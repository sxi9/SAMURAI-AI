# SAMURAI roadmap — everything that could still be added

Numbered so you can say "build 3, 12 and 40". Legend: `[ ]` not started · `[x]` done (as of v1.6.0).
Effort: S = under a day, M = a few days, L = a week or more. "GPU" means it needs a graphics card for real time.

## A. Claude and brains

- [x] A1 (S) "Log in to Claude" button in the control panel: runs the Claude Code login, shows whether the session is valid, which plan, and when it expires
- [x] A2 (S) Claude session health on the HUD pill (logged in, expired, rate limited) with a spoken warning · (status on the panel; HUD pill pending)
- [x] A3 (S) Claude panel: a ring node that opens claude.ai in an embedded browser window for manual chat (cannot drive SAMURAI; the site refuses iframes and scraping it breaks the terms) · (opens the real site in the agent browser window; manual chat only)
- [x] A4 (S) Gemini CLI login button, same as A1
- [x] A5 (M) Streaming for headless Claude Code (today the JSON answer arrives whole) · (NDJSON stream from headless Claude; Gemini CLI whole)
- [x] A6 (M) Tool calling through Claude Code's own MCP servers: let Claude use SAMURAI's actions, browser agent and documents as tools inside one session · (servers/samurai_mcp.py; panel button registers it with Claude Code)
- [x] A7 (M) Per-provider cost and token meter, monthly budget with a spoken warning
- [x] A8 (M) Local vision model (Ollama llava / moondream) so "what is on my screen" works offline · (Ollama llava / moondream picked automatically)
- [x] A9 (L) Agent loop with a scratchpad: multi-hour tasks that keep working while you are away and report when done · (missions in workspace/ with a NOTES.md scratchpad, 6 h cap)

## B. Voice

- [x] B1 (S) Premium online voices behind the TTS sidecar: ElevenLabs, OpenAI gpt-4o-mini-tts (nova, shimmer), Cartesia Sonic, Azure HD (Ava, Emma); voice picker with a sample button
- [x] B2 (S) More Edge voices surfaced by default: en-US-AvaMultilingual, en-US-Emma, en-GB-Sonia, en-AU-Natasha, en-IN-Neerja
- [x] B3 (M, GPU) Local natural voices: Chatterbox (emotion control), Orpheus (laughs, sighs), XTTS v2 (clone a voice from a 10-second sample), Fish Speech, F5-TTS · (any local OpenAI-compatible voice server: Kokoro-FastAPI, Orpheus, XTTS, Chatterbox, Fish, F5; the models themselves need a GPU)
- [x] B4 (S) Voice styles: whisper, excited, calm, per mood, where the engine supports it
- [x] B5 (M) Full duplex speech-to-speech: OpenAI Realtime, Gemini Live, or Moshi locally; natural interruptions and back-channel ("mm-hm") · (OpenAI Realtime over WebRTC; Gemini Live and Moshi still open)
- [x] B6 (M) Trained "samurai" wake-word model from your own recordings (openWakeWord training script) · (custom wake phrase through the recogniser grammar; a trained model is still open)
- [x] B7 (M) Voice identity: only obey enrolled voices; greet the right person · (resemblyzer voice prints, optional)
- [x] B8 (S) Large Vosk model as default on capable machines; Whisper option (faster-whisper) for better accuracy · (Whisper; large Vosk still manual)
- [ ] B9 (S) Global push-to-talk hotkey that works in any app
- [x] B10 (S) Live translation: speak one language, reply in another; subtitles on the HUD · (via the brain; no live subtitles yet)
- [x] B11 (M) Meeting mode: transcribe the room, summarise, pull out action items

## C. Media inside the HUD

- [x] C1 (S) Video widget: YouTube embed with voice control (play, pause, skip, volume, search), cinema mode that dims the rest of the HUD
- [x] C2 (S) Local video files and folders in the same widget
- [x] C3 (S) HLS and Twitch live streams
- [x] C4 (M) Real Spotify control through the Web API: play anything, album art, queue
- [x] C5 (S) Album art and lyrics for the local library (tags, LRC files)
- [x] C6 (S) Internet radio and podcasts
- [x] C7 (S) Read a PDF, an article or the clipboard aloud; "summarise this page"
- [x] C8 (M) Map widget with Leaflet: your location, routes, traffic, "how long to the office" · (Leaflet + OSM, geocoding)
- [x] C9 (S) Photo slideshow from the gallery in ambient mode
- [x] C10 (S) Picture-in-picture: any widget can float small over other apps (browser PiP for video) · (Document Picture-in-Picture; Chrome 116+)

## D. Senses

- [x] D1 (M) Presence: greet you when the camera sees you, pause and lock when you leave
- [x] D2 (M) Face recognition for per-person profiles and greetings · (OpenCV LBPH, optional opencv-contrib)
- [x] D3 (M) Hand gestures via webcam (MediaPipe): volume, next, pause, summon a widget · (MediaPipe hands, vendored)
- [x] D4 (S) Screen OCR: read any text on screen, copy it, translate it · (tesseract OCR + SCREEN panel)
- [x] D5 (M) Activity awareness: knows which app you are in and adapts (quiet during calls, no interruptions while gaming)
- [x] D6 (S) Clipboard history and "what did I copy earlier" · (clipboard read/write actions exist; no history list)
- [x] D7 (M) Windows notifications read aloud, with reply by voice · (WinRT / D-Bus toasts read aloud, reply by voice pending)
- [x] D8 (S) Microphone always-on with a privacy light on the HUD and a hardware-style kill switch

## E. Tasks and connections

- [x] E1 (M) Google Calendar and Gmail write access: create events, send replies by voice · (calendar writes via ICS / CalDAV; Gmail and Google Calendar OAuth still open)
- [ ] E2 (M) WhatsApp or Telegram bridge: read and send messages, phone notifications to the HUD
- [x] E3 (S) ntfy or Pushover: push alerts to your phone when you are away
- [x] E4 (S) Discord and Slack presence and messages · (webhooks out; no inbound)
- [x] E5 (S) Wi-Fi, Bluetooth, VPN on and off; "connect my headphones"
- [x] E6 (S) Wake-on-LAN and SSH to other machines: "turn on the server", "run the backup on the NAS"
- [x] E7 (S) File search across drives (everything-style index) and "open the file I worked on yesterday"
- [x] E8 (S) Download manager and torrent client control · (built-in downloader + qBittorrent Web UI)
- [x] E9 (S) Game launcher: Steam library, "launch Elden Ring", FPS overlay
- [x] E10 (S) System cleanup and updates: temp files, package updates, driver check, with confirmation
- [x] E11 (M) Notes and journal by voice, searchable, daily summary
- [x] E12 (S) Pomodoro and focus sessions with app blocking
- [x] E13 (M) Shopping and orders: price watch, "order more coffee" through a confirmed browser flow · (price watch through the browser agent; ordering stays a manual confirmed browser flow)
- [x] E14 (M) Smart home beyond Home Assistant: Hue, Tuya, Tapo, Govee direct; scenes by voice · (Hue, Govee, Kasa / Tapo direct; Tuya still open)
- [x] E15 (L) Android companion app (Capacitor) with wake word, instead of the phone web page · (installable companion PWA; a native app is still open)
- [x] E16 (S) Kiosk mode for a wall tablet: full screen, auto-start, dim at night

## F. Avatar and look (the "incredible visual" list)

- [x] F1 (L) Volumetric orb in Three.js: glass sphere with refraction, inner plasma shader, fresnel rim, 50,000-particle point cloud, 3D shape morphs with depth of field, slow orbiting camera
- [x] F2 (M) Reactive nebula background: GPU noise or fluid shader that stirs when listening, brightens when speaking, turns red and turbulent on alert
- [x] F3 (S) Voice visualiser: real spectrum of the reply audio as rings around the orb; lip-sync via the audio analyser
- [x] F4 (L) 3D head option: Live2D or VRM avatar with eye tracking toward the mouse or your face, blinking, mood expressions · (procedural Three.js head; Live2D/VRM models still open)
- [x] F5 (M) Hologram materialise: widgets assemble from scanlines and particles, dissolve when docked
- [x] F6 (M) Shape-to-widget morphs: the particles form a cloud before weather opens, a heartbeat line before system, a note before music
- [x] F7 (S) Energy arcs between the orb and the widget it is driving; a flash when an action runs
- [x] F8 (S) Camera moves: dolly and parallax from the mouse and the phone gyroscope; slow drift in ambient · (mouse parallax; gyroscope pending)
- [x] F9 (M) Depth layers with real blur: foreground glass, mid widgets, deep background
- [x] F10 (S) Chromatic aberration and glitch on alert; CRT bloom "retro" theme; film grain and lens flares "cinema" theme
- [x] F11 (M) Day cycle: palette and background follow the real clock and the weather feed; rain or snow particles when forecast
- [x] F12 (S) Audio-reactive everything: ring, ticker glow and corner brackets pulse with music, not only the orb
- [x] F13 (M) 3D Earth globe for the position widget: textured globe, your location, satellites, the day-night line, spins on voice
- [x] F14 (L) Holographic desk: a 3D room in ambient mode with widgets as floating panels · (CSS 3D curved wall, drag to rotate)
- [x] F15 (M) Data constellations: memories and tasks as stars connected by topic, searchable by voice
- [x] F16 (S) Wall or projector mode: 4K ambient scene with the orb alone, as a living wallpaper
- [x] F17 (S) Typewriter reply text with a cursor glow, sound-synced
- [x] F18 (S) Heartbeat line behind the system widget that follows real CPU load
- [x] F19 (S) Eyes narrow on hard questions, widen on alerts, look at the widget being read · (glance at the widget being driven)
- [x] F20 (S) Boot sequence with a diagnostic scroll, a power hum and a "systems online" flash
- [x] F21 (M) Desktop overlay: Electron shell, transparent and always on top, so the orb floats over any app · (chromeless pywebview window; overlay transparency pending)
- [x] F22 (S) Widget themes: glass, wireframe, paper; custom fonts
- [x] F23 (S) Idle behaviours: the orb yawns, stretches, chases the mouse, hides behind a widget

## G. Platform and polish

- [x] G-1 (L) Forge: SAMURAI rebuilds its own code on request (Claude Code headless, review, apply, restart) and designs its own widgets by voice (v1.4.0)
- [x] G-2 (M) Find my phone: companion alarm, ntfy push, Google Find My Device through the agent browser, tracking map overlay (v1.4.0)

- [x] G0 (M) Auto-tune: hardware profile, recommended settings applied on first start, browser GPU check, battery / heat / memory governor, essentials startup profile (v1.3.0)

- [x] G1 (S) Installer exe (NSIS or Inno) instead of a zip; macOS .app and Linux AppImage · (Inno Setup installer built in CI; not code-signed)
- [x] G2 (S) Auto-update from GitHub releases with a changelog spoken on first boot · (staged swap, keeps config)
- [x] G3 (S) Settings sync across machines through a folder or Git · (folder sync, newer wins)
- [x] G4 (M) Multi-room: several HUDs on the LAN, one brain, hand-off between rooms · (rooms register, events carry a room, hand-off by voice)
- [x] G5 (S) Backup and restore of memory, config and routines
- [x] G6 (S) Crash reporter into the control panel, with one-click log bundle
- [x] G7 (M) Plugin marketplace page that installs plugins from a Git URL
- [x] G8 (S) Accessibility: screen-reader labels, high-contrast theme, bigger text mode

## Suggested order

1. A1 Claude login button · B1 premium voices · C1 video widget · F3 voice visualiser (all small, all visible)
2. F1 volumetric orb · F2 nebula shader · F5 hologram transitions (the look of every frame)
3. D1 presence · B5 full duplex speech · F11 day cycle
4. E1 calendar and mail · C4 Spotify · F13 globe
