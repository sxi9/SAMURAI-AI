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

- [ ] Recorded walkthrough video (mp4 + gif) of the HUD and control panel
- [ ] docs/WALKTHROUGH.md with labeled step screenshots

## Not verified in this build (needs a real desktop)

- Windows-specific paths: Startup-folder autostart, PowerShell volume/brightness/screenshot, `start` app launcher
- macOS paths: launchd autostart, osascript volume/media keys
- openWakeWord engine (package install path is wired, model inference untested here)
- Kokoro local voice (install path wired, 330 MB download untested here)
- Real microphone input in a browser (the Vosk pipeline is verified with synthesised audio)
- Gemini CLI headless (written from its docs; Claude Code headless is verified)
