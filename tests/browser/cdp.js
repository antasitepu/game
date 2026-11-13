'use strict';
// Driver browser headless lewat Chrome DevTools Protocol (tanpa dependency).
// Dipakai tests/browser/run.js. Butuh Node dengan WebSocket global (Node 20: --experimental-websocket).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');

const BROWSERS = [
  process.env.BROWSER_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const request = (method, url) => new Promise((res, rej) => {
  const req = http.request(url, { method }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); });
  req.on('error', rej);
  req.end();
});

async function launch(outDir, port) {
  const bin = BROWSERS.find(p => fs.existsSync(p));
  if (!bin) throw new Error('Browser Chromium tidak ditemukan. Set BROWSER_BIN ke path executable-nya.');
  const profile = path.join(outDir, 'profile-' + port);
  fs.rmSync(profile, { recursive: true, force: true });   // profil bersih → localStorage kosong
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--window-size=1280,800',
    '--hide-scrollbars', '--no-first-run', '--mute-audio'].concat(process.env.NO_GPU ? ['--disable-gpu'] : [], ['about:blank']), { stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(200); try { up = (await request('GET', base + '/json/version')).status === 200; } catch (e) { /* belum siap */ } }
  if (!up) { proc.kill(); throw new Error('Browser tidak merespons'); }

  async function page(url) {
    const target = JSON.parse((await request('PUT', base + '/json/new?about:blank')).body);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    let seq = 0;
    const pending = new Map(), errors = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE: ' + m.params.args.map(a => a.value || a.description).join(' '));
    });
    const send = (method, params) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
    const ev = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error('eval gagal: ' + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text) + '\n  expr: ' + expr.slice(0, 160));
      return r.result.result.value;
    };
    const mouse = (type, x, y, button, extra) => send('Input.dispatchMouseEvent', Object.assign({
      type, x, y, button: button || 'none', buttons: button === 'left' ? 1 : button === 'right' ? 2 : 0, clickCount: type === 'mouseMoved' ? 0 : 1,
    }, extra || {}));
    const p = {
      send, ev, mouse, errors, sleep,
      async shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64')); },
      async click(x, y, button, extra) { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, button || 'left', extra); await mouse('mouseReleased', x, y, button || 'left', extra); },
      async drag(x0, y0, x1, y1) {
        await mouse('mouseMoved', x0, y0);
        await mouse('mousePressed', x0, y0, 'left');
        for (let i = 1; i <= 6; i++) await mouse('mouseMoved', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, 'left');
        await mouse('mouseReleased', x1, y1, 'left');
      },
      async key(k, code, vk, modifiers) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: modifiers || 0 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: modifiers || 0 });
      },
      // Klik elemen DOM di titik tengahnya dengan event mouse sungguhan.
      async clickEl(selector) {
        const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (!r) throw new Error('elemen tidak ada: ' + selector);
        await p.click(r.x, r.y);
      },
      async type(text) { await send('Input.insertText', { text }); },
      async close() { try { ws.close(); await request('GET', base + '/json/close/' + target.id); } catch (e) { /* sudah tertutup */ } },
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: +(process.env.DPR || 1), mobile: false });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.navigate', { url });
    await sleep(900);
    return p;
  }

  return { page, close() { proc.kill(); } };
}

module.exports = { launch, sleep, request };
