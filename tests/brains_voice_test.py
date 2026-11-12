"""Tests for the brains + voice additions (A5-A9, B3-B7, B11):
agent streaming, MCP server + registration, missions, meter, TTS local engine / styles / realtime session, speech WAKE / ENROLL / WHO / MEETING.

    .venv/bin/python tests/brains_voice_test.py [--real]     (--real also streams one answer through the signed-in Claude Code CLI)

Needs the TTS service on :9200 (for the spoken test phrase) and ffmpeg. Spare ports: agent 9401, tts 9201, speech 9101, fake APIs 9701.
"""
import asyncio, json, os, shutil, stat, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVERS = os.path.join(ROOT, "servers")
sys.path.insert(0, SERVERS)
PY = sys.executable
ORIGIN = {"Origin": "http://localhost:8080", "Content-Type": "application/json"}
REAL = "--real" in sys.argv
FAILS = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{(' · ' + str(detail)[:160]) if detail and not ok else ''}")
    if not ok:
        FAILS.append(name)


def call(method, url, body=None, timeout=30):
    req = urllib.request.Request(url, method=method, headers=ORIGIN, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def wait_port(port, secs=30):
    import socket
    for _ in range(int(secs * 5)):
        s = socket.socket(); s.settimeout(0.3)
        try:
            s.connect(("127.0.0.1", port)); s.close(); return True
        except OSError:
            time.sleep(0.2)
    return False


# ----------------------------------------------------------------------------- a fake claude CLI (stream-json, mcp, missions)
FAKE_CLAUDE = r'''#!/usr/bin/env python3
import json, sys, time
a = sys.argv[1:]
if a[:1] == ["--version"]:
    print("9.9.9 (fake)"); sys.exit(0)
if a[:1] == ["mcp"]:
    if a[1] == "list":
        print("Checking MCP server health...\n\nsamurai: /x/python /x/servers/samurai_mcp.py - ✓ Connected"); sys.exit(0)
    print("ok"); sys.exit(0)
prompt = a[a.index("-p") + 1]
sid = "fake-session-123"
if "stream-json" in a:
    print(json.dumps({"type": "system", "subtype": "init", "session_id": sid})); sys.stdout.flush()
    for w in ["Hello ", "from ", "the ", "fake ", "stream."]:
        print(json.dumps({"type": "stream_event", "session_id": sid, "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": w}}})); sys.stdout.flush()
        time.sleep(0.05)
    print(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "Hello from the fake stream."}, {"type": "tool_use", "name": "Write", "input": {"file_path": "NOTES.md"}}]}, "session_id": sid}))
    print(json.dumps({"type": "result", "subtype": "success", "result": "Hello from the fake stream.", "session_id": sid, "total_cost_usd": 0.0123,
                      "usage": {"input_tokens": 10, "output_tokens": 6}, "modelUsage": {"claude-fake": {}}}))
    sys.exit(0)
print(json.dumps({"result": "whole answer: " + prompt[:20], "session_id": sid}))
'''


def make_fake_claude(d):
    p = os.path.join(d, "claude")
    with open(p, "w") as f:
        f.write(FAKE_CLAUDE)
    os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
    return p


# ----------------------------------------------------------------------------- a fake OpenAI / Azure / ElevenLabs / local voice server
class FakeAPI(BaseHTTPRequestHandler):
    seen = []

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        FakeAPI.seen.append((self.path, dict(self.headers), body))
        if self.path.startswith("/v1/realtime/sessions"):
            out = json.dumps({"id": "sess_1", "model": "gpt-4o-mini-realtime-preview", "client_secret": {"value": "ek_test_123", "expires_at": int(time.time()) + 60}}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out); return
        wav = b"RIFF" + b"\x00" * 40 if "wav" in body.decode("utf-8", "replace") else b"ID3fake-mp3-bytes"
        self.send_response(200); self.send_header("Content-Type", "audio/wav" if wav.startswith(b"RIFF") else "audio/mpeg"); self.send_header("Content-Length", str(len(wav))); self.end_headers(); self.wfile.write(wav)

    def log_message(self, *a):
        pass


def start_fake_api(port):
    srv = ThreadingHTTPServer(("127.0.0.1", port), FakeAPI)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ----------------------------------------------------------------------------- tests
def test_agent(tmp):
    fake = make_fake_claude(tmp)
    env = dict(os.environ, SAMURAI_CLAUDE_CMD=fake)
    env.pop("CLAUDECODE", None)
    p = subprocess.Popen([PY, os.path.join(SERVERS, "samurai_agent_server.py"), "--port", "9401"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        check("agent sidecar up on :9401", wait_port(9401))
        code, d = call("GET", "http://localhost:9401/agent/status")
        check("agent status reports stream + fake claude", d.get("stream") is True and d.get("claude", {}).get("found"), d)
        # streaming: ndjson lines
        req = urllib.request.Request("http://localhost:9401/agent/stream", method="POST", headers=ORIGIN, data=json.dumps({"provider": "claude", "prompt": "hi there", "mode": "chat"}).encode())
        lines = []
        with urllib.request.urlopen(req, timeout=30) as r:
            ctype = r.headers.get("Content-Type")
            for line in r:
                lines.append(json.loads(line))
        deltas = [l["delta"] for l in lines if "delta" in l]
        done = next((l for l in lines if l.get("done")), {})
        check("stream content type", ctype == "application/x-ndjson", ctype)
        check("stream deltas arrive in pieces", len(deltas) == 5 and "".join(deltas) == "Hello from the fake stream.", deltas)
        check("stream done carries text, session, usage, cost", done.get("text") == "Hello from the fake stream." and done.get("session_id") == "fake-session-123" and done.get("cost_usd") == 0.0123 and done.get("usage", {}).get("output_tokens") == 6, done)
        # gemini (missing) falls back to one delta + error text
        code, d = call("POST", "http://localhost:9401/agent/stream", {"provider": "nope", "prompt": "x"})
        check("stream rejects unknown provider", code == 400, d)
        # MCP registration
        code, d = call("GET", "http://localhost:9401/agent/mcp")
        check("GET /agent/mcp lists registration", d.get("registered") is True and d["command"][1].endswith("samurai_mcp.py") and d.get("exists"), d)
        code, d = call("POST", "http://localhost:9401/agent/mcp", {"on": True})
        check("POST /agent/mcp registers", d.get("ok") and "samurai_action" in d.get("did", ""), d)
        code, d = call("POST", "http://localhost:9401/agent/mcp", {"on": False})
        check("POST /agent/mcp off", d.get("ok") and "removed" in d.get("did", ""), d)
        # missions
        code, d = call("POST", "http://localhost:9401/mission", {"goal": "short"})
        check("mission needs a sentence", code == 400, d)
        code, d = call("POST", "http://localhost:9401/mission", {"goal": "organise the workspace notes for the test"})
        check("mission starts", d.get("ok") and d.get("id") and d["log"].endswith(f"mission-{d['id']}.log"), d)
        mid = d.get("id")
        for _ in range(50):
            code, m = call("GET", "http://localhost:9401/mission?id=" + mid)
            if not m.get("mission", {}).get("running"):
                break
            time.sleep(0.2)
        m = m.get("mission", {})
        check("mission finishes with summary + tool log", m.get("code") == 0 and m.get("summary") == "Hello from the fake stream." and "[Write]" in m.get("log", ""), m)
        check("mission log file written", os.path.exists(m.get("log_file", "")), m.get("log_file"))
        code, d = call("GET", "http://localhost:9401/mission")
        check("mission list", any(x["id"] == mid for x in d.get("missions", [])), d)
        # the spoken event reached the events feed
        ev_path = os.path.join(ROOT, "data", "events.json")
        evs = json.load(open(ev_path)) if os.path.exists(ev_path) else []
        mine = [e for e in evs if e.get("source") == "mission" and "organise the workspace" in e.get("text", "")]
        check("mission queued a spoken 'say' event", mine and mine[-1]["kind"] == "say" and "Mission done" in mine[-1]["text"], evs[-1:] if evs else "no events")
        if mine:                                                        # tidy: do not let the HUD speak the test event
            json.dump([e for e in evs if e not in mine], open(ev_path, "w"), indent=2)
        code, d = call("POST", "http://localhost:9401/mission/stop", {})
        check("mission stop with nothing running is a 400", code == 400, d)
        if REAL:
            real_env = dict(os.environ); real_env.pop("CLAUDECODE", None)
            p2 = subprocess.Popen([PY, os.path.join(SERVERS, "samurai_agent_server.py"), "--port", "9402"], env=real_env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
            try:
                wait_port(9402)
                req = urllib.request.Request("http://localhost:9402/agent/stream", method="POST", headers=ORIGIN, data=json.dumps({"provider": "claude", "prompt": "Reply with exactly: streaming works", "mode": "chat"}).encode())
                t0, first, lines = time.time(), None, []
                with urllib.request.urlopen(req, timeout=150) as r:
                    for line in r:
                        if first is None:
                            first = time.time() - t0
                        lines.append(json.loads(line))
                done = next((l for l in lines if l.get("done")), {})
                nd = sum(1 for l in lines if "delta" in l)
                check("REAL claude streams (deltas before done, session id, cost)", nd >= 1 and "streaming works" in done.get("text", "").lower() and done.get("session_id") and done.get("cost_usd") is not None,
                      f"{nd} deltas, first after {first and round(first, 1)}s: {done}")
                print(f"      real claude: {nd} delta(s), first line after {first and round(first, 1)}s, total {done.get('seconds')}s, cost ${done.get('cost_usd')}")
            finally:
                p2.kill()
    finally:
        p.kill()


def test_mcp():
    p = subprocess.Popen([PY, os.path.join(SERVERS, "samurai_mcp.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    def rpc(obj):
        p.stdin.write(json.dumps(obj) + "\n"); p.stdin.flush()
        return json.loads(p.stdout.readline())
    try:
        d = rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}})
        check("mcp initialize", d["result"]["protocolVersion"] == "2024-11-05" and d["result"]["serverInfo"]["name"] == "samurai", d)
        p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); p.stdin.flush()
        d = rpc({"jsonrpc": "2.0", "id": 2, "method": "ping"})
        check("mcp ping (and no reply to the notification)", d["id"] == 2 and d["result"] == {}, d)
        d = rpc({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
        names = [t["name"] for t in d["result"]["tools"]]
        check("mcp tools/list has the six tools", names == ["samurai_action", "samurai_browser", "samurai_docs_search", "samurai_journal_add", "samurai_calendar_add", "samurai_memory_remember"], names)
        check("mcp tool schemas", all("inputSchema" in t and t["inputSchema"]["type"] == "object" for t in d["result"]["tools"]))
        d = rpc({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "samurai_docs_search", "arguments": {"query": "samurai", "k": 2}}})
        text = d["result"]["content"][0]["text"]
        check("mcp tools/call docs_search returns the add-ons answer", "hits" in text or "not running" in text, text[:120])
        d = rpc({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "nope", "arguments": {}}})
        check("mcp unknown tool -> -32602", d.get("error", {}).get("code") == -32602, d)
        d = rpc({"jsonrpc": "2.0", "id": 6, "method": "resources/list"})
        check("mcp unknown method -> -32601", d.get("error", {}).get("code") == -32601, d)
        p.stdin.write("not json\n"); p.stdin.flush()
        d = json.loads(p.stdout.readline())
        check("mcp parse error -> -32700", d.get("error", {}).get("code") == -32700, d)
    finally:
        p.kill()


def test_meter(tmp):
    import samurai_meter as meter
    meter.METER_PATH = os.path.join(tmp, "meter.jsonl")
    meter.load_config = lambda: {"meter": {"monthly_budget_usd": 1.0}}
    check("meter price lookup", meter.price("openai", "gpt-4o-mini") == (0.15, 0.6) and meter.price("claude", "claude-opus-5-5") == (15, 75) and meter.price("ollama", "x") == (0, 0))
    check("meter estimate", meter.estimate("openai", "gpt-4o-mini", 1_000_000, 0) == 0.15)
    d = meter.post_meter(None, {}, {"provider": "openai", "model": "gpt-4o", "input": 100000, "output": 10000})
    check("POST /meter estimates and summarises", abs(d["usd"] - 0.35) < 1e-6 and d["month"]["total_usd"] == 0.35 and not d["month"]["warning"], d)
    d = meter.post_meter(None, {}, {"provider": "claudecode", "model": "claude-fake", "cost_usd": 0.5})
    check("POST /meter keeps a reported cost and warns at 80%", d["usd"] == 0.5 and d["month"]["warning"] and not d["month"]["over_budget"], d)
    d = meter.post_meter(None, {}, {"provider": "elevenlabs", "kind": "tts", "chars": 1000})
    check("POST /meter tts by characters", abs(d["usd"] - 0.18) < 1e-6 and d["month"]["over_budget"], d)
    s = meter.get_meter(None, {"period": "month"}, None)
    check("GET /meter by provider + spoken", set(s["by_provider"]) == {"openai", "claudecode", "elevenlabs"} and s["calls"] == 3 and "over budget" in s["spoken"], s)
    check("GET /meter day/all periods", meter.get_meter(None, {"period": "day"}, None)["calls"] == 3 and meter.get_meter(None, {"period": "all"}, None)["calls"] == 3)
    try:
        meter.post_meter(None, {}, {})
        check("POST /meter needs a provider", False)
    except ValueError:
        check("POST /meter needs a provider", True)
    # through the running add-ons sidecar, if it has the route (services started from this checkout)
    code, d = call("GET", "http://localhost:9500/meter?period=month")
    print(f"      live :9500/meter -> {code} ({'mounted' if code == 200 else 'old add-ons process without the meter route; restart the services'})")


def test_tts(tmp, fake_port):
    import samurai_tts_server as tts
    FakeAPI.seen.clear()
    base = f"http://127.0.0.1:{fake_port}"
    tts.FAKE = base
    cfg = {"keys": {"openai": "sk-test", "azure": "az-test", "azure_region": "eastus", "elevenlabs": "el-test"}, "local_tts_url": base, "local_tts_voice": "tara"}
    tts.vcfg = lambda: cfg

    class H:                                                          # captures send_bytes
        def __init__(self): self.out = None
        def send_bytes(self, data, ctype, code=200, extra=None): self.out = (data, ctype, extra)
    check("engines lists local + styles + realtime", tts.get_engines(None, {}, None)["local"] is True and "whisper" in tts.get_engines(None, {}, None)["styles"] and tts.get_engines(None, {}, None)["realtime"])
    h = H(); tts.get_tts(h, {"text": "hello", "voice": "nova", "engine": "openai", "style": "whisper"}, None)
    body = json.loads(FakeAPI.seen[-1][2])
    check("openai style -> instructions", "Whisper" in body["instructions"] and h.out[2]["X-Style"] == "whisper" and h.out[2]["X-Engine"] == "openai", body)
    h = H(); tts.get_tts(h, {"text": "hello", "voice": "en-US-AvaMultilingualNeural", "engine": "azure", "style": "excited"}, None)
    ssml = FakeAPI.seen[-1][2].decode()
    check("azure style -> mstts:express-as", "express-as style='excited'" in ssml and "xmlns:mstts" in ssml, ssml)
    h = H(); tts.get_tts(h, {"text": "hello", "voice": "en-US-AvaMultilingualNeural", "engine": "azure"}, None)
    check("azure neutral -> no express-as", "express-as" not in FakeAPI.seen[-1][2].decode())
    h = H(); tts.get_tts(h, {"text": "hello", "voice": "21m00Tcm4TlvDq8ikWAM", "engine": "elevenlabs", "style": "calm"}, None)
    vs = json.loads(FakeAPI.seen[-1][2])["voice_settings"]
    check("elevenlabs style -> stability/style", vs["stability"] == 0.7 and vs["style"] == 0.1, vs)
    h = H(); tts.get_tts(h, {"text": "hello", "voice": "en-US-AriaNeural", "engine": "local", "rate": "+10%"}, None)
    path, hdr, raw = FakeAPI.seen[-1]; body = json.loads(raw)
    check("local engine -> OpenAI-style /v1/audio/speech with the configured voice", path == "/v1/audio/speech" and body["voice"] == "tara" and body["speed"] == 1.1 and h.out[1] == "audio/mpeg" and h.out[2]["X-Engine"] == "local", (path, body))
    h = H(); tts.get_tts(h, {"text": "hello", "voice": "tara", "engine": "local", "style": "unknownstyle"}, None)
    check("unknown style falls back to neutral", h.out[2]["X-Style"] == "neutral")
    cfg["local_tts_url"] = ""
    h = H(); tts.get_tts(h, {"text": "hello", "voice": "en-US-AriaNeural", "engine": "local"}, None)
    check("local without a url falls back to edge", h.out is None or h.out[2]["X-Engine"] == "edge")
    d = tts.post_realtime_session(None, {}, {"voice": "coral"})
    sess = json.loads(FakeAPI.seen[-1][2])
    check("POST /realtime/session mints an ephemeral key", d["client_secret"] == "ek_test_123" and d["voice"] == "coral" and sess["voice"] == "coral" and "samurai" in sess["instructions"].lower() and "realtime?model=" in d["url"], d)
    check("realtime session never leaks the real key", "sk-test" not in json.dumps(d) and FakeAPI.seen[-1][1].get("Authorization") == "Bearer sk-test")
    cfg["keys"]["openai"] = ""
    try:
        tts.post_realtime_session(None, {}, {}); check("realtime needs the openai key", False)
    except RuntimeError as e:
        check("realtime needs the openai key", "no API key" in str(e))


def spoken_pcm(tmp, phrase):
    """The phrase spoken by the running TTS service (:9200), as 16 kHz PCM."""
    mp3, pcm = os.path.join(tmp, "p.mp3"), os.path.join(tmp, "p.pcm")
    req = urllib.request.Request("http://localhost:9200/tts?text=" + urllib.request.quote(phrase), headers={"Origin": "http://localhost:8080"})
    with urllib.request.urlopen(req, timeout=60) as r, open(mp3, "wb") as f:
        f.write(r.read())
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", mp3, "-ar", "16000", "-ac", "1", "-f", "s16le", pcm], check=True)
    return open(pcm, "rb").read()


def test_speech(tmp):
    import websockets
    try:
        pcm = spoken_pcm(tmp, "samurai open chrome please")
    except Exception as e:
        check("spoken phrase from :9200 (needs the TTS service + ffmpeg)", False, e); return
    p = subprocess.Popen([PY, os.path.join(SERVERS, "samurai_speech_server.py"), "--port", "9101"], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

    async def feed(ws, data):
        for i in range(0, len(data), 8000):
            await ws.send(data[i:i + 8000])
        await ws.send(b"\x00" * 32000)
        await ws.send("EOF")

    async def collect(ws, secs=12):
        out = []
        try:
            while True:
                out.append(json.loads(await asyncio.wait_for(ws.recv(), secs)))
                secs = 3
        except asyncio.TimeoutError:
            pass
        return out

    async def run():
        async with websockets.connect("ws://localhost:9101") as ws:
            hello = json.loads(await ws.recv())
            check("speech hello carries identity + wake_phrase fields", "identity" in hello and "wake_phrase" in hello, hello)
            await ws.send("WAKE:samurai"); d = json.loads(await ws.recv())
            check("WAKE: sets the phrase through a grammar recogniser", d.get("wake_phrase") == "samurai" and d.get("status") == "grammar", d)
            await feed(ws, pcm); msgs = await collect(ws)
            wakes = [m for m in msgs if m.get("wake")]; finals = [m for m in msgs if m.get("final")]
            heard = " ".join(m["text"] for m in finals)
            check("custom wake phrase detected", wakes and wakes[0].get("phrase") == "samurai", msgs[:3])
            check("transcript still full vocabulary", "chrome" in heard, heard)
            await ws.send("WAKE:"); d = json.loads(await ws.recv())
            check("WAKE: (empty) clears", d.get("status") == "off", d)
            await ws.send("ENROLL:"); d = json.loads(await ws.recv())
            check("ENROLL needs a name", d.get("status") == "name required", d)
            await ws.send("ENROLL:bob"); d = json.loads(await ws.recv())
            have_res = d.get("status") == "listening"
            check("ENROLL degrades without resemblyzer (or listens with it)", d.get("status") in ("unavailable", "listening"), d)
            if have_res:
                await feed(ws, pcm); msgs = await collect(ws)
                check("enrolment stored", any(m.get("enroll") == "bob" and m.get("status") == "ok" for m in msgs), msgs)
            await ws.send("WHO:1"); d = json.loads(await ws.recv())
            check("WHO:1 answers with availability", d.get("who") is True and "available" in d and isinstance(d.get("enrolled"), list), d)
            await feed(ws, pcm); msgs = await collect(ws)
            finals = [m for m in msgs if m.get("final")]
            check("finals tagged with a speaker (unknown without prints)", finals and all("speaker" in m for m in finals) and (have_res or finals[0]["speaker"] == "unknown"), finals)
            await ws.send("WHO:0"); await ws.recv()
            await ws.send("MEETING:on"); d = json.loads(await ws.recv())
            check("MEETING:on opens data/meetings/<date>.txt", d.get("meeting") is True and d.get("file", "").endswith(time.strftime("%Y-%m-%d") + ".txt"), d)
            mfile = d.get("file")
            await feed(ws, pcm); msgs = await collect(ws)
            finals = [m for m in msgs if m.get("final")]
            check("meeting finals flagged meeting:true", finals and all(m.get("meeting") for m in finals), finals)
            txt = open(mfile, encoding="utf-8").read() if mfile and os.path.exists(mfile) else ""
            check("meeting transcript written with timestamps", "--- meeting started ---" in txt and "chrome" in txt and txt.strip().startswith("["), txt[-200:])
            await ws.send("MEETING:off"); d = json.loads(await ws.recv())
            check("MEETING:off", d.get("meeting") is False, d)
            await feed(ws, pcm); msgs = await collect(ws)
            check("after the meeting finals are commands again", any(m.get("final") and not m.get("meeting") for m in msgs), msgs)
    try:
        check("speech server up on :9101", wait_port(9101, 60))
        asyncio.run(run())
    finally:
        p.kill()


def test_js():
    for f in ("app/js/hud-brain.js", "app/js/hud-voice.js"):
        r = subprocess.run(["node", "--check", os.path.join(ROOT, f)], capture_output=True, text=True)
        check(f"node --check {f}", r.returncode == 0, r.stderr)
    src = open(os.path.join(ROOT, "app/js/hud-brain.js"), encoding="utf-8").read()
    check("hud-brain streams agents + meters + missions + summarise + visionCapable", all(k in src for k in ("/stream", "meter(", "mission(goal", "summarise(text", "visionCapable(", "localVisionModel(")))
    src = open(os.path.join(ROOT, "app/js/hud-voice.js"), encoding="utf-8").read()
    check("hud-voice sends style, WAKE:, ENROLL:, WHO:, MEETING: and has realtime", all(k in src for k in ("&style=", "'WAKE:'", "'ENROLL:'", "'WHO:'", "'MEETING:on'", "realtime: {", "onCommand", "realtime/session")))


def main():
    tmp = tempfile.mkdtemp(prefix="samurai-bv-")
    fake = start_fake_api(9701)
    try:
        test_js()
        test_meter(tmp)
        test_tts(tmp, 9701)
        test_mcp()
        test_agent(tmp)
        test_speech(tmp)
    finally:
        fake.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAILED: ' + ', '.join(FAILS)}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
