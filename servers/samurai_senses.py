"""SAMURAI senses: what the user is doing, system notifications, face recognition. Mounted into the add-ons sidecar (:9500).

GET  /activity                      -> {ok, title, app, category: call|game|video|work|idle, fullscreen, quiet, since}
GET  /notifications[?n=20]          -> {ok, notifications:[{app,title,text,t}], source: winrt|dbus|none, note}
POST /notifications/clear           -> {ok}
POST /faces/enroll {name, image}    -> {ok, name, samples}           image = base64 JPEG (data: prefix allowed)
POST /faces/who {image}             -> {ok, name|null, confidence, known:[names]}
GET  /faces                         -> {ok, people:[{name, samples}], available, note}
POST /faces/forget {name}           -> {ok}

Activity comes from the telemetry sidecar's active_window (title + process) plus name patterns and config senses.quiet_apps.
Notifications: Windows → WinRT UserNotificationListener (optional `winsdk` package, the user grants access once in
Settings → Privacy → Notifications); Linux → org.freedesktop.Notifications eavesdrop through python-dbus when present.
New toasts are pushed as add-ons events (kind 'say', source 'notification') when senses.read_notifications is on.
Faces: Haar cascade + LBPH from opencv-contrib (optional); samples live in data/faces/<name>/*.jpg."""
import base64, json, os, re, threading, time, urllib.request

from samurai_common import DATA, PORTS, IS_WIN, IS_MAC, load_config

try:
    from samurai_automation import push_event
except Exception:                                       # pragma: no cover - keeps the module importable in isolation
    def push_event(kind, text, source="system"):
        pass

FACES_DIR = os.path.join(DATA, "faces")
NOTIF = {"items": [], "lock": threading.Lock(), "source": "none", "note": "", "started": False, "seen": set()}
ACT = {"title": "", "app": "", "category": "idle", "fullscreen": False, "t": 0, "since": 0, "last_cat": ""}

CATEGORIES = [
    ("call", re.compile(r"zoom|teams|meet\.google|google meet|discord|skype|webex|facetime|slack huddle|whereby|jitsi|call\b", re.I)),
    ("game", re.compile(r"steam_app|steamapps|unity|unreal|minecraft|fortnite|valorant|league of legends|counter-strike|cs2|dota|elden|roblox|epic games|\.exe game|gta|apex", re.I)),
    ("video", re.compile(r"youtube|netflix|vlc|mpv|prime video|disney\+|twitch|plex|jellyfin|kodi|hulu|hotstar|player", re.I)),
    ("work", re.compile(r"code|visual studio|pycharm|intellij|terminal|powershell|cmd\.exe|word|excel|powerpoint|docs\.google|notion|figma|photoshop|blender|xcode|obsidian|jupyter|sheets|outlook|gmail", re.I)),
]


def telemetry_stats():
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{PORTS['telemetry']}/stats", headers={"Origin": "http://localhost:8080"})
        return json.loads(urllib.request.urlopen(req, timeout=2).read())
    except Exception:
        return {}


def categorise(title, app):
    cfg = load_config().get("senses", {})
    hay = f"{title} {app}"
    for pat in cfg.get("quiet_apps", []) or []:
        if pat and pat.lower() in hay.lower():
            return "call"
    for name, rx in CATEGORIES:
        if rx.search(hay):
            return name
    return "work" if (title or app) else "idle"


def get_activity(h, q, b):
    st = telemetry_stats(); aw = st.get("active_window") or {}
    title, app = (aw.get("title") or "")[:120], (aw.get("app") or "")[:60]
    cat = categorise(title, app)
    now = time.time()
    if cat != ACT["last_cat"]:
        ACT["since"] = now; ACT["last_cat"] = cat
    ACT.update(title=title, app=app, category=cat, fullscreen=bool(st.get("fullscreen")), t=now)
    return {"ok": True, "title": title, "app": app, "category": cat, "fullscreen": ACT["fullscreen"], "quiet": cat in ("call", "game"), "since": ACT["since"]}


# ---------------------------------------------------------------- notifications
def _add_toast(app, title, text):
    key = (app, title, text)
    with NOTIF["lock"]:
        if key in NOTIF["seen"]:
            return
        NOTIF["seen"].add(key)
        if len(NOTIF["seen"]) > 500:
            NOTIF["seen"] = set(list(NOTIF["seen"])[-250:])
        NOTIF["items"].append({"app": app[:40], "title": title[:120], "text": text[:300], "t": time.time()})
        NOTIF["items"] = NOTIF["items"][-50:]
    if load_config().get("senses", {}).get("read_notifications"):
        push_event("say", f"{app or 'Notification'}: {title}. {text}".strip(), source="notification")


def _winrt_loop():
    try:
        from winsdk.windows.ui.notifications.management import UserNotificationListener, UserNotificationListenerAccessStatus
        from winsdk.windows.ui.notifications import NotificationKinds
    except Exception:
        NOTIF.update(source="none", note="pip install winsdk (Windows 10+), then allow SAMURAI under Settings → Privacy → Notifications")
        return
    import asyncio

    async def run():
        listener = UserNotificationListener.current
        status = await listener.request_access_async()
        if status != UserNotificationListenerAccessStatus.ALLOWED:
            NOTIF.update(source="none", note="notification access denied: allow it under Settings → Privacy → Notifications"); return
        NOTIF.update(source="winrt", note="")
        while True:
            try:
                notes = await listener.get_notifications_async(NotificationKinds.TOAST)
                for n in notes:
                    app = n.app_info.display_info.display_name if n.app_info else ""
                    binding = n.notification.visual.get_binding("ToastGeneric") if n.notification and n.notification.visual else None
                    parts = [t.text for t in binding.get_text_elements()] if binding else []
                    _add_toast(app, parts[0] if parts else "", " ".join(parts[1:]) if len(parts) > 1 else "")
            except Exception:
                pass
            await asyncio.sleep(4)
    try:
        asyncio.run(run())
    except Exception as e:
        NOTIF.update(source="none", note=f"winrt listener failed: {str(e)[:80]}")


def _dbus_loop():
    try:
        import dbus
        from dbus.mainloop.glib import DBusGMainLoop
        from gi.repository import GLib
    except Exception:
        NOTIF.update(source="none", note="python-dbus + PyGObject not installed: notifications are not captured on this desktop")
        return
    try:
        DBusGMainLoop(set_as_default=True)
        bus = dbus.SessionBus()
        bus.add_match_string_non_blocking("type='method_call',interface='org.freedesktop.Notifications',member='Notify',eavesdrop='true'")

        def on_msg(bus_, msg):
            try:
                if msg.get_member() == "Notify":
                    a = msg.get_args_list()
                    _add_toast(str(a[0]), str(a[3]), str(a[4]))
            except Exception:
                pass
        bus.add_message_filter(on_msg)
        NOTIF.update(source="dbus", note="")
        GLib.MainLoop().run()
    except Exception as e:
        NOTIF.update(source="none", note=f"dbus listener failed: {str(e)[:80]}")


def start_threads():
    if NOTIF["started"]:
        return
    NOTIF["started"] = True
    target = _winrt_loop if IS_WIN else (None if IS_MAC else _dbus_loop)
    if target is None:
        NOTIF.update(note="macOS notifications are not readable without accessibility hacks; not captured")
        return
    threading.Thread(target=target, daemon=True).start()


def get_notifications(h, q, b):
    n = min(int(q.get("n", 20) or 20), 50)
    with NOTIF["lock"]:
        items = list(reversed(NOTIF["items"]))[:n]
    return {"ok": True, "notifications": items, "source": NOTIF["source"], "note": NOTIF["note"], "reading": bool(load_config().get("senses", {}).get("read_notifications"))}


def post_notifications_clear(h, q, b):
    with NOTIF["lock"]:
        NOTIF["items"].clear()
    return {"ok": True}


def post_notification_test(h, q, b):
    """Inject a toast (tests and the HUD's own demo button)."""
    _add_toast(b.get("app") or "SAMURAI", b.get("title") or "Test", b.get("text") or "")
    return {"ok": True}


# ---------------------------------------------------------------- faces
def _cv():
    try:
        import cv2, numpy as np
        if not hasattr(cv2, "face"):
            return None, None, "opencv-contrib-python-headless is needed (cv2.face missing)"
        return cv2, np, ""
    except Exception:
        return None, None, "pip install opencv-contrib-python-headless to enable face recognition"


def _decode(image_b64):
    cv2, np, err = _cv()
    if err:
        raise ValueError(err)
    raw = image_b64.split(",", 1)[-1]
    arr = np.frombuffer(base64.b64decode(raw), dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("not a decodable image")
    return img


def _faces_in(img):
    cv2, _, _ = _cv()
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    rects = cascade.detectMultiScale(img, scaleFactor=1.2, minNeighbors=5, minSize=(60, 60))
    out = []
    for (x, y, w, h) in rects:
        out.append(cv2.resize(img[y:y + h, x:x + w], (160, 160)))
    return out


def people():
    out = []
    if os.path.isdir(FACES_DIR):
        for n in sorted(os.listdir(FACES_DIR)):
            d = os.path.join(FACES_DIR, n)
            if os.path.isdir(d):
                out.append({"name": n, "samples": len([f for f in os.listdir(d) if f.endswith(".jpg")])})
    return out


def post_faces_enroll(h, q, b):
    name = re.sub(r"[^a-z0-9_ -]", "", str(b.get("name", "")).lower()).strip().replace(" ", "_")[:32]
    if not name:
        raise ValueError("name required")
    cv2, _, _ = _cv()
    img = _decode(b.get("image", ""))
    faces = _faces_in(img)
    if not faces:
        return {"ok": False, "error": "no face found in the image: look at the camera, good light", "name": name}
    d = os.path.join(FACES_DIR, name); os.makedirs(d, exist_ok=True)
    cv2.imwrite(os.path.join(d, f"{int(time.time() * 1000)}.jpg"), faces[0])
    return {"ok": True, "name": name, "samples": len(os.listdir(d))}


def _train():
    cv2, np, err = _cv()
    if err:
        raise ValueError(err)
    labels, imgs, names = [], [], []
    for i, p in enumerate(people()):
        names.append(p["name"])
        d = os.path.join(FACES_DIR, p["name"])
        for f in os.listdir(d):
            if f.endswith(".jpg"):
                im = cv2.imread(os.path.join(d, f), cv2.IMREAD_GRAYSCALE)
                if im is not None:
                    imgs.append(im); labels.append(i)
    if not imgs:
        return None, names
    rec = cv2.face.LBPHFaceRecognizer_create()
    rec.train(imgs, np.array(labels))
    return rec, names


def post_faces_who(h, q, b):
    img = _decode(b.get("image", ""))
    faces = _faces_in(img)
    known = [p["name"] for p in people()]
    if not faces:
        return {"ok": True, "name": None, "confidence": 0, "known": known, "note": "no face in frame"}
    rec, names = _train()
    if rec is None:
        return {"ok": True, "name": None, "confidence": 0, "known": known, "note": "nobody enrolled yet: say 'remember my face as <name>'"}
    label, dist = rec.predict(faces[0])
    conf = max(0.0, min(1.0, 1 - dist / 120.0))                 # LBPH distance: 0 = identical, >100 = unlike
    return {"ok": True, "name": names[label] if conf >= 0.35 else None, "confidence": round(conf, 2), "known": known, "faces": len(faces)}


def get_faces(h, q, b):
    cv2, _, err = _cv()
    return {"ok": True, "people": people(), "available": not err, "note": err}


def post_faces_forget(h, q, b):
    import shutil
    name = re.sub(r"[^a-z0-9_-]", "", str(b.get("name", "")).lower())
    d = os.path.join(FACES_DIR, name)
    if name and os.path.isdir(d):
        shutil.rmtree(d)
    return {"ok": True, "people": people()}


ROUTES = {("GET", "/activity"): get_activity,
          ("GET", "/notifications"): get_notifications, ("POST", "/notifications/clear"): post_notifications_clear, ("POST", "/notifications/test"): post_notification_test,
          ("POST", "/faces/enroll"): post_faces_enroll, ("POST", "/faces/who"): post_faces_who, ("GET", "/faces"): get_faces, ("POST", "/faces/forget"): post_faces_forget}
