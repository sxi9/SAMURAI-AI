"""Faces test: the two avatar faces (pinu-bot robot face, three-vrm VRM avatar) are wired into the HUD.
Checks, without a browser: the vendored files and the bundled model exist with their licences, the importmap has the
entries, the add-ons GET /avatars route lists the bundled model (called in-process), the HUD scripts carry the new
avatar modes / phrases / contract, every JS file parses (node --check) and every sidecar compiles (py_compile).
Run:  python tests/face_test.py          (the browser screenshots are tests/face_shots.js)"""
import json, os, py_compile, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
sys.path.insert(0, os.path.join(ROOT, "servers"))
import samurai_addons as addons          # noqa: E402

FAILS = []


def check(cond, what):
    print(("  ok   " if cond else "  FAIL ") + what)
    if not cond:
        FAILS.append(what)


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def main():
    print("vendored files")
    for p in ("vendor/pinu-bot/index.js", "vendor/pinu-bot/robotFace.js", "vendor/pinu-bot/characters/pinu.js", "vendor/pinu-bot/LICENSE", "vendor/pinu-bot/package.json",
              "vendor/three-vrm/three-vrm.module.js", "vendor/three-vrm/LICENSE", "vendor/three/jsm/loaders/GLTFLoader.js",
              "vendor/three/jsm/utils/BufferGeometryUtils.js", "vendor/three/jsm/utils/SkeletonUtils.js",
              "avatars/VRM1_Constraint_Twist_Sample.vrm", "avatars/NOTICE.md", "js/hud-face.js"):
        check(os.path.isfile(os.path.join(APP, p)), p)
    check(not any(f.endswith(".d.ts") for f in os.listdir(os.path.join(APP, "vendor", "pinu-bot"))), "no .d.ts files shipped in vendor/pinu-bot")
    check(os.path.getsize(os.path.join(APP, "avatars", "VRM1_Constraint_Twist_Sample.vrm")) > 5_000_000, "bundled VRM is the full 11 MB model")
    check("MIT" in read("app", "vendor", "pinu-bot", "LICENSE") and "MIT" in read("app", "vendor", "three-vrm", "LICENSE"), "licences are MIT")
    check("VRM Public License" in read("app", "avatars", "NOTICE.md"), "avatar notice names the VRM Public License")
    check("pinu-bot" in read("docs", "THIRD-PARTY.md") and "three-vrm" in read("docs", "THIRD-PARTY.md"), "docs/THIRD-PARTY.md lists both libraries")
    pkg = json.loads(read("app", "vendor", "pinu-bot", "package.json"))
    check(pkg.get("name") == "pinu-bot" and pkg.get("version") == "0.3.0", "pinu-bot package.json is 0.3.0")
    check("three-vrm v3.5.5" in read("app", "vendor", "three-vrm", "three-vrm.module.js")[:400], "three-vrm bundle is 3.5.5")

    print("importmap and page")
    html = read("app", "jarvis-interface.html")
    im = json.loads(re.search(r'<script type="importmap">(.*?)</script>', html, re.S).group(1))["imports"]
    check(im.get("@pixiv/three-vrm") == "./vendor/three-vrm/three-vrm.module.js", 'importmap "@pixiv/three-vrm"')
    check(im.get("pinu-bot") == "./vendor/pinu-bot/index.js", 'importmap "pinu-bot"')
    check(im.get("three") == "./vendor/three/three.module.js" and im.get("three/addons/") == "./vendor/three/jsm/", "importmap three entries kept")
    check('src="js/hud-face.js"' in html and html.index("js/hud.js") < html.index("js/hud-face.js"), "hud-face.js loads after hud.js")
    check('id="botFace"' in html and 'id="bot"' in html, "bot canvas layer in the page")
    check(not re.search(r"https?://[^\"' ]*\.(?:jsdelivr|unpkg|cdnjs|cloudflare)", html), "no CDN script urls")

    print("scripts")
    hud = read("app", "js", "hud.js"); face = read("app", "js", "hud-face.js"); gl = read("app", "js", "hud-3d.js"); brain = read("app", "js", "hud-brain.js"); css = read("app", "css", "hud.css")
    check("buildFace" not in gl and "'face'" not in gl, "procedural face removed from hud-3d.js")
    check("loadVrm" in gl and "VRMLoaderPlugin" in gl and "disposeVrm" in gl and "updateVrm" in gl, "VRM load / update / dispose in hud-3d.js")
    check("s.ui.avatar === 'face' ? 'bot'" in hud, "saved 'face' avatar migrates to 'bot'")
    check("faceStyle: S.faceStyle, vrm: S.vrm" in hud, "faceStyle and vrm saved with the ui settings")
    for phrase in ("robot face", "avatar mode", "anime", "hide your face", "use|wear|load|pick) the avatar", "look|be|act|feel) (happy", "face style|face look|robot style) (soft|visor|band"):
        check(phrase in hud, f"voice phrase · {phrase}")
    check('id="optAvatar"' in hud and 'id="optFaceStyle"' in hud and 'id="optVrm"' in hud, "drawer selects: avatar, face style, vrm file")
    check("SAM.face = face" in face and all(k in face for k in ("set(emotion, hold)", "mode(m)", "level(v)", "look(x, y", "tick(dt)", "guess(text)", "speech()")), "SAM.face controller api")
    check("createRobotFace" in face and "import('pinu-bot')" in face, "robot face created from the vendored pinu-bot")
    check("emotion: out.emotion" in hud and '"emotion"' in brain and "EMOTIONS.includes(o.emotion)" in brain, "emotion in the brain's JSON contract and parse path")
    check(".stage.bot" in css and ".stage.vrm" in css and ".stage.face" not in css, "stage classes renamed to bot / vrm")

    print("add-ons route (in-process)")
    d = addons.get_avatars(None, {}, None)
    check(d.get("ok") is True and isinstance(d.get("avatars"), list), "GET /avatars answers {ok, avatars}")
    files = [a["file"] for a in d.get("avatars", [])]
    check("VRM1_Constraint_Twist_Sample.vrm" in files, "bundled model listed")
    one = next((a for a in d.get("avatars", []) if a["file"] == "VRM1_Constraint_Twist_Sample.vrm"), {})
    check(one.get("url") == "/avatars/VRM1_Constraint_Twist_Sample.vrm" and one.get("name"), "url is relative to the UI origin, name is pretty")
    check(("GET", "/avatars") in addons.Handler.ROUTES, "route registered in the handler")

    print("syntax")
    node = shutil.which("node")
    for js in ("hud.js", "hud-face.js", "hud-3d.js", "hud-brain.js", "hud-core.js", "hud-fx.js", "hud-voice.js", "hud-widgets.js"):
        p = os.path.join(APP, "js", js)
        if node:
            r = subprocess.run([node, "--check", p], capture_output=True, text=True)
            check(r.returncode == 0, f"node --check {js}" + ("" if r.returncode == 0 else " · " + r.stderr.strip().splitlines()[-1][:80]))
        else:
            check(os.path.getsize(p) > 0, f"{js} present (node not installed, parse skipped)")
    for py in ("samurai_addons.py", "samurai_common.py"):
        try:
            py_compile.compile(os.path.join(ROOT, "servers", py), doraise=True); check(True, "py_compile " + py)
        except py_compile.PyCompileError as e:
            check(False, f"py_compile {py} · {e}")

    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)}"); [print("  - " + f) for f in FAILS]; sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
