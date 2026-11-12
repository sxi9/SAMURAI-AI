"""Spotify (PKCE + Web API request shaping against a fake), calendar natural-time parser + ICS writes, map routes.
Starts its own add-ons sidecar on a spare port with a temporary data dir, plus a fake Spotify / Nominatim server."""
import datetime as dt, json, os, subprocess, sys, tempfile, threading, time, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "servers"))
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + (f" — {detail}" if detail and not ok else "")); fails += 0 if ok else 1


# ----------------------------------------------------------------------------- fake Spotify + Nominatim
SEEN = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _json(self, obj, code=200):
        raw = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0) or 0); body = self.rfile.read(n).decode()
        SEEN.append(("POST", self.path, dict(self.headers), body))
        if self.path == "/api/token":
            f = urllib.parse.parse_qs(body)
            if f.get("grant_type") == ["authorization_code"]:
                self._json({"access_token": "AT1", "refresh_token": "RT1", "expires_in": 3600, "token_type": "Bearer"}); return
            if f.get("grant_type") == ["refresh_token"]:
                self._json({"access_token": "AT2", "expires_in": 3600, "token_type": "Bearer"}); return
            self._json({"error": "bad"}, 400); return
        if self.path.startswith("/v1/me/player/next") or self.path.startswith("/v1/me/player/previous"):
            self.send_response(204); self.end_headers(); return
        self._json({"error": {"message": "unknown"}}, 404)

    def do_PUT(self):
        n = int(self.headers.get("Content-Length", 0) or 0); body = self.rfile.read(n).decode()
        SEEN.append(("PUT", self.path, dict(self.headers), body))
        if self.path.startswith("/v1/me/player/play") and "nodev" in (self.headers.get("X-Test") or ""):
            self._json({"error": {"status": 404, "message": "Player command failed: No active device found"}}, 404); return
        self.send_response(204); self.end_headers()

    def do_GET(self):
        SEEN.append(("GET", self.path, dict(self.headers), ""))
        p = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(p.query)
        if p.path == "/v1/me":
            self._json({"display_name": "Boss", "id": "boss"}); return
        if p.path == "/v1/me/player/devices":
            self._json({"devices": [{"id": "dev1", "name": "Laptop", "type": "Computer", "is_active": False, "volume_percent": 40}, {"id": "dev2", "name": "Kitchen Speaker", "type": "Speaker", "is_active": True, "volume_percent": 60}]}); return
        if p.path == "/v1/me/player":
            self._json({"is_playing": True, "shuffle_state": False, "repeat_state": "off", "progress_ms": 61000, "device": {"name": "Kitchen Speaker"},
                        "item": {"name": "Night Drive", "duration_ms": 221000, "uri": "spotify:track:abc", "artists": [{"name": "Kessler Array"}], "album": {"name": "Neon", "images": [{"url": "http://art/1.jpg"}]}}}); return
        if p.path == "/v1/search":
            if "nothing" in q.get("q", [""])[0]:
                self._json({"tracks": {"items": []}, "albums": {"items": []}, "playlists": {"items": []}, "artists": {"items": []}}); return
            if "playlist" in q.get("q", [""])[0]:
                self._json({"tracks": {"items": []}, "albums": {"items": []}, "playlists": {"items": [{"name": "Deep Focus", "uri": "spotify:playlist:pl1", "owner": {"display_name": "Spotify"}}]}, "artists": {"items": []}}); return
            self._json({"tracks": {"items": [{"name": "Blue Monday", "uri": "spotify:track:bm", "artists": [{"name": "New Order"}]}]}, "albums": {"items": []}, "playlists": {"items": []}, "artists": {"items": []}}); return
        if p.path == "/search":                                                   # Nominatim
            self._json([{"lat": "12.9716", "lon": "77.5946", "display_name": "Bengaluru, Karnataka, India", "type": "city"}]); return
        self._json({"error": {"message": "unknown"}}, 404)


def serve(port):
    s = ThreadingHTTPServer(("127.0.0.1", port), Fake); threading.Thread(target=s.serve_forever, daemon=True).start(); return s


# ----------------------------------------------------------------------------- unit: PKCE + parser (import the modules directly)
TMP = tempfile.mkdtemp(prefix="samurai-test-")
os.environ["SAMURAI_DATA"] = TMP
import samurai_spotify as sp
import samurai_calendar as cal

v, c = sp.pkce_pair()
check("pkce verifier/challenge shape", 43 <= len(v) <= 128 and len(c) == 43 and "=" not in c and "+" not in c)

NOW = dt.datetime(2026, 11, 12, 10, 30)
cases = [("tomorrow 3pm", dt.datetime(2026, 11, 13, 15, 0)), ("next monday at 10", dt.datetime(2026, 11, 16, 10, 0)), ("in 2 hours", dt.datetime(2026, 11, 12, 12, 30)),
         ("friday 15:30", dt.datetime(2026, 11, 13, 15, 30)), ("on 12 dec 9am", dt.datetime(2026, 12, 12, 9, 0)), ("today", dt.datetime(2026, 11, 12, 9, 0)),
         ("at 3", dt.datetime(2026, 11, 12, 15, 0)), ("at 8am", dt.datetime(2026, 11, 13, 8, 0)), ("2026-12-01T14:00", dt.datetime(2026, 12, 1, 14, 0)),
         ("tonight", dt.datetime(2026, 11, 12, 19, 0)), ("in thirty minutes", dt.datetime(2026, 11, 12, 11, 0)), ("sunday noon", dt.datetime(2026, 11, 15, 12, 0)),
         ("march 3 at 11:15", dt.datetime(2027, 3, 3, 11, 15)), ("gibberish", None)]
for text, want in cases:
    got = cal.parse_when(text, now=NOW)
    check(f"parse '{text}'", got == want, f"got {got}")

# ----------------------------------------------------------------------------- live sidecar on a spare port
FAKE_PORT, ADDONS_PORT = 9719, 9519
fake = serve(FAKE_PORT)
ics = os.path.join(TMP, "agenda.ics")
cfg = {"user": {"name": "Test"}, "location": {"lat": 1.5, "lon": 2.5, "label": "TST"}, "widgets": {"agenda": {"ics_path": ics, "sample": True}}, "spotify": {"client_id": "cid123"}, "calendar": {"target": "ics"}}
CFG = os.path.join(ROOT, "config.json")                                  # the sidecar reads ROOT/config.json: park any existing one for the run
BACKUP = CFG + ".spotify-test-backup"
if os.path.exists(CFG):
    os.replace(CFG, BACKUP)
json.dump(cfg, open(CFG, "w"))
env = dict(os.environ, SAMURAI_SPOTIFY_FAKE=f"http://127.0.0.1:{FAKE_PORT}", SAMURAI_NOMINATIM=f"http://127.0.0.1:{FAKE_PORT}", SAMURAI_DATA=TMP)
py = os.path.join(ROOT, ".venv", "bin", "python") if os.path.exists(os.path.join(ROOT, ".venv", "bin", "python")) else sys.executable
proc = subprocess.Popen([py, os.path.join(ROOT, "servers", "samurai_addons.py"), "--port", str(ADDONS_PORT)], env=env, stdout=open(os.path.join(TMP, "addons.log"), "w"), stderr=subprocess.STDOUT)
A = f"http://127.0.0.1:{ADDONS_PORT}"
H = {"Origin": "http://localhost:8080", "Content-Type": "application/json"}


def J(path, body=None, method=None):
    req = urllib.request.Request(A + path, data=json.dumps(body).encode() if body is not None else None, headers=H, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}


for _ in range(60):
    try:
        urllib.request.urlopen(A + "/config", timeout=1); break
    except Exception:
        time.sleep(0.5)
try:
    # ---- spotify not linked
    s, d = J("/spotify/status"); check("status: not linked", s == 200 and d["linked"] is False and d["client_id"] is True, d)
    s, d = J("/spotify", {"cmd": "play"}); check("play when not linked → 400 with hint", s == 400 and "not linked" in d.get("error", ""), d)
    s, d = J("/spotify/auth"); check("auth url", s == 200 and d["ok"] and "code_challenge=" in d["url"] and "client_id=cid123" in d["url"] and "user-modify-playback-state" in urllib.parse.unquote(d["url"]), d)
    state = d["state"]
    # ---- callback exchange against the fake
    req = urllib.request.Request(f"{A}/spotify/callback?code=CODE1&state={state}", headers={"Origin": "http://localhost:8080"})
    html = urllib.request.urlopen(req, timeout=20).read().decode()
    check("callback exchanges the code and shows the linked page", "Linked to Spotify" in html, html[:120])
    tok = [x for x in SEEN if x[1] == "/api/token"]
    check("token request shape (PKCE, no secret)", tok and "code_verifier=" in tok[-1][3] and "client_secret" not in tok[-1][3] and "grant_type=authorization_code" in tok[-1][3])
    stale = urllib.request.urlopen(urllib.request.Request(f"{A}/spotify/callback?code=X&state=nope", headers={"Origin": "http://localhost:8080"}), timeout=10).read().decode()
    check("stale state is rejected", "stale" in stale)
    # ---- status when linked
    s, d = J("/spotify/status"); check("status linked: track, device, devices", s == 200 and d["linked"] and d["track"]["title"] == "Night Drive" and d["device"] == "Kitchen Speaker" and len(d["devices"]) == 2 and d["track"]["progress"] == 61 and d["user"] == "Boss", d)
    # ---- every command's request
    SEEN.clear(); s, d = J("/spotify", {"cmd": "pause"}); check("pause → PUT /v1/me/player/pause", s == 200 and any(x[0] == "PUT" and x[1].startswith("/v1/me/player/pause") for x in SEEN), (s, d))
    SEEN.clear(); s, d = J("/spotify", {"cmd": "next"}); check("next → POST /v1/me/player/next", s == 200 and any(x[0] == "POST" and x[1].startswith("/v1/me/player/next") for x in SEEN))
    SEEN.clear(); s, d = J("/spotify", {"cmd": "prev"}); check("prev → POST /v1/me/player/previous", s == 200 and any(x[1].startswith("/v1/me/player/previous") for x in SEEN))
    SEEN.clear(); s, d = J("/spotify", {"cmd": "volume", "arg": "35"}); check("volume → volume_percent=35", s == 200 and any("volume_percent=35" in x[1] for x in SEEN) and d["volume"] == 35)
    SEEN.clear(); s, d = J("/spotify", {"cmd": "shuffle", "arg": "on"}); check("shuffle on", s == 200 and any("shuffle?state=true" in x[1] for x in SEEN))
    SEEN.clear(); s, d = J("/spotify", {"cmd": "repeat", "arg": "one"}); check("repeat one → track", s == 200 and any("repeat?state=track" in x[1] for x in SEEN))
    SEEN.clear(); s, d = J("/spotify", {"cmd": "play"}); check("play (active device) → PUT play?device_id=dev2", s == 200 and any(x[0] == "PUT" and x[1].startswith("/v1/me/player/play") and "device_id=dev2" in x[1] for x in SEEN), (s, d, [x[1] for x in SEEN]))
    SEEN.clear(); s, d = J("/spotify", {"cmd": "play", "arg": "blue monday"}); pl = [x for x in SEEN if x[1].startswith("/v1/me/player/play")]
    check("play <words> → search then uris", s == 200 and pl and json.loads(pl[-1][3]).get("uris") == ["spotify:track:bm"] and "Blue Monday" in d["did"], (s, d))
    SEEN.clear(); s, d = J("/spotify", {"cmd": "search", "arg": "deep focus playlist"}); pl = [x for x in SEEN if x[1].startswith("/v1/me/player/play")]
    check("search playlist → context_uri", s == 200 and pl and json.loads(pl[-1][3]).get("context_uri") == "spotify:playlist:pl1", (s, d))
    s, d = J("/spotify", {"cmd": "search", "arg": "nothing here"}); check("search with no result → 400", s == 400 and "nothing on Spotify" in d["error"], d)
    SEEN.clear(); s, d = J("/spotify", {"cmd": "play_uri", "arg": "spotify:album:al1"}); pl = [x for x in SEEN if x[1].startswith("/v1/me/player/play")]
    check("play_uri album → context_uri", s == 200 and pl and json.loads(pl[-1][3]).get("context_uri") == "spotify:album:al1")
    SEEN.clear(); s, d = J("/spotify", {"cmd": "transfer", "arg": "laptop"}); tr = [x for x in SEEN if x[1] == "/v1/me/player" and x[0] == "PUT"]
    check("transfer laptop → PUT /v1/me/player device_ids", s == 200 and tr and json.loads(tr[-1][3])["device_ids"] == ["dev1"] and d["device"] == "Laptop", (s, d))
    s, d = J("/spotify", {"cmd": "transfer", "arg": "toaster"}); check("transfer unknown device → 400 listing devices", s == 400 and "Kitchen Speaker" in d["error"], d)
    s, d = J("/spotify", {"cmd": "dance"}); check("bad cmd → 400", s == 400)
    # ---- refresh when expired
    t = json.load(open(os.path.join(TMP, "spotify.json"))); t["expires_at"] = 0; json.dump(t, open(os.path.join(TMP, "spotify.json"), "w"))
    SEEN.clear(); s, d = J("/spotify", {"cmd": "pause"}); ref = [x for x in SEEN if x[1] == "/api/token"]
    check("expired token refreshes with refresh_token", s == 200 and ref and "grant_type=refresh_token" in ref[-1][3] and json.load(open(os.path.join(TMP, "spotify.json")))["access_token"] == "AT2")
    s, d = J("/spotify", {"cmd": "unlink"}); s2, d2 = J("/spotify/status"); check("unlink", s == 200 and d2["linked"] is False)
    # ---- calendar
    s, d = J("/calendar/parse?when=" + urllib.parse.quote("tomorrow 3pm")); check("GET /calendar/parse", s == 200 and d["ok"] and d["iso"].endswith("T15:00"), d)
    s, d = J("/calendar/add", {"title": "Dentist", "start": "tomorrow 3pm", "duration_min": 45, "location": "Clinic"}); check("add event (ics)", s == 200 and d["ok"] and d["event"]["title"] == "Dentist" and d["target"] == "ics", d)
    s, d2 = J("/calendar/add", {"title": "Standup", "start": "in 2 hours", "end": "in 3 hours", "notes": "zoom, link in mail"}); check("add second event with end", s == 200 and d2["ok"])
    txt = open(ics, encoding="utf-8").read()
    check("ics file valid: one VCALENDAR, two VEVENT, escaped comma", txt.count("BEGIN:VCALENDAR") == 1 and txt.count("END:VCALENDAR") == 1 and txt.count("BEGIN:VEVENT") == 2 and "zoom\\, link" in txt and txt.rstrip().endswith("END:VCALENDAR"), txt[-200:])
    s, d = J("/calendar/next?n=5"); check("GET /calendar/next lists both, soonest first", s == 200 and [e["title"] for e in d["events"]] == ["Standup", "Dentist"] and d["events"][0]["when"], d)
    s, d = J("/calendar/add", {"title": "Nope", "start": "whenever"}); check("bad time → 400 with a hint", s == 400 and "could not understand" in d["error"], d)
    s, d = J("/calendar/add", {"start": "tomorrow"}); check("missing title → 400", s == 400)
    import samurai_addons  # noqa  (the sidecar's own agenda parser must still read the file we wrote)
    from samurai_addons import parse_ics_today
    check("agenda parser reads the written file", isinstance(parse_ics_today(ics), list))
    # ---- map
    s, d = J("/map/here"); check("GET /map/here from config", s == 200 and d["lat"] == 1.5 and d["lon"] == 2.5 and d["label"] == "TST" and d["source"] == "config", d)
    s, d = J("/map/geocode?q=bengaluru"); check("GET /map/geocode (fake nominatim)", s == 200 and d["ok"] and d["results"][0]["lat"] == 12.9716 and "Bengaluru" in d["results"][0]["label"], d)
    ua = [x for x in SEEN if x[1].startswith("/search")]; check("geocode sends a proper User-Agent", ua and "SAMURAI-AI" in ua[-1][2].get("User-Agent", ""))
    s, d = J("/map/geocode?q=bengaluru"); check("geocode cached", s == 200 and d.get("cached") is True)
    s, d = J("/map/geocode"); check("geocode without q → 400", s == 400)
finally:
    proc.terminate(); fake.shutdown()
    try:
        os.remove(CFG)
    except OSError:
        pass
    if os.path.exists(BACKUP):
        os.replace(BACKUP, CFG)
print("\n" + ("ALL PASS" if not fails else f"{fails} FAILED")); sys.exit(1 if fails else 0)
