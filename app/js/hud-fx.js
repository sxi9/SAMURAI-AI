/* SAMURAI HUD v3 — effects layer. A canvas over the widgets for energy arcs, weather particles, alert tears and the CPU
   heartbeat; hologram materialise on cards; day cycle tint; looks (crt, cinema); the orb chasing the mouse; presence
   through the camera; boot diagnostics. Exposes window.SAM.fx. */
(function (SAM) {
  const $ = id => document.getElementById(id);
  const fx = {
    on: true, canvas: null, ctx: null, raf: 0, arcs: [], drops: [], flash: 0, tear: 0, look: 'none', lastT: 0,
    cam: { on: false, stream: null, video: null, cv: null, prev: null, present: null, lastSeen: 0, lastGone: 0, timer: 0 },
    init() {
      const c = document.createElement('canvas'); c.id = 'fx'; c.className = 'fx'; c.width = 1920; c.height = 1080; $('stage').appendChild(c); this.canvas = c; this.ctx = c.getContext('2d');
      const d = document.createElement('div'); d.className = 'daytint'; $('stage').insertBefore(d, $('layerC')); const bars = document.createElement('div'); bars.className = 'cine'; $('stage').appendChild(bars);
      this.observeCards(); this.mouseChase(); this.dayCycle(); setInterval(() => this.dayCycle(), 60000);
      const loop = ts => { this.frame(ts); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop);
      this.ecgInit();
      const S = SAM.hud.S; this.setEnabled(S.fx !== false); if (S.presence) this.presence(true); if (S.look) this.setLook(S.look);
    },
    setEnabled(on) { this.on = on; this.canvas.style.display = on ? '' : 'none'; $('stage').classList.toggle('nofx', !on); },

    /* ---- energy arcs: orb → the widget being driven ---- */
    zap(id, strong) {
      if (!this.on) return;
      const fly = document.querySelector(`.fly[data-id=${id}]`); if (!fly || fly.style.visibility === 'hidden') return;
      const slot = fly.parentNode, x = parseFloat(slot.style.left) + 136, y = parseFloat(slot.style.top) + 125;
      this.arcs.push({ x, y, t0: performance.now(), life: strong ? 1100 : 750, seed: Math.random() * 99 });
      const card = fly.querySelector('.card'); card.classList.remove('zap'); void card.offsetWidth; card.classList.add('zap');
    },
    drawArcs(ts) {
      const x = this.ctx, WD = SAM.hud.WD, ox = 960 + (WD.ox || 0), oy = 470 + (WD.oy || 0), A = SAM.core.THEME.c;
      this.arcs = this.arcs.filter(a => ts - a.t0 < a.life);
      for (const a of this.arcs) {
        const k = (ts - a.t0) / a.life, al = k < .15 ? k / .15 : 1 - (k - .15) / .85;
        for (let b = 0; b < 3; b++) {
          x.beginPath(); x.moveTo(ox, oy); const n = 14;
          for (let i = 1; i <= n; i++) { const f = i / n, jx = (Math.sin(a.seed + i * 7.3 + ts * .02 + b * 3) * 22 + (Math.random() - .5) * 10) * Math.sin(f * Math.PI); x.lineTo(ox + (a.x - ox) * f + jx, oy + (a.y - oy) * f + jx * .6); }
          x.strokeStyle = `rgba(${b === 0 ? '255,255,255' : A},${al * (b === 0 ? .9 : .45)})`; x.lineWidth = b === 0 ? 1.4 : 3.5; x.shadowColor = `rgb(${A})`; x.shadowBlur = b === 0 ? 0 : 14; x.stroke();
        }
      }
      x.shadowBlur = 0;
    },

    /* ---- weather particles from the live forecast ---- */
    weather(ts, dt) {
      const w = SAM.widgets.data.weather; if (!w) return; const c = String(w.cond || '').toLowerCase();
      const rain = /rain|drizzle|shower|storm|thunder/.test(c), snow = /snow|sleet|blizzard/.test(c), storm = /storm|thunder/.test(c);
      if (!rain && !snow) { this.drops.length = 0; return; }
      const want = snow ? 140 : 260; while (this.drops.length < want) this.drops.push({ x: Math.random() * 1920, y: Math.random() * 1080, v: snow ? 40 + Math.random() * 40 : 700 + Math.random() * 500, s: Math.random() });
      const x = this.ctx; x.strokeStyle = snow ? 'rgba(240,247,255,.55)' : `rgba(${SAM.core.THEME.ice},.28)`; x.lineWidth = snow ? 2.5 : 1; x.lineCap = 'round';
      for (const d of this.drops) {
        d.y += d.v * dt; if (snow) d.x += Math.sin(ts / 900 + d.s * 9) * 18 * dt; else d.x -= 60 * dt;
        if (d.y > 1080) { d.y = -20; d.x = Math.random() * 1920; }
        x.beginPath(); x.moveTo(d.x, d.y); x.lineTo(d.x - (snow ? 0 : 3), d.y + (snow ? .1 : 14 + d.s * 10)); x.stroke();
      }
      if (storm && Math.random() < .004) this.flash = 1;
      if (this.flash > 0) { x.fillStyle = `rgba(220,235,255,${this.flash * .18})`; x.fillRect(0, 0, 1920, 1080); this.flash = Math.max(0, this.flash - dt * 6); }
    },

    /* ---- alert: horizontal tears ---- */
    tears(ts) {
      if (SAM.core.mode !== 'alert') return; const x = this.ctx;
      for (let i = 0; i < 3; i++) { if (Math.random() < .4) continue; const y = Math.random() * 1080, h = 2 + Math.random() * 10; x.fillStyle = `rgba(255,61,110,${.08 + Math.random() * .12})`; x.fillRect(0, y, 1920, h); x.fillStyle = `rgba(${SAM.core.THEME.c},.08)`; x.fillRect(Math.random() * 40 - 20, y + h, 1920, 1); }
    },

    /* ---- CPU heartbeat inside the system card ---- */
    ecgInit() { const b = $('body-sys'); if (!b || b.querySelector('.ecg')) return; const c = document.createElement('canvas'); c.className = 'ecg'; c.width = 240; c.height = 26; b.appendChild(c); this.ecg = c; this.ecgX = 0; this.ecgPhase = 0; },
    ecgDraw(dt) {
      const c = this.ecg; if (!c || !c.isConnected) { this.ecgInit(); return; } const x = c.getContext('2d'), cpu = (SAM.widgets.data.tel && SAM.widgets.data.tel.cpu) || 5, bpm = 50 + cpu * .9;
      this.ecgPhase += dt * bpm / 60; const ph = this.ecgPhase % 1; let y = 16;
      if (ph < .08) y = 16 - ph / .08 * 3; else if (ph < .14) y = 13 + (ph - .08) / .06 * 6; else if (ph < .2) y = 19 - (ph - .14) / .06 * 17; else if (ph < .26) y = 2 + (ph - .2) / .06 * 20; else if (ph < .32) y = 22 - (ph - .26) / .06 * 6; else if (ph < .5) y = 16 - Math.sin((ph - .32) / .18 * Math.PI) * 2.5;
      const nx = (this.ecgX + 1.6) % 240; x.fillStyle = 'rgba(8,14,28,.9)'; x.fillRect(nx, 0, 12, 26); x.fillStyle = `rgb(${SAM.core.THEME.c})`; x.fillRect(nx, y, 2, 2); this.ecgX = nx;
    },

    frame(ts) {
      const dt = Math.min(.05, (ts - (this.lastT || ts)) / 1000); this.lastT = ts;
      if (!this.on) return;
      const x = this.ctx; x.clearRect(0, 0, 1920, 1080);
      this.weather(ts, dt); this.drawArcs(ts); this.tears(ts); this.ecgDraw(dt);
    },

    /* ---- hologram materialise when a card becomes visible ---- */
    observeCards() {
      const seen = new WeakMap();
      const ob = new MutationObserver(ms => { for (const m of ms) { const fly = m.target, vis = fly.style.visibility !== 'hidden' && fly.style.opacity !== '0'; if (vis && seen.get(fly) === false && this.on) { const card = fly.querySelector('.card'); card.classList.remove('mat'); void card.offsetWidth; card.classList.add('mat'); } seen.set(fly, vis); } });
      document.querySelectorAll('.fly').forEach(f => { seen.set(f, f.style.visibility !== 'hidden'); ob.observe(f, { attributes: true, attributeFilter: ['style'] }); });
      this.cardObserver = ob;
    },

    /* ---- day cycle: the background tint follows the clock (and the forecast) ---- */
    dayCycle() {
      const S = SAM.hud.S; if (!this.on || S.theme === 'custom') { document.documentElement.style.removeProperty('--day'); return; }
      const h = new Date().getHours() + new Date().getMinutes() / 60, w = SAM.widgets.data.weather, c = String(w && w.cond || '').toLowerCase();
      let tint = [5, 6, 13], a = 0;
      if (h >= 5 && h < 8) { tint = [40, 18, 30]; a = (h - 5) / 3; a = Math.sin(a * Math.PI); }            // dawn: warm
      else if (h >= 8 && h < 17) { tint = [8, 16, 36]; a = .5; }                                           // day: a little brighter
      else if (h >= 17 && h < 20) { tint = [44, 14, 30]; a = Math.sin((h - 17) / 3 * Math.PI); }         // dusk: orange-purple
      else { tint = [3, 4, 10]; a = .6; }                                                                  // night: deep
      if (/rain|storm|snow|fog|overcast/.test(c)) { tint = tint.map(v => v * .8 + 4); }
      document.documentElement.style.setProperty('--day', `rgba(${tint.join(',')},${(a * .22).toFixed(2)})`);
      document.documentElement.dataset.daypart = h < 5 || h >= 20 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : 'dusk';
    },

    /* ---- looks: crt and cinema overlays ---- */
    setLook(name) { this.look = ['crt', 'cinema', 'none'].includes(name) ? name : 'none'; const st = $('stage'); st.classList.remove('look-crt', 'look-cinema'); if (this.look !== 'none') st.classList.add('look-' + this.look); SAM.hud.S.look = this.look; },

    /* ---- the orb chases the mouse while idle ---- */
    mouseChase() {
      const st = $('stage'); let last = 0;
      st.addEventListener('mousemove', e => {
        const S = SAM.hud.S, WD = SAM.hud.WD; if (!S.wander || S.mode !== 'idle' || S.focus || S.drawer || S.flow) return;
        const r = st.getBoundingClientRect(), sx = (e.clientX - r.left) / S.scale, sy = (e.clientY - r.top) / S.scale;
        const now = performance.now() / 1000; if (now - last < .1) return; last = now;
        WD.wx = Math.max(-600, Math.min(600, sx - 960)); WD.wy = Math.max(-290, Math.min(290, sy - 470)); WD.nextWp = now + 4;
        WD.lookX = Math.max(-9, Math.min(9, (sx - 960 - WD.x) * .02)); WD.lookY = Math.max(-6, Math.min(6, (sy - 470 - WD.y) * .02)); WD.lookUntil = now + 1.5;
      });
    },

    /* ---- presence through the camera: motion means someone is here ---- */
    presence(on) {
      const C = this.cam;
      if (!on) { C.on = false; clearInterval(C.timer); if (C.stream) C.stream.getTracks().forEach(t => t.stop()); C.stream = null; return; }
      if (C.on) return; C.on = true;
      const VIRTUAL = /Iriun|DroidCam|Snap Camera|OBS|Virtual|NDI|XSplit|ManyCam|EpocCam|Camo/i, want = (SAM.hud.S.presenceCam || '').toLowerCase();
      navigator.mediaDevices.enumerateDevices().catch(() => []).then(devs => {
        const cams = devs.filter(d => d.kind === 'videoinput'); let pick = cams.find(d => want && d.label.toLowerCase().includes(want)) || cams.find(d => d.label && !VIRTUAL.test(d.label)) || cams[0];
        const video = pick && pick.deviceId ? { deviceId: { exact: pick.deviceId }, width: 160, height: 120 } : { width: 160, height: 120 };
        if (pick && pick.label) SAM.hud.log('info', 'presence · camera: ' + pick.label.slice(0, 40));
        return navigator.mediaDevices.getUserMedia({ video, audio: false });
      }).then(stream => {
        C.stream = stream; C.video = document.createElement('video'); C.video.srcObject = stream; C.video.muted = true; C.video.play().catch(() => { });
        C.cv = document.createElement('canvas'); C.cv.width = 40; C.cv.height = 30; const x = C.cv.getContext('2d', { willReadFrequently: true });
        C.timer = setInterval(() => {
          if (!C.on || C.video.readyState < 2) return; x.drawImage(C.video, 0, 0, 40, 30); const d = x.getImageData(0, 0, 40, 30).data;
          if (C.prev) { let diff = 0; for (let i = 0; i < d.length; i += 4) diff += Math.abs(d[i] - C.prev[i]) + Math.abs(d[i + 1] - C.prev[i + 1]); const motion = diff / (d.length / 4) / 2; this.motion = motion; this.seen(motion > 6); }
          C.prev = new Uint8ClampedArray(d);
        }, 500);
        SAM.hud.log('info', 'presence · camera watching for you');
      }).catch(e => { C.on = false; SAM.hud.S.presence = false; SAM.hud.log('warn', 'presence · camera unavailable: ' + String(e.message || e).slice(0, 50)); });
    },
    seen(moving) {
      const C = this.cam, now = Date.now();
      if (moving) {
        const gone = C.lastSeen ? now - C.lastSeen : 0; C.lastSeen = now;
        if (C.present === false || C.present === null) {
          C.present = true; document.getElementById('pillMic') && (document.documentElement.dataset.presence = 'here');
          if (C.present !== null && gone > 120000) { const h = new Date().getHours(); SAM.hud.say(`${h < 12 ? 'Good morning' : h < 18 ? 'Welcome back' : 'Good evening'}, ${SAM.widgets.userName || 'Boss'}. You were away ${Math.round(gone / 60000)} minutes.`); SAM.hud.log('info', 'presence · you are back'); }
          else if (gone === 0) SAM.hud.log('info', 'presence · someone is here');
        }
      } else if (C.present && now - C.lastSeen > 120000) { C.present = false; document.documentElement.dataset.presence = 'away'; SAM.hud.log('info', 'presence · nobody for 2 min'); if (SAM.hud.S.lockOnLeave) SAM.hud.__run('lock', ''); }
    },

  };
  SAM.fx = fx;
  const start = () => { if (!SAM.hud || !SAM.hud.S || !document.getElementById('body-sys')) return setTimeout(start, 60); fx.init(); };
  start();
})(window.SAM);
