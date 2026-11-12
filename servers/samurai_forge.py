"""SAMURAI forge: the assistant rebuilds itself. Mounted into the control panel (:9000).

GET  /forge/status            -> {available, why, running, task, changed:[files], branch, last}
POST /forge {task}            -> runs Claude Code headless on the SAMURAI source with the task (edits allowed, nothing applied yet)
GET  /forge/log               -> {log} the live output
POST /forge/apply             -> syntax-checks every changed file, commits on branch forge/<date>, restarts the services
POST /forge/discard           -> drops every uncommitted change the forge made

Needs the source install (a git checkout, not the packaged exe) and the Claude Code CLI signed in. The forge never pushes and
never touches config.json, data/ or secrets; the user says "apply" before anything goes live."""
import glob, json, os, shutil, subprocess, sys, threading, time

from samurai_common import ROOT, LOGS, FROZEN, venv_python

SRC = os.path.join(ROOT, "data", "src")                    # packaged build: the sources the forge works on (prepared from the panel)
WORK = SRC if FROZEN else ROOT                             # where git and Claude Code run

STATE = {"running": False, "task": "", "started": 0, "finished": 0, "log": "", "before": None, "last": None, "proc": None}
LOCK = threading.Lock()
RULES = ("You are editing SAMURAI, a Jarvis-style assistant: Python sidecars in servers/ (stdlib http.server, see servers/samurai_common.py "
         "for the JSONHandler and config), a vanilla JS HUD in app/js (hud.js routes + runAction, hud-widgets.js widgets, hud-core.js / hud-3d.js "
         "rendering, hud.css), the control panel in app/panel.html + servers/samurai_panel.py. Keep the existing style: small functions, no new "
         "frameworks, no new runtime dependencies unless asked, every new sidecar route in the module docstring, voice phrases added to quickRoute "
         "in hud.js, new widgets registered in W in hud-widgets.js with a ring node. Never edit config.json, data/, models/, .venv/, docs/*.mp4. "
         "After editing run `node --check` on changed JS and `python3 -m py_compile` on changed Python. Finish with a short summary of what changed "
         "and how to use it by voice.")


def git(*args, timeout=30):
    try:
        return subprocess.run(["git", *args], cwd=WORK, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except Exception as e:
        return f"git error: {e}"


def available():
    if FROZEN and not os.path.isdir(os.path.join(SRC, ".git")):
        return False, "sources not prepared: control panel -> FORGE -> PREPARE SOURCES (needs git installed); the rebuilt code runs from data/src on the next restart"
    if not FROZEN and not os.path.isdir(os.path.join(ROOT, ".git")):
        return False, "not a git checkout: clone the repository to use the forge"
    if not shutil.which("claude"):
        return False, "Claude Code CLI not installed (npm i -g @anthropic-ai/claude-code) or not signed in"
    return True, "ready"


def changed_files():
    out = git("status", "--porcelain", "--", "app", "servers", "plugins", "tests", "docs", "samurai_launcher.py", "install.py", "requirements.txt")
    files = [line[2:].strip() for line in out.splitlines() if line.strip()]
    # plugins installed from the store live next to the built-in ones (plugins/<name>.py + plugins/<name>_pkg/); they are not forge work
    store = {os.path.basename(d)[:-4] for d in glob.glob(os.path.join(WORK, "plugins", "*_pkg")) if os.path.exists(os.path.join(d, "plugin.json"))}
    return [f for f in files if not any(f.startswith(f"plugins/{n}_pkg") or f == f"plugins/{n}.py" for n in store)]


def get_status(h, q, b):
    ok, why = available()
    return {"ok": True, "available": ok, "why": why, "running": STATE["running"], "task": STATE["task"], "started": STATE["started"], "finished": STATE["finished"],
            "changed": changed_files() if ok else [], "branch": git("rev-parse", "--abbrev-ref", "HEAD") if ok else "", "last": STATE["last"], "log_tail": STATE["log"][-1500:]}


def run_forge(task):
    log_path = os.path.join(LOGS, "forge.log"); os.makedirs(LOGS, exist_ok=True)
    cmd = ["claude", "-p", task, "--permission-mode", "acceptEdits", "--output-format", "text",
           "--allowedTools", "Read,Edit,Write,MultiEdit,Glob,Grep,Bash(node --check:*),Bash(python3 -m py_compile:*),Bash(python -m py_compile:*),Bash(git diff:*),Bash(git status:*)",
           "--append-system-prompt", RULES]
    env = dict(os.environ); env.pop("CLAUDECODE", None)
    try:
        with open(log_path, "w", encoding="utf-8") as lf:
            p = subprocess.Popen(cmd, cwd=WORK, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, shell=os.name == "nt")
            STATE["proc"] = p
            for line in p.stdout:
                lf.write(line); lf.flush(); STATE["log"] += line
                if len(STATE["log"]) > 200000:
                    STATE["log"] = STATE["log"][-150000:]
            p.wait()
            code = p.returncode
    except Exception as e:
        STATE["log"] += f"\nforge failed to start: {e}\n"; code = -1
    STATE.update(running=False, finished=time.time(), proc=None)
    STATE["last"] = {"task": task, "code": code, "changed": changed_files(), "finished": STATE["finished"], "summary": STATE["log"].strip()[-800:]}


def post_forge(h, q, b):
    ok, why = available()
    if not ok:
        raise ValueError(why)
    task = (b.get("task") or "").strip()
    if len(task) < 8:
        raise ValueError("describe the change in a sentence")
    with LOCK:
        if STATE["running"]:
            raise ValueError("the forge is already working on: " + STATE["task"])
        STATE.update(running=True, task=task, started=time.time(), finished=0, log="", before=changed_files())
        threading.Thread(target=run_forge, args=(task,), daemon=True).start()
    return {"ok": True, "did": "forge started", "task": task}


def get_log(h, q, b):
    return {"ok": True, "running": STATE["running"], "log": STATE["log"][-20000:], "task": STATE["task"]}


def check_file(path):
    full = os.path.join(WORK, path)
    if not os.path.exists(full):
        return True, "removed"
    if path.endswith(".js"):
        r = subprocess.run(["node", "--check", full], capture_output=True, text=True); return r.returncode == 0, (r.stderr or "ok").strip()[:200]
    if path.endswith(".py"):
        r = subprocess.run([venv_python() or sys.executable, "-m", "py_compile", full], capture_output=True, text=True); return r.returncode == 0, (r.stderr or "ok").strip()[:200]
    if path.endswith(".json"):
        try:
            json.load(open(full, encoding="utf-8")); return True, "ok"
        except Exception as e:
            return False, str(e)[:200]
    return True, "ok"


def post_apply(h, q, b):
    ok, why = available()
    if not ok:
        raise ValueError(why)
    if STATE["running"]:
        raise ValueError("the forge is still working")
    files = changed_files()
    if not files:
        raise ValueError("nothing to apply")
    results = {f: check_file(f) for f in files}
    bad = {f: r[1] for f, r in results.items() if not r[0]}
    if bad:
        return {"ok": False, "error": "syntax check failed", "files": bad}
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    stamp = time.strftime("%Y%m%d-%H%M")
    if not branch.startswith("forge/"):
        git("checkout", "-b", f"forge/{stamp}")
    git("add", "--", *files)
    msg = "forge: " + (STATE["last"] or {}).get("task", "change")[:70]
    git("commit", "-q", "-m", msg + "\n\nMade by SAMURAI's forge (Claude Code headless) at the user's request.")
    head = git("rev-parse", "--short", "HEAD")
    threading.Thread(target=restart_services, daemon=True).start()
    return {"ok": True, "did": f"applied {len(files)} file(s) as {head} on {git('rev-parse', '--abbrev-ref', 'HEAD')}; restarting services", "files": files, "commit": head}


def post_discard(h, q, b):
    files = changed_files()
    git("checkout", "--", *[f for f in files if os.path.exists(os.path.join(WORK, f))]) if files else None
    git("clean", "-fdq", "--", "app", "servers", "plugins", "tests", "docs")
    STATE["last"] = None
    return {"ok": True, "did": f"discarded {len(files)} file(s)"}


def restart_services():
    """Ask the panel (same process) to restart everything so the new code runs; the HUD reloads itself."""
    try:
        import samurai_panel as panel
        panel.STATE["status"] = "restarting"
        for svc in reversed(panel.SERVICES):
            panel.stop(svc)
        time.sleep(1.5)
        panel.bring_up_all(open_ui=False)
    except Exception as e:
        STATE["log"] += f"\nrestart failed: {e}\n"


def post_sources(h, q, b):
    """Packaged build only: copy the bundled source tree to data/src and start a git history there, so the forge can work on it."""
    if not FROZEN:
        return {"ok": False, "error": "already a source install: the forge works on this checkout"}
    bundle = os.path.join(getattr(sys, "_MEIPASS", ROOT), "src")
    if not os.path.isdir(os.path.join(bundle, "servers")):
        raise ValueError("this build has no bundled sources")
    if not shutil.which("git"):
        raise ValueError("git is not installed: https://git-scm.com/download/win, then try again")
    fresh = not os.path.isdir(os.path.join(SRC, ".git"))
    os.makedirs(SRC, exist_ok=True)
    for name in os.listdir(bundle):
        src_p, dst_p = os.path.join(bundle, name), os.path.join(SRC, name)
        if os.path.isdir(src_p):
            shutil.copytree(src_p, dst_p, dirs_exist_ok=True)
        else:
            shutil.copy2(src_p, dst_p)
    if fresh:
        git("init", "-q"); git("add", "-A"); git("-c", "user.email=samurai@local", "-c", "user.name=SAMURAI", "commit", "-q", "-m", "forge baseline from the packaged build")
    return {"ok": True, "path": SRC, "git": os.path.isdir(os.path.join(SRC, ".git")), "did": ("sources prepared" if fresh else "sources refreshed") + " - the forge works on data/src; rebuilt code runs from there after a restart"}


ROUTES = {("GET", "/forge/status"): get_status, ("POST", "/forge"): post_forge, ("GET", "/forge/log"): get_log,
          ("POST", "/forge/apply"): post_apply, ("POST", "/forge/discard"): post_discard, ("POST", "/forge/sources"): post_sources}
