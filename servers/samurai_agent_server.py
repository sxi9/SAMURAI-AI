"""SAMURAI Agent Sidecar — headless Claude Code / Gemini CLI bridge.

Lets SAMURAI use the official command-line agents as a brain, a web
researcher, or a worker, with NO API key: both CLIs sign in with your
normal subscription / Google login the first time you run them.

  claude  ->  npm install -g @anthropic-ai/claude-code   then run `claude` once to sign in
  gemini  ->  npm install -g @google/gemini-cli           then run `gemini` once to sign in
             (free-tier Google accounts were moved to Antigravity CLI in June 2026;
              point SAMURAI_GEMINI_CMD at that command if `gemini` is gone)

GET  /agent/status                      -> which CLIs are installed
POST /agent  {"provider": "claude"|"gemini", "prompt": "...",
              "mode": "chat"|"search"|"work", "session_id": "...", "model": "..."}
             -> {"ok": true, "text": "...", "session_id": "..."}

  chat    answer from the model only (no tools)
  search  may use the agent's built-in web search / fetch
  work    may read, create and edit files inside the workspace\\ folder
          (set SAMURAI_AGENT_ALLOW_BASH=1 to also let Claude Code run shell commands)

Run: python samurai_agent_server.py        (port 9400, localhost only)
"""
import json, os, shutil, subprocess, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 9400
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE = os.path.join(ROOT, "workspace")
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
# only the SAMURAI page may call this from a browser
ALLOWED_ORIGINS = {"http://localhost:8080", "http://127.0.0.1:8080"}

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
    "claude": "install with: npm install -g @anthropic-ai/claude-code  then run `claude` once to sign in",
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
                r = subprocess.run([exe, "--version"], capture_output=True, text=True,
                                   timeout=20, creationflags=CREATE_NO_WINDOW,
                                   encoding="utf-8", errors="replace")
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
        raise RuntimeError(f"{CMD[provider]} not found — {INSTALL_HINT[provider]}")
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
        else:  # work
            tools = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "WebSearch", "WebFetch"]
            if os.environ.get("SAMURAI_AGENT_ALLOW_BASH") == "1":
                tools.append("Bash")
            cmd += ["--permission-mode", "acceptEdits", "--tools", *tools, "--allowedTools", *tools]
        return cmd
    # gemini: no server-side session resume with -o json, so carry a little history in the prompt
    text = STYLE + "\n\n"
    if history:
        text += "Conversation so far:\n" + "\n".join(
            f"{h.get('role', 'user')}: {h.get('content', '')}" for h in history[-6:]) + "\n\n"
    text += "User: " + prompt
    cmd = [exe, "-p", text, "-o", "json"]
    if model:
        cmd += ["-m", model]
    if mode == "chat":
        cmd += ["--approval-mode", "plan"]      # read-only, no edits
    else:
        cmd += ["--approval-mode", "yolo"]      # search / work: tools run without a prompt
    return cmd


def run_agent(provider, prompt, mode, session_id=None, model=None, history=None):
    mode = mode if mode in TIMEOUT else "chat"
    os.makedirs(WORKSPACE, exist_ok=True)
    cmd = build_cmd(provider, prompt, mode, session_id, model, history)
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)          # allow launching from inside another Claude Code session
    t0 = time.time()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=TIMEOUT[mode], cwd=WORKSPACE, env=env, creationflags=CREATE_NO_WINDOW)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"{provider} took longer than {TIMEOUT[mode]}s and was stopped")
    raw = (r.stdout or "").strip()
    try:
        data = json.loads(raw[raw.find("{"):]) if "{" in raw else {}
    except json.JSONDecodeError:
        data = {}
    if provider == "claude":
        text = data.get("result") or ""
        err = data.get("is_error") or (r.returncode != 0 and not text)
        sid = data.get("session_id")
    else:
        text = data.get("response") or ""
        err = bool(data.get("error")) or (r.returncode != 0 and not text)
        sid = None
    if err or not text:
        detail = (data.get("error") or {}).get("message") if isinstance(data.get("error"), dict) else None
        detail = detail or text or (r.stderr or raw or "no output").strip()[-400:]
        if "log in" in detail.lower() or "login" in detail.lower() or "auth" in detail.lower():
            detail += f"  — run `{CMD[provider]}` once in a terminal to sign in"
        raise RuntimeError(detail)
    return {"ok": True, "provider": provider, "mode": mode, "text": text.strip(),
            "session_id": sid, "seconds": round(time.time() - t0, 1)}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or origin in ALLOWED_ORIGINS   # no Origin = local tool, not a browser

    def do_OPTIONS(self):
        self._send(200 if self._origin_ok() else 403, {"ok": self._origin_ok()})

    def do_GET(self):
        if self.path != "/agent/status":
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not self._origin_ok():
            self._send(403, {"ok": False, "error": "origin not allowed"})
            return
        self._send(200, {"ok": True, **status()})

    def do_POST(self):
        if self.path != "/agent":
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not self._origin_ok():
            self._send(403, {"ok": False, "error": "origin not allowed"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n) or "{}")
            provider = data.get("provider", "claude")
            if provider not in CMD:
                raise ValueError("provider must be 'claude' or 'gemini'")
            prompt = (data.get("prompt") or "").strip()[:20000]
            if not prompt:
                raise ValueError("empty prompt")
            print(f"[SAMURAI-AGENT] {provider}/{data.get('mode', 'chat')}: {prompt[:80]}")
            res = run_agent(provider, prompt, data.get("mode", "chat"), data.get("session_id"),
                            (data.get("model") or "").strip() or None, data.get("history"))
            print(f"[SAMURAI-AGENT] done in {res['seconds']}s")
            self._send(200, res)
        except Exception as e:
            print(f"[SAMURAI-AGENT] error: {e}")
            self._send(400, {"ok": False, "error": str(e)})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.makedirs(WORKSPACE, exist_ok=True)
    print(f"[SAMURAI] Agent sidecar on http://localhost:{PORT}/agent  (workspace: {WORKSPACE})")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
