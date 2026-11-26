import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Library, ChevronDown, TrendingUp, Flame, Glasses } from "lucide-react";
import SearchBar from "./SearchBar";
import { useIsMobile } from "@/hooks/use-mobile";

const categories = [
  "Action", "Comedy", "Drama", "Fantasy", "Horror", "Romance", "Sci-Fi", "Slice of Life",
];

const highlights = [
  { icon: <TrendingUp className="mr-2 h-4 w-4" />, label: "Trending", path: "/anime?category=trending" },
  { icon: <Flame className="mr-2 h-4 w-4" />, label: "Hot This Week", path: "/anime?category=hot" },
];

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const isMobile = useIsMobile();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Every navigation closes the menus, so a tap never leaves one open behind.
  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsCategoriesOpen(false);
  }, [location.pathname, location.search]);

  // Only the home page has artwork behind the header. Everywhere else the
  // header needs its own background, or the logo and links disappear against
  // the page colour (the Library page showed a bare white strip).
  const isHome = location.pathname === "/";
  const solid = isMobile || isScrolled || !isHome || isMobileMenuOpen;

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-50 transition-colors duration-300 ${
        solid ? "glass-surface !rounded-none !border-0" : "bg-transparent"
      }`}
    >
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex h-16 w-full items-center justify-between gap-3">
          <div className="flex items-center">
            <Link to="/" className="flex items-center" aria-label="NyAnime home">
              <div className="text-2xl font-bold tracking-tighter text-white">
                <span className="text-anime-purple">Ny</span>Anime
              </div>
            </Link>

            <nav className="ml-10 hidden items-center space-x-6 md:flex">
              <Link
                to="/"
                className="text-sm font-medium text-white transition-colors hover:text-anime-purple"
              >
                Home
              </Link>
              <div className="group relative">
                <button
                  type="button"
                  aria-expanded={isCategoriesOpen}
                  aria-haspopup="true"
                  onClick={() => setIsCategoriesOpen((open) => !open)}
                  className="flex items-center text-sm font-medium text-white transition-colors hover:text-anime-purple"
                >
                  Categories
                  <ChevronDown
                    className={`ml-1 h-4 w-4 transition-transform ${
                      isCategoriesOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div
                  className={`glass-card absolute left-0 top-full z-50 mt-2 w-56 origin-top-left rounded-lg transition-all duration-200 ${
                    isCategoriesOpen
                      ? "visible translate-y-0 opacity-100"
                      : "invisible translate-y-1 opacity-0 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
                  }`}
                >
                  <div className="grid grid-cols-2 gap-1 p-3">
                    {categories.map((category) => (
                      <Link
                        key={category}
                        to={`/anime?genre=${category.toLowerCase()}`}
                        onClick={() => setIsCategoriesOpen(false)}
                        className="rounded px-2 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        {category}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
              {highlights.map((item) => (
                <Link
                  key={item.label}
                  to={item.path}
                  className="flex items-center text-sm font-medium text-white transition-colors hover:text-anime-purple"
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
              <Link
                to="/vr"
                className="flex items-center text-sm font-medium text-white transition-colors hover:text-anime-purple"
              >
                <Glasses className="mr-2 h-4 w-4" />
                VR Theater
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            <SearchBar />

            <Link
              to="/library"
              title="My library - saved on this device"
              className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white md:flex"
            >
              <Library className="h-5 w-5" />
              <span className="text-sm font-medium">Library</span>
            </Link>

            <button
              type="button"
              className="text-white/70 transition-colors hover:text-white md:hidden"
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
              onClick={() => setIsMobileMenuOpen((open) => !open)}
            >
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out md:hidden ${
            isMobileMenuOpen ? "mt-2 max-h-96 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <nav className="flex flex-col space-y-1 pb-4">
            <Link
              to="/"
              className="rounded px-2 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 hover:text-anime-purple"
            >
              Home
            </Link>
            <Link
              to="/anime"
              className="rounded px-2 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 hover:text-anime-purple"
            >
              All Anime
            </Link>
            {highlights.map((item) => (
              <Link
                key={item.label}
                to={item.path}
                className="flex items-center rounded px-2 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 hover:text-anime-purple"
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
            <Link
              to="/vr"
              className="flex items-center rounded px-2 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 hover:text-anime-purple"
            >
              <Glasses className="mr-2 h-4 w-4" />
              VR Theater
            </Link>
            <div className="mt-1 border-t border-white/10 pt-2">
              <Link
                to="/library"
                className="flex items-center rounded px-2 py-2 text-sm text-white transition-colors hover:bg-white/10 hover:text-anime-purple"
              >
                <Library className="mr-2 h-5 w-5" /> My Library
              </Link>
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
