"""SAMURAI "find my phone" — mounted into the add-ons sidecar (:9500).

POST /findmy {action: ring|locate|status}
    ring    -> rings every companion page (phone HUD) through the panel relay, pushes a priority-5 ntfy alarm when
               connect.ntfy_topic is set, and asks Google Find My Device (browser agent, signed-in profile) to play a sound
    locate  -> Google Find My Device: devices, last seen, address; the map is on the browser agent's page (GET :9600/browser/view)
    status  -> what is available
    -> {ok, action, sent: ["companion", "ntfy", "google"], note, google: {...} | null, companion_pages, ntfy}
GET  /findmy/status -> {ok, ntfy, companion_pages, google: last result | null, google_enabled}

Config: findmy.google (default true), connect.ntfy_topic (optional).  Panel/browser ports come from PORTS, or
SAMURAI_PANEL_PORT / SAMURAI_BROWSER_PORT for tests."""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import PORTS, load_config

try:
    import samurai_connect as connect
except Exception:                                      # pragma: no cover
    connect = None

STATE = {"google": None, "google_t": 0}
UA = {"User-Agent": "SAMURAI/1.0", "Origin": "http://localhost:8080"}


def _port(name, env):
    return int(os.environ.get(env) or PORTS.get(name, 0))


def _headers():
    h = {"Content-Type": "application/json", **UA}
    lan = load_config().get("lan", {})
    if lan.get("enabled") and lan.get("token"):
        h["X-Samurai-Token"] = lan["token"]
    return h


def _call(port, path, body=None, timeout=12):
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=_headers(), method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def companion_pages():
    try:
        return int(_call(_port("panel", "SAMURAI_PANEL_PORT"), "/remote/events?since=0&peek=1", timeout=4).get("pages", 0))
    except Exception:
        return 0


def ring_companions(text):
    try:
        r = _call(_port("panel", "SAMURAI_PANEL_PORT"), "/remote/broadcast", {"kind": "ring", "text": text})
        return int(r.get("pages", 0))
    except Exception:
        return -1


def push_alarm(text):
    c = load_config().get("connect", {})
    if not c.get("ntfy_topic") or connect is None:
        return False
    server = (c.get("ntfy_server") or "https://ntfy.sh").rstrip("/")
    connect._post(f"{server}/{urllib.parse.quote(c['ntfy_topic'])}", text.encode("utf-8"),
                  {"Title": "SAMURAI: find my phone", "Priority": "5", "Tags": "rotating_light,iphone", "Content-Type": "text/plain; charset=utf-8"})
    return True


def google(action):
    if not load_config().get("findmy", {}).get("google", True):
        return None
    try:
        res = _call(_port("browser", "SAMURAI_BROWSER_PORT"), "/browser", {"cmd": "findmy", "arg": action}, timeout=75)
    except urllib.error.HTTPError as e:
        try:
            res = {"ok": False, "error": json.loads(e.read() or b"{}").get("error", f"browser agent answered {e.code}")}
        except Exception:
            res = {"ok": False, "error": f"browser agent answered {e.code}"}
    except OSError as e:
        res = {"ok": False, "error": f"browser agent not running ({str(e)[:50]})"}
    STATE["google"], STATE["google_t"] = res, time.time()
    return res


def post_findmy(h, q, b):
    action = (b.get("action") or "ring").lower()
    if action not in ("ring", "locate", "status"):
        raise ValueError("action must be ring|locate|status")
    if action == "status":
        return get_status(h, q, b)
    sent, notes = [], []
    pages = 0
    if action == "ring":
        pages = ring_companions("SAMURAI is looking for you")
        if pages > 0:
            sent.append("companion")
        elif pages == 0:
            notes.append("no phone has the companion page open")
        else:
            notes.append("control panel not reachable for the companion ring")
        try:
            if push_alarm("Ring! SAMURAI is looking for this phone."):
                sent.append("ntfy")
            else:
                notes.append("ntfy not configured (connect.ntfy_topic)")
        except Exception as e:
            notes.append(f"ntfy failed: {str(e)[:60]}")
    g = google(action)
    if g is None:
        notes.append("Google Find My Device disabled (findmy.google)")
    elif g.get("needs_login"):
        notes.append("Google Find My Device needs a sign-in: show the browser window and sign in once")
    elif g.get("error"):
        notes.append(f"Google Find My Device: {g['error'][:80]}")
    elif action == "ring" and g.get("rang"):
        sent.append("google")
    elif action == "locate" and (g.get("devices") or g.get("last_seen")):
        sent.append("google")
    return {"ok": True, "action": action, "sent": sent, "note": "; ".join(notes), "google": g, "companion_pages": max(pages, 0),
            "ntfy": bool(load_config().get("connect", {}).get("ntfy_topic"))}


def get_status(h, q, b):
    return {"ok": True, "ntfy": bool(load_config().get("connect", {}).get("ntfy_topic")), "companion_pages": companion_pages(),
            "google_enabled": bool(load_config().get("findmy", {}).get("google", True)), "google": STATE["google"], "google_t": STATE["google_t"]}


ROUTES = {("POST", "/findmy"): post_findmy, ("GET", "/findmy/status"): get_status}
