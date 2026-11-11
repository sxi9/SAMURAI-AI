/* SAMURAI HUD v3 — voice: microphone → Vosk WebSocket (:9100), neural TTS (:9200) with browser fallback.
   Exposes window.SAM.voice. Events are delivered through callbacks set by hud.js. */
window.SAM = window.SAM || {};
(function (SAM) {
  const SPEECH_WS = SAM.H.replace('http', 'ws') + ':9100' + (SAM.token ? '?token=' + SAM.token : ''), TTS_URL = SAM.H + ':9200';
  const voice = {
    cfg: { gain: 1.5, ns: true, ec: true, agc: true, sttModel: 'small', neuralVoice: 'en-US-AriaNeural', rate: 1.0, voiceOn: true, wake: false, wakeWord: 'samurai' },
    micOn: false, wantRunning: false, ws: null, stream: null, actx: null, node: null, level: 0,
    onPartial: null, onFinal: null, onLog: null, onLevel: null, onMicState: null,
    speaking: false, queue: [], audio: null, bargeIn: true,
    log(cls, msg) { if (this.onLog) this.onLog(cls, msg); },

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
    async voices() { try { const r = await fetch(TTS_URL + '/voices'); return (await r.json()).voices || []; } catch (e) { return []; } },
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
      if (await this._neural(text, onStart, done)) return;
      if (!this._browser(text, onStart, done)) { onStart(); setTimeout(done, Math.min(6000, 300 + text.length * 22)); }
    },
    async _neural(text, onstart, onend) {
      try {
        const pct = Math.round((this.cfg.rate - 1) * 100), rate = (pct >= 0 ? '+' : '') + pct + '%';
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
        const r = await fetch(`${TTS_URL}/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(this.cfg.neuralVoice)}&rate=${encodeURIComponent(rate)}`, { signal: ctl.signal });
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
      const u = new SpeechSynthesisUtterance(text); u.rate = this.cfg.rate; u.pitch = 1.05;
      const vs = speechSynthesis.getVoices(); const pref = vs.find(v => /Aria|Jenny|Zira|Samantha|Google US English|Female/i.test(v.name)) || vs.find(v => /^en/.test(v.lang));
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
    }
  };
  SAM.voice = voice;
})(window.SAM);
