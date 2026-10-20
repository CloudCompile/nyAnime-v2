import fs from 'node:fs';

/// Locate a Chromium-based browser for the headless harnesses.
///
/// `CHROME_PATH` wins so a local run can point at anything. Otherwise the
/// usual Linux locations are probed, which covers this container
/// (`/usr/bin/chromium`) and GitHub's Ubuntu runners, which ship Chrome.
export function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
