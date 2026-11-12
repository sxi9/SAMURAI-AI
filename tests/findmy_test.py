"""Find my phone: panel broadcast/events round trip, /findmy on the add-ons sidecar, the browser agent's findmy command.
Starts its own copies on spare ports (panel 9010, add-ons 9510, browser 9610); needs the venv with playwright for the last part."""
import json, os, subprocess, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
PANEL, ADDONS, BROWSER = 9010, 9510, 9610
HDR = {"Origin": "http://localhost:8080", "Content-Type": "application/json"}
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + (f" — {detail}" if detail and not ok else "")); fails += 0 if ok else 1


def J(port, path, body=None, timeout=90):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode() if body is not None else None, headers=HDR, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "http": e.code, **(json.loads(e.read() or b"{}") if e.headers.get("Content-Type", "").startswith("application/json") else {})}


def wait_port(port, t=40):
    for _ in range(t * 4):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1)
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.25)
    return False


env = {**os.environ, "SAMURAI_PANEL_PORT": str(PANEL), "SAMURAI_BROWSER_PORT": str(BROWSER)}
procs = [subprocess.Popen([PY, os.path.join(ROOT, "servers", "samurai_panel.py"), "--port", str(PANEL), "--no-browser"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
         subprocess.Popen([PY, os.path.join(ROOT, "servers", "samurai_addons.py"), "--port", str(ADDONS)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
         subprocess.Popen([PY, os.path.join(ROOT, "servers", "samurai_browser.py"), "--port", str(BROWSER)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)]
try:
    check("test servers up", wait_port(PANEL) and wait_port(ADDONS) and wait_port(BROWSER))
    # ---- relay broadcast / events
    e0 = J(PANEL, "/remote/events?since=0"); check("events: empty at start", e0["ok"] and e0["events"] == [] and e0["pages"] >= 1, e0)
    b = J(PANEL, "/remote/broadcast", {"kind": "ring", "text": "SAMURAI is looking for you"}); check("broadcast counts the polling page", b["ok"] and b["pages"] >= 1, b)
    e1 = J(PANEL, "/remote/events?since=0"); check("events: ring delivered", any(e["kind"] == "ring" for e in e1["events"]), e1)
    e2 = J(PANEL, "/remote/events?since=" + str(e1["now"])); check("events: since filter", e2["events"] == [], e2)
    pk = J(PANEL, "/remote/events?since=0&peek=1"); check("peek does not register a page", pk["ok"] and "pages" in pk)
    # ---- findmy status + ring (no ntfy, companion page = this test's polls, Google via the browser agent)
    st = J(ADDONS, "/findmy/status"); check("findmy status shape", st["ok"] and set(st) >= {"ntfy", "companion_pages", "google_enabled", "google"}, st)
    check("findmy status counts the companion page", st["companion_pages"] >= 1, st)
    r = J(ADDONS, "/findmy", {"action": "ring"}); check("findmy ring ok", r["ok"] and r["action"] == "ring" and isinstance(r["sent"], list), r)
    check("ring reaches the companion page", "companion" in r["sent"], r)
    check("ring notes ntfy missing", "ntfy" in r["note"] and "ntfy" not in r["sent"], r["note"])
    ev = J(PANEL, "/remote/events?since=0"); check("ring event visible to pages", any(e["kind"] == "ring" and "looking" in e["text"] for e in ev["events"]))
    g = r.get("google"); check("google result present (needs_login / error / devices), never a crash", isinstance(g, dict) and ("needs_login" in g or "error" in g), g)
    if isinstance(g, dict) and not g.get("error"):
        print("      google:", {k: g.get(k) for k in ("needs_login", "url", "title", "detail")})
    bad = J(ADDONS, "/findmy", {"action": "fly"}); check("bad action rejected", not bad["ok"])
    # ---- browser agent: persistent profile + status + headed toggle (headless stays true here: no display)
    bs = J(BROWSER, "/browser/status"); check("browser status reports profile + headless", bs["ok"] and "headless" in bs and bs["profile"].endswith("browser-profile"), bs)
    check("profile directory created", os.path.isdir(bs["profile"]))
    op = J(BROWSER, "/browser", {"cmd": "open", "arg": "https://example.com"}); check("open still works on the persistent profile", op.get("ok") and "Example" in (op.get("title") or ""), op)
    vw = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{BROWSER}/browser/view", headers=HDR), timeout=20); check("view still works", vw.headers.get("Content-Type") == "image/jpeg" and len(vw.read()) > 1000)
    fm = J(BROWSER, "/browser", {"cmd": "findmy", "arg": "status"}); check("browser findmy command answers", fm.get("ok") and ("needs_login" in fm), fm)
    hd = J(BROWSER, "/browser", {"cmd": "headed", "arg": "off"}); check("headed off keeps the browser usable", hd.get("ok") and hd.get("headless") is True, hd)
    cfg = json.load(open(os.path.join(ROOT, "config.json"))); check("headed toggle persisted in config", cfg.get("browser", {}).get("headless") is True)
    # ---- google disabled path
    cfg.setdefault("findmy", {})["google"] = False; json.dump(cfg, open(os.path.join(ROOT, "config.json"), "w"), indent=2)
    r2 = J(ADDONS, "/findmy", {"action": "locate"}); check("locate with google disabled: ok + note", r2["ok"] and r2["google"] is None and "disabled" in r2["note"], r2)
    cfg["findmy"]["google"] = True; json.dump(cfg, open(os.path.join(ROOT, "config.json"), "w"), indent=2)
finally:
    for p in procs:
        p.terminate()
    try:
        J(BROWSER, "/browser", {"cmd": "close"}, timeout=5)
    except Exception:
        pass
print("\n" + ("ALL PASS" if not fails else f"{fails} FAILED")); sys.exit(1 if fails else 0)
