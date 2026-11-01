"""SAMURAI Neural TTS Sidecar — human-like voice via Microsoft Edge neural TTS.
GET /tts?text=hello&voice=en-US-AriaNeural&rate=+0%  ->  MP3 audio.
Run: python samurai_tts_server.py"""
import asyncio, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import edge_tts

PORT = 9200
DEFAULT_VOICE = "en-US-AriaNeural"


def synth(text, voice, rate):
    async def run():
        chunks = []
        com = edge_tts.Communicate(text, voice, rate=rate)
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)
    return asyncio.run(run())


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/tts":
            self.send_response(404)
            self.end_headers()
            return
        q = urllib.parse.parse_qs(parsed.query)
        text = (q.get("text", [""])[0]).strip()[:1000]
        voice = q.get("voice", [DEFAULT_VOICE])[0]
        rate = q.get("rate", ["+0%"])[0]
        if not text:
            self.send_response(400)
            self.end_headers()
            return
        try:
            audio = synth(text, voice, rate)
        except Exception as e:
            print(f"[SAMURAI-TTS] error: {e}")
            self.send_response(500)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"[SAMURAI] Neural TTS sidecar on http://localhost:{PORT}/tts")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
