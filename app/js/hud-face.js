/* SAMURAI HUD v3 — face controller. One source of truth for the avatar's emotion, gaze, blink and lip-sync, read by the
   VRM avatar (hud-3d.js, inside the Three.js scene; needs the 3D core, otherwise the orb stays). Emotions come from the brain's reply ("emotion" in the JSON contract), a
   keyword fallback, the HUD mode and the personality. Exposes window.SAM.face. */
(function (SAM) {
  const $ = id => document.getElementById(id);
  const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'love', 'confused', 'excited'];
  /* resting bias per personality: what the face drifts back to when nothing is going on */
  const REST = { professional: ['neutral', 1], balanced: ['neutral', 1], witty: ['happy', .35], deadpan: ['neutral', 1], sarcastic: ['happy', .18], hype: ['excited', .45] };
  /* VRM expression weights per emotion (the expression manager handles the blink / mouth overrides itself) */
  const VRM_EXPR = { neutral: {}, happy: { happy: 1 }, sad: { sad: 1 }, angry: { angry: 1 }, surprised: { surprised: 1 }, thinking: { relaxed: .3, lookUp: .6, lookLeft: .3 }, love: { happy: .7, relaxed: .5 }, confused: { surprised: .35, sad: .25, lookLeft: .4 }, excited: { happy: 1, surprised: .25 } };
  const DEFAULT_VRM = { name: 'Sample (pixiv)', file: 'VRM1_Constraint_Twist_Sample.vrm', url: '/avatars/VRM1_Constraint_Twist_Sample.vrm' };
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, smooth = (a, b, v) => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k)), hex = a => '#' + a.map(x => clamp(x, 0, 255).toString(16).padStart(2, '0')).join('');
  const cssRgb = (name, fb) => { const p = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(',').map(Number); return p.length === 3 && p.every(n => !isNaN(n)) ? p : fb; };

  const face = {
    EMOTIONS, DEFAULT_VRM, VRM_EXPR,
    emotion: 'neutral', intensity: 1, holdMs: 0, holdFrom: 0, shown: 'neutral', shownIntensity: 1, hudMode: 'idle', speaking: false,
    lvl: 0, lookX: 0, lookY: 0, blinkV: 0, blinkT: -1, nextBlink: 3, blinkNow: false, glanceId: null, glanceX: 0, glanceY: 0, glanceUntil: 0,
    vis: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }, eff: '', avatars: [DEFAULT_VRM], forceLvl: 0, forceUntil: 0,
    analyser: null, actx: null, srcEl: null, srcNode: null, sources: new WeakMap(), fft: null, lastTs: 0, warned: {},

    /* ---- the public controls ---- */
    set(emotion, hold) { if (!EMOTIONS.includes(emotion)) return false; this.emotion = emotion; this.intensity = 1; this.holdMs = hold || 0; this.holdFrom = 0; return true; },
    /* keyword / punctuation fallback when the brain gives no emotion */
    guess(text) {
      const t = String(text || '').toLowerCase();
      if (/\b(sorry|unfortunately|failed|cannot|can't|could not|couldn't|no luck|offline|unavailable)\b/.test(t)) return 'sad';
      if (/\b(warning|danger|alert|threat|intrusion|blocked|breach)\b/.test(t)) return 'angry';
      if (/\b(love|adore)\b/.test(t)) return 'love';
      if (/\b(wow|whoa|incredible|amazing)\b/.test(t) || /!{2,}/.test(t)) return 'surprised';
      if (/\?\s*$/.test(t) || /\b(not sure|unclear|hmm|which one)\b/.test(t)) return 'confused';
      if (/!/.test(t)) return /\b(great|awesome|let's go|ready|done)\b/.test(t) ? 'excited' : 'happy';
      return this.rest()[0];
    },
    rest() { const mood = (SAM.brain && SAM.brain.cfg && SAM.brain.cfg.mood) || 'balanced'; return REST[mood] || REST.balanced; },
    mode(m) { this.hudMode = m; },
    /* an outside level (a test, a voice engine with its own meter) overrides the analyser for ms (250 ms by default, so a per-frame caller keeps it alive) */
    level(v, ms) { this.forceLvl = clamp(v || 0, 0, 1); this.forceUntil = performance.now() / 1000 + (ms || 250) / 1000; },
    warn(msg) { if (this.warned[msg]) return; this.warned[msg] = 1; SAM.hud && SAM.hud.log && SAM.hud.log('warn', 'face · ' + msg); },
    look(x, y, ms) { this.glanceX = clamp(x, -1, 1); this.glanceY = clamp(y, -1, 1); this.glanceUntil = performance.now() / 1000 + (ms || 1500) / 1000; this.glanceId = null; },
    glance(id) { this.glanceId = id || null; },
    /* which avatar is really on screen: the VRM needs the 3D core, so without it the orb stays */
    effective() { const a = SAM.hud.S.avatar; return a === 'vrm' && SAM.gl && SAM.gl.on ? 'vrm' : 'orb'; },
    vrmUrl() { return 'avatars/' + encodeURIComponent(SAM.hud.S.vrm || DEFAULT_VRM.file); },
    async listAvatars() {
      try { const d = await (await fetch(SAM.H + ':9500/avatars')).json(); if (d.ok && d.avatars && d.avatars.length) this.avatars = d.avatars; } catch (e) { }
      return this.avatars;
    },
    pickAvatar(name) {
      const q = String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim(), words = q.split(/\s+/).filter(Boolean); if (!words.length) return null;
      let best = null, score = 0;
      for (const a of this.avatars) { const hay = (a.name + ' ' + a.file).toLowerCase(); const s = words.filter(w => hay.includes(w)).length + (hay.includes(q) ? 2 : 0); if (s > score) { score = s; best = a; } }
      return best;
    },

    /* ---- lip-sync level: one analyser on whatever audio element the voice module is playing (shared with the 3D core) ---- */
    speech() {
      const v = SAM.voice, el = v && v.audio, want = (SAM.gl && SAM.gl.on) || this.eff !== 'orb';       // the orb with the 2D core never needs the audio graph
      if (el && el !== this.srcEl && want) {
        try {
          if (!this.actx) { this.actx = new (window.AudioContext || window.webkitAudioContext)(); this.analyser = this.actx.createAnalyser(); this.analyser.fftSize = 256; this.fft = new Uint8Array(this.analyser.frequencyBinCount); }
          if (this.srcNode) this.srcNode.disconnect(this.analyser);                                     // the previous clip leaves the analyser (it stays routed to the speakers)
          let src = this.sources.get(el); if (!src) { src = this.actx.createMediaElementSource(el); src.connect(this.actx.destination); this.sources.set(el, src); }
          src.connect(this.analyser); this.srcNode = src; if (this.actx.state === 'suspended') this.actx.resume().catch(() => { });
        } catch (e) { this.srcNode = null; this.warn('audio analyser unavailable · ' + String(e.message || e).slice(0, 50)); }
        this.srcEl = el;
      }
      if (el && el === this.srcEl && this.srcNode && this.analyser) { this.analyser.getByteFrequencyData(this.fft); let s = 0; for (let i = 2; i < 40; i++) s += this.fft[i]; return Math.min(1, s / 38 / 140); }
      if (!el) { if (this.srcNode) { try { this.srcNode.disconnect(this.analyser); } catch (e) { } this.srcNode = null; } this.srcEl = null; }
      /* no measurable audio (browser voice, blocked autoplay): a spoken cadence stands in while the voice says it is speaking */
      if ((v && v.speaking) || SAM.core.mode === 'speaking') { const t = performance.now() / 1000; return .35 + .35 * Math.abs(Math.sin(t * 9.1)) * Math.abs(Math.sin(t * 2.3 + 1)); }
      return 0;
    },

    /* ---- one step of life: timers, blink, gaze, visemes; then push to the robot face when it is on screen ---- */
    tick(dt) {
      const hud = SAM.hud, S = hud.S, now = performance.now() / 1000, m = S.mode; this.hudMode = m;
      this.speaking = !!((SAM.voice && SAM.voice.speaking) || m === 'speaking');
      const raw = this.forceUntil > now ? this.forceLvl : this.speech(); this.lvl += (raw - this.lvl) * (raw > this.lvl ? .5 : .15);   // one level for both faces and the 3D orb
      /* the reply's emotion stays while it speaks and decays back to the resting bias ~6 s after speech ends */
      const [restE, restI] = this.rest();
      if (this.speaking) this.holdFrom = now; else if (!this.holdFrom) this.holdFrom = now;
      if ((this.emotion !== restE || this.intensity !== restI) && !this.speaking && now - this.holdFrom > (this.holdMs ? this.holdMs / 1000 : 6)) { this.emotion = restE; this.intensity = restI; }
      const atRest = this.emotion === restE;
      let shown = this.emotion, inten = this.intensity;
      if (m === 'alert') { shown = 'angry'; inten = 1; } else if (m === 'thinking' && atRest) shown = 'thinking'; else if (m === 'listening' && atRest) { shown = 'surprised'; inten = .3; }
      this.shown = shown; this.shownIntensity = inten;
      /* blink: random 2-6 s, a 220 ms close-open curve */
      this.blinkNow = false;
      if (this.blinkT < 0 && now > this.nextBlink) { this.blinkT = now; this.nextBlink = now + 2 + Math.random() * 4; this.blinkNow = true; }
      if (this.blinkT >= 0) { const k = (now - this.blinkT) / .22; this.blinkV = k < .5 ? k * 2 : k < 1 ? 2 - k * 2 : 0; if (k >= 1) { this.blinkT = -1; this.blinkV = 0; } }
      /* gaze: the orb's own glance (mouse chase, idle drift) in -1..1, a glance at a widget when one opens, up-left while thinking */
      const WD = hud.WD; let tx = clamp((WD.gx || 0) / 9, -1, 1), ty = clamp((WD.gy || 0) / 6, -1, 1);
      if (this.glanceId) { const slot = document.querySelector(`.slot[data-id=${this.glanceId}]`); if (slot && slot.style.left) { const sx = parseFloat(slot.style.left) + 136 - 960 - (WD.ox || 0), sy = parseFloat(slot.style.top) + 125 - 470 - (WD.oy || 0); this.glanceX = clamp(sx / 700, -1, 1); this.glanceY = clamp(sy / 400, -1, 1); this.glanceUntil = now + 1.6; } this.glanceId = null; }
      if (this.glanceUntil > now) { tx = this.glanceX; ty = this.glanceY; } else if (m === 'thinking') { tx += .35; ty -= .5; }
      const gk = Math.min(1, dt * 6); this.lookX += (tx - this.lookX) * gk; this.lookY += (ty - this.lookY) * gk;
      /* visemes for the VRM mouth: aa on loud, ih / ee on mid, ou / oh on low, a slow phase alternates within each band */
      const L = this.speaking ? this.lvl : 0, ph = Math.sin(now * 7.3) * .5 + .5, ph2 = Math.sin(now * 5.1 + 1) * .5 + .5;
      const loud = smooth(.35, .75, L), mid = smooth(.12, .45, L) * (1 - loud), low = smooth(.02, .15, L) * (1 - mid - loud);
      const tv = { aa: loud * (.7 + .3 * ph), ih: mid * ph2 * .8, ee: mid * (1 - ph2) * .7, ou: low * ph * .6, oh: low * (1 - ph) * .6 + loud * .2 * (1 - ph) }, vk = Math.min(1, dt * 14);
      for (const k in tv) this.vis[k] += (tv[k] - this.vis[k]) * vk;
      this.apply();
    },
    /* stage classes follow the avatar that is really showing */
    apply() {
      const eff = this.effective(); if (eff === this.eff) return; this.eff = eff;
      $('stage').classList.toggle('vrm', eff === 'vrm');
      if (eff === 'orb' && SAM.hud.S.avatar === 'vrm' && !this.vrmWarned) { this.vrmWarned = true; SAM.hud.log('info', 'avatar · the VRM avatar needs the 3D core (settings → 3D on)'); }
    },
    retheme() { },
  };
  SAM.face = face;
  const loop = ts => { const dt = Math.min(.05, (ts - (face.lastTs || ts)) / 1000); face.lastTs = ts; try { face.tick(dt); } catch (e) { face.warn('tick · ' + String(e.message || e).slice(0, 70)); } requestAnimationFrame(loop); };
  const start = () => { if (!SAM.hud || !SAM.hud.S) return setTimeout(start, 50); face.listAvatars(); requestAnimationFrame(loop); };
  start();
})(window.SAM);
