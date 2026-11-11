"""SAMURAI connect — the outside world: phone push, other machines, radios, files, journal, radio and podcasts,
read-aloud, Telegram, webhooks, Steam games, cleanup, focus sessions.
Mounted by samurai_addons.py (routes under :9500). Config lives under "connect" in config.json; credentials stay empty by default.

POST /push          {title?, body}                       -> {ok, sent: ["ntfy", "pushover"]}        ntfy topic and/or Pushover
POST /wol           {mac} | {name}                        -> {ok, mac, host}                          magic packet (machines from config)
POST /ssh           {name, command}                       -> {ok, code, out, err}                    system ssh, BatchMode, 20 s timeout
GET  /radio                                               -> {ok, wifi, bluetooth, vpn}              "on" | "off" | "unknown"
POST /radio         {kind: wifi|bluetooth|vpn, on: bool}  -> {ok, kind, on, did}
GET  /files?q=&n=   fuzzy name search over connect.search_dirs  -> {ok, results: [{path, name, size, mtime}], indexed, built}
GET  /files/recent?days=1&n=                              -> {ok, results: [...]}                    most recently modified first
GET  /journal?q=&n=                                       -> {ok, entries: [{t, text}]}              newest first
POST /journal       {text}                                -> {ok, entry}
GET  /journal/today                                       -> {ok, entries, text}
GET  /radio_stations                                      -> {ok, stations: [{name, url, genre}]}
GET  /podcasts                                            -> {ok, episodes: [{show, title, url, date}]}  latest 10 across connect.podcasts
GET  /read?path=                                          -> {ok, path, text, chars}                 txt / md / pdf / docx, 20k chars
POST /telegram      {text, chat?}                         -> {ok, chat}
POST /webhook       {target: discord|slack, text}         -> {ok, target}
GET  /games                                               -> {ok, games: [{appid, name, library}], steam}
POST /games         {appid} | {name}                      -> {ok, appid, name}
GET  /cleanup                                             -> {ok, total, items: [{path, bytes, files}]}  reclaimable
POST /cleanup       {confirm: true}                       -> {ok, freed, removed}                    temp files older than one day only
POST /focus         {minutes, break}                      -> {ok, focus}
GET  /focus                                               -> {ok, focus: {active, phase, ends, left, minutes, break}}
GET  /connect/status                                      -> {ok, push, machines, telegram, webhooks, steam, search_dirs, stations, podcasts}

Events pushed for the HUD (kind "say"): source "remote_message" for Telegram, "focus_end" / "break_end" for sessions.
"""
import glob, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from samurai_common import DATA, IS_WIN, IS_MAC, load_config
from samurai_automation import push_event, _read_text

JOURNAL_PATH = os.path.join(DATA, "journal.jsonl")
LOCK = threading.RLock()
UA = {"User-Agent": "SAMURAI/1.0"}
DEFAULT_STATIONS = [
    {"name": "SomaFM Groove Salad", "url": "https://ice1.somafm.com/groovesalad-128-mp3", "genre": "ambient"},
    {"name": "SomaFM Drone Zone", "url": "https://ice1.somafm.com/dronezone-128-mp3", "genre": "ambient"},
    {"name": "SomaFM DEF CON Radio", "url": "https://ice1.somafm.com/defcon-128-mp3", "genre": "electronic"},
    {"name": "SomaFM Lush", "url": "https://ice1.somafm.com/lush-128-mp3", "genre": "vocal"},
    {"name": "SomaFM Secret Agent", "url": "https://ice1.somafm.com/secretagent-128-mp3", "genre": "lounge"},
    {"name": "Radio Paradise Main", "url": "https://stream.radioparadise.com/mp3-128", "genre": "eclectic"},
]


def ccfg():
    return load_config().get("connect", {})


def _run(cmd, timeout=10):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, "", str(e)


def _post(url, data=None, headers=None, timeout=10):
    body = json.dumps(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, headers={**UA, **(headers or {})}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


# ----------------------------------------------------------------------------- push to phone
def post_push(h, q, b):
    c = ccfg(); title = (b.get("title") or "SAMURAI")[:120]; body = (b.get("body") or b.get("text") or "").strip()
    if not body:
        raise ValueError("body required")
    sent = []
    if c.get("ntfy_topic"):
        server = (c.get("ntfy_server") or "https://ntfy.sh").rstrip("/")
        _post(f"{server}/{urllib.parse.quote(c['ntfy_topic'])}", body.encode("utf-8"), {"Title": title, "Content-Type": "text/plain; charset=utf-8"})
        sent.append("ntfy")
    if c.get("pushover_user") and c.get("pushover_token"):
        data = urllib.parse.urlencode({"token": c["pushover_token"], "user": c["pushover_user"], "title": title, "message": body}).encode()
        _post("https://api.pushover.net/1/messages.json", data, {"Content-Type": "application/x-www-form-urlencoded"})
        sent.append("pushover")
    if not sent:
        raise ValueError("no push service configured (connect.ntfy_topic or connect.pushover_user/token)")
    return {"ok": True, "sent": sent}


# ----------------------------------------------------------------------------- machines: wake-on-LAN, ssh
def _machine(name):
    name = (name or "").strip().lower()
    for m in ccfg().get("machines", []):
        if m.get("name", "").lower() == name or m.get("host", "").lower() == name:
            return m
    return None


def post_wol(h, q, b):
    mac = (b.get("mac") or "").strip(); host = (b.get("host") or "").strip()
    if not mac and b.get("name"):
        m = _machine(b["name"])
        if not m:
            raise ValueError(f"machine '{b['name']}' is not in connect.machines")
        mac, host = m.get("mac", ""), m.get("host", host)
    hexmac = re.sub(r"[^0-9a-fA-F]", "", mac)
    if len(hexmac) != 12:
        raise ValueError("mac address must be 12 hex digits, e.g. AA:BB:CC:DD:EE:FF")
    packet = b"\xff" * 6 + bytes.fromhex(hexmac) * 16
    targets = [("255.255.255.255", 9)] + ([(host, 9)] if host and not host.startswith(("127.", "localhost")) else [])
    if host.startswith(("127.", "localhost")):
        targets = [("127.0.0.1", 9)]
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        for t in targets:
            for _ in range(3):
                s.sendto(packet, t)
    finally:
        s.close()
    return {"ok": True, "mac": ":".join(hexmac[i:i + 2].upper() for i in range(0, 12, 2)), "host": host}


def post_ssh(h, q, b):
    m = _machine(b.get("name"))
    if not m or not m.get("host"):
        raise ValueError("machine not found (connect.machines needs name, host, ssh_user)")
    command = (b.get("command") or "").strip()
    if not command:
        raise ValueError("command required")
    if not shutil.which("ssh"):
        raise ValueError("ssh client not installed")
    target = f"{m.get('ssh_user') or os.environ.get('USER', 'root')}@{m['host']}"
    code, out, err = _run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new", target, command], timeout=20)
    return {"ok": code == 0, "code": code, "out": out[-4000:], "err": err[-1000:]}


# ----------------------------------------------------------------------------- radios: wifi, bluetooth, vpn
def _vpn_name():
    return ccfg().get("vpn_name", "")


def radio_state():
    st = {"wifi": "unknown", "bluetooth": "unknown", "vpn": "unknown"}
    if IS_WIN:
        code, out, _ = _run(["netsh", "interface", "show", "interface"])
        if code == 0:
            for line in out.splitlines():
                if "wi-fi" in line.lower() or "wireless" in line.lower():
                    st["wifi"] = "on" if "Enabled" in line else "off"
        code, out, _ = _run(["rasdial"])
        if code == 0:
            st["vpn"] = "off" if "No connections" in out else ("on" if "Connected to" in out else "unknown")
    elif IS_MAC:
        code, out, _ = _run(["networksetup", "-getairportpower", "en0"])
        if code == 0:
            st["wifi"] = "on" if out.strip().endswith("On") else "off"
        if shutil.which("blueutil"):
            code, out, _ = _run(["blueutil", "-p"]); st["bluetooth"] = "on" if out.strip() == "1" else "off"
    else:
        if shutil.which("nmcli"):
            code, out, _ = _run(["nmcli", "radio", "wifi"])
            if code == 0:
                st["wifi"] = "on" if "enabled" in out else "off"
            code, out, _ = _run(["nmcli", "-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"])
            if code == 0:
                st["vpn"] = "on" if any(":vpn:" in l or ":wireguard:" in l for l in out.splitlines()) else "off"
        if shutil.which("bluetoothctl"):
            code, out, _ = _run(["bluetoothctl", "show"])
            if code == 0 and "Powered:" in out:
                st["bluetooth"] = "on" if "Powered: yes" in out else "off"
    return st


def get_radio(h, q, b):
    return {"ok": True, **radio_state()}


BT_PS = ("[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null; "
         "$a=[Windows.Devices.Radios.Radio]::GetRadiosAsync(); $a.AsTask().Wait(); "
         "$r=$a.GetResults() | ? {{ $_.Kind -eq 'Bluetooth' }}; if ($r) {{ $r.SetStateAsync('{state}').AsTask().Wait(); 'ok' }} else {{ 'no bluetooth radio' }}")


def post_radio(h, q, b):
    kind = (b.get("kind") or "").lower(); on = bool(b.get("on"))
    if kind not in ("wifi", "bluetooth", "vpn"):
        raise ValueError("kind must be wifi, bluetooth or vpn")
    if IS_WIN:
        if kind == "wifi":
            code, out, err = _run(["netsh", "interface", "set", "interface", "Wi-Fi", f"admin={'enable' if on else 'disable'}"])
        elif kind == "bluetooth":
            code, out, err = _run(["powershell", "-NoProfile", "-Command", BT_PS.format(state="On" if on else "Off")], timeout=25)
        else:
            name = _vpn_name()
            if not name:
                raise ValueError("set connect.vpn_name to the VPN connection name")
            code, out, err = _run(["rasdial", name] if on else ["rasdial", name, "/disconnect"], timeout=30)
    elif IS_MAC:
        if kind == "wifi":
            code, out, err = _run(["networksetup", "-setairportpower", "en0", "on" if on else "off"])
        elif kind == "bluetooth":
            if not shutil.which("blueutil"):
                raise ValueError("brew install blueutil for Bluetooth control")
            code, out, err = _run(["blueutil", "-p", "1" if on else "0"])
        else:
            name = _vpn_name()
            if not name:
                raise ValueError("set connect.vpn_name to the VPN service name")
            code, out, err = _run(["networksetup", "-connectpppoeservice" if on else "-disconnectpppoeservice", name])
    else:
        if kind == "wifi":
            if not shutil.which("nmcli"):
                raise ValueError("nmcli not found (NetworkManager)")
            code, out, err = _run(["nmcli", "radio", "wifi", "on" if on else "off"])
        elif kind == "bluetooth":
            if not shutil.which("bluetoothctl"):
                raise ValueError("bluetoothctl not found (bluez)")
            code, out, err = _run(["bluetoothctl", "power", "on" if on else "off"])
        else:
            if not shutil.which("nmcli"):
                raise ValueError("nmcli not found (NetworkManager)")
            name = _vpn_name()
            if not name:
                c2, o2, _ = _run(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"])
                name = next((l.split(":")[0] for l in o2.splitlines() if l.endswith((":vpn", ":wireguard"))), "")
            if not name:
                raise ValueError("no VPN connection found; set connect.vpn_name")
            code, out, err = _run(["nmcli", "connection", "up" if on else "down", name], timeout=30)
    if code != 0:
        raise ValueError((err or out or f"{kind} control failed")[:300])
    return {"ok": True, "kind": kind, "on": on, "did": (out or "done")[:200]}


# ----------------------------------------------------------------------------- file search
_files = {"entries": [], "built": 0, "building": False}
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", ".cache", "AppData", "Library", ".npm", ".local", "site-packages"}
MAX_ENTRIES = 200_000


def search_dirs():
    dirs = [os.path.expanduser(d) for d in ccfg().get("search_dirs", []) if d]
    return [d for d in dirs if os.path.isdir(d)] or [os.path.expanduser("~")]


def build_file_index():
    if _files["building"]:
        return
    _files["building"] = True
    entries = []
    try:
        for root in search_dirs():
            for dp, dns, fns in os.walk(root):
                dns[:] = [d for d in dns if d not in SKIP_DIRS and not d.startswith(".")]
                for fn in fns:
                    if fn.startswith("."):
                        continue
                    p = os.path.join(dp, fn)
                    try:
                        st = os.stat(p)
                    except OSError:
                        continue
                    entries.append((fn.lower(), p, st.st_size, st.st_mtime))
                    if len(entries) >= MAX_ENTRIES:
                        raise StopIteration
    except StopIteration:
        pass
    finally:
        with LOCK:
            _files["entries"] = entries; _files["built"] = time.time(); _files["building"] = False


def file_index_loop():
    while True:
        try:
            build_file_index()
        except Exception as e:
            print(f"[SAMURAI-CONNECT] file index: {e}")
        time.sleep(600)


def _ensure_index():
    if not _files["built"] and not _files["building"]:
        build_file_index()
    while _files["building"] and not _files["built"]:
        time.sleep(0.1)


def _score(name, terms):
    s = 0
    for t in terms:
        if t == name or name.startswith(t + "."):
            s += 10
        elif name.startswith(t):
            s += 5
        elif t in name:
            s += 3
        elif all(ch in name for ch in t) and _subseq(t, name):
            s += 1
        else:
            return 0
    return s


def _subseq(t, name):
    i = 0
    for ch in name:
        if i < len(t) and ch == t[i]:
            i += 1
    return i == len(t)


def _entry(e):
    return {"path": e[1], "name": os.path.basename(e[1]), "size": e[2], "mtime": e[3]}


def get_files(h, q, b):
    terms = [t for t in (q.get("q") or "").lower().split() if t]
    if not terms:
        raise ValueError("q required")
    n = min(int(q.get("n", 20) or 20), 100)
    _ensure_index()
    with LOCK:
        hits = [(sc, e) for e in _files["entries"] if (sc := _score(e[0], terms))]
    hits.sort(key=lambda x: (-x[0], -x[1][3]))
    return {"ok": True, "results": [_entry(e) for _, e in hits[:n]], "indexed": len(_files["entries"]), "built": _files["built"]}


def get_files_recent(h, q, b):
    days = float(q.get("days", 1) or 1); n = min(int(q.get("n", 20) or 20), 100); since = time.time() - days * 86400
    _ensure_index()
    with LOCK:
        hits = sorted((e for e in _files["entries"] if e[3] >= since), key=lambda e: -e[3])[:n]
    return {"ok": True, "results": [_entry(e) for e in hits], "indexed": len(_files["entries"])}


# ----------------------------------------------------------------------------- journal
def _journal_all():
    out = []
    try:
        with open(JOURNAL_PATH, encoding="utf-8") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out


def post_journal(h, q, b):
    text = (b.get("text") or "").strip()
    if not text:
        raise ValueError("text required")
    entry = {"t": time.time(), "date": time.strftime("%Y-%m-%d %H:%M"), "text": text[:4000]}
    with LOCK:
        os.makedirs(DATA, exist_ok=True)
        with open(JOURNAL_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    return {"ok": True, "entry": entry}


def get_journal(h, q, b):
    n = min(int(q.get("n", 20) or 20), 200); query = (q.get("q") or "").lower().split()
    entries = _journal_all()
    if query:
        entries = [e for e in entries if all(t in e["text"].lower() for t in query)]
    return {"ok": True, "entries": list(reversed(entries))[:n], "total": len(entries)}


def get_journal_today(h, q, b):
    today = time.strftime("%Y-%m-%d")
    entries = [e for e in _journal_all() if e.get("date", "").startswith(today)]
    return {"ok": True, "entries": entries, "text": "\n".join(f"{e['date'][11:]} {e['text']}" for e in entries)}


# ----------------------------------------------------------------------------- radio stations, podcasts
def get_radio_stations(h, q, b):
    st = [s for s in ccfg().get("stations", []) if s.get("url")] or DEFAULT_STATIONS
    return {"ok": True, "stations": st}


def _podcast_feed(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=10) as r:
        root = ET.fromstring(r.read())
    ch = root.find("channel")
    if ch is None:
        return []
    show = (ch.findtext("title") or url).strip()
    eps = []
    for item in ch.findall("item")[:20]:
        enc = item.find("enclosure")
        if enc is None or not enc.get("url"):
            continue
        try:
            ts = parsedate_to_datetime(item.findtext("pubDate") or "").timestamp()
        except (TypeError, ValueError):
            ts = 0
        eps.append({"show": show, "title": (item.findtext("title") or "").strip()[:200], "url": enc.get("url"), "date": ts})
    return eps


def get_podcasts(h, q, b):
    eps, errors = [], []
    for url in ccfg().get("podcasts", []):
        try:
            eps += _podcast_feed(url)
        except Exception as e:
            errors.append(f"{url}: {str(e)[:80]}")
    eps.sort(key=lambda e: -e["date"])
    return {"ok": True, "episodes": eps[:10], "feeds": len(ccfg().get("podcasts", [])), "errors": errors}


# ----------------------------------------------------------------------------- read aloud
def get_read(h, q, b):
    p = os.path.abspath(os.path.expanduser(q.get("path", "")))
    if not p or not os.path.isfile(p):
        raise ValueError("file not found")
    if not p.lower().endswith((".txt", ".md", ".rst", ".pdf", ".docx", ".log", ".csv", ".html", ".htm")):
        raise ValueError("txt, md, pdf, docx, log, csv or html only")
    text = _read_text(p)
    if p.lower().endswith((".html", ".htm")):
        text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text).strip()
    return {"ok": True, "path": p, "text": text[:20_000], "chars": len(text)}


# ----------------------------------------------------------------------------- telegram
_tg = {"offset": 0}


def _tg_api(method, data=None):
    token = ccfg().get("telegram_token", "")
    if not token:
        raise ValueError("connect.telegram_token not set")
    return json.loads(_post(f"https://api.telegram.org/bot{token}/{method}", data or {}, {"Content-Type": "application/json"}, timeout=40))


def post_telegram(h, q, b):
    text = (b.get("text") or "").strip()
    if not text:
        raise ValueError("text required")
    chat = b.get("chat") or (ccfg().get("telegram_chats") or [None])[0]
    if not chat:
        raise ValueError("no chat id (connect.telegram_chats)")
    _tg_api("sendMessage", {"chat_id": chat, "text": text[:4000]})
    return {"ok": True, "chat": chat}


def telegram_loop():
    while True:
        c = ccfg()
        if not c.get("telegram_token"):
            time.sleep(30); continue
        try:
            res = _tg_api("getUpdates", {"offset": _tg["offset"], "timeout": 30})
            allowed = {str(x) for x in c.get("telegram_chats", [])}
            for u in res.get("result", []):
                _tg["offset"] = u["update_id"] + 1
                msg = u.get("message") or {}
                chat = str((msg.get("chat") or {}).get("id", ""))
                text = (msg.get("text") or "").strip()
                if not text or (allowed and chat not in allowed):
                    continue
                push_event("say", text, source=f"remote_message:telegram:{chat}")
        except Exception as e:
            print(f"[SAMURAI-CONNECT] telegram: {str(e)[:120]}")
            time.sleep(15)


# ----------------------------------------------------------------------------- webhooks
def post_webhook(h, q, b):
    c = ccfg(); target = (b.get("target") or "").lower(); text = (b.get("text") or "").strip()
    if not text:
        raise ValueError("text required")
    if not target:
        target = "discord" if c.get("discord_webhook") else "slack"
    url = c.get(f"{target}_webhook", "")
    if target not in ("discord", "slack") or not url:
        raise ValueError(f"connect.{target}_webhook not set")
    _post(url, {"content": text[:2000]} if target == "discord" else {"text": text[:4000]}, {"Content-Type": "application/json"})
    return {"ok": True, "target": target}


# ----------------------------------------------------------------------------- steam games
def steam_dirs():
    d = ccfg().get("steam_dir", "")
    cands = [os.path.expanduser(d)] if d else []
    if IS_WIN:
        cands += [os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Steam"), r"C:\Program Files\Steam"]
    elif IS_MAC:
        cands += [os.path.expanduser("~/Library/Application Support/Steam")]
    else:
        cands += [os.path.expanduser(p) for p in ("~/.steam/steam", "~/.local/share/Steam", "~/.var/app/com.valvesoftware.Steam/.local/share/Steam")]
    return [c for c in cands if os.path.isdir(os.path.join(c, "steamapps"))]


def list_games():
    games, seen = [], set()
    for sd in steam_dirs():
        libs = [sd]
        try:
            with open(os.path.join(sd, "steamapps", "libraryfolders.vdf"), encoding="utf-8", errors="ignore") as f:
                libs += [p.replace("\\\\", "\\") for p in re.findall(r'"path"\s+"([^"]+)"', f.read())]
        except OSError:
            pass
        for lib in libs:
            for acf in glob.glob(os.path.join(lib, "steamapps", "appmanifest_*.acf")):
                try:
                    with open(acf, encoding="utf-8", errors="ignore") as f:
                        txt = f.read()
                    appid = re.search(r'"appid"\s+"(\d+)"', txt); name = re.search(r'"name"\s+"([^"]+)"', txt)
                    if appid and name and appid.group(1) not in seen:
                        seen.add(appid.group(1)); games.append({"appid": int(appid.group(1)), "name": name.group(1), "library": lib})
                except OSError:
                    pass
    games.sort(key=lambda g: g["name"].lower())
    return games


def get_games(h, q, b):
    return {"ok": True, "games": list_games(), "steam": bool(steam_dirs())}


def post_games(h, q, b):
    games = list_games(); appid = b.get("appid"); name = (b.get("name") or "").lower().strip()
    g = None
    if appid:
        g = next((x for x in games if x["appid"] == int(appid)), {"appid": int(appid), "name": str(appid)})
    elif name:
        g = next((x for x in games if x["name"].lower() == name), None) or next((x for x in games if name in x["name"].lower()), None)
    if not g:
        raise ValueError("game not found in the Steam library")
    url = f"steam://rungameid/{g['appid']}"
    if IS_WIN:
        os.startfile(url)
    else:
        subprocess.Popen(["open" if IS_MAC else "xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"ok": True, "appid": g["appid"], "name": g["name"]}


# ----------------------------------------------------------------------------- cleanup
def cleanup_targets():
    home = os.path.expanduser("~")
    t = [("temp", tempfile.gettempdir())]
    if IS_WIN:
        la = os.environ.get("LOCALAPPDATA", "")
        t += [("temp", os.path.join(la, "Temp")), ("pip cache", os.path.join(la, "pip", "Cache")), ("npm cache", os.path.join(os.environ.get("APPDATA", ""), "npm-cache"))]
    elif IS_MAC:
        t += [("pip cache", os.path.join(home, "Library", "Caches", "pip")), ("npm cache", os.path.join(home, ".npm", "_cacache")), ("trash", os.path.join(home, ".Trash"))]
    else:
        t += [("pip cache", os.path.join(home, ".cache", "pip")), ("npm cache", os.path.join(home, ".npm", "_cacache")), ("trash", os.path.join(home, ".local", "share", "Trash", "files"))]
    seen, out = set(), []
    for kind, p in t:
        if p and os.path.isdir(p) and p not in seen:
            seen.add(p); out.append((kind, p))
    return out


def _dir_size(path, deadline):
    total, files = 0, 0
    for dp, dns, fns in os.walk(path):
        for fn in fns:
            try:
                total += os.lstat(os.path.join(dp, fn)).st_size; files += 1
            except OSError:
                pass
        if time.time() > deadline:
            break
    return total, files


def get_cleanup(h, q, b):
    deadline = time.time() + 8; items = []
    for kind, p in cleanup_targets():
        size, files = _dir_size(p, deadline)
        items.append({"kind": kind, "path": p, "bytes": size, "files": files})
    return {"ok": True, "total": sum(i["bytes"] for i in items), "items": items}


def post_cleanup(h, q, b):
    if not b.get("confirm"):
        raise ValueError("confirm required")
    cutoff = time.time() - 86400; freed = removed = 0
    for kind, p in cleanup_targets():
        if kind != "temp":
            continue                                   # caches and trash are reported, never deleted automatically
        for dp, dns, fns in os.walk(p):
            for fn in fns:
                fp = os.path.join(dp, fn)
                try:
                    st = os.lstat(fp)
                    if st.st_mtime < cutoff and not os.path.islink(fp):
                        os.remove(fp); freed += st.st_size; removed += 1
                except OSError:
                    pass
    return {"ok": True, "freed": freed, "removed": removed}


# ----------------------------------------------------------------------------- focus sessions
_focus = {"active": False, "phase": None, "ends": 0, "minutes": 25, "break": 5}


def post_focus(h, q, b):
    if b.get("stop"):
        _focus.update(active=False, phase=None, ends=0)
        return {"ok": True, "focus": focus_state()}
    minutes = max(1, min(180, int(b.get("minutes", 25) or 25))); brk = max(0, min(60, int(b.get("break", 5) or 5)))
    _focus.update(active=True, phase="focus", ends=time.time() + minutes * 60, minutes=minutes, **{"break": brk})
    return {"ok": True, "focus": focus_state()}


def focus_state():
    return {**_focus, "left": max(0, int(_focus["ends"] - time.time())) if _focus["active"] else 0}


def get_focus(h, q, b):
    return {"ok": True, "focus": focus_state()}


def focus_loop():
    while True:
        time.sleep(1)
        if not _focus["active"] or time.time() < _focus["ends"]:
            continue
        if _focus["phase"] == "focus":
            if _focus["break"] > 0:
                _focus.update(phase="break", ends=time.time() + _focus["break"] * 60)
                push_event("say", f"Focus session done. Take a {_focus['break']} minute break.", source="focus_end")
            else:
                _focus.update(active=False, phase=None)
                push_event("say", "Focus session done.", source="focus_end")
        else:
            _focus.update(active=False, phase=None)
            push_event("say", "Break is over. Back to it.", source="break_end")


# ----------------------------------------------------------------------------- status, mount
def get_connect_status(h, q, b):
    c = ccfg()
    return {"ok": True, "push": [k for k in ("ntfy", "pushover") if (c.get("ntfy_topic") if k == "ntfy" else c.get("pushover_token"))],
            "machines": [m.get("name") for m in c.get("machines", [])], "telegram": bool(c.get("telegram_token")),
            "webhooks": [k for k in ("discord", "slack") if c.get(f"{k}_webhook")], "steam": bool(steam_dirs()),
            "search_dirs": search_dirs(), "stations": len(c.get("stations") or DEFAULT_STATIONS), "podcasts": len(c.get("podcasts", [])),
            "files_indexed": len(_files["entries"]), "focus": focus_state(), "radio": radio_state()}


ROUTES = {
    ("POST", "/push"): post_push, ("POST", "/wol"): post_wol, ("POST", "/ssh"): post_ssh,
    ("GET", "/radio"): get_radio, ("POST", "/radio"): post_radio,
    ("GET", "/files"): get_files, ("GET", "/files/recent"): get_files_recent,
    ("GET", "/journal"): get_journal, ("POST", "/journal"): post_journal, ("GET", "/journal/today"): get_journal_today,
    ("GET", "/radio_stations"): get_radio_stations, ("GET", "/podcasts"): get_podcasts,
    ("GET", "/read"): get_read,
    ("POST", "/telegram"): post_telegram, ("POST", "/webhook"): post_webhook,
    ("GET", "/games"): get_games, ("POST", "/games"): post_games,
    ("GET", "/cleanup"): get_cleanup, ("POST", "/cleanup"): post_cleanup,
    ("POST", "/focus"): post_focus, ("GET", "/focus"): get_focus,
    ("GET", "/connect/status"): get_connect_status,
}


def start_threads():
    for fn in (file_index_loop, telegram_loop, focus_loop):
        threading.Thread(target=fn, daemon=True).start()
