import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import AnimeCard from './AnimeCard';

interface CategoryRowProps {
  title: string;
  seeAllLink?: string;
  animeList: {
    id: string;
    title: string;
    image: string;
    category: string;
    rating: string;
    year: string;
    episodes?: number;
  }[];
}

/**
 * A horizontally paginated shelf.
 *
 * Arrows page by most of a viewport and are disabled at either end, so a click
 * always does something visible. The scrollbar is hidden in favour of the
 * arrows and a soft edge fade, and a "see all" tile closes the row instead of
 * leaving a dead gap after the last card.
 */
const CategoryRow = ({ title, seeAllLink, animeList }: CategoryRowProps) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const syncArrows = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setCanScroll({
      left: node.scrollLeft > 8,
      right: max > 8 && node.scrollLeft < max - 8,
    });
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    syncArrows();
    node.addEventListener('scroll', syncArrows, { passive: true });
    window.addEventListener('resize', syncArrows);
    return () => {
      node.removeEventListener('scroll', syncArrows);
      window.removeEventListener('resize', syncArrows);
    };
  }, [syncArrows, animeList.length]);

  const scroll = (direction: 'left' | 'right') => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({
      left: (direction === 'left' ? -1 : 1) * node.clientWidth * 0.85,
      behavior: 'smooth',
    });
  };

  const arrowClass =
    'absolute top-1/2 z-20 -translate-y-1/2 grid h-10 w-10 place-items-center rounded-full bg-black/70 text-white shadow-lg backdrop-blur transition-all duration-300 hover:bg-black/90 disabled:pointer-events-none disabled:opacity-0';

  return (
    <section className="py-6 md:py-10">
      <div className="container mx-auto px-4 md:px-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white md:text-2xl">{title}</h2>
          {seeAllLink && (
            <Link
              to={seeAllLink}
              className="flex items-center text-sm font-medium text-anime-purple hover:underline"
            >
              See All
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="group relative">
          <div
            ref={scrollerRef}
            role="group"
            aria-label={title}
            tabIndex={0}
            className="scrollbar-hide -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 focus-visible:outline-none"
          >
            {animeList.map((anime) => (
              <div key={anime.id} className="w-[180px] flex-shrink-0 snap-start sm:w-[220px] md:w-[250px]">
                <AnimeCard
                  id={anime.id}
                  title={anime.title}
                  image={anime.image}
                  category={anime.category}
                  rating={anime.rating}
                  year={anime.year}
                  episodes={anime.episodes}
                  compact
                />
              </div>
            ))}

            {seeAllLink && (
              <Link
                to={seeAllLink}
                className="flex w-[120px] flex-shrink-0 snap-start flex-col items-center justify-center gap-2 self-stretch rounded-xl border border-white/10 bg-white/5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white md:w-[150px]"
              >
                <ChevronRight className="h-6 w-6" />
                See all
              </Link>
            )}
          </div>

          {/* Edge fades hint that the shelf continues without covering art. */}
          {canScroll.left && (
            <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-anime-darker to-transparent" />
          )}
          {canScroll.right && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-anime-darker to-transparent" />
          )}

          {/* Visible on touch screens and TVs, where hover never happens. */}
          <button
            type="button"
            onClick={() => scroll('left')}
            disabled={!canScroll.left}
            className={`${arrowClass} left-0 opacity-90 md:-left-3 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100`}
            aria-label={`Scroll ${title} left`}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          <button
            type="button"
            onClick={() => scroll('right')}
            disabled={!canScroll.right}
            className={`${arrowClass} right-0 opacity-90 md:-right-3 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100`}
            aria-label={`Scroll ${title} right`}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default CategoryRow;
