"""SAMURAI Control Panel + Supervisor — port 9000, every OS.

Serves the browser control panel (app/panel.html) and manages the services:
start / stop / restart, health, logs, a watchdog that restarts crashed services
and repairs common failures, a "doctor" that checks the whole install, and the
start-with-boot switch.

    python samurai_panel.py [--autostart] [--no-browser]

--autostart  start every service, then open the HUD (unless --no-browser)
"""
import io, json, os, re, shutil, socket, subprocess, sys, threading, time, urllib.error, urllib.request, uuid, webbrowser, zipfile
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import (bind_host, JSONHandler, PORTS, ROOT, APP, LOGS, MODELS, DATA, NOWIN, IS_WIN, IS_MAC, service_defs, venv_python,
                            load_config, save_config, port_up, any_valid_model, ensure_model, CONFIG_PATH, CONFIG_EXAMPLE, VERSION,
                            lan_ips, scheme, tls_enabled, ensure_cert, tls_paths, maybe_wrap_tls, http_json)
import samurai_autostart as autostart
import samurai_tune as tune

PORT = PORTS["panel"]
if "--port" in sys.argv:
    PORT = int(sys.argv[sys.argv.index("--port") + 1])
UI_URL = f"http://localhost:{PORTS['ui']}/jarvis-interface.html"
RELEASES_API = "https://api.github.com/repos/sxi9/SAMURAI-AI/releases/latest"
PIP_NAME = {"vosk": "vosk", "websockets": "websockets", "psutil": "psutil", "edge_tts": "edge-tts", "playwright": "playwright"}
SERVICES = service_defs()
BY_KEY = {s["key"]: s for s in SERVICES}
procs, starts, LOCK = {}, {}, threading.Lock()
STATE = {"status": "idle", "message": "", "watchdog": True}


# ----------------------------------------------------------------------------- process control
def health(svc):
    if not port_up(svc["port"]):
        return "down", "OFFLINE"
    if not svc["check"]:
        return "ok", "PORT OK"
    t0 = time.time()
    try:
        urllib.request.urlopen(svc["check"], timeout=2).read(64)
        return "ok", f"{int((time.time() - t0) * 1000)} ms"
    except urllib.error.HTTPError:
        return "ok", f"{int((time.time() - t0) * 1000)} ms"
    except Exception:
        return "warn", "NO RESPONSE"


def start(svc):
    if port_up(svc["port"]):
        return False
    os.makedirs(LOGS, exist_ok=True)
    log = open(os.path.join(LOGS, svc["key"] + ".log"), "w", encoding="utf-8", errors="replace")
    with LOCK:
        procs[svc["key"]] = subprocess.Popen(svc["cmd"], creationflags=NOWIN, cwd=ROOT, stdout=log, stderr=log)
        starts.setdefault(svc["key"], []).append(time.time())
    return True


def kill_port(port):
    try:
        import psutil
        for c in psutil.net_connections(kind="tcp"):
            if c.laddr and c.laddr.port == port and c.status == "LISTEN" and c.pid:
                psutil.Process(c.pid).terminate()
    except Exception:
        pass


def stop(svc):
    with LOCK:
        p = procs.pop(svc["key"], None)
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(5)
        except subprocess.TimeoutExpired:
            p.kill()
    else:
        kill_port(svc["port"])


def read_log(key, n=4000):
    try:
        with open(os.path.join(LOGS, key + ".log"), encoding="utf-8", errors="ignore") as f:
            return f.read()[-n:]
    except OSError:
        return ""


def set_status(msg):
    STATE["message"] = msg[:120]
    print(f"[SAMURAI-PANEL] {msg}")


def pip_install(pkg):
    if getattr(sys, "frozen", False):
        return False                      # packaged build: everything it needs is bundled
    r = subprocess.run([venv_python(), "-m", "pip", "install", pkg], capture_output=True, text=True, creationflags=NOWIN)
    return r.returncode == 0


def auto_fix(svc):
    """Diagnose a dead service from its log, repair, restart. Returns a status string."""
    log = read_log(svc["key"])
    m = re.search(r"No module named '(\w+)'", log)
    if m:
        pkg = PIP_NAME.get(m.group(1), m.group(1))
        set_status(f"{svc['name']}: installing missing package {pkg}…")
        if not pip_install(pkg):
            return f"pip install {pkg} failed — see logs/{svc['key']}.log"
        if pkg == "playwright":
            set_status("installing Chromium for the browser agent…")
            subprocess.run([venv_python(), "-m", "playwright", "install", "chromium"], capture_output=True, text=True, creationflags=NOWIN)
        return restart_and_report(svc, f"installed {pkg}")
    if svc["key"] == "speech" and ("no valid vosk model" in log.lower() or "no vosk model" in log.lower() or not any_valid_model()):
        ok, msg = ensure_model(set_status)
        if not ok:
            return msg
        return restart_and_report(svc, "voice model installed")
    if "WinError 126" in log or "libvosk" in log:
        webbrowser.open("https://aka.ms/vs/17/release/vc_redist.x64.exe")
        return "needs Microsoft VC++ runtime — installer download opened, run it and press START ALL again"
    if "10048" in log or "Address already in use" in log:
        return f"port {svc['port']} is used by another program"
    return restart_and_report(svc, "restarted", fallback=f"still failing — see logs/{svc['key']}.log")


def restart_and_report(svc, action, fallback=None):
    stop(svc)
    time.sleep(1)
    start(svc)
    deadline = time.time() + (120 if svc["key"] == "speech" else 15)
    while time.time() < deadline:
        if health(svc)[0] == "ok":
            return f"{action} — ONLINE"
        time.sleep(1)
    return fallback or f"{action}, but still offline — see logs/{svc['key']}.log"


def bring_up_all(open_ui=True):
    STATE["status"] = "starting"
    try:
        if tune.first_run():
            set_status("auto-tune applied for this machine")
        speech = BY_KEY["speech"]
        set_status("checking voice stack…")
        ok, msg = ensure_model(set_status)
        set_status(msg)
        wanted = wanted_services()
        for svc in wanted:
            start(svc)
        deadline = time.time() + 150
        while time.time() < deadline:
            broken = [s for s in wanted if health(s)[0] != "ok"]
            if not broken:
                break
            dead = [s for s in broken if not (procs.get(s["key"]) and procs[s["key"]].poll() is None)]
            for svc in dead:
                set_status(f"fixing {svc['name']}…")
                set_status(svc["name"] + ": " + auto_fix(svc))
            if dead:
                break
            time.sleep(2)
        up = sum(1 for s in wanted if health(s)[0] == "ok")
        set_status(f"{up}/{len(wanted)} services online" + ("" if len(wanted) == len(SERVICES) else f" (essentials profile, {len(SERVICES) - len(wanted)} on demand)"))
        if open_ui and health(BY_KEY["ui"])[0] == "ok":
            webbrowser.open(UI_URL)
    finally:
        STATE["status"] = "idle"


ON_DEMAND = ("agent", "browser")                      # the essentials profile starts these only when the HUD asks for them


def wanted_services():
    prof = load_config().get("services", {}).get("profile", "full")
    return [s for s in SERVICES if prof != "essentials" or s["key"] not in ON_DEMAND]


def watchdog():
    """Restart services the panel started if they die; at most 3 restarts per 10 minutes each."""
    while True:
        time.sleep(10)
        if not STATE["watchdog"] or STATE["status"] != "idle":
            continue
        for svc in SERVICES:
            p = procs.get(svc["key"])
            if p is None or p.poll() is None:
                continue
            recent = [t for t in starts.get(svc["key"], []) if time.time() - t < 600]
            if len(recent) >= 3:
                continue
            set_status(f"watchdog: {svc['name']} exited — {auto_fix(svc)}")


# ----------------------------------------------------------------------------- doctor
def doctor(fix=False):
    checks = []

    def add(name, ok, detail, fixable=False):
        checks.append({"name": name, "ok": bool(ok), "detail": detail, "fixable": fixable})

    v = sys.version_info
    add("Python", v >= (3, 9), f"{v.major}.{v.minor}.{v.micro}" + ("" if v >= (3, 9) else " — need 3.9+"))
    try:
        tp = tune.profile(); rec = tune.recommend(tp)[0]
        add("Free disk", tp["disk_free_gb"] >= 2, f"{tp['disk_free_gb']} GB free" + ("" if tp["disk_free_gb"] >= 2 else " — models need up to 2 GB"))
        add("Memory", tp["ram_gb"] >= 8, f"{tp['ram_gb']} GB" + ("" if tp["ram_gb"] >= 8 else " — tight: skip Kokoro and Whisper"))
        add("GPU", bool(tp["gpus"]) and all(g["kind"] != "virtual" for g in tp["gpus"]), ", ".join(g["name"] for g in tp["gpus"]) or "none found")
        bw = tune.browser_warning(tp, tune._browser)
        add("Browser GPU", not bw, bw or (tune._browser.get("renderer", "")[:60] or "open the HUD once to measure"))
        add("Auto-tune", bool(load_config().get("tune", {}).get("applied_at")), f"3D {rec['gl_quality']}, Whisper {rec['whisper_model']}, {rec['services_profile']} profile" if load_config().get("tune", {}).get("applied_at") else "not applied yet — click AUTO-TUNE")
    except Exception as e:
        add("Auto-tune", False, f"profile failed: {str(e)[:60]}")
    py = venv_python()
    from samurai_common import FROZEN
    if FROZEN:
        add("Packaged build", True, sys.executable)
    else:
        add("Virtual environment", ".venv" in py, py if ".venv" in py else "running on the system Python — run install.py to create .venv", fixable=False)
    for mod, pkg in ([] if FROZEN else list(PIP_NAME.items())[:4]):
        r = subprocess.run([py, "-c", f"import {mod}"], capture_output=True, text=True, creationflags=NOWIN)
        ok = r.returncode == 0
        if not ok and fix:
            ok = pip_install(pkg) and subprocess.run([py, "-c", f"import {mod}"], capture_output=True, creationflags=NOWIN).returncode == 0
        add(f"Package {pkg}", ok, "installed" if ok else "missing — pip install " + pkg, fixable=True)
    has_model = any_valid_model()
    if not has_model and fix:
        has_model = ensure_model(set_status)[0]
    add("Voice model", has_model, os.path.join(MODELS, "vosk-model-*") if has_model else "missing — download from the panel", fixable=True)
    cfg_ok = os.path.exists(CONFIG_PATH)
    if not cfg_ok and fix and os.path.exists(CONFIG_EXAMPLE):
        shutil.copy(CONFIG_EXAMPLE, CONFIG_PATH); cfg_ok = True
    cfg = load_config()
    add("config.json", cfg_ok, "present" if cfg_ok else "missing — created from example on first run", fixable=True)
    loc = cfg.get("location", {})
    add("Location set", bool(loc.get("lat") or loc.get("lon")), f"{loc.get('label')} {loc.get('lat')}, {loc.get('lon')}" if loc.get("lat") else "not set — weather and position use sample data")
    for svc in SERVICES:
        st, d = health(svc)
        add(f"Service {svc['name']} :{svc['port']}", st == "ok", d)
    for name, cmd in (("Ollama", "ollama"), ("Claude Code CLI", "claude"), ("Gemini CLI", "gemini"), ("Node.js", "node"), ("ffmpeg", "ffmpeg")):
        add(name, bool(shutil.which(cmd)), shutil.which(cmd) or "not installed (optional)")
    try:
        urllib.request.urlopen("https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m", timeout=6).read(32)
        add("Internet (weather API)", True, "reachable")
    except Exception as e:
        add("Internet (weather API)", False, str(e)[:80])
    try:
        total, used, free = shutil.disk_usage(ROOT)
        add("Disk space", free > 2e9, f"{free / 1e9:.1f} GB free")
    except Exception:
        pass
    add("Autostart", True, "on" if autostart.status() else "off")
    return checks


# ----------------------------------------------------------------------------- routes
def get_status(h, q, b):
    out = []
    for svc in SERVICES:
        st, d = health(svc)
        p = procs.get(svc["key"])
        out.append({"key": svc["key"], "name": svc["name"], "port": svc["port"], "state": st, "detail": d,
                    "managed": bool(p and p.poll() is None)})
    return {"ok": True, "services": out, "status": STATE["status"], "message": STATE["message"],
            "watchdog": STATE["watchdog"], "autostart": autostart.status(), "ui": UI_URL, "python": venv_python(),
            "model": any_valid_model(), "os": sys.platform}


def post_control(h, q, b):
    act, key = b.get("action"), b.get("key")
    if act == "start_all":
        threading.Thread(target=bring_up_all, args=(bool(b.get("open", False)),), daemon=True).start()
        return {"ok": True, "did": "starting all services"}
    if act == "stop_all":
        for svc in reversed(SERVICES):
            stop(svc)
        STATE["message"] = "all services stopped"
        return {"ok": True, "did": "stopped"}
    svc = BY_KEY.get(key)
    if not svc:
        raise ValueError("unknown service")
    if act == "start":
        start(svc); return {"ok": True, "did": f"starting {svc['name']}"}
    if act == "stop":
        stop(svc); return {"ok": True, "did": f"stopped {svc['name']}"}
    if act == "restart":
        threading.Thread(target=lambda: set_status(svc["name"] + ": " + restart_and_report(svc, "restarted")), daemon=True).start()
        return {"ok": True, "did": f"restarting {svc['name']}"}
    if act == "fix":
        threading.Thread(target=lambda: set_status(svc["name"] + ": " + auto_fix(svc)), daemon=True).start()
        return {"ok": True, "did": f"diagnosing {svc['name']}"}
    raise ValueError("action must be start|stop|restart|fix|start_all|stop_all")


def get_logs(h, q, b):
    key = q.get("key", "ui")
    if key not in BY_KEY and key != "panel":
        raise ValueError("unknown service")
    return {"ok": True, "key": key, "log": read_log(key, int(q.get("n", 6000)))}


def get_doctor(h, q, b):
    return {"ok": True, "checks": doctor(fix=q.get("fix") == "1")}


def post_autostart(h, q, b):
    try:
        (autostart.enable if b.get("on") else autostart.disable)()
        return {"ok": True, "autostart": autostart.status()}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200], "autostart": autostart.status()}


def post_watchdog(h, q, b):
    STATE["watchdog"] = bool(b.get("on", True))
    return {"ok": True, "watchdog": STATE["watchdog"]}


MODEL_NEED_GB = {"vosk-model-small-en-us-0.15": 0.2, "vosk-model-en-us-0.22": 4.0, "kokoro": 0.6, "whisper": 0.5, "wake": 0.3}


def disk_guard(what):
    need = MODEL_NEED_GB.get(what, 0.5); free = tune.free_gb()
    if free < need + 0.5:
        raise ValueError(f"not enough disk space: {free:.1f} GB free, {what} needs about {need} GB plus headroom")


def post_model(h, q, b):
    disk_guard(b.get("name") or "vosk-model-small-en-us-0.15")

    def run():
        STATE["status"] = "model"
        try:
            ok, msg = ensure_model(set_status, name=b.get("name") or "vosk-model-small-en-us-0.15")
            set_status(msg)
        finally:
            STATE["status"] = "idle"
    threading.Thread(target=run, daemon=True).start()
    return {"ok": True, "did": "downloading"}


KOKORO_FILES = {"kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
                "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"}


def post_voice_extras(h, q, b):
    """Install optional voice engines: {"what": "kokoro"} local TTS (~330 MB) · {"what": "wake"} VAD + openWakeWord."""
    what = b.get("what")
    if what not in ("kokoro", "wake", "whisper"):
        raise ValueError("what must be kokoro|wake|whisper")
    disk_guard(what)

    def run():
        STATE["status"] = "installing"
        try:
            from samurai_common import download_with_resume, load_config, save_config
            if what == "kokoro":
                set_status("pip install kokoro-onnx soundfile …")
                if not pip_install("kokoro-onnx") or not pip_install("soundfile"):
                    set_status("kokoro-onnx install failed — see the terminal"); return
                d = os.path.join(MODELS, "kokoro"); os.makedirs(d, exist_ok=True)
                for name, url in KOKORO_FILES.items():
                    dest = os.path.join(d, name)
                    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
                        continue
                    set_status(f"downloading {name} …")
                    if not download_with_resume(url, dest, lambda s: set_status(f"{name}: {s}"), attempts=20):
                        set_status(f"download of {name} failed"); return
                cfg = load_config(); cfg.setdefault("voice", {})["tts_engine"] = "kokoro"; save_config(cfg)
                set_status("local voice (Kokoro) installed — restarting TTS")
                restart_and_report(BY_KEY["tts"], "restarted")
            elif what == "whisper":
                set_status("pip install faster-whisper … (the model downloads on first use, ~150 MB for 'base')")
                if not pip_install("faster-whisper"):
                    set_status("faster-whisper install failed — see the terminal"); return
                cfg = load_config(); cfg.setdefault("voice", {})["stt_engine"] = "whisper"; save_config(cfg)
                set_status("whisper installed — restarting speech (first start downloads the model)")
                restart_and_report(BY_KEY["speech"], "restarted")
            else:
                set_status("pip install webrtcvad-wheels openwakeword …")
                ok = pip_install("webrtcvad-wheels") and pip_install("openwakeword")
                if not ok:
                    set_status("wake word install failed — see the terminal"); return
                cfg = load_config(); cfg.setdefault("voice", {})["wake_engine"] = "openwakeword"; save_config(cfg)
                set_status("wake word engine installed — restarting speech")
                restart_and_report(BY_KEY["speech"], "restarted")
        finally:
            STATE["status"] = "idle"
    threading.Thread(target=run, daemon=True).start()
    return {"ok": True, "did": f"installing {what}"}


def post_lan(h, q, b):
    """Turn LAN mode on/off. Services restart so they rebind. Returns the phone link with the token."""
    import secrets
    cfg = load_config(); lan = cfg.setdefault("lan", {})
    lan["enabled"] = bool(b.get("on"))
    if "https" in b:
        lan["https"] = bool(b.get("https"))
    if lan["enabled"] and not lan.get("token"):
        lan["token"] = secrets.token_urlsafe(12)
    cert_msg = ""
    if lan["enabled"] and lan.get("https"):
        ok, cert_msg = ensure_cert()
        if not ok:
            lan["https"] = False
    save_config(cfg)
    def restart_all():
        STATE["status"] = "restarting"
        try:
            for svc in reversed(SERVICES):
                stop(svc)
            time.sleep(1.5)
            SERVICES[:] = service_defs()             # rebind: LAN mode changes the listen address
            BY_KEY.clear(); BY_KEY.update({s["key"]: s for s in SERVICES})
            bring_up_all(False)
        finally:
            STATE["status"] = "idle"
    threading.Thread(target=restart_all, daemon=True).start()
    ips = ordered_ips(); sch = "https" if lan.get("https") else "http"
    return {"ok": True, "enabled": lan["enabled"], "https": bool(lan.get("https")), "token": lan.get("token", ""), "ips": ips, "cert": cert_msg,
            "links": [f"{sch}://{ip}:{PORTS['ui']}/jarvis-interface.html?token={lan.get('token', '')}" for ip in ips] if lan["enabled"] else []}


# ----------------------------------------------------------------------------- phone pairing + relay
def phone_links(cfg=None):
    cfg = cfg or load_config(); lan = cfg.get("lan", {})
    if not lan.get("enabled"):
        return []
    sch = "https" if lan.get("https") else "http"
    return [f"{sch}://{ip}:{PORTS['ui']}/jarvis-interface.html?token={lan.get('token', '')}&companion=1" for ip in ordered_ips()]


def ordered_ips():
    """LAN addresses with the physical adapter first (Wi-Fi / Ethernet), then VPN, then virtual adapters."""
    ips = list(lan_ips())
    try:
        nets = tune.network_info(); known = {n["ip"]: i for i, n in enumerate(nets)}
        ips.sort(key=lambda ip: known.get(ip, 99))
        pref = load_config().get("lan", {}).get("preferred_ip")
        if pref in ips:
            ips.remove(pref); ips.insert(0, pref)
    except Exception:
        pass
    return ips


def get_phone(h, q, b):
    """Pairing info: links, ips, https state, a QR (svg) of the first link, the certificate to install on the phone."""
    cfg = load_config(); lan = cfg.get("lan", {}); links = phone_links(cfg); svg = ""
    if links:
        try:
            import qrcode, qrcode.image.svg
            img = qrcode.make(links[0], image_factory=qrcode.image.svg.SvgPathImage, box_size=6, border=2)
            svg = img.to_string(encoding="unicode")
        except Exception as e:
            svg = f"<!-- qr unavailable: {e} -->"
    crt = tls_paths()[0]
    return {"ok": True, "enabled": bool(lan.get("enabled")), "https": bool(lan.get("https")), "ips": lan_ips(), "links": links, "qr": svg,
            "cert_url": "/phone/cert" if os.path.exists(crt) else "", "token": lan.get("token", "")}


def get_phone_cert(h, q, b):
    crt = tls_paths()[0]
    if not os.path.exists(crt):
        raise ValueError("no certificate yet — switch https on first")
    with open(crt, "rb") as f:
        h.send_bytes(f.read(), "application/x-x509-ca-cert", extra={"Content-Disposition": "attachment; filename=samurai.crt"})
    return None


RELAY = {"queue": [], "taken": {}, "replies": {}, "lock": threading.Lock(), "event": threading.Condition()}


def post_remote_command(h, q, b):
    """From the phone: {text, speak_on: phone|pc|both}. Queued for the PC HUD."""
    text = (b.get("text") or "").strip()[:500]
    if not text:
        raise ValueError("text required")
    item = {"id": uuid.uuid4().hex[:10], "text": text, "speak_on": b.get("speak_on") or "both", "t": time.time(), "from": h.client_address[0] if h.client_address else ""}
    with RELAY["lock"]:
        RELAY["queue"].append(item)
        RELAY["queue"][:] = [x for x in RELAY["queue"] if time.time() - x["t"] < 60]
    return {"ok": True, "id": item["id"]}


def get_remote_next(h, q, b):
    """Polled by the PC HUD: the oldest pending command, or {command: null}."""
    with RELAY["lock"]:
        item = RELAY["queue"].pop(0) if RELAY["queue"] else None
        if item:
            RELAY["taken"][item["id"]] = item
    return {"ok": True, "command": item, "pending": len(RELAY["queue"])}


def post_remote_reply(h, q, b):
    """From the PC HUD: {id, text, focus?}. Wakes the phone's long-poll."""
    rid = b.get("id")
    if not rid:
        raise ValueError("id required")
    with RELAY["event"]:
        RELAY["replies"][rid] = {"id": rid, "text": (b.get("text") or "")[:2000], "focus": b.get("focus"), "t": time.time()}
        for k in [k for k, v in RELAY["replies"].items() if time.time() - v["t"] > 300]:
            RELAY["replies"].pop(k, None)
        RELAY["event"].notify_all()
    return {"ok": True}


def get_remote_reply(h, q, b):
    """Polled by the phone (long-poll up to 20 s): ?id= -> {reply} or {reply: null} on timeout."""
    rid = q.get("id")
    if not rid:
        raise ValueError("id required")
    deadline = time.time() + min(20, float(q.get("wait", 20)))
    with RELAY["event"]:
        while rid not in RELAY["replies"] and time.time() < deadline:
            RELAY["event"].wait(max(0.05, deadline - time.time()))
        rep = RELAY["replies"].pop(rid, None)
    return {"ok": True, "reply": rep}


# broadcast to every companion page (find my phone: ring; say): kept 120 s, pages poll /remote/events
BCAST = {"events": [], "pages": {}, "lock": threading.Lock()}


def post_remote_broadcast(h, q, b):
    """{kind: ring|say, text} -> every companion page that polls /remote/events gets it. Returns how many pages polled in the last 30 s."""
    kind = (b.get("kind") or "say")[:20]
    with BCAST["lock"]:
        BCAST["events"].append({"t": time.time(), "kind": kind, "text": (b.get("text") or "")[:500]})
        BCAST["events"][:] = [e for e in BCAST["events"] if time.time() - e["t"] < 120]
        pages = sum(1 for t in BCAST["pages"].values() if time.time() - t < 30)
    return {"ok": True, "pages": pages}


def get_remote_events(h, q, b):
    """Polled by companion pages every few seconds: ?since=<unix ts> -> {events:[{t, kind, text}], now, pages}. ?peek=1 does not count as a page."""
    since = float(q.get("since", 0) or 0)
    with BCAST["lock"]:
        if q.get("peek") != "1":
            key = (h.client_address[0] if h.client_address else "?") + "|" + (h.headers.get("User-Agent") or "")[:40]
            BCAST["pages"][key] = time.time()
            for k in [k for k, t in BCAST["pages"].items() if time.time() - t > 300]:
                BCAST["pages"].pop(k, None)
        events = [e for e in BCAST["events"] if e["t"] > since and time.time() - e["t"] < 120]
        pages = sum(1 for t in BCAST["pages"].values() if time.time() - t < 30)
    return {"ok": True, "events": events, "now": time.time(), "pages": pages}


RELAY_ROUTES = {("POST", "/remote/broadcast"): post_remote_broadcast, ("GET", "/remote/events"): get_remote_events}


# ----------------------------------------------------------------------------- claude / gemini login
AUTH = {"proc": None, "tool": "", "log": "", "url": ""}


def _run(cmd, timeout=20):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=NOWIN)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError:
        return 127, "not installed"
    except subprocess.TimeoutExpired:
        return 124, "timed out"


def claude_status():
    exe = shutil.which("claude")
    if not exe:
        return {"installed": False, "logged_in": False, "detail": "Claude Code CLI not installed (npm i -g @anthropic-ai/claude-code)"}
    code, out = _run([exe, "auth", "status", "--json"])
    try:
        d = json.loads(out[out.index("{"):out.rindex("}") + 1])
        return {"installed": True, "logged_in": bool(d.get("loggedIn")), "method": d.get("authMethod"), "provider": d.get("apiProvider"),
                "email": d.get("email") or d.get("emailAddress") or "", "subscription": d.get("subscriptionType") or "",
                "detail": "signed in" if d.get("loggedIn") else "not signed in", "raw": d}
    except (ValueError, json.JSONDecodeError):
        return {"installed": True, "logged_in": "logged in" in out.lower() and "not logged" not in out.lower(), "detail": out.strip()[:200]}


def gemini_status():
    exe = shutil.which("gemini")
    if not exe:
        return {"installed": False, "logged_in": False, "detail": "Gemini CLI not installed (npm i -g @google/gemini-cli)"}
    home = os.path.expanduser("~")
    creds = [os.path.join(home, ".gemini", "oauth_creds.json"), os.path.join(home, ".gemini", "google_accounts.json")]
    found = [c for c in creds if os.path.exists(c)]
    key = bool(os.environ.get("GEMINI_API_KEY"))
    return {"installed": True, "logged_in": bool(found) or key, "method": "api_key" if key else ("oauth" if found else ""),
            "detail": "signed in (Google account)" if found else ("API key in environment" if key else "not signed in — run `gemini` once in a terminal and pick 'Login with Google'")}


def get_auth_status(h, q, b):
    running = AUTH["proc"] is not None and AUTH["proc"].poll() is None
    return {"ok": True, "claude": claude_status(), "gemini": gemini_status(),
            "login": {"running": running, "tool": AUTH["tool"], "url": AUTH["url"], "log": AUTH["log"][-1500:]}}


URL_RE = re.compile(r"https://[^\s\"'<>]+")


def post_auth_login(h, q, b):
    """{tool: claude|claude-token|gemini}. Runs the CLI login; its output (with the URL to open) streams into /auth/status."""
    tool = b.get("tool") or "claude"
    if AUTH["proc"] is not None and AUTH["proc"].poll() is None:
        return {"ok": False, "error": f"a {AUTH['tool']} login is already running"}
    if tool.startswith("claude"):
        exe = shutil.which("claude")
        if not exe:
            raise ValueError("Claude Code CLI not installed")
        cmd = [exe, "setup-token"] if tool == "claude-token" else [exe, "auth", "login", "--claudeai"]
    elif tool == "gemini":
        exe = shutil.which("gemini")
        if not exe:
            raise ValueError("Gemini CLI not installed")
        cmd = [exe]
    else:
        raise ValueError("tool must be claude|claude-token|gemini")
    AUTH.update({"tool": tool, "log": "", "url": ""})
    os.makedirs(LOGS, exist_ok=True)
    env = dict(os.environ, BROWSER="echo", NO_COLOR="1", TERM="dumb")

    def pump():
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.PIPE, text=True, bufsize=1, creationflags=NOWIN, env=env, cwd=ROOT)
            AUTH["proc"] = p
            with open(os.path.join(LOGS, "auth.log"), "a", encoding="utf-8") as lf:
                for line in p.stdout:
                    AUTH["log"] += line; lf.write(line)
                    m = URL_RE.search(line)
                    if m and not AUTH["url"]:
                        AUTH["url"] = m.group(0)
                        set_status(f"{tool}: open the login link shown in the panel")
                        try:
                            webbrowser.open(AUTH["url"])
                        except Exception:
                            pass
            p.wait()
            AUTH["log"] += f"\n[exit {p.returncode}]\n"
            set_status(f"{tool} login finished" if p.returncode == 0 else f"{tool} login ended with code {p.returncode}")
        except Exception as e:
            AUTH["log"] += f"\nerror: {e}\n"
    threading.Thread(target=pump, daemon=True).start()
    return {"ok": True, "did": f"{tool} login started — watch the panel for the link"}


def post_auth_logout(h, q, b):
    tool = b.get("tool") or "claude"
    if tool == "claude":
        code, out = _run([shutil.which("claude") or "claude", "auth", "logout"])
        return {"ok": code == 0, "detail": out.strip()[:200]}
    if tool == "gemini":
        n = 0
        for f in ("oauth_creds.json", "google_accounts.json"):
            p = os.path.join(os.path.expanduser("~"), ".gemini", f)
            if os.path.exists(p):
                os.remove(p); n += 1
        return {"ok": True, "detail": f"removed {n} credential file(s)"}
    raise ValueError("tool must be claude|gemini")


def post_auth_input(h, q, b):
    """Send a line to the running login (the code the browser shows, when the CLI asks for it)."""
    p = AUTH["proc"]
    if p is None or p.poll() is not None:
        raise ValueError("no login running")
    p.stdin.write((b.get("text") or "") + "\n"); p.stdin.flush()
    return {"ok": True}


# ----------------------------------------------------------------------------- backup / restore / update / log bundle
BACKUP_FILES = ("config.json", "data/tasks.json", "data/memory.json", "data/home_state.json", "data/schedules.json", "data/routines.json",
                "data/events.json", "data/journal.json", "data/notes.json", "data/memory.sqlite", "data/memory.db")


def get_backup(h, q, b):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in BACKUP_FILES:
            p = os.path.join(ROOT, rel)
            if os.path.exists(p):
                z.write(p, rel)
        for extra in ("plugins", "routines"):
            d = os.path.join(ROOT, extra)
            if os.path.isdir(d):
                for fn in os.listdir(d):
                    if fn.endswith((".py", ".json")):
                        z.write(os.path.join(d, fn), f"{extra}/{fn}")
        z.writestr("VERSION", VERSION)
    h.send_bytes(buf.getvalue(), "application/zip", extra={"Content-Disposition": f"attachment; filename=samurai-backup-{time.strftime('%Y%m%d-%H%M')}.zip"})
    return None


def restore_zip(raw):
    n = 0
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for info in z.infolist():
            rel = info.filename.replace("\\", "/")
            if rel == "VERSION" or info.is_dir():
                continue
            if rel not in BACKUP_FILES and not (rel.startswith(("plugins/", "routines/")) and rel.count("/") == 1 and rel.endswith((".py", ".json"))):
                continue
            target = os.path.abspath(os.path.join(ROOT, rel))
            if not target.startswith(os.path.abspath(ROOT) + os.sep):
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(z.read(info))
            n += 1
    return n


def get_update(h, q, b):
    try:
        d = http_json(RELEASES_API, timeout=8)
        latest = str(d.get("tag_name", "")).lstrip("v")
        assets = [{"name": a.get("name"), "url": a.get("browser_download_url"), "size": a.get("size")} for a in d.get("assets", [])]
        newer = tuple(int(x) for x in latest.split(".") if x.isdigit()) > tuple(int(x) for x in VERSION.split(".") if x.isdigit())
        return {"ok": True, "current": VERSION, "latest": latest, "newer": newer, "url": d.get("html_url"), "assets": assets, "published": d.get("published_at")}
    except Exception as e:
        return {"ok": False, "current": VERSION, "error": str(e)[:120]}


def get_log_bundle(h, q, b):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        if os.path.isdir(LOGS):
            for fn in os.listdir(LOGS):
                if fn.endswith(".log"):
                    z.write(os.path.join(LOGS, fn), fn)
        z.writestr("doctor.json", json.dumps(doctor(), indent=1))
        z.writestr("system.txt", f"SAMURAI {VERSION}\n{sys.platform} python {sys.version}\n")
    h.send_bytes(buf.getvalue(), "application/zip", extra={"Content-Disposition": "attachment; filename=samurai-logs.zip"})
    return None


def get_version(h, q, b):
    return {"ok": True, "version": VERSION}


def post_open(h, q, b):
    webbrowser.open(UI_URL)
    return {"ok": True}


def get_page(h, q, b):
    try:
        with open(os.path.join(APP, "panel.html"), "rb") as f:
            h.send_bytes(f.read(), "text/html; charset=utf-8", extra={"Cache-Control": "no-store"})
    except OSError:
        h.send_json({"ok": False, "error": "panel.html missing"}, 404)
    return None


def get_asset(h, q, b):
    name = os.path.basename(h.path.split("?")[0])
    p = os.path.join(APP, "fonts", name)
    if not os.path.exists(p):
        h.send_json({"ok": False}, 404); return None
    with open(p, "rb") as f:
        h.send_bytes(f.read(), "font/woff2" if name.endswith(".woff2") else "text/css", extra={"Cache-Control": "max-age=86400"})
    return None


class Handler(JSONHandler):
    TAG = "SAMURAI-PANEL"
    ROUTES = {("GET", "/"): get_page, ("GET", "/panel"): get_page, ("GET", "/index.html"): get_page,
              ("GET", "/panel/status"): get_status, ("POST", "/panel/control"): post_control,
              ("GET", "/panel/logs"): get_logs, ("GET", "/panel/doctor"): get_doctor,
              ("POST", "/panel/autostart"): post_autostart, ("POST", "/panel/watchdog"): post_watchdog,
              ("POST", "/panel/model"): post_model, ("POST", "/panel/open"): post_open,
              ("POST", "/panel/voice"): post_voice_extras, ("POST", "/panel/lan"): post_lan,
              ("GET", "/phone"): get_phone, ("GET", "/phone/cert"): get_phone_cert,
              ("POST", "/remote/command"): post_remote_command, ("GET", "/remote/next"): get_remote_next,
              ("POST", "/remote/reply"): post_remote_reply, ("GET", "/remote/reply"): get_remote_reply, **RELAY_ROUTES,
              ("GET", "/auth/status"): get_auth_status, ("POST", "/auth/login"): post_auth_login, ("POST", "/auth/logout"): post_auth_logout,
              **tune.ROUTES,
              ("POST", "/auth/input"): post_auth_input,
              ("GET", "/backup"): get_backup, ("GET", "/update"): get_update, ("GET", "/logs/bundle"): get_log_bundle, ("GET", "/version"): get_version}

    def do_GET(self):
        if self.path.startswith("/fonts/"):
            if not self._origin_ok():
                return self.send_json({"ok": False}, 403)
            get_asset(self, {}, None)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] == "/restore":                  # raw zip body, not JSON
            if not self._origin_ok():
                return self.send_json({"ok": False, "error": "origin not allowed"}, 403)
            n = int(self.headers.get("Content-Length", 0) or 0)
            if n > 50_000_000:
                return self.send_json({"ok": False, "error": "backup too large"}, 400)
            try:
                count = restore_zip(self.rfile.read(n))
                return self.send_json({"ok": True, "restored": count, "note": "restart the services to apply"})
            except Exception as e:
                return self.send_json({"ok": False, "error": f"not a SAMURAI backup: {e}"[:200]}, 400)
        super().do_POST()


if __name__ == "__main__":
    os.makedirs(LOGS, exist_ok=True)
    if port_up(PORT):
        print(f"[SAMURAI-PANEL] already running on :{PORT}")
        if "--autostart" in sys.argv and "--no-browser" not in sys.argv:
            webbrowser.open(f"http://localhost:{PORT}/")
        sys.exit(0)
    threading.Thread(target=watchdog, daemon=True).start()
    if "--autostart" in sys.argv:
        threading.Thread(target=bring_up_all, args=("--no-browser" not in sys.argv,), daemon=True).start()
    print(f"[SAMURAI] Control panel on {scheme()}://localhost:{PORT}/  (v{VERSION})")
    maybe_wrap_tls(ThreadingHTTPServer((bind_host(), PORT), Handler)).serve_forever()
