import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Info, Play, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface BillboardSlide {
  id: string;
  title: string;
  image: string;
  synopsis?: string;
  type?: string;
  episodes?: number;
  rating?: string;
  audio?: string;
}

interface HeroBillboardProps {
  slides: BillboardSlide[];
}

/**
 * A billboard, not a slideshow.
 *
 * The previous hero showed a single spotlight with no way to browse the rest of
 * the curated list. This one keeps every spotlight reachable with explicit
 * arrows and dots — the way a streaming service features several titles — but
 * deliberately does not auto-advance. An interval rotation keeps a large
 * composited layer alive and wakes the CPU every few seconds for a change the
 * viewer did not ask for; a manual choice costs one click and never fights the
 * reader for attention.
 */
const HeroBillboard = ({ slides }: HeroBillboardProps) => {
  const [index, setIndex] = useState(0);
  const count = slides.length;

  // A shorter list must never leave the pointer past the end.
  useEffect(() => {
    setIndex((current) => (count === 0 || current < count ? current : 0));
  }, [count]);

  const go = useCallback(
    (direction: -1 | 1) => {
      if (count < 2) return;
      setIndex((current) => (current + direction + count) % count);
    },
    [count],
  );

  const slide = slides[index];
  if (!slide) return null;

  const meta = [
    slide.rating && slide.rating !== 'N/A' ? slide.rating : null,
    slide.type,
    slide.episodes ? `${slide.episodes} episodes` : null,
    slide.audio,
  ].filter((value): value is string => Boolean(value));

  return (
    <section
      className="group/hero relative h-[64vh] min-h-[430px] w-full overflow-hidden md:h-[78vh]"
      aria-roledescription="carousel"
      aria-label="Featured titles"
    >
      <div
        key={slide.id}
        className="absolute inset-0 animate-fade-in"
        style={{
          backgroundImage: `url('${slide.image}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 22%',
        }}
      />
      {/* Two scrims, not a card: artwork stays visible on the right while the
          copy on the left keeps enough contrast on any poster. */}
      <div className="absolute inset-0 bg-gradient-to-r from-anime-darker via-anime-darker/85 to-anime-darker/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-anime-darker via-transparent to-anime-darker/50" />

      <div className="relative z-10 flex h-full items-end">
        <div className="container mx-auto px-4 pb-16 md:px-6 md:pb-24">
          <div key={slide.id} className="max-w-2xl animate-fade-in">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-anime-purple px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                #{index + 1} Spotlight
              </span>
              {meta.map((item) => (
                <span
                  key={item}
                  className="rounded border border-white/25 px-2 py-0.5 text-[11px] text-white/80"
                >
                  {item}
                </span>
              ))}
              <span className="flex items-center gap-1 text-white/80">
                <Star className="h-3 w-3 text-yellow-400" fill="currentColor" />
                {slide.rating && slide.rating !== 'N/A' ? slide.rating : 'New'}
              </span>
            </div>

            <h1 className="mb-3 line-clamp-2 text-4xl font-black leading-[1.05] text-white md:text-6xl">
              {slide.title}
            </h1>

            {slide.synopsis && (
              <p className="mb-6 line-clamp-3 max-w-xl text-sm leading-relaxed text-white/75 md:text-base">
                {slide.synopsis}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="bg-white text-black hover:bg-white/90 focus-visible:ring-white"
              >
                <Link to={`/anime/${slide.id}/watch`}>
                  <Play className="mr-2 h-5 w-5" fill="currentColor" />
                  Play
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="bg-white/15 hover:bg-white/25">
                <Link to={`/anime/${slide.id}`}>
                  <Info className="mr-2 h-5 w-5" />
                  More info
                </Link>
              </Button>
            </div>

            {count > 1 && (
              <div className="mt-6 flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  {slides.map((item, position) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setIndex(position)}
                      aria-label={`Show ${item.title}`}
                      aria-current={position === index}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        position === index
                          ? 'w-6 bg-white'
                          : 'w-2 bg-white/40 hover:bg-white/70'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[11px] tabular-nums text-white/40">
                  {index + 1} / {count}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {count > 1 && (
        <div className="absolute bottom-6 right-4 z-20 hidden items-center gap-2 md:right-8 md:flex">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous featured title"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/40 text-white/80 backdrop-blur transition-colors hover:bg-black/70 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next featured title"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/40 text-white/80 backdrop-blur transition-colors hover:bg-black/70 hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </section>
  );
};

export default HeroBillboard;
