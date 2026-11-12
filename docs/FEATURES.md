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

## New in 1.6 — brains, voice, senses, platform

Clip: [docs/whatsnew-1.6.mp4](https://github.com/sxi9/SAMURAI-AI/blob/claude/upbeat-heisenberg-0eu8oj/docs/whatsnew-1.6.mp4) (three minutes, spoken commands recognised offline).

- Streaming replies from headless Claude Code; Claude Code can use SAMURAI as tools (MCP): actions, browser, documents, journal, calendar, memory. Panel: GIVE CLAUDE CODE SAMURAI'S TOOLS
- Cost meter per provider with a monthly budget: "what did I spend", "set my budget to 20 dollars"; spoken warning at 80 %
- Missions: "start a mission: research X and write a report" runs Claude Code for hours in workspace/ with a scratchpad and tells you when it is done; "missions", "stop the mission"
- Local vision: "what is on my screen" works offline with llava or moondream on Ollama
- Voice: local voice servers (Kokoro-FastAPI, Orpheus, XTTS, Chatterbox, Fish, F5) as the "local" engine; styles ("speak calm", "whisper", "excited", or follow the mood); live two-way voice over OpenAI Realtime ("full duplex on"); your own wake phrase ("change the wake word to hey sam"); voice identity ("enrol my voice as Sam", "only obey enrolled voices on"); meeting mode ("meeting mode on" transcribes, "off" gives a summary with action items and files it in the journal)
- Senses: quiet during calls, games and full screen, and a "while you were busy" catch-up after; notifications read aloud ("read my notifications", "read notifications aloud on"); face recognition ("remember my face as Sam", "who am I"); hand gestures with the camera ("gestures on": open palm pauses, fist mutes, thumbs up confirms, point to talk, swipe to skip)
- Platform: "download <link>", "my downloads", torrents through qBittorrent; "watch the price of <link>" with a spoken alert on a drop; Hue, Govee and Kasa lights direct ("list my devices", "turn on the desk lamp", "scene movie"); "sync my settings to <folder>"; rooms ("this is the kitchen", "hand off to the office"); plugin store ("plugin store", "install plugin countdown"); lyrics and album art in the music widget ("lyrics")

## The HUD
- 3D core (WebGL, Three.js): a nebula shader background that stirs when it listens and turns red on alert, up to 24,000 particles morphing through every shape, a volumetric glass orb that lip-syncs to the voice, bloom; quality auto / low / medium / high, falls back to the 2D canvas; "3d on" / "3d off"
- Effects layer: energy arcs from the orb to the widget it is driving, hologram materialise when a card appears, rain or snow from the live forecast, lightning in storms, alert tears and glitch, a CPU heartbeat line, day-cycle tint, the orb chasing the mouse, eyes that glance at what they act on
- Looks: "cinema look" (letterbox, grain, warm vignette) and "retro look" (CRT scanlines and fringing)
- Holographic globe in the position widget (wireframe Earth, your marker, a satellite)
- Layouts: focus, full, ambient, holographic desk (pinned widgets on a curved 3D wall you drag to rotate) and wall mode (big clock, orb alone, photos drifting behind) for a TV or projector
- Robot face avatar (pinu-bot, MIT): a glowing display-panel head over the orb's spot with eyes, brows and a mouth that emote (happy, sad, angry, surprised, excited, confused, love, thinking), blink, follow the mouse and glance at the widget being opened, and lip-sync to the voice; works with the 2D and the 3D core, follows the colour theme, three looks ("face style soft / band / visor"); "show your face" / "robot face" / "orb mode"
- VRM avatar (three-vrm, MIT): an anime-style 3D character inside the WebGL scene, head and shoulders where the orb was, cyan rim light, nebula and particles behind; facial expressions, visemes (aa / ih / ou / ee / oh) driven by the reply audio, blinks, eye tracking toward the mouse; the bundled pixiv sample or any VRM 0.x / 1.0 file dropped into app/avatars (in the packaged build: SAMURAI/_internal/app/avatars, or data/src/app/avatars once the forge has prepared the sources; both are listed) ("avatar mode", "use the avatar <name>", VRM FILE in the settings drawer); the bust is framed head and shoulders over the orb's spot and fades out above the state label; while a face is on, the idle wander stays close to the centre and upright
- Emotions from the brain: the reply contract carries an optional "emotion" the face makes while it speaks (keyword fallback when the brain gives none), decays to the personality's resting face ~6 s after speech ends; "look happy / sad / angry / surprised / excited / confused"
- Skins and fonts: glass, wireframe, paper; Michroma, system, monospace or serif; depth blur behind cards
- Icon morphs: the particles form a cloud, a pulse line, a house, a pin, a clock, a note or an envelope for a moment before that widget opens
- Pop-out: "pop out the weather" floats any widget in its own small always-on-top window (Document Picture-in-Picture)
- Mic kill switch with a privacy light: the mic pill glows amber when open and red when it hears you; "mute the mic" stops the stream, blocks restarts and mutes the system microphone
- "Open claude" / "open chatgpt" / "open gemini" shows the real site in the agent's browser window for manual chat (no automation of those sites)
- Memory constellation: every fact, journal entry, task and recent conversation as a star, linked by shared words, searchable ("show my memory about dentist"), click a star to hear it
- Big-text mode ("big text") and keyboard-reachable controls with screen-reader labels
- Orb avatar with eyes and a waveform ring for idle, listening, thinking, speaking and alert
- Free roaming when idle: the avatar picks a spot anywhere on the screen, glides there, banks into turns and glances ahead; "stay still" / "roam" by voice
- Music reaction: while the library player runs, a real audio analyser drives the beat; the orb bounces, the ring pumps, the eyes squint on the kick (external players get a steady pulse)
- Particle core that morphs: sphere, galaxy, heart, knot, helix, cube, ring, wave, any spelled word; idle cycle
- Fourteen widgets: System, Agenda, Tasks, Inbox, Terminal, Timers, Weather, Music, Home, Position, Camera feed, Holo gallery, Video, Browser
- Video in the HUD: "play video <name>" from your library folder, "watch <anything> on youtube" (no API key), direct mp4 / HLS streams, cinema mode that dims the HUD, picture-in-picture
- Browser in the HUD: the agent's real Chromium streamed live into a widget; click, scroll and type on it, or let the brain drive it ("browse wikipedia.org", "browse for …")
- Spotify: link your account once (PKCE, your own client id), then "play daft punk on spotify", "pause spotify", "spotify volume 30", "shuffle on", "play on the kitchen speaker"; the Music widget shows the track, art, progress and device
- Map panel: the POSITION widget opens as a real map (Leaflet, OpenStreetMap tiles, dark look) with you, your phone's last Google position and any place you ask for: "where is the airport", "show the map"
- Calendar writes: "add dentist to my calendar tomorrow at 3pm for 45 minutes", "schedule standup friday 15:30", "what's next on my calendar"; writes to your ICS file or a CalDAV calendar (Nextcloud, Fastmail, iCloud app password)
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
- Windows installer: SAMURAI-setup-<version>.exe (per-user, Start Menu, optional desktop shortcut and start with Windows, uninstaller that can keep your data)
- Self-installing update: UPDATE + INSTALL in the panel downloads the latest release, stages it, swaps the files on restart (keeps config and data); source installs pull with git
- Companion page installs to the phone's home screen as an app (manifest + service worker)
- Forge from the packaged build: PREPARE SOURCES copies the bundled source to data/src with git; applied forges run from that overlay on the next start
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
