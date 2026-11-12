/* Faces screenshots (Playwright, node). Serves app/ on a free port with python's http.server (no sidecars needed: the
   HUD runs offline), opens the HUD with the 2D core (?gl=off&skipboot=1) and with the 3D core (swiftshader), switches
   the avatar to the robot face and to the VRM avatar, sets emotions through SAM.face.set and saves screenshots.
   Run:  node tests/face_shots.js <output folder>            (about two minutes on a loaded machine)
   Needs: node with playwright (npm i playwright) and its chromium; python3. */
const { chromium } = require('playwright'); const { spawn } = require('child_process'); const net = require('net'); const path = require('path'); const fs = require('fs');
const APP = path.join(__dirname, '..', 'app'), OUT = path.resolve(process.argv[2] || path.join(__dirname, 'face-shots')); fs.mkdirSync(OUT, { recursive: true });
const GPU = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const freePort = () => new Promise(r => { const sv = net.createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => r(p)); }); });
const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'thinking'];
let fails = 0; const check = (ok, what) => { log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };

async function open(browser, port, gl) {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(String(e.message).slice(0, 160)));
  await page.goto(`http://127.0.0.1:${port}/jarvis-interface.html?gl=${gl}&skipboot=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.SAM && SAM.hud && SAM.face && SAM.hud.S.mode === 'idle', null, { timeout: 60000, polling: 300 });
  return page;
}
const shot = async (page, name) => { const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f, timeout: 180000 }); log('shot', f); return f; };
const state = page => page.evaluate(() => ({ eff: SAM.face.effective(), shown: SAM.face.shown, bot: !!SAM.face.bot, botW: document.getElementById('botFace').width, cls: document.getElementById('stage').className, gl: !!(SAM.gl && SAM.gl.on), vrm: !!(SAM.gl && SAM.gl.vrm), orbVis: !!(SAM.gl && SAM.gl.on && SAM.gl.orb && SAM.gl.orb.visible), lvl: SAM.face.lvl }));

(async () => {
  const PORT = await freePort();
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', APP], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ args: [...GPU, '--autoplay-policy=no-user-gesture-required'] });
  try {
    /* ---- 2D core: the robot face on its own canvas over the orb ---- */
    let page = await open(browser, PORT, 'off'); log('2D hud idle');
    await page.evaluate(() => { SAM.hud.S.avatar = 'bot'; SAM.hud.applyLayout(); });
    await page.waitForFunction(() => SAM.face.bot && document.getElementById('botFace').width > 100, null, { timeout: 60000, polling: 300 });
    await page.waitForTimeout(900);
    let s = await state(page); check(s.eff === 'bot' && s.bot && /\bbot\b/.test(s.cls) && s.botW > 400 && s.botW < 2000, `2D · robot face on, canvas ${s.botW}px wide, stage class bot`);
    await shot(page, '2d-bot-neutral');
    for (const e of EMOTIONS) { await page.evaluate(e => SAM.face.set(e, 30000), e); await page.waitForTimeout(800); s = await state(page); check(s.shown === e, `2D · emotion ${e}`); await shot(page, '2d-bot-' + e); }
    await page.evaluate(() => { SAM.face.set('neutral', 30000); SAM.hud.setMode('speaking'); });
    await page.waitForTimeout(900); s = await state(page); check(s.lvl > 0.05, `2D · lip-sync level while speaking (${s.lvl.toFixed(2)})`); await shot(page, '2d-bot-speaking');
    await page.evaluate(() => { SAM.hud.setMode('idle'); SAM.face.style('visor'); }); await page.waitForTimeout(600); await shot(page, '2d-bot-visor');
    await page.evaluate(() => { SAM.face.style('soft'); SAM.hud.S.avatar = 'vrm'; SAM.hud.applyLayout(); }); await page.waitForTimeout(400);
    s = await state(page); check(s.eff === 'bot', '2D · VRM avatar falls back to the robot face without the 3D core');
    check(page.errors.length === 0, '2D · no page errors' + (page.errors.length ? ' · ' + page.errors[0] : ''));
    await page.context().close();

    /* ---- 3D core: robot face over the hidden 3D orb, then the VRM avatar inside the scene ---- */
    page = await open(browser, PORT, 'on'); log('3D hud idle');
    await page.waitForFunction(() => SAM.gl && SAM.gl.on, null, { timeout: 60000, polling: 300 });
    await page.evaluate(() => { SAM.hud.S.avatar = 'bot'; SAM.hud.applyLayout(); });
    await page.waitForFunction(() => SAM.face.bot && document.getElementById('botFace').width > 100, null, { timeout: 60000, polling: 300 });
    await page.waitForTimeout(900); s = await state(page); check(s.gl && s.eff === 'bot' && !s.orbVis, '3D · robot face on, 3D orb hidden'); await shot(page, '3d-bot-neutral');
    await page.evaluate(() => SAM.face.set('happy', 30000)); await page.waitForTimeout(800); await shot(page, '3d-bot-happy');
    await page.evaluate(() => { SAM.hud.S.avatar = 'vrm'; SAM.hud.applyLayout(); });
    await page.waitForFunction(() => SAM.gl && SAM.gl.vrm, null, { timeout: 180000, polling: 500 });
    await page.waitForTimeout(1500); s = await state(page); check(s.vrm && s.eff === 'vrm' && /\bvrm\b/.test(s.cls), '3D · VRM avatar loaded, stage class vrm');
    await shot(page, '3d-vrm-neutral');
    for (const e of EMOTIONS) { await page.evaluate(e => SAM.face.set(e, 30000), e); await page.waitForTimeout(900); s = await state(page); check(s.shown === e, `3D · VRM emotion ${e}`); await shot(page, '3d-vrm-' + e); }
    await page.evaluate(() => { SAM.face.set('neutral', 30000); SAM.hud.setMode('speaking'); }); await page.waitForTimeout(1000);
    const vis = await page.evaluate(() => Object.values(SAM.face.vis).reduce((a, b) => a + b, 0)); check(vis > 0.05, `3D · VRM visemes while speaking (${vis.toFixed(2)})`); await shot(page, '3d-vrm-speaking');
    await page.evaluate(() => { SAM.hud.setMode('idle'); SAM.hud.S.avatar = 'orb'; SAM.hud.applyLayout(); }); await page.waitForTimeout(800);
    s = await state(page); check(!s.vrm && s.eff === 'orb', '3D · back to the orb disposes the VRM');
    check(page.errors.length === 0, '3D · no page errors' + (page.errors.length ? ' · ' + page.errors[0] : ''));
    await page.context().close();
  } finally { await browser.close(); srv.kill(); }
  log(fails ? `FAILED: ${fails}` : 'all checks passed', '· screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
