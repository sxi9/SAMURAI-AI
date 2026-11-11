"""
SAMURAI Speech Server — Local Vosk-based speech-to-text via WebSocket, with optional
voice-activity detection (webrtcvad) and an optional wake-word engine (openWakeWord).

Browser sends raw 16 kHz mono PCM audio, server returns transcribed text.
Client messages: binary PCM chunks, "EOF" (finalise), "MODEL:small|large".
Server messages: {"text", "final"}, {"wake": true, "score"}, {"model", "status"}, {"engine", "vad"}

config.json  "voice": {"vad": true, "wake_engine": "text" | "openwakeword", "oww_model": "hey_jarvis", "wake_window": 8}
  text          the HUD looks for the word "samurai" in the transcript (default, no extra packages)
  openwakeword  pip install openwakeword — audio only reaches the recogniser for wake_window seconds after
                the wake word; models: hey_jarvis, alexa, hey_mycroft, hey_rhasspy, timer, weather
Run: python samurai_speech_server.py   (ws://localhost:9100)
"""
import asyncio, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import MODELS, PORTS, model_valid, SMALL_MODEL_NAME, LARGE_MODEL_NAME, load_config

try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
    import websockets
except ImportError as e:
    print(f"[SAMURAI] ERROR: missing package: {e}. Run SETUP.bat / install.py")
    sys.exit(1)

SetLogLevel(-1)
PORT = PORTS["speech"]
SAMPLE_RATE = 16000
VCFG = load_config().get("voice", {})
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


def new_rec(model):
    rec = KaldiRecognizer(model, SAMPLE_RATE)
    rec.SetWords(True)
    return rec


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
    current = DEFAULT_MODEL
    rec = new_rec(get_model(current))
    gate, silence = WakeGate(), 0
    print("[SAMURAI] Client connected")
    await websocket.send(json.dumps({"engine": WAKE_ENGINE, "vad": VAD is not None}))
    try:
        async for message in websocket:
            if isinstance(message, str) and message.startswith("MODEL:"):
                name = message[6:].strip().lower()
                if name == current:
                    await websocket.send(json.dumps({"model": name, "status": "ok"}))
                    continue
                m = await asyncio.get_event_loop().run_in_executor(None, get_model, name)
                if m:
                    current, rec = name, new_rec(m)
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
                else:
                    silence += 1
                    if silence > 40:                  # ~5 s of silence: skip the recogniser, save CPU
                        continue
                if rec.AcceptWaveform(message):
                    text = json.loads(rec.Result()).get("text", "").strip()
                    if text:
                        print(f"[SAMURAI] Heard: {text}")
                        await websocket.send(json.dumps({"text": text, "final": True}))
                else:
                    ptext = json.loads(rec.PartialResult()).get("partial", "").strip()
                    if ptext:
                        await websocket.send(json.dumps({"text": ptext, "final": False}))
            elif message == "EOF":
                text = json.loads(rec.FinalResult()).get("text", "").strip()
                if text:
                    print(f"[SAMURAI] Final: {text}")
                    await websocket.send(json.dumps({"text": text, "final": True}))
                rec = new_rec(get_model(current))
    except websockets.exceptions.ConnectionClosed:
        print("[SAMURAI] Client disconnected")


async def main():
    async with websockets.serve(recognize, "localhost", PORT, max_size=2**20):
        print(f"[SAMURAI] Listening on ws://localhost:{PORT}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
