"""
SAMURAI Telemetry Sidecar — real system stats for the HUD.
Serves JSON on http://localhost:8765/stats
  cpu, mem, gpu (%), net (MB/s total), up/down (MB/s),
  conns  — active TCP connections with process names,
  events — recent system log entries (Windows event log / journald),
  temp, cores, uptime, top_cpu, top_mem, disk, battery.
Run: python samurai_telemetry.py
"""
import json, os, shutil, subprocess, sys, threading, time
from http.server import ThreadingHTTPServer
import psutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from samurai_common import maybe_wrap_tls, bind_host, JSONHandler, NOWIN, IS_WIN, PORTS

PORT = PORTS["telemetry"]
STATE = {
    "cpu": 0, "mem": 0, "gpu": None, "gpu_temp": None,
    "net": 0.0, "up": 0.0, "down": 0.0,
    "conns": [], "events": [],
    "temp": None, "cores": 0, "uptime": "",
    "top_cpu": [], "top_mem": [], "disk": [], "battery": None,
    "net_history": [],
    "active_window": {"title": "", "app": ""}, "fullscreen": False,
}
LOCK = threading.Lock()


def run(cmd, **kw):
    return subprocess.run(cmd, creationflags=NOWIN, **kw)


def gpu_percent():
    if not shutil.which("nvidia-smi"):
        return None, None
    try:
        out = run(["nvidia-smi", "--query-gpu=utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits"],
                  capture_output=True, text=True, timeout=3)
        parts = out.stdout.strip().splitlines()[0].split(",")
        return int(parts[0]), int(parts[1])
    except Exception:
        return None, None


def cpu_temp():
    try:
        temps = psutil.sensors_temperatures()
        for key in ("coretemp", "k10temp", "cpu_thermal", "acpitz"):
            if key in temps and temps[key]:
                return round(temps[key][0].current, 1)
        for arr in temps.values():
            if arr:
                return round(arr[0].current, 1)
    except Exception:
        pass
    if IS_WIN:
        try:
            out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                       "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop).CurrentTemperature"],
                      capture_output=True, text=True, timeout=8)
            return round(int(out.stdout.strip().splitlines()[0]) / 10.0 - 273.15, 1)
        except Exception:
            return None
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
            STATE["net_history"] = (STATE["net_history"] + [round(up + down, 3)])[-40:]


def sample_conns():
    while True:
        conns = []
        try:
            procs = {p.pid: p.info["name"] for p in psutil.process_iter(["name"])}
            for c in psutil.net_connections(kind="tcp"):
                if c.status == "ESTABLISHED" and c.raddr:
                    conns.append({"proc": (procs.get(c.pid) or "?").replace(".exe", ""),
                                  "raddr": f"{c.raddr.ip}:{c.raddr.port}"})
        except Exception:
            pass
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
            STATE["conn_count"] = len(conns)
            STATE["gpu"] = gpu_u
            STATE["gpu_temp"] = gpu_t
        time.sleep(5)


def fmt_uptime(seconds):
    d, rem = divmod(int(seconds), 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    return f"{d}d {h}h {m}m" if d else (f"{h}h {m}m" if h else f"{m}m")


def sample_system():
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
                procs.append({"name": name.replace(".exe", ""), "cpu": round(cpu, 1), "mem": round(mem_mb, 0)})
            except Exception:
                pass
        disks = []
        for part in psutil.disk_partitions(all=False):
            try:
                u = psutil.disk_usage(part.mountpoint)
                disks.append({"drive": part.device.replace("\\", "") if IS_WIN else part.mountpoint,
                              "pct": round(u.percent, 0), "free_gb": round(u.free / 1e9, 1),
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
        with LOCK:
            STATE["top_cpu"] = sorted(procs, key=lambda x: x["cpu"], reverse=True)[:5]
            STATE["top_mem"] = sorted(procs, key=lambda x: x["mem"], reverse=True)[:5]
            STATE["disk"] = disks[:6]
            STATE["battery"] = battery
            STATE["temp"] = cpu_temp()
            STATE["cores"] = ncpu
            STATE["uptime"] = fmt_uptime(time.time() - psutil.boot_time())


def read_events():
    if IS_WIN:
        ps = ("Get-WinEvent -LogName System,Application -MaxEvents 12 -ErrorAction SilentlyContinue | "
              "Sort-Object TimeCreated -Descending | Select-Object -First 10 | "
              "ForEach-Object { [pscustomobject]@{ t = $_.TimeCreated.ToString('HH:mm:ss'); "
              "lvl = $_.LevelDisplayName; src = $_.ProviderName; id = $_.Id; "
              "msg = if ($_.Message) { $_.Message.Split(\"`n\")[0].Trim() } else { '' } } } | ConvertTo-Json -Compress")
        out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                  capture_output=True, text=True, timeout=30)
        data = json.loads(out.stdout) if out.stdout.strip() else []
        if isinstance(data, dict):
            data = [data]
        return [{"t": e.get("t", ""), "lvl": e.get("lvl") or "Info", "src": (e.get("src") or "")[:28],
                 "id": e.get("id"), "msg": (e.get("msg") or "")[:90]} for e in data]
    if shutil.which("journalctl"):
        out = run(["journalctl", "-p", "warning", "-n", "10", "-o", "json", "--no-pager"],
                  capture_output=True, text=True, timeout=15)
        evs = []
        for line in out.stdout.splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            ts = int(e.get("__REALTIME_TIMESTAMP", 0)) / 1e6
            lvl = {"0": "Critical", "1": "Critical", "2": "Critical", "3": "Error", "4": "Warning"}.get(
                str(e.get("PRIORITY", "6")), "Info")
            evs.append({"t": time.strftime("%H:%M:%S", time.localtime(ts)) if ts else "", "lvl": lvl,
                        "src": (e.get("SYSLOG_IDENTIFIER") or e.get("_COMM") or "")[:28],
                        "id": e.get("PRIORITY"), "msg": str(e.get("MESSAGE", ""))[:90]})
        return list(reversed(evs))
    return []


def active_window():
    """Foreground window title + process name (best effort per OS); returns (dict, fullscreen)."""
    try:
        if IS_WIN:
            script = ("Add-Type -AssemblyName System.Windows.Forms; Add-Type @'\nusing System;using System.Runtime.InteropServices;using System.Text;public class FW{[DllImport(\"user32.dll\")]public static extern IntPtr GetForegroundWindow();"
                      "[DllImport(\"user32.dll\")]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);[DllImport(\"user32.dll\")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);"
                      "[DllImport(\"user32.dll\")]public static extern bool GetWindowRect(IntPtr h,out RECT r);public struct RECT{public int L,T,R,B;}}\n'@;"
                      "$h=[FW]::GetForegroundWindow();$sb=New-Object System.Text.StringBuilder 256;[FW]::GetWindowText($h,$sb,256)|Out-Null;$p=0;[FW]::GetWindowThreadProcessId($h,[ref]$p)|Out-Null;"
                      "$r=New-Object FW+RECT;[FW]::GetWindowRect($h,[ref]$r)|Out-Null;$n=(Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName;"
                      "$w=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width;$hh=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height;"
                      "@{title=$sb.ToString();app=$n;full=(($r.R-$r.L) -ge $w -and ($r.B-$r.T) -ge $hh)} | ConvertTo-Json -Compress")
            out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, timeout=8).stdout
            d = json.loads(out.strip() or "{}")
            return {"title": str(d.get("title") or "")[:160], "app": str(d.get("app") or "")[:60]}, bool(d.get("full"))
        if IS_MAC:
            out = subprocess.run(["osascript", "-e", 'tell application "System Events" to set p to first application process whose frontmost is true', "-e", 'set t to ""', "-e", "try",
                                  "-e", 'tell application "System Events" to set t to name of front window of p', "-e", "end try", "-e", 'return (name of p) & "|" & t'], capture_output=True, text=True, timeout=5).stdout.strip()
            app, _, title = out.partition("|")
            return {"title": title[:160], "app": app[:60]}, False
        if shutil.which("xdotool") and os.environ.get("DISPLAY"):
            run = lambda *a: subprocess.run(["xdotool", *a], capture_output=True, text=True, timeout=3).stdout.strip()
            wid = run("getactivewindow"); title = run("getwindowname", wid); pid = run("getwindowpid", wid)
            app = psutil.Process(int(pid)).name() if pid.isdigit() else ""
            full = False
            try:
                g = dict(l.split("=") for l in run("getwindowgeometry", "--shell", wid).splitlines() if "=" in l)
                scr = run("getdisplaygeometry").split()
                full = int(g.get("WIDTH", 0)) >= int(scr[0]) and int(g.get("HEIGHT", 0)) >= int(scr[1])
            except Exception:
                pass
            return {"title": title[:160], "app": app[:60]}, full
    except Exception:
        pass
    return {"title": "", "app": ""}, False


def sample_window():
    while True:
        try:
            aw, full = active_window()
            with LOCK:
                STATE["active_window"] = aw; STATE["fullscreen"] = full
        except Exception:
            pass
        time.sleep(5)


def sample_events():
    while True:
        try:
            events = read_events()
            with LOCK:
                STATE["events"] = events
        except Exception:
            pass
        time.sleep(20)


def get_stats(handler, query, body):
    with LOCK:
        return dict(STATE)


class Handler(JSONHandler):
    TAG = "SAMURAI-TEL"
    ROUTES = {("GET", "/stats"): get_stats}


if __name__ == "__main__":
    for fn in (sample_fast, sample_conns, sample_events, sample_system, sample_window):
        threading.Thread(target=fn, daemon=True).start()
    print(f"[SAMURAI] Telemetry sidecar on http://localhost:{PORT}/stats")
    maybe_wrap_tls(ThreadingHTTPServer((bind_host(), PORT), Handler)).serve_forever()
