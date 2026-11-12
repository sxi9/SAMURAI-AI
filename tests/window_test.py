"""App window: module logic with a fake pywebview (no display here), the state file, the api, and the launcher flags."""
import json, os, sys, types
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "servers"))
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + (f" — {detail}" if detail and not ok else "")); fails += 0 if ok else 1


# ---- fake pywebview
calls = {}


class Hook:
    def __init__(self): self.fns = []
    def __iadd__(self, fn): self.fns.append(fn); return self


class FakeEvents:
    def __init__(self): self.closing = Hook(); self.shown = Hook()


class FakeWindow:
    def __init__(self, **kw):
        self.kw = kw; self.width, self.height, self.x, self.y = kw["width"], kw["height"], kw.get("x", 10), kw.get("y", 20)
        self.on_top = kw.get("on_top"); self.events = FakeEvents(); self.log = []
    def minimize(self): self.log.append("minimize")
    def destroy(self): self.log.append("destroy")
    def resize(self, w, h): self.width, self.height = w, h; self.log.append(("resize", w, h))
    def move(self, x, y): self.x, self.y = x, y; self.log.append(("move", x, y))
    def toggle_fullscreen(self): self.log.append("fullscreen")
    def restore(self): self.log.append("restore")
    def show(self): self.log.append("show")
    def evaluate_js(self, js): self.log.append(("js", js))


fake = types.ModuleType("webview")


def create_window(**kw):
    calls["create"] = kw; w = FakeWindow(**kw); calls["window"] = w; return w


def start(**kw):
    calls["start"] = kw; w = calls["window"]
    for fn in w.events.shown.fns: fn()
    for fn in w.events.closing.fns: fn()


fake.create_window, fake.start = create_window, start
sys.modules["webview"] = fake

import samurai_window as W
W.STATE_FILE = os.path.join(ROOT, "data", "window.test.json")
if os.path.exists(W.STATE_FILE):
    os.remove(W.STATE_FILE)
rc = W.main([])
check("main returns 0 with pywebview present", rc == 0)
kw = calls["create"]
check("frameless window with the HUD url (?app=1)", kw["frameless"] is True and kw["easy_drag"] is False and "jarvis-interface.html?app=1" in kw["url"] and kw["title"] == "SAMURAI", kw)
check("default size 1600x900, min 1100x650, dark background", kw["width"] == 1600 and kw["height"] == 900 and kw["min_size"] == (1100, 650) and kw["background_color"] == "#05060d")
check("js api attached", kw["js_api"] is not None and hasattr(kw["js_api"], "toggle_on_top"))
api = kw["js_api"]
check("state file written on close", os.path.exists(W.STATE_FILE) and json.load(open(W.STATE_FILE))["w"] == 1600)
check("toggle_on_top flips and persists", api.toggle_on_top() is True and json.load(open(W.STATE_FILE))["on_top"] is True and api.toggle_on_top() is False)
r = api.set_size(800, 300); check("set_size clamps to the minimum", r == {"w": 1100, "h": 650} and calls["window"].width == 1100)
api.move(15, -5); check("move shifts the window by the delta", calls["window"].x == 25 and calls["window"].y == 15, (calls["window"].x, calls["window"].y))
check("fullscreen toggles", api.fullscreen() is True and api.get_state()["fullscreen"] is True and api.fullscreen() is False)
api.minimize(); check("minimize + close call the window", "minimize" in calls["window"].log and (api.close() is True) and "destroy" in calls["window"].log)
st = api.get_state(); check("get_state shape", set(st) == {"on_top", "fullscreen", "w", "h"})
calls.clear(); W.main([]); check("remembered size restored on next start", calls["create"]["width"] == 1100 and calls["create"]["height"] == 650 and "x" in calls["create"], calls["create"].get("width"))
# ---- missing pywebview → browser fallback
sys.modules["webview"] = None
opened = []; W.webbrowser.open = lambda u: opened.append(u)
check("no pywebview → opens the plain HUD url in the browser, returns 2", W.main([]) == 2 and bool(opened) and "app=1" not in opened[0], opened)
sys.modules.pop("webview", None)
# ---- launcher / panel wiring (static)
src = open(os.path.join(ROOT, "samurai_launcher.py"), encoding="utf-8").read()
check("launcher knows --window and --service window", '"--window" in args' in src and 'if key == "window"' in src and "run_window" in src)
check("panel open route accepts {window:true}", 'b.get("window")' in open(os.path.join(ROOT, "servers", "samurai_panel.py"), encoding="utf-8").read())
check("panel page has the app-window button", 'id="openWin"' in open(os.path.join(ROOT, "app", "panel.html"), encoding="utf-8").read())
if os.path.exists(W.STATE_FILE):
    os.remove(W.STATE_FILE)
print("\n" + ("ALL PASS" if not fails else f"{fails} FAILED")); sys.exit(1 if fails else 0)
