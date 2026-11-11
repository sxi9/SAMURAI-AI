"""SAMURAI system tray icon — Open HUD, Control panel, Start all, Stop all, Quit.
Needs:  pip install pystray pillow     Run: python samurai_tray.py   (START.bat can launch it instead of the panel)
"""
import json, os, subprocess, sys, threading, urllib.request, webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import PORTS, ROOT, NOWIN, venv_pythonw, port_up

PANEL = f"http://localhost:{PORTS['panel']}"
HUD = f"http://localhost:{PORTS['ui']}/jarvis-interface.html"


def ensure_panel():
    if not port_up(PORTS["panel"]):
        subprocess.Popen([venv_pythonw(), os.path.join(ROOT, "servers", "samurai_panel.py"), "--no-browser"], cwd=ROOT, creationflags=NOWIN)


def control(action):
    ensure_panel()
    try:
        req = urllib.request.Request(PANEL + "/panel/control", data=json.dumps({"action": action}).encode(),
                                     headers={"Content-Type": "application/json", "Origin": PANEL})
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print("control failed:", e)


def make_icon():
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (64, 64), (5, 6, 13, 255))
    d = ImageDraw.Draw(img)
    d.polygon([(16, 2), (48, 2), (62, 32), (48, 62), (16, 62), (2, 32)], outline=(46, 230, 255, 255), width=3)
    d.rectangle([20, 24, 30, 40], fill=(217, 248, 255, 255)); d.rectangle([34, 24, 44, 40], fill=(217, 248, 255, 255))
    return img


def main():
    try:
        import pystray
    except ImportError:
        sys.exit("pip install pystray pillow")
    ensure_panel()
    menu = pystray.Menu(
        pystray.MenuItem("Open SAMURAI HUD", lambda: webbrowser.open(HUD), default=True),
        pystray.MenuItem("Control panel", lambda: webbrowser.open(PANEL)),
        pystray.MenuItem("Start all services", lambda: threading.Thread(target=control, args=("start_all",), daemon=True).start()),
        pystray.MenuItem("Stop all services", lambda: threading.Thread(target=control, args=("stop_all",), daemon=True).start()),
        pystray.MenuItem("Quit tray", lambda icon: icon.stop()),
    )
    pystray.Icon("SAMURAI", make_icon(), "SAMURAI", menu).run()


if __name__ == "__main__":
    main()
