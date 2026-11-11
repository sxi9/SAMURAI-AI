/* SAMURAI HUD v3 — state machine, layout, boot, focus / fly-in, settings drawer, commands, voice wiring. */
(function (SAM) {
  const core = SAM.core, voice = SAM.voice, brain = SAM.brain, widgets = SAM.widgets, W = widgets.W, NODE = widgets.NODE;
  const $ = id => document.getElementById(id), esc = widgets.esc;
  const ACTION_URL = SAM.H + ':9300/action', ADDONS = SAM.H + ':9500';
  const MODES = { idle: ['IDLE', 'awaiting command', '#2ee6ff'], listening: ['LISTENING', 'say "samurai" + command', '#d9f8ff'], thinking: ['PROCESSING', 'neural core', '#a07cff'], speaking: ['SPEAKING', 'neural voice', '#2ee6ff'], alert: ['ALERT', 'security watch · high', '#ff3d6e'], boot: ['BOOT', 'initialising', '#6a8ea3'] };
  const BOOT = ['mounting telemetry sidecar :8765', 'voice model vosk ready', 'neural core linked', 'action server :9300 armed', 'add-ons · 12 pinned', 'assembling HUD'];
  const DEMO = new URLSearchParams(location.search).has('demo');
  const SAVE_KEY = 'samurai.hud3';

  const S = {
    mode: 'boot', layout: 'focus', pinned: Object.fromEntries(W.map(w => [w.id, 1])), focus: null, drawer: false,
    assembled: false, stagger: false, blink: false, tick: 0, flow: false, vw: 1920, vh: 1080, scale: 1, cols: 3, k: .5,
    parallax: true, particles: true, idleMorph: true, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    typing: null, speakGen: 0, lastAlertSource: null, pendingConfirm: null, wakeArmed: false,
  };
  const stage = $('stage'), root = $('root');
  const timers = []; const T = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };

  /* ---------- persistence ---------- */
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      Object.assign(brain.cfg, s.brain || {}); Object.assign(voice.cfg, s.voice || {});
      if (s.ui) { S.layout = s.ui.layout || 'focus'; Object.assign(S.pinned, s.ui.pinned || {}); S.parallax = s.ui.parallax ?? true; S.particles = s.ui.particles ?? true; S.idleMorph = s.ui.idleMorph ?? true; S.theme = s.ui.theme || 'arc'; S.proactive = !!s.ui.proactive; }
      // migrate the v2 page's provider settings once
      if (!s.brain) { const old = JSON.parse(localStorage.getItem('samuraiLLM') || 'null'); if (old) { const map = { local: 'ollama', openai: 'openai', claude: 'claude', gemini: 'gemini', claudecode: 'claudecode', geminicli: 'geminicli' }; brain.cfg.provider = map[old.provider] || 'ollama'; Object.assign(brain.cfg.keys, old.keys || {}); for (const [k, v] of Object.entries(old.models || {})) if (v) brain.cfg.models[map[k] || k] = v; } }
    } catch (e) { }
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ brain: brain.cfg, voice: voice.cfg, ui: { layout: S.layout, pinned: S.pinned, parallax: S.parallax, particles: S.particles, idleMorph: S.idleMorph, theme: S.theme, proactive: S.proactive } })); } catch (e) { } }

  /* ---------- mode / core ---------- */
  function setMode(m) {
    if (S.mode === m) return;
    S.mode = m; core.mode = m; stage.dataset.mode = m;
    const [l, sub, col] = MODES[m] || MODES.idle;
    $('stateLabel').textContent = l; $('stateLabel').style.color = col; $('stateLabel').style.textShadow = `0 0 16px ${col}`;
    $('stateSub').textContent = m === 'speaking' ? `neural voice · ${(voice.cfg.neuralVoice.split('-')[2] || 'aria').replace('Neural', '')}` : sub;
    $('pillMic').textContent = m === 'listening' ? 'MIC · HOT' : (voice.micOn ? 'MIC · OPEN' : 'MIC · ARMED');
    $('alertPulse').classList.toggle('hidden', m !== 'alert'); $('alert').classList.toggle('hidden', m !== 'alert');
    eyes();
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
    BOOT.forEach((l, i) => T(() => { $('bootLog').insertAdjacentHTML('beforeend', `<div>▸ ${l}</div>`); const pct = Math.round((i + 1) / BOOT.length * 100); $('bootBar').style.width = pct + '%'; $('bootPct').textContent = pct; }, 400 + i * 330));
    const end = 400 + BOOT.length * 330 + 250;
    T(() => $('bootWrap').classList.add('off'), end);
    T(() => { setMode('idle'); S.assembled = true; S.stagger = true; applyLayout(); $('welcome').classList.remove('hidden'); }, end + 700);
    T(() => { S.stagger = false; applyLayout(); }, end + 2600);
    T(() => $('welcome').classList.add('hidden'), end + 3900);
  }

  /* ---------- layout: slots, fly, halo, flow ---------- */
  const FOCUS_SET = { sys: 1, cal: 1, task: 1, wx: 1, mus: 1, home: 1 };     // the calmer default: six widgets, six docked in the ring
  function applyLayout() {
    const ambient = S.layout === 'ambient', focusMode = S.layout === 'focus';
    stage.classList.toggle('calm', focusMode || ambient);
    W.forEach((w, i) => {
      const slot = document.querySelector(`.slot[data-id=${w.id}]`), fly = document.querySelector(`.fly[data-id=${w.id}]`), node = document.querySelector(`.node[data-id=${w.id}]`);
      const docked = ambient || !S.pinned[w.id] || (focusMode && !FOCUS_SET[w.id]), focused = S.focus === w.id;
      node.classList.toggle('docked', docked && !focused); node.classList.toggle('focused', focused);
      if (S.flow) {
        slot.style.left = slot.style.top = '';
        slot.classList.toggle('docked', docked && !focused); fly.style.cssText = ''; fly.classList.toggle('focus', focused); fly.classList.toggle('dim', !!S.focus && !focused);
        if (focused) { const fs = Math.max(1, Math.min(2.2, (S.vw - 24) / 300, (S.vh - 180) / 250)); fly.style.transform = `scale(${fs})`; }
        return;
      }
      slot.classList.remove('docked'); fly.classList.remove('focus', 'dim'); slot.style.left = w.x + 'px'; slot.style.top = w.y + 'px';
      const cx = w.x + 136, cy = w.y + 125, [nx, ny] = NODE(w.node); let st;
      if (!S.assembled) st = `transform:perspective(1400px) translate(${960 - cx}px,${470 - cy}px) rotateY(0deg) scale(.1);opacity:0;visibility:hidden;transition:none`;
      else if (focused) st = `z-index:60;transform:perspective(1400px) translate(${960 - cx}px,${482 - cy}px) rotateY(0deg) scale(2.2);opacity:1;visibility:visible`;
      else if (docked) st = `transform:perspective(1400px) translate(${nx - cx}px,${ny - cy}px) rotateY(0deg) scale(.08);opacity:0;visibility:hidden`;
      else st = `transform:perspective(1400px) translate(0px,0px) rotateY(${w.side === 'L' ? 9 : -9}deg) scale(1);opacity:${S.focus ? .22 : 1};filter:${S.focus ? 'blur(1px)' : 'none'};visibility:visible;transition-delay:${S.stagger ? i * 70 : 0}ms`;
      fly.style.cssText = st;
    });
    $('backdrop').classList.toggle('hidden', !S.focus);
    document.querySelectorAll('.sbtn.lay').forEach(b => b.classList.toggle('on', b.dataset.l === S.layout));
    document.querySelectorAll('.drawer .sbtn.lay').forEach(b => b.classList.toggle('on', b.dataset.l === S.layout));
  }
  function setFocus(id) { S.focus = S.focus === id && id !== null ? null : id; if (S.focus && S.flow) document.querySelector(`.slot[data-id=${S.focus}]`).classList.remove('docked'); applyLayout(); }
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

  /* ---------- reply / speech ---------- */
  function setReply(t) { $('reply').textContent = t; }
  function say(text, focus, opts = {}) {
    clearInterval(S.typing); const gen = ++S.speakGen;
    if (focus !== undefined) { S.focus = focus; applyLayout(); }
    setMode('speaking'); setReply('');
    let i = 0, typingDone = false, audioDone = false, settled = false;
    const finish = () => { if (settled || !(typingDone && audioDone) || gen !== S.speakGen) return; settled = true; setReply(text); T(() => { if (gen === S.speakGen && S.mode === 'speaking') setMode(voice.micOn ? 'listening' : 'idle'); opts.after && opts.after(); }, opts.quick ? 400 : 2400); };
    const startTyping = () => { if (i) return; S.typing = setInterval(() => { i++; setReply(text.slice(0, i)); if (i >= text.length) { clearInterval(S.typing); typingDone = true; finish(); } }, 22); };
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
    const startTyping = () => { if (started) return; started = true; setMode('speaking'); setReply(''); S.typing = setInterval(() => { if (gen !== S.speakGen) { clearInterval(S.typing); return; } if (shown.length < target.length) { shown = target.slice(0, shown.length + 1); setReply(shown); } else if (ended) { clearInterval(S.typing); finish(); } }, 22); };
    return {
      push(text) { if (gen !== S.speakGen || !text) return; target = text; startTyping(); flush(false); },
      end(text) { if (gen !== S.speakGen) return; if (text != null) target = text; startTyping(); ended = true; flush(true); if (!target) { settled = true; setMode(voice.micOn ? 'listening' : 'idle'); } },
      active: () => gen === S.speakGen && started,
    };
  }

  /* ---------- commands ---------- */
  const SHAPES = [[/\b(heart|love)\b/, 'heart', 'Heart, as requested.'], [/\b(cube|box)\b/, 'cube', 'Cube.'], [/\b(galaxy|spiral|stars)\b/, 'galaxy', 'One galaxy, three arms.'], [/\b(helix|dna)\b/, 'helix', 'Double helix.'], [/\bknot\b/, 'knot', 'Torus knot.'], [/\b(ring|halo|torus)\b/, 'ring', 'Ring.'], [/\b(wave|waves|ocean|ripple)\b/, 'wave', 'Wave field.'], [/\b(sphere|cloud|particles)\b/, 'sphere', 'Back to the cloud.']];
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, sixty: 60 };
  function quickRoute(q) {
    const has = (...k) => k.some(x => q.includes(x));
    if (/^(alert demo|alert|threat|intrusion|breach)$/.test(q)) return { alert: true };
    if (/^(reboot|restart hud|restart samurai|reboot samurai)$/.test(q)) return { reboot: true };
    if (/\b(make|show|draw|form|become|turn into|shape)\b/.test(q) || /^(heart|cube|galaxy|helix|knot|ring|wave|sphere)$/.test(q)) for (const [re, name, text] of SHAPES) if (re.test(q)) return { shape: name, text };
    const sp = q.match(/\b(?:spell|write|text|type)\s+(.{1,12}?)\s*$/); if (sp) { const w = sp[1].toUpperCase(); return { shape: 'text:' + w, text: `Spelling ${w}.` }; }
    if (/^(ambient|ambient mode|ambient layout)$/.test(q)) return { text: 'Ambient mode. Widgets stay docked in the ring until you ask for them.', effect: () => { S.layout = 'ambient'; save(); applyLayout(); } };
    if (has('full layout', 'show all', 'full mode', 'show everything', 'dashboard mode')) return { text: 'Full layout restored.', effect: () => { S.layout = 'full'; save(); applyLayout(); } };
    if (/^(focus layout|focus mode layout|calm (mode|layout)|less widgets|fewer widgets|declutter)$/.test(q)) return { text: 'Focus layout. Six widgets, the rest wait in the ring.', effect: () => { S.layout = 'focus'; save(); applyLayout(); } };
    const pl = q.match(/^(?:plan|make a plan|do all this|multi ?step)[:,]?\s+(.{4,})$/); if (pl) return { plan: pl[1] };
    if (/^proactive check$/.test(q)) return { proactive: true };
    const tm = q.match(/\b(?:timer|countdown|alarm)\b.*?(\d+|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|sixty)\s*(?:min|minute|m\b)/) || q.match(/(\d+|one|two|three|four|five|ten|fifteen|twenty|thirty)\s*(?:min|minute)s?\s*(?:timer|countdown)/);
    if (tm) { const n = WORDS[tm[1]] || +tm[1]; return { focus: 'tmr', text: `Timer set, ${n} minute${n > 1 ? 's' : ''}. I'll ping you when it's done.`, effect: () => widgets.timerStart(n * 60) }; }
    if (/\b(stop|cancel|reset)\b.*\btimer\b|\btimer\b.*\b(stop|cancel|reset)\b/.test(q)) return { focus: 'tmr', text: 'Timer cleared.', effect: () => widgets.timerReset() };
    if (/^(pause|pause music|stop music|stop the music)$/.test(q)) return { focus: 'mus', text: 'Paused.', effect: () => widgets.music('pause') };
    if (/^(next|next track|next song|skip)$/.test(q)) return { focus: 'mus', text: 'Next track.', effect: () => widgets.music('next') };
    const vl = q.match(/^(?:set )?volume (?:to )?(\d{1,3})%?$/); if (vl) return { text: `Volume ${vl[1]} percent.`, actions: [{ type: 'volume_set', arg: vl[1] }] };
    if (/^(volume up|louder|turn it up)$/.test(q)) return { text: 'Louder.', actions: [{ type: 'volume_up', arg: '10' }] };
    if (/^(volume down|quieter|turn it down)$/.test(q)) return { text: 'Quieter.', actions: [{ type: 'volume_down', arg: '10' }] };
    if (/^(mute|unmute)$/.test(q)) return { text: q === 'mute' ? 'Muted.' : 'Unmuted.', actions: [{ type: 'mute' }] };
    if (/^(show|open|focus) (the )?(weather|forecast)$/.test(q)) return { focus: 'wx', text: null };
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
    if (has('play ', 'music', 'song')) { const what = (q.match(/play (?:me )?(?:some )?(.+)/) || [])[1] || ''; return { focus: 'mus', text: what ? `Playing ${what}.` : 'Playing music.', effect: () => widgets.music(what ? 'find' : 'play', what) }; }
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

  async function submit(input) {
    const q = (input || '').trim(); if (!q) return;
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
      else if (r && r.proactive) { r = await proactiveCheck(); if (!r) { setMode(voice.micOn ? 'listening' : 'idle'); return; } }
      else if (!r) {
        if (brain.online) {
          llmSnap = brain.cfg.sysAccess ? widgets.snapshot() : null;
          const sc = sayStream();
          try { const out = await brain.ask(q, llmSnap, text => sc.push(text)); r = { text: out.reply, focus: out.focus, actions: out.actions, shape: out.shape, provider: out.provider, stream: sc }; }
          catch (e) { log('warn', `neural core · ${String(e.message).slice(0, 70)}`); if (sc.active()) { sc.end(); return; } r = offlineRoute(low); }
        } else r = offlineRoute(low);
      }
    } catch (e) { r = { text: 'Something went wrong on my side.' }; }
    if (r.alert) { showAlert({ level: 'HIGH', title: `Unusual login pattern on node ${widgets.nodeLabel}`, source: '203.0.113.9 · unknown host', vector: 'SSH · 3 failed attempts in 40 s', asset: 'login service', demo: true }); return; }
    if (r.reboot) { boot(); return; }
    r.effect && r.effect();
    if (r.shape) { const ok = core.setShape(r.shape.startsWith('text:') ? r.shape : String(r.shape).toLowerCase(), true); if (!ok && !r.text) r.text = 'Already there.'; }
    const acts = r.actions || []; const results = [];
    for (const a of acts) { const res = await runAction(a); if (res) results.push(res); }
    let text = r.text == null ? (results[0] || 'Done.') : r.text;
    if (r.text && results.length && acts.some(a => a.type === 'clipboard_get')) text += ' ' + results.join(' ');
    if (r.stream) { if (r.focus !== undefined) { S.focus = r.focus; applyLayout(); } r.stream.end(text); return; }
    say(text, r.focus === undefined ? null : r.focus);
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
  async function runAction(a) {
    const type = String(a.type || '').toLowerCase(), arg = String(a.arg ?? '').trim();
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
        case 'layout': S.layout = arg === 'ambient' ? 'ambient' : 'full'; save(); applyLayout(); return null;
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
        case 'browse_open': case 'browse_read': case 'browse_click': case 'browse_type': case 'browse_find': case 'browse_back': case 'browse_screenshot': {
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
  async function pollEvents() {
    try {
      const d = await (await fetch(`${ADDONS}/events?since=${eventsSince}`)).json(); eventsSince = d.now || eventsSince;
      for (const e of d.events || []) {
        if (S.mode === 'thinking') continue;
        if (e.kind === 'command') { widgets.pushTty(`⏰ ${e.source}: ${e.text}`, '#a07cff'); await submit(e.text); }
        else { widgets.pushTty(`${e.kind === 'alert' ? '⚠' : '⏰'} ${e.text}`, e.kind === 'alert' ? '#ff3d6e' : '#a07cff'); say(e.text, e.kind === 'alert' ? 'sys' : null); }
      }
    } catch (err) { }
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
    for (let n = 1; n <= 3 && start + n <= words.length; n++) { const cand = words.slice(start, start + n).join('').toLowerCase().replace(/[^a-z]/g, ''); if (cand === ww || (cand.length >= 5 && lev(cand, ww) <= (n >= 2 ? 5 : Math.max(2, Math.ceil(ww.length * .55)))) || (ww === 'samurai' && /^(s|d|z|th|sh)?[a-z]{2,5}a?w?r(ai|i|y|ye|ie|ee)$/.test(cand) && cand.length <= 10)) return { found: true, rest: words.slice(start + n).join(' ').replace(/^[\s,.:!-]+/, '').trim() }; }
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
  widgets.onTimerDone = () => { say("Timer's up.", 'tmr'); };
  widgets.onSecurity = sec => showAlert(sec);
  widgets.onAction = (type, arg) => runAction({ type, arg });
  widgets.onTicker = () => renderTicker();
  core.onShape = (name, locked) => { $('shapeText').textContent = `PARTICLES · ${name.replace('text:', '').toUpperCase()}`; const box = $('shapeText').parentElement; box.classList.add('show'); clearTimeout(S.shapeHideT); S.shapeHideT = setTimeout(() => box.classList.remove('show'), 6000); if (locked) widgets.pushTty(`particles → ${name.replace('text:', 'text ')}`, '#a07cff'); };

  /* ---------- settings drawer ---------- */
  const MOODS = [['professional', 'PROFESSIONAL — CRISP'], ['balanced', 'BALANCED — BUTLER'], ['witty', 'WITTY — PLAYFUL'], ['deadpan', 'DEADPAN — DRY'], ['sarcastic', 'SARCASTIC — SNARKY BUTLER'], ['hype', 'HYPE — HIGH ENERGY']];
  let voiceList = null;
  async function renderDrawer() {
    const d = $('drawer'), b = brain.cfg, v = voice.cfg, p = brain.P(b.provider), cfgU = widgets.config || {};
    if (!voiceList) voiceList = await voice.voices();
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
      <div class="addons">${W.map(w => `<div class="row"><span><b>${w.code}</b>${w.name}</span>${sw('pin:' + w.id, !!S.pinned[w.id])}</div>`).join('')}</div>
      <div class="note">Unpinned add-ons dock into their ring node. Click the node or ask for them by voice to summon.</div>
      <h4>THEME</h4>
      <select id="optTheme">${Object.keys(THEMES).map(t => `<option value="${t}"${S.theme === t ? ' selected' : ''}>${t.toUpperCase()}</option>`).join('')}</select>
      <h4>LAYOUT</h4>
      <div class="lbtns"><div class="sbtn lay${S.layout === 'focus' ? ' on' : ''}" data-l="focus">FOCUS</div><div class="sbtn lay${S.layout === 'full' ? ' on' : ''}" data-l="full">FULL</div><div class="sbtn lay${S.layout === 'ambient' ? ' on' : ''}" data-l="ambient">AMBIENT</div></div>
      <div class="note">Focus shows six widgets; the other six wait in the ring. Full shows all twelve.</div>
      <div class="row"><span>PROACTIVE CHECK-INS (EVERY 30 MIN)</span>${sw('proactive', !!S.proactive)}</div>
      <div class="row"><span>PARALLAX DEPTH</span>${sw('parallax', S.parallax)}</div>
      <div class="row"><span>PARTICLE FIELD</span>${sw('particles', S.particles)}</div>
      <div class="row"><span>IDLE SHAPE CYCLE</span>${sw('idleMorph', S.idleMorph)}</div>
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
    $('optTheme').onchange = e => { applyTheme(e.target.value); save(); };
    $('optPool').onchange = e => { b.pool.order = e.target.value.split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(x => brain.PROVIDERS[x]); e.target.value = b.pool.order.join(', '); save(); };
    $('optVoice').onchange = e => { v.neuralVoice = e.target.value; save(); };
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
      else if (k === 'bargeIn') voice.bargeIn = on; else if (k === 'parallax') { S.parallax = on; if (!on) ['layerL', 'layerR', 'layerC', 'bg'].forEach(i => $(i).style.transform = ''); }
      else if (k === 'particles') { S.particles = on; core.particles = on; } else if (k === 'idleMorph') S.idleMorph = on;
      else if (k === 'proactive') { S.proactive = on; fetch(ADDONS + '/schedules').then(r => r.json()).then(async d => { const ex = (d.schedules || []).find(x => x.command === 'proactive check'); if (on && !ex) await fetch(ADDONS + '/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', schedule: { name: 'proactive check every 30 min', when: { type: 'interval', minutes: 30 }, command: 'proactive check' } }) }); if (!on && ex) await fetch(ADDONS + '/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id: ex.id }) }); }).catch(() => { }); }
      save();
    });
  }
  const THEMES = { arc: ['46,230,255', '160,124,255', '217,248,255'], ember: ['255,106,61', '255,181,71', '255,227,214'], gold: ['255,194,77', '46,230,255', '255,233,194'], matrix: ['61,255,160', '160,255,124', '214,255,233'], ice: ['142,197,255', '195,166,255', '240,247,255'] };
  function applyTheme(name) { const t = THEMES[name] || THEMES.arc; S.theme = THEMES[name] ? name : 'arc'; document.documentElement.dataset.theme = S.theme; core.setTheme(t[0], t[1], t[2]); }
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
  function init() {
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
  SAM.hud = { S, submit, say, setMode, boot, setFocus, toggleDrawer, applyLayout, showAlert, __run: runAction, applyTheme, desktopTask };
  init();
})(window.SAM);
