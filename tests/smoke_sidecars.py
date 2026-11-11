"""Smoke test for every sidecar route. Run with the services up:  .venv/bin/python tests/smoke_sidecars.py"""
import json, sys, urllib.request

ORIGIN = {"Origin": "http://localhost:8080"}
CHECKS = [
    ("GET", "http://localhost:8765/stats", None, lambda d: "cpu" in d),
    ("GET", "http://localhost:9200/engines", None, lambda d: d.get("edge") is True),
    ("GET", "http://localhost:9200/voices", None, lambda d: len(d.get("voices", [])) > 3),
    ("GET", "http://localhost:9300/actions", None, lambda d: "open_app" in d.get("actions", [])),
    ("POST", "http://localhost:9300/action", {"type": "shutdown"}, lambda d: d.get("needs_confirm") is True),
    ("GET", "http://localhost:9400/agent/status", None, lambda d: "claude" in d),
    ("GET", "http://localhost:9500/config", None, lambda d: "user" in d),
    ("GET", "http://localhost:9500/weather", None, lambda d: "temp" in d),
    ("GET", "http://localhost:9500/tasks", None, lambda d: isinstance(d.get("tasks"), list)),
    ("GET", "http://localhost:9500/home", None, lambda d: "lights" in d.get("state", {})),
    ("GET", "http://localhost:9500/security", None, lambda d: d.get("level") in ("LOW", "MEDIUM", "HIGH")),
    ("GET", "http://localhost:9500/memory", None, lambda d: "facts" in d),
    ("GET", "http://localhost:9000/panel/status", None, lambda d: len(d.get("services", [])) == 8),
    ("GET", "http://localhost:9500/schedules", None, lambda d: isinstance(d.get("schedules"), list)),
    ("GET", "http://localhost:9500/routines", None, lambda d: "focus mode" in d.get("routines", {})),
    ("GET", "http://localhost:9500/events", None, lambda d: "events" in d),
    ("GET", "http://localhost:9300/audit", None, lambda d: "entries" in d),
    ("GET", "http://localhost:9600/browser/status", None, lambda d: "playwright" in d),
]


def call(method, url, body):
    req = urllib.request.Request(url, method=method, headers={**ORIGIN, "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    fails = 0
    for method, url, body, ok in CHECKS:
        try:
            code, d = call(method, url, body)
            good = ok(d)
        except Exception as e:
            good, code = False, str(e)[:40]
        fails += not good
        print(f"{'PASS' if good else 'FAIL'}  {method} {url} ({code})")
    # origin lock
    for port in (8765, 9200, 9300, 9400, 9500, 9000, 9600):
        req = urllib.request.Request(f"http://localhost:{port}/", headers={"Origin": "https://evil.example"})
        try:
            urllib.request.urlopen(req, timeout=5); code = 200
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception:
            code = "down"
        good = code == 403
        fails += not good
        print(f"{'PASS' if good else 'FAIL'}  foreign origin refused on :{port} ({code})")
    print(f"\n{'ALL PASS' if not fails else str(fails) + ' FAILED'}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
