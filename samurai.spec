# PyInstaller spec — builds the SAMURAI one-folder app (SAMURAI.exe on Windows).
#   pip install pyinstaller && pyinstaller samurai.spec
# Output: dist/SAMURAI/  (zip the folder; config.json, data/, logs/, models/ are created next to the executable)
from PyInstaller.utils.hooks import collect_all, collect_submodules

import os
datas, binaries, hiddenimports = [("app", "app"), ("servers", "servers"), ("plugins", "plugins"), ("tests/mock_llm.py", "tests"),
                                  ("config.example.json", "."), ("requirements.txt", "."), ("VERSION", ".")], [], []
# the source tree, so the packaged build can hand it to the forge (control panel -> PREPARE SOURCES): copied to data/src on request
datas += [("servers", "src/servers"), ("tests", "src/tests"), ("plugins", "src/plugins"), ("requirements.txt", "src"),
          ("samurai_launcher.py", "src"), ("install.py", "src"), ("VERSION", "src"), ("config.example.json", "src"), ("samurai.spec", "src")]
if os.path.isdir("installer"):
    datas += [("installer", "src/installer")]
ICON = os.path.join("app", "icons", "samurai.ico") if os.path.exists(os.path.join("app", "icons", "samurai.ico")) else None
for pkg in ("vosk", "edge_tts", "websockets", "psutil", "certifi"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h
import importlib.util
for pkg in ("cryptography", "qrcode", "faster_whisper", "ctranslate2", "huggingface_hub", "tokenizers", "onnxruntime", "webview", "clr_loader", "pythonnet", "proxy_tools", "bottle", "keyboard"):   # optional: bundled when installed (webview = pywebview app window)
    if importlib.util.find_spec(pkg):
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
hiddenimports += collect_submodules("servers") if False else []
hiddenimports += ["samurai_common", "samurai_automation", "samurai_autostart", "samurai_panel", "samurai_telemetry", "samurai_tts_server",
                  "samurai_speech_server", "samurai_action_server", "samurai_agent_server", "samurai_addons", "samurai_browser", "samurai_window", "samurai_update", "samurai_forge", "samurai_tune", "samurai_connect", "samurai_findmy", "samurai_mcp", "samurai_meter", "samurai_senses", "samurai_home2", "samurai_market", "mock_llm",
                  "imaplib", "smtplib", "email.message", "plistlib", "http.server", "socketserver", "asyncio", "multiprocessing"]

a = Analysis(["samurai_launcher.py"], pathex=["servers", "tests"], binaries=binaries, datas=datas, hiddenimports=hiddenimports,
             hookspath=[], runtime_hooks=[], excludes=["tkinter", "matplotlib", "numpy", "scipy", "PIL", "pystray", "playwright", "keyring"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="SAMURAI", debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=True, icon=ICON)
# the forge sources get app/ without the 11 MB sample avatar (the UI server serves the bundled app/avatars for the overlay)
coll = COLLECT(exe, a.binaries, a.datas, Tree("app", prefix="src/app", excludes=["*.vrm"]), strip=False, upx=False, name="SAMURAI")
