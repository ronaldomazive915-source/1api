import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Search,
  Film,
  Tv,
  Sparkles,
  Copy,
  Check,
  ChevronRight,
  ChevronLeft,
  Code2,
  Terminal,
  Zap,
  Database,
  BookOpen,
  Layers,
  Server,
  RefreshCw,
  AlertTriangle,
  Shuffle,
  Star,
  Calendar,
  Flame,
  Clock,
  TrendingUp,
  Info,
  Heart,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, CATALOG_UPDATED_EVENT } from '../lib/api';
import { RonycinePlayer, VideoSourceItem } from '../components/player/RonycinePlayer';
import { OFFICIAL_BASE_URL } from '../lib/siteConfig.js';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MediaCard, MediaCardSkeleton } from '../components/MediaCard';
import { MediaItem, PublicStatsResponse, TrendingSectionResponse } from '../types';
import { resolveTmdbPosterUrl } from '../lib/mediaUtils';

type TrendingTabKey = 'trending' | 'movies' | 'series' | 'animes' | 'doramas' | 'recent';

const TRENDING_TABS: Array<{ key: TrendingTabKey; label: string }> = [
  { key: 'trending', label: 'Em Alta' },
  { key: 'movies', label: 'Filmes' },
  { key: 'series', label: 'Séries' },
  { key: 'animes', label: 'Animes' },
  { key: 'doramas', label: 'Doramas' },
  { key: 'recent', label: 'Mais Recentes' }
];

interface CarouselRowProps {
  title: string;
  subtitle?: string;
  badgeText?: string;
  badgeTone?: 'red' | 'sky' | 'emerald';
  items: MediaItem[];
  loading?: boolean;
  emptyMessage: string;
  actionSlot?: React.ReactNode;
  showRanks?: boolean;
}

const CarouselRow: React.FC<CarouselRowProps> = ({
  title,
  subtitle,
  badgeText,
  badgeTone = 'red',
  items,
  loading = false,
  emptyMessage,
  actionSlot,
  showRanks = false
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollTrack = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const offset = Math.max(280, el.clientWidth * 0.78);
    el.scrollBy({ left: direction === 'left' ? -offset : offset, behavior: 'smooth' });
  };

  const badgeClasses =
    badgeTone === 'sky'
      ? 'bg-sky-500/10 border-sky-400/25 text-sky-300'
      : badgeTone === 'emerald'
        ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-300'
        : 'bg-[#E50914]/10 border-[#E50914]/30 text-[#E50914]';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">{title}</h3>
            {badgeText && (
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${badgeClasses}`}>
                {badgeText}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2">
          {actionSlot}
          {items.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => scrollTrack('left')}
                aria-label={`Anterior em ${title}`}
                className="w-8 h-8 rounded-lg bg-[#111216] border border-white/[0.08] hover:border-white/25 text-zinc-300 hover:text-white flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollTrack('right')}
                aria-label={`Seguinte em ${title}`}
                className="w-8 h-8 rounded-lg bg-[#111216] border border-white/[0.08] hover:border-white/25 text-zinc-300 hover:text-white flex items-center justify-center transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3.5">
          {Array.from({ length: 6 }).map((_, idx) => (
            <MediaCardSkeleton key={idx} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-[#0D0F15] border border-white/[0.08] rounded-xl px-4 py-6 text-center text-xs text-zinc-400">
          {emptyMessage}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex gap-3.5 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar"
        >
          {items.map((item, idx) => (
            <div
              key={`${item.inCatalog === false ? 'tmdb' : 'lib'}-${item.type}-${item.id || item.tmdbId}-${idx}`}
              className="w-[138px] sm:w-[158px] lg:w-[172px] shrink-0 snap-start"
            >
              <MediaCard item={item} rank={showRanks ? idx + 1 : undefined} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const HomeView: React.FC = () => {
  const { navigateTo, isAdmin, isFounder } = useAuth();
  const canAdmin = isAdmin || isFounder;

  const [stats, setStats] = useState<PublicStatsResponse>({
    success: true,
    moviesCount: 0,
    seriesCount: 0,
    episodesCount: 0,
    animesCount: 0,
    doramasCount: 0,
    totalCatalog: 0,
    status: 'Online'
  });
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [kpiBumpKey, setKpiBumpKey] = useState(0);
  const prevCountsRef = useRef<string>('');

  const [activeTrendingTab, setActiveTrendingTab] = useState<TrendingTabKey>('trending');
  const [trendingData, setTrendingData] = useState<TrendingSectionResponse | null>(null);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [refreshingTrending, setRefreshingTrending] = useState(false);
  const [trendingError, setTrendingError] = useState<string | null>(null);

  const [activeCodeTab, setActiveCodeTab] = useState<'curl' | 'javascript' | 'python'>('curl');
  const [copiedCode, setCopiedCode] = useState(false);

  const trendingAbortRef = useRef<AbortController | null>(null);
  const origin = OFFICIAL_BASE_URL;

  const applyStatsSnapshot = useCallback((next: PublicStatsResponse) => {
    const sig = `${next.moviesCount}-${next.seriesCount}-${next.episodesCount}-${next.animesCount}-${next.doramasCount}`;
    if (prevCountsRef.current && prevCountsRef.current !== sig) {
      setKpiBumpKey(k => k + 1);
    }
    prevCountsRef.current = sig;
    setStats(next);
  }, []);

  const loadStats = useCallback(
    async (forceRefresh = false) => {
      try {
        setStatsError(null);
        const data = await api.getPublicStats(forceRefresh);
        applyStatsSnapshot({
          success: true,
          moviesCount: Number(data.moviesCount ?? data.movies ?? 0),
          seriesCount: Number(data.seriesCount ?? data.series ?? 0),
          episodesCount: Number(data.episodesCount ?? 0),
          animesCount: Number(data.animesCount ?? 0),
          doramasCount: Number(data.doramasCount ?? 0),
          totalCatalog: Number(data.totalCatalog ?? 0),
          status: data.status || 'Online',
          updatedAt: data.updatedAt
        });
      } catch (err: any) {
        setStatsError(err?.message || 'Não foi possível carregar as estatísticas da base de dados.');
      } finally {
        setLoadingStats(false);
      }
    },
    [applyStatsSnapshot]
  );

  const loadTrending = useCallback(
    async (tab: TrendingTabKey, forceRefresh = false) => {
      if (trendingAbortRef.current) {
        trendingAbortRef.current.abort();
      }
      const controller = new AbortController();
      trendingAbortRef.current = controller;

      if (forceRefresh) {
        setRefreshingTrending(true);
      } else {
        setLoadingTrending(true);
      }
      setTrendingError(null);

      try {
        const res = await api.getTrending({ tab, refresh: forceRefresh }, controller.signal);
        if (controller.signal.aborted) return;
        setTrendingData(res);
        if (res.stats) {
          applyStatsSnapshot(res.stats);
          setLoadingStats(false);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setTrendingError(err?.message || 'Não foi possível carregar os destaques do catálogo.');
      } finally {
        if (!controller.signal.aborted) {
          setLoadingTrending(false);
          setRefreshingTrending(false);
        }
      }
    },
    [applyStatsSnapshot]
  );

  useEffect(() => {
    loadStats(false);
  }, [loadStats]);

  useEffect(() => {
    loadTrending(activeTrendingTab, false);
    return () => {
      if (trendingAbortRef.current) {
        trendingAbortRef.current.abort();
      }
    };
  }, [activeTrendingTab, loadTrending]);

  // Real-time auto-update listener across tabs/components without reloading the page
  useEffect(() => {
    const handleCatalogUpdate = () => {
      loadStats(true);
      loadTrending(activeTrendingTab, true);
    };

    window.addEventListener(CATALOG_UPDATED_EVENT, handleCatalogUpdate);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('ronycine_catalog_sync');
      bc.onmessage = evt => {
        if (evt?.data?.type === 'CATALOG_UPDATED') {
          handleCatalogUpdate();
        }
      };
    } catch {}

    return () => {
      window.removeEventListener(CATALOG_UPDATED_EVENT, handleCatalogUpdate);
      if (bc) bc.close();
    };
  }, [activeTrendingTab, loadStats, loadTrending]);

  const heroSpotlight = trendingData?.heroSpotlight || null;
  const [heroBackdropError, setHeroBackdropError] = useState(false);
  const [heroPosterError, setHeroPosterError] = useState(false);

  useEffect(() => {
    setHeroBackdropError(false);
    setHeroPosterError(false);
  }, [heroSpotlight?.id]);

  const rawBackdrop = heroSpotlight?.backdropPath || '';
  const rawPoster = heroSpotlight?.posterPath || '';
  const resolvedBackdrop = !heroBackdropError ? resolveTmdbPosterUrl(rawBackdrop, 'w1280') : '';
  const resolvedPoster = !heroPosterError ? resolveTmdbPosterUrl(rawPoster, 'w500') : '';
  const heroBackgroundImage = resolvedBackdrop || resolvedPoster;
  const isPosterOnlyBackground = !resolvedBackdrop && Boolean(resolvedPoster);
  const heroCoverImage = resolvedPoster || resolvedBackdrop;

  const heroYear = heroSpotlight?.releaseYear
    ? heroSpotlight.releaseYear
    : heroSpotlight?.releaseDate
      ? new Date(heroSpotlight.releaseDate).getFullYear()
      : heroSpotlight?.firstAirDate
        ? new Date(heroSpotlight.firstAirDate).getFullYear()
        : null;
  const heroCategoryLabel = heroSpotlight
    ? heroSpotlight.categories?.includes('anime')
      ? 'Anime'
      : heroSpotlight.categories?.includes('dorama')
        ? 'Dorama'
        : heroSpotlight.type === 'tv' || heroSpotlight.type === 'series'
          ? 'Série'
          : 'Filme'
    : null;

  const kpiCards = [
    {
      id: 'movies',
      label: 'Filmes',
      value: stats.moviesCount,
      subtitle: 'Títulos de cinema no acervo',
      icon: Film,
      accent: 'text-[#E50914]',
      iconBg: 'bg-[#E50914]/12 border-[#E50914]/25',
      onClick: () => navigateTo('movies')
    },
    {
      id: 'series',
      label: 'Séries',
      value: stats.seriesCount,
      subtitle: 'Produções seriadas indexadas',
      icon: Tv,
      accent: 'text-sky-400',
      iconBg: 'bg-sky-500/12 border-sky-500/25',
      onClick: () => navigateTo('series')
    },
    {
      id: 'episodes',
      label: 'Episódios',
      value: stats.episodesCount,
      subtitle: 'Episódios registados por temporada',
      icon: Layers,
      accent: 'text-violet-400',
      iconBg: 'bg-violet-500/12 border-violet-500/25',
      onClick: () => navigateTo('series')
    },
    {
      id: 'animes',
      label: 'Animes',
      value: stats.animesCount,
      subtitle: 'Animações japonesas catalogadas',
      icon: Sparkles,
      accent: 'text-amber-400',
      iconBg: 'bg-amber-500/12 border-amber-500/25',
      onClick: () => navigateTo('animes')
    },
    {
      id: 'doramas',
      label: 'Doramas',
      value: stats.doramasCount,
      subtitle: 'Dramas asiáticos disponíveis',
      icon: Heart,
      accent: 'text-rose-400',
      iconBg: 'bg-rose-500/12 border-rose-500/25',
      onClick: () => navigateTo('doramas')
    }
  ];

  const codeSnippets = {
    curl: `# Obter estatísticas em tempo real da biblioteca RONYCINE
curl -X GET "${origin}/api/v1/stats"

# Obter detalhes e fontes de vídeo de um filme pelo TMDB ID
curl -X GET "${origin}/api/v1/filmes/550" \\
  -H "x-api-key: rc_live_sua_chave_aqui" \\
  -H "Accept: application/json"`,
    javascript: `// Buscar filme com o SDK oficial ou fetch autenticado
async function fetchMoviePlayer(tmdbId) {
  const response = await fetch(\`${origin}/api/v1/filmes/\${tmdbId}\`, {
    headers: { 'x-api-key': 'rc_live_sua_chave_aqui' }
  });
  const data = await response.json();

  if (data.success && data.data.sources.length > 0) {
    const primarySource = data.data.sources[0];
    return primarySource.url;
  }
  throw new Error('Fonte não disponível');
}`,
    python: `import requests

def get_series_episode(tmdb_id, season, episode, api_key):
    url = f"${origin}/api/v1/series/{tmdb_id}/temporadas/{season}/episodios/{episode}"
    headers = {"x-api-key": api_key}
    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        data = response.json()
        return data.get("data", {}).get("sources", [])
    return []

sources = get_series_episode(1399, 1, 1, "rc_live_sua_chave_aqui")
print(f"Fontes encontradas: {len(sources)}")`
  };

  const jsonPreview = `{
  "success": true,
  "moviesCount": ${stats.moviesCount},
  "seriesCount": ${stats.seriesCount},
  "episodesCount": ${stats.episodesCount},
  "animesCount": ${stats.animesCount},
  "doramasCount": ${stats.doramasCount},
  "totalCatalog": ${stats.totalCatalog},
  "status": "${stats.status}"
}`;

  const copyCode = () => {
    navigator.clipboard.writeText(codeSnippets[activeCodeTab]);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] text-white selection:bg-[#E50914]/30 selection:text-white font-sans overflow-x-hidden">
      {/* 1. FEATURED HERO SPOTLIGHT & API OVERVIEW */}
      <section className="relative pt-20 sm:pt-24 pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div
          key={heroSpotlight?.id || 'hero-default'}
          className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0D0F15] shadow-2xl animate-hero-fade"
        >
          {/* Full-bleed Backdrop / Poster ambient background */}
          {heroBackgroundImage ? (
            <img
              src={heroBackgroundImage}
              alt={heroSpotlight?.title || 'RONYCINE API'}
              referrerPolicy="no-referrer"
              onError={() => {
                if (resolvedBackdrop) {
                  setHeroBackdropError(true);
                } else {
                  setHeroPosterError(true);
                }
              }}
              className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${
                isPosterOnlyBackground
                  ? 'opacity-65 scale-110 blur-xl saturate-125'
                  : 'opacity-95 animate-hero-zoom'
              }`}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#230b10] via-[#10121a] to-[#080808]" />
          )}

          {/* Measured directional dark scrim: protects left text contrast while keeping backdrop & right cover vibrant */}
          <div className="hidden lg:block absolute inset-0 bg-gradient-to-r from-[#080808]/92 via-[#080808]/58 via-48% to-transparent" />
          <div className="hidden lg:block absolute inset-0 bg-gradient-to-t from-[#080808]/60 via-transparent to-transparent" />
          <div className="lg:hidden absolute inset-0 bg-gradient-to-t from-[#080808]/95 via-[#080808]/72 via-55% to-[#080808]/15" />

          <div className="relative z-10 p-4 sm:p-8 lg:p-10 grid lg:grid-cols-12 gap-5 lg:gap-8 items-center">
            {/* LEFT COLUMN: Metadata, Synopsis & Actions */}
            <div className="lg:col-span-8 space-y-3.5 sm:space-y-4 min-w-0">
              {/* Mobile Top Showcase Row: Poster visible beside status, title & core metadata without squeezing synopsis */}
              <div className="flex lg:block items-start gap-3.5 sm:gap-4">
                {heroSpotlight && (
                  <button
                    type="button"
                    onClick={() =>
                      heroSpotlight.inCatalog !== false
                        ? navigateTo('media_detail', heroSpotlight.id)
                        : scrollToSection('demo-player')
                    }
                    aria-label={`Ver capa de ${heroSpotlight.title}`}
                    className="lg:hidden shrink-0 w-24 sm:w-28 aspect-[2/3] rounded-xl overflow-hidden border border-white/25 bg-[#14161f] shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914]"
                  >
                    {heroCoverImage ? (
                      <img
                        src={heroCoverImage}
                        alt={`Capa de ${heroSpotlight.title}`}
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (resolvedPoster) {
                            setHeroPosterError(true);
                          } else {
                            setHeroBackdropError(true);
                          }
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-[#E50914]/25 to-[#0c0d12] p-2 text-center">
                        <Film className="w-6 h-6 text-[#E50914] mb-1" />
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-200 line-clamp-2">
                          {heroSpotlight.title}
                        </span>
                      </div>
                    )}
                  </button>
                )}

                <div className="min-w-0 flex-1 space-y-2 lg:space-y-3.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-100">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/55 backdrop-blur-sm border border-white/15 whitespace-nowrap">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          stats.status === 'Online' ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                      />
                      <span>API {stats.status}</span>
                    </span>
                    {heroSpotlight && (
                      <span className="px-2.5 py-1 rounded-md bg-[#E50914]/22 backdrop-blur-sm border border-[#E50914]/45 text-[#ff5c66] font-bold uppercase tracking-wider whitespace-nowrap">
                        Em Destaque na Biblioteca
                      </span>
                    )}
                  </div>

                  {heroSpotlight ? (
                    <>
                      <h1 className="text-xl sm:text-3xl lg:text-5xl font-black text-white tracking-tight leading-[1.08] font-display text-balance drop-shadow-sm">
                        {heroSpotlight.title}
                      </h1>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-zinc-200 font-medium tabular-nums">
                        {heroCategoryLabel && (
                          <span className="text-white font-semibold">{heroCategoryLabel}</span>
                        )}
                        {heroYear && (
                          <>
                            <span className="text-zinc-500" aria-hidden="true">·</span>
                            <span>{heroYear}</span>
                          </>
                        )}
                        {typeof heroSpotlight.voteAverage === 'number' && heroSpotlight.voteAverage > 0 && (
                          <>
                            <span className="text-zinc-500" aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                              <Star className="w-3.5 h-3.5 fill-amber-400" />
                              {heroSpotlight.voteAverage.toFixed(1)}
                            </span>
                          </>
                        )}
                        {heroSpotlight.genres && heroSpotlight.genres.length > 0 && (
                          <>
                            <span className="hidden sm:inline text-zinc-500" aria-hidden="true">·</span>
                            <span className="hidden sm:inline text-zinc-300">
                              {heroSpotlight.genres.slice(0, 3).join(', ')}
                            </span>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <h1 className="text-2xl sm:text-5xl font-black text-white tracking-tight leading-[1.08] font-display text-balance">
                      RONYCINE <span className="text-[#E50914]">API</span>
                    </h1>
                  )}
                </div>
              </div>

              {/* Mobile-only full-width genres line for clean unboxed readability */}
              {heroSpotlight?.genres && heroSpotlight.genres.length > 0 && (
                <p className="sm:hidden text-[11px] font-medium text-zinc-300">
                  {heroSpotlight.genres.slice(0, 3).join(' · ')}
                </p>
              )}

              {heroSpotlight ? (
                heroSpotlight.overview && (
                  <p className="text-xs sm:text-sm text-zinc-100/90 max-w-2xl leading-relaxed line-clamp-2 sm:line-clamp-3 drop-shadow-sm">
                    {heroSpotlight.overview}
                  </p>
                )
              ) : (
                <p className="text-sm sm:text-base text-zinc-200 max-w-2xl leading-relaxed">
                  Biblioteca cinematográfica centralizada, Player Embed oficial e API REST v1 para filmes, séries, animes e doramas com métricas reais.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 pt-0.5">
                {heroSpotlight && heroSpotlight.hasPlayableSource === true && (
                  <button
                    type="button"
                    onClick={() =>
                      navigateTo('watch', heroSpotlight.id, {
                        type: heroSpotlight.type === 'series' ? 'tv' : heroSpotlight.type,
                        tmdbId: heroSpotlight.tmdbId
                      })
                    }
                    className="px-4 sm:px-5 py-2.5 min-h-[40px] bg-[#E50914] hover:bg-[#b80710] text-white font-bold text-xs sm:text-sm rounded-lg transition-colors shadow-lg shadow-[#E50914]/30 flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Play className="w-4 h-4 fill-white shrink-0" />
                    <span>Assistir Agora</span>
                  </button>
                )}

                {heroSpotlight && heroSpotlight.inCatalog !== false && (
                  <button
                    type="button"
                    onClick={() => navigateTo('media_detail', heroSpotlight.id)}
                    className="px-3.5 sm:px-4 py-2.5 min-h-[40px] bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white border border-white/25 font-semibold text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Info className="w-4 h-4 text-zinc-100 shrink-0" />
                    <span>Ver Detalhes</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => scrollToSection('demo-player')}
                  className="px-3.5 sm:px-4 py-2.5 min-h-[40px] bg-[#111216]/85 hover:bg-zinc-900 backdrop-blur-sm text-zinc-100 border border-white/20 font-semibold text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4 text-[#E50914] fill-[#E50914] shrink-0" />
                  <span>Testar Player</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigateTo('documentation')}
                  className="px-3.5 sm:px-4 py-2.5 min-h-[40px] bg-[#111216]/85 hover:bg-zinc-900 backdrop-blur-sm text-zinc-100 border border-white/20 font-semibold text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <BookOpen className="w-4 h-4 text-[#E50914] shrink-0" />
                  <span>Documentação</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigateTo('developer')}
                  className="px-3.5 sm:px-4 py-2.5 min-h-[40px] bg-[#111216]/85 hover:bg-zinc-900 backdrop-blur-sm text-zinc-100 border border-white/20 font-semibold text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Portal Dev</span>
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN (DESKTOP): Prominent Vertical Poster + Live Catalog Status Card */}
            <div className="lg:col-span-4 hidden lg:flex flex-col items-end justify-center gap-3">
              {heroSpotlight && (
                <button
                  type="button"
                  onClick={() =>
                    heroSpotlight.inCatalog !== false
                      ? navigateTo('media_detail', heroSpotlight.id)
                      : scrollToSection('demo-player')
                  }
                  aria-label={`Ver capa e detalhes de ${heroSpotlight.title}`}
                  className="group relative w-44 xl:w-52 aspect-[2/3] rounded-xl overflow-hidden border border-white/25 bg-[#12141c] shadow-[0_24px_60px_rgba(0,0,0,0.85)] transition-transform duration-300 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914]"
                >
                  {heroCoverImage ? (
                    <img
                      src={heroCoverImage}
                      alt={`Poster de ${heroSpotlight.title}`}
                      referrerPolicy="no-referrer"
                      onError={() => {
                        if (resolvedPoster) {
                          setHeroPosterError(true);
                        } else {
                          setHeroBackdropError(true);
                        }
                      }}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-[#E50914]/20 via-[#13151d] to-[#080808] p-4 text-center">
                      <Film className="w-9 h-9 text-[#E50914] mb-2" />
                      <span className="text-xs font-bold uppercase tracking-wider text-white line-clamp-3">
                        {heroSpotlight.title}
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/75 via-black/20 to-transparent pointer-events-none" />
                </button>
              )}

              <div className="bg-black/75 backdrop-blur-md border border-white/15 rounded-xl px-4 py-2.5 text-left w-full max-w-[208px] space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                  <span>CATÁLOGO INDEXADO</span>
                  <span className="text-emerald-400 font-bold">LIVE</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-black text-white tabular-nums">
                    {loadingStats ? '—' : stats.totalCatalog.toLocaleString('pt-PT')}
                  </span>
                  <span className="text-[10px] text-zinc-400">títulos publicados</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 5 ESTATÍSTICAS REAIS DA BIBLIOTECA */}
      <section aria-label="Estatísticas da Biblioteca" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-12">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">
              ESTADO REAL DA BIBLIOTECA RONYCINE
            </h2>
          </div>
          {statsError && (
            <button
              type="button"
              onClick={() => loadStats(true)}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 font-semibold"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Falha ao carregar métricas · Tentar novamente</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {kpiCards.map(card => {
            const Icon = card.icon;
            return (
              <button
                key={`${card.id}-${kpiBumpKey}`}
                type="button"
                onClick={card.onClick}
                className="text-left bg-[#111216] border border-white/[0.08] hover:border-[#E50914]/50 rounded-xl p-4 sm:p-5 transition-all group shadow-sm hover:shadow-lg hover:shadow-black/50 flex flex-col justify-between min-h-[132px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 group-hover:text-zinc-200 transition-colors">
                    {card.label}
                  </span>
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${card.iconBg}`}>
                    <Icon className={`w-4 h-4 ${card.accent}`} />
                  </div>
                </div>

                <div className="my-2">
                  {loadingStats ? (
                    <div className="h-8 w-20 bg-white/10 animate-pulse rounded" />
                  ) : (
                    <div className="text-2xl sm:text-3xl font-black text-white tracking-tight tabular-nums animate-kpi-bump">
                      {card.value.toLocaleString('pt-PT')}
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-zinc-500 line-clamp-1">{card.subtitle}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. TENDÊNCIAS DE HOJE & DESTA SEMANA */}
      <section id="trending-section" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-14 space-y-10">
        <div className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl p-5 sm:p-7 space-y-8 shadow-xl">
          {trendingError && (
            <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 flex items-center justify-between gap-3 text-xs text-red-200">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                {trendingError}
              </span>
              <button
                type="button"
                onClick={() => loadTrending(activeTrendingTab, true)}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold shrink-0"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* Row 1: TENDÊNCIAS DE HOJE */}
          <CarouselRow
            title="TENDÊNCIAS DE HOJE"
            subtitle="Conteúdos que estão em destaque ou apresentam maior popularidade no período diário."
            badgeText="DIÁRIO"
            badgeTone="red"
            items={(trendingData?.libraryItems || []).slice(0, 6)}
            loading={loadingTrending && !trendingData}
            emptyMessage="Ainda não existem títulos publicados nas tendências de hoje."
            actionSlot={
              <button
                type="button"
                onClick={() => navigateTo('search')}
                className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>Ver mais</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            }
          />

          {/* Row 2: DESTA SEMANA */}
          <CarouselRow
            title="DESTA SEMANA"
            subtitle="Filmes e séries que se destacam durante a semana atual."
            badgeText="ESTA SEMANA"
            badgeTone="sky"
            items={(trendingData?.recentAdditions || trendingData?.libraryItems || []).slice(0, 6)}
            loading={loadingTrending && !trendingData}
            emptyMessage="Ainda não existem destaques semanais publicados."
            actionSlot={
              <button
                type="button"
                onClick={() => navigateTo('search')}
                className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>Ver mais</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            }
          />
        </div>
      </section>

      {/* 4. ÚLTIMOS CONTEÚDOS ADICIONADOS & MAIS POPULARES */}
      <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-16 space-y-10">
        <CarouselRow
          title="Últimos Conteúdos Adicionados"
          subtitle="As adições e atualizações mais recentes da biblioteca RONYCINE."
          badgeText="Recentes"
          badgeTone="red"
          items={trendingData?.recentAdditions || []}
          loading={loadingTrending && !trendingData}
          emptyMessage="Ainda não existem adições recentes publicadas."
          actionSlot={
            <button
              type="button"
              onClick={() => navigateTo('search')}
              className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-[#E50914]" />
              <span>Explorar catálogo</span>
            </button>
          }
        />

        <CarouselRow
          title="Mais Populares da Biblioteca"
          subtitle="Ordenados por popularidade oficial do TMDB e avaliação real dos títulos registados."
          badgeText="Top Popularidade"
          badgeTone="red"
          items={trendingData?.popularLibrary || []}
          loading={loadingTrending && !trendingData}
          emptyMessage="Sem títulos populares publicados na biblioteca."
          showRanks
          actionSlot={
            <button
              type="button"
              onClick={() => navigateTo('search')}
              className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <TrendingUp className="w-3.5 h-3.5 text-[#E50914]" />
              <span>Pesquisar tudo</span>
            </button>
          }
        />
      </section>

      {/* 5. PUBLIC DEMO PLAYER SECTION ("EXPERIMENTE NOSSO PLAYER") */}
      <section id="demo-player" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20">
        <div className="bg-[#0D0D14] border border-white/10 rounded-3xl p-6 sm:p-8 md:p-10 shadow-2xl relative">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#E50914] uppercase tracking-widest mb-1">
                <Sparkles className="w-4 h-4" />
                <span>DEMONSTRAÇÃO INTERATIVA PÚBLICA</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                EXPERIMENTE NOSSO PLAYER
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
                Pesquise por nome ou insira um ID TMDB para testar a busca de fontes e a reprodução de vídeo instantânea.
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold self-start md:self-auto">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Player Ativo & Operacional</span>
            </div>
          </div>

          <div className="pt-8">
            <InteractiveDemoPlayer />
          </div>
        </div>
      </section>

      {/* 6. RECURSOS E RECURSOS DA API */}
      <section id="api-resources" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20">
        <div className="text-center max-w-3xl mx-auto mb-12 space-y-3">
          <span className="text-xs font-mono font-bold text-[#E50914] uppercase tracking-widest">
            RECURSOS TÉCNICOS
          </span>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Projetado para Desenvolvedores Exigentes
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400">
            Tudo o que precisa para alimentar o seu aplicativo de reprodução ou catálogo com metadados e streams seguros.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#0B0B0E] border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#E50914]/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-[#E50914]/15 border border-[#E50914]/30 flex items-center justify-center text-[#E50914]">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">Integração Total TMDB</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Consulte conteúdos pelo ID oficial do TMDB. A nossa API resolve títulos, sinopses, capas, temporadas e fontes automaticamente.
            </p>
          </div>

          <div className="bg-[#0B0B0E] border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#E50914]/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Server className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">Fontes de Vídeo HLS & MP4</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Suporte nativo para streams M3U8 em resolução adaptativa, links MP4 diretos e iFrames com proteção contra falhas.
            </p>
          </div>

          <div className="bg-[#0B0B0E] border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#E50914]/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">Baixa Latência & 99.9% Uptime</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Infraestrutura otimizada com caching inteligente e banco centralizado com respostas em milissegundos.
            </p>
          </div>
        </div>
      </section>

      {/* 7. CODE EXAMPLES & INTERACTIVE TABS */}
      <section id="code-examples" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20">
        <div className="bg-[#0B0B0F] border border-white/10 rounded-3xl p-6 sm:p-8 overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#E50914] uppercase tracking-widest mb-1">
                <Terminal className="w-4 h-4" />
                <span>INTEGRAÇÃO RÁPIDA</span>
              </div>
              <h2 className="text-xl sm:text-3xl font-black text-white tracking-tight">
                Exemplos de Integração em Código
              </h2>
            </div>

            {/* Language Selector Tabs */}
            <div className="flex items-center p-1 bg-black/60 rounded-xl border border-white/10 self-start lg:self-auto">
              <button
                type="button"
                onClick={() => setActiveCodeTab('curl')}
                className={`px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all ${
                  activeCodeTab === 'curl' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                }`}
              >
                cURL
              </button>
              <button
                type="button"
                onClick={() => setActiveCodeTab('javascript')}
                className={`px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all ${
                  activeCodeTab === 'javascript' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                }`}
              >
                JavaScript
              </button>
              <button
                type="button"
                onClick={() => setActiveCodeTab('python')}
                className={`px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all ${
                  activeCodeTab === 'python' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Python
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6 pt-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 px-1">
                <span>Requisição ({activeCodeTab.toUpperCase()})</span>
                <button
                  type="button"
                  onClick={copyCode}
                  className="flex items-center gap-1 text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded transition-colors text-[11px]"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
              <pre className="bg-black/80 border border-white/10 rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto leading-relaxed h-[260px]">
                <code>{codeSnippets[activeCodeTab]}</code>
              </pre>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 px-1">
                <span>Resposta Real (`/api/v1/stats`)</span>
                <span className="text-[10px] text-emerald-400 font-mono font-bold">200 OK</span>
              </div>
              <pre className="bg-black/80 border border-white/10 rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed h-[260px]">
                <code>{jsonPreview}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* 8. DOCUMENTATION PREVIEW BANNER */}
      <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20">
        <div className="bg-gradient-to-r from-[#E50914]/20 via-[#0B0B0F] to-[#0B0B0F] border border-[#E50914]/30 rounded-3xl p-8 sm:p-12 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-3 max-w-2xl">
            <span className="text-xs font-mono font-bold text-[#E50914] uppercase tracking-widest flex items-center gap-1.5">
              <Code2 className="w-4 h-4" />
              <span>GUIA DO DESENVOLVEDOR</span>
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Pronto para integrar no seu projeto?
            </h2>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Consulte a documentação completa dos endpoints `/api/v1/filmes`, `/api/v1/series`, `/api/v1/trending`, `/api/v1/stats` e autenticação de chaves.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigateTo('documentation')}
            className="px-8 py-4 bg-[#E50914] hover:bg-[#b80710] text-white font-black text-sm uppercase tracking-wider rounded-xl transition-all shadow-xl shadow-[#E50914]/40 shrink-0 flex items-center justify-center gap-2"
          >
            <BookOpen className="w-5 h-5" />
            <span>Ver Documentação Completa</span>
          </button>
        </div>
      </section>
    </div>
  );
};

/* =====================================================================
   PUBLIC INTERACTIVE DEMO PLAYER COMPONENT ("EXPERIMENTE NOSSO PLAYER")
   ===================================================================== */
const InteractiveDemoPlayer: React.FC = () => {
  const [contentType, setContentType] = useState<'movie' | 'tv' | 'all'>('movie');
  const [queryInput, setQueryInput] = useState('');
  const [seasonNum, setSeasonNum] = useState(1);
  const [episodeNum, setEpisodeNum] = useState(1);

  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<any | null>(null);

  const [isPickingRandom, setIsPickingRandom] = useState(false);
  const [surpriseItem, setSurpriseItem] = useState<any | null>(null);
  const [surpriseError, setSurpriseError] = useState<string | null>(null);
  const [recentSurpriseIds, setRecentSurpriseIds] = useState<number[]>([]);

  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [demoSources, setDemoSources] = useState<VideoSourceItem[]>([]);
  const [demoTitle, setDemoTitle] = useState<string>('');
  const [demoPoster, setDemoPoster] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!queryInput.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const cleanQuery = queryInput.trim();
        const res = await api.search(cleanQuery, contentType);
        if (res && (res.local || res.external)) {
          const combined = [...(res.local || []), ...(res.external || [])];
          setSearchResults(combined.slice(0, 8));
          setShowDropdown(true);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [queryInput, contentType]);

  const handleSelectMedia = (item: any) => {
    setSelectedMedia(item);
    setSurpriseItem(null);
    setSurpriseError(null);
    setQueryInput(`${item.title} (${item.tmdbId})`);
    setShowDropdown(false);
  };

  const startDemoPlayback = async (
    tmdbIdToQuery: number,
    typeToQuery: 'movie' | 'tv',
    sNum: number,
    eNum: number,
    fallbackMedia?: any
  ) => {
    setErrorMessage(null);
    setDemoSources([]);
    setIsLoadingSource(true);

    try {
      const res =
        typeToQuery === 'movie'
          ? await api.getPlayerMovie(tmdbIdToQuery)
          : await api.getPlayerTv(tmdbIdToQuery, sNum, eNum);

      const resolvedList =
        res?.sources && res.sources.length > 0
          ? res.sources
          : res?.source?.url
            ? [res.source, ...(res.alternativeSources || [])]
            : [];

      if (res && res.success && resolvedList.length > 0) {
        setDemoSources(resolvedList as VideoSourceItem[]);
        setDemoTitle(
          res.content?.title ||
            fallbackMedia?.title ||
            (typeToQuery === 'tv' ? `Série ${tmdbIdToQuery} (T${sNum}:E${eNum})` : `Filme ${tmdbIdToQuery}`)
        );
        setDemoPoster(res.content?.backdrop || res.content?.poster || fallbackMedia?.backdropPath || fallbackMedia?.posterPath);
      } else {
        setErrorMessage(res?.message || 'Este conteúdo ainda não possui uma fonte de demonstração disponível.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao consultar a rede de vídeo RONYCINE.');
    } finally {
      setIsLoadingSource(false);
    }
  };

  const handlePlayback = async () => {
    setErrorMessage(null);

    let tmdbIdToQuery: number | null = null;
    let typeToQuery: 'movie' | 'tv' = contentType === 'tv' ? 'tv' : 'movie';

    if (selectedMedia && selectedMedia.tmdbId) {
      tmdbIdToQuery = Number(selectedMedia.tmdbId);
      typeToQuery = selectedMedia.type === 'tv' || selectedMedia.type === 'series' ? 'tv' : 'movie';
    } else {
      const parsed = parseInt(queryInput.replace(/\D/g, ''), 10);
      if (!isNaN(parsed) && parsed > 0) {
        tmdbIdToQuery = parsed;
      }
    }

    if (!tmdbIdToQuery) {
      setDemoSources([]);
      setErrorMessage('Por favor, digite um título válido ou insira um TMDB ID numérico.');
      return;
    }

    await startDemoPlayback(tmdbIdToQuery, typeToQuery, seasonNum, episodeNum, selectedMedia);
  };

  const handleSurpriseMe = async () => {
    if (isPickingRandom) return;
    setIsPickingRandom(true);
    setSurpriseError(null);
    setErrorMessage(null);
    setShowDropdown(false);

    try {
      const res = await api.getRandomCatalogItem(contentType, recentSurpriseIds);
      if (res?.success && res.item) {
        setSurpriseItem(res.item);
        const pickedId = Number(res.item.tmdbId);
        if (pickedId > 0) {
          setRecentSurpriseIds(prev => [pickedId, ...prev.filter(id => id !== pickedId)].slice(0, 15));
        }
      } else {
        setSurpriseItem(null);
        setSurpriseError(res?.message || 'Não existem conteúdos disponíveis para seleção aleatória neste momento.');
      }
    } catch {
      setSurpriseItem(null);
      setSurpriseError('Não existem conteúdos disponíveis para seleção aleatória neste momento.');
    } finally {
      setIsPickingRandom(false);
    }
  };

  const handleWatchSurprise = async () => {
    if (!surpriseItem || !surpriseItem.tmdbId) return;
    const mediaType: 'movie' | 'tv' =
      surpriseItem.type === 'tv' || surpriseItem.type === 'series' ? 'tv' : 'movie';
    const targetSeason = mediaType === 'tv' ? Number(surpriseItem.seasonNumber || 1) : 1;
    const targetEpisode = mediaType === 'tv' ? Number(surpriseItem.episodeNumber || 1) : 1;

    setSelectedMedia(surpriseItem);
    setQueryInput(`${surpriseItem.title} (${surpriseItem.tmdbId})`);
    if (mediaType === 'tv') {
      setSeasonNum(targetSeason);
      setEpisodeNum(targetEpisode);
    }

    await startDemoPlayback(Number(surpriseItem.tmdbId), mediaType, targetSeason, targetEpisode, surpriseItem);
  };

  const primarySource = demoSources[0];
  const showSeriesInputs =
    contentType === 'tv' ||
    (contentType === 'all' && (selectedMedia?.type === 'tv' || selectedMedia?.type === 'series'));

  return (
    <div className="grid lg:grid-cols-12 gap-8 items-start">
      {/* Left Input & Selection Form (5 Cols) */}
      <div className="lg:col-span-5 space-y-5 bg-[#09090D] border border-white/10 rounded-2xl p-5 sm:p-6">
        <div className="flex p-1 bg-black/80 rounded-xl border border-white/10 gap-1">
          <button
            type="button"
            onClick={() => {
              setContentType('movie');
              setSelectedMedia(null);
              setSurpriseItem(null);
              setSurpriseError(null);
              setQueryInput('');
              setErrorMessage(null);
              setDemoSources([]);
            }}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 min-h-[42px] ${
              contentType === 'movie' ? 'bg-[#E50914] text-white shadow-md' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Filme</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setContentType('tv');
              setSelectedMedia(null);
              setSurpriseItem(null);
              setSurpriseError(null);
              setQueryInput('');
              setErrorMessage(null);
              setDemoSources([]);
            }}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 min-h-[42px] ${
              contentType === 'tv' ? 'bg-[#E50914] text-white shadow-md' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Série</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setContentType('all');
              setSelectedMedia(null);
              setSurpriseItem(null);
              setSurpriseError(null);
              setQueryInput('');
              setErrorMessage(null);
              setDemoSources([]);
            }}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 min-h-[42px] ${
              contentType === 'all' ? 'bg-[#E50914] text-white shadow-md' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Todos</span>
          </button>
        </div>

        <div className="relative">
          <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
            Pesquisar Título ou TMDB ID
          </label>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => {
                setQueryInput(e.target.value);
                setSelectedMedia(null);
              }}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              placeholder={
                contentType === 'tv'
                  ? 'Ex: Game of Thrones ou ID 1399'
                  : contentType === 'movie'
                    ? 'Ex: Clube da Luta ou ID 550'
                    : 'Ex: Clube da Luta, Game of Thrones ou TMDB ID'
              }
              className="w-full bg-black/60 border border-white/15 rounded-xl py-3 pl-10 pr-10 text-xs sm:text-sm text-white placeholder:text-zinc-600 focus:border-[#E50914] focus:outline-none transition-all"
            />
            {isSearching && (
              <RefreshCw className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#E50914] animate-spin" />
            )}
          </div>

          {showDropdown && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-2 bg-[#0F0F14] border border-white/15 rounded-xl shadow-2xl z-30 max-h-60 overflow-y-auto py-1">
              {searchResults.map((item) => (
                <button
                  key={`${item.type}-${item.tmdbId}`}
                  type="button"
                  onClick={() => handleSelectMedia(item)}
                  className="w-full px-3 py-2 text-left hover:bg-white/10 flex items-center gap-3 transition-colors text-xs border-b border-white/5 last:border-0"
                >
                  {resolveTmdbPosterUrl(item.posterPath, 'w185') ? (
                    <img
                      src={resolveTmdbPosterUrl(item.posterPath, 'w185')}
                      alt={item.title}
                      className="w-8 h-12 object-cover rounded bg-black shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-12 rounded bg-black flex items-center justify-center shrink-0 text-zinc-600">
                      <Film className="w-4 h-4" />
                    </div>
                  )}
                  <div className="truncate">
                    <div className="font-bold text-white truncate">{item.title}</div>
                    <div className="text-[10px] text-zinc-400 flex items-center gap-2 mt-0.5">
                      <span className="text-[#E50914] font-mono font-bold">TMDB: {item.tmdbId}</span>
                      <span>•</span>
                      <span>{item.releaseYear || item.firstAirDate?.substring(0, 4) || 'TMDB'}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {showSeriesInputs && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                Temporada
              </label>
              <input
                type="number"
                min="1"
                value={seasonNum}
                onChange={(e) => setSeasonNum(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full bg-black/60 border border-white/15 rounded-xl py-2.5 px-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                Episódio
              </label>
              <input
                type="number"
                min="1"
                value={episodeNum}
                onChange={(e) => setEpisodeNum(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full bg-black/60 border border-white/15 rounded-xl py-2.5 px-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              />
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={handlePlayback}
            disabled={isLoadingSource}
            className="flex-1 min-h-[46px] px-4 py-3 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-[#E50914]/30 flex items-center justify-center gap-2"
          >
            {isLoadingSource ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Play className="w-4 h-4 fill-white shrink-0" />
                <span>REPRODUZIR NO DEMO PLAYER</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSurpriseMe}
            disabled={isPickingRandom || isLoadingSource}
            className="sm:w-auto min-h-[46px] px-4 py-3 bg-[#111111] hover:bg-[#191922] disabled:opacity-50 text-white border border-[#E50914]/50 hover:border-[#E50914] font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 shrink-0"
          >
            {isPickingRandom ? (
              <>
                <RefreshCw className="w-4 h-4 text-[#E50914] animate-spin shrink-0" />
                <span>A escolher algo para si...</span>
              </>
            ) : (
              <>
                <Shuffle className="w-4 h-4 text-[#E50914] shrink-0" />
                <span>SURPREENDA-ME</span>
              </>
            )}
          </button>
        </div>

        {isPickingRandom && (
          <div className="bg-[#111111] border border-white/10 rounded-xl p-4 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-[#E50914] border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-xs font-semibold text-zinc-200">A escolher algo para si...</span>
          </div>
        )}

        {!isPickingRandom && surpriseError && (
          <div className="bg-[#111111] border border-white/10 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-zinc-300 leading-relaxed">{surpriseError}</p>
          </div>
        )}

        {!isPickingRandom && surpriseItem && (
          <div className="bg-[#111111] border border-[#E50914]/35 rounded-2xl p-3.5 sm:p-4 space-y-3.5 transition-all">
            <div className="flex items-start gap-3.5">
              {surpriseItem.posterPath ? (
                <img
                  src={resolveTmdbPosterUrl(surpriseItem.posterPath, 'w185')}
                  alt={surpriseItem.title}
                  className="w-16 h-24 sm:w-[72px] sm:h-[108px] object-cover rounded-xl bg-black border border-white/10 shrink-0"
                />
              ) : (
                <div className="w-16 h-24 sm:w-[72px] sm:h-[108px] rounded-xl bg-black/80 border border-white/10 flex items-center justify-center shrink-0">
                  {surpriseItem.type === 'tv' || surpriseItem.type === 'series' ? (
                    <Tv className="w-6 h-6 text-zinc-500" />
                  ) : (
                    <Film className="w-6 h-6 text-zinc-500" />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-[#E50914]/20 border border-[#E50914]/40 text-[#E50914] text-[10px] font-black uppercase tracking-wider">
                    {surpriseItem.type === 'tv' || surpriseItem.type === 'series' ? 'SÉRIE' : 'FILME'}
                  </span>
                  {(surpriseItem.type === 'tv' || surpriseItem.type === 'series') && surpriseItem.seasonNumber && (
                    <span className="text-[10px] font-mono font-bold text-zinc-400">
                      T{surpriseItem.seasonNumber} · E{surpriseItem.episodeNumber || 1}
                    </span>
                  )}
                </div>

                <h4 className="text-sm sm:text-base font-black text-white leading-snug line-clamp-2 font-display">
                  {surpriseItem.title}
                </h4>

                <div className="flex items-center gap-3 text-[11px] text-zinc-400 flex-wrap">
                  {surpriseItem.releaseYear && (
                    <span className="flex items-center gap-1 font-mono tabular-nums">
                      <Calendar className="w-3 h-3 text-zinc-500" />
                      {surpriseItem.releaseYear}
                    </span>
                  )}
                  {typeof surpriseItem.voteAverage === 'number' && surpriseItem.voteAverage > 0 && (
                    <span className="flex items-center gap-1 font-mono tabular-nums text-amber-400 font-bold">
                      <Star className="w-3 h-3 fill-amber-400" />
                      {surpriseItem.voteAverage.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleWatchSurprise}
                disabled={isLoadingSource}
                className="flex-1 min-h-[44px] px-4 py-2.5 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>ASSISTIR AGORA</span>
              </button>

              <button
                type="button"
                onClick={handleSurpriseMe}
                disabled={isPickingRandom || isLoadingSource}
                className="sm:w-auto min-h-[44px] px-4 py-2.5 bg-[#202020] hover:bg-white/15 border border-white/10 text-zinc-200 hover:text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5"
              >
                <Shuffle className="w-3.5 h-3.5 text-[#E50914]" />
                <span>ESCOLHER OUTRO</span>
              </button>
            </div>
          </div>
        )}

        {selectedMedia && !surpriseItem && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-3">
            {resolveTmdbPosterUrl(selectedMedia.posterPath, 'w185') ? (
              <img
                src={resolveTmdbPosterUrl(selectedMedia.posterPath, 'w185')}
                alt={selectedMedia.title}
                className="w-10 h-14 object-cover rounded shadow"
              />
            ) : (
              <div className="w-10 h-14 rounded bg-black flex items-center justify-center text-zinc-600">
                <Film className="w-4 h-4" />
              </div>
            )}
            <div className="text-xs truncate">
              <span className="text-[9px] font-mono text-[#E50914] font-bold block uppercase">
                Conteúdo Selecionado
              </span>
              <span className="font-bold text-white block truncate">{selectedMedia.title}</span>
              <span className="text-[10px] text-zinc-400">
                {selectedMedia.releaseYear || selectedMedia.firstAirDate?.substring(0, 4) || 'Catálogo'}
                {selectedMedia.voteAverage ? ` · Nota ${Number(selectedMedia.voteAverage).toFixed(1)}` : ''}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Right Video Player Screen Container (7 Cols) */}
      <div className="lg:col-span-7 bg-black border border-white/15 rounded-2xl overflow-hidden shadow-2xl relative min-h-[340px] sm:min-h-[420px] flex flex-col justify-between">
        <div className="p-3 bg-gradient-to-b from-black/90 to-transparent flex items-center justify-between z-20 border-b border-white/5">
          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-300 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#E50914] shrink-0" />
            <span className="font-bold text-white truncate">
              {demoTitle || selectedMedia?.title || 'Player de Demonstração RONYCINE'}
            </span>
          </div>
        </div>

        <div className="relative flex-1 flex items-center justify-center bg-[#050507] aspect-video">
          <ErrorBoundary fallbackTitle="Erro no Demo Player" resetKey={primarySource?.url || 'standby'}>
            {isLoadingSource ? (
              <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                <RefreshCw className="w-8 h-8 text-[#E50914] animate-spin" />
                <p className="text-xs font-mono text-zinc-400">A preparar reprodução...</p>
              </div>
            ) : errorMessage ? (
              <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center max-w-md">
                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-white">Conteúdo indisponível</h4>
                <p className="text-xs text-red-300 font-medium bg-red-500/10 border border-red-500/20 p-3 rounded-xl leading-relaxed">
                  {errorMessage}
                </p>
              </div>
            ) : demoSources.length > 0 ? (
              <div className="w-full h-full">
                <RonycinePlayer
                  sources={demoSources}
                  title={demoTitle || selectedMedia?.title}
                  poster={demoPoster}
                  autoplay={true}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center space-y-3 p-8 text-center text-zinc-600">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-500">
                  <Play className="w-8 h-8 opacity-40 fill-zinc-500" />
                </div>
                <h4 className="text-sm font-bold text-zinc-300">Aguardando Seleção de Conteúdo</h4>
                <p className="text-xs text-zinc-500 max-w-xs">
                  Pesquise um filme ou série à esquerda ou clique em SURPREENDA-ME para assistir imediatamente.
                </p>
              </div>
            )}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};
