import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

/**
 * The Apple "Liquid Glass" slider: a track with a filled progress bar and a
 * refractive glass thumb.
 *
 * The visual language is fixed (track, progress, glass thumb) so every slider
 * in the app reads the same; only the bar colours are meant to change. Those
 * are driven by the `--slider-fill` and `--slider-track` custom properties,
 * which default to the app's purple and can be overridden per instance.
 *
 * The thumb carries a magnifying-lens displacement filter, so while a pointer
 * is down it must not be clipped by the track: the glass layers live in an
 * unclipped wrapper positioned over the Radix thumb.
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    /** Colour of the filled portion of the bar. */
    fillClassName?: string
  }
>(({ className, fillClassName, value, defaultValue, min = 0, ...props }, ref) => {
  // Radix renders one thumb per entry in the value array and reads each thumb's
  // index from DOM order, so a single `<Thumb>` makes a range slider show one
  // handle and drop the other. Derive the count the same way shadcn does.
  const values = React.useMemo(() => {
    if (Array.isArray(value)) return value
    if (Array.isArray(defaultValue)) return defaultValue
    return [min]
  }, [value, defaultValue, min])

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn("slider-root relative flex w-full touch-none select-none items-center", className)}
      value={value}
      defaultValue={defaultValue}
      min={min}
      {...props}
    >
      <SliderPrimitive.Track className="slider-track relative h-2.5 w-full grow overflow-hidden rounded-full">
        <SliderPrimitive.Range className={cn("slider-progress absolute h-full", fillClassName)} />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className="slider-thumb-glass block h-6 w-6 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-anime-darker disabled:pointer-events-none"
        >
          <span className="slider-thumb-glass-filter" aria-hidden="true" />
          <span className="slider-thumb-glass-overlay" aria-hidden="true" />
          <span className="slider-thumb-glass-specular" aria-hidden="true" />
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
