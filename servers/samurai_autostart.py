"""Start SAMURAI with the computer — Windows (Startup folder), Linux (systemd --user, XDG fallback), macOS (launchd).

    python samurai_autostart.py on | off | status
"""
import os, plistlib, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import ROOT, IS_WIN, IS_MAC, NOWIN, venv_pythonw, load_config, save_config

PANEL = os.path.join(ROOT, "servers", "samurai_panel.py")
if getattr(sys, "frozen", False):
    PANEL = ""                            # packaged build: the executable itself is the launcher
NAME = "SAMURAI"


def _win_paths():
    startup = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
    return startup, os.path.join(startup, NAME + ".lnk")


def _linux_paths():
    base = os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "systemd", "user", "samurai.service"), os.path.join(base, "autostart", "samurai.desktop")


def _mac_path():
    return os.path.join(os.path.expanduser("~"), "Library", "LaunchAgents", "com.samurai.panel.plist")


def status():
    if IS_WIN:
        return os.path.exists(_win_paths()[1])
    if IS_MAC:
        return os.path.exists(_mac_path())
    unit, desk = _linux_paths()
    return os.path.exists(unit) or os.path.exists(desk)


def enable():
    py = sys.executable if getattr(sys, "frozen", False) else venv_pythonw()
    if IS_WIN:
        startup, lnk = _win_paths()
        os.makedirs(startup, exist_ok=True)
        ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk}');$s.TargetPath='{py}';"
              f"$s.Arguments='{('\"' + PANEL + '\" ') if PANEL else ''}--autostart';$s.WorkingDirectory='{ROOT}';$s.WindowStyle=7;$s.Save()")
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, creationflags=NOWIN)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or "shortcut failed").strip()[:200])
    elif IS_MAC:
        p = _mac_path()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            plistlib.dump({"Label": "com.samurai.panel", "ProgramArguments": [x for x in (py, PANEL, "--autostart") if x],
                           "WorkingDirectory": ROOT, "RunAtLoad": True, "KeepAlive": False,
                           "StandardOutPath": os.path.join(ROOT, "logs", "panel.log"),
                           "StandardErrorPath": os.path.join(ROOT, "logs", "panel.log")}, f)
        subprocess.run(["launchctl", "load", "-w", p], capture_output=True)
    else:
        unit, desk = _linux_paths()
        if subprocess.run(["systemctl", "--user", "--version"], capture_output=True).returncode == 0:
            os.makedirs(os.path.dirname(unit), exist_ok=True)
            with open(unit, "w") as f:
                f.write(f"""[Unit]
Description=SAMURAI assistant (control panel + services)
After=network-online.target graphical-session.target

[Service]
Type=simple
WorkingDirectory={ROOT}
ExecStart={py} {PANEL + " " if PANEL else ""}--autostart --no-browser
Restart=on-failure
RestartSec=5
Environment=DISPLAY=:0

[Install]
WantedBy=default.target
""")
            subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True)
            r = subprocess.run(["systemctl", "--user", "enable", "samurai.service"], capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError((r.stderr or "systemctl enable failed").strip()[:200])
        else:
            os.makedirs(os.path.dirname(desk), exist_ok=True)
            with open(desk, "w") as f:
                f.write(f"[Desktop Entry]\nType=Application\nName={NAME}\nExec={py} {PANEL + " " if PANEL else ""}--autostart\nPath={ROOT}\nX-GNOME-Autostart-enabled=true\n")
    cfg = load_config(); cfg["autostart"] = True; save_config(cfg)
    return True


def disable():
    if IS_WIN:
        lnk = _win_paths()[1]
        if os.path.exists(lnk):
            os.remove(lnk)
    elif IS_MAC:
        p = _mac_path()
        if os.path.exists(p):
            subprocess.run(["launchctl", "unload", "-w", p], capture_output=True)
            os.remove(p)
    else:
        unit, desk = _linux_paths()
        if os.path.exists(unit):
            subprocess.run(["systemctl", "--user", "disable", "samurai.service"], capture_output=True)
            os.remove(unit)
            subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True)
        if os.path.exists(desk):
            os.remove(desk)
    cfg = load_config(); cfg["autostart"] = False; save_config(cfg)
    return True


if __name__ == "__main__":
    cmd = (sys.argv[1:] or ["status"])[0]
    if cmd == "on":
        enable(); print("autostart enabled")
    elif cmd == "off":
        disable(); print("autostart disabled")
    else:
        print("autostart:", "on" if status() else "off")
