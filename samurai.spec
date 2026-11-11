# PyInstaller spec — builds the SAMURAI one-folder app (SAMURAI.exe on Windows).
#   pip install pyinstaller && pyinstaller samurai.spec
# Output: dist/SAMURAI/  (zip the folder; config.json, data/, logs/, models/ are created next to the executable)
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [("app", "app"), ("servers", "servers"), ("plugins", "plugins"), ("tests/mock_llm.py", "tests"),
                                  ("config.example.json", "."), ("requirements.txt", ".")], [], []
for pkg in ("vosk", "edge_tts", "websockets", "psutil", "certifi"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h
hiddenimports += collect_submodules("servers") if False else []
hiddenimports += ["samurai_common", "samurai_automation", "samurai_autostart", "samurai_panel", "samurai_telemetry", "samurai_tts_server",
                  "samurai_speech_server", "samurai_action_server", "samurai_agent_server", "samurai_addons", "samurai_browser", "mock_llm",
                  "imaplib", "smtplib", "email.message", "plistlib", "http.server", "socketserver", "asyncio", "multiprocessing"]

a = Analysis(["samurai_launcher.py"], pathex=["servers", "tests"], binaries=binaries, datas=datas, hiddenimports=hiddenimports,
             hookspath=[], runtime_hooks=[], excludes=["tkinter", "matplotlib", "numpy", "scipy", "PIL", "pystray", "playwright", "keyring"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="SAMURAI", debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=True, icon=None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="SAMURAI")
