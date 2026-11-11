S A M U R A I  —  Jarvis-style local AI assistant
==================================================

INSTALL
  Windows   install Python 3.9+ (python.org, tick "Add Python to PATH"), double-click SETUP.bat
  Linux/mac ./install.sh
  The installer creates .venv, installs requirements, downloads the offline voice model (40 MB),
  writes config.json, offers the headless agent CLIs, a shortcut and start-with-boot, runs a
  health check and starts everything.

RUN
  START.bat  (Windows)  ·  ./install.sh --start  (Linux/mac)  ·  or open http://localhost:9000
  The control panel starts every service, repairs what fails, and opens the HUD:
  http://localhost:8080/jarvis-interface.html

CONTROL PANEL  http://localhost:9000
  start / stop / restart each service · logs · watchdog (restarts crashed services, installs
  missing packages, downloads the voice model) · DOCTOR with auto-fix · START WITH BOOT switch
  (Windows Startup folder, Linux systemd --user, macOS launchd) · config editor for your name,
  location and widget sources · one-click installs for the local Kokoro voice and the wake word.

SERVICES (all on localhost, each answers only the SAMURAI pages)
  :8080  app/jarvis-interface.html         the HUD
  :9000  servers/samurai_panel.py          control panel + supervisor
  :8765  servers/samurai_telemetry.py      system stats
  :9100  servers/samurai_speech_server.py  offline speech recognition (Vosk) + VAD + wake word
  :9200  servers/samurai_tts_server.py     neural voice (Edge online / Kokoro local)
  :9300  servers/samurai_action_server.py  PC control (Windows, Linux, macOS)
  :9400  servers/samurai_agent_server.py   headless Claude Code / Gemini CLI
  :9500  servers/samurai_addons.py         widget data, config, memory, security watch

BRAINS (CFG -> NEURAL CORE)
  local: Ollama, LM Studio, llama.cpp, any OpenAI-compatible server
  no key: Claude Code / Gemini CLI headless (npm i -g @anthropic-ai/claude-code, claude auth login)
  keys: OpenAI, Claude, Gemini (free tier), OpenRouter, Groq (free), Mistral, DeepSeek, xAI,
        Perplexity, Together, Hugging Face, Azure OpenAI
  pool: several providers with failover or round-robin · "ask all: question" compares them
  memory: "remember that …", "forget …", recent turns stored locally and fed to every prompt
  streaming replies spoken sentence by sentence · speak to interrupt

VOICE
  Click MIC and talk, or turn on the wake word and say "samurai …".
  Settings: neural voice, speed, mic model (small/large), mic gain, barge-in.
  Troubleshooting: control panel -> MIC / SPEAKER TEST, or DOCTOR.

PC CONTROL (SYSTEM CONTROL switch in settings)
  open apps / URLs / files, web search, play music, volume, mute, media keys, brightness,
  screenshot, clipboard, type text, hotkeys, lock screen. Sleep, shutdown, restart, kill
  process and run command always ask for confirmation. Add your own apps and commands under
  "actions" in config.json.

WIDGET SOURCES (control panel -> CONFIG, or config.json)
  weather/position: latitude + longitude · agenda: path to an .ics file · inbox: IMAP host,
  user, app password · home: Home Assistant URL + token · music: a folder · camera: a URL ·
  gallery: drop photos into gallery/ · tasks: automatic (data/tasks.json)

TESTS
  .venv/bin/python tests/smoke_sidecars.py     every route + origin lock
  .venv/bin/python tests/voice_e2e.py          TTS -> Vosk -> transcript
  python tests/mock_llm.py                     fake AI provider for trying the HUD offline

NOTES
  - Everything runs locally. Cloud AIs are optional.
  - config.json holds your settings and secrets and is never committed.
  - The previous interface is app/legacy-interface.html; the tkinter dashboard
    (samurai_dashboard.py) still works on Windows but the browser control panel replaces it.
