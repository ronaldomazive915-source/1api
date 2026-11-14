import React, { useState } from 'react';
import { Star, Play, Plus, Check, Film, Info } from 'lucide-react';
import { MediaItem } from '../types.js';
import { useAuth } from '../context/AuthContext.js';
import { resolveTmdbPosterUrl } from '../lib/mediaUtils.js';

interface MediaCardProps {
  item?: MediaItem;
  media?: MediaItem;
  rank?: number;
  className?: string;
  showRankBadge?: boolean;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  media,
  rank,
  className = '',
  showRankBadge = false
}) => {
  const mediaItem = item || media;
  const { navigateTo, isMediaInMyList, toggleMyList } = useAuth();
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  if (!mediaItem) return null;

  const posterSrc = resolveTmdbPosterUrl(mediaItem.posterPath, 'w500');
  const inList = isMediaInMyList(mediaItem.id || mediaItem.tmdbId);

  const year = mediaItem.releaseDate
    ? new Date(mediaItem.releaseDate).getFullYear()
    : mediaItem.firstAirDate
    ? new Date(mediaItem.firstAirDate).getFullYear()
    : (mediaItem.releaseYear || '');

  const rating = typeof mediaItem.voteAverage === 'number' && mediaItem.voteAverage > 0
    ? mediaItem.voteAverage.toFixed(1)
    : null;

  const handleCardClick = () => {
    navigateTo('media_detail', mediaItem.id);
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigateTo('watch', mediaItem.id, { type: mediaItem.type === 'series' ? 'tv' : mediaItem.type, tmdbId: mediaItem.tmdbId });
  };

  const handleListClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleMyList(mediaItem);
  };

  return (
    <div
      onClick={handleCardClick}
      className={`group relative flex flex-col cursor-pointer select-none transition-all duration-200 ${className}`}
    >
      {/* POSTER CONTAINER */}
      <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-[#141416] border border-white/[0.06] shadow-sm transition-all duration-200 lg:group-hover:scale-[1.03] lg:group-hover:border-white/20 lg:group-hover:shadow-lg lg:group-hover:shadow-black/60">
        
        {/* Poster Image */}
        {imgError || !posterSrc ? (
          <div className="absolute inset-0 bg-gradient-to-b from-[#18181b] to-[#0c0c0e] flex flex-col items-center justify-center p-2 text-center">
            <Film className="w-6 h-6 text-zinc-700 mb-1.5" />
            <span className="text-[10px] font-black tracking-wider text-zinc-500 uppercase line-clamp-2 px-1">
              {mediaItem.title}
            </span>
          </div>
        ) : (
          <>
            {!imgLoaded && (
              <div className="absolute inset-0 bg-[#18181b] animate-pulse" />
            )}
            <img
              src={posterSrc}
              alt={mediaItem.title}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
              className={`w-full h-full object-cover object-center transition-opacity duration-300 ${
                imgLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </>
        )}

        {/* Top Badges (Rank or Rating) */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10 pointer-events-none">
          {rating && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-md border border-white/10 text-[9px] font-bold text-zinc-100 shadow">
              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
              <span>{rating}</span>
            </div>
          )}
        </div>

        {/* Top Left: Type tag or New */}
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 z-10 pointer-events-none">
          {mediaItem.createdAt && (Date.now() - new Date(mediaItem.createdAt).getTime() < 14 * 24 * 60 * 60 * 1000) ? (
            <span className="bg-[#E50914] text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow uppercase tracking-wider">
              Novo
            </span>
          ) : (
            <span className="bg-black/60 backdrop-blur-md text-zinc-300 text-[8px] font-bold px-1.5 py-0.5 rounded border border-white/10 uppercase tracking-wider">
              {mediaItem.type === 'movie' ? 'Filme' : 'Série'}
            </span>
          )}
        </div>

        {/* Top 10 Number Watermark (if rank provided) */}
        {typeof rank === 'number' && rank > 0 && rank <= 10 && (
          <div className="absolute bottom-0 left-0 leading-none font-black text-4xl sm:text-5xl font-display text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.9)] px-1 select-none pointer-events-none text-stroke">
            <span className="bg-gradient-to-t from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              {rank}
            </span>
          </div>
        )}

        {/* DESKTOP HOVER OVERLAY (Subtle, non-disruptive, hidden on touch screens) */}
        <div className="hidden lg:flex absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-col justify-end p-2.5 gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePlayClick}
              title="Assistir agora"
              className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90 active:scale-95 transition-transform shadow"
            >
              <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
            </button>
            <button
              type="button"
              onClick={handleListClick}
              title={inList ? 'Remover da Minha Lista' : 'Adicionar à Minha Lista'}
              className="w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center border border-white/20 hover:bg-zinc-800 active:scale-95 transition-all shadow"
            >
              {inList ? <Check className="w-3.5 h-3.5 text-[#E50914]" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleCardClick}
              title="Ver detalhes"
              className="w-7 h-7 rounded-full bg-black/60 text-zinc-300 flex items-center justify-center border border-white/20 hover:text-white hover:bg-zinc-800 active:scale-95 transition-all shadow"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* METADATA BELOW CARD (Visible on all devices) */}
      <div className="mt-1.5 space-y-0.5">
        <h3 className="text-xs sm:text-[13px] font-semibold text-zinc-200 line-clamp-1 leading-snug group-hover:text-[#E50914] transition-colors">
          {mediaItem.title}
        </h3>
        <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-zinc-400 font-medium">
          {year && <span>{year}</span>}
          {year && <span className="text-zinc-600">·</span>}
          <span>{mediaItem.type === 'movie' ? 'Filme' : 'Série'}</span>
          {rating && (
            <>
              <span className="text-zinc-600">·</span>
              <span className="text-amber-400/90 font-medium flex items-center gap-0.5">
                <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 inline" />
                {rating}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const MediaCardSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      <div className="w-full aspect-[2/3] bg-[#161616] rounded-md border border-white/5" />
      <div className="space-y-1">
        <div className="h-3.5 bg-[#1c1c1f] rounded w-4/5" />
        <div className="h-2.5 bg-[#18181a] rounded w-2/5" />
      </div>
    </div>
  );
};
