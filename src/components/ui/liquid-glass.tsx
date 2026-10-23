import React from 'react';

/**
 * SVG filter definitions for the Liquid Glass surfaces.
 *
 * The displacement filter gives the glass layers their refractive, "liquid"
 * edge. It is declared once for the whole document because duplicating the
 * filter per component would cost a compositing layer each.
 */
export const LiquidGlassDefs: React.FC = () => (
  <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute' }}>
    <defs>
      <filter id="lg-dist" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="2" seed="92" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2" result="blurred" />
        <feDisplacementMap in="SourceGraphic" in2="blurred" scale="70" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="mini-liquid-lens" x="-50%" y="-50%" width="200%" height="200%">
        <feImage
          x="0"
          y="0"
          result="normalMap"
          xlinkHref="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><radialGradient id='invmap' cx='50%' cy='50%' r='75%'><stop offset='0%' stop-color='rgb(128,128,255)'/><stop offset='90%' stop-color='rgb(255,255,255)'/></radialGradient><rect width='100%' height='100%' fill='url(%23invmap)'/></svg>"
        />
        <feDisplacementMap in="SourceGraphic" in2="normalMap" scale="-252" xChannelSelector="R" yChannelSelector="G" result="displaced" />
        <feMerge>
          <feMergeNode in="displaced" />
        </feMerge>
      </filter>
    </defs>
  </svg>
);

export default LiquidGlassDefs;
