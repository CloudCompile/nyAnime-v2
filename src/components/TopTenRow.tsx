import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Play } from 'lucide-react';

interface TopTenRowProps {
  title: string;
  seeAllLink?: string;
  items: {
    id: string;
    title: string;
    image: string;
  }[];
}

/**
 * The ranked shelf. A row of posters answers "what is there?"; a numbered row
 * answers "what is everyone watching?", which is a different question and the
 * one this row exists for. Positions come from the order the catalogue feed
 * already returns, so the rank always matches the row it was taken from.
 */
const TopTenRow = ({ title, seeAllLink, items }: TopTenRowProps) => {
  const ranked = items.slice(0, 10);
  if (ranked.length === 0) return null;

  return (
    <section className="py-6 md:py-10">
      <div className="container mx-auto px-4 md:px-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded bg-red-600 text-xs font-black text-white">
              10
            </span>
            <h2 className="text-xl font-bold text-white md:text-2xl">{title}</h2>
          </div>
          {seeAllLink && (
            <Link
              to={seeAllLink}
              className="flex items-center text-sm font-medium text-anime-purple hover:underline"
            >
              See all
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="scrollbar-hide -mx-4 flex snap-x gap-1 overflow-x-auto px-4 pb-2">
          {ranked.map((item, position) => (
            <Link
              key={item.id}
              to={`/anime/${item.id}`}
              aria-label={`Number ${position + 1}: ${item.title}`}
              className="group flex shrink-0 snap-start items-end pb-1 pl-2 focus-visible:outline-offset-4"
            >
              <span
                aria-hidden
                className="rank-number select-none text-[104px] leading-[0.72] md:text-[142px]"
              >
                {position + 1}
              </span>
              <span
                className="relative -ml-5 block w-[104px] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-anime-gray shadow-lg md:-ml-7 md:w-[142px]"
                style={{ aspectRatio: '2 / 3' }}
              >
                <img
                  src={item.image}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-transparent" />
                <span className="absolute inset-x-2 bottom-2 line-clamp-2 text-xs font-medium text-white">
                  {item.title}
                </span>
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-white/90">
                    <Play className="h-4 w-4 text-black" fill="currentColor" />
                  </span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TopTenRow;
