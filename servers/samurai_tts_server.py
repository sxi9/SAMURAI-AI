"""SAMURAI Neural TTS Sidecar — human-like voices.

Engines (query `engine=`; default from config voice.tts_engine, else picked from the voice id):
  edge        Microsoft Edge neural voices, online, free (default)
  kokoro      fully local (kokoro-onnx + models/kokoro/, one-click install from the panel)
  elevenlabs  ElevenLabs, the most natural voices (key: voice.keys.elevenlabs)
  openai      OpenAI gpt-4o-mini-tts (key: voice.keys.openai)
  cartesia    Cartesia Sonic, very fast and realistic (key: voice.keys.cartesia)
  azure       Azure Speech HD voices (key: voice.keys.azure + voice.keys.azure_region)
  local       any local server that speaks the OpenAI /v1/audio/speech API (config voice.local_tts_url, voice.local_tts_voice):
              Chatterbox, Orpheus (orpheus-fastapi), XTTS v2 (xtts-api-server / openedai-speech), Fish Speech, F5-TTS, Kokoro-FastAPI, LocalAI

GET /tts?text=hello&voice=en-US-AriaNeural&rate=+0%[&engine=…][&style=…]  ->  audio (mp3, or wav from kokoro / local)
     style: neutral | calm | excited | whisper | sad | cheerful | serious (openai instructions, azure express-as, elevenlabs settings, edge pitch/rate)
GET /voices[?engine=…][&all=1]                                   ->  voices for the settings drawer (female, natural first)
GET /engines                                                     ->  which engines are available / configured (+ styles, local url)
POST /realtime/session {voice?, instructions?}                   ->  {"client_secret": "ek_…", "expires_at", "model", "voice"}: an ephemeral
                                                                     OpenAI Realtime key for the browser's WebRTC speech-to-speech (key: voice.keys.openai)
Run: python samurai_tts_server.py [--port N]   (port 9200)
"""
import asyncio, json, os, sys, threading, urllib.error, urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import bind_host, JSONHandler, PORTS, MODELS, load_config, maybe_wrap_tls

PORT = PORTS["tts"]
DEFAULT_VOICE = "en-US-AriaNeural"
# a short curated list for the drawer; /voices?all=1 returns everything edge-tts knows. Natural female voices first.
CURATED = [
    ("en-US-AvaMultilingualNeural", "AVA — US, MOST NATURAL"), ("en-US-EmmaMultilingualNeural", "EMMA — US, WARM"),
    ("en-US-AriaNeural", "ARIA — US, EXPRESSIVE"), ("en-US-JennyNeural", "JENNY — US, FRIENDLY"),
    ("en-GB-SoniaNeural", "SONIA — UK"), ("en-AU-NatashaNeural", "NATASHA — AUSTRALIA"), ("en-IN-NeerjaNeural", "NEERJA — INDIA"),
    ("en-US-GuyNeural", "GUY — US, MALE"), ("en-GB-RyanNeural", "RYAN — UK, MALE"), ("en-IN-PrabhatNeural", "PRABHAT — INDIA, MALE"),
]
PREMIUM = {
    "elevenlabs": [("21m00Tcm4TlvDq8ikWAM", "RACHEL — CALM, NATURAL"), ("EXAVITQu4vr4xnSDxMaL", "BELLA — SOFT"), ("XB0fDUnXU5powFXDhCwa", "CHARLOTTE — SEDUCTIVE"),
                   ("jsCqWAovK2LkecY7zXl4", "FREYA — EXPRESSIVE"), ("pNInz6obpgDQGcFmaJgB", "ADAM — MALE")],
    "openai": [("nova", "NOVA — BRIGHT, FRIENDLY"), ("shimmer", "SHIMMER — WARM"), ("coral", "CORAL — CLEAR"), ("sage", "SAGE — CALM"), ("alloy", "ALLOY — NEUTRAL"), ("onyx", "ONYX — MALE")],
    "cartesia": [("a0e99841-438c-4a64-b679-ae501e7d6091", "BARBERSHOP GIRL — BRIGHT"), ("79a125e8-cd45-4c13-8a67-188112f4dd22", "BRITISH LADY"),
                 ("156fb8d2-335b-4950-9cb3-a2d33befec77", "HELPFUL WOMAN"), ("694f9389-aac1-45b6-b726-9d9369183238", "SARAH — SOFT"), ("41534e16-2966-4c6b-9670-111411def906", "MALE NARRATOR")],
    "azure": [("en-US-AvaMultilingualNeural", "AVA HD — MOST NATURAL"), ("en-US-EmmaMultilingualNeural", "EMMA HD"), ("en-US-JennyNeural", "JENNY"),
              ("en-US-AriaNeural", "ARIA"), ("en-GB-SoniaNeural", "SONIA — UK"), ("en-US-AndrewMultilingualNeural", "ANDREW — MALE")],
}
NOTES = {"edge": "online Microsoft voices, free", "kokoro": "fully local (panel: install local voice)", "elevenlabs": "most natural, paid; key in settings",
         "openai": "OpenAI gpt-4o-mini-tts, paid; key in settings", "cartesia": "Cartesia Sonic, fast and realistic; key in settings",
         "azure": "Azure Speech HD voices; key + region in settings",
         "local": "your own local voice server (Chatterbox, Orpheus, XTTS, Fish Speech, F5-TTS) behind an OpenAI-style /v1/audio/speech URL in settings"}
# voice styles (B4): how each engine expresses them. edge: (rate offset %, pitch) · azure: express-as style · openai: instructions · elevenlabs: (stability, style)
STYLES = {
    "neutral":  {"edge": (0, "+0Hz"),  "azure": None,          "openai": "Speak naturally, warm and clear, like a calm personal assistant.", "eleven": (0.45, 0.3)},
    "calm":     {"edge": (-8, "-2Hz"), "azure": "calm",        "openai": "Speak slowly and softly, calm and reassuring, with gentle pauses.", "eleven": (0.7, 0.1)},
    "excited":  {"edge": (12, "+6Hz"), "azure": "excited",     "openai": "Speak with bright, upbeat energy and enthusiasm, a little faster than usual.", "eleven": (0.3, 0.7)},
    "whisper":  {"edge": (-12, "-4Hz"), "azure": "whispering", "openai": "Whisper the whole reply, quietly and intimately, as if not to wake anyone.", "eleven": (0.8, 0.0)},
    "sad":      {"edge": (-10, "-4Hz"), "azure": "sad",        "openai": "Speak slowly with a soft, subdued, slightly sad tone.", "eleven": (0.6, 0.2)},
    "cheerful": {"edge": (6, "+4Hz"),  "azure": "cheerful",    "openai": "Speak in a cheerful, friendly, smiling tone.", "eleven": (0.4, 0.5)},
    "serious":  {"edge": (-4, "+0Hz"), "azure": "serious",     "openai": "Speak in a crisp, serious, professional tone with no playfulness.", "eleven": (0.6, 0.15)},
}
# SAMURAI_TTS_FAKE=http://127.0.0.1:port routes every paid engine to a local server (tests)
FAKE = os.environ.get("SAMURAI_TTS_FAKE")
_voice_cache = {"t": 0, "data": None}
_kokoro = {"checked": False, "engine": None, "voice": "af_heart"}
_style = threading.local()                                    # the style of the request being synthesised (set by get_tts)


def vcfg():
    return load_config().get("voice", {})


def style():
    return STYLES.get(getattr(_style, "name", "neutral")) or STYLES["neutral"]


def key_for(engine):
    k = (vcfg().get("keys") or {}).get(engine, "")
    if not k:
        raise RuntimeError(f"{engine}: no API key — add it in settings (voice.keys.{engine})")
    return k


def rate_pct(rate):
    try:
        return int(str(rate).replace("%", "").replace("+", "") or 0)
    except ValueError:
        return 0


def post_bytes(url, data, headers, timeout=30):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        detail = e.read(300).decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code} from {url.split('/')[2]}: {detail[:160]}")


# ----------------------------------------------------------------------------- engines
def edge_synth(text, voice, rate):
    import edge_tts

    off, pitch = style()["edge"]
    if off:
        rate = f"{rate_pct(rate) + off:+d}%"

    async def run():
        chunks = []
        async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).stream():
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
    pct = rate_pct(rate)
    samples, sr = eng.create(text, voice=voice if voice.startswith(("af_", "am_", "bf_", "bm_")) else _kokoro["voice"],
                             speed=max(0.5, min(2.0, 1 + pct / 100)), lang="en-us")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue(), "audio/wav"


def elevenlabs_synth(text, voice, rate):
    key = key_for("elevenlabs")
    vid = voice if len(voice) > 12 and not voice.startswith("en-") else PREMIUM["elevenlabs"][0][0]
    base = FAKE or "https://api.elevenlabs.io"
    stab, sty = style()["eleven"]
    body = {"text": text, "model_id": "eleven_turbo_v2_5",
            "voice_settings": {"stability": stab, "similarity_boost": 0.8, "style": sty, "use_speaker_boost": True, "speed": max(0.7, min(1.2, 1 + rate_pct(rate) / 100))}}
    data = post_bytes(f"{base}/v1/text-to-speech/{vid}?output_format=mp3_44100_128", json.dumps(body).encode(),
                      {"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    return data, "audio/mpeg"


def openai_synth(text, voice, rate):
    key = key_for("openai")
    v = voice if voice in {v for v, _ in PREMIUM["openai"]} else "nova"
    base = FAKE or "https://api.openai.com"
    body = {"model": "gpt-4o-mini-tts", "input": text, "voice": v, "response_format": "mp3", "speed": max(0.5, min(2.0, 1 + rate_pct(rate) / 100)),
            "instructions": style()["openai"]}
    data = post_bytes(f"{base}/v1/audio/speech", json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    return data, "audio/mpeg"


def local_url():
    return (vcfg().get("local_tts_url") or "").rstrip("/")


def local_synth(text, voice, rate):
    """Any local server with the OpenAI speech API: Chatterbox, Orpheus-FastAPI, openedai-speech / XTTS, Fish Speech, F5-TTS, Kokoro-FastAPI, LocalAI."""
    base = local_url()
    if not base:
        raise RuntimeError("local: set voice.local_tts_url in settings (e.g. http://127.0.0.1:8880 for Kokoro-FastAPI / Orpheus / XTTS servers)")
    v = voice if voice and not voice.startswith("en-") and voice not in {x for x, _ in PREMIUM["openai"]} else (vcfg().get("local_tts_voice") or "default")
    body = {"model": vcfg().get("local_tts_model") or "tts-1", "input": text, "voice": v, "response_format": "mp3",
            "speed": max(0.5, min(2.0, 1 + rate_pct(rate) / 100)), "instructions": style()["openai"]}
    headers = {"Content-Type": "application/json"}
    if vcfg().get("local_tts_key"):
        headers["Authorization"] = "Bearer " + vcfg()["local_tts_key"]
    url = base + ("" if base.endswith("/audio/speech") else "/v1/audio/speech")
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            ctype = (r.headers.get("Content-Type") or "audio/mpeg").split(";")[0]
            return r.read(), ("audio/wav" if "wav" in ctype else "audio/mpeg")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"local voice server HTTP {e.code}: {e.read(200).decode('utf-8', 'replace')[:160]}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"local voice server not reachable at {base} ({e.reason})")


def cartesia_synth(text, voice, rate):
    key = key_for("cartesia")
    vid = voice if len(voice) > 20 else PREMIUM["cartesia"][0][0]
    base = FAKE or "https://api.cartesia.ai"
    pct = rate_pct(rate)
    body = {"model_id": "sonic-2", "transcript": text, "voice": {"mode": "id", "id": vid}, "language": "en",
            "output_format": {"container": "mp3", "bit_rate": 128000, "sample_rate": 44100}}
    if pct:
        body["generation_config"] = {"speed": max(-1, min(1, pct / 50))}
    data = post_bytes(f"{base}/tts/bytes", json.dumps(body).encode(), {"X-API-Key": key, "Cartesia-Version": "2024-11-13", "Content-Type": "application/json"})
    return data, "audio/mpeg"


def azure_synth(text, voice, rate):
    key = key_for("azure")
    region = (vcfg().get("keys") or {}).get("azure_region") or "eastus"
    v = voice if voice.startswith("en-") else PREMIUM["azure"][0][0]
    base = FAKE or f"https://{region}.tts.speech.microsoft.com"
    from xml.sax.saxutils import escape
    pct = rate_pct(rate)
    inner = f"<prosody rate='{pct:+d}%'>{escape(text)}</prosody>"
    if style()["azure"]:
        inner = f"<mstts:express-as style='{style()['azure']}'>{inner}</mstts:express-as>"
    ssml = (f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'>"
            f"<voice name='{v}'>{inner}</voice></speak>").encode("utf-8")
    data = post_bytes(f"{base}/cognitiveservices/v1", ssml, {"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                                                              "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3", "User-Agent": "SAMURAI"})
    return data, "audio/mpeg"


ENGINES = {"edge": edge_synth, "kokoro": kokoro_synth, "elevenlabs": elevenlabs_synth, "openai": openai_synth, "cartesia": cartesia_synth, "azure": azure_synth,
           "local": local_synth}


def guess_engine(voice):
    if voice.startswith(("af_", "am_", "bf_", "bm_")):
        return "kokoro"
    for eng, lst in PREMIUM.items():
        if eng != "azure" and voice in {v for v, _ in lst}:
            return eng
    return None


def engine_ready(engine):
    if engine == "edge":
        return True
    if engine == "kokoro":
        return kokoro_engine() is not None
    if engine == "local":
        return bool(local_url())
    return bool((vcfg().get("keys") or {}).get(engine))


# ----------------------------------------------------------------------------- routes
def get_tts(h, q, body):
    text = (q.get("text") or "").strip()[:1000]
    if not text:
        raise ValueError("text required")
    voice = q.get("voice") or DEFAULT_VOICE
    rate = q.get("rate") or "+0%"
    engine = q.get("engine") or guess_engine(voice) or vcfg().get("tts_engine", "edge")
    if engine not in ENGINES:
        raise ValueError(f"unknown engine {engine}; one of {', '.join(ENGINES)}")
    if engine != "edge" and not engine_ready(engine):
        print(f"[SAMURAI-TTS] {engine} not configured — using edge")
        engine, voice = "edge", (voice if voice.startswith("en-") else DEFAULT_VOICE)
    _style.name = (q.get("style") or "neutral").lower() if (q.get("style") or "neutral").lower() in STYLES else "neutral"
    try:
        audio, ctype = ENGINES[engine](text, voice, rate)
        if not audio:
            raise RuntimeError("empty audio")
    except Exception as e:
        print(f"[SAMURAI-TTS] {engine} error: {e}")
        return 502, {"ok": False, "engine": engine, "error": f"{engine}: {e}"}
    h.send_bytes(audio, ctype, extra={"Cache-Control": "no-store", "X-Engine": engine, "X-Style": _style.name})
    return None


def post_realtime_session(h, q, body):
    """Mints a short-lived OpenAI Realtime client secret so the HUD can open a WebRTC speech-to-speech session (B5).
    The real key never leaves this machine; the browser gets a token that expires in about a minute."""
    key = key_for("openai")
    base = FAKE or "https://api.openai.com"
    voice = (body.get("voice") or vcfg().get("realtime_voice") or "shimmer")[:30]
    model = vcfg().get("realtime_model") or "gpt-4o-mini-realtime-preview"
    session = {"model": model, "voice": voice, "modalities": ["audio", "text"],
               "instructions": (body.get("instructions") or "You are SAMURAI, a Jarvis-style voice assistant. Speak briefly, warmly and naturally.")[:4000],
               "input_audio_transcription": {"model": "whisper-1"}, "turn_detection": {"type": "server_vad", "silence_duration_ms": 600}}
    raw = post_bytes(f"{base}/v1/realtime/sessions", json.dumps(session).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, timeout=20)
    d = json.loads(raw or b"{}")
    secret = (d.get("client_secret") or {})
    if not secret.get("value"):
        raise ValueError("no client secret in the Realtime answer: " + raw[:200].decode("utf-8", "replace"))
    return {"ok": True, "client_secret": secret["value"], "expires_at": secret.get("expires_at"), "model": d.get("model") or model, "voice": voice,
            "url": f"{base}/v1/realtime?model={model}"}


def get_voices(h, q, body):
    want = q.get("engine")
    out = []
    if kokoro_engine() is not None and want in (None, "kokoro"):
        out += [{"id": "af_heart", "label": "HEART — LOCAL KOKORO", "engine": "kokoro"}, {"id": "af_bella", "label": "BELLA — LOCAL KOKORO", "engine": "kokoro"},
                {"id": "am_michael", "label": "MICHAEL — LOCAL KOKORO, MALE", "engine": "kokoro"}]
    for eng, lst in PREMIUM.items():
        if want in (None, eng) and (want == eng or engine_ready(eng)):
            out += [{"id": v, "label": f"{l} · {eng.upper()}", "engine": eng} for v, l in lst]
    if want in (None, "local") and engine_ready("local"):
        out += [{"id": vcfg().get("local_tts_voice") or "default", "label": "YOUR LOCAL VOICE SERVER", "engine": "local"}]
    if want in (None, "edge"):
        out += [{"id": v, "label": l, "engine": "edge"} for v, l in CURATED]
    if q.get("all") and want in (None, "edge"):
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
    out = {"ok": True, "default": vcfg().get("tts_engine", "edge"), "notes": NOTES, "styles": list(STYLES), "local_url": local_url(),
           "realtime": bool((vcfg().get("keys") or {}).get("openai"))}
    for eng in ENGINES:
        out[eng] = engine_ready(eng)
    return out


class Handler(JSONHandler):
    TAG = "SAMURAI-TTS"
    ROUTES = {("GET", "/tts"): get_tts, ("GET", "/voices"): get_voices, ("GET", "/engines"): get_engines, ("POST", "/realtime/session"): post_realtime_session}


if __name__ == "__main__":
    if "--port" in sys.argv:
        PORT = int(sys.argv[sys.argv.index("--port") + 1])
    threading.Thread(target=kokoro_engine, daemon=True).start()
    print(f"[SAMURAI] Neural TTS sidecar on http://localhost:{PORT}/tts")
    maybe_wrap_tls(ThreadingHTTPServer((bind_host(), PORT), Handler)).serve_forever()
