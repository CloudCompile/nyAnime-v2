/**
 * Runtime bridge for @ybouane/liquidglass.
 *
 * Unlike the previous dashersw library (which scanned the DOM for `.glass`
 * classes and attached a WebGL surface to each), this library requires each
 * glass element to be a direct child of its own root container. We wrap each
 * glass surface in a <GlassSurface> React component that creates its own root.
 *
 * Configuration is passed via `data-config` JSON on the glass element.
 */

import { LiquidGlass } from '@ybouane/liquidglass';

export const GLASS_SETTINGS = {
  blurAmount: 0.25,
  refraction: 0.69,
  chromAberration: 0.05,
  edgeHighlight: 0.05,
  specular: 0.0,
  fresnel: 1.0,
  distortion: 0.0,
  cornerRadius: 16,
  zRadius: 40,
  opacity: 1.0,
  saturation: 0.0,
  tintStrength: 0.0,
  brightness: 0.0,
  shadowOpacity: 0.3,
  shadowSpread: 10,
  shadowOffsetY: 1,
  floating: false,
  button: false,
  bevelMode: 0,
} as const;

export type GlassConfig = typeof GLASS_SETTINGS;

export const GLASS_CONFIG_JSON = JSON.stringify(GLASS_SETTINGS);

/**
 * Initialize a LiquidGlass instance on a root element containing glass children.
 * Returns a destroy function.
 */
export async function initGlass(root: HTMLElement, glassElements: HTMLElement[]) {
  try {
    const instance = await LiquidGlass.init({ root, glassElements });
    return instance;
  } catch (e) {
    console.error('LiquidGlass init failed:', e);
    return null;
  }
}

export { LiquidGlass };