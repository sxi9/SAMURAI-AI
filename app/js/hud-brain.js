/* SAMURAI HUD v3 — brain: many AI providers behind one call, JSON reply contract, provider pool
   (failover / round-robin / compare), headless agents (:9400), memory (:9500). Exposes window.SAM.brain. */
window.SAM = window.SAM || {};
(function (SAM) {
  const AGENT_URL = 'http://localhost:9400/agent', ADDONS = 'http://localhost:9500';
  /* kind: ollama | openai (any OpenAI-compatible chat endpoint) | anthropic | gemini | azure | agent */
  const PROVIDERS = {
    ollama:      { label: 'LOCAL — OLLAMA',        kind: 'ollama',    url: 'http://localhost:11434',       model: 'llama3.1:8b', nokey: true, free: true, note: 'Run: OLLAMA_ORIGINS="*" ollama serve. Models list loads from the server.' },
    lmstudio:    { label: 'LOCAL — LM STUDIO',     kind: 'openai',    url: 'http://localhost:1234/v1',     model: '', nokey: true, free: true, note: 'Start the LM Studio server (Developer tab). Model box optional.' },
    llamacpp:    { label: 'LOCAL — LLAMA.CPP',     kind: 'openai',    url: 'http://localhost:8081/v1',     model: '', nokey: true, free: true, note: 'llama-server --port 8081. Model box optional.' },
    claudecode:  { label: 'CLAUDE CODE — HEADLESS (NO KEY)', kind: 'agent', agent: 'claude', nokey: true, note: 'Uses the Claude Code CLI signed in with your Claude plan: npm i -g @anthropic-ai/claude-code → claude auth login → AGENT service :9400. Searches the web and works on files in workspace/.' },
    geminicli:   { label: 'GEMINI CLI — HEADLESS (NO KEY)',  kind: 'agent', agent: 'gemini', nokey: true, note: 'Uses the Gemini CLI signed in with your Google account: npm i -g @google/gemini-cli → gemini → sign in → AGENT service :9400.' },
    openai:      { label: 'OPENAI — GPT',          kind: 'openai',    url: 'https://api.openai.com/v1',    model: 'gpt-4o-mini', json: true, note: 'Key from platform.openai.com/api-keys' },
    claude:      { label: 'ANTHROPIC — CLAUDE',    kind: 'anthropic', url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', note: 'Key from console.anthropic.com · e.g. claude-sonnet-5-5, claude-opus-5-5, claude-haiku-5-5' },
    gemini:      { label: 'GOOGLE — GEMINI',       kind: 'gemini',    url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash', free: true, note: 'Free key from aistudio.google.com/apikey · e.g. gemini-2.0-flash, gemini-2.5-pro' },
    openrouter:  { label: 'OPENROUTER — ANY MODEL', kind: 'openai',   url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', note: 'Key from openrouter.ai/keys · one key, hundreds of models (some free, suffix :free)' },
    groq:        { label: 'GROQ — FAST',           kind: 'openai',    url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', json: true, free: true, note: 'Free key from console.groq.com' },
    mistral:     { label: 'MISTRAL',               kind: 'openai',    url: 'https://api.mistral.ai/v1',    model: 'mistral-small-latest', json: true, note: 'Key from console.mistral.ai' },
    deepseek:    { label: 'DEEPSEEK',              kind: 'openai',    url: 'https://api.deepseek.com/v1',  model: 'deepseek-chat', json: true, note: 'Key from platform.deepseek.com' },
    xai:         { label: 'XAI — GROK',            kind: 'openai',    url: 'https://api.x.ai/v1',          model: 'grok-3-mini', json: true, note: 'Key from console.x.ai' },
    perplexity:  { label: 'PERPLEXITY — SEARCH',   kind: 'openai',    url: 'https://api.perplexity.ai',    model: 'sonar', note: 'Key from perplexity.ai/settings/api · answers include live web results' },
    together:    { label: 'TOGETHER AI',           kind: 'openai',    url: 'https://api.together.xyz/v1',  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', note: 'Key from api.together.ai' },
    huggingface: { label: 'HUGGING FACE',          kind: 'openai',    url: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', note: 'Token from huggingface.co/settings/tokens' },
    azure:       { label: 'AZURE OPENAI',          kind: 'azure',     url: 'https://YOUR-RESOURCE.openai.azure.com', model: 'your-deployment', note: 'URL = your resource endpoint · model = deployment name' },
    custom:      { label: 'CUSTOM — OPENAI-COMPATIBLE', kind: 'openai', url: '', model: '', note: 'Any server that speaks the OpenAI chat API: base URL ending in /v1, key if needed, model name.' },
  };
  const WIDGET_IDS = ['sys', 'cal', 'task', 'msg', 'tty', 'tmr', 'wx', 'mus', 'home', 'map', 'cam', 'pix'];
  const ACTION_SPEC = `Action types you may emit (use only when the user clearly wants it):
- open_app {arg: app name}, open_url {arg: url}, web_search {arg: terms}, play_music {arg: song or artist}, open_path {arg: folder or file}
- volume_up, volume_down, volume_set {arg: 0-100}, mute, media_play_pause, media_next, media_prev, brightness {arg: 5-100}, screenshot, lock, clipboard_set {arg: text}, type_text {arg: text}, hotkey {arg: e.g. copy, paste, save, new tab}
- sleep, shutdown, restart, kill_process {arg: name}, run_command {arg: name} (these ask the user to confirm)
- home_set {arg: "device on|off"} devices: lights, ac, lock, blinds, plug, fan
- timer_start {arg: minutes}, timer_stop, task_add {arg: text}, task_done {arg: text}
- remember {arg: fact to store}, forget {arg: fact}
- research {arg: question needing live web data; a headless agent searches and reports back}, agent_task {arg: a file/code task for the headless agent in the workspace folder}
- shape {arg: sphere|galaxy|heart|knot|helix|cube|ring|wave|text:<WORD>}, layout {arg: full|ambient}, reboot, alert_demo`;

  const brain = {
    PROVIDERS, WIDGET_IDS,
    cfg: { provider: 'ollama', keys: {}, models: {}, urls: {}, pool: { enabled: false, strategy: 'failover', order: [] }, sysAccess: true, actions: true, mood: 'balanced', humor: 5, memory: true },
    online: false, agentStatus: null, sessions: {}, history: [], facts: [], user: { name: 'Boss', node: 'LOCAL-01', label: '' },
    rr: 0, onLog: null, snapshot: null,
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
      p += `Respond with ONLY a JSON object, no prose around it:\n{"reply": "<what to say>", "focus": <one of ${JSON.stringify(WIDGET_IDS)} or null>, "actions": [{"type": "<type>", "arg": "<arg>"}], "shape": <shape name or null>}\n`;
      p += `"focus" brings a HUD widget to the front: sys=system stats, cal=agenda, task=tasks, msg=inbox, tty=terminal, tmr=timers, wx=weather, mus=music, home=smart home, map=position, cam=camera, pix=gallery. Use it when the answer relates to one.\n`;
      p += c.actions ? ACTION_SPEC + '\n' : 'Actions are disabled by the user: always return "actions": [].\n';
      if (this.facts.length) p += `\nThings to remember about the user:\n- ${this.facts.join('\n- ')}\n`;
      if (snapshot) p += `\nLIVE DATA from the machine and widgets (use these exact numbers, never invent values):\n${snapshot}\n`;
      return p;
    },
    parse(text) {
      let t = (text || '').trim();
      const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1].trim();
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) { try { const o = JSON.parse(t.slice(a, b + 1)); if (o && typeof o === 'object' && ('reply' in o || 'actions' in o)) return { reply: String(o.reply || '').trim(), focus: WIDGET_IDS.includes(o.focus) ? o.focus : null, actions: Array.isArray(o.actions) ? o.actions.filter(x => x && x.type) : [], shape: o.shape || null }; } catch (e) { } }
      return { reply: t.replace(/^\{.*"reply"\s*:\s*"/s, '').replace(/"\s*,\s*"focus.*$/s, ''), focus: null, actions: [], shape: null };
    },
    recent(n = 12) { return this.history.slice(-n).map(m => ({ role: m.role, content: m.content })); },

    /* ---------- one provider ---------- */
    async callProvider(id, q, sys, signal) {
      const p = this.P(id), msgs = [...this.recent(), { role: 'user', content: q }];
      const hdr = { 'Content-Type': 'application/json' };
      if (p.kind === 'ollama') {
        const r = await fetch(p.url + '/api/chat', { method: 'POST', headers: hdr, signal, body: JSON.stringify({ model: p.model, messages: [{ role: 'system', content: sys }, ...msgs], stream: false, format: 'json' }) });
        const d = await r.json(); if (d.error) throw new Error(d.error); return d.message && d.message.content;
      }
      if (p.kind === 'openai' || p.kind === 'azure') {
        let url = p.url + '/chat/completions';
        if (p.kind === 'azure') { url = `${p.url}/openai/deployments/${encodeURIComponent(p.model)}/chat/completions?api-version=2024-10-21`; hdr['api-key'] = p.key; }
        else if (p.key) hdr['Authorization'] = 'Bearer ' + p.key;
        if (id === 'openrouter') { hdr['HTTP-Referer'] = location.origin; hdr['X-Title'] = 'SAMURAI'; }
        const body = { model: p.model || undefined, messages: [{ role: 'system', content: sys }, ...msgs], max_tokens: 400 };
        if (p.json) body.response_format = { type: 'json_object' };
        const r = await fetch(url, { method: 'POST', headers: hdr, signal, body: JSON.stringify(body) });
        const d = await r.json(); if (d.error) throw new Error(d.error.message || JSON.stringify(d.error)); if (!r.ok) throw new Error('HTTP ' + r.status);
        return d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      }
      if (p.kind === 'anthropic') {
        const r = await fetch(p.url + '/messages', { method: 'POST', signal, headers: { ...hdr, 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: p.model, max_tokens: 500, system: sys, messages: msgs }) });
        const d = await r.json(); if (d.error) throw new Error(d.error.message);
        if (d.stop_reason === 'refusal') throw new Error('Claude declined that request');
        const tb = (d.content || []).find(b => b.type === 'text'); return tb && tb.text;
      }
      if (p.kind === 'gemini') {
        const contents = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const r = await fetch(`${p.url}/models/${encodeURIComponent(p.model)}:generateContent?key=${encodeURIComponent(p.key)}`, { method: 'POST', headers: hdr, signal, body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: sys }] }, generationConfig: { maxOutputTokens: 800, responseMimeType: 'application/json' } }) });
        const d = await r.json(); if (d.error) throw new Error(d.error.message || 'HTTP ' + r.status);
        const cand = d.candidates && d.candidates[0]; if (!cand) throw new Error(d.promptFeedback ? 'blocked' : 'no candidates');
        return (cand.content && cand.content.parts || []).map(x => x.text || '').join('');
      }
      if (p.kind === 'agent') {
        const mode = this.agentMode(q);
        const text = await this.agentRun(p.agent, (sys.includes('LIVE DATA') ? sys.slice(sys.indexOf('LIVE DATA')) + '\n\n' : '') + `Reply in the JSON format: {"reply": "...", "focus": null, "actions": [], "shape": null}. ` + q, mode, this.recent(6), p.model);
        return text;
      }
      throw new Error('unknown provider kind');
    },

    /* ---------- pool: failover / round-robin / compare ---------- */
    order() {
      const pool = this.cfg.pool;
      let ids = pool.enabled && pool.order.length ? pool.order.filter(id => PROVIDERS[id]) : [this.cfg.provider];
      ids = ids.filter(id => this.configured(id));
      if (!ids.length) ids = [this.cfg.provider];
      if (pool.enabled && pool.strategy === 'roundrobin' && ids.length > 1) { const k = this.rr++ % ids.length; ids = [...ids.slice(k), ...ids.slice(0, k)]; }
      return ids;
    },
    async ask(q, snapshot) {
      const sys = this.systemPrompt(snapshot), ids = this.order(), errors = [];
      for (const id of ids) {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), PROVIDERS[id].kind === 'agent' ? 620000 : 45000);
        try {
          const raw = await this.callProvider(id, q, sys, ctl.signal);
          clearTimeout(to);
          if (!raw || !String(raw).trim()) throw new Error('empty reply');
          const out = this.parse(raw); out.provider = id;
          if (!out.reply) throw new Error('no reply text');
          this.remember(q, out.reply);
          return out;
        } catch (e) {
          clearTimeout(to);
          const msg = (e && e.message) || String(e);
          errors.push(`${id}: ${msg.slice(0, 80)}`); this.log('warn', `${id} failed · ${msg.slice(0, 60)}`);
        }
      }
      throw new Error(errors.join(' | ') || 'no provider');
    },
    async askMany(q, ids, snapshot) {
      const sys = this.systemPrompt(snapshot);
      const results = await Promise.all(ids.map(async id => { const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 60000); try { const raw = await this.callProvider(id, q, sys, ctl.signal); return { id, reply: this.parse(raw).reply }; } catch (e) { return { id, error: (e.message || '').slice(0, 60) }; } finally { clearTimeout(to); } }));
      return results;
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

    /* ---------- status ---------- */
    async ping() {
      const p = this.P(this.cfg.provider);
      try {
        if (p.kind === 'agent') { const st = await this.agentPing(); this.online = !!(st && st[p.agent] && st[p.agent].found); }
        else if (p.kind === 'ollama') { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2500); const r = await fetch(p.url + '/api/tags', { signal: ctl.signal }); this.online = r.ok; if (r.ok) { const d = await r.json(); this.localModels = (d.models || []).map(m => m.name); } }
        else if (p.nokey && p.kind === 'openai') { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2500); const r = await fetch(p.url + '/models', { signal: ctl.signal }); this.online = r.ok; if (r.ok) { const d = await r.json(); this.localModels = (d.data || []).map(m => m.id); } }
        else this.online = !!p.key && !!(p.model || p.kind !== 'azure');
      } catch (e) { this.online = false; }
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
