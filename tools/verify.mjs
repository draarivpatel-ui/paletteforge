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
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
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

let server, chrome, ws;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shutdown(code) {
  try { ws?.close(); } catch {}
  try { server?.close(); } catch {}
  if (chrome && chrome.exitCode === null) {
    const gone = new Promise((r) => chrome.once('exit', r));
    chrome.kill('SIGTERM');
    await Promise.race([gone, sleep(3000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  rmSync(profile, { recursive: true, force: true });
  rmSync(downloadDir, { recursive: true, force: true });
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
  const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; if (${scroll}) el.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'}); const r = el.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height}; })()`);
  if (!box) throw new Error(`no element ${sel}`);
  return box;
};

const realClick = async (sel) => {
  const { x, y } = await center(sel, true);
  for (const [type, btn, cnt] of [['mouseMoved', 'none', 0], ['mousePressed', 'left', 1], ['mouseReleased', 'left', 1]]) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: btn, clickCount: cnt }, S);
  }
  await sleep(120);
};

async function runViewport(w, h, label) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 }, S);
  await send('Page.navigate', { url: appUrl }, S);
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
}

await runViewport(1440, 900, 'desktop');

// SVG export by real click (desktop size still active).
{
  const before = readdirSync(downloadDir).length;
  await realClick('#btn-svg');
  await sleep(900);
  const files = readdirSync(downloadDir);
  const svgFile = files.find((f) => f.endsWith('.svg'));
  let ok = false;
  let detail = '';
  if (svgFile) {
    const body = readFileSync(join(downloadDir, svgFile), 'utf8');
    ok = body.startsWith('<svg') && body.includes('viewBox="0 0 1400 1800"') && !/NaN|undefined/.test(body);
    detail = `${svgFile} ${body.length}b`;
  }
  note('desktop: SVG export by click', ok && files.length > before, detail);
}

// PNG export by real click: must land a real PNG at 1400x1800.
{
  const before = readdirSync(downloadDir).length;
  await realClick('#btn-png');
  await sleep(1400);
  const files = readdirSync(downloadDir);
  const pngFile = files.find((f) => f.endsWith('.png'));
  let ok = false;
  let detail = '';
  if (pngFile) {
    const buf = readFileSync(join(downloadDir, pngFile));
    ok = buf.length > 20000 && buf[0] === 0x89 && buf.readUInt32BE(16) === 1400 && buf.readUInt32BE(20) === 1800;
    detail = `${pngFile} ${buf.length}b`;
  }
  note('desktop: PNG export by click', ok && files.length > before, detail);
}

await runViewport(390, 844, 'mobile');

note('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
note('zero uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
note('zero external network requests', externalRequests.length === 0, externalRequests.slice(0, 3).join(' | '));

await shutdown();
