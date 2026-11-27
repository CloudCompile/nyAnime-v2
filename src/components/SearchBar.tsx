import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Search, X } from "lucide-react";
import { useAnimeSuggestions } from "../hooks/useAnimeData";

const RECENT_SEARCHES_KEY = "nyanime.recent-searches";
const MAX_RECENT_SEARCHES = 5;

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/**
 * Header search.
 *
 * Three details matter more than the visual:
 *
 * - The results panel must not be clipped by the pill's rounded corners, so it
 *   is a sibling of the pill rather than a child of it.
 * - A TV remote's on-screen keyboard often has no Enter key, so submitting is a
 *   real, focusable button — not just an implicit form submit.
 * - On narrow screens the collapsed icon has to be a button that expands the
 *   field, because a visually hidden input cannot be focused by touch or D-pad.
 */
const SearchBar = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsFocused(false);
        setIsExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const timerId = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timerId);
  }, [searchQuery]);

  // Expanding the compact field is useless unless the caret lands in it.
  useEffect(() => {
    if (isExpanded) inputRef.current?.focus();
  }, [isExpanded]);

  const { data: searchResults = [], isLoading } = useAnimeSuggestions(debouncedQuery, 8);

  const close = useCallback(() => {
    setIsFocused(false);
    setIsExpanded(false);
    inputRef.current?.blur();
  }, []);

  const handleClear = () => {
    setSearchQuery("");
    setDebouncedQuery("");
    inputRef.current?.focus();
  };

  // Searches are remembered per device, the same way the rest of the library
  // is: no account, no sync.
  const rememberSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setRecentSearches((current) => {
        const next = [
          trimmed,
          ...current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
        ].slice(0, MAX_RECENT_SEARCHES);
        try {
          localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
        } catch {
          // Storage can be unavailable; the list still works for this session.
        }
        return next;
      });
    },
    [],
  );

  const clearRecentSearches = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Nothing stored; nothing to remove.
    }
  };

  const submitQuery = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    rememberSearch(trimmed);
    navigate(`/anime?query=${encodeURIComponent(trimmed)}`);
    setSearchQuery("");
    setDebouncedQuery("");
    close();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    submitQuery(searchQuery);
  };

  const handleResultClick = (animeId: string) => {
    navigate(`/anime/${animeId}`);
    setSearchQuery("");
    setDebouncedQuery("");
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  const expanded = isExpanded || isFocused;
  const showPanel = isFocused && (searchQuery.trim().length > 0 || recentSearches.length > 0);

  return (
    <div ref={searchContainerRef} onKeyDown={handleKeyDown} className="relative">
      {!expanded && (
        <button
          type="button"
          onClick={() => {
            setIsExpanded(true);
            setIsFocused(true);
          }}
          aria-label="Open search"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/60 text-white/70 transition-colors hover:bg-secondary hover:text-white md:hidden"
        >
          <Search className="h-5 w-5" />
        </button>
      )}

      <div
        className={`${expanded ? "flex" : "hidden"} ${
          isExpanded ? "fixed inset-x-3 top-2.5 z-[70] md:static md:inset-auto" : "md:relative md:flex"
        }`}
      >
        <form
          role="search"
          onSubmit={handleSubmit}
          className={`flex w-full items-center gap-2 rounded-full border px-3 py-2 transition-all duration-300 ${
            isFocused
              ? "border-white/25 bg-anime-gray md:w-96"
              : "border-transparent bg-secondary/50 md:w-64"
          }`}
        >
          <Search className="h-5 w-5 shrink-0 text-white/70" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onFocus={() => setIsFocused(true)}
            placeholder="Search anime..."
            aria-label="Search anime"
            enterKeyHint="search"
            autoComplete="off"
            className="min-w-0 w-full flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              className="shrink-0 text-white/70 transition-colors hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {isExpanded && (
            <button
              type="button"
              onClick={close}
              aria-label="Close search"
              className="shrink-0 text-white/70 transition-colors hover:text-white md:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={!searchQuery.trim()}
            aria-label="Search"
            className="flex shrink-0 items-center gap-1 rounded-full bg-anime-purple px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:bg-anime-purple/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="hidden sm:inline">Search</span>
            <Search className="h-4 w-4 sm:hidden" aria-hidden />
          </button>
        </form>

        {showPanel && (
          <div className="absolute left-0 right-0 top-full z-[70] mt-2 overflow-hidden rounded-xl border border-white/15 bg-[#15151f] p-2 shadow-2xl animate-fade-in">
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-white/50">
              {searchQuery.trim() ? "Quick results" : "Recent searches"}
            </div>
            <div className="mt-1 space-y-1">
              {!searchQuery.trim() ? (
                recentSearches.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => submitQuery(term)}
                    className="flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-white/10 focus:bg-white/10"
                  >
                    <Clock className="h-4 w-4 shrink-0 text-white/40" />
                    <span className="truncate text-sm text-white/85">{term}</span>
                  </button>
                ))
              ) : isLoading ? (
                <div className="px-2 py-3 text-sm text-white/60">Searching…</div>
              ) : searchResults.length > 0 ? (
                searchResults.slice(0, 5).map((anime) => (
                  <button
                    key={anime.id}
                    type="button"
                    onClick={() => handleResultClick(anime.id)}
                    className="flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-white/10 focus:bg-white/10"
                  >
                    <span className="h-14 w-10 shrink-0 overflow-hidden rounded-sm bg-anime-gray/60">
                      <img
                        src={anime.image}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white">
                        {anime.title}
                      </span>
                      <span className="block truncate text-xs text-white/60">
                        {[anime.category, anime.year].filter(Boolean).join(" • ")}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-3 text-sm text-white/60">
                  {debouncedQuery.trim().length < 2
                    ? "Type at least 2 characters"
                    : "No results found"}
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
              {searchQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => submitQuery(searchQuery)}
                  className="flex-1 rounded-md px-2 py-2 text-left text-sm font-medium text-anime-purple transition-colors hover:bg-white/5 hover:text-anime-purple/80"
                >
                  View all results
                </button>
              ) : (
                <span className="px-2 py-2 text-xs text-white/40">
                  Your last {recentSearches.length} searches
                </span>
              )}
              {recentSearches.length > 0 && (
                <button
                  type="button"
                  onClick={clearRecentSearches}
                  className="rounded-md px-2 py-2 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
