// Static hygiene and DOM invariants over the shipped files: banned
// punctuation, banned CSS, no external references, single standing title,
// no model-brand mentions, and a README test count that matches reality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const SHIPPED = ['index.html', 'styles.css', 'app.mjs', 'src/color-science.mjs', 'src/generative.mjs', 'src/self-tests.mjs', 'README.md'];

test('no em dashes or en dashes anywhere in shipped files', async (t) => {
  for (const f of SHIPPED) {
    await t.test(f, () => {
      const s = read(f);
      assert.ok(!s.includes('\u2014'), `em dash in ${f}`);
      assert.ok(!s.includes('\u2013'), `en dash in ${f}`);
    });
  }
});

test('banned CSS and banned label structures are absent', async (t) => {
  await t.test('no smooth scroll behavior', () => {
    const s = read('styles.css');
    assert.ok(!/scroll-behavior/.test(s));
  });
  await t.test('no eyebrow or tagline classes in markup', () => {
    const html = read('index.html');
    assert.ok(!/class="[^"]*\b(eyebrow|kicker|tagline|subtitle|lede|subhead)\b/i.test(html));
  });
  await t.test('exactly one h1 and nothing under it but actions', () => {
    const html = read('index.html');
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
    const after = html.split('</h1>')[1];
    assert.ok(!/<(p|span|div)[^>]*class="[^"]*(tag|sub|lede)[^"]*"/i.test(after.slice(0, 300)));
  });
  await t.test('the h1 stands alone in the header', () => {
    const html = read('index.html');
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    const afterH1 = header.split('</h1>')[1];
    assert.ok(afterH1.trimStart().startsWith('<div class="top-actions">'), 'content sits under the title');
  });
});

test('zero external network references in shipped code', async (t) => {
  const files = ['index.html', 'styles.css', 'app.mjs', 'src/color-science.mjs', 'src/generative.mjs', 'src/self-tests.mjs'];
  for (const f of files) {
    await t.test(f, () => {
      const s = read(f);
      const scrubbed = s.replace(/xmlns="http:\/\/www\.w3\.org[^"]*"/g, '').replace(/<!--[^]*?-->/g, '');
      assert.ok(!/https?:\/\//.test(scrubbed), `external URL in ${f}`);
      assert.ok(!/@import/.test(s), `@import in ${f}`);
      assert.ok(!/\bfetch\s*\(|XMLHttpRequest|new EventSource|sendBeacon/.test(s), `network call in ${f}`);
    });
  }
  await t.test('no external assets in markup', () => {
    const html = read('index.html');
    assert.ok(!/<(script|link|img|iframe|video|audio|source)[^>]+(src|href)="https?:/i.test(html));
  });
});

test('no model-brand or assistant mentions in shipped surfaces', async (t) => {
  const pattern = /\b(AI|artificial intelligence|chatgpt|claude|gpt|llm|copilot|gemini|anthropic|openai|machine learning|neural network)\b/i;
  for (const f of SHIPPED) {
    await t.test(f, () => {
      const s = read(f);
      assert.ok(!pattern.test(s), `mention found in ${f}`);
    });
  }
});

test('README states the exact verified test count', async (t) => {
  // Guard against recursion: the child run re-executes this file with the
  // flag set and skips the subprocess leg.
  if (process.env.PF_COUNT_INNER) {
    await t.test('inner run skipped', () => assert.ok(true));
    return;
  }
  await t.test('README count matches the live suite', { timeout: 120000 }, () => {
    const readme = read('README.md');
    const m = /(\d+)\s+passing\s+checks?/i.exec(readme);
    assert.ok(m, 'README does not state a test count');
    const env = { ...process.env, PF_COUNT_INNER: '1' };
    // The worker marker makes a nested `node --test` skip silently; clear it.
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_TEST_WORKER_ID;
    const out = execFileSync(process.execPath, ['--test', 'tests/', '--test-reporter', 'tap'], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 90000,
    });
    const pass = /(?:#|ℹ)\s*pass\s+(\d+)/.exec(out);
    const fail = /(?:#|ℹ)\s*fail\s+(\d+)/.exec(out);
    assert.ok(pass, 'could not parse test summary; tail: ' + JSON.stringify(out.slice(-400)));
    assert.equal(fail ? fail[1] : '0', '0', `inner suite has failures: ${out.slice(-2000)}`);
    assert.equal(m[1], pass[1], `README claims ${m[1]} but suite reports ${pass[1]}`);
  });
});

test('every shipped source file parses as a module', async (t) => {
  const srcs = readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.mjs'));
  for (const f of srcs.map((x) => 'src/' + x)) {
    await t.test(`${f} imports cleanly`, async () => {
      await import(pathToFileURL(join(ROOT, f)).href);
    });
  }
  await t.test('app.mjs parses (DOM-bound, checked not imported)', () => {
    execFileSync(process.execPath, ['--check', join(ROOT, 'app.mjs')], { encoding: 'utf8' });
  });
});
