"""SAMURAI Browser Agent — a real browser the brain can drive, step by step.  Port 9600.

POST /browser {"cmd": "open|read|links|click|type|find|back|screenshot|close|headed|findmy", "arg": "..."}
  headed      arg = on|off                    show the browser window (sign in to Google etc.), persisted in config browser.headless
  findmy      arg = locate|ring|status        Google Find My Device through the signed-in profile -> {needs_login, devices, last_seen, address, rang}
  open        arg = url                       -> {"title"}
  read                                        -> {"title", "url", "text"}  (readable page text, trimmed)
  links                                       -> {"links": [{"text", "href"}]}
  click       arg = visible text of a link/button (or "nth:3")
  type        arg = "field label or placeholder | text"   (press Enter if text ends with "\\n")
  find        arg = text                       -> {"found", "context"}
  screenshot                                   -> {"path"}  (data/browser/*.png, served by GET /browser/file?path=)
GET  /browser/status

Needs:  pip install playwright && python -m playwright install chromium
config.json "browser": {"headless": false}  shows the window on your PC so you can watch it work.
The browser keeps a PERSISTENT profile in data/browser-profile (config browser.profile_dir): sign in once, it stays signed in.
Run: python samurai_browser.py
"""
import os, urllib.parse, re, sys, threading, time
from http.server import HTTPServer   # single-threaded on purpose: Playwright's sync API is bound to one thread

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import maybe_wrap_tls, bind_host, JSONHandler, PORTS, DATA, load_config, save_config

PORT = PORTS.get("browser", 9600)
if "--port" in sys.argv:
    PORT = int(sys.argv[sys.argv.index("--port") + 1])
SHOTS = os.path.join(DATA, "browser")
LOCK = threading.Lock()
_b = {"pw": None, "browser": None, "page": None, "started": 0}


def page():
    """Lazily start Playwright + Chromium on first use (keeps startup instant)."""
    if _b["page"] and not _b["page"].is_closed():
        return _b["page"]
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise ValueError("pip install playwright && python -m playwright install chromium")
    headless = bool(load_config().get("browser", {}).get("headless", True))
    exe = os.environ.get("SAMURAI_CHROMIUM") or (None if not os.path.exists("/opt/pw-browsers/chromium") else "/opt/pw-browsers/chromium")
    if _b["pw"] is None:
        _b["pw"] = sync_playwright().start()
    kw = {"headless": headless, "viewport": {"width": 1280, "height": 800}, "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SAMURAI/1.0"}
    if exe:
        kw["executable_path"] = exe
    profile = profile_dir()
    os.makedirs(profile, exist_ok=True)
    try:
        ctx = _b["pw"].chromium.launch_persistent_context(profile, **kw)     # persistent: sign-ins (Google etc.) survive restarts
    except Exception as e:
        raise ValueError(f"chromium failed to start ({str(e)[:80]}) — run: python -m playwright install chromium")
    _b["browser"] = ctx
    _b["page"] = ctx.pages[0] if ctx.pages else ctx.new_page()
    _b["page"].set_default_timeout(15000)
    _b["started"] = time.time()
    return _b["page"]


def profile_dir():
    d = load_config().get("browser", {}).get("profile_dir") or ""
    return os.path.expanduser(d) if d else os.path.join(DATA, "browser-profile")


def close_browser():
    try:
        _b["browser"] and _b["browser"].close()
    except Exception:
        pass
    _b.update(browser=None, page=None)


FMD_URL = "https://www.google.com/android/find"


def findmy(action):
    """Google Find My Device in the signed-in profile. Every step is best effort: Google's DOM changes, so nothing here raises on a missing element."""
    action = (action or "status").lower()
    out = {"ok": True, "action": action, "needs_login": False, "devices": [], "last_seen": "", "address": "", "rang": False, "detail": ""}
    pg = page()
    try:
        pg.goto(FMD_URL, wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        out.update(error=f"could not open Find My Device: {str(e)[:80]}", title="", url=pg.url)
        return out
    try:
        pg.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass
    out["url"], out["title"] = pg.url, pg.title()
    signed_out = "accounts.google.com" in pg.url or "signin" in pg.url.lower() or "/find/about" in pg.url
    if not signed_out:
        try:                                             # the marketing page shows a "Sign in" link instead of the device list
            signed_out = pg.get_by_role("link", name=re.compile(r"^sign in$", re.I)).first.is_visible(timeout=1500)
        except Exception:
            signed_out = False
    if signed_out:
        out.update(needs_login=True, detail="sign in to Google in the browser window (control panel → BROWSER → SHOW WINDOW), then try again")
        return out
    try:
        txt = pg.evaluate("() => document.body.innerText") or ""
    except Exception:
        txt = ""
    lines = [l.strip() for l in txt.splitlines() if l.strip()]
    for i, l in enumerate(lines):
        if re.search(r"last seen|last known|last online|\bago\b", l, re.I) and not out["last_seen"]:
            out["last_seen"] = l[:160]
        if re.search(r"\b\d{1,5} [A-Z][\w .'-]+ (Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Blvd|Drive|Dr|Way|Nagar|Layout|Marg)\b", l) and not out["address"]:
            out["address"] = l[:160]
    try:                                                 # device names: list items / buttons that look like a device chooser
        names = pg.evaluate("""() => { const out = []; const seen = new Set();
            for (const el of document.querySelectorAll('[role=listitem], [role=option], [role=button], li, h2, h3')) { const t = (el.innerText || '').trim().split('\n')[0];
              if (t && t.length < 40 && /phone|pixel|galaxy|oneplus|xiaomi|redmi|realme|oppo|vivo|motorola|nothing|watch|tablet|tab |buds|android/i.test(t) && !seen.has(t)) { seen.add(t); out.push(t); } }
            return out.slice(0, 8); }""") or []
        out["devices"] = names
    except Exception:
        pass
    if action == "ring":
        try:
            btn = pg.get_by_role("button", name=re.compile(r"play sound|ring", re.I)).first
            btn.wait_for(state="visible", timeout=10000)
            btn.click(timeout=5000)
            out.update(rang=True, detail="asked Google to ring the device for 5 minutes")
            try:
                pg.wait_for_timeout(1500)
            except Exception:
                pass
        except Exception as e:
            out.update(rang=False, detail=f"no 'Play sound' button found: {str(e)[:60]}")
    if not out["devices"] and not out["needs_login"] and not out.get("error"):
        out["detail"] = out["detail"] or "page opened but no device list found (Google may show a consent screen first — open the browser window)"
    return out


def readable_text(pg, limit=8000):
    txt = pg.evaluate("""() => { const kill = ['script','style','noscript','svg','nav','footer','header','aside'];
        const clone = document.body.cloneNode(true); clone.querySelectorAll(kill.join(',')).forEach(e => e.remove());
        const main = clone.querySelector('main, article, [role=main]') || clone; return main.innerText; }""")
    txt = re.sub(r"[ \t]+", " ", txt or ""); txt = re.sub(r"\n{2,}", "\n", txt).strip()
    return txt[:limit]


def do(cmd, arg):
    arg = (arg or "").strip()
    if cmd == "close":
        close_browser()
        return {"ok": True, "did": "browser closed"}
    if cmd == "headed":
        on = str(arg).lower() in ("on", "1", "true", "show", "yes")
        cfg = load_config(); cfg.setdefault("browser", {})["headless"] = not on; save_config(cfg)
        close_browser()
        try:
            page()
        except ValueError as e:
            return {"ok": False, "error": str(e), "headless": not on}
        return {"ok": True, "did": "browser window " + ("shown" if on else "hidden"), "headless": not on}
    if cmd == "findmy":
        res = findmy(arg)
        res["did"] = res.get("detail") or ("Find My Device: " + ", ".join(res["devices"]) if res["devices"] else "Find My Device opened")
        return res
    pg = page()
    if cmd == "open":
        if not arg:
            raise ValueError("url required")
        if not arg.startswith(("http://", "https://")):
            arg = "https://" + arg
        pg.goto(arg, wait_until="domcontentloaded")
        try:
            pg.wait_for_load_state("networkidle", timeout=6000)
        except Exception:
            pass
        return {"ok": True, "did": f"Opened {pg.title() or arg}", "title": pg.title(), "url": pg.url}
    if cmd == "read":
        return {"ok": True, "title": pg.title(), "url": pg.url, "text": readable_text(pg)}
    if cmd == "links":
        links = pg.evaluate("""() => [...document.querySelectorAll('a[href]')].slice(0,80).map(a => ({text: (a.innerText||'').trim().slice(0,80), href: a.href})).filter(l => l.text)""")
        return {"ok": True, "links": links}
    if cmd == "click":
        if not arg:
            raise ValueError("text required")
        m = re.match(r"nth:(\d+)$", arg)
        if m:
            links = pg.query_selector_all("a[href]")
            i = int(m.group(1))
            if i >= len(links):
                raise ValueError("no such link")
            links[i].click()
        else:
            pat = re.compile(re.escape(arg), re.I)
            target = None
            for cand in (pg.get_by_role("link", name=pat), pg.get_by_role("button", name=pat), pg.get_by_text(pat)):
                for i in range(min(cand.count(), 12)):
                    el = cand.nth(i)
                    try:
                        if el.is_visible():
                            target = el; break
                    except Exception:
                        continue
                if target:
                    break
            if target is None:
                raise ValueError(f"nothing visible on the page says '{arg}'")
            target.click(timeout=8000)
        try:
            pg.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:
            pass
        return {"ok": True, "did": f"Clicked {arg} — now on {pg.title()}", "title": pg.title(), "url": pg.url}
    if cmd == "type":
        if "|" not in arg:
            raise ValueError("arg must be 'field | text'")
        field, text = [x.strip() for x in arg.split("|", 1)]
        enter = text.endswith("\\n")
        text = text[:-2] if enter else text
        loc = None
        for finder in (lambda: pg.get_by_label(re.compile(re.escape(field), re.I)).first,
                       lambda: pg.get_by_placeholder(re.compile(re.escape(field), re.I)).first,
                       lambda: pg.locator(f"input[name*='{field}' i], textarea[name*='{field}' i]").first,
                       lambda: pg.get_by_role("searchbox").first, lambda: pg.get_by_role("textbox").first):
            try:
                cand = finder()
                if cand.count():
                    loc = cand; break
            except Exception:
                continue
        if loc is None:
            raise ValueError(f"no field matching '{field}'")
        loc.fill(text)
        if enter:
            loc.press("Enter")
            try:
                pg.wait_for_load_state("domcontentloaded", timeout=8000)
            except Exception:
                pass
        return {"ok": True, "did": f"Typed into {field}", "title": pg.title(), "url": pg.url}
    if cmd == "find":
        txt = readable_text(pg, 200000)
        i = txt.lower().find(arg.lower())
        return {"ok": True, "found": i >= 0, "context": txt[max(0, i - 200):i + 300] if i >= 0 else ""}
    if cmd == "back":
        pg.go_back()
        return {"ok": True, "did": f"Back to {pg.title()}", "title": pg.title(), "url": pg.url}
    if cmd == "click_at":
        x, y = [float(v) for v in arg.split(",")[:2]]
        pg.mouse.click(x, y)
        try:
            pg.wait_for_load_state("domcontentloaded", timeout=3000)
        except Exception:
            pass
        return {"ok": True, "did": f"Clicked {int(x)},{int(y)}", "title": pg.title(), "url": pg.url}
    if cmd == "key":
        pg.keyboard.press(arg or "Enter")
        return {"ok": True, "did": f"Key {arg}", "title": pg.title(), "url": pg.url}
    if cmd == "scroll":
        pg.mouse.wheel(0, int(arg or 600))
        return {"ok": True, "did": "Scrolled"}
    if cmd == "view":
        return {"ok": True, "jpeg": pg.screenshot(type="jpeg", quality=55), "title": pg.title(), "url": pg.url}
    if cmd == "screenshot":
        os.makedirs(SHOTS, exist_ok=True)
        path = os.path.join(SHOTS, time.strftime("web-%Y%m%d-%H%M%S.png"))
        pg.screenshot(path=path)
        return {"ok": True, "path": path, "did": "Page captured"}
    raise ValueError("unknown browser command")


def post_browser(h, q, b):
    with LOCK:
        try:
            res = do(b.get("cmd", ""), b.get("arg", ""))
        except Exception as e:                                   # a closed context (crash, headed/headless switch): relaunch once and retry
            if "has been closed" not in str(e):
                raise
            for k in ("page", "ctx", "context", "browser"):
                if k in _b:
                    _b[k] = None
            res = do(b.get("cmd", ""), b.get("arg", ""))
    print(f"[SAMURAI-WEB] {b.get('cmd')} {str(b.get('arg', ''))[:50]} -> {res.get('did') or res.get('title') or 'ok'}")
    return res


def get_view(h, q, b):
    """Live JPEG of the current page for the HUD's browser widget (blank frame when nothing is open)."""
    with LOCK:
        if not (_b["page"] and not _b["page"].is_closed()):
            h.send_bytes(BLANK_JPEG, "image/jpeg", extra={"X-Title": "no page", "Cache-Control": "no-store"})
            return None
        res = do("view", "")
    h.send_bytes(res["jpeg"], "image/jpeg", extra={"X-Title": urllib.parse.quote(res["title"][:80]), "X-Url": urllib.parse.quote(res["url"][:200]), "Cache-Control": "no-store"})
    return None


BLANK_JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbd3ffd9")


def get_status(h, q, b):
    try:
        import playwright  # noqa
        ready = True
    except ImportError:
        ready = False
    return {"ok": True, "playwright": ready, "open": bool(_b["page"] and not _b["page"].is_closed()), "url": _b["page"].url if _b["page"] and not _b["page"].is_closed() else None,
            "headless": bool(load_config().get("browser", {}).get("headless", True)), "profile": profile_dir()}


def get_file(h, q, b):
    p = os.path.abspath(q.get("path", ""))
    if not p.startswith(SHOTS + os.sep) or not os.path.exists(p):
        raise ValueError("not allowed")
    with open(p, "rb") as f:
        h.send_bytes(f.read(), "image/png")
    return None


class Handler(JSONHandler):
    TAG = "SAMURAI-WEB"
    ROUTES = {("POST", "/browser"): post_browser, ("GET", "/browser/status"): get_status, ("GET", "/browser/file"): get_file, ("GET", "/browser/view"): get_view}


if __name__ == "__main__":
    print(f"[SAMURAI] Browser agent on http://localhost:{PORT}/browser")
    maybe_wrap_tls(HTTPServer((bind_host(), PORT), Handler)).serve_forever()
