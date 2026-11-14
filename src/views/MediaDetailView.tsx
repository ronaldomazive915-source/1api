import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Plus, 
  Check, 
  Star, 
  Clock, 
  Film, 
  Tv, 
  X, 
  ArrowLeft,
  Calendar,
  Share2
} from 'lucide-react';
import { MediaItem } from '../types.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { SeasonEpisodeSelector } from '../components/SeasonEpisodeSelector.js';
import { resolveTmdbPosterUrl } from '../lib/mediaUtils.js';

interface MediaDetailViewProps {
  mediaId: string;
}

export const MediaDetailView: React.FC<MediaDetailViewProps> = ({ mediaId }) => {
  const { navigateTo, goBack, isMediaInMyList, toggleMyList } = useAuth();
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTrailerModal, setShowTrailerModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    api.getMediaById(mediaId)
      .then((data) => {
        if (isMounted) {
          setMedia(data);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [mediaId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex items-center justify-center pt-20">
        <div className="w-10 h-10 border-3 border-[#E50914] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!media) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] text-white pt-32 px-4 text-center">
        <div className="max-w-md mx-auto space-y-4">
          <Film className="w-12 h-12 text-zinc-700 mx-auto" />
          <h2 className="text-xl font-bold">Conteúdo não encontrado</h2>
          <p className="text-zinc-400 text-xs">O título pesquisado não está disponível no acervo.</p>
          <button
            onClick={() => navigateTo('home')}
            className="px-6 py-2.5 bg-[#E50914] text-white font-bold rounded text-xs uppercase tracking-wider"
          >
            Voltar ao Início
          </button>
        </div>
      </div>
    );
  }

  const inList = isMediaInMyList(media.id || media.tmdbId);
  const year = media.releaseDate 
    ? new Date(media.releaseDate).getFullYear() 
    : (media.firstAirDate ? new Date(media.firstAirDate).getFullYear() : media.releaseYear || '');

  const posterSrc = resolveTmdbPosterUrl(media.posterPath, 'w500');
  const backdrop = resolveTmdbPosterUrl(media.backdropPath, 'w1280') || posterSrc;

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-white pb-24 overflow-x-hidden">
      
      {/* BACKDROP HEADER */}
      <div className="relative w-full h-[45vh] min-h-[320px] max-h-[480px] overflow-hidden select-none">
        {backdrop && (
          <img
            src={backdrop}
            alt={media.title}
            className="w-full h-full object-cover object-top filter brightness-[0.75]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0B] via-[#0B0B0B]/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B0B0B] via-[#0B0B0B]/50 to-transparent w-full md:w-3/5" />

        {/* Back Button */}
        <div className="absolute top-20 left-4 sm:left-8 z-20">
          <button
            onClick={() => goBack(media?.type === 'tv' || media?.type === 'series' ? 'series' : 'movies')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 hover:bg-black/90 text-zinc-300 hover:text-white rounded-lg border border-white/10 text-xs font-semibold backdrop-blur-sm transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar</span>
          </button>
        </div>
      </div>

      {/* MAIN DETAILS CONTAINER */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-8 -mt-36 sm:-mt-48 relative z-10">
        <div className="flex flex-col md:flex-row items-start gap-6 sm:gap-8">
          
          {/* COMPACT POSTER (2:3) */}
          <div className="w-36 sm:w-52 md:w-60 aspect-[2/3] rounded-lg overflow-hidden bg-[#141416] border border-white/10 shadow-2xl shrink-0 mx-auto md:mx-0">
            {posterSrc ? (
              <img
                src={posterSrc}
                alt={media.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-zinc-900">
                <Film className="w-8 h-8 text-zinc-700 mb-2" />
                <span className="text-xs font-bold text-zinc-500 uppercase">{media.title}</span>
              </div>
            )}
          </div>

          {/* METADATA & ACTIONS */}
          <div className="flex-1 space-y-4 pt-2">
            
            {/* Header info */}
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                <span className="text-[#E50914] font-black">RONYCINE</span>
                <span className="text-zinc-600">·</span>
                <span>{media.type === 'movie' ? 'Filme' : 'Série'}</span>
                {year && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span>{year}</span>
                  </>
                )}
                {media.voteAverage && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span className="flex items-center gap-1 text-amber-400">
                      <Star className="w-3 h-3 fill-amber-400" />
                      {media.voteAverage.toFixed(1)}
                    </span>
                  </>
                )}
                {media.duration && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {media.duration} min
                    </span>
                  </>
                )}
              </div>

              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white uppercase tracking-tight font-display leading-tight">
                {media.title}
              </h1>
            </div>

            {/* Genres */}
            {media.genres && media.genres.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {media.genres.map((g) => (
                  <span
                    key={g}
                    className="text-[11px] font-semibold text-zinc-300 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Synopsis */}
            <div className="space-y-1 pt-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Sinopse</h3>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-3xl font-normal">
                {media.overview || 'Sinopse não disponível para este título.'}
              </p>
            </div>

            {/* Cast & Director */}
            {(media.director || (media.cast && media.cast.length > 0)) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3 border-y border-white/5 text-xs">
                {media.director && (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-zinc-500 block">Direção</span>
                    <span className="font-semibold text-zinc-200">{media.director}</span>
                  </div>
                )}
                {media.cast && media.cast.length > 0 && (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-zinc-500 block">Elenco Principal</span>
                    <span className="font-semibold text-zinc-200 line-clamp-1">
                      {media.cast.slice(0, 5).map(c => c.name).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ACTION BUTTONS (Assistir, Minha Lista, Trailer) */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => navigateTo('watch', media.id, { type: media.type === 'series' ? 'tv' : media.type, tmdbId: media.tmdbId })}
                className="flex items-center gap-2 px-6 py-2.5 sm:py-3 bg-[#E50914] hover:bg-[#b80710] text-white font-bold text-xs uppercase tracking-wider rounded-md transition-all active:scale-95 shadow-lg shadow-[#E50914]/25"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Assistir Agora</span>
              </button>

              <button
                type="button"
                onClick={() => toggleMyList(media)}
                className="flex items-center gap-1.5 px-4 py-2.5 sm:py-3 bg-white/10 hover:bg-white/15 text-white font-semibold text-xs rounded-md transition-all active:scale-95 border border-white/10"
              >
                {inList ? <Check className="w-4 h-4 text-[#E50914]" /> : <Plus className="w-4 h-4" />}
                <span>{inList ? 'Na Minha Lista' : 'Minha Lista'}</span>
              </button>

              {media.trailerUrl && (
                <button
                  type="button"
                  onClick={() => setShowTrailerModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 sm:py-3 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white font-semibold text-xs rounded-md transition-all border border-white/10"
                >
                  <Film className="w-4 h-4" />
                  <span>Trailer</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleShare}
                className="p-2.5 sm:p-3 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-md transition-all border border-white/10"
                title="Copiar link"
              >
                <Share2 className="w-4 h-4" />
              </button>

              {copiedLink && (
                <span className="text-[10px] text-emerald-400 font-bold">Link copiado!</span>
              )}
            </div>
          </div>
        </div>

        {/* EPISODES & SEASONS SECTION (For Series) */}
        {media.type === 'tv' && (
          <div className="mt-8 sm:mt-12">
            <SeasonEpisodeSelector
              seriesId={media.id}
              tmdbId={media.tmdbId}
              seasons={media.seasons}
            />
          </div>
        )}
      </div>

      {/* TRAILER MODAL */}
      {showTrailerModal && media.trailerUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative w-full max-w-4xl aspect-video rounded-xl overflow-hidden bg-black border border-white/10 shadow-2xl">
            <button
              onClick={() => setShowTrailerModal(false)}
              className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/60 hover:bg-[#E50914] text-white transition-all"
            >
              <X className="w-5 h-5" />
            </button>
            <iframe
              src={media.trailerUrl.includes('youtube.com') ? media.trailerUrl.replace('watch?v=', 'embed/') : media.trailerUrl}
              className="w-full h-full"
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              title="Trailer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
