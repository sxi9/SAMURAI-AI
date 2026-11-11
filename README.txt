S A M U R A I  —  Jarvis-style AI assistant
============================================

INSTALL (on any Windows PC)
  1. Install Python 3.8+  (python.org — tick "Add Python to PATH")
  2. Double-click SETUP.bat  — the wizard installs packages + voice model,
     then runs a VERIFICATION CHECKLIST and auto-repairs anything that failed
  3. Double-click START.bat  (or the desktop SAMURAI shortcut)
     — one click starts every service and opens the interface

VOICE MODEL
  The small offline voice model (40 MB) is BUNDLED in models\ — voice works
  out of the box, no download needed. To use the more accurate large model
  (1.8 GB), pick it in SETUP.bat; it downloads with resume + retry + mirrors.

SELF-HEALING
  On START ALL the dashboard first guarantees the SPEECH stack is usable
  BEFORE opening the interface: it checks the vosk package + voice model,
  installs/downloads whatever is missing, starts the speech server, and
  waits until it is actually listening. Then it starts the rest and opens
  the UI. If a service fails it reads its log (logs\ folder) and fixes it:
    - missing python package  -> installs it and restarts the service
    - missing voice model     -> downloads it (resumable, tries 2 mirrors)
    - missing VC++ runtime    -> opens the Microsoft installer for you
    - port already in use     -> tells you which port is blocked
  Status per service shows live health + response time in the dashboard.

  If your network blocks the model download, copy the folder
  "vosk-model-small-en-us-0.15" into models\ manually from any machine.

SCREENSHOTS
  docs\screenshot-labeled.png    the interface with every area numbered and explained
  docs\screenshot-settings.png  the settings drawer
  (README.md shows them on the GitHub page)

WHAT'S INSIDE
  SETUP.bat              one-click installer entry point
  samurai_setup.py       setup wizard window
  samurai_dashboard.py   service control dashboard (desktop shortcut: SAMURAI.lnk)
  app\jarvis-interface.html      the SAMURAI interface
  servers\samurai_speech_server.py   offline voice recognition (Vosk)   :9100
  servers\samurai_telemetry.py       live system stats                  :8765
  servers\samurai_tts_server.py      human-like neural voice            :9200
  servers\samurai_action_server.py   PC control (open apps/music/web)   :9300
  servers\samurai_agent_server.py    headless Claude Code / Gemini CLI   :9400
  workspace\             files the headless agent creates or edits
  models\                voice models are downloaded here by setup
  docs\                  screenshots

USING SAMURAI
  Dashboard -> START ALL -> OPEN SAMURAI (http://localhost:8080/jarvis-interface.html)
  Click the mic, say "Samurai ..." followed by your command.
  Settings drawer: LLM provider (Ollama / OpenAI / Claude / Gemini + API key),
  voice model, neural voice, mood + humor level, system access & control.

HEADLESS AGENTS (NO API KEY)
  SAMURAI can use the official Claude Code or Gemini CLI as its brain, as a
  live web researcher, and as a worker that edits files — signed in with
  your normal Claude plan / Google account instead of an API key.
    1. npm install -g @anthropic-ai/claude-code     (and/or)  npm install -g @google/gemini-cli
    2. run  claude   (or  gemini )  once in a terminal and sign in
    3. START ALL in the dashboard (the AGENT service runs on port 9400)
    4. Settings -> NEURAL CORE -> "CLAUDE CODE — HEADLESS" or "GEMINI CLI — HEADLESS"
  Ask "search the latest ..." and the agent searches the web for you.
  Ask "write a script that ..." and it works inside the workspace\ folder.
  Any other brain (Ollama, OpenAI, ...) can also hand off a question or a
  task to the headless agent with the research / task directives.
  Shell access for work tasks is off by default; set SAMURAI_AGENT_ALLOW_BASH=1
  to allow it. Note: free-tier Google accounts moved to Antigravity CLI in
  June 2026 — set SAMURAI_GEMINI_CMD to that command if `gemini` is gone.

NOTES
  - Everything runs locally. Cloud LLMs are optional (add API key in settings).
  - The large voice model (1.8 GB) is more accurate; the small one is faster.
  - Closing the dashboard leaves services running; use STOP ALL to stop them.
