/* SAMURAI HUD · faces. Grabs a frame from the presence camera every 10 s and asks the
   add-ons sidecar who it is (POST /faces/who, LBPH in servers/samurai_senses.py).
     SAM.faces.who()        → {name, confidence, known}   (one shot; fires window 'samurai-face' events with {name, confidence, t} when someone is recognised)
     SAM.faces.enroll(name) → captures 5 frames over 2 s and enrols them as `name`
     SAM.faces.start() / stop()   (start is automatic when SAM.hud.S.presence is on and the sidecar reports faces available)
   Shares the camera with hud-gestures.js through SAM.cam. */
(function (SAM) {
  'use strict';
  const ADDONS = SAM.H + ':9500';
  const C = SAM.cam = SAM.cam || { video: null, stream: null, users: 0 };
  const F = { running: false, last: null, intervalMs: 10000, available: null };
  let timer = null, canvas = null;

  async function openCam() {
    if (C.video) { C.users++; return C.video; }
    const want = ((SAM.hud && SAM.hud.S && SAM.hud.S.presenceCam) || '').toLowerCase();
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cams = devs.filter(d => d.kind === 'videoinput'), pick = cams.find(d => want && d.label.toLowerCase().includes(want)) || cams.find(d => d.label && !/Virtual|OBS|Snap|DroidCam|Iriun/i.test(d.label)) || cams[0];
    C.stream = await navigator.mediaDevices.getUserMedia({ video: pick && pick.deviceId ? { deviceId: { exact: pick.deviceId }, width: 320, height: 240 } : { width: 320, height: 240 }, audio: false });
    C.video = document.createElement('video'); C.video.srcObject = C.stream; C.video.muted = true; C.video.playsInline = true; await C.video.play().catch(() => { });
    C.users = 1; return C.video;
  }
  function closeCam() { if (--C.users > 0) return; if (C.stream) C.stream.getTracks().forEach(t => t.stop()); C.stream = C.video = null; C.users = 0; }

  function frame() {
    const v = C.video; if (!v || v.readyState < 2) return null;
    canvas = canvas || document.createElement('canvas'); canvas.width = v.videoWidth || 320; canvas.height = v.videoHeight || 240;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  }
  const post = (path, body) => fetch(ADDONS + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

  F.who = async function () {
    const opened = !C.video; if (opened) await openCam();
    try {
      if (opened) await new Promise(r => setTimeout(r, 600));
      const img = frame(); if (!img) return { name: null, confidence: 0, known: false, error: 'no frame' };
      const d = await post('/faces/who', { image: img });
      F.last = { name: d.name, confidence: d.confidence, t: Date.now() };
      if (d.name) window.dispatchEvent(new CustomEvent('samurai-face', { detail: F.last }));
      return d;
    } finally { if (opened) closeCam(); }
  };
  F.enroll = async function (name) {
    if (!name) throw new Error('name required');
    const opened = !C.video; if (opened) await openCam();
    try {
      let last = null;
      for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, i ? 400 : 700)); const img = frame(); if (img) last = await post('/faces/enroll', { name, image: img }); }
      SAM.hud && SAM.hud.log(last && last.ok ? 'ok' : 'warn', 'faces · ' + (last ? (last.ok ? `enrolled ${name} (${last.samples} samples)` : last.error) : 'no frames'));
      return last;
    } finally { if (opened) closeCam(); }
  };
  F.start = async function () {
    if (F.running) return;
    try { const d = await (await fetch(ADDONS + '/faces')).json(); F.available = !!d.available; if (!d.available) { SAM.hud && SAM.hud.log('info', 'faces · ' + (d.note || 'not available')); return; } } catch (e) { return; }
    await openCam(); F.running = true;
    timer = setInterval(() => { F.who().catch(() => { }); }, F.intervalMs);
  };
  F.stop = function () { if (!F.running) return; F.running = false; clearInterval(timer); closeCam(); };
  SAM.faces = F;
  // follow the presence switch once the HUD is up
  setTimeout(() => { try { if (SAM.hud && SAM.hud.S && SAM.hud.S.presence) F.start(); } catch (e) { } }, 4000);
})(window.SAM = window.SAM || {});
