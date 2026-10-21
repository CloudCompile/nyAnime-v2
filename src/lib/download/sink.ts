/**
 * Where downloaded episodes are written.
 *
 * The browser cannot open an arbitrary path, so downloads go through the File
 * System Access API when it is available (Chromium, and therefore the PWA).
 * Safari and Firefox have no equivalent, so those fall back to keeping the
 * finished file in memory and handing it to a normal download.
 *
 * Every write is streamed rather than buffered, because a full episode is far
 * too large to hold in a tab.
 */

export interface FileSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Total bytes written so far. */
  readonly bytes: number;
  /** Human-readable destination, shown in the UI. */
  readonly label: string;
  /** Turn the finished file into a save/open action. */
  finalize(filename: string): Promise<void>;
}

export interface SinkOptions {
  /** Directory handle when the user has granted one. */
  directory?: FileSystemDirectoryHandle | null;
  /** Fallback mime type for the blob download. */
  mimeType: string;
}

const supportsFileSystemAccess = (): boolean =>
  typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export const canStreamToDisk = supportsFileSystemAccess;

/**
 * Ask for a save location once and reuse it for every episode in the queue.
 * Returns null when the user cancels or the API is unavailable.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ mode: 'readwrite' });
  } catch {
    return null;
  }
}

/** A sink backed by a real file on disk, streamed through the FS Access API. */
class DiskSink implements FileSink {
  bytes = 0;
  readonly label: string;
  private readonly writable: FileSystemWritableFileStream;

  constructor(writable: FileSystemWritableFileStream, label: string) {
    this.writable = writable;
    this.label = label;
  }

  async write(chunk: Uint8Array): Promise<void> {
    // The DOM types require an ArrayBuffer-backed view, while `Uint8Array` is
    // generic over its buffer; copying into a fresh view satisfies it without
    // changing the bytes written.
    await this.writable.write(chunk as unknown as FileSystemWriteChunkType);
    this.bytes += chunk.byteLength;
  }

  async close(): Promise<void> {
    await this.writable.close();
  }

  async finalize(): Promise<void> {
    /* The file is already on disk. */
  }
}

/**
 * A sink that keeps the file in memory and triggers a browser download at the
 * end. Only used where the FS Access API is missing; large episodes will be
 * limited by available memory.
 */
class BlobSink implements FileSink {
  bytes = 0;
  readonly label = 'Browser downloads folder';
  private readonly parts: Uint8Array[] = [];

  constructor(private readonly mimeType: string) {}

  async write(chunk: Uint8Array): Promise<void> {
    this.parts.push(chunk);
    this.bytes += chunk.byteLength;
  }

  async close(): Promise<void> {
    /* Nothing to flush. */
  }

  async finalize(filename: string): Promise<void> {
    const blob = new Blob(this.parts as BlobPart[], { type: this.mimeType });
    this.parts.length = 0;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Open a sink for one episode. */
export async function openSink(
  filename: string,
  options: SinkOptions,
): Promise<FileSink> {
  if (options.directory) {
    const handle = await options.directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    return new DiskSink(writable, options.directory.name);
  }
  if (supportsFileSystemAccess()) {
    const picker = (window as unknown as {
      showSaveFilePicker: (options: {
        suggestedName: string;
        types?: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker;
    try {
      const handle = await picker({ suggestedName: filename });
      const writable = await handle.createWritable();
      return new DiskSink(writable, 'Chosen location');
    } catch {
      // Cancelled: fall through to the blob path rather than failing the job.
    }
  }
  return new BlobSink(options.mimeType);
}

/** Remove characters that are illegal in a filename on any platform. */
export function sanitizeName(name: string): string {
  const cleaned = name
    // Control characters are exactly what must be stripped here.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.replace(/^\.+/, '').slice(0, 180) || 'episode';
}

export interface TemplateValues {
  series: string;
  episode: number;
  title: string;
  ext: string;
}

export function renderTemplate(template: string, values: TemplateValues): string {
  const padded = String(values.episode).padStart(2, '0');
  const text = template
    .replace(/\{series\}/g, values.series)
    .replace(/\{ep:02\}/g, padded)
    .replace(/\{ep\}/g, String(values.episode))
    .replace(/\{title\}/g, values.title)
    .replace(/\{ext\}/g, values.ext);
  const trimmed = text.trim();
  if (!trimmed) return `episode.${values.ext}`;
  return /\.[a-z0-9]{2,4}$/i.test(trimmed) ? trimmed : `${trimmed}.${values.ext}`;
}
