"""
SAMURAI Speech Server — Local Vosk-based speech-to-text via WebSocket.
Browser sends raw PCM audio, server returns transcribed text.
Run: python samurai_speech_server.py
"""
import asyncio, json, os, sys
from vosk import Model, KaldiRecognizer
import websockets

_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.dirname(_here)


def _find_model(folder):
    # look in package models/, then next to the package, then next to this script
    for base in (os.path.join(_root, "models"), os.path.dirname(_root), _here):
        p = os.path.join(base, folder)
        if os.path.isdir(p):
            return p
    return os.path.join(_root, "models", folder)


MODEL_PATHS = {
    "large": _find_model("vosk-model-en-us-0.22"),
    "small": _find_model("vosk-model-small-en-us-0.15"),
}
DEFAULT_MODEL = "large" if os.path.isdir(MODEL_PATHS["large"]) else "small"
if not os.path.isdir(MODEL_PATHS[DEFAULT_MODEL]):
    print("[SAMURAI] ERROR: no Vosk model found. Run SETUP.bat and choose a voice model,")
    print(f"[SAMURAI] or place a model folder in {os.path.join(_root, 'models')}")
    sys.exit(1)
SAMPLE_RATE = 16000
PORT = 9100

_loaded = {}
def get_model(name):
    path = MODEL_PATHS.get(name)
    if not path or not os.path.isdir(path):
        return None
    if name not in _loaded:
        print(f"[SAMURAI] Loading '{name}' model from {path}...")
        _loaded[name] = Model(path)
        print(f"[SAMURAI] '{name}' model loaded")
    return _loaded[name]

print(f"[SAMURAI] Default model: {DEFAULT_MODEL}")
if get_model(DEFAULT_MODEL) is None:
    print(f"[SAMURAI] ERROR: no voice model found in {_models}")
    print("[SAMURAI] Run SETUP.bat (or the dashboard auto-fix) to download one.")
    sys.exit(2)
print(f"[SAMURAI] Starting WebSocket server on ws://localhost:{PORT}")

async def recognize(websocket):
    current = DEFAULT_MODEL
    rec = KaldiRecognizer(get_model(current), SAMPLE_RATE)
    rec.SetWords(True)
    print("[SAMURAI] Client connected")
    try:
        async for message in websocket:
            if isinstance(message, str) and message.startswith("MODEL:"):
                name = message[6:].strip().lower()
                if name == current:
                    await websocket.send(json.dumps({"model": name, "status": "ok"}))
                    continue
                loop = asyncio.get_event_loop()
                m = await loop.run_in_executor(None, get_model, name)
                if m:
                    current = name
                    rec = KaldiRecognizer(m, SAMPLE_RATE)
                    rec.SetWords(True)
                    print(f"[SAMURAI] Switched to '{name}' model")
                    await websocket.send(json.dumps({"model": name, "status": "ok"}))
                else:
                    await websocket.send(json.dumps({"model": name, "status": "missing"}))
                continue
            if isinstance(message, bytes):
                if rec.AcceptWaveform(message):
                    result = json.loads(rec.Result())
                    text = result.get("text", "").strip()
                    if text:
                        print(f"[SAMURAI] Heard: {text}")
                        await websocket.send(json.dumps({"text": text, "final": True}))
                else:
                    partial = json.loads(rec.PartialResult())
                    ptext = partial.get("partial", "").strip()
                    if ptext:
                        await websocket.send(json.dumps({"text": ptext, "final": False}))
            elif message == "EOF":
                result = json.loads(rec.FinalResult())
                text = result.get("text", "").strip()
                if text:
                    print(f"[SAMURAI] Final: {text}")
                    await websocket.send(json.dumps({"text": text, "final": True}))
                rec = KaldiRecognizer(get_model(current), SAMPLE_RATE)
                rec.SetWords(True)
    except websockets.exceptions.ConnectionClosed:
        print("[SAMURAI] Client disconnected")

async def main():
    async with websockets.serve(recognize, "localhost", PORT):
        print(f"[SAMURAI] Listening on ws://localhost:{PORT}")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
