"""Tests for the premium TTS engines, the phone relay / pairing routes, backup + restore, update check, auth status and https.

    .venv/bin/python tests/voice_phone_test.py
Starts its own TTS sidecar (:9210, paid engines pointed at a fake backend) and panel (:9010), then a second TTS on https (:9211).
Needs no keys and no network except the GitHub releases API (skipped gracefully when offline).
"""
import io, json, os, shutil, ssl, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "servers"))
PY = sys.executable
ORIGIN = {"Origin": "http://localhost:8080", "Content-Type": "application/json"}
FAKE_PORT, TTS_PORT, PANEL_PORT, TLS_PORT = 9209, 9210, 9010, 9211
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{(' — ' + str(detail)[:120]) if detail else ''}")


class Fake(BaseHTTPRequestHandler):
    """Pretends to be ElevenLabs / OpenAI / Cartesia / Azure: records the request, answers 'mp3' bytes."""
    seen = []

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        Fake.seen.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        if b"FAILPLEASE" in body:
            self.send_response(401); self.end_headers(); self.wfile.write(b'{"detail":"bad key"}'); return
        self.send_response(200); self.send_header("Content-Type", "audio/mpeg"); self.end_headers(); self.wfile.write(b"ID3fake-mp3-bytes")

    def log_message(self, *a):
        pass


def get(url, headers=None, raw=False):
    req = urllib.request.Request(url, headers={**ORIGIN, **(headers or {})})
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        data = r.read()
        return (data, dict(r.headers)) if raw else json.loads(data)


def post(url, body, raw=None):
    req = urllib.request.Request(url, method="POST", headers=ORIGIN if raw is None else {"Origin": "http://localhost:8080"}, data=json.dumps(body).encode() if raw is None else raw)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def wait_port(port, secs=20):
    import socket
    for _ in range(secs * 10):
        s = socket.socket(); s.settimeout(0.3)
        try:
            s.connect(("127.0.0.1", port)); return True
        except OSError:
            time.sleep(0.1)
        finally:
            s.close()
    return False


def main():
    work = tempfile.mkdtemp(prefix="samurai-test-")
    # an isolated ROOT for the servers under test: config with fake keys, no LAN
    cfg = {"voice": {"keys": {"elevenlabs": "k-eleven", "openai": "k-openai", "cartesia": "k-cartesia", "azure": "k-azure", "azure_region": "westeurope"}},
           "lan": {"enabled": False, "token": "", "https": False}}
    # servers read config.json from their ROOT (= repo); we run the real repo but override keys via env? No: simplest is a temp copy of servers/ + config
    tmp_root = os.path.join(work, "root"); os.makedirs(os.path.join(tmp_root, "data"))
    shutil.copytree(os.path.join(ROOT, "servers"), os.path.join(tmp_root, "servers"), ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(os.path.join(ROOT, "app"), os.path.join(tmp_root, "app"))
    shutil.copy(os.path.join(ROOT, "VERSION"), tmp_root)
    json.dump(cfg, open(os.path.join(tmp_root, "config.json"), "w"))
    env = dict(os.environ, SAMURAI_TTS_FAKE=f"http://127.0.0.1:{FAKE_PORT}")
    fake = ThreadingHTTPServer(("127.0.0.1", FAKE_PORT), Fake); threading.Thread(target=fake.serve_forever, daemon=True).start()
    procs = [subprocess.Popen([PY, os.path.join(tmp_root, "servers", "samurai_tts_server.py"), "--port", str(TTS_PORT)], env=env, cwd=tmp_root, stdout=open(os.path.join(work, "tts.log"), "w"), stderr=subprocess.STDOUT),
             subprocess.Popen([PY, os.path.join(tmp_root, "servers", "samurai_panel.py"), "--port", str(PANEL_PORT)], cwd=tmp_root, stdout=open(os.path.join(work, "panel.log"), "w"), stderr=subprocess.STDOUT)]
    try:
        check("tts sidecar up", wait_port(TTS_PORT)); check("panel up", wait_port(PANEL_PORT))
        T, P = f"http://localhost:{TTS_PORT}", f"http://localhost:{PANEL_PORT}"
        # ---- engines + voices
        eng = get(T + "/engines")
        check("engines report keys", all(eng.get(e) for e in ("elevenlabs", "openai", "cartesia", "azure")) and eng.get("edge"), eng)
        vs = get(T + "/voices")["voices"]
        check("voices: premium + edge, female first", vs[0]["engine"] == "elevenlabs" and any(v["id"] == "en-US-AvaMultilingualNeural" for v in vs) and any(v["engine"] == "openai" for v in vs), [v["id"] for v in vs[:4]])
        check("voices?engine=openai filters", all(v["engine"] == "openai" for v in get(T + "/voices?engine=openai")["voices"]))
        # ---- each paid engine: request shape
        Fake.seen.clear()
        data, hdr = get(T + "/tts?text=hello+there&engine=elevenlabs&voice=21m00Tcm4TlvDq8ikWAM&rate=%2B10%25", raw=True)
        s = Fake.seen[-1]; body = json.loads(s["body"])
        check("elevenlabs request", data.startswith(b"ID3") and "/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM" in s["path"] and s["headers"].get("xi-api-key") == "k-eleven" and body["text"] == "hello there" and hdr.get("X-Engine") == "elevenlabs", s["path"])
        data, hdr = get(T + "/tts?text=hi&engine=openai&voice=shimmer", raw=True); s = Fake.seen[-1]; body = json.loads(s["body"])
        check("openai request", s["path"] == "/v1/audio/speech" and s["headers"].get("authorization") == "Bearer k-openai" and body["voice"] == "shimmer" and body["model"] == "gpt-4o-mini-tts", body)
        data, hdr = get(T + "/tts?text=hi&engine=cartesia", raw=True); s = Fake.seen[-1]; body = json.loads(s["body"])
        check("cartesia request", s["path"] == "/tts/bytes" and s["headers"].get("x-api-key") == "k-cartesia" and body["transcript"] == "hi" and body["output_format"]["container"] == "mp3", body)
        data, hdr = get(T + "/tts?text=hi+%26+bye&engine=azure&voice=en-US-EmmaMultilingualNeural&rate=-5%25", raw=True); s = Fake.seen[-1]
        check("azure request (ssml, key, format)", s["path"] == "/cognitiveservices/v1" and s["headers"].get("ocp-apim-subscription-key") == "k-azure" and b"<voice name='en-US-EmmaMultilingualNeural'>" in s["body"] and b"hi &amp; bye" in s["body"] and b"rate='-5%'" in s["body"], s["body"][:120])
        # voice id picks the engine without engine=
        get(T + "/tts?text=auto&voice=nova", raw=True); check("voice id selects engine", json.loads(Fake.seen[-1]["body"]).get("voice") == "nova")
        # backend failure -> clear 502 json
        try:
            get(T + "/tts?text=FAILPLEASE&engine=openai"); check("engine failure reported", False)
        except urllib.error.HTTPError as e:
            d = json.loads(e.read()); check("engine failure reported", e.code == 502 and d["engine"] == "openai" and "HTTP 401" in d["error"], d)
        # ---- phone + relay
        ph = get(P + "/phone"); check("phone: off when LAN off", ph["ok"] and ph["enabled"] is False and ph["links"] == [])
        lan = post(P + "/panel/lan", {"on": True, "https": True})
        check("lan on + https: cert created", lan["ok"] and lan["enabled"] and lan["https"] and lan["links"] and lan["links"][0].startswith("https://"), lan)
        crt = os.path.join(tmp_root, "data", "tls", "samurai.crt"); check("certificate files exist", os.path.exists(crt) and os.path.exists(crt.replace(".crt", ".key")))
        time.sleep(1)
        ph = get(P + "/phone"); check("phone: QR svg + companion link", ph["enabled"] and "<svg" in ph["qr"] and "companion=1" in ph["links"][0] and ph["cert_url"] == "/phone/cert", ph["links"])
        pem, _ = get(P + "/phone/cert", raw=True); check("certificate download", pem.startswith(b"-----BEGIN CERTIFICATE-----"))
        tok = lan["token"]
        r = post(P + "/remote/command", {"text": "lights on", "speak_on": "phone"}); check("relay: phone posts command", r["ok"] and r["id"], r)
        nx = get(P + "/remote/next"); check("relay: pc takes command", nx["command"] and nx["command"]["text"] == "lights on" and nx["command"]["speak_on"] == "phone", nx)
        check("relay: queue empty after take", get(P + "/remote/next")["command"] is None)
        out = {}
        def waiter(): out["r"] = get(P + f"/remote/reply?id={r['id']}")
        th = threading.Thread(target=waiter); th.start(); time.sleep(0.5)
        post(P + "/remote/reply", {"id": r["id"], "text": "Lights on.", "focus": "home"}); th.join(10)
        check("relay: long-poll wakes with the reply", out.get("r", {}).get("reply", {}).get("text") == "Lights on." and out["r"]["reply"]["focus"] == "home", out.get("r"))
        check("relay: reply timeout returns null", get(P + "/remote/reply?id=nope&wait=0.3")["reply"] is None)
        # token gate on the relay for a non-local client cannot be exercised from 127.0.0.1; the JSONHandler gate is covered by smoke tests
        post(P + "/panel/lan", {"on": False})
        # ---- backup / restore / update / version / logs
        json.dump({"facts": ["likes tea"]}, open(os.path.join(tmp_root, "data", "memory.json"), "w"))
        zb, hdr = get(P + "/backup", raw=True); z = zipfile.ZipFile(io.BytesIO(zb)); names = z.namelist()
        check("backup zip has config, memory, VERSION", "config.json" in names and "data/memory.json" in names and "VERSION" in names and "attachment" in hdr.get("Content-Disposition", ""), names)
        os.remove(os.path.join(tmp_root, "data", "memory.json"))
        rr = post(P + "/restore", None, raw=zb); check("restore puts files back", rr.get("ok") and rr["restored"] >= 2 and os.path.exists(os.path.join(tmp_root, "data", "memory.json")), rr)
        bad = post(P + "/restore", None, raw=b"not a zip"); check("restore rejects junk", bad.get("ok") is False and "backup" in bad.get("error", ""), bad)
        evil = io.BytesIO(); zipfile.ZipFile(evil, "w").writestr("../../evil.txt", "x"); evil.seek(0)
        post(P + "/restore", None, raw=evil.getvalue()); check("restore ignores paths outside the backup set", not os.path.exists(os.path.join(work, "evil.txt")))
        check("version", get(P + "/version")["version"] == open(os.path.join(ROOT, "VERSION")).read().strip())
        up = get(P + "/update"); check("update check", (up["ok"] and up["latest"] and "newer" in up) or (not up["ok"] and "error" in up), up)
        lb, _ = get(P + "/logs/bundle", raw=True); check("log bundle zip", "doctor.json" in zipfile.ZipFile(io.BytesIO(lb)).namelist())
        # ---- auth
        a = get(P + "/auth/status"); check("auth status shape", "claude" in a and "gemini" in a and "logged_in" in a["claude"] and "login" in a, {k: a[k].get("detail") for k in ("claude", "gemini")})
        check("auth login validates tool", post(P + "/auth/login", {"tool": "nope"}).get("ok") is False)
        # ---- https sidecar: TTS over TLS with the generated cert
        json.dump({"lan": {"enabled": True, "token": tok, "https": True}}, open(os.path.join(tmp_root, "config.json"), "w"))
        p3 = subprocess.Popen([PY, os.path.join(tmp_root, "servers", "samurai_tts_server.py"), "--port", str(TLS_PORT)], cwd=tmp_root, stdout=open(os.path.join(work, "tls.log"), "w"), stderr=subprocess.STDOUT)
        procs.append(p3); check("tls tts up", wait_port(TLS_PORT))
        e2 = get(f"https://localhost:{TLS_PORT}/engines", headers={"X-Samurai-Token": tok}); check("https request served", e2.get("ok") and e2.get("edge"), e2)
        try:
            urllib.request.urlopen(f"http://localhost:{TLS_PORT}/engines", timeout=5); check("plain http refused on tls port", False)
        except Exception as e:
            check("plain http refused on tls port", True, type(e).__name__)
        from samurai_common import allowed_origins
        json.dump({"lan": {"enabled": True, "token": tok, "https": True}, "ui": {"origins": ["http://localhost:8080"]}}, open(os.path.join(ROOT, "config.json.testtmp"), "w"))
        ao = allowed_origins(); check("allowed origins include https variants", "https://localhost:8080" in ao and "https://localhost:9000" in ao)
        os.remove(os.path.join(ROOT, "config.json.testtmp"))
    finally:
        for p in procs:
            p.terminate()
        fake.shutdown()
    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
