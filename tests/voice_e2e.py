"""End-to-end voice test: neural TTS -> 16 kHz PCM -> Vosk WebSocket -> transcript.

    .venv/bin/python tests/voice_e2e.py            (needs ffmpeg, and the TTS + speech services running)
Exit code 0 when the spoken phrase comes back from the recogniser.
"""
import asyncio, json, os, subprocess, sys, tempfile, time, urllib.request

PHRASE = "samurai open chrome and play some music"
TTS = "http://localhost:9200/tts?text=" + urllib.request.quote(PHRASE)
WS = "ws://localhost:9100"


def main():
    import websockets
    tmp = tempfile.mkdtemp()
    mp3, pcm = os.path.join(tmp, "t.mp3"), os.path.join(tmp, "t.pcm")
    req = urllib.request.Request(TTS, headers={"Origin": "http://localhost:8080"})
    with urllib.request.urlopen(req, timeout=60) as r, open(mp3, "wb") as f:
        f.write(r.read())
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", mp3, "-ar", "16000", "-ac", "1", "-f", "s16le", pcm], check=True)
    data = open(pcm, "rb").read()

    async def run():
        async with websockets.connect(WS) as ws:
            t0 = time.time()
            for i in range(0, len(data), 8000):
                await ws.send(data[i:i + 8000])
            await ws.send("EOF")
            finals = []
            try:
                while True:
                    m = json.loads(await asyncio.wait_for(ws.recv(), 4))
                    if m.get("final"):
                        finals.append(m["text"])
            except asyncio.TimeoutError:
                pass
            return finals, time.time() - t0
    finals, dt = asyncio.run(run())
    heard = " ".join(finals)
    ok = "samurai" in heard and "chrome" in heard
    print(f"{'PASS' if ok else 'FAIL'}  heard={heard!r}  in {dt:.1f}s")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
