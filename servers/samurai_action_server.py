"""SAMURAI Action Sidecar — lets SAMURAI control the PC (whitelisted actions only).
POST http://localhost:9300/action   body: {"type": "...", "arg": "..."}
Supported: open_url, web_search, play_music, open_app.
Run: python samurai_action_server.py"""
import json, os, re, subprocess, urllib.parse, urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 9300

# whitelist: friendly name -> Windows "start" target (fixed constants, no user text)
APPS = {
    "chrome": "chrome", "google chrome": "chrome",
    "edge": "msedge", "microsoft edge": "msedge",
    "firefox": "firefox",
    "brave": "brave",
    "spotify": "spotify",
    "explorer": "explorer", "file explorer": "explorer", "files": "explorer",
    "notepad": "notepad",
    "calculator": "calc", "calc": "calc",
    "paint": "mspaint",
    "settings": "ms-settings:",
    "cmd": "cmd", "command prompt": "cmd",
    "terminal": "wt", "windows terminal": "wt",
    "vscode": "code", "vs code": "code", "code": "code",
    "word": "winword", "excel": "excel", "powerpoint": "powerpnt",
    "task manager": "taskmgr", "taskmgr": "taskmgr",
    "camera": "microsoft.windows.camera:",
    "youtube": "https://www.youtube.com",
}


CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def launch(target):
    # target is a fixed whitelisted constant; safe to hand to the shell 'start' verb
    subprocess.Popen(f'start "" "{target}"', shell=True, creationflags=CREATE_NO_WINDOW)


def yt_first_video(query):
    # scrape the first videoId from YouTube search results (no API key needed)
    try:
        url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        })
        html = urllib.request.urlopen(req, timeout=6).read().decode("utf-8", "ignore")
        m = re.search(r'"videoId":"([\w-]{11})"', html)
        return m.group(1) if m else None
    except Exception:
        return None


def do_action(atype, arg):
    arg = (arg or "").strip()
    if atype == "open_url":
        if not (arg.startswith("http://") or arg.startswith("https://")):
            arg = "https://" + arg
        webbrowser.open(arg)
        return f"Opening {arg}"
    if atype in ("web_search", "search"):
        webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote(arg))
        return f"Searching the web for {arg}"
    if atype == "play_music":
        vid = yt_first_video(arg)
        if vid:
            webbrowser.open(f"https://www.youtube.com/watch?v={vid}")
            return f"Playing {arg}"
        webbrowser.open("https://www.youtube.com/results?search_query=" + urllib.parse.quote(arg))
        return f"Pulling up {arg} on YouTube"
    if atype == "open_app":
        key = arg.lower().replace(".exe", "").strip()
        target = APPS.get(key)
        if not target:
            raise ValueError(f"app '{arg}' is not in the allowed list")
        if target.startswith("http") or target.endswith(":"):
            webbrowser.open(target) if target.startswith("http") else launch(target)
        else:
            launch(target)
        return f"Launching {arg}"
    raise ValueError(f"unknown action '{atype}'")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200, {"ok": True})

    def do_POST(self):
        if self.path != "/action":
            self._send(404, {"ok": False, "error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n) or "{}")
            did = do_action(data.get("type", ""), data.get("arg", ""))
            print(f"[SAMURAI-ACT] {did}")
            self._send(200, {"ok": True, "did": did})
        except Exception as e:
            print(f"[SAMURAI-ACT] error: {e}")
            self._send(400, {"ok": False, "error": str(e)})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"[SAMURAI] Action sidecar on http://localhost:{PORT}/action")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
