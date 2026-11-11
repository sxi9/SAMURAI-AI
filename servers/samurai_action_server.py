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
import json, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request, webbrowser
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import JSONHandler, NOWIN, IS_WIN, IS_MAC, PORTS, ROOT, load_config

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
POWER_ACTIONS = {"sleep", "shutdown", "restart", "kill_process", "run_command"}


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


# ----------------------------------------------------------------------------- dispatcher
def do_action(atype, arg, confirm=False):
    arg = (arg or "").strip()
    cfg = load_config()
    if atype in POWER_ACTIONS and not confirm:
        return {"ok": False, "needs_confirm": True,
                "error": f"'{atype}' needs confirmation — say it again with 'confirm' or press CONFIRM"}
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
    if atype == "mute":
        volume(mute="toggle"); return "Mute toggled"
    if atype in ("media_play_pause", "media_next", "media_prev", "media_stop"):
        media_key(atype[6:]); return f"Media {atype[6:].replace('_', '/')}"
    if atype == "brightness":
        brightness(arg or 70); return f"Brightness {arg}%"
    if atype == "screenshot":
        return f"Screenshot saved to {screenshot()}"
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
    raise ValueError(f"unknown action '{atype}'")


def post_action(h, q, body):
    res = do_action(body.get("type", ""), body.get("arg", ""), bool(body.get("confirm")))
    if isinstance(res, dict):
        return res
    print(f"[SAMURAI-ACT] {res}")
    return {"ok": True, "did": res}


def get_actions(h, q, body):
    return {"ok": True, "os": sys.platform, "apps": sorted(APPS), "hotkeys": sorted(HOTKEYS),
            "actions": ["open_url", "web_search", "play_music", "open_app", "open_path", "volume_up", "volume_down",
                        "volume_set", "mute", "media_play_pause", "media_next", "media_prev", "media_stop",
                        "brightness", "screenshot", "clipboard_get", "clipboard_set", "type_text", "hotkey", "lock"],
            "needs_confirm": sorted(POWER_ACTIONS)}


class Handler(JSONHandler):
    TAG = "SAMURAI-ACT"
    ROUTES = {("POST", "/action"): post_action, ("GET", "/actions"): get_actions}


if __name__ == "__main__":
    print(f"[SAMURAI] Action sidecar on http://localhost:{PORT}/action  ({sys.platform})")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
