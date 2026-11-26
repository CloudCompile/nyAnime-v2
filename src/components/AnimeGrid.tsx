
import React from 'react';
import { Link } from 'react-router-dom';
import AnimeCard from './AnimeCard';
import { ChevronRight } from 'lucide-react';

interface AnimeGridProps {
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

const AnimeGrid = ({ title, seeAllLink, animeList }: AnimeGridProps) => {
  const hasHeading = Boolean(title || seeAllLink);

  return (
    <section className={hasHeading ? 'py-8 md:py-12' : 'py-2 md:py-4'}>
      <div className="container mx-auto px-4 md:px-6">
        {/* An empty heading left a dead band of padding above grids that have
            no title, which is how the genre pages opened. */}
        {hasHeading && (
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">{title}</h2>
            {seeAllLink && (
              <Link
                to={seeAllLink}
                className="flex items-center text-sm font-medium text-anime-purple hover:underline"
              >
                See All <ChevronRight className="h-4 w-4 ml-1" />
              </Link>
            )}
          </div>
        )}
        
        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-6">
          {animeList.map((anime) => (
            <AnimeCard 
              key={anime.id}
              id={anime.id}
              title={anime.title}
              image={anime.image}
              category={anime.category}
              rating={anime.rating}
              year={anime.year}
              episodes={anime.episodes}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default AnimeGrid;
