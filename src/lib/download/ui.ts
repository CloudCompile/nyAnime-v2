/**
 * Open state for the global downloads dock.
 *
 * The dock lives in `App`, while the buttons that open it live in the header,
 * the watch page and the library. A tiny external store keeps those in sync
 * without threading props or adding a context provider.
 */
type Listener = (open: boolean) => void;

let open = false;
const listeners = new Set<Listener>();

export function isDownloadDockOpen(): boolean {
  return open;
}

export function setDownloadDockOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener(open);
}

export function openDownloadDock(): void {
  setDownloadDockOpen(true);
}

export function toggleDownloadDock(): void {
  setDownloadDockOpen(!open);
}

export function subscribeDownloadDock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
