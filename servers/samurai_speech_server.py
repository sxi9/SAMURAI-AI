"""
SAMURAI Speech Server — Local Vosk-based speech-to-text via WebSocket, with optional
voice-activity detection (webrtcvad) and an optional wake-word engine (openWakeWord).

Browser sends raw 16 kHz mono PCM audio, server returns transcribed text.
Client messages: binary PCM chunks, "EOF" (finalise), "MODEL:small|large",
  "WAKE:<phrase>"      custom wake phrase (B6): a second Vosk recogniser limited to that phrase (grammar / hot words, small models)
                       listens on the same audio and sends {"wake": true, "score", "phrase"}; models without a dynamic graph fall back
                       to matching the phrase in partial results. "WAKE:" clears it.
  "ENROLL:<name>"      voice identity (B7): the next few seconds of speech become <name>'s voice print (data/voices/<name>.json);
                       needs `pip install resemblyzer` (optional), otherwise {"enroll", "status": "unavailable"}
  "WHO:1|0"            tag every final transcript with "speaker": the closest enrolled name or "unknown";
                       config voice.only_enrolled = true drops commands from unknown voices ({"ignored": true})
  "MEETING:on|off"     meeting mode (B11): every final line is appended with a timestamp to data/meetings/<date>.txt;
                       the HUD stops treating lines as commands and can ask the brain for a summary afterwards
Server messages: {"text", "final", "speaker"?}, {"wake": true, "score"}, {"model", "status"}, {"engine", "vad", "stt", "identity", "wake_phrase"},
  {"enroll", "status"}, {"who": bool}, {"meeting": bool, "file"}

config.json  "voice": {"vad": true, "wake_engine": "text" | "openwakeword", "oww_model": "hey_jarvis", "wake_window": 8,
                        "stt_engine": "vosk" | "whisper", "whisper_model": "base"}
  stt_engine whisper  faster-whisper on the CPU (int8): more accurate than Vosk, needs the package (one click in the panel);
                      speech is cut into utterances by the VAD and each one is transcribed when you pause
  text          the HUD looks for the word "samurai" in the transcript (default, no extra packages)
  openwakeword  pip install openwakeword — audio only reaches the recogniser for wake_window seconds after
                the wake word; models: hey_jarvis, alexa, hey_mycroft, hey_rhasspy, timer, weather
Run: python samurai_speech_server.py   (ws://localhost:9100)
"""
import asyncio, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import MODELS, PORTS, DATA, model_valid, SMALL_MODEL_NAME, LARGE_MODEL_NAME, load_config, bind_host, lan_mode, tls_context

try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
    import websockets
except ImportError as e:
    print(f"[SAMURAI] ERROR: missing package: {e}. Run SETUP.bat / install.py")
    sys.exit(1)

SetLogLevel(-1)
PORT = PORTS["speech"]
if "--port" in sys.argv:
    PORT = int(sys.argv[sys.argv.index("--port") + 1])
SAMPLE_RATE = 16000
VCFG = load_config().get("voice", {})
STT_ENGINE = VCFG.get("stt_engine", "vosk")
if "--engine" in sys.argv:
    STT_ENGINE = sys.argv[sys.argv.index("--engine") + 1]
MODEL_PATHS = {"large": os.path.join(MODELS, LARGE_MODEL_NAME), "small": os.path.join(MODELS, SMALL_MODEL_NAME)}
DEFAULT_MODEL = "large" if model_valid(LARGE_MODEL_NAME) else "small"
if not model_valid(os.path.basename(MODEL_PATHS[DEFAULT_MODEL])):
    print("[SAMURAI] ERROR: no valid Vosk model found. Run SETUP.bat (or the control panel's doctor) to download one,")
    print(f"[SAMURAI] or place a model folder in {MODELS}")
    sys.exit(1)

# ----------------------------------------------------------------------------- optional engines
VAD = None
if VCFG.get("vad", True):
    try:
        import webrtcvad
        VAD = webrtcvad.Vad(2)
        print("[SAMURAI] VAD: webrtcvad on")
    except ImportError:
        print("[SAMURAI] VAD: off (pip install webrtcvad-wheels to enable)")

OWW = None
WAKE_ENGINE = VCFG.get("wake_engine", "text")
if WAKE_ENGINE == "openwakeword":
    try:
        import numpy as np
        import openwakeword
        from openwakeword.model import Model as OWWModel
        name = VCFG.get("oww_model", "hey_jarvis")
        try:
            openwakeword.utils.download_models([name])
        except Exception as e:
            print(f"[SAMURAI] openWakeWord model download skipped: {e}")
        OWW = OWWModel(wakeword_models=[name], inference_framework="onnx")
        print(f"[SAMURAI] wake word engine: openWakeWord ({name})")
    except Exception as e:
        print(f"[SAMURAI] openWakeWord unavailable ({e}) — falling back to text wake word")
        WAKE_ENGINE = "text"
WAKE_WINDOW = float(VCFG.get("wake_window", 8))

_loaded = {}


def get_model(name):
    path = MODEL_PATHS.get(name)
    if not path or not model_valid(os.path.basename(path)):
        return None
    if name not in _loaded:
        print(f"[SAMURAI] Loading '{name}' model from {path}...")
        try:
            _loaded[name] = Model(path)
        except Exception as e:
            print(f"[SAMURAI] ERROR: model '{name}' failed to load: {e}")
            return None
        print(f"[SAMURAI] '{name}' model loaded")
    return _loaded[name]


print(f"[SAMURAI] Default model: {DEFAULT_MODEL}")
if get_model(DEFAULT_MODEL) is None:
    print(f"[SAMURAI] ERROR: the voice model in {MODELS} could not be loaded — delete it and run SETUP.bat again.")
    sys.exit(2)


# ----------------------------------------------------------------------------- whisper (optional)
_whisper = {"model": None, "error": None}


def whisper_model():
    """faster-whisper model, loaded once (CPU, int8). None if the package or the download is unavailable."""
    if _whisper["model"] is not None or _whisper["error"]:
        return _whisper["model"]
    try:
        from faster_whisper import WhisperModel
        name = VCFG.get("whisper_model", "base")
        print(f"[SAMURAI] Loading whisper '{name}' (first run downloads it) ...")
        _whisper["model"] = WhisperModel(name, device="cpu", compute_type="int8", download_root=os.path.join(MODELS, "whisper"))
        print("[SAMURAI] whisper ready")
    except Exception as e:
        _whisper["error"] = str(e)
        print(f"[SAMURAI] whisper unavailable ({e}) — using vosk")
    return _whisper["model"]


class WhisperRec:
    """Same interface as KaldiRecognizer: AcceptWaveform() is True when an utterance ended (then Result()),
    PartialResult() reports that speech is being collected, FinalResult() flushes."""
    BYTES_PER_S = SAMPLE_RATE * 2

    def __init__(self, model):
        self.m, self.buf, self.voiced, self.silence, self.text = model, b"", 0, 0, ""

    def _speech(self, pcm):
        if VAD is not None:
            return has_speech(pcm)
        import array
        a = array.array("h", pcm[: len(pcm) // 2 * 2])
        return (sum(x * x for x in a) / max(1, len(a))) ** 0.5 > 350

    def AcceptWaveform(self, pcm):
        if self._speech(pcm):
            self.buf += pcm; self.voiced += len(pcm); self.silence = 0
        else:
            if self.voiced:
                self.buf += pcm; self.silence += len(pcm)
        if self.voiced >= 0.35 * self.BYTES_PER_S and (self.silence >= 0.8 * self.BYTES_PER_S or self.voiced >= 20 * self.BYTES_PER_S):
            self._transcribe(); return True
        if self.voiced and self.voiced < 0.35 * self.BYTES_PER_S and self.silence >= 1.5 * self.BYTES_PER_S:
            self.buf, self.voiced, self.silence = b"", 0, 0          # a click, not speech
        return False

    def _transcribe(self):
        import numpy as np
        audio = np.frombuffer(self.buf, dtype=np.int16).astype(np.float32) / 32768.0
        self.buf, self.voiced, self.silence = b"", 0, 0
        try:
            segs, _ = self.m.transcribe(audio, language="en", beam_size=2, vad_filter=False, condition_on_previous_text=False)
            self.text = " ".join(s.text.strip() for s in segs).strip().lower().strip(".,!?")
        except Exception as e:
            print(f"[SAMURAI] whisper error: {e}"); self.text = ""

    def Result(self):
        t, self.text = self.text, ""
        return json.dumps({"text": t})

    def PartialResult(self):
        return json.dumps({"partial": "…" if self.voiced else ""})

    def FinalResult(self):
        if self.voiced >= 0.3 * self.BYTES_PER_S:
            self._transcribe()
        else:
            self.buf, self.voiced, self.silence = b"", 0, 0
        return self.Result()


def new_rec(model):
    if STT_ENGINE == "whisper":
        wm = whisper_model()
        if wm is not None:
            return WhisperRec(wm)
    rec = KaldiRecognizer(model, SAMPLE_RATE)
    rec.SetWords(True)
    return rec


def wake_rec(model, phrase):
    """A recogniser that only knows the wake phrase (plus [unk]); None when the model has no dynamic graph (large models)."""
    try:
        rec = KaldiRecognizer(model, SAMPLE_RATE, json.dumps([phrase, "[unk]"]))
        return rec
    except Exception as e:
        print(f"[SAMURAI] wake grammar not supported by this model ({e}); matching the phrase in text instead")
        return None


# ----------------------------------------------------------------------------- voice identity (optional, resemblyzer)
VOICES_DIR = os.path.join(DATA, "voices")
_identity = {"checked": False, "enc": None, "error": ""}


def encoder():
    if _identity["checked"]:
        return _identity["enc"]
    _identity["checked"] = True
    try:
        from resemblyzer import VoiceEncoder
        _identity["enc"] = VoiceEncoder("cpu", verbose=False)
        print("[SAMURAI] voice identity: resemblyzer ready")
    except Exception as e:
        _identity["error"] = str(e)[:120]
        print(f"[SAMURAI] voice identity unavailable (pip install resemblyzer): {e}")
    return _identity["enc"]


def embed(pcm):
    import numpy as np
    enc = encoder()
    if enc is None or len(pcm) < SAMPLE_RATE:                    # under half a second: nothing to compare
        return None
    from resemblyzer import preprocess_wav
    wav = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    return enc.embed_utterance(preprocess_wav(wav, source_sr=SAMPLE_RATE)).tolist()


def load_prints():
    out = {}
    if os.path.isdir(VOICES_DIR):
        for fn in os.listdir(VOICES_DIR):
            if fn.endswith(".json"):
                try:
                    out[fn[:-5]] = json.load(open(os.path.join(VOICES_DIR, fn), encoding="utf-8"))["embedding"]
                except Exception:
                    pass
    return out


def save_print(name, emb):
    os.makedirs(VOICES_DIR, exist_ok=True)
    safe = "".join(c for c in name.lower() if c.isalnum() or c in "-_")[:40] or "user"
    with open(os.path.join(VOICES_DIR, safe + ".json"), "w", encoding="utf-8") as f:
        json.dump({"name": name, "embedding": emb, "t": time.time()}, f)
    return safe


def identify(pcm, prints, threshold=0.75):
    """(name, score) of the closest enrolled voice, or ("unknown", score)."""
    emb = embed(pcm) if prints else None
    if emb is None:
        return "unknown", 0.0
    import numpy as np
    a = np.array(emb)
    best, score = "unknown", 0.0
    for name, e in prints.items():
        b = np.array(e)
        s = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        if s > score:
            best, score = name, s
    return (best if score >= threshold else "unknown"), round(score, 3)


# ----------------------------------------------------------------------------- meeting mode
MEETINGS_DIR = os.path.join(DATA, "meetings")


def meeting_write(path, text, speaker=None):
    os.makedirs(MEETINGS_DIR, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {(speaker + ': ') if speaker and speaker != 'unknown' else ''}{text}\n")


def has_speech(pcm):
    """True if any 30 ms frame in this chunk contains speech (or VAD is unavailable)."""
    if VAD is None:
        return True
    frame = 960                                   # 30 ms @ 16 kHz, 16-bit
    for i in range(0, len(pcm) - frame + 1, frame):
        try:
            if VAD.is_speech(pcm[i:i + frame], SAMPLE_RATE):
                return True
        except Exception:
            return True
    return False


class WakeGate:
    """Feeds 80 ms frames to openWakeWord; opens for WAKE_WINDOW seconds after a detection."""
    def __init__(self):
        self.buf = b""
        self.open_until = 0.0

    def feed(self, pcm):
        if OWW is None:
            return None
        import numpy as np
        self.buf += pcm
        score = 0.0
        while len(self.buf) >= 2560:                  # 1280 samples
            frame = np.frombuffer(self.buf[:2560], dtype=np.int16)
            self.buf = self.buf[2560:]
            pred = OWW.predict(frame)
            score = max(score, max(pred.values()) if pred else 0.0)
        if score >= 0.5:
            self.open_until = time.time() + WAKE_WINDOW
            return score
        return None

    @property
    def is_open(self):
        return OWW is None or time.time() < self.open_until


async def recognize(websocket):
    lan = lan_mode()
    if lan.get("enabled") and lan.get("token") and websocket.remote_address and websocket.remote_address[0] not in ("127.0.0.1", "::1"):
        q = websocket.request.path if hasattr(websocket, "request") else getattr(websocket, "path", "")
        if f"token={lan['token']}" not in q:
            await websocket.close(code=4403, reason="token required"); return
    current = DEFAULT_MODEL
    rec = new_rec(get_model(current))
    gate, silence = WakeGate(), 0
    wake_phrase, wrec, wake_seen = (VCFG.get("wake_phrase") or "").strip().lower(), None, ""
    if wake_phrase:
        wrec = wake_rec(get_model(current), wake_phrase)
    who, prints, utter, enroll = False, {}, b"", None                 # identity: tag finals · rolling audio of the current utterance · pending enrolment
    meeting = None                                                   # path of the transcript while meeting mode is on
    only_enrolled = bool(VCFG.get("only_enrolled"))
    print("[SAMURAI] Client connected")
    await websocket.send(json.dumps({"engine": WAKE_ENGINE, "vad": VAD is not None, "stt": "whisper" if isinstance(rec, WhisperRec) else "vosk",
                                     "identity": encoder() is not None if _identity["checked"] else "lazy", "wake_phrase": wake_phrase}))

    async def final_out(text):
        nonlocal utter, enroll, prints
        speaker = None
        if who or enroll is not None:
            audio, utter = utter, b""
            if enroll is not None and len(audio) >= 1.5 * SAMPLE_RATE * 2:
                emb = await asyncio.get_event_loop().run_in_executor(None, embed, audio)
                name, enroll_name = enroll, enroll
                enroll = None
                if emb is None:
                    await websocket.send(json.dumps({"enroll": enroll_name, "status": "unavailable", "why": _identity["error"] or "too short"}))
                else:
                    safe = save_print(name, emb)
                    prints = load_prints()
                    await websocket.send(json.dumps({"enroll": name, "status": "ok", "id": safe, "enrolled": list(prints)}))
                    print(f"[SAMURAI] enrolled voice '{name}'")
            elif who:
                speaker, score = await asyncio.get_event_loop().run_in_executor(None, identify, audio, prints)
                if only_enrolled and prints and speaker == "unknown":
                    print(f"[SAMURAI] ignored (unknown voice, {score}): {text}")
                    await websocket.send(json.dumps({"text": text, "final": True, "speaker": "unknown", "score": score, "ignored": True}))
                    return
        else:
            utter = b""
        if meeting:
            meeting_write(meeting, text, speaker)
        msg = {"text": text, "final": True}
        if speaker is not None:
            msg["speaker"] = speaker
        if meeting:
            msg["meeting"] = True
        await websocket.send(json.dumps(msg))

    try:
        async for message in websocket:
            if isinstance(message, str) and message.startswith("WAKE:"):
                wake_phrase = message[5:].strip().lower()
                wrec = wake_rec(get_model(current), wake_phrase) if wake_phrase else None
                await websocket.send(json.dumps({"wake_phrase": wake_phrase, "status": "grammar" if wrec else ("text" if wake_phrase else "off")}))
                continue
            if isinstance(message, str) and message.startswith("ENROLL:"):
                name = message[7:].strip()[:40]
                if not name:
                    await websocket.send(json.dumps({"enroll": "", "status": "name required"}))
                elif await asyncio.get_event_loop().run_in_executor(None, encoder) is None:
                    await websocket.send(json.dumps({"enroll": name, "status": "unavailable", "why": "pip install resemblyzer (optional)"}))
                else:
                    enroll, utter = name, b""
                    await websocket.send(json.dumps({"enroll": name, "status": "listening", "hint": "say a few sentences, then pause"}))
                continue
            if isinstance(message, str) and message.startswith("WHO:"):
                who = message[4:].strip() in ("1", "on", "true")
                if who:
                    await asyncio.get_event_loop().run_in_executor(None, encoder)
                    prints = load_prints()
                await websocket.send(json.dumps({"who": who, "enrolled": list(prints), "available": _identity["enc"] is not None}))
                continue
            if isinstance(message, str) and message.startswith("MEETING:"):
                on = message[8:].strip().lower() in ("on", "1", "true")
                meeting = os.path.join(MEETINGS_DIR, time.strftime("%Y-%m-%d") + ".txt") if on else None
                if on:
                    os.makedirs(MEETINGS_DIR, exist_ok=True)
                    meeting_write(meeting, "--- meeting started ---")
                await websocket.send(json.dumps({"meeting": on, "file": meeting or ""}))
                continue
            if isinstance(message, str) and message.startswith("MODEL:"):
                name = message[6:].strip().lower()
                if name == current:
                    await websocket.send(json.dumps({"model": name, "status": "ok"}))
                    continue
                m = await asyncio.get_event_loop().run_in_executor(None, get_model, name)
                if m:
                    current, rec = name, new_rec(m)
                    wrec = wake_rec(m, wake_phrase) if wake_phrase else None
                    print(f"[SAMURAI] Switched to '{name}' model")
                    await websocket.send(json.dumps({"model": name, "status": "ok"}))
                else:
                    await websocket.send(json.dumps({"model": name, "status": "missing"}))
                continue
            if isinstance(message, bytes):
                score = gate.feed(message)
                if score is not None:
                    print(f"[SAMURAI] Wake word ({score:.2f})")
                    await websocket.send(json.dumps({"wake": True, "score": round(float(score), 2)}))
                    rec = new_rec(get_model(current))
                if not gate.is_open:
                    continue
                if has_speech(message):
                    silence = 0
                    if who or enroll is not None:
                        utter = (utter + message)[-20 * SAMPLE_RATE * 2:]
                else:
                    silence += 1
                    if silence > 40:                  # ~5 s of silence: skip the recogniser, save CPU
                        continue
                if wrec is not None:                  # custom wake phrase through a grammar-limited recogniser
                    if wrec.AcceptWaveform(message):
                        heard = json.loads(wrec.Result()).get("text", "")
                        if wake_phrase in heard:
                            print(f"[SAMURAI] Wake phrase '{wake_phrase}'")
                            await websocket.send(json.dumps({"wake": True, "score": 1.0, "phrase": wake_phrase}))
                            gate.open_until = time.time() + WAKE_WINDOW
                if rec.AcceptWaveform(message):
                    text = json.loads(rec.Result()).get("text", "").strip()
                    wake_seen = ""
                    if text:
                        print(f"[SAMURAI] Heard: {text}")
                        await final_out(text)
                else:
                    ptext = json.loads(rec.PartialResult()).get("partial", "").strip()
                    if ptext:
                        if wake_phrase and wrec is None and wake_phrase in ptext and wake_seen != ptext:
                            wake_seen = ptext
                            await websocket.send(json.dumps({"wake": True, "score": 0.9, "phrase": wake_phrase}))
                        await websocket.send(json.dumps({"text": ptext, "final": False}))
            elif message == "EOF":
                text = json.loads(rec.FinalResult()).get("text", "").strip()
                if text:
                    print(f"[SAMURAI] Final: {text}")
                    await final_out(text)
                rec = new_rec(get_model(current))
    except websockets.exceptions.ConnectionClosed:
        print("[SAMURAI] Client disconnected")


async def main():
    ctx = tls_context()
    async with websockets.serve(recognize, bind_host(), PORT, max_size=2**20, ssl=ctx):
        print(f"[SAMURAI] Listening on {'wss' if ctx else 'ws'}://localhost:{PORT} · stt engine {STT_ENGINE}")
        await asyncio.Future()


if __name__ == "__main__":
    if STT_ENGINE == "whisper":
        import threading
        threading.Thread(target=whisper_model, daemon=True).start()
    asyncio.run(main())
