/* SAMURAI HUD v3 — the 12 widgets: markup, live data from the sidecars (:8765 telemetry, :9500 add-ons),
   timers, music, tasks, home, security. Exposes window.SAM.widgets. */
window.SAM = window.SAM || {};
(function (SAM) {
  const ADDONS = SAM.H + ':9500', TEL = SAM.H + ':8765/stats', TQ = SAM.token ? '&token=' + SAM.token : '';
  const W = [
    { id: 'sys', side: 'L', x: 40, y: 100, node: 6, code: 'SYS', name: 'SYSTEM & NETWORK', title: 'SYSTEM' },
    { id: 'cal', side: 'L', x: 328, y: 100, node: 11, code: 'CAL', name: 'AGENDA', title: 'AGENDA' },
    { id: 'task', side: 'L', x: 40, y: 366, node: 10, code: 'TASK', name: 'TASKS & REMINDERS', title: 'TASKS' },
    { id: 'msg', side: 'L', x: 328, y: 366, node: 9, code: 'MSG', name: 'INBOX', title: 'INBOX' },
    { id: 'tty', side: 'L', x: 40, y: 632, node: 8, code: 'TTY', name: 'TERMINAL', title: 'TERMINAL' },
    { id: 'tmr', side: 'L', x: 328, y: 632, node: 7, code: 'TMR', name: 'TIMERS & ALARMS', title: 'TIMERS' },
    { id: 'wx', side: 'R', x: 1320, y: 100, node: 0, code: 'WX', name: 'WEATHER', title: 'WEATHER' },
    { id: 'mus', side: 'R', x: 1608, y: 100, node: 1, code: 'MUS', name: 'MUSIC', title: 'MUSIC' },
    { id: 'home', side: 'R', x: 1320, y: 366, node: 2, code: 'HOME', name: 'SMART HOME', title: 'HOME' },
    { id: 'map', side: 'R', x: 1608, y: 366, node: 3, code: 'MAP', name: 'POSITION', title: 'POSITION' },
    { id: 'cam', side: 'R', x: 1320, y: 632, node: 4, code: 'CAM', name: 'CAMERA FEED', title: 'FEED 01' },
    { id: 'pix', side: 'R', x: 1608, y: 632, node: 5, code: 'PIX', name: 'HOLO GALLERY', title: 'HOLO GALLERY' },
  ];
  const NODE = k => { const a = (-90 + k * 30) * Math.PI / 180; return [960 + 300 * Math.cos(a), 470 + 300 * Math.sin(a)]; };
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = id => document.getElementById(id);
  const J = async (url, opts) => { const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000); try { const r = await fetch(url, { ...opts, signal: ctl.signal }); return await r.json(); } finally { clearTimeout(to); } };
  const POST = (url, body) => J(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const widgets = {
    W, NODE, fmt, esc,
    data: {
      tel: { cpu: 0, mem: 0, gpu: null, up: 0, down: 0, conns: 0, net: Array(40).fill(0), live: false },
      weather: null, agenda: [], agendaLive: false, inbox: [], inboxLive: false, tasks: [], home: { lights: true, ac: true, lock: true, blinds: false, plug: false, fan: true }, homeLive: false,
      music: { tracks: [{ i: -1, title: 'Night Drive', artist: 'Kessler Array', len: 221, sample: true }], now: { i: -1, playing: false }, pos: 0, live: false, queryTitle: '' },
      gallery: [], position: null, security: null, ticker: null,
      timer: { left: 300, total: 300, running: false }, tty: [{ t: 'samurai boot · ok', c: '#2ee6ff' }], camErr: false,
    },
    onLog: null, onTimerDone: null, onSecurity: null, onAction: null, nodeLabel: 'LOCAL-01', audio: null,
    log(c, m) { this.onLog && this.onLog(c, m); },

    /* ---------- markup ---------- */
    shell(w) {
      return `<div class="slot" data-id="${w.id}"><div class="fly" data-id="${w.id}"><div class="card ${w.side}" data-id="${w.id}">
        <div class="ch"><b></b><span class="t">${w.title}</span><span class="tag" id="tag-${w.id}">—</span></div><div class="body" id="body-${w.id}"></div></div></div></div>`;
    },
    mount(layerL, layerR, nodesEl) {
      layerL.innerHTML = W.filter(w => w.side === 'L').map(w => this.shell(w)).join('');
      layerR.innerHTML = W.filter(w => w.side === 'R').map(w => this.shell(w)).join('');
      nodesEl.innerHTML = W.map(w => { const [x, y] = NODE(w.node); return `<div class="node" data-id="${w.id}" title="${w.name}" style="left:${x - 23}px;top:${y - 23}px">${w.code}<i></i></div>`; }).join('');
      document.querySelectorAll('.slot').forEach(s => { const w = W.find(x => x.id === s.dataset.id); s.style.left = w.x + 'px'; s.style.top = w.y + 'px'; });
      W.forEach(w => this.render(w.id));
    },
    tag(id, text, cls) { const el = $('tag-' + id); if (el) { el.className = 'tag' + (cls ? ' ' + cls : ''); el.innerHTML = text; } },
    render(id) {
      const b = $('body-' + id); if (!b) return;
      const d = this.data;
      switch (id) {
        case 'sys': {
          const t = d.tel; this.tag(id, t.live ? 'LIVE' : 'SIM', t.live ? '' : 'v');
          if (!b.firstChild) b.innerHTML = `<div class="meter"><span>CPU</span><span id="vcpu">0%</span></div><div class="track"><i id="bcpu"></i></div>
            <div class="meter"><span>MEMORY</span><span id="vmem">0%</span></div><div class="track"><i id="bmem"></i></div>
            <div class="meter"><span>GPU</span><span id="vgpu">—</span></div><div class="track last"><i id="bgpu" class="v"></i></div>
            <canvas id="net" width="480" height="76"></canvas>
            <div class="netrow"><span class="c" id="vdown">▼ 0.0 MB/s</span><span class="v" id="vup">▲ 0.0 MB/s</span><span class="m" id="vconn">0 CONN</span></div>`;
          $('vcpu').textContent = Math.round(t.cpu) + '%'; $('bcpu').style.width = t.cpu + '%';
          $('vmem').textContent = Math.round(t.mem) + '%'; $('bmem').style.width = t.mem + '%';
          $('vgpu').textContent = t.gpu == null ? 'N/A' : Math.round(t.gpu) + '%'; $('bgpu').style.width = (t.gpu || 0) + '%';
          $('vdown').textContent = `▼ ${(+t.down).toFixed(1)} MB/s`; $('vup').textContent = `▲ ${(+t.up).toFixed(1)} MB/s`; $('vconn').textContent = `${t.conns} CONN`;
          this.drawNet(); break;
        }
        case 'cal': {
          const ev = d.agenda, now = new Date(), days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
          this.tag(id, `${ev.length} TODAY`, 'v');
          const nxt = ev.find(e => e.next), mins = nxt ? Math.max(0, Math.round((new Date(now.toDateString() + ' ' + nxt.time) - now) / 60000)) : null;
          b.innerHTML = `<div class="agenda"><div class="datebox"><div class="n">${String(now.getDate()).padStart(2, '0')}</div><div class="d">${days[now.getDay()]} · ${mons[now.getMonth()]}</div></div>
            <div class="evs">${ev.slice(0, 3).map(e => `<div class="ev ${e.past ? 'past' : e.next ? 'next' : 'later'}"><b></b><div><div class="tm">${esc(e.time)}${e.next ? ' · NEXT' : ''}</div><div class="ti">${esc(e.title)}${e.tag ? ' · ' + esc(e.tag) : ''}</div></div></div>`).join('') || '<div class="ev"><b></b><div><div class="ti">Nothing scheduled</div></div></div>'}</div></div>
            <div class="foot">${nxt ? `NEXT IN ${mins >= 60 ? Math.floor(mins / 60) + 'H ' : ''}${mins % 60}M` : 'NO MORE EVENTS TODAY'} · ${d.agendaLive ? 'CALENDAR LINKED' : 'SAMPLE · SET ICS IN CONFIG'}</div>`;
          break;
        }
        case 'task': {
          const ts = d.tasks; this.tag(id, `${ts.filter(t => t.done).length} / ${ts.length}`, 'v');
          b.innerHTML = `<div class="tasks">${ts.slice(0, 4).map(t => `<div class="task${t.done ? ' done' : ''}" data-tid="${t.id}"><span class="bx"></span><span class="lb">${esc(t.label)}</span><span class="du">${esc(t.due)}</span></div>`).join('')}</div><div class="foot">CLICK TO TOGGLE · SAY "REMIND ME TO…"</div>`;
          b.querySelectorAll('.task').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); this.taskAction('toggle', { id: +el.dataset.tid }); }));
          break;
        }
        case 'msg': {
          const m = d.inbox, unread = m.filter(x => x.unread).length, flagged = m.filter(x => x.flagged).length;
          this.tag(id, `${unread} UNREAD`, unread ? 'r' : '');
          b.innerHTML = `<div class="mails">${m.slice(0, 3).map(x => `<div class="mail${x.flagged ? ' flag' : ''}"><i></i><div><div class="fr"><span>${esc(x.from)}</span><span>${esc(x.time)}</span></div><div class="su">${esc(x.subject)}</div></div></div>`).join('') || '<div class="mail"><div><div class="su">Inbox empty</div></div></div>'}</div>
            <div class="foot">${flagged} FLAGGED · ${d.inboxLive ? 'IMAP LINKED' : 'SAMPLE · SET IMAP IN CONFIG'}</div>`;
          break;
        }
        case 'tty': {
          this.tag(id, ':9300');
          b.innerHTML = `<div class="tty">${d.tty.slice(-8).map(l => `<div style="color:${l.c}">${esc(l.t)}</div>`).join('')}<div class="pr">samurai@${esc(this.nodeLabel.toLowerCase())}:~$ <i></i></div></div>`;
          break;
        }
        case 'tmr': {
          const t = d.timer; this.tag(id, t.running ? 'RUNNING' : t.left === 0 ? 'DONE' : 'READY', 'v');
          b.innerHTML = `<div class="tmr"><div class="tring${t.running ? ' run' : ''}" style="background:conic-gradient(${t.running ? '#2ee6ff' : '#a07cff'} ${t.total ? t.left / t.total * 100 : 0}%, rgba(46,230,255,.1) 0)"><div><div class="tt">${fmt(t.left)}</div><div class="tc">FOCUS</div></div></div>
            <div class="tbtns"><div class="btn" id="tmrToggle">${t.running ? 'PAUSE' : 'START'}</div><div class="btn v" id="tmrReset">RESET</div></div></div>
            <div class="foot"><div class="alarms"><div><span>SAY "TIMER 5 MIN"</span><span class="on">VOICE</span></div><div><span>SAY "STOP TIMER"</span><span class="off">RESET</span></div></div></div>`;
          $('tmrToggle').addEventListener('click', e => { e.stopPropagation(); this.timerToggle(); });
          $('tmrReset').addEventListener('click', e => { e.stopPropagation(); this.timerReset(); });
          break;
        }
        case 'wx': {
          const w = d.weather; this.tag(id, w ? esc(w.label || 'WX') : '…');
          if (!w) { b.innerHTML = '<div class="wx"><div class="big">--°</div><div class="cond">LINKING<br>—</div></div>'; break; }
          b.innerHTML = `<div class="wx"><div class="big">${w.temp}°</div><div class="cond">${esc(w.cond)}<br>H ${w.hi}° · L ${w.lo}°</div></div>
            <div class="wxrow"><span>WIND ${w.wind} km/h</span><span>HUM ${w.hum}%</span><span>UV ${w.uv}</span></div>
            <div class="days">${(w.days || []).slice(0, 4).map(x => `<div><div class="d">${esc(x.d)}</div><div class="h">${x.hi}°</div><div class="l">${x.cond && x.cond.length <= 5 ? esc(x.cond) : x.lo + '°'}</div></div>`).join('')}</div>`;
          break;
        }
        case 'mus': {
          const m = d.music, tr = m.tracks[Math.max(0, m.now.i)] || m.tracks[0] || { title: '—', artist: '—', len: 0 };
          this.tag(id, m.now.playing ? 'PLAYING' : 'PAUSED', 'v');
          const len = (this.audio && isFinite(this.audio.duration) && this.audio.duration) || tr.len || 0, pos = this.audio ? this.audio.currentTime : m.pos;
          b.innerHTML = `<div class="mus"><div class="art" id="art">${tr.art ? `<img src="${tr.art}" alt="">` : 'album<br>art'}</div><div><div class="ti">${esc(m.queryTitle || tr.title)}</div><div class="ar">${esc(tr.artist || '')}</div><div class="mx">${m.live ? `LIBRARY · ${Math.max(0, m.now.i) + 1} / ${m.tracks.length}` : 'SAY "PLAY …" · YOUTUBE'}</div></div></div>
            <div class="mbar"><i style="width:${len ? Math.min(100, pos / len * 100) : 0}%"></i></div><div class="mtimes"><span>${fmt(pos)}</span><span>${fmt(len)}</span></div>
            <div class="mctl"><div id="musPrev">◀◀</div><div class="pl" id="musToggle">${m.now.playing ? '❚❚' : '▶'}</div><div id="musNext">▶▶</div></div>`;
          $('musPrev').addEventListener('click', e => { e.stopPropagation(); this.music('prev'); });
          $('musNext').addEventListener('click', e => { e.stopPropagation(); this.music('next'); });
          $('musToggle').addEventListener('click', e => { e.stopPropagation(); this.music(m.now.playing ? 'pause' : 'play'); });
          break;
        }
        case 'home': {
          const h = d.home; this.tag(id, `${Object.values(h).filter(Boolean).length} ON`);
          const tiles = [['lights', 'LIGHTS', 'ON', 'OFF'], ['ac', 'AC', '22°', 'OFF'], ['lock', 'DOOR', 'LOCKED', 'OPEN'], ['blinds', 'BLINDS', 'DOWN', 'UP'], ['plug', 'PLUG', 'ON', 'OFF'], ['fan', 'FAN', 'LOW', 'OFF']];
          b.innerHTML = `<div class="tiles">${tiles.map(([k, n, on, off]) => `<div class="tile${h[k] ? ' on' : ''}" data-dev="${k}"><div class="n">${n}</div><div class="v">${h[k] ? on : off}</div></div>`).join('')}</div>
            <div class="foot">${d.homeLive ? 'HOME ASSISTANT LINKED' : 'SAY "LIGHTS OFF" · "LOCK THE DOOR"'}</div>`;
          b.querySelectorAll('.tile').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); this.setHome(el.dataset.dev, !h[el.dataset.dev]); }));
          break;
        }
        case 'map': {
          const p = d.position; this.tag(id, p && p.lat ? 'FIXED' : 'GPS —');
          const near = (p && p.nearby || []).slice(0, 2);
          const pts = near.map((n, i) => { const a = ((n.bearing || (i ? 225 : 40)) - 90) * Math.PI / 180, r = Math.min(68, 20 + Math.log2(1 + (n.km || 1)) * 12), x = Math.cos(a) * r, y = Math.sin(a) * r; return `<div class="pt" style="left:calc(50% + ${x - 3}px);top:calc(50% + ${y - 3}px)"></div><div class="pl" style="left:calc(50% + ${x + (x < 0 ? -78 : 8)}px);top:calc(50% + ${y - 8}px)">${esc(n.name)} ${n.km} km</div>`; }).join('');
          b.innerHTML = `<div class="radar"><div class="r r1"></div><div class="r r2"></div><div class="r r3"></div><div class="hx"></div><div class="vx"></div><div class="sweep"></div><div class="me"></div>${pts}</div>
            <div class="coords"><span>${p && p.lat ? `${Math.abs(p.lat).toFixed(4)}° ${p.lat >= 0 ? 'N' : 'S'} · ${Math.abs(p.lon).toFixed(4)}° ${p.lon >= 0 ? 'E' : 'W'}` : 'SET LOCATION IN SETTINGS'}</span><span>${esc(p && p.node || this.nodeLabel)}</span></div>`;
          break;
        }
        case 'cam': {
          if (b.firstChild) break;
          this.tag(id, '<i></i>LIVE', 'r');
          const url = this.camUrl || '';
          const isImg = /\.(mjpg|mjpeg|jpg|png)(\?|$)/i.test(url) || /mjpg|mjpeg|snapshot/i.test(url);
          b.innerHTML = `<div class="feed" id="feed">${url ? (isImg ? `<img id="camImg" src="${esc(url)}" alt="">` : `<video id="camVid" muted loop playsinline autoplay preload="auto" src="${esc(url)}"></video>`) : `<video id="camVid" muted loop playsinline autoplay preload="auto"><source src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" type="video/mp4"><source src="https://www.w3schools.com/html/mov_bbb.mp4" type="video/mp4"></video>`}
            <div class="nosig hidden" id="nosig">NO SIGNAL</div><div class="sl"></div><div class="tn"></div><div class="lab a">${url ? 'CAM · 01' : 'GATE · NORTH (DEMO CLIP)'}</div><div class="lab b" id="camClock"></div><div class="ck a"></div><div class="ck b"></div><div class="ck c"></div><div class="ck d"></div></div>
            <div class="feedfoot"><span>${url ? 'LIVE STREAM' : 'H.264 · DEMO · SET CAMERA URL'}</span><span>CLICK TO PAUSE</span></div>`;
          const v = $('camVid'), im = $('camImg');
          if (v) { v.addEventListener('error', () => $('nosig').classList.remove('hidden'), true); v.play().catch(() => { }); }
          if (im) im.addEventListener('error', () => $('nosig').classList.remove('hidden'));
          $('feed').addEventListener('click', e => { e.stopPropagation(); if (v) v.paused ? v.play().catch(() => { }) : v.pause(); });
          break;
        }
        case 'pix': {
          const g = d.gallery; this.tag(id, `${Math.min(3, g.length)} FRAMES`, 'v');
          b.innerHTML = `<div class="holo">${[0, 1, 2].map(i => `<div class="frame${i === 0 ? ' tall' : ''}" data-fi="${i}">${g[i] ? `<img src="${ADDONS}${g[i]}${TQ}" alt="">` : (i === 0 ? 'drop photo' : 'drop')}<div class="fx"></div><div class="bd"></div></div>`).join('')}</div>
            <div class="foot">${g.length ? `${g.length} PHOTOS IN GALLERY FOLDER` : 'DROP PHOTOS INTO THE gallery/ FOLDER'}</div>`;
          break;
        }
      }
    },
    drawNet() {
      const c = $('net'); if (!c) return;
      const x = c.getContext('2d'), W2 = c.width, H = c.height, a = this.data.tel.net, mx = Math.max(4, ...a);
      x.clearRect(0, 0, W2, H);
      const pt = (i, v) => [i / (a.length - 1) * W2, H - 4 - (v / mx) * (H - 8)];
      x.beginPath(); a.forEach((v, i) => { const [px, py] = pt(i, v); i ? x.lineTo(px, py) : x.moveTo(px, py); });
      x.strokeStyle = '#2ee6ff'; x.lineWidth = 2; x.shadowColor = '#2ee6ff'; x.shadowBlur = 8; x.stroke();
      x.lineTo(W2, H); x.lineTo(0, H); x.closePath();
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(46,230,255,.3)'); g.addColorStop(1, 'rgba(160,124,255,0)');
      x.shadowBlur = 0; x.fillStyle = g; x.fill();
    },
    pushTty(text, c = '#a9cfe0') { this.data.tty = [...this.data.tty.slice(-7), { t: text, c }]; this.render('tty'); },

    /* ---------- live data ---------- */
    async pollTel() {
      try {
        const s = await J(TEL); const t = this.data.tel;
        Object.assign(t, { cpu: s.cpu, mem: s.mem, gpu: s.gpu, up: s.up, down: s.down, conns: s.conn_count ?? (s.conns || []).length, live: true, raw: s });
        t.net = (s.net_history && s.net_history.length ? [...Array(Math.max(0, 40 - s.net_history.length)).fill(0), ...s.net_history] : [...t.net.slice(1), (s.up || 0) + (s.down || 0)]).slice(-40);
        if (!this._telOnce) { this._telOnce = true; this.pushTty('telemetry :8765 · linked', '#2ee6ff'); }
      } catch (e) {
        const t = this.data.tel, j = (v, a, lo, hi) => Math.max(lo, Math.min(hi, v + (Math.random() - .5) * a));
        Object.assign(t, { cpu: Math.round(j(t.cpu || 23, 10, 6, 60)), mem: Math.round(j(t.mem || 41, 3, 30, 70)), gpu: Math.round(j(t.gpu || 12, 8, 4, 50)), down: +j(t.down || 2, 1.2, .1, 9).toFixed(1), up: +j(t.up || .4, .4, .05, 3).toFixed(1), conns: Math.round(j(t.conns || 14, 4, 6, 24)), live: false });
        t.net = [...t.net.slice(1), t.up + t.down];
      }
      this.render('sys');
    },
    async pollAddons(kind) {
      const d = this.data;
      try {
        if (kind === 'weather') { const r = await J(ADDONS + '/weather'); d.weather = r; this.render('wx'); if (!r.live && !r.note && (this._wxRetry = (this._wxRetry || 0) + 1) <= 5) setTimeout(() => this.pollAddons('weather'), 20000); }
        if (kind === 'ticker') { d.ticker = await J(ADDONS + '/ticker'); this.onTicker && this.onTicker(); }
        if (kind === 'tasks') { const r = await J(ADDONS + '/tasks'); d.tasks = r.tasks || []; this.render('task'); }
        if (kind === 'agenda') { const r = await J(ADDONS + '/agenda'); d.agenda = r.events || []; d.agendaLive = !!r.live; this.render('cal'); }
        if (kind === 'inbox') { const r = await J(ADDONS + '/inbox'); d.inbox = r.mail || []; d.inboxLive = !!r.live; this.render('msg'); }
        if (kind === 'home') { const r = await J(ADDONS + '/home'); d.home = r.state || d.home; d.homeLive = !!r.live; this.render('home'); }
        if (kind === 'music') { const r = await J(ADDONS + '/music'); d.music.tracks = r.tracks || d.music.tracks; d.music.live = !!r.live; if (!this.audio) d.music.now = r.now || d.music.now; this.render('mus'); }
        if (kind === 'gallery') { const r = await J(ADDONS + '/gallery'); d.gallery = r.images || []; this.render('pix'); }
        if (kind === 'position') { d.position = await J(ADDONS + '/position'); this.render('map'); }
        if (kind === 'security') { const r = await J(ADDONS + '/security'); const prev = d.security; d.security = r; if (r.level === 'HIGH' && (!prev || prev.source !== r.source) && this.onSecurity) this.onSecurity(r); }
        if (kind === 'config') { const r = await J(ADDONS + '/config'); this.config = r; this.nodeLabel = (r.user && r.user.node) || this.nodeLabel; this.camUrl = (r.widgets && r.widgets.camera && r.widgets.camera.url) || ''; return r; }
        if (!this._addonsOnce) { this._addonsOnce = true; this.pushTty('add-ons :9500 · linked', '#2ee6ff'); }
      } catch (e) { if (kind === 'weather' && !d.weather) { d.weather = { temp: '--', cond: 'ADD-ONS OFFLINE', hi: '--', lo: '--', wind: '-', hum: '-', uv: '-', days: [], label: 'WX' }; this.render('wx'); } }
    },
    startPolling() {
      const every = (fn, ms) => { fn(); return setInterval(fn, ms); };
      every(() => this.pollTel(), 2000);
      every(() => this.pollAddons('weather'), 600000); every(() => this.pollAddons('ticker'), 120000);
      every(() => this.pollAddons('tasks'), 60000); every(() => this.pollAddons('agenda'), 300000);
      every(() => this.pollAddons('inbox'), 120000); every(() => this.pollAddons('home'), 30000);
      every(() => this.pollAddons('music'), 300000); every(() => this.pollAddons('gallery'), 300000);
      every(() => this.pollAddons('position'), 300000); every(() => this.pollAddons('security'), 60000);
      setInterval(() => this.tickSecond(), 1000);
    },
    tickSecond() {
      const t = this.data.timer, m = this.data.music;
      if (t.running) { if (t.left <= 1) { t.left = 0; t.running = false; this.render('tmr'); this.onTimerDone && this.onTimerDone(); } else { t.left--; this.render('tmr'); } }
      if (m.now.playing && !this.audio) { const tr = m.tracks[Math.max(0, m.now.i)] || m.tracks[0]; m.pos = m.pos + 1 >= (tr.len || 200) ? 0 : m.pos + 1; this.render('mus'); }
      else if (this.audio && m.now.playing) this.render('mus');
      const cc = $('camClock'); if (cc) cc.textContent = new Date().toTimeString().slice(0, 8);
    },
    snapshot() {
      const d = this.data, t = d.tel, s = t.raw || {}, L = [];
      L.push(`CPU ${Math.round(t.cpu)}% (${s.cores || '?'} cores), RAM ${Math.round(t.mem)}%${t.gpu != null ? `, GPU ${Math.round(t.gpu)}%` : ''}${s.temp != null ? `, CPU temp ${s.temp} C` : ''}, uptime ${s.uptime || '?'}, network down ${t.down} MB/s up ${t.up} MB/s, ${t.conns} connections${t.live ? '' : ' (simulated: telemetry sidecar offline)'}`);
      if (s.battery) L.push(`Battery ${s.battery.pct}% ${s.battery.plugged ? 'charging' : 'on battery'}`);
      if (s.disk && s.disk.length) L.push('Disks: ' + s.disk.map(x => `${x.drive} ${x.pct}% used, ${x.free_gb} GB free`).join('; '));
      if (s.top_cpu && s.top_cpu.length) L.push('Top CPU: ' + s.top_cpu.filter(p => p.cpu > 0).slice(0, 4).map(p => `${p.name} ${p.cpu}%`).join(', '));
      const bad = (s.events || []).filter(e => /error|critical|warning/i.test(e.lvl)); if (bad.length) L.push('Recent log warnings: ' + bad.slice(0, 3).map(e => `[${e.lvl}] ${e.src}: ${e.msg}`).join(' | '));
      if (d.weather && d.weather.temp !== '--') L.push(`Weather ${d.weather.label || ''}: ${d.weather.temp} C ${d.weather.cond}, high ${d.weather.hi} low ${d.weather.lo}, wind ${d.weather.wind} km/h, humidity ${d.weather.hum}%${d.weather.live ? '' : ' (sample data)'}; next days: ${(d.weather.days || []).map(x => `${x.d} ${x.hi}/${x.lo} ${x.cond}`).join(', ')}`);
      L.push(`Agenda today${d.agendaLive ? '' : ' (sample)'}: ${d.agenda.map(e => `${e.time} ${e.title}${e.next ? ' (next)' : ''}`).join('; ') || 'none'}`);
      L.push(`Tasks: ${d.tasks.map(t => `${t.done ? '[done] ' : ''}${t.label} (${t.due})`).join('; ') || 'none'}`);
      L.push(`Inbox${d.inboxLive ? '' : ' (sample)'}: ${d.inbox.map(m => `${m.from}: ${m.subject}${m.flagged ? ' [flagged]' : ''}`).join('; ') || 'empty'}`);
      L.push(`Smart home${d.homeLive ? '' : ' (sample)'}: ${Object.entries(d.home).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')}`);
      const tr = d.music.tracks[Math.max(0, d.music.now.i)] || d.music.tracks[0]; L.push(`Music: ${d.music.now.playing ? 'playing' : 'paused'} ${d.music.queryTitle || (tr && tr.title) || ''}${d.music.live ? ` (library of ${d.music.tracks.length})` : ''}`);
      L.push(`Timer: ${d.timer.running ? 'running, ' + fmt(d.timer.left) + ' left' : d.timer.left === 0 ? 'finished' : 'ready, ' + fmt(d.timer.total)}`);
      if (d.security) L.push(`Security watch: ${d.security.level} — ${d.security.title}`);
      if (d.position && d.position.lat) L.push(`Location: ${d.position.label || ''} ${d.position.lat}, ${d.position.lon}; nearby ${(d.position.nearby || []).map(n => `${n.name} ${n.km} km`).join(', ')}`);
      return L.join('\n');
    },

    /* ---------- widget actions ---------- */
    async taskAction(action, extra) { try { const r = await POST(ADDONS + '/tasks', { action, ...extra }); this.data.tasks = r.tasks || this.data.tasks; } catch (e) { if (action === 'toggle') { const t = this.data.tasks.find(x => x.id === extra.id); if (t) { t.done = !t.done; t.due = t.done ? 'DONE' : 'TODAY'; } } if (action === 'add') this.data.tasks.push({ id: Date.now(), label: extra.label, due: extra.due || 'TODAY', done: false }); } this.render('task'); },
    async setHome(dev, on) { this.data.home[dev] = on; this.render('home'); try { const r = await POST(ADDONS + '/home', { device: dev, on }); this.data.home = r.state || this.data.home; this.data.homeLive = !!r.live; } catch (e) { } this.render('home'); this.pushTty(`home · ${dev} ${on ? 'on' : 'off'}`, '#a07cff'); },
    timerStart(sec) { const t = this.data.timer; t.left = t.total = sec; t.running = true; this.render('tmr'); },
    timerToggle() { const t = this.data.timer; if (t.left === 0) t.left = t.total; t.running = !t.running; this.render('tmr'); },
    timerReset() { const t = this.data.timer; t.running = false; t.left = t.total; this.render('tmr'); },
    music(cmd, arg) {
      const m = this.data.music;
      if (m.live) {
        if (cmd === 'find' && arg) { const q = arg.toLowerCase(), i = m.tracks.findIndex(t => t.title.toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q)); if (i < 0) return false; m.now.i = i; cmd = 'play'; }
        if (cmd === 'next') m.now.i = (m.now.i + 1) % m.tracks.length;
        if (cmd === 'prev') m.now.i = (m.now.i - 1 + m.tracks.length) % m.tracks.length;
        if (cmd === 'play' && m.now.i < 0) m.now.i = 0;
        if (cmd === 'pause') { m.now.playing = false; this.audio && this.audio.pause(); }
        else { m.now.playing = true; this.playTrack(m.now.i); }
        POST(ADDONS + '/music', { cmd: m.now.playing ? 'play' : 'pause', i: m.now.i }).catch(() => { });
        this.render('mus'); return true;
      }
      if (cmd === 'find' || (cmd === 'play' && arg)) { m.queryTitle = arg || m.queryTitle; m.now.playing = true; m.pos = 0; this.render('mus'); this.onAction && this.onAction('play_music', arg); return true; }
      if (cmd === 'pause') { m.now.playing = false; this.onAction && this.onAction('media_play_pause', ''); }
      else if (cmd === 'play') { m.now.playing = true; this.onAction && this.onAction('media_play_pause', ''); }
      else if (cmd === 'next' || cmd === 'prev') { this.onAction && this.onAction(cmd === 'next' ? 'media_next' : 'media_prev', ''); }
      this.render('mus'); return true;
    },
    /* music energy 0..1 for the avatar: real analyser on the library player, a steady 120 BPM pulse for external players */
    musicLevel() {
      const m = this.data.music;
      if (!m.now.playing) return 0;
      if (this.analyser && this.audio && !this.audio.paused) {
        const a = this.analyser, buf = this._fft || (this._fft = new Uint8Array(a.frequencyBinCount)); a.getByteFrequencyData(buf);
        let bass = 0; for (let i = 1; i < 10; i++) bass += buf[i];                // low bins ≈ kick / bass
        const v = bass / 9 / 255; this._lvl = Math.max(v, (this._lvl || 0) * .85); return Math.min(1, this._lvl * 1.4);
      }
      const t = performance.now() / 1000, beat = (t * 2) % 1;                     // 120 BPM
      return Math.max(0, 1 - beat * 3) * .8;
    },
    _attachAnalyser() {
      if (this.analyser || !this.audio) return;
      try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const src = ctx.createMediaElementSource(this.audio); this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = .5; src.connect(this.analyser); this.analyser.connect(ctx.destination); this._actx = ctx; }
      catch (e) { this.analyser = null; }
    },
    playTrack(i) {
      const m = this.data.music; if (!this.audio) { this.audio = new Audio(); this.audio.crossOrigin = 'anonymous'; this.audio.addEventListener('ended', () => this.music('next')); this._attachAnalyser(); }
      if (this._actx && this._actx.state === 'suspended') this._actx.resume().catch(() => { });
      const src = `${ADDONS}/music/file?i=${i}${TQ}`; if (!this.audio.src.endsWith(src)) this.audio.src = src;
      this.audio.play().catch(() => this.log('warn', 'audio playback blocked (click the page once)'));
      const tr = m.tracks[i]; this.pushTty(`music · ${tr ? tr.title : i}`, '#a07cff');
    },
  };
  SAM.widgets = widgets;
})(window.SAM);
