import React, { useState } from "react";
import { Search, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGenres } from "../hooks/useAnimeData";

// Generate years for the dropdown (current year down to 1990)
const years = Array.from({ length: new Date().getFullYear() - 1989 }, (_, i) =>
  (new Date().getFullYear() - i).toString(),
);

const statuses = ["Airing", "Completed", "Upcoming"];

interface SearchFiltersProps {
  onSearch: (filters: SearchFilters) => void;
}

export interface SearchFilters {
  query: string;
  genres: string[];
  year: string | null;
  status: string | null;
}

/**
 * Catalogue filters, laid out inline.
 *
 * They used to live behind a second popover trigger inside the "Filters" panel,
 * so the panel looked like a lone search box and most visitors never saw a
 * genre picker at all. They are now visible as soon as the panel opens.
 *
 * Genres are single-select because the API's filter takes one `genres` value;
 * a multi-select UI would silently drop every choice but the first. The rating
 * slider was removed for the same reason — the API has no rating parameter, so
 * it never filtered anything.
 */
export const SearchFilters = ({ onSearch }: SearchFiltersProps) => {
  const [filters, setFilters] = useState<SearchFilters>({
    query: "",
    genres: [],
    year: null,
    status: null,
  });

  const { data: genreList = [] } = useGenres();

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSearch(filters);
  };

  const toggleGenre = (genre: string) => {
    setFilters((previous) => ({
      ...previous,
      genres: previous.genres.includes(genre) ? [] : [genre],
    }));
  };

  const handleReset = () => {
    const cleared: SearchFilters = { query: "", genres: [], year: null, status: null };
    setFilters(cleared);
    onSearch(cleared);
  };

  const activeCount =
    filters.genres.length + (filters.year ? 1 : 0) + (filters.status ? 1 : 0);

  return (
    <form onSubmit={handleSearchSubmit} className="w-full space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
          <Input
            type="text"
            placeholder="Search anime..."
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            className="border-white/10 pl-9 text-white"
          />
        </div>
        <Button type="submit" className="shrink-0 bg-anime-purple hover:bg-anime-purple/90">
          Apply filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <div>
        <p className="mb-2 text-sm text-white/70">Genre</p>
        <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
          {genreList.length === 0 && (
            <p className="text-xs text-white/50">Genres are still loading…</p>
          )}
          {genreList.map((genre) => {
            const selected = filters.genres.includes(genre);
            return (
              <button
                key={genre}
                type="button"
                onClick={() => toggleGenre(genre)}
                aria-pressed={selected}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  selected
                    ? "bg-anime-purple text-white"
                    : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                }`}
              >
                {genre}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm text-white/70">
          Year
          <Select
            value={filters.year || "any"}
            onValueChange={(value) =>
              setFilters({ ...filters, year: value === "any" ? null : value })
            }
          >
            <SelectTrigger className="mt-1 border-white/10 text-white">
              <SelectValue placeholder="Any year" />
            </SelectTrigger>
            <SelectContent className="border-white/10 text-white">
              <SelectItem value="any">Any year</SelectItem>
              {years.map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="text-sm text-white/70">
          Status
          <Select
            value={filters.status || "any"}
            onValueChange={(value) =>
              setFilters({ ...filters, status: value === "any" ? null : value })
            }
          >
            <SelectTrigger className="mt-1 border-white/10 text-white">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent className="border-white/10 text-white">
              <SelectItem value="any">Any status</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="text-white/70 hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Reset
        </Button>
      </div>
    </form>
  );
};
