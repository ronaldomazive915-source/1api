import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Star,
  Film,
  Tv,
  RefreshCw,
  AlertTriangle,
  Play
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { MediaItem, Season } from '../types.js';
import { RonycinePlayer } from '../components/player/RonycinePlayer.js';
import { MediaCard } from '../components/MediaCard.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { resolveTmdbPosterUrl } from '../lib/mediaUtils.js';

type DirectPlayState =
  | 'LOADING'
  | 'READY'
  | 'CONTENT_NOT_FOUND'
  | 'NO_SOURCE_AVAILABLE'
  | 'SOURCE_UNAVAILABLE';

export const WatchView: React.FC = () => {
  const { user, watchParams, navigateTo, goBack } = useAuth();
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loadingMedia, setLoadingMedia] = useState<boolean>(true);
  const [similarItems, setSimilarItems] = useState<MediaItem[]>([]);

  // Season & Episode State for TV (undefined if visiting /watch/tv/:id without episode)
  const [currentSeasonNum, setCurrentSeasonNum] = useState<number>(watchParams?.season || 1);
  const [currentEpisodeNum, setCurrentEpisodeNum] = useState<number>(watchParams?.episode || 1);
  const [seasonData, setSeasonData] = useState<Season | null>(null);
  const [loadingSeason, setLoadingSeason] = useState<boolean>(false);

  // Unified Direct Play State
  const [sources, setSources] = useState<any[]>([]);
  const [playState, setPlayState] = useState<DirectPlayState>('LOADING');
  const [statusMessage, setStatusMessage] = useState<string>('Inicializando fonte...');
  const [cinemaMode, setCinemaMode] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const tmdbId = watchParams?.tmdbId;
  const mediaType: 'movie' | 'tv' = watchParams?.type === 'series' || watchParams?.type === 'tv' ? 'tv' : 'movie';

  // Sync season/episode when watchParams changes explicitly
  useEffect(() => {
    if (watchParams?.season !== undefined) setCurrentSeasonNum(watchParams.season);
    if (watchParams?.episode !== undefined) setCurrentEpisodeNum(watchParams.episode);
  }, [watchParams?.season, watchParams?.episode, watchParams?.tmdbId]);

  // Direct Play Resolution via /api/v1/direct-play/... (strictly local DB, zero auto-import)
  useEffect(() => {
    if (!tmdbId) return;
    const cleanId = Number(tmdbId);
    if (isNaN(cleanId) || cleanId <= 0) {
      setPlayState('CONTENT_NOT_FOUND');
      setStatusMessage('Conteúdo não encontrado na RONYCINE API.');
      setLoadingMedia(false);
      return;
    }

    let cancelled = false;
    setPlayState('LOADING');
    setLoadingMedia(true);
    setSources([]);

    const loadDirectPlay = async () => {
      try {
        const res = await api.getDirectPlay({
          tmdbId: cleanId,
          type: mediaType,
          season: mediaType === 'tv' ? watchParams?.season : undefined,
          episode: mediaType === 'tv' ? watchParams?.episode : undefined
        });

        if (cancelled) return;

        if (res.content) {
          setMedia(res.content);
        } else {
          setMedia(null);
        }

        if (mediaType === 'tv' && res.season !== undefined && res.episode !== undefined) {
          setCurrentSeasonNum(res.season);
          setCurrentEpisodeNum(res.episode);
        }

        if (res.state === 'CONTENT_NOT_FOUND') {
          setPlayState('CONTENT_NOT_FOUND');
          setStatusMessage('Conteúdo não encontrado na RONYCINE API.');
          setSources([]);
        } else if (res.state === 'NO_SOURCE_AVAILABLE') {
          setPlayState('NO_SOURCE_AVAILABLE');
          setStatusMessage('Este conteúdo ainda não possui uma fonte de reprodução disponível.');
          setSources([]);
        } else if (res.state === 'SOURCE_UNAVAILABLE') {
          setPlayState('SOURCE_UNAVAILABLE');
          setStatusMessage('Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.');
          setSources([]);
        } else if (res.state === 'READY' && res.sources && res.sources.length > 0) {
          setSources(res.sources);
          setPlayState('READY');
          setStatusMessage('');
        } else {
          setPlayState('NO_SOURCE_AVAILABLE');
          setStatusMessage('Este conteúdo ainda não possui uma fonte de reprodução disponível.');
          setSources([]);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[WatchView] Direct Play error:', err);
        setPlayState('SOURCE_UNAVAILABLE');
        setStatusMessage('Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.');
      } finally {
        if (!cancelled) setLoadingMedia(false);
      }
    };

    loadDirectPlay();
    return () => {
      cancelled = true;
    };
  }, [tmdbId, mediaType, watchParams?.season, watchParams?.episode, reloadNonce]);

  // Similar Items
  useEffect(() => {
    const cleanId = Number(tmdbId);
    if (!cleanId || isNaN(cleanId) || playState === 'CONTENT_NOT_FOUND') {
      setSimilarItems([]);
      return;
    }

    let cancelled = false;
    api.getCatalog({ type: mediaType, limit: 12 })
      .then((res) => {
        if (!cancelled) {
          setSimilarItems((res.items || []).filter(i => Number(i.tmdbId) !== cleanId).slice(0, 6));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [tmdbId, mediaType, playState]);

  // Load Seasons & Episodes for TV (only if content exists in DB)
  useEffect(() => {
    if (mediaType !== 'tv' || !tmdbId || playState === 'CONTENT_NOT_FOUND') return;
    let cancelled = false;
    setLoadingSeason(true);
    api.getSeasonEpisodes(Number(tmdbId), currentSeasonNum)
      .then((res) => {
        if (cancelled) return;
        const eps = Array.isArray(res) ? res : (res?.episodes || []);
        setSeasonData({
          seasonNumber: currentSeasonNum,
          title: `Temporada ${currentSeasonNum}`,
          episodeCount: eps.length,
          episodes: eps
        });
      })
      .catch(() => {
        if (!cancelled) setSeasonData(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSeason(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mediaType, currentSeasonNum, tmdbId, playState]);

  const handleSelectEpisode = (season: number, episode: number) => {
    if (!tmdbId) return;
    setCurrentSeasonNum(season);
    setCurrentEpisodeNum(episode);
    navigateTo(
      'watch',
      { type: 'tv', tmdbId: Number(tmdbId), season, episode },
      undefined,
      { replace: true }
    );
  };

  // Save Progress
  const handleProgress = (prog: any) => {
    if (!user?.id || !tmdbId) return;
    api.saveWatchProgress(user.id, {
      userId: user.id,
      mediaId: media?.id || `${mediaType}-${tmdbId}`,
      tmdbId: Number(tmdbId),
      mediaType,
      title: media?.title || 'Conteúdo',
      posterPath: media?.posterPath || '',
      seasonNumber: mediaType === 'tv' ? currentSeasonNum : undefined,
      episodeNumber: mediaType === 'tv' ? currentEpisodeNum : undefined,
      positionSeconds: prog.currentTime,
      durationSeconds: prog.duration,
      progressPercent: prog.duration > 0 ? Math.min(100, Math.round((prog.currentTime / prog.duration) * 100)) : 10
    }).catch(() => {});
  };

  if (!tmdbId) {
    return (
      <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center p-6 text-center">
        <Film className="w-16 h-16 text-zinc-800 mb-6" />
        <h2 className="text-2xl font-bold font-display text-white mb-2">RONYCINE DIRECT PLAY</h2>
        <p className="text-sm text-zinc-400 mb-6 max-w-md">
          Informe um ID TMDB válido na rota <code className="text-[#E50914]">/watch/movie/&#123;tmdbId&#125;</code> ou{' '}
          <code className="text-[#E50914]">/watch/tv/&#123;tmdbId&#125;/&#123;season&#125;/&#123;episode&#125;</code>.
        </p>
        <button
          type="button"
          onClick={() => goBack('home')}
          className="px-8 py-3 bg-[#E50914] text-white font-bold rounded-sm uppercase tracking-widest text-xs"
        >
          Voltar ao Catálogo
        </button>
      </div>
    );
  }

  const currentEpisode = seasonData?.episodes?.find(e => e.episodeNumber === currentEpisodeNum);
  const totalSeasons = media?.numberOfSeasons || (media?.seasons ? media.seasons.length : 1);
  const hasNextEpisode = mediaType === 'tv';
  const resumeKey =
    mediaType === 'tv'
      ? `tv-${tmdbId}-s${currentSeasonNum}-e${currentEpisodeNum}`
      : `movie-${tmdbId}`;
  const posterUrl = resolveTmdbPosterUrl(media?.backdropPath, 'w1280') || resolveTmdbPosterUrl(media?.posterPath, 'w500');

  return (
    <div className="min-h-screen bg-[#080808] text-white flex flex-col selection:bg-[#E50914] selection:text-white">
      {/* HEADER */}
      <div className="glass-dark border-b border-white/5 px-6 py-4 flex items-center justify-between z-50 sticky top-0">
        <button
          type="button"
          onClick={() => goBack('home')}
          className="flex items-center gap-3 text-zinc-400 hover:text-white transition-all group"
        >
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">Voltar</span>
        </button>

        <div className="text-center max-w-xl px-4">
          <h2 className="text-sm font-black text-white uppercase tracking-tighter truncate font-display">
            {media?.title || (loadingMedia ? 'Carregando...' : `RONYCINE DIRECT PLAY · TMDB ${tmdbId}`)}
          </h2>
          {mediaType === 'tv' && playState !== 'CONTENT_NOT_FOUND' && (
            <p className="text-[10px] text-[#E50914] font-bold uppercase tracking-widest mt-0.5">
              Temporada {currentSeasonNum} • Episódio {currentEpisodeNum}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1">
            <div className={`w-1.5 h-1.5 rounded-full ${playState === 'READY' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500'}`} />
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Direct Play</span>
          </div>
        </div>
      </div>

      {/* PLAYER AREA */}
      <div
        className={`w-full bg-black relative shadow-2xl transition-all duration-300 ${
          cinemaMode ? 'h-[85vh]' : 'aspect-video lg:max-h-[82vh]'
        }`}
      >
        <ErrorBoundary
          fallbackTitle="Erro ao carregar o Player"
          onBack={() => goBack('home')}
          resetKey={`${tmdbId}-${currentSeasonNum}-${currentEpisodeNum}-${reloadNonce}`}
        >
          {playState === 'LOADING' ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#080808] text-white gap-3">
              <RefreshCw className="w-10 h-10 text-[#E50914] animate-spin" />
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                Resolvendo RONYCINE Direct Play...
              </p>
            </div>
          ) : playState === 'READY' && sources.length > 0 ? (
            <RonycinePlayer
              sources={sources}
              title={
                mediaType === 'tv'
                  ? `${media?.title || 'Série'} — T${currentSeasonNum}:E${currentEpisodeNum}`
                  : media?.title
              }
              poster={posterUrl}
              resumeKey={resumeKey}
              isCinemaMode={cinemaMode}
              onToggleCinemaMode={() => setCinemaMode(prev => !prev)}
              hasNextEpisode={hasNextEpisode}
              onNextEpisode={() => handleSelectEpisode(currentSeasonNum, currentEpisodeNum + 1)}
              onBack={() => goBack('home')}
              onProgress={handleProgress}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 sm:p-10 bg-[#080808] text-center">
              <div className="w-14 h-14 rounded-full bg-[#E50914]/10 border border-[#E50914]/30 flex items-center justify-center text-[#E50914] mb-4">
                {playState === 'CONTENT_NOT_FOUND' ? <Film className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#E50914] mb-2">
                RONYCINE DIRECT PLAY
              </span>
              <h3 className="text-base sm:text-xl font-black text-white max-w-lg mb-2">
                {statusMessage}
              </h3>
              <p className="text-xs text-zinc-500 max-w-md mb-6 leading-relaxed">
                {playState === 'CONTENT_NOT_FOUND'
                  ? `O ID TMDB ${tmdbId} (${mediaType === 'tv' ? 'Série' : 'Filme'}) ainda não foi importado manualmente para o catálogo oficial da RONYCINE.`
                  : playState === 'NO_SOURCE_AVAILABLE'
                  ? `O conteúdo existe no catálogo (TMDB ${tmdbId}), mas nenhuma fonte de vídeo foi associada ainda pelo administrador.`
                  : 'As fontes associadas estão desativadas, bloqueadas ou temporariamente indisponíveis.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {playState === 'SOURCE_UNAVAILABLE' && (
                  <button
                    type="button"
                    onClick={() => setReloadNonce(n => n + 1)}
                    className="px-5 py-2.5 bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold uppercase tracking-widest rounded-lg transition-all flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Tentar Novamente</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => goBack('home')}
                  className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-widest rounded-lg transition-all flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Voltar ao Catálogo</span>
                </button>
              </div>
            </div>
          )}
        </ErrorBoundary>
      </div>

      {/* METADATA (shown whenever content exists in local DB) */}
      {playState !== 'CONTENT_NOT_FOUND' && (
        <div className="max-w-[1600px] mx-auto w-full px-6 sm:px-12 lg:px-16 py-12 space-y-12">
          <div className="flex flex-col lg:flex-row gap-12">
            <div className="flex-1 space-y-8">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4 text-xs font-bold tracking-[0.2em] uppercase text-zinc-500">
                  <span className="text-[#E50914]">RONYCINE DIRECT PLAY</span>
                  <span className="opacity-20">|</span>
                  <span>{mediaType === 'movie' ? 'Filme' : 'Série'}</span>
                  <span className="opacity-20">|</span>
                  <span>{media?.releaseYear || '—'}</span>
                  <span className="flex items-center gap-1.5 text-white bg-white/5 px-2 py-0.5 rounded">
                    <Star className="w-3 h-3 fill-[#E50914] text-[#E50914]" />
                    {media?.voteAverage ? media.voteAverage.toFixed(1) : '—'}
                  </span>
                </div>

                <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tighter uppercase font-display">
                  {media?.title || (loadingMedia ? 'Carregando...' : `TMDB ${tmdbId}`)}
                </h1>

                {mediaType === 'tv' && currentEpisode && (
                  <div className="bg-white/5 border border-white/5 p-4 rounded-sm">
                    <h3 className="text-xs font-black text-[#E50914] uppercase tracking-[0.2em] mb-2">Agora Assistindo</h3>
                    <h4 className="text-lg font-bold text-white">E{currentEpisodeNum}. {currentEpisode.title}</h4>
                    <p className="text-sm text-zinc-400 mt-2 line-clamp-2">{currentEpisode.overview}</p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Sinopse</h3>
                <p className="text-base text-zinc-300 leading-relaxed max-w-4xl font-medium">
                  {media?.overview || 'Explore este conteúdo na RONYCINE API.'}
                </p>
              </div>
            </div>

            <div className="w-full lg:w-80 space-y-8">
              {media?.genres && media.genres.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Gêneros</h3>
                  <div className="flex flex-wrap gap-2">
                    {media.genres.map(g => (
                      <span key={g} className="px-3 py-1 bg-white/5 rounded text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SEASONS AREA FOR TV */}
          {mediaType === 'tv' && (
            <div className="pt-12 border-t border-white/5">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <Tv className="w-6 h-6 text-[#E50914]" />
                  <h2 className="text-2xl font-bold font-display uppercase tracking-tight">Episódios</h2>
                </div>

                <select
                  value={currentSeasonNum}
                  onChange={e => handleSelectEpisode(parseInt(e.target.value, 10), 1)}
                  className="bg-surface border border-white/10 rounded-sm px-6 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-[#E50914] transition-all outline-none"
                >
                  {Array.from({ length: totalSeasons }, (_, i) => i + 1).map(s => (
                    <option key={s} value={s}>Temporada {s}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {loadingSeason ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-24 bg-surface rounded-sm animate-pulse" />
                  ))
                ) : (
                  seasonData?.episodes?.map(ep => (
                    <button
                      key={`${ep.seasonNumber}-${ep.episodeNumber}`}
                      type="button"
                      onClick={() => handleSelectEpisode(currentSeasonNum, ep.episodeNumber)}
                      className={`flex items-start text-left p-4 rounded-sm border transition-all ${
                        ep.episodeNumber === currentEpisodeNum
                          ? 'bg-white/10 border-[#E50914]'
                          : 'bg-surface border-white/5 hover:bg-white/5'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-sm flex items-center justify-center font-black text-xs shrink-0 mr-4 ${
                          ep.episodeNumber === currentEpisodeNum ? 'bg-[#E50914] text-white' : 'bg-white/5 text-zinc-500'
                        }`}
                      >
                        {ep.episodeNumber}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-sm font-bold text-white truncate mb-1">{ep.title}</h4>
                          {ep.episodeNumber === currentEpisodeNum && (
                            <Play className="w-3.5 h-3.5 text-[#E50914] fill-[#E50914] shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">{ep.overview}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* RECOMMENDATIONS */}
          {similarItems.length > 0 && (
            <div className="pt-12 border-t border-white/5">
              <h3 className="text-xl font-bold font-display uppercase tracking-tight mb-8">Mais como este</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6">
                {similarItems.map(item => (
                  <MediaCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="py-16 px-6 sm:px-12 flex flex-col items-center opacity-40 mt-auto">
        <span className="text-2xl font-black tracking-tighter text-[#E50914] font-display uppercase mb-2">
          RONYCINE<span className="text-white">API</span>
        </span>
        <p className="text-[9px] text-zinc-600 font-medium tracking-[0.3em] uppercase">
          RONYCINE DIRECT PLAY · CINEMA PRO
        </p>
      </footer>
    </div>
  );
};
