"""SAMURAI home2: smart home beyond Home Assistant. Mounted into the add-ons sidecar (:9500).

GET  /home2/devices                         -> {ok, devices:[{id, name, backend, on, brightness, color, room}], backends:{hue, govee, kasa}}
POST /home2 {device, on?, brightness?(0-100), color?(#rrggbb|name), scene?}   -> {ok, did, device}
GET  /home2/scenes                          -> {ok, scenes:[{id, name, backend}]}
POST /home2/scene {scene}                   -> {ok, did}
POST /home2/hue/pair {bridge?}              -> {ok, paired, bridge, note}   press the link button on the bridge first, then call within 30 s
GET  /home2/status                          -> {ok, hue:{configured, bridge, lights}, govee:{configured, devices}, kasa:{configured, devices, note}}

Backends (all optional): Philips Hue local API (home2.hue_bridge + home2.hue_user, pairing fills the user),
Govee cloud API (home2.govee_key), TP-Link Kasa / Tapo through the `python-kasa` package when installed
(home2.kasa_discover true, or home2.kasa_hosts). `device` matches by id or a part of the name, case-insensitive."""
import asyncio, json, os, re, socket, threading, time, urllib.error, urllib.request

from samurai_common import load_config, save_config

CACHE = {"devices": [], "t": 0, "lock": threading.Lock(), "kasa_note": ""}
COLORS = {"red": (255, 0, 0), "green": (0, 255, 0), "blue": (0, 0, 255), "white": (255, 255, 255), "warm": (255, 180, 100), "cool": (200, 220, 255),
          "yellow": (255, 220, 0), "orange": (255, 120, 0), "purple": (150, 0, 255), "pink": (255, 80, 180), "cyan": (0, 220, 255)}


def cfg():
    c = load_config().get("home2", {}) or {}
    return {"hue_bridge": c.get("hue_bridge", ""), "hue_user": c.get("hue_user", ""), "govee_key": c.get("govee_key", ""),
            "kasa_discover": bool(c.get("kasa_discover", False)), "kasa_hosts": c.get("kasa_hosts", []) or []}


def http(method, url, body=None, headers=None, timeout=6):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def parse_color(c):
    if not c:
        return None
    c = str(c).strip().lower()
    if c in COLORS:
        return COLORS[c]
    m = re.match(r"#?([0-9a-f]{6})$", c)
    if m:
        v = int(m.group(1), 16); return ((v >> 16) & 255, (v >> 8) & 255, v & 255)
    return None


def rgb_to_xy(r, g, b):
    r, g, b = [((v / 255) ** 2.2) for v in (r, g, b)]
    X = r * .664511 + g * .154324 + b * .162028; Y = r * .283881 + g * .668433 + b * .047685; Z = r * .000088 + g * .072310 + b * .986039
    s = X + Y + Z or 1
    return [round(X / s, 4), round(Y / s, 4)]


# ---------------------------------------------------------------- Hue (local)
def hue_discover():
    try:
        d = http("GET", "https://discovery.meethue.com/", timeout=5)
        if d and isinstance(d, list) and d[0].get("internalipaddress"):
            return d[0]["internalipaddress"]
    except Exception:
        pass
    return ""


def post_hue_pair(h, q, b):
    c = load_config(); h2 = c.setdefault("home2", {})
    bridge = (b.get("bridge") or h2.get("hue_bridge") or hue_discover()).strip()
    if not bridge:
        return {"ok": False, "paired": False, "bridge": "", "note": "no Hue bridge found: pass {bridge: '192.168.x.x'}"}
    try:
        res = http("POST", f"http://{bridge}/api", {"devicetype": "samurai#hud"}, timeout=5)
    except Exception as e:
        return {"ok": False, "paired": False, "bridge": bridge, "note": f"bridge did not answer: {str(e)[:60]}"}
    if res and res[0].get("success"):
        h2["hue_bridge"] = bridge; h2["hue_user"] = res[0]["success"]["username"]; save_config(c)
        CACHE["t"] = 0
        return {"ok": True, "paired": True, "bridge": bridge, "note": "paired"}
    err = (res[0].get("error", {}) if res else {}).get("description", "unknown")
    return {"ok": False, "paired": False, "bridge": bridge, "note": f"press the link button on the bridge, then try again ({err})"}


def hue_devices():
    c = cfg()
    if not (c["hue_bridge"] and c["hue_user"]):
        return []
    lights = http("GET", f"http://{c['hue_bridge']}/api/{c['hue_user']}/lights", timeout=4)
    out = []
    for lid, l in (lights or {}).items():
        st = l.get("state", {})
        out.append({"id": f"hue:{lid}", "name": l.get("name", lid), "backend": "hue", "on": bool(st.get("on")), "brightness": round((st.get("bri") or 0) / 254 * 100), "color": None, "room": "", "reachable": st.get("reachable", True)})
    return out


def hue_set(lid, on=None, brightness=None, color=None):
    c = cfg(); body = {}
    if on is not None:
        body["on"] = bool(on)
    if brightness is not None:
        body["bri"] = max(1, min(254, round(float(brightness) / 100 * 254))); body.setdefault("on", True)
    rgb = parse_color(color)
    if rgb:
        body["xy"] = rgb_to_xy(*rgb); body.setdefault("on", True)
    return http("PUT", f"http://{c['hue_bridge']}/api/{c['hue_user']}/lights/{lid}/state", body, timeout=4)


def hue_scenes():
    c = cfg()
    if not (c["hue_bridge"] and c["hue_user"]):
        return []
    sc = http("GET", f"http://{c['hue_bridge']}/api/{c['hue_user']}/scenes", timeout=4)
    return [{"id": f"hue:{sid}", "name": s.get("name", sid), "backend": "hue", "group": s.get("group")} for sid, s in (sc or {}).items()]


def hue_scene(sid):
    c = cfg(); sc = http("GET", f"http://{c['hue_bridge']}/api/{c['hue_user']}/scenes/{sid}", timeout=4)
    group = sc.get("group") or "0"
    return http("PUT", f"http://{c['hue_bridge']}/api/{c['hue_user']}/groups/{group}/action", {"scene": sid}, timeout=4)


# ---------------------------------------------------------------- Govee (cloud)
GOVEE = "https://openapi.api.govee.com/router/api/v1"


def govee_devices():
    c = cfg()
    if not c["govee_key"]:
        return []
    d = http("GET", GOVEE + "/user/devices", headers={"Govee-API-Key": c["govee_key"]}, timeout=8)
    out = []
    for dev in d.get("data", []) or []:
        out.append({"id": f"govee:{dev.get('sku')}:{dev.get('device')}", "name": dev.get("deviceName", dev.get("device")), "backend": "govee", "on": None, "brightness": None, "color": None, "room": "", "sku": dev.get("sku"), "mac": dev.get("device")})
    return out


def govee_set(sku, mac, on=None, brightness=None, color=None):
    c = cfg(); out = []
    def send(cap_type, instance, value):
        body = {"requestId": str(int(time.time() * 1000)), "payload": {"sku": sku, "device": mac, "capability": {"type": cap_type, "instance": instance, "value": value}}}
        out.append(http("POST", GOVEE + "/device/control", body, headers={"Govee-API-Key": c["govee_key"]}, timeout=8))
    if on is not None:
        send("devices.capabilities.on_off", "powerSwitch", 1 if on else 0)
    if brightness is not None:
        send("devices.capabilities.range", "brightness", max(1, min(100, int(brightness))))
    rgb = parse_color(color)
    if rgb:
        send("devices.capabilities.color_setting", "colorRgb", (rgb[0] << 16) + (rgb[1] << 8) + rgb[2])
    return out


# ---------------------------------------------------------------- Kasa / Tapo (python-kasa, optional)
def _kasa_run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def kasa_devices():
    c = cfg()
    if not (c["kasa_discover"] or c["kasa_hosts"]):
        return []
    try:
        import kasa
    except Exception:
        CACHE["kasa_note"] = "pip install python-kasa to control Kasa / Tapo plugs and bulbs"
        return []

    async def find():
        devs = {}
        if c["kasa_discover"]:
            try:
                devs.update(await kasa.Discover.discover(timeout=3))
            except Exception:
                pass
        for host in c["kasa_hosts"]:
            try:
                devs[host] = await kasa.Discover.discover_single(host, timeout=3)
            except Exception:
                pass
        out = []
        for host, d in devs.items():
            try:
                await d.update()
                bri = None
                if getattr(d, "is_dimmable", False) or getattr(d, "has_emeter", False) is False and hasattr(d, "brightness"):
                    bri = getattr(d, "brightness", None)
                out.append({"id": f"kasa:{host}", "name": d.alias or host, "backend": "kasa", "on": bool(d.is_on), "brightness": bri, "color": None, "room": "", "host": host})
            except Exception:
                pass
        return out
    try:
        return _kasa_run(find())
    except Exception as e:
        CACHE["kasa_note"] = f"kasa discovery failed: {str(e)[:60]}"
        return []


def kasa_set(host, on=None, brightness=None, color=None):
    import kasa

    async def run():
        d = await kasa.Discover.discover_single(host, timeout=4)
        await d.update()
        if on is not None:
            await (d.turn_on() if on else d.turn_off())
        if brightness is not None and hasattr(d, "set_brightness"):
            await d.set_brightness(max(1, min(100, int(brightness))))
        rgb = parse_color(color)
        if rgb and hasattr(d, "set_hsv"):
            import colorsys
            hh, ss, vv = colorsys.rgb_to_hsv(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
            await d.set_hsv(int(hh * 360), int(ss * 100), int(vv * 100))
        return {"on": d.is_on}
    return _kasa_run(run())


# ---------------------------------------------------------------- routes
def all_devices(force=False):
    with CACHE["lock"]:
        if not force and time.time() - CACHE["t"] < 20:
            return CACHE["devices"]
        devs, errors = [], {}
        for name, fn in (("hue", hue_devices), ("govee", govee_devices), ("kasa", kasa_devices)):
            try:
                devs += fn()
            except Exception as e:
                errors[name] = str(e)[:80]
        CACHE.update(devices=devs, t=time.time(), errors=errors)
        return devs


def find_device(key):
    key = str(key or "").lower().strip()
    devs = all_devices()
    for d in devs:
        if d["id"].lower() == key:
            return d
    for d in devs:
        if key and key in d["name"].lower():
            return d
    return None


def get_devices(h, q, b):
    devs = all_devices(force=q.get("refresh") == "1"); c = cfg()
    return {"ok": True, "devices": devs, "errors": CACHE.get("errors", {}), "backends": {"hue": bool(c["hue_bridge"] and c["hue_user"]), "govee": bool(c["govee_key"]), "kasa": bool(c["kasa_discover"] or c["kasa_hosts"])}, "note": CACHE["kasa_note"]}


def post_home2(h, q, b):
    if b.get("scene"):
        return post_scene(h, q, {"scene": b["scene"]})
    d = find_device(b.get("device"))
    if not d:
        names = ", ".join(x["name"] for x in all_devices()[:8]) or "none found"
        raise ValueError(f"no device called {b.get('device')!r}; known: {names}")
    on, bri, col = b.get("on"), b.get("brightness"), b.get("color")
    if d["backend"] == "hue":
        hue_set(d["id"].split(":", 1)[1], on, bri, col)
    elif d["backend"] == "govee":
        govee_set(d["sku"], d["mac"], on, bri, col)
    elif d["backend"] == "kasa":
        kasa_set(d["host"], on, bri, col)
    CACHE["t"] = 0
    what = ", ".join(x for x in [("on" if on else "off") if on is not None else "", f"{bri}%" if bri is not None else "", str(col) if col else ""] if x)
    return {"ok": True, "did": f"{d['name']} {what}".strip(), "device": d["id"]}


def get_scenes(h, q, b):
    try:
        return {"ok": True, "scenes": hue_scenes()}
    except Exception as e:
        return {"ok": True, "scenes": [], "error": str(e)[:80]}


def post_scene(h, q, b):
    key = str(b.get("scene", "")).lower()
    for s in hue_scenes():
        if s["id"].lower() == key or key in s["name"].lower():
            hue_scene(s["id"].split(":", 1)[1]); return {"ok": True, "did": f"scene {s['name']}"}
    raise ValueError(f"no scene called {b.get('scene')!r}")


def get_status(h, q, b):
    c = cfg(); devs = all_devices()
    return {"ok": True, "hue": {"configured": bool(c["hue_bridge"] and c["hue_user"]), "bridge": c["hue_bridge"], "lights": len([d for d in devs if d["backend"] == "hue"])},
            "govee": {"configured": bool(c["govee_key"]), "devices": len([d for d in devs if d["backend"] == "govee"])},
            "kasa": {"configured": bool(c["kasa_discover"] or c["kasa_hosts"]), "devices": len([d for d in devs if d["backend"] == "kasa"]), "note": CACHE["kasa_note"]}}


ROUTES = {("GET", "/home2/devices"): get_devices, ("POST", "/home2"): post_home2, ("GET", "/home2/scenes"): get_scenes, ("POST", "/home2/scene"): post_scene,
          ("POST", "/home2/hue/pair"): post_hue_pair, ("GET", "/home2/status"): get_status}
