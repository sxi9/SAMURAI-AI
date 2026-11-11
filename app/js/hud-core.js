/* SAMURAI HUD v3 — core renderer: particle field (morphing shapes), waveform ring, ellipses, eyes.
   Exposes window.SAM.core. Pure canvas + DOM, no framework. */
window.SAM = window.SAM || {};
(function (SAM) {
  const PN = 1400;
  const SHAPE_CYCLE = ['sphere', 'galaxy', 'text:SAMURAI', 'heart', 'knot', 'helix', 'cube', 'ring', 'wave'];
  const SHAPE_TILT = { sphere: .3, heart: 0, text: 0, cube: .35, galaxy: .25, helix: .15, knot: .35, ring: .75, wave: .85 };
  const FACING = { heart: 1, text: 1, galaxy: 1 };
  const CFG = {
    idle: { amp: 36, base: 22, sp: 1.2, col: '46,230,255' }, listening: { amp: 78, base: 24, sp: 5, col: '217,248,255' },
    thinking: { amp: 70, base: 18, sp: 3, col: '160,124,255' }, speaking: { amp: 80, base: 22, sp: 4, col: '46,230,255' },
    alert: { amp: 96, base: 16, sp: 9, col: '255,61,110' }, boot: { amp: 10, base: 10, sp: .5, col: '46,230,255' }
  };

  function shapeOf(name) {
    const a = new Float32Array(PN * 3), R = Math.random, set = (i, x, y, z) => { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; };
    if (name === 'heart') for (let i = 0; i < PN; i++) { const t = R() * 6.283, r = Math.sqrt(R()); const hx = 16 * Math.pow(Math.sin(t), 3), hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); set(i, r * hx / 17, r * (hy + 2) / 17, (R() - .5) * .25); }
    else if (name === 'cube') for (let i = 0; i < PN; i++) { const f = (R() * 6) | 0, s = .75, u = (R() - .5) * 2 * s, v = (R() - .5) * 2 * s; set(i, f === 0 ? s : f === 1 ? -s : u, f === 2 ? s : f === 3 ? -s : (f < 2 ? u : v), f === 4 ? s : f === 5 ? -s : v); }
    else if (name === 'galaxy') for (let i = 0; i < PN; i++) { const arm = i % 3, k = Math.pow(R(), .6), r = .12 + k * .95, t = k * 4.5 + arm / 3 * 6.283 + (R() - .5) * .35; set(i, Math.cos(t) * r, Math.sin(t) * r, (R() - .5) * .12 * (1 - k * .7)); }
    else if (name === 'helix') for (let i = 0; i < PN; i++) { const strand = i % 2, k = Math.floor(i / 2) / (PN / 2), t = k * Math.PI * 6 + strand * Math.PI, r = (i % 24 === 0) ? .45 * R() : .45; set(i, Math.cos(t) * r, (k - .5) * 2, Math.sin(t) * r); }
    else if (name === 'knot') for (let i = 0; i < PN; i++) { const t = (i / PN) * 6.283 * 2, r = .62 + .22 * Math.cos(1.5 * t), j = () => (R() - .5) * .05; set(i, r * Math.cos(t) + j(), .24 * Math.sin(1.5 * t) + j(), r * Math.sin(t) + j()); }
    else if (name === 'ring') for (let i = 0; i < PN; i++) { const t = (i / PN) * 6.283, tube = R() * 6.283, Rr = .85, T = .07 + R() * .05; set(i, (Rr + T * Math.cos(tube)) * Math.cos(t), T * Math.sin(tube), (Rr + T * Math.cos(tube)) * Math.sin(t)); }
    else if (name === 'wave') { const side = Math.sqrt(PN) | 0; for (let i = 0; i < PN; i++) { const gx = (i % side) / side - .5, gz = Math.floor(i / side) / side - .5, d = Math.hypot(gx, gz); set(i, gx * 2.2, Math.sin(d * 18) * .22 * (1 - d), gz * 2.2); } }
    else if (name.startsWith('text:')) {
      const word = name.slice(5), c = document.createElement('canvas'), w = 360, h = 160; c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      let size = 110; do { x.font = `bold ${size}px Michroma, Arial Black, sans-serif`; size -= 6; } while (x.measureText(word).width > w - 24 && size > 16);
      x.fillText(word, w / 2, h / 2);
      const img = x.getImageData(0, 0, w, h).data, pts = [];
      for (let py = 0; py < h; py += 2) for (let px = 0; px < w; px += 2) if (img[(py * w + px) * 4 + 3] > 110) pts.push(px, py);
      if (!pts.length) return shapeOf('sphere');
      for (let i = 0; i < PN; i++) { const k = ((R() * pts.length / 2) | 0) * 2; set(i, (pts[k] / w - .5) * 2.3 + (R() - .5) * .02, (.5 - pts[k + 1] / h) * 2.3 * (h / w) + (R() - .5) * .02, (R() - .5) * .12); }
    }
    else { const phi = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < PN; i++) { const y = 1 - (i / (PN - 1)) * 2, r = Math.sqrt(1 - y * y), th = phi * i; set(i, Math.cos(th) * r, y, Math.sin(th) * r); } }
    return a;
  }

  const core = {
    SHAPE_CYCLE, mode: 'boot', shapeName: 'sphere', shapeLock: 0, particles: true, flowStep: 1,
    shapes: {}, morphT: 1, spin: 0, tilt: SHAPE_TILT.sphere, lastTs: 0, raf: 0, canvas: null, ctx: null,
    onShape: null,
    init(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.ppos = shapeOf('sphere'); this.pfrom = this.ppos.slice(); this.ptarget = this.getShape('sphere');
      this.pdelay = new Float32Array(PN); for (let i = 0; i < PN; i++) this.pdelay[i] = Math.random();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { delete this.shapes['text:SAMURAI']; if (this.shapeName === 'text:SAMURAI') this.ptarget = this.getShape('text:SAMURAI'); });
      const loop = ts => { this.draw(ts); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    },
    getShape(name) { if (!this.shapes[name]) this.shapes[name] = shapeOf(name); return this.shapes[name]; },
    setShape(name, lock) {
      if (!name || name === this.shapeName) return false;
      this.pfrom = this.ppos.slice(); this.ptarget = this.getShape(name); this.morphT = 0; this.shapeName = name;
      this.spin = ((this.spin % 6.283) + 6.283) % 6.283; if (this.spin > Math.PI) this.spin -= 6.283;
      if (lock) this.shapeLock = Date.now() + 25000;
      if (this.onShape) this.onShape(name, !!lock);
      return true;
    },
    nextShape(lock) { return this.setShape(SHAPE_CYCLE[(SHAPE_CYCLE.indexOf(this.shapeName) + 1) % SHAPE_CYCLE.length], lock); },
    draw(ts) {
      const x = this.ctx; if (!x) return;
      const S = 1520, cx = S / 2, cy = S / 2, t = ts / 1000, m = this.mode, cfg = CFG[m] || CFG.idle;
      x.clearRect(0, 0, S, S);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, 560);
      g.addColorStop(0, `rgba(${cfg.col},.26)`); g.addColorStop(.45, `rgba(${cfg.col},.06)`); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      if (this.particles && this.ppos) {
        const dt = Math.min(.05, (ts - (this.lastTs || ts)) / 1000); this.lastTs = ts;
        const P = this.ppos, F = this.pfrom, T = this.ptarget, D = this.pdelay;
        if (this.morphT < 1) {
          this.morphT = Math.min(1, this.morphT + dt / 1.6);
          for (let i = 0; i < PN; i++) { let k = (this.morphT - D[i] * .45) / .55; k = k < 0 ? 0 : k > 1 ? 1 : k; k = k * k * (3 - 2 * k); for (let j = 0; j < 3; j++) P[i * 3 + j] = F[i * 3 + j] + (T[i * 3 + j] - F[i * 3 + j]) * k; }
        }
        const base = this.shapeName.startsWith('text:') ? 'text' : this.shapeName;
        const spinSpeed = m === 'thinking' ? 1.4 : m === 'alert' ? 2 : .3;
        if (FACING[base]) this.spin += (Math.sin(t * .6) * .3 - this.spin) * .04; else this.spin += spinSpeed * dt;
        this.tilt += ((SHAPE_TILT[base] ?? .3) - this.tilt) * .04;
        const cs = Math.cos(this.spin), sn = Math.sin(this.spin), ct = Math.cos(this.tilt), st = Math.sin(this.tilt), Rp = 380;
        x.globalCompositeOperation = 'lighter';
        const step = this.flowStep;
        for (let i = 0; i < PN; i += step) {
          const x0 = P[i * 3], y0 = P[i * 3 + 1], z0 = P[i * 3 + 2];
          const x1 = x0 * cs - z0 * sn, z1 = x0 * sn + z0 * cs;
          const y2 = y0 * ct - z1 * st, z2 = y0 * st + z1 * ct;
          const sc = 1000 / (1000 - z2 * Rp), d = (z2 + 1) / 2;
          const sx = cx + x1 * Rp * sc, sy = cy - y2 * Rp * sc;
          x.fillStyle = m === 'alert' ? `rgba(255,61,110,${.15 + d * .6})` : m === 'thinking' ? `rgba(160,124,255,${.15 + d * .6})` : z2 > 0 ? `rgba(46,230,255,${.18 + d * .6})` : `rgba(160,124,255,${.1 + d * .35})`;
          x.beginPath(); x.arc(sx, sy, (1.1 + d * 2) * sc, 0, 6.283); x.fill();
        }
        x.globalCompositeOperation = 'source-over';
      }
      const R = 300, n = 72, level = this.micLevel || 0;
      x.lineCap = 'round'; x.lineWidth = 6;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2; let v;
        if (m === 'thinking') v = Math.max(0, Math.sin(a * 3 - t * cfg.sp));
        else if (m === 'speaking') v = Math.abs(Math.sin(t * 6 + i * .5)) * Math.abs(Math.sin(t * 1.7 + i * .13));
        else if (m === 'alert') v = Math.abs(Math.sin(i * 7.1 + t * cfg.sp)) * (.4 + Math.random() * .6);
        else if (m === 'listening') v = (Math.sin(i * .9 + t * cfg.sp) * .5 + .5) * (Math.sin(i * 2.3 - t * cfg.sp * .7) * .5 + .5) * (1.4 + level * 1.2);
        else v = Math.sin(i * .6 + t * cfg.sp) * .5 + .5;
        const len = cfg.base + v * cfg.amp;
        x.strokeStyle = `rgba(${cfg.col},${.3 + Math.min(1, v) * .65})`;
        x.beginPath(); x.moveTo(cx + Math.cos(a) * (R - len * .3), cy + Math.sin(a) * (R - len * .3)); x.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len)); x.stroke();
      }
      x.lineWidth = 1.5;
      for (let k = 0; k < 2; k++) {
        const a = t * (k ? -.25 : .35) + k * 1.1, rr = R * (1.5 + k * .12);
        x.beginPath(); x.ellipse(cx, cy, rr, rr * .3, a, 0, 6.283);
        x.strokeStyle = k ? 'rgba(160,124,255,.35)' : 'rgba(46,230,255,.35)'; x.stroke();
      }
    },
    /* eyes: computed from mode + blink + tick, written as inline styles */
    eyes(elL, elR, mode, blink, tick) {
      for (const [el, L] of [[elL, true], [elR, false]]) {
        let w = 34, h = 46, rot = 0, tx = 0, ty = 0, color = '#d9f8ff', glow = '0 0 14px rgba(46,230,255,.9),0 0 36px rgba(46,230,255,.5)', clip = 'none', op = 1;
        if (mode === 'listening') { w = 40; h = 54; }
        if (mode === 'thinking') { h = 22; ty = -12; tx = 9; color = '#a07cff'; glow = '0 0 14px rgba(160,124,255,.9),0 0 36px rgba(160,124,255,.5)'; }
        if (mode === 'speaking') h = tick % 2 ? 42 : 50;
        if (mode === 'alert') { color = '#ff3d6e'; glow = '0 0 14px rgba(255,61,110,1),0 0 36px rgba(255,61,110,.5)'; rot = L ? 10 : -10; clip = L ? 'polygon(0 0,100% 38%,100% 100%,0 100%)' : 'polygon(0 38%,100% 0,100% 100%,0 100%)'; }
        if (mode === 'boot') { h = 4; op = .4; }
        if (blink) h = 4;
        const x = L ? -37 : 37;
        el.style.cssText = `left:${x - w / 2 + tx}px;top:${-8 - h / 2 + ty}px;width:${w}px;height:${h}px;background:${color};box-shadow:${glow};opacity:${op};transform:rotate(${rot}deg);clip-path:${clip}`;
      }
    }
  };
  SAM.core = core;
})(window.SAM);
