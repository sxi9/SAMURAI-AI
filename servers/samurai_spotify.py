"""SAMURAI Spotify: real playback control through the Spotify Web API (Authorization Code with PKCE, no client secret).
Mounted into the add-ons sidecar (:9500).

Setup once: create an app at https://developer.spotify.com/dashboard, add the redirect URI
http://127.0.0.1:9500/spotify/callback, put its Client ID in config.json → spotify.client_id, then open GET /spotify/auth
(the control panel / HUD link) and approve. Tokens live in data/spotify.json; the access token refreshes itself.

GET  /spotify/auth              -> {ok, url}                 the authorize URL to open (or {ok:false, error} when no client id)
GET  /spotify/callback?code=    -> tiny HTML "linked" page   Spotify redirects here
GET  /spotify/status            -> {ok, linked, user, device, playing, track:{title, artist, album, album_art, progress, duration, uri}, devices:[{id,name,type,active,volume}], shuffle, repeat}
POST /spotify {cmd, arg}        cmd: play | pause | next | prev | volume (0-100) | search (words) | play_uri (spotify:…) |
                                shuffle (on/off) | repeat (off/track/context) | transfer (device name) | unlink
                                -> {ok, did, …} ; 400 with a clear error when not linked or no active device

Spotify needs an active device: the desktop/mobile app open, or a speaker. "transfer" picks one when none is active.
SAMURAI_SPOTIFY_FAKE=http://host:port redirects both accounts.spotify.com and api.spotify.com (tests only)."""
import base64, hashlib, json, os, secrets, time, urllib.error, urllib.parse, urllib.request

from samurai_common import DATA, PORTS, load_config

TOKENS = os.path.join(os.environ.get("SAMURAI_DATA") or DATA, "spotify.json")
SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-library-read"
_pending = {}                                  # state -> code_verifier for the auth round trip


def _base():
    fake = os.environ.get("SAMURAI_SPOTIFY_FAKE")
    return (fake, fake) if fake else ("https://accounts.spotify.com", "https://api.spotify.com")


def redirect_uri():
    return os.environ.get("SAMURAI_SPOTIFY_REDIRECT") or f"http://127.0.0.1:{PORTS['addons']}/spotify/callback"


def client_id():
    return (load_config().get("spotify", {}) or {}).get("client_id", "").strip()


def pkce_pair():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def load_tokens():
    try:
        return json.load(open(TOKENS, encoding="utf-8"))
    except Exception:
        return {}


def save_tokens(t):
    os.makedirs(DATA, exist_ok=True)
    json.dump(t, open(TOKENS, "w", encoding="utf-8"), indent=1)


def _post_form(url, fields):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SAMURAI/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8", "replace") or "{}")


def exchange(code, verifier):
    acc, _ = _base()
    t = _post_form(acc + "/api/token", {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri(), "client_id": client_id(), "code_verifier": verifier})
    t["expires_at"] = time.time() + int(t.get("expires_in", 3600)) - 60
    save_tokens(t)
    return t


def access_token():
    t = load_tokens()
    if not t.get("refresh_token") and not t.get("access_token"):
        raise ValueError("Spotify is not linked: set spotify.client_id in config.json, then open /spotify/auth and approve")
    if time.time() >= t.get("expires_at", 0) and t.get("refresh_token"):
        acc, _ = _base()
        n = _post_form(acc + "/api/token", {"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": client_id()})
        t.update(n); t.setdefault("refresh_token", t.get("refresh_token"))
        t["expires_at"] = time.time() + int(n.get("expires_in", 3600)) - 60
        save_tokens(t)
    return t["access_token"]


def api(method, path, body=None, params=None):
    """Call the Web API; returns (status, json-or-None). 204 = fine with no body."""
    _, base = _base()
    url = base + path + (("?" + urllib.parse.urlencode(params)) if params else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + access_token(), "Content-Type": "application/json", "User-Agent": "SAMURAI/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            raw = r.read()
            return r.status, (json.loads(raw.decode("utf-8", "replace")) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(raw).get("error", {}).get("message", raw)
        except Exception:
            msg = raw
        if e.code == 404 and "device" in str(msg).lower():
            raise ValueError("no active Spotify device: open the Spotify app on a device (or say \"transfer to <device>\")")
        if e.code == 403 and "premium" in str(msg).lower():
            raise ValueError("Spotify playback control needs a Premium account")
        if e.code == 401:
            raise ValueError("Spotify session expired: open /spotify/auth and approve again")
        raise ValueError(f"Spotify {e.code}: {str(msg)[:120]}")


# ----------------------------------------------------------------------------- routes
def get_auth(h, q, b):
    cid = client_id()
    if not cid:
        return {"ok": False, "error": "set spotify.client_id in config.json first (create an app at developer.spotify.com, redirect " + redirect_uri() + ")"}
    verifier, challenge = pkce_pair(); state = secrets.token_urlsafe(12)
    _pending[state] = verifier
    for k in [k for k, v in list(_pending.items())][:-20]:
        _pending.pop(k, None)
    acc, _ = _base()
    url = acc + "/authorize?" + urllib.parse.urlencode({"client_id": cid, "response_type": "code", "redirect_uri": redirect_uri(), "scope": SCOPES,
                                                        "code_challenge_method": "S256", "code_challenge": challenge, "state": state})
    return {"ok": True, "url": url, "state": state}


def get_callback(h, q, b):
    code, state, err = q.get("code"), q.get("state", ""), q.get("error")
    page = lambda msg, ok=True: h.send_bytes(f"<!doctype html><meta charset=utf-8><body style='background:#05060d;color:{'#2ee6ff' if ok else '#ff3d6e'};font:16px/1.6 Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0'><div style='text-align:center'><h2 style='letter-spacing:.3em'>SAMURAI</h2>{msg}</div></body>".encode(), "text/html; charset=utf-8")
    if err or not code:
        page(f"Spotify said: {err or 'no code'}. Close this and try again.", False); return None
    verifier = _pending.pop(state, None)
    if not verifier:
        page("This link is stale. Open /spotify/auth again.", False); return None
    try:
        exchange(code, verifier)
    except Exception as e:
        page(f"Token exchange failed: {str(e)[:120]}", False); return None
    page("Linked to Spotify. You can close this tab and say \"play music on spotify\"."); return None


def track_of(item):
    if not item:
        return None
    imgs = (item.get("album") or {}).get("images") or (item.get("images") or [])
    return {"title": item.get("name", ""), "artist": ", ".join(a.get("name", "") for a in item.get("artists", [])), "album": (item.get("album") or {}).get("name", ""),
            "album_art": imgs[0]["url"] if imgs else "", "duration": int(item.get("duration_ms", 0) / 1000), "uri": item.get("uri", "")}


def get_status(h, q, b):
    t = load_tokens()
    if not (t.get("access_token") or t.get("refresh_token")):
        return {"ok": True, "linked": False, "client_id": bool(client_id()), "note": "not linked: open /spotify/auth"}
    out = {"ok": True, "linked": True, "user": t.get("user", ""), "device": None, "playing": False, "track": None, "devices": [], "shuffle": False, "repeat": "off"}
    try:
        if not t.get("user"):
            s, me = api("GET", "/v1/me")
            if me:
                t["user"] = me.get("display_name") or me.get("id", ""); save_tokens(t); out["user"] = t["user"]
        s, p = api("GET", "/v1/me/player")
        if p:
            out.update(playing=bool(p.get("is_playing")), device=(p.get("device") or {}).get("name"), shuffle=bool(p.get("shuffle_state")), repeat=p.get("repeat_state", "off"))
            tr = track_of(p.get("item"))
            if tr:
                tr["progress"] = int((p.get("progress_ms") or 0) / 1000); out["track"] = tr
        s, d = api("GET", "/v1/me/player/devices")
        out["devices"] = [{"id": x.get("id"), "name": x.get("name"), "type": x.get("type"), "active": bool(x.get("is_active")), "volume": x.get("volume_percent")} for x in (d or {}).get("devices", [])]
    except ValueError as e:
        out["error"] = str(e)
    return out


def active_device_id(prefer=None):
    s, d = api("GET", "/v1/me/player/devices")
    devs = (d or {}).get("devices", [])
    if prefer:
        pl = prefer.lower()
        m = next((x for x in devs if pl in (x.get("name") or "").lower() or pl in (x.get("type") or "").lower()), None)
        if m:
            return m["id"], m["name"]
        raise ValueError(f"no Spotify device called {prefer}; available: {', '.join(x.get('name', '') for x in devs) or 'none'}")
    act = next((x for x in devs if x.get("is_active")), None) or (devs[0] if devs else None)
    if not act:
        raise ValueError("no Spotify device available: open the Spotify app on your PC or phone first")
    return act["id"], act["name"]


def ensure_device():
    """Return a device id to play on, transferring playback to the first device when none is active."""
    s, d = api("GET", "/v1/me/player/devices")
    devs = (d or {}).get("devices", [])
    act = next((x for x in devs if x.get("is_active")), None)
    if act:
        return act["id"]
    if not devs:
        raise ValueError("no Spotify device available: open the Spotify app on your PC or phone first")
    api("PUT", "/v1/me/player", {"device_ids": [devs[0]["id"]], "play": False})
    return devs[0]["id"]


def search(words):
    s, r = api("GET", "/v1/search", params={"q": words, "type": "track,album,playlist,artist", "limit": 3})
    r = r or {}
    for kind in ("track", "album", "playlist", "artist"):
        items = (r.get(kind + "s") or {}).get("items") or []
        items = [i for i in items if i]
        if items:
            it = items[0]
            return {"kind": kind, "uri": it.get("uri"), "name": it.get("name"), "by": ", ".join(a.get("name", "") for a in it.get("artists", [])) if kind in ("track", "album") else (it.get("owner") or {}).get("display_name", "")}
    return None


def post_spotify(h, q, b):
    cmd, arg = (b.get("cmd") or "").lower().strip(), str(b.get("arg") or "").strip()
    if cmd == "unlink":
        try:
            os.remove(TOKENS)
        except OSError:
            pass
        return {"ok": True, "did": "Spotify unlinked"}
    if cmd not in ("play", "pause", "next", "prev", "volume", "search", "play_uri", "shuffle", "repeat", "transfer"):
        raise ValueError("cmd must be play|pause|next|prev|volume|search|play_uri|shuffle|repeat|transfer|unlink")
    access_token()                                                       # raises the not-linked message early
    if cmd == "pause":
        api("PUT", "/v1/me/player/pause"); return {"ok": True, "did": "paused"}
    if cmd == "next":
        api("POST", "/v1/me/player/next"); return {"ok": True, "did": "next track"}
    if cmd == "prev":
        api("POST", "/v1/me/player/previous"); return {"ok": True, "did": "previous track"}
    if cmd == "volume":
        v = max(0, min(100, int(float(arg or 50)))); api("PUT", "/v1/me/player/volume", params={"volume_percent": v}); return {"ok": True, "did": f"volume {v}", "volume": v}
    if cmd == "shuffle":
        on = arg.lower() not in ("off", "0", "false", "no"); api("PUT", "/v1/me/player/shuffle", params={"state": "true" if on else "false"}); return {"ok": True, "did": f"shuffle {'on' if on else 'off'}", "shuffle": on}
    if cmd == "repeat":
        st = arg.lower() if arg.lower() in ("off", "track", "context") else ("track" if arg.lower() in ("one", "song", "this") else "context" if arg.lower() in ("on", "all") else "off")
        api("PUT", "/v1/me/player/repeat", params={"state": st}); return {"ok": True, "did": f"repeat {st}", "repeat": st}
    if cmd == "transfer":
        did, name = active_device_id(arg or None); api("PUT", "/v1/me/player", {"device_ids": [did], "play": True}); return {"ok": True, "did": f"playing on {name}", "device": name}
    dev = ensure_device()
    if cmd == "play":
        if arg:                                                          # "play <words>" = search then play
            hit = search(arg)
            if not hit:
                raise ValueError(f"nothing on Spotify for '{arg}'")
            body = {"uris": [hit["uri"]]} if hit["kind"] == "track" else {"context_uri": hit["uri"]}
            api("PUT", "/v1/me/player/play", body, params={"device_id": dev}); return {"ok": True, "did": f"playing {hit['kind']} {hit['name']}" + (f" by {hit['by']}" if hit["by"] else ""), "hit": hit}
        api("PUT", "/v1/me/player/play", params={"device_id": dev}); return {"ok": True, "did": "playing"}
    if cmd == "search":
        if not arg:
            raise ValueError("search needs words")
        hit = search(arg)
        if not hit:
            raise ValueError(f"nothing on Spotify for '{arg}'")
        body = {"uris": [hit["uri"]]} if hit["kind"] == "track" else {"context_uri": hit["uri"]}
        api("PUT", "/v1/me/player/play", body, params={"device_id": dev}); return {"ok": True, "did": f"playing {hit['kind']} {hit['name']}" + (f" by {hit['by']}" if hit["by"] else ""), "hit": hit}
    if cmd == "play_uri":
        if not arg.startswith("spotify:"):
            raise ValueError("play_uri needs a spotify: uri")
        body = {"uris": [arg]} if ":track:" in arg else {"context_uri": arg}
        api("PUT", "/v1/me/player/play", body, params={"device_id": dev}); return {"ok": True, "did": f"playing {arg}"}
    raise ValueError("unknown command")


ROUTES = {("GET", "/spotify/auth"): get_auth, ("GET", "/spotify/callback"): get_callback, ("GET", "/spotify/status"): get_status, ("POST", "/spotify"): post_spotify}
