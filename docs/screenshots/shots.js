/* Labeled screenshots of every SAMURAI feature, against the running services (HUD :8080, panel :9000, add-ons :9500).
   node docs/screenshots/shots.js   → docs/screenshots/NN-*.png (1920x1080). Numbered badges match the captions in docs/SCREENSHOTS.md. */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname;
const CSS = `.lb{position:absolute;z-index:999999;display:flex;align-items:flex-start;gap:8px;pointer-events:none}
.lb i{width:30px;height:30px;border-radius:50%;background:#ffb547;color:#0a0f1a;font:bold 15px/30px 'IBM Plex Mono',monospace;text-align:center;flex:none;box-shadow:0 2px 10px rgba(0,0,0,.6)}
.lb b{background:rgba(5,6,13,.95);border:1px solid #ffb547;color:#ffe9c2;font:600 14px/1.35 Saira,Segoe UI,sans-serif;padding:6px 10px;border-radius:4px;max-width:420px;box-shadow:0 4px 18px rgba(0,0,0,.6)}
.lbox{position:absolute;z-index:999998;border:2px solid #ffb547;border-radius:4px;pointer-events:none;box-shadow:0 0 0 2px rgba(0,0,0,.5)}
.ttl{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:999999;background:rgba(5,6,13,.92);border:1px solid #ffb547;color:#ffb547;font:700 16px/1.2 'IBM Plex Mono',monospace;letter-spacing:.18em;padding:8px 18px;border-radius:4px;pointer-events:none}`;
async function label(page, title, items) {
  await page.evaluate(({ items, css, title }) => {
    document.querySelectorAll('.lb,.lbox,.ttl,#__lbcss').forEach(e => e.remove());
    const st = document.createElement('style'); st.id = '__lbcss'; st.textContent = css; document.head.appendChild(st);
    if (title) { const t = document.createElement('div'); t.className = 'ttl'; t.textContent = title; document.body.appendChild(t); }
    items.forEach(([sel, n, text, pos]) => {
      const el = typeof sel === 'string' ? document.querySelector(sel) : null;
      if (typeof sel === 'string' && !el) return;
      const r = el ? el.getBoundingClientRect() : { x: sel[0], y: sel[1], width: sel[2], height: sel[3] };
      if (el && pos !== 'nobox') { const b = document.createElement('div'); b.className = 'lbox'; b.style.cssText = `left:${r.x + scrollX - 4}px;top:${r.y + scrollY - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`; document.body.appendChild(b); }
      const d = document.createElement('div'); d.className = 'lb'; d.innerHTML = `<i>${n}</i><b>${text}</b>`;
      let x = r.x + scrollX, y = r.y + scrollY + r.height + 10;
      if (pos === 'above') y = r.y + scrollY - 48; if (pos === 'right') { x = r.x + scrollX + r.width + 12; y = r.y + scrollY; } if (pos === 'inside' || pos === 'nobox') { x = r.x + scrollX + 12; y = r.y + scrollY + 12; } if (pos === 'left') { x = r.x + scrollX - 440; y = r.y + scrollY; }
      d.style.cssText = `left:${Math.max(8, Math.min(x, innerWidth - 440))}px;top:${Math.max(8, y)}px`; document.body.appendChild(d);
    });
  }, { items, css: CSS, title });
}
const clear = page => page.evaluate(() => document.querySelectorAll('.lb,.lbox,.ttl').forEach(e => e.remove()));
const P = name => `${OUT}/${name}.png`;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('samurai.hud3', JSON.stringify({ brain: { provider: 'lmstudio', keys: {}, models: {}, urls: {}, pool: { enabled: false, strategy: 'failover', order: [] }, roles: {}, sysAccess: true, actions: true, mood: 'balanced', humor: 5, memory: true, stream: true }, ui: { theme: 'arc', layout: 'focus', idleMorph: false, wander: false, gl: 'on', glQuality: 'low', fx: true, depth: true, avatar: 'orb' } })));
  await page.goto('http://127.0.0.1:8080/jarvis-interface.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
  /* 01 boot */
  await wait(2500); await label(page, 'BOOT SEQUENCE', [['#bootLog', 1, 'Diagnostic scroll while the sidecars link up', 'right'], ['#bootBar', 2, 'Progress; then the widgets assemble and the welcome flash', 'above']]);
  await page.screenshot({ path: P('01-boot'), timeout: 180000 }); console.log('01');
  await wait(10000); await clear(page);
  await page.goto('http://127.0.0.1:8080/jarvis-interface.html?skipboot=1', { waitUntil: 'domcontentloaded', timeout: 90000 }); await wait(8000);
  const reset = async () => { await page.keyboard.press('Escape'); await page.evaluate(() => { SAM.hud.S.focus = null; SAM.hud.S.layout = 'focus'; SAM.hud.applyLayout(); if (SAM.hud.S.mode === 'alert') SAM.hud.setMode('idle'); }); await wait(800); };
  const say = async (q, ms = 3500) => { await page.evaluate(q => SAM.hud.submit(q), q); await wait(ms); };
  const shot = async (name) => { await page.screenshot({ path: P(name), timeout: 120000, animations: 'disabled' }); console.log(name); await clear(page); };
  /* 02 overview */
  await reset();
  await page.evaluate(() => { document.getElementById('reply').textContent = 'Good morning. 28 degrees and clear, two meetings today, systems nominal.'; });
  await label(page, 'THE HUD · FOCUS LAYOUT', [['#pillProvider', 1, 'Brain in use (Ollama, Claude Code, OpenAI, 18 providers)', 'nobox'], ['#pillMic', 2, 'Mic pill: amber when open, red when it hears you; privacy light', 'nobox'],
    ['.slot[data-id=sys]', 3, 'SYSTEM: live CPU, memory, GPU, network sparkline', 'inside'], ['.slot[data-id=cal]', 4, 'AGENDA from your calendar (ICS / CalDAV)', 'inside'], ['.slot[data-id=task]', 5, 'TASKS by voice, click to toggle', 'inside'],
    ['#core', 6, 'The orb: 24,000 particles + glass sphere, lip-syncs to the voice', 'nobox'], ['#nodes', 7, 'Orbital ring: 16 nodes, click to summon a widget', 'nobox'],
    ['.slot[data-id=wx]', 8, 'WEATHER + 4-day forecast (no key)', 'inside'], ['.slot[data-id=mus]', 9, 'MUSIC: library, Spotify, radio, podcasts, lyrics', 'inside'], ['.slot[data-id=home]', 10, 'HOME: Home Assistant, Hue, Govee, Kasa tiles', 'inside'],
    ['#reply', 11, 'Spoken reply, typed in sync with the voice', 'above'], ['#cmd', 12, 'Type or say a command; wake word "samurai"', 'above'], ['#ticker', 13, 'Live ticker: markets and headlines', 'nobox']]);
  await shot('02-hud-overview');
  /* 03 full layout */
  await page.evaluate(() => { SAM.hud.S.layout = 'full'; SAM.hud.applyLayout(); }); await wait(2500);
  await label(page, 'FULL LAYOUT · TWELVE WIDGETS', [['.slot[data-id=msg]', 1, 'INBOX over IMAP', 'inside'], ['.slot[data-id=tty]', 2, 'TERMINAL: every action logged, plugins, downloads', 'inside'], ['.slot[data-id=tmr]', 3, 'TIMERS: "timer 5 min"', 'inside'], ['.slot[data-id=cam]', 4, 'CAMERA feed (MJPEG / MP4 / HLS), presence', 'inside'], ['.slot[data-id=pix]', 5, 'GALLERY from a photos folder', 'inside'], ['.slot[data-id=map]', 6, 'POSITION: globe / map', 'inside']]);
  await shot('03-hud-full'); await reset();
  /* 04 settings drawer */
  await page.evaluate(() => SAM.hud.toggleDrawer(true)); await wait(1200);
  await label(page, 'SETTINGS DRAWER', [['#drawer', 1, 'Brains, provider pool, task routing, voice engines and styles, wake phrase, personality, avatar, layouts, themes, gestures, rooms', 'left']]);
  await shot('04-settings'); await page.evaluate(() => SAM.hud.toggleDrawer(false));
  /* 05 map */
  await say('show the map', 6000); await label(page, 'MAP PANEL', [['.slot.big', 1, '"show the map" · Leaflet + OpenStreetMap, you, your phone, any place: "find the airport on the map"', 'inside']]); await shot('05-map'); await reset();
  /* 06 browser */
  await say('browse wikipedia.org', 25000); await label(page, 'BROWSER IN THE HUD', [['.slot.big', 1, '"browse wikipedia.org" · the agent\'s real Chromium streamed live; click, scroll, type, or let the brain drive it', 'inside']]); await shot('06-browser'); await reset();
  /* 07 memory */
  await say('show my memory', 6000); await label(page, 'MEMORY CONSTELLATION', [['.slot.big', 1, '"show my memory" · facts, journal, tasks and conversations as stars linked by topic; click a star to hear it', 'inside']]); await shot('07-memory'); await reset();
  /* 08 video */
  await say('watch lofi hip hop on youtube', 14000); await label(page, 'VIDEO PANEL', [['.slot.big', 1, '"watch lofi hip hop on youtube" · YouTube, local files, HLS and Twitch; play, pause, skip, cinema mode by voice (YouTube is blocked from this container, so the frame is black here)', 'inside']]); await shot('08-video'); await say('stop the video', 1500); await reset();
  /* 09 screen */
  await say('show my screen', 5000); await label(page, 'SCREEN PANEL', [['.slot.big', 1, '"show my screen" · live view of any monitor; READ (OCR), DESCRIBE (vision brain), SHOT (no desktop in this container, so the panel is empty here)', 'inside']]); await shot('09-screen'); await reset();
  /* 10 calendar + agenda */
  await say('schedule dentist tomorrow at 3 pm', 3500); await label(page, 'CALENDAR WRITES', [['.card[data-id=cal]', 1, '"schedule dentist tomorrow at 3 pm" · written to your ICS file or CalDAV calendar', 'right'], ['#reply', 2, 'Confirmation spoken back', 'above']]); await shot('10-calendar'); await reset();
  /* 11 custom widget by the brain */
  await say('create a widget that shows my task count', 9000); await label(page, 'WIDGETS DESIGNED BY THE BRAIN', [['#reply', 1, '"create a widget that shows my task count" · the brain writes a sandboxed widget, it is mounted in the ring with live data', 'above'], ['#nodes', 2, 'New node appears in the ring', 'nobox']]); await shot('11-custom-widget'); await say('delete widget task count', 2000); await reset();
  /* 12 plugin store in terminal */
  await say('plugin store', 3500); await label(page, 'PLUGIN STORE', [['.card[data-id=tty]', 1, '"plugin store" · catalog listed in the terminal; "install plugin countdown" installs by voice; also in the control panel', 'right']]); await shot('12-plugin-store'); await reset();
  /* 13 shapes */
  await say('make a heart', 4500); await label(page, 'PARTICLE SHAPES', [['#core', 1, '"make a heart" · sphere, galaxy, heart, knot, helix, cube, ring, wave, any spelled word', 'nobox']]); await shot('13-shape-heart'); await say('sphere', 2000); await reset();
  /* 14 alert */
  await say('alert demo', 3000); await label(page, 'SECURITY ALERT', [['#alert', 1, 'Failed logins raise an alert: red nebula, glitch, block the address at the firewall or dismiss', 'above']]); await shot('14-alert'); await page.evaluate(() => { const b = document.getElementById('alertDismiss'); b && b.click(); }); await reset();
  /* 15 looks */
  await say('cinema look', 3000); await label(page, 'CINEMA LOOK', [[[700, 980, 520, 40], 1, '"cinema look" · letterbox, grain, warm vignette · "retro look" for CRT scanlines', 'inside']]); await shot('15-look-cinema'); await say('retro look', 3000); await label(page, 'RETRO LOOK', [[[700, 980, 520, 40], 1, '"retro look" · CRT scanlines and colour fringing', 'inside']]); await shot('16-look-retro'); await say('normal look', 2000); await reset();
  /* 17 big text */
  await say('bigger text', 3000); await label(page, 'ACCESSIBILITY', [['#reply', 1, '"bigger text" · big-text mode, screen-reader labels, high-contrast theme', 'above']]); await shot('17-big-text'); await say('normal text', 2000); await reset();
  /* 18 tracking overlay */
  await say('find my phone', 9000); await label(page, 'FIND MY PHONE', [[[600, 90, 720, 50], 1, '"find my phone" · TRACKING overlay over Google Find My Device in the agent browser; "ring my phone" rings the companion page and pushes an alarm', 'inside']]); await shot('18-find-my-phone'); await say('stop tracking', 2000); await reset();
  /* 19 themes already in screenshot-themes.png; 20 ambient */
  await say('ambient', 4000); await label(page, 'AMBIENT LAYOUT', [['#core', 1, '"ambient" · core only, free roaming when idle, photo slideshow behind', 'nobox']]); await shot('19-ambient'); await reset();
  /* companion phone page */
  const phone = await ctx.newPage(); await phone.setViewportSize({ width: 430, height: 900 });
  await phone.goto('http://127.0.0.1:8080/jarvis-interface.html?companion=1&gl=off', { waitUntil: 'domcontentloaded', timeout: 90000 }); await wait(9000);
  await label(phone, 'PHONE COMPANION', [[[10, 60, 300, 40], 1, 'Installable as an app: phone speech recognition, replies on the phone, PC or both, ring and locate from the HUD', 'inside']]);
  await phone.screenshot({ path: P('20-phone-companion'), timeout: 180000 }); console.log('20'); await phone.close();
  /* control panel */
  const pp = await ctx.newPage(); await pp.setViewportSize({ width: 1400, height: 1000 }); await pp.goto('http://127.0.0.1:9000/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await wait(5000);
  const cards = await pp.evaluate(() => [...document.querySelectorAll('.card')].map((c, i) => { c.id = c.id || ('card' + i); return [c.id, c.querySelector('h2') ? c.querySelector('h2').textContent.trim() : '']; }));
  const find = t => (cards.find(c => c[1].toUpperCase().includes(t)) || [])[0];
  const items = [['SERVICES', 'Start, stop, restart, fix each sidecar; watchdog; start with boot; LAN mode'], ['AUTO-TUNE', 'Hardware profile: 3D quality, Whisper size, startup profile, governor'], ['LOGS', 'Per-service logs'], ['DOCTOR', '24 checks with auto-fix; install voices, wake word, Whisper'], ['CLAUDE', 'Sign in to Claude Code and Gemini CLI with your subscription'], ['PHONE', 'QR pairing, ring / locate, https on the LAN'], ['PREMIUM', 'ElevenLabs, OpenAI, Cartesia, Azure keys'], ['BACKUP', 'Backup, restore, log bundle, self-update'], ['FORGE', 'SAMURAI rebuilds its own code with Claude Code; review, apply, discard'], ['CLAUDE TOOLS', 'MCP tools for Claude Code, cost meter + budget, missions'], ['CONFIG', 'Your name, location, widget sources, secrets to the keychain']];
  const lab = items.map((it, i) => find(it[0]) ? ['#' + find(it[0]), i + 1, it[1], 'inside'] : null).filter(Boolean);
  await label(pp, 'CONTROL PANEL', lab); await pp.screenshot({ path: P('21-control-panel'), fullPage: true, timeout: 180000 }); console.log('21'); await pp.close();
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
