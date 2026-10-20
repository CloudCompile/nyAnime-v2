import puppeteer from 'puppeteer-core';
import { resolveChromePath } from './chrome.mjs';

const URL = process.argv[2] ?? (process.env.NYANIME_URL ?? 'http://localhost:8080/anime/82753/watch');

const browser = await puppeteer.launch({
  executablePath: resolveChromePath(),
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage();
const requests = [];
const errors = [];
const statuses = new Map();
const failed = [];
page.on('request', (r) => requests.push(r.url()));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/stream')) {
    const key = `${r.status()} ${r.headers()['content-type'] ?? '?'}`;
    statuses.set(key, (statuses.get(key) ?? 0) + 1);
  }
});
page.on('requestfailed', (r) => {
  if (r.url().includes('/api/stream')) {
    failed.push(`${r.failure()?.errorText ?? '?'} ${r.url().slice(0, 80)}`);
  }
});
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' || /hls|buffer|append/i.test(text)) {
    errors.push(`console(${m.type()}): ${text}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

// hls.js transmuxes to fMP4, so a browser without H.264/AAC support stalls at
// readyState 0 with no error. Report this explicitly instead of looking like a
// network or player bug.
const codecs = await page.evaluate(() => {
  const probe = (type) =>
    document.createElement('video').canPlayType(type);
  return {
    h264: probe('video/mp4; codecs="avc1.42E01E"'),
    aac: probe('audio/mp4; codecs="mp4a.40.2"'),
    mse: typeof MediaSource !== 'undefined',
    ua: navigator.userAgent,
  };
});
console.log('--- codec support ---');
console.log(JSON.stringify(codecs));

// Wait for the player to attach a source and start buffering.
await page.waitForSelector('video', { timeout: 30000 });
// Let the HLS pipeline settle; the player swaps elements while attaching.
await new Promise((r) => setTimeout(r, 4000));

const state = await page.evaluate(async () => {
  const deadline = Date.now() + 30000;
  const lastError = { message: null };
  let v = document.querySelector('video');
  if (!v) {
    return {
      error: 'no video element',
      bodyText: document.body.innerText.slice(0, 400),
    };
  }
  v.muted = true;

  // The player swaps sources as it attaches, so a play() can be interrupted
  // by a new load. That is transient; retry until playback actually starts.
  while (Date.now() < deadline) {
    v = document.querySelector('video') ?? v;
    try {
      if (v.paused) await v.play();
      lastError.message = null;
    } catch (e) {
      lastError.message = e.message;
    }
    if (v.readyState >= 2 && v.currentTime > 0 && v.videoWidth > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    src: v.currentSrc,
    readyState: v.readyState,
    networkState: v.networkState,
    currentTime: v.currentTime,
    duration: v.duration,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    error: v.error ? `${v.error.code}: ${v.error.message}` : null,
    lastPlayRejection: lastError.message,
  };
});

const proxied = requests.filter((u) => u.includes('/api/stream'));
const upstream = requests.filter((u) => u.includes('echovideo'));

console.log('--- video state ---');
console.log(JSON.stringify(state, null, 2));
console.log('--- network ---');
console.log(`proxy requests:    ${proxied.length}`);
console.log(`direct CDN hits:   ${upstream.length}`);
console.log('responses:');
for (const [key, n] of statuses) console.log(`  ${n} x ${key}`);
if (failed.length) {
  console.log('failed requests:');
  failed.slice(0, 5).forEach((f) => console.log(`  ${f}`));
}
upstream.slice(0, 5).forEach((u) => console.log(`  direct: ${u.slice(0, 110)}`));
proxied.slice(0, 3).forEach((u) => console.log(`  proxied: ${u.slice(0, 110)}`));
console.log('--- page errors ---');
console.log(errors.length ? errors.slice(0, 10).join('\n') : '(none)');

await browser.close();

const ok =
  !state.error &&
  state.readyState >= 2 &&
  state.currentTime > 0 &&
  state.videoWidth > 0;

console.log(ok ? '\nPLAYBACK OK' : '\nPLAYBACK FAILED');
process.exit(ok ? 0 : 1);
