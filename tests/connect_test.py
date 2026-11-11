"""Connect routes test: starts the add-ons sidecar in-process on a free port and checks every route that works
without credentials or hardware.  Run:  python tests/connect_test.py   (or .venv/bin/python)"""
import json, os, socket, sys, tempfile, threading, time, urllib.request
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "servers"))
import samurai_addons as addons          # noqa: E402
import samurai_connect as connect        # noqa: E402

ORIGIN = {"Origin": "http://localhost:8080", "Content-Type": "application/json"}


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def call(base, method, path, body=None):
    req = urllib.request.Request(base + path, method=method, headers=ORIGIN, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    tmp = tempfile.mkdtemp(prefix="samurai-connect-")
    open(os.path.join(tmp, "notes.txt"), "w").write("Buy milk\nShip the HUD\n")
    open(os.path.join(tmp, "report.md"), "w").write("# Quarterly report\nAll systems nominal.\n")
    connect.search_dirs = lambda: [tmp]               # index only the temp folder for a fast, deterministic run
    port = free_port(); base = f"http://127.0.0.1:{port}"
    srv = ThreadingHTTPServer(("127.0.0.1", port), addons.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    connect.start_threads()
    time.sleep(0.3)
    checks = [
        ("GET", "/connect/status", None, lambda c, d: c == 200 and d["ok"] and isinstance(d["radio"], dict) and d["files_indexed"] >= 0),
        ("GET", "/radio", None, lambda c, d: c == 200 and d["wifi"] in ("on", "off", "unknown")),
        ("POST", "/radio", {"kind": "toaster", "on": True}, lambda c, d: c == 400),
        ("GET", "/files?q=notes", None, lambda c, d: c == 200 and any(r["name"] == "notes.txt" for r in d["results"])),
        ("GET", "/files?q=rprt", None, lambda c, d: c == 200 and any(r["name"] == "report.md" for r in d["results"])),
        ("GET", "/files/recent?days=1", None, lambda c, d: c == 200 and len(d["results"]) >= 2),
        ("GET", "/files", None, lambda c, d: c == 400),
        ("POST", "/journal", {"text": "connect test entry"}, lambda c, d: c == 200 and d["entry"]["text"] == "connect test entry"),
        ("GET", "/journal?q=connect%20test", None, lambda c, d: c == 200 and d["entries"] and "connect test" in d["entries"][0]["text"]),
        ("GET", "/journal/today", None, lambda c, d: c == 200 and "connect test entry" in d["text"]),
        ("GET", "/radio_stations", None, lambda c, d: c == 200 and len(d["stations"]) >= 6 and d["stations"][0]["url"].startswith("http")),
        ("GET", "/podcasts", None, lambda c, d: c == 200 and d["episodes"] == [] and d["feeds"] == 0),
        ("GET", "/read?path=" + os.path.join(tmp, "report.md"), None, lambda c, d: c == 200 and "nominal" in d["text"]),
        ("GET", "/read?path=/nope/x.txt", None, lambda c, d: c == 400),
        ("POST", "/wol", {"mac": "AA:BB:CC:DD:EE:FF", "host": "127.0.0.1"}, lambda c, d: c == 200 and d["mac"] == "AA:BB:CC:DD:EE:FF"),
        ("POST", "/wol", {"mac": "zz"}, lambda c, d: c == 400),
        ("POST", "/wol", {"name": "ghost"}, lambda c, d: c == 400),
        ("POST", "/ssh", {"name": "ghost", "command": "uptime"}, lambda c, d: c == 400),
        ("POST", "/push", {"body": "hi"}, lambda c, d: c == 400 and "push" in d["error"]),
        ("POST", "/telegram", {"text": "hi"}, lambda c, d: c == 400),
        ("POST", "/webhook", {"text": "hi"}, lambda c, d: c == 400),
        ("GET", "/games", None, lambda c, d: c == 200 and isinstance(d["games"], list)),
        ("POST", "/games", {"name": "no such game"}, lambda c, d: c == 400),
        ("GET", "/cleanup", None, lambda c, d: c == 200 and d["total"] >= 0 and d["items"] and d["items"][0]["kind"] == "temp"),
        ("POST", "/cleanup", {}, lambda c, d: c == 400),
        ("POST", "/focus", {"minutes": 1, "break": 1}, lambda c, d: c == 200 and d["focus"]["active"] and d["focus"]["phase"] == "focus"),
        ("GET", "/focus", None, lambda c, d: c == 200 and 0 < d["focus"]["left"] <= 60),
        ("POST", "/focus", {"stop": True}, lambda c, d: c == 200 and not d["focus"]["active"]),
    ]
    fails = 0
    for method, path, body, ok in checks:
        code, data = call(base, method, path, body)
        good = False
        try:
            good = ok(code, data)
        except Exception:
            pass
        print(("PASS " if good else "FAIL ") + f"{method} {path} -> {code} {json.dumps(data)[:90]}")
        fails += not good
    # the focus loop speaks through the event queue: a 1-second session ends with a "say" event
    connect._focus.update(active=True, phase="focus", ends=time.time() + 1, minutes=1, **{"break": 0})
    time.sleep(2.5)
    code, ev = call(base, "GET", "/events?since=" + str(time.time() - 10))
    spoke = any(e.get("source") == "focus_end" for e in ev.get("events", []))
    print(("PASS " if spoke else "FAIL ") + "focus_end event pushed for the HUD")
    fails += not spoke
    srv.shutdown()
    print("\nALL PASS" if not fails else f"\n{fails} FAILED")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
