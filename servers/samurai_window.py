"""SAMURAI app window — the HUD in its own chromeless window (no browser tabs, no address bar).

    python servers/samurai_window.py      from source, after the services are up
    SAMURAI.exe --window                  packaged build
    SAMURAI.exe --service window          what the control panel's "OPEN AS APP WINDOW" button runs

Uses pywebview (Edge WebView2 on Windows, WebKit on macOS, GTK/Qt WebKit on Linux). Frameless, remembers its size and
position in data/window.json, optional always-on-top (config window.on_top), optional global hotkey Ctrl+Alt+S (needs the
`keyboard` package) that brings the window to the front and fires a `samurai-hotkey` event in the page.
The HUD sees `?app=1` in its URL and shows its own slim window bar that calls window.pywebview.api.*.
Without pywebview installed it says how to install it and opens the HUD in the default browser instead."""
import json, os, sys, threading, webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import DATA, PORTS, load_config, tls_enabled

STATE_FILE = os.path.join(DATA, "window.json")
DEFAULT = {"w": 1600, "h": 900, "x": None, "y": None, "on_top": False}
MIN_W, MIN_H = 1100, 650
BG = "#05060d"
HOTKEY = "ctrl+alt+s"


def hud_url(cfg=None):
    cfg = cfg or load_config()
    lan = cfg.get("lan", {})
    url = f"{'https' if tls_enabled() else 'http'}://localhost:{PORTS['ui']}/jarvis-interface.html?app=1"
    if lan.get("enabled") and lan.get("token"):
        url += "&token=" + lan["token"]
    return url


def load_state():
    st = dict(DEFAULT)
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            st.update({k: v for k, v in json.load(f).items() if k in DEFAULT})
    except Exception:
        pass
    try:
        st["on_top"] = bool(load_config().get("window", {}).get("on_top", st["on_top"]))
    except Exception:
        pass
    st["w"] = max(MIN_W, int(st["w"] or DEFAULT["w"])); st["h"] = max(MIN_H, int(st["h"] or DEFAULT["h"]))
    return st


def save_state(st):
    try:
        os.makedirs(DATA, exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({k: st.get(k) for k in DEFAULT}, f)
    except Exception:
        pass


class Api:
    """Called from the page as window.pywebview.api.<name>(...). Every method returns JSON-friendly values."""

    def __init__(self, state):
        self.window = None
        self.state = state
        self.fullscreen_on = False

    def _remember(self):
        w = self.window
        if w is None:
            return
        try:
            self.state.update(w=int(w.width), h=int(w.height), x=int(w.x), y=int(w.y))
        except Exception:
            pass
        save_state(self.state)

    def minimize(self):
        if self.window:
            self.window.minimize()
        return True

    def close(self):
        self._remember()
        if self.window:
            self.window.destroy()
        return True

    def toggle_on_top(self):
        self.state["on_top"] = not self.state.get("on_top")
        if self.window:
            try:
                self.window.on_top = self.state["on_top"]
            except Exception:
                pass
        save_state(self.state)
        return self.state["on_top"]

    def set_size(self, w, h):
        w, h = max(MIN_W, int(w)), max(MIN_H, int(h))
        if self.window:
            self.window.resize(w, h)
        self.state.update(w=w, h=h); save_state(self.state)
        return {"w": w, "h": h}

    def move(self, dx, dy):
        """Drag region support: the page sends mouse deltas, the window follows."""
        if self.window:
            try:
                self.window.move(int(self.window.x) + int(dx), int(self.window.y) + int(dy))
            except Exception:
                pass
        return True

    def fullscreen(self):
        self.fullscreen_on = not self.fullscreen_on
        if self.window:
            self.window.toggle_fullscreen()
        return self.fullscreen_on

    def get_state(self):
        st = {"on_top": bool(self.state.get("on_top")), "fullscreen": self.fullscreen_on, "w": self.state.get("w"), "h": self.state.get("h")}
        if self.window:
            try:
                st.update(w=int(self.window.width), h=int(self.window.height))
            except Exception:
                pass
        return st


def install_hotkey(window, api):
    """Ctrl+Alt+S brings the window to the front and tells the HUD; silently skipped when `keyboard` is missing."""
    try:
        import keyboard
    except Exception:
        return False

    def fire():
        try:
            window.restore(); window.show()
            if not api.state.get("on_top"):
                window.on_top = True; window.on_top = False       # a short on-top pulse raises the window on every platform
            window.evaluate_js("window.dispatchEvent(new CustomEvent('samurai-hotkey'))")
        except Exception:
            pass
    try:
        keyboard.add_hotkey(HOTKEY, fire)
        return True
    except Exception:
        return False


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    url = hud_url()
    try:
        import webview
    except ImportError:
        print("[SAMURAI] the app window needs pywebview:  pip install pywebview   (opening the HUD in your browser instead)")
        webbrowser.open(url.replace("?app=1&", "?").replace("?app=1", ""))
        return 2
    state = load_state()
    api = Api(state)
    kw = dict(title="SAMURAI", url=url, js_api=api, width=state["w"], height=state["h"], min_size=(MIN_W, MIN_H),
              frameless=True, easy_drag=False, background_color=BG, on_top=bool(state["on_top"]), text_select=False)
    if state.get("x") is not None and state.get("y") is not None:
        kw.update(x=int(state["x"]), y=int(state["y"]))
    window = webview.create_window(**kw)
    api.window = window

    def on_closing():
        api._remember()

    def on_shown():
        install_hotkey(window, api)
    try:
        window.events.closing += on_closing
        window.events.shown += on_shown
    except Exception:
        pass
    print(f"[SAMURAI] app window → {url}")
    webview.start(private_mode=False, debug="--debug" in argv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
