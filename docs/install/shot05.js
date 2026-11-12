/* Re-takes 05-phone.png alone: run after `POST /panel/lan {on:true}` has settled (LAN mode restarts the services). */
const { chromium } = require('playwright');
const OUT = __dirname;
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('http://127.0.0.1:9000/', { waitUntil: 'load' }); await page.waitForTimeout(9000);
  const st = await page.evaluate(async () => (await (await fetch('/phone')).json()));
  console.log('phone enabled', st.enabled, 'qr', !!st.qr, 'links', (st.links || []).length);
  await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(h => /PHONE/.test(h.textContent)); if (h) { h.parentElement.id = '__phone'; h.parentElement.scrollIntoView({ block: 'center' }); } });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const st = document.createElement('style'); st.textContent = `.lb{position:absolute;z-index:999999;display:flex;align-items:flex-start;gap:8px;pointer-events:none}.lb i{width:30px;height:30px;border-radius:50%;background:#ffb547;color:#0a0f1a;font:bold 15px/30px 'IBM Plex Mono',monospace;text-align:center;flex:none;box-shadow:0 2px 10px rgba(0,0,0,.6)}.lb b{background:rgba(5,6,13,.95);border:1px solid #ffb547;color:#ffe9c2;font:600 13px/1.35 Saira,Segoe UI,sans-serif;padding:6px 10px;border-radius:4px;max-width:380px;box-shadow:0 4px 18px rgba(0,0,0,.6)}.lbox{position:absolute;z-index:999998;border:2px solid #ffb547;border-radius:4px;pointer-events:none}`; document.head.appendChild(st);
    const items = [['#swLan2', 1, 'Switch PHONE / LAN ACCESS on (and HTTPS for the phone microphone)', 'below'], ['#phoneQr', 2, 'Scan the QR code with your phone on the same Wi-Fi; trust the certificate once', 'right'], ['#__phone', 3, 'Companion mode: the phone listens, the PC runs the command', 'above']];
    items.forEach(([sel, n, text, pos]) => { const el = document.querySelector(sel); if (!el) return; const r = el.getBoundingClientRect(); const b = document.createElement('div'); b.className = 'lbox'; b.style.cssText = `left:${r.x + scrollX - 4}px;top:${r.y + scrollY - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`; document.body.appendChild(b);
      const d = document.createElement('div'); d.className = 'lb'; d.innerHTML = `<i>${n}</i><b>${text}</b>`; let x = r.x + scrollX, y = r.y + scrollY + r.height + 10; if (pos === 'above') y = r.y + scrollY - 50; if (pos === 'right') { x = r.x + scrollX + r.width + 12; y = r.y + scrollY; } d.style.cssText = `left:${Math.max(8, x)}px;top:${Math.max(8, y)}px`; document.body.appendChild(d); });
  });
  await page.screenshot({ path: OUT + '/05-phone.png' }); console.log('05 retaken');
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
