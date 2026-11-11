"""SAMURAI Add-ons Sidecar — data for the HUD widgets, plus config and memory.  Port 9500.

GET  /config                      public config for the page (name, node, location, which widgets are live)
POST /config  {user, location, widgets}   merge + save
GET  /weather                     Open-Meteo at the configured lat/lon (no key)
GET  /ticker                      crypto prices (CoinGecko) + Hacker News headlines
GET  /tasks   POST /tasks {action: add|toggle|remove|clear_done, id, label, due}
GET  /agenda                      today's events from an .ics file (config widgets.agenda.ics_path) or sample
GET  /inbox                       IMAP headers (config widgets.inbox) or sample
GET  /home    POST /home {device, on}   Home Assistant (config widgets.home) or local sample state
GET  /music   GET /music/file?i=N  POST /music {cmd, i}   local library (config widgets.music.library_dir)
GET  /gallery GET /gallery/file?name=   images from the gallery/ folder
GET  /position                    configured location + nearby places
GET  /security POST /security/block {ip}   failed-login watch + firewall block
GET  /memory  POST /memory {action: remember|forget|append|clear, text, role}   local context (data/memory.json)
GET  /addons/status               which widgets are live vs sample
Run: python samurai_addons.py
"""
import json, os, re, sys, threading, time, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import (JSONHandler, PORTS, ROOT, DATA, IS_WIN, IS_MAC, NOWIN,
                            load_config, save_config, http_json, run_hidden)

PORT = PORTS["addons"]
TASKS_PATH = os.path.join(DATA, "tasks.json")
MEMORY_PATH = os.path.join(DATA, "memory.json")
HOME_PATH = os.path.join(DATA, "home_state.json")
LOCK = threading.Lock()
_cache = {}


def cached(key, ttl, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (now, val)
    return val


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


# ----------------------------------------------------------------------------- config
SECRET_KEYS = {"imap_password", "hass_token"}


def public_config(cfg):
    w = {}
    for name, sect in cfg.get("widgets", {}).items():
        w[name] = {k: ("***" if k in SECRET_KEYS and v else v) for k, v in sect.items()}
    return {"user": cfg["user"], "location": cfg["location"], "widgets": w,
            "agent": cfg.get("agent", {}), "autostart": cfg.get("autostart", False)}


def get_config(h, q, b):
    return {"ok": True, **public_config(load_config())}


def post_config(h, q, b):
    cfg = load_config()
    for key in ("user", "location", "widgets", "agent", "autostart"):
        if key in b:
            if isinstance(b[key], dict) and isinstance(cfg.get(key), dict):
                for k2, v2 in b[key].items():
                    if isinstance(v2, dict) and isinstance(cfg[key].get(k2), dict):
                        cfg[key][k2].update({k: v for k, v in v2.items() if v != "***"})
                    else:
                        cfg[key][k2] = v2
            else:
                cfg[key] = b[key]
    save_config(cfg)
    _cache.clear()
    return {"ok": True, **public_config(cfg)}


# ----------------------------------------------------------------------------- weather
WMO = {0: "CLEAR", 1: "MAINLY CLEAR", 2: "PARTLY CLOUDY", 3: "OVERCAST", 45: "FOG", 48: "FOG", 51: "DRIZZLE",
       53: "DRIZZLE", 55: "DRIZZLE", 61: "RAIN", 63: "RAIN", 65: "HEAVY RAIN", 71: "SNOW", 73: "SNOW", 75: "SNOW",
       80: "SHOWERS", 81: "SHOWERS", 82: "SHOWERS", 95: "THUNDERSTORM", 96: "THUNDERSTORM", 99: "THUNDERSTORM"}
SAMPLE_WEATHER = {"temp": 27, "cond": "PARTLY CLOUDY", "hi": 31, "lo": 20, "wind": 9, "hum": 58, "uv": 6,
                  "days": [{"d": "THU", "hi": 28, "lo": 19, "cond": "RAIN"}, {"d": "FRI", "hi": 29, "lo": 20, "cond": "CLEAR"},
                           {"d": "SAT", "hi": 31, "lo": 20, "cond": "CLEAR"}, {"d": "SUN", "hi": 30, "lo": 21, "cond": "CLOUDY"}],
                  "live": False}


def fetch_weather():
    loc = load_config()["location"]
    lat, lon = float(loc.get("lat") or 0), float(loc.get("lon") or 0)
    if lat == 0 and lon == 0:
        return {**SAMPLE_WEATHER, "label": loc.get("label", "SET ME"), "note": "set location in config.json"}
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,uv_index"
           "&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=5&timezone=auto")
    d = http_json(url, timeout=8)
    cur, daily = d["current"], d["daily"]
    days = []
    for i in range(1, min(5, len(daily["time"]))):
        wd = time.strftime("%a", time.strptime(daily["time"][i], "%Y-%m-%d")).upper()
        days.append({"d": wd, "hi": round(daily["temperature_2m_max"][i]), "lo": round(daily["temperature_2m_min"][i]),
                     "cond": WMO.get(daily["weather_code"][i], "CLOUDY")})
    return {"temp": round(cur["temperature_2m"]), "cond": WMO.get(cur["weather_code"], "CLOUDY"),
            "hi": round(daily["temperature_2m_max"][0]), "lo": round(daily["temperature_2m_min"][0]),
            "wind": round(cur["wind_speed_10m"]), "hum": round(cur["relative_humidity_2m"]),
            "uv": round(cur.get("uv_index") or 0), "days": days, "label": loc.get("label", ""), "live": True}


def get_weather(h, q, b):
    try:
        return {"ok": True, **cached("weather", 600, fetch_weather)}
    except Exception as e:
        return {"ok": True, **SAMPLE_WEATHER, "error": str(e)[:80]}


# ----------------------------------------------------------------------------- ticker
def fetch_ticker():
    markets, headlines = [], []
    try:
        c = http_json("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true", 8)
        for sym, key in (("BTC", "bitcoin"), ("ETH", "ethereum"), ("SOL", "solana")):
            if key in c:
                markets.append({"sym": sym, "px": c[key]["usd"], "chg": round(c[key].get("usd_24h_change") or 0, 1)})
    except Exception:
        pass
    try:
        ids = http_json("https://hacker-news.firebaseio.com/v0/topstories.json", 8)[:6]
        for i in ids:
            try:
                it = http_json(f"https://hacker-news.firebaseio.com/v0/item/{i}.json", 5)
                if it and it.get("title"):
                    headlines.append(it["title"][:80])
            except Exception:
                pass
    except Exception:
        pass
    return {"markets": markets, "headlines": headlines, "live": bool(markets or headlines)}


def get_ticker(h, q, b):
    return {"ok": True, **cached("ticker", 120, fetch_ticker)}


# ----------------------------------------------------------------------------- tasks
SAMPLE_TASKS = [{"id": 1, "label": "Deploy checklist", "due": "TODAY", "done": False},
                {"id": 2, "label": "Review telemetry PR", "due": "DONE", "done": True},
                {"id": 3, "label": "Large voice model → NAS", "due": "FRI", "done": False},
                {"id": 4, "label": "Rename action routes", "due": "DONE", "done": True}]


def get_tasks(h, q, b):
    with LOCK:
        tasks = load_json(TASKS_PATH, None)
        if tasks is None:
            tasks = SAMPLE_TASKS
            save_json(TASKS_PATH, tasks)
    return {"ok": True, "tasks": tasks}


def post_tasks(h, q, b):
    with LOCK:
        tasks = load_json(TASKS_PATH, list(SAMPLE_TASKS))
        act = b.get("action")
        if act == "add":
            label = (b.get("label") or "").strip()[:120]
            if not label:
                raise ValueError("label required")
            nid = max([t["id"] for t in tasks] + [0]) + 1
            tasks.append({"id": nid, "label": label, "due": (b.get("due") or "TODAY")[:12].upper(), "done": False})
        elif act == "toggle":
            for t in tasks:
                if t["id"] == b.get("id"):
                    t["done"] = not t["done"]
                    t["due"] = "DONE" if t["done"] else (t.get("orig_due") or "TODAY")
        elif act == "remove":
            tasks = [t for t in tasks if t["id"] != b.get("id")]
        elif act == "clear_done":
            tasks = [t for t in tasks if not t["done"]]
        else:
            raise ValueError("action must be add|toggle|remove|clear_done")
        save_json(TASKS_PATH, tasks)
    return {"ok": True, "tasks": tasks}


# ----------------------------------------------------------------------------- agenda
SAMPLE_AGENDA = [{"time": "09:30", "title": "Standup", "tag": "ENG", "next": False, "past": True},
                 {"time": "14:00", "title": "Design review", "tag": "HUD v3", "next": True, "past": False},
                 {"time": "18:30", "title": "Gym", "tag": "", "next": False, "past": False}]


def parse_ics_today(path):
    today = time.strftime("%Y%m%d")
    events, cur = [], None
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if line == "BEGIN:VEVENT":
                cur = {}
            elif line == "END:VEVENT" and cur is not None:
                st = cur.get("DTSTART", "")
                if st.startswith(today):
                    hhmm = st[9:13] if len(st) >= 13 else "0000"
                    events.append({"time": f"{hhmm[:2]}:{hhmm[2:]}", "title": cur.get("SUMMARY", "")[:40],
                                   "tag": cur.get("LOCATION", "")[:16], "next": False, "past": False})
                cur = None
            elif cur is not None and ":" in line:
                k, v = line.split(":", 1)
                cur[k.split(";")[0]] = v
    events.sort(key=lambda e: e["time"])
    now = time.strftime("%H:%M")
    marked = False
    for e in events:
        e["past"] = e["time"] < now
        if not e["past"] and not marked:
            e["next"] = True
            marked = True
    return events


def get_agenda(h, q, b):
    cfg = load_config()["widgets"]["agenda"]
    path = os.path.expanduser(cfg.get("ics_path") or "")
    if path and os.path.exists(path):
        try:
            return {"ok": True, "events": cached("agenda", 300, lambda: parse_ics_today(path)), "live": True}
        except Exception as e:
            return {"ok": True, "events": SAMPLE_AGENDA, "live": False, "error": str(e)[:80]}
    return {"ok": True, "events": SAMPLE_AGENDA, "live": False, "note": "set widgets.agenda.ics_path in config.json"}


# ----------------------------------------------------------------------------- inbox
SAMPLE_INBOX = [{"from": "Priya N.", "subject": "Vendor contract — reply before 5?", "time": "11:02", "unread": True, "flagged": True},
                {"from": "GitHub", "subject": "[SAMURAI-AI] CI passed on main", "time": "10:40", "unread": True, "flagged": False},
                {"from": "Arjun", "subject": "Weekend plan? Trek or climb", "time": "09:15", "unread": True, "flagged": False}]


def fetch_inbox(cfg):
    import email, imaplib
    from email.header import decode_header
    M = imaplib.IMAP4_SSL(cfg["imap_host"], int(cfg.get("imap_port") or 993))
    M.login(cfg["imap_user"], cfg["imap_password"])
    M.select("INBOX", readonly=True)
    _, data = M.search(None, "ALL")
    ids = data[0].split()[-6:]
    out = []
    for i in reversed(ids):
        _, msg = M.fetch(i, "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
        raw = b"".join(p[1] for p in msg if isinstance(p, tuple))
        m = email.message_from_bytes(raw)

        def dec(s):
            return "".join(t.decode(c or "utf-8", "replace") if isinstance(t, bytes) else t for t, c in decode_header(s or ""))
        flags = b"".join(p[0] if isinstance(p, tuple) else p for p in msg).decode("utf-8", "ignore")
        sender = re.sub(r"\s*<.*>", "", dec(m.get("From"))).strip()[:24]
        out.append({"from": sender, "subject": dec(m.get("Subject"))[:60], "time": (m.get("Date") or "")[17:22],
                    "unread": "\\Seen" not in flags, "flagged": "\\Flagged" in flags})
    M.logout()
    return out


def get_inbox(h, q, b):
    cfg = load_config()["widgets"]["inbox"]
    if cfg.get("imap_host") and cfg.get("imap_user") and cfg.get("imap_password"):
        try:
            return {"ok": True, "mail": cached("inbox", 120, lambda: fetch_inbox(cfg)), "live": True}
        except Exception as e:
            return {"ok": True, "mail": SAMPLE_INBOX, "live": False, "error": str(e)[:80]}
    return {"ok": True, "mail": SAMPLE_INBOX, "live": False, "note": "set widgets.inbox imap_* in config.json"}


# ----------------------------------------------------------------------------- home
SAMPLE_HOME = {"lights": True, "ac": True, "lock": True, "blinds": False, "plug": False, "fan": True}
HASS_MAP = {"lights": "light.living_room", "ac": "climate.ac", "lock": "lock.front_door",
            "blinds": "cover.blinds", "plug": "switch.plug", "fan": "fan.ceiling"}


def hass(cfg, path, body=None):
    req = urllib.request.Request(cfg["hass_url"].rstrip("/") + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + cfg["hass_token"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=6) as r:
        return json.loads(r.read().decode())


def get_home(h, q, b):
    cfg = load_config()["widgets"]["home"]
    if cfg.get("hass_url") and cfg.get("hass_token"):
        try:
            ents = {k: (cfg.get("entities", {}).get(k) or v) for k, v in HASS_MAP.items()}
            state = {}
            for key, ent in ents.items():
                s = hass(cfg, f"/api/states/{ent}")
                state[key] = s.get("state") in ("on", "locked", "closed", "heat", "cool", "auto")
            return {"ok": True, "state": state, "live": True}
        except Exception as e:
            return {"ok": True, "state": load_json(HOME_PATH, SAMPLE_HOME), "live": False, "error": str(e)[:80]}
    return {"ok": True, "state": load_json(HOME_PATH, SAMPLE_HOME), "live": False}


def post_home(h, q, b):
    dev, on = b.get("device"), bool(b.get("on"))
    if dev not in SAMPLE_HOME:
        raise ValueError("device must be one of " + ", ".join(SAMPLE_HOME))
    cfg = load_config()["widgets"]["home"]
    if cfg.get("hass_url") and cfg.get("hass_token"):
        ent = (cfg.get("entities", {}).get(dev) or HASS_MAP[dev])
        domain = ent.split(".")[0]
        svc = {"lock": "lock" if on else "unlock", "cover": "close_cover" if on else "open_cover"}.get(
            domain, "turn_on" if on else "turn_off")
        hass(cfg, f"/api/services/{domain}/{svc}", {"entity_id": ent})
        return get_home(h, q, b)
    with LOCK:
        state = load_json(HOME_PATH, dict(SAMPLE_HOME))
        state[dev] = on
        save_json(HOME_PATH, state)
    return {"ok": True, "state": state, "live": False}


# ----------------------------------------------------------------------------- music
AUDIO_EXT = (".mp3", ".m4a", ".flac", ".ogg", ".wav", ".aac", ".opus")
_music = {"tracks": [], "scanned": 0, "dir": "", "now": {"i": -1, "playing": False}}
SAMPLE_TRACKS = [{"i": -1, "title": "Night Drive", "artist": "Kessler Array", "len": 221, "sample": True}]


def scan_music():
    d = os.path.expanduser(load_config()["widgets"]["music"].get("library_dir") or "")
    if not d or not os.path.isdir(d):
        _music.update(tracks=[], dir="")
        return
    if _music["dir"] == d and time.time() - _music["scanned"] < 300:
        return
    tracks = []
    for root, _, files in os.walk(d):
        for f in sorted(files):
            if f.lower().endswith(AUDIO_EXT):
                p = os.path.join(root, f)
                name = os.path.splitext(f)[0]
                artist, title = (name.split(" - ", 1) + [""])[:2] if " - " in name else ("", name)
                tracks.append({"i": len(tracks), "title": (title or name)[:40], "artist": (artist or os.path.basename(root))[:30],
                               "path": p, "size": os.path.getsize(p)})
                if len(tracks) >= 2000:
                    break
    _music.update(tracks=tracks, dir=d, scanned=time.time())


def get_music(h, q, b):
    scan_music()
    tr = [{k: v for k, v in t.items() if k != "path"} for t in _music["tracks"]]
    return {"ok": True, "tracks": tr or SAMPLE_TRACKS, "live": bool(tr), "now": _music["now"], "count": len(tr)}


def get_music_file(h, q, b):
    scan_music()
    i = int(q.get("i", -1))
    if not (0 <= i < len(_music["tracks"])):
        raise ValueError("no such track")
    p = _music["tracks"][i]["path"]
    ctype = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "flac": "audio/flac", "ogg": "audio/ogg", "wav": "audio/wav",
             "aac": "audio/aac", "opus": "audio/ogg"}[p.rsplit(".", 1)[-1].lower()]
    with open(p, "rb") as f:
        h.send_bytes(f.read(), ctype, extra={"Accept-Ranges": "none"})
    return None


def post_music(h, q, b):
    cmd = b.get("cmd")
    if cmd in ("play", "pause", "set"):
        if "i" in b:
            _music["now"]["i"] = int(b["i"])
        _music["now"]["playing"] = cmd == "play" or (cmd == "set" and bool(b.get("playing")))
    elif cmd in ("next", "prev") and _music["tracks"]:
        n = len(_music["tracks"])
        _music["now"]["i"] = (_music["now"]["i"] + (1 if cmd == "next" else -1)) % n
        _music["now"]["playing"] = True
    elif cmd == "find":
        scan_music()
        qstr = (b.get("q") or "").lower()
        hit = next((t for t in _music["tracks"] if qstr in t["title"].lower() or qstr in t["artist"].lower()), None)
        if hit:
            _music["now"].update(i=hit["i"], playing=True)
        return {"ok": bool(hit), "now": _music["now"], "track": hit and {k: v for k, v in hit.items() if k != "path"}}
    return {"ok": True, "now": _music["now"]}


# ----------------------------------------------------------------------------- gallery
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif")


def gallery_dir():
    d = load_config()["widgets"]["gallery"].get("dir") or "gallery"
    return d if os.path.isabs(d) else os.path.join(ROOT, d)


def get_gallery(h, q, b):
    d = gallery_dir()
    try:
        names = sorted(f for f in os.listdir(d) if f.lower().endswith(IMG_EXT))[:30]
    except OSError:
        names = []
    return {"ok": True, "images": [f"/gallery/file?name={urllib.parse.quote(n)}" for n in names], "dir": d}


def get_gallery_file(h, q, b):
    name = os.path.basename(q.get("name", ""))
    p = os.path.join(gallery_dir(), name)
    if not name.lower().endswith(IMG_EXT) or not os.path.exists(p):
        raise ValueError("no such image")
    ctype = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}[name.rsplit(".", 1)[-1].lower()]
    with open(p, "rb") as f:
        h.send_bytes(f.read(), ctype, extra={"Cache-Control": "max-age=300"})
    return None


# ----------------------------------------------------------------------------- position
def get_position(h, q, b):
    cfg = load_config()
    loc = cfg["location"]
    return {"ok": True, "lat": loc.get("lat"), "lon": loc.get("lon"), "label": loc.get("label"),
            "node": cfg["user"].get("node"), "sats": 0, "nearby": cfg["widgets"]["position"].get("nearby", [])}


# ----------------------------------------------------------------------------- security
def failed_logins():
    """Recent failed logins: Windows event 4625, or sshd 'Failed password' lines on Linux/macOS."""
    out = []
    try:
        if IS_WIN:
            ps = ("Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4625} -MaxEvents 20 -ErrorAction SilentlyContinue | "
                  "ForEach-Object { [pscustomobject]@{ t=$_.TimeCreated.ToString('HH:mm:ss'); "
                  "ip=($_.Properties[19].Value); user=($_.Properties[5].Value) } } | ConvertTo-Json -Compress")
            r = run_hidden(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True, timeout=30)
            data = json.loads(r.stdout) if r.stdout.strip() else []
            out = [data] if isinstance(data, dict) else data
        else:
            r = run_hidden(["journalctl", "_COMM=sshd", "-n", "200", "--no-pager", "-o", "short"], capture_output=True, text=True, timeout=15)
            for line in r.stdout.splitlines():
                m = re.search(r"^(\S+ \S+ \S+).*Failed password for (?:invalid user )?(\S+) from ([\d.a-f:]+)", line)
                if m:
                    out.append({"t": m.group(1)[-8:], "user": m.group(2), "ip": m.group(3)})
    except Exception:
        pass
    return out[-20:]


def get_security(h, q, b):
    ev = cached("security", 60, failed_logins)
    by_ip = {}
    for e in ev:
        ip = e.get("ip") or "?"
        by_ip[ip] = by_ip.get(ip, 0) + 1
    worst = max(by_ip.items(), key=lambda kv: kv[1]) if by_ip else None
    level = "HIGH" if worst and worst[1] >= 3 else ("MEDIUM" if worst else "LOW")
    node = load_config()["user"].get("node", "LOCAL-01")
    return {"ok": True, "level": level, "events": ev,
            "title": f"Unusual login pattern on node {node}" if worst else "No failed logins detected",
            "source": f"{worst[0]} · unknown host" if worst else "—",
            "vector": f"{worst[1]} failed attempts" if worst else "—", "asset": "login service", "live": True}


def post_block(h, q, b):
    ip = (b.get("ip") or "").strip()
    if not re.fullmatch(r"(\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{3,39}", ip):
        raise ValueError("bad ip")
    if not b.get("confirm"):
        return {"ok": False, "needs_confirm": True, "error": "blocking needs confirm:true"}
    if IS_WIN:
        r = run_hidden(["netsh", "advfirewall", "firewall", "add", "rule", f"name=SAMURAI block {ip}", "dir=in",
                        "action=block", f"remoteip={ip}"], capture_output=True, text=True, timeout=15)
    elif IS_MAC:
        r = run_hidden(["sh", "-c", f"echo 'block drop from {ip} to any' | sudo -n pfctl -ef -"], capture_output=True, text=True, timeout=15)
    else:
        r = run_hidden(["sh", "-c", f"sudo -n ufw deny from {ip} || sudo -n iptables -I INPUT -s {ip} -j DROP"],
                       capture_output=True, text=True, timeout=15)
    if r.returncode != 0:
        return {"ok": False, "error": (r.stderr or r.stdout or "firewall command failed (needs admin)").strip()[:160]}
    _cache.pop("security", None)
    return {"ok": True, "did": f"Blocked {ip}"}


# ----------------------------------------------------------------------------- memory
def get_memory(h, q, b):
    mem = load_json(MEMORY_PATH, {"facts": [], "history": []})
    n = int(q.get("history", 20))
    return {"ok": True, "facts": mem["facts"], "history": mem["history"][-n:], "count": len(mem["history"])}


def post_memory(h, q, b):
    with LOCK:
        mem = load_json(MEMORY_PATH, {"facts": [], "history": []})
        act = b.get("action")
        text = (b.get("text") or "").strip()
        if act == "remember" and text:
            if text not in mem["facts"]:
                mem["facts"].append(text[:300])
        elif act == "forget" and text:
            mem["facts"] = [f for f in mem["facts"] if text.lower() not in f.lower()]
        elif act == "append" and text:
            mem["history"].append({"t": int(time.time()), "role": b.get("role", "user"), "content": text[:2000]})
            mem["history"] = mem["history"][-400:]
        elif act == "clear":
            mem["history"] = []
        elif act == "clear_facts":
            mem["facts"] = []
        else:
            raise ValueError("action must be remember|forget|append|clear|clear_facts")
        save_json(MEMORY_PATH, mem)
    return {"ok": True, "facts": mem["facts"], "count": len(mem["history"])}


# ----------------------------------------------------------------------------- status
def get_status(h, q, b):
    cfg = load_config()
    w = cfg["widgets"]
    loc = cfg["location"]
    return {"ok": True, "live": {
        "weather": bool(float(loc.get("lat") or 0) or float(loc.get("lon") or 0)),
        "agenda": bool(w["agenda"].get("ics_path")), "inbox": bool(w["inbox"].get("imap_host")),
        "home": bool(w["home"].get("hass_url")), "music": bool(w["music"].get("library_dir")),
        "camera": bool(w["camera"].get("url")), "gallery": os.path.isdir(gallery_dir()),
        "security": True, "tasks": True, "ticker": True, "position": True, "memory": True}}


class Handler(JSONHandler):
    TAG = "SAMURAI-ADDONS"
    ROUTES = {
        ("GET", "/config"): get_config, ("POST", "/config"): post_config,
        ("GET", "/weather"): get_weather, ("GET", "/ticker"): get_ticker,
        ("GET", "/tasks"): get_tasks, ("POST", "/tasks"): post_tasks,
        ("GET", "/agenda"): get_agenda, ("GET", "/inbox"): get_inbox,
        ("GET", "/home"): get_home, ("POST", "/home"): post_home,
        ("GET", "/music"): get_music, ("GET", "/music/file"): get_music_file, ("POST", "/music"): post_music,
        ("GET", "/gallery"): get_gallery, ("GET", "/gallery/file"): get_gallery_file,
        ("GET", "/position"): get_position,
        ("GET", "/security"): get_security, ("POST", "/security/block"): post_block,
        ("GET", "/memory"): get_memory, ("POST", "/memory"): post_memory,
        ("GET", "/addons/status"): get_status,
    }


if __name__ == "__main__":
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(gallery_dir(), exist_ok=True)
    print(f"[SAMURAI] Add-ons sidecar on http://localhost:{PORT}/  (config: {os.path.join(ROOT, 'config.json')})")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
