"""SAMURAI Control Panel + Supervisor — port 9000, every OS.

Serves the browser control panel (app/panel.html) and manages the services:
start / stop / restart, health, logs, a watchdog that restarts crashed services
and repairs common failures, a "doctor" that checks the whole install, and the
start-with-boot switch.

    python samurai_panel.py [--autostart] [--no-browser]

--autostart  start every service, then open the HUD (unless --no-browser)
"""
import json, os, re, shutil, socket, subprocess, sys, threading, time, urllib.error, urllib.request, webbrowser
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import (JSONHandler, PORTS, ROOT, APP, LOGS, MODELS, NOWIN, IS_WIN, IS_MAC, service_defs, venv_python,
                            load_config, port_up, any_valid_model, ensure_model, CONFIG_PATH, CONFIG_EXAMPLE)
import samurai_autostart as autostart

PORT = PORTS["panel"]
UI_URL = f"http://localhost:{PORTS['ui']}/jarvis-interface.html"
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
        speech = BY_KEY["speech"]
        set_status("checking voice stack…")
        ok, msg = ensure_model(set_status)
        set_status(msg)
        for svc in SERVICES:
            start(svc)
        deadline = time.time() + 150
        while time.time() < deadline:
            broken = [s for s in SERVICES if health(s)[0] != "ok"]
            if not broken:
                break
            dead = [s for s in broken if not (procs.get(s["key"]) and procs[s["key"]].poll() is None)]
            for svc in dead:
                set_status(f"fixing {svc['name']}…")
                set_status(svc["name"] + ": " + auto_fix(svc))
            if dead:
                break
            time.sleep(2)
        up = sum(1 for s in SERVICES if health(s)[0] == "ok")
        set_status(f"{up}/{len(SERVICES)} services online")
        if open_ui and health(BY_KEY["ui"])[0] == "ok":
            webbrowser.open(UI_URL)
    finally:
        STATE["status"] = "idle"


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
    py = venv_python()
    add("Virtual environment", ".venv" in py, py if ".venv" in py else "running on the system Python — run install.py to create .venv", fixable=False)
    for mod, pkg in list(PIP_NAME.items())[:4]:
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


def post_model(h, q, b):
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
    if what not in ("kokoro", "wake"):
        raise ValueError("what must be kokoro|wake")

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
              ("POST", "/panel/voice"): post_voice_extras}

    def do_GET(self):
        if self.path.startswith("/fonts/"):
            if not self._origin_ok():
                return self.send_json({"ok": False}, 403)
            get_asset(self, {}, None)
            return
        super().do_GET()


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
    print(f"[SAMURAI] Control panel on http://localhost:{PORT}/")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
