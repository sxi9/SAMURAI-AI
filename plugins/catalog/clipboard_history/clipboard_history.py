"""SAMURAI marketplace plugin: clipboard history. Installed by POST /plugins/install {url: "plugins/catalog/clipboard_history"}.
Polls the clipboard every 2 s (pyperclip when installed, else the OS tool) and keeps the last 20 distinct texts in memory."""
import shutil, subprocess, sys, threading, time

HISTORY = []
LOCK = threading.Lock()


def read_clip():
    try:
        import pyperclip
        return pyperclip.paste()
    except Exception:
        pass
    try:
        if sys.platform.startswith("win"):
            return subprocess.run(["powershell", "-NoProfile", "-Command", "Get-Clipboard"], capture_output=True, text=True, timeout=3).stdout
        if sys.platform == "darwin":
            return subprocess.run(["pbpaste"], capture_output=True, text=True, timeout=3).stdout
        if shutil.which("xclip"):
            return subprocess.run(["xclip", "-selection", "clipboard", "-o"], capture_output=True, text=True, timeout=3).stdout
        if shutil.which("wl-paste"):
            return subprocess.run(["wl-paste", "-n"], capture_output=True, text=True, timeout=3).stdout
    except Exception:
        pass
    return ""


def _poll():
    last = None
    while True:
        try:
            t = (read_clip() or "").strip()
            if t and t != last:
                last = t
                with LOCK:
                    if t in HISTORY:
                        HISTORY.remove(t)
                    HISTORY.insert(0, t); del HISTORY[20:]
        except Exception:
            pass
        time.sleep(2)


threading.Thread(target=_poll, daemon=True).start()


def clip_history(arg):
    with LOCK:
        items = HISTORY[:5]
    if not items:
        return "Nothing copied yet."
    return "Recent clips: " + "; ".join(f"{i + 1}, {t[:60]}" for i, t in enumerate(items))


def clip_recall(arg):
    n = int("".join(ch for ch in (arg or "1") if ch.isdigit()) or 1)
    with LOCK:
        t = HISTORY[n - 1] if 0 < n <= len(HISTORY) else None
    if t is None:
        return f"I only have {len(HISTORY)} clips."
    try:
        import pyperclip
        pyperclip.copy(t)
        return f"Clip {n} is back on the clipboard: {t[:80]}"
    except Exception:
        return f"Clip {n}: {t[:200]}"


PLUGIN = {
    "name": "clipboard_history",
    "description": "Remembers the last 20 things you copied.",
    "tools": [
        {"type": "clip_history", "description": "list the last few things copied to the clipboard", "run": clip_history},
        {"type": "clip_recall", "description": "put an earlier clip back on the clipboard; arg = its number", "run": clip_recall},
    ],
}
