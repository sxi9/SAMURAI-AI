"""SAMURAI automation — scheduler, routines, proactive watch, event queue, document search, mail.
Mounted by samurai_addons.py (routes under :9500). State lives in data/*.json.

Schedules   {"id", "name", "when": {"type": "daily", "time": "08:00"} | {"type": "weekly", "days": [0..6], "time": "08:00"}
                          | {"type": "interval", "minutes": 30} | {"type": "once", "at": "2026-11-12T17:00"},
             "say": "spoken text" | "command": "HUD command text", "enabled": true, "last": epoch}
Events      queue the HUD polls (GET /events?since=): {"t", "kind": "say"|"command"|"alert", "text", "source"}
Routines    {"name": ["command", "command", ...]}
"""
import json, os, re, smtplib, threading, time, urllib.request
from email.message import EmailMessage

from samurai_common import DATA, ROOT, load_config, http_json

SCHED_PATH = os.path.join(DATA, "schedules.json")
ROUTINES_PATH = os.path.join(DATA, "routines.json")
EVENTS_PATH = os.path.join(DATA, "events.json")
DOCS_INDEX = os.path.join(DATA, "docs_index.json")
LOCK = threading.RLock()
DEFAULT_ROUTINES = {
    "focus mode": ["ambient", "timer 25 min", "play some focus music"],
    "good night": ["lights off", "lock the door", "ambient", "mute"],
    "good morning": ["full layout", "morning briefing", "lights on"],
}


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


# ----------------------------------------------------------------------------- events
def push_event(kind, text, source="system"):
    with LOCK:
        ev = _load(EVENTS_PATH, [])
        ev.append({"t": time.time(), "kind": kind, "text": text[:400], "source": source})
        _save(EVENTS_PATH, ev[-200:])


def get_events(h, q, b):
    since = float(q.get("since", 0) or 0)
    ev = [e for e in _load(EVENTS_PATH, []) if e["t"] > since]
    return {"ok": True, "events": ev, "now": time.time()}


# ----------------------------------------------------------------------------- schedules
WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
           "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "sixty": 60}
DAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}


def parse_clock(text):
    """'8', '8 am', '5:30 pm', '17:00', 'noon' -> 'HH:MM' or None"""
    t = text.strip().lower()
    if t in ("noon", "midday"):
        return "12:00"
    if t == "midnight":
        return "00:00"
    m = re.match(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$", t)
    if not m:
        w = WORDNUM.get(t.split()[0]) if t.split() else None
        if w is None:
            return None
        m = re.match(r"(\w+)\s*(am|pm)?$", t)
        h, mi, ap = w, 0, (m.group(2) if m else None)
    else:
        h, mi, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ap and ap.startswith("p") and h < 12:
        h += 12
    if ap and ap.startswith("a") and h == 12:
        h = 0
    if not (0 <= h < 24 and 0 <= mi < 60):
        return None
    return f"{h:02d}:{mi:02d}"


def parse_schedule(text):
    """Natural language -> schedule dict, or None.
    every day at 8 am say good morning · every weekday at 9 run morning briefing · every 30 minutes check my system
    remind me at 5 pm to call mom · at 22:00 say time to wind down · every monday at 10 say standup"""
    t = text.strip().lower().rstrip(".")
    m = re.match(r"every\s+(\d+|\w+)\s*(minutes?|mins?|hours?|hrs?)\s+(?:to\s+|say\s+|run\s+)?(.+)$", t)
    if m:
        n = WORDNUM.get(m.group(1), None) if not m.group(1).isdigit() else int(m.group(1))
        if n:
            mins = n * (60 if m.group(2).startswith("h") else 1)
            kind = "say" if "say " in t.split(m.group(2), 1)[1][:8] else "command"
            return {"when": {"type": "interval", "minutes": max(1, mins)}, kind: m.group(3), "name": f"every {n} {m.group(2)}: {m.group(3)[:30]}"}
    m = re.match(r"every\s+(day|morning|evening|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:at\s+([\w:. ]+?))?\s+(say|run|tell me|remind me to|do)\s+(.+)$", t)
    if m:
        day, clock, verb, what = m.group(1), m.group(2), m.group(3), m.group(4)
        hhmm = parse_clock(clock) if clock else ("08:00" if day == "morning" else "20:00" if day == "evening" else None)
        if not hhmm:
            return None
        when = {"type": "daily", "time": hhmm}
        if day == "weekday":
            when = {"type": "weekly", "days": [0, 1, 2, 3, 4], "time": hhmm}
        elif day == "weekend":
            when = {"type": "weekly", "days": [5, 6], "time": hhmm}
        elif day in DAYS:
            when = {"type": "weekly", "days": [DAYS[day]], "time": hhmm}
        kind = "say" if verb in ("say", "tell me", "remind me to") else "command"
        text_out = what if verb != "remind me to" else "reminder: " + what
        return {"when": when, kind: text_out, "name": f"{day} {hhmm}: {what[:30]}"}
    CLOCK = r"(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midnight|midday|[a-z]+\s*(?:am|pm)?)"
    m = re.match(r"(?:remind me|reminder)\s+(?:at|on)\s+" + CLOCK + r"\s+(?:to\s+)?(.+)$", t) or re.match(r"at\s+" + CLOCK + r"\s+(?:say|remind me to|run)\s+(.+)$", t)
    if m:
        hhmm = parse_clock(m.group(1))
        if not hhmm:
            return None
        now = time.localtime()
        at = time.mktime(time.strptime(f"{now.tm_year}-{now.tm_mon}-{now.tm_mday} {hhmm}", "%Y-%m-%d %H:%M"))
        if at < time.time():
            at += 86400
        kind = "command" if " run " in " " + t else "say"
        return {"when": {"type": "once", "at": at}, kind: ("reminder: " + m.group(2)) if kind == "say" else m.group(2), "name": f"once {hhmm}: {m.group(2)[:30]}"}
    m = re.match(r"in\s+(\d+|\w+)\s*(minutes?|mins?|hours?|hrs?)\s+(?:remind me to\s+|say\s+|run\s+)?(.+)$", t)
    if m:
        n = int(m.group(1)) if m.group(1).isdigit() else WORDNUM.get(m.group(1))
        if n:
            at = time.time() + n * (3600 if m.group(2).startswith("h") else 60)
            return {"when": {"type": "once", "at": at}, "say": "reminder: " + m.group(3), "name": f"in {n} {m.group(2)}: {m.group(3)[:30]}"}
    return None


def _due(s, now):
    w, last = s.get("when", {}), s.get("last", 0)
    lt = time.localtime(now)
    if w.get("type") == "interval":
        return now - last >= w.get("minutes", 60) * 60
    if w.get("type") == "once":
        return now >= float(w.get("at", 0)) and not last
    if w.get("type") in ("daily", "weekly"):
        hh, mm = map(int, w.get("time", "08:00").split(":"))
        if w["type"] == "weekly" and lt.tm_wday not in w.get("days", []):
            return False
        today_at = time.mktime(time.strptime(f"{lt.tm_year}-{lt.tm_mon}-{lt.tm_mday} {hh:02d}:{mm:02d}", "%Y-%m-%d %H:%M"))
        return today_at <= now < today_at + 120 and last < today_at
    return False


def scheduler_loop():
    while True:
        try:
            now = time.time()
            with LOCK:
                sch = _load(SCHED_PATH, [])
                changed = False
                for s in sch:
                    if s.get("enabled", True) and _due(s, now):
                        s["last"] = now
                        changed = True
                        if s.get("say"):
                            push_event("say", s["say"], "schedule:" + s.get("name", ""))
                        if s.get("command"):
                            push_event("command", s["command"], "schedule:" + s.get("name", ""))
                        print(f"[SAMURAI-AUTO] fired: {s.get('name')}")
                if changed:
                    sch = [s for s in sch if not (s.get("when", {}).get("type") == "once" and s.get("last"))]
                    _save(SCHED_PATH, sch)
        except Exception as e:
            print(f"[SAMURAI-AUTO] scheduler error: {e}")
        time.sleep(20)


def get_schedules(h, q, b):
    return {"ok": True, "schedules": _load(SCHED_PATH, [])}


def post_schedules(h, q, b):
    with LOCK:
        sch = _load(SCHED_PATH, [])
        act = b.get("action")
        if act == "add":
            s = b.get("schedule") or parse_schedule(b.get("text", ""))
            if not s:
                raise ValueError("could not understand that schedule — try 'every day at 8 am say good morning'")
            s.setdefault("id", int(time.time() * 1000)); s.setdefault("enabled", True); s.setdefault("last", 0)
            sch.append(s)
        elif act == "remove":
            sch = [s for s in sch if s.get("id") != b.get("id")]
        elif act == "toggle":
            for s in sch:
                if s.get("id") == b.get("id"):
                    s["enabled"] = not s.get("enabled", True)
        elif act == "clear":
            sch = []
        else:
            raise ValueError("action must be add|remove|toggle|clear")
        _save(SCHED_PATH, sch)
    return {"ok": True, "schedules": sch, "added": s if act == "add" else None}


# ----------------------------------------------------------------------------- routines
def get_routines(h, q, b):
    r = _load(ROUTINES_PATH, None)
    if r is None:
        r = dict(DEFAULT_ROUTINES); _save(ROUTINES_PATH, r)
    return {"ok": True, "routines": r}


def post_routines(h, q, b):
    with LOCK:
        r = _load(ROUTINES_PATH, dict(DEFAULT_ROUTINES))
        name = (b.get("name") or "").strip().lower()
        if b.get("action") == "set" and name and isinstance(b.get("commands"), list):
            r[name] = [str(c)[:120] for c in b["commands"]][:12]
        elif b.get("action") == "remove" and name:
            r.pop(name, None)
        else:
            raise ValueError("action must be set|remove with name (+ commands)")
        _save(ROUTINES_PATH, r)
    return {"ok": True, "routines": r}


# ----------------------------------------------------------------------------- proactive watch
_watch_state = {"warned": {}}


def _warn(key, text, every=1800):
    last = _watch_state["warned"].get(key, 0)
    if time.time() - last > every:
        _watch_state["warned"][key] = time.time()
        push_event("alert", text, "watch")


def watch_loop(get_agenda):
    time.sleep(30)
    while True:
        try:
            s = http_json("http://localhost:8765/stats", timeout=4)
            if s.get("temp") and s["temp"] >= 85:
                _warn("temp", f"CPU temperature is {s['temp']} degrees. Check the cooling.")
            for d in s.get("disk", []):
                if d.get("pct", 0) >= 95 and d.get("total_gb", 0) >= 20:
                    _warn("disk" + d["drive"], f"Drive {d['drive']} is {int(d['pct'])} percent full.", 7200)
            b = s.get("battery")
            if b and not b.get("plugged") and b.get("pct", 100) <= 15:
                _warn("battery", f"Battery at {int(b['pct'])} percent. Plug in soon.", 900)
            if s.get("mem", 0) >= 95:
                _warn("mem", "Memory is almost full. Something is eating RAM.", 1800)
        except Exception:
            pass
        try:
            now = time.localtime()
            for e in get_agenda():
                if e.get("past") or not e.get("time"):
                    continue
                hh, mm = map(int, e["time"].split(":"))
                mins = (hh * 60 + mm) - (now.tm_hour * 60 + now.tm_min)
                if 0 < mins <= 5:
                    _warn("ev" + e["time"] + e.get("title", ""), f"{e.get('title', 'Your event')} starts in {mins} minute{'s' if mins > 1 else ''}.", 3600)
        except Exception:
            pass
        time.sleep(60)


# ----------------------------------------------------------------------------- document search
TEXT_EXT = (".txt", ".md", ".rst", ".py", ".js", ".ts", ".json", ".csv", ".html", ".htm", ".log", ".yaml", ".yml", ".ini", ".cfg")
_idx = {"built": 0, "docs": []}


def _read_text(path):
    low = path.lower()
    if low.endswith(".pdf"):
        try:
            from pypdf import PdfReader
            return "\n".join((p.extract_text() or "") for p in PdfReader(path).pages[:60])
        except Exception:
            return ""
    if low.endswith(".docx"):
        try:
            import zipfile
            with zipfile.ZipFile(path) as z:
                xml = z.read("word/document.xml").decode("utf-8", "ignore")
            return re.sub(r"<[^>]+>", " ", xml)
        except Exception:
            return ""
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            return f.read(400_000)
    except OSError:
        return ""


def docs_dir():
    d = load_config().get("widgets", {}).get("documents", {}).get("dir", "")
    return os.path.expanduser(d) if d else ""


def build_index(force=False):
    d = docs_dir()
    if not d or not os.path.isdir(d):
        _idx.update(built=time.time(), docs=[])
        return 0
    if not force and time.time() - _idx["built"] < 600 and _idx["docs"]:
        return len(_idx["docs"])
    docs = []
    for root, _, files in os.walk(d):
        for f in files:
            if f.lower().endswith(TEXT_EXT + (".pdf", ".docx")):
                p = os.path.join(root, f)
                try:
                    if os.path.getsize(p) > 20_000_000:
                        continue
                except OSError:
                    continue
                text = _read_text(p)
                if text.strip():
                    docs.append({"path": p, "name": os.path.relpath(p, d), "text": text, "words": len(text.split())})
                if len(docs) >= 3000:
                    break
    _idx.update(built=time.time(), docs=docs)
    return len(docs)


def search_docs(query, k=5):
    build_index()
    terms = [t for t in re.findall(r"[a-z0-9]{2,}", query.lower()) if t not in ("the", "and", "for", "with", "what", "about", "does", "did", "say", "my", "in", "of", "to", "is")]
    if not terms:
        return []
    import math
    N = max(1, len(_idx["docs"]))
    df = {t: sum(1 for d in _idx["docs"] if t in d["text"].lower()) for t in terms}
    hits = []
    for d in _idx["docs"]:
        low = d["text"].lower()
        score, first = 0.0, None
        for t in terms:
            c = low.count(t)
            if c:
                score += (1 + math.log(c)) * math.log(1 + N / (1 + df[t]))
                if first is None:
                    first = low.find(t)
        if score > 0:
            a = max(0, (first or 0) - 160)
            hits.append({"name": d["name"], "path": d["path"], "score": round(score, 2), "snippet": re.sub(r"\s+", " ", d["text"][a:a + 420]).strip()})
    hits.sort(key=lambda x: -x["score"])
    return hits[:k]


def get_docs_search(h, q, b):
    return {"ok": True, "query": q.get("q", ""), "hits": search_docs(q.get("q", ""), int(q.get("k", 5))), "indexed": len(_idx["docs"]), "dir": docs_dir()}


def post_docs_reindex(h, q, b):
    return {"ok": True, "indexed": build_index(force=True), "dir": docs_dir()}


# ----------------------------------------------------------------------------- mail
def post_mail_send(h, q, b):
    cfg = load_config().get("widgets", {}).get("inbox", {})
    host, user, pw = cfg.get("smtp_host") or cfg.get("imap_host", "").replace("imap.", "smtp."), cfg.get("imap_user"), cfg.get("imap_password")
    if not (host and user and pw):
        raise ValueError("set inbox imap_user, imap_password and smtp_host in config.json first")
    if not b.get("confirm"):
        return {"ok": False, "needs_confirm": True, "error": "sending mail needs confirm:true"}
    to, subject, body = (b.get("to") or "").strip(), (b.get("subject") or "(no subject)").strip(), (b.get("body") or "").strip()
    if "@" not in to or not body:
        raise ValueError("to and body required")
    msg = EmailMessage(); msg["From"] = user; msg["To"] = to; msg["Subject"] = subject[:200]; msg.set_content(body[:20000])
    with smtplib.SMTP_SSL(host, int(cfg.get("smtp_port") or 465), timeout=20) as s:
        s.login(user, pw); s.send_message(msg)
    return {"ok": True, "did": f"Mail sent to {to}"}


ROUTES = {
    ("GET", "/events"): get_events,
    ("GET", "/schedules"): get_schedules, ("POST", "/schedules"): post_schedules,
    ("GET", "/routines"): get_routines, ("POST", "/routines"): post_routines,
    ("GET", "/docs/search"): get_docs_search, ("POST", "/docs/reindex"): post_docs_reindex,
    ("POST", "/mail/send"): post_mail_send,
}


def start_threads(get_agenda):
    threading.Thread(target=scheduler_loop, daemon=True).start()
    threading.Thread(target=watch_loop, args=(get_agenda,), daemon=True).start()
