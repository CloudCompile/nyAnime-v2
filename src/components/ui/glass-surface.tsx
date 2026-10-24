import React, { useEffect, useRef } from 'react';
import { GLASS_CONFIG_JSON, initGlass } from '@/lib/liquidGlass';

interface GlassSurfaceProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  config?: string;
}

/**
 * Wraps children in a LiquidGlass root. The glass element is the first child
 * (with data-config), and any background content is a sibling.
 */
export function GlassSurface({ children, className, style, config }: GlassSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const glass = glassRef.current;
    if (!root || !glass) return;

    let instance: any = null;
    let cancelled = false;

    initGlass(root, [glass]).then((inst) => {
      if (!cancelled) instance = inst;
    });

    return () => {
      cancelled = true;
      instance?.destroy?.();
    };
  }, []);

  return (
    <div ref={rootRef} className={className} style={{ position: 'relative', ...style }}>
      {/* Background content captured by the shader */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }} aria-hidden />
      {/* Glass element */}
      <div
        ref={glassRef}
        data-config={config ?? GLASS_CONFIG_JSON}
        style={{ position: 'relative', zIndex: 1 }}
      >
        {children}
      </div>
    </div>
  );
}

export default GlassSurface;