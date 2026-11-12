"""SAMURAI Agent Sidecar — headless Claude Code / Gemini CLI bridge.

Lets SAMURAI use the official command-line agents as a brain, a web
researcher, or a worker, with NO API key: both CLIs sign in with your
normal subscription / Google login the first time you run them.

  claude  ->  npm install -g @anthropic-ai/claude-code   then run `claude auth login`
  gemini  ->  npm install -g @google/gemini-cli           then run `gemini` once and sign in
             (free-tier Google accounts were moved to Antigravity CLI in June 2026;
              point SAMURAI_GEMINI_CMD at that command if `gemini` is gone)

GET  /agent/status                      -> which CLIs are installed
POST /agent  {"provider": "claude"|"gemini", "prompt": "...",
              "mode": "chat"|"search"|"work", "session_id": "...", "model": "..."}
             -> {"ok": true, "text": "...", "session_id": "..."}
POST /agent/stream  same body        -> one JSON object per line while Claude types (application/x-ndjson):
             {"delta": "..."} ... {"done": true, "text": "...", "session_id": "...", "seconds": n, "usage": {...}, "cost_usd": n}
             ({"error": "..."} on failure; gemini answers whole, as one delta)
GET  /agent/mcp                         -> {"registered": bool, "servers": "...", "command": [...]}  (claude mcp list)
POST /agent/mcp {"on": true|false}      -> registers / removes SAMURAI's MCP server (servers/samurai_mcp.py) with Claude Code,
                                           so `claude` can call SAMURAI's actions, browser, documents, journal, calendar and memory as tools
POST /mission {"goal": "..."}           -> starts a long-running Claude Code task in workspace/ (hours allowed); {"id", "log"}
GET  /mission[?id=]                     -> {"missions": [{id, goal, running, started, finished, code, summary, log}]}
POST /mission/stop {"id": "..."}        -> stops it. When a mission finishes, a spoken event (kind "say", source "mission") is queued
                                           through the add-ons events feed, so the HUD reports it even hours later.

  chat    answer from the model only (no tools)
  search  may use the agent's built-in web search / fetch
  work    may read, create and edit files inside the workspace/ folder
          (config.json agent.allow_bash = true also lets Claude Code run shell commands)

Run: python samurai_agent_server.py        (port 9400, localhost only)
"""
import json, os, shutil, subprocess, sys, threading, time, uuid
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import maybe_wrap_tls, bind_host, JSONHandler, NOWIN, PORTS, ROOT, LOGS, load_config, venv_python

PORT = PORTS["agent"]
WORKSPACE = os.path.join(ROOT, "workspace")
CMD = {
    "claude": os.environ.get("SAMURAI_CLAUDE_CMD", "claude"),
    "gemini": os.environ.get("SAMURAI_GEMINI_CMD", "gemini"),
}
TIMEOUT = {"chat": 120, "search": 300, "work": 600}
STYLE = ("You are the agent behind SAMURAI, a spoken voice assistant. Reply in plain text "
         "with no markdown, no bullet lists and no code fences unless the user asks for code. "
         "Keep answers short enough to be read aloud: one to four sentences for questions, "
         "a brief summary of what you did for tasks.")
INSTALL_HINT = {
    "claude": "install with: npm install -g @anthropic-ai/claude-code  then run `claude auth login`",
    "gemini": "install with: npm install -g @google/gemini-cli  then run `gemini` once to sign in",
}
_status_cache = {"t": 0, "data": None}


def which(provider):
    return shutil.which(CMD[provider])


def status():
    if time.time() - _status_cache["t"] < 60 and _status_cache["data"]:
        return _status_cache["data"]
    out = {"workspace": WORKSPACE}
    for prov in ("claude", "gemini"):
        exe = which(prov)
        info = {"found": bool(exe), "cmd": CMD[prov], "version": None}
        if exe:
            try:
                r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=20,
                                   creationflags=NOWIN, encoding="utf-8", errors="replace")
                info["version"] = (r.stdout or r.stderr).strip().splitlines()[0][:60]
            except Exception as e:
                info["version"] = f"? ({str(e)[:40]})"
        else:
            info["hint"] = INSTALL_HINT[prov]
        out[prov] = info
    _status_cache.update(t=time.time(), data=out)
    return out


def build_cmd(provider, prompt, mode, session_id, model, history, stream=False):
    exe = which(provider)
    if not exe:
        raise ValueError(f"{CMD[provider]} not found — {INSTALL_HINT[provider]}")
    if provider == "claude":
        fmt = ["--output-format", "stream-json", "--include-partial-messages", "--verbose"] if stream else ["--output-format", "json"]
        cmd = [exe, "-p", prompt, *fmt, "--append-system-prompt", STYLE]
        if model:
            cmd += ["--model", model]
        if session_id:
            cmd += ["--resume", session_id]
        if mode == "chat":
            cmd += ["--tools", ""]
        elif mode == "search":
            cmd += ["--tools", "WebSearch", "WebFetch", "--allowedTools", "WebSearch", "WebFetch"]
        else:
            tools = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "WebSearch", "WebFetch"]
            if load_config().get("agent", {}).get("allow_bash") or os.environ.get("SAMURAI_AGENT_ALLOW_BASH") == "1":
                tools.append("Bash")
            cmd += ["--permission-mode", "acceptEdits", "--tools", *tools, "--allowedTools", *tools]
        return cmd
    text = STYLE + "\n\n"
    if history:
        text += "Conversation so far:\n" + "\n".join(
            f"{h.get('role', 'user')}: {h.get('content', '')}" for h in history[-6:]) + "\n\n"
    text += "User: " + prompt
    cmd = [exe, "-p", text, "-o", "json"]
    if model:
        cmd += ["-m", model]
    cmd += ["--approval-mode", "plan" if mode == "chat" else "yolo"]
    return cmd


def run_agent(provider, prompt, mode, session_id=None, model=None, history=None):
    mode = mode if mode in TIMEOUT else "chat"
    os.makedirs(WORKSPACE, exist_ok=True)
    cmd = build_cmd(provider, prompt, mode, session_id, model, history)
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    t0 = time.time()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=TIMEOUT[mode], cwd=WORKSPACE, env=env, creationflags=NOWIN)
    except subprocess.TimeoutExpired:
        raise ValueError(f"{provider} took longer than {TIMEOUT[mode]}s and was stopped")
    raw = (r.stdout or "").strip()
    try:
        data = json.loads(raw[raw.find("{"):]) if "{" in raw else {}
    except json.JSONDecodeError:
        data = {}
    if provider == "claude":
        text, sid = data.get("result") or "", data.get("session_id")
        err = data.get("is_error") or (r.returncode != 0 and not text)
    else:
        text, sid = data.get("response") or "", None
        err = bool(data.get("error")) or (r.returncode != 0 and not text)
    if err or not text:
        detail = (data.get("error") or {}).get("message") if isinstance(data.get("error"), dict) else None
        detail = detail or text or (r.stderr or raw or "no output").strip()[-400:]
        if any(k in detail.lower() for k in ("log in", "login", "auth")):
            detail += f"  — run `{CMD[provider]}` once in a terminal to sign in"
        raise ValueError(detail)
    return {"ok": True, "provider": provider, "mode": mode, "text": text.strip(),
            "session_id": sid, "seconds": round(time.time() - t0, 1)}


def agent_env():
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    return env


class ClientGone(Exception):
    pass


# ----------------------------------------------------------------------------- streaming (A5)
def stream_claude(prompt, mode, session_id, model, emit):
    """Runs Claude Code in stream-json mode; emit({"delta"}) for every text chunk, then once {"done": True, ...} or {"error"}."""
    mode = mode if mode in TIMEOUT else "chat"
    os.makedirs(WORKSPACE, exist_ok=True)
    cmd = build_cmd("claude", prompt, mode, session_id, model, None, stream=True)
    t0, text, sid, final, err = time.time(), "", session_id, None, ""
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
                         cwd=WORKSPACE, env=agent_env(), creationflags=NOWIN)
    timer = threading.Timer(TIMEOUT[mode], p.kill)
    timer.start()
    try:
        for line in p.stdout:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            sid = d.get("session_id") or sid
            if d.get("type") == "stream_event":
                ev = d.get("event") or {}
                if ev.get("type") == "content_block_delta" and (ev.get("delta") or {}).get("type") == "text_delta":
                    chunk = ev["delta"].get("text") or ""
                    if chunk:
                        text += chunk
                        emit({"delta": chunk})
            elif "result" in d:                               # the last line: the whole answer, usage and cost
                final = d
        err = p.stderr.read()
        p.wait()
    finally:
        timer.cancel()
        if p.poll() is None:
            p.kill()
    if final:
        text = final.get("result") or text
        if final.get("is_error"):
            err, text = text or err, ""
    if not text:
        detail = (err or "no output").strip()[-400:]
        if any(k in detail.lower() for k in ("log in", "login", "auth")):
            detail += "  — run `claude` once in a terminal to sign in"
        if time.time() - t0 >= TIMEOUT[mode] - 1:
            detail = f"claude took longer than {TIMEOUT[mode]}s and was stopped"
        emit({"error": detail or "claude returned nothing"})
        return
    used = (final or {}).get("modelUsage") or {}
    emit({"done": True, "text": text.strip(), "session_id": sid, "seconds": round(time.time() - t0, 1), "provider": "claude",
          "usage": (final or {}).get("usage"), "cost_usd": (final or {}).get("total_cost_usd"), "model": next(iter(used), None) or model})


def post_stream(h, q, body):
    provider = body.get("provider", "claude")
    if provider not in CMD:
        raise ValueError("provider must be 'claude' or 'gemini'")
    prompt = (body.get("prompt") or "").strip()[:20000]
    if not prompt:
        raise ValueError("empty prompt")
    h._headers(200, "application/x-ndjson", extra={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    def emit(obj):
        try:
            h.wfile.write((json.dumps(obj) + "\n").encode("utf-8"))
            h.wfile.flush()
        except OSError:
            raise ClientGone()
    print(f"[SAMURAI-AGENT] {provider}/{body.get('mode', 'chat')} stream: {prompt[:80]}")
    try:
        if provider == "claude" and which("claude"):
            stream_claude(prompt, body.get("mode", "chat"), body.get("session_id"), (body.get("model") or "").strip() or None, emit)
        else:                                                   # gemini (or claude missing): the whole answer as one delta
            res = run_agent(provider, prompt, body.get("mode", "chat"), body.get("session_id"), (body.get("model") or "").strip() or None, body.get("history"))
            emit({"delta": res["text"]})
            emit({"done": True, "provider": provider, **{k: res[k] for k in ("text", "session_id", "seconds")}})
    except ClientGone:
        print("[SAMURAI-AGENT] stream client went away")
    except ValueError as e:
        try:
            emit({"error": str(e)})
        except ClientGone:
            pass
    return None


# ----------------------------------------------------------------------------- MCP registration (A6)
MCP_SERVER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samurai_mcp.py")
MCP_TOOLS = "samurai_action, samurai_browser, samurai_docs_search, samurai_journal_add, samurai_calendar_add, samurai_memory_remember"


def mcp_cmd(*args):
    exe = which("claude")
    if not exe:
        raise ValueError("claude not found — " + INSTALL_HINT["claude"])
    r = subprocess.run([exe, "mcp", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90,
                       env=agent_env(), creationflags=NOWIN, cwd=ROOT)
    return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()


def get_mcp(h, q, body):
    code, out = mcp_cmd("list")
    return {"ok": True, "registered": "samurai:" in out, "servers": out[-2000:], "command": [venv_python(), MCP_SERVER],
            "exists": os.path.exists(MCP_SERVER), "tools": MCP_TOOLS.split(", ")}


def post_mcp(h, q, body):
    if body.get("on", True):
        if not os.path.exists(MCP_SERVER):
            raise ValueError("servers/samurai_mcp.py is missing")
        mcp_cmd("remove", "-s", "user", "samurai")
        code, out = mcp_cmd("add", "samurai", "-s", "user", "--", venv_python(), MCP_SERVER)
        if code != 0:
            raise ValueError(out[-300:] or "claude mcp add failed")
        return {"ok": True, "did": "SAMURAI registered as an MCP server for Claude Code (user scope); tools: " + MCP_TOOLS, "output": out[-500:]}
    code, out = mcp_cmd("remove", "-s", "user", "samurai")
    return {"ok": True, "did": "SAMURAI MCP server removed from Claude Code", "output": out[-500:]}


# ----------------------------------------------------------------------------- missions (A9)
MISSIONS = {}
MLOCK = threading.Lock()
MISSION_TIMEOUT = 6 * 3600
MISSION_RULES = ("You are running a long mission for SAMURAI, a voice assistant, while the user is away. Work inside the current folder "
                 "(the SAMURAI workspace). Keep a scratchpad in NOTES.md: the plan, what is done, what is left; update it as you go. "
                 "Finish with a short plain-text summary of the outcome, two to four spoken sentences, no markdown.")


def mission_json(m):
    out = {k: m[k] for k in ("id", "goal", "running", "started", "finished", "code", "summary", "log_file")}
    out["log"] = m["log"][-4000:]
    return out


def say_event(text, source="mission"):
    """Queue a spoken HUD event through the add-ons events feed (data/events.json, polled by the HUD)."""
    try:
        import samurai_automation
        samurai_automation.push_event("say", text, source)
    except Exception as e:
        print(f"[SAMURAI-AGENT] could not queue the event: {e}")


def run_mission(m):
    tools = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "WebSearch", "WebFetch"]
    if load_config().get("agent", {}).get("allow_bash") or os.environ.get("SAMURAI_AGENT_ALLOW_BASH") == "1":
        tools.append("Bash")
    cmd = [which("claude"), "-p", m["goal"], "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
           "--tools", *tools, "--allowedTools", *tools, "--append-system-prompt", MISSION_RULES]
    if m.get("model"):
        cmd += ["--model", m["model"]]
    os.makedirs(LOGS, exist_ok=True)
    os.makedirs(WORKSPACE, exist_ok=True)
    summary, code = "", -1
    try:
        with open(m["log_file"], "w", encoding="utf-8") as lf:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                                 cwd=WORKSPACE, env=agent_env(), creationflags=NOWIN)
            m["proc"] = p
            timer = threading.Timer(MISSION_TIMEOUT, p.kill)
            timer.start()
            for line in p.stdout:
                lf.write(line)
                lf.flush()
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if d.get("type") == "assistant":
                    for blk in (d.get("message") or {}).get("content") or []:
                        if blk.get("type") == "text" and blk.get("text"):
                            m["log"] += blk["text"].strip() + "\n"
                        elif blk.get("type") == "tool_use":
                            m["log"] += f"[{blk.get('name')}] {json.dumps(blk.get('input'))[:160]}\n"
                elif "result" in d:
                    summary = d.get("result") or ""
                    m["session_id"] = d.get("session_id")
                if len(m["log"]) > 60000:
                    m["log"] = m["log"][-40000:]
            p.wait()
            timer.cancel()
            code = p.returncode
    except Exception as e:
        m["log"] += f"\nmission failed to start: {e}\n"
    m.update(running=False, finished=time.time(), code=code, proc=None, summary=(summary or m["log"]).strip()[-800:])
    status_word = "done" if code == 0 and summary else ("stopped" if m.get("stopped") else "failed")
    say_event(f"Mission {status_word}: {m['goal'][:80]}. {summary[:300] if summary else 'See the mission log.'}")


def post_mission(h, q, body):
    goal = (body.get("goal") or "").strip()[:4000]
    if len(goal) < 8:
        raise ValueError("describe the mission in a sentence")
    if not which("claude"):
        raise ValueError("claude not found — " + INSTALL_HINT["claude"])
    with MLOCK:
        busy = next((m for m in MISSIONS.values() if m["running"]), None)
        if busy:
            raise ValueError("a mission is already running: " + busy["goal"][:80])
        mid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
        m = {"id": mid, "goal": goal, "model": (body.get("model") or "").strip() or None, "running": True, "started": time.time(), "finished": 0,
             "code": None, "summary": "", "log": "", "log_file": os.path.join(LOGS, f"mission-{mid}.log"), "proc": None, "stopped": False}
        MISSIONS[mid] = m
        for old in sorted(MISSIONS)[:-20]:
            if not MISSIONS[old]["running"]:
                MISSIONS.pop(old, None)
    threading.Thread(target=run_mission, args=(m,), daemon=True).start()
    return {"ok": True, "did": "mission started; I will report when it is done", "id": mid, "log": m["log_file"]}


def get_mission(h, q, body):
    mid = q.get("id")
    if mid:
        if mid not in MISSIONS:
            raise ValueError("unknown mission")
        return {"ok": True, "mission": mission_json(MISSIONS[mid])}
    return {"ok": True, "missions": [mission_json(m) for m in sorted(MISSIONS.values(), key=lambda m: m["started"], reverse=True)], "workspace": WORKSPACE}


def post_mission_stop(h, q, body):
    mid = body.get("id") or next((k for k, m in MISSIONS.items() if m["running"]), None)
    m = MISSIONS.get(mid)
    if not m or not m["running"]:
        raise ValueError("no running mission")
    m["stopped"] = True
    try:
        if m["proc"]:
            m["proc"].kill()
    except Exception:
        pass
    return {"ok": True, "did": "mission stopped", "id": mid}


def get_status(h, q, body):
    return {"ok": True, **status(), "mission_running": any(m["running"] for m in MISSIONS.values()), "stream": True}


def post_agent(h, q, body):
    provider = body.get("provider", "claude")
    if provider not in CMD:
        raise ValueError("provider must be 'claude' or 'gemini'")
    prompt = (body.get("prompt") or "").strip()[:20000]
    if not prompt:
        raise ValueError("empty prompt")
    print(f"[SAMURAI-AGENT] {provider}/{body.get('mode', 'chat')}: {prompt[:80]}")
    res = run_agent(provider, prompt, body.get("mode", "chat"), body.get("session_id"),
                    (body.get("model") or "").strip() or None, body.get("history"))
    print(f"[SAMURAI-AGENT] done in {res['seconds']}s")
    return res


class Handler(JSONHandler):
    TAG = "SAMURAI-AGENT"
    ROUTES = {("GET", "/agent/status"): get_status, ("POST", "/agent"): post_agent, ("POST", "/agent/stream"): post_stream,
              ("GET", "/agent/mcp"): get_mcp, ("POST", "/agent/mcp"): post_mcp,
              ("POST", "/mission"): post_mission, ("GET", "/mission"): get_mission, ("POST", "/mission/stop"): post_mission_stop}


if __name__ == "__main__":
    if "--port" in sys.argv:
        PORT = int(sys.argv[sys.argv.index("--port") + 1])
    os.makedirs(WORKSPACE, exist_ok=True)
    print(f"[SAMURAI] Agent sidecar on http://localhost:{PORT}/agent  (workspace: {WORKSPACE})")
    maybe_wrap_tls(ThreadingHTTPServer((bind_host(), PORT), Handler)).serve_forever()
