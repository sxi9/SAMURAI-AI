"""Shared helpers for every SAMURAI sidecar and for the dashboard / installer.

- paths, config loading (config.json with config.example.json defaults)
- JSONHandler: an HTTP handler base that only answers the SAMURAI page's origin
- voice-model download with verified TLS, checksum and safe extraction

No GUI imports here, so this module works headless.
"""
import hashlib, json, os, shutil, ssl, subprocess, sys, time, zipfile
import urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler

SERVERS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SERVERS_DIR)
APP = os.path.join(ROOT, "app")
MODELS = os.path.join(ROOT, "models")
LOGS = os.path.join(ROOT, "logs")
DATA = os.path.join(ROOT, "data")
CONFIG_PATH = os.path.join(ROOT, "config.json")
CONFIG_EXAMPLE = os.path.join(ROOT, "config.example.json")
NOWIN = 0x08000000 if os.name == "nt" else 0          # CREATE_NO_WINDOW
IS_WIN = os.name == "nt"
IS_MAC = sys.platform == "darwin"

UI_PORT = 8080
PORTS = {"ui": 8080, "telemetry": 8765, "speech": 9100, "tts": 9200,
         "actions": 9300, "agent": 9400, "addons": 9500, "panel": 9000}

# --------------------------------------------------------------------------- config
DEFAULT_CONFIG = {
    "user": {"name": "Boss", "node": "LOCAL-01"},
    "location": {"lat": 0.0, "lon": 0.0, "label": "SET ME"},
    "ui": {"origins": ["http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:9000", "http://127.0.0.1:9000"]},
    "widgets": {
        "agenda": {"ics_path": "", "sample": True},
        "inbox": {"imap_host": "", "imap_user": "", "imap_password": "", "sample": True},
        "home": {"hass_url": "", "hass_token": "", "sample": True},
        "music": {"library_dir": "", "sample": True},
        "gallery": {"dir": "gallery"},
        "camera": {"url": ""},
        "position": {"nearby": [{"name": "OFFICE", "km": 4.2, "bearing": 40},
                                {"name": "AIRPORT", "km": 31, "bearing": 225}]},
    },
    "agent": {"allow_bash": False},
    "autostart": False,
}


def _merge(base, over):
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def load_config():
    """config.json merged over the defaults. Creates config.json from the example on first run."""
    if not os.path.exists(CONFIG_PATH) and os.path.exists(CONFIG_EXAMPLE):
        try:
            shutil.copy(CONFIG_EXAMPLE, CONFIG_PATH)
        except OSError:
            pass
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return _merge(DEFAULT_CONFIG, json.load(f))
    except (OSError, ValueError):
        return dict(DEFAULT_CONFIG)


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def allowed_origins():
    return set(DEFAULT_CONFIG["ui"]["origins"]) | set(load_config().get("ui", {}).get("origins", []))


def venv_python():
    """The project's .venv interpreter when it exists, else the running one."""
    cand = os.path.join(ROOT, ".venv", "Scripts" if IS_WIN else "bin", "python.exe" if IS_WIN else "python")
    return cand if os.path.exists(cand) else sys.executable


def venv_pythonw():
    py = venv_python()
    if IS_WIN:
        w = py.replace("python.exe", "pythonw.exe")
        return w if os.path.exists(w) else py
    return py


def service_defs():
    """The managed services, in start order. 'check' is an HTTP probe (any status = alive); None = TCP only."""
    py = venv_python()
    return [
        {"key": "ui",      "name": "UI SERVER",     "port": PORTS["ui"],        "check": f"http://localhost:{PORTS['ui']}/jarvis-interface.html",
         "cmd": [py, "-m", "http.server", str(PORTS["ui"]), "--bind", "127.0.0.1", "--directory", APP]},
        {"key": "speech",  "name": "SPEECH (VOSK)", "port": PORTS["speech"],    "check": None,
         "cmd": [py, os.path.join(SERVERS_DIR, "samurai_speech_server.py")]},
        {"key": "tel",     "name": "TELEMETRY",     "port": PORTS["telemetry"], "check": f"http://localhost:{PORTS['telemetry']}/stats",
         "cmd": [py, os.path.join(SERVERS_DIR, "samurai_telemetry.py")]},
        {"key": "tts",     "name": "NEURAL TTS",    "port": PORTS["tts"],       "check": f"http://localhost:{PORTS['tts']}/engines",
         "cmd": [py, os.path.join(SERVERS_DIR, "samurai_tts_server.py")]},
        {"key": "act",     "name": "ACTIONS",       "port": PORTS["actions"],   "check": f"http://localhost:{PORTS['actions']}/actions",
         "cmd": [py, os.path.join(SERVERS_DIR, "samurai_action_server.py")]},
        {"key": "agent",   "name": "AGENT (CLI)",   "port": PORTS["agent"],     "check": f"http://localhost:{PORTS['agent']}/agent/status",
         "cmd": [py, os.path.join(SERVERS_DIR, "samurai_agent_server.py")]},
        {"key": "addons",  "name": "ADD-ONS",       "port": PORTS["addons"],    "check": f"http://localhost:{PORTS['addons']}/addons/status",
         "cmd": [py, os.path.join(SERVERS_DIR, "samurai_addons.py")]},
    ]


def run_hidden(cmd, **kw):
    """subprocess.run with no flashing console window on Windows."""
    return subprocess.run(cmd, creationflags=NOWIN, **kw)


# --------------------------------------------------------------------------- HTTP base
class JSONHandler(BaseHTTPRequestHandler):
    """Routes GET/POST by path, answers JSON, and only allows the SAMURAI page's origin.

    Subclasses set ROUTES = {("GET", "/path"): fn, ("POST", "/path"): fn}; fn(handler, query, body)
    returns (status, obj) or obj (status 200). Raise ValueError for a 400.
    """
    ROUTES = {}
    _origins = None

    @classmethod
    def origins(cls):
        if cls._origins is None:
            cls._origins = allowed_origins()
        return cls._origins

    def _origin_ok(self):
        o = self.headers.get("Origin")
        return o is None or o in self.origins()      # no Origin header = local tool, not a browser

    def _headers(self, code, ctype="application/json", length=None, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        o = self.headers.get("Origin")
        if o in self.origins():
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
        if length is not None:
            self.send_header("Content-Length", str(length))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self._headers(code, length=len(body))
        self.wfile.write(body)

    def send_bytes(self, data, ctype, code=200, extra=None):
        self._headers(code, ctype, len(data), extra)
        self.wfile.write(data)

    def read_json(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(n) if n else b""
        return json.loads(raw or b"{}")

    def _dispatch(self, method):
        if not self._origin_ok():
            self.send_json({"ok": False, "error": "origin not allowed"}, 403)
            return
        parsed = urllib.parse.urlparse(self.path)
        fn = self.ROUTES.get((method, parsed.path))
        if fn is None:
            self.send_json({"ok": False, "error": "not found"}, 404)
            return
        try:
            query = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
            body = self.read_json() if method == "POST" else None
            res = fn(self, query, body)
            if res is None:
                return                                    # handler already wrote the response
            if isinstance(res, tuple):
                self.send_json(res[1], res[0])
            else:
                self.send_json(res)
        except ValueError as e:
            self.send_json({"ok": False, "error": str(e)}, 400)
        except Exception as e:                            # keep the sidecar alive, report the error
            print(f"[{self.server_name_tag()}] error on {parsed.path}: {e}")
            self.send_json({"ok": False, "error": str(e)}, 500)

    @classmethod
    def server_name_tag(cls):
        return getattr(cls, "TAG", "SAMURAI")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_OPTIONS(self):
        if self._origin_ok():
            self._headers(204, length=0)
        else:
            self.send_json({"ok": False, "error": "origin not allowed"}, 403)

    def log_message(self, *a):
        pass


# --------------------------------------------------------------------------- voice model
SMALL_MODEL_NAME = "vosk-model-small-en-us-0.15"
MODEL_MIRRORS = [
    "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
    "https://huggingface.co/rhasspy/vosk-models/resolve/main/en/vosk-model-small-en-us-0.15.zip",
]
# sha256 of vosk-model-small-en-us-0.15.zip (41,205,931 bytes), recorded 2026-11-11
MODEL_SHA256 = {SMALL_MODEL_NAME: "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"}
LARGE_MODEL_NAME = "vosk-model-en-us-0.22"
LARGE_MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip"


def model_valid(folder=SMALL_MODEL_NAME):
    base = os.path.join(MODELS, folder)
    if not os.path.isdir(base):
        return False
    return any(os.path.exists(os.path.join(base, *m)) for m in (("conf", "model.conf"), ("am", "final.mdl")))


def any_valid_model():
    try:
        return any(model_valid(d) for d in os.listdir(MODELS) if d.startswith("vosk-model"))
    except OSError:
        return False


def _opener():
    """urllib opener with verified TLS. SAMURAI_INSECURE_TLS=1 opts out behind a corporate MITM proxy."""
    ctx = ssl.create_default_context()
    if os.environ.get("SAMURAI_INSECURE_TLS") == "1":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
    op.addheaders = [("User-Agent", "SAMURAI-setup/1.0")]
    return op


def download_with_resume(url, dest, status_cb=lambda s: None, attempts=6):
    """Download url -> dest with byte-range resume and retries. True on success."""
    op = _opener()
    for attempt in range(1, attempts + 1):
        have = os.path.getsize(dest) if os.path.exists(dest) else 0
        try:
            req = urllib.request.Request(url)
            if have:
                req.add_header("Range", f"bytes={have}-")
            with op.open(req, timeout=30) as r:
                total = have + int(r.headers.get("Content-Length", 0) or 0)
                mode = "ab" if (have and r.status == 206) else "wb"
                if mode == "wb":
                    have = 0
                with open(dest, mode) as f:
                    while True:
                        chunk = r.read(262144)
                        if not chunk:
                            break
                        f.write(chunk)
                        have += len(chunk)
                        status_cb(f"downloading voice model… {have * 100 // total}%" if total
                                  else f"downloading voice model… {have // 1048576} MB")
            if os.path.getsize(dest) > 1_000_000:
                return True
        except urllib.error.HTTPError as e:
            if e.code == 416 and have:          # already complete
                return True
            status_cb(f"download retry {attempt}/{attempts} (HTTP {e.code})")
            time.sleep(2)
        except Exception as e:
            msg = str(e)
            if "CERTIFICATE_VERIFY_FAILED" in msg:
                status_cb("TLS verification failed — corporate proxy? set SAMURAI_INSECURE_TLS=1")
            else:
                status_cb(f"download retry {attempt}/{attempts} ({msg[:40]})")
            time.sleep(2)
    return False


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_extract(zpath, dest_dir):
    """Extract a zip, refusing entries that would land outside dest_dir (zip-slip)."""
    dest_dir = os.path.abspath(dest_dir)
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            target = os.path.abspath(os.path.join(dest_dir, info.filename))
            if not target.startswith(dest_dir + os.sep) and target != dest_dir:
                raise ValueError(f"unsafe path in archive: {info.filename}")
        z.extractall(dest_dir)


def ensure_model(status_cb=lambda s: None, name=SMALL_MODEL_NAME):
    """Guarantee a valid Vosk model is present. Returns (ok, message)."""
    if model_valid(name) or (name == SMALL_MODEL_NAME and any_valid_model()):
        return True, "voice model present"
    os.makedirs(MODELS, exist_ok=True)
    zpath = os.path.join(MODELS, name + ".zip")
    urls = MODEL_MIRRORS if name == SMALL_MODEL_NAME else [LARGE_MODEL_URL]
    for url in urls:
        status_cb(f"fetching voice model from {url.split('/')[2]}…")
        if download_with_resume(url, zpath, status_cb, attempts=6 if name == SMALL_MODEL_NAME else 30):
            expected = MODEL_SHA256.get(name)
            if expected and sha256_file(zpath) != expected:
                status_cb("checksum mismatch — discarding download")
                os.remove(zpath)
                continue
            try:
                status_cb("extracting voice model…")
                safe_extract(zpath, MODELS)
                os.remove(zpath)
            except Exception as e:
                return False, f"extract failed: {e}"
            if model_valid(name):
                return True, "voice model installed"
        if os.path.exists(zpath):
            try:
                os.remove(zpath)
            except OSError:
                pass
    return False, "could not download voice model (network blocked?) — see README"


# --------------------------------------------------------------------------- misc
def http_json(url, timeout=8, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "SAMURAI/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def port_up(port, host="127.0.0.1", timeout=0.4):
    import socket
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()
