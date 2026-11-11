#!/usr/bin/env python3
"""SAMURAI one-shot installer — Windows, Linux, macOS.

    python install.py            interactive
    python install.py --yes      take the defaults (small voice model, shortcuts, no autostart)
    options: --large-model  --no-model  --agents  --autostart  --no-shortcut  --start

Creates .venv, installs requirements, downloads the offline voice model, copies config.json,
optionally installs the headless agent CLIs (Claude Code / Gemini CLI, needs Node.js),
creates a desktop shortcut, enables start-with-boot, runs the doctor, and can start everything.
Needs only Python 3.9+ to begin.
"""
import os, platform, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "servers"))
IS_WIN, IS_MAC = os.name == "nt", sys.platform == "darwin"
ARGS = set(a for a in sys.argv[1:] if a.startswith("--"))
YES = "--yes" in ARGS
VENV = os.path.join(ROOT, ".venv")
PY = os.path.join(VENV, "Scripts" if IS_WIN else "bin", "python.exe" if IS_WIN else "python")
PYW = PY.replace("python.exe", "pythonw.exe") if IS_WIN else PY


def say(msg):
    print(f"  {msg}", flush=True)


def ask(q, default=True):
    if YES:
        return default
    a = input(f"  {q} [{'Y/n' if default else 'y/N'}] ").strip().lower()
    return default if not a else a.startswith("y")


def run(cmd, **kw):
    return subprocess.run(cmd, **kw)


def step_python():
    v = sys.version_info
    say(f"Python {v.major}.{v.minor}.{v.micro} on {platform.system()} {platform.machine()}")
    if v < (3, 9):
        sys.exit("  SAMURAI needs Python 3.9 or newer: https://www.python.org/downloads/")
    if IS_WIN:
        try:
            import tkinter  # noqa
        except ImportError:
            say("note: tkinter missing — the old tkinter dashboard won't run, the browser control panel will")


def step_venv():
    if not os.path.exists(PY):
        say("creating virtual environment .venv …")
        r = run([sys.executable, "-m", "venv", VENV])
        if r.returncode != 0:
            sys.exit("  could not create .venv (on Debian/Ubuntu: sudo apt install python3-venv)")
    say("upgrading pip / setuptools / wheel …")
    run([PY, "-m", "pip", "install", "--quiet", "--upgrade", "pip", "setuptools", "wheel"])
    say("installing requirements …")
    r = run([PY, "-m", "pip", "install", "--quiet", "-r", os.path.join(ROOT, "requirements.txt")])
    if r.returncode != 0:
        say("! pip failed — retrying without --quiet so you can see why")
        run([PY, "-m", "pip", "install", "-r", os.path.join(ROOT, "requirements.txt")])
    r = run([PY, "-c", "import vosk, websockets, psutil, edge_tts"], capture_output=True, text=True)
    say("packages ok" if r.returncode == 0 else "! some packages failed: " + (r.stderr or "").strip().splitlines()[-1][:100])


def step_config():
    import samurai_common as c
    if not os.path.exists(c.CONFIG_PATH) and os.path.exists(c.CONFIG_EXAMPLE):
        shutil.copy(c.CONFIG_EXAMPLE, c.CONFIG_PATH)
        say("config.json created from config.example.json (edit it in the control panel)")
    for d in ("logs", "data", "gallery", "workspace", "models"):
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)


def step_model():
    import samurai_common as c
    if "--no-model" in ARGS:
        return
    if c.any_valid_model():
        say("voice model present")
    else:
        say("downloading the offline voice model (40 MB) …")
        ok, msg = c.ensure_model(lambda s: print("\r    " + s.ljust(70), end="", flush=True))
        print()
        say(("ok: " if ok else "! ") + msg)
    if "--large-model" in ARGS or (not YES and ask("Also download the LARGE, more accurate model (1.8 GB)?", False)):
        ok, msg = c.ensure_model(lambda s: print("\r    " + s.ljust(70), end="", flush=True), name=c.LARGE_MODEL_NAME)
        print()
        say(("ok: " if ok else "! ") + msg)


def step_agents():
    if not ("--agents" in ARGS or (not YES and ask("Install the headless agent CLIs (Claude Code / Gemini CLI)? needs Node.js", False))):
        return
    npm = shutil.which("npm")
    if not npm:
        say("! npm not found — install Node.js from https://nodejs.org then run: npm install -g @anthropic-ai/claude-code @google/gemini-cli")
        return
    for pkg in ("@anthropic-ai/claude-code", "@google/gemini-cli"):
        say(f"npm install -g {pkg} …")
        run([npm, "install", "-g", pkg], shell=IS_WIN)
    say("sign in once: run `claude auth login` and/or `gemini` in a terminal, then pick the headless provider in the HUD settings")


def step_shortcut():
    if "--no-shortcut" in ARGS:
        return
    panel = os.path.join(ROOT, "servers", "samurai_panel.py")
    try:
        if IS_WIN:
            ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\SAMURAI.lnk');"
                  f"$s.TargetPath='{PYW}';$s.Arguments='\"{panel}\" --autostart';$s.WorkingDirectory='{ROOT}';$s.Save()")
            run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)
            say("desktop shortcut SAMURAI.lnk created")
        elif IS_MAC:
            app = os.path.join(os.path.expanduser("~"), "Desktop", "SAMURAI.command")
            with open(app, "w") as f:
                f.write(f"#!/bin/bash\ncd '{ROOT}'\n'{PY}' '{panel}' --autostart\n")
            os.chmod(app, 0o755)
            say("SAMURAI.command created on the Desktop")
        else:
            apps = os.path.join(os.path.expanduser("~"), ".local", "share", "applications")
            os.makedirs(apps, exist_ok=True)
            with open(os.path.join(apps, "samurai.desktop"), "w") as f:
                f.write(f"[Desktop Entry]\nType=Application\nName=SAMURAI\nComment=Jarvis-style assistant\nExec={PY} {panel} --autostart\nPath={ROOT}\nTerminal=false\nCategories=Utility;\n")
            say("application menu entry 'SAMURAI' created")
    except Exception as e:
        say(f"! shortcut failed: {e}")


def step_autostart():
    if "--autostart" in ARGS or (not YES and ask("Start SAMURAI automatically when you log in?", False)):
        try:
            import samurai_autostart
            samurai_autostart.enable()
            say("start-with-boot enabled")
        except Exception as e:
            say(f"! autostart failed: {e}")


def step_doctor():
    say("checking the install …")
    r = run([PY, "-c", "import sys; sys.path.insert(0,'servers'); import samurai_panel as p, json; "
             "cs=p.doctor(fix=False); [print('    ' + ('ok ' if c['ok'] else '!! ') + c['name'] + ' — ' + c['detail']) for c in cs if not c['name'].startswith('Service')]"],
            cwd=ROOT)


def step_start():
    if "--start" in ARGS or (not YES and ask("Start SAMURAI now?", True)):
        panel = os.path.join(ROOT, "servers", "samurai_panel.py")
        flags = 0x08000000 if IS_WIN else 0
        subprocess.Popen([PYW, panel, "--autostart"], cwd=ROOT, creationflags=flags, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        say("control panel: http://localhost:9000  ·  HUD opens when the services are up")


if __name__ == "__main__":
    print("\n  S A M U R A I  —  installer\n")
    step_python(); step_venv(); step_config(); step_model(); step_agents(); step_shortcut(); step_autostart(); step_doctor(); step_start()
    print("\n  done. Later: START.bat / install.sh --start, or open http://localhost:9000\n")
