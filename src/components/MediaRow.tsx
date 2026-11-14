import React, { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaCard } from './MediaCard.js';
import { MediaItem } from '../types.js';

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  subtitle?: string;
  isTop10?: boolean;
  onSeeMore?: () => void;
  seeMoreLabel?: string;
}

export const MediaRow: React.FC<MediaRowProps> = ({
  title,
  items,
  subtitle,
  isTop10 = false,
  onSeeMore,
  seeMoreLabel = 'Ver mais'
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Filter valid items
  const validItems = (items || []).filter(item => item && (item.id || item.tmdbId));

  // If no items, do not render empty section (Requirement #3)
  if (validItems.length === 0) return null;

  const checkScroll = () => {
    if (!rowRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [validItems]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!rowRef.current) return;
    const { clientWidth } = rowRef.current;
    const scrollAmount = direction === 'left' ? -clientWidth * 0.75 : clientWidth * 0.75;
    rowRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    setTimeout(checkScroll, 350);
  };

  return (
    <section className="relative group/row my-4 sm:my-6">
      {/* SECTION HEADER */}
      <div className="flex items-end justify-between px-3 sm:px-6 md:px-8 mb-2 sm:mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 sm:h-5 bg-[#E50914] rounded-full" />
          <h2 className="text-sm sm:text-base md:text-lg font-bold text-white tracking-tight">
            {title}
          </h2>
          {subtitle && (
            <span className="text-xs text-zinc-500 hidden sm:inline">
              · {subtitle}
            </span>
          )}
        </div>

        {onSeeMore && (
          <button
            onClick={onSeeMore}
            className="text-[11px] sm:text-xs font-semibold text-zinc-400 hover:text-white transition-colors flex items-center gap-1 group/btn"
          >
            <span>{seeMoreLabel}</span>
            <ChevronRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* ROW CAROUSEL WRAPPER */}
      <div className="relative">
        {/* Left Arrow (Desktop Only) */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => handleScroll('left')}
            aria-label="Rolar para esquerda"
            className="hidden lg:flex absolute left-0 top-0 bottom-0 w-10 sm:w-12 z-20 items-center justify-center bg-black/60 hover:bg-black/85 text-white backdrop-blur-sm opacity-0 group-hover/row:opacity-100 transition-all duration-200"
          >
            <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
          </button>
        )}

        {/* Scrollable Container */}
        <div
          ref={rowRef}
          onScroll={checkScroll}
          className="flex gap-2 sm:gap-2.5 md:gap-3 overflow-x-auto no-scrollbar scroll-smooth px-3 sm:px-6 md:px-8 py-1 snap-x snap-mandatory"
        >
          {validItems.map((item, index) => {
            const rankNumber = isTop10 ? index + 1 : undefined;

            return (
              <div
                key={item.id || item.tmdbId || index}
                className="w-[29vw] min-w-[100px] max-w-[125px] sm:w-[21vw] sm:min-w-[130px] sm:max-w-[160px] md:w-[15.5vw] md:min-w-[150px] md:max-w-[180px] xl:w-[13vw] 2xl:w-[11.8vw] shrink-0 snap-start"
              >
                <MediaCard
                  item={item}
                  rank={rankNumber}
                />
              </div>
            );
          })}
        </div>

        {/* Right Arrow (Desktop Only) */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => handleScroll('right')}
            aria-label="Rolar para direita"
            className="hidden lg:flex absolute right-0 top-0 bottom-0 w-10 sm:w-12 z-20 items-center justify-center bg-black/60 hover:bg-black/85 text-white backdrop-blur-sm opacity-0 group-hover/row:opacity-100 transition-all duration-200"
          >
            <ChevronRight className="w-6 h-6 stroke-[2.5]" />
          </button>
        )}
      </div>
    </section>
  );
};
