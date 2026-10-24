/**
 * Runtime bridge for the vendored `liquid-glass-js` library.
 *
 * `container.js`, `button.js` and `controls.js` are copied verbatim from
 * https://github.com/dashersw/liquid-glass-js into `public/liquid-glass/` and
 * loaded as plain scripts from `index.html`. Their classes are not modules, so
 * everything here talks to them through `window` (the inline bootstrap in
 * `index.html` re-exposes them, because `class` declarations are lexical
 * globals rather than properties of `window`).
 *
 * Three properties of the upstream code shape this file:
 *
 * 1. Every `Container` owns a WebGL context, and browsers only keep ~16 of them
 *    alive per page (measured: 16 live, the rest lost and rendered transparent).
 *    A catalogue page has far more surfaces than that, so mounting one context
 *    per surface would leave most of the UI blank. `acquireSlot`/`releaseSlot`
 *    keep the number of live contexts under the browser cap and recycle the
 *    least recently seen surface; a surface that loses its slot keeps its styled
 *    background and re-acquires a context when it scrolls back into view.
 *
 * 2. `setupShader` reads `window.glassControls?.rimIntensity || 0.05`, so a rim
 *    intensity of exactly 0 silently becomes 0.05. The configured values are
 *    re-applied after the shader is built to pin them.
 *
 * 3. `controls.js` builds its demo panel on load, and that panel is itself a
 *    `Container`. It is mounted hidden so the file initialises cleanly, and its
 *    context is handed straight back so it does not eat into the budget.
 */

/** The exact Liquid Glass parameter set requested for the site. */
export const GLASS_SETTINGS = {
  edgeIntensity: 0.009,
  rimIntensity: 0.0,
  baseIntensity: 0.011,
  edgeDistance: 0.05,
  rimDistance: 0.5,
  baseDistance: 0.15,
  cornerBoost: 0.1,
  rippleEffect: 0.28,
  blurRadius: 1.0,
  tintOpacity: 0.29,
} as const;

export type GlassShape = 'rounded' | 'circle' | 'pill';

export interface GlassOptions {
  shape?: GlassShape;
  /** Corner radius in CSS pixels for `rounded` shapes. */
  borderRadius?: number;
}

type UniformLocation = WebGLUniformLocation | null;

interface GlassInstance {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  borderRadius: number;
  type: GlassShape;
  gl: WebGLRenderingContext | null;
  gl_refs: Record<string, UniformLocation>;
  webglInitialized: boolean;
  render?: () => void;
  warp?: boolean;
}

/** The parameter object `controls.js` installs on `window`. */
interface GlassControls {
  edgeIntensity: number;
  rimIntensity: number;
  baseIntensity: number;
  edgeDistance: number;
  rimDistance: number;
  baseDistance: number;
  cornerBoost: number;
  rippleEffect: number;
  blurRadius: number;
  tintOpacity: number;
  warp: boolean;
  hideButtons: boolean;
}

interface GlassContainerConstructor {
  new (options?: { borderRadius?: number; type?: GlassShape; tintOpacity?: number }): GlassInstance;
  prototype: GlassInstance;
  instances: GlassInstance[];
  pageSnapshot: HTMLCanvasElement | null;
  isCapturing: boolean;
  waitingForSnapshot: GlassInstance[];
}

/**
 * The globals the vendored scripts publish. `index.html` re-exposes the class
 * declarations here because `class` creates a lexical binding, not a property
 * of `window`.
 */
interface GlassGlobals {
  Container?: GlassContainerConstructor;
  Button?: unknown;
  glassControls?: GlassControls;
  controlsContainer?: { updateSizeFromDOM?: () => void };
  updateAllGlassInstances?: () => void;
  __nyanimeRefreshGlass?: () => void;
}

const glassWindow = window as unknown as GlassGlobals;

/** Live WebGL contexts kept mounted at once. Browsers cap this near 16. */
const MAX_LIVE_CONTEXTS = 13;

const live = new Set<number>();
/** Visible surfaces that want a context but could not get one yet. */
const waiting: Array<() => void> = [];
let nextSlotId = 1;
let bridgeReady = false;

function upstream(): GlassContainerConstructor | undefined {
  return glassWindow.Container;
}

/**
 * Hand a freed context to the longest-waiting visible surface.
 *
 * Slots are never taken from a surface that is still on screen: doing so would
 * blank a visible surface with no event to bring it back. A surface that cannot
 * get a context waits here and is promoted as soon as one is released.
 */
function promoteNextWaiter() {
  const next = waiting.shift();
  if (next) queueMicrotask(next);
}

/**
 * Read the host's computed corner radius so a rounded surface matches whatever
 * Tailwind or the design tokens gave it. Falls back to 16px.
 */
function readHostRadius(host: HTMLElement): number {
  const raw = getComputedStyle(host).borderTopLeftRadius;
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 16;
}

/**
 * Re-apply the configured uniforms. `setupShader` finishes by setting every
 * uniform, so overriding the prototype and calling through afterwards is enough
 * to fix the `rimIntensity || 0.05` fallback without touching the vendored file.
 */
function applySettings(instance: GlassInstance) {
  const gl = instance.gl;
  const refs = instance.gl_refs;
  if (!gl || !refs || !refs.edgeIntensityLoc) return;

  const s = GLASS_SETTINGS;
  gl.uniform1f(refs.edgeIntensityLoc, s.edgeIntensity);
  gl.uniform1f(refs.rimIntensityLoc, s.rimIntensity);
  gl.uniform1f(refs.baseIntensityLoc, s.baseIntensity);
  gl.uniform1f(refs.edgeDistanceLoc, s.edgeDistance);
  gl.uniform1f(refs.rimDistanceLoc, s.rimDistance);
  gl.uniform1f(refs.baseDistanceLoc, s.baseDistance);
  gl.uniform1f(refs.cornerBoostLoc, s.cornerBoost);
  gl.uniform1f(refs.rippleEffectLoc, s.rippleEffect);
  gl.uniform1f(refs.blurRadiusLoc, s.blurRadius);
  gl.uniform1f(refs.tintOpacityLoc, s.tintOpacity);
  gl.uniform1f(refs.warpLoc, 0);
}

/** Install the settings override once, before any instance renders. */
export function initLiquidGlass() {
  if (bridgeReady) return;
  const Container = upstream();
  if (!Container) return;
  bridgeReady = true;

  const settings: GlassControls = {
    ...GLASS_SETTINGS,
    warp: false,
    hideButtons: false,
  };
  glassWindow.glassControls = settings;

  const originalSetup = Container.prototype.setupShader;
  Container.prototype.setupShader = function (this: GlassInstance, image: HTMLImageElement) {
    // A container whose context could not be created (the browser's WebGL
    // context budget is exhausted) must not try to compile shaders against it.
    if (!this.gl) return;
    originalSetup.call(this, image);
    applySettings(this);
  };

  reclaimControlsPanel();
}

/**
 * The demo control panel from controls.js is not part of the site's chrome, and
 * it is itself a glass container. Reclaim its WebGL context so it does not take
 * one of the few the page gets.
 *
 * controls.js builds the panel on `DOMContentLoaded`, which is after a module
 * entry point has already run, so this is retried on that event (and on `load`,
 * for a cached page where the panel appears earlier).
 */
function reclaimControlsPanel() {
  const panel = glassWindow.controlsContainer as GlassInstance | undefined;
  if (!panel?.element) return;
  disposeInstance(panel);
  panel.element.remove();
  // controls.js holds a deferred reference to this object; leave a no-op stub
  // so its own follow-up call does not throw.
  glassWindow.controlsContainer = { updateSizeFromDOM() {} };
}

if (typeof document !== 'undefined') {
  reclaimControlsPanel();
  if (document.readyState !== 'complete') {
    document.addEventListener('DOMContentLoaded', reclaimControlsPanel, { once: true });
    window.addEventListener('load', reclaimControlsPanel, { once: true });
  }
}

/** Update the shared parameter set and push it to every live instance. */
export function setGlassSettings(patch: Partial<typeof GLASS_SETTINGS>) {
  Object.assign(glassWindow.glassControls ?? {}, patch);
  glassWindow.updateAllGlassInstances?.();
}

export function isGlassAvailable(): boolean {
  return typeof glassWindow.Container === 'function' && typeof glassWindow.Button === 'function';
}

/**
 * Claim one of the limited WebGL slots.
 *
 * A visible surface that cannot get a slot queues here and is promoted when
 * another releases one; nothing visible is ever evicted, because that would
 * blank a surface that has no further event to bring it back.
 */
export function acquireSlot(onAvailable: () => void): number | null {
  if (!isGlassAvailable()) return null;

  if (live.size >= MAX_LIVE_CONTEXTS) {
    waiting.push(onAvailable);
    return null;
  }

  const id = nextSlotId++;
  live.add(id);
  return id;
}

export function releaseSlot(id: number | null) {
  if (id === null) return;
  if (!live.delete(id)) return;
  promoteNextWaiter();
}

export function cancelWaiter(onAvailable: () => void) {
  const index = waiting.indexOf(onAvailable);
  if (index > -1) waiting.splice(index, 1);
}

/**
 * Tear a glass instance down and free its context.
 *
 * The upstream class registers a `scroll` listener per instance that is never
 * removed. Dropping the instance from `Container.instances` and clearing
 * `gl_refs` makes that listener a no-op, and `loseContext` hands the context
 * back to the browser immediately instead of waiting for GC.
 */
export function disposeInstance(instance: GlassInstance) {
  const Container = upstream();
  if (!Container) return;

  const list: GlassInstance[] = Container.instances ?? [];
  const index = list.indexOf(instance);
  if (index > -1) list.splice(index, 1);

  const gl = instance.gl;
  instance.gl_refs = {};
  instance.webglInitialized = false;
  instance.render = undefined;
  instance.gl = null;
  try {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* context already gone */
  }
}

/**
 * Create a glass surface element sized by CSS. The returned instance has not
 * been attached to the document yet, so the caller controls mount order.
 */
export function createGlassInstance(
  host: HTMLElement,
  options: GlassOptions = {},
): GlassInstance | null {
  const Container = upstream();
  if (!Container) return null;

  const type = options.shape ?? 'rounded';
  const radius = options.borderRadius ?? readHostRadius(host);
  const instance: GlassInstance = new Container({
    borderRadius: radius,
    type,
    tintOpacity: GLASS_SETTINGS.tintOpacity,
  });

  const canvas = instance.canvas;
  // The vendored markup assumes the canvas *is* the surface. Here it is the
  // background of a styled app element, so it fills the host and drops the
  // inline shadow the library would otherwise draw on top of the app's own.
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '0';
  canvas.style.boxShadow = 'none';
  canvas.style.borderRadius = 'inherit';
  canvas.style.pointerEvents = 'none';

  instance.element.style.position = 'absolute';
  instance.element.style.inset = '0';
  instance.element.style.padding = '0';
  instance.element.style.gap = '0';
  instance.element.style.borderRadius = 'inherit';
  instance.element.style.pointerEvents = 'none';
  // Negative z-index inside the host's own stacking context paints above the
  // host background but below its content, so text stays legible on the glass.
  instance.element.style.zIndex = '-1';

  host.appendChild(instance.element);
  return instance;
}

/** Force a glass instance to match the host's current CSS box. */
export function syncInstanceSize(instance: GlassInstance) {
  const gl = instance.gl;
  const refs = instance.gl_refs;
  const host = instance.element?.parentElement;
  if (!gl || !refs || !refs.resolutionLoc || !host) return;

  const rect = host.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const radius =
    instance.type === 'circle'
      ? Math.min(width, height) / 2
      : instance.type === 'pill'
        ? height / 2
        : Math.min(instance.borderRadius || 24, Math.min(width, height) / 2);

  instance.width = width;
  instance.height = height;
  instance.borderRadius = radius;

  const canvas = instance.canvas;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.style.borderRadius = 'inherit';
  instance.element.style.borderRadius = 'inherit';

  gl.viewport(0, 0, width, height);
  gl.uniform2f(refs.resolutionLoc, width, height);
  gl.uniform1f(refs.borderRadiusLoc, radius);
}

/**
 * Attach a live glass surface to `host` while it is on screen and holding a
 * slot. Returns a detach function.
 *
 * The canvas is positioned against the host, so a static host is promoted to
 * `relative`; the original value is restored on detach.
 */
export function attachGlassSurface(host: HTMLElement, options: GlassOptions = {}) {
  initLiquidGlass();
  if (!isGlassAvailable()) return () => {};

  let disposed = false;
  let instance: GlassInstance | null = null;
  let slot: number | null = null;
  let observer: IntersectionObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let previousPosition: string | null = null;

  const mount = () => {
    if (disposed || instance) return;
    if (getComputedStyle(host).position === 'static') {
      previousPosition = host.style.position;
      host.style.position = 'relative';
    }
    instance = createGlassInstance(host, options);
    if (!instance) {
      if (previousPosition !== null) host.style.position = previousPosition;
      previousPosition = null;
      return;
    }
    resizeObserver = new ResizeObserver(() => {
      if (instance) syncInstanceSize(instance);
    });
    resizeObserver.observe(host);
  };

  const unmount = () => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (instance) {
      disposeInstance(instance);
      instance.element.remove();
      instance = null;
    }
    if (previousPosition !== null) {
      host.style.position = previousPosition;
      previousPosition = null;
    }
  };

  const activate = () => {
    if (disposed || instance) return;
    const acquired = acquireSlot(() => {
      slot = null;
      activate();
    });
    if (acquired === null) return;
    slot = acquired;
    mount();
  };

  const deactivate = () => {
    cancelWaiter(activate);
    releaseSlot(slot);
    slot = null;
    unmount();
  };

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) activate();
      else deactivate();
    },
    { rootMargin: '200px 0px', threshold: 0 },
  );
  observer.observe(host);

  return () => {
    disposed = true;
    observer?.disconnect();
    deactivate();
  };
}

/** Surfaces declared by class in the app's own markup. */
const ENHANCED_SELECTOR = '.glass, .glass-card, .glass-surface';

/**
 * Attach glass to every element carrying a glass class, and to any such element
 * added or re-classed later.
 *
 * This is what lets the existing markup drive the library: a component only has
 * to put `glass` or `glass-card` on an element, and the enhancer gives it a
 * live surface (budget permitting) without the component knowing about WebGL.
 */
export function initGlassEnhancer() {
  initLiquidGlass();
  if (!isGlassAvailable()) return () => {};

  const attached = new WeakMap<HTMLElement, () => void>();
  const managed = new Set<HTMLElement>();

  const detachHost = (host: HTMLElement) => {
    const detach = attached.get(host);
    if (detach) {
      detach();
      attached.delete(host);
    }
    managed.delete(host);
  };

  const attachHost = (host: HTMLElement) => {
    attached.set(host, attachGlassSurface(host));
    managed.add(host);
  };

  const refresh = (element: Element) => {
    const host = element as HTMLElement;
    if (host.matches(ENHANCED_SELECTOR)) {
      if (!attached.has(host)) attachHost(host);
    } else {
      detachHost(host);
    }
  };

  const refreshTree = (root: Element) => {
    refresh(root);
    root.querySelectorAll(ENHANCED_SELECTOR).forEach(refresh);
  };

  refreshTree(document.body);

  // `Container.pageSnapshot` is a single page-wide screenshot that every
  // surface refracts, captured on the first mount and then cached forever. On
  // an SPA that would leave the glass showing whatever the page looked like
  // when the app first booted, so the snapshot is invalidated and the surfaces
  // re-mounted whenever the route changes.
  const invalidateSnapshot = () => {
    const Container = upstream();
    if (!Container) return;
    Container.pageSnapshot = null;
    Container.isCapturing = false;
    Container.waitingForSnapshot = [];
    // Iterate a copy: detach/attach re-adds each host to `managed`, and
    // re-adding during a live Set iteration would revisit it forever.
    for (const host of Array.from(managed)) {
      detachHost(host);
      if (host.isConnected && host.matches(ENHANCED_SELECTOR)) attachHost(host);
    }
  };

  let refreshTimer: number | null = null;
  const scheduleSnapshotRefresh = () => {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      invalidateSnapshot();
    }, 250);
  };

  glassWindow.__nyanimeRefreshGlass = scheduleSnapshotRefresh;

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        refresh(record.target);
        continue;
      }
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) refreshTree(node as Element);
      });
      record.removedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const host = node as HTMLElement;
        detachHost(host);
        host.querySelectorAll?.(ENHANCED_SELECTOR).forEach((child) => detachHost(child as HTMLElement));
      });
    }
  });

  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  // A first capture happens while images may still be in flight, which would
  // leave the glass refracting empty boxes. Re-capture once the page settles.
  if (document.readyState !== 'complete') {
    window.addEventListener('load', scheduleSnapshotRefresh, { once: true });
  }

  return () => {
    mutations.disconnect();
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    delete glassWindow.__nyanimeRefreshGlass;
  };
}
