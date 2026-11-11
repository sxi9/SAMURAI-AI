"""SAMURAI Dashboard — start/stop all SAMURAI services and open the interface.
Run: pythonw samurai_dashboard.py  (created as SAMURAI.lnk on the desktop by setup)"""
import os, socket, subprocess, sys, threading, time
import urllib.error, urllib.request, webbrowser
import tkinter as tk

ROOT = os.path.dirname(os.path.abspath(__file__))
SRV = os.path.join(ROOT, "servers")
APP = os.path.join(ROOT, "app")
LOGS = os.path.join(ROOT, "logs")
MODELS = os.path.join(ROOT, "models")
UI_URL = "http://localhost:8080/jarvis-interface.html"
NOWIN = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW


sys.path.insert(0, os.path.join(ROOT, "servers"))
from samurai_common import (run_hidden, model_valid, any_valid_model, ensure_model,       # noqa: E402
                            download_with_resume, SMALL_MODEL_NAME, MODEL_MIRRORS, PORTS)
PIP_NAME = {"vosk": "vosk", "websockets": "websockets", "psutil": "psutil", "edge_tts": "edge-tts"}

SERVICES = [
    {"key": "ui",     "name": "UI SERVER",      "port": 8080,
     "check": "http://localhost:8080/jarvis-interface.html",
     "cmd": [sys.executable, "-m", "http.server", "8080", "--bind", "127.0.0.1", "--directory", APP]},
    {"key": "speech", "name": "SPEECH (VOSK)",  "port": 9100,
     "check": None,  # websocket server: TCP connect is the health probe
     "cmd": [sys.executable, os.path.join(SRV, "samurai_speech_server.py")]},
    {"key": "tel",    "name": "TELEMETRY",      "port": 8765,
     "check": "http://localhost:8765/stats",
     "cmd": [sys.executable, os.path.join(SRV, "samurai_telemetry.py")]},
    {"key": "tts",    "name": "NEURAL TTS",     "port": 9200,
     "check": "http://localhost:9200/tts",  # 400 (no text) still proves it's alive
     "cmd": [sys.executable, os.path.join(SRV, "samurai_tts_server.py")]},
    {"key": "act",    "name": "ACTIONS",        "port": 9300,
     "check": "http://localhost:9300/action",  # 404 on GET still proves it's alive
     "cmd": [sys.executable, os.path.join(SRV, "samurai_action_server.py")]},
    {"key": "agent",  "name": "AGENT (CLI)",    "port": 9400,
     "check": "http://localhost:9400/agent/status",
     "cmd": [sys.executable, os.path.join(SRV, "samurai_agent_server.py")]},
    {"key": "addons", "name": "ADD-ONS",        "port": 9500,
     "check": "http://localhost:9500/addons/status",
     "cmd": [sys.executable, os.path.join(SRV, "samurai_addons.py")]},
]

BG, PANEL, FG, ACCENT, RED, DIM = "#060a12", "#0b1322", "#9adfff", "#27e0a6", "#ff5f6d", "#3a5a78"
AMBER = "#ffc857"
DOT_COLOR = {"ok": ACCENT, "warn": AMBER, "down": RED}


def port_up(port):
    s = socket.socket()
    s.settimeout(0.4)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def health(svc):
    """Return (state, detail): 'ok' responding, 'warn' port open but not responding, 'down'."""
    if not port_up(svc["port"]):
        return "down", "OFFLINE"
    if not svc["check"]:
        return "ok", "PORT OK"
    t0 = time.time()
    try:
        urllib.request.urlopen(svc["check"], timeout=2).read(64)
        return "ok", f"{int((time.time() - t0) * 1000)} ms"
    except urllib.error.HTTPError:
        # server answered with an HTTP error status — it is alive
        return "ok", f"{int((time.time() - t0) * 1000)} ms"
    except Exception:
        return "warn", "NO RESPONSE"


def kill_port(port):
    try:
        import psutil
        for c in psutil.net_connections(kind="tcp"):
            if c.laddr and c.laddr.port == port and c.status == "LISTEN" and c.pid:
                psutil.Process(c.pid).terminate()
    except Exception:
        pass


class Dash(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SAMURAI DASHBOARD")
        self.geometry("520x500")
        self.configure(bg=BG)
        self.resizable(False, False)
        self.procs = {}
        self.rows = {}

        tk.Label(self, text="S A M U R A I", font=("Consolas", 22, "bold"),
                 fg=ACCENT, bg=BG).pack(pady=(22, 0))
        tk.Label(self, text="SERVICE CONTROL DASHBOARD", font=("Consolas", 9),
                 fg=DIM, bg=BG).pack(pady=(0, 14))

        box = tk.Frame(self, bg=PANEL, padx=16, pady=12)
        box.pack(padx=26, fill="x")
        for svc in SERVICES:
            row = tk.Frame(box, bg=PANEL)
            row.pack(fill="x", pady=4)
            dot = tk.Label(row, text="●", font=("Consolas", 12), fg=RED, bg=PANEL)
            dot.pack(side="left")
            tk.Label(row, text=f" {svc['name']:<15} :{svc['port']}", font=("Consolas", 11),
                     fg=FG, bg=PANEL, anchor="w").pack(side="left")
            btn = tk.Button(row, text="START", font=("Consolas", 9, "bold"), width=7,
                            fg=BG, bg=ACCENT, relief="flat", cursor="hand2",
                            command=lambda s=svc: self.toggle(s))
            btn.pack(side="right")
            info = tk.Label(row, text="…", font=("Consolas", 9), fg=DIM, bg=PANEL, width=12, anchor="e")
            info.pack(side="right", padx=(0, 8))
            self.rows[svc["key"]] = (dot, btn, info)

        ctl = tk.Frame(self, bg=BG)
        ctl.pack(pady=16)
        for text, cmd in (("START ALL", self.start_all), ("STOP ALL", self.stop_all),
                          ("OPEN SAMURAI", lambda: webbrowser.open(UI_URL))):
            tk.Button(ctl, text=text, font=("Consolas", 10, "bold"), fg=BG,
                      bg=ACCENT if text != "STOP ALL" else RED, relief="flat",
                      padx=14, pady=6, cursor="hand2", command=cmd).pack(side="left", padx=6)

        self.status = tk.Label(self, text="", font=("Consolas", 9), fg=DIM, bg=BG)
        self.status.pack()
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.refresh()

    # ---------- service control ----------
    def start(self, svc):
        if port_up(svc["port"]):
            return
        os.makedirs(LOGS, exist_ok=True)
        log = open(os.path.join(LOGS, svc["key"] + ".log"), "w")
        self.procs[svc["key"]] = subprocess.Popen(
            svc["cmd"], creationflags=NOWIN, cwd=ROOT, stdout=log, stderr=log)

    def stop(self, svc):
        p = self.procs.pop(svc["key"], None)
        if p and p.poll() is None:
            p.terminate()
        else:
            kill_port(svc["port"])

    def toggle(self, svc):
        if port_up(svc["port"]):
            self.stop(svc)
            self.after(700, self.refresh_now)
        else:
            self.start(svc)
            self.after(2500, lambda: self.verify_or_fix([svc]))
        self.after(700, self.refresh_now)

    def start_all(self):
        # do the whole bring-up on a worker thread so the window stays responsive
        threading.Thread(target=self._bring_up_all, daemon=True).start()

    def _svc(self, key):
        return next(s for s in SERVICES if s["key"] == key)

    def _ensure_dep(self, mod, pkg):
        r = run_hidden([sys.executable, "-c", f"import {mod}"],
                       capture_output=True, text=True)
        if r.returncode == 0:
            return True
        self.set_status(f"installing {pkg}…")
        run_hidden([sys.executable, "-m", "pip", "install", pkg],
                   capture_output=True, text=True)
        return run_hidden([sys.executable, "-c", f"import {mod}"],
                          capture_output=True, text=True).returncode == 0

    def _bring_up_all(self):
        self.fixing = True
        try:
            # ---- 1. make the SPEECH stack usable BEFORE anything else ----
            speech = self._svc("speech")
            self.set_info(speech, "PREP…", AMBER)

            if not self._ensure_dep("vosk", "vosk"):
                self.set_info(speech, "VOSK FAIL", RED)
                self.set_status("could not install 'vosk' package — check internet/pip")
            else:
                ok, msg = ensure_model(self.set_status)
                self.set_status(msg)
                if not ok:
                    self.set_info(speech, "NO MODEL", RED)

                # start speech and WAIT until it is actually listening
                if any_valid_model():
                    self.set_info(speech, "STARTING…", AMBER)
                    self.start(speech)
                    if self.wait_healthy(speech, 150):
                        self.set_info(speech, "ONLINE", ACCENT)
                    else:
                        # died? diagnose from its log (dll runtime, port, etc.)
                        self.set_status("speech server failed to start — diagnosing…")
                        self.set_status("speech: " + self.auto_fix(speech))

            # ---- 2. start the remaining services ----
            for svc in SERVICES:
                if svc["key"] == "speech":
                    continue
                self.start(svc)
            self.after(0, self.refresh_now)

            # ---- 3. verify the rest, auto-fix, THEN open the UI ----
            others = [s for s in SERVICES if s["key"] != "speech"]
            deadline = time.time() + 40
            while time.time() < deadline:
                broken = [s for s in others if health(s)[0] != "ok"]
                if not broken:
                    break
                dead = [s for s in broken
                        if not (self.procs.get(s["key"]) and self.procs[s["key"]].poll() is None)]
                if dead:
                    for svc in dead:
                        self.set_status("fixing " + svc["name"] + "…")
                        self.set_status(svc["name"] + ": " + self.auto_fix(svc))
                    break
                time.sleep(2)

            ui_ok = health(self._svc("ui"))[0] == "ok"
            self.set_status("SAMURAI ready — opening interface…" if ui_ok
                            else "UI server not ready — check logs\\ui.log")
        finally:
            self.fixing = False
        if health(self._svc("ui"))[0] == "ok":
            webbrowser.open(UI_URL)
        self.after(0, self.refresh_now)

    def wait_healthy(self, svc, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if health(svc)[0] == "ok":
                return True
            # bail early if the process crashed instead of loading
            p = self.procs.get(svc["key"])
            if p and p.poll() is not None:
                return False
            time.sleep(1)
        return False

    def stop_all(self):
        for svc in SERVICES:
            self.stop(svc)
        self.after(700, self.refresh_now)

    # ---------- auto-fix ----------
    def verify_or_fix(self, svcs, open_ui=False):
        threading.Thread(target=self._verify_or_fix, args=(svcs, open_ui), daemon=True).start()

    def _verify_or_fix(self, svcs, open_ui):
        self.fixing = True
        try:
            # grace period: a service whose process is still alive is starting up
            # (the large voice model can take a minute to load) — don't touch it yet
            deadline = time.time() + 90
            while time.time() < deadline:
                broken = [s for s in svcs if health(s)[0] != "ok"]
                if not broken:
                    break
                crashed = [s for s in broken
                           if not (self.procs.get(s["key"]) and self.procs[s["key"]].poll() is None)]
                if crashed:
                    broken = crashed  # something actually died — diagnose it now
                    break
                self.set_status(f"waiting for {', '.join(s['name'] for s in broken)} to finish starting…")
                time.sleep(3)
            for svc in broken:
                self.set_status(f"{svc['name']}: failed — diagnosing…")
                self.set_info(svc, "FIXING…", AMBER)
                fixed_reason = self.auto_fix(svc)
                self.set_status(f"{svc['name']}: {fixed_reason}")
                time.sleep(2)
        finally:
            self.fixing = False
        if open_ui:
            webbrowser.open(UI_URL)
        self.after(0, self.refresh_now)

    def read_log(self, svc):
        try:
            with open(os.path.join(LOGS, svc["key"] + ".log"), encoding="utf-8", errors="ignore") as f:
                return f.read()[-4000:]
        except OSError:
            return ""

    def auto_fix(self, svc):
        """Diagnose a dead service from its log, repair, restart. Returns a status string."""
        log = self.read_log(svc)

        # 1. missing python package -> pip install it
        import re
        m = re.search(r"No module named '(\w+)'", log)
        if m:
            pkg = PIP_NAME.get(m.group(1), m.group(1))
            self.set_status(f"{svc['name']}: installing missing package {pkg}…")
            r = run_hidden([sys.executable, "-m", "pip", "install", pkg],
                           capture_output=True, text=True)
            if r.returncode != 0:
                return f"pip install {pkg} failed — see logs\\{svc['key']}.log"
            return self.restart_and_report(svc, f"installed {pkg}")

        # 2. speech server with no voice model -> download the small model (robust, resumable)
        if svc["key"] == "speech" and ("no vosk model" in log.lower()
                                       or "no voice model" in log.lower() or not any_valid_model()):
            ok, msg = ensure_model(self.set_status)
            if not ok:
                return msg
            return self.restart_and_report(svc, "voice model installed")

        # 3. vosk DLL cannot load -> needs the VC++ runtime
        if "WinError 126" in log or "libvosk" in log:
            webbrowser.open("https://aka.ms/vs/17/release/vc_redist.x64.exe")
            return "needs Microsoft VC++ runtime — installer download opened, run it and press START ALL again"

        # 4. port taken by something else
        if "10048" in log or "Address already in use" in log:
            return f"port {svc['port']} is used by another program"

        # unknown -> retry once, then point at the log
        return self.restart_and_report(svc, "restarted", fallback=f"still failing — see logs\\{svc['key']}.log")

    def restart_and_report(self, svc, action, fallback=None):
        self.stop(svc)
        time.sleep(1)
        self.start(svc)
        # speech may load a large model — give it time
        deadline = time.time() + (120 if svc["key"] == "speech" else 15)
        while time.time() < deadline:
            if health(svc)[0] == "ok":
                return f"{action} — ONLINE ✓"
            time.sleep(1)
        return fallback or f"{action}, but still offline — see logs\\{svc['key']}.log"

    # ---------- status display ----------
    def set_status(self, text):
        self.after(0, lambda: self.status.configure(text=text[:70]))

    def set_info(self, svc, text, color=DIM):
        def apply():
            self.rows[svc["key"]][2].configure(text=text, fg=color)
        self.after(0, apply)

    def refresh_now(self):
        threading.Thread(target=self._check_all, daemon=True).start()

    def _check_all(self):
        results = {s["key"]: health(s) for s in SERVICES}
        def apply():
            up = 0
            for svc in SERVICES:
                state, detail = results[svc["key"]]
                dot, btn, info = self.rows[svc["key"]]
                dot.configure(fg=DOT_COLOR[state])
                btn.configure(text="STOP" if state != "down" else "START",
                              bg=RED if state != "down" else ACCENT)
                info.configure(text=detail, fg=DOT_COLOR[state] if state != "down" else DIM)
                up += state == "ok"
            if not getattr(self, "fixing", False):
                self.status.configure(text=f"{up}/{len(SERVICES)} services healthy")
        self.after(0, apply)

    def refresh(self):
        self.refresh_now()
        self.after(3000, self.refresh)

    def on_close(self):
        self.destroy()  # services keep running in the background


if __name__ == "__main__":
    dash = Dash()
    if "--autostart" in sys.argv:
        dash.after(600, dash.start_all)
    dash.mainloop()
