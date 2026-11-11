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

  chat    answer from the model only (no tools)
  search  may use the agent's built-in web search / fetch
  work    may read, create and edit files inside the workspace/ folder
          (config.json agent.allow_bash = true also lets Claude Code run shell commands)

Run: python samurai_agent_server.py        (port 9400, localhost only)
"""
import json, os, shutil, subprocess, sys, time
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import bind_host, JSONHandler, NOWIN, PORTS, ROOT, load_config

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


def build_cmd(provider, prompt, mode, session_id, model, history):
    exe = which(provider)
    if not exe:
        raise ValueError(f"{CMD[provider]} not found — {INSTALL_HINT[provider]}")
    if provider == "claude":
        cmd = [exe, "-p", prompt, "--output-format", "json", "--append-system-prompt", STYLE]
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


def get_status(h, q, body):
    return {"ok": True, **status()}


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
    ROUTES = {("GET", "/agent/status"): get_status, ("POST", "/agent"): post_agent}


if __name__ == "__main__":
    os.makedirs(WORKSPACE, exist_ok=True)
    print(f"[SAMURAI] Agent sidecar on http://localhost:{PORT}/agent  (workspace: {WORKSPACE})")
    ThreadingHTTPServer((bind_host(), PORT), Handler).serve_forever()
