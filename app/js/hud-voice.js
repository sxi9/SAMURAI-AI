/* SAMURAI HUD v3 — voice: microphone → Vosk/Whisper WebSocket (:9100) or the phone's own recogniser (SpeechRecognition),
   neural TTS (:9200, edge / kokoro / elevenlabs / openai / cartesia / azure) with the browser's voices as fallback or by choice.
   Exposes window.SAM.voice. Events are delivered through callbacks set by hud.js.
   Companion mode (phone): voice.relay sends recognised text to the PC and waits for the reply; the PC HUD polls voice.relay.pollLoop. */
window.SAM = window.SAM || {};
(function (SAM) {
  const SPEECH_WS = SAM.H.replace('http', 'ws') + ':9100' + (SAM.token ? '?token=' + SAM.token : ''), TTS_URL = SAM.H + ':9200', PANEL_URL = SAM.H + ':9000';
  const TOK = SAM.token ? { 'X-Samurai-Token': SAM.token } : {};
  const voice = {
    /* sttEngine: server (Vosk or Whisper on the PC) | phone (this browser's SpeechRecognition: Google on Android Chrome, Siri on iPhone)
       ttsEngine: neural (the TTS sidecar; `tts` picks the sidecar engine, voice id picks the voice) | local (this device's speechSynthesis voices)
       companion: off | phone | pc | both — on the phone page: where replies are spoken when commands are relayed to the PC */
    cfg: { gain: 1.5, ns: true, ec: true, agc: true, sttModel: 'small', sttEngine: 'server', neuralVoice: 'en-US-AriaNeural', tts: '', ttsEngine: 'neural', rate: 1.0, voiceOn: true, wake: false, wakeWord: 'samurai', companion: 'off' },
    micOn: false, wantRunning: false, ws: null, stream: null, actx: null, node: null, level: 0, rec: null,
    onPartial: null, onFinal: null, onLog: null, onLevel: null, onMicState: null,
    speaking: false, queue: [], audio: null, bargeIn: true,
    log(cls, msg) { if (this.onLog) this.onLog(cls, msg); },
    get phoneCapable() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },

    /* ---------- the phone's own recogniser ---------- */
    startPhone() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { this.log('warn', 'this browser has no speech recognition · use the server mic'); return false; }
      if (!window.isSecureContext) this.log('warn', 'page is not https: the browser may refuse the microphone');
      const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US'; rec.maxAlternatives = 1;
      let lastInterim = '', armed = false; const ww = (this.cfg.wakeWord || 'samurai').toLowerCase();
      rec.onresult = ev => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i], t = r[0].transcript.trim();
          if (r.isFinal) { if (t) { this.onFinal && this.onFinal(t.toLowerCase()); armed = false; } }
          else interim += t + ' ';
        }
        interim = interim.trim();
        if (interim && interim !== lastInterim) {
          lastInterim = interim; this.level = .6; this.onLevel && this.onLevel(this.level);
          if (!armed && this.cfg.wake && interim.toLowerCase().includes(ww)) { armed = true; this.onWake && this.onWake({ wake: true, score: 1 }); }
          this.onPartial && this.onPartial(interim.toLowerCase());
          if (this.speaking && this.bargeIn) this.stopSpeaking('barge-in');
        }
      };
      rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.log('warn', 'microphone refused · open the page over https'); this.wantRunning = false; } else if (e.error !== 'no-speech' && e.error !== 'aborted') this.log('warn', 'phone recogniser: ' + e.error); };
      rec.onend = () => { this.level = 0; if (this.micOn && this.wantRunning) { try { rec.start(); } catch (e) { setTimeout(() => { try { rec.start(); } catch (_) { } }, 500); } } };
      try { rec.start(); } catch (e) { this.log('warn', 'phone recogniser failed to start'); return false; }
      this.rec = rec; this.micOn = true; this.log('ok', 'mic → this phone\'s recogniser (' + rec.lang + ')');
      this.onMicState && this.onMicState(true);
      return true;
    },

    /* ---------- microphone ---------- */
    connect() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(SPEECH_WS); ws.binaryType = 'arraybuffer';
        ws.onopen = () => { this.log('ok', 'speech server connected'); resolve(ws); };
        ws.onmessage = ev => { try { const m = JSON.parse(ev.data); if (m.text) (m.final ? this.onFinal : this.onPartial)?.(m.text); else if (m.wake) this.onWake && this.onWake(m); else if (m.model) this.log(m.status === 'ok' ? 'ok' : 'warn', `stt model ${m.model} ${m.status}`); else if (m.engine) this.log('ok', `speech server: vad ${m.vad ? 'on' : 'off'} · wake engine ${m.engine}`); } catch (e) { } };
        ws.onerror = () => reject(new Error('speech server offline'));
        ws.onclose = () => { if (this.micOn && this.wantRunning) { this.log('warn', 'speech server disconnected · reconnecting'); setTimeout(async () => { try { this.ws = await this.connect(); } catch (e) { this.log('warn', 'reconnect failed'); } }, 2000); } };
      });
    },
    async start() {
      if (this.micOn) return true;
      this.wantRunning = true;
      if (this.cfg.sttEngine === 'phone') { const ok = this.startPhone(); if (!ok) this.wantRunning = false; return ok; }
      try { this.ws = await this.connect(); if (this.cfg.sttModel !== 'small') this.ws.send('MODEL:' + this.cfg.sttModel); }
      catch (e) { this.log('warn', 'speech server offline (:9100)'); this.wantRunning = false; return false; }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: this.cfg.ec, noiseSuppression: this.cfg.ns, autoGainControl: this.cfg.agc, channelCount: 1 } });
        this.actx = new (window.AudioContext || window.webkitAudioContext)();
        const ratio = this.actx.sampleRate / 16000, src = this.actx.createMediaStreamSource(this.stream);
        this.node = this.actx.createScriptProcessor(4096, 1, 1);
        this.node.onaudioprocess = ev => {
          if (!this.micOn || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
          const raw = ev.inputBuffer.getChannelData(0), input = new Float32Array(raw.length);
          let max = 0;
          for (let i = 0; i < raw.length; i++) { input[i] = Math.max(-1, Math.min(1, raw[i] * this.cfg.gain)); const a = Math.abs(input[i]); if (a > max) max = a; }
          this.level = this.level * .6 + Math.min(1, max * 3) * .4;
          if (this.onLevel) this.onLevel(this.level);
          if (this.speaking && !this.bargeIn) return;                           // half-duplex unless barge-in
          if (this.speaking && this.bargeIn && this.level > .55) this.stopSpeaking('barge-in');
          else if (this.speaking) return;
          const outLen = Math.floor(input.length / ratio), out = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) { const s = Math.floor(i * ratio), e = Math.min(input.length, Math.floor((i + 1) * ratio)); let sum = 0; for (let j = s; j < e; j++) sum += input[j]; out[i] = sum / Math.max(1, e - s); }
          const i16 = new Int16Array(outLen); for (let i = 0; i < outLen; i++) i16[i] = out[i] < 0 ? out[i] * 0x8000 : out[i] * 0x7FFF;
          this.ws.send(i16.buffer);
        };
        src.connect(this.node); this.node.connect(this.actx.destination);
        this.micOn = true; this.log('ok', `mic ${this.actx.sampleRate}Hz → 16k → vosk`);
        if (this.onMicState) this.onMicState(true);
        return true;
      } catch (e) { this.log('warn', 'microphone access denied'); this.wantRunning = false; try { this.ws && this.ws.close(); } catch (_) { } return false; }
    },
    stop() {
      this.micOn = false; this.wantRunning = false;
      try { if (this.rec) { this.rec.onend = null; this.rec.stop(); this.rec = null; } } catch (e) { }
      try { this.node && this.node.disconnect(); } catch (e) { }
      try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) { }
      try { this.actx && this.actx.close(); } catch (e) { }
      try { this.ws && this.ws.close(); } catch (e) { }
      this.node = this.stream = this.actx = this.ws = null; this.level = 0;
      if (this.onMicState) this.onMicState(false);
    },
    flush() { if (this.ws && this.ws.readyState === 1) this.ws.send('EOF'); },
    setModel(name) { this.cfg.sttModel = name; if (this.ws && this.ws.readyState === 1) this.ws.send('MODEL:' + name); },

    /* ---------- speech output ---------- */
    async voices() { try { const r = await fetch(TTS_URL + '/voices', { headers: TOK }); return (await r.json()).voices || []; } catch (e) { return []; } },
    async engines() { try { const r = await fetch(TTS_URL + '/engines', { headers: TOK }); return await r.json(); } catch (e) { return {}; } },
    /* the best female voice this device has (iPhone: Samantha / Siri voices; Android Chrome: Google US English; Windows: Zira / Aria) */
    localVoice() {
      const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
      const order = [/Samantha/i, /Siri/i, /Ava/i, /Aria/i, /Jenny/i, /Google US English/i, /Zira/i, /Karen/i, /Moira/i, /Female/i, /en-US/i, /^en/i];
      for (const re of order) { const v = vs.find(v => re.test(v.name) || (re.source.startsWith('en') && re.test(v.lang))); if (v) return v; }
      return vs[0] || null;
    },
    speakLocal(text, opts = {}) {
      return new Promise(resolve => {
        if (!window.speechSynthesis || !text) return resolve(false);
        const u = new SpeechSynthesisUtterance(text); u.rate = this.cfg.rate; u.pitch = 1.03; const v = this.localVoice(); if (v) u.voice = v;
        u.onstart = () => opts.onstart && opts.onstart(); u.onend = () => resolve(true); u.onerror = () => resolve(false);
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      });
    },
    speak(text, opts = {}) {
      text = (text || '').trim(); if (!text) return Promise.resolve();
      return new Promise(resolve => { this.queue.push({ text, opts, resolve }); if (!this.speaking) this._next(); });
    },
    async _next() {
      const item = this.queue.shift();
      if (!item) { this.speaking = false; return; }
      this.speaking = true;
      const { text, opts, resolve } = item;
      let started = false;
      const onStart = () => { if (!started) { started = true; opts.onstart && opts.onstart(); } };
      const done = () => { opts.onend && opts.onend(); resolve(); this._next(); };
      if (!this.cfg.voiceOn) { onStart(); setTimeout(done, Math.min(6000, 300 + text.length * 22)); return; }
      if (this.cfg.ttsEngine === 'local') { if (this._browser(text, onStart, done)) return; }
      if (await this._neural(text, onStart, done)) return;
      if (!this._browser(text, onStart, done)) { onStart(); setTimeout(done, Math.min(6000, 300 + text.length * 22)); }
    },
    async _neural(text, onstart, onend) {
      try {
        const pct = Math.round((this.cfg.rate - 1) * 100), rate = (pct >= 0 ? '+' : '') + pct + '%';
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
        const r = await fetch(`${TTS_URL}/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(this.cfg.neuralVoice)}&rate=${encodeURIComponent(rate)}${this.cfg.tts ? '&engine=' + encodeURIComponent(this.cfg.tts) : ''}`, { signal: ctl.signal, headers: TOK });
        clearTimeout(to);
        if (!r.ok) throw new Error('tts ' + r.status);
        const blob = await r.blob(), audio = new Audio(URL.createObjectURL(blob));
        this.audio = audio;
        audio.onplay = onstart; audio.onended = () => { this.audio = null; onend(); }; audio.onerror = () => { this.audio = null; onend(); };
        try { await audio.play(); } catch (e) { this.log('warn', 'audio playback blocked by browser (click the page once)'); this.audio = null; return false; }
        return true;
      } catch (e) { this.log('warn', 'neural tts offline · browser voice'); return false; }
    },
    _browser(text, onstart, onend) {
      if (!window.speechSynthesis) return false;
      const u = new SpeechSynthesisUtterance(text); u.rate = this.cfg.rate; u.pitch = 1.03;
      const pref = this.localVoice();
      if (pref) u.voice = pref;
      u.onstart = onstart; u.onend = onend; u.onerror = onend;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      return true;
    },
    stopSpeaking(reason) {
      this.queue = [];
      try { if (this.audio) { this.audio.pause(); this.audio.onended = null; this.audio = null; } } catch (e) { }
      try { speechSynthesis && speechSynthesis.cancel(); } catch (e) { }
      if (this.speaking) { this.speaking = false; this.log('ok', `speech stopped${reason ? ' · ' + reason : ''}`); if (this.onInterrupt) this.onInterrupt(); }
    },

    /* ---------- companion relay (panel :9000) ----------
       phone page:  const reply = await voice.relay.send(text, speakOn)   -> {text, focus} or null on timeout
       PC HUD:      voice.relay.pollLoop(async cmd => replyText)           (cmd = {id, text, speak_on, from}) */
    relay: {
      timer: null,
      async send(text, speakOn) {
        const r = await fetch(PANEL_URL + '/remote/command', { method: 'POST', headers: { 'Content-Type': 'application/json', ...TOK }, body: JSON.stringify({ text, speak_on: speakOn || voice.cfg.companion || 'both' }) }).then(r => r.json());
        if (!r.ok) throw new Error(r.error || 'relay refused');
        for (let i = 0; i < 3; i++) {                                     // up to ~60 s for long tasks
          const p = await fetch(`${PANEL_URL}/remote/reply?id=${r.id}`, { headers: TOK }).then(r => r.json());
          if (p.reply) return p.reply;
        }
        return null;
      },
      pollLoop(handler, every = 1500) {
        this.stop();
        const tick = async () => {
          try {
            const d = await fetch(PANEL_URL + '/remote/next', { headers: TOK }).then(r => r.json());
            if (d.command) {
              let text = '';
              try { text = (await handler(d.command)) || ''; } catch (e) { text = 'Something went wrong on my side.'; }
              await fetch(PANEL_URL + '/remote/reply', { method: 'POST', headers: { 'Content-Type': 'application/json', ...TOK }, body: JSON.stringify({ id: d.command.id, text }) });
            }
          } catch (e) { }
          this.timer = setTimeout(tick, every);
        };
        this.timer = setTimeout(tick, every);
      },
      stop() { clearTimeout(this.timer); this.timer = null; }
    }
  };
  SAM.voice = voice;
})(window.SAM);
