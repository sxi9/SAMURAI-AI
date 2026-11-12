"""SAMURAI auto-tune: read the hardware, recommend settings, apply them. Mounted into the control panel (:9000).

GET  /tune                 -> {profile, recommendation, applied, browser, warnings}
POST /tune {apply: true}   -> writes the recommendation into config.json (ui.gl_quality, voice.whisper_model, services.profile, …)
POST /tune/report {renderer, vendor, fps}   from the HUD: which GPU the browser really uses and how fast it renders

The profile is cheap to compute (a few shell calls) and cached for 60 s. Everything degrades gracefully: a probe that fails
just leaves its field empty."""
import json, os, platform, re, shutil, subprocess, sys, time

try:
    import psutil
except ImportError:                                     # the panel always has psutil (telemetry needs it); keep the module importable anyway
    psutil = None

from samurai_common import ROOT, load_config, save_config, IS_WIN, IS_MAC

_cache = {"t": 0, "profile": None}
_browser = {}                                           # last report from the HUD

INTEGRATED = re.compile(r"Vega \d|Radeon\(TM\) Graphics|Radeon Graphics$|Intel.*(UHD|HD Graphics|Iris|Xe)|Apple M\d|Mali|Adreno", re.I)
DISCRETE = re.compile(r"RTX|GTX|Radeon RX|RX \d{3}|Arc A[357]\d|Quadro|Tesla|Radeon Pro|Radeon VII|GeForce", re.I)
VIRTUAL_GPU = re.compile(r"VMware|VirtualBox|Hyper-V|llvmpipe|SwiftShader|Microsoft Basic|Remote Display|QXL|virtio|Parallels", re.I)
VIRTUAL_CAM = re.compile(r"Iriun|DroidCam|Snap Camera|OBS|Virtual|NDI|XSplit|ManyCam|EpocCam|Camo|Reincubate", re.I)
VIRTUAL_NET = re.compile(r"VMware|VirtualBox|vEthernet|Hyper-V|docker|veth|^br-|Loopback|^lo$|WSL|Npcap|TAP-|Bluetooth", re.I)
VPN_NET = re.compile(r"Tailscale|ZeroTier|WireGuard|OpenVPN|tun\d|utun|Hamachi|NordLynx", re.I)


def run(cmd, timeout=8):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, shell=isinstance(cmd, str)).stdout
    except Exception:
        return ""


def ps(script):
    """Run a PowerShell snippet on Windows and parse its JSON output (list)."""
    out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script + " | ConvertTo-Json -Compress"], timeout=20)
    try:
        data = json.loads(out.strip() or "[]")
        return data if isinstance(data, list) else [data]
    except Exception:
        return []


def cpu_info():
    name, cores, threads, mhz = platform.processor() or "", os.cpu_count() or 0, os.cpu_count() or 0, 0
    try:
        cores = psutil.cpu_count(logical=False) or cores
        f = psutil.cpu_freq()
        mhz = int(f.max or f.current or 0) if f else 0
    except Exception:
        pass
    if IS_WIN:
        for r in ps("Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed"):
            name = r.get("Name", name).strip(); cores = r.get("NumberOfCores", cores); threads = r.get("NumberOfLogicalProcessors", threads); mhz = r.get("MaxClockSpeed", mhz)
    elif IS_MAC:
        name = run(["sysctl", "-n", "machdep.cpu.brand_string"]).strip() or name
    else:
        try:
            for line in open("/proc/cpuinfo", encoding="utf-8", errors="ignore"):
                if line.lower().startswith("model name"):
                    name = line.split(":", 1)[1].strip(); break
        except Exception:
            pass
    return {"name": name, "cores": cores, "threads": threads, "mhz": mhz}


def gpu_info():
    gpus = []
    if IS_WIN:
        for r in ps("Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion"):
            gpus.append({"name": str(r.get("Name", "")), "vram_gb": round((r.get("AdapterRAM") or 0) / 1e9, 1), "driver": str(r.get("DriverVersion", ""))})
    elif IS_MAC:
        out = run(["system_profiler", "SPDisplaysDataType"], timeout=15)
        for m in re.finditer(r"Chipset Model: (.+)", out):
            gpus.append({"name": m.group(1).strip(), "vram_gb": 0, "driver": ""})
    else:
        out = run("lspci 2>/dev/null | grep -Ei 'vga|3d|display'")
        for line in out.splitlines():
            gpus.append({"name": line.split(":", 2)[-1].strip(), "vram_gb": 0, "driver": ""})
        if shutil.which("nvidia-smi"):
            for line in run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"]).splitlines():
                p = [x.strip() for x in line.split(",")]
                if len(p) == 3:
                    gpus.append({"name": p[0], "vram_gb": round(float(p[1].split()[0]) / 1024, 1), "driver": p[2]})
    for g in gpus:
        n = g["name"]
        g["kind"] = "virtual" if VIRTUAL_GPU.search(n) else "discrete" if DISCRETE.search(n) else "integrated" if INTEGRATED.search(n) else "unknown"
    return gpus


def camera_info():
    cams = []
    if IS_WIN:
        for r in ps("Get-PnpDevice -Class Camera,Image -Status OK -ErrorAction SilentlyContinue | Select-Object FriendlyName"):
            n = str(r.get("FriendlyName", "")).strip()
            if n and not re.search(r"printer|deskjet|scanner|officejet", n, re.I):
                cams.append({"name": n, "virtual": bool(VIRTUAL_CAM.search(n))})
    elif not IS_MAC:
        try:
            for d in sorted(os.listdir("/sys/class/video4linux")):
                n = open(f"/sys/class/video4linux/{d}/name", encoding="utf-8", errors="ignore").read().strip()
                cams.append({"name": f"{n} ({d})", "virtual": bool(VIRTUAL_CAM.search(n) or "loopback" in n.lower())})
        except Exception:
            pass
    return cams


def network_info():
    nets = []
    if not psutil:
        return nets
    try:
        stats = psutil.net_if_stats()
        for name, addrs in psutil.net_if_addrs().items():
            ip = next((a.address for a in addrs if getattr(a, "family", None) and a.family.name == "AF_INET"), None)
            if not ip or ip.startswith("127."):
                continue
            kind = "vpn" if VPN_NET.search(name) else "virtual" if VIRTUAL_NET.search(name) or ip.startswith("169.254.") else "physical"
            nets.append({"name": name, "ip": ip, "kind": kind, "up": bool(stats.get(name) and stats[name].isup), "speed": getattr(stats.get(name), "speed", 0) or 0})
    except Exception:
        pass
    order = {"physical": 0, "vpn": 1, "virtual": 2}
    nets.sort(key=lambda n: (order.get(n["kind"], 3), not n["up"], -n["speed"]))
    return nets


def profile(force=False):
    if _cache["profile"] and not force and time.time() - _cache["t"] < 60:
        return _cache["profile"]
    p = {"os": f"{platform.system()} {platform.release()}", "machine": platform.machine(), "cpu": cpu_info(), "ram_gb": 0, "ram_free_gb": 0,
         "gpus": gpu_info(), "battery": None, "disk_free_gb": 0, "cameras": camera_info(), "networks": network_info(),
         "tools": {t: bool(shutil.which(t)) for t in ("claude", "gemini", "ollama", "node", "git", "ffmpeg")}, "python": sys.version.split()[0]}
    try:
        vm = psutil.virtual_memory(); p["ram_gb"] = round(vm.total / 2**30, 1); p["ram_free_gb"] = round(vm.available / 2**30, 1)
        b = psutil.sensors_battery(); p["battery"] = {"percent": b.percent, "plugged": b.power_plugged} if b else None
        p["disk_free_gb"] = round(psutil.disk_usage(ROOT).free / 2**30, 1)
    except Exception:
        pass
    _cache.update(t=time.time(), profile=p)
    return p


def recommend(p):
    """Turn a profile into settings plus plain-language reasons."""
    kinds = {g["kind"] for g in p["gpus"]}
    discrete = next((g for g in p["gpus"] if g["kind"] == "discrete"), None)
    vm = bool(kinds & {"virtual"}) and not discrete and "integrated" not in kinds
    ram, cores = p["ram_gb"] or 0, p["cpu"]["cores"] or 1
    laptop = p["battery"] is not None
    rec, why, warn = {}, [], []
    if vm or not p["gpus"]:
        rec["gl"], rec["gl_quality"] = ("off" if vm else "auto"), "low"; why.append("no real GPU found: 2D core" if vm else "GPU unknown: 3D on low until measured")
    elif discrete:
        rec["gl"], rec["gl_quality"] = "auto", "high"; why.append(f"discrete GPU {discrete['name']}: 3D core on high")
    else:
        rec["gl"], rec["gl_quality"] = "auto", "medium"; why.append("integrated GPU: 3D core on medium")
    rec["fx"] = not vm
    rec["stt_engine"] = "vosk"; rec["whisper_model"] = "base" if ram >= 7.5 and cores >= 4 else "tiny"; rec["whisper_ok"] = ram >= 5.5
    why.append(f"speech: Vosk small by default; Whisper {rec['whisper_model']} fits ({ram} GB RAM, {cores} cores)" if rec["whisper_ok"] else "speech: Vosk only, Whisper needs 6 GB of RAM")
    rec["kokoro_ok"] = ram >= 11.5; why.append("local Kokoro voice: " + ("fits" if rec["kokoro_ok"] else f"not recommended with {ram} GB RAM, use Edge or a key voice"))
    rec["local_llm"] = "14B models" if ram >= 30 else "7B-8B models" if ram >= 15 else "3B models only, slow" if ram >= 7.5 else "no"
    rec["brain"] = "claude_code" if p["tools"].get("claude") else "ollama" if (p["tools"].get("ollama") and ram >= 15) else "cloud"
    why.append({"claude_code": "brain: Claude Code is installed, sign in from the panel", "ollama": "brain: Ollama is installed and there is enough RAM", "cloud": "brain: use a cloud provider or sign in to Claude Code"}[rec["brain"]])
    rec["services_profile"] = "essentials" if ram < 11.5 or cores <= 4 else "full"
    why.append("startup: " + ("essentials profile, browser and headless agents start on demand" if rec["services_profile"] == "essentials" else "full profile, every service at boot"))
    rec["half_duplex"] = laptop; why.append("mic: " + ("half duplex on a laptop (mic muted while it speaks)" if laptop else "full duplex"))
    rec["governor"] = True
    cams = [c for c in p["cameras"] if not c["virtual"]]
    rec["presence_camera"] = cams[0]["name"] if cams else (p["cameras"][0]["name"] if p["cameras"] else "")
    if p["cameras"]:
        why.append(f"presence camera: {rec['presence_camera'] or 'none'}" + (f" ({len(p['cameras']) - len(cams)} virtual ignored)" if len(cams) < len(p["cameras"]) else ""))
    phys = [n for n in p["networks"] if n["kind"] == "physical"]
    rec["lan_ip"] = phys[0]["ip"] if phys else (p["networks"][0]["ip"] if p["networks"] else "")
    if p["disk_free_gb"] and p["disk_free_gb"] < 2:
        warn.append(f"only {p['disk_free_gb']} GB free on the SAMURAI drive: model downloads need up to 2 GB")
    if ram and ram < 7.5:
        warn.append(f"{ram} GB RAM: keep one browser tab, skip Kokoro and Whisper")
    if discrete and any(g["kind"] == "integrated" for g in p["gpus"]):
        warn.append(f"two GPUs: make sure the browser runs on {discrete['name']} (Windows: Settings → System → Display → Graphics)")
    return rec, why, warn


def browser_warning(p, rep):
    if not rep.get("renderer"):
        return ""
    r = rep["renderer"]
    discrete = next((g for g in p["gpus"] if g["kind"] == "discrete"), None)
    if VIRTUAL_GPU.search(r) and p["gpus"] and not any(g["kind"] == "virtual" for g in p["gpus"]):
        return f"the browser renders in software ({r[:40]}): enable hardware acceleration in the browser settings"
    if discrete and INTEGRATED.search(r) and not DISCRETE.search(r):
        return f"the browser is using the integrated GPU ({r[:40]}) while {discrete['name']} is available: set the browser to high performance in the graphics settings"
    return ""


def status():
    p = profile(); rec, why, warn = recommend(p)
    bw = browser_warning(p, _browser)
    if bw:
        warn = warn + [bw]
    cfg = load_config()
    return {"ok": True, "profile": p, "recommendation": rec, "why": why, "warnings": warn, "browser": _browser, "applied": cfg.get("tune", {}).get("applied_at", 0), "current": {
        "gl": cfg.get("ui", {}).get("gl"), "gl_quality": cfg.get("ui", {}).get("gl_quality"), "whisper_model": cfg.get("voice", {}).get("whisper_model"),
        "services_profile": cfg.get("services", {}).get("profile", "full"), "half_duplex": cfg.get("voice", {}).get("half_duplex"), "presence_camera": cfg.get("widgets", {}).get("presence_camera", "")}}


def apply(overrides=None):
    p = profile(True); rec, why, warn = recommend(p); rec.update(overrides or {})
    cfg = load_config()
    cfg.setdefault("ui", {}).update({"gl": rec["gl"], "gl_quality": rec["gl_quality"], "fx": rec["fx"], "governor": rec["governor"]})
    cfg.setdefault("voice", {}).update({"whisper_model": rec["whisper_model"], "half_duplex": rec["half_duplex"]})
    cfg.setdefault("services", {})["profile"] = rec["services_profile"]
    cfg.setdefault("widgets", {})["presence_camera"] = rec["presence_camera"]
    cfg.setdefault("lan", {})["preferred_ip"] = rec["lan_ip"]
    cfg["tune"] = {"applied_at": int(time.time()), "profile": {"cpu": p["cpu"]["name"], "ram_gb": p["ram_gb"], "gpus": [g["name"] for g in p["gpus"]], "os": p["os"]}, "recommendation": rec}
    save_config(cfg)
    return {"ok": True, "applied": rec, "why": why, "warnings": warn}


def get_tune(h, q, b):
    return status()


def post_tune(h, q, b):
    if b.get("apply"):
        return apply(b.get("overrides"))
    return status()


def post_report(h, q, b):
    _browser.update({k: b.get(k) for k in ("renderer", "vendor", "fps", "quality") if k in b}); _browser["t"] = time.time()
    p = profile(); w = browser_warning(p, _browser)
    return {"ok": True, "warning": w, "recommendation": recommend(p)[0]}


def first_run():
    """Called by the panel at start: apply once when nothing was tuned yet, so a fresh install gets sane defaults."""
    try:
        if not load_config().get("tune", {}).get("applied_at"):
            apply()
            return True
    except Exception:
        pass
    return False


def free_gb():
    try:
        return psutil.disk_usage(ROOT).free / 2**30
    except Exception:
        return 999


ROUTES = {("GET", "/tune"): get_tune, ("POST", "/tune"): post_tune, ("POST", "/tune/report"): post_report}

if __name__ == "__main__":
    print(json.dumps(status(), indent=1)[:4000])
