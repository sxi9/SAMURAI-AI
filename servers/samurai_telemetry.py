"""
SAMURAI Telemetry Sidecar — real system stats for the HUD.
Serves JSON on http://localhost:8765/stats
  cpu, mem, gpu (%), net (MB/s total), up/down (MB/s),
  conns  — active TCP connections with process names,
  events — recent Windows System/Application event log entries.
Run: python samurai_telemetry.py
"""
import json, os, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import psutil

# run child processes (powershell, nvidia-smi) with NO flashing console window
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def run(cmd, **kw):
    return subprocess.run(cmd, creationflags=CREATE_NO_WINDOW, **kw)


PORT = 8765
STATE = {
    "cpu": 0, "mem": 0, "gpu": None,
    "net": 0.0, "up": 0.0, "down": 0.0,
    "conns": [], "events": [],
    "temp": None, "cores": 0, "uptime": "",
    "top_cpu": [], "top_mem": [], "disk": [], "battery": None
}
LOCK = threading.Lock()


def gpu_percent():
    try:
        out = run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3)
        parts = out.stdout.strip().splitlines()[0].split(",")
        return int(parts[0]), int(parts[1])
    except Exception:
        return None, None


def cpu_temp():
    # 1) psutil sensors (rare on Windows)
    try:
        temps = psutil.sensors_temperatures()
        for key in ("coretemp", "cpu_thermal", "acpitz"):
            if key in temps and temps[key]:
                return round(temps[key][0].current, 1)
        for arr in temps.values():
            if arr:
                return round(arr[0].current, 1)
    except Exception:
        pass
    # 2) Windows ACPI thermal zone (tenths of Kelvin)
    try:
        out = run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop).CurrentTemperature"],
            capture_output=True, text=True, timeout=8)
        line = out.stdout.strip().splitlines()[0]
        return round(int(line) / 10.0 - 273.15, 1)
    except Exception:
        return None


def sample_fast():
    last = psutil.net_io_counters()
    last_t = time.time()
    while True:
        time.sleep(2)
        now = psutil.net_io_counters()
        t = time.time()
        dt = max(0.5, t - last_t)
        up = (now.bytes_sent - last.bytes_sent) / dt / 1e6
        down = (now.bytes_recv - last.bytes_recv) / dt / 1e6
        last, last_t = now, t
        with LOCK:
            STATE["cpu"] = psutil.cpu_percent()
            STATE["mem"] = psutil.virtual_memory().percent
            STATE["up"] = round(up, 2)
            STATE["down"] = round(down, 2)
            STATE["net"] = round(up + down, 2)


def sample_conns():
    while True:
        conns = []
        try:
            procs = {p.pid: p.info["name"] for p in psutil.process_iter(["name"])}
            for c in psutil.net_connections(kind="tcp"):
                if c.status == "ESTABLISHED" and c.raddr:
                    conns.append({
                        "proc": (procs.get(c.pid) or "?").replace(".exe", ""),
                        "raddr": f"{c.raddr.ip}:{c.raddr.port}"
                    })
        except Exception:
            pass
        # dedupe by process, keep first 8
        seen, top = set(), []
        for c in conns:
            k = (c["proc"], c["raddr"].rsplit(":", 1)[0])
            if k not in seen:
                seen.add(k)
                top.append(c)
            if len(top) >= 8:
                break
        gpu_u, gpu_t = gpu_percent()
        with LOCK:
            STATE["conns"] = top
            STATE["gpu"] = gpu_u
            STATE["gpu_temp"] = gpu_t
        time.sleep(5)


def fmt_uptime(seconds):
    d, rem = divmod(int(seconds), 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    if d:
        return f"{d}d {h}h {m}m"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


def sample_system():
    # prime cpu_percent per-process
    for p in psutil.process_iter():
        try:
            p.cpu_percent()
        except Exception:
            pass
    ncpu = psutil.cpu_count() or 1
    while True:
        time.sleep(6)
        procs = []
        skip = {"System Idle Process", "Idle"}
        for p in psutil.process_iter(["name", "memory_info"]):
            try:
                name = (p.info["name"] or "?")
                if name in skip:
                    continue
                cpu = p.cpu_percent() / ncpu
                mem_mb = p.info["memory_info"].rss / 1e6 if p.info["memory_info"] else 0
                procs.append({"name": name.replace(".exe", ""),
                              "cpu": round(cpu, 1), "mem": round(mem_mb, 0)})
            except Exception:
                pass
        top_cpu = sorted(procs, key=lambda x: x["cpu"], reverse=True)[:5]
        top_mem = sorted(procs, key=lambda x: x["mem"], reverse=True)[:5]

        disks = []
        for part in psutil.disk_partitions(all=False):
            try:
                u = psutil.disk_usage(part.mountpoint)
                disks.append({"drive": part.device.replace("\\", ""),
                              "pct": round(u.percent, 0),
                              "free_gb": round(u.free / 1e9, 1),
                              "total_gb": round(u.total / 1e9, 1)})
            except Exception:
                pass

        battery = None
        try:
            b = psutil.sensors_battery()
            if b is not None:
                battery = {"pct": round(b.percent, 0), "plugged": bool(b.power_plugged)}
        except Exception:
            pass

        temp = cpu_temp()
        up = fmt_uptime(time.time() - psutil.boot_time())
        with LOCK:
            STATE["top_cpu"] = top_cpu
            STATE["top_mem"] = top_mem
            STATE["disk"] = disks
            STATE["battery"] = battery
            STATE["temp"] = temp
            STATE["cores"] = ncpu
            STATE["uptime"] = up


def sample_events():
    ps = (
        "Get-WinEvent -LogName System,Application -MaxEvents 12 -ErrorAction SilentlyContinue | "
        "Sort-Object TimeCreated -Descending | Select-Object -First 10 | "
        "ForEach-Object { [pscustomobject]@{ "
        "t = $_.TimeCreated.ToString('HH:mm:ss'); "
        "lvl = $_.LevelDisplayName; "
        "src = $_.ProviderName; "
        "id = $_.Id; "
        "msg = if ($_.Message) { $_.Message.Split(\"`n\")[0].Trim() } else { '' } } } | "
        "ConvertTo-Json -Compress"
    )
    while True:
        try:
            out = run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                capture_output=True, text=True, timeout=30)
            data = json.loads(out.stdout) if out.stdout.strip() else []
            if isinstance(data, dict):
                data = [data]
            events = [{
                "t": e.get("t", ""),
                "lvl": (e.get("lvl") or "Info"),
                "src": (e.get("src") or "")[:28],
                "id": e.get("id"),
                "msg": (e.get("msg") or "")[:90]
            } for e in data]
            with LOCK:
                STATE["events"] = events
        except Exception:
            pass
        time.sleep(20)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/stats":
            self.send_response(404)
            self.end_headers()
            return
        with LOCK:
            body = json.dumps(STATE).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    for fn in (sample_fast, sample_conns, sample_events, sample_system):
        threading.Thread(target=fn, daemon=True).start()
    print(f"[SAMURAI] Telemetry sidecar on http://localhost:{PORT}/stats")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
