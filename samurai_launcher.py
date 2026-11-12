"""SAMURAI launcher — the entry point of the packaged build (SAMURAI.exe / SAMURAI binary).

    SAMURAI                  start the control panel, bring every service up, open the HUD
    SAMURAI --no-browser     same without opening the browser
    SAMURAI --window         same, then open the HUD in its own chromeless app window (pywebview) instead of a browser tab
    SAMURAI --service <key>  run one service in this process (the panel spawns these)
                             keys: ui speech tel tts act agent addons web mock window

From source it works the same:  python samurai_launcher.py
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLE = getattr(sys, "_MEIPASS", HERE)
# overlay: when the forge has prepared and rebuilt the sources next to the exe (data/src), run from there so the rebuild is live
_root = os.environ.get("SAMURAI_ROOT") or (os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else HERE)
OVERLAY = os.path.join(_root, "data", "src")
USE_OVERLAY = getattr(sys, "frozen", False) and os.path.exists(os.path.join(OVERLAY, "servers", "samurai_common.py"))
if os.environ.get("SAMURAI_FORCE_OVERLAY") == "1" and os.path.isdir(os.path.join(OVERLAY, "servers")):
    USE_OVERLAY = True
SERVERS = os.path.join(OVERLAY if USE_OVERLAY else BUNDLE, "servers")
sys.path.insert(0, SERVERS)
sys.path.insert(0, os.path.join(OVERLAY if USE_OVERLAY else BUNDLE, "tests"))


def app_dir():
    """The HUD files: the overlay's app/ when a forge rebuild is in place, else the bundled app/."""
    from samurai_common import APP
    ov = os.path.join(OVERLAY, "app")
    return ov if USE_OVERLAY and os.path.exists(os.path.join(ov, "jarvis-interface.html")) else APP


def run_ui():
    import http.server, functools, mimetypes
    from samurai_common import PORTS, bind_host, maybe_wrap_tls, tls_enabled
    mimetypes.add_type("application/manifest+json", ".webmanifest")    # companion PWA manifest (the dev `python -m http.server` serves it as octet-stream; Chrome still accepts it on http://localhost)
    mimetypes.add_type("application/javascript", ".js")
    from samurai_common import APP

    class Handler(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):                                   # /avatars/<file>: the overlay carries no VRM models (not needed to rebuild), serve the bundled ones
            p = super().translate_path(path)
            if not os.path.exists(p) and path.split("?", 1)[0].startswith("/avatars/"):
                alt = os.path.join(APP, "avatars", os.path.basename(p))
                if os.path.exists(alt):
                    return alt
            return p

        def log_message(self, *a):
            pass
    handler = functools.partial(Handler, directory=app_dir())
    host = "0.0.0.0" if bind_host() != "localhost" else "127.0.0.1"
    print(f"[SAMURAI] UI server on {'https' if tls_enabled() else 'http'}://localhost:{PORTS['ui']}/jarvis-interface.html" + (f"  (overlay {app_dir()})" if USE_OVERLAY else ""))
    maybe_wrap_tls(http.server.ThreadingHTTPServer((host, PORTS["ui"]), handler)).serve_forever()


def run_window():
    import samurai_window
    return samurai_window.main()


def run_service(key):
    if key == "ui":
        return run_ui()
    if key == "window":
        return run_window()
    mod = {"speech": "samurai_speech_server", "tel": "samurai_telemetry", "tts": "samurai_tts_server", "act": "samurai_action_server",
           "agent": "samurai_agent_server", "addons": "samurai_addons", "web": "samurai_browser", "panel": "samurai_panel", "mock": "mock_llm"}.get(key)
    if not mod:
        sys.exit(f"unknown service {key}")
    import runpy
    runpy.run_module(mod, run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    if getattr(sys, "frozen", False) and sys.platform == "win32":
        import multiprocessing
        multiprocessing.freeze_support()
    args = sys.argv[1:]
    if "--service" in args:
        run_service(args[args.index("--service") + 1])
    else:
        if "--autostart" not in args:
            sys.argv.append("--autostart")
        if "--window" in args:
            sys.argv.append("--no-browser")        # the panel brings the services up; the window opens the HUD itself
            import threading, time, urllib.request
            from samurai_common import PORTS

            def open_window():
                for _ in range(90):
                    try:
                        urllib.request.urlopen(f"http://localhost:{PORTS['ui']}/jarvis-interface.html", timeout=2).read(64)
                        break
                    except Exception:
                        time.sleep(2)
                import subprocess
                subprocess.Popen([sys.executable] + ([] if getattr(sys, "frozen", False) else [os.path.abspath(__file__)]) + ["--service", "window"])
            threading.Thread(target=open_window, daemon=True).start()
        run_service("panel")
