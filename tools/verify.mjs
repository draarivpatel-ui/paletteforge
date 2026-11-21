// Headless verification for PaletteForge. Boots a throwaway headless Chrome
// (temp profile, debug port 0; never touches a real browser profile), serves
// the repo over a local static server, and drives real pointer
// clicks through CDP. Asserts: zero console errors, zero uncaught exceptions,
// zero external network requests, zero horizontal overflow, and that seed
// change, composition switch, harmony switch, CVD toggle, sample extraction,
// SVG export, and the self-test button all work by click at 1440x900 and
// 390x844. All temp artifacts are deleted on every exit path.
//
//   node tools/verify.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };

const profile = mkdtempSync(join(tmpdir(), 'pf-verify-profile-'));
const downloadDir = mkdtempSync(join(tmpdir(), 'pf-verify-dl-'));
const results = [];
const note = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

let server, server2, chrome, ws;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shutdown(code) {
  try { ws?.close(); } catch {}
  try { server?.close(); } catch {}
  try { server2?.close(); } catch {}
  if (chrome && chrome.exitCode === null) {
    const gone = new Promise((r) => chrome.once('exit', r));
    chrome.kill('SIGTERM');
    await Promise.race([gone, sleep(3000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  rmSync(downloadDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  const fails = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed, ${fails} failed`);
  process.exit(code ?? (fails ? 1 : 0));
}
process.on('unhandledRejection', (e) => { console.error(e); shutdown(1); });
process.on('SIGINT', () => shutdown(130));

// Static file server on localhost only.
const { readFile } = await import('node:fs/promises');
server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${server.address().port}/`;
// Second origin for the mobile pass: Chrome throttles repeated automatic
// downloads per origin, so each viewport verifies exports on its own origin.
server2 = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server2.listen(0, '127.0.0.1', r));
const appUrlMobile = `http://127.0.0.1:${server2.address().port}/`;

chrome = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--disable-blink-features=AutomationControlled', 'about:blank',
], { stdio: 'ignore' });

let port;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  const f = join(profile, 'DevToolsActivePort');
  if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0].trim();
}
if (!port) { console.error('Chrome did not start'); await shutdown(1); }

const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const exceptions = [];
const externalRequests = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  }
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url;
    if (/^https?:/i.test(u) && !u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost')) {
      externalRequests.push(u);
    }
  }
};

const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
});

// Attach to a new page target.
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = sessionId;

for (const dom of ['Page', 'Runtime', 'Network']) await send(`${dom}.enable`, {}, S);
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, S);
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

const center = async (sel, scroll = false) => {
  // scrollIntoView is compositor-driven on mobile emulation: the rect read in
  // the same task can precede the actual scroll, leaving stale click coords.
  // Scroll first, let it settle, then read the rect and confirm the element
  // is really what elementFromPoint reports at its center.
  //
  // Coordinates: getBoundingClientRect/elementFromPoint are layout-viewport
  // space, but Input.dispatchMouseEvent on mobile emulation expects
  // visual-viewport space. visualViewport.offsetTop/Left is the gap between
  // them (0 on desktop), so dispatch coords = layout coords minus the offset.
  if (scroll) {
    await evaluate(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'}); 'ok'`);
    await sleep(200);
  }
  let box = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); const lx = r.left + r.width/2, ly = r.top + r.height/2; const hit = document.elementFromPoint(lx, ly); const vx = lx - visualViewport.offsetLeft, vy = ly - visualViewport.offsetTop; return {x: vx, y: vy, lx, ly, w: r.width, h: r.height, ok: hit === el || el.contains(hit)}; })()`);
    if (!box) throw new Error(`no element ${sel}`);
    if (box.ok || !scroll) return box;
    await evaluate(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block: 'center', inline: 'nearest'}); 'ok'`);
    await sleep(200);
  }
  return box;
};

const realClick = async (sel) => {
  // Mobile emulation can keep scrolling after scrollIntoView returns, so a
  // rect read a moment earlier may already be stale. Re-center and re-verify
  // the hit target immediately before pressing; retry if the page moved.
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { x, y, lx, ly } = await center(sel, true);
    last = { x, y, lx, ly };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }, S);
    const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const hit = document.elementFromPoint(${lx}, ${ly}); return hit === el || el.contains(hit); })()`);
    if (!ok) { await sleep(300); continue; }
    for (const [type, btn, cnt] of [['mousePressed', 'left', 1], ['mouseReleased', 'left', 1]]) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: btn, clickCount: cnt }, S);
    }
    await sleep(120);
    return last;
  }
  return last;
};

// After a real click, report what element sits at the click point. Used only
// for failure diagnostics so a missed tap explains itself.
const hitAt = async (x, y) =>
  evaluate(`(() => { const el = document.elementFromPoint(${x}, ${y}); return el ? (el.id || el.tagName + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className)) : 'none'; })()`);

const realTab = async () => {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }, S);
  }
  await sleep(80);
};

async function runViewport(w, h, label, url = appUrl) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 }, S);
  await send('Page.navigate', { url }, S);
  await sleep(1600);

  const overflow = await evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  note(`${label}: no horizontal overflow at ${w}x${h}`, overflow === false);

  // Poster actually painted (non-blank canvas).
  const painted = await evaluate(`(() => { const c = document.getElementById('poster'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let distinct = new Set(); for (let i = 0; i < d.length; i += 4000) distinct.add(d[i]+','+d[i+1]+','+d[i+2]); return distinct.size; })()`);
  note(`${label}: poster canvas painted`, painted > 3, `${painted} sampled colors`);

  const placardBefore = await evaluate(`document.getElementById('placard-meta').textContent`);

  // Seed change: type into the input then click Apply.
  await realClick('#seed-input');
  await send('Input.insertText', { text: 'orbit study' }, S);
  await evaluate(`(() => { const el = document.getElementById('seed-input'); el.value = 'orbit study'; return true; })()`);
  await realClick('#btn-seed');
  const placardSeed = await evaluate(`document.getElementById('placard-meta').textContent`);
  note(`${label}: seed change by click`, placardSeed.includes('orbit study'), placardSeed.slice(0, 60));

  // Composition switch.
  await realClick('#mode-bauhaus');
  const placardMode = await evaluate(`document.getElementById('placard-meta').textContent`);
  note(`${label}: composition switch by click`, placardMode.includes('bauhaus'), placardMode.slice(0, 80));

  // Harmony switch.
  await realClick('#harm-tetradic');
  const placardHarm = await evaluate(`document.getElementById('placard-meta').textContent`);
  note(`${label}: harmony switch by click`, placardHarm.includes('tetradic'), placardHarm.slice(0, 90));

  // CVD toggle.
  const chipBefore = await evaluate(`document.querySelector('.swatch .hex').textContent`);
  await realClick('#cvd-deuteranopia');
  const note2 = await evaluate(`document.querySelector('.swatch .oklch').textContent`);
  note(`${label}: CVD toggle by click`, note2.includes('deuteranopia'), `${note2.slice(0, 60)}`);
  await realClick('#cvd-none');

  // Radio-group keyboard navigation: focus a harmony option, press ArrowRight,
  // and focus plus selection should move together to the next item.
  await evaluate(`document.getElementById('harm-triadic').focus(); 'ok'`);
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 }, S);
  }
  await sleep(200);
  const arrow = await evaluate(`(() => { const el = document.activeElement; return { id: el && el.id, checked: el && el.getAttribute('aria-checked'), meta: document.getElementById('placard-meta').textContent }; })()`);
  note(`${label}: arrow key navigates the radio group`, arrow && arrow.id === 'harm-analogous' && arrow.checked === 'true' && arrow.meta.includes('analogous'), JSON.stringify(arrow).slice(0, 120));

  // The polite live region announced that change.
  const live = await evaluate(`document.getElementById('live').textContent`);
  note(`${label}: live region announces changes`, typeof live === 'string' && live.length > 4, live.slice(0, 70));

  // Malformed hex input is rejected and flagged, not silently dropped.
  await evaluate(`(() => { const el = document.getElementById('base-hex'); el.value = 'not-a-hex'; el.dispatchEvent(new Event('input')); return true; })()`);
  await realClick('#btn-base');
  const badHex = await evaluate(`(() => ({ invalid: document.getElementById('base-hex').getAttribute('aria-invalid'), note: document.getElementById('color-note').textContent }))()`);
  note(`${label}: malformed hex rejected and announced`, badHex.invalid === 'true' && badHex.note.includes('kept'), badHex.note.slice(0, 60));

  // A typed OKLCH triple gamut-maps into a real base color.
  await evaluate(`(() => { const el = document.getElementById('base-oklch'); el.value = 'oklch(0.62 0.16 30)'; el.dispatchEvent(new Event('input')); return true; })()`);
  await realClick('#btn-oklch');
  const okRes = await evaluate(`(() => ({ hex: document.getElementById('base-hex').value, note: document.getElementById('color-note').textContent }))()`);
  note(`${label}: oklch input applies through the gamut map`, /^#[0-9a-f]{6}$/.test(okRes.hex) && okRes.note.includes('mapped'), `${okRes.hex} ${okRes.note.slice(0, 50)}`);

  // A malformed OKLCH triple is rejected the same way.
  await evaluate(`(() => { const el = document.getElementById('base-oklch'); el.value = 'oklch(nope)'; el.dispatchEvent(new Event('input')); return true; })()`);
  await realClick('#btn-oklch');
  const badOk = await evaluate(`(() => ({ invalid: document.getElementById('base-oklch').getAttribute('aria-invalid'), note: document.getElementById('color-note').textContent }))()`);
  note(`${label}: malformed oklch rejected and announced`, badOk.invalid === 'true' && badOk.note.includes('kept'), badOk.note.slice(0, 60));

  // Sample art extraction.
  await realClick('#btn-extract');
  const srcNote = await evaluate(`document.getElementById('palette-source-note').textContent`);
  const swatchCount = await evaluate(`document.querySelectorAll('#swatches .swatch').length`);
  note(`${label}: sample extraction by click`, srcNote.includes('median cut') && swatchCount === 5, `${swatchCount} swatches`);

  // Surprise button regenerates.
  const before = await evaluate(`document.getElementById('placard-meta').textContent`);
  await realClick('#btn-surprise');
  const after = await evaluate(`document.getElementById('placard-meta').textContent`);
  note(`${label}: surprise button by click`, before !== after, after.slice(0, 60));

  // Self-tests drawer.
  await realClick('#btn-tests');
  await sleep(300);
  const summary = await evaluate(`document.getElementById('test-summary').textContent`);
  const anyBad = await evaluate(`document.querySelectorAll('#test-list .dot.bad').length`);
  note(`${label}: self-tests run and all pass`, /\d+\/\d+/.test(summary) && anyBad === 0, summary);

  // Theme toggle.
  await realClick('#btn-theme');
  const theme = await evaluate(`document.documentElement.dataset.theme`);
  note(`${label}: theme toggle`, theme === 'dark', theme);
  await realClick('#btn-theme');

  // Keyboard: Tab must move focus through real controls and show a visible
  // focus ring (focus-visible outline, not the mouse-hover state).
  await evaluate(`document.body.focus()`);
  const seen = [];
  let ringSeen = false;
  for (let i = 0; i < 14; i++) {
    await realTab();
    const info = await evaluate(`(() => { const el = document.activeElement; if (!el || el === document.body) return null; const cs = getComputedStyle(el); return { id: (el.id || el.tagName) + ':' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')), outline: cs.outlineStyle + ' ' + cs.outlineWidth }; })()`);
    if (info && !seen.includes(info.id)) {
      seen.push(info.id);
      if (info.outline.startsWith('solid') && !info.outline.startsWith('solid 0')) ringSeen = true;
    }
  }
  note(`${label}: Tab order reaches controls with visible focus ring`, seen.length >= 4 && ringSeen, `${seen.length} stops, ring=${ringSeen}`);
}

// Export artifacts: real clicks, then inspect the produced bytes. SVG must
// parse as the poster markup; PNG must decode to a non-blank 1400x1800 image
// (distinct sampled colors checked by drawing it back through a canvas).
// Chrome caps automatic downloads at two per browser session, so the mobile
// pass captures the export blob directly after a real click instead of
// relying on a second file download.
const dlSnapshot = () => new Map(readdirSync(downloadDir).map((f) => [f, statSync(join(downloadDir, f)).mtimeMs]));
const dlFresh = (snap, ext) =>
  readdirSync(downloadDir)
    .filter((f) => f.endsWith(ext) && snap.get(f) !== statSync(join(downloadDir, f)).mtimeMs)
    .map((f) => join(downloadDir, f));

const captureBlobs = () =>
  evaluate(`(() => {
    window.__pfBlobs = [];
    window.__pfClicks = [];
    window.__pfLog = [];
    for (const id of ['btn-svg', 'btn-png']) {
      document.getElementById(id).addEventListener('click', () => window.__pfClicks.push(id), true);
    }
    for (const t of ['mousedown', 'mouseup', 'click']) {
      document.addEventListener(t, (e) => window.__pfLog.push(t + '@' + (e.target.id || e.target.tagName)), true);
    }
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__pfBlobs.push(b); return orig(b); };
    return true;
  })()`);

const readBlobInfo = (idx, kind) =>
  evaluate(`(async () => {
    const b = window.__pfBlobs[${idx}];
    if (!b) return null;
    if ('${kind}' === 'svg') {
      const t = await b.text();
      return { type: b.type, size: b.size, head: t.slice(0, 200), len: t.length, hasNaN: /NaN|undefined/.test(t), hasViewBox: t.includes('viewBox="0 0 1400 1800"'), shapes: /<(path|rect|circle|ellipse|polygon|line)/.test(t) };
    }
    const bmp = await createImageBitmap(b);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 16000) colors.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return { type: b.type, size: b.size, w: bmp.width, h: bmp.height, colors: colors.size };
  })()`);

async function checkExports(label, { viaBlob = false } = {}) {
  // The Tab-order pass can leave focus inside a text field; on mobile
  // emulation that opens the virtual keyboard and shifts the visual
  // viewport, so export taps would land offset. Drop focus first.
  await evaluate(`if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); 'ok'`);
  await sleep(400);
  if (viaBlob) await captureBlobs();

  // SVG export.
  const snap1 = viaBlob ? null : dlSnapshot();
  let pt = await realClick('#btn-svg');
  await sleep(viaBlob ? 600 : 1500);
  let svgOk = false;
  let svgDetail = '';
  if (viaBlob) {
    const info = await readBlobInfo(0, 'svg');
    const dbg = await evaluate(`JSON.stringify({clicks: window.__pfClicks || [], blobs: (window.__pfBlobs || []).length, log: (window.__pfLog || []).slice(-8), scrollY: scrollY, ae: document.activeElement ? document.activeElement.id || document.activeElement.tagName : 'none'})`);
    svgOk = !!info && info.type === 'image/svg+xml' && info.size > 3000 && info.len > 3000 && info.head.startsWith('<svg') && info.hasViewBox && !info.hasNaN && info.shapes;
    svgDetail = info ? `blob ${info.size}b ${info.len} chars` : `no blob captured (${dbg})`;
  } else {
    let svgs = dlFresh(snap1, '.svg');
    if (!svgs.length) {
      const hit = await hitAt(pt.lx ?? pt.x, pt.ly ?? pt.y);
      pt = await realClick('#btn-svg');
      await sleep(1500);
      svgs = dlFresh(snap1, '.svg');
      if (!svgs.length) svgDetail = `click at ${Math.round(pt.x)},${Math.round(pt.y)} hit ${hit}`;
    }
    if (svgs.length) {
      const body = readFileSync(svgs[svgs.length - 1], 'utf8');
      svgOk = body.startsWith('<svg') && body.includes('viewBox="0 0 1400 1800"') && !/NaN|undefined/.test(body) && body.length > 3000 && /<(path|rect|circle|ellipse|polygon|line)/.test(body);
      svgDetail = `${svgs[svgs.length - 1].split('/').pop()} ${body.length}b`;
    }
  }
  note(`${label}: SVG export non-empty and valid`, svgOk, svgDetail);

  // PNG export.
  const snap2 = viaBlob ? null : dlSnapshot();
  pt = await realClick('#btn-png');
  await sleep(viaBlob ? 1600 : 2200);
  let pngOk = false;
  let pngDetail = '';
  if (viaBlob) {
    const info = await readBlobInfo(1, 'png');
    const dbg = await evaluate(`JSON.stringify({clicks: window.__pfClicks || [], blobs: (window.__pfBlobs || []).length, log: (window.__pfLog || []).slice(-8)})`);
    pngOk = !!info && info.type === 'image/png' && info.size > 20000 && info.w === 1400 && info.h === 1800 && info.colors > 12;
    pngDetail = info ? `blob ${info.size}b ${info.w}x${info.h} ${info.colors} colors` : `no blob captured (${dbg})`;
  } else {
    let pngs = dlFresh(snap2, '.png');
    if (!pngs.length) {
      const hit = await hitAt(pt.lx ?? pt.x, pt.ly ?? pt.y);
      pt = await realClick('#btn-png');
      await sleep(2200);
      pngs = dlFresh(snap2, '.png');
      if (!pngs.length) pngDetail = `click at ${Math.round(pt.x)},${Math.round(pt.y)} hit ${hit}`;
    }
    if (pngs.length) {
      const pngPath = pngs[pngs.length - 1];
      const buf = readFileSync(pngPath);
      const sigOk = buf.length > 20000 && buf[0] === 0x89 && buf[1] === 0x50 && buf.readUInt32BE(16) === 1400 && buf.readUInt32BE(20) === 1800;
      if (sigOk) {
        const b64 = buf.toString('base64');
        const px = await evaluate(`(async () => {
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = 'data:image/png;base64,${b64}'; });
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          const colors = new Set();
          for (let i = 0; i < d.length; i += 16000) colors.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
          return { w: img.width, h: img.height, colors: colors.size };
        })()`);
        pngOk = px.w === 1400 && px.h === 1800 && px.colors > 12;
        pngDetail = `${pngPath.split('/').pop()} ${buf.length}b ${px.w}x${px.h} ${px.colors} colors`;
      } else {
        pngDetail = `${pngPath.split('/').pop()} ${buf.length}b bad signature/dimensions`;
      }
    }
  }
  note(`${label}: PNG export decodes non-blank at 1400x1800`, pngOk, pngDetail);

  // Token exports: real clicks on each of the four buttons, payloads captured
  // through a createObjectURL hook (Chrome caps file downloads per session, so
  // the produced blob is the reliable artifact to audit).
  await evaluate(`(() => {
    window.__pfTokBlobs = [];
    if (!window.__pfTokHooked) {
      window.__pfTokHooked = true;
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (b) => { window.__pfTokBlobs.push(b); return orig(b); };
    }
    return true;
  })()`);
  const readTok = (idx) =>
    evaluate(`(async () => {
      const b = (window.__pfTokBlobs || [])[${idx}];
      if (!b) return null;
      return { type: b.type, size: b.size, text: await b.text() };
    })()`);
  for (const id of ['btn-export-json', 'btn-export-css', 'btn-export-tw', 'btn-export-figma']) {
    await realClick('#' + id);
    await sleep(500);
  }

  const pj = await readTok(0);
  let pjOk = false;
  let pjDetail = 'no blob captured';
  if (pj) {
    try {
      const j = JSON.parse(pj.text);
      pjOk = j.report === 'paletteforge-contrast-proof' &&
        Array.isArray(j.visions) && j.visions.length === 4 &&
        j.visions.every((v) => v.pairs.length > 0 && v.summary) &&
        !/NaN|undefined/.test(pj.text);
      pjDetail = `${pj.size}b ${j.visions && j.visions.length} visions ${j.verdict && j.verdict.pairs} pairs`;
    } catch {
      pjDetail = 'unparseable json';
    }
  }
  note(`${label}: proof JSON export parses with four vision matrices`, pjOk, pjDetail);

  const css = await readTok(1);
  const cssVars = css ? (css.text.match(/--pf-swatch-\d+:/g) || []).length : 0;
  const cssOk = css && css.text.includes(':root {') && cssVars >= 20 && css.text.includes('[data-vision="protanopia"]');
  note(`${label}: CSS token export carries vars and vision blocks`, !!cssOk, css ? `${css.size}b ${cssVars} hex vars` : 'no blob');

  const tw = await readTok(2);
  const twOk = tw && tw.text.includes('module.exports') && tw.text.includes('paletteforge') && tw.text.includes('DEFAULT');
  note(`${label}: Tailwind config export`, !!twOk, tw ? `${tw.size}b` : 'no blob');

  const fg = await readTok(3);
  let fgOk = false;
  if (fg) {
    try {
      const j = JSON.parse(fg.text);
      const color = j.paletteforge && j.paletteforge.color;
      fgOk = !!color && Object.keys(color).length >= 10 &&
        Object.values(color).every((x) => x.$type === 'color' && /^#[0-9a-f]{6}$/.test(x.$value));
    } catch { /* stays false */ }
  }
  note(`${label}: Figma token export parses as design tokens`, fgOk, fg ? `${fg.size}b` : 'no blob');
}

await runViewport(1440, 900, 'desktop', appUrl);
await checkExports('desktop');
await runViewport(390, 844, 'mobile', appUrlMobile);
await checkExports('mobile', { viaBlob: true });

note('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
note('zero uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
note('zero external network requests', externalRequests.length === 0, externalRequests.slice(0, 3).join(' | '));

await shutdown();
