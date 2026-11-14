import React, { useState, useEffect } from 'react';
import { Play, Plus, Check, Info, Star } from 'lucide-react';
import { MediaItem } from '../types.js';
import { useAuth } from '../context/AuthContext.js';

interface HeroSectionProps {
  items: MediaItem[];
}

export const HeroSection: React.FC<HeroSectionProps> = ({ items }) => {
  const { navigateTo, isMediaInMyList, toggleMyList } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(0);

  const validItems = (items || []).filter(item => item && (item.id || item.tmdbId));
  const currentMedia = validItems[currentIndex] || validItems[0];

  useEffect(() => {
    if (validItems.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % validItems.length);
    }, 9000);
    return () => clearInterval(timer);
  }, [validItems.length]);

  if (!currentMedia) {
    return (
      <div className="relative w-full h-[55vh] min-h-[380px] bg-[#0E0E10] flex items-center justify-center text-zinc-600">
        <div className="text-center px-4">
          <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-wider mb-2">RONYCINE STREAMING</h2>
          <p className="text-xs sm:text-sm text-zinc-400">Milhares de filmes e séries disponíveis instantaneamente.</p>
        </div>
      </div>
    );
  }

  const inList = isMediaInMyList(currentMedia.id || currentMedia.tmdbId);
  const year = currentMedia.releaseDate
    ? new Date(currentMedia.releaseDate).getFullYear()
    : currentMedia.firstAirDate
    ? new Date(currentMedia.firstAirDate).getFullYear()
    : currentMedia.releaseYear || '';

  const backdrop = currentMedia.backdropPath || currentMedia.posterPath;

  const handleWatch = () => {
    navigateTo('watch', currentMedia.id, { type: currentMedia.type === 'series' ? 'tv' : currentMedia.type, tmdbId: currentMedia.tmdbId });
  };

  const handleDetails = () => {
    navigateTo('media_detail', currentMedia.id);
  };

  return (
    <div className="relative w-full h-[58vh] min-h-[420px] max-h-[680px] sm:h-[70vh] bg-black select-none overflow-hidden">
      {/* BACKGROUND BACKDROP */}
      <div className="absolute inset-0">
        {backdrop && (
          <img
            src={backdrop}
            alt={currentMedia.title}
            loading="eager"
            decoding="async"
            className="w-full h-full object-cover object-top sm:object-center transition-all duration-700"
          />
        )}
        {/* Soft Vignette Gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0B] via-[#0B0B0B]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B0B0B] via-[#0B0B0B]/60 to-transparent w-full lg:w-3/5" />
      </div>

      {/* HERO CONTENT */}
      <div className="relative max-w-[1600px] mx-auto h-full px-4 sm:px-8 md:px-12 flex flex-col justify-end pb-10 sm:pb-16 z-10">
        <div className="max-w-2xl space-y-3 sm:space-y-4">
          {/* Tagline / Metadata */}
          <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-300">
            <span className="text-[#E50914] font-black">RONYCINE EXCLUSIVO</span>
            {year && (
              <>
                <span className="text-zinc-600">·</span>
                <span>{year}</span>
              </>
            )}
            <span className="text-zinc-600">·</span>
            <span className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] text-zinc-200">
              {currentMedia.type === 'movie' ? 'Filme' : 'Série'}
            </span>
            {currentMedia.voteAverage && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="flex items-center gap-0.5 text-amber-400">
                  <Star className="w-3 h-3 fill-amber-400" />
                  {currentMedia.voteAverage.toFixed(1)}
                </span>
              </>
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white uppercase tracking-tight font-display leading-[1.05] line-clamp-2 drop-shadow-md">
            {currentMedia.title}
          </h1>

          {/* Overview */}
          {currentMedia.overview && (
            <p className="text-xs sm:text-sm text-zinc-300 font-medium leading-relaxed line-clamp-2 sm:line-clamp-3 max-w-xl drop-shadow">
              {currentMedia.overview}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 pt-1 sm:pt-2">
            <button
              onClick={handleWatch}
              className="flex items-center gap-2 px-5 sm:px-7 py-2.5 sm:py-3 bg-[#E50914] hover:bg-[#b80710] text-white font-bold text-xs sm:text-sm uppercase tracking-wider rounded-md transition-all active:scale-95 shadow-lg shadow-[#E50914]/25"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Assistir</span>
            </button>

            <button
              onClick={() => toggleMyList(currentMedia)}
              className="flex items-center gap-1.5 px-3.5 sm:px-5 py-2.5 sm:py-3 bg-white/10 hover:bg-white/20 text-white font-semibold text-xs sm:text-sm rounded-md transition-all active:scale-95 border border-white/15 backdrop-blur-sm"
            >
              {inList ? <Check className="w-4 h-4 text-[#E50914]" /> : <Plus className="w-4 h-4" />}
              <span className="hidden sm:inline">{inList ? 'Na Minha Lista' : 'Minha Lista'}</span>
            </button>

            <button
              onClick={handleDetails}
              className="flex items-center gap-1.5 px-3.5 sm:px-5 py-2.5 sm:py-3 bg-white/10 hover:bg-white/20 text-white font-semibold text-xs sm:text-sm rounded-md transition-all active:scale-95 border border-white/15 backdrop-blur-sm"
            >
              <Info className="w-4 h-4" />
              <span className="hidden sm:inline">Detalhes</span>
            </button>
          </div>
        </div>

        {/* Slide Indicators (if multiple) */}
        {validItems.length > 1 && (
          <div className="absolute right-4 sm:right-8 bottom-6 sm:bottom-12 flex items-center gap-1.5 z-10">
            {validItems.slice(0, 6).map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Slide ${idx + 1}`}
                className={`h-1 rounded-full transition-all duration-300 ${
                  currentIndex === idx ? 'w-6 bg-[#E50914]' : 'w-2 bg-white/30 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
