"""
SAMURAI Speech Server — Local Vosk-based speech-to-text via WebSocket.
Browser sends raw 16 kHz mono PCM audio, server returns transcribed text.
Messages from the client: binary PCM chunks, "EOF" (finalise), "MODEL:small|large".
Run: python samurai_speech_server.py   (ws://localhost:9100)
"""
import asyncio, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import MODELS, PORTS, model_valid, SMALL_MODEL_NAME, LARGE_MODEL_NAME

try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
    import websockets
except ImportError as e:
    print(f"[SAMURAI] ERROR: missing package: {e}. Run SETUP.bat / install.py")
    sys.exit(1)

SetLogLevel(-1)
PORT = PORTS["speech"]
SAMPLE_RATE = 16000
MODEL_PATHS = {"large": os.path.join(MODELS, LARGE_MODEL_NAME), "small": os.path.join(MODELS, SMALL_MODEL_NAME)}
DEFAULT_MODEL = "large" if model_valid(LARGE_MODEL_NAME) else "small"
if not model_valid(MODEL_PATHS[DEFAULT_MODEL].rsplit(os.sep, 1)[-1]):
    print("[SAMURAI] ERROR: no valid Vosk model found. Run SETUP.bat (or the dashboard auto-fix) to download one,")
    print(f"[SAMURAI] or place a model folder in {MODELS}")
    sys.exit(1)

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


async def recognize(websocket):
    current = DEFAULT_MODEL
    rec = new_rec(get_model(current))
    print("[SAMURAI] Client connected")
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
