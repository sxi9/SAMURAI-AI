/* Makes the labeled screenshots for docs/INSTALL.md against the running services (panel :9000, HUD :8080).
   node docs/install/shots.js   → docs/install/0N-*.png (1400 px wide). Toggles LAN mode on for one shot and off again. */
const { chromium } = require('playwright');
const OUT = __dirname;
const LABEL = `.lb{position:absolute;z-index:999999;display:flex;align-items:flex-start;gap:8px;pointer-events:none}
.lb i{width:30px;height:30px;border-radius:50%;background:#ffb547;color:#0a0f1a;font:bold 15px/30px 'IBM Plex Mono',monospace;text-align:center;flex:none;box-shadow:0 2px 10px rgba(0,0,0,.6)}
.lb b{background:rgba(5,6,13,.95);border:1px solid #ffb547;color:#ffe9c2;font:600 13px/1.35 Saira,Segoe UI,sans-serif;padding:6px 10px;border-radius:4px;max-width:380px;box-shadow:0 4px 18px rgba(0,0,0,.6)}
.lbox{position:absolute;z-index:999998;border:2px solid #ffb547;border-radius:4px;pointer-events:none;box-shadow:0 0 0 2px rgba(0,0,0,.5)}`;
async function label(page, items) {
  await page.evaluate(({ items, css }) => {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    items.forEach(([sel, n, text, pos]) => {
      const el = typeof sel === 'string' ? document.querySelector(sel) : null;
      const r = el ? el.getBoundingClientRect() : { x: sel[0], y: sel[1], width: sel[2], height: sel[3] };
      if (el) { const b = document.createElement('div'); b.className = 'lbox'; b.style.cssText = `left:${r.x + scrollX - 4}px;top:${r.y + scrollY - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`; document.body.appendChild(b); }
      const d = document.createElement('div'); d.className = 'lb'; d.innerHTML = `<i>${n}</i><b>${text}</b>`;
      let x = r.x + scrollX, y = r.y + scrollY + r.height + 10;
      if (pos === 'above') y = r.y + scrollY - 50; if (pos === 'right') { x = r.x + scrollX + r.width + 12; y = r.y + scrollY; } if (pos === 'inside') { x = r.x + scrollX + 12; y = r.y + scrollY + 12; }
      d.style.cssText = `left:${Math.max(8, x)}px;top:${Math.max(8, y)}px`; document.body.appendChild(d);
    });
  }, { items, css: LABEL });
}
const P = name => `${OUT}/${name}`;
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const J = (page, path, body) => page.evaluate(async ({ path, body }) => (await fetch('http://127.0.0.1:9000' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json(), { path, body });
  /* 1 — release page */
  const gh = await ctx.newPage(); let ghOk = false;
  try { await gh.goto('https://github.com/sxi9/SAMURAI-AI/releases/latest', { waitUntil: 'domcontentloaded', timeout: 40000 }); await gh.waitForTimeout(5000); ghOk = /SAMURAI/i.test(await gh.title()); } catch (e) { }
  if (ghOk) {
    await gh.evaluate(() => { const h = [...document.querySelectorAll('h3, h2, summary, span')].find(e => /^Assets/.test(e.textContent.trim())); if (h) h.scrollIntoView({ block: 'start' }); else window.scrollTo(0, document.body.scrollHeight); });
    await gh.waitForTimeout(4000);
    const found = await gh.evaluate(() => { const a = [...document.querySelectorAll('a')].find(a => /SAMURAI-windows-x64\.zip/.test(a.textContent)); if (!a) return false; a.id = '__asset'; a.scrollIntoView({ block: 'center' }); return true; });
    await gh.waitForTimeout(800);
    await label(gh, found ? [['#__asset', 1, 'Click SAMURAI-windows-x64.zip to download the Windows build (Linux: SAMURAI-linux-x64.tar.gz)', 'above']] : [[[40, 20, 300, 40], 1, 'Scroll to Assets and click SAMURAI-windows-x64.zip', 'inside']]);
    await gh.screenshot({ path: P('01-download.png') }); console.log('01 github', found ? 'asset labeled' : 'asset link not found');
  } else {
    await gh.setContent(`<html><body style="margin:0;background:#0d1117;color:#e6edf3;font:15px Segoe UI,sans-serif"><div style="padding:40px 60px"><div style="font-size:26px;font-weight:600">SAMURAI v1.3.0 <span style="font-size:12px;border:1px solid #3fb950;color:#3fb950;border-radius:12px;padding:2px 8px;margin-left:8px">Latest</span></div><div style="color:#8b949e;margin:6px 0 30px">github.com/sxi9/SAMURAI-AI/releases/latest</div><div style="border:1px solid #30363d;border-radius:8px;width:720px"><div style="padding:12px 16px;border-bottom:1px solid #30363d;font-weight:600">Assets</div>${['SAMURAI-windows-x64.zip  ·  34.6 MB', 'SAMURAI-linux-x64.tar.gz  ·  45.8 MB', 'walkthrough-ultimate.mp4  ·  54.6 MB'].map((a, i) => `<div id="a${i}" style="padding:10px 16px;border-bottom:1px solid #30363d;color:#58a6ff">${a}</div>`).join('')}</div></div></body></html>`);
    await label(gh, [['#a0', 1, 'Click SAMURAI-windows-x64.zip to download the Windows build', 'right'], ['#a1', 2, 'Linux: SAMURAI-linux-x64.tar.gz', 'right']]);
    await gh.screenshot({ path: P('01-download.png') }); console.log('01 mock (github not reachable from here)');
  }
  /* 2..5, 8 — control panel */
  const panel = await ctx.newPage(); await panel.goto('http://127.0.0.1:9000/', { waitUntil: 'load' }); await panel.waitForTimeout(7000);
  await panel.evaluate(() => document.getElementById('tuneProfile').scrollIntoView({ block: 'center' })); await panel.waitForTimeout(500);
  await label(panel, [['#tuneApply', 1, 'First start: AUTO-TUNE sizes the 3D core, voices and startup profile to your PC (it also runs by itself the first time)', 'above'], ['#svcProfile', 2, 'Startup profile: ESSENTIALS on small machines', 'below'], ['#tuneProfile', 3, 'Your hardware and what SAMURAI recommends', 'inside']]);
  await panel.screenshot({ path: P('02-panel-autotune.png') }); console.log('02');
  await panel.reload({ waitUntil: 'load' }); await panel.waitForTimeout(6000);
  await panel.evaluate(() => document.getElementById('claudeLogin').scrollIntoView({ block: 'center' })); await panel.waitForTimeout(400);
  await label(panel, [['#claudeLogin', 1, 'SIGN IN: opens the Claude login link and uses your claude.ai plan (no API key)', 'below'], ['#authTbl', 2, 'Shows whether Claude Code / Gemini CLI are installed and signed in', 'above']]);
  await panel.screenshot({ path: P('03-claude-signin.png') }); console.log('03');
  await panel.reload({ waitUntil: 'load' }); await panel.waitForTimeout(6000);
  await panel.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(h => /PREMIUM VOICES/.test(h.textContent)); if (h) { h.parentElement.id = '__voices'; h.parentElement.scrollIntoView({ block: 'center' }); } });
  await panel.waitForTimeout(400);
  await label(panel, [['#__voices', 1, 'Optional: paste an ElevenLabs / OpenAI / Cartesia / Azure key for a more natural voice. The Edge voices (Ava, Emma) are free and need no key', 'above']]);
  await panel.screenshot({ path: P('04-voices.png') }); console.log('04');

  await panel.reload({ waitUntil: 'load' }); await panel.waitForTimeout(6000);
  await panel.click('#doctor'); await panel.waitForTimeout(14000);
  await panel.evaluate(() => document.getElementById('doctor').scrollIntoView({ block: 'start' })); await panel.evaluate(() => window.scrollBy(0, -40)); await panel.waitForTimeout(400);
  await label(panel, [['#doctor', 1, 'RUN CHECKS: Python, packages, voice model, ports, disk, memory, GPU', 'above'], ['#doctorFix', 2, 'CHECK + AUTO-FIX repairs what it can', 'below'], ['#checks', 3, 'A red line tells you exactly what to fix', 'inside']]);
  await panel.screenshot({ path: P('08-doctor.png') }); console.log('08');
  /* 6, 7 — HUD */
  const hud = await ctx.newPage(); await hud.setViewportSize({ width: 1400, height: 788 });
  await hud.addInitScript(() => localStorage.setItem('samurai.hud3', JSON.stringify({ brain: { provider: 'lmstudio', keys: {}, models: {}, urls: {}, pool: { enabled: false, strategy: 'failover', order: [] }, roles: {}, sysAccess: true, actions: true, mood: 'balanced', humor: 5, memory: true, stream: true }, voice: { voiceOn: false, wake: false }, ui: { theme: 'arc', layout: 'focus', idleMorph: false, wander: false, gl: 'on', glQuality: 'low', fx: true } })));
  await hud.goto('http://127.0.0.1:8080/jarvis-interface.html', { waitUntil: 'domcontentloaded' }); await hud.waitForTimeout(9000);
  await hud.evaluate(() => SAM.hud.submit("what's the weather")); await hud.waitForTimeout(5000);
  await label(hud, [['#cmd', 1, 'Type a command here, or click MIC and say "samurai, what\'s the weather"', 'above'], ['#micBtn', 2, 'MIC: voice on (allow the microphone once)', 'below'], ['#cfgBtn', 3, 'CFG: settings', 'below'], ['.reply', 4, 'The reply is typed and spoken', 'above']]);
  await hud.screenshot({ path: P('06-hud-first-command.png') }); console.log('06');
  await hud.reload({ waitUntil: 'domcontentloaded' }); await hud.waitForTimeout(8000);
  await hud.evaluate(() => SAM.hud.toggleDrawer(true)); await hud.waitForTimeout(1500);
  await hud.evaluate(() => { const p = document.querySelector('#drawer select'); if (p) p.id = '__prov'; });
  await label(hud, [['#__prov', 1, 'NEURAL CORE: pick your brain (Claude Code needs no key, or paste an API key)', 'right'], ['#optVoice', 2, 'VOICE: choose a voice, TEST VOICE plays a sample', 'right'], ['#tuneNote', 3, 'AUTO-TUNE summary for this PC; the 3D CORE quality is just below', 'right']]);
  await hud.screenshot({ path: P('07-hud-settings.jpg'), type: 'jpeg', quality: 85 }); console.log('07');
  await J(panel, '/panel/lan', { on: true }); await panel.waitForTimeout(28000);
  await panel.reload({ waitUntil: 'load' }); await panel.waitForTimeout(7000);
  await panel.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(h => /PHONE/.test(h.textContent)); if (h) { h.parentElement.id = '__phone'; h.parentElement.scrollIntoView({ block: 'center' }); } });
  await panel.waitForTimeout(400);
  await label(panel, [['#swLan2', 1, 'Switch PHONE / LAN ACCESS on', 'below'], ['#phoneQr', 2, 'Scan the QR code with your phone on the same Wi-Fi. Turn HTTPS on for the phone microphone', 'right'], ['#__phone', 3, 'Companion mode: the phone listens, the PC runs the command', 'above']]);
  await panel.screenshot({ path: P('05-phone.png') }); console.log('05');
  await J(panel, '/panel/lan', { on: false }); await panel.waitForTimeout(28000);
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
