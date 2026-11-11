"""SAMURAI Neural TTS Sidecar — human-like voice via Microsoft Edge neural TTS (online),
with an optional fully local engine (Kokoro) when the `kokoro-onnx` package and model files are installed.

GET /tts?text=hello&voice=en-US-AriaNeural&rate=+0%[&engine=edge|kokoro]  ->  audio
GET /voices                                                                ->  voices for the settings drawer
GET /engines                                                               ->  which engines are available
Run: python samurai_tts_server.py   (port 9200)
"""
import asyncio, os, sys, threading
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import bind_host, JSONHandler, PORTS, MODELS, load_config

PORT = PORTS["tts"]
DEFAULT_VOICE = "en-US-AriaNeural"
# a short curated list for the drawer; /voices?all=1 returns everything edge-tts knows
CURATED = [
    ("en-US-AriaNeural", "ARIA — US, EXPRESSIVE"), ("en-US-JennyNeural", "JENNY — US, WARM"),
    ("en-US-GuyNeural", "GUY — US, MALE"), ("en-GB-SoniaNeural", "SONIA — UK"),
    ("en-GB-RyanNeural", "RYAN — UK, MALE"), ("en-IN-NeerjaNeural", "NEERJA — INDIA"),
    ("en-IN-PrabhatNeural", "PRABHAT — INDIA, MALE"), ("en-AU-NatashaNeural", "NATASHA — AUSTRALIA"),
]
_voice_cache = {"t": 0, "data": None}
_kokoro = {"checked": False, "engine": None, "voice": "af_heart"}


def edge_synth(text, voice, rate):
    import edge_tts

    async def run():
        chunks = []
        async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)
    return asyncio.run(run()), "audio/mpeg"


def kokoro_engine():
    """Local TTS if kokoro-onnx + model files exist under models/kokoro/. Returns engine or None."""
    if _kokoro["checked"]:
        return _kokoro["engine"]
    _kokoro["checked"] = True
    try:
        from kokoro_onnx import Kokoro
        mdir = os.path.join(MODELS, "kokoro")
        model = os.path.join(mdir, "kokoro-v1.0.onnx")
        voices = os.path.join(mdir, "voices-v1.0.bin")
        if os.path.exists(model) and os.path.exists(voices):
            _kokoro["engine"] = Kokoro(model, voices)
    except Exception as e:
        print(f"[SAMURAI-TTS] kokoro unavailable: {e}")
    return _kokoro["engine"]


def kokoro_synth(text, voice, rate):
    import io, wave
    import numpy as np
    eng = kokoro_engine()
    if eng is None:
        raise RuntimeError("kokoro engine not installed (pip install kokoro-onnx + model files in models/kokoro)")
    pct = int(rate.replace("%", "").replace("+", "") or 0)
    samples, sr = eng.create(text, voice=voice if voice.startswith(("af_", "am_", "bf_", "bm_")) else _kokoro["voice"],
                             speed=max(0.5, min(2.0, 1 + pct / 100)), lang="en-us")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue(), "audio/wav"


def get_tts(h, q, body):
    text = (q.get("text") or "").strip()[:1000]
    if not text:
        raise ValueError("text required")
    voice = q.get("voice") or DEFAULT_VOICE
    rate = q.get("rate") or "+0%"
    engine = q.get("engine") or ("kokoro" if voice.startswith(("af_", "am_", "bf_", "bm_")) else load_config().get("voice", {}).get("tts_engine", "edge"))
    if engine == "kokoro" and kokoro_engine() is None:
        engine = "edge"
    try:
        audio, ctype = kokoro_synth(text, voice, rate) if engine == "kokoro" else edge_synth(text, voice, rate)
    except Exception as e:
        print(f"[SAMURAI-TTS] {engine} error: {e}")
        return 502, {"ok": False, "error": f"{engine}: {e}"}
    h.send_bytes(audio, ctype, extra={"Cache-Control": "no-store"})
    return None


def get_voices(h, q, body):
    out = [{"id": v, "label": l, "engine": "edge"} for v, l in CURATED]
    if kokoro_engine() is not None:
        out = [{"id": "af_heart", "label": "HEART — LOCAL KOKORO", "engine": "kokoro"},
               {"id": "am_michael", "label": "MICHAEL — LOCAL KOKORO, MALE", "engine": "kokoro"}] + out
    if q.get("all"):
        try:
            import edge_tts, time
            if time.time() - _voice_cache["t"] > 3600 or not _voice_cache["data"]:
                _voice_cache["data"] = asyncio.run(edge_tts.list_voices())
                _voice_cache["t"] = time.time()
            out += [{"id": v["ShortName"], "label": f'{v["ShortName"]} · {v["Gender"]}', "engine": "edge"}
                    for v in _voice_cache["data"] if v["Locale"].startswith("en")]
        except Exception as e:
            print(f"[SAMURAI-TTS] voice list failed: {e}")
    return {"ok": True, "voices": out, "default": DEFAULT_VOICE}


def get_engines(h, q, body):
    return {"ok": True, "edge": True, "kokoro": kokoro_engine() is not None,
            "note": "edge = online Microsoft voices; kokoro = fully local (pip install kokoro-onnx, models/kokoro/)"}


class Handler(JSONHandler):
    TAG = "SAMURAI-TTS"
    ROUTES = {("GET", "/tts"): get_tts, ("GET", "/voices"): get_voices, ("GET", "/engines"): get_engines}


if __name__ == "__main__":
    threading.Thread(target=kokoro_engine, daemon=True).start()
    print(f"[SAMURAI] Neural TTS sidecar on http://localhost:{PORT}/tts")
    ThreadingHTTPServer((bind_host(), PORT), Handler).serve_forever()
