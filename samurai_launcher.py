"""SAMURAI launcher — the entry point of the packaged build (SAMURAI.exe / SAMURAI binary).

    SAMURAI                  start the control panel, bring every service up, open the HUD
    SAMURAI --no-browser     same without opening the browser
    SAMURAI --service <key>  run one service in this process (the panel spawns these)
                             keys: ui speech tel tts act agent addons web mock

From source it works the same:  python samurai_launcher.py
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVERS = os.path.join(getattr(sys, "_MEIPASS", HERE), "servers")
sys.path.insert(0, SERVERS)
sys.path.insert(0, os.path.join(getattr(sys, "_MEIPASS", HERE), "tests"))


def run_ui():
    import http.server, functools
    from samurai_common import APP, PORTS, bind_host
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=APP)
    handler.log_message = lambda *a: None
    host = "0.0.0.0" if bind_host() != "localhost" else "127.0.0.1"
    print(f"[SAMURAI] UI server on http://localhost:{PORTS['ui']}/jarvis-interface.html")
    http.server.ThreadingHTTPServer((host, PORTS["ui"]), handler).serve_forever()


def run_service(key):
    if key == "ui":
        return run_ui()
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
        run_service("panel")
