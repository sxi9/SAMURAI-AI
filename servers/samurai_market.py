"""SAMURAI market: downloads, torrents, price watch, settings sync, rooms, plugin marketplace, lyrics and art.
Mounted into the add-ons sidecar (:9500).

POST /download {url, name?}            -> {ok, id, path}            direct downloads into market.download_dir (default ~/Downloads/SAMURAI)
GET  /downloads                         -> {ok, downloads:[{id, name, url, path, bytes, total, progress, state: running|done|error|cancelled, error}]}
POST /download/cancel {id}             -> {ok}
GET  /torrents                          -> {ok, configured, torrents:[{hash, name, progress, state, dlspeed}]}   qBittorrent Web UI (market.qbittorrent_url/user/password)
POST /torrents {action: add|pause|resume|delete, magnet?, hash?}   -> {ok, did}
POST /watch {url, label?}              -> {ok, watch}              price watch through the browser agent, checked every 6 h
GET  /watch                             -> {ok, watches:[{id, url, label, price, currency, history:[{t, price}], last, error}]}
POST /watch/delete {id}  ·  POST /watch/check {id?}  ·  POST /watch/open {id}
POST /sync {dir}  ·  GET /sync           settings sync folder: config.json, data/*.json, data/widgets, plugins (newer wins, .bak kept)
POST /rooms/register {room, kind}  ·  GET /rooms  ·  POST /rooms/handoff {to}   several HUDs on the LAN
GET  /plugins/market  ·  POST /plugins/install {url}  ·  POST /plugins/remove {name}  ·  POST /plugins/reload
GET  /lyrics?title=&artist=[&i=]        -> {ok, lrc|null, plain|null, source: file|lrclib|none}
GET  /art?i=                            -> image/jpeg|png bytes of the embedded album art (mutagen), 404 when none
GET  /market/status"""
import glob, io, json, os, re, shutil, subprocess, threading, time, urllib.error, urllib.parse, urllib.request, uuid, zipfile

from samurai_common import DATA, ROOT, PORTS, load_config

try:
    from samurai_automation import push_event
except Exception:                                       # pragma: no cover
    def push_event(kind, text, source="system"):
        pass

LOCK = threading.Lock()
DOWNLOADS = {}                                          # id -> dict
WATCH_PATH = os.path.join(DATA, "pricewatch.json")
ROOMS_PATH = os.path.join(DATA, "rooms.json")
SYNC_PATH = os.path.join(DATA, "sync.json")
PLUGINS_DIR = os.path.join(ROOT, "plugins")
MARKET_FILE = os.path.join(PLUGINS_DIR, "marketplace.json")
UA = "SAMURAI-AI/1.6 (+https://github.com/sxi9/SAMURAI-AI)"
PRICE_RX = re.compile(r"(?:(?P<cur>[$€£₹¥]|USD|EUR|GBP|INR|Rs\.?|CAD|AUD)\s?(?P<amt>\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?))|(?:(?P<amt2>\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?)\s?(?P<cur2>€|USD|EUR|GBP|INR|kr|zł))")


def mcfg():
    c = load_config().get("market", {}) or {}
    return {"download_dir": os.path.expanduser(c.get("download_dir") or os.path.join("~", "Downloads", "SAMURAI")),
            "qbittorrent_url": (c.get("qbittorrent_url") or "").rstrip("/"), "qbittorrent_user": c.get("qbittorrent_user", ""), "qbittorrent_password": c.get("qbittorrent_password", "")}


def _load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return default


def _save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    json.dump(data, open(tmp, "w", encoding="utf-8"), indent=1)
    os.replace(tmp, path)


# ---------------------------------------------------------------- downloads
def safe_name(n):
    n = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", str(n or "")).strip(". ") or "download"
    return n[:120]


def _download_worker(d):
    try:
        req = urllib.request.Request(d["url"], headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r, open(d["path"] + ".part", "wb") as f:
            d["total"] = int(r.headers.get("Content-Length") or 0)
            if not d.get("name_fixed"):
                cd = r.headers.get("Content-Disposition") or ""
                m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)', cd)
                if m:
                    new = os.path.join(os.path.dirname(d["path"]), safe_name(urllib.parse.unquote(m.group(1))))
                    d["name"] = os.path.basename(new); d["path"] = new
            while True:
                if d["state"] == "cancelled":
                    break
                chunk = r.read(256 * 1024)
                if not chunk:
                    break
                f.write(chunk); d["bytes"] += len(chunk)
                d["progress"] = round(d["bytes"] / d["total"], 3) if d["total"] else 0
        if d["state"] == "cancelled":
            try:
                os.remove(d["path"] + ".part")
            except OSError:
                pass
            return
        os.replace(d["path"] + ".part", d["path"]); d["state"] = "done"; d["progress"] = 1.0; d["finished"] = time.time()
        push_event("say", f"Download finished: {d['name']}", source="download")
    except Exception as e:
        d["state"] = "error"; d["error"] = str(e)[:160]


def post_download(h, q, b):
    url = (b.get("url") or "").strip()
    if not re.match(r"^https?://", url):
        raise ValueError("url must start with http:// or https://")
    ddir = mcfg()["download_dir"]; os.makedirs(ddir, exist_ok=True)
    name = safe_name(b.get("name") or os.path.basename(urllib.parse.urlparse(url).path) or "download")
    path = os.path.join(ddir, name); n = 1
    while os.path.exists(path):
        root_, ext = os.path.splitext(os.path.join(ddir, name)); path = f"{root_} ({n}){ext}"; n += 1
    d = {"id": uuid.uuid4().hex[:10], "name": os.path.basename(path), "url": url, "path": path, "bytes": 0, "total": 0, "progress": 0, "state": "running", "error": "", "started": time.time(), "name_fixed": bool(b.get("name"))}
    with LOCK:
        DOWNLOADS[d["id"]] = d
    threading.Thread(target=_download_worker, args=(d,), daemon=True).start()
    return {"ok": True, "id": d["id"], "path": path, "did": f"downloading {d['name']}"}


def get_downloads(h, q, b):
    with LOCK:
        items = sorted(DOWNLOADS.values(), key=lambda d: -d["started"])
    return {"ok": True, "downloads": [{k: v for k, v in d.items() if k != "name_fixed"} for d in items], "dir": mcfg()["download_dir"]}


def post_download_cancel(h, q, b):
    d = DOWNLOADS.get(b.get("id"))
    if not d:
        raise ValueError("no such download")
    if d["state"] == "running":
        d["state"] = "cancelled"
    return {"ok": True, "state": d["state"]}


# ---------------------------------------------------------------- qBittorrent web ui
_qb = {"cookie": "", "t": 0}


def qb_login():
    c = mcfg()
    if not c["qbittorrent_url"]:
        raise ValueError("qBittorrent is not configured: set market.qbittorrent_url (and user / password) in config.json")
    if _qb["cookie"] and time.time() - _qb["t"] < 1500:
        return _qb["cookie"]
    data = urllib.parse.urlencode({"username": c["qbittorrent_user"], "password": c["qbittorrent_password"]}).encode()
    req = urllib.request.Request(c["qbittorrent_url"] + "/api/v2/auth/login", data=data, headers={"Referer": c["qbittorrent_url"], "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=8) as r:
        cookie = r.headers.get("Set-Cookie", "").split(";")[0]
        if r.read().decode().strip() != "Ok." or not cookie:
            raise ValueError("qBittorrent login refused: check user / password and 'Bypass authentication for localhost'")
    _qb.update(cookie=cookie, t=time.time())
    return cookie


def qb(path, data=None):
    c = mcfg(); cookie = qb_login()
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(c["qbittorrent_url"] + "/api/v2" + path, data=body, headers={"Cookie": cookie, "Referer": c["qbittorrent_url"], "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        raw = r.read()
    try:
        return json.loads(raw)
    except Exception:
        return raw.decode(errors="ignore")


def get_torrents(h, q, b):
    if not mcfg()["qbittorrent_url"]:
        return {"ok": True, "configured": False, "torrents": [], "note": "set market.qbittorrent_url to control qBittorrent (Web UI must be enabled)"}
    ts = qb("/torrents/info")
    return {"ok": True, "configured": True, "torrents": [{"hash": t["hash"], "name": t["name"], "progress": round(t.get("progress", 0), 3), "state": t.get("state"), "dlspeed": t.get("dlspeed", 0), "size": t.get("size", 0)} for t in ts]}


def post_torrents(h, q, b):
    act = b.get("action")
    if act == "add":
        if not (b.get("magnet") or "").startswith("magnet:"):
            raise ValueError("a magnet link is required")
        qb("/torrents/add", {"urls": b["magnet"]}); return {"ok": True, "did": "torrent added"}
    hashes = b.get("hash") or "all"
    if act in ("pause", "resume"):
        qb(f"/torrents/{'stop' if act == 'pause' else 'start'}", {"hashes": hashes}); return {"ok": True, "did": f"torrent {act}d"}
    if act == "delete":
        qb("/torrents/delete", {"hashes": hashes, "deleteFiles": "false"}); return {"ok": True, "did": "torrent removed (files kept)"}
    raise ValueError("action must be add|pause|resume|delete")


# ---------------------------------------------------------------- price watch
def parse_price(text):
    """First plausible price in a page's text: (amount, currency) or (None, None)."""
    best = None
    for m in PRICE_RX.finditer(text or ""):
        amt = m.group("amt") or m.group("amt2"); cur = m.group("cur") or m.group("cur2") or ""
        if not amt:
            continue
        s = amt
        if s.count(",") and s.count("."):
            s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
        elif s.count(",") == 1 and len(s.split(",")[1]) == 2:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
        try:
            val = float(s)
        except ValueError:
            continue
        if 0 < val < 10_000_000:
            best = (val, cur.replace("Rs.", "₹").replace("Rs", "₹"))
            break
    return best or (None, None)


def browser_read(url):
    req = urllib.request.Request(f"http://127.0.0.1:{PORTS['browser']}/browser", data=json.dumps({"cmd": "open", "arg": url}).encode(), headers={"Content-Type": "application/json", "Origin": "http://localhost:8080"})
    urllib.request.urlopen(req, timeout=60).read()
    req = urllib.request.Request(f"http://127.0.0.1:{PORTS['browser']}/browser", data=json.dumps({"cmd": "read"}).encode(), headers={"Content-Type": "application/json", "Origin": "http://localhost:8080"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def check_watch(w):
    try:
        page = browser_read(w["url"])
        price, cur = parse_price(page.get("text", ""))
        w["title"] = (page.get("title") or "")[:100]
        if price is None:
            w["error"] = "no price found on the page"; w["last"] = time.time(); return
        prev = w.get("price")
        w.update(price=price, currency=cur or w.get("currency", ""), error="", last=time.time())
        w.setdefault("history", []).append({"t": time.time(), "price": price}); w["history"] = w["history"][-200:]
        if prev and price <= prev * 0.95:
            push_event("say", f"Price drop: {w.get('label') or w['title']} is now {cur}{price:g}, down from {cur}{prev:g}.", source="pricewatch")
    except Exception as e:
        w["error"] = str(e)[:120]; w["last"] = time.time()


def watch_loop():
    while True:
        time.sleep(60)
        try:
            watches = _load(WATCH_PATH, []); changed = False
            for w in watches:
                if time.time() - (w.get("last") or 0) > 6 * 3600:
                    check_watch(w); changed = True
            if changed:
                _save(WATCH_PATH, watches)
        except Exception:
            pass


def post_watch(h, q, b):
    url = (b.get("url") or "").strip()
    if not re.match(r"^https?://", url):
        raise ValueError("url must start with http:// or https://")
    watches = _load(WATCH_PATH, [])
    w = {"id": uuid.uuid4().hex[:8], "url": url, "label": (b.get("label") or "")[:80], "price": None, "currency": "", "history": [], "last": 0, "error": "", "created": time.time()}
    watches.append(w); _save(WATCH_PATH, watches)
    if not b.get("defer"):
        threading.Thread(target=lambda: (check_watch(w), _save(WATCH_PATH, [x if x["id"] != w["id"] else w for x in _load(WATCH_PATH, [])])), daemon=True).start()
    return {"ok": True, "watch": w, "did": f"watching {w['label'] or url}"}


def get_watch(h, q, b):
    return {"ok": True, "watches": _load(WATCH_PATH, [])}


def post_watch_delete(h, q, b):
    watches = [w for w in _load(WATCH_PATH, []) if w["id"] != b.get("id")]
    _save(WATCH_PATH, watches); return {"ok": True, "watches": watches}


def post_watch_check(h, q, b):
    watches = _load(WATCH_PATH, []); hit = [w for w in watches if not b.get("id") or w["id"] == b.get("id")]
    for w in hit:
        check_watch(w)
    _save(WATCH_PATH, watches); return {"ok": True, "watches": hit}


def post_watch_open(h, q, b):
    w = next((w for w in _load(WATCH_PATH, []) if w["id"] == b.get("id")), None)
    if not w:
        raise ValueError("no such watch")
    hdr = {"Content-Type": "application/json", "Origin": "http://localhost:8080"}
    for body in ({"cmd": "headed", "arg": "on"}, {"cmd": "open", "arg": w["url"]}):
        try:
            urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORTS['browser']}/browser", data=json.dumps(body).encode(), headers=hdr), timeout=60).read()
        except Exception as e:
            return {"ok": False, "error": f"browser agent: {str(e)[:80]}"}
    return {"ok": True, "did": "opened in the browser window; buying is up to you"}


# ---------------------------------------------------------------- settings sync
SYNC_ITEMS = ["config.json", "data/widgets", "plugins"]


def _newer(a, b):
    try:
        return os.path.getmtime(a) > os.path.getmtime(b) + 1
    except OSError:
        return os.path.exists(a) and not os.path.exists(b)


def _copy_item(src, dst):
    if os.path.isdir(src):
        for root_, _, files in os.walk(src):
            for f in files:
                s = os.path.join(root_, f); d = os.path.join(dst, os.path.relpath(s, src))
                _copy_file(s, d)
    elif os.path.exists(src):
        _copy_file(src, dst)


def _copy_file(s, d):
    if os.path.exists(d) and not _newer(s, d):
        return 0
    os.makedirs(os.path.dirname(d), exist_ok=True)
    if os.path.exists(d):
        shutil.copy2(d, d + ".bak")
    shutil.copy2(s, d); return 1


def sync_run(folder):
    """Two-way: for every item, the newer copy wins on each side; .bak kept next to the overwritten one."""
    os.makedirs(folder, exist_ok=True); pushed = pulled = 0
    items = SYNC_ITEMS + [os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, "data", "*.json"))]
    items += [os.path.join("data", os.path.basename(p)) for p in glob.glob(os.path.join(folder, "data", "*.json")) if os.path.join("data", os.path.basename(p)) not in items]
    for rel in sorted(set(items)):
        local, remote = os.path.join(ROOT, rel), os.path.join(folder, rel)
        if os.path.isdir(local) or os.path.isdir(remote):
            for root_, _, files in os.walk(local) if os.path.isdir(local) else []:
                for f in files:
                    s = os.path.join(root_, f); pushed += _copy_file(s, os.path.join(remote, os.path.relpath(s, local)))
            for root_, _, files in os.walk(remote) if os.path.isdir(remote) else []:
                for f in files:
                    if f.endswith(".bak"):
                        continue
                    s = os.path.join(root_, f); pulled += _copy_file(s, os.path.join(local, os.path.relpath(s, remote)))
        else:
            if os.path.exists(local):
                pushed += _copy_file(local, remote)
            if os.path.exists(remote) and not remote.endswith(".bak"):
                pulled += _copy_file(remote, local)
    st = {"dir": folder, "last": time.time(), "pushed": pushed, "pulled": pulled}
    _save(SYNC_PATH, st); return st


def post_sync(h, q, b):
    folder = os.path.expanduser((b.get("dir") or _load(SYNC_PATH, {}).get("dir") or "").strip())
    if not folder:
        raise ValueError("dir required: a Dropbox / OneDrive / Syncthing folder")
    return {"ok": True, **sync_run(folder)}


def get_sync(h, q, b):
    return {"ok": True, **_load(SYNC_PATH, {"dir": "", "last": 0, "pushed": 0, "pulled": 0})}


def sync_on_start():
    st = _load(SYNC_PATH, {})
    if st.get("dir") and os.path.isdir(st["dir"]):
        try:
            sync_run(st["dir"])
        except Exception:
            pass


# ---------------------------------------------------------------- rooms
def post_rooms_register(h, q, b):
    room = re.sub(r"[^a-z0-9 _-]", "", str(b.get("room", "")).lower()).strip()[:32] or "default"
    rooms = _load(ROOMS_PATH, {"rooms": {}, "active": ""})
    rooms["rooms"][room] = {"kind": b.get("kind") or "pc", "seen": time.time(), "addr": h.client_address[0] if h and h.client_address else ""}
    if not rooms["active"]:
        rooms["active"] = room
    _save(ROOMS_PATH, rooms)
    return {"ok": True, "room": room, "active": rooms["active"]}


def get_rooms(h, q, b):
    rooms = _load(ROOMS_PATH, {"rooms": {}, "active": ""}); now = time.time()
    return {"ok": True, "active": rooms["active"], "rooms": [{"room": k, **v, "online": now - v.get("seen", 0) < 90} for k, v in rooms["rooms"].items()]}


def post_rooms_handoff(h, q, b):
    rooms = _load(ROOMS_PATH, {"rooms": {}, "active": ""}); to = str(b.get("to", "")).lower().strip()
    if to not in rooms["rooms"]:
        raise ValueError(f"no room called {to!r}; known: {', '.join(rooms['rooms']) or 'none'}")
    rooms["active"] = to; _save(ROOMS_PATH, rooms)
    push_event("say", f"Handing off to the {to}.", source="rooms")
    return {"ok": True, "active": to, "did": f"active room is now {to}"}


# ---------------------------------------------------------------- plugin marketplace
def installed_plugins():
    out = {}
    for p in glob.glob(os.path.join(PLUGINS_DIR, "*.py")):
        n = os.path.basename(p)[:-3]
        if n.startswith("_"):
            continue
        man = os.path.join(PLUGINS_DIR, n + "_pkg", "plugin.json")
        out[n] = _load(man, {"name": n, "version": "", "tools": []}) if os.path.exists(man) else {"name": n, "version": "local", "tools": []}
    return out


def get_plugins_market(h, q, b):
    market = _load(MARKET_FILE, {"plugins": []}).get("plugins", [])
    inst = installed_plugins()
    for m in market:
        m["installed"] = m.get("name") in inst
        m["installed_version"] = inst.get(m.get("name"), {}).get("version", "")
    return {"ok": True, "plugins": market, "installed": [{"name": k, **v} for k, v in inst.items()]}


def _validate_manifest(folder):
    man = _load(os.path.join(folder, "plugin.json"), None)
    if not man or not man.get("name") or not man.get("entry"):
        raise ValueError("plugin.json with name and entry (the .py file) is required")
    name = re.sub(r"[^a-z0-9_]", "", str(man["name"]).lower().replace("-", "_"))[:40]
    entry = os.path.join(folder, os.path.basename(man["entry"]))
    if not name or not os.path.isfile(entry) or not entry.endswith(".py"):
        raise ValueError("manifest entry must be a .py file inside the package")
    return name, man, entry


def post_plugins_install(h, q, b):
    url = (b.get("url") or "").strip()
    if not url:
        raise ValueError("url required (zip, git repository, or a local folder path)")
    tmp = os.path.join(DATA, "plugin-tmp"); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    if not re.match(r"^[a-z]+://", url) and not os.path.isabs(url) and os.path.isdir(os.path.join(ROOT, url)):
        url = os.path.join(ROOT, url)                                   # a folder in this repo, e.g. plugins/catalog/countdown
    if os.path.isdir(url):
        shutil.copytree(url, os.path.join(tmp, "pkg"))
    elif url.endswith(".git") or "github.com" in url and not url.endswith(".zip"):
        if not shutil.which("git"):
            raise ValueError("git is not installed")
        r = subprocess.run(["git", "clone", "--depth", "1", url, os.path.join(tmp, "pkg")], capture_output=True, text=True, timeout=120)
        if r.returncode:
            raise ValueError("git clone failed: " + r.stderr.strip()[:160])
    else:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=60).read()
        zf = zipfile.ZipFile(io.BytesIO(data)); pkg = os.path.join(tmp, "pkg"); os.makedirs(pkg)
        for m in zf.infolist():
            dest = os.path.realpath(os.path.join(pkg, m.filename))
            if not dest.startswith(os.path.realpath(pkg) + os.sep) and dest != os.path.realpath(pkg):
                raise ValueError("unsafe path in zip")
            if m.is_dir():
                os.makedirs(dest, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(dest), exist_ok=True); open(dest, "wb").write(zf.read(m))
    pkg = os.path.join(tmp, "pkg")
    inner = [d for d in os.listdir(pkg) if os.path.isdir(os.path.join(pkg, d))]
    if not os.path.exists(os.path.join(pkg, "plugin.json")) and len(inner) == 1 and os.path.exists(os.path.join(pkg, inner[0], "plugin.json")):
        pkg = os.path.join(pkg, inner[0])
    name, man, entry = _validate_manifest(pkg)
    dest_pkg = os.path.join(PLUGINS_DIR, name + "_pkg"); shutil.rmtree(dest_pkg, ignore_errors=True); shutil.copytree(pkg, dest_pkg)
    shutil.copy2(os.path.join(dest_pkg, os.path.basename(entry)), os.path.join(PLUGINS_DIR, name + ".py"))
    shutil.rmtree(tmp, ignore_errors=True)
    reload_plugins()
    return {"ok": True, "did": f"installed {man.get('name')} {man.get('version', '')}".strip(), "name": name, "tools": man.get("tools", [])}


def post_plugins_remove(h, q, b):
    name = re.sub(r"[^a-z0-9_]", "", str(b.get("name", "")).lower())
    if not name or name == "example_tools":
        raise ValueError("name required (the bundled example cannot be removed)")
    removed = False
    for p in (os.path.join(PLUGINS_DIR, name + ".py"), os.path.join(PLUGINS_DIR, name + "_pkg")):
        if os.path.isdir(p):
            shutil.rmtree(p); removed = True
        elif os.path.exists(p):
            os.remove(p); removed = True
    reload_plugins()
    return {"ok": True, "removed": removed}


def reload_plugins():
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{PORTS['actions']}/plugins/reload", data=b"{}", headers={"Content-Type": "application/json", "Origin": "http://localhost:8080"})
        return json.loads(urllib.request.urlopen(req, timeout=10).read())
    except Exception as e:
        return {"ok": False, "error": str(e)[:80]}


def post_plugins_reload(h, q, b):
    r = reload_plugins()
    return {"ok": True, "actions": r}


# ---------------------------------------------------------------- lyrics + art
_lyrics_cache = {}


def _track(i):
    try:
        import samurai_addons as addons
        addons.scan_music()
        return addons._music["tracks"][int(i)] if 0 <= int(i) < len(addons._music["tracks"]) else None
    except Exception:
        return None


def get_lyrics(h, q, b):
    title, artist = (q.get("title") or "").strip(), (q.get("artist") or "").strip()
    track = _track(q["i"]) if q.get("i") not in (None, "") else None
    if track:
        title = title or track.get("title", ""); artist = artist or track.get("artist", "")
        lrc = os.path.splitext(track.get("path", ""))[0] + ".lrc"
        if os.path.exists(lrc):
            return {"ok": True, "lrc": open(lrc, encoding="utf-8", errors="ignore").read()[:20000], "plain": None, "source": "file"}
    if not title:
        raise ValueError("title (or i) required")
    key = (title.lower(), artist.lower())
    if key in _lyrics_cache:
        return {"ok": True, **_lyrics_cache[key], "cached": True}
    base = os.environ.get("SAMURAI_LRCLIB", "https://lrclib.net")
    try:
        url = base + "/api/get?" + urllib.parse.urlencode({"track_name": title, "artist_name": artist} if artist else {"track_name": title})
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        d = json.loads(urllib.request.urlopen(req, timeout=10).read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            try:
                url = base + "/api/search?" + urllib.parse.urlencode({"track_name": title, **({"artist_name": artist} if artist else {})})
                hits = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=10).read())
                d = hits[0] if hits else {}
            except Exception:
                d = {}
        else:
            return {"ok": True, "lrc": None, "plain": None, "source": "none", "error": f"lrclib {e.code}"}
    except Exception as e:
        return {"ok": True, "lrc": None, "plain": None, "source": "none", "error": str(e)[:80]}
    res = {"lrc": d.get("syncedLyrics"), "plain": d.get("plainLyrics"), "source": "lrclib" if d else "none"}
    if d:
        _lyrics_cache[key] = res
    return {"ok": True, **res}


def get_art(h, q, b):
    track = _track(q.get("i", -1))
    if not track:
        h.send_bytes(b'{"ok": false, "error": "no such track"}', "application/json", code=404); return None
    try:
        import mutagen
    except ImportError:
        h.send_bytes(b'{"ok": false, "error": "pip install mutagen for album art"}', "application/json", code=404); return None
    try:
        f = mutagen.File(track["path"])
        data, ctype = None, "image/jpeg"
        if f is not None:
            tags = getattr(f, "tags", None)
            if tags:
                for k in tags.keys():
                    if str(k).startswith("APIC") or k == "covr":
                        v = tags[k]; pic = v[0] if isinstance(v, list) else v
                        data = getattr(pic, "data", None) or bytes(pic); ctype = getattr(pic, "mime", None) or ctype; break
            if data is None and getattr(f, "pictures", None):
                p = f.pictures[0]; data, ctype = p.data, p.mime or ctype
        if not data:
            h.send_bytes(b'{"ok": false, "error": "no embedded art"}', "application/json", code=404); return None
        h.send_bytes(data, ctype, extra={"Cache-Control": "max-age=3600"}); return None
    except Exception as e:
        h.send_bytes(json.dumps({"ok": False, "error": str(e)[:80]}).encode(), "application/json", code=404); return None


def get_status(h, q, b):
    c = mcfg()
    return {"ok": True, "download_dir": c["download_dir"], "downloads": len(DOWNLOADS), "qbittorrent": bool(c["qbittorrent_url"]), "watches": len(_load(WATCH_PATH, [])),
            "sync": _load(SYNC_PATH, {}).get("dir", ""), "rooms": _load(ROOMS_PATH, {"rooms": {}}).get("rooms", {}), "plugins": list(installed_plugins().keys())}


def start_threads():
    threading.Thread(target=watch_loop, daemon=True).start()
    threading.Thread(target=sync_on_start, daemon=True).start()


ROUTES = {("POST", "/download"): post_download, ("GET", "/downloads"): get_downloads, ("POST", "/download/cancel"): post_download_cancel,
          ("GET", "/torrents"): get_torrents, ("POST", "/torrents"): post_torrents,
          ("POST", "/watch"): post_watch, ("GET", "/watch"): get_watch, ("POST", "/watch/delete"): post_watch_delete, ("POST", "/watch/check"): post_watch_check, ("POST", "/watch/open"): post_watch_open,
          ("POST", "/sync"): post_sync, ("GET", "/sync"): get_sync,
          ("POST", "/rooms/register"): post_rooms_register, ("GET", "/rooms"): get_rooms, ("POST", "/rooms/handoff"): post_rooms_handoff,
          ("GET", "/plugins/market"): get_plugins_market, ("POST", "/plugins/install"): post_plugins_install, ("POST", "/plugins/remove"): post_plugins_remove, ("POST", "/plugins/reload"): post_plugins_reload,
          ("GET", "/lyrics"): get_lyrics, ("GET", "/art"): get_art, ("GET", "/market/status"): get_status}
