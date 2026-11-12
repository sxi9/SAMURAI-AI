# Background agent reports

Large subsystems were built by forked agents working in their own git worktrees and merged back. These are their final reports.

## Report 2026-11-11 16:37

Background command "Wait until the v1.0.0 release page exists" completed (exit code 0)

---

## Report 2026-11-11 16:37

Background command "Wait until the Windows zip is attached to the v1.0.0 release" completed (exit code 0)

---

## Report 2026-11-11 17:49

Background command "Wait seven minutes for the release build to run" completed (exit code 0)

---

## Report 2026-11-12 04:10

Fork E: Spotify (PKCE), calendar writes, map geocode/here, vendored Leaflet, tests — done on branch `wt/spotify-cal-map`, commit `cfd60c8` (worktree `/home/user/SAMURAI-AI/.claude/worktrees/agent-a22a465f38c78a36f`, not pushed). `.venv` in the worktree is an untracked symlink to the main venv; do not add it.

**Files**
- `servers/samurai_spotify.py` (new), `servers/samurai_calendar.py` (new), `servers/samurai_addons.py` (import + `**spotify.ROUTES`, `**calendar.ROUTES`), `servers/samurai_common.py` (DEFAULT_CONFIG `spotify`, `calendar`), `config.example.json` (two keys appended), `tests/spotify_cal_test.py` (new), `app/vendor/leaflet/` (leaflet.js, leaflet.css, images/, LICENSE; 1.9.4, BSD-2, 196 KB).

**Spotify routes on :9500**
- `GET /spotify/auth` → `{ok, url, state}` (or `{ok:false, error}` when `spotify.client_id` is empty). Open `url` in the user's browser.
- `GET /spotify/callback?code=&amp;state=` → HTML "Linked to Spotify… say play music on spotify" (stale state or Spotify error → red page).
- `GET /spotify/status` → `{ok, linked, client_id}` when unlinked; when linked `{ok, linked:true, user, device, playing, track:{title, artist, album, album_art, progress, duration, uri}|null, devices:[{id,name,type,active,volume}], shuffle, repeat, error?}`.
- `POST /spotify {cmd, arg}`: `play` (no arg = resume; with words = search then play), `pause`, `next`, `prev`, `volume` (0–100), `search` (words), `play_uri` (spotify:…), `shuffle` (on/off), `repeat` (off|track|context; also one/all/on), `transfer` (device name), `unlink` → `{ok, did, …}`. 400 messages: "Spotify is not linked: …", "no Spotify device available: open the Spotify app…", "no Spotify device called X; available: …", "nothing on Spotify for '…'", "needs a Premium account", "session expired".
- Tokens: `data/spotify.json` (refresh token kept, access token refreshed when expired; `SAMURAI_DATA` env overrides the dir). `SAMURAI_SPOTIFY_FAKE` / `SAMURAI_SPOTIFY_REDIRECT` env for tests.

**Calendar + map routes on :9500**
- `POST /calendar/add {title, start, end?, duration_min?(60), location?, notes?}` → `{ok, event:{uid,title,start,end,location,when}, target, did}`. `start`/`end` accept ISO or natural: today/tonight/tomorrow/day after tomorrow, weekday names ("next monday at 10", "friday 15:30"), "in 2 hours / in thirty minutes", "at 3pm / at 3 (afternoon) / 15:30 / noon / midnight / evening / morning", "on 12 dec 9am", "march 3 at 11:15". Target `calendar.target`: `ics` (appends a VEVENT to `widgets.agenda.ics_path`, creates the file, keeps one VCALENDAR, clears the agenda cache) or `caldav` (PUT `&lt;caldav_url&gt;/&lt;uid&gt;.ics` with Basic auth; Nextcloud/Fastmail/iCloud app passwords/Radicale; Google needs OAuth and is not covered).
- `GET /calendar/next?n=5` → `{ok, events:[{uid,title,start,end,location,when}], source, path}` (ICS parse, or CalDAV REPORT for the next 30 days).
- `GET /calendar/parse?when=` → `{ok, iso, human}`.
- `GET /map/geocode?q=` → `{ok, results:[{lat,lon,label,type}], cached?}` (Nominatim jsonv2, User-Agent "SAMURAI-AI/1.4 (…github link)", ≥1.1 s between requests, 24 h cache; `SAMURAI_NOMINATIM` env for tests; unreachable → `{ok:false, error, results:[]}`).
- `GET /map/here` → `{ok, lat, lon, label, source:"config", phone:{lat,lon,t,device}|null}`; `phone` is filled from `samurai_findmy.LAST_POS` if that module ever sets it (it does not today; the Google parser would need to set `LAST_POS = {"lat","lon","t","device"}`).

**Config keys**: `spotify.client_id`; `calendar.target` (ics|caldav), `calendar.caldav_url`, `calendar.caldav_user`, `calendar.caldav_password` (consider adding the password to `SECRET_FIELDS` in samurai_common; I did not touch that tuple). `post_config` in samurai_addons merges only a fixed key tuple: add `"spotify", "calendar"` there if the panel should save them (not mine to edit beyond the mount hunk).

**HUD hooks (yours)**
- Map widget: add `&lt;link rel="stylesheet" href="vendor/leaflet/leaflet.css"&gt;` and `&lt;script src="vendor/leaflet/leaflet.js"&gt;`; in the focused POSITION panel create `L.map(el, {zoomControl:false, attributionControl:true}).setView([lat,lon], 13)` with `L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OpenStreetMap'})`; markers from `GET /map/here` (`[lat,lon]` = you; `phone` = phone marker when present); "where is &lt;place&gt;" → `/map/geocode?q=` → `map.flyTo`. Set `L.Icon.Default.imagePath = 'vendor/leaflet/images/'`. Tiles: light personal use only, keep the attribution visible (OSM tile policy); a dark look can be a CSS `filter: invert(1) hue-rotate(180deg)` on `.leaflet-tile-pane`.
- Spotify in the MUSIC widget: when `/spotify/status` says `linked`, show `track.title`, `track.artist`, `album_art`, `progress/duration`, `device`, and a device list; voice → cmd: "play &lt;x&gt; on spotify" / "spotify play &lt;x&gt;" → `play` with arg; "pause spotify" → `pause`; "next/previous track" → `next`/`prev` (when linked, otherwise the existing media keys); "spotify volume 30" → `volume`; "shuffle on/off" → `shuffle`; "repeat this song" → `repeat one`; "play on the kitchen speaker" → `transfer`; "link spotify" → open `/spotify/auth` url; speak `did` or the 400 `error` verbatim.
- Calendar phrases: "add &lt;title&gt; to my calendar tomorrow at 3pm", "schedule dentist friday 15:30 for 45 minutes", "put standup on my calendar every…" (recurrence not supported, say so), "what's next on my calendar" → `/calendar/next`. Pass the time part as `start` and the duration as `duration_min`.
- Brain action catalogue: `spotify {arg: "play &lt;words&gt;" | pause | next | prev | "volume N"}`, `calendar_add {arg: "title | when | duration"}`, `map_show {arg: place}`.

**Verified** (`.venv/bin/python tests/spotify_cal_test.py`, 51/51): PKCE pair shape; auth URL with S256 challenge, client id and scopes; callback exchange (code_verifier sent, no client secret) and stale-state rejection; status mapping (track, progress, device, devices, user); every command's request against the fake (pause/next/prev/volume/shuffle/repeat/play/search→uris or context_uri/play_uri/transfer by name/unknown device listing/bad cmd); refresh when expired; unlink; 14 natural-time cases; ICS create + append + escaping + `/calendar/next` order; parse/missing-title errors; the sidecar's own agenda parser reads the written file; `/map/here`; geocode with User-Agent, cache and 400. The test parks `ROOT/config.json` during the run and restores it.

**Not verifiable here**: a real Spotify account (Premium rules, real device behaviour), a real CalDAV server (PUT/REPORT shapes follow RFC 4791 but were not exercised), live Nominatim.

Aside, not mine: the main checkout's running add-ons answers `GET /config` with 500 "'str' object has no attribute 'items'" (the existing smoke test's one failure); it is unrelated to this branch.

---

## Report 2026-11-12 05:50

Committed as d5cec42 on `wt/senses-platform` (not pushed). Final report follows.

## Fork H report: senses platform on `wt/senses-platform`

**Commit** d5cec42 on top of af0e363, 22 files, not pushed. `.venv` and `models` symlinks left untracked. `app/vendor/mediapipe` adds 17 MB (wasm SIMD build 9.5 MB plus the 7.8 MB hand model).

**Tests.** `tests/senses_platform_test.py` runs its own add-ons and action-server copies in-process on free ports with data redirected to a temp folder: 93 checks, ALL PASS. `tests/smoke_sidecars.py` ALL PASS, but it hits the main checkout's running services on the standard ports, so it only proves nothing there broke. The telemetry sampler was verified separately on a spare port.

### Routes and shapes (add-ons :9500 unless noted)

- **D5** `GET /activity` → `{ok, title, app, category: call|game|video|work|idle, fullscreen, quiet, since}`. `quiet` is true for call and game. Telemetry `/stats` now carries `active_window {title, app}` and `fullscreen`, refreshed every 5 s.
- **D7** `GET /notifications` → `{ok, notifications:[{app,title,text,t}], source: winrt|dbus|none, note, reading}`. `POST /notifications/clear`. `POST /notifications/test {app,title,text}` injects a toast (for tests). New toasts become events kind `say`, source `notification`, only when `senses.read_notifications` is true.
- **D8** action server :9300. `POST /action {type:'mic_mute', arg:'on|off|toggle'}`, `GET /mic` → `{ok, muted: true|false|null, known}`. `POST /plugins/reload` → `{ok, tools}`.
- **D2** `POST /faces/enroll {name, image}` and `POST /faces/who {image}` → `{ok, name|null, confidence, known}`. `GET /faces` → `{people, available, note}`. `POST /faces/forget {name}`. Base64 jpeg in, LBPH data under data/faces.
- **D3** `app/js/hud-gestures.js`: `SAM.gestures.start()/stop()`, 10 fps only while started, dispatches `samurai-gesture` with `detail.name` in open_palm, fist, thumbs_up, index_up, swipe_left, swipe_right. Geometry exported for node and tested with synthetic landmarks.
- **E8** `POST /download {url, name?}` → `{ok, id, path}`. `GET /downloads` → `{downloads:[{id,name,url,path,bytes,total,progress,state,error}], dir}`. `POST /download/cancel {id}`. `GET /torrents` → `{configured, torrents}`. `POST /torrents {action: add|pause|resume|delete, magnet?, hash?}`.
- **E13** `POST /watch {url, label?}`, `GET /watch` → `{watches:[{id,url,label,price,currency,history,last,error}]}`, `POST /watch/delete {id}`, `POST /watch/check {id?}`, `POST /watch/open {id}` (headed browser only, never orders). Checks every 6 h through the browser agent read. A drop of 5 % or more pushes a `say` event with source `pricewatch`.
- **E14** `GET /home2/devices` → `{devices, errors, backends:{hue,govee,kasa}, note}`. `POST /home2 {device, on?, brightness?, color?}`. `GET /home2/scenes`, `POST /home2/scene`, `POST /home2/hue/pair`, `GET /home2/status`.
- **G3** `POST /sync {dir}` → `{ok, dir, last, pushed, pulled}`. `GET /sync`. Mirrors config.json, data/*.json, data/widgets and plugins both ways, newer wins, overwritten copy kept as .bak, pulls on start.
- **G4** `POST /rooms/register {room, kind}` → `{room, active}`. `GET /rooms` → `{active, rooms:[{room,kind,seen,addr,online}]}`. `POST /rooms/handoff {to}`.
- **G7** `GET /plugins/market` → `{plugins:[{name,version,description,tools,url,installed,installed_version}], installed}`. `POST /plugins/install {url}` accepts a zip URL, a git URL or a repo folder such as `plugins/catalog/countdown`, requires plugin.json with name and entry, refuses zip-slip paths. `POST /plugins/remove {name}`, `POST /plugins/reload`.
- **C5** `GET /lyrics?title=&amp;artist=` or `?i=&lt;track index&gt;` → `{lrc|null, plain|null, source: file|lrclib|none}`, cached. `GET /art?i=` → image bytes, 404 when no embedded art or mutagen missing.

### Config keys
`senses.quiet_apps` (list of app name substrings forced to category call), `senses.read_notifications`, `home2.hue_bridge/hue_user/govee_key/kasa_discover/kasa_hosts`, `market.download_dir` (default ~/Downloads/SAMURAI), `market.qbittorrent_url/user/password`. Added to DEFAULT_CONFIG and config.example.json. `mutagen` appended to requirements; opencv-contrib, winsdk, python-kasa and dbus-python are noted as optional.

### Hooks for hud.js (not wired, files untouched)
- Load `js/hud-faces.js` and `js/hud-gestures.js` from jarvis-interface.html after hud.js.
- Poll `/activity` and suppress proactive speech when `quiet` is true or `fullscreen` is set.
- Events with source `notification`, `pricewatch`, `download` or `rooms` arrive through the existing `/events` poll.
- Listen for `samurai-gesture` and map names to pause, mute, confirm, next, prev, listen. Faces fire `samurai-face` with `{name, confidence}`.
- Rooms: the page should register its room from localStorage and filter events by `room`. Events do not carry `room` yet because samurai_automation.push_event was out of scope; add a `room` field there when wiring.
- Mic privacy light from `GET /mic`.

### Not verified here
Windows paths (user32 window title, WinRT toasts, nircmd and AudioDeviceCmdlets), macOS osascript paths, real Hue, Govee and Kasa devices, dbus toasts, face recognition with real opencv-contrib, MediaPipe in a real browser with a camera, and qBittorrent against a live Web UI.
