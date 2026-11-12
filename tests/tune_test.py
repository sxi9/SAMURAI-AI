"""Auto-tune: recommendations for a few known machines (unit) + the live panel routes."""
import json, os, sys, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "servers"))
import samurai_tune as T

fails = 0
def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + (f" — {detail}" if detail and not ok else "")); fails += 0 if ok else 1

def prof(**kw):
    base = {"os": "Windows 11", "machine": "AMD64", "cpu": {"name": "AMD Ryzen 5 3550H", "cores": 4, "threads": 8, "mhz": 2100}, "ram_gb": 7.9, "ram_free_gb": 3.1,
            "gpus": [{"name": "AMD Radeon(TM) Vega 8 Graphics", "vram_gb": .1, "driver": "", "kind": "integrated"}, {"name": "Radeon RX 560X Series", "vram_gb": 4, "driver": "", "kind": "discrete"}],
            "battery": {"percent": 80, "plugged": True}, "disk_free_gb": 40, "cameras": [{"name": "Iriun Webcam", "virtual": True}, {"name": "Snap Camera", "virtual": True}, {"name": "HD User Facing", "virtual": False}],
            "networks": [{"name": "VMware Network Adapter VMnet8", "ip": "192.168.44.1", "kind": "virtual", "up": True, "speed": 100}, {"name": "Wi-Fi", "ip": "192.168.1.23", "kind": "physical", "up": True, "speed": 144}],
            "tools": {"claude": True, "gemini": False, "ollama": False, "node": True, "git": True, "ffmpeg": False}, "python": "3.10.5"}
    base.update(kw); return base

# the laptop from the conversation
p = prof(); p["networks"].sort(key=lambda n: {"physical": 0, "vpn": 1, "virtual": 2}[n["kind"]])
r, why, warn = T.recommend(p)
check("laptop: 3D high on the discrete GPU", r["gl"] == "auto" and r["gl_quality"] == "high", r)
check("laptop: Whisper base, Kokoro skipped", r["whisper_model"] == "base" and r["whisper_ok"] and not r["kokoro_ok"], r)
check("laptop: essentials profile (8 GB, 4 cores)", r["services_profile"] == "essentials")
check("laptop: half duplex, governor", r["half_duplex"] and r["governor"])
check("laptop: presence camera is the real one", r["presence_camera"] == "HD User Facing", r["presence_camera"])
check("laptop: Wi-Fi address first", r["lan_ip"] == "192.168.1.23", r["lan_ip"])
check("laptop: brain = Claude Code", r["brain"] == "claude_code")
check("laptop: two-GPU warning", any("two GPUs" in w for w in warn), warn)
check("browser on Vega 8 → warning", "integrated" in T.browser_warning(p, {"renderer": "ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"}))
check("browser on RX 560X → no warning", T.browser_warning(p, {"renderer": "ANGLE (AMD, Radeon RX 560X Series Direct3D11 vs_5_0 ps_5_0, D3D11)"}) == "")
check("browser in software → warning", "software" in T.browser_warning(p, {"renderer": "Google SwiftShader"}))
# a desktop workstation
d = prof(ram_gb=32, battery=None, cpu={"name": "Ryzen 7 5800X", "cores": 8, "threads": 16, "mhz": 4700}, gpus=[{"name": "NVIDIA GeForce RTX 3070", "vram_gb": 8, "driver": "", "kind": "discrete"}], tools={"claude": False, "ollama": True})
r2 = T.recommend(d)[0]
check("desktop: full profile, Kokoro ok, 14B local models, Ollama brain", r2["services_profile"] == "full" and r2["kokoro_ok"] and r2["local_llm"] == "14B models" and r2["brain"] == "ollama", r2)
check("desktop: full duplex", not r2["half_duplex"])
# a VM
v = prof(gpus=[{"name": "VMware SVGA 3D", "vram_gb": 0, "driver": "", "kind": "virtual"}], ram_gb=4, battery=None)
r3, _, w3 = T.recommend(v)
check("vm: 2D core, no effects, tiny whisper, RAM warning", r3["gl"] == "off" and not r3["fx"] and not r3["whisper_ok"] and any("RAM" in w for w in w3), (r3, w3))
# gpu classification
check("gpu kinds", [g["kind"] for g in [dict(name=n, kind=("virtual" if T.VIRTUAL_GPU.search(n) else "discrete" if T.DISCRETE.search(n) else "integrated" if T.INTEGRATED.search(n) else "unknown")) for n in ("Intel(R) UHD Graphics 630", "NVIDIA GeForce GTX 1650", "Apple M2", "Microsoft Basic Render Driver", "Radeon RX 7800 XT")]] == ["integrated", "discrete", "integrated", "virtual", "discrete"])
# live routes
try:
    def J(path, body=None):
        req = urllib.request.Request("http://127.0.0.1:9000" + path, data=json.dumps(body).encode() if body is not None else None, headers={"Origin": "http://localhost:9000", "Content-Type": "application/json"}, method="POST" if body is not None else "GET")
        return json.loads(urllib.request.urlopen(req, timeout=30).read())
    t = J("/tune"); check("live GET /tune", t["ok"] and "profile" in t and "recommendation" in t and isinstance(t["why"], list))
    a = J("/tune", {"apply": True, "overrides": {"services_profile": "full"}}); check("live POST /tune apply", a["ok"] and a["applied"]["services_profile"] == "full")
    t2 = J("/tune"); check("applied is recorded", t2["applied"] > 0 and t2["current"]["services_profile"] == "full")
    rep = J("/tune/report", {"renderer": "Google SwiftShader", "fps": 12, "quality": "low"}); check("live POST /tune/report", rep["ok"] and "warning" in rep)
except Exception as e:
    check("live routes (panel on :9000)", False, str(e)[:80])
print("\n" + ("ALL PASS" if not fails else f"{fails} FAILED")); sys.exit(1 if fails else 0)
