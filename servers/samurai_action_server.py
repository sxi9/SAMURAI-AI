"""SAMURAI Action Sidecar — lets SAMURAI control the PC. Windows, Linux and macOS.
POST http://localhost:9300/action   body: {"type": "...", "arg": "...", "confirm": true}
GET  http://localhost:9300/actions  -> the list of supported action types on this OS

Levels:
  open     open_url, web_search, play_music, open_app, open_path            (allow-listed apps)
  control  volume_up/down/set, mute, media_play_pause/next/prev, brightness, screenshot,
           clipboard_get/set, type_text, hotkey, lock
  power    sleep, shutdown, restart, kill_process, run_command   -> need "confirm": true in the request
           run_command only runs entries from config.json "actions.commands" (name -> command line)
Run: python samurai_action_server.py
"""
import glob, importlib.util, json, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request, webbrowser
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import maybe_wrap_tls, bind_host, JSONHandler, NOWIN, IS_WIN, IS_MAC, PORTS, ROOT, DATA, load_config

PORT = PORTS["actions"]
SHOTS = os.path.join(ROOT, "data", "screenshots")

# friendly name -> launch target per OS (fixed constants; user text never reaches a shell)
APPS_WIN = {
    "chrome": "chrome", "google chrome": "chrome", "edge": "msedge", "microsoft edge": "msedge",
    "firefox": "firefox", "brave": "brave", "spotify": "spotify",
    "explorer": "explorer", "file explorer": "explorer", "files": "explorer",
    "notepad": "notepad", "calculator": "calc", "calc": "calc", "paint": "mspaint",
    "settings": "ms-settings:", "cmd": "cmd", "command prompt": "cmd",
    "terminal": "wt", "windows terminal": "wt", "powershell": "powershell",
    "vscode": "code", "vs code": "code", "code": "code",
    "word": "winword", "excel": "excel", "powerpoint": "powerpnt",
    "task manager": "taskmgr", "taskmgr": "taskmgr", "camera": "microsoft.windows.camera:",
    "youtube": "https://www.youtube.com", "discord": "discord", "steam": "steam", "vlc": "vlc",
}
APPS_LINUX = {
    "chrome": "google-chrome", "google chrome": "google-chrome", "chromium": "chromium",
    "firefox": "firefox", "brave": "brave-browser", "spotify": "spotify",
    "files": "xdg-open ~", "explorer": "xdg-open ~", "file explorer": "xdg-open ~",
    "terminal": "x-terminal-emulator", "vscode": "code", "vs code": "code", "code": "code",
    "calculator": "gnome-calculator", "calc": "gnome-calculator", "settings": "gnome-control-center",
    "text editor": "gedit", "notepad": "gedit", "vlc": "vlc", "discord": "discord", "steam": "steam",
    "youtube": "https://www.youtube.com",
}
APPS_MAC = {
    "chrome": "Google Chrome", "google chrome": "Google Chrome", "safari": "Safari", "firefox": "Firefox",
    "brave": "Brave Browser", "spotify": "Spotify", "files": "Finder", "finder": "Finder", "explorer": "Finder",
    "terminal": "Terminal", "vscode": "Visual Studio Code", "vs code": "Visual Studio Code", "code": "Visual Studio Code",
    "calculator": "Calculator", "calc": "Calculator", "settings": "System Settings", "notes": "Notes",
    "notepad": "TextEdit", "music": "Music", "vlc": "VLC", "discord": "Discord", "youtube": "https://www.youtube.com",
}
APPS = APPS_WIN if IS_WIN else (APPS_MAC if IS_MAC else APPS_LINUX)
POWER_ACTIONS = {"sleep", "shutdown", "restart", "kill_process", "run_command", "desktop_step", "ssh_run", "cleanup"}
CONNECT_ACTIONS = {"push_phone", "wake_machine", "ssh_run", "wifi", "bluetooth", "vpn", "telegram_send", "post_webhook", "launch_game", "cleanup"}


def connect_call(path, body):
    """Forward to the connect routes on the add-ons sidecar (servers/samurai_connect.py)."""
    req = urllib.request.Request(f"http://127.0.0.1:{PORTS['addons']}{path}", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise ValueError(json.loads(e.read() or b"{}").get("error", f"add-ons sidecar answered {e.code}"))
    except OSError:
        raise ValueError("add-ons sidecar is not running")


def do_connect_action(atype, arg):
    if atype == "push_phone":
        connect_call("/push", {"title": "SAMURAI", "body": arg}); return f"Sent to your phone: {arg[:60]}"
    if atype == "wake_machine":
        r = connect_call("/wol", {"mac": arg} if ":" in arg or "-" in arg else {"name": arg}); return f"Wake packet sent to {r.get('mac')}"
    if atype == "ssh_run":
        m = re.match(r"^\s*([\w.-]+)\s*[:,]?\s+(.+)$", arg)
        if not m:
            raise ValueError("say 'machine: command', e.g. 'nas: df -h'")
        r = connect_call("/ssh", {"name": m.group(1), "command": m.group(2)})
        return f"{m.group(1)} said: {(r.get('out') or r.get('err') or 'nothing')[:300]}"
    if atype in ("wifi", "bluetooth", "vpn"):
        on = not re.search(r"\b(off|disable|disconnect|down)\b", arg.lower())
        connect_call("/radio", {"kind": atype, "on": on}); return f"{atype} {'on' if on else 'off'}"
    if atype == "telegram_send":
        connect_call("/telegram", {"text": arg}); return "Sent on Telegram"
    if atype == "post_webhook":
        m = re.match(r"^(discord|slack)\s*[:,]\s*(.+)$", arg, re.I)
        r = connect_call("/webhook", {"target": m.group(1).lower(), "text": m.group(2)} if m else {"text": arg}); return f"Posted to {r.get('target')}"
    if atype == "launch_game":
        r = connect_call("/games", {"appid": int(arg)} if arg.isdigit() else {"name": arg}); return f"Launching {r.get('name')}"
    if atype == "cleanup":
        r = connect_call("/cleanup", {"confirm": True}); return f"Cleaned {r.get('removed', 0)} temp files, {r.get('freed', 0) // 1048576} MB freed"
    raise ValueError(f"unknown action '{atype}'")
AUDIT_PATH = os.path.join(DATA, "audit.jsonl")
PLUGINS = {}          # tool type -> {"run": fn, "description": str, "plugin": name}


def load_plugins():
    """plugins/*.py each define PLUGIN = {"name", "description", "tools": [{"type", "description", "run": fn(arg) -> str}]}"""
    PLUGINS.clear()
    for path in sorted(glob.glob(os.path.join(ROOT, "plugins", "*.py"))):
        if os.path.basename(path).startswith("_"):
            continue
        try:
            spec = importlib.util.spec_from_file_location("samurai_plugin_" + os.path.basename(path)[:-3], path)
            mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
            pl = getattr(mod, "PLUGIN", None)
            for t in (pl or {}).get("tools", []):
                if t.get("type") and callable(t.get("run")):
                    PLUGINS[t["type"]] = {"run": t["run"], "description": t.get("description", ""), "plugin": pl.get("name", os.path.basename(path))}
            print(f"[SAMURAI-ACT] plugin {pl.get('name') if pl else path}: {len((pl or {}).get('tools', []))} tool(s)")
        except Exception as e:
            print(f"[SAMURAI-ACT] plugin {path} failed: {e}")


def audit(atype, arg, ok, result):
    try:
        os.makedirs(DATA, exist_ok=True)
        with open(AUDIT_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": time.time(), "type": atype, "arg": (arg or "")[:200], "ok": bool(ok), "result": str(result)[:200]}) + "\n")
    except OSError:
        pass


def read_audit(n=50, since=0):
    out = []
    try:
        with open(AUDIT_PATH, encoding="utf-8") as f:
            for line in f.readlines()[-max(n, 1) * 4:]:
                try:
                    e = json.loads(line)
                    if e["t"] >= since:
                        out.append(e)
                except ValueError:
                    pass
    except OSError:
        pass
    return out[-n:]


def sh(cmd, timeout=15, check=False):
    """Run a fixed command list (never user text) and return stdout."""
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=NOWIN)
    if check and r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "command failed").strip()[:200])
    return (r.stdout or "").strip()


def ps(script, timeout=15):
    return sh(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], timeout)


def launch(target):
    if target.startswith("http"):
        webbrowser.open(target)
    elif IS_WIN:
        subprocess.Popen(f'start "" "{target}"', shell=True, creationflags=NOWIN)
    elif IS_MAC:
        subprocess.Popen(["open", "-a", target])
    else:
        parts = target.split()
        if parts[0] == "xdg-open":
            subprocess.Popen(["xdg-open", os.path.expanduser(parts[1])])
        elif shutil.which(parts[0]):
            subprocess.Popen(parts, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            raise ValueError(f"'{parts[0]}' is not installed")


def yt_first_video(query):
    try:
        url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9"})
        html = urllib.request.urlopen(req, timeout=6).read().decode("utf-8", "ignore")
        m = re.search(r'"videoId":"([\w-]{11})"', html)
        return m.group(1) if m else None
    except Exception:
        return None


# ----------------------------------------------------------------------------- control helpers
def _vol_linux(delta=None, level=None, mute=None):
    if shutil.which("pactl"):
        if mute is not None:
            sh(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle" if mute == "toggle" else ("1" if mute else "0")])
        elif level is not None:
            sh(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{int(level)}%"])
        else:
            sh(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{'+' if delta > 0 else '-'}{abs(int(delta))}%"])
    elif shutil.which("amixer"):
        if mute is not None:
            sh(["amixer", "set", "Master", "toggle" if mute == "toggle" else ("mute" if mute else "unmute")])
        elif level is not None:
            sh(["amixer", "set", "Master", f"{int(level)}%"])
        else:
            sh(["amixer", "set", "Master", f"{abs(int(delta))}%{'+' if delta > 0 else '-'}"])
    else:
        raise ValueError("no pactl/amixer found")


def _vol_win(delta=None, level=None, mute=None):
    # virtual key presses via the shell COM object: VOLUME_UP 0xAF, VOLUME_DOWN 0xAE, VOLUME_MUTE 0xAD
    if mute is not None:
        ps("(New-Object -ComObject WScript.Shell).SendKeys([char]173)")
    elif level is not None:
        steps = int(level) // 2
        ps("$w=New-Object -ComObject WScript.Shell; 1..50 | % { $w.SendKeys([char]174) }; "
           f"1..{max(0, steps)} | % {{ $w.SendKeys([char]175) }}", timeout=30)
    else:
        key = 175 if delta > 0 else 174
        ps(f"$w=New-Object -ComObject WScript.Shell; 1..{max(1, abs(int(delta)) // 2)} | % {{ $w.SendKeys([char]{key}) }}")


def _vol_mac(delta=None, level=None, mute=None):
    if mute is not None:
        sh(["osascript", "-e", "set volume output muted not (output muted of (get volume settings))"])
    elif level is not None:
        sh(["osascript", "-e", f"set volume output volume {int(level)}"])
    else:
        cur = int(sh(["osascript", "-e", "output volume of (get volume settings)"]) or 50)
        sh(["osascript", "-e", f"set volume output volume {max(0, min(100, cur + int(delta)))}"])


def volume(**kw):
    (_vol_win if IS_WIN else _vol_mac if IS_MAC else _vol_linux)(**kw)


def media_key(which):
    if IS_WIN:
        code = {"play_pause": 179, "next": 176, "prev": 177, "stop": 178}[which]
        ps(f"(New-Object -ComObject WScript.Shell).SendKeys([char]{code})")
    elif IS_MAC:
        key = {"play_pause": 16, "next": 19, "prev": 20, "stop": 16}[which]
        sh(["osascript", "-e", f'tell application "System Events" to key code {key}'])
    elif shutil.which("playerctl"):
        sh(["playerctl", {"play_pause": "play-pause", "next": "next", "prev": "previous", "stop": "stop"}[which]])
    elif shutil.which("xdotool"):
        sh(["xdotool", "key", {"play_pause": "XF86AudioPlay", "next": "XF86AudioNext",
                               "prev": "XF86AudioPrev", "stop": "XF86AudioStop"}[which]])
    else:
        raise ValueError("install playerctl or xdotool for media keys")


def brightness(level):
    level = max(5, min(100, int(level)))
    if IS_WIN:
        ps(f"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{level})")
    elif IS_MAC:
        if shutil.which("brightness"):
            sh(["brightness", str(level / 100)])
        else:
            raise ValueError("brew install brightness")
    elif shutil.which("brightnessctl"):
        sh(["brightnessctl", "set", f"{level}%"])
    elif shutil.which("xrandr"):
        out = sh(["xrandr", "--listmonitors"])
        mon = out.split()[-1] if out else "eDP-1"
        sh(["xrandr", "--output", mon, "--brightness", str(level / 100)])
    else:
        raise ValueError("install brightnessctl")


def screenshot():
    os.makedirs(SHOTS, exist_ok=True)
    path = os.path.join(SHOTS, time.strftime("shot-%Y%m%d-%H%M%S.png"))
    if IS_WIN:
        ps("Add-Type -AssemblyName System.Windows.Forms,System.Drawing; "
           "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "
           "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; "
           "$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); "
           f"$bmp.Save('{path}')")
    elif IS_MAC:
        sh(["screencapture", "-x", path])
    else:
        for cmd in (["gnome-screenshot", "-f", path], ["spectacle", "-b", "-n", "-o", path],
                    ["scrot", path], ["import", "-window", "root", path]):
            if shutil.which(cmd[0]):
                sh(cmd, timeout=20)
                break
    if not os.path.exists(path):
        raise ValueError("no screenshot tool available")
    return path


def clipboard_get():
    if IS_WIN:
        return ps("Get-Clipboard -Raw")
    if IS_MAC:
        return sh(["pbpaste"])
    for cmd in (["wl-paste", "-n"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "-b"]):
        if shutil.which(cmd[0]):
            return sh(cmd)
    raise ValueError("install xclip or wl-clipboard")


def clipboard_set(text):
    data = text.encode("utf-8")
    if IS_WIN:
        subprocess.run(["clip"], input=data, creationflags=NOWIN, timeout=5)
    elif IS_MAC:
        subprocess.run(["pbcopy"], input=data, timeout=5)
    else:
        for cmd in (["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "-b", "-i"]):
            if shutil.which(cmd[0]):
                subprocess.run(cmd, input=data, timeout=5)
                return
        raise ValueError("install xclip or wl-clipboard")


def type_text(text):
    text = text[:2000]
    if IS_WIN:
        safe = re.sub(r"([+^%~(){}\[\]])", r"{\1}", text)
        ps(f"(New-Object -ComObject WScript.Shell).SendKeys('{safe.replace(chr(39), chr(39)*2)}')")
    elif IS_MAC:
        sh(["osascript", "-e", f'tell application "System Events" to keystroke "{text.replace(chr(34), chr(92)+chr(34))}"'])
    elif shutil.which("xdotool"):
        sh(["xdotool", "type", "--delay", "12", text])
    elif shutil.which("wtype"):
        sh(["wtype", text])
    else:
        raise ValueError("install xdotool or wtype")


HOTKEYS = {"copy": "ctrl+c", "paste": "ctrl+v", "undo": "ctrl+z", "save": "ctrl+s", "select all": "ctrl+a",
           "new tab": "ctrl+t", "close tab": "ctrl+w", "switch window": "alt+Tab", "show desktop": "super+d",
           "task view": "super+Tab", "screenshot": "super+shift+s", "find": "ctrl+f", "refresh": "F5", "escape": "Escape"}


def hotkey(name):
    combo = HOTKEYS.get(name.lower().strip(), name.strip())
    if not re.fullmatch(r"[A-Za-z0-9_+ ]{1,40}", combo):
        raise ValueError("bad hotkey")
    keys = [k.strip() for k in combo.split("+")]
    if IS_WIN:
        mods = {"ctrl": "^", "alt": "%", "shift": "+", "super": ""}
        s = "".join(mods.get(k.lower(), "") for k in keys[:-1]) + ("{" + keys[-1] + "}" if len(keys[-1]) > 1 else keys[-1])
        ps(f"(New-Object -ComObject WScript.Shell).SendKeys('{s}')")
    elif IS_MAC:
        mods = {"ctrl": "command down", "alt": "option down", "shift": "shift down", "super": "command down"}
        using = ", ".join(mods.get(k.lower(), "command down") for k in keys[:-1])
        sh(["osascript", "-e", f'tell application "System Events" to keystroke "{keys[-1].lower()}"' + (f" using {{{using}}}" if using else "")])
    elif shutil.which("xdotool"):
        sh(["xdotool", "key", "+".join(keys)])
    else:
        raise ValueError("install xdotool")


def lock_screen():
    if IS_WIN:
        sh(["rundll32.exe", "user32.dll,LockWorkStation"])
    elif IS_MAC:
        sh(["osascript", "-e", 'tell application "System Events" to keystroke "q" using {command down, control down}'])
    else:
        for cmd in (["loginctl", "lock-session"], ["xdg-screensaver", "lock"], ["gnome-screensaver-command", "-l"]):
            if shutil.which(cmd[0]):
                sh(cmd)
                return
        raise ValueError("no screen locker found")


def power(kind):
    if IS_WIN:
        cmd = {"sleep": ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"],
               "shutdown": ["shutdown", "/s", "/t", "15"], "restart": ["shutdown", "/r", "/t", "15"]}[kind]
    elif IS_MAC:
        cmd = {"sleep": ["pmset", "sleepnow"], "shutdown": ["osascript", "-e", 'tell app "System Events" to shut down'],
               "restart": ["osascript", "-e", 'tell app "System Events" to restart']}[kind]
    else:
        cmd = {"sleep": ["systemctl", "suspend"], "shutdown": ["systemctl", "poweroff"],
               "restart": ["systemctl", "reboot"]}[kind]
    sh(cmd, check=True)


def kill_process(name):
    import psutil
    name = name.lower().replace(".exe", "").strip()
    if not re.fullmatch(r"[a-z0-9_. -]{1,60}", name):
        raise ValueError("bad process name")
    n = 0
    for p in psutil.process_iter(["name"]):
        if (p.info["name"] or "").lower().replace(".exe", "") == name:
            try:
                p.terminate()
                n += 1
            except Exception:
                pass
    if not n:
        raise ValueError(f"no process named {name}")
    return n


def run_named_command(name):
    cmds = load_config().get("actions", {}).get("commands", {})
    cmd = cmds.get(name)
    if not cmd:
        raise ValueError(f"'{name}' is not in config.json actions.commands")
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60, creationflags=NOWIN)
    return (r.stdout or r.stderr or "").strip()[-400:]


def mouse(cmd, x=None, y=None, button="left", amount=0):
    if IS_WIN:
        import ctypes
        u = ctypes.windll.user32
        if cmd in ("move", "click", "double") and x is not None:
            u.SetCursorPos(int(x), int(y))
        if cmd in ("click", "double"):
            down, up = (0x0002, 0x0004) if button == "left" else (0x0008, 0x0010)
            for _ in range(2 if cmd == "double" else 1):
                u.mouse_event(down, 0, 0, 0, 0); u.mouse_event(up, 0, 0, 0, 0)
        if cmd == "scroll":
            u.mouse_event(0x0800, 0, 0, int(amount) * 120, 0)
    elif IS_MAC:
        if not shutil.which("cliclick"):
            raise ValueError("brew install cliclick for mouse control")
        if cmd == "move":
            sh(["cliclick", f"m:{int(x)},{int(y)}"])
        elif cmd == "click":
            sh(["cliclick", f"{'rc' if button == 'right' else 'c'}:{int(x)},{int(y)}"])
        elif cmd == "double":
            sh(["cliclick", f"dc:{int(x)},{int(y)}"])
        elif cmd == "scroll":
            sh(["osascript", "-e", f'tell application "System Events" to scroll {"up" if amount > 0 else "down"} {abs(int(amount))}'])
    else:
        if not shutil.which("xdotool"):
            raise ValueError("install xdotool for mouse control")
        if cmd in ("move", "click", "double") and x is not None:
            sh(["xdotool", "mousemove", str(int(x)), str(int(y))])
        if cmd == "click":
            sh(["xdotool", "click", "3" if button == "right" else "1"])
        if cmd == "double":
            sh(["xdotool", "click", "--repeat", "2", "1"])
        if cmd == "scroll":
            sh(["xdotool", "click", "--repeat", str(abs(int(amount))), "4" if amount > 0 else "5"])


# ----------------------------------------------------------------------------- dispatcher
def do_action(atype, arg, confirm=False):
    arg = (arg or "").strip()
    cfg = load_config()
    acfg = cfg.get("actions", {})
    if atype in acfg.get("deny", []):
        raise ValueError(f"'{atype}' is blocked by actions.deny in config.json")
    if atype in POWER_ACTIONS and atype not in acfg.get("no_confirm", []) and not confirm:
        return {"ok": False, "needs_confirm": True,
                "error": f"'{atype}' needs confirmation — say it again with 'confirm' or press CONFIRM"}
    if atype in PLUGINS:
        return {"ok": True, "did": str(PLUGINS[atype]["run"](arg))[:1000], "plugin": PLUGINS[atype]["plugin"]}
    if atype in CONNECT_ACTIONS:
        return do_connect_action(atype, arg)
    if atype == "open_url":
        if not arg.startswith(("http://", "https://")):
            arg = "https://" + arg
        webbrowser.open(arg)
        return f"Opening {arg}"
    if atype in ("web_search", "search"):
        webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote(arg))
        return f"Searching the web for {arg}"
    if atype == "play_music":
        vid = yt_first_video(arg)
        webbrowser.open(f"https://www.youtube.com/watch?v={vid}" if vid
                        else "https://www.youtube.com/results?search_query=" + urllib.parse.quote(arg))
        return f"Playing {arg}" if vid else f"Pulling up {arg} on YouTube"
    if atype == "open_app":
        key = arg.lower().replace(".exe", "").strip()
        target = APPS.get(key) or cfg.get("actions", {}).get("apps", {}).get(key)
        if not target:
            raise ValueError(f"app '{arg}' is not in the allowed list (add it under actions.apps in config.json)")
        launch(target)
        return f"Launching {arg}"
    if atype == "open_path":
        path = os.path.expanduser(arg)
        if not os.path.exists(path):
            raise ValueError("path not found")
        (os.startfile(path) if IS_WIN else subprocess.Popen(["open" if IS_MAC else "xdg-open", path]))
        return f"Opening {path}"
    if atype == "volume_up":
        volume(delta=int(arg or 10)); return "Volume up"
    if atype == "volume_down":
        volume(delta=-int(arg or 10)); return "Volume down"
    if atype == "volume_set":
        volume(level=max(0, min(100, int(arg or 50)))); return f"Volume set to {arg}%"
    if atype == "mic_mute":
        return {"ok": True, "did": mic_mute(arg)}
    if atype == "mute":
        volume(mute="toggle"); return "Mute toggled"
    if atype in ("media_play_pause", "media_next", "media_prev", "media_stop"):
        media_key(atype[6:]); return f"Media {atype[6:].replace('_', '/')}"
    if atype == "brightness":
        brightness(arg or 70); return f"Brightness {arg}%"
    if atype == "screenshot":
        return {"ok": True, "did": "Screenshot taken", "path": screenshot()}
    if atype == "camera_frame":
        return {"ok": True, "did": "Camera frame captured", "path": camera_frame()}
    if atype == "clipboard_get":
        return {"ok": True, "did": "Clipboard read", "text": clipboard_get()[:4000]}
    if atype == "clipboard_set":
        clipboard_set(arg); return "Copied to clipboard"
    if atype == "type_text":
        type_text(arg); return "Typed the text"
    if atype == "hotkey":
        hotkey(arg); return f"Pressed {arg}"
    if atype == "lock":
        lock_screen(); return "Locking the screen"
    if atype in ("sleep", "shutdown", "restart"):
        power(atype); return f"{atype.capitalize()} in progress"
    if atype == "kill_process":
        return f"Terminated {kill_process(arg)} process(es) named {arg}"
    if atype == "run_command":
        return f"Ran {arg}: {run_named_command(arg)}"
    if atype in ("mouse_click", "mouse_move", "mouse_double", "mouse_right"):
        m = re.match(r"\s*(\d+)\s*[, ]\s*(\d+)", arg)
        if not m:
            raise ValueError("arg must be 'x,y'")
        mouse({"mouse_click": "click", "mouse_move": "move", "mouse_double": "double", "mouse_right": "click"}[atype], int(m.group(1)), int(m.group(2)),
              "right" if atype == "mouse_right" else "left")
        return f"{atype.replace('_', ' ')} at {m.group(1)},{m.group(2)}"
    if atype == "scroll":
        mouse("scroll", amount=int(arg or -3)); return f"Scrolled {arg or -3}"
    if atype == "desktop_step":
        # one step of the desktop agent: arg is JSON {"action": "click|double|right|type|key|scroll|move", "x", "y", "text", "key", "amount"}
        st = json.loads(arg or "{}"); a = st.get("action")
        if a in ("click", "double", "right", "move"):
            mouse("click" if a == "right" else a, st.get("x"), st.get("y"), "right" if a == "right" else "left")
        elif a == "type":
            type_text(str(st.get("text", "")))
        elif a == "key":
            hotkey(str(st.get("key", "")))
        elif a == "scroll":
            mouse("scroll", amount=int(st.get("amount", -3)))
        else:
            raise ValueError("unknown desktop step")
        return f"desktop {a} done"
    raise ValueError(f"unknown action '{atype}'")


def post_action(h, q, body):
    atype, arg = body.get("type", ""), body.get("arg", "")
    try:
        res = do_action(atype, arg, bool(body.get("confirm")))
    except Exception as e:
        audit(atype, arg, False, str(e)); raise
    if isinstance(res, dict):
        if not res.get("needs_confirm"):
            audit(atype, arg, res.get("ok", True), res.get("did") or res.get("error"))
        return res
    audit(atype, arg, True, res)
    print(f"[SAMURAI-ACT] {res}")
    return {"ok": True, "did": res}


def get_audit(h, q, body):
    return {"ok": True, "entries": read_audit(int(q.get("n", 50)), float(q.get("since", 0) or 0))}


def get_file(h, q, body):
    """Serve a screenshot or camera frame back to the HUD (only from data/screenshots and data/camera)."""
    p = os.path.abspath(q.get("path", ""))
    allowed = [os.path.join(DATA, "screenshots"), os.path.join(DATA, "camera")]
    if not any(p.startswith(a + os.sep) for a in allowed) or not os.path.exists(p):
        raise ValueError("not allowed")
    with open(p, "rb") as f:
        h.send_bytes(f.read(), "image/png" if p.lower().endswith(".png") else "image/jpeg", extra={"Cache-Control": "no-store"})
    return None


def camera_frame():
    """Grab one webcam frame with OpenCV (optional dependency)."""
    try:
        import cv2
    except ImportError:
        raise ValueError("pip install opencv-python for the camera")
    d = os.path.join(DATA, "camera"); os.makedirs(d, exist_ok=True)
    cam = cv2.VideoCapture(0)
    ok, frame = cam.read(); cam.release()
    if not ok:
        raise ValueError("no camera frame")
    path = os.path.join(d, time.strftime("cam-%Y%m%d-%H%M%S.jpg"))
    cv2.imwrite(path, frame)
    return path


# ---------- live screen: JPEG frames for the HUD's SCREEN widget, text through OCR when tesseract is installed ----------
def grab_screen(monitor=0, width=1280):
    """Return (PIL image) of a monitor: mss when available, else the platform screenshot tool."""
    from PIL import Image
    try:
        import mss
        with mss.mss() as sct:
            mons = sct.monitors
            m = mons[monitor + 1] if 0 <= monitor < len(mons) - 1 else mons[0]
            shot = sct.grab(m)
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    except Exception:
        img = Image.open(screenshot()).convert("RGB")
    if width and img.width > width:
        img = img.resize((width, int(img.height * width / img.width)))
    return img


def get_screen_view(h, q, body):
    import io
    try:
        img = grab_screen(int(q.get("monitor", 0) or 0), int(q.get("w", 1280) or 1280))
    except Exception as e:
        h.send_bytes(json.dumps({"ok": False, "error": f"no screen capture available: {str(e)[:80]}"}).encode(), "application/json", code=503)
        return None
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=int(q.get("q", 60) or 60))
    h.send_bytes(buf.getvalue(), "image/jpeg", extra={"Cache-Control": "no-store", "X-Size": f"{img.width}x{img.height}"})
    return None


def get_screen_monitors(h, q, body):
    try:
        import mss
        with mss.mss() as sct:
            return {"ok": True, "monitors": [{"i": i, "w": m["width"], "h": m["height"], "x": m["left"], "y": m["top"]} for i, m in enumerate(sct.monitors[1:])]}
    except Exception as e:
        return {"ok": True, "monitors": [{"i": 0, "w": 0, "h": 0, "x": 0, "y": 0}], "note": str(e)[:80]}


def get_screen_text(h, q, body):
    """OCR of the screen (or a monitor) with tesseract; the HUD falls back to the vision brain when it is missing."""
    try:
        import pytesseract
        if not shutil.which("tesseract"):
            return {"ok": False, "error": "tesseract is not installed: Windows → https://github.com/UB-Mannheim/tesseract/wiki · Linux → apt install tesseract-ocr · macOS → brew install tesseract", "installed": False}
        img = grab_screen(int(q.get("monitor", 0) or 0), 1920)
        text = pytesseract.image_to_string(img)
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        return {"ok": True, "text": "\n".join(lines)[:20000], "lines": len(lines), "installed": True}
    except ImportError:
        return {"ok": False, "error": "pytesseract is not installed in the venv (pip install pytesseract pillow)", "installed": False}
    except Exception as e:
        return {"ok": False, "error": str(e)[:120], "installed": True}


# ---------- microphone kill switch (the HUD shows a privacy light) ----------
MIC = {"muted": None}


def mic_state():
    try:
        if IS_WIN:
            if shutil.which("nircmd"):
                return MIC["muted"]
            out = ps("if (Get-Command Get-AudioDevice -ErrorAction SilentlyContinue) { (Get-AudioDevice -RecordingMute) } else { 'unsupported' }")
            return None if "unsupported" in out else out.strip().lower() == "true"
        if IS_MAC:
            return int(sh(["osascript", "-e", "input volume of (get volume settings)"]).strip() or 0) == 0
        if shutil.which("pactl"):
            return "yes" in sh(["pactl", "get-source-mute", "@DEFAULT_SOURCE@"]).lower()
        if shutil.which("amixer"):
            return "[off]" in sh(["amixer", "get", "Capture"])
    except Exception:
        pass
    return MIC["muted"]


def mic_mute(arg):
    arg = str(arg or "toggle").lower()
    if arg == "toggle":
        cur = mic_state(); want = (not cur) if cur is not None else True
    else:
        want = arg in ("on", "mute", "true", "1")
    if IS_WIN:
        if shutil.which("nircmd"):
            sh(["nircmd", "mutesysvolume", "1" if want else "0", "default_record"])
        else:
            out = ps("if (Get-Command Set-AudioDevice -ErrorAction SilentlyContinue) { Set-AudioDevice -RecordingMute $%s | Out-Null; 'ok' } else { 'unsupported' }" % ("true" if want else "false"))
            if "unsupported" in out:
                raise ValueError("microphone mute needs nircmd (nirsoft.net) or the AudioDeviceCmdlets PowerShell module on Windows")
    elif IS_MAC:
        sh(["osascript", "-e", f"set volume input volume {0 if want else 80}"])
    elif shutil.which("pactl"):
        sh(["pactl", "set-source-mute", "@DEFAULT_SOURCE@", "1" if want else "0"])
    elif shutil.which("amixer"):
        sh(["amixer", "set", "Capture", "nocap" if want else "cap"])
    else:
        raise ValueError("no mixer tool found (pactl or amixer) to mute the microphone")
    MIC["muted"] = want
    return f"microphone {'muted' if want else 'live'}"


def get_mic(h, q, body):
    m = mic_state()
    return {"ok": True, "muted": m, "known": m is not None}


def post_plugins_reload(h, q, body):
    load_plugins()
    return {"ok": True, "tools": sorted(PLUGINS.keys()), "did": f"{len(PLUGINS)} plugin tool(s) loaded"}


def get_actions(h, q, body):
    return {"ok": True, "os": sys.platform, "apps": sorted(APPS), "hotkeys": sorted(HOTKEYS),
            "actions": ["open_url", "web_search", "play_music", "open_app", "open_path", "volume_up", "volume_down",
                        "volume_set", "mute", "mic_mute", "media_play_pause", "media_next", "media_prev", "media_stop",
                        "brightness", "screenshot", "camera_frame", "clipboard_get", "clipboard_set", "type_text", "hotkey", "lock",
                        "mouse_click", "mouse_move", "mouse_double", "mouse_right", "scroll", *sorted(CONNECT_ACTIONS)],
            "needs_confirm": sorted(POWER_ACTIONS), "deny": load_config().get("actions", {}).get("deny", []),
            "plugins": [{"type": t, "description": v["description"], "plugin": v["plugin"]} for t, v in PLUGINS.items()]}


class Handler(JSONHandler):
    TAG = "SAMURAI-ACT"
    ROUTES = {("POST", "/action"): post_action, ("GET", "/actions"): get_actions, ("GET", "/mic"): get_mic, ("POST", "/plugins/reload"): post_plugins_reload, ("GET", "/audit"): get_audit, ("GET", "/file"): get_file,
              ("GET", "/screen/view"): get_screen_view, ("GET", "/screen/monitors"): get_screen_monitors, ("GET", "/screen/text"): get_screen_text}


if __name__ == "__main__":
    load_plugins()
    print(f"[SAMURAI] Action sidecar on http://localhost:{PORT}/action  ({sys.platform}) · {len(PLUGINS)} plugin tool(s)")
    maybe_wrap_tls(ThreadingHTTPServer((bind_host(), PORT), Handler)).serve_forever()
