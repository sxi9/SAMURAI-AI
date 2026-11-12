"""SAMURAI calendar writes + map helpers. Mounted into the add-ons sidecar (:9500).

POST /calendar/add {title, start, end?, duration_min?, location?, notes?}
      start/end: ISO 8601 ("2026-11-13T15:00") or natural ("tomorrow 3pm", "next monday at 10", "in 2 hours", "friday 15:30", "on 12 dec 9am")
      writes to calendar.target = "ics" (the file in widgets.agenda.ics_path, created if missing) or "caldav" (PUT to calendar.caldav_url
      with calendar.caldav_user / caldav_password: Nextcloud, Fastmail, iCloud app passwords, Radicale, Synology). Google Calendar needs OAuth and is not covered.
      -> {ok, event:{uid, title, start, end, location}, target, did}
GET  /calendar/next?n=5         -> {ok, events:[{uid, title, start, end, location, when}], source}
GET  /calendar/parse?when=      -> {ok, iso, human}   (what the parser understood)

GET  /map/geocode?q=            -> {ok, results:[{lat, lon, label}]}   Nominatim (OpenStreetMap), 1 request/s, cached, proper User-Agent
GET  /map/here                  -> {ok, lat, lon, label, source: config|phone, phone:{lat, lon, t, device}|null}
      the phone position comes from samurai_findmy.LAST_POS when that module has one (Google Find My Device parsed a location).
Map tiles are loaded by the HUD straight from tile.openstreetmap.org (light personal use, attribution shown, see
https://operations.osmfoundation.org/policies/tiles/)."""
import datetime as dt, json, os, re, threading, time, urllib.parse, urllib.request, uuid

from samurai_common import DATA, load_config, http_json

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "fifteen": 15, "twenty": 20, "thirty": 30, "half": 0.5, "an": 1, "a": 1}


# ----------------------------------------------------------------------------- natural time
def parse_when(text, now=None, default_hour=9):
    """'tomorrow 3pm' / 'next monday at 10' / 'in 2 hours' / 'friday 15:30' / 'on 12 dec' / 'today' / ISO -> datetime (local, naive). None when nothing understood."""
    now = now or dt.datetime.now()
    s = (text or "").strip().lower()
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))?", s)
    if m:                                                       # ISO
        return dt.datetime(int(m[1]), int(m[2]), int(m[3]), int(m[4] or default_hour), int(m[5] or 0))
    m = re.search(r"\bin (\d+|[a-z]+) ?(minutes?|mins?|hours?|hrs?|days?|weeks?)\b", s)
    if m:                                                       # relative
        n = float(m[1]) if m[1].isdigit() else WORDNUM.get(m[1], 1)
        unit = m[2]
        delta = dt.timedelta(minutes=n) if unit.startswith("m") else dt.timedelta(hours=n) if unit.startswith("h") else dt.timedelta(days=n) if unit.startswith("d") else dt.timedelta(weeks=n)
        return (now + delta).replace(second=0, microsecond=0)
    day = None
    if re.search(r"\btoday\b", s) or re.search(r"\btonight\b", s):
        day = now.date()
    elif re.search(r"\btomorrow\b", s):
        day = now.date() + dt.timedelta(days=1)
    elif re.search(r"\bday after tomorrow\b", s):
        day = now.date() + dt.timedelta(days=2)
    else:
        m = re.search(r"\b(next |this |on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b", s)
        if m:
            wd = next(i for i, n in enumerate(WEEKDAYS) if n.startswith(m[2][:3]))
            ahead = (wd - now.weekday()) % 7
            if ahead == 0 and (m[1] or "").strip() == "next":
                ahead = 7
            elif ahead == 0 and m[1] != "this ":
                ahead = 7 if now.hour >= 20 else 0
            if (m[1] or "").strip() == "next" and ahead < 7 and ahead != 0:
                pass
            day = now.date() + dt.timedelta(days=ahead)
        else:
            m = re.search(r"\b(?:on )?(\d{1,2})(?:st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?: (\d{4}))?\b", s) or re.search(r"\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b", s)
            if m:
                g = m.groups()
                d_, mo = (int(g[0]), MONTHS[g[1]]) if g[0].isdigit() else (int(g[1]), MONTHS[g[0]])
                yr = int(g[2]) if g[2] else now.year
                day = dt.date(yr, mo, d_)
                if not g[2] and day < now.date():
                    day = dt.date(yr + 1, mo, d_)
    hour, minute = None, 0
    m = re.search(r"\b(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\b", s)
    if m:
        hour, minute = int(m[1]), int(m[2])
        if m[3] and m[3].startswith("p") and hour < 12:
            hour += 12
        if m[3] and m[3].startswith("a") and hour == 12:
            hour = 0
    else:
        m = re.search(r"\b(?:at )?(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b", s) or re.search(r"\bat (\d{1,2})\b", s)
        if m:
            hour = int(m[1]); ap = m.group(2) if m.lastindex and m.lastindex >= 2 else None
            if ap and ap.startswith("p") and hour < 12:
                hour += 12
            if ap and ap.startswith("a") and hour == 12:
                hour = 0
            if not ap and hour <= 7:
                hour += 12                                      # "at 3" in speech almost always means afternoon
        elif re.search(r"\bnoon\b", s):
            hour = 12
        elif re.search(r"\bmidnight\b", s):
            hour = 0
        elif re.search(r"\b(evening|tonight)\b", s):
            hour = 19
        elif re.search(r"\bafternoon\b", s):
            hour = 15
        elif re.search(r"\bmorning\b", s):
            hour = 9
    if day is None and hour is None:
        return None
    if day is None:
        day = now.date()
        if dt.datetime.combine(day, dt.time(hour, minute)) <= now:
            day += dt.timedelta(days=1)                        # "at 3pm" after 3pm means tomorrow
    return dt.datetime.combine(day, dt.time(hour if hour is not None else default_hour, minute))


def human(d):
    return d.strftime("%a %d %b %H:%M")


# ----------------------------------------------------------------------------- ICS
def ics_path():
    return os.path.expanduser(load_config()["widgets"]["agenda"].get("ics_path") or "") or os.path.join(os.environ.get("SAMURAI_DATA") or DATA, "samurai.ics")


def ics_escape(s):
    return str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def vevent(ev):
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    lines = ["BEGIN:VEVENT", f"UID:{ev['uid']}", f"DTSTAMP:{stamp}", f"DTSTART:{ev['start'].strftime('%Y%m%dT%H%M%S')}", f"DTEND:{ev['end'].strftime('%Y%m%dT%H%M%S')}", f"SUMMARY:{ics_escape(ev['title'])}"]
    if ev.get("location"):
        lines.append(f"LOCATION:{ics_escape(ev['location'])}")
    if ev.get("notes"):
        lines.append(f"DESCRIPTION:{ics_escape(ev['notes'])}")
    lines.append("END:VEVENT")
    return "\r\n".join(lines)


def ics_append(path, ev):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    body = vevent(ev)
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        open(path, "w", encoding="utf-8", newline="").write("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SAMURAI//EN\r\n" + body + "\r\nEND:VCALENDAR\r\n")
        return
    txt = open(path, encoding="utf-8", errors="ignore").read()
    i = txt.rfind("END:VCALENDAR")
    nl = "\r\n" if "\r\n" in txt else "\n"
    if i < 0:
        txt = txt.rstrip() + nl + body.replace("\r\n", nl) + nl + "END:VCALENDAR" + nl
    else:
        txt = txt[:i].rstrip("\r\n") + nl + body.replace("\r\n", nl) + nl + txt[i:]
    open(path, "w", encoding="utf-8", newline="").write(txt)


def ics_events(path):
    out, cur = [], None
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8", errors="ignore"):
        line = line.rstrip("\r\n")
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT" and cur is not None:
            st = cur.get("DTSTART", "")
            try:
                start = dt.datetime.strptime(st[:15], "%Y%m%dT%H%M%S") if "T" in st else dt.datetime.strptime(st[:8], "%Y%m%d")
                en = cur.get("DTEND", "")
                end = dt.datetime.strptime(en[:15], "%Y%m%dT%H%M%S") if "T" in en else (start + dt.timedelta(hours=1))
                out.append({"uid": cur.get("UID", ""), "title": cur.get("SUMMARY", "").replace("\\,", ","), "start": start.isoformat(timespec="minutes"), "end": end.isoformat(timespec="minutes"),
                            "location": cur.get("LOCATION", "").replace("\\,", ","), "when": human(start), "_t": start})
            except Exception:
                pass
            cur = None
        elif cur is not None and ":" in line:
            k, v = line.split(":", 1)
            cur[k.split(";")[0]] = v
    return out


# ----------------------------------------------------------------------------- CalDAV
def caldav_put(ev):
    c = load_config().get("calendar", {})
    url, user, pw = c.get("caldav_url", "").rstrip("/") + "/", c.get("caldav_user", ""), c.get("caldav_password", "")
    if not c.get("caldav_url"):
        raise ValueError("calendar.caldav_url is empty")
    import base64
    body = ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SAMURAI//EN\r\n" + vevent(ev) + "\r\nEND:VCALENDAR\r\n").encode()
    req = urllib.request.Request(url + ev["uid"] + ".ics", data=body, method="PUT", headers={"Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*", "User-Agent": "SAMURAI/1.0",
                                                                                               "Authorization": "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status


def caldav_list():
    """Upcoming events from the CalDAV collection (REPORT calendar-query)."""
    c = load_config().get("calendar", {})
    url, user, pw = c.get("caldav_url", "").rstrip("/") + "/", c.get("caldav_user", ""), c.get("caldav_password", "")
    import base64
    start = dt.datetime.now().strftime("%Y%m%dT000000Z"); end = (dt.datetime.now() + dt.timedelta(days=30)).strftime("%Y%m%dT000000Z")
    body = f'<?xml version="1.0" encoding="utf-8"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="{start}" end="{end}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>'.encode()
    req = urllib.request.Request(url, data=body, method="REPORT", headers={"Content-Type": "application/xml; charset=utf-8", "Depth": "1", "User-Agent": "SAMURAI/1.0", "Authorization": "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()})
    with urllib.request.urlopen(req, timeout=20) as r:
        xml = r.read().decode("utf-8", "replace")
    import html as _h, tempfile
    out = []
    for m in re.finditer(r"<[^>]*calendar-data[^>]*>(.*?)</[^>]*calendar-data>", xml, re.S):
        f = tempfile.NamedTemporaryFile("w", suffix=".ics", delete=False, encoding="utf-8"); f.write(_h.unescape(m.group(1))); f.close()
        out += ics_events(f.name); os.remove(f.name)
    return out


# ----------------------------------------------------------------------------- routes
def post_calendar_add(h, q, b):
    title = (b.get("title") or "").strip()
    if not title:
        raise ValueError("title required")
    start = parse_when(b.get("start") or "")
    if not start:
        raise ValueError(f"I could not understand the time '{b.get('start')}': try 'tomorrow 3pm', 'next monday at 10' or an ISO date")
    end = parse_when(b.get("end") or "", now=start) if b.get("end") else None
    if not end or end <= start:
        end = start + dt.timedelta(minutes=int(b.get("duration_min") or 60))
    ev = {"uid": f"samurai-{uuid.uuid4().hex[:12]}", "title": title[:120], "start": start, "end": end, "location": (b.get("location") or "")[:120], "notes": (b.get("notes") or "")[:1000]}
    target = (load_config().get("calendar", {}) or {}).get("target", "ics")
    if target == "caldav":
        caldav_put(ev); did = "added to your CalDAV calendar"
    else:
        ics_append(ics_path(), ev); did = f"added to {os.path.basename(ics_path())}"
        try:
            from samurai_addons import _cache
            _cache.pop("agenda", None)                                   # the agenda widget refreshes on its next poll
        except Exception:
            pass
    return {"ok": True, "event": {"uid": ev["uid"], "title": ev["title"], "start": start.isoformat(timespec="minutes"), "end": end.isoformat(timespec="minutes"), "location": ev["location"], "when": human(start)}, "target": target, "did": did}


def get_calendar_next(h, q, b):
    n = max(1, min(50, int(q.get("n", 5) or 5)))
    target = (load_config().get("calendar", {}) or {}).get("target", "ics")
    events = caldav_list() if target == "caldav" else ics_events(ics_path())
    now = dt.datetime.now()
    up = sorted([e for e in events if e["_t"] >= now - dt.timedelta(hours=1)], key=lambda e: e["_t"])[:n]
    for e in up:
        e.pop("_t", None)
    return {"ok": True, "events": up, "source": target, "path": ics_path() if target == "ics" else ""}


def get_calendar_parse(h, q, b):
    d = parse_when(q.get("when", ""))
    return {"ok": bool(d), "iso": d.isoformat(timespec="minutes") if d else None, "human": human(d) if d else None}


# ----------------------------------------------------------------------------- map
_geo = {"cache": {}, "last": 0.0, "lock": threading.Lock()}


def get_map_geocode(h, q, b):
    query = (q.get("q") or "").strip()
    if not query:
        raise ValueError("q required")
    key = query.lower()
    with _geo["lock"]:
        hit = _geo["cache"].get(key)
        if hit and time.time() - hit[0] < 86400:
            return {"ok": True, "results": hit[1], "cached": True}
        wait = 1.1 - (time.time() - _geo["last"])
        if wait > 0:
            time.sleep(wait)                                         # Nominatim usage policy: at most one request per second
        base = os.environ.get("SAMURAI_NOMINATIM") or "https://nominatim.openstreetmap.org"
        try:
            data = http_json(base + "/search?" + urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": 5}), timeout=12,
                             headers={"User-Agent": "SAMURAI-AI/1.4 (local assistant; https://github.com/sxi9/SAMURAI-AI)", "Accept-Language": "en"})
        except Exception as e:
            _geo["last"] = time.time()
            return {"ok": False, "error": f"geocoder unreachable: {str(e)[:80]}", "results": []}
        _geo["last"] = time.time()
        res = [{"lat": float(x["lat"]), "lon": float(x["lon"]), "label": x.get("display_name", "")[:120], "type": x.get("type", "")} for x in data if "lat" in x]
        _geo["cache"][key] = (time.time(), res)
        return {"ok": True, "results": res}


def get_map_here(h, q, b):
    loc = load_config().get("location", {})
    out = {"ok": True, "lat": float(loc.get("lat") or 0), "lon": float(loc.get("lon") or 0), "label": loc.get("label", ""), "source": "config", "phone": None}
    try:
        import samurai_findmy
        pos = getattr(samurai_findmy, "LAST_POS", None)
        if isinstance(pos, dict) and pos.get("lat") is not None:
            out["phone"] = {"lat": float(pos["lat"]), "lon": float(pos["lon"]), "t": pos.get("t", 0), "device": pos.get("device", "")}
    except Exception:
        pass
    return out


ROUTES = {("POST", "/calendar/add"): post_calendar_add, ("GET", "/calendar/next"): get_calendar_next, ("GET", "/calendar/parse"): get_calendar_parse,
          ("GET", "/map/geocode"): get_map_geocode, ("GET", "/map/here"): get_map_here}
