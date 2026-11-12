"""SAMURAI self-update. Mounted into the control panel (:9000).

GET  /update/status     -> {ok, current, latest, newer, downloading, progress, staged, error, asset, mode}
POST /update/install    -> packaged build: downloads the release asset for this OS to data/update/, extracts it to data/update/new/,
                           writes apply.bat (Windows) or apply.sh, stops the services and exits so the script swaps the files
                           (data/, logs/, models/ and config.json are kept) and relaunches SAMURAI.
                           source install: `git pull --ff-only` on the current branch, then the services restart.

SAMURAI_UPDATE_URL overrides the releases API (tests point it at a local server)."""
import json, os, shutil, subprocess, sys, tarfile, threading, time, urllib.request, zipfile

from samurai_common import ROOT, DATA, LOGS, FROZEN, VERSION, http_json

RELEASES_API = os.environ.get("SAMURAI_UPDATE_URL") or "https://api.github.com/repos/sxi9/SAMURAI-AI/releases/latest"
ASSET = {"win32": "SAMURAI-windows-x64.zip", "linux": "SAMURAI-linux-x64.tar.gz"}
STATE = {"downloading": False, "progress": 0.0, "staged": "", "error": "", "latest": "", "asset": "", "started": 0, "log": []}
LOCK = threading.Lock()


def log(msg):
    STATE["log"] = (STATE["log"] + [msg])[-40:]
    print(f"[SAMURAI-UPDATE] {msg}")


def vtuple(v):
    return tuple(int(x) for x in str(v).lstrip("v").split(".") if x.isdigit())


def latest():
    d = http_json(RELEASES_API, timeout=10)
    tag = str(d.get("tag_name", "")).lstrip("v")
    assets = {a.get("name"): a for a in d.get("assets", [])}
    return {"latest": tag, "newer": vtuple(tag) > vtuple(VERSION), "assets": assets, "url": d.get("html_url", "")}


def get_status(h, q, b):
    out = {"ok": True, "current": VERSION, "mode": "packaged" if FROZEN else "source", "platform": sys.platform, **{k: STATE[k] for k in ("downloading", "progress", "staged", "error", "latest", "asset")}, "log": STATE["log"][-8:]}
    if not STATE["latest"]:
        try:
            l = latest(); STATE["latest"] = l["latest"]; out["latest"] = l["latest"]; out["newer"] = l["newer"]
        except Exception as e:
            out["newer"] = False; out["check_error"] = str(e)[:100]
    else:
        out["newer"] = vtuple(STATE["latest"]) > vtuple(VERSION)
    return out


def download(url, dest, size=0):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "SAMURAI-update"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or size or 0); done = 0
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            f.write(chunk); done += len(chunk)
            STATE["progress"] = round(done / total, 3) if total else 0.0
    if size and os.path.getsize(dest) != size:
        raise ValueError(f"download size mismatch: {os.path.getsize(dest)} != {size}")
    return dest


def extract(archive, new_dir):
    """Unpack the release asset into new_dir so that SAMURAI's files sit directly inside it (zip-slip guarded)."""
    if os.path.isdir(new_dir):
        shutil.rmtree(new_dir)
    os.makedirs(new_dir)
    base = os.path.realpath(new_dir)

    def safe(p):
        full = os.path.realpath(os.path.join(new_dir, p))
        if not full.startswith(base + os.sep) and full != base:
            raise ValueError("unsafe path in archive: " + p)
        return full
    if archive.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                full = safe(info.filename)
                if info.is_dir():
                    os.makedirs(full, exist_ok=True); continue
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with z.open(info) as src, open(full, "wb") as dst:
                    shutil.copyfileobj(src, dst)
    else:
        with tarfile.open(archive, "r:gz") as t:
            for m in t.getmembers():
                safe(m.name)
            t.extractall(new_dir)
    # a tarball carries a SAMURAI/ folder; a zip has the files at its root — normalise to files at the root of new_dir
    entries = os.listdir(new_dir)
    if len(entries) == 1 and os.path.isdir(os.path.join(new_dir, entries[0])) and not any(os.path.isfile(os.path.join(new_dir, e)) for e in ("SAMURAI.exe", "SAMURAI")):
        inner = os.path.join(new_dir, "__inner__"); os.rename(os.path.join(new_dir, entries[0]), inner)
        for n in os.listdir(inner):
            shutil.move(os.path.join(inner, n), os.path.join(new_dir, n))
        os.rmdir(inner)
    exe = "SAMURAI.exe" if sys.platform == "win32" else "SAMURAI"
    if not os.path.isfile(os.path.join(new_dir, exe)):
        raise ValueError(f"{exe} not found in the downloaded build")
    return new_dir


KEEP_DIRS = ("data", "logs", "models")
KEEP_FILES = ("config.json",)


def write_apply(new_dir, root, platform=None, exe_path=None):
    """The swap script: waits for SAMURAI to exit, copies the new files over the install folder (keeping data, logs, models,
    config.json), relaunches. Returns the script path."""
    platform = platform or sys.platform
    if platform == "win32":
        path = os.path.join(os.path.dirname(new_dir), "apply.bat")
        exe = exe_path or os.path.join(root, "SAMURAI.exe")
        xd = " ".join(f'"{os.path.join(root, d)}"' for d in KEEP_DIRS)
        xf = " ".join(f'"{f}"' for f in KEEP_FILES)
        script = f"""@echo off
title SAMURAI update
echo Waiting for SAMURAI to close...
:wait
tasklist /FI "IMAGENAME eq SAMURAI.exe" 2>NUL | find /I "SAMURAI.exe" >NUL
if not errorlevel 1 (timeout /t 2 /nobreak >NUL & goto wait)
echo Installing the update...
robocopy "{new_dir}" "{root}" /E /R:3 /W:2 /XD {xd} /XF {xf} >NUL
if errorlevel 8 (echo Copy failed. Your old files are untouched where the copy did not reach. & pause & exit /b 1)
echo Starting SAMURAI...
start "" "{exe}"
exit /b 0
"""
    else:
        path = os.path.join(os.path.dirname(new_dir), "apply.sh")
        exe = exe_path or os.path.join(root, "SAMURAI")
        excl = " ".join(f"--exclude='{d}'" for d in KEEP_DIRS + KEEP_FILES)
        script = f"""#!/bin/sh
# SAMURAI update: waits for the old process, copies the new build over the install folder, relaunches.
echo "Waiting for SAMURAI to close..."
while pgrep -f "{exe}" >/dev/null 2>&1; do sleep 2; done
echo "Installing the update..."
if command -v rsync >/dev/null 2>&1; then rsync -a {excl} "{new_dir}/" "{root}/"; else cp -R "{new_dir}/." "{root}/"; fi
chmod +x "{exe}" 2>/dev/null
echo "Starting SAMURAI..."
nohup "{exe}" --no-browser >/dev/null 2>&1 &
exit 0
"""
    with open(path, "w", encoding="utf-8", newline="\r\n" if platform == "win32" else "\n") as f:
        f.write(script)
    if platform != "win32":
        os.chmod(path, 0o755)
    return path


def stage(asset_name=None, asset_url=None, size=0):
    """Download + extract + write the swap script. Returns the script path."""
    upd = os.path.join(DATA, "update")
    name = asset_name or ASSET.get(sys.platform)
    if not name:
        raise ValueError("no packaged build for this platform (macOS: install from source, see docs/INSTALL.md)")
    if not asset_url:
        l = latest(); a = l["assets"].get(name)
        if not a:
            raise ValueError(f"the latest release has no {name}")
        asset_url, size = a.get("browser_download_url"), a.get("size") or 0
        STATE["latest"] = l["latest"]
    STATE.update(downloading=True, progress=0.0, staged="", error="", asset=name, started=time.time())
    log(f"downloading {name}")
    archive = download(asset_url, os.path.join(upd, name), size)
    log("extracting")
    new_dir = extract(archive, os.path.join(upd, "new"))
    script = write_apply(new_dir, ROOT)
    STATE.update(downloading=False, staged=script, progress=1.0)
    log(f"staged: {script}")
    return script


def run_swap(script):
    """Detach the swap script, stop every service, leave. The script waits for this process to be gone."""
    import samurai_panel as panel
    log("stopping services, handing over to the updater")
    if sys.platform == "win32":
        subprocess.Popen(["cmd", "/c", "start", "", "/min", script], creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0) | getattr(subprocess, "DETACHED_PROCESS", 0), close_fds=True)
    else:
        subprocess.Popen(["sh", script], start_new_session=True, stdout=open(os.path.join(LOGS, "update.log"), "ab"), stderr=subprocess.STDOUT)
    try:
        for svc in reversed(panel.SERVICES):
            panel.stop(svc)
    except Exception as e:
        log(f"stop failed: {e}")
    time.sleep(1.5)
    os._exit(0)


def source_update():
    import samurai_panel as panel
    out = subprocess.run(["git", "pull", "--ff-only"], cwd=ROOT, capture_output=True, text=True, timeout=120)
    log(("git: " + (out.stdout or out.stderr).strip())[:300])
    if out.returncode != 0:
        STATE["error"] = (out.stderr or out.stdout).strip()[:200]; return
    panel.STATE["status"] = "restarting"
    for svc in reversed(panel.SERVICES):
        panel.stop(svc)
    time.sleep(1.5)
    panel.bring_up_all(open_ui=False)
    STATE["staged"] = "pulled"


def post_install(h, q, b):
    with LOCK:
        if STATE["downloading"]:
            raise ValueError("an update is already downloading")
        STATE.update(error="", staged="")
    if not FROZEN:
        threading.Thread(target=source_update, daemon=True).start()
        return {"ok": True, "did": "source install: pulling the latest code, services restart when done", "mode": "source"}
    if sys.platform not in ASSET:
        raise ValueError("no packaged build for this platform (macOS: install from source)")

    def run():
        try:
            script = stage()
            if b.get("stage_only"):
                return
            run_swap(script)
        except Exception as e:
            STATE.update(downloading=False, error=str(e)[:200]); log(f"failed: {e}")
    threading.Thread(target=run, daemon=True).start()
    return {"ok": True, "did": "downloading the latest build; SAMURAI closes and relaunches itself when it is ready", "mode": "packaged"}


ROUTES = {("GET", "/update/status"): get_status, ("POST", "/update/install"): post_install}
