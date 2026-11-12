"""Senses / home2 / market routes test. Starts the add-ons sidecar and the action server in-process on free ports
(data redirected to a temp folder, no real devices or internet) and checks every route that works without hardware
or credentials, plus the gesture geometry in app/js/hud-gestures.js through node.
Run:  python tests/senses_platform_test.py   (or .venv/bin/python)"""
import base64, io, json, os, shutil, socket, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "servers"))
import samurai_common as common          # noqa: E402
import samurai_addons as addons          # noqa: E402
import samurai_senses as senses          # noqa: E402
import samurai_home2 as home2            # noqa: E402
import samurai_market as market          # noqa: E402
import samurai_action_server as act      # noqa: E402

ORIGIN = {"Origin": "http://localhost:8080", "Content-Type": "application/json"}


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def call(base, method, path, body=None, raw=False):
    req = urllib.request.Request(base + path, method=method, headers=ORIGIN, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data))
    except urllib.error.HTTPError as e:
        data = e.read()
        return e.code, (data if raw else json.loads(data or b"{}"))


class FileServer(BaseHTTPRequestHandler):
    """Tiny local HTTP server standing in for the internet: a file to download, a shop page, a lyrics api, a plugin zip."""
    FILES = {}

    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/get":
            body = json.dumps({"trackName": "Test Song", "syncedLyrics": "[00:01.00] hello\n[00:05.00] world", "plainLyrics": "hello\nworld"}).encode(); ctype = "application/json"
        elif path in self.FILES:
            body, ctype = self.FILES[path]
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


def main():
    tmp = tempfile.mkdtemp(prefix="samurai-senses-")
    # ---- redirect everything that writes to data/ or depends on other sidecars
    market.WATCH_PATH = os.path.join(tmp, "pricewatch.json"); market.ROOMS_PATH = os.path.join(tmp, "rooms.json"); market.SYNC_PATH = os.path.join(tmp, "sync.json"); market.DATA = tmp
    senses.FACES_DIR = os.path.join(tmp, "faces")
    pushed = []
    market.push_event = lambda kind, text, source="system", room="": pushed.append((kind, text, source))
    senses.push_event = lambda kind, text, source="system", room="": pushed.append((kind, text, source))
    dl_dir = os.path.join(tmp, "downloads")
    real_load = common.load_config
    market.load_config = lambda: {**real_load(), "market": {"download_dir": dl_dir}, "senses": {"quiet_apps": ["obs"], "read_notifications": True}}
    senses.load_config = market.load_config
    # fake telemetry: senses reads active_window from it
    tele = {"active_window": {"title": "Zoom Meeting", "app": "Zoom"}, "fullscreen": False}
    senses.telemetry_stats = lambda: tele

    # ---- local stand-in for the internet
    fport = free_port(); fbase = f"http://127.0.0.1:{fport}"
    FileServer.FILES["/big.bin"] = (os.urandom(300_000), "application/octet-stream")
    FileServer.FILES["/shop"] = (b"<html><title>Widget</title><body>Great widget. Price: $129.99 only today. Was $150.00</body></html>", "text/html")
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.write(os.path.join(ROOT, "plugins", "catalog", "countdown", "plugin.json"), "countdown/plugin.json")
        z.write(os.path.join(ROOT, "plugins", "catalog", "countdown", "countdown.py"), "countdown/countdown.py")
    FileServer.FILES["/countdown.zip"] = (zbuf.getvalue(), "application/zip")
    bad = io.BytesIO()
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("../../evil.py", "x=1"); z.writestr("plugin.json", json.dumps({"name": "evil", "entry": "evil.py"}))
    FileServer.FILES["/evil.zip"] = (bad.getvalue(), "application/zip")
    fsrv = ThreadingHTTPServer(("127.0.0.1", fport), FileServer); threading.Thread(target=fsrv.serve_forever, daemon=True).start()
    os.environ["SAMURAI_LRCLIB"] = fbase
    # price watch: fake the browser agent read with the shop page text
    pages = {"text": "Great widget. Price: $129.99 only today.", "title": "Widget"}
    market.browser_read = lambda url: dict(pages)

    # ---- our own action server + add-ons copies on spare ports
    aport = free_port(); abase = f"http://127.0.0.1:{aport}"
    act.load_plugins()
    asrv = ThreadingHTTPServer(("127.0.0.1", aport), act.Handler); threading.Thread(target=asrv.serve_forever, daemon=True).start()
    market.PORTS = dict(common.PORTS, actions=aport)
    port = free_port(); base = f"http://127.0.0.1:{port}"
    srv = ThreadingHTTPServer(("127.0.0.1", port), addons.Handler); threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(0.3)

    sync_dir = os.path.join(tmp, "cloud")
    plug_py, plug_pkg = os.path.join(ROOT, "plugins", "countdown.py"), os.path.join(ROOT, "plugins", "countdown_pkg")
    for p in (plug_py, plug_pkg):
        (shutil.rmtree if os.path.isdir(p) else lambda x: os.path.exists(x) and os.remove(x))(p)

    def wait_download(did):
        for _ in range(100):
            c, d = call(base, "GET", "/downloads"); item = next((x for x in d["downloads"] if x["id"] == did), None)
            if item and item["state"] in ("done", "error", "cancelled"):
                return item
            time.sleep(0.05)
        return item

    def set_window(title, app):
        tele["active_window"] = {"title": title, "app": app}

    # ---- 1 px jpeg for the face routes (opencv may be absent: the routes must still answer cleanly)
    jpeg = base64.b64encode(bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbd3ffd9")).decode()

    state = {}
    checks = [
        # D5 activity
        ("GET", "/activity", None, lambda c, d: c == 200 and d["category"] == "call" and d["quiet"] is True and d["app"] == "Zoom"),
        ("_set", "Elden Ring", "eldenring.exe", lambda: set_window("Elden Ring", "eldenring.exe")),
        ("GET", "/activity", None, lambda c, d: c == 200 and d["category"] == "game" and d["quiet"]),
        ("_set", "", "", lambda: set_window("Recording - OBS Studio", "obs64")),
        ("GET", "/activity", None, lambda c, d: c == 200 and d["category"] == "call" and d["quiet"]),            # senses.quiet_apps
        ("_set", "", "", lambda: set_window("main.py - Visual Studio Code", "Code")),
        ("GET", "/activity", None, lambda c, d: c == 200 and d["category"] == "work" and not d["quiet"] and "since" in d),
        ("_set", "", "", lambda: set_window("", "")),
        ("GET", "/activity", None, lambda c, d: c == 200 and d["category"] == "idle"),
        # D7 notifications
        ("POST", "/notifications/clear", {}, lambda c, d: c == 200 and d["ok"]),
        ("GET", "/notifications", None, lambda c, d: c == 200 and d["notifications"] == [] and d["source"] in ("winrt", "dbus", "none") and isinstance(d["reading"], bool)),
        ("POST", "/notifications/test", {"app": "Mail", "title": "Boss", "text": "Lunch?"}, lambda c, d: c == 200 and d["ok"]),
        ("POST", "/notifications/test", {"app": "Mail", "title": "Boss", "text": "Lunch?"}, lambda c, d: c == 200),               # duplicate, deduped
        ("GET", "/notifications", None, lambda c, d: c == 200 and len(d["notifications"]) == 1 and d["notifications"][0]["app"] == "Mail" and "t" in d["notifications"][0]),
        ("_check", "toast pushed as say/notification event", None, lambda: any(k == "say" and s == "notification" and "Lunch" in t for k, t, s in pushed)),
        ("POST", "/notifications/clear", {}, lambda c, d: c == 200),
        ("GET", "/notifications", None, lambda c, d: d["notifications"] == []),
        # D2 faces (opencv-contrib optional: either real answers or a clean 'not available')
        ("GET", "/faces", None, lambda c, d: c == 200 and isinstance(d["people"], list) and isinstance(d["available"], bool)),
        ("POST", "/faces/who", {"image": jpeg}, lambda c, d: c in (200, 400) and ("name" in d or "error" in d)),
        ("POST", "/faces/enroll", {"name": "", "image": jpeg}, lambda c, d: c == 400),
        ("POST", "/faces/enroll", {"name": "tester", "image": jpeg}, lambda c, d: c in (200, 400) and ("ok" in d)),
        ("POST", "/faces/forget", {"name": "tester"}, lambda c, d: c == 200 and d["ok"]),
        # E8 downloads
        ("POST", "/download", {"url": "ftp://nope"}, lambda c, d: c == 400),
        ("POST", "/download", {"url": fbase + "/big.bin"}, lambda c, d: c == 200 and d["ok"] and state.update(dl=d["id"]) is None and d["path"].startswith(dl_dir)),
        ("_check", "download completes with progress 1.0", None, lambda: (lambda it: it and it["state"] == "done" and it["progress"] == 1.0 and it["bytes"] == 300_000 and os.path.getsize(it["path"]) == 300_000)(wait_download(state["dl"]))),
        ("_check", "download finished event", None, lambda: any(s == "download" for _, _, s in pushed)),
        ("POST", "/download", {"url": fbase + "/big.bin", "name": "copy.bin"}, lambda c, d: c == 200 and d["path"].endswith("copy.bin") and state.update(dl2=d["id"]) is None),
        ("POST", "/download/cancel", {"id": "zzz"}, lambda c, d: c == 400),
        ("POST", "/download/cancel", {"id": "__dl2__"}, lambda c, d: c == 200 and d["state"] in ("cancelled", "done")),
        ("GET", "/downloads", None, lambda c, d: c == 200 and len(d["downloads"]) == 2 and d["dir"] == dl_dir),
        ("GET", "/torrents", None, lambda c, d: c == 200 and d["configured"] is False and d["torrents"] == []),
        ("POST", "/torrents", {"action": "add", "magnet": "magnet:?xt=urn:btih:abc"}, lambda c, d: c == 400 and "qbittorrent" in d["error"].lower()),
        # E13 price watch
        ("_check", "parse_price formats", None, lambda: market.parse_price("now only $1,299.00!") == (1299.0, "$") and market.parse_price("Preis 1.299,50 €") == (1299.5, "€") and market.parse_price("₹ 4,999") == (4999.0, "₹") and market.parse_price("£12.5") == (12.5, "£") and market.parse_price("no numbers here") == (None, None)),
        ("POST", "/watch", {"url": "nope"}, lambda c, d: c == 400),
        ("POST", "/watch", {"url": fbase + "/shop", "label": "widget", "defer": True}, lambda c, d: c == 200 and d["ok"] and state.update(w=d["watch"]["id"]) is None),
        ("POST", "/watch/check", {"id": "__w__"}, lambda c, d: c == 200 and d["watches"][0]["price"] == 129.99 and d["watches"][0]["currency"] == "$" and len(d["watches"][0]["history"]) == 1),
        ("_set", "", "", lambda: pages.update(text="Price: $99.00 sale")),
        ("POST", "/watch/check", {"id": "__w__"}, lambda c, d: c == 200 and d["watches"][0]["price"] == 99.0),
        ("_check", "price drop ≥5% pushed as say/pricewatch", None, lambda: any(s == "pricewatch" and "99" in t for _, t, s in pushed)),
        ("GET", "/watch", None, lambda c, d: c == 200 and len(d["watches"]) == 1 and d["watches"][0]["label"] == "widget" and len(d["watches"][0]["history"]) == 2),
        ("POST", "/watch/open", {"id": "zzz"}, lambda c, d: c == 400),
        ("POST", "/watch/delete", {"id": "__w__"}, lambda c, d: c == 200 and d["watches"] == []),
        # E14 home2 (no devices configured: honest status, no hangs)
        ("GET", "/home2/status", None, lambda c, d: c == 200 and d["ok"]),
        ("GET", "/home2/devices", None, lambda c, d: c == 200 and d["devices"] == [] and d["backends"] == {"hue": False, "govee": False, "kasa": False}),
        ("POST", "/home2", {"device": "desk lamp", "on": True}, lambda c, d: c == 400 and "device" in d["error"].lower() or "no" in d["error"].lower()),
        ("POST", "/home2/hue/pair", {}, lambda c, d: c in (200, 400, 500) and "ok" in d),
        ("_check", "parse_color", None, lambda: home2.parse_color("#ff8000") == (255, 128, 0) and home2.parse_color("red") == (255, 0, 0) and home2.parse_color("nope") is None),
        # G3 sync
        ("POST", "/sync", {"dir": ""}, lambda c, d: c == 400),
        ("POST", "/sync", {"dir": sync_dir}, lambda c, d: c == 200 and d["ok"] and d["dir"] == sync_dir and d["pushed"] >= 1 and os.path.isdir(os.path.join(sync_dir, "plugins"))),
        ("_set", "", "", lambda: (time.sleep(1.1), os.makedirs(os.path.join(sync_dir, "data"), exist_ok=True), open(os.path.join(sync_dir, "data", "synctest.json"), "w").write('{"from": "cloud"}'))),
        ("POST", "/sync", {}, lambda c, d: c == 200 and d["pulled"] >= 1 and json.load(open(os.path.join(ROOT, "data", "synctest.json")))["from"] == "cloud"),
        ("GET", "/sync", None, lambda c, d: c == 200 and d["dir"] == sync_dir and d["last"] > 0),
        # G4 rooms
        ("GET", "/rooms", None, lambda c, d: c == 200 and d["rooms"] == [] and d["active"] == ""),
        ("POST", "/rooms/register", {"room": "Office", "kind": "pc"}, lambda c, d: c == 200 and d["room"] == "office" and d["active"] == "office"),
        ("POST", "/rooms/register", {"room": "kitchen", "kind": "phone"}, lambda c, d: c == 200 and d["active"] == "office"),
        ("GET", "/rooms", None, lambda c, d: c == 200 and len(d["rooms"]) == 2 and all(r["online"] for r in d["rooms"]) and d["rooms"][1]["kind"] == "phone"),
        ("POST", "/rooms/handoff", {"to": "garage"}, lambda c, d: c == 400),
        ("POST", "/rooms/handoff", {"to": "kitchen"}, lambda c, d: c == 200 and d["active"] == "kitchen"),
        ("_check", "handoff announced", None, lambda: any(s == "rooms" for _, _, s in pushed)),
        # G7 marketplace
        ("GET", "/plugins/market", None, lambda c, d: c == 200 and len(d["plugins"]) == 2 and {p["name"] for p in d["plugins"]} == {"countdown", "clipboard_history"} and not d["plugins"][0]["installed"] and any(p["name"] == "example_tools" for p in d["installed"])),
        ("POST", "/plugins/install", {"url": fbase + "/evil.zip"}, lambda c, d: c == 400 and "unsafe" in d["error"]),
        ("POST", "/plugins/install", {"url": fbase + "/countdown.zip"}, lambda c, d: c == 200 and d["ok"] and d["name"] == "countdown" and os.path.isfile(plug_py) and os.path.isfile(os.path.join(plug_pkg, "plugin.json"))),
        ("GET", "/plugins/market", None, lambda c, d: next(p for p in d["plugins"] if p["name"] == "countdown")["installed"] and next(p for p in d["plugins"] if p["name"] == "countdown")["installed_version"] == "1.0.0"),
        ("_check", "action server reloaded and runs days_until", None, lambda: "days_until" in act.PLUGINS and call(abase, "POST", "/action", {"type": "days_until", "arg": "2099-01-01"})[1]["ok"]),
        ("POST", "/plugins/remove", {"name": "example_tools"}, lambda c, d: c == 400),
        ("POST", "/plugins/remove", {"name": "countdown"}, lambda c, d: c == 200 and d["removed"] and not os.path.exists(plug_py) and not os.path.exists(plug_pkg)),
        ("POST", "/plugins/install", {"url": "plugins/catalog/clipboard_history"}, lambda c, d: c == 200 and d["name"] == "clipboard_history" and "clip_history" in act.PLUGINS),
        ("POST", "/plugins/remove", {"name": "clipboard_history"}, lambda c, d: c == 200 and d["removed"] and "clip_history" not in act.PLUGINS),
        ("POST", "/plugins/reload", {}, lambda c, d: c == 200 and d["actions"]["ok"] and "roll_dice" in d["actions"]["tools"]),
        # C5 lyrics + art
        ("GET", "/lyrics", None, lambda c, d: c == 400),
        ("GET", "/lyrics?title=Test%20Song&artist=Nobody", None, lambda c, d: c == 200 and d["source"] == "lrclib" and d["lrc"].startswith("[00:01.00]") and d["plain"] == "hello\nworld"),
        ("GET", "/lyrics?title=Test%20Song&artist=Nobody", None, lambda c, d: c == 200 and d.get("cached") is True),
        ("GET", "/art?i=999999", None, lambda c, d: c == 404),
        # D8 mic kill switch + plugin reload on the action server
        ("_act_GET", "/mic", None, lambda c, d: c == 200 and d["ok"] and d["muted"] in (True, False, None) and isinstance(d["known"], bool)),
        ("_act_POST", "/action", {"type": "mic_mute", "arg": "on"}, lambda c, d: c in (200, 400, 500) and "ok" in d),
        ("_act_GET", "/actions", None, lambda c, d: c == 200 and "mic_mute" in d["actions"]),
        ("_act_POST", "/plugins/reload", {}, lambda c, d: c == 200 and d["ok"] and "roll_dice" in d["tools"]),
    ]
    fails = 0
    for method, path, body, ok in checks:
        if method == "_set":
            ok(); continue
        if method == "_check":
            try:
                good = bool(ok())
            except Exception as e:
                good = False; print("   ", e)
            print(("PASS" if good else "FAIL"), "check", path); fails += not good; continue
        if isinstance(body, dict):
            body = {k: (state[v[2:-2]] if isinstance(v, str) and v.startswith("__") and v.endswith("__") else v) for k, v in body.items()}
        b = abase if method.startswith("_act_") else base
        m = method.replace("_act_", "")
        code, data = call(b, m, path, body)
        try:
            good = bool(ok(code, data))
        except Exception as e:
            good = False; print("   ", e)
        print(("PASS" if good else "FAIL"), m, path, "" if good else (code, str(data)[:200])); fails += not good

    # D3 gesture geometry through node, with synthetic landmarks
    node = shutil.which("node")
    if node:
        js = r"""
const g = require(process.argv[1]);
const hand = (open) => { const lm = []; for (let i = 0; i < 21; i++) lm.push({ x: 0.5, y: 0.8 }); lm[0] = { x: 0.5, y: 0.9 }; lm[9] = { x: 0.5, y: 0.7 }; lm[5] = { x: 0.42, y: 0.72 }; lm[17] = { x: 0.6, y: 0.74 };
  const tips = { 8: 0.4, 12: 0.47, 16: 0.54, 20: 0.61 }, pips = { 6: 0.4, 10: 0.47, 14: 0.54, 18: 0.61 };
  for (const [t, x] of Object.entries(tips)) lm[t] = open[t] ? { x: +x, y: 0.35 } : { x: +x, y: 0.72 };
  for (const [p, x] of Object.entries(pips)) lm[p] = { x: +x, y: 0.6 };
  lm[2] = { x: 0.36, y: 0.78 }; lm[3] = { x: 0.34, y: 0.72 }; lm[4] = open.thumb ? { x: 0.3, y: 0.66 } : { x: 0.45, y: 0.78 };
  if (open.thumbUp) { lm[3] = { x: 0.36, y: 0.6 }; lm[4] = { x: 0.36, y: 0.45 }; }
  return lm; };
const out = {
  open_palm: g.classify(hand({ 8: 1, 12: 1, 16: 1, 20: 1, thumb: 1 })),
  fist: g.classify(hand({})),
  thumbs_up: g.classify(hand({ thumbUp: 1 })),
  index_up: g.classify(hand({ 8: 1 })),
  two: g.classify(hand({ 8: 1, 12: 1 })),
  none: g.classify(null),
  left: g.detectSwipe([{ x: 0.8, y: 0.5, t: 0 }, { x: 0.6, y: 0.5, t: 150 }, { x: 0.4, y: 0.52, t: 300 }]),
  right: g.detectSwipe([{ x: 0.2, y: 0.5, t: 0 }, { x: 0.4, y: 0.5, t: 150 }, { x: 0.6, y: 0.5, t: 300 }]),
  slow: g.detectSwipe([{ x: 0.2, y: 0.5, t: 0 }, { x: 0.4, y: 0.5, t: 500 }, { x: 0.6, y: 0.5, t: 1000 }]),
  vertical: g.detectSwipe([{ x: 0.2, y: 0.2, t: 0 }, { x: 0.3, y: 0.5, t: 150 }, { x: 0.5, y: 0.9, t: 300 }]),
};
console.log(JSON.stringify(out));
"""
        r = subprocess.run([node, "-e", js, os.path.join(ROOT, "app", "js", "hud-gestures.js")], capture_output=True, text=True, timeout=30)
        try:
            g = json.loads(r.stdout.strip())
            exp = {"open_palm": "open_palm", "fist": "fist", "thumbs_up": "thumbs_up", "index_up": "index_up", "two": None, "none": None, "left": "swipe_left", "right": "swipe_right", "slow": None, "vertical": None}
            for k, v in exp.items():
                good = g.get(k) == v; print(("PASS" if good else "FAIL"), "gesture", k, "" if good else g.get(k)); fails += not good
        except Exception as e:
            print("FAIL gesture node run:", e, r.stderr[-300:]); fails += 1
    else:
        print("SKIP gesture geometry (node not installed)")
    vendor = os.path.join(ROOT, "app", "vendor", "mediapipe")
    for f in ("vision_bundle.mjs", "wasm/vision_wasm_internal.wasm", "wasm/vision_wasm_internal.js"):
        good = os.path.exists(os.path.join(vendor, f)); print(("PASS" if good else "FAIL"), "vendored", f); fails += not good
    print(("PASS" if os.path.exists(os.path.join(vendor, "hand_landmarker.task")) else "INFO (download per README)"), "hand_landmarker.task")

    # cleanup
    try:
        os.remove(os.path.join(ROOT, "data", "synctest.json"))
    except OSError:
        pass
    for p in (plug_py, plug_pkg):
        (shutil.rmtree if os.path.isdir(p) else lambda x: os.path.exists(x) and os.remove(x))(p)
    shutil.rmtree(tmp, ignore_errors=True)
    print("ALL PASS" if not fails else f"{fails} FAILED")
    return fails


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
