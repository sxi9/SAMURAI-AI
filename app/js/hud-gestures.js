/* SAMURAI HUD · hand gestures (MediaPipe HandLandmarker, vendored in app/vendor/mediapipe).
   Runs only after SAM.gestures.start(); samples the camera at 10 fps and dispatches
   window 'samurai-gesture' CustomEvents with detail {name, t}:
     open_palm (stop / pause) · fist (mute) · thumbs_up (confirm) · index_up (listen)
     swipe_left (next) · swipe_right (prev)
   The geometry (classify / detectSwipe / fingers) is pure and exported for node tests. */
(function (root) {
  'use strict';
  // landmark indices: 0 wrist, 4 thumb tip, 8 index tip, 12 middle tip, 16 ring tip, 20 pinky tip; pips: 6 10 14 18; thumb ip 3, thumb mcp 2
  const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 }, PIP = { index: 6, middle: 10, ring: 14, pinky: 18 };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* which fingers are extended, from 21 normalised landmarks (x,y in 0..1, y grows downward) */
  function fingers(lm) {
    const wrist = lm[0], palm = dist(wrist, lm[9]) || 1e-6;
    const ext = {};
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      // a finger is extended when its tip is further from the wrist than its pip joint by a margin
      ext[f] = dist(lm[TIP[f]], wrist) > dist(lm[PIP[f]], wrist) * 1.15 && dist(lm[TIP[f]], wrist) > palm * 1.3;
    }
    // thumb: tip away from the index mcp (5) compared with the thumb ip joint, and not tucked across the palm
    ext.thumb = dist(lm[4], lm[5]) > dist(lm[3], lm[5]) * 1.1 && dist(lm[4], lm[17]) > palm * 0.9;
    return ext;
  }

  /* classify a single frame → gesture name or null */
  function classify(lm) {
    if (!lm || lm.length < 21) return null;
    const e = fingers(lm), n = ['index', 'middle', 'ring', 'pinky'].filter(f => e[f]).length;
    const wrist = lm[0], palm = dist(wrist, lm[9]) || 1e-6;
    if (n === 4) return 'open_palm';
    if (n === 0) {
      // thumbs up: thumb extended and pointing up (tip clearly above its mcp), others curled
      if (e.thumb && lm[4].y < lm[2].y - palm * 0.5) return 'thumbs_up';
      return 'fist';
    }
    if (n === 1 && e.index && lm[8].y < wrist.y - palm * 0.8) return 'index_up';
    return null;
  }

  /* swipe from the recent wrist trail [{x, y, t}]: fast horizontal travel of ≥ 25 % of the frame within 600 ms */
  function detectSwipe(trail, minDx = 0.25, maxMs = 600) {
    if (!trail || trail.length < 3) return null;
    const last = trail[trail.length - 1];
    for (let i = trail.length - 2; i >= 0; i--) {
      const p = trail[i]; if (last.t - p.t > maxMs) break;
      const dx = last.x - p.x, dy = Math.abs(last.y - p.y);
      if (Math.abs(dx) >= minDx && dy < Math.abs(dx) * 0.6) return dx < 0 ? 'swipe_left' : 'swipe_right';
    }
    return null;
  }

  const G = { classify, detectSwipe, fingers, running: false, last: null, fps: 10, cooldownMs: 900, debug: false };
  if (typeof module !== 'undefined' && module.exports) { module.exports = G; return; }
  const SAM = root.SAM = root.SAM || {};
  let landmarker = null, video = null, stream = null, timer = null, trail = [], stable = { name: null, count: 0 }, lastFire = {};

  async function load() {
    if (landmarker) return landmarker;
    const base = new URL('vendor/mediapipe/', location.href.replace(/[^/]*$/, '')).href;
    const vision = await import(base + 'vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(base + 'wasm');
    landmarker = await vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: base + 'hand_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1 });
    return landmarker;
  }

  async function camera() {
    if (SAM.cam && SAM.cam.video) { SAM.cam.users++; return (video = SAM.cam.video); }   // shared with hud-faces.js when it is loaded
    if (video) return video;
    const want = ((SAM.hud && SAM.hud.S && SAM.hud.S.presenceCam) || '').toLowerCase();
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cams = devs.filter(d => d.kind === 'videoinput'), pick = cams.find(d => want && d.label.toLowerCase().includes(want)) || cams.find(d => d.label && !/Virtual|OBS|Snap|DroidCam|Iriun/i.test(d.label)) || cams[0];
    stream = await navigator.mediaDevices.getUserMedia({ video: pick && pick.deviceId ? { deviceId: { exact: pick.deviceId }, width: 320, height: 240 } : { width: 320, height: 240 }, audio: false });
    video = document.createElement('video'); video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play().catch(() => { });
    return video;
  }

  function fire(name) {
    const now = performance.now(); if (lastFire[name] && now - lastFire[name] < G.cooldownMs) return;
    lastFire[name] = now; G.last = { name, t: Date.now() };
    root.dispatchEvent(new CustomEvent('samurai-gesture', { detail: { name, t: Date.now() } }));
    if (G.debug && SAM.hud) SAM.hud.log('info', 'gesture · ' + name);
  }

  function tick() {
    if (!G.running || !landmarker || !video || video.readyState < 2) return;
    let res; try { res = landmarker.detectForVideo(video, performance.now()); } catch (e) { return; }
    const lm = res && res.landmarks && res.landmarks[0];
    if (!lm) { stable = { name: null, count: 0 }; trail = []; return; }
    const now = performance.now(); trail.push({ x: lm[0].x, y: lm[0].y, t: now }); trail = trail.filter(p => now - p.t < 800);
    const sw = detectSwipe(trail); if (sw) { fire(sw); trail = []; return; }
    const name = classify(lm);
    if (name && name === stable.name) stable.count++; else stable = { name, count: 1 };
    if (name && stable.count >= 3) { fire(name); stable.count = 0; }          // ~300 ms of the same pose
  }

  G.start = async function () {
    if (G.running) return true;
    try { await load(); await camera(); } catch (e) { SAM.hud && SAM.hud.log('warn', 'gestures · ' + String(e.message || e).slice(0, 80)); return false; }
    G.running = true; timer = setInterval(tick, 1000 / G.fps); SAM.hud && SAM.hud.log('ok', 'gestures · watching your hands');
    return true;
  };
  G.stop = function () {
    G.running = false; clearInterval(timer); timer = null;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    else if (SAM.cam && SAM.cam.video === video && SAM.cam.users > 0) { SAM.cam.users--; if (!SAM.cam.users && SAM.cam.stream) { SAM.cam.stream.getTracks().forEach(t => t.stop()); SAM.cam.stream = SAM.cam.video = null; } }
    video = null;
  };
  SAM.gestures = G;
})(typeof window !== 'undefined' ? window : globalThis);
