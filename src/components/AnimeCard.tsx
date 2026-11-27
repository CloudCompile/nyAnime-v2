import React, { useEffect, useState } from "react";
import {
  BookmarkCheck,
  BookmarkPlus,
  Calendar,
  Heart,
  Info,
  List,
  ListVideo,
  Play,
  Star,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import {
  addToWatchlist,
  isFavorite as isStoredFavorite,
  isInWatchlist,
  removeFromWatchlist,
  toggleFavorite,
} from "@/services/localLibrary";

interface AnimeCardProps {
  id: string;
  title: string;
  image: string;
  category: string;
  rating: string;
  year: string;
  episodes?: number;
  compact?: boolean;
  progress?: number;
}

const AnimeCard = ({
  id,
  title,
  image,
  category,
  rating,
  year,
  episodes,
  compact = false,
  progress,
}: AnimeCardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isFavorite, setIsFavorite] = useState(() => isStoredFavorite(id));
  const [isSaved, setIsSaved] = useState(() => isInWatchlist(id));
  const navigate = useNavigate();

  // Both lists live in the same device store, so a change made on another card
  // or on the details page has to reach this card's buttons.
  useEffect(() => {
    const sync = () => {
      setIsFavorite(isStoredFavorite(id));
      setIsSaved(isInWatchlist(id));
    };
    sync();
    window.addEventListener("nyanime:library-changed", sync);
    return () => window.removeEventListener("nyanime:library-changed", sync);
  }, [id]);

  const openDetails = () => navigate(`/anime/${id}`);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails();
    }
  };

  const handlePlay = (event: React.MouseEvent) => {
    event.stopPropagation();
    navigate(`/anime/${id}/watch`);
  };

  const handleEpisodes = (event: React.MouseEvent) => {
    event.stopPropagation();
    navigate(`/anime/${id}/watch`);
  };

  const handleInfo = (event: React.MouseEvent) => {
    event.stopPropagation();
    openDetails();
  };

  const handleWatchlist = (event: React.MouseEvent) => {
    event.stopPropagation();
    const nowSaved = !isSaved;
    if (nowSaved) addToWatchlist(id);
    else removeFromWatchlist(id);
    setIsSaved(nowSaved);
    toast({
      title: nowSaved ? "Added to My List" : "Removed from My List",
      description: title,
      duration: 2500,
    });
  };

  const handleFavorite = (event: React.MouseEvent) => {
    event.stopPropagation();
    const nowFavorite = !isFavorite;
    toggleFavorite(id);
    setIsFavorite(nowFavorite);
    toast({
      title: nowFavorite ? "Added to favorites" : "Removed from favorites",
      description: nowFavorite
        ? `${title} is in your favorites`
        : `${title} was removed from your favorites`,
      duration: 3000,
    });
  };

  const firstGenre = category.split(",")[0].trim() || "Anime";

  const handleCategoryClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    navigate(`/anime?genre=${encodeURIComponent(firstGenre)}`);
  };

  const actionClass =
    "grid h-8 w-8 place-items-center rounded-full border border-white/30 bg-black/45 text-white transition-colors hover:border-white/70 hover:bg-white/15";

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden transition-transform duration-300 ease-out ${
        compact ? "rounded-lg" : "rounded-xl"
      } ${isHovered ? "shadow-lg" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={openDetails}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${title}`}
    >
      <div
        className="w-full"
        role="img"
        aria-label={title}
        style={{
          aspectRatio: compact ? "16/10" : "2/3",
          backgroundImage: `url(${image})`,
          backgroundSize: "cover",
          backgroundPosition: "top center",
        }}
      />

      {progress !== undefined && progress > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-20 h-1 bg-black/30">
          <div className="h-full bg-anime-purple" style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

      <div className="absolute inset-0 flex flex-col justify-end p-3 md:p-4">
        <h3 className="mb-1 line-clamp-2 text-sm font-semibold text-white md:text-base">{title}</h3>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span
            className="cursor-pointer truncate text-white/70 hover:text-white"
            onClick={handleCategoryClick}
          >
            {firstGenre}
          </span>
          <div className="flex shrink-0 items-center">
            <Star className="mr-1 h-3 w-3 text-yellow-400" fill="currentColor" />
            <span className="text-white">{rating}</span>
          </div>
        </div>
      </div>

      {/* Favourites stay reachable without hover: a touch screen and a TV
          remote never fire mouseenter. */}
      <button
        type="button"
        onClick={handleFavorite}
        aria-label={isFavorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
        aria-pressed={isFavorite}
        className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 transition-colors hover:bg-black/75"
      >
        <Heart
          className={`h-4 w-4 ${isFavorite ? "text-red-500" : "text-white"}`}
          fill={isFavorite ? "currentColor" : "none"}
        />
      </button>

      <div
        className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/70 p-3 backdrop-blur-sm transition-opacity duration-300 ${
          isHovered ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={handlePlay}
          aria-label={`Play ${title}`}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-anime-purple transition-colors hover:bg-anime-purple/90"
        >
          <Play className="h-4 w-4 text-white" fill="currentColor" />
        </button>
        <h3 className="line-clamp-2 text-center text-sm font-semibold text-white">{title}</h3>

        {/* The quick-action row a hover card is for: play, keep, browse
            episodes, or open the full page. */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleWatchlist}
            aria-label={isSaved ? `Remove ${title} from My List` : `Add ${title} to My List`}
            aria-pressed={isSaved}
            title={isSaved ? "Remove from My List" : "Add to My List"}
            className={`${actionClass} ${isSaved ? "!border-anime-purple/60 !text-anime-purple" : ""}`}
          >
            {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleEpisodes}
            aria-label={`Browse episodes of ${title}`}
            title="Episodes"
            className={actionClass}
          >
            <ListVideo className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleInfo}
            aria-label={`More information about ${title}`}
            title="More info"
            className={actionClass}
          >
            <Info className="h-4 w-4" />
          </button>
        </div>

        {!compact && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="flex items-center text-white/70">
              <Calendar className="mr-1 h-3 w-3" />
              {year}
            </span>
            {episodes ? (
              <span className="flex items-center text-white/70">
                <List className="mr-1 h-3 w-3" />
                {episodes} episodes
              </span>
            ) : null}
          </div>
        )}
        {!compact && (
          <button
            type="button"
            onClick={handleCategoryClick}
            className="max-w-full truncate rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-anime-purple/20"
          >
            {firstGenre}
          </button>
        )}
      </div>
    </div>
  );
};

export default AnimeCard;
