# SAMURAI build checklist

Living plan for the HUD v3 rebuild and the platform upgrade. Updated at the end of every stage.
Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified · `[-]` dropped

## Stage 1 — Backend fixes, config, widgets sidecar

- [x] Headless agent sidecar (Claude Code / Gemini CLI) on :9400 with chat / search / work modes
- [x] Speech server: fix undefined name in error path, validate model folder before loading
- [x] Interface: Claude reply parsing (pick the text block), refusal handling
- [x] All sidecars: allow only the SAMURAI page origin (no wildcard CORS)
- [x] Model download: keep TLS verification, verify checksum, reject unsafe zip paths
- [x] UI server bound to 127.0.0.1
- [x] `config.json` for name, location, keys and widget sources (no personal data in code)
- [x] `servers/samurai_addons.py` on :9500 — weather, ticker, tasks, gallery, position, security, agenda, inbox, music, home
- [x] Setup: venv, pinned requirements, fresh setuptools (fixes vosk on Python 3.13)

## Stage 2 — HUD v3 page (design handoff, pixel-for-pixel at 1920×1080)

- [x] Stage scaling (cockpit ≥ 0.75, flow layout below), bundled fonts, reduced-motion
- [x] Header, ticker, corner brackets, background grid, scanlines, vignette, parallax
- [x] Core: particle field with morphing shapes, waveform ring, ellipses, DOM rings
- [x] Orb + eyes with the six states (boot, idle, listening, thinking, speaking, alert)
- [x] 12 widget cards, orbital ring nodes, focus fly-in, docking, ambient layout
- [x] Boot overlay + assemble animation, alert card, settings drawer
- [x] Response console, input bar, keyboard shortcuts, `?demo` state strip
- [x] Carry over: Vosk mic, neural TTS + browser fallback, 4 API providers, headless agents, telemetry injection, moods
- [x] LLM JSON contract `{reply, focus_widget, actions[]}` with keyword fallback
- [x] Old page kept as `app/legacy-interface.html`

## Stage 3 — Platform: installer, control panel, autostart

- [x] One installer for Windows, Linux and macOS (`install.py` + `SETUP.bat` / `install.sh` wrappers): venv, deps, voice model, optional Node + Claude Code / Gemini CLI, shortcuts
- [x] Browser control panel served by a supervisor sidecar (replaces the tkinter dashboard on all OSes): service health, logs, restart, auto-fix, settings editor, autostart toggle
- [x] Start with boot: Windows Startup folder, Linux systemd user service (XDG fallback), macOS launchd
- [x] Automatic troubleshooting: health watchdog, auto-restart, log diagnosis, "doctor" command, mic/speaker self-test
- [x] Full PC control actions (gated by the SYSTEM CONTROL switch, confirmation for destructive ones): volume, mute, media keys, brightness, lock, sleep, shutdown, restart, screenshot, clipboard, open file/folder, type text, hotkeys, kill process, run allow-listed command
- [x] Media: local music folder playback in the MUSIC widget, system media keys, YouTube/Spotify via actions

## Stage 4 — Brains (as many AIs as possible) and memory

- [x] Providers: Ollama, LM Studio, llama.cpp, OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI Grok, Perplexity, Together, Hugging Face, Azure OpenAI, plus headless Claude Code and Gemini CLI
- [x] Generic "OpenAI-compatible" provider: any endpoint works with just a base URL, key and model name
- [x] Per-provider model lists fetched live where the API offers them; free-tier providers marked
- [x] Multi-AI modes: ask one, ask several at once and compare, or route by task (fast model for chat, strong model for work, search-capable model for research)
- [x] Provider pool with round-robin and failover (order configurable; multiple keys per provider rotated; rate-limit aware)
- [x] Local context: conversation history and "remember …" facts saved to SQLite, recalled into every prompt, "forget" command
- [x] Streaming replies with sentence-level speech (Ollama, OpenAI-compatible, Claude, Gemini)

## Stage 5 — Audio and speech hardening

- [x] Wake word model (openWakeWord, optional, one-click install from the panel) + text wake word fallback
- [x] Voice activity detection (webrtcvad, server side) and barge-in (interrupt SAMURAI by speaking)
- [x] Local TTS option (Kokoro, one-click install from the panel) so voice works offline; edge-tts stays as the online voice
- [x] Mic/speaker self-test page linked from the control panel
- [x] End-to-end voice test (tests/voice_e2e.py) + sidecar smoke test + mock LLM for offline testing

## Stage 6 — Verification and docs

- [x] Playwright checks: 1920×1080 vs design reference, 1366×768 and phone flow mode, typed command, simulated voice command, headless search, streaming via mock provider
- [x] Labeled screenshots regenerated (`docs/screenshot-labeled.png`, settings, alert, phone, control panel)
- [x] README.md / README.txt rewritten for HUD v3; this checklist kept current

## Verified so far

- [x] Voice pipeline end to end (TTS clip transcribed exactly by the Vosk server)
- [x] Dashboard downloader fetches and extracts the small model
- [x] Headless Claude Code: chat with memory, live web search, file task in `workspace/`
- [x] Interface boots with live telemetry; headless provider routes search queries

## Stage 7 — Automation and knowledge

- [x] Scheduler: "every day at 8 say …", "every 30 minutes …", "remind me at 5 pm to …" (add-ons, persisted)
- [x] Routines: named command lists ("focus mode", "good night"), editable
- [x] Briefings: "morning briefing" narrates weather, agenda, tasks, inbox, system
- [x] Proactive alerts: CPU temperature, disk full, battery low, meeting in 5 minutes, spoken unprompted
- [x] Audit log of every action + "what did you do today"; per-action allow/deny lists
- [x] Plugin system: drop a Python file into plugins/ to add tools the brain can call
- [x] Task routing: separate providers for chat, work and research
- [x] Document search over a folder (txt, md, pdf, code), results fed to the brain
- [x] Colour themes

## Stage 8 — Sight and hands

- [x] Vision: "what is on my screen" / "what do you see" through vision-capable providers
- [x] Browser agent sidecar (Playwright): open, read, click, type, find, screenshot; chained by the brain
- [x] Desktop agent loop: screenshot → vision model → click / type / key, step by step with a cancel toast (code complete; needs a real desktop to verify)
- [x] Mouse control actions (click, move, scroll) on Windows, Linux, macOS (needs a desktop to verify)
- [x] Send email (SMTP) with confirmation (code complete; needs a mail account to verify)
- [x] Secrets in the OS keychain when the keyring package is present
- [x] System tray app (pystray, untested here), CI workflow running the tests

## Stage 9 — Walkthrough

- [x] Recorded walkthrough video (docs/walkthrough.mp4, 2 min) + README gif (34 s) + voice walkthrough with sound (docs/walkthrough-voice.mp4, 2 min 43 s)
- [x] docs/WALKTHROUGH.md with 14 captioned step screenshots

## Stage 10 — Toward Jarvis

- [x] Focus layout (six widgets) as the calmer default; full and ambient remain; shape readout only while it changes; softer grid and borders
- [x] Plan mode: goal → ordered steps → executed in sequence
- [x] Proactive check-ins every 30 minutes (brain decides whether to speak)
- [x] Memory recall of related earlier conversations into every prompt
- [x] Forgiving wake word (edit-distance match on the first words)
- [x] Phone / LAN mode with a token (switch in the control panel, phone link)
- [x] Packaged build: PyInstaller spec + launcher, verified on Linux (8 services from one executable); Windows SAMURAI.exe built by the build-exe workflow
- [x] Walkthrough v2 with real microphone input and spoken replies
- [x] Idle orb wander on every axis with glancing eyes; particle showcase mode so commanded shapes read clearly
- [x] Free roaming across the whole stage (waypoints, banking, gaze), "stay still" / "roam" commands
- [x] Music reaction: AnalyserNode beat level from the library player bounces the orb, pumps the ring; steady pulse for external players
- [x] Sixteen colour themes + custom two-colour theme, swatch picker, theme voice commands
- [x] 1080p walkthrough v5 with roaming, music bounce, themes and shapes (docs/walkthrough-motion.mp4); narration, user voice and replies never overlap (scheduled into silent gaps)
- [ ] Trained "samurai" wake-word model (needs recorded samples), voice identity, full-duplex speech-to-speech, camera presence — still open

## Stage 11 — Everything on the roadmap that fits (v1.2.0)

- [x] 3D core: Three.js nebula, 24k particle field, volumetric lip-syncing orb, bloom, quality auto-detect, 2D fallback, holo globe
- [x] Effects layer: energy arcs, hologram materialise, weather particles and lightning, alert tears and glitch, CPU heartbeat, day cycle, mouse chase, expressive eyes; cinema and retro looks
- [x] Video widget: local library (range requests), YouTube search without a key, direct streams, cinema mode, PiP
- [x] Browser widget: the Playwright browser streamed live as JPEG frames, click / scroll / type, driven by voice or the brain
- [x] Radio and podcasts in the Music widget
- [x] Premium TTS engines (ElevenLabs, OpenAI, Cartesia, Azure) + curated natural voices; Whisper STT option with a panel installer
- [x] Claude and Gemini sign-in from the control panel with session status
- [x] Phone companion mode: https with a generated certificate, QR pairing, relay queue, phone-side recognition and speech, PC-side execution (relay verified with two browser pages)
- [x] Connections sidecar: ntfy / Pushover push, wake-on-LAN, SSH run (confirmed), Wi-Fi / Bluetooth / VPN, file search index, journal, radio stations, podcasts, read-aloud, Telegram bridge, Discord / Slack webhooks, Steam launcher, disk cleanup (confirmed), focus sessions
- [x] Presence through the camera (motion), greeting after an absence
- [x] Backup / restore, update check, log bundle, VERSION file, high-contrast theme
- [x] Walkthrough v6 at 1080p covering the 3D core, video, browser, music, looks, alert, journal, focus, cleanup and the phone relay (docs/walkthrough-ultimate.mp4)
- [ ] Not built yet: gestures (MediaPipe), screen OCR, Google Calendar / Gmail write, Spotify Web API, map tiles, Live2D / VRM head, holographic desk, memory constellations, Android app, installer exe, multi-room, plugin marketplace

## Stage 12 — Auto-tune (v1.3.0)

- [x] Hardware profile: CPU, RAM, GPUs (integrated / discrete / virtual), battery, disk, cameras (virtual ones flagged), network adapters (physical first), tools
- [x] Recommendation + apply: 3D quality, Whisper model, Kokoro advice, local-LLM size, brain, startup profile, half-duplex, presence camera, LAN address; applied automatically on first start
- [x] HUD takes tune defaults where the user has not chosen; reports the browser's real GPU and fps; two-GPU and software-rendering warnings
- [x] Governor: battery / heat / memory → lower 3D, 2D fallback, restore after a quiet minute (verified in the browser)
- [x] Essentials profile with on-demand start of the browser agent and headless agents (verified: browser came up in 3 s from a command)
- [x] Disk guard on downloads, physical-first phone links, doctor checks, panel auto-tune card, tests/tune_test.py (19 checks)

## Stage 13 — Self-building, screen, phone, app window (v1.4.0)

- [x] SCREEN widget: live JPEG view from the action server (mss), monitor select, OCR via tesseract, vision fallback
- [x] Custom widgets designed by the brain, stored in data/widgets, mounted as sandboxed frames with a live snapshot bridge (verified with the mock brain: create, show, delete)
- [x] Forge: Claude Code headless edits the source, syntax checks, commit on forge/<date>, restart; voice + panel card (status / apply / discard paths verified; a real run needs a signed-in Claude Code)
- [x] Find my phone: companion-page alarm (verified: the phone page rang), ntfy priority push, Google Find My Device through the persistent-profile browser (sign-in path verified; the signed-in device list could not be tested here), tracking overlay
- [x] Chromeless app window (pywebview) with drag bar, pin, minimize, fullscreen, hotkey; tests/window_test.py 16/16 with a fake pywebview; a real window needs a display
- [x] docs/INSTALL.md with eight labeled screenshots

## Stage 14 — Spotify, map, calendar, installer, self-update (v1.5.0)

- [x] Spotify Web API with PKCE: auth, callback, status, play / pause / next / prev / volume / search / shuffle / repeat / transfer; Music widget shows it; 51 checks against a fake API (no real account here)
- [x] Calendar writes to ICS or CalDAV with a natural-time parser (14 cases), /calendar/next; verified end to end on the ICS file
- [x] Map panel: Leaflet + OpenStreetMap with you / phone / searched place; Nominatim geocoding with cache and rate limit (verified live)
- [x] Memory constellation panel, big-text mode, accessibility labels
- [x] Windows installer script (Inno Setup, built in CI), self-installing update with staged swap (25 checks against a fake release), companion PWA manifest + service worker, forge from the packaged build via a data/src overlay
- [ ] Not verifiable here: compiling the installer, a real Windows update swap, the PWA install prompt, a real Spotify or CalDAV account

## Stage 15 — Everything left on the roadmap that fits (v1.6.0)

- [x] Brains: streaming headless Claude (NDJSON), MCP server so Claude Code can use SAMURAI's actions / browser / documents / journal / calendar / memory as tools, per-provider cost meter with a monthly budget and spoken warning, local vision models on Ollama, missions (hours-long Claude Code tasks in workspace/ with a scratchpad, reported through the events feed); 67 checks incl. one real stream through the signed-in CLI
- [x] Voice: local OpenAI-compatible TTS engine, voice styles (also from the mood), OpenAI Realtime full duplex (key stays on the PC), custom wake phrase, voice identity (enrol / only obey enrolled), meeting mode with a summary into the journal
- [x] Senses: activity awareness (quiet during calls, games and full screen; held events replayed after), Windows / Linux notifications read aloud, face recognition (enrol / who), MediaPipe hand gestures mapped to pause / mute / confirm / listen / skip, mic kill switch backed by the system mute; 93 checks
- [x] Platform: downloads and qBittorrent, price watch through the browser agent, Hue / Govee / Kasa direct with tiles in HOME, settings sync folder, rooms (several HUDs, one brain, hand-off), plugin marketplace with a catalog and panel / voice install, lyrics (LRC + lrclib) and embedded album art in MUSIC
- [x] Look: holographic desk and wall layouts, 3D face avatar, glass / wireframe / paper skins and fonts, depth blur, icon morphs, widget pop-out, privacy light
- [x] HUD wiring verified in the browser: every new phrase routes, quiet mode holds and replays an event, gesture and face events act, settings rows, panel card for Claude tools / meter / missions
- [ ] Not verifiable here: real Hue / Govee / Kasa devices, WinRT toasts, a camera for gestures and faces, OpenAI Realtime audio, a local voice server, resemblyzer, Claude Code calling the MCP tools inside a live session

## Not verified in this build (needs a real desktop)

- Premium voice engines with real keys (request shaping tested against a fake backend); browser SpeechRecognition on a phone; Siri / Google voices
- Real hardware: Wi-Fi / Bluetooth / VPN toggles, wake-on-LAN on a LAN, SSH to a machine, Steam, ntfy / Telegram with tokens
- WebGL performance on a real GPU (verified here with software rendering at about 22 fps on medium)

- Windows-specific paths: Startup-folder autostart, PowerShell volume/brightness/screenshot, `start` app launcher
- macOS paths: launchd autostart, osascript volume/media keys
- openWakeWord engine (package install path is wired, model inference untested here)
- Kokoro local voice (install path wired, 330 MB download untested here)
- Real microphone input in a browser (the Vosk pipeline is verified with synthesised audio)
- Gemini CLI headless (written from its docs; Claude Code headless is verified)
