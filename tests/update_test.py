"""Self-update + installer + overlay checks: a fake release served locally is downloaded, verified, extracted and staged with a
swap script; the status route shape; the installer script references only paths the build produces; the launcher picks the
data/src overlay when it exists. No network, no real swap."""
import io, json, os, shutil, subprocess, sys, tarfile, tempfile, threading, zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "servers"))
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + (f" — {detail}" if detail and not ok else "")); fails += 0 if ok else 1


# ---- a fake GitHub release on localhost
zbuf = io.BytesIO()
with zipfile.ZipFile(zbuf, "w") as z:
    z.writestr("SAMURAI.exe", b"MZ fake exe"); z.writestr("README.txt", "new"); z.writestr("_internal/VERSION", "9.9.9")
    z.writestr("config.json", "SHOULD NOT OVERWRITE")
ZIP = zbuf.getvalue()
tbuf = io.BytesIO()
with tarfile.open(fileobj=tbuf, mode="w:gz") as t:
    for name, data in (("SAMURAI/SAMURAI", b"#!/bin/sh\n"), ("SAMURAI/README.txt", b"new"), ("SAMURAI/_internal/VERSION", b"9.9.9")):
        info = tarfile.TarInfo(name); info.size = len(data); t.addfile(info, io.BytesIO(data))
TAR = tbuf.getvalue()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        if self.path.startswith("/latest"):
            body = json.dumps({"tag_name": "v9.9.9", "html_url": "x", "assets": [
                {"name": "SAMURAI-windows-x64.zip", "browser_download_url": f"http://127.0.0.1:{PORT}/win.zip", "size": len(ZIP)},
                {"name": "SAMURAI-linux-x64.tar.gz", "browser_download_url": f"http://127.0.0.1:{PORT}/lin.tgz", "size": len(TAR)}]}).encode()
            ct = "application/json"
        elif self.path == "/win.zip":
            body, ct = ZIP, "application/zip"
        elif self.path == "/lin.tgz":
            body, ct = TAR, "application/gzip"
        elif self.path == "/bad.zip":
            body, ct = ZIP[:-10], "application/zip"
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", ct); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


srv = HTTPServer(("127.0.0.1", 0), H); PORT = srv.server_port
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["SAMURAI_UPDATE_URL"] = f"http://127.0.0.1:{PORT}/latest"

import samurai_update as U
tmp = tempfile.mkdtemp(prefix="samurai-upd-")
U.ROOT = tmp; U.DATA = os.path.join(tmp, "data"); U.LOGS = os.path.join(tmp, "logs"); os.makedirs(U.LOGS)
open(os.path.join(tmp, "config.json"), "w").write("keep me")

# ---- latest + status
l = U.latest(); check("latest release parsed", l["latest"] == "9.9.9" and l["newer"] and "SAMURAI-windows-x64.zip" in l["assets"], l)
st = U.get_status(None, {}, {}); check("status shape", st["ok"] and st["current"] and st["latest"] == "9.9.9" and st["newer"] and "downloading" in st and "staged" in st and st["mode"] in ("packaged", "source"), st)

# ---- windows path: zip → new/ → apply.bat
U.sys.platform = "win32"
try:
    script = U.stage("SAMURAI-windows-x64.zip", f"http://127.0.0.1:{PORT}/win.zip", len(ZIP))
    check("zip downloaded and extracted", os.path.exists(os.path.join(U.DATA, "update", "new", "SAMURAI.exe")) and os.path.exists(os.path.join(U.DATA, "update", "new", "_internal", "VERSION")))
    check("progress reached 100 %", U.STATE["progress"] == 1.0 and not U.STATE["downloading"])
    bat = open(script, encoding="utf-8").read()
    check("apply.bat waits, copies with exclusions, relaunches", script.endswith("apply.bat") and "tasklist" in bat and "robocopy" in bat and '"config.json"' in bat and os.path.join(tmp, "data") in bat and "SAMURAI.exe" in bat and "start" in bat, bat[:300])
    check("config.json untouched by staging", open(os.path.join(tmp, "config.json")).read() == "keep me")
except Exception as e:
    check("windows stage path", False, str(e))
# ---- size mismatch rejected
try:
    U.stage("SAMURAI-windows-x64.zip", f"http://127.0.0.1:{PORT}/bad.zip", len(ZIP)); check("size mismatch rejected", False, "no error")
except Exception as e:
    check("size mismatch rejected", "mismatch" in str(e) or "not found" in str(e), str(e))
# ---- linux path: tar with a SAMURAI/ folder → normalised → apply.sh
U.sys.platform = "linux"
try:
    script = U.stage("SAMURAI-linux-x64.tar.gz", f"http://127.0.0.1:{PORT}/lin.tgz", len(TAR))
    check("tarball normalised to files at the root", os.path.exists(os.path.join(U.DATA, "update", "new", "SAMURAI")) and not os.path.isdir(os.path.join(U.DATA, "update", "new", "SAMURAI", "_internal")))
    sh = open(script).read(); check("apply.sh waits, copies, relaunches", script.endswith("apply.sh") and "pgrep" in sh and ("rsync" in sh or "cp -R" in sh) and "--exclude='config.json'" in sh and "nohup" in sh, sh[:300])
    check("apply.sh is executable", os.access(script, os.X_OK))
except Exception as e:
    check("linux stage path", False, str(e))
# ---- zip-slip guard
evil = io.BytesIO()
with zipfile.ZipFile(evil, "w") as z:
    z.writestr("../../evil.txt", "x"); z.writestr("SAMURAI", "x")
p = os.path.join(U.DATA, "update", "evil.zip"); open(p, "wb").write(evil.getvalue())
try:
    U.extract(p, os.path.join(U.DATA, "update", "new2")); check("zip-slip rejected", False, "extracted")
except Exception as e:
    check("zip-slip rejected", "unsafe" in str(e), str(e))
U.sys.platform = sys.platform

# ---- installer script sanity (no Inno on Linux): every referenced file exists in the layout the build produces
iss = open(os.path.join(ROOT, "installer", "samurai.iss"), encoding="utf-8").read()
check("iss: per-user install, keeps data unless asked", "{localappdata}\\Programs" in iss and "PrivilegesRequired=lowest" in iss and "RemoveData" in iss and "DelTree(AppDir + '\\data'" in iss)
check("iss: version and source come from the build", "/DMyAppVersion" in open(os.path.join(ROOT, ".github", "workflows", "build-exe.yml")).read() and "{#SourceDir}\\*" in iss)
check("iss: icon exists when referenced", os.path.exists(os.path.join(ROOT, "app", "icons", "samurai.ico")) and "FileExists(IconFile)" in iss)
check("iss: GUID is valid", __import__("re").search(r"AppId=\{\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}", iss) is not None)
secs = [s for s in ("[Setup]", "[Files]", "[Icons]", "[Tasks]", "[Run]", "[UninstallRun]", "[Code]", "[Languages]") if s in iss]
check("iss: sections present", len(secs) == 8, secs)
check("ci: installer built and released", "ISCC.exe" in open(os.path.join(ROOT, ".github", "workflows", "build-exe.yml")).read() and "SAMURAI-setup-*.exe" in open(os.path.join(ROOT, ".github", "workflows", "build-exe.yml")).read())

# ---- PWA files
m = json.load(open(os.path.join(ROOT, "app", "companion.webmanifest")))
check("manifest", m["display"] == "standalone" and "companion=1" in m["start_url"] and all(os.path.exists(os.path.join(ROOT, "app", i["src"])) for i in m["icons"]))
sw = open(os.path.join(ROOT, "app", "sw.js")).read(); check("service worker caches the shell only on this origin", "url.origin !== self.location.origin" in sw and "jarvis-interface.html" in sw)
html = open(os.path.join(ROOT, "app", "jarvis-interface.html"), encoding="utf-8").read()
check("page links the manifest and registers the worker for the companion only", 'rel="manifest"' in html and "companion') === '1'" in html and "serviceWorker.register" in html)
check("spec bundles the sources for the forge", '"src/servers"' in open(os.path.join(ROOT, "samurai.spec")).read() and "ICON" in open(os.path.join(ROOT, "samurai.spec")).read())

# ---- launcher overlay: with SAMURAI_FORCE_OVERLAY and data/src present, SERVERS points at the overlay
ov = tempfile.mkdtemp(prefix="samurai-ov-"); os.makedirs(os.path.join(ov, "data", "src", "servers")); open(os.path.join(ov, "data", "src", "servers", "samurai_common.py"), "w").write("")
out = subprocess.run([sys.executable, "-c", "import sys; sys.argv=['x']; import importlib.util, os; spec=importlib.util.spec_from_file_location('L', os.environ['L']); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(m.USE_OVERLAY, m.SERVERS)"],
                     env={**os.environ, "L": os.path.join(ROOT, "samurai_launcher.py"), "SAMURAI_ROOT": ov, "SAMURAI_FORCE_OVERLAY": "1"}, capture_output=True, text=True)
check("launcher picks data/src overlay when forced", out.stdout.startswith("True") and os.path.join(ov, "data", "src", "servers") in out.stdout, out.stdout + out.stderr)
out2 = subprocess.run([sys.executable, "-c", "import sys; sys.argv=['x']; import importlib.util, os; spec=importlib.util.spec_from_file_location('L', os.environ['L']); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(m.USE_OVERLAY)"],
                      env={**os.environ, "L": os.path.join(ROOT, "samurai_launcher.py"), "SAMURAI_ROOT": ov}, capture_output=True, text=True)
check("launcher ignores the overlay when not frozen", out2.stdout.strip() == "False", out2.stdout + out2.stderr)
# ---- forge in packaged mode would work from data/src
import samurai_forge as F
check("forge WORK dir is the checkout for a source install", F.WORK == F.ROOT and not F.FROZEN)
r = F.post_sources(None, {}, {}); check("forge sources route refuses on a source install", r["ok"] is False and "source install" in r["error"])

shutil.rmtree(tmp, ignore_errors=True); shutil.rmtree(ov, ignore_errors=True); srv.shutdown()
print("\n" + ("ALL PASS" if not fails else f"{fails} FAILED")); sys.exit(1 if fails else 0)
