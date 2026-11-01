"""SAMURAI Setup Wizard — installs dependencies, downloads voice models,
creates a desktop shortcut, and launches the dashboard.
Run: python samurai_setup.py  (or double-click SETUP.bat)"""
import os, subprocess, sys, threading, urllib.request, zipfile
import tkinter as tk
from tkinter import ttk

ROOT = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(ROOT, "models")
PIP_PACKAGES = ["vosk", "websockets", "psutil", "edge-tts"]
# reuse the dashboard's robust, resumable, SSL-tolerant downloader + mirror list
sys.path.insert(0, ROOT)
import samurai_dashboard as dash
MODEL_URLS = {
    "small": ("vosk-model-small-en-us-0.15", None, "40 MB"),
    "large": ("vosk-model-en-us-0.22",
              "https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip", "1.8 GB"),
}

BG, PANEL, FG, ACCENT, DIM = "#060a12", "#0b1322", "#9adfff", "#27e0a6", "#3a5a78"


class Setup(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SAMURAI SETUP")
        self.geometry("620x520")
        self.configure(bg=BG)
        self.resizable(False, False)
        self.model_choice = tk.StringVar(value="small")
        self.want_deps = tk.BooleanVar(value=True)
        self.want_shortcut = tk.BooleanVar(value=True)
        self.frames = {}
        for name in ("welcome", "options", "progress", "done"):
            f = tk.Frame(self, bg=BG)
            f.place(x=0, y=0, relwidth=1, relheight=1)
            self.frames[name] = f
        self.build_welcome()
        self.build_options()
        self.build_progress()
        self.build_done()
        self.show("welcome")

    def show(self, name):
        self.frames[name].tkraise()

    def header(self, parent, sub):
        tk.Label(parent, text="S A M U R A I", font=("Consolas", 26, "bold"),
                 fg=ACCENT, bg=BG).pack(pady=(38, 2))
        tk.Label(parent, text=sub, font=("Consolas", 11), fg=FG, bg=BG).pack(pady=(0, 24))

    def button(self, parent, text, cmd):
        b = tk.Button(parent, text=text, command=cmd, font=("Consolas", 11, "bold"),
                      fg=BG, bg=ACCENT, activebackground=FG, relief="flat",
                      padx=24, pady=8, cursor="hand2")
        return b

    # ---------- pages ----------
    def build_welcome(self):
        f = self.frames["welcome"]
        self.header(f, "JARVIS-STYLE AI ASSISTANT · SETUP WIZARD")
        msg = ("This wizard will set up SAMURAI on this machine:\n\n"
               "  1. Install Python packages (vosk, websockets, psutil, edge-tts)\n"
               "  2. Download an offline voice-recognition model\n"
               "  3. Create a desktop shortcut to the SAMURAI Dashboard\n\n"
               "Everything runs 100% locally. No cloud account required.\n"
               "(Optional cloud LLM keys can be added later in the UI settings.)")
        tk.Label(f, text=msg, font=("Consolas", 10), fg=FG, bg=BG,
                 justify="left").pack(pady=6)
        pyv = f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro} detected"
        ok = sys.version_info >= (3, 8)
        tk.Label(f, text=("✓ " if ok else "✗ ") + pyv + ("" if ok else " — need 3.8+"),
                 font=("Consolas", 10, "bold"), fg=ACCENT if ok else "#ff5f6d", bg=BG).pack(pady=14)
        self.button(f, "BEGIN SETUP  ▸", lambda: self.show("options")).pack(pady=16)

    def build_options(self):
        f = self.frames["options"]
        self.header(f, "CHOOSE COMPONENTS")
        box = tk.Frame(f, bg=PANEL, padx=26, pady=18)
        box.pack(padx=40, fill="x")

        def chk(parent, text, var):
            c = tk.Checkbutton(parent, text=text, variable=var, font=("Consolas", 10),
                               fg=FG, bg=PANEL, selectcolor=BG, activebackground=PANEL,
                               activeforeground=ACCENT, anchor="w")
            c.pack(fill="x", pady=3)

        chk(box, "Install Python packages (vosk, websockets, psutil, edge-tts)", self.want_deps)
        chk(box, "Create desktop shortcut  →  SAMURAI Dashboard", self.want_shortcut)

        tk.Label(box, text="\nVOICE RECOGNITION MODEL (offline)", font=("Consolas", 10, "bold"),
                 fg=ACCENT, bg=PANEL, anchor="w").pack(fill="x")
        for key, label in (("small", "SMALL — fast, 40 MB (recommended first)"),
                           ("large", "LARGE — most accurate, 1.8 GB download"),
                           ("skip",  "Skip — download later / already installed")):
            r = tk.Radiobutton(box, text=label, value=key, variable=self.model_choice,
                               font=("Consolas", 10), fg=FG, bg=PANEL, selectcolor=BG,
                               activebackground=PANEL, activeforeground=ACCENT, anchor="w")
            r.pack(fill="x", pady=2)
        self.button(f, "INSTALL  ▸", self.start_install).pack(pady=22)

    def build_progress(self):
        f = self.frames["progress"]
        self.header(f, "INSTALLING…")
        self.bar = ttk.Progressbar(f, length=520, mode="determinate")
        self.bar.pack(pady=4)
        self.log = tk.Text(f, height=14, width=70, bg=PANEL, fg=FG,
                           font=("Consolas", 9), relief="flat", state="disabled")
        self.log.pack(pady=10)

    def build_done(self):
        f = self.frames["done"]
        self.header(f, "SETUP COMPLETE")
        tk.Label(f, text="SAMURAI is installed and ready.", font=("Consolas", 12),
                 fg=FG, bg=BG).pack(pady=8)
        tk.Label(f, text="The dashboard starts / stops all SAMURAI services\n"
                         "and opens the interface in your browser.",
                 font=("Consolas", 10), fg=DIM, bg=BG).pack(pady=4)
        self.button(f, "LAUNCH DASHBOARD  ▸", self.launch_dashboard).pack(pady=26)

    # ---------- install logic ----------
    def plog(self, line):
        self.log.configure(state="normal")
        self.log.insert("end", line + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def start_install(self):
        self.show("progress")
        threading.Thread(target=self.install, daemon=True).start()

    def install(self):
        ui = lambda fn, *a: self.after(0, fn, *a)
        try:
            steps = (1 if self.want_deps.get() else 0) + \
                    (1 if self.model_choice.get() != "skip" else 0) + \
                    (1 if self.want_shortcut.get() else 0)
            done = 0

            if self.want_deps.get():
                ui(self.plog, "▸ Installing Python packages…")
                for pkg in PIP_PACKAGES:
                    ui(self.plog, f"    pip install {pkg}")
                    r = dash.run_hidden([sys.executable, "-m", "pip", "install", "--quiet", pkg],
                                        capture_output=True, text=True)
                    ui(self.plog, "      ✓ ok" if r.returncode == 0 else f"      ✗ {r.stderr.strip()[-120:]}")
                done += 1
                ui(self.bar.configure, {"value": done / max(steps, 1) * 100})

            choice = self.model_choice.get()
            if choice != "skip":
                name, url, size = MODEL_URLS[choice]
                dest = os.path.join(MODELS_DIR, name)
                if os.path.isdir(dest) and dash.model_valid(name):
                    ui(self.plog, f"▸ Model {name} already present — skipping download.")
                else:
                    os.makedirs(MODELS_DIR, exist_ok=True)
                    ui(self.plog, f"▸ Downloading {name} ({size})…")
                    log_status = lambda s: ui(self.plog, "      " + s)
                    if choice == "small":
                        # resumable, multi-mirror, SSL-tolerant (handles corporate firewalls)
                        ok, msg = dash.ensure_model(log_status)
                        ui(self.plog, "      " + ("✓ " + msg if ok else "✗ " + msg))
                    else:
                        zpath = os.path.join(MODELS_DIR, name + ".zip")
                        ok = dash.download_with_resume(url, zpath, log_status, attempts=30)
                        if ok:
                            ui(self.plog, "▸ Extracting…")
                            with zipfile.ZipFile(zpath) as z:
                                z.extractall(MODELS_DIR)
                            os.remove(zpath)
                            ui(self.plog, "      ✓ model installed")
                        else:
                            ui(self.plog, "      ✗ download failed — the dashboard can retry later")
                done += 1
                ui(self.bar.configure, {"value": done / max(steps, 1) * 100})

            if self.want_shortcut.get():
                ui(self.plog, "▸ Creating desktop shortcut…")
                dash_py = os.path.join(ROOT, "samurai_dashboard.py")
                pyw = sys.executable.replace("python.exe", "pythonw.exe")
                ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut("
                      f"[Environment]::GetFolderPath('Desktop')+'\\SAMURAI.lnk');"
                      f"$s.TargetPath='{pyw}';$s.Arguments='\"{dash_py}\" --autostart';"
                      f"$s.WorkingDirectory='{ROOT}';$s.Save()")
                r = dash.run_hidden(["powershell", "-NoProfile", "-Command", ps],
                                    capture_output=True, text=True)
                ui(self.plog, "      ✓ shortcut created" if r.returncode == 0 else "      ✗ shortcut failed")
                done += 1

            # ---- verification checklist (auto-repairs failed installs once) ----
            ui(self.plog, "\n▸ Verifying installation…")
            all_ok = True
            for mod, pkg in (("vosk", "vosk"), ("websockets", "websockets"),
                             ("psutil", "psutil"), ("edge_tts", "edge-tts")):
                r = dash.run_hidden([sys.executable, "-c", f"import {mod}"],
                                    capture_output=True, text=True)
                if r.returncode != 0:
                    ui(self.plog, f"    … {pkg} missing, retrying install")
                    dash.run_hidden([sys.executable, "-m", "pip", "install", pkg],
                                    capture_output=True, text=True)
                    r = dash.run_hidden([sys.executable, "-c", f"import {mod}"],
                                        capture_output=True, text=True)
                ok = r.returncode == 0
                all_ok &= ok
                ui(self.plog, f"    {'✓' if ok else '✗'} package {pkg}" +
                   ("" if ok else f"  ({(r.stderr or '').strip().splitlines()[-1][:70] if r.stderr else 'import failed'})"))

            has_model = dash.any_valid_model()
            ui(self.plog, f"    {'✓' if has_model else '✗'} voice model in models\\" +
               ("" if has_model else "  (voice input won't work — dashboard can auto-download it)"))

            for rel in ("app\\jarvis-interface.html", "servers\\samurai_speech_server.py",
                        "servers\\samurai_telemetry.py", "servers\\samurai_tts_server.py",
                        "servers\\samurai_action_server.py", "samurai_dashboard.py"):
                ok = os.path.exists(os.path.join(ROOT, rel))
                all_ok &= ok
                ui(self.plog, f"    {'✓' if ok else '✗'} file {rel}")

            ui(self.bar.configure, {"value": 100})
            if all_ok and has_model:
                ui(self.plog, "\n✓ ALL CHECKS PASSED — SETUP COMPLETE")
            else:
                ui(self.plog, "\n⚠ SETUP FINISHED WITH WARNINGS (see ✗ above)")
                ui(self.plog, "  The dashboard's START ALL will try to auto-fix anything broken.")
            self.after(1500, lambda: self.show("done"))
        except Exception as e:
            ui(self.plog, f"\n✗ ERROR: {e}")

    def launch_dashboard(self):
        pyw = sys.executable.replace("python.exe", "pythonw.exe")
        exe = pyw if os.path.exists(pyw) else sys.executable
        subprocess.Popen([exe, os.path.join(ROOT, "samurai_dashboard.py"), "--autostart"],
                         cwd=ROOT, creationflags=dash.NOWIN)
        self.destroy()


if __name__ == "__main__":
    Setup().mainloop()
