import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? (process.env.NYANIME_URL ?? 'http://localhost:8080/anime/82753/watch');

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
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
page.on('request', (r) => requests.push(r.url()));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

// Wait for the player to attach a source and start buffering.
await page.waitForSelector('video', { timeout: 30000 });
// Let the HLS pipeline settle; the player swaps elements while attaching.
await new Promise((r) => setTimeout(r, 4000));

const state = await page.evaluate(async () => {
  const deadline = Date.now() + 20000;
  let v = null;
  while (Date.now() < deadline) {
    v = document.querySelector('video');
    if (v) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!v) {
    return {
      error: 'no video element',
      bodyText: document.body.innerText.slice(0, 400),
    };
  }
  v.muted = true;
  try {
    await v.play();
  } catch (e) {
    return { error: `play() rejected: ${e.message}`, src: v.currentSrc };
  }
  // Give the pipeline a moment to fetch and decode.
  await new Promise((r) => setTimeout(r, 8000));
  return {
    src: v.currentSrc,
    readyState: v.readyState,
    networkState: v.networkState,
    currentTime: v.currentTime,
    duration: v.duration,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    error: v.error ? `${v.error.code}: ${v.error.message}` : null,
  };
});

const proxied = requests.filter((u) => u.includes('/api/stream'));
const upstream = requests.filter((u) => u.includes('echovideo'));

console.log('--- video state ---');
console.log(JSON.stringify(state, null, 2));
console.log('--- network ---');
console.log(`proxy requests:    ${proxied.length}`);
console.log(`direct CDN hits:   ${upstream.length}`);
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
