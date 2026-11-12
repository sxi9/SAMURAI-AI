"""Mock OpenAI-compatible chat server for testing SAMURAI without any AI account.

    python tests/mock_llm.py [port]          default port 1234 (the LM STUDIO slot in the HUD)
Then pick "LOCAL — LM STUDIO" in the HUD settings. Streams a JSON reply in the SAMURAI contract,
token by token, so streaming + sentence-by-sentence speech can be exercised offline.
"""
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1234


def reply_for(user):
    if "Design a small HUD widget" in user:
        return {"focus": None, "actions": [], "shape": None, "reply": ('{"name": "Task Count", "code": "TCT", "html": "<div style=\\"padding:24px;font-family:monospace;color:#d9f8ff\\"><div style=\\"font-size:12px;letter-spacing:.3em;color:#a07cff\\">OPEN TASKS</div><div id=n style=\\"font-size:120px;color:#2ee6ff;line-height:1.1\\">0</div><div id=l style=\\"font-size:14px;opacity:.8\\"></div><script>window.addEventListener(\\"message\\",e=>{const s=e.data&&e.data.snapshot;if(!s)return;const t=(s.tasks||[]).filter(x=>!x.done);document.getElementById(\\"n\\").textContent=t.length;document.getElementById(\\"l\\").textContent=t.map(x=>x.label).join(\\" · \\")});</script></div>"}')}
    u = (user or "").lower()
    focus, actions, shape, emotion = None, [], None, "neutral"
    if "spoken briefing from these facts" in u:
        facts = user.split(":", 1)[-1].strip().replace("\n", " ")
        return {"reply": f"Good day. {facts[:420]}", "focus": "cal", "actions": [], "shape": None}
    if "excerpts from" in u and "documents" in u:
        if "net 30" in u:
            text = "Your vendor contract says payment is due net 30 days after invoice, with a 2 percent penalty per month when late, and it renews automatically unless cancelled 60 days before the term ends."
        else:
            text = "I found that in your documents: " + user.split("\n", 2)[-1][:200]
        return {"reply": text, "focus": "tty", "actions": [], "shape": None}
    if "plan this goal" in u:
        return {"reply": "Three steps: lights off, a twenty five minute timer, and some focus music.", "steps": ["lights off", "timer 25 min", "play some focus music"], "focus": "tty", "actions": [], "shape": None}
    if "proactive check-in" in u:
        return {"reply": "Heads up: CPU has stayed high for the last few minutes and memory is climbing. Worth a look.", "focus": "sys", "actions": [], "shape": None}
    if "weather" in u:
        focus, text = "wx", "It is 26 degrees and overcast in Bengaluru right now. The high today is 29. Carry a light jacket for the evening."
    elif "light" in u:
        focus, actions, text = "home", [{"type": "home_set", "arg": "lights off" if "off" in u else "lights on"}], "Lights handled. Anything else?"
    elif "heart" in u:
        shape, text, emotion = "heart", "One heart, coming up. Try not to melt.", "love"
    elif "bad news" in u or "sad" in u:
        text, emotion = "I am sorry to say the backup drive did not answer tonight. I will try again in an hour.", "sad"
    elif "good news" in u or "happy" in u:
        text, emotion = "Good news: every service is up and the build passed on the first try.", "happy"
    else:
        focus, text = "sys", "All systems nominal. CPU is calm, memory is fine, and nothing is on fire. What do you need next?"
    return {"reply": text, "focus": focus, "actions": actions, "shape": shape, "emotion": emotion}   # "emotion" is the face the avatar makes (SAM.face)


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        body = json.dumps({"data": [{"id": "mock-samurai-1"}, {"id": "mock-samurai-2"}]}).encode()
        self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); req = json.loads(self.rfile.read(n) or b"{}")
        last = next((m["content"] for m in reversed(req.get("messages", [])) if m["role"] == "user"), "")
        if isinstance(last, list):                       # vision request: text + image parts
            user = " ".join(p.get("text", "") for p in last if p.get("type") == "text")
            has_img = any(p.get("type") == "image_url" for p in last)
            text = f"I can see the image you sent ({'screenshot' if has_img else 'no image'}). It shows a dark interface with glowing elements. {user[:40]}"
        else:
            user = last
            text = json.dumps(reply_for(user))
        if req.get("stream"):
            self.send_response(200); self._cors(); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            for i in range(0, len(text), 6):
                chunk = {"choices": [{"delta": {"content": text[i:i + 6]}}]}
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode()); self.wfile.flush(); time.sleep(0.03)
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            body = json.dumps({"choices": [{"message": {"role": "assistant", "content": text}}]}).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"[mock-llm] OpenAI-compatible mock on http://localhost:{PORT}/v1  (pick LOCAL — LM STUDIO in the HUD)")
    ThreadingHTTPServer(("localhost", PORT), H).serve_forever()
