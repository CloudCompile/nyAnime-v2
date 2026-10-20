import fs from 'node:fs';

/// Locate a Chromium-based browser for the headless harnesses.
///
/// `CHROME_PATH` wins so a local run can point at anything.
///
/// Google Chrome is preferred over Chromium because the streams are MPEG-TS
/// with H.264 video and AAC audio, which hls.js transmuxes to fMP4 for
/// Media Source Extensions. Plain Chromium builds ship without those
/// proprietary codecs, so playback stalls at `readyState 0` with no error.
export function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  const found = candidates.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

  if (!found) {
    throw new Error(
      `No Chromium found. Tried:\n  ${candidates.join('\n  ')}\n` +
        'Set CHROME_PATH to a browser binary.',
    );
  }
  return found;
}
