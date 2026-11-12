/* Faces screenshots (Playwright, node). Serves app/ on a free port with python's http.server (no sidecars needed: the
   HUD runs offline), opens the HUD with the 2D core (?gl=off&skipboot=1) and with the 3D core (swiftshader, low quality),
   switches the avatar to the robot face and to the VRM avatar, sets emotions through SAM.face.set and saves screenshots.
   Every wait polls the HUD's own state (no fixed sleeps): a slow software GPU only makes the run longer, not red.
   Run:  node tests/face_shots.js <output folder>            (two to three minutes; longer on a loaded machine)
   Needs: node with playwright (npm i playwright) and its chromium; python3. */
const { chromium } = require('playwright'); const { spawn } = require('child_process'); const net = require('net'); const path = require('path'); const fs = require('fs');
const APP = path.join(__dirname, '..', 'app'), OUT = path.resolve(process.argv[2] || path.join(__dirname, 'face-shots')); fs.mkdirSync(OUT, { recursive: true });
const GPU = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const freePort = () => new Promise(r => { const sv = net.createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => r(p)); }); });
const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'thinking'], WAIT = { timeout: 180000, polling: 250 };
let fails = 0; const check = (ok, what) => { log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };

async function open(browser, port, gl, saved) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  if (saved) await ctx.addInitScript(s => { try { localStorage.setItem('samurai.hud3', JSON.stringify(s)); } catch (e) { } }, saved);   // seeded settings (saved avatar, 3D quality)
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(String(e.message).slice(0, 160)));
  await page.goto(`http://127.0.0.1:${port}/jarvis-interface.html?gl=${gl}&skipboot=1`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => window.SAM && SAM.hud && SAM.face && SAM.hud.S.mode === 'idle', null, WAIT);
  return page;
}
const shot = async (page, name) => { const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f, timeout: 240000 }); log('shot', f); return f; };
const state = page => page.evaluate(() => ({ eff: SAM.face.effective(), shown: SAM.face.shown, emotion: SAM.face.emotion, hold: SAM.face.holdMs, bot: !!SAM.face.bot, botW: document.getElementById('botFace').width, cls: document.getElementById('stage').className, gl: !!(SAM.gl && SAM.gl.on), vrm: !!(SAM.gl && SAM.gl.vrm), orbVis: !!(SAM.gl && SAM.gl.on && SAM.gl.orb && SAM.gl.orb.visible), lvl: SAM.face.lvl, avatar: SAM.hud.S.avatar }));
const setAvatar = (page, a) => page.evaluate(a => { SAM.hud.S.avatar = a; SAM.hud.applyLayout(); }, a);
/* an emotion is "shown" once the controller has ticked it through; polled, because frames are slow under swiftshader */
const emote = async (page, e) => { await page.evaluate(e => SAM.face.set(e, 60000), e); await page.waitForFunction(e => SAM.face.shown === e, e, WAIT); };
/* the robot face's mouth: pinu-bot's rendered pose sampled over ~1.5 s while it speaks (pinu opens and closes with its cadence), the
   widest frame of the face canvas saved through toDataURL, independent of the page-screenshot pipeline */
async function mouthOpen(page, name) {
  const r = await page.evaluate(() => new Promise(r => { let best = 0, img = '', n = 0; const step = () => { const f = SAM.face.bot, o = f ? f.currentPose.mouth.openness : 0; if (o > best) { best = o; img = f.canvas.toDataURL('image/png'); } if (++n < 90 && performance.now() - t0 < 1800) requestAnimationFrame(step); else r({ best, img }); }; const t0 = performance.now(); requestAnimationFrame(step); }));
  if (r.img) { fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.img.split(',')[1], 'base64')); log('frame', path.join(OUT, name + '.png')); }
  return r.best;
}

(async () => {
  const PORT = await freePort();
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', APP], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ args: [...GPU, '--autoplay-policy=no-user-gesture-required'] });
  try {
    /* ---- 2D core: the robot face on its own canvas over the orb; a saved 'face' avatar from the old build migrates to 'bot' ---- */
    let page = await open(browser, PORT, 'off', { ui: { avatar: 'face' } }); log('2D hud idle');
    let s = await state(page); check(s.avatar === 'bot', `2D · saved avatar 'face' migrates to 'bot' (${s.avatar})`);
    await page.evaluate(() => { SAM.hud.S.avatar = 'orb'; SAM.hud.applyLayout(); }); await page.waitForFunction(() => SAM.face.effective() === 'orb', null, WAIT);
    await shot(page, '2d-orb');
    await setAvatar(page, 'bot');
    await page.waitForFunction(() => SAM.face.bot && document.getElementById('botFace').width > 100 && SAM.face.bot.running, null, WAIT);
    await page.waitForTimeout(600);
    s = await state(page); check(s.eff === 'bot' && s.bot && /\bbot\b/.test(s.cls) && s.botW > 600 && s.botW < 2400, `2D · robot face on, canvas ${s.botW}px wide, stage class bot`);
    await shot(page, '2d-bot-neutral');
    for (const e of EMOTIONS) { await emote(page, e); check(true, `2D · emotion ${e} shown`); await shot(page, '2d-bot-' + e); }
    /* the voice command path: a short confirmation must not override the requested face (it did once) */
    await page.evaluate(() => SAM.hud.submit('look sad')); await page.waitForFunction(() => SAM.face.emotion === 'sad' && SAM.face.holdMs === 8000, null, WAIT);
    await page.waitForTimeout(1500); s = await state(page); check(s.emotion === 'sad' && s.hold === 8000, `2D · "look sad" keeps the sad face with an 8 s hold (${s.emotion}, ${s.hold})`);
    await page.waitForFunction(() => SAM.hud.S.mode === 'idle', null, WAIT);                         // the spoken confirmation settles (its finish timer would flip the mode back)
    /* lip-sync: speaking mode with the cadence (no TTS here), then a forced level for a wide-open frame */
    await page.evaluate(() => { SAM.hud.S.speakGen++; SAM.face.set('neutral', 60000); SAM.hud.setMode('speaking'); });
    await page.waitForFunction(() => SAM.face.speaking && SAM.face.lvl > 0.05 && SAM.face.bot.speakingAmount > 0.3, null, WAIT);
    const mx = await mouthOpen(page, '2d-bot-mouth-cadence'); check(mx > 0.3, `2D · robot mouth opens to the speaking cadence (max openness ${mx.toFixed(2)})`);
    await page.evaluate(() => SAM.face.level(.9, 30000)); await page.waitForFunction(() => SAM.face.lvl > 0.6 && SAM.face.bot.speakingAmount > 0.8, null, WAIT);
    const mo = await mouthOpen(page, '2d-bot-mouth-open'); check(mo > 0.6, `2D · robot mouth wide open on a loud level (max openness ${mo.toFixed(2)})`);
    await shot(page, '2d-bot-speaking');
    await page.evaluate(() => { SAM.face.level(0, 1); SAM.hud.setMode('idle'); SAM.face.style('visor'); }); await page.waitForTimeout(600); await shot(page, '2d-bot-visor');
    await page.evaluate(() => { SAM.face.style('soft'); SAM.hud.toggleDrawer(true); }); await page.waitForSelector('#optAvatar', { timeout: 60000 });
    await page.evaluate(() => document.getElementById('optAvatar').scrollIntoView({ block: 'center' })); await page.waitForTimeout(400); await shot(page, '2d-drawer-avatar');
    await page.evaluate(() => SAM.hud.toggleDrawer(false));
    await setAvatar(page, 'vrm'); await page.waitForTimeout(400);
    s = await state(page); check(s.eff === 'bot', '2D · VRM avatar falls back to the robot face without the 3D core');
    check(page.errors.length === 0, '2D · no page errors' + (page.errors.length ? ' · ' + page.errors[0] : ''));
    await page.context().close();

    /* ---- 3D core (low quality, so swiftshader keeps up): robot face over the hidden 3D orb, then the VRM avatar inside the scene ---- */
    page = await open(browser, PORT, 'on', { ui: { avatar: 'orb', glQuality: 'low' } }); log('3D hud idle');
    await page.waitForFunction(() => SAM.gl && SAM.gl.on && SAM.gl.fps > 0, null, WAIT);
    await shot(page, '3d-orb');
    await setAvatar(page, 'bot');
    await page.waitForFunction(() => SAM.face.bot && document.getElementById('botFace').width > 100 && SAM.gl.orb && !SAM.gl.orb.visible, null, WAIT);
    await page.waitForTimeout(600); s = await state(page); check(s.gl && s.eff === 'bot' && !s.orbVis, '3D · robot face on, 3D orb hidden'); await shot(page, '3d-bot-neutral');
    await emote(page, 'happy'); await shot(page, '3d-bot-happy');
    await setAvatar(page, 'vrm');
    await page.waitForFunction(() => SAM.gl && SAM.gl.vrm && SAM.gl.orb && !SAM.gl.orb.visible, null, WAIT);
    await page.evaluate(() => SAM.face.set('neutral', 60000)); await page.waitForFunction(() => SAM.face.shown === 'neutral', null, WAIT); await page.waitForTimeout(1200);
    s = await state(page); check(s.vrm && s.eff === 'vrm' && /\bvrm\b/.test(s.cls) && !s.orbVis, '3D · VRM avatar loaded, stage class vrm, orb hidden');
    await shot(page, '3d-vrm-neutral');
    for (const e of EMOTIONS) { await emote(page, e); await page.waitForTimeout(500); check(true, `3D · VRM emotion ${e} shown`); await shot(page, '3d-vrm-' + e); }
    await page.evaluate(() => { SAM.hud.S.speakGen++; SAM.face.set('neutral', 60000); SAM.hud.setMode('speaking'); SAM.face.level(.9, 30000); });
    await page.waitForFunction(() => SAM.face.speaking && Object.values(SAM.face.vis).reduce((a, b) => a + b, 0) > 0.05, null, WAIT); await page.waitForTimeout(500);
    const vis = await page.evaluate(() => Object.values(SAM.face.vis).reduce((a, b) => a + b, 0)); check(vis > 0.05, `3D · VRM visemes while speaking (${vis.toFixed(2)})`); await shot(page, '3d-vrm-speaking');
    await page.evaluate(() => { SAM.face.level(0, 1); SAM.hud.setMode('idle'); SAM.hud.applyTheme('ember'); }); await page.waitForTimeout(800); await shot(page, '3d-vrm-ember');
    await page.evaluate(() => { SAM.hud.applyTheme('arc'); SAM.hud.S.avatar = 'orb'; SAM.hud.applyLayout(); });
    await page.waitForFunction(() => !SAM.gl.vrm && SAM.face.effective() === 'orb' && SAM.gl.orb.visible, null, WAIT);
    s = await state(page); check(!s.vrm && s.eff === 'orb' && s.orbVis, '3D · back to the orb disposes the VRM');
    check(page.errors.length === 0, '3D · no page errors' + (page.errors.length ? ' · ' + page.errors[0] : ''));
    await page.context().close();
  } finally { await browser.close(); srv.kill(); }
  log(fails ? `FAILED: ${fails}` : 'all checks passed', '· screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
