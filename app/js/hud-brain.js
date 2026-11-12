/* SAMURAI HUD v3 — brain: many AI providers behind one call, streaming, JSON reply contract, provider pool
   (failover / round-robin / compare), headless agents (:9400), memory (:9500). Exposes window.SAM.brain. */
window.SAM = window.SAM || {};
(function (SAM) {
  const AGENT_URL = SAM.H + ':9400/agent', ADDONS = SAM.H + ':9500';
  /* kind: ollama | openai (any OpenAI-compatible chat endpoint) | anthropic | gemini | azure | agent */
  const PROVIDERS = {
    ollama:      { label: 'LOCAL — OLLAMA',        kind: 'ollama',    url: SAM.H + ':11434',       model: 'llama3.1:8b', nokey: true, free: true, note: 'Run: OLLAMA_ORIGINS="*" ollama serve. Models list loads from the server.' },
    lmstudio:    { label: 'LOCAL — LM STUDIO',     kind: 'openai',    url: SAM.H + ':1234/v1',     model: '', nokey: true, free: true, note: 'Start the LM Studio server (Developer tab). Model box optional.' },
    llamacpp:    { label: 'LOCAL — LLAMA.CPP',     kind: 'openai',    url: SAM.H + ':8081/v1',     model: '', nokey: true, free: true, note: 'llama-server --port 8081. Model box optional.' },
    claudecode:  { label: 'CLAUDE CODE — HEADLESS (NO KEY)', kind: 'agent', agent: 'claude', nokey: true, note: 'Uses the Claude Code CLI signed in with your Claude plan: npm i -g @anthropic-ai/claude-code → claude auth login → AGENT service :9400. Searches the web and works on files in workspace/.' },
    geminicli:   { label: 'GEMINI CLI — HEADLESS (NO KEY)',  kind: 'agent', agent: 'gemini', nokey: true, note: 'Uses the Gemini CLI signed in with your Google account: npm i -g @google/gemini-cli → gemini → sign in → AGENT service :9400.' },
    openai:      { label: 'OPENAI — GPT',          kind: 'openai',    url: 'https://api.openai.com/v1',    model: 'gpt-4o-mini', json: true, models: true, note: 'Key from platform.openai.com/api-keys' },
    claude:      { label: 'ANTHROPIC — CLAUDE',    kind: 'anthropic', url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', models: true, note: 'Key from console.anthropic.com · e.g. claude-sonnet-5-5, claude-opus-5-5, claude-haiku-5-5' },
    gemini:      { label: 'GOOGLE — GEMINI',       kind: 'gemini',    url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash', free: true, models: true, note: 'Free key from aistudio.google.com/apikey · e.g. gemini-2.0-flash, gemini-2.5-pro' },
    openrouter:  { label: 'OPENROUTER — ANY MODEL', kind: 'openai',   url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', models: true, note: 'Key from openrouter.ai/keys · one key, hundreds of models (some free, suffix :free)' },
    groq:        { label: 'GROQ — FAST',           kind: 'openai',    url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', json: true, free: true, models: true, note: 'Free key from console.groq.com' },
    mistral:     { label: 'MISTRAL',               kind: 'openai',    url: 'https://api.mistral.ai/v1',    model: 'mistral-small-latest', json: true, models: true, note: 'Key from console.mistral.ai' },
    deepseek:    { label: 'DEEPSEEK',              kind: 'openai',    url: 'https://api.deepseek.com/v1',  model: 'deepseek-chat', json: true, models: true, note: 'Key from platform.deepseek.com' },
    xai:         { label: 'XAI — GROK',            kind: 'openai',    url: 'https://api.x.ai/v1',          model: 'grok-3-mini', json: true, models: true, note: 'Key from console.x.ai' },
    perplexity:  { label: 'PERPLEXITY — SEARCH',   kind: 'openai',    url: 'https://api.perplexity.ai',    model: 'sonar', note: 'Key from perplexity.ai/settings/api · answers include live web results' },
    together:    { label: 'TOGETHER AI',           kind: 'openai',    url: 'https://api.together.xyz/v1',  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', models: true, note: 'Key from api.together.ai' },
    huggingface: { label: 'HUGGING FACE',          kind: 'openai',    url: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', note: 'Token from huggingface.co/settings/tokens' },
    azure:       { label: 'AZURE OPENAI',          kind: 'azure',     url: 'https://YOUR-RESOURCE.openai.azure.com', model: 'your-deployment', note: 'URL = your resource endpoint · model = deployment name' },
    custom:      { label: 'CUSTOM — OPENAI-COMPATIBLE', kind: 'openai', url: '', model: '', models: true, note: 'Any server that speaks the OpenAI chat API: base URL ending in /v1, key if needed, model name.' },
  };
  const WIDGET_IDS = ['sys', 'cal', 'task', 'msg', 'tty', 'tmr', 'wx', 'mus', 'home', 'map', 'cam', 'pix'];
  const ACTION_SPEC = `Action types you may emit (use only when the user clearly wants it):
- open_app {arg: app name}, open_url {arg: url}, web_search {arg: terms}, play_music {arg: song or artist}, open_path {arg: folder or file}
- volume_up, volume_down, volume_set {arg: 0-100}, mute, media_play_pause, media_next, media_prev, brightness {arg: 5-100}, screenshot, lock, clipboard_set {arg: text}, type_text {arg: text}, hotkey {arg: e.g. copy, paste, save, new tab}
- sleep, shutdown, restart, kill_process {arg: name}, run_command {arg: name} (these ask the user to confirm)
- home_set {arg: "device on|off"} devices: lights, ac, lock, blinds, plug, fan
- timer_start {arg: minutes}, timer_stop, task_add {arg: text}, task_done {arg: text}
- video_play {arg: search words or title} (YouTube or the local library, shown in the HUD), video_pause, video_close, cinema, radio_play {arg: station or genre}, podcast_play {arg: show}, journal_add {arg: text}, focus_start {arg: minutes}
- push_phone {arg: text}, telegram_send {arg: text}, wake_machine {arg: name}, wifi {arg: on|off}, bluetooth {arg: on|off}, vpn {arg: on|off}, launch_game {arg: name}, cleanup (asks first), ssh_run {arg: 'machine: command'} (asks first)
- remember {arg: fact to store}, forget {arg: fact}
- research {arg: question needing live web data; a headless agent searches and reports back}, agent_task {arg: a file/code task for the headless agent in the workspace folder}
- shape {arg: sphere|galaxy|heart|knot|helix|cube|ring|wave|text:<WORD>}, layout {arg: full|ambient}, reboot, alert_demo
- schedule_add {arg: natural language like "every day at 8 am say good morning" or "in 20 minutes remind me to stretch"}, routine_run {arg: routine name}
- search_docs {arg: query over the user's documents folder}, send_email {arg: "to | subject | body"} (asks to confirm)
- look_at_screen {arg: question about what is on screen}, look_at_camera {arg: question about what the webcam sees}
- browse_open {arg: url}, browse_read, browse_click {arg: link or button text}, browse_type {arg: "field label | text"}, browse_find {arg: text}
- desktop_task {arg: a goal to accomplish with mouse and keyboard, step by step}`;

  /* Pulls the "reply" string out of a JSON object that is still streaming in. */
  function replySoFar(raw) {
    const t = raw.replace(/^\s*```(?:json)?\s*/, '');
    if (!/^\s*\{/.test(t)) return { text: t, done: false, json: false };
    const m = t.match(/"reply"\s*:\s*"/); if (!m) return { text: '', done: false, json: true };
    let i = m.index + m[0].length, out = '';
    while (i < t.length) {
      const c = t[i];
      if (c === '\\') { const n = t[i + 1]; if (n === undefined) break; if (n === 'n') out += '\n'; else if (n === 'u' && t.length >= i + 6) { out += String.fromCharCode(parseInt(t.slice(i + 2, i + 6), 16)); i += 4; } else if (n !== 't' && n !== 'r') out += n; i += 2; continue; }
      if (c === '"') return { text: out, done: true, json: true };
      out += c; i++;
    }
    return { text: out, done: false, json: true };
  }

  async function readStream(resp, onLine) {
    const reader = resp.body.getReader(), dec = new TextDecoder(); let buf = '';
    while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k; while ((k = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1); if (line) onLine(line); } }
    if (buf.trim()) onLine(buf.trim());
  }

  const brain = {
    PROVIDERS, WIDGET_IDS, replySoFar,
    cfg: { provider: 'ollama', keys: {}, models: {}, urls: {}, pool: { enabled: false, strategy: 'failover', order: [] }, roles: { chat: '', work: '', research: '', vision: '' }, sysAccess: true, actions: true, mood: 'balanced', humor: 5, memory: true, stream: true },
    extraActions: [],
    online: false, agentStatus: null, sessions: {}, history: [], facts: [], user: { name: 'Boss', node: 'LOCAL-01', label: '' },
    rr: 0, onLog: null, localModels: [], modelLists: {},
    log(c, m) { this.onLog && this.onLog(c, m); },
    P(id) { const p = PROVIDERS[id] || PROVIDERS.custom; return { ...p, id, url: (this.cfg.urls[id] || p.url || '').replace(/\/$/, ''), model: this.cfg.models[id] ?? p.model, key: this.cfg.keys[id] || '' }; },
    configured(id) { const p = this.P(id); return p.kind === 'agent' ? !!(this.agentStatus && this.agentStatus[p.agent] && this.agentStatus[p.agent].found) : (p.nokey || !!p.key); },

    /* ---------- prompt ---------- */
    MOODS: {
      professional: 'Tone: crisp, precise, professional. No jokes.',
      balanced: 'Tone: confident and composed like Jarvis from Iron Man, with the occasional light quip.',
      witty: 'Tone: playful and clever. Land a light joke or pun when it fits, but stay helpful.',
      deadpan: 'Tone: deadpan, understated, darkly funny. Deliver help with a straight face and dry irony.',
      sarcastic: 'Tone: dry and sarcastic like a snarky butler. Tease, but always actually help and never be mean.',
      hype: 'Tone: high-energy and enthusiastic.'
    },
    systemPrompt(snapshot) {
      const c = this.cfg, u = this.user;
      let p = `You are SAMURAI, a Jarvis-style voice assistant running on ${u.name}'s computer (node ${u.node}${u.label ? ', ' + u.label : ''}). Address the user as ${u.name}. `;
      p += (this.MOODS[c.mood] || this.MOODS.balanced) + ` Humor level ${c.humor}/10. Replies are spoken aloud: plain text, no markdown, no emojis, 1-3 short sentences unless asked for detail.\n\n`;
      p += `Respond with ONLY a JSON object, no prose around it, with "reply" as the FIRST key:\n{"reply": "<what to say>", "focus": <one of ${JSON.stringify(WIDGET_IDS)} or null>, "actions": [{"type": "<type>", "arg": "<arg>"}], "shape": <shape name or null>}\n`;
      p += `"focus" brings a HUD widget to the front: sys=system stats, cal=agenda, task=tasks, msg=inbox, tty=terminal, tmr=timers, wx=weather, mus=music, home=smart home, map=position, cam=camera, pix=gallery. Use it when the answer relates to one.\n`;
      p += c.actions ? ACTION_SPEC + (this.extraActions.length ? '\n- plugin tools: ' + this.extraActions.map(x => `${x.type} (${x.description})`).join('; ') : '') + '\n' : 'Actions are disabled by the user: always return "actions": [].\n';
      if (this.facts.length) p += `\nThings to remember about the user:\n- ${this.facts.join('\n- ')}\n`;
      if (snapshot) p += `\nLIVE DATA from the machine and widgets (use these exact numbers, never invent values):\n${snapshot}\n`;
      return p;
    },
    parse(text) {
      let t = (text || '').trim();
      const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1].trim();
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) { try { const o = JSON.parse(t.slice(a, b + 1)); if (o && typeof o === 'object' && ('reply' in o || 'actions' in o)) return { reply: String(o.reply || '').trim(), focus: WIDGET_IDS.includes(o.focus) ? o.focus : null, actions: Array.isArray(o.actions) ? o.actions.filter(x => x && x.type) : [], shape: o.shape || null }; } catch (e) { } }
      const r = replySoFar(t); return { reply: (r.json ? r.text : t).trim(), focus: null, actions: [], shape: null };
    },
    recent(n = 12) { return this.history.slice(-n).map(m => ({ role: m.role, content: m.content })); },

    /* ---------- one provider (streams when onDelta is given and the API supports it) ---------- */
    async callProvider(id, q, sys, signal, onDelta) {
      const p = this.P(id), msgs = [...this.recent(), { role: 'user', content: q }], stream = !!onDelta && this.cfg.stream;
      const hdr = { 'Content-Type': 'application/json' };
      let raw = ''; const push = s => { if (s) { raw += s; onDelta && onDelta(raw); } };
      const fail = async (r) => { let d = {}; try { d = await r.json(); } catch (e) { } throw new Error((d.error && (d.error.message || d.error)) || ('HTTP ' + r.status)); };
      if (p.kind === 'ollama') {
        const r = await fetch(p.url + '/api/chat', { method: 'POST', headers: hdr, signal, body: JSON.stringify({ model: p.model, messages: [{ role: 'system', content: sys }, ...msgs], stream, format: 'json' }) });
        if (!r.ok) await fail(r);
        if (!stream) { const d = await r.json(); if (d.error) throw new Error(d.error); return d.message && d.message.content; }
        await readStream(r, line => { try { const d = JSON.parse(line); if (d.error) throw new Error(d.error); push(d.message && d.message.content); } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; } });
        return raw;
      }
      if (p.kind === 'openai' || p.kind === 'azure') {
        let url = p.url + '/chat/completions';
        if (p.kind === 'azure') { url = `${p.url}/openai/deployments/${encodeURIComponent(p.model)}/chat/completions?api-version=2024-10-21`; hdr['api-key'] = p.key; }
        else if (p.key) hdr['Authorization'] = 'Bearer ' + p.key;
        if (id === 'openrouter') { hdr['HTTP-Referer'] = location.origin; hdr['X-Title'] = 'SAMURAI'; }
        const body = { model: p.model || undefined, messages: [{ role: 'system', content: sys }, ...msgs], max_tokens: 400, stream };
        if (p.json) body.response_format = { type: 'json_object' };
        const r = await fetch(url, { method: 'POST', headers: hdr, signal, body: JSON.stringify(body) });
        if (!r.ok) await fail(r);
        if (!stream) { const d = await r.json(); if (d.error) throw new Error(d.error.message || JSON.stringify(d.error)); return d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content; }
        await readStream(r, line => { if (!line.startsWith('data:')) return; const s = line.slice(5).trim(); if (s === '[DONE]') return; try { const d = JSON.parse(s); push(d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content); } catch (e) { } });
        return raw;
      }
      if (p.kind === 'anthropic') {
        const r = await fetch(p.url + '/messages', { method: 'POST', signal, headers: { ...hdr, 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: p.model, max_tokens: 500, system: sys, messages: msgs, stream }) });
        if (!r.ok) await fail(r);
        if (!stream) { const d = await r.json(); if (d.stop_reason === 'refusal') throw new Error('Claude declined that request'); const tb = (d.content || []).find(b => b.type === 'text'); return tb && tb.text; }
        let refusal = false;
        await readStream(r, line => { if (!line.startsWith('data:')) return; try { const d = JSON.parse(line.slice(5)); if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') push(d.delta.text); if (d.type === 'message_delta' && d.delta && d.delta.stop_reason === 'refusal') refusal = true; if (d.type === 'error') throw new Error(d.error && d.error.message); } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; } });
        if (refusal && !raw) throw new Error('Claude declined that request');
        return raw;
      }
      if (p.kind === 'gemini') {
        const contents = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const body = JSON.stringify({ contents, systemInstruction: { parts: [{ text: sys }] }, generationConfig: { maxOutputTokens: 800, responseMimeType: 'application/json' } });
        const r = await fetch(`${p.url}/models/${encodeURIComponent(p.model)}:${stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${encodeURIComponent(p.key)}`, { method: 'POST', headers: hdr, signal, body });
        if (!r.ok) await fail(r);
        const text = d => { const c = d.candidates && d.candidates[0]; return (c && c.content && c.content.parts || []).map(x => x.text || '').join(''); };
        if (!stream) { const d = await r.json(); if (d.error) throw new Error(d.error.message); if (!d.candidates) throw new Error(d.promptFeedback ? 'blocked' : 'no candidates'); return text(d); }
        await readStream(r, line => { if (!line.startsWith('data:')) return; try { push(text(JSON.parse(line.slice(5)))); } catch (e) { } });
        return raw;
      }
      if (p.kind === 'agent') {
        const mode = this.agentMode(q);
        return await this.agentRun(p.agent, (sys.includes('LIVE DATA') ? sys.slice(sys.indexOf('LIVE DATA')) + '\n\n' : '') + `Reply in the JSON format: {"reply": "...", "focus": null, "actions": [], "shape": null}. ` + q, mode, this.recent(6), p.model);
      }
      throw new Error('unknown provider kind');
    },

    /* ---------- pool: failover / round-robin / compare ---------- */
    taskType(q) { if (/\b(search|look ?up|latest|news|current|today'?s?|right now|price of|who won|what happened|find out|research|headlines)\b/i.test(q)) return 'research'; if (/\b(write|code|script|refactor|fix|build|create a file|analy[sz]e|summari[sz]e|translate|draft|essay|plan)\b/i.test(q)) return 'work'; return 'chat'; },
    order(q) {
      const pool = this.cfg.pool, roles = this.cfg.roles || {};
      let ids = pool.enabled && pool.order.length ? pool.order.filter(id => PROVIDERS[id]) : [this.cfg.provider];
      const role = q ? roles[this.taskType(q)] : ''; if (role && PROVIDERS[role] && this.configured(role)) ids = [role, ...ids.filter(x => x !== role)];
      ids = ids.filter(id => this.configured(id));
      if (!ids.length) ids = [this.cfg.provider];
      if (pool.enabled && pool.strategy === 'roundrobin' && ids.length > 1) { const k = this.rr++ % ids.length; ids = [...ids.slice(k), ...ids.slice(0, k)]; }
      return ids;
    },
    /* onDelta(replyText, done) receives the spoken reply as it streams in */
    async recall(q) {
      if (!this.cfg.memory) return '';
      try { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 1500); const d = await (await fetch(`${ADDONS}/memory/search?q=${encodeURIComponent(q)}&k=4`, { signal: ctl.signal })).json(); const hits = (d.hits || []).filter(h => !this.history.some(m => m.content === h.content)); return hits.length ? '\nRelated things from earlier conversations (oldest first):\n' + hits.reverse().map(h => `- [${new Date(h.t * 1000).toLocaleDateString()}] ${h.role}: ${h.content}`).join('\n') + '\n' : ''; } catch (e) { return ''; }
    },
    async ask(q, snapshot, onDelta) {
      const sys = this.systemPrompt(snapshot) + await this.recall(q), ids = this.order(q), errors = [];
      for (const id of ids) {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), PROVIDERS[id].kind === 'agent' ? 620000 : 60000);
        let streamed = '';
        try {
          const raw = await this.callProvider(id, q, sys, ctl.signal, onDelta ? r => { const s = replySoFar(r); if (s.text.length > streamed.length) { streamed = s.text; onDelta(s.text, s.done); } } : null);
          clearTimeout(to);
          if (!raw || !String(raw).trim()) throw new Error('empty reply');
          this.lastRaw = String(raw); const out = this.parse(raw); out.provider = id;
          if (!out.reply) throw new Error('no reply text');
          this.remember(q, out.reply);
          return out;
        } catch (e) {
          clearTimeout(to);
          const msg = (e && e.message) || String(e);
          errors.push(`${id}: ${msg.slice(0, 80)}`); this.log('warn', `${id} failed · ${msg.slice(0, 60)}`);
          if (streamed) throw new Error(errors.join(' | '));            // already spoke part of it: do not restart on another provider
        }
      }
      throw new Error(errors.join(' | ') || 'no provider');
    },
    /* ---------- vision: one image + a question, plain-text answer ---------- */
    visionProviders() { return Object.keys(PROVIDERS).filter(id => ['openai', 'anthropic', 'gemini', 'ollama'].includes(PROVIDERS[id].kind) && this.configured(id)); },
    async askVision(question, b64, mime) {
      const roles = this.cfg.roles || {}, ids = [roles.vision, this.cfg.provider, ...this.visionProviders()].filter((x, i, a) => x && PROVIDERS[x] && this.configured(x) && ['openai', 'anthropic', 'gemini', 'ollama'].includes(PROVIDERS[x].kind) && a.indexOf(x) === i);
      if (!ids.length) throw new Error('no vision-capable provider configured (OpenAI, Claude, Gemini or an Ollama vision model)');
      const sys = `You are SAMURAI, a voice assistant. Describe or answer about the image in 1-3 spoken sentences, plain text, no markdown.`;
      let lastErr;
      for (const id of ids) {
        const p = this.P(id), hdr = { 'Content-Type': 'application/json' }, ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 60000);
        try {
          if (p.kind === 'openai') {
            if (p.key) hdr['Authorization'] = 'Bearer ' + p.key;
            const r = await fetch(p.url + '/chat/completions', { method: 'POST', headers: hdr, signal: ctl.signal, body: JSON.stringify({ model: p.model, max_tokens: 300, messages: [{ role: 'system', content: sys }, { role: 'user', content: [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }] }) });
            const d = await r.json(); if (d.error) throw new Error(d.error.message || 'vision failed'); return d.choices[0].message.content.trim();
          }
          if (p.kind === 'anthropic') {
            const r = await fetch(p.url + '/messages', { method: 'POST', signal: ctl.signal, headers: { ...hdr, 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: p.model, max_tokens: 400, system: sys, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: question }] }] }) });
            const d = await r.json(); if (d.error) throw new Error(d.error.message); const tb = (d.content || []).find(b => b.type === 'text'); return (tb && tb.text || '').trim();
          }
          if (p.kind === 'gemini') {
            const r = await fetch(`${p.url}/models/${encodeURIComponent(p.model)}:generateContent?key=${encodeURIComponent(p.key)}`, { method: 'POST', headers: hdr, signal: ctl.signal, body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: question }] }] }) });
            const d = await r.json(); if (d.error) throw new Error(d.error.message); return ((d.candidates || [])[0]?.content?.parts || []).map(x => x.text || '').join('').trim();
          }
          if (p.kind === 'ollama') {
            const r = await fetch(p.url + '/api/chat', { method: 'POST', headers: hdr, signal: ctl.signal, body: JSON.stringify({ model: p.model, stream: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: question, images: [b64] }] }) });
            const d = await r.json(); if (d.error) throw new Error(d.error); return (d.message && d.message.content || '').trim();
          }
        } catch (e) { lastErr = e; this.log('warn', `vision ${id} · ${String(e.message).slice(0, 60)}`); } finally { clearTimeout(to); }
      }
      throw lastErr || new Error('vision failed');
    },
    async askMany(q, ids, snapshot) {
      const sys = this.systemPrompt(snapshot);
      return Promise.all(ids.map(async id => { const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 60000); try { const raw = await this.callProvider(id, q, sys, ctl.signal); return { id, reply: this.parse(raw).reply }; } catch (e) { return { id, error: (e.message || '').slice(0, 60) }; } finally { clearTimeout(to); } }));
    },
    remember(q, a) {
      this.history.push({ role: 'user', content: q }, { role: 'assistant', content: a });
      if (this.history.length > 40) this.history = this.history.slice(-40);
      if (this.cfg.memory) { for (const [role, content] of [['user', q], ['assistant', a]]) fetch(ADDONS + '/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'append', role, text: content }) }).catch(() => { }); }
    },
    async loadMemory() {
      try { const d = await (await fetch(ADDONS + '/memory?history=12')).json(); this.facts = d.facts || []; this.history = (d.history || []).map(h => ({ role: h.role, content: h.content })); this.log('ok', `memory · ${this.facts.length} facts · ${d.count || 0} turns`); } catch (e) { }
    },
    async fact(action, text) { try { const d = await (await fetch(ADDONS + '/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, text }) })).json(); this.facts = d.facts || this.facts; return true; } catch (e) { return false; } },

    /* ---------- status + live model lists ---------- */
    async ping() {
      const p = this.P(this.cfg.provider), timeout = ms => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
      try {
        if (p.kind === 'agent') { const st = await this.agentPing(); this.online = !!(st && st[p.agent] && st[p.agent].found); this.localModels = []; }
        else if (p.kind === 'ollama') { const r = await fetch(p.url + '/api/tags', { signal: timeout(2500) }); this.online = r.ok; if (r.ok) { const d = await r.json(); this.localModels = (d.models || []).map(m => m.name); } }
        else if (p.kind === 'openai' && (p.nokey || (p.models && p.key)) && !this.modelLists[p.id + p.key]) {
          const r = await fetch(p.url + '/models', { signal: timeout(4000), headers: p.key ? { Authorization: 'Bearer ' + p.key } : {} });
          this.online = p.nokey ? r.ok : !!p.key;
          if (r.ok) { const d = await r.json(); this.localModels = (d.data || []).map(m => m.id).sort().slice(0, 300); if (p.key) this.modelLists[p.id + p.key] = this.localModels; }
        }
        else if (p.kind === 'anthropic' && p.key && !this.modelLists[p.id + p.key]) {
          const r = await fetch(p.url + '/models?limit=100', { signal: timeout(4000), headers: { 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
          this.online = true; if (r.ok) { const d = await r.json(); this.localModels = (d.data || []).map(m => m.id); this.modelLists[p.id + p.key] = this.localModels; }
        }
        else if (p.kind === 'gemini' && p.key && !this.modelLists[p.id + p.key]) {
          const r = await fetch(`${p.url}/models?key=${encodeURIComponent(p.key)}`, { signal: timeout(4000) });
          this.online = true; if (r.ok) { const d = await r.json(); this.localModels = (d.models || []).map(m => m.name.replace(/^models\//, '')).filter(n => /gemini/.test(n)); this.modelLists[p.id + p.key] = this.localModels; }
        }
        else { this.online = p.nokey || (!!p.key && !!(p.model || p.kind !== 'azure')); this.localModels = this.modelLists[p.id + p.key] || []; }
      } catch (e) { this.online = p.kind !== 'ollama' && !p.nokey ? !!p.key : false; }
      return this.online;
    },
    async agentPing() { try { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000); const r = await fetch(AGENT_URL + '/status', { signal: ctl.signal }); this.agentStatus = r.ok ? await r.json() : null; } catch (e) { this.agentStatus = null; } return this.agentStatus; },
    agentMode(q) {
      if (/\b(search|look ?up|latest|news|current|today'?s?|right now|price of|who won|what happened|find out|google|headlines|stock|score)\b/i.test(q)) return 'search';
      if (this.cfg.actions && /\b(create|write|edit|build|make a (file|script)|generate|fix|refactor|rename|convert|analy[sz]e|summari[sz]e|workspace|script|code|file|folder)\b/i.test(q)) return 'work';
      return 'chat';
    },
    async agentRun(agent, prompt, mode, history, model) {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), mode === 'chat' ? 130000 : 620000);
      try {
        if (SAM.hud && SAM.hud.ensureService) await SAM.hud.ensureService('agent');      // essentials profile: the agent sidecar starts on demand
        const r = await fetch(AGENT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ provider: agent, prompt, mode, session_id: this.sessions[agent] || null, model: model || '', history }) });
        const d = await r.json(); if (!d.ok) throw new Error(d.error || 'HTTP ' + r.status);
        if (d.session_id) this.sessions[agent] = d.session_id;
        this.log('ok', `${agent} ${mode} · ${d.seconds}s`); return d.text;
      } finally { clearTimeout(to); }
    },
    preferredAgent() { const s = this.agentStatus; return s && s.claude && s.claude.found ? 'claude' : (s && s.gemini && s.gemini.found ? 'gemini' : null); },
  };
  SAM.brain = brain;
})(window.SAM);
