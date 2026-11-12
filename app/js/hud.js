/* SAMURAI HUD v3 — state machine, layout, boot, focus / fly-in, settings drawer, commands, voice wiring. */
(function (SAM) {
  const core = SAM.core, voice = SAM.voice, brain = SAM.brain, widgets = SAM.widgets, W = widgets.W, NODE = widgets.NODE;
  const $ = id => document.getElementById(id), esc = widgets.esc;
  const ACTION_URL = SAM.H + ':9300/action', ADDONS = SAM.H + ':9500';
  const MODES = { idle: ['IDLE', 'awaiting command', '#2ee6ff'], listening: ['LISTENING', 'say "samurai" + command', '#d9f8ff'], thinking: ['PROCESSING', 'neural core', '#a07cff'], speaking: ['SPEAKING', 'neural voice', '#2ee6ff'], alert: ['ALERT', 'security watch · high', '#ff3d6e'], boot: ['BOOT', 'initialising', '#6a8ea3'] };
  const BOOT = ['mounting telemetry sidecar :8765', 'voice model vosk ready', 'neural core linked', 'action server :9300 armed', 'add-ons · 12 pinned', 'assembling HUD'];
  const DEMO = new URLSearchParams(location.search).has('demo'), SKIPBOOT = new URLSearchParams(location.search).has('skipboot');
  const SAVE_KEY = 'samurai.hud3';

  const S = {
    mode: 'boot', layout: 'focus', pinned: Object.fromEntries(W.map(w => [w.id, w.pin === false ? 0 : 1])), focus: null, drawer: false,
    assembled: false, stagger: false, blink: false, tick: 0, flow: false, vw: 1920, vh: 1080, scale: 1, cols: 3, k: .5,
    parallax: true, particles: true, idleMorph: true, wander: true, gl: 'auto', glQuality: 'medium', glUser: false, fx: true, presence: false, avatar: 'orb', faceStyle: 'soft', vrm: '', skin: 'glass', font: 'michroma', deskRot: 0, micKill: false, depth: true, presenceCam: '', governor: true, tune: null, gpuWarning: '', theme: 'arc', custom: { a: '#2ee6ff', b: '#a07cff' }, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    typing: null, speakGen: 0, lastAlertSource: null, pendingConfirm: null, wakeArmed: false,
  };
  const stage = $('stage'), root = $('root');
  const timers = []; const T = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };

  /* ---------- persistence ---------- */
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      Object.assign(brain.cfg, s.brain || {}); Object.assign(voice.cfg, s.voice || {});
      if (s.ui) { S.layout = s.ui.layout || 'focus'; Object.assign(S.pinned, s.ui.pinned || {}); S.parallax = s.ui.parallax ?? true; S.particles = s.ui.particles ?? true; S.idleMorph = s.ui.idleMorph ?? true; S.theme = s.ui.theme || 'arc'; S.custom = s.ui.custom || S.custom; S.gl = s.ui.gl || 'auto'; S.look = s.ui.look || 'none'; S.glUser = !!s.ui.glUser; S.bigtext = !!s.ui.bigtext; S.avatar = s.ui.avatar === 'face' ? 'bot' : (s.ui.avatar || 'orb'); S.faceStyle = s.ui.faceStyle || 'soft'; S.vrm = s.ui.vrm || ''; S.skin = s.ui.skin || 'glass'; S.font = s.ui.font || 'michroma'; S.micKill = !!s.ui.micKill; S.depth = s.ui.depth ?? true; S.gestures = !!s.ui.gestures; S.room = s.ui.room || ''; S.quietMode = s.ui.quietMode ?? true; applySkin(); if (S.bigtext) document.documentElement.classList.add('bigtext'); S.presenceCam = s.ui.presenceCam || ''; S.governor = s.ui.governor ?? true; S.glQuality = s.ui.glQuality || 'medium'; S.fx = s.ui.fx ?? true; S.presence = !!s.ui.presence; S.proactive = !!s.ui.proactive; S.wander = s.ui.wander ?? true; }
      // migrate the v2 page's provider settings once
      if (!s.brain) { const old = JSON.parse(localStorage.getItem('samuraiLLM') || 'null'); if (old) { const map = { local: 'ollama', openai: 'openai', claude: 'claude', gemini: 'gemini', claudecode: 'claudecode', geminicli: 'geminicli' }; brain.cfg.provider = map[old.provider] || 'ollama'; Object.assign(brain.cfg.keys, old.keys || {}); for (const [k, v] of Object.entries(old.models || {})) if (v) brain.cfg.models[map[k] || k] = v; } }
    } catch (e) { }
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ brain: brain.cfg, voice: voice.cfg, ui: { layout: S.layout, pinned: S.pinned, parallax: S.parallax, particles: S.particles, idleMorph: S.idleMorph, theme: S.theme, custom: S.custom, look: S.look, gl: S.gl, glUser: S.glUser, bigtext: S.bigtext, avatar: S.avatar, faceStyle: S.faceStyle, vrm: S.vrm, skin: S.skin, font: S.font, micKill: S.micKill, depth: S.depth, gestures: S.gestures, room: S.room, quietMode: S.quietMode, presenceCam: S.presenceCam, governor: S.governor, glQuality: S.glQuality, fx: S.fx, presence: S.presence, proactive: S.proactive, wander: S.wander } })); } catch (e) { } }

  /* ---------- mode / core ---------- */
  function setMode(m) {
    if (S.mode === m) return;
    S.mode = m; core.mode = m; stage.dataset.mode = m;
    const [l, sub, col] = MODES[m] || MODES.idle;
    $('stateLabel').textContent = l; $('stateLabel').style.color = col; $('stateLabel').style.textShadow = `0 0 16px ${col}`;
    $('stateSub').textContent = m === 'speaking' ? `neural voice · ${(voice.cfg.neuralVoice.split('-')[2] || 'aria').replace('Neural', '')}` : sub;
    $('pillMic').textContent = m === 'listening' ? 'MIC · HOT' : (voice.micOn ? 'MIC · OPEN' : 'MIC · ARMED');
    $('alertPulse').classList.toggle('hidden', m !== 'alert'); $('alert').classList.toggle('hidden', m !== 'alert');
    eyes(); SAM.face && SAM.face.mode(m);
  }
  function eyes() { core.eyes($('eyeL'), $('eyeR'), S.mode, S.blink, S.tick); }
  function blinkLoop() { T(() => { S.blink = true; eyes(); T(() => { S.blink = false; eyes(); }, 110); blinkLoop(); }, 2800 + Math.random() * 3200); }
  function log(cls, msg) { widgets.pushTty((cls === 'warn' ? '! ' : '') + msg, cls === 'warn' ? '#ff3d6e' : cls === 'ok' ? '#2ee6ff' : '#a9cfe0'); }

  /* ---------- boot ---------- */
  function boot() {
    timers.splice(0).forEach(clearTimeout);
    S.assembled = false; S.stagger = false; S.focus = null; setMode('boot'); setReply(''); $('transcript').textContent = '';
    $('bootWrap').classList.remove('off'); $('bootLog').innerHTML = ''; $('bootBar').style.width = '0%'; $('bootPct').textContent = '0';
    applyLayout();
    if (!SKIPBOOT) BOOT.forEach((l, i) => T(() => { $('bootLog').insertAdjacentHTML('beforeend', `<div>▸ ${l}</div>`); const pct = Math.round((i + 1) / BOOT.length * 100); $('bootBar').style.width = pct + '%'; $('bootPct').textContent = pct; }, 400 + i * 330));
    const end = SKIPBOOT ? 0 : 400 + BOOT.length * 330 + 250;                                   // ?skipboot=1 (tests): straight to idle
    T(() => $('bootWrap').classList.add('off'), end);
    T(() => { setMode('idle'); S.assembled = true; S.stagger = true; applyLayout(); $('welcome').classList.remove('hidden'); }, end + 700);
    T(() => { S.stagger = false; applyLayout(); }, end + 2600);
    T(() => $('welcome').classList.add('hidden'), end + 3900);
  }

  /* ---------- layout: slots, fly, halo, flow ---------- */
  const FOCUS_SET = { sys: 1, cal: 1, task: 1, wx: 1, mus: 1, home: 1 };     // the calmer default: six widgets, six docked in the ring
  function applyLayout() {
    const wall = S.layout === 'wall', desk = S.layout === 'desk', ambient = S.layout === 'ambient' || wall, focusMode = S.layout === 'focus';
    stage.classList.toggle('calm', focusMode || ambient); stage.classList.toggle('wall', wall); stage.classList.toggle('desk', desk); SAM.face && SAM.face.apply();
    const deskList = desk ? W.filter(w => S.pinned[w.id] && w.pin !== false) : [];
    W.forEach((w, i) => {
      const slot = document.querySelector(`.slot[data-id=${w.id}]`), fly = document.querySelector(`.fly[data-id=${w.id}]`), node = document.querySelector(`.node[data-id=${w.id}]`);
      const docked = ambient || !S.pinned[w.id] || (focusMode && !FOCUS_SET[w.id]), focused = S.focus === w.id;
      if (desk && !focused && !docked && !S.flow) {                        // holographic desk: pinned widgets on a curved 3D wall around the orb
        slot.classList.remove('docked'); fly.classList.remove('focus', 'dim'); slot.style.left = w.x + 'px'; slot.style.top = w.y + 'px';
        const k = deskList.indexOf(w), n = deskList.length, a = ((k - (n - 1) / 2) * (n > 8 ? 20 : 26) + S.deskRot) * Math.PI / 180;
        const tx = 960 + Math.sin(a) * 1180 - (w.x + 136), ty = 300 + Math.abs(Math.sin(a)) * 90 - (w.y + 125), tz = Math.cos(a) * 520 - 820;
        fly.style.cssText = `transform:perspective(1500px) translate3d(${tx.toFixed(0)}px,${ty.toFixed(0)}px,${tz.toFixed(0)}px) rotateY(${(-a * 180 / Math.PI).toFixed(1)}deg);opacity:${.55 + .45 * Math.cos(a)};visibility:${Math.abs(a) > 1.9 ? 'hidden' : 'visible'};z-index:${Math.round(40 + Math.cos(a) * 20)}`;
        node.classList.remove('docked', 'focused'); return;
      }
      node.classList.toggle('docked', docked && !focused); node.classList.toggle('focused', focused);
      if (S.flow) {
        slot.style.left = slot.style.top = '';
        slot.classList.toggle('docked', docked && !focused); fly.style.cssText = ''; fly.classList.toggle('focus', focused); fly.classList.toggle('dim', !!S.focus && !focused);
        if (focused) { const fs = Math.max(1, Math.min(2.2, (S.vw - 24) / 300, (S.vh - 180) / 250)); fly.style.transform = `scale(${fs})`; }
        return;
      }
      slot.classList.remove('docked'); fly.classList.remove('focus', 'dim'); slot.style.left = w.x + 'px'; slot.style.top = w.y + 'px';
      if (w.big && !focused) { slot.classList.remove('big'); slot.style.width = slot.style.height = ''; }
      const cx = w.x + 136, cy = w.y + 125, [nx, ny] = NODE(w.node); let st;
      if (!S.assembled) st = `transform:perspective(1400px) translate(${960 - cx}px,${470 - cy}px) rotateY(0deg) scale(.1);opacity:0;visibility:hidden;transition:none`;
      else if (focused && w.big) {                                   // video / browser: a real-size panel, no upscaling, so frames stay crisp
        const cine = w.id === 'vid' && widgets.data.video.cinema, pw = cine ? 1700 : 1320, ph = cine ? 956 : 780;
        slot.classList.add('big'); slot.style.width = pw + 'px'; slot.style.height = ph + 'px'; slot.style.left = (960 - pw / 2) + 'px'; slot.style.top = ((cine ? 540 : 500) - ph / 2) + 'px';
        st = `z-index:60;transform:none;opacity:1;visibility:visible`;
      }
      else if (focused) { st = `z-index:60;transform:perspective(1400px) translate(${960 - cx}px,${482 - cy}px) rotateY(0deg) scale(2.2);opacity:1;visibility:visible`; }
      else if (docked) st = `transform:perspective(1400px) translate(${nx - cx}px,${ny - cy}px) rotateY(0deg) scale(.08);opacity:0;visibility:hidden`;
      else st = `transform:perspective(1400px) translate(0px,0px) rotateY(${w.side === 'L' ? 9 : -9}deg) scale(1);opacity:${S.focus ? .22 : 1};filter:${S.focus ? 'blur(1px)' : 'none'};visibility:visible;transition-delay:${S.stagger ? i * 70 : 0}ms`;
      fly.style.cssText = st;
    });
    $('backdrop').classList.toggle('hidden', !S.focus);
    if (SAM.fx) SAM.fx.slideshow(ambient && !S.focus);
    document.querySelectorAll('.sbtn.lay').forEach(b => b.classList.toggle('on', b.dataset.l === S.layout));
    document.querySelectorAll('.drawer .sbtn.lay').forEach(b => b.classList.toggle('on', b.dataset.l === S.layout));
  }
  function setFocus(id) { S.focus = S.focus === id && id !== null ? null : id; SAM.face && SAM.face.glance(S.focus); if (S.focus === 'map') setTimeout(() => widgets.mapShow(), 200); if (S.focus && S.flow) document.querySelector(`.slot[data-id=${S.focus}]`).classList.remove('docked'); applyLayout(); }
  function onResize() {
    const vw = innerWidth, vh = innerHeight, scale = Math.min(vw / 1920, vh / 1080), flow = scale < .75;
    S.vw = vw; S.vh = vh; S.scale = scale; S.flow = flow; S.cols = vw < 600 ? 1 : vw < 1000 ? 2 : 3; S.k = Math.max(.35, Math.min(.75, (vw - 24) / 760));
    root.classList.toggle('flow', flow); root.classList.toggle('narrow', vw < 600);
    core.flowStep = flow && vw < 700 ? 2 : 1;
    const lc = $('layerC');
    if (flow) {
      $('scaler').style.transform = ''; ['layerL', 'layerR', 'bg'].forEach(i => $(i).style.transform = '');
      lc.style.cssText = `transform:scale(${S.k});margin-left:${vw / 2 - 960}px;margin-top:${-(470 - 380 * S.k) + 6}px;margin-bottom:${-(610 - 380 * S.k) + 6}px`;
      ['layerL', 'layerR'].forEach(i => $(i).style.gridTemplateColumns = `repeat(${S.cols},minmax(0,1fr))`);
    } else { $('scaler').style.transform = `scale(${scale})`; lc.style.cssText = ''; ['layerL', 'layerR'].forEach(i => $(i).style.gridTemplateColumns = ''); }
    applyLayout();
  }
  function onMove(e) {
    if (S.flow || !S.parallax || S.reduced) return;
    const nx = (e.clientX / innerWidth - .5) * 2, ny = (e.clientY / innerHeight - .5) * 2;
    $('layerL').style.transform = $('layerR').style.transform = `translate(${nx * 10}px,${ny * 8}px)`;
    $('layerC').style.transform = `translate(${-nx * 14}px,${-ny * 10}px)`; $('bg').style.transform = `translate(${nx * 18}px,${ny * 12}px)`;
  }

  /* ---------- orb wander: in idle the avatar drifts on every axis (x, y, depth, tilt) and its eyes glance around;
     it eases back to the centre whenever it listens, thinks, speaks or a widget is focused ---------- */
  /* the avatar roams the whole stage when idle: it picks a waypoint anywhere, glides there with a little banking,
     drifts on every axis on the way, glances where it is going, and bounces to the music when something is playing */
  const WD = { x: 0, y: 0, vx: 0, vy: 0, s: 1, rx: 0, ry: 0, rz: 0, gx: 0, gy: 0, sh: 0, wx: 0, wy: 0, nextWp: 0, beat: 0, bob: 0 };
  function pickWaypoint(t) {
    const flow = S.flow, R = flow ? 0.35 : faceOn() ? 0.15 : 1;                                   // a face (opaque panel or bust) only drifts a little around its spot
    WD.wx = (Math.random() * 2 - 1) * 600 * R; WD.wy = (Math.random() * 2 - 1) * 290 * R;     // anywhere on the stage, clear of the console
    WD.nextWp = t + 5 + Math.random() * 7;
  }
  const faceOn = () => !!(SAM.face && SAM.face.effective() !== 'orb');
  function wanderFrame(ts) {
    const t = ts / 1000, showcase = core.showcase(), playing = widgets.data.music.now.playing, face = faceOn();
    const idle = S.wander && !S.reduced && S.mode === 'idle' && !S.focus && !S.drawer && !showcase;
    if (face) { if (Math.abs(WD.wx) > 130 || Math.abs(WD.wy) > 70) { WD.wx *= .2; WD.wy *= .2; } WD.x = Math.max(-110, Math.min(110, WD.x)); WD.y = Math.max(-60, Math.min(60, WD.y)); }   // the face came on mid-trip: shorten the waypoint and keep the panel by its spot
    WD.sh += ((showcase ? 1 : 0) - WD.sh) * .05;       // a commanded shape is on display: orb shrinks and stays centred so the shape reads
    if (idle) { if (t > WD.nextWp) pickWaypoint(t); }
    else { WD.wx = WD.wy = 0; WD.nextWp = t + 2; }
    const dx = WD.wx + (idle ? 40 * Math.sin(t * .53 + 1.3) : 0) - WD.x, dy = WD.wy + (idle ? 24 * Math.sin(t * .41 + .4) : 0) - WD.y;
    const acc = idle ? .0022 : .006, damp = idle ? .96 : .86;
    WD.vx = (WD.vx + dx * acc) * damp; WD.vy = (WD.vy + dy * acc) * damp; WD.x += WD.vx; WD.y += WD.vy;
    const speed = Math.hypot(WD.vx, WD.vy);
    const tsc = idle ? 1 + .08 * Math.sin(t * .13 + 2) : 1;
    const tilt = idle && !face;                                                                      // the faces stay upright: no banking for the panel or the bust
    const trx = tilt ? 9 * Math.sin(t * .19 + .7) - WD.vy * 3 : 0, tryy = tilt ? 12 * Math.sin(t * .23 + 1.9) + WD.vx * 3 : 0, trz = tilt ? WD.vx * 4 : 0;
    WD.s += (tsc - WD.s) * .05; WD.rx += (Math.max(-18, Math.min(18, trx)) - WD.rx) * .05; WD.ry += (Math.max(-22, Math.min(22, tryy)) - WD.ry) * .05; WD.rz += (Math.max(-14, Math.min(14, trz)) - WD.rz) * .05;
    if (face) WD.rx = WD.ry = WD.rz = 0;                                                             // a face switched on mid-bank stands up straight at once
    const look = t < (WD.lookUntil || 0);
    const gx = look ? WD.lookX : idle ? Math.max(-9, Math.min(9, dx * .03)) + 4 * Math.sin(t * .9) : 0, gy = look ? WD.lookY : idle ? Math.max(-6, Math.min(6, dy * .03)) + 2 * Math.sin(t * .7 + 2) : 0;
    WD.gx += (gx - WD.gx) * .08; WD.gy += (gy - WD.gy) * .08;
    /* music: a bounce on every beat, a little sway, the ring pumps too */
    const lvl = playing ? widgets.musicLevel() : 0; WD.beat += (lvl - WD.beat) * (lvl > WD.beat ? .5 : .12);
    WD.bob = playing ? WD.bob * .9 + Math.sin(t * 4.2) * 2 : WD.bob * .9;
    core.musicLevel = WD.beat;
    const bs = 1 + .16 * WD.beat, by = -22 * WD.beat + WD.bob, bz = (playing ? 6 * Math.sin(t * 2.1) : 0);
    const anchor = document.querySelector('.orbAnchor'), eyes = document.querySelector('.eyes');
    WD.ox = WD.x; WD.oy = WD.y + by; WD.os = WD.s * bs * (1 - .42 * WD.sh);
    if (anchor) anchor.style.transform = `perspective(900px) translate3d(${WD.x.toFixed(1)}px,${(WD.y + by).toFixed(1)}px,0) rotateX(${WD.rx.toFixed(1)}deg) rotateY(${WD.ry.toFixed(1)}deg) rotateZ(${(WD.rz + bz).toFixed(1)}deg) scale(${(WD.s * bs * (1 - .42 * WD.sh)).toFixed(3)})`;
    if (eyes) eyes.style.transform = `translate(${WD.gx.toFixed(1)}px,${(WD.gy - 3 * WD.beat).toFixed(1)}px) scaleY(${(1 - .25 * WD.beat).toFixed(2)})`;
    requestAnimationFrame(wanderFrame);
  }
  requestAnimationFrame(wanderFrame);

  /* ---------- reply / speech ---------- */
  function setReply(t) { $('reply').textContent = t; }
  function say(text, focus, opts = {}) {
    clearInterval(S.typing); const gen = ++S.speakGen;
    if (focus !== undefined) { S.focus = focus; applyLayout(); }
    setMode('speaking'); setReply(''); SAM.face && SAM.face.set(opts.emotion || SAM.face.guess(text), opts.hold);   // the reply's face: from the brain, a route, or a guess
    let i = 0, typingDone = false, audioDone = false, settled = false;
    const finish = () => { if (settled || !(typingDone && audioDone) || gen !== S.speakGen) return; settled = true; setReply(text); T(() => { if (gen === S.speakGen && S.mode === 'speaking') setMode(voice.micOn ? 'listening' : 'idle'); opts.after && opts.after(); }, opts.quick ? 400 : 2400); };
    const startTyping = () => {                                            // generation-safe: a late audio start from an older reply can never type over a newer one
      if (i || gen !== S.speakGen) return; clearInterval(S.typing);
      const iv = setInterval(() => { if (gen !== S.speakGen) { clearInterval(iv); return; } i++; setReply(text.slice(0, i)); if (i >= text.length) { clearInterval(iv); typingDone = true; setReply(text); finish(); } }, 22); S.typing = iv;
    };
    T(startTyping, 350);                                     // start typing even if audio is slow
    voice.speak(text, { onstart: startTyping, onend: () => { audioDone = true; finish(); } });
    return new Promise(r => { const chk = setInterval(() => { if (settled || gen !== S.speakGen) { clearInterval(chk); r(); } }, 100); });
  }
  voice.onInterrupt = () => { clearInterval(S.typing); S.speakGen++; if (S.mode === 'speaking') setMode(voice.micOn ? 'listening' : 'idle'); };
  /* streaming reply: text types in as it arrives, each finished sentence is spoken right away */
  function sayStream() {
    clearInterval(S.typing); const gen = ++S.speakGen;
    let target = '', shown = '', spoken = 0, pending = 0, ended = false, settled = false, started = false;
    const SENT = /[^.!?\n]+[.!?]+["')\]]?(?:\s+|$)|[^.!?\n]+\n/g;
    const finish = () => { if (settled || !ended || pending || shown.length < target.length || gen !== S.speakGen) return; settled = true; setReply(target); T(() => { if (gen === S.speakGen && S.mode === 'speaking') setMode(voice.micOn ? 'listening' : 'idle'); }, 1800); };
    const speakChunk = text => { text = text.trim(); if (!text) return; pending++; voice.speak(text, { onend: () => { pending--; finish(); } }); };
    const flush = all => {
      const rest = target.slice(spoken); SENT.lastIndex = 0; let m, upto = 0;
      while ((m = SENT.exec(rest)) !== null) upto = m.index + m[0].length;
      if (all) upto = rest.length;
      if (upto > 0 && (all || rest.slice(0, upto).trim().length > 12 || /[.!?]\s*$/.test(rest.slice(0, upto)))) { speakChunk(rest.slice(0, upto)); spoken += upto; }
    };
    const startTyping = () => { if (started) return; started = true; setMode('speaking'); setReply(''); SAM.face && SAM.face.set(SAM.face.guess(target)); S.typing = setInterval(() => { if (gen !== S.speakGen) { clearInterval(S.typing); return; } if (shown.length < target.length) { shown = target.slice(0, shown.length + 1); setReply(shown); } else if (ended) { clearInterval(S.typing); finish(); } }, 22); };
    return {
      push(text) { if (gen !== S.speakGen || !text) return; target = text; startTyping(); flush(false); },
      end(text, emotion, hold) { if (gen !== S.speakGen) return; if (text != null) target = text; startTyping(); if (emotion && SAM.face) SAM.face.set(emotion, hold); ended = true; flush(true); if (!target) { settled = true; setMode(voice.micOn ? 'listening' : 'idle'); } },
      active: () => gen === S.speakGen && started,
    };
  }

  /* ---------- commands ---------- */
  const SHAPES = [[/\b(heart|love)\b/, 'heart', 'Heart, as requested.'], [/\b(cube|box)\b/, 'cube', 'Cube.'], [/\b(galaxy|spiral|stars|milky way)\b/, 'galaxy', 'One galaxy, three arms.'], [/\b(helix|dna)\b/, 'helix', 'Double helix.'], [/\b(knot|not|naught)\b/, 'knot', 'Torus knot.'], [/\b(ring|halo|torus|donut)\b/, 'ring', 'Ring.'], [/\b(wave|waves|ocean|ripple|sea)\b/, 'wave', 'Wave field.'], [/\b(sphere|cloud|particles|ball|normal)\b/, 'sphere', 'Back to the cloud.']];
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90 };
  function quickRoute(q) {
    q = q.replace(/\bwire frame\b/g, 'wireframe').replace(/\bcount down\b/g, 'countdown').replace(/\bthe mike\b/g, 'the mic').replace(/\bplug in\b/g, 'plugin').replace(/\bhand off\b/g, 'hand off');   // recogniser spellings
    const has = (...k) => k.some(x => q.includes(x));
    if (/^(alert demo|alert|threat|intrusion|breach)$/.test(q)) return { alert: true };
    if (/^(reboot|restart hud|restart samurai|reboot samurai)$/.test(q)) return { reboot: true };
    if (/\b(make|show|draw|form|become|turn into|shape|give me|build|morph|back to|go back|reset|switch to|change to)\b/.test(q) || /^(a |an |the )?(double |big |nice )?(heart|cube|galaxy|helix|dna|knot|ring|wave|sphere|ball|box|torus)( please| now)?$/.test(q)) for (const [re, name, text] of SHAPES) if (re.test(q)) return { shape: name, text };
    if (/^(next shape|another shape|something else|surprise me)$/.test(q)) return { text: 'How about this.', effect: () => core.nextShape(true) };
    const sp = q.match(/\b(?:spell|write|text|type)\s+(.{1,12}?)\s*$/); if (sp) { const w = sp[1].toUpperCase(); return { shape: 'text:' + w, text: `Spelling ${w}.` }; }
    if (/^(ambient|ambient mode|ambient layout)$/.test(q)) return { text: 'Ambient mode. Widgets stay docked in the ring until you ask for them.', effect: () => { S.layout = 'ambient'; save(); applyLayout(); } };
    if (has('full layout', 'show all', 'full mode', 'show everything', 'dashboard mode')) return { text: 'Full layout restored.', effect: () => { S.layout = 'full'; save(); applyLayout(); } };
    if (/^(focus layout|focus mode layout|calm (mode|layout)|less widgets|fewer widgets|declutter)$/.test(q)) return { text: 'Focus layout. Six widgets, the rest wait in the ring.', effect: () => { S.layout = 'focus'; save(); applyLayout(); } };
    const pl = q.match(/^(?:plan|make a plan|do all this|multi ?step)[:,]?\s+(.{4,})$/); if (pl) return { plan: pl[1] };
    const th = q.match(/^(?:(?:set |switch |change )?(?:the )?(?:theme|colou?rs?|skin)(?: to)? |go )([a-z]+)(?: theme| mode| colou?rs?)?$/) || q.match(/^([a-z]+) theme$/) || q.match(/^the ([a-z]+)$/);
    const THEME_ALIAS = { ark: 'arc', arch: 'arc', art: 'arc', read: 'crimson', bread: 'crimson', amber: 'ember', embers: 'ember', eyes: 'ice', iced: 'ice', golden: 'gold', green: 'matrix', blue: 'ocean', red: 'crimson', pink: 'rose', purple: 'nebula', violet: 'nebula', orange: 'sunset', yellow: 'solar', white: 'mono', grey: 'stealth', gray: 'stealth', dark: 'stealth', teal: 'aurora', indigo: 'royal' };
    if (th && THEME_ALIAS[th[1]]) th[1] = THEME_ALIAS[th[1]];
    if (th && (th[1] in THEMES) && th[1] !== 'custom') return { text: `${th[1]} theme.`, effect: () => { applyTheme(th[1]); save(); } };
    if (/^(random|next|another|surprise) (theme|colou?rs?|skin)$/.test(q)) return { text: 'New colours.', effect: () => { const names = Object.keys(THEMES).filter(n => n !== 'custom' && n !== S.theme); applyTheme(names[Math.floor(Math.random() * names.length)]); save(); } };
    const lk = q.match(/^(?:(retro|crt|cinema|film|normal|plain|default) (?:look|filter))$/) || q.match(/^(?:(retro|crt|film|plain) mode)$/) || q.match(/^(?:look|filter) (retro|crt|cinema|film|normal|plain|default)$/);
    if (lk) { const n = /retro|crt/.test(lk[1]) ? 'crt' : /cinema|film/.test(lk[1]) ? 'cinema' : 'none'; return { text: n === 'none' ? 'Clean look.' : `${n === 'crt' ? 'Retro' : 'Cinema'} look.`, effect: () => { SAM.fx && SAM.fx.setLook(n); save(); } }; }
    if (/^(3d (on|core|mode)|go 3d|three d on|enable 3d)$/.test(q)) return { text: '3D core online.', effect: () => { S.gl = 'on'; save(); SAM.gl && !SAM.gl.on && SAM.gl.enable(S.glQuality); } };
    if (/^(3d off|2d (mode|core)|go 2d|disable 3d|flat mode)$/.test(q)) return { text: 'Back to the flat core.', effect: () => { S.gl = 'off'; save(); SAM.gl && SAM.gl.disable(); } };
    if (/^(presence (on|off)|(start|stop) watching( the)?( camera| for me)?|watch for me)$/.test(q)) { const on = !/off|stop/.test(q); return { text: on ? 'Watching for you.' : 'Presence off.', effect: () => { S.presence = on; save(); SAM.fx && SAM.fx.presence(on); } }; }
    if (/^(big(ger)? text( mode)?|large text|text (bigger|larger)|zoom in text)$/.test(q)) return { text: 'Bigger text.', effect: () => { S.bigtext = true; document.documentElement.classList.add('bigtext'); save(); } };
    if (/^(normal text|small(er)? text|text smaller|zoom out text)$/.test(q)) return { text: 'Normal text.', effect: () => { S.bigtext = false; document.documentElement.classList.remove('bigtext'); save(); } };
    if (/^(desk( mode| layout)?|holographic desk|holo desk|3d desk)$/.test(q)) return { text: 'Holographic desk.', effect: () => { S.layout = 'desk'; save(); applyLayout(); } };
    if (/^(wall( mode| layout)?|wallpaper( mode)?|projector mode|living wallpaper)$/.test(q)) return { text: 'Wall mode.', effect: () => { S.layout = 'wall'; save(); applyLayout(); } };
    /* ---- faces: the robot face (pinu-bot), the VRM avatar (three-vrm), emotions and styles ---- */
    if (/^(show (me )?your face|face mode|3d face|put on a face|be a face|robot face|robot mode|be a robot)$/.test(q)) return { text: 'Face on.', effect: () => { S.avatar = 'bot'; save(); applyLayout(); } };
    if (/^(avatar mode|anime (face|mode|avatar)|show (me )?the avatar|use the avatar|vrm (mode|avatar)|be the avatar)$/.test(q)) return { text: 'Avatar on.', effect: () => { S.avatar = 'vrm'; save(); applyLayout(); } };
    if (/^(orb mode|back to the orb|be an orb|hide your face|hide the avatar|no face)$/.test(q)) return { text: 'Back to the orb.', effect: () => { S.avatar = 'orb'; save(); applyLayout(); } };
    const ua = q.match(/^(?:use|wear|load|pick) the avatar (.{2,40})$/); if (ua) return { run: async () => { await SAM.face.listAvatars(); const a = SAM.face.pickAvatar(ua[1]); if (!a) return { text: `I have no avatar called ${ua[1]}. Drop a VRM file into app/avatars.` }; S.avatar = 'vrm'; S.vrm = a.file; save(); applyLayout(); return { text: `Wearing ${a.name}.` }; } };
    const lk2 = q.match(/^(?:look|be|act|feel) (happy|sad|angry|mad|surprised|excited|confused|neutral|loving|in love|thoughtful|thinking)$/); if (lk2) { const e = { mad: 'angry', loving: 'love', 'in love': 'love', thoughtful: 'thinking' }[lk2[1]] || lk2[1]; return { text: ({ happy: 'Happy it is.', sad: 'If you say so.', angry: 'Grr.', surprised: 'Oh!', excited: "Let's go!", confused: 'Hm?', neutral: 'Neutral.', love: 'Aw.', thinking: 'Thinking.' })[e], emotion: e, hold: 8000 }; }   // say() gets the emotion, so the short reply's own guess does not override it
    const fst = q.match(/^(?:face style|face look|robot style) (soft|visor|band)$/); if (fst) return { text: `${fst[1]} face.`, effect: () => { SAM.face && SAM.face.style(fst[1]); save(); } };
    const skq = q.match(/^(glass|wireframe|paper) (skin|look|widgets|cards)$/); if (skq) return { text: `${skq[1]} skin.`, effect: () => { S.skin = skq[1]; save(); applySkin(); } };
    /* ---- brains + voice (v1.6): missions, meter, meeting mode, voice styles, wake phrase, voice identity, full duplex ---- */
    const ms = q.match(/^(?:start|run|launch) (?:a )?mission[:,]? (.{6,400})$/); if (ms) return { run: async () => { try { await ensureService('agent'); const d = await brain.mission(ms[1]); return { focus: 'tty', text: `Mission ${d.id || ''} started. I will keep working on it in the background and tell you when it is done.` }; } catch (e) { return { text: `I could not start the mission: ${String(e.message).replace(/^Error: /, '')}` }; } } };
    if (/^(how (are|is) (my|the) missions?( going)?|mission status|missions)\??$/.test(q)) return { run: async () => { const M = await brain.missions(); M.slice(-5).forEach(m => widgets.pushTty(`⚑ ${m.id} · ${m.running ? 'running' : 'done ' + (m.code === 0 ? 'ok' : 'code ' + m.code)} · ${m.goal.slice(0, 70)}`, '#a07cff')); const run = M.filter(m => m.running); return { focus: 'tty', text: !M.length ? 'No missions yet. Say "start a mission" and a goal.' : run.length ? `${run.length} running: ${run.map(m => m.goal.slice(0, 60)).join('; ')}.` : `Last mission ${M[M.length - 1].code === 0 ? 'finished' : 'stopped'}: ${(M[M.length - 1].summary || M[M.length - 1].goal).slice(0, 200)}` }; } };
    if (/^(stop|abort|cancel) (the |my )?mission$/.test(q)) return { run: async () => { try { await brain.missionStop(); return { text: 'Mission stopped.' }; } catch (e) { return { text: 'No mission is running.' }; } } };
    if (/^(what (did|have) i spen[dt]|how much (did|have) i spen[dt]|usage|ai (usage|spend|cost)|token (usage|meter))( this month| today)?\??$/.test(q)) return { run: async () => { const u = await brain.usage(/today/.test(q) ? 'day' : 'month'); if (!u) return { text: 'The meter is not available.' }; Object.entries(u.by_provider || {}).forEach(([k, v]) => widgets.pushTty(`meter · ${k} · $${(v.usd || v.total_usd || 0).toFixed(3)} · ${v.calls || 0} calls`, '#a07cff')); return { focus: 'tty', text: u.spoken || `About ${u.total_usd.toFixed(2)} dollars over ${u.calls} calls.` }; } };
    const bg = q.match(/^(?:set (?:my|the) (?:monthly )?(?:ai )?budget to|budget) \$?(\d+(?:\.\d+)?) ?(?:dollars|usd)?$/); if (bg) return { text: `Budget set to ${bg[1]} dollars a month. I will warn you at eighty percent.`, effect: () => fetch(ADDONS + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meter: { monthly_budget_usd: +bg[1] } }) }).catch(() => { }) };
    if (/^meeting mode on$|^(start|begin) (the |a )?(meeting|transcript)$/.test(q)) return { text: 'Meeting mode. I am transcribing and staying quiet; say "meeting mode off" for the summary.', effect: () => { S.meeting = true; document.documentElement.classList.add('meeting'); if (!voice.micOn) voice.start(); voice.meeting(true); widgets.pushTty('meeting · transcribing', '#ffb84d'); } };
    if (/^meeting mode off$|^(stop|end) (the )?(meeting|transcript)$/.test(q)) return { run: async () => { const tx = voice.meeting(false) || ''; S.meeting = false; document.documentElement.classList.remove('meeting'); if (!tx.trim()) return { text: 'Meeting over. Nothing was transcribed.' }; widgets.pushTty(`meeting · ${tx.split('\n').length} lines`, '#ffb84d'); try { const sum = await brain.summarise(tx, 'a meeting: give a 3 sentence summary, then the decisions, then the action items with owners'); fetch(ADDONS + '/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Meeting summary: ' + sum }) }).catch(() => { }); return { focus: 'task', text: sum.slice(0, 900) }; } catch (e) { return { focus: 'task', text: 'Meeting over. ' + tx.slice(0, 500) }; } } };
    const vst = q.match(/^(?:voice style|speak|talk|sound) (neutral|calm|excited|whisper|whispered|sad|cheerful|serious|normal|auto)(?: from now on)?$/); if (vst) { const st = { normal: '', auto: '', whispered: 'whisper' }[vst[1]] ?? vst[1]; return { text: st ? `${st} it is.` : 'Back to following my mood.', effect: () => { voice.cfg.style = st; save(); } }; }
    const wp = q.match(/^(?:change|set) (?:the |your |my )?wake (?:word|phrase) to (.{2,30})$/) || q.match(/^(?:answer to|respond to|your name is) (.{2,30})$/); if (wp) return { text: `From now on, say "${wp[1]}" to wake me.`, effect: () => { voice.setWakePhrase(wp[1]); save(); } };
    const ve = q.match(/^(?:enrol|enroll|remember|learn) my voice(?: as (.{2,30}))?$/); if (ve) return { text: `Keep talking normally for ten seconds, ${ve[1] || brain.user.name}. I am learning your voice.`, effect: () => { if (!voice.micOn) voice.start(); voice.onEnrolled = d => say(d && d.status === 'ok' ? `Done. I know your voice now, ${ve[1] || brain.user.name}.` : 'Voice enrolment is not available here. Install resemblyzer on the PC.'); T(() => voice.enroll(ve[1] || brain.user.name), 400); } };
    const vi = q.match(/^(?:only (?:obey|listen to) (?:enrolled|known|my) voices?|voice identity|speaker verification|voice lock) (on|off)$/); if (vi) return { text: vi[1] === 'on' ? 'I will only act on enrolled voices.' : 'Listening to everyone again.', effect: () => { voice.cfg.identify = vi[1] === 'on'; voice.identify(voice.cfg.identify); save(); } };
    const fd = q.match(/^(?:full duplex|realtime voice|real time voice|live voice|conversation mode) (on|off)$/); if (fd) return { run: async () => { if (fd[1] === 'off') { voice.realtime.stop(); document.documentElement.classList.remove('realtime'); return { text: 'Back to normal listening.' }; } try { voice.realtime.onCommand = async text => { const out = await submitQuiet(text); return out || 'Done.'; }; voice.realtime.onTranscript = (text, who) => widgets.pushTty(`${who === 'user' ? '>' : '≈'} ${text}`, who === 'user' ? '#6a8ea3' : '#2ee6ff'); await voice.realtime.start(); document.documentElement.classList.add('realtime'); return { text: 'Live voice is on. Talk over me whenever you like.' }; } catch (e) { return { text: `Live voice needs an OpenAI key in the panel: ${String(e.message).slice(0, 80)}` }; } } };
    if (/^(turn on|enable|register|connect) (the )?(mcp|tools for claude|claude tools)$/.test(q)) return { run: async () => { try { await ensureService('agent'); const d = await POSTJ(SAM.H + ':9400/agent/mcp', { on: true }); return { text: `Claude Code can now use my ${(d.tools || []).length || 6} tools: actions, browser, documents, journal, calendar and memory.` }; } catch (e) { return { text: `MCP registration failed: ${String(e.message).slice(0, 100)}` }; } } };
    /* ---- senses: notifications, activity, gestures, faces, rooms, downloads, price watch, devices, sync, plugins ---- */
    if (/^(read|what are|any|show)( my)?( new)? notifications\??$/.test(q)) return { run: async () => { const d = await (await fetch(ADDONS + '/notifications')).json(); const N = d.notifications || []; N.slice(-8).forEach(n => widgets.pushTty(`🔔 ${n.app}: ${n.title} ${n.text}`, '#a07cff')); return { focus: 'msg', text: N.length ? `${N.length} notification${N.length === 1 ? '' : 's'}. ${N.slice(-3).map(n => `${n.app}: ${n.title}${n.text ? ', ' + n.text : ''}`).join('. ').slice(0, 400)}` : (d.source === 'none' ? 'Notification reading is not available on this system.' : 'No new notifications.') }; } };
    if (/^(clear|dismiss)( my| the)? notifications$/.test(q)) return { text: 'Cleared.', effect: () => fetch(ADDONS + '/notifications/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => { }) };
    const rnot = q.match(/^(read|speak|announce) (my )?notifications (aloud )?(on|off)$/); if (rnot) return { text: `Notifications ${rnot[4] === 'on' ? 'will be read aloud' : 'stay silent'}.`, effect: () => fetch(ADDONS + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senses: { read_notifications: rnot[4] === 'on' } }) }).catch(() => { }) };
    if (/^(what am i doing|which app am i in|what's open|what is open)\??$/.test(q)) return { run: async () => { const d = await (await fetch(ADDONS + '/activity')).json(); return { focus: 'sys', text: d.app ? `You are in ${d.app}${d.title ? ', ' + d.title.slice(0, 60) : ''}. I read that as ${d.category}${d.quiet ? ', so I am keeping quiet' : ''}.` : 'I cannot see an active window right now.' }; } };
    const qm = q.match(/^(quiet mode|do not disturb|don't disturb me|interrupt me) (on|off|again)$/); if (qm) { const on = qm[1] === 'interrupt me' ? qm[2] === 'off' : qm[2] === 'on'; return { text: on ? 'I will stay quiet during calls and games.' : 'I will speak up whenever something happens.', effect: () => { S.quietMode = on; save(); if (!on) releaseHeld(); } }; }
    const gm = q.match(/^(hand )?gestures? (on|off)$/); if (gm) return { text: gm[2] === 'on' ? 'Watching your hands. Open palm pauses, fist mutes, thumbs up confirms, point to talk, swipe to skip.' : 'Gestures off.', effect: () => gesturesOn(gm[2] === 'on') };
    const fe = q.match(/^(remember|enrol|enroll|learn) my face as (.{2,30})$/); if (fe) return { focus: 'cam', text: `Look at the camera for two seconds, ${fe[2]}.`, effect: async () => { try { const d = await SAM.faces.enroll(fe[2]); say(d && d.ok !== false ? `Got it. I will know you as ${fe[2]}.` : `I could not enrol a face: ${(d && d.error) || 'camera or face support missing'}.`); } catch (e) { say('Face enrolment needs the camera and the add-ons sidecar.'); } } };
    if (/^(who am i|do you know me|who is this)\??$/.test(q)) return { run: async () => { try { const d = await SAM.faces.who(); return { focus: 'cam', text: d && d.name ? `You are ${d.name}. ${Math.round((d.confidence || 0) * 100)} percent sure.` : d && d.known === false && d.available === false ? 'Face recognition is not installed. Add opencv-contrib-python.' : 'I do not recognise this face yet. Say "remember my face as" and your name.' }; } catch (e) { return { text: 'The camera is not available.' }; } } };
    if (/^forget my face$/.test(q)) return { run: async () => { const names = ((await (await fetch(ADDONS + '/faces')).json()).people || []); for (const n of names) await fetch(ADDONS + '/faces/forget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) }); return { text: names.length ? `Forgotten ${names.join(', ')}.` : 'No faces stored.' }; } };
    const rmn = q.match(/^(?:this is the|call this room|this room is|this is my) (.{2,24})$/); if (rmn) return { text: `This is the ${rmn[1]}.`, effect: () => setRoom(rmn[1]) };
    if (/^(which rooms|list( the)? rooms|where are you)\??$/.test(q)) return { run: async () => { const d = await (await fetch(ADDONS + '/rooms')).json(); const R = d.rooms || []; return { text: R.length ? `${R.length} room${R.length === 1 ? '' : 's'}: ${R.map(r => r.room + (r.online ? '' : ' (offline)')).join(', ')}. Active: ${d.active || 'none'}. This is ${S.room || 'an unnamed room'}.` : 'No rooms registered yet. Say "this is the kitchen" on each HUD.' }; } };
    const ho = q.match(/^(?:hand off to|hand over to|move to|go to|follow me to) the (.{2,24})$/); if (ho) return { run: async () => { try { const d = await POSTJ(ADDONS + '/rooms/handoff', { to: ho[1] }); return { text: `Handing off to the ${d.active}.` }; } catch (e) { return { text: String(e.message || e).replace(/^Error: /, '') }; } } };
    const dl = q.match(/^download (https?:\/\/\S+)$/); if (dl) return { run: async () => { try { const d = await POSTJ(ADDONS + '/download', { url: dl[1] }); return { focus: 'web', text: `Downloading ${d.name || 'it'} to the SAMURAI downloads folder. I will tell you when it is done.` }; } catch (e) { return { text: `I could not start that download: ${e.message}` }; } } };
    if (/^(my )?downloads\??$/.test(q) || /^(how are|show)( my)? downloads( going)?\??$/.test(q)) return { run: async () => { const d = await (await fetch(ADDONS + '/downloads')).json(); const L = d.downloads || []; L.forEach(x => widgets.pushTty(`⬇ ${x.name} · ${Math.round((x.progress || 0) * 100)}% · ${x.state}`, '#a07cff')); return { focus: 'tty', text: L.length ? `${L.length} download${L.length === 1 ? '' : 's'}. ${L.slice(-3).map(x => `${x.name} ${x.state === 'done' ? 'finished' : Math.round((x.progress || 0) * 100) + ' percent'}`).join(', ')}.` : 'No downloads.' }; } };
    if (/^(my )?torrents\??$/.test(q)) return { run: async () => { const d = await (await fetch(ADDONS + '/torrents')).json(); const T = d.torrents || []; T.forEach(t => widgets.pushTty(`⇅ ${t.name} · ${Math.round((t.progress || 0) * 100)}%`, '#a07cff')); return { focus: 'tty', text: !d.configured ? 'Set the qBittorrent web address under market in the config first.' : T.length ? `${T.length} torrent${T.length === 1 ? '' : 's'}. ${T.slice(0, 3).map(t => `${t.name} ${Math.round((t.progress || 0) * 100)} percent`).join(', ')}.` : 'No torrents.' }; } };
    const pw = q.match(/^(?:watch the price of|price watch|track the price of|watch) (https?:\/\/\S+)$/); if (pw) return { run: async () => { try { const d = await POSTJ(ADDONS + '/watch', { url: pw[1] }); return { focus: 'web', text: d.price != null ? `Watching it. It is ${d.currency || ''}${d.price} today. I will tell you when it drops.` : 'Watching it. I could not read a price yet, I will try again in a few hours.' }; } catch (e) { return { text: `I could not add that watch: ${e.message}` }; } } };
    if (/^(my )?price watch(es)?\??$/.test(q) || /^what am i watching\??$/.test(q)) return { run: async () => { const d = await (await fetch(ADDONS + '/watch')).json(); const W = d.watches || []; W.forEach(w => widgets.pushTty(`💸 ${w.label || w.url} · ${w.currency || ''}${w.price ?? '?'}`, '#a07cff')); return { focus: 'tty', text: W.length ? `${W.length} watch${W.length === 1 ? '' : 'es'}. ${W.slice(0, 3).map(w => `${w.label || 'one item'} at ${w.currency || ''}${w.price ?? 'unknown'}`).join(', ')}.` : 'No price watches. Say "watch the price of" and a link.' }; } };
    if (/^(list|show|what are)( my)? (smart )?devices\??$/.test(q) || /^(home|my) devices\??$/.test(q)) return { run: async () => { const d = await (await fetch(ADDONS + '/home2/devices')).json(); const D = d.devices || []; D.forEach(x => widgets.pushTty(`⌂ ${x.name} · ${x.backend} · ${x.on === null ? '?' : x.on ? 'on' : 'off'}`, '#a07cff')); widgets.data.home2 = D; widgets.render('home'); return { focus: 'home', text: D.length ? `${D.length} device${D.length === 1 ? '' : 's'}: ${D.slice(0, 6).map(x => x.name).join(', ')}.` : `No Hue, Govee or Kasa devices found. ${d.note || ''}`.trim() }; } };
    const dv = q.match(/^(?:turn|switch) (on|off) (?:the |my )?(.{2,40})$/); if (dv && ((widgets.data.home2 || []).some(x => x.name.toLowerCase().includes(dv[2]) || dv[2].includes(x.name.toLowerCase())) || !/light|lamp|lock|fan|blind|plug|\bac\b|air con|wifi|wi-fi|bluetooth|vpn|mic|camera|screen|monitor|pc|computer/.test(dv[2]))) return { run: async () => { try { const d = await POSTJ(ADDONS + '/home2', { device: dv[2], on: dv[1] === 'on' }); return { focus: 'home', text: `${d.device || dv[2]} ${dv[1]}.` }; } catch (e) { return { text: String(e.message).replace(/^Error: /, '') }; } } };
    const sc2 = q.match(/^(?:scene|set the scene to|activate scene) (.{2,30})$/); if (sc2) return { run: async () => { try { await POSTJ(ADDONS + '/home2/scene', { scene: sc2[1] }); return { focus: 'home', text: `Scene ${sc2[1]}.` }; } catch (e) { return { text: String(e.message).replace(/^Error: /, '') }; } } };
    const sy = q.match(/^sync (?:my )?settings (?:to|with) (.{2,120})$/); if (sy) return { run: async () => { try { const d = await POSTJ(ADDONS + '/sync', { dir: sy[1] }); return { text: `Settings synced with ${d.dir}. ${d.pushed || 0} pushed, ${d.pulled || 0} pulled.` }; } catch (e) { return { text: `Sync failed: ${e.message}` }; } } };
    if (/^sync (?:my )?settings( now)?$/.test(q)) return { run: async () => { try { const d = await POSTJ(ADDONS + '/sync', {}); return { text: d.dir ? `Synced with ${d.dir}. ${d.pushed || 0} pushed, ${d.pulled || 0} pulled.` : 'Say "sync my settings to" and a folder first.' }; } catch (e) { return { text: `Sync failed: ${e.message}` }; } } };
    if (/^(plugin (store|market|marketplace)|what plugins (are there|can i install)|list plugins)\??$/.test(q)) return { run: async () => { const d = await (await fetch(ADDONS + '/plugins/market')).json(); const P = d.plugins || []; P.forEach(p => widgets.pushTty(`🧩 ${p.name} ${p.version}${p.installed ? ' · installed' : ''} · ${p.description}`, '#a07cff')); return { focus: 'tty', text: P.length ? `${P.length} plugins in the store: ${P.map(p => p.name + (p.installed ? ' (installed)' : '')).join(', ')}. Say "install plugin" and a name.` : 'The store is empty.' }; } };
    const pi = q.match(/^install (?:the )?plugin (.{2,60})$/); if (pi) return { run: async () => { try { const m = await (await fetch(ADDONS + '/plugins/market')).json(); const want = pi[1].toLowerCase().replace(/[\s_-]/g, ''), hit = (m.plugins || []).find(p => p.name.toLowerCase().replace(/[\s_-]/g, '') === want); if (!hit && !/^https?:\/\/|^plugins\//.test(pi[1])) return { text: `There is no plugin called ${pi[1]} in the store.` }; const d = await POSTJ(ADDONS + '/plugins/install', { url: hit ? hit.url : pi[1] }); return { text: `Installed ${d.name || pi[1]}${d.tools && d.tools.length ? ' with ' + d.tools.join(', ') : ''}.` }; } catch (e) { return { text: `Install failed: ${String(e.message).replace(/^Error: /, '')}` }; } } };
    const pr = q.match(/^(?:remove|uninstall) (?:the )?plugin (.{2,60})$/); if (pr) return { run: async () => { try { await POSTJ(ADDONS + '/plugins/remove', { name: pr[1].replace(/ /g, '_') }); return { text: `Removed ${pr[1]}.` }; } catch (e) { return { text: String(e.message).replace(/^Error: /, '') }; } } };
    if (/^(show|what are the|sing the) lyrics\??$/.test(q) || /^lyrics$/.test(q)) return { focus: 'mus', run: async () => { const m = widgets.data.music; if (!m.live || m.now.i < 0) return { focus: 'mus', text: 'Play something from the library first.' }; const d = await (await fetch(ADDONS + '/lyrics?i=' + m.now.i)).json(); const txt = d.plain || (d.lrc ? d.lrc.replace(/\[[^\]]*\]/g, ' ') : ''); return { focus: 'mus', text: txt ? txt.replace(/\s+/g, ' ').trim().slice(0, 500) : 'No lyrics found for this track.' }; } };
    if (/^(mute the mic|mic off|kill the mic|privacy mode( on)?|stop listening for good)$/.test(q)) return { text: 'Microphone off. Nothing leaves this PC until you flip the switch.', effect: () => micKill(true) };
    if (/^(mic on|unmute the mic|privacy mode off|listen again)$/.test(q)) return { text: 'Microphone back.', effect: () => { micKill(false); } };
    const po = q.match(/^(?:pop out|float|detach|pin out) (?:the )?(.+?)(?: widget)?$/); if (po) { const w = W.find(x => x.id === po[1] || x.title.toLowerCase() === po[1] || x.name.toLowerCase().includes(po[1])); if (w) return { popOut: w.id }; }
    const site = q.match(/^open (claude|chatgpt|chat gpt|gemini|google ai studio|perplexity)( in the browser| website| site)?$/); if (site) { const u = { claude: 'https://claude.ai', chatgpt: 'https://chatgpt.com', 'chat gpt': 'https://chatgpt.com', gemini: 'https://gemini.google.com', 'google ai studio': 'https://aistudio.google.com', perplexity: 'https://www.perplexity.ai' }[site[1]]; return { text: `Opening ${site[1]} in the browser window. That is the real site, sign in there if you like.`, effect: async () => { try { await fetch(BROWSER + '/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'headed', arg: 'on' }) }); } catch (e) { } fetch(BROWSER + '/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'open', arg: u }) }).catch(() => { }); } }; }
    if (/^(stay|stay still|stop moving|stop wandering|hold still|come back|come here|center|centre)$/.test(q)) return { text: 'Holding position.', effect: () => { S.wander = false; save(); } };
    if (/^(roam|rome|roman|wander|wonder|move around|explore|free roam|go explore|move as you like|go roam)$/.test(q)) return { text: 'Roaming.', effect: () => { S.wander = true; save(); } };
    if (/^proactive check$/.test(q)) return { proactive: true };
    const tm = q.match(/\b(?:timer|countdown|alarm)\b.*?(\d+|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|sixty)\s*(?:min|minute|m\b)/) || q.match(/(\d+|one|two|three|four|five|ten|fifteen|twenty|thirty)\s*(?:min|minute)s?\s*(?:timer|countdown)/);
    if (tm) { const n = WORDS[tm[1]] || +tm[1]; return { focus: 'tmr', text: `Timer set, ${n} minute${n > 1 ? 's' : ''}. I'll ping you when it's done.`, effect: () => widgets.timerStart(n * 60) }; }
    if (/\b(stop|cancel|reset)\b.*\btimer\b|\btimer\b.*\b(stop|cancel|reset)\b/.test(q)) return { focus: 'tmr', text: 'Timer cleared.', effect: () => widgets.timerReset() };
    const tm2 = q.match(/\b(?:timer|countdown|alarm)\b(?: for)? (\d+|one|two|three|four|five|ten|fifteen|twenty|thirty)$/); if (tm2) { const n = WORDS[tm2[1]] || +tm2[1]; return { focus: 'tmr', text: `Timer set, ${n} minute${n > 1 ? 's' : ''}.`, effect: () => widgets.timerStart(n * 60) }; }
    const pm = q.match(/^(?:play|start|put on|resume)(?: me)?(?: the| some| a| any)?(?: (.+?))?(?: please)?$/);
    if (pm) { const what = (pm[1] || '').replace(/^(music|song|songs|track|tune|tunes|something|anything|beat|a beat|playlist|the music)$/, '').trim(), m = widgets.data.music;
      if (!what) return { focus: 'mus', text: 'Playing music.', effect: () => widgets.music('play') };
      if (m.live && m.tracks.some(t => t.title.toLowerCase().includes(what) || (t.artist || '').toLowerCase().includes(what))) return { focus: 'mus', text: `Playing ${what}.`, effect: () => widgets.music('find', what) }; }
    if (/^(pause|pause music|stop music|stop the music)$/.test(q)) return { focus: 'mus', text: 'Paused.', effect: () => widgets.music('pause') };
    if (/^(next|next track|next song|skip)$/.test(q)) return { focus: 'mus', text: 'Next track.', effect: () => widgets.music('next') };
    const vl = q.match(/^(?:set )?volume (?:to )?(\d{1,3})%?$/); if (vl) return { text: `Volume ${vl[1]} percent.`, actions: [{ type: 'volume_set', arg: vl[1] }] };
    if (/^(volume up|louder|turn it up)$/.test(q)) return { text: 'Louder.', actions: [{ type: 'volume_up', arg: '10' }] };
    if (/^(volume down|quieter|turn it down)$/.test(q)) return { text: 'Quieter.', actions: [{ type: 'volume_down', arg: '10' }] };
    if (/^(mute|unmute)$/.test(q)) return { text: q === 'mute' ? 'Muted.' : 'Unmuted.', actions: [{ type: 'mute' }] };
    if (/^(show|open|focus) (the )?(weather|forecast)$/.test(q)) return { focus: 'wx', text: null };
    /* video: youtube by search, local library, direct streams */
    if (/^(pause|stop) (the )?(video|youtube|movie)$/.test(q)) return { text: 'Paused.', effect: () => widgets.video('pause') };
    if (/^(resume|continue|play) (the )?(video|movie)$/.test(q)) return { focus: 'vid', text: 'Playing.', effect: () => widgets.video('play') };
    if (/^(close|kill|exit) (the )?(video|youtube|movie|player)$|^video off$/.test(q)) return { text: 'Video closed.', effect: () => { widgets.video('close'); if (S.focus === 'vid') setFocus(null); } };
    if (/^(cinema( mode)?|theat(er|re) mode|big screen|full screen video|exit cinema|cinema off)$/.test(q)) return { focus: 'vid', text: /exit|off/.test(q) ? 'Back to the HUD.' : 'Cinema mode.', effect: () => { const v = widgets.data.video; if (!!v.cinema === !/exit|off/.test(q)) return; widgets.video('cinema'); } };
    if (/^(show|open|focus) (the )?(video|player|youtube)$/.test(q)) return { focus: 'vid', text: null };
    const vu = q.match(/^(?:play|open|stream|watch) (https?:\/\/\S+\.(?:mp4|webm|m3u8|mov|m4v)(?:\?\S*)?)$/); if (vu) return { focus: 'vid', text: 'Streaming.', effect: () => widgets.video('url', vu[1]) };
    const vq = q.match(/^(?:play|watch|show(?: me)?|put on|start)(?: a| the| some)? (?:video|videos|youtube|movie|clip)(?: of| about| for| on|:)? (.+)$/) || q.match(/^(?:watch|youtube) (.+)$/) || q.match(/^(?:play|open|watch|put on) (.+?) on youtube$/);
    if (vq) { const what = vq[1].replace(/ on you ?tube$/, '').trim(); return { focus: 'vid', text: `Finding ${what}.`, effect: async () => { const ok = await widgets.video('search', what); say(ok ? `Playing ${widgets.data.video.now.title.slice(0, 60)}.` : `I could not find ${what}.`); } }; }
    /* find my phone: companion page alarm + ntfy + Google Find My Device through the agent browser */
    if (/^(find|locate|where is|where's|track) (my )?(phone|mobile|cell|android)( is)?\??$|^track my phone$/.test(q)) return { findPhone: 'locate' };
    if (/^(ring|call|ping|buzz|make .* ring|play (a )?sound on) (my )?(phone|mobile|cell|android)$|^ring it$/.test(q)) return { findPhone: 'ring' };
    if (/^(stop|silence|quiet) (the )?(ring|ringing|alarm|phone)$/.test(q)) return { text: 'Quiet.', effect: () => stopRing() };
    if (/^(sign in to google|google sign in|show (the )?browser window|open (the )?browser window)$/.test(q)) return { text: 'Opening the browser window. Sign in to Google there, then say "find my phone" again.', effect: () => fetch(BROWSER + '/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'headed', arg: 'on' }) }).catch(() => { }) };
    /* map: where is X, show the map */
    if (/^(show|open) (me )?(the )?map$|^map$|^where am i\??$/.test(q)) return { focus: 'map', text: 'Here you are.', effect: () => setTimeout(() => widgets.mapShow(), 150) };
    const wh = q.match(/^(?:where is|where's|map of|find on the map|navigate to|locate) (?!my phone)(.{2,60})$/) || q.match(/^(?:find|show|show me|put) (.{2,60}?) on the map$/); if (wh && !/phone|mobile/.test(wh[1])) return { mapFind: wh[1] };
    /* spotify */
    if (/^(link|connect|log ?in to|sign in to) spotify$/.test(q)) return { spotifyLink: true };
    const spq = q.match(/^(?:play|put on|start) (.+?) on spotify$/) || q.match(/^spotify(?: play)? (.+)$/); if (spq && !/^(pause|next|previous|prev|volume|shuffle|repeat|status)/.test(spq[1])) return { spotify: ['play', spq[1]] };
    if (/^(pause|stop) spotify$/.test(q)) return { spotify: ['pause', ''] };
    if (/^(resume|play) spotify$/.test(q)) return { spotify: ['play', ''] };
    const sv = q.match(/^spotify volume (\d+)$/); if (sv) return { spotify: ['volume', sv[1]] };
    const ss = q.match(/^shuffle (on|off)$/); if (ss) return { spotify: ['shuffle', ss[1]] };
    const sr = q.match(/^repeat (this song|this track|one|off|all|on)$/); if (sr) return { spotify: ['repeat', /song|track|one/.test(sr[1]) ? 'track' : sr[1]] };
    const st = q.match(/^play on (?:the |my )?(.+?)(?: speaker| device)?$/); if (st && widgets.data.spotify.linked) return { spotify: ['transfer', st[1]] };
    /* calendar */
    const ca = q.match(/^(?:add|put|schedule|book|create)(?: an? )?(?:event |meeting |appointment |reminder )?(.+?) (?:to|on|in) my calendar(?: (?:for |on |at )?(.+))?$/) || q.match(/^(?:schedule|scheduled|book|plan) (.+?) (?:(?:for|on|at) )?((?:today|tonight|tomorrow|next |on |in |at |monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d).+)$/);
    if (ca) { const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, fifty: 50 };
      const spoken = t => t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty five|forty|fifty)\b/g, m => NUM[m]).replace(/(\d)\s*(p|a)\s*m\b/g, '$1$2m').replace(/\b(\d+) (\d+)\b/g, '$1:$2');
      let title = ca[1].trim(), when = spoken((ca[2] || '').trim()), dur = 60; const dm = (when + ' ' + title).match(/for (\d+) ?(minutes?|min|hours?|h)\b/); if (dm) { dur = /hour|h\b/.test(dm[2]) ? +dm[1] * 60 : +dm[1]; when = when.replace(dm[0], '').trim(); title = title.replace(dm[0], '').trim(); } if (!when) { const tm = title.match(/^(.*?)\s+((?:today|tonight|tomorrow|next |monday|tuesday|wednesday|thursday|friday|saturday|sunday|at \d|on \d|in \d).*)$/); if (tm) { title = tm[1]; when = tm[2]; } } return { calendarAdd: { title, when: when || 'tomorrow 9am', dur } }; }
    if (/^(what('s| is) next on my calendar|next (event|meeting|appointment)|what do i have next|upcoming events)$/.test(q)) return { calendarNext: true };
    /* memory constellation */
    const mq = q.match(/^(?:show|open) (?:my |the )?(?:memory|memories|constellation|what you remember)(?: (?:about|for|of) (.+))?$/) || q.match(/^(?:what do you remember about|memory search) (.+)$/);
    if (mq) return { focus: 'mem', text: mq[1] ? `Memory, filtered on ${mq[1]}.` : 'Your memory, as stars.', effect: () => { widgets.data.mem.query = (mq[1] || '').toLowerCase(); widgets.memLoad(true); } };
    /* screen widget: live desktop, OCR, vision */
    if (/^(show|open|view|watch) (me )?(my |the )?(screen|desktop|display)( live)?$|^screen (view|live)$/.test(q)) return { focus: 'scr', text: null, effect: () => widgets.screenRefresh(true) };
    if (/^(read|ocr) (me )?(my |the )?(screen|display|text on (my|the) screen)( aloud| out loud)?$|^what does (my|the) screen say$/.test(q)) return { screenRead: true };
    if (/^(take a |grab a )?(screenshot|screen shot|capture (my|the) screen)$/.test(q)) return { focus: 'scr', text: 'Captured.', actions: [{ type: 'screenshot', arg: '' }] };
    /* custom widgets and the forge */
    const cw = q.match(/^(?:create|make|build|add)(?: me)? (?:a |an )?(?:new )?widget(?: that| which| for| to| showing| called)? (.{4,})$/); if (cw) return { widgetCreate: cw[1] };
    const dw = q.match(/^(?:delete|remove|drop) (?:the )?widget (.{2,})$/); if (dw) return { widgetDelete: dw[1] };
    if (/^(list|show)( my)? (custom )?widgets$/.test(q)) return { text: widgets.data.custom.length ? `${widgets.data.custom.length} of yours: ${widgets.data.custom.map(w => w.name).join(', ')}.` : 'No custom widgets yet. Say "create a widget that shows my task count".' };
    if (/^(forge|rebuild) status$/.test(q)) return { forgeStatus: true };
    if (/^(apply|install|accept) (the )?(forge|changes|rebuild|upgrade)$/.test(q)) return { forgeApply: true };
    if (/^(discard|drop|cancel|revert) (the )?(forge|changes|rebuild|upgrade)$/.test(q)) return { forgeDiscard: true };
    const fj = q.match(/^(?:forge|rebuild yourself|improve yourself|add (?:a )?feature|add (?:the )?ability|upgrade yourself|modify yourself|change yourself|rewrite)[:,]?\s*(?:to |so that |that )?(.{6,})$/); if (fj) return { forge: fj[1] };
    /* browser widget: the agent's real page, live in the HUD */
    if (/^(show|open|focus) (the )?(browser|web|web view|agent browser)$/.test(q)) return { focus: 'web', text: null, effect: () => widgets.webRefresh(true) };
    const bu = q.match(/^(?:browse|open|go to|visit|open website|open site|open page|navigate to)(?: the)?(?: website| site| page)? (?:to )?((?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?)$/) || q.match(/^browse (?:to |for )?(.+)$/) || q.match(/^(?:look (?:that |it |this )?up|search) in the browser(?: for)? (.+)$/);
    if (bu) { const t = bu[1].trim(), url = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t) ? (t.startsWith('http') ? t : 'https://' + t) : 'https://duckduckgo.com/?q=' + encodeURIComponent(t); return { focus: 'web', text: `Opening ${t}.`, effect: () => widgets.browse(url) }; }
    /* radio and podcasts */
    if (/^(stop|pause|kill)( the)? (radio|podcast|stream)$/.test(q)) return { focus: 'mus', text: 'Stopped.', effect: () => widgets.stopStream() };
    const rd = q.match(/^(?:play|put on|start|tune (?:in|to))(?: the| some| a)? radio(?: station)?(?: (.+))?$/) || q.match(/^(?:play|put on) (.+) radio$/); if (rd) return { focus: 'mus', text: rd[1] ? `Tuning to ${rd[1]}.` : 'Radio on.', effect: async () => { if (!await widgets.stream('radio', rd[1] || '')) say('No station found. Add stations under connect in the config.'); } };
    const pc = q.match(/^(?:play|put on|start|resume)(?: the| a| my| latest| the latest)? podcast(?: (.+))?$/); if (pc) return { focus: 'mus', text: 'Podcast.', effect: async () => { if (!await widgets.stream('podcast', pc[1] || '')) say('No podcast episodes yet. Add feeds under connect in the config.'); } };
    /* journal, focus sessions, files, read aloud, machines, radios, phone push, games, cleanup */
    const jn = q.match(/^(?:note|journal|log|write down|remember in my journal)(?: that| this)?[:,]? (.{2,})$/); if (jn) return { focus: 'task', text: 'Noted.', effect: () => fetch(ADDONS + '/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: jn[1] }) }).catch(() => { }) };
    if (/^(read|show|what's in|what is in|open) (my |the )?journal( today| for today)?$/.test(q)) return { journal: true };
    const fs = q.match(/^(?:(?:start|started|begin|go)(?: a| the| my| of| off)? )?(?:focus|pomodoro|deep work)(?: session| mode| timer)?(?: for)?(?: (\d+|[a-z]+(?: [a-z]+)?)(?: minutes?| min)?)?$/) || q.match(/^(?:(?:start|started|begin|go)(?: a| the| my)? )?(?:focus|pomodoro|deep work)(?: session| mode| timer)?$/); if (fs) { const w = (fs[1] || '').split(' '), mins = +(fs[1] || 0) || (WORDS[w[0]] || 0) + (WORDS[w[1]] || 0) || 25; return { focus: 'tmr', text: `Focus session, ${mins} minutes. I will keep quiet.`, effect: () => { fetch(ADDONS + '/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: mins, break: 5 }) }).catch(() => { }); widgets.timerStart(mins * 60); } }; }
    if (/^(stop|end|cancel) (the )?(focus|pomodoro)( session)?$/.test(q)) return { text: 'Focus session ended.', effect: () => { fetch(ADDONS + '/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stop: true }) }).catch(() => { }); widgets.timerReset(); } };
    const ff = q.match(/^(?:find|search|locate)(?: my| the)? files?(?: for| named| called| about)? (.{2,})$/) || q.match(/^where is (?:my |the )?file (.{2,})$/); if (ff) return { files: ff[1] };
    const ra = q.match(/^read(?: me)?(?: the)?(?: file| document)? (\S+\.(?:txt|md|pdf|docx|csv|log|rst))(?: aloud| out loud| to me)?$/); if (ra) return { readFile: ra[1] };
    const wk = q.match(/^(?:wake|wake up|power on|turn on|boot)(?: the| my)? (?:machine |server |pc |computer )?(.{2,30})$/); if (wk && /server|nas|pc|machine|desktop|laptop|box|rig|[0-9a-f]{2}(:[0-9a-f]{2}){5}/i.test(wk[0])) return { text: `Waking ${wk[1]}.`, actions: [{ type: 'wake_machine', arg: wk[1] }] };
    const rk = q.match(/^(?:turn |switch )?(wifi|wi-fi|wi fi|bluetooth|vpn)(?: on| off)?(?: (on|off))?$/); if (rk && /on|off/.test(q)) { const kind = rk[1].replace(/[^a-z]/g, '') === 'wifi' ? 'wifi' : rk[1]; return { text: `${kind} ${/off/.test(q) ? 'off' : 'on'}.`, actions: [{ type: kind, arg: /off/.test(q) ? 'off' : 'on' }] }; }
    const pp = q.match(/^(?:push|send)(?: this| a note| a message)? to (?:my )?phone[:,]? (.{2,})$/); if (pp) return { text: 'Sent to your phone.', actions: [{ type: 'push_phone', arg: pp[1] }] };
    const tg = q.match(/^(?:telegram|message me|text me)[:,]? (.{2,})$/); if (tg) return { text: 'Sent.', actions: [{ type: 'telegram_send', arg: tg[1] }] };
    const lg = q.match(/^(?:launch|start the game|play the game|run the game) (.{2,})$/); if (lg) return { text: `Launching ${lg[1]}.`, actions: [{ type: 'launch_game', arg: lg[1] }] };
    if (/^(list |show |what )?(games|my games|steam games)( do i have| library)?$/.test(q)) return { games: true };
    if (/^(clean ?up|clean the (system|pc|disk)|free (up )?(some )?space|disk cleanup)$/.test(q)) return { cleanup: true };
    if (/^(show|open|focus) (the )?(camera|cam|feed|gate)$/.test(q)) return { focus: 'cam', text: 'Camera feed up.' };
    if (/^(show|open|focus) (the )?(map|position|location)$/.test(q)) return { focus: 'map', text: 'Position locked.' };
    if (/^(show|open|focus) (the )?(gallery|photos|pics|pictures)$/.test(q)) return { focus: 'pix', text: 'Gallery up.' };
    if (/^(show|open|focus) (the )?(terminal|log|logs)$/.test(q)) return { focus: 'tty', text: 'Terminal.' };
    if (/^(show|open|focus) (the )?(system|stats|cpu)$/.test(q)) return { focus: 'sys', text: null };
    if (/^(confirm|yes do it|do it|confirmed)$/.test(q) && S.pendingConfirm) { const a = S.pendingConfirm; S.pendingConfirm = null; return { text: `Confirmed. ${a.type.replace('_', ' ')}.`, actions: [{ ...a, confirm: true }] }; }
    if (/^(cancel|no|never mind|nevermind)$/.test(q) && S.pendingConfirm) { S.pendingConfirm = null; return { text: 'Cancelled.' }; }
    const rm = q.match(/^remember (?:that )?(.{3,200})$/); if (rm) return { text: 'Noted. I will remember that.', effect: () => brain.fact('remember', rm[1]) };
    const fg = q.match(/^forget (?:about |that )?(.{2,200})$/); if (fg) return { text: 'Forgotten.', effect: () => brain.fact('forget', fg[1]) };
    if (/^(what do you remember|what do you know about me)\??$/.test(q)) return { text: brain.facts.length ? 'I remember: ' + brain.facts.join('. ') : 'Nothing stored yet. Say "remember" followed by a fact.' };
    const am = q.match(/^(?:ask (?:all|everyone|every ai)|compare)[:,]?\s+(.{3,})$/); if (am) return { compare: am[1] };
    if (/^(every (day|morning|evening|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+|\w+ ?(minutes?|mins?|hours?))|remind me (at|on|in)\b|in (\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|sixty|an?) ?(minutes?|mins?|hours?) |at [\w:. ]+ (say|remind|run))/.test(q)) return { text: null, actions: [{ type: 'schedule_add', arg: q.replace(/^in an? (minute|hour)/, 'in 1 $1') }] };
    if (/^(what('s| is) scheduled|list (my )?(schedules|reminders)|show (my )?(schedules|reminders))\??$/.test(q)) return { schedules: true };
    const rr = q.match(/^(?:run |start |activate )?(focus mode|good night|good morning|bedtime|movie mode|work mode)(?: routine)?$/); if (rr) return { text: null, actions: [{ type: 'routine_run', arg: rr[1] }] };
    const rn = q.match(/^run (?:the )?(.{2,30}?) routine$/); if (rn) return { text: null, actions: [{ type: 'routine_run', arg: rn[1] }] };
    if (/^((morning|evening|daily) )?brief(ing)?( me)?$|^brief me$|^what('s| is) (my|the) (day|briefing)\b/.test(q)) return { briefing: true };
    if (/^(what did you do|what have you done|show (the )?audit|activity log)/.test(q)) return { audit: true };
    const ds = q.match(/^(?:search(?:ed)?|find|look(?:ed)?|check)(?: in| through)? (?:my )?(?:docs|documents|files|notes)(?: for)? (.{2,})$/) || q.match(/^what do my (?:docs|documents|notes) say about (.{2,})$/); if (ds) return { docs: ds[1] };
    if (/^(what('s| is) on my screen|look at (my|the) screen|read (my|the) screen|describe (my|the) screen|what am i looking at)\??$/.test(q)) return { vision: 'screen', question: 'Describe what is on the screen and anything notable.' };
    const vs = q.match(/^(?:look at (?:my|the) screen and |on my screen,? )(.{3,})$/); if (vs) return { vision: 'screen', question: vs[1] };
    if (/^(what do you see|look at me|what('s| is) in front of (the|your) camera|describe the (room|camera))\??$/.test(q)) return { vision: 'camera', question: 'Describe what the camera sees.' };
    const dt = q.match(/^(?:on my desktop,? |desktop task:? |do this on (?:my|the) (?:desktop|screen):? )(.{4,})$/); if (dt) return { text: null, actions: [{ type: 'desktop_task', arg: dt[1] }] };
    return null;
  }
  /* offline fallback: answers from live widget data without an LLM */
  function offlineRoute(q) {
    const d = widgets.data, has = (...k) => k.some(x => q.includes(x));
    if (has('weather', 'forecast', 'rain', 'temperature')) { const w = d.weather; return { focus: 'wx', text: w && w.temp !== '--' ? `${w.temp} degrees and ${String(w.cond).toLowerCase()}${w.label ? ' in ' + w.label : ''}. High of ${w.hi}, low ${w.lo}.` : 'Weather feed is offline.' }; }
    if (has('play ', 'music', 'song')) { let what = ((q.match(/play (?:me )?(?:some )?(.+)/) || [])[1] || '').replace(/^(the |a |some )?(music|song|songs|track|tune|tunes|something|anything|a beat|beat)$/, '').trim(); return { focus: 'mus', text: what ? `Playing ${what}.` : 'Playing music.', effect: () => { if (!(what && widgets.music('find', what))) widgets.music('play'); } }; }
    if (has('light', 'lamp')) { const off = has('off'); return { focus: 'home', text: off ? 'Lights off.' : 'Lights on.', effect: () => widgets.setHome('lights', !off) }; }
    if (has('unlock')) return { focus: 'home', text: 'Front door unlocked.', effect: () => widgets.setHome('lock', false) };
    if (has('lock')) return { focus: 'home', text: 'Front door locked.', effect: () => widgets.setHome('lock', true) };
    if (has(' ac', 'air con', 'fan', 'blind', 'plug')) { const dev = has('fan') ? 'fan' : has('blind') ? 'blinds' : has('plug') ? 'plug' : 'ac', off = has('off', 'close', 'down'); return { focus: 'home', text: `${dev} ${off ? 'off' : 'on'}.`, effect: () => widgets.setHome(dev, !off) }; }
    if (has('calendar', 'agenda', 'schedule', 'meeting', 'event')) { const n = d.agenda.find(e => e.next); return { focus: 'cal', text: `${d.agenda.length} events today.${n ? ` Next is ${n.title} at ${n.time}.` : ''}` }; }
    if (has('mail', 'inbox', 'message')) { const u = d.inbox.filter(m => m.unread); return { focus: 'msg', text: `${u.length} unread.${u[0] ? ` ${u[0].from} wrote about ${u[0].subject}.` : ''}` }; }
    const ta = q.match(/(?:remind me to|add (?:a )?task(?: to)?|todo)\s+(.{3,80})/); if (ta) return { focus: 'task', text: `Added: ${ta[1]}.`, effect: () => widgets.taskAction('add', { label: ta[1] }) };
    if (has('task', 'todo')) { const open = d.tasks.filter(t => !t.done); return { focus: 'task', text: `${d.tasks.length} tasks, ${d.tasks.length - open.length} done.${open[0] ? ` ${open[0].label} is still open.` : ''}` }; }
    if (has('camera', 'cam', 'feed', 'gate')) return { focus: 'cam', text: 'Camera feed is up.' };
    if (has('map', 'where am i', 'location', 'gps')) return { focus: 'map', text: `You are at node ${widgets.nodeLabel}.` };
    if (has('system', 'cpu', 'memory', 'status', 'network', 'how are you', 'health')) { const t = d.tel; return { focus: 'sys', text: `CPU at ${Math.round(t.cpu)} percent, memory at ${Math.round(t.mem)}. ${t.live ? 'Nothing out of range.' : 'Telemetry sidecar is offline, these are simulated.'}` }; }
    if (has('photo', 'picture', 'gallery', 'holo')) return { focus: 'pix', text: 'Gallery is up.' };
    if (has('screenshot')) return { text: 'Taking a screenshot.', actions: [{ type: 'screenshot' }] };
    if (has('lock the screen', 'lock screen', 'lock my pc', 'lock computer')) return { text: 'Locking.', actions: [{ type: 'lock' }] };
    if (has('shut down', 'shutdown', 'power off')) return { text: 'Shutdown needs confirmation.', actions: [{ type: 'shutdown' }] };
    if (has('restart pc', 'reboot pc', 'restart computer', 'reboot computer')) return { text: 'Restart needs confirmation.', actions: [{ type: 'restart' }] };
    if (has('sleep')) return { text: 'Sleep needs confirmation.', actions: [{ type: 'sleep' }] };
    const op = q.match(/\b(?:open|launch|start|run)\s+([a-z0-9 .]+)$/); if (op) return { focus: 'tty', text: `Launching ${op[1].trim()}.`, actions: [{ type: 'open_app', arg: op[1].trim() }] };
    const se = q.match(/\b(?:search|google|look up)\s+(?:for\s+)?(.{2,})$/); if (se) return { text: `Searching the web for ${se[1]}.`, actions: [{ type: 'web_search', arg: se[1] }] };
    if (has('hello', 'hi ', 'hey', 'good morning', 'good evening')) return { text: `Online and listening, ${brain.user.name}. What do you need?` };
    return { text: 'The neural core is offline, so I can only handle widget commands right now. Pick a provider in settings or start Ollama.' };
  }

  /* phone companion page: recognise here, run on the PC, speak wherever the setting says */
  const COMPANION = new URLSearchParams(location.search).get('companion') === '1';
  async function relaySubmit(q) {
    $('cmd').value = ''; widgets.pushTty(`> ${q}`, '#6a8ea3'); setMode('thinking'); setReply('');
    const r = await voice.relay.send(q, voice.cfg.companion);
    if (!r) { say('The PC did not answer. Is SAMURAI open there?', null, { quick: true }); return; }
    setReply(r.text || ''); if (r.focus) setFocus(r.focus);
    if (/phone|both/.test(voice.cfg.companion) && r.text) { setMode('speaking'); voice.speakLocal(r.text).then(() => setMode(voice.micOn ? 'listening' : 'idle')); } else setMode(voice.micOn ? 'listening' : 'idle');
    return r.text;
  }
  async function submit(input) {
    const q = (input || '').trim(); if (!q) return;
    if (COMPANION && voice.cfg.companion !== 'off') return relaySubmit(q);
    S.lastReply = '';
    $('cmd').value = ''; voice.stopSpeaking();
    clearInterval(S.typing); S.focus = null; applyLayout(); setReply(''); $('transcript').textContent = ''; $('transcript').classList.remove('on');
    widgets.pushTty(`> ${q}`, '#6a8ea3'); setMode('thinking');
    const low = q.toLowerCase();
    let r = quickRoute(low), llmSnap = null;
    try {
      if (r && r.compare) { r = await compareAll(r.compare); }
      else if (r && r.briefing) { r = await briefing(); }
      else if (r && r.audit) { r = await auditSummary(); }
      else if (r && r.schedules) { r = await listSchedules(); }
      else if (r && r.docs) { r = await docsAnswer(r.docs); }
      else if (r && r.vision) { r = await visionAnswer(r.vision, r.question); }
      else if (r && r.plan) { r = await planRun(r.plan); }
      else if (r && r.popOut) { r = { text: await popOut(r.popOut) }; }
      else if (r && r.findPhone) { r = await findPhone(r.findPhone); }
      else if (r && r.mapFind) { const t = await widgets.mapFind(r.mapFind); r = t ? { focus: 'map', text: `${t.label.split(',').slice(0, 2).join(',')}.`, effect: () => setTimeout(() => widgets.mapShow(t), 150) } : { text: `I could not find ${r.mapFind} on the map.` }; }
      else if (r && r.spotifyLink) { const d = await (await fetch(ADDONS + '/spotify/auth')).json(); r = d.ok ? { text: 'Opening Spotify to link your account. Approve it there, then say "play something on spotify".', effect: () => window.open(d.url, '_blank') } : { text: d.error || 'Set your Spotify client id in the control panel first.' }; }
      else if (r && r.spotify) { const d = await widgets.spotify(r.spotify[0], r.spotify[1]); r = { focus: 'mus', text: d.ok ? (d.did || 'Done.') : d.error }; }
      else if (r && r.calendarAdd) { const c = r.calendarAdd; const d = await (await fetch(ADDONS + '/calendar/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: c.title, start: c.when, duration_min: c.dur }) })).json(); r = d.ok ? { focus: 'cal', text: `${d.event.title}, ${d.event.when}. Added.`, effect: () => widgets.pollAddons && widgets.pollAddons('agenda') } : { text: d.error || 'I could not add that.' }; }
      else if (r && r.calendarNext) { const d = await (await fetch(ADDONS + '/calendar/next?n=3')).json(); const L = d.events || []; r = { focus: 'cal', text: L.length ? L.map(e => `${e.title} ${e.when}`).join('. ') + '.' : 'Nothing coming up.' }; }
      else if (r && r.screenRead) { r = await screenRead(); }
      else if (r && r.widgetCreate) { r = await widgetCreate(r.widgetCreate); }
      else if (r && r.widgetDelete) { const w = widgets.data.custom.find(x => x.name.toLowerCase().includes(r.widgetDelete.toLowerCase())); if (!w) r = { text: `No widget called ${r.widgetDelete}.` }; else { await fetch(ADDONS + '/widgets_custom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: w.id }) }); r = { text: `Widget ${w.name} removed. It disappears after the next reload.`, effect: () => { const el = document.querySelector(`.node[data-id=cw_${w.id}]`); el && el.remove(); document.querySelector(`.slot[data-id=cw_${w.id}]`)?.remove(); const i = W.findIndex(x => x.id === 'cw_' + w.id); if (i >= 0) W.splice(i, 1); widgets.data.custom = widgets.data.custom.filter(x => x.id !== w.id); widgets.relayoutNodes(); } }; } }
      else if (r && r.forge) { r = await forgeStart(r.forge); }
      else if (r && r.forgeApply) { r = await forgeApply(); }
      else if (r && r.forgeDiscard) { const d = await (await fetch(PANEL + '/forge/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json(); r = { text: d.ok ? d.did + '.' : d.error }; }
      else if (r && r.forgeStatus) { const d = await (await fetch(PANEL + '/forge/status')).json(); r = { text: !d.available ? `Forge unavailable: ${d.why}.` : d.running ? `The forge is working on: ${d.task}.` : d.changed.length ? `${d.changed.length} file(s) changed and waiting. Say "apply the forge" or "discard the forge".` : 'The forge is idle and ready.' }; }
      else if (r && r.journal) { const d = await (await fetch(ADDONS + '/journal/today')).json(); const n = (d.entries || []).length; r = { focus: 'task', text: n ? `${n} entr${n === 1 ? 'y' : 'ies'} today. ${d.entries.slice(0, 3).map(e => e.text).join('. ')}` : 'Nothing in the journal today.' }; }
      else if (r && r.files) { const d = await (await fetch(ADDONS + '/files?q=' + encodeURIComponent(r.files) + '&n=5')).json(); const L = d.results || []; L.forEach(f => widgets.pushTty(`file · ${f.path}`, '#a07cff')); r = { focus: 'tty', text: L.length ? `${L.length} match${L.length === 1 ? '' : 'es'}. First: ${L[0].name}.` : `No file matching ${r.files}.`, actions: L.length ? [] : [] }; }
      else if (r && r.readFile) { const d = await (await fetch(ADDONS + '/read?path=' + encodeURIComponent(r.readFile))).json(); r = d.ok ? { focus: 'tty', text: String(d.text || '').replace(/\s+/g, ' ').slice(0, 700) } : { text: `I could not read ${r.readFile}.` }; }
      else if (r && r.games) { const d = await (await fetch(ADDONS + '/games')).json(); const G = d.games || []; G.slice(0, 12).forEach(g => widgets.pushTty(`game · ${g.name}`, '#a07cff')); r = { focus: 'tty', text: G.length ? `${G.length} games installed. ${G.slice(0, 3).map(g => g.name).join(', ')}${G.length > 3 ? ' and more' : ''}.` : (d.steam ? 'No Steam games found.' : 'Steam is not installed here.') }; }
      else if (r && r.cleanup) { const d = await (await fetch(ADDONS + '/cleanup')).json(); const mb = Math.round((d.total || 0) / 1048576); (d.items || []).forEach(i => widgets.pushTty(`cleanup · ${i.kind} ${Math.round(i.bytes / 1048576)} MB`, '#a07cff')); r = { focus: 'sys', text: mb ? `About ${mb} megabytes can go. Say "confirm" to delete temp files older than a day.` : 'Nothing worth cleaning.', actions: mb ? [{ type: 'cleanup', arg: 'temp' }] : [] }; }
      else if (r && r.run) { r = (await r.run()) || { text: 'Done.' }; }
      else if (r && r.proactive) { r = await proactiveCheck(); if (!r) { setMode(voice.micOn ? 'listening' : 'idle'); return; } }
      else if (!r) {
        if (brain.online) {
          llmSnap = brain.cfg.sysAccess ? widgets.snapshot() : null;
          const sc = sayStream();
          try { const out = await brain.ask(q, llmSnap, text => sc.push(text)); r = { text: out.reply, focus: out.focus, actions: out.actions, shape: out.shape, emotion: out.emotion, provider: out.provider, stream: sc }; }
          catch (e) { log('warn', `neural core · ${String(e.message).slice(0, 70)}`); if (sc.active()) { sc.end(); return; } r = offlineRoute(low); }
        } else r = offlineRoute(low);
      }
    } catch (e) { r = { text: 'Something went wrong on my side.' }; }
    if (r.alert) { showAlert({ level: 'HIGH', title: `Unusual login pattern on node ${widgets.nodeLabel}`, source: '203.0.113.9 · unknown host', vector: 'SSH · 3 failed attempts in 40 s', asset: 'login service', demo: true }); return; }
    if (r.reboot) { boot(); return; }
    r.effect && r.effect();
    if (r.focus && !r.shape && ICON[r.focus] && !S.flow) iconMorph(r.focus);
    if (r.shape) { const ok = core.setShape(r.shape.startsWith('text:') ? r.shape : String(r.shape).toLowerCase(), true); if (!ok && !r.text) r.text = 'Already there.'; }
    const acts = r.actions || []; const results = [];
    for (const a of acts) { const res = await runAction(a); if (res) results.push(res); }
    let text = r.text == null ? (results[0] || 'Done.') : r.text;
    if (r.text && results.length && acts.some(a => a.type === 'clipboard_get')) text += ' ' + results.join(' ');
    if (r.stream) { if (r.focus !== undefined) { S.focus = r.focus; applyLayout(); } r.stream.end(text, r.emotion, r.hold); return S.lastReply = text; }
    say(text, r.focus === undefined ? null : r.focus, { emotion: r.emotion, hold: r.hold });
    return S.lastReply = text;
  }
  /* ---------- find my phone ---------- */
  const BROWSER = SAM.H + ':9600';
  async function findPhone(action) {
    let d; try { d = await (await fetch(ADDONS + '/findmy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })).json(); } catch (e) { return { text: 'The add-ons service did not answer.' }; }
    if (!d.ok) return { text: d.error || 'Find my phone failed.' };
    const g = d.google || {}, sent = d.sent || [], parts = [];
    if (action === 'ring') parts.push(sent.length ? `Ringing your phone through ${sent.map(s => ({ companion: 'the companion page', ntfy: 'the phone push', google: 'Google Find My Device' })[s] || s).join(' and ')}.` : 'Ring sent to your phone if the companion page is open. For a sure ring, set up the ntfy push in the panel or sign in to Google.');
    if (g.needs_login) parts.push('Google Find My Device needs you signed in once: say "show the browser window", sign in there, then ask again.');
    else if (g.devices && g.devices.length) parts.push(`Google sees ${g.devices.join(', ')}${g.last_seen ? ', last seen ' + g.last_seen : ''}${g.address ? ', near ' + g.address : ''}.`);
    else if (g.error) parts.push(`Google: ${String(g.error).slice(0, 80)}.`);
    if (d.note && !sent.length && !/companion page is open/.test(parts.join(' '))) parts.push(d.note);
    const trackable = !g.needs_login && !g.error && g.ok !== false && widgets.data.web !== undefined && sent.includes('google') || (g.devices && g.devices.length);
    return { focus: trackable ? 'web' : (action === 'ring' ? null : 'map'), text: parts.join(' ') || 'Done.', effect: () => { if (trackable) { widgets.data.web.live = true; widgets.data.web.title = 'TRACKING MY PHONE'; widgets.render('web'); widgets.webRefresh(true); trackOverlay(true, g); } } };
  }
  function trackOverlay(on, g) {
    let el = document.getElementById('trackOv'); if (!on) { el && el.remove(); return; }
    const view = document.getElementById('webView'); if (!view) return;
    if (!el) { el = document.createElement('div'); el.id = 'trackOv'; el.className = 'trackov'; view.appendChild(el); }
    el.innerHTML = `<div class="tscan"></div><div class="tcross"><i></i><i></i></div><div class="tlab"><b>TRACKING MY PHONE</b><span>${esc((g.devices || []).join(' · ') || 'locating…')}${g.last_seen ? ' · ' + esc(g.last_seen) : ''}</span></div>`;
    clearTimeout(trackOverlay.t); trackOverlay.t = setTimeout(() => trackOverlay(false), 90000);
  }
  /* companion page: the PC can make this phone ring */
  let ringCtx = null, ringTimer = null;
  function startRing(text) {
    stopRing(); try { ringCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const ctx = ringCtx, g = ctx.createGain(); g.gain.value = 1; g.connect(ctx.destination); let i = 0;
    ringTimer = setInterval(() => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = i % 2 ? 1760 : 1320; o.connect(g); o.start(); o.stop(ctx.currentTime + .22); i++; if (i > 90) stopRing(); }, 260);
    try { navigator.vibrate && navigator.vibrate([500, 200, 500, 200, 500]); } catch (e) { }
    let ov = document.getElementById('ringOv'); if (!ov) { ov = document.createElement('div'); ov.id = 'ringOv'; ov.className = 'ringov'; ov.innerHTML = `<div><b>SAMURAI IS LOOKING FOR THIS PHONE</b><span>${esc(text || '')}</span><div class="sbtn on" id="ringStop">STOP</div></div>`; document.body.appendChild(ov); ov.querySelector('#ringStop').onclick = stopRing; }
    if (voice.speakLocal) voice.speakLocal(text || 'Here I am.');
  }
  function stopRing() { clearInterval(ringTimer); ringTimer = null; try { ringCtx && ringCtx.close(); } catch (e) { } ringCtx = null; const ov = document.getElementById('ringOv'); ov && ov.remove(); }
  function companionEvents() {
    let since = Date.now() / 1000;
    setInterval(async () => { try { const d = await (await fetch(PANEL + '/remote/events?since=' + since)).json(); since = d.now || since; for (const e of d.events || []) { if (e.kind === 'ring') startRing(e.text); else if (e.kind === 'say' && e.text) { setReply(e.text); voice.speakLocal ? voice.speakLocal(e.text) : say(e.text); } } } catch (e) { } }, 3000);
  }
  /* ---------- screen: OCR first, vision brain when tesseract is missing ---------- */
  async function screenRead() {
    const r = await widgets.screenText();
    if (r.ok) { const t = r.text.replace(/\s+/g, ' ').trim(); return { focus: 'scr', text: t ? `On screen: ${t.slice(0, 600)}${t.length > 600 ? '… and more.' : ''}` : 'The screen has no readable text.', effect: () => { widgets.data.screen.text = r.text; } }; }
    log('info', `ocr · ${r.error}`);
    const v = await visionAnswer('screen', 'Read out the text that is on the screen, briefly, most important first.');
    return { focus: 'scr', text: v.text };
  }
  /* ---------- custom widgets: the brain writes one, the add-ons store it, the HUD mounts it ---------- */
  async function widgetCreate(spec) {
    log('info', `widget · designing: ${spec}`);
    const prompt = `Design a small HUD widget for this request: "${spec}". Reply ONLY with JSON: {"name": "<2-3 words>", "code": "<3 capital letters>", "html": "<self-contained HTML+CSS+JS for a 1260x680 dark panel, no external resources>"}.
Rules for the html: dark transparent background, cyan #2ee6ff / violet #a07cff / ice #d9f8ff colours, monospace labels, big readable values. Live data arrives as window messages: window.addEventListener('message', e => { const s = e.data && e.data.snapshot; if (!s) return; /* s.tel (cpu, mem, temp, battery, disk), s.weather, s.agenda, s.tasks, s.inbox, s.home, s.music, s.timer */ }) every 5 s. You may call window.samurai.say("text") to make SAMURAI speak, window.samurai.run("timer_start","5") to run an action, window.samurai.focus("wx") to open a widget. Keep it under 6000 characters.`;
    let out; try { out = await brain.ask(prompt, widgets.snapshot()); } catch (e) { return { text: 'The brain did not answer.' }; }
    let raw = String(out.reply || out.raw || '').trim(); const m = raw.match(/\{[\s\S]*\}/); if (!m) return { text: 'I could not design that widget. Try describing it differently.' };
    let spec2; try { spec2 = JSON.parse(m[0]); } catch (e) { return { text: 'The widget design was not valid. Try again.' }; }
    if (!spec2.html || !spec2.name) return { text: 'The design was missing its page. Try again.' };
    const d = await (await fetch(ADDONS + '/widgets_custom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: spec2.name, code: spec2.code, html: spec2.html, by: out.provider || 'brain' }) })).json();
    if (!d.ok) return { text: `Could not save the widget: ${d.error}` };
    await widgets.loadCustom(); applyLayout();
    return { focus: 'cw_' + d.widget.id, text: `${d.widget.name} is live in the ring. Say "delete widget ${d.widget.name}" to remove it.` };
  }
  /* ---------- forge: Claude Code rebuilds SAMURAI from a sentence; nothing goes live until you say apply ---------- */
  let forgeTimer = null, forgeSeen = 0;
  async function forgeStart(task) {
    const st = await (await fetch(PANEL + '/forge/status')).json();
    if (!st.available) return { text: `I cannot rebuild myself here: ${st.why}.` };
    if (st.running) return { text: `Still working on: ${st.task}. Ask for the forge status later.` };
    const d = await (await fetch(PANEL + '/forge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) })).json();
    if (!d.ok) return { text: d.error };
    forgeSeen = 0; clearInterval(forgeTimer);
    forgeTimer = setInterval(async () => {
      try {
        const s = await (await fetch(PANEL + '/forge/log')).json(); const lines = (s.log || '').split('\n'); for (let i = forgeSeen; i < lines.length; i++) if (lines[i].trim()) widgets.pushTty(`forge · ${lines[i].trim().slice(0, 110)}`, '#ffb84d'); forgeSeen = lines.length;
        if (!s.running) { clearInterval(forgeTimer); const f = await (await fetch(PANEL + '/forge/status')).json(); const last = f.last || {}; const n = (f.changed || []).length; say(n ? `Forge done: ${n} file${n === 1 ? '' : 's'} changed. ${String(last.summary || '').replace(/\s+/g, ' ').slice(-220)} Say "apply the forge" to install it, or "discard the forge".` : `The forge finished without changing files. ${String(last.summary || '').replace(/\s+/g, ' ').slice(-200)}`, 'tty'); }
      } catch (e) { }
    }, 3000);
    return { focus: 'tty', text: `Forging: ${task}. I will tell you when it is ready.` };
  }
  async function forgeApply() {
    const d = await (await fetch(PANEL + '/forge/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    if (!d.ok) return { text: `Not applied: ${d.error}${d.files ? ' · ' + Object.entries(d.files).map(([f, e]) => f + ': ' + e).join('; ').slice(0, 300) : ''}` };
    setTimeout(() => location.reload(), 25000);
    return { text: `${d.did}. I will reload in half a minute with the new code.` };
  }
  async function compareAll(q) {
    const ids = Object.keys(brain.PROVIDERS).filter(id => brain.configured(id) && brain.PROVIDERS[id].kind !== 'agent').slice(0, 5);
    if (!ids.length) return { text: 'No providers configured for a comparison.' };
    log('ok', `asking ${ids.length} providers…`);
    const res = await brain.askMany(q, ids, brain.cfg.sysAccess ? widgets.snapshot() : null);
    res.forEach(x => widgets.pushTty(`${x.id}: ${x.error ? 'error · ' + x.error : x.reply.slice(0, 60)}`, x.error ? '#ff3d6e' : '#a9cfe0'));
    const good = res.filter(x => x.reply);
    return { text: good.map(x => `${brain.PROVIDERS[x.id].label.split(' — ')[0]} says: ${x.reply}`).join(' ') || 'Every provider failed.' };
  }
  /* autonomous planner: the brain breaks a goal into spoken steps + commands, SAMURAI runs them one after another */
  async function planRun(goal) {
    if (!brain.online) return { text: 'I need a brain online to plan that.' };
    try {
      const out = await brain.ask(`Plan this goal for ${brain.user.name} as a short ordered list of SAMURAI commands I can run one by one. Reply ONLY with JSON: {"reply": "<one sentence saying what you will do>", "steps": ["<command 1>", "<command 2>", ...], "focus": null, "actions": [], "shape": null}. Commands are things SAMURAI understands: lights off, timer 5 min, play some music, web search for X, open chrome, remind me at 5 pm to X, search my documents for X, browse_open X, screenshot. Goal: ${goal}`, widgets.snapshot());
      let steps = [];
      if (brain.lastRaw) { try { const o = JSON.parse(brain.lastRaw.slice(brain.lastRaw.indexOf('{'), brain.lastRaw.lastIndexOf('}') + 1)); steps = Array.isArray(o.steps) ? o.steps.map(String) : []; } catch (e) { } }
      if (!steps.length) return { text: out.reply || 'I could not break that into steps.' };
      steps.slice(0, 8).forEach((s, i) => widgets.pushTty(`plan ${i + 1}: ${s}`, '#a07cff'));
      S.routineQueue = steps.slice(0, 8); T(runRoutineQueue, 2500);
      return { text: out.reply || `Plan ready, ${steps.length} steps.`, focus: 'tty' };
    } catch (e) { return { text: 'Planning failed: ' + String(e.message).slice(0, 60) }; }
  }
  /* proactive check-in: the brain looks at the live data and speaks only if something deserves attention */
  async function proactiveCheck() {
    if (S.quiet && S.quietMode) { widgets.pushTty(`proactive check · skipped (${S.quietWhy})`, '#6a8ea3'); return null; }
    if (!brain.online) return null;
    try {
      const out = await brain.ask(`Proactive check-in. Look at the LIVE DATA. If something deserves ${brain.user.name}'s attention right now (high load, low battery, disk nearly full, an imminent meeting, a flagged mail, an open security alert), say it in one or two sentences. If nothing stands out reply with exactly the word NOTHING.`, widgets.snapshot());
      if (!out.reply || /^\s*nothing\b/i.test(out.reply)) { widgets.pushTty('proactive check · nothing to report', '#6a8ea3'); return null; }
      widgets.pushTty('proactive check · speaking up', '#ffb84d'); return { text: out.reply, focus: out.focus || 'sys' };
    } catch (e) { return null; }
  }
  async function briefing() {
    const d = widgets.data, parts = [];
    if (d.weather && d.weather.temp !== '--') parts.push(`${d.weather.temp} degrees and ${String(d.weather.cond).toLowerCase()}, high of ${d.weather.hi}.`);
    const nxt = d.agenda.find(e => e.next); parts.push(d.agenda.length ? `${d.agenda.length} events today${nxt ? ', next is ' + nxt.title + ' at ' + nxt.time : ''}.` : 'Nothing on the calendar.');
    const open = d.tasks.filter(t => !t.done); parts.push(open.length ? `${open.length} open task${open.length > 1 ? 's' : ''}, starting with ${open[0].label}.` : 'No open tasks.');
    const unread = d.inbox.filter(m => m.unread); if (unread.length) parts.push(`${unread.length} unread mail${unread[0].flagged ? ', one flagged from ' + unread[0].from : ''}.`);
    parts.push(`System: CPU ${Math.round(d.tel.cpu)} percent, memory ${Math.round(d.tel.mem)} percent${d.security && d.security.level === 'HIGH' ? ', and a security alert is open' : ''}.`);
    const raw = parts.join(' ');
    if (brain.online) { try { const out = await brain.ask(`Give ${brain.user.name} a spoken briefing from these facts, in 3-4 sentences, warm and concise:\n${raw}`, widgets.snapshot()); return { text: out.reply, focus: 'cal' }; } catch (e) { } }
    return { text: `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${brain.user.name}. ${raw}`, focus: 'cal' };
  }
  async function auditSummary() {
    try {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const d = await (await fetch(`${ACTION_URL.replace('/action', '')}/audit?n=40&since=${since.getTime() / 1000}`)).json();
      const e = d.entries || [];
      e.slice(-8).forEach(x => widgets.pushTty(`${new Date(x.t * 1000).toTimeString().slice(0, 5)} ${x.type} ${x.arg || ''} ${x.ok ? '✓' : '✗'}`, x.ok ? '#a9cfe0' : '#ff3d6e'));
      if (!e.length) return { text: 'No actions on the PC today yet.', focus: 'tty' };
      const counts = {}; e.forEach(x => counts[x.type] = (counts[x.type] || 0) + 1);
      return { text: `${e.length} action${e.length > 1 ? 's' : ''} today: ${Object.entries(counts).map(([k, v]) => `${k.replace(/_/g, ' ')}${v > 1 ? ' ×' + v : ''}`).join(', ')}.`, focus: 'tty' };
    } catch (e) { return { text: 'The action service is offline, so there is no audit log to read.' }; }
  }
  async function listSchedules() {
    try {
      const d = await (await fetch(ADDONS + '/schedules')).json(); const sc = d.schedules || [];
      sc.forEach(x => widgets.pushTty(`⏰ ${x.name}${x.enabled === false ? ' (off)' : ''}`, '#a07cff'));
      return { text: sc.length ? `${sc.length} schedule${sc.length > 1 ? 's' : ''}: ${sc.map(x => x.name).join('; ')}.` : 'Nothing scheduled. Try "every day at 8 am say good morning".', focus: 'tty' };
    } catch (e) { return { text: 'Add-ons service offline, no schedules available.' }; }
  }
  async function docsAnswer(query) {
    try {
      const d = await (await fetch(`${ADDONS}/docs/search?q=${encodeURIComponent(query)}&k=4`)).json();
      if (!d.dir) return { text: 'Set a documents folder in the control panel first.' };
      if (!d.hits.length) return { text: `Nothing in your documents matches ${query}.` };
      d.hits.forEach(h => widgets.pushTty(`📄 ${h.name}`, '#a9cfe0'));
      if (brain.online) { try { const ctx = d.hits.map(h => `[${h.name}] ${h.snippet}`).join('\n'); const out = await brain.ask(`Using only these excerpts from ${brain.user.name}'s documents, answer: ${query}\n\n${ctx}`, null); return { text: out.reply, focus: 'tty' }; } catch (e) { } }
      return { text: `Found ${d.hits.length} match${d.hits.length > 1 ? 'es' : ''}: ${d.hits.map(h => h.name).join(', ')}. Top excerpt: ${d.hits[0].snippet.slice(0, 160)}`, focus: 'tty' };
    } catch (e) { return { text: 'Add-ons service offline, document search unavailable.' }; }
  }
  async function grabImage(kind) {
    /* returns {b64, mime}; screen via the action server, else via the browser's screen share prompt */
    try {
      const r = await fetch(ACTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: kind === 'camera' ? 'camera_frame' : 'screenshot', arg: '' }) });
      const d = await r.json();
      if (d.ok && d.path) { const img = await (await fetch(`${ACTION_URL.replace('/action', '')}/file?path=${encodeURIComponent(d.path)}`)).blob(); return { b64: await blobB64(img), mime: img.type || 'image/png' }; }
      if (kind === 'camera') throw new Error(d.error || 'no camera');
    } catch (e) { if (kind === 'camera') { const v = document.getElementById('camVid'); if (v && v.videoWidth) return canvasB64(v); throw e; } }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const v = document.createElement('video'); v.srcObject = stream; await v.play(); await new Promise(r => setTimeout(r, 300));
    const out = canvasB64(v); stream.getTracks().forEach(t => t.stop()); return out;
  }
  function canvasB64(v) { const c = document.createElement('canvas'); c.width = Math.min(1600, v.videoWidth); c.height = Math.round(v.videoHeight * c.width / v.videoWidth); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); return { b64: c.toDataURL('image/jpeg', .8).split(',')[1], mime: 'image/jpeg' }; }
  function blobB64(blob) { return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); }); }
  async function visionAnswer(kind, question) {
    try { setMode('thinking'); const img = await grabImage(kind); widgets.pushTty(`vision · ${kind} · ${Math.round(img.b64.length * 3 / 4 / 1024)} KB`, '#a07cff'); const text = await brain.askVision(question, img.b64, img.mime); brain.remember(question, text); return { text, focus: kind === 'camera' ? 'cam' : null }; }
    catch (e) { log('warn', `vision · ${String(e.message).slice(0, 70)}`); return { text: /no vision/.test(e.message) ? 'No vision-capable brain is configured. Add OpenAI, Claude, Gemini or an Ollama vision model.' : 'I could not get an image to look at.' }; }
  }
  /* desktop agent: screenshot -> vision model -> one mouse/keyboard step, repeat */
  async function desktopTask(goal) {
    if (!brain.cfg.actions) { say('System control is off, so I cannot drive the desktop.', null); return; }
    const steps = []; let n = 0; S.desktopCancel = false;
    toast(`DESKTOP TASK: ${goal.slice(0, 40)} — press CANCEL to stop`, () => { });
    while (n++ < 12 && !S.desktopCancel) {
      let img; try { img = await grabImage('screen'); } catch (e) { say('I cannot see the screen, so I will stop.', null); return; }
      const prompt = `Goal: ${goal}\nSteps so far: ${steps.join('; ') || 'none'}\nLook at the screenshot (${1600}px wide, coordinates scale to the real screen). Reply with ONLY JSON: {"action": "click|double|right|type|key|scroll|done", "x": 0, "y": 0, "text": "", "key": "", "amount": -3, "say": "one short sentence"}. Use "done" when the goal is reached or impossible.`;
      let st; try { const raw = await brain.askVision(prompt, img.b64, img.mime); const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); st = JSON.parse(raw.slice(a, b + 1)); } catch (e) { log('warn', 'desktop agent: bad step from the model'); break; }
      widgets.pushTty(`desktop ${n}: ${st.action} ${st.text || st.key || (st.x != null ? st.x + ',' + st.y : '')}`, '#a07cff');
      if (st.say) voice.speak(st.say);
      if (st.action === 'done') { steps.push('done'); break; }
      const r = await fetch(ACTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'desktop_step', arg: JSON.stringify(st), confirm: true }) });
      const d = await r.json(); if (!d.ok) { log('warn', `desktop step failed · ${d.error}`); break; }
      steps.push(`${st.action} ${st.text || st.key || ''}`.trim()); await new Promise(r => setTimeout(r, 1200));
    }
    $('toast').classList.add('hidden');
    say(S.desktopCancel ? 'Desktop task cancelled.' : `Desktop task finished after ${steps.length} step${steps.length === 1 ? '' : 's'}.`, 'tty');
  }
  const ZAP = { home_set: 'home', lights: 'home', timer_start: 'tmr', task_add: 'task', task_done: 'task', play_music: 'mus', music_play: 'mus', music_next: 'mus', music_pause: 'mus', volume: 'sys', screenshot: 'sys' };
  async function runAction(a) {
    const type = String(a.type || '').toLowerCase(), arg = String(a.arg ?? '').trim();
    if (SAM.fx) SAM.fx.zap(ZAP[type] || (type.startsWith('home') ? 'home' : type.startsWith('browse') ? 'web' : type.startsWith('video') ? 'vid' : 'tty'), true);
    if (!brain.cfg.actions && !['remember', 'forget', 'shape', 'layout', 'timer_start', 'timer_stop', 'task_add', 'task_done', 'home_set'].includes(type)) { log('warn', `action ${type} blocked · SYSTEM CONTROL is off`); return null; }
    try {
      switch (type) {
        case 'home_set': { const m = arg.match(/(lights|ac|lock|blinds|plug|fan)\s*(on|off|locked|unlocked|up|down|open|close)?/i); if (m) widgets.setHome(m[1].toLowerCase(), !/off|unlocked|up|open/i.test(m[2] || 'on')); return null; }
        case 'timer_start': { const n = parseFloat(arg) || 5; widgets.timerStart(Math.round(n * 60)); S.focus = 'tmr'; return null; }
        case 'timer_stop': widgets.timerReset(); return null;
        case 'task_add': if (arg) widgets.taskAction('add', { label: arg }); return null;
        case 'task_done': { const t = widgets.data.tasks.find(x => !x.done && x.label.toLowerCase().includes(arg.toLowerCase())); if (t) widgets.taskAction('toggle', { id: t.id }); return null; }
        case 'remember': await brain.fact('remember', arg); return null;
        case 'forget': await brain.fact('forget', arg); return null;
        case 'shape': core.setShape(arg.startsWith('text:') ? arg : arg.toLowerCase(), true); return null;
        case 'layout': S.layout = ['ambient', 'focus', 'desk', 'wall'].includes(arg) ? arg : 'full'; save(); applyLayout(); return null;
        case 'reboot': T(boot, 1500); return null;
        case 'alert_demo': T(() => showAlert({ level: 'HIGH', title: 'Demo alert', source: '203.0.113.9 · unknown host', vector: 'SSH · 3 failed attempts', asset: 'login service', demo: true }), 1200); return null;
        case 'research': case 'agent_task': { agentDelegate(type === 'research' ? 'search' : 'work', arg); return null; }
        case 'schedule_add': { const d = await (await fetch(ADDONS + '/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', text: arg }) })).json(); if (!d.ok) { log('warn', d.error); return 'I could not understand that schedule. Try "every day at 8 am say good morning".'; } widgets.pushTty(`⏰ scheduled: ${d.added.name}`, '#a07cff'); return `Scheduled: ${d.added.name}.`; }
        case 'routine_run': { const d = await (await fetch(ADDONS + '/routines')).json(); const cmds = (d.routines || {})[arg.toLowerCase().trim()]; if (!cmds) return `No routine called ${arg}.`; widgets.pushTty(`routine ${arg}: ${cmds.length} steps`, '#a07cff'); S.routineQueue = cmds.slice(); T(runRoutineQueue, 300); return `Running ${arg}.`; }
        case 'search_docs': { const r2 = await docsAnswer(arg); return r2.text; }
        case 'send_email': { const m = arg.split('|').map(x => x.trim()); if (m.length < 3) return 'Say the mail as: to, subject, body.'; if (!a.confirm) { S.pendingConfirm = { type: 'send_email', arg }; toast(`SEND MAIL to ${m[0]} — confirm?`, () => submit('confirm')); return `Mail to ${m[0]} is ready. Say confirm to send.`; } const d = await (await fetch(ADDONS + '/mail/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: m[0], subject: m[1], body: m.slice(2).join(' | '), confirm: true }) })).json(); return d.ok ? d.did : `Mail failed: ${d.error}`; }
        case 'look_at_screen': { const r2 = await visionAnswer('screen', arg || 'Describe what is on the screen.'); return r2.text; }
        case 'look_at_camera': { const r2 = await visionAnswer('camera', arg || 'Describe what the camera sees.'); return r2.text; }
        case 'desktop_task': { T(() => desktopTask(arg), 1500); return null; }
        case 'spotify': { const w = arg.split(/\s+/); const cmd = ['pause', 'next', 'prev', 'volume', 'shuffle', 'repeat'].includes(w[0]) ? w[0] : 'play'; const d = await widgets.spotify(cmd, cmd === 'play' ? arg.replace(/^play\s+/, '') : w.slice(1).join(' ')); say(d.ok ? d.did || 'Done.' : d.error, 'mus'); return null; }
        case 'calendar_add': { const [title, when, dur] = arg.split('|').map(s => s.trim()); const d = await (await fetch(ADDONS + '/calendar/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, start: when || 'tomorrow 9am', duration_min: parseInt(dur) || 60 }) })).json(); say(d.ok ? `${d.event.title}, ${d.event.when}. Added.` : d.error, 'cal'); return null; }
        case 'map_show': { const t = arg ? await widgets.mapFind(arg) : null; setFocus('map'); setTimeout(() => widgets.mapShow(t), 150); return null; }
        case 'find_phone': { const d = await findPhone(/ring|sound/.test(arg) ? 'ring' : 'locate'); say(d.text, d.focus); d.effect && d.effect(); return null; }
        case 'screen_read': { const d = await screenRead(); say(d.text, 'scr'); return null; }
        case 'screen_describe': { const d = await visionAnswer('screen', 'Describe what is on the screen and anything notable.'); say(d.text, 'scr'); return null; }
        case 'widget_create': { const d = await widgetCreate(arg); say(d.text, d.focus); return null; }
        case 'forge': { const d = await forgeStart(arg); say(d.text); return null; }
        case 'video_play': case 'video_search': case 'youtube': { setFocus('vid'); const ok = await widgets.video('search', arg); if (!ok) log('warn', `video · nothing found for ${arg}`); return null; }
        case 'video_pause': widgets.video('pause'); return null; case 'video_close': widgets.video('close'); return null; case 'cinema': widgets.video('cinema'); return null;
        case 'radio_play': await widgets.stream('radio', arg); setFocus('mus'); return null; case 'podcast_play': await widgets.stream('podcast', arg); setFocus('mus'); return null;
        case 'journal_add': fetch(ADDONS + '/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: arg }) }).catch(() => { }); return null;
        case 'focus_start': fetch(ADDONS + '/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: parseInt(arg) || 25, break: 5 }) }).catch(() => { }); widgets.timerStart((parseInt(arg) || 25) * 60); return null;
        case 'browse_open': case 'browse_read': case 'browse_click': case 'browse_type': case 'browse_find': case 'browse_back': case 'browse_screenshot': {
          if (type === 'browse_open') { widgets.data.web.live = true; widgets.render('web'); if (!S.focus) setFocus('web'); }
          try { const d = await (await fetch(SAM.H + ':9600/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: type.slice(7), arg }) })).json(); widgets.pushTty(`browser ${type.slice(7)} → ${d.ok ? 'ok' : d.error}`, d.ok ? '#2ee6ff' : '#ff3d6e'); if (d.ok && d.text && brain.online && type === 'browse_read') { const out = await brain.ask(`Summarise this web page for ${brain.user.name} in 2-3 spoken sentences (title: ${d.title}):\n${d.text.slice(0, 6000)}`, null); return out.reply; } return d.ok ? (d.did || d.title || 'Done.') : `Browser: ${d.error}`; }
          catch (e) { return 'The browser agent is not running. Start it from the control panel.'; }
        }
        case 'play_music': { if (widgets.data.music.live && widgets.music('find', arg)) return null; widgets.data.music.queryTitle = arg; widgets.data.music.now.playing = true; widgets.render('mus'); break; }
        case 'music_play': widgets.music('play'); return null; case 'music_pause': widgets.music('pause'); return null;
        case 'music_next': widgets.music('next'); return null; case 'music_prev': widgets.music('prev'); return null;
      }
      const r = await fetch(ACTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, arg, confirm: !!a.confirm }) });
      const d = await r.json();
      if (d.needs_confirm) { S.pendingConfirm = { type, arg }; toast(`${type.replace('_', ' ').toUpperCase()} — say "confirm" or press`, () => submit('confirm')); widgets.pushTty(`${type} · awaiting confirmation`, '#ffb84d'); return `Say confirm to ${type.replace('_', ' ')}.`; }
      if (d.ok) { widgets.pushTty(`${type}${arg ? ' ' + arg.slice(0, 30) : ''} → ok`, '#2ee6ff'); return d.text || null; }
      widgets.pushTty(`${type} → ${d.error}`, '#ff3d6e'); return null;
    } catch (e) { log('warn', `action ${type} · action server offline (:9300)`); return null; }
  }
  async function runRoutineQueue() { const cmd = S.routineQueue && S.routineQueue.shift(); if (!cmd) return; await submit(cmd); const wait = setInterval(() => { if (S.mode !== 'speaking' && S.mode !== 'thinking') { clearInterval(wait); T(runRoutineQueue, 600); } }, 400); }
  /* proactive events from the add-ons scheduler and watch */
  let eventsSince = Date.now() / 1000;
  let eventsBusy = false;
  async function pollEvents() {
    if (eventsBusy) return; eventsBusy = true;                      // a slow poll must not overlap the next one (the same event would be spoken twice)
    try {
      const d = await (await fetch(`${ADDONS}/events?since=${eventsSince}`)).json(); eventsSince = d.now || eventsSince;
      for (const e of d.events || []) {
        if (S.mode === 'thinking') continue;
        if (e.room && S.room && e.room !== S.room) continue;                       // meant for another room
        if (e.kind !== 'alert' && S.quiet && S.quietMode) { widgets.pushTty(`(quiet · ${S.quietWhy}) ${e.text}`, '#6a8ea3'); S.heldEvents.push(e); continue; }
        if (e.kind === 'command') { widgets.pushTty(`⏰ ${e.source}: ${e.text}`, '#a07cff'); await submit(e.text); }
        else if (e.kind === 'say') { const tag = { notification: '🔔', pricewatch: '💸', download: '⬇', rooms: '⌂', mission: '⚑' }[e.source] || '•'; widgets.pushTty(`${tag} ${e.text}`, '#a07cff'); say(e.text, e.source === 'pricewatch' ? 'web' : null); }
        else { widgets.pushTty(`${e.kind === 'alert' ? '⚠' : '⏰'} ${e.text}`, e.kind === 'alert' ? '#ff3d6e' : '#a07cff'); say(e.text, e.kind === 'alert' ? 'sys' : null); }
      }
    } catch (err) { }
    eventsBusy = false;
  }
  async function agentDelegate(mode, arg) {
    const agent = brain.preferredAgent() || (await brain.agentPing(), brain.preferredAgent());
    if (!agent) { say('No headless agent is installed. Install Claude Code or Gemini CLI and start the agent service.', null); return; }
    widgets.pushTty(`${agent} ${mode} · ${arg.slice(0, 40)}`, '#a07cff'); setMode('thinking');
    try { const text = await brain.agentRun(agent, arg, mode, brain.recent(6)); brain.remember(arg, text); say(text, mode === 'work' ? 'tty' : null); }
    catch (e) { log('warn', `${agent} ${mode} failed · ${String(e.message).slice(0, 60)}`); say('The headless agent could not finish that.', null); }
  }
  function toast(text, onYes) {
    const t = $('toast'); t.innerHTML = `<span>${esc(text)}</span><div class="sbtn" id="toastYes">CONFIRM</div><div class="sbtn v" id="toastNo">CANCEL</div>`; t.classList.remove('hidden');
    $('toastYes').onclick = () => { t.classList.add('hidden'); onYes(); }; $('toastNo').onclick = () => { t.classList.add('hidden'); S.pendingConfirm = null; };
    T(() => t.classList.add('hidden'), 30000);
  }
  function showAlert(sec) {
    $('alertRisk').textContent = 'RISK ' + (sec.level || 'HIGH'); $('alertTitle').textContent = sec.title; $('alertSource').textContent = sec.source; $('alertVector').textContent = sec.vector; $('alertAsset').textContent = sec.asset;
    S.alertIp = (String(sec.source).match(/^[\d.]+|[0-9a-f:]{3,}/) || [''])[0]; S.alertDemo = !!sec.demo;
    voice.stopSpeaking(); setMode('alert'); widgets.pushTty('security_watch → ' + (sec.level || 'HIGH'), '#ff3d6e');
    voice.speak(`Security alert. ${sec.title}.`);
  }
  async function blockIp() {
    const ip = S.alertIp;
    if (S.alertDemo || !ip) { widgets.pushTty(`firewall → block ${ip || '?'} (demo)`, '#ff3d6e'); setMode('idle'); say(`${ip || 'The source'} is blocked at the firewall. Attempt logged to Security Watch.`, null); return; }
    try { const d = await (await fetch(ADDONS + '/security/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip, confirm: true }) })).json(); setMode('idle'); say(d.ok ? `${ip} is blocked at the firewall.` : `Block failed: ${d.error}`, null); }
    catch (e) { setMode('idle'); say('Could not reach the add-ons service to block that address.', null); }
  }

  /* ---------- voice wiring ---------- */
  voice.onLog = log; brain.onLog = log; widgets.onLog = log;
  voice.onPartial = t => { $('transcript').textContent = t; $('transcript').classList.add('on'); if (S.mode === 'idle') setMode('listening'); clearTimeout(S.partialT); S.partialT = setTimeout(() => voice.flush(), 700); };
  /* the recogniser sometimes hears "damn ri" or "some rye" for "samurai": accept close matches at the start */
  function lev(a, b) { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
  function stripWake(text, ww) {
    const words = text.trim().split(/\s+/), lead = /^(hey|ok|okay|yo)$/i;
    let start = words.length && lead.test(words[0]) ? 1 : 0;
    for (let n = 1; n <= 3 && start + n <= words.length; n++) { const cand = words.slice(start, start + n).join('').toLowerCase().replace(/[^a-z]/g, ''); if (cand === ww || (cand.length >= 5 && lev(cand, ww) <= (n >= 2 ? 5 : Math.max(2, Math.ceil(ww.length * .55)))) || (ww === 'samurai' && /^(s|d|z|th|sh)?[a-z]{2,5}a?w?r(ai|i|y|ye|ie|ee|ight|ite|eye)$/.test(cand) && cand.length <= 10)) return { found: true, rest: words.slice(start + n).join(' ').replace(/^[\s,.:!-]+/, '').trim() }; }
    return { found: false, rest: text.trim() };
  }
  voice.onFinal = t => {
    clearTimeout(S.partialT); $('transcript').textContent = t; $('transcript').classList.add('on');
    const ww = voice.cfg.wakeWord, sw = stripWake(t, ww); let cmd = sw.rest;
    if (voice.cfg.wake && !sw.found) { widgets.pushTty(`heard: ${t.slice(0, 40)} (no wake word)`, '#6a8ea3'); if (S.mode === 'listening') setMode('idle'); return; }
    if (sw.found) widgets.pushTty(`wake: "${t.split(/\s+/).slice(0, 2).join(' ')}"`, '#2ee6ff');
    if (!cmd || /^(hello|hi|hey|yo|there|wake up)$/.test(cmd.toLowerCase())) { say(`Welcome back, ${brain.user.name}. All systems at your command.`, null); return; }
    submit(cmd);
  };
  voice.onLevel = l => { core.micLevel = l; };
  voice.onWake = () => { widgets.pushTty('wake word detected', '#2ee6ff'); voice.stopSpeaking('wake'); setMode('listening'); };
  voice.onMicState = on => { if (!on && S.mode === 'listening') setMode('idle'); if (on && S.mode === 'idle') setMode('listening'); $('pillMic').textContent = on ? 'MIC · OPEN' : 'MIC · ARMED'; };
  widgets.onSay = t => say(t); widgets.onMemVisible = () => S.focus === 'mem'; widgets.onMapBig = () => S.focus === 'map'; widgets.onFocus = id => setFocus(id); widgets.onScreenVisible = () => S.focus === 'scr'; widgets.onCustomLoaded = () => applyLayout();
    window.addEventListener('samurai-hotkey', () => { if (!voice.micOn) voice.start(); setMode('listening'); });
    widgets.onVideo = now => { if (now) { if (S.focus !== 'vid') setFocus('vid'); else applyLayout(); } else if (S.focus === 'vid') setFocus(null); }; widgets.onWebVisible = () => S.focus === 'web';
  widgets.onTimerDone = () => { say("Timer's up.", 'tmr'); };
  widgets.onSecurity = sec => showAlert(sec);
  widgets.onAction = (type, arg) => runAction({ type, arg });
  widgets.onTicker = () => renderTicker();
  core.onShape = (name, locked) => { $('shapeText').textContent = `PARTICLES · ${name.replace('text:', '').toUpperCase()}`; const box = $('shapeText').parentElement; box.classList.add('show'); clearTimeout(S.shapeHideT); S.shapeHideT = setTimeout(() => box.classList.remove('show'), 6000); if (locked) widgets.pushTty(`particles → ${name.replace('text:', 'text ')}`, '#a07cff'); };

  /* ---------- settings drawer ---------- */
  const MOODS = [['professional', 'PROFESSIONAL — CRISP'], ['balanced', 'BALANCED — BUTLER'], ['witty', 'WITTY — PLAYFUL'], ['deadpan', 'DEADPAN — DRY'], ['sarcastic', 'SARCASTIC — SNARKY BUTLER'], ['hype', 'HYPE — HIGH ENERGY']];
  let voiceList = null, ttsEngines = null;
  async function renderDrawer() {
    const d = $('drawer'), b = brain.cfg, v = voice.cfg, p = brain.P(b.provider), cfgU = widgets.config || {};
    if (!voiceList) voiceList = await voice.voices();
    if (!ttsEngines) ttsEngines = await voice.engines();
    let cams = []; try { cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.label).map(d => ({ label: d.label, id: d.deviceId })); } catch (e) { }
    const avatars = SAM.face ? await SAM.face.listAvatars() : [];
    const sw = (id, on) => `<div class="sw${on ? ' on' : ''}" data-sw="${id}"><i></i></div>`;
    const provOpts = Object.entries(brain.PROVIDERS).map(([id, x]) => `<option value="${id}"${id === b.provider ? ' selected' : ''}>${x.label}${x.free ? ' · FREE' : ''}${brain.configured(id) ? '' : (x.nokey ? '' : ' (NO KEY)')}</option>`).join('');
    const localModels = (brain.localModels || []).slice(0, 40);
    d.innerHTML = `<div class="dt">SETTINGS<span id="drawerX">[ × ]</span></div>
      <h4>NEURAL CORE</h4>
      <select id="optProvider">${provOpts}</select>
      ${p.kind !== 'agent' ? `<input type="text" id="optUrl" value="${esc(p.url)}" placeholder="BASE URL" spellcheck="false" ${['anthropic', 'gemini'].includes(p.kind) ? 'style="display:none"' : ''}>` : ''}
      ${p.kind !== 'agent' && !p.nokey ? `<input type="password" id="optKey" value="${esc(p.key)}" placeholder="API KEY" autocomplete="off">` : ''}
      ${localModels.length ? `<select id="optModelSel"><option value="">MODEL · ${localModels.length} FOUND</option>${localModels.map(m => `<option value="${esc(m)}"${m === p.model ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>` : ''}
      <input type="text" id="optModel" value="${esc(p.model || '')}" placeholder="${p.kind === 'agent' ? 'MODEL (OPTIONAL — CLI DEFAULT)' : 'MODEL'}" spellcheck="false">
      <div class="note">${p.note || ''}</div>
      <div class="row"><span>SYSTEM ACCESS (READ)</span>${sw('sysAccess', b.sysAccess)}</div>
      <div class="row"><span>SYSTEM CONTROL (ACTIONS)</span>${sw('actions', b.actions)}</div>
      <div class="row"><span>REMEMBER CONVERSATIONS</span>${sw('memory', b.memory)}</div>
      <div class="row"><span>STREAM REPLIES (SPEAK SENTENCE BY SENTENCE)</span>${sw('stream', b.stream !== false)}</div>
      <h4>MULTI-AI POOL</h4>
      <div class="row"><span>USE A POOL OF PROVIDERS</span>${sw('pool', b.pool.enabled)}</div>
      <select id="optStrategy"><option value="failover"${b.pool.strategy === 'failover' ? ' selected' : ''}>FAILOVER — FIRST THAT ANSWERS</option><option value="roundrobin"${b.pool.strategy === 'roundrobin' ? ' selected' : ''}>ROUND ROBIN — ROTATE EACH TURN</option></select>
      <input type="text" id="optPool" value="${esc(b.pool.order.join(', '))}" placeholder="ORDER: ollama, groq, claude, openai…" spellcheck="false">
      <div class="note">Only configured providers are used. Say <b>"ask all: question"</b> to compare every configured provider at once.</div>
      <h4>TASK ROUTING</h4>
      ${['chat', 'work', 'research', 'vision'].map(role => `<select id="role_${role}"><option value="">${role.toUpperCase()}: SAME AS MAIN</option>${Object.entries(brain.PROVIDERS).map(([id, x]) => `<option value="${id}"${(b.roles || {})[role] === id ? ' selected' : ''}>${role.toUpperCase()}: ${x.label}</option>`).join('')}</select>`).join('')}
      <div class="note">Chat = quick questions · work = writing and code · research = live information · vision = "what is on my screen".</div>
      <h4>VOICE</h4>
      <select id="optVoice">${(voiceList.length ? voiceList : [{ id: v.neuralVoice, label: v.neuralVoice }]).map(x => `<option value="${esc(x.id)}"${x.id === v.neuralVoice ? ' selected' : ''}>NEURAL: ${esc(x.label)}</option>`).join('')}</select>
      <select id="optTtsEngine"><option value="">VOICE ENGINE: AUTO (BY VOICE)</option>${['edge', 'kokoro', 'elevenlabs', 'openai', 'cartesia', 'azure'].map(e => `<option value="${e}"${v.tts === e ? ' selected' : ''}${ttsEngines[e] === false ? ' disabled' : ''}>VOICE ENGINE: ${e.toUpperCase()}${ttsEngines[e] === false ? ' (NO KEY · SET IN PANEL)' : ''}</option>`).join('')}</select>
      <select id="optStyle"><option value="">VOICE STYLE: FOLLOW MOOD</option>${['neutral', 'calm', 'excited', 'whisper', 'sad', 'cheerful', 'serious'].map(x => `<option value="${x}"${v.style === x ? ' selected' : ''}>VOICE STYLE: ${x.toUpperCase()}</option>`).join('')}</select>
      <div class="row"><span>WAKE PHRASE</span><input type="text" id="optWake" value="${esc(v.wakePhrase || '')}" placeholder="SAMURAI · HEY SAM · JARVIS" spellcheck="false" style="width:160px"></div>
      <div class="row"><span>ONLY OBEY ENROLLED VOICES</span>${sw('identify', !!v.identify)}</div>
      <div class="row"><span>LIVE VOICE (OPENAI REALTIME)</span>${sw('realtime', !!(voice.realtime && voice.realtime.on))}</div>
      <select id="optStt2"><option value="server"${v.sttEngine !== 'phone' ? ' selected' : ''}>MIC ENGINE: SAMURAI SERVER (VOSK / WHISPER, OFFLINE)</option><option value="phone"${v.sttEngine === 'phone' ? ' selected' : ''}${voice.phoneCapable ? '' : ' disabled'}>MIC ENGINE: THIS DEVICE (GOOGLE / SIRI RECOGNITION)</option></select>
      <select id="optCompanion"><option value="off"${v.companion === 'off' ? ' selected' : ''}>COMPANION: OFF (THIS IS THE PC)</option><option value="phone"${v.companion === 'phone' ? ' selected' : ''}>COMPANION: PHONE SPEAKS THE REPLY</option><option value="pc"${v.companion === 'pc' ? ' selected' : ''}>COMPANION: PC SPEAKS THE REPLY</option><option value="both"${v.companion === 'both' ? ' selected' : ''}>COMPANION: BOTH SPEAK</option></select>
      <div class="note">Phone mode: open the QR link from the control panel on your phone. The phone recognises, the PC runs the command.${COMPANION ? ' This page is a companion.' : ''}</div>
      <div class="row"><span>SPEED <em id="rateVal">${v.rate.toFixed(1)}</em></span><input type="range" id="optRate" min="0.5" max="2" step="0.1" value="${v.rate}"></div>
      <div class="row"><span>VOICE REPLIES</span>${sw('voiceOn', v.voiceOn)}</div>
      <div class="row"><span>WAKE WORD "SAMURAI"</span>${sw('wake', v.wake)}</div>
      <div class="row"><span>BARGE-IN (INTERRUPT BY SPEAKING)</span>${sw('bargeIn', voice.bargeIn)}</div>
      <select id="optStt"><option value="small"${v.sttModel === 'small' ? ' selected' : ''}>MIC MODEL: SMALL — FAST</option><option value="large"${v.sttModel === 'large' ? ' selected' : ''}>MIC MODEL: LARGE — ACCURATE (1.8 GB)</option></select>
      <div class="row"><span>MIC GAIN <em id="gainVal">${v.gain.toFixed(1)}</em></span><input type="range" id="optGain" min="0.5" max="5" step="0.1" value="${v.gain}"></div>
      <div class="dbtn" id="voiceTest">TEST VOICE</div><div class="dbtn" id="micTest">OPEN MIC TEST PAGE</div>
      <h4>PERSONALITY</h4>
      <select id="optMood">${MOODS.map(([k, l]) => `<option value="${k}"${k === b.mood ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <div class="row"><span>HUMOR <em id="humorVal">${b.humor}</em></span><input type="range" id="optHumor" class="v" min="0" max="10" step="1" value="${b.humor}"></div>
      <h4>ADD-ONS · PINNED TO HUD</h4>
      <div class="addons">${W.filter(w => w.pin !== false).map(w => `<div class="row"><span><b>${w.code}</b>${w.name}</span>${sw('pin:' + w.id, !!S.pinned[w.id])}</div>`).join('')}</div>
      <div class="note">Unpinned add-ons dock into their ring node. Click the node or ask for them by voice to summon.</div>
      <h4>THEME</h4>
      <div class="themes">${Object.keys(THEMES).map(t => { const [a, b] = themeHex(t); return `<div class="sw${S.theme === t ? ' on' : ''}" data-t="${t}" style="--a:${a};--b:${b}" title="${t}"><span>${t}</span></div>`; }).join('')}</div>
      <div class="pick"><label>ACCENT <input type="color" id="optColA" value="${S.custom.a}"></label><label>SECOND <input type="color" id="optColB" value="${S.custom.b}"></label><span class="note" style="margin:0">pick two colours for your own theme · say "theme ocean", "random theme"</span></div>
      <h4>LAYOUT</h4>
      <div class="lbtns"><div class="sbtn lay${S.layout === 'focus' ? ' on' : ''}" data-l="focus">FOCUS</div><div class="sbtn lay${S.layout === 'full' ? ' on' : ''}" data-l="full">FULL</div><div class="sbtn lay${S.layout === 'ambient' ? ' on' : ''}" data-l="ambient">AMBIENT</div><div class="sbtn lay${S.layout === 'desk' ? ' on' : ''}" data-l="desk">DESK 3D</div><div class="sbtn lay${S.layout === 'wall' ? ' on' : ''}" data-l="wall">WALL</div></div>
      <h4>AVATAR · SKIN · FONT</h4>
      <select id="optAvatar">${[['orb', 'AVATAR: ORB'], ['bot', 'AVATAR: ROBOT FACE'], ['vrm', 'AVATAR: VRM AVATAR (3D CORE)']].map(([k, l]) => `<option value="${k}"${S.avatar === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select id="optFaceStyle">${[['soft', 'FACE STYLE: SOFT'], ['band', 'FACE STYLE: BAND MOUTH'], ['visor', 'FACE STYLE: VISOR']].map(([k, l]) => `<option value="${k}"${S.faceStyle === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select id="optVrm">${avatars.map(a => `<option value="${esc(a.file)}"${(S.vrm || SAM.face.DEFAULT_VRM.file) === a.file ? ' selected' : ''}>VRM FILE: ${esc(a.name.toUpperCase().slice(0, 40))}</option>`).join('')}</select>
      <div class="note">Robot face: "show your face", "face style visor", "look happy". VRM: "avatar mode", "use the avatar &lt;name&gt;"; drop .vrm files into app/avatars.</div>
      <div class="lbtns"><div class="sbtn sk${S.skin === 'glass' ? ' on' : ''}" data-sk="glass">GLASS</div><div class="sbtn sk${S.skin === 'wireframe' ? ' on' : ''}" data-sk="wireframe">WIREFRAME</div><div class="sbtn sk${S.skin === 'paper' ? ' on' : ''}" data-sk="paper">PAPER</div></div>
      <select id="optFont">${[['michroma', 'FONT: MICHROMA + SAIRA (DEFAULT)'], ['system', 'FONT: SYSTEM (SEGOE / SF)'], ['mono', 'FONT: ALL MONOSPACE'], ['serif', 'FONT: SERIF']].map(([k, l]) => `<option value="${k}"${S.font === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <div class="row"><span>DEPTH BLUR (BACKGROUND SOFTENS BEHIND CARDS)</span>${sw('depth', S.depth)}</div>
      <div class="row"><span>MIC KILL SWITCH (PRIVACY · NO AUDIO LEAVES THE PC)</span>${sw('micKill', S.micKill)}</div>
      <div class="note">Focus shows six widgets; the other six wait in the ring. Full shows all twelve.</div>
      <div class="row"><span>PROACTIVE CHECK-INS (EVERY 30 MIN)</span>${sw('proactive', !!S.proactive)}</div>
      <div class="row"><span>QUIET DURING CALLS AND GAMES</span>${sw('quietMode', !!S.quietMode)}</div>
      <div class="row"><span>HAND GESTURES (CAMERA)</span>${sw('gestures', !!S.gestures)}</div>
      <div class="row"><span>THIS ROOM</span><input type="text" id="optRoom" value="${esc(S.room || '')}" placeholder="KITCHEN · OFFICE" spellcheck="false" style="width:160px"></div>
      <h4>AUTO-TUNE · THIS MACHINE</h4>
      <div class="note" id="tuneNote">${S.tune ? `${esc(S.tune.profile.cpu.name || 'CPU')} · ${S.tune.profile.ram_gb} GB · ${esc((S.tune.profile.gpus || []).map(g => g.name).join(', ') || 'no GPU')}<br>${S.tune.why.map(esc).join('<br>')}${S.gpuWarning ? `<br><b style="color:var(--red)">⚠ ${esc(S.gpuWarning)}</b>` : ''}` : 'Open the control panel and click AUTO-TUNE to size the 3D core, voices and startup profile to this PC.'}</div>
      <div class="row"><span>GOVERNOR (LOWER 3D ON BATTERY · HEAT · LOW MEMORY)</span>${sw('governor', S.governor)}</div>
      <select id="optCam"><option value="">PRESENCE CAMERA: AUTO (FIRST REAL CAMERA)</option>${(cams || []).map(c => `<option value="${esc(c.label)}"${S.presenceCam === c.label ? ' selected' : ''}>PRESENCE CAMERA: ${esc(c.label.toUpperCase().slice(0, 40))}</option>`).join('')}</select>
      <h4>3D CORE</h4>
      <div class="lbtns"><div class="sbtn gl${S.gl === 'auto' ? ' on' : ''}" data-g="auto">AUTO</div><div class="sbtn gl${S.gl === 'on' ? ' on' : ''}" data-g="on">ON</div><div class="sbtn gl${S.gl === 'off' ? ' on' : ''}" data-g="off">OFF (2D)</div></div>
      <div class="lbtns"><div class="sbtn glq${S.glQuality === 'low' ? ' on' : ''}" data-q="low">LOW</div><div class="sbtn glq${S.glQuality === 'medium' ? ' on' : ''}" data-q="medium">MEDIUM</div><div class="sbtn glq${S.glQuality === 'high' ? ' on' : ''}" data-q="high">HIGH</div></div>
      <div class="note">WebGL nebula, volumetric orb with lip-sync, up to 24,000 particles and bloom. Auto drops to low quality on a slow GPU.</div>
      <div class="row"><span>EFFECTS (ARCS, HOLOGRAM, WEATHER, DAY CYCLE)</span>${sw('fx', S.fx)}</div>
      <div class="row"><span>PRESENCE (CAMERA: GREET WHEN YOU ARRIVE)</span>${sw('presence', S.presence)}</div>
      <div class="row"><span>BIG TEXT (25% LARGER, FOR TV OR WEAK EYES)</span>${sw('bigtext', !!S.bigtext)}</div>
      <div class="row"><span>PARALLAX DEPTH</span>${sw('parallax', S.parallax)}</div>
      <div class="row"><span>PARTICLE FIELD</span>${sw('particles', S.particles)}</div>
      <div class="row"><span>IDLE SHAPE CYCLE</span>${sw('idleMorph', S.idleMorph)}</div>
      <div class="row"><span>ORB WANDERS WHEN IDLE</span>${sw('wander', S.wander)}</div>
      <h4>YOU</h4>
      <div class="half"><input type="text" id="optName" value="${esc((cfgU.user || {}).name || 'Boss')}" placeholder="YOUR NAME"><input type="text" id="optNode" value="${esc((cfgU.user || {}).node || 'LOCAL-01')}" placeholder="NODE"></div>
      <div class="half"><input type="number" id="optLat" step="0.0001" value="${(cfgU.location || {}).lat || ''}" placeholder="LAT"><input type="number" id="optLon" step="0.0001" value="${(cfgU.location || {}).lon || ''}" placeholder="LON"></div>
      <input type="text" id="optLabel" value="${esc((cfgU.location || {}).label || '')}" placeholder="CITY LABEL (e.g. BLR)">
      <input type="text" id="optDocs" value="${esc(((cfgU.widgets || {}).documents || {}).dir || '')}" placeholder="DOCUMENTS FOLDER (for 'search my documents')">
      <div class="dbtn" id="saveYou">SAVE TO CONFIG</div>
      <div class="note">Name and location are stored in config.json by the add-ons service and drive the weather and position widgets. Control panel: <b>http://localhost:9000</b></div>`;
    $('drawerX').onclick = () => toggleDrawer(false);
    $('optProvider').onchange = e => { b.provider = e.target.value; save(); brain.ping().then(pill); renderDrawer(); };
    const bindText = (id, fn) => { const el = $(id); if (el) el.onchange = e => { fn(e.target.value.trim()); save(); brain.ping().then(pill); }; };
    bindText('optUrl', v2 => { b.urls[b.provider] = v2.replace(/\/$/, ''); }); bindText('optKey', v2 => { b.keys[b.provider] = v2; }); bindText('optModel', v2 => { b.models[b.provider] = v2; });
    if ($('optModelSel')) $('optModelSel').onchange = e => { if (e.target.value) { b.models[b.provider] = e.target.value; $('optModel').value = e.target.value; save(); pill(); } };
    $('optStrategy').onchange = e => { b.pool.strategy = e.target.value; save(); };
    b.roles = b.roles || { chat: '', work: '', research: '', vision: '' };
    ['chat', 'work', 'research', 'vision'].forEach(role => { $('role_' + role).onchange = e => { b.roles[role] = e.target.value; save(); }; });
    document.querySelectorAll('.themes .sw').forEach(el => el.onclick = () => { applyTheme(el.dataset.t); save(); });
    $('optAvatar').onchange = e => { S.avatar = e.target.value; save(); applyLayout(); };
    $('optFaceStyle').onchange = e => { SAM.face && SAM.face.style(e.target.value); save(); };
    $('optVrm').onchange = e => { S.vrm = e.target.value; save(); applyLayout(); };
    document.querySelectorAll('.sbtn.sk').forEach(el => el.onclick = () => { S.skin = el.dataset.sk; save(); applySkin(); document.querySelectorAll('.sbtn.sk').forEach(b => b.classList.toggle('on', b === el)); });
    $('optFont').onchange = e => { S.font = e.target.value; save(); applySkin(); };
    document.querySelectorAll('.sbtn.gl').forEach(el => el.onclick = () => { S.gl = el.dataset.g; save(); document.querySelectorAll('.sbtn.gl').forEach(b => b.classList.toggle('on', b === el)); if (!SAM.gl) return; if (S.gl === 'off') SAM.gl.disable(); else if (!SAM.gl.on) SAM.gl.enable(S.glQuality); });
    document.querySelectorAll('.sbtn.glq').forEach(el => el.onclick = () => { S.glQuality = el.dataset.q; S.glUser = true; save(); document.querySelectorAll('.sbtn.glq').forEach(b => b.classList.toggle('on', b === el)); if (SAM.gl && SAM.gl.on) SAM.gl.setQuality(S.glQuality); });
    const colPick = () => { S.custom = { a: $('optColA').value, b: $('optColB').value }; applyTheme('custom'); save(); };
    $('optColA').oninput = colPick; $('optColB').oninput = colPick;
    $('optPool').onchange = e => { b.pool.order = e.target.value.split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(x => brain.PROVIDERS[x]); e.target.value = b.pool.order.join(', '); save(); };
    $('optVoice').onchange = e => { v.neuralVoice = e.target.value; const ent = (voiceList || []).find(x => x.id === v.neuralVoice); if (ent && ent.engine) v.tts = ent.engine; save(); };
    $('optTtsEngine').onchange = e => { v.tts = e.target.value; save(); };
    $('optCam').onchange = e => { S.presenceCam = e.target.value; save(); if (S.presence && SAM.fx) { SAM.fx.presence(false); SAM.fx.presence(true); } };
    $('optRoom') && ($('optRoom').onchange = e => setRoom(e.target.value));
    $('optStyle') && ($('optStyle').onchange = e => { v.style = e.target.value; save(); });
    $('optWake') && ($('optWake').onchange = e => { voice.setWakePhrase(e.target.value); save(); });
    $('optStt2').onchange = e => { v.sttEngine = e.target.value; save(); if (voice.micOn) { voice.stop(); setTimeout(() => voice.start(), 300); } };
    $('optCompanion').onchange = e => { v.companion = e.target.value; save(); };
    $('optRate').oninput = e => { v.rate = +e.target.value; $('rateVal').textContent = v.rate.toFixed(1); save(); };
    $('optGain').oninput = e => { v.gain = +e.target.value; $('gainVal').textContent = v.gain.toFixed(1); save(); };
    $('optStt').onchange = e => { voice.setModel(e.target.value); save(); };
    $('optMood').onchange = e => { b.mood = e.target.value; save(); };
    $('optHumor').oninput = e => { b.humor = +e.target.value; $('humorVal').textContent = b.humor; save(); };
    $('voiceTest').onclick = () => say(`Voice check. This is ${v.neuralVoice.split('-')[2] || 'the neural voice'}, standing by, ${brain.user.name}.`, undefined, { quick: true });
    $('micTest').onclick = () => window.open('voice-test.html', '_blank');
    $('saveYou').onclick = async () => { try { const r = await fetch(ADDONS + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: { name: $('optName').value.trim() || 'Boss', node: $('optNode').value.trim() || 'LOCAL-01' }, location: { lat: +$('optLat').value || 0, lon: +$('optLon').value || 0, label: $('optLabel').value.trim() }, widgets: { documents: { dir: $('optDocs').value.trim() } } }) }); if (!r.ok) throw 0; await loadConfig(); widgets.pollAddons('weather'); widgets.pollAddons('position'); log('ok', 'config saved'); } catch (e) { log('warn', 'add-ons service offline · config not saved'); } };
    d.querySelectorAll('.sbtn.lay').forEach(el => el.onclick = () => { S.layout = el.dataset.l; S.focus = null; save(); applyLayout(); renderDrawer(); });
    d.querySelectorAll('.sw').forEach(el => el.onclick = () => {
      const k = el.dataset.sw, on = !el.classList.contains('on'); el.classList.toggle('on', on);
      if (k.startsWith('pin:')) { S.pinned[k.slice(4)] = on ? 1 : 0; if (!on && S.focus === k.slice(4)) S.focus = null; applyLayout(); }
      else if (k === 'sysAccess') b.sysAccess = on; else if (k === 'actions') b.actions = on; else if (k === 'memory') b.memory = on; else if (k === 'stream') b.stream = on;
      else if (k === 'pool') b.pool.enabled = on; else if (k === 'voiceOn') v.voiceOn = on; else if (k === 'wake') { v.wake = on; if (on && !voice.micOn) voice.start(); }
      else if (k === 'bargeIn') { voice.bargeIn = on; try { localStorage.setItem('samurai.bargeIn', on ? '1' : '0'); } catch (e) { } } else if (k === 'parallax') { S.parallax = on; if (!on) ['layerL', 'layerR', 'layerC', 'bg'].forEach(i => $(i).style.transform = ''); }
      else if (k === 'particles') { S.particles = on; core.particles = on && !(SAM.gl && SAM.gl.on); } else if (k === 'idleMorph') S.idleMorph = on; else if (k === 'wander') S.wander = on;
      else if (k === 'fx') { S.fx = on; SAM.fx && SAM.fx.setEnabled(on); } else if (k === 'presence') { S.presence = on; SAM.fx && SAM.fx.presence(on); }
      else if (k === 'governor') S.governor = on; else if (k === 'bigtext') { S.bigtext = on; document.documentElement.classList.toggle('bigtext', on); }
      else if (k === 'depth') { S.depth = on; applySkin(); } else if (k === 'micKill') micKill(on); else if (k === 'gestures') gesturesOn(on); else if (k === 'identify') { v.identify = on; voice.identify(on); } else if (k === 'realtime') submit(on ? 'full duplex on' : 'full duplex off'); else if (k === 'quietMode') { S.quietMode = on; if (!on) releaseHeld(); }
      else if (k === 'proactive') { S.proactive = on; fetch(ADDONS + '/schedules').then(r => r.json()).then(async d => { const ex = (d.schedules || []).find(x => x.command === 'proactive check'); if (on && !ex) await fetch(ADDONS + '/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', schedule: { name: 'proactive check every 30 min', when: { type: 'interval', minutes: 30 }, command: 'proactive check' } }) }); if (!on && ex) await fetch(ADDONS + '/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id: ex.id }) }); }).catch(() => { }); }
      save();
    });
  }
  /* [accent, second accent, bright text] as rgb triplets; the CSS has a matching block per name. 'custom' is built from two colour pickers. */
  const THEMES = { arc: ['46,230,255', '160,124,255', '217,248,255'], ember: ['255,106,61', '255,181,71', '255,227,214'], gold: ['255,194,77', '46,230,255', '255,233,194'], matrix: ['61,255,160', '160,255,124', '214,255,233'], ice: ['142,197,255', '195,166,255', '240,247,255'],
    crimson: ['255,61,110', '255,140,66', '255,219,228'], rose: ['255,122,200', '176,124,255', '255,230,244'], nebula: ['178,124,255', '255,111,216', '239,228,255'], aurora: ['56,242,198', '124,255,158', '223,255,246'],
    ocean: ['56,166,255', '54,227,212', '224,241,255'], sunset: ['255,140,66', '255,77,141', '255,232,214'], solar: ['255,240,77', '255,159,28', '255,251,224'], mono: ['230,230,230', '154,154,154', '255,255,255'],
    stealth: ['90,111,138', '63,95,122', '201,214,230'], lime: ['198,255,61', '61,255,160', '243,255,214'], royal: ['109,124,255', '255,194,77', '230,232,255'], contrast: ['255,255,255', '255,230,0', '255,255,255'], custom: null };
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  function customTheme() {
    const a = hexRgb(S.custom.a), b = hexRgb(S.custom.b), ice = mix(a, [255, 255, 255], .82), text = mix(a, [170, 180, 190], .7), tick = mix(a, [140, 150, 160], .75), muted = mix(a, [90, 100, 110], .8), bg = mix(a, [4, 5, 10], .96);
    const r = document.documentElement.style; r.setProperty('--cyan', S.custom.a); r.setProperty('--cyan-rgb', a.join(',')); r.setProperty('--violet', S.custom.b); r.setProperty('--violet-rgb', b.join(','));
    r.setProperty('--ice', rgbHex(...ice)); r.setProperty('--text', rgbHex(...text)); r.setProperty('--tick', rgbHex(...tick)); r.setProperty('--muted', rgbHex(...muted)); r.setProperty('--bg', rgbHex(...bg));
    return [a.join(','), b.join(','), ice.map(Math.round).join(',')];
  }
  function applyTheme(name) {
    if (!(name in THEMES)) name = 'arc'; S.theme = name; document.documentElement.dataset.theme = name;
    const r = document.documentElement.style; ['--cyan', '--cyan-rgb', '--violet', '--violet-rgb', '--ice', '--text', '--tick', '--muted', '--bg'].forEach(k => r.removeProperty(k));
    const t = name === 'custom' ? customTheme() : THEMES[name]; core.setTheme(t[0], t[1], t[2]); SAM.face && SAM.face.retheme();
    document.querySelectorAll('.themes .sw').forEach(el => el.classList.toggle('on', el.dataset.t === name));
  }
  const themeHex = n => n === 'custom' ? [S.custom.a, S.custom.b] : THEMES[n].slice(0, 2).map(x => rgbHex(...x.split(',').map(Number)));
  function toggleDrawer(open) { S.drawer = open === undefined ? !S.drawer : open; $('drawer').classList.toggle('hidden', !S.drawer); if (S.drawer) renderDrawer(); }
  function pill() { const p = brain.P(brain.cfg.provider); $('pillProvider').textContent = (brain.online ? '' : 'OFFLINE · ') + p.label.split(' — ')[0].replace(' (NO KEY)', ''); }
  async function loadConfig() { const c = await widgets.pollAddons('config'); if (c) { brain.user = { name: (c.user || {}).name || 'Boss', node: (c.user || {}).node || 'LOCAL-01', label: (c.location || {}).label || '' }; $('nodeText').textContent = brain.user.node; widgets.render('tty'); } }

  /* ---------- ticker / clock ---------- */
  function tickClock() {
    const d = new Date(), p = n => String(n).padStart(2, '0'), days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    $('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; $('dateText').textContent = `${days[d.getDay()]} ${p(d.getDate())} ${mons[d.getMonth()]} ${d.getFullYear()}`;
    if (d.getSeconds() % 30 === 0) renderTicker();
  }
  function renderTicker() {
    const t = widgets.data.ticker; let html;
    if (t && (t.markets.length || t.headlines.length)) html = `<span class="lbl">MARKETS</span>&nbsp;&nbsp; ${t.markets.map(m => `${m.sym} ${m.px.toLocaleString()} <span class="${m.chg >= 0 ? 'up' : 'dn'}">${m.chg >= 0 ? '▲' : '▼'}${Math.abs(m.chg)}%</span>`).join(' &nbsp;·&nbsp; ')} &nbsp;&nbsp;&nbsp;&nbsp; <span class="lbl">HEADLINES</span>&nbsp;&nbsp; ${t.headlines.map(esc).join(' &nbsp;·&nbsp; ')} &nbsp;&nbsp;&nbsp;&nbsp; <span class="mut">FEED · LIVE</span>`;
    else html = `<span class="lbl">MARKETS</span>&nbsp;&nbsp; BTC — &nbsp;·&nbsp; ETH — &nbsp;&nbsp;&nbsp;&nbsp; <span class="lbl">HEADLINES</span>&nbsp;&nbsp; add-ons service offline, start it from the dashboard &nbsp;&nbsp;&nbsp;&nbsp; <span class="mut">FEED · SIM</span>`;
    if ($('tape').dataset.h !== html) { $('tape').dataset.h = html; $('tape').innerHTML = `<span>${html}</span><span>${html}</span>`; }
  }

  /* ---------- wiring ---------- */
  /* ---------- skins, fonts, depth ---------- */
  function applySkin() {
    stage.classList.remove('skin-glass', 'skin-wireframe', 'skin-paper'); stage.classList.add('skin-' + (S.skin || 'glass'));
    const r = document.documentElement.style, F = { michroma: null, system: ["'Segoe UI','SF Pro Text',system-ui,sans-serif", "'Segoe UI','SF Pro Text',system-ui,sans-serif", "Consolas,'SF Mono',monospace"], mono: ["'IBM Plex Mono',monospace", "'IBM Plex Mono',monospace", "'IBM Plex Mono',monospace"], serif: ["Georgia,'Times New Roman',serif", "Georgia,'Times New Roman',serif", "'IBM Plex Mono',monospace"] }[S.font || 'michroma'];
    if (F) { r.setProperty('--disp', F[0]); r.setProperty('--body', F[1]); r.setProperty('--mono', F[2]); } else ['--disp', '--body', '--mono'].forEach(k => r.removeProperty(k));
    document.documentElement.classList.toggle('depth', !!S.depth);
  }
  /* ---------- mic kill switch: stops the mic, blocks restarts, mutes the system microphone ---------- */
  function micKill(on) {
    S.micKill = on; save(); document.documentElement.classList.toggle('mickill', on);
    if (on) { voice.stop(); if (S.mode === 'listening') setMode('idle'); }
    fetch(SAM.H + ':9300/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'mic_mute', arg: on ? 'on' : 'off' }) }).catch(() => { });
    log(on ? 'warn' : 'ok', on ? 'mic kill switch ON · no audio leaves this PC' : 'mic kill switch off');
  }
  /* route a command and return the reply text without speaking it (used by full-duplex voice, which speaks on its own) */
  async function submitQuiet(text) {
    const q = String(text || '').trim(); if (!q) return '';
    const low = q.toLowerCase().replace(/[.!?]+$/, ''); let r = quickRoute(low, q);
    try { if (r && r.run) r = await r.run(); else if (!r && brain.online) { const out = await brain.ask(q, brain.cfg.sysAccess ? widgets.snapshot() : null); r = { text: out.reply, focus: out.focus, actions: out.actions, emotion: out.emotion }; } else if (!r) r = offlineRoute(low); } catch (e) { return 'Something went wrong on my side.'; }
    if (!r) return ''; if (SAM.face) SAM.face.set(r.emotion || SAM.face.guess(r.text), r.hold); if (r.focus && S.focus !== r.focus) setFocus(r.focus); if (r.effect) { try { r.effect(); } catch (e) { } } for (const a of r.actions || []) { try { await runAction(a); } catch (e) { } }
    widgets.pushTty(`≈ ${String(r.text || '').slice(0, 120)}`, '#2ee6ff'); return r.text || '';
  }
  brain.onBudget = m => { if (m && m.spoken) { widgets.pushTty(`meter · ${m.spoken}`, '#ff3d6e'); say(m.spoken, 'tty'); } };
  async function POSTJ(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status)); return d; }
  /* ---------- activity awareness: quiet during calls and games, hold proactive speech until you are back ---------- */
  S.quiet = false; S.quietWhy = ''; S.heldEvents = [];
  function releaseHeld() { const held = S.heldEvents.splice(0); if (held.length) { widgets.pushTty(`${held.length} held event(s) while you were busy`, '#a07cff'); say(`While you were busy: ${held.slice(-3).map(e => e.text).join('. ').slice(0, 300)}`); } }
  async function pollActivity() {
    try { const d = await (await fetch(ADDONS + '/activity')).json(); const quiet = !!(d.quiet || d.fullscreen); const why = d.quiet ? d.category : d.fullscreen ? 'full screen' : '';
      if (quiet !== S.quiet) { S.quiet = quiet; S.quietWhy = why; document.documentElement.classList.toggle('quiet', quiet); widgets.pushTty(quiet ? `quiet · ${why} (${d.app || 'app'})` : 'back · speaking up again', '#6a8ea3'); if (!quiet) releaseHeld(); }
    } catch (e) { }
  }
  setInterval(pollActivity, 10000); T(pollActivity, 4000);
  /* ---------- rooms: several HUDs on the LAN, one brain ---------- */
  function setRoom(name) { S.room = String(name || '').toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim().slice(0, 32); save(); registerRoom(); }
  function registerRoom() { if (!S.room) return; fetch(ADDONS + '/rooms/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: S.room, kind: SAM.inApp ? 'app' : location.search.includes('kiosk') ? 'kiosk' : 'pc' }) }).catch(() => { }); }
  setInterval(registerRoom, 60000); T(registerRoom, 2500);
  /* ---------- hand gestures (hud-gestures.js) ---------- */
  let lastGesture = 0;
  function gesturesOn(on) { S.gestures = on; save(); try { on ? SAM.gestures.start() : SAM.gestures.stop(); } catch (e) { log('warn', 'gestures need the camera and the vendored MediaPipe files'); } document.documentElement.classList.toggle('gestures', on); }
  window.addEventListener('samurai-gesture', ev => {
    const g = ev.detail && ev.detail.name, now = Date.now(); if (!g || now - lastGesture < 900) return; lastGesture = now;
    widgets.pushTty(`✋ ${g}`, '#a07cff'); try { fx.flash && fx.flash(); } catch (e) { }
    const v = widgets.data.video, playingVid = v && v.now;
    if (g === 'open_palm') { if (playingVid) widgets.video('toggle'); else widgets.music(widgets.data.music.now.playing ? 'pause' : 'play'); }
    else if (g === 'fist') runAction({ type: 'volume_mute', arg: '' });
    else if (g === 'thumbs_up') { if (S.pendingConfirm || /confirm/i.test(S.lastReply || '')) submit('confirm'); else say('Noted.'); }
    else if (g === 'index_up') { if (!voice.micOn) voice.start(); setMode('listening'); }
    else if (g === 'swipe_left') { playingVid ? widgets.video('next') : widgets.music('next'); }
    else if (g === 'swipe_right') { playingVid ? widgets.video('prev') : widgets.music('prev'); }
  });
  if (S.gestures) T(() => gesturesOn(true), 6000);
  /* ---------- faces (hud-faces.js): greet enrolled people once an hour ---------- */
  const greeted = {};
  window.addEventListener('samurai-face', ev => { const n = ev.detail && ev.detail.name; if (!n) return; const now = Date.now(); if (greeted[n] && now - greeted[n] < 3600000) return; greeted[n] = now; widgets.pushTty(`👤 ${n} · ${Math.round((ev.detail.confidence || 0) * 100)}%`, '#a07cff'); if (!(S.quiet && S.quietMode)) say(`Welcome back, ${n}.`); });
  /* mic privacy light follows the system mute state reported by the action server */
  fetch(SAM.H + ':9300/mic').then(r => r.json()).then(d => { if (d && d.muted === true && !S.micKill) log('warn', 'system microphone is muted'); }).catch(() => { });
  const _vstart = voice.start.bind(voice); voice.start = (...a) => { if (S.micKill) { log('warn', 'mic is killed · say nothing, flip the switch in settings'); return Promise.resolve(false); } return _vstart(...a); };
  setInterval(() => { document.documentElement.classList.toggle('mic-live', !!voice.micOn && !S.micKill && (voice.level || 0) > .02); document.documentElement.classList.toggle('mic-open', !!voice.micOn && !S.micKill); }, 250);
  /* ---------- particles form the widget's icon for a moment before it opens ---------- */
  const ICON = { wx: 'cloud', sys: 'pulse', home: 'house', map: 'pin', tmr: 'clock', msg: 'envelope', task: 'check', mus: 'note', cam: 'eye', scr: 'screen', cal: 'clock', web: 'globe' };
  let iconT = null;
  function iconMorph(id) {
    if (!S.fx || !ICON[id] || core.showcase()) return; const prev = core.shapeName; if (prev.startsWith('icon:')) return;
    core.setShape('icon:' + ICON[id]); clearTimeout(iconT); iconT = setTimeout(() => { if (core.shapeName === 'icon:' + ICON[id]) core.setShape(prev); }, 1500);
  }
  /* ---------- pop a widget out into a small always-on-top window (Document Picture-in-Picture, Chrome 116+) ---------- */
  async function popOut(id) {
    const card = document.querySelector(`.card[data-id=${id}]`); if (!card) return 'No such widget.';
    if (!('documentPictureInPicture' in window)) return 'This browser cannot pop widgets out. Chrome 116 or newer can.';
    try {
      const pw = await documentPictureInPicture.requestWindow({ width: 420, height: 360 });
      [...document.styleSheets].forEach(ss => { try { const st = pw.document.createElement('style'); st.textContent = [...ss.cssRules].map(r => r.cssText).join('\n'); pw.document.head.appendChild(st); } catch (e) { if (ss.href) { const l = pw.document.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; pw.document.head.appendChild(l); } } });
      pw.document.body.style.cssText = 'margin:0;background:#05060d;overflow:hidden'; const holder = pw.document.createElement('div'); holder.style.cssText = 'position:relative;width:272px;height:250px;transform:scale(1.4);transform-origin:0 0'; pw.document.body.appendChild(holder);
      const clone = card.cloneNode(true); clone.style.position = 'absolute'; clone.style.inset = '0'; holder.appendChild(clone);
      const iv = setInterval(() => { if (pw.closed) { clearInterval(iv); return; } const live = document.querySelector(`.card[data-id=${id}] .body`); const c = clone.querySelector('.body'); if (live && c && c.innerHTML !== live.innerHTML) c.innerHTML = live.innerHTML; }, 2000);
      return `${W.find(w => w.id === id).title} is floating in its own window.`;
    } catch (e) { return 'Pop-out was blocked: ' + String(e.message).slice(0, 60); }
  }
  /* ---------- auto-tune: defaults from the control panel's hardware profile (only where the user has not chosen) ---------- */
  const PANEL = SAM.H + ':9000';
  async function loadTune() {
    try {
      const t = await (await fetch(PANEL + '/tune')).json(); if (!t.ok) return; S.tune = t; const rec = t.recommendation || {};
      if (!S.glUser && rec.gl_quality) S.glQuality = rec.gl_quality;
      if (S.gl === 'auto' && rec.gl === 'off') S.gl = 'off';
      if (rec.half_duplex && localStorage.getItem('samurai.bargeIn') === null) voice.bargeIn = false;
      if (!S.presenceCam && rec.presence_camera) S.presenceCam = rec.presence_camera;
      (t.warnings || []).forEach(w => log('warn', 'auto-tune · ' + w));
      if (SAM.gl && SAM.gl.on && SAM.gl.quality !== S.glQuality && !S.glUser) SAM.gl.setQuality(S.glQuality);
    } catch (e) { }
  }
  /* ---------- governor: lower the load on battery, heat or low memory; restore when it clears ---------- */
  const GOV = { level: 0, pending: 0, pendingWant: -1, saved: null };
  function governor() {
    if (!S.governor || !SAM.gl) return;
    const tel = widgets.data.tel || {}, onBattery = tel.battery && tel.battery.plugged === false, hot = (tel.temp || 0) > 85, lowMem = (tel.mem || 0) > 90;
    const want = lowMem ? 2 : (hot || onBattery) ? 1 : 0, now = Date.now();
    if (want === GOV.level) { GOV.pending = 0; return; }
    if (want < GOV.level) {                                            // hysteresis: one quiet minute before restoring
      if (!GOV.pending || GOV.pendingWant !== want) { GOV.pending = now; GOV.pendingWant = want; return; }
      if (now - GOV.pending < 60000) return;
    }
    GOV.pending = 0;
    const reason = lowMem ? 'memory above 90%' : hot ? `CPU at ${tel.temp}°` : 'on battery';
    if (want > GOV.level && !GOV.saved) GOV.saved = { gl: S.gl, q: S.glQuality, fx: S.fx };
    if (want === 2) { if (SAM.gl.on) SAM.gl.disable(); SAM.fx && SAM.fx.setEnabled(false); log('warn', `governor · ${reason}: 2D core, effects off`); }
    else if (want === 1) { if (S.gl !== 'off') { if (!SAM.gl.on) SAM.gl.enable('low'); else if (SAM.gl.quality !== 'low') SAM.gl.setQuality('low'); } SAM.fx && SAM.fx.setEnabled(S.fx); log('info', `governor · ${reason}: 3D on low`); }
    else if (GOV.saved) { if (GOV.saved.gl !== 'off') { if (!SAM.gl.on) SAM.gl.enable(GOV.saved.q); else SAM.gl.setQuality(GOV.saved.q); } SAM.fx && SAM.fx.setEnabled(GOV.saved.fx); log('ok', 'governor · back to normal'); GOV.saved = null; }
    GOV.level = want;
  }
  /* ---------- essentials profile: start a sidecar on demand and wait for it ---------- */
  const SERVICE_PROBE = { browser: SAM.H + ':9600/browser/status', agent: SAM.H + ':9400/', tts: SAM.H + ':9200/', speech: SAM.H + ':9100/' };
  const probing = {};
  async function ensureService(key) {
    const url = SERVICE_PROBE[key]; if (!url) return true;
    const up = async () => { try { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 1500); await fetch(url, { signal: ctl.signal }); return true; } catch (e) { return false; } };
    if (await up()) return true;
    if (!probing[key]) { probing[key] = (async () => { log('info', `starting ${key} service…`); try { await fetch(PANEL + '/panel/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', key }) }); } catch (e) { } for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 1000)); if (await up()) return true; } return false; })().finally(() => { setTimeout(() => { probing[key] = null; }, 2000); }); }
    return probing[key];
  }
  /* ---------- chromeless app window (pywebview): slim bar with drag, pin, minimize, fullscreen, close ---------- */
  const APP_WINDOW = new URLSearchParams(location.search).get('app') === '1';
  function appWindow() {
    document.documentElement.classList.add('app');
    const bar = document.createElement('div'); bar.id = 'appbar'; bar.className = 'appbar';
    bar.innerHTML = `<div class="drag" id="appDrag"><i></i>SAMURAI</div><div class="btns"><span id="appPin" title="always on top">PIN</span><span id="appMin" title="minimize">MIN</span><span id="appFull" title="fullscreen">FULL</span><span id="appClose" title="close">✕</span></div>`;
    document.body.appendChild(bar);
    const api = () => window.pywebview && window.pywebview.api;
    let drag = null;
    $('appDrag').addEventListener('mousedown', e => { drag = { x: e.screenX, y: e.screenY }; e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (!drag || !api()) return; const dx = e.screenX - drag.x, dy = e.screenY - drag.y; if (dx || dy) { api().move(dx, dy); drag = { x: e.screenX, y: e.screenY }; } });
    window.addEventListener('mouseup', () => { drag = null; });
    const refresh = async () => { try { const st = await api().get_state(); $('appPin').classList.toggle('on', !!st.on_top); $('appFull').classList.toggle('on', !!st.fullscreen); } catch (e) { } };
    $('appPin').onclick = async () => { if (api()) { const on = await api().toggle_on_top(); $('appPin').classList.toggle('on', !!on); } };
    $('appMin').onclick = () => api() && api().minimize();
    $('appFull').onclick = async () => { if (api()) { const on = await api().fullscreen(); $('appFull').classList.toggle('on', !!on); } };
    $('appClose').onclick = () => api() ? api().close() : window.close();
    if (api()) refresh(); else window.addEventListener('pywebviewready', refresh);
    window.addEventListener('samurai-hotkey', () => { $('cmd').focus(); });
  }
  function init() {
    if (APP_WINDOW) appWindow();
    let dragX = null; stage.addEventListener('mousedown', e => { if (S.layout === 'desk' && !e.target.closest('.card,.drawer,.inputbar,.console,.node')) dragX = e.clientX; });
    window.addEventListener('mousemove', e => { if (dragX !== null) { S.deskRot += (e.clientX - dragX) * .25; dragX = e.clientX; applyLayout(); } }); window.addEventListener('mouseup', () => { if (dragX !== null) { dragX = null; save(); } });
    applySkin();
    loadTune(); setInterval(governor, 10000);
    if (COMPANION) { companionEvents(); voice.cfg.sttEngine = voice.phoneCapable ? 'phone' : voice.cfg.sttEngine; if (!voice.cfg.companion || voice.cfg.companion === 'off') voice.cfg.companion = 'phone'; document.documentElement.dataset.companion = '1'; }
    else voice.relay.pollLoop(async c => { const quiet = c.speak_on === 'phone', was = voice.cfg.voiceOn; if (quiet) voice.cfg.voiceOn = false; widgets.pushTty(`phone · ${c.text}`, '#ffb84d'); console.log('relay · from phone: ' + c.text); let text = ''; try { text = await submit(c.text); } finally { if (quiet) voice.cfg.voiceOn = was; } setTimeout(() => { $('transcript').textContent = `from your phone: "${c.text}"`; $('transcript').classList.add('on'); }, 60); return text || S.lastReply || ''; });
    load(); core.particles = S.particles;
    if (S.reduced) stage.classList.add('rm');
    widgets.mount($('layerL'), $('layerR'), $('nodes')); core.init($('core'));
    if (DEMO) $('stripL').classList.remove('hidden');
    window.addEventListener('resize', onResize); onResize(); root.addEventListener('mousemove', onMove);
    document.querySelectorAll('.node').forEach(n => n.addEventListener('click', () => setFocus(n.dataset.id)));
    document.querySelectorAll('.card').forEach(c => c.addEventListener('click', e => { if (e.target.closest('input,select,.btn,.tile,.task,.mctl,#feed')) return; setFocus(c.dataset.id); }));
    $('backdrop').addEventListener('click', () => setFocus(null));
    $('sendBtn').addEventListener('click', () => submit($('cmd').value));
    $('cmd').addEventListener('keydown', e => { if (e.key === 'Enter') submit(e.target.value); });
    $('micBtn').addEventListener('click', async () => { if (voice.micOn) { voice.stop(); log('ok', 'mic off'); } else { await voice.start(); } });
    $('cfgBtn').addEventListener('click', () => toggleDrawer());
    $('alertBlock').addEventListener('click', blockIp); $('alertDismiss').addEventListener('click', () => setMode('idle'));
    document.querySelectorAll('#stripL .sbtn').forEach(b => b.addEventListener('click', () => { const s = b.dataset.s; if (s === 'reboot') return boot(); if (s === 'shape') return core.nextShape(true); if (s === 'listening') return voice.micOn ? voice.stop() : voice.start(); if (s === 'speaking') return say('Systems nominal. Twelve add-ons pinned, neural core linked, voice stack warm.'); if (s === 'alert') return submit('alert demo'); setMode(s); }));
    document.querySelectorAll('.stripR .sbtn.lay').forEach(b => b.addEventListener('click', () => { S.layout = b.dataset.l; S.focus = null; save(); applyLayout(); }));
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (S.focus) setFocus(null); if (S.drawer) toggleDrawer(false); if (S.mode === 'alert') setMode('idle'); voice.stopSpeaking('esc'); }
      if (e.key === '/' && document.activeElement !== $('cmd')) { e.preventDefault(); $('cmd').focus(); }
    });
    setInterval(() => { if (!S.idleMorph || S.mode !== 'idle' || S.focus || Date.now() < core.shapeLock) return; core.nextShape(false); }, 9000);
    setInterval(() => { if (S.mode === 'listening' || S.mode === 'speaking') { S.tick++; eyes(); $('orb').classList.toggle('pulse', S.tick % 2 === 1); } else $('orb').classList.remove('pulse'); }, 320);
    tickClock(); setInterval(tickClock, 1000); blinkLoop(); eyes();
    widgets.startPolling(); loadConfig().then(() => { brain.loadMemory(); });
    brain.agentPing().then(() => brain.ping().then(pill)); setInterval(() => brain.ping().then(pill), 30000);
    setInterval(pollEvents, 10000);
    fetch(ACTION_URL.replace('/action', '') + '/actions').then(r => r.json()).then(d => { brain.extraActions = d.plugins || []; if (brain.extraActions.length) log('ok', `${brain.extraActions.length} plugin tool(s) loaded`); }).catch(() => { });
    applyTheme(S.theme || 'arc');
    setTimeout(renderTicker, 1500);
    if (voice.cfg.wake) T(() => voice.start(), 4000);
    boot();
  }
  SAM.hud = { S, WD, submit, say, setMode, boot, setFocus, toggleDrawer, applyLayout, showAlert, __run: runAction, applyTheme, desktopTask, quickRoute, log, ensureService, loadTune };
  init();
})(window.SAM);
