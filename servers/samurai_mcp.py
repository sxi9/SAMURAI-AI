"""SAMURAI as an MCP server (stdio, JSON-RPC 2.0, protocol 2024-11-05) for Claude Code.

Registered with:  claude mcp add samurai -s user -- <.venv python> servers/samurai_mcp.py
(the control panel / agent sidecar does this: POST :9400/agent/mcp {"on": true}). Inside one Claude Code session
the model can then call SAMURAI's own services as tools:

  samurai_action          {type, arg}           -> the action sidecar (:9300): open_app, volume_set, play_music, lock ... (dangerous ones ask the user)
  samurai_browser         {cmd, arg}            -> the browser agent (:9600): open, read, click, type, find, screenshot
  samurai_docs_search     {query, k}            -> the user's documents index (:9500/docs/search)
  samurai_journal_add     {text}                -> a journal entry (:9500/journal)
  samurai_calendar_add    {title, start, end, duration_min, location, notes} -> the calendar (:9500/calendar/add)
  samurai_memory_remember {fact}                -> a long-term fact (:9500/memory)

Methods: initialize, notifications/initialized, ping, tools/list, tools/call. Everything else answers -32601.
Only stdlib; no network beyond localhost. Test by hand:  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python servers/samurai_mcp.py
"""
import json, os, sys, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from samurai_common import PORTS, lan_mode
except Exception:                                                     # run from anywhere: fall back to the default ports
    PORTS = {"actions": 9300, "addons": 9500, "browser": 9600}
    def lan_mode():
        return {}

PROTOCOL = "2024-11-05"
HOST = os.environ.get("SAMURAI_MCP_HOST", "http://127.0.0.1")
ORIGIN = "http://localhost:8080"
TOOLS = [
    {"name": "samurai_action", "description": "Run one of SAMURAI's PC actions on the user's machine: open_app, open_url, web_search, play_music, open_path, "
                                              "volume_up/volume_down/volume_set, mute, media_play_pause, media_next, brightness, screenshot, lock, clipboard_set, "
                                              "type_text, hotkey, timer_start, task_add, home_set, push_phone, wifi, bluetooth and more. Shutdown, restart, sleep, "
                                              "kill_process and run_command need the user's confirmation and return needs_confirm.",
     "inputSchema": {"type": "object", "properties": {"type": {"type": "string", "description": "action type, e.g. open_app"}, "arg": {"type": "string", "description": "argument, e.g. chrome"}}, "required": ["type"]}},
    {"name": "samurai_browser", "description": "Drive SAMURAI's browser agent (a real Chromium with the user's saved logins): cmd open {arg: url}, read (page text), "
                                               "click {arg: link or button text}, type {arg: 'field label | text'}, find {arg: text}, screenshot, back, status.",
     "inputSchema": {"type": "object", "properties": {"cmd": {"type": "string"}, "arg": {"type": "string"}}, "required": ["cmd"]}},
    {"name": "samurai_docs_search", "description": "Full-text search over the user's documents folder (PDF, Word, text, Markdown). Returns the best matching passages.",
     "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "k": {"type": "integer", "default": 5}}, "required": ["query"]}},
    {"name": "samurai_journal_add", "description": "Append a dated entry to the user's voice journal.",
     "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
    {"name": "samurai_calendar_add", "description": "Create a calendar event. start/end accept natural language ('tomorrow 3pm', 'next monday at 10') or ISO dates.",
     "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}, "duration_min": {"type": "integer", "default": 60},
                                                      "location": {"type": "string"}, "notes": {"type": "string"}}, "required": ["title", "start"]}},
    {"name": "samurai_memory_remember", "description": "Store a fact about the user in SAMURAI's long-term memory (used in every future conversation).",
     "inputSchema": {"type": "object", "properties": {"fact": {"type": "string"}}, "required": ["fact"]}},
]


def call(port, path, body=None, method=None, timeout=120):
    url = f"{HOST}:{port}{path}"
    headers = {"Origin": ORIGIN, "Content-Type": "application/json"}
    lan = lan_mode() or {}
    if lan.get("token"):
        headers["X-Samurai-Token"] = lan["token"]
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read() or b"{}")
        except Exception:
            return {"ok": False, "error": f"HTTP {e.code}"}
    except Exception as e:
        return {"ok": False, "error": f"SAMURAI service on :{port} is not running ({e})"}


def run_tool(name, args):
    args = args or {}
    if name == "samurai_action":
        return call(PORTS["actions"], "/action", {"type": args.get("type", ""), "arg": args.get("arg", "")})
    if name == "samurai_browser":
        return call(PORTS["browser"], "/browser", {"cmd": args.get("cmd", ""), "arg": args.get("arg", "")})
    if name == "samurai_docs_search":
        q = urllib.request.quote(args.get("query", ""))
        return call(PORTS["addons"], f"/docs/search?q={q}&k={int(args.get('k') or 5)}")
    if name == "samurai_journal_add":
        return call(PORTS["addons"], "/journal", {"text": args.get("text", "")})
    if name == "samurai_calendar_add":
        return call(PORTS["addons"], "/calendar/add", {k: args[k] for k in ("title", "start", "end", "duration_min", "location", "notes") if k in args})
    if name == "samurai_memory_remember":
        return call(PORTS["addons"], "/memory", {"action": "remember", "text": args.get("fact", "")})
    return None


def handle(msg):
    mid, method, params = msg.get("id"), msg.get("method", ""), msg.get("params") or {}
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}},
                                                         "serverInfo": {"name": "samurai", "version": "1.6.0"}}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
    if method == "tools/call":
        name = params.get("name", "")
        res = run_tool(name, params.get("arguments"))
        if res is None:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"unknown tool {name}"}}
        text = json.dumps(res, ensure_ascii=False)
        return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text[:20000]}], "isError": res.get("ok") is False}}
    if method.startswith("notifications/"):
        return None                                                   # no reply to notifications
    if mid is None:
        return None
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}


def serve(inp=sys.stdin, out=sys.stdout):
    for line in inp:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            out.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}) + "\n")
            out.flush()
            continue
        try:
            reply = handle(msg)
        except Exception as e:
            reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32603, "message": str(e)[:300]}}
        if reply is not None:
            out.write(json.dumps(reply, ensure_ascii=False) + "\n")
            out.flush()


if __name__ == "__main__":
    serve()
