import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] ?? (process.env.NYANIME_URL ?? 'http://localhost:8080/anime/82753/watch');
const OUT = '/tmp/nyanime-downloads';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
const client = await page.createCDPSession();
await client.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: OUT,
  eventsEnabled: true,
});

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

// Surface the browser's own download lifecycle, and the picker behaviour.
client.on('Browser.downloadWillBegin', (e) =>
  console.log(`[cdp] downloadWillBegin: ${e.suggestedFilename}`),
);
client.on('Browser.downloadProgress', (e) => {
  if (e.state !== 'inProgress') console.log(`[cdp] download ${e.state}: ${e.totalBytes} bytes`);
});
page.on('dialog', async (d) => {
  console.log(`[dialog] ${d.type()}: ${d.message()}`);
  await d.dismiss();
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('video', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 3000));

// Use the batch range path with a narrow range so the test file is small.
// React controlled inputs need the native setter, and the `From`/`To` inputs
// are direct children of their label (not grandchildren).
const ready = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('label')];
  const setInput = (text, value) => {
    const label = labels.find((l) =>
      l.textContent.trim().toLowerCase().startsWith(text),
    );
    const input = label?.querySelector('input[type="number"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  return { from: setInput('from', '1'), to: setInput('to', '1') };
});
console.log('range inputs set:', JSON.stringify(ready));
await new Promise((r) => setTimeout(r, 800));

const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim().toLowerCase() === 'add',
  );
  if (!btn) return false;
  btn.click();
  return true;
});
console.log(`clicked "Add" (batch): ${clicked}`);
await new Promise((r) => setTimeout(r, 4000));

// Report the queue state so a silent failure is visible.
const panel = await page.evaluate(() => {
  const section = [...document.querySelectorAll('section')].find((s) =>
    /Downloads/i.test(s.textContent ?? ''),
  );
  return section ? section.innerText.slice(0, 600) : '(no downloads panel)';
});
console.log('--- downloads panel ---');
console.log(panel);

// Wait for the file to appear and stop growing.
let file = null;
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  const files = fs
    .readdirSync(OUT)
    .filter((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
  if (files.length) {
    file = path.join(OUT, files[0]);
    const a = fs.statSync(file).size;
    await new Promise((r) => setTimeout(r, 2000));
    const b = fs.statSync(file).size;
    if (a === b && a > 0) break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}

console.log('--- page errors ---');
console.log(errors.length ? errors.slice(0, 5).join('\n') : '(none)');

if (!file) {
  console.log('\nDOWNLOAD FAILED: no file produced');
  await browser.close();
  process.exit(1);
}

const size = fs.statSync(file).size;
const head = fs.readFileSync(file).subarray(0, 12);
const isMp4 = head.subarray(4, 8).toString('latin1') === 'ftyp';

console.log('--- downloaded file ---');
console.log(`name: ${path.basename(file)}`);
console.log(`size: ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`first bytes: ${head.toString('hex')}`);
console.log(`container: ${isMp4 ? 'MP4 (ftyp box present)' : 'not MP4'}`);

await browser.close();

const ok = size > 100_000 && isMp4;
console.log(ok ? '\nDOWNLOAD OK' : '\nDOWNLOAD FAILED');
process.exit(ok ? 0 : 1);
