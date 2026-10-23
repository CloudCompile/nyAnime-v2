/**
 * WebVTT retiming.
 *
 * Scraped subtitle files are authored against whichever encode the scraper
 * happened to rip: a cold open or "previously on" segment that one provider
 * trims and another keeps shifts every cue by a fixed amount. The player
 * therefore loads the raw file once and re-emits it with a per-episode offset,
 * so a viewer can nudge the track into sync without a round trip.
 */

const TIMESTAMP = /((?:\d+:)?\d{2}:\d{2}\.\d{3})/g;

/** `HH:MM:SS.mmm`, `MM:SS.mmm` or `SS.mmm` to seconds. */
export function parseTimestamp(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/** Seconds to `HH:MM:SS.mmm`, the only form WebVTT accepts in a cue body. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
}

/**
 * Shift every cue by `offset` seconds (positive moves subtitles later).
 *
 * Only timestamp lines are touched — the cue text, header and any
 * `X-TIMESTAMP-MAP` metadata are copied through, so a zero offset is a no-op
 * and the file stays valid WebVTT.
 */
export function shiftVtt(text: string, offset: number): string {
  if (!offset) return text;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.includes('-->')) return line;
      return line.replace(TIMESTAMP, (match) => {
        const seconds = parseTimestamp(match);
        return Number.isNaN(seconds) ? match : formatTimestamp(seconds + offset);
      });
    })
    .join('\n');
}

/** True when the file is a WebVTT document the browser will accept. */
export function looksLikeVtt(text: string): boolean {
  return text.replace(/^\uFEFF/, '').trimStart().startsWith('WEBVTT');
}

const DELAY_KEY_PREFIX = 'nyanime.subtitleDelay.';

/**
 * Per-series subtitle delay, persisted so a viewer only has to find the offset
 * once. A series shares one rip, so the correction carries across episodes.
 */
export function loadSubtitleDelay(seriesId: string | number | undefined): number {
  if (seriesId === undefined || seriesId === '') return 0;
  const stored = Number(localStorage.getItem(`${DELAY_KEY_PREFIX}${seriesId}`));
  return Number.isFinite(stored) ? stored : 0;
}

export function saveSubtitleDelay(seriesId: string | number | undefined, seconds: number): void {
  if (seriesId === undefined || seriesId === '') return;
  localStorage.setItem(`${DELAY_KEY_PREFIX}${seriesId}`, String(seconds));
}
