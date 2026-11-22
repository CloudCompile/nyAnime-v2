
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Library, ChevronDown, TrendingUp, Flame } from 'lucide-react';
import SearchBar from './SearchBar';
import { useIsMobile } from '@/hooks/use-mobile';

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const categories = [
    'Action', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi', 'Slice of Life'
  ];

  // Simplified highlights - only keeping Trending and Hot This Week
  const highlights = [
    { icon: <TrendingUp className="mr-2 h-4 w-4" />, label: 'Trending', path: '/anime?category=trending' },
    { icon: <Flame className="mr-2 h-4 w-4" />, label: 'Hot This Week', path: '/anime?category=hot' },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${
        isMobile || isScrolled ? 'glass-surface !rounded-none !border-0' : 'bg-transparent'
      }`}
    >
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex h-16 w-full items-center justify-between">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center">
              <div className="text-white font-bold text-2xl tracking-tighter">
                <span className="text-anime-purple">Ny</span>Anime
              </div>
            </Link>
            
            {/* Desktop Navigation - All items aligned in one row */}
            <nav className="hidden md:flex ml-10 items-center space-x-6">
              <Link to="/" className="text-white font-medium text-sm hover:text-anime-purple transition-colors">
                Home
              </Link>
              <div className="relative group">
                <button className="text-white font-medium text-sm flex items-center hover:text-anime-purple transition-colors">
                  Categories <ChevronDown className="ml-1 h-4 w-4" />
                </button>
                <div className="absolute top-full left-0 mt-2 w-48 glass-card rounded-lg overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 transform origin-top-left group-hover:translate-y-0 translate-y-2 z-50">
                  <div className="p-3 grid grid-cols-2 gap-2">
                    {categories.map((category) => (
                      <Link 
                        key={category} 
                        to={`/anime?genre=${category.toLowerCase()}`}
                        className="text-white/80 hover:text-white text-sm px-2 py-1 rounded hover:bg-white/5 transition-colors"
                      >
                        {category}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
              {/* Only display Trending and Hot This Week */}
              {highlights.map((item) => (
                <Link 
                  key={item.label}
                  to={item.path} 
                  className="text-white font-medium text-sm hover:text-anime-purple transition-colors flex items-center"
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          
          {/* Right Side */}
          <div className="flex items-center space-x-5">
            <SearchBar />
            
            <Link
              to="/library"
              title="My library - saved on this device"
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Library className="h-5 w-5" />
              <span className="text-sm font-medium">Library</span>
            </Link>
            
            {/* Mobile Menu Button */}
            <button 
              className="md:hidden text-white/70 hover:text-white transition-colors"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </div>
        
        {/* Mobile Menu */}
        <div className={`md:hidden transition-all duration-300 ease-in-out overflow-hidden ${
          isMobileMenuOpen ? 'max-h-96 opacity-100 mt-5' : 'max-h-0 opacity-0'
        }`}>
          <nav className="flex flex-col space-y-4 pb-4">
            <Link to="/" className="text-white font-medium hover:text-anime-purple transition-colors">
              Home
            </Link>
            <Link to="/anime" className="text-white font-medium hover:text-anime-purple transition-colors">
              All Anime
            </Link>
            
            {/* Mobile Highlights - Only Trending and Hot This Week */}
            {highlights.map((item) => (
              <Link 
                key={item.label}
                to={item.path} 
                className="text-white font-medium hover:text-anime-purple transition-colors flex items-center"
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
            
            <div className="pt-2 border-t border-white/10">
              <Link to="/library" className="text-white flex items-center py-2 hover:text-anime-purple">
                <Library className="h-5 w-5 mr-2" /> My Library
              </Link>
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
