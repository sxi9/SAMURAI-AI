# SAMURAI — feature list

Jarvis-style assistant for your own PC. Offline voice, any AI brain, full PC control, a cinematic HUD, and a control panel that keeps it all running. Windows build: `SAMURAI-windows-x64.zip` below. Unzip, run `SAMURAI.exe`, the HUD opens.

## Talk to it
- Premium voices: ElevenLabs, OpenAI (nova, shimmer, coral), Cartesia and Azure HD (Ava, Emma) with keys set in the control panel; Edge voices led by Ava and Emma multilingual; Kokoro fully offline
- Whisper option for recognition (faster-whisper, offline, one-click install from the panel) next to Vosk
- Phone companion mode: scan the QR code in the panel, the phone recognises with Google or Siri, the PC runs the command, the reply is spoken on the phone, the PC or both; https on the LAN with a one-click certificate
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
- 3D core (WebGL, Three.js): a nebula shader background that stirs when it listens and turns red on alert, up to 24,000 particles morphing through every shape, a volumetric glass orb that lip-syncs to the voice, bloom; quality auto / low / medium / high, falls back to the 2D canvas; "3d on" / "3d off"
- Effects layer: energy arcs from the orb to the widget it is driving, hologram materialise when a card appears, rain or snow from the live forecast, lightning in storms, alert tears and glitch, a CPU heartbeat line, day-cycle tint, the orb chasing the mouse, eyes that glance at what they act on
- Looks: "cinema look" (letterbox, grain, warm vignette) and "retro look" (CRT scanlines and fringing)
- Holographic globe in the position widget (wireframe Earth, your marker, a satellite)
- Memory constellation: every fact, journal entry, task and recent conversation as a star, linked by shared words, searchable ("show my memory about dentist"), click a star to hear it
- Big-text mode ("big text") and keyboard-reachable controls with screen-reader labels
- Orb avatar with eyes and a waveform ring for idle, listening, thinking, speaking and alert
- Free roaming when idle: the avatar picks a spot anywhere on the screen, glides there, banks into turns and glances ahead; "stay still" / "roam" by voice
- Music reaction: while the library player runs, a real audio analyser drives the beat; the orb bounces, the ring pumps, the eyes squint on the kick (external players get a steady pulse)
- Particle core that morphs: sphere, galaxy, heart, knot, helix, cube, ring, wave, any spelled word; idle cycle
- Fourteen widgets: System, Agenda, Tasks, Inbox, Terminal, Timers, Weather, Music, Home, Position, Camera feed, Holo gallery, Video, Browser
- Video in the HUD: "play video <name>" from your library folder, "watch <anything> on youtube" (no API key), direct mp4 / HLS streams, cinema mode that dims the HUD, picture-in-picture
- Browser in the HUD: the agent's real Chromium streamed live into a widget; click, scroll and type on it, or let the brain drive it ("browse wikipedia.org", "browse for …")
- Radio and podcasts in the Music widget ("play radio", "play jazz radio", "play the latest podcast"), with your own station list and RSS feeds
- Orbital ring of twelve nodes: click to summon, unpin to dock
- Focus layout (six widgets, calmer default), full layout (twelve), ambient (core only)
- Boot sequence with assembling widgets, welcome flash, security alert card
- Seventeen colour themes (arc, ember, gold, matrix, ice, crimson, rose, nebula, aurora, ocean, sunset, solar, mono, stealth, lime, royal, high-contrast) plus a custom theme from two colour pickers; by voice: "theme ocean", "blue theme", "random theme" (see docs/screenshot-themes.png)
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
- SCREEN panel: a live view of your desktop inside the HUD (any monitor), READ (OCR with tesseract, spoken), DESCRIBE (vision brain), SHOT; "show my screen", "read my screen", "what is on my screen"
- Find my phone: "ring my phone" makes the phone with the companion page open ring, flash and vibrate, pushes an alarm through ntfy, and presses Play Sound on Google Find My Device through the agent's browser (sign in once in the browser window); "find my phone" shows the Google map live in the HUD under a TRACKING overlay
- Presence: the camera notices when you arrive after being away and greets you; optional lock when you leave
- Vision: "what is on my screen", "look at my screen and tell me the error", "what do you see" (webcam)
- Browser agent: a real Chromium the brain drives: open, read, links, click, type, find, back, screenshot
- Desktop agent: screenshot, vision brain, one click or keystroke at a time, with a cancel toast
- Document search over a folder of text, Markdown, PDF, Word and code files, fed to the brain
- Send email over SMTP with confirmation

## Runs itself
- Forge: "forge: add a widget that shows my pomodoro streak" makes SAMURAI rebuild its own code with Claude Code headless (source install), shows the summary, and installs it on "apply the forge" (syntax check, commit on a forge branch, restart); "discard the forge" drops it
- Custom widgets by voice: "create a widget that shows my task count" — the brain designs a sandboxed widget, it is stored and mounted in the ring with live data; "delete widget …"
- Chromeless app window: `SAMURAI.exe --window` or the panel's OPEN AS APP WINDOW opens the HUD in its own frameless window (pywebview) with drag bar, pin on top, minimize, fullscreen and a Ctrl+Alt+S hotkey; the browser option stays
- Illustrated step-by-step install guide: docs/INSTALL.md
- Auto-tune: the control panel reads your CPU, RAM, GPUs, battery, cameras, network adapters, disk and installed tools, then sets the 3D quality, Whisper model, Kokoro advice, startup profile, half-duplex mic, presence camera and phone address for that machine; runs by itself on first start
- Browser GPU check: the HUD reports which GPU the browser really uses; on a two-GPU laptop it warns when the browser sits on the integrated one
- Governor: on battery or above 85 °C the 3D core drops to low; above 90 % memory it switches to the 2D core and effects off; everything comes back after a quiet minute
- Essentials startup profile for small machines: the browser agent and the headless agents start on demand when a command needs them
- Disk-space guard before every model download; doctor shows free disk, memory, GPU, browser GPU and tune status
- Sign in to Claude (your claude.ai subscription through Claude Code) and Gemini from the control panel; session status shown
- Connections: push to your phone (ntfy, Pushover), Telegram bridge (chat with SAMURAI from your phone), Discord and Slack webhooks, wake-on-LAN and SSH to your other machines, Wi-Fi / Bluetooth / VPN on and off
- Journal by voice ("note: …", "read my journal"), focus sessions with a spoken break, file search across your drives, read any text, PDF or Word file aloud, Steam game launcher, disk cleanup that reports first and asks before deleting
- Backup and restore of config, memory and routines; update check against GitHub releases; one-click log bundle
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
