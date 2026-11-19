import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeft,
  Star,
  Film,
  Tv,
  RefreshCw,
  AlertTriangle,
  Play,
  Plus,
  Check,
  Share2,
  RectangleHorizontal,
  ChevronLeft,
  ChevronRight,
  SkipForward,
  History
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { MediaItem, Season, PlaybackVersionAvailability } from '../types.js';
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

const AUTO_NEXT_STORAGE_KEY = 'ronycine_auto_next';

function formatResumeClock(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function readLocalResumeState(resumeKey: string): { time: number; completed: boolean } {
  if (typeof window === 'undefined' || !resumeKey) return { time: 0, completed: false };
  try {
    const raw = localStorage.getItem(`ronycine_resume_${resumeKey}`);
    if (!raw) return { time: 0, completed: false };
    const parsed = JSON.parse(raw);
    const time = Number(parsed?.time || 0);
    const dur = Number(parsed?.duration || 0);
    const completed =
      Boolean(parsed?.completed) || (dur > 60 && time >= dur * 0.93) || (dur > 0 && time >= dur * 0.95);
    if (completed) return { time: 0, completed: true };
    if (time >= 10) return { time, completed: false };
  } catch {}
  return { time: 0, completed: false };
}

export const WatchView: React.FC = () => {
  const { user, watchParams, navigateTo, goBack, isMediaInMyList, toggleMyList } = useAuth();
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loadingMedia, setLoadingMedia] = useState<boolean>(true);
  const [similarItems, setSimilarItems] = useState<MediaItem[]>([]);

  // Season & Episode State for TV
  const [currentSeasonNum, setCurrentSeasonNum] = useState<number>(watchParams?.season || 1);
  const [currentEpisodeNum, setCurrentEpisodeNum] = useState<number>(watchParams?.episode || 1);
  const [seasonData, setSeasonData] = useState<Season | null>(null);
  const [loadingSeason, setLoadingSeason] = useState<boolean>(false);

  // Unified Direct Play State
  const [sources, setSources] = useState<any[]>([]);
  const [versionAvailability, setVersionAvailability] = useState<PlaybackVersionAvailability | undefined>(undefined);
  const [nextEpisodeMeta, setNextEpisodeMeta] = useState<{ available: boolean; season: number; episode: number } | null>(null);
  const [playState, setPlayState] = useState<DirectPlayState>('LOADING');
  const [statusMessage, setStatusMessage] = useState<string>('Inicializando reprodução...');
  const [cinemaMode, setCinemaMode] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  // UX Controls: Share, Resume Banner & Auto-Next Episode
  const [copiedLink, setCopiedLink] = useState(false);
  const [savedResumeSec, setSavedResumeSec] = useState<number>(0);
  const [backendResumeSec, setBackendResumeSec] = useState<number>(0);
  const [backendCompleted, setBackendCompleted] = useState<boolean>(false);
  const lastBackendProgressSyncRef = useRef<number>(0);
  const [autoNextEnabled, setAutoNextEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem(AUTO_NEXT_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState<number | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);

  const tmdbId = watchParams?.tmdbId;
  const mediaType: 'movie' | 'tv' = watchParams?.type === 'series' || watchParams?.type === 'tv' ? 'tv' : 'movie';

  // Sync season/episode when watchParams changes explicitly
  useEffect(() => {
    if (watchParams?.season !== undefined) setCurrentSeasonNum(watchParams.season);
    if (watchParams?.episode !== undefined) setCurrentEpisodeNum(watchParams.episode);
    setNextEpisodeCountdown(null);
  }, [watchParams?.season, watchParams?.episode, watchParams?.tmdbId]);

  const resumeKey =
    mediaType === 'tv'
      ? `tv-${tmdbId}-s${currentSeasonNum}-e${currentEpisodeNum}`
      : `movie-${tmdbId}`;

  useEffect(() => {
    const local = readLocalResumeState(resumeKey);
    setSavedResumeSec(local.completed ? 0 : local.time);
    setBackendResumeSec(0);
    setBackendCompleted(local.completed);
    lastBackendProgressSyncRef.current = 0;

    if (!user?.id || !tmdbId) return;
    let cancelled = false;
    api
      .getProgressList(user.id)
      .then((list) => {
        if (cancelled || !Array.isArray(list)) return;
        const match = list.find((p) => {
          if (Number(p.tmdbId) !== Number(tmdbId) || p.mediaType !== mediaType) return false;
          if (mediaType === 'tv') {
            return (
              Number(p.seasonNumber ?? 1) === Number(currentSeasonNum) &&
              Number(p.episodeNumber ?? 1) === Number(currentEpisodeNum)
            );
          }
          return true;
        });
        if (!match) return;
        const isDone =
          Boolean(match.completed) ||
          (match.durationSeconds > 60 && match.positionSeconds >= match.durationSeconds * 0.93);
        if (isDone) {
          setBackendCompleted(true);
          setBackendResumeSec(0);
          setSavedResumeSec(0);
        } else if (match.positionSeconds >= 10) {
          setBackendCompleted(false);
          setBackendResumeSec(match.positionSeconds);
          setSavedResumeSec(Math.max(local.time, match.positionSeconds));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [resumeKey, reloadNonce, user?.id, tmdbId, mediaType, currentSeasonNum, currentEpisodeNum]);

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
    setVersionAvailability(undefined);
    setNextEpisodeMeta(null);
    setNextEpisodeCountdown(null);

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

        if (res.nextEpisode) {
          setNextEpisodeMeta(res.nextEpisode);
        }
        setVersionAvailability(res.versionAvailability);

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

  // Similar Items ("Você Vai Gostar")
  useEffect(() => {
    const cleanId = Number(tmdbId);
    if (!cleanId || isNaN(cleanId) || playState === 'CONTENT_NOT_FOUND') {
      setSimilarItems([]);
      return;
    }

    let cancelled = false;
    api.getCatalog({ type: mediaType, limit: 16 })
      .then((res) => {
        if (!cancelled) {
          setSimilarItems((res.items || []).filter(i => Number(i.tmdbId) !== cleanId).slice(0, 12));
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
    setNextEpisodeCountdown(null);
    setCurrentSeasonNum(season);
    setCurrentEpisodeNum(episode);
    navigateTo(
      'watch',
      { type: 'tv', tmdbId: Number(tmdbId), season, episode },
      undefined,
      { replace: true }
    );
  };

  // Compute Next Episode Target
  const nextEpisodeTarget = useMemo(() => {
    if (mediaType !== 'tv') return null;
    if (nextEpisodeMeta?.available && nextEpisodeMeta.season && nextEpisodeMeta.episode) {
      return { season: nextEpisodeMeta.season, episode: nextEpisodeMeta.episode };
    }
    const eps = seasonData?.episodes || [];
    const idx = eps.findIndex(e => Number(e.episodeNumber) === Number(currentEpisodeNum));
    if (idx >= 0 && idx + 1 < eps.length) {
      return { season: currentSeasonNum, episode: Number(eps[idx + 1].episodeNumber) };
    }
    if (eps.length === 0) {
      return { season: currentSeasonNum, episode: currentEpisodeNum + 1 };
    }
    const totalSeasons = media?.numberOfSeasons || (media?.seasons ? media.seasons.length : 1);
    if (currentSeasonNum < totalSeasons) {
      return { season: currentSeasonNum + 1, episode: 1 };
    }
    return null;
  }, [mediaType, nextEpisodeMeta, seasonData?.episodes, currentSeasonNum, currentEpisodeNum, media]);

  // Countdown timer for auto-next episode
  useEffect(() => {
    if (nextEpisodeCountdown === null) return;
    if (nextEpisodeCountdown <= 0) {
      if (nextEpisodeTarget) {
        handleSelectEpisode(nextEpisodeTarget.season, nextEpisodeTarget.episode);
      } else {
        setNextEpisodeCountdown(null);
      }
      return;
    }
    const timer = setTimeout(() => {
      setNextEpisodeCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [nextEpisodeCountdown, nextEpisodeTarget]);

  const toggleAutoNext = () => {
    setAutoNextEnabled(prev => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_NEXT_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  // Save Progress (throttled during continuous playback; immediate on pause/exit/complete)
  const handleProgress = (prog: {
    currentTime: number;
    duration: number;
    progressPercent: number;
    completed?: boolean;
    flush?: boolean;
  }) => {
    if (prog.completed) {
      setSavedResumeSec(0);
    } else if (prog.currentTime >= 10) {
      setSavedResumeSec(Math.floor(prog.currentTime));
    }

    if (!user?.id || !tmdbId) return;
    const now = Date.now();
    if (!prog.flush && !prog.completed && now - lastBackendProgressSyncRef.current < 10000) {
      return;
    }
    lastBackendProgressSyncRef.current = now;

    api
      .saveWatchProgress(
        user.id,
        {
          userId: user.id,
          mediaId: media?.id || `${mediaType}-${tmdbId}`,
          tmdbId: Number(tmdbId),
          mediaType,
          title: media?.title || 'Conteúdo',
          posterPath: media?.posterPath || '',
          backdropPath: media?.backdropPath || '',
          seasonNumber: mediaType === 'tv' ? currentSeasonNum : undefined,
          episodeNumber: mediaType === 'tv' ? currentEpisodeNum : undefined,
          positionSeconds: prog.currentTime,
          durationSeconds: prog.duration,
          completed: Boolean(prog.completed),
          progressPercent: prog.completed
            ? 100
            : prog.duration > 0
              ? Math.min(100, Math.round((prog.currentTime / prog.duration) * 100))
              : 10
        },
        { keepalive: Boolean(prog.flush) }
      )
      .catch(() => {});
  };

  const clearCurrentContentProgress = () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`ronycine_resume_${resumeKey}`);
      } catch {}
    }
    setSavedResumeSec(0);
    setBackendResumeSec(0);
    setBackendCompleted(false);
    if (user?.id && tmdbId) {
      api
        .resetWatchProgress(user.id, {
          tmdbId: Number(tmdbId),
          mediaType,
          seasonNumber: mediaType === 'tv' ? currentSeasonNum : undefined,
          episodeNumber: mediaType === 'tv' ? currentEpisodeNum : undefined
        })
        .catch(() => {});
    }
  };

  const handleRestartFromZero = () => {
    clearCurrentContentProgress();
    setReloadNonce(n => n + 1);
  };

  const handleShare = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const scrollCarousel = (dir: 'left' | 'right') => {
    if (!carouselRef.current) return;
    const delta = dir === 'left' ? -420 : 420;
    carouselRef.current.scrollBy({ left: delta, behavior: 'smooth' });
  };

  if (!tmdbId) {
    return (
      <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center p-6 text-center">
        <Film className="w-16 h-16 text-zinc-800 mb-6" />
        <h2 className="text-2xl font-bold font-display text-white mb-2">RONYCINE CINEMA ULTRA</h2>
        <p className="text-sm text-zinc-400 mb-6 max-w-md">
          Informe um ID TMDB válido na rota <code className="text-[#E50914]">/watch/movie/&#123;tmdbId&#125;</code> ou{' '}
          <code className="text-[#E50914]">/watch/tv/&#123;tmdbId&#125;/&#123;season&#125;/&#123;episode&#125;</code>.
        </p>
        <button
          type="button"
          onClick={() => goBack('home')}
          className="min-h-[44px] px-8 py-3 bg-[#E50914] hover:bg-red-700 text-white font-bold rounded-xl uppercase tracking-widest text-xs"
        >
          Voltar ao Catálogo
        </button>
      </div>
    );
  }

  const currentEpisode = seasonData?.episodes?.find(e => e.episodeNumber === currentEpisodeNum);
  const totalSeasons = media?.numberOfSeasons || (media?.seasons ? media.seasons.length : 1);
  const hasNextEpisode = Boolean(nextEpisodeTarget);
  const posterUrl = resolveTmdbPosterUrl(media?.backdropPath, 'w1280') || resolveTmdbPosterUrl(media?.posterPath, 'w500');
  const inMyList = media ? isMediaInMyList(media.id || media.tmdbId) : isMediaInMyList(tmdbId);

  return (
    <div className="min-h-screen bg-[#080808] text-white flex flex-col selection:bg-[#E50914] selection:text-white">
      {/* CINEMA ULTRA TOP HEADER */}
      <header className="bg-[#080808]/95 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 py-3 flex items-center justify-between z-50 sticky top-0 gap-3">
        <button
          type="button"
          onClick={() => goBack('home')}
          className="min-h-[44px] px-3 flex items-center gap-2.5 text-zinc-300 hover:text-white rounded-xl hover:bg-white/5 transition-all group shrink-0"
        >
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">Voltar</span>
        </button>

        <div className="text-center min-w-0 flex-1 px-2">
          <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight truncate font-display">
            {media?.title || (loadingMedia ? 'Carregando...' : `RONYCINE CINEMA · TMDB ${tmdbId}`)}
          </h2>
          {mediaType === 'tv' && playState !== 'CONTENT_NOT_FOUND' && (
            <p className="text-[10px] text-[#E50914] font-bold uppercase tracking-widest mt-0.5 truncate">
              Temporada {currentSeasonNum} • Episódio {currentEpisodeNum}
              {currentEpisode?.title ? ` · ${currentEpisode.title}` : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setCinemaMode(prev => !prev)}
            className={`min-h-[44px] sm:min-h-[38px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
              cinemaMode
                ? 'bg-[#E50914] border-[#E50914] text-white'
                : 'bg-[#111111] border-white/10 text-zinc-300 hover:text-white hover:border-white/25'
            }`}
            title="Alternar Modo Cinema"
          >
            <RectangleHorizontal className="w-4 h-4" />
            <span className="hidden md:inline">Modo Cinema</span>
          </button>

          {media && (
            <button
              type="button"
              onClick={() => toggleMyList(media)}
              className={`min-h-[44px] sm:min-h-[38px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                inMyList
                  ? 'bg-[#202020] border-[#E50914]/50 text-white'
                  : 'bg-[#111111] border-white/10 text-zinc-300 hover:text-white'
              }`}
              title={inMyList ? 'Na Minha Lista' : 'Adicionar à Minha Lista'}
            >
              {inMyList ? <Check className="w-4 h-4 text-[#E50914]" /> : <Plus className="w-4 h-4" />}
              <span className="hidden lg:inline">{inMyList ? 'Na Minha Lista' : 'Minha Lista'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleShare}
            className="min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl bg-[#111111] border border-white/10 hover:border-white/25 text-zinc-300 hover:text-white flex items-center justify-center transition-all"
            title={copiedLink ? 'Link copiado!' : 'Partilhar'}
          >
            {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* CINEMA ULTRA PLAYER STAGE */}
      <div
        className={`w-full bg-black relative shadow-2xl transition-all duration-300 ${
          cinemaMode ? 'h-[82vh] min-h-[420px]' : 'aspect-video lg:max-h-[80vh]'
        }`}
      >
        <ErrorBoundary
          fallbackTitle="Erro ao carregar o Player"
          onBack={() => goBack('home')}
          resetKey={`${tmdbId}-${currentSeasonNum}-${currentEpisodeNum}-${reloadNonce}`}
        >
          {playState === 'LOADING' ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#080808] text-white p-6 text-center relative overflow-hidden">
              <div className="absolute w-64 h-64 rounded-full bg-[#E50914]/10 blur-3xl pointer-events-none" />
              <div className="relative flex items-center justify-center mb-5">
                <div className="w-20 h-20 rounded-full border-2 border-white/10" />
                <div className="absolute inset-0 w-20 h-20 rounded-full border-[3px] border-[#E50914] border-t-transparent animate-spin shadow-[0_0_24px_rgba(229,9,20,0.45)]" />
                <span className="absolute text-xs font-black tracking-tighter text-white font-display">RC</span>
              </div>
              <span className="text-base sm:text-xl font-black tracking-[0.3em] text-white font-display uppercase mb-1">
                RONY<span className="text-[#E50914]">CINE</span>
              </span>
              <span className="text-[10px] font-black tracking-[0.22em] text-zinc-400 uppercase mb-3">
                PREPARANDO A SUA EXPERIÊNCIA...
              </span>
              <p className="px-4 py-1.5 rounded-xl bg-[#111111] border border-white/10 text-xs font-semibold text-zinc-200">
                A preparar reprodução...
              </p>
            </div>
          ) : playState === 'READY' && sources.length > 0 ? (
            <>
              <RonycinePlayer
                sources={sources}
                versionAvailability={versionAvailability}
                title={
                  mediaType === 'tv'
                    ? `${media?.title || 'Série'} — T${currentSeasonNum}:E${currentEpisodeNum}`
                    : media?.title
                }
                mediaTitle={media?.title}
                mediaType={mediaType}
                seasonNumber={currentSeasonNum}
                episodeNumber={currentEpisodeNum}
                releaseYear={media?.releaseYear}
                poster={posterUrl}
                resumeKey={resumeKey}
                initialPositionSeconds={backendResumeSec}
                initialPositionCompleted={backendCompleted}
                isCinemaMode={cinemaMode}
                onToggleCinemaMode={() => setCinemaMode(prev => !prev)}
                hasNextEpisode={hasNextEpisode}
                onNextEpisode={() => {
                  if (nextEpisodeTarget) {
                    handleSelectEpisode(nextEpisodeTarget.season, nextEpisodeTarget.episode);
                  }
                }}
                onBack={() => goBack('home')}
                onProgress={handleProgress}
                onRestartProgress={clearCurrentContentProgress}
                onEnded={() => {
                  if (mediaType === 'tv' && autoNextEnabled && nextEpisodeTarget) {
                    setNextEpisodeCountdown(5);
                  }
                }}
              />

              {/* AUTO NEXT EPISODE COUNTDOWN OVERLAY */}
              {nextEpisodeCountdown !== null && nextEpisodeTarget && (
                <div className="absolute inset-0 z-50 bg-[#080808]/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#E50914] mb-2">
                    PRÓXIMO EPISÓDIO AUTOMÁTICO
                  </span>
                  <h3 className="text-lg sm:text-2xl font-black text-white font-display mb-1">
                    Preparando próximo episódio...
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-300 mb-5">
                    Temporada {nextEpisodeTarget.season} • Episódio {nextEpisodeTarget.episode} inicia em{' '}
                    <span className="font-mono font-black text-[#E50914] text-base tabular-nums">
                      {nextEpisodeCountdown}s
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleSelectEpisode(nextEpisodeTarget.season, nextEpisodeTarget.episode)}
                      className="min-h-[44px] px-6 py-2.5 bg-[#E50914] hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-xl flex items-center gap-2 shadow-lg shadow-[#E50914]/30"
                    >
                      <SkipForward className="w-4 h-4" />
                      <span>Reproduzir Agora</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNextEpisodeCountdown(null)}
                      className="min-h-[44px] px-5 py-2.5 bg-[#202020] hover:bg-white/15 border border-white/15 text-zinc-200 text-xs font-bold uppercase tracking-wider rounded-xl"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 sm:p-10 bg-[#080808] text-center">
              <div className="w-14 h-14 rounded-full bg-[#E50914]/15 border border-[#E50914]/35 flex items-center justify-center text-[#E50914] mb-4">
                {playState === 'CONTENT_NOT_FOUND' ? <Film className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#E50914] mb-2">
                RONYCINE CINEMA ULTRA
              </span>
              <h3 className="text-base sm:text-xl font-black text-white max-w-lg mb-2 font-display">
                {statusMessage}
              </h3>
              <p className="text-xs text-zinc-400 max-w-md mb-6 leading-relaxed">
                {playState === 'CONTENT_NOT_FOUND'
                  ? `O ID TMDB ${tmdbId} (${mediaType === 'tv' ? 'Série' : 'Filme'}) ainda não foi importado manualmente para o catálogo oficial.`
                  : playState === 'NO_SOURCE_AVAILABLE'
                    ? `O conteúdo existe no catálogo (TMDB ${tmdbId}), mas nenhuma fonte de vídeo foi associada ainda.`
                    : sources?.[0]?.diagnostics?.externalPageUrl || sources?.[0]?.originalUrl || sources?.[0]?.url
                      ? 'Esta fonte é uma página web protegida e não permite reprodução direta no player. Pode abrir a página original do fornecedor ou associar um link com o Prefixo MGEB.'
                      : 'As fontes associadas estão desativadas, bloqueadas ou temporariamente indisponíveis.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {(sources?.[0]?.diagnostics?.externalPageUrl || sources?.[0]?.originalUrl || sources?.[0]?.url) && playState === 'SOURCE_UNAVAILABLE' && (
                  <a
                    href={sources?.[0]?.diagnostics?.externalPageUrl || sources?.[0]?.originalUrl || sources?.[0]?.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold uppercase tracking-widest rounded-xl flex items-center gap-2 transition-all"
                  >
                    <span>Abrir Página Original do Fornecedor</span>
                  </a>
                )}
                {playState === 'SOURCE_UNAVAILABLE' && (
                  <button
                    type="button"
                    onClick={() => setReloadNonce(n => n + 1)}
                    className="min-h-[44px] px-5 py-2.5 bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Tentar Novamente</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => goBack('home')}
                  className="min-h-[44px] px-5 py-2.5 bg-[#202020] hover:bg-white/15 border border-white/10 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Voltar ao Catálogo</span>
                </button>
              </div>
            </div>
          )}
        </ErrorBoundary>
      </div>

      {/* METADATA & CONTROLS STRIP */}
      {playState !== 'CONTENT_NOT_FOUND' && (
        <div className="max-w-[1600px] mx-auto w-full px-4 sm:px-8 lg:px-14 py-8 sm:py-12 space-y-10">
          {/* CONTINUAR A ASSISTIR + QUICK ACTIONS */}
          {(savedResumeSec > 5 || mediaType === 'tv') && (
            <div className="bg-[#111111] border border-white/10 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {savedResumeSec > 5 && (
                  <>
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <History className="w-4 h-4 text-[#E50914]" />
                      <span>CONTINUAR A ASSISTIR:</span>
                      <span className="font-mono text-[#E50914] tabular-nums">
                        {formatResumeClock(savedResumeSec)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRestartFromZero}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#202020] hover:bg-white/15 border border-white/10 text-[11px] font-bold uppercase tracking-wider text-zinc-200"
                    >
                      Reiniciar do Início
                    </button>
                  </>
                )}
              </div>

              {mediaType === 'tv' && (
                <div className="flex items-center gap-3 ml-auto">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-zinc-200 select-none">
                    <input
                      type="checkbox"
                      checked={autoNextEnabled}
                      onChange={toggleAutoNext}
                      className="w-4 h-4 accent-[#E50914]"
                    />
                    <span>Auto Próximo Episódio</span>
                  </label>
                  {nextEpisodeTarget && (
                    <button
                      type="button"
                      onClick={() => handleSelectEpisode(nextEpisodeTarget.season, nextEpisodeTarget.episode)}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-[#E50914] hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5"
                    >
                      <span>T{nextEpisodeTarget.season}:E{nextEpisodeTarget.episode}</span>
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* DETAILS */}
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
            <div className="flex-1 space-y-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-xs font-bold tracking-[0.18em] uppercase text-zinc-400">
                  <span className="text-[#E50914] font-black">RONYCINE CINEMA ULTRA</span>
                  <span className="opacity-30">|</span>
                  <span>{mediaType === 'movie' ? 'Filme' : 'Série'}</span>
                  <span className="opacity-30">|</span>
                  <span className="tabular-nums">{media?.releaseYear || '—'}</span>
                  <span className="flex items-center gap-1.5 text-white bg-[#111111] border border-white/10 px-2 py-0.5 rounded">
                    <Star className="w-3 h-3 fill-[#E50914] text-[#E50914]" />
                    <span className="tabular-nums">{media?.voteAverage ? media.voteAverage.toFixed(1) : '—'}</span>
                  </span>
                </div>

                <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase font-display">
                  {media?.title || (loadingMedia ? 'Carregando...' : `TMDB ${tmdbId}`)}
                </h1>

                {mediaType === 'tv' && currentEpisode && (
                  <div className="bg-[#111111] border border-white/10 p-4 rounded-xl">
                    <h3 className="text-[11px] font-black text-[#E50914] uppercase tracking-[0.2em] mb-1">
                      Agora Assistindo
                    </h3>
                    <h4 className="text-base sm:text-lg font-bold text-white">
                      E{currentEpisodeNum}. {currentEpisode.title}
                    </h4>
                    {currentEpisode.overview && (
                      <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 line-clamp-2">{currentEpisode.overview}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-[11px] font-black uppercase tracking-[0.25em] text-zinc-500">Sinopse</h3>
                <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-4xl">
                  {media?.overview || 'Explore este conteúdo na RONYCINE API.'}
                </p>
              </div>
            </div>

            <div className="w-full lg:w-80 space-y-6">
              {media?.genres && media.genres.length > 0 && (
                <div className="space-y-3 bg-[#111111] border border-white/10 rounded-2xl p-5">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Géneros</h3>
                  <div className="flex flex-wrap gap-2">
                    {media.genres.map(g => (
                      <span
                        key={g}
                        className="px-3 py-1 bg-[#202020] border border-white/10 rounded-lg text-[11px] font-bold text-zinc-200 uppercase tracking-wider"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* EPISODES AREA FOR TV */}
          {mediaType === 'tv' && (
            <div className="pt-8 border-t border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <Tv className="w-6 h-6 text-[#E50914]" />
                  <h2 className="text-xl sm:text-2xl font-bold font-display uppercase tracking-tight">Episódios</h2>
                </div>

                <select
                  value={currentSeasonNum}
                  onChange={e => handleSelectEpisode(parseInt(e.target.value, 10), 1)}
                  className="min-h-[44px] bg-[#111111] border border-white/15 rounded-xl px-5 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-[#E50914]"
                >
                  {Array.from({ length: totalSeasons }, (_, i) => i + 1).map(s => (
                    <option key={s} value={s}>Temporada {s}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {loadingSeason ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-24 bg-[#111111] rounded-xl animate-pulse" />
                  ))
                ) : (
                  seasonData?.episodes?.map(ep => {
                    const isCurrent = ep.episodeNumber === currentEpisodeNum;
                    return (
                      <button
                        key={`${ep.seasonNumber}-${ep.episodeNumber}`}
                        type="button"
                        onClick={() => handleSelectEpisode(currentSeasonNum, ep.episodeNumber)}
                        className={`flex items-start text-left p-4 rounded-xl border transition-all min-h-[72px] ${
                          isCurrent
                            ? 'bg-[#202020] border-[#E50914] shadow-lg shadow-[#E50914]/15'
                            : 'bg-[#111111] border-white/10 hover:border-white/25 hover:bg-[#181818]'
                        }`}
                      >
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center font-black text-xs shrink-0 mr-4 font-mono tabular-nums ${
                            isCurrent ? 'bg-[#E50914] text-white' : 'bg-[#202020] text-zinc-400'
                          }`}
                        >
                          {ep.episodeNumber}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-bold text-white truncate mb-1">{ep.title}</h4>
                            {isCurrent && <Play className="w-3.5 h-3.5 text-[#E50914] fill-[#E50914] shrink-0" />}
                          </div>
                          <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{ep.overview}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* HORIZONTAL RECOMMENDATIONS CAROUSEL ("Você Vai Gostar") */}
          {similarItems.length > 0 && (
            <div className="pt-8 border-t border-white/10 space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#E50914] block">
                    Recomendações Cinema Ultra
                  </span>
                  <h3 className="text-xl sm:text-2xl font-bold font-display uppercase tracking-tight text-white">
                    Você Vai Gostar
                  </h3>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => scrollCarousel('left')}
                    className="w-10 h-10 rounded-xl bg-[#111111] border border-white/15 hover:border-[#E50914] text-white flex items-center justify-center transition-colors"
                    aria-label="Anterior"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollCarousel('right')}
                    className="w-10 h-10 rounded-xl bg-[#111111] border border-white/15 hover:border-[#E50914] text-white flex items-center justify-center transition-colors"
                    aria-label="Seguinte"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div
                ref={carouselRef}
                className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory admin-scrollbar"
              >
                {similarItems.map(item => (
                  <div key={item.id} className="w-36 sm:w-44 md:w-48 shrink-0 snap-start">
                    <MediaCard item={item} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="py-12 px-6 flex flex-col items-center opacity-50 mt-auto border-t border-white/5">
        <span className="text-xl font-black tracking-tighter text-[#E50914] font-display uppercase mb-1">
          RONYCINE<span className="text-white">API</span>
        </span>
        <p className="text-[9px] text-zinc-500 font-medium tracking-[0.3em] uppercase">
          RONYCINE CINEMA ULTRA · STREAMING ENGINE
        </p>
      </footer>
    </div>
  );
};
