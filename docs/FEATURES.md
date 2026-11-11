# SAMURAI v1.0.0 — feature list

Jarvis-style assistant for your own PC. Offline voice, any AI brain, full PC control, a cinematic HUD, and a control panel that keeps it all running. Windows build: `SAMURAI-windows-x64.zip` below. Unzip, run `SAMURAI.exe`, the HUD opens.

## Talk to it
- Offline speech recognition (Vosk) with a voice-activity gate; small model downloaded automatically, large model optional
- Wake word "samurai" that tolerates mishearings, optional openWakeWord engine for hands-free use
- Neural voice replies (Microsoft Edge voices online, Kokoro fully local as a one-click install)
- Streaming replies: text types in as it arrives and is spoken sentence by sentence; speak to interrupt (barge-in)
- Six personalities (professional, balanced, witty, deadpan, sarcastic, hype) and a humor level
- Mic and speaker self-test page

## Brains (choose any, mix several)
- Local: Ollama, LM Studio, llama.cpp, any OpenAI-compatible server
- No API key: Claude Code and Gemini CLI run headless with your own subscription
- API keys: OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI Grok, Perplexity, Together, Hugging Face, Azure OpenAI
- Provider pool with failover or round-robin; "ask all: question" compares every configured brain
- Task routing: separate brains for chat, work, research and vision
- Live model lists where the API offers them; free-tier providers marked
- JSON reply contract so every brain can drive the widgets and the PC
- Memory: "remember that …", "forget …", conversation history, and automatic recall of related past conversations
- Mock provider for trying everything with no account

## The HUD
- Orb avatar with eyes and a waveform ring for idle, listening, thinking, speaking and alert
- Particle core that morphs: sphere, galaxy, heart, knot, helix, cube, ring, wave, any spelled word; idle cycle
- Twelve widgets: System, Agenda, Tasks, Inbox, Terminal, Timers, Weather, Music, Home, Position, Camera feed, Holo gallery
- Orbital ring of twelve nodes: click to summon, unpin to dock
- Focus layout (six widgets, calmer default), full layout (twelve), ambient (core only)
- Boot sequence with assembling widgets, welcome flash, security alert card
- Five colour themes: arc, ember, gold, matrix, ice
- Live ticker (markets, headlines), clock, parallax, reduced-motion support
- Cockpit mode on big screens, flow layout on laptops, tablets and phones
- Settings drawer: brains, pool, routing, voice, mic, personality, pinned add-ons, layout, theme, your name and location

## Widgets with real data
- System: CPU, memory, GPU, network sparkline, connections, temperature, disks, battery, system log
- Weather and four-day forecast (Open-Meteo, no key)
- Agenda from an .ics calendar file
- Tasks: persistent, voice-added, click to toggle
- Inbox over IMAP
- Timers: "timer 5 min", spoken when done
- Smart home through Home Assistant: lights, AC, lock, blinds, plug, fan
- Music: your library folder, YouTube via actions, system media keys
- Position radar with nearby places
- Camera feed from any MJPEG, MP4 or HLS URL
- Gallery from a photos folder
- Security watch: failed logins raise an alert; block the address at the firewall

## PC control (Windows, Linux, macOS)
- Open apps, URLs, files and folders; web search; play music
- Volume up, down, set, mute; media play, pause, next, previous; brightness
- Screenshot, webcam frame, clipboard read and write, type text, hotkeys, lock screen
- Mouse click, move, double-click, right-click, scroll
- Sleep, shutdown, restart, kill process, allow-listed commands: always ask for confirmation
- Audit log of every action; "what did you do today"; deny and no-confirm lists
- Plugins: drop a Python file into `plugins/` to add tools the brain can call

## Automation
- Scheduler in plain language: "every day at 8 am say good morning", "every weekday at 9 run morning briefing", "every 30 minutes check my system", "remind me at 5 pm to call mom", "in twenty minutes remind me to stretch"
- Routines: focus mode, good night, good morning, editable lists of commands
- Morning briefing: weather, agenda, tasks, inbox, system
- Proactive alerts: CPU temperature, disk full, battery low, memory full, meeting in five minutes
- Proactive check-ins: every 30 minutes the brain looks at the live data and speaks only if something matters
- Plan mode: "plan: get me ready for deep work" turns a goal into steps and runs them

## Sight and hands
- Vision: "what is on my screen", "look at my screen and tell me the error", "what do you see" (webcam)
- Browser agent: a real Chromium the brain drives: open, read, links, click, type, find, back, screenshot
- Desktop agent: screenshot, vision brain, one click or keystroke at a time, with a cancel toast
- Document search over a folder of text, Markdown, PDF, Word and code files, fed to the brain
- Send email over SMTP with confirmation

## Runs itself
- One installer for Windows, Linux and macOS, or the packaged executable with no Python at all
- Browser control panel: start, stop, restart each service; logs; watchdog that restarts crashed services and repairs missing packages or models; doctor with 24 checks and auto-fix
- Start with boot: Windows Startup folder, Linux systemd user service, macOS launchd
- Phone / LAN mode with a token-protected link for other devices on your Wi-Fi
- Config editor for your name, location and every widget source; secrets in the OS keychain when available
- System tray app; GitHub Actions run the tests and build the executables

## Security
- Every service listens on localhost only unless LAN mode is on, and answers only the SAMURAI pages' origin
- Verified TLS, checksum and path checks on downloads
- Confirmation for every destructive action; audit trail

## Tests and docs
- Sidecar smoke test, voice end-to-end test, browser tests, mock provider
- Labeled screenshots, a captioned walkthrough video, and a three-minute voice walkthrough with real microphone input
