/**
 * Verifies the download pipeline against the real CDN, through the local dev
 * proxy. It downloads the first few segments of an episode, transmuxes them to
 * fragmented MP4, patches the duration and writes the result to /tmp.
 *
 * Run with:  npm run verify:download
 */
import { writeFile } from 'node:fs/promises';
import {
  downloadSegmentsStreaming,
  loadMediaPlaylist,
} from '../src/lib/download/hls.ts';
import { TransmuxStream, patchDuration } from '../src/lib/download/transmux.ts';

const PROXY = process.env.PROXY_BASE ?? 'http://localhost:8080/api/stream';
const API = process.env.ANIME_API_URL ?? 'https://animeapi.cjhauser.me';
const EPISODE = process.env.EPISODE_KEY ?? '74575_1';

const proxied = (url: string) => `${PROXY}?url=${encodeURIComponent(url)}`;

interface Variant {
  height: number;
  bandwidth: number;
  url: string;
}

/** Master-playlist parsing, inlined so this script does not pull in the
 *  browser-only modules the app's manager depends on. */
function parseMaster(text: string, baseUrl: string): Variant[] {
  const lines = text.split(/\r?\n/);
  const variants: Variant[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line || !line.startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = lines[index + 1];
    if (!uri || uri.startsWith('#')) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    const resolution = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    variants.push({
      height: resolution ? Number(resolution[2]) : 0,
      bandwidth,
      url: new URL(uri, baseUrl).toString(),
    });
  }
  return variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
}

/** Walk top-level boxes to locate `moov`, then `mvhd` inside it. */
function findMvhd(view: DataView): number | null {
  const type = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );

  let offset = 0;
  while (offset + 8 <= view.byteLength) {
    const size = view.getUint32(offset);
    if (size < 8) return null;
    if (type(offset + 4) === 'moov') {
      let child = offset + 8;
      const end = offset + size;
      while (child + 8 <= end) {
        const childSize = view.getUint32(child);
        if (childSize < 8) return null;
        if (type(child + 4) === 'mvhd') return child;
        child += childSize;
      }
      return null;
    }
    offset += size;
  }
  return null;
}

async function main(): Promise<void> {
  // 1. Resolve a direct HLS stream from the API.
  const streamResponse = await fetch(`${API}/api/stream?id=${EPISODE}&server=Vidplay&type=sub`);
  if (!streamResponse.ok) throw new Error(`HTTP ${streamResponse.status} from the anime API.`);
  const payload = (await streamResponse.json()) as {
    results: { streamingLink: { link: { file?: string } } };
  };
  const master = payload.results.streamingLink.link.file;
  if (!master) throw new Error('No direct stream file returned.');
  console.log('master playlist:', master.slice(0, 72), '...');

  // 2. Fetch the master playlist through the proxy and pick a variant.
  const masterText = await (await fetch(proxied(master))).text();
  if (!masterText.startsWith('#EXTM3U')) {
    throw new Error(`Proxy did not return a playlist: ${masterText.slice(0, 80)}`);
  }
  const variants = parseMaster(masterText, proxied(master));
  if (variants.length === 0) throw new Error('No variants in the master playlist.');
  console.log('variants:', variants.map((v) => `${v.height}p`).join(', '));

  // 3. Load the media playlist and download its first segments.
  const playlist = await loadMediaPlaylist(variants[0]!.url);
  console.log(
    'media playlist:',
    playlist.segments.length,
    'segments,',
    playlist.duration.toFixed(1),
    's total',
  );

  const limit = Number(process.env.SEGMENT_LIMIT ?? 6);
  const subset = {
    ...playlist,
    segments: playlist.segments.slice(0, limit),
    durations: playlist.durations.slice(0, limit),
    // The patched duration must describe the downloaded portion, not the whole
    // episode, so the expected value comes from the subset.
    duration: playlist.durations.slice(0, limit).reduce((sum, value) => sum + value, 0),
  };

  const parts: Uint8Array[] = [];
  await downloadSegmentsStreaming(
    subset,
    {
      concurrency: 4,
      onProgress: (progress) =>
        process.stdout.write(`\r  ${progress.completed}/${progress.total} segments, ${progress.bytes} bytes`),
    },
    (_index, data) => {
      parts.push(data);
    },
  );
  console.log();

  for (const [index, part] of parts.entries()) {
    if (part[0] !== 0x47) {
      throw new Error(`Segment ${index} is not MPEG-TS (first byte was ${part[0]}).`);
    }
  }
  console.log('  all segments start with the MPEG-TS sync byte');

  // 4. Transmux to fragmented MP4 and patch the duration.
  const fragments: Uint8Array[] = [];
  let init: Uint8Array | null = null;
  const transmux = new TransmuxStream(
    (segment) => {
      init = patchDuration(segment, subset.duration);
    },
    (fragment) => {
      fragments.push(fragment);
    },
  );
  for (const part of parts) {
    transmux.push(part);
    await transmux.flush();
  }
  const result = await transmux.finish();
  console.log(`  transmuxed ${result.fragments} fragments, ${result.init.byteLength}-byte init segment`);

  if (!init) throw new Error('No init segment was produced.');
  const output = new Uint8Array(
    init.byteLength + fragments.reduce((sum, fragment) => sum + fragment.byteLength, 0),
  );
  output.set(init, 0);
  let offset = init.byteLength;
  for (const fragment of fragments) {
    output.set(fragment, offset);
    offset += fragment.byteLength;
  }

  // The patched duration must be the real length, not the 0xffffffff sentinel
  // mux.js writes before it knows the duration.
  // Layout, relative to the box start: size(4) type(4) version(1) flags(3),
  // then for version 0 creation(4) modification(4) timescale(4) duration(4).
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const mvhd = findMvhd(view);
  if (mvhd === null) throw new Error('No mvhd box in the MP4 output.');
  const body = mvhd + 8;
  const version = view.getUint8(body);
  const timescale = view.getUint32(body + (version === 1 ? 20 : 12));
  const duration =
    version === 1 ? Number(view.getBigUint64(body + 24)) : view.getUint32(body + 16);
  const seconds = duration / timescale;
  console.log(`  mvhd duration: ${seconds.toFixed(1)}s (timescale ${timescale})`);
  if (duration === 0xffffffff || seconds > 3600) {
    throw new Error(`Duration was not patched (${seconds}s).`);
  }
  if (Math.abs(seconds - subset.duration) > 2) {
    throw new Error(`Duration ${seconds}s does not match the playlist (${subset.duration}s).`);
  }

  const target = process.env.OUTPUT ?? '/tmp/verify-download.mp4';
  await writeFile(target, output);
  console.log(`  wrote ${target} (${output.byteLength} bytes)`);
  console.log('\nOK: download, transmux and duration patch verified.');
}

void main().catch((error: unknown) => {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
