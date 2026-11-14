import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Film,
  Tv,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Sparkles,
  Clock,
  Check,
  Layers,
  ChevronRight,
  ChevronLeft,
  X,
  TrendingUp,
  Activity,
  History,
  Zap,
  Calendar,
  Star,
  PlusCircle,
  CheckCircle,
  ExternalLink,
  AlertTriangle
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { TmdbSearchResult, MediaItem, ImportHistoryItem, ImportStatus } from '../../types.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';
import { SourceModal } from './SourceModal.js';
import { motion, AnimatePresence } from 'motion/react';

interface TmdbImporterProps {
  onCatalogUpdated?: () => void;
  onViewCatalogItem?: (item: { id?: string; tmdbId: number; type: 'movie' | 'tv'; title: string }) => void;
}

interface DuplicateConflictState {
  searched: TmdbSearchResult;
  existing: MediaItem | null;
  message: string;
}

const SafeTmdbPoster: React.FC<{
  path?: string;
  alt: string;
  type?: 'movie' | 'tv' | string;
  className?: string;
}> = ({ path, alt, type, className = 'w-full h-full object-cover' }) => {
  const [errored, setErrored] = useState(false);
  const url = resolveTmdbPosterUrl(path, 'w500');

  if (!url || errored) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-700 gap-1 p-2">
        {type === 'tv' ? <Tv className="w-5 h-5" /> : <Film className="w-5 h-5" />}
        <span className="text-[8px] font-black uppercase tracking-widest text-center">SEM POSTER</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
};

export const TmdbImporter: React.FC<TmdbImporterProps> = ({
  onCatalogUpdated,
  onViewCatalogItem
}) => {
  // --- UI States ---
  const [activeTab, setActiveTab] = useState<'smart' | 'mass' | 'history'>('smart');
  const [tmdbStatus, setTmdbStatus] = useState<string>('OFFLINE');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  // --- Smart Search States ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTypeFilter, setSearchTypeFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Carousel Lists States ---
  const [recentMedia, setRecentMedia] = useState<TmdbSearchResult[]>([]);
  const [popularMovies, setPopularMovies] = useState<TmdbSearchResult[]>([]);
  const [popularSeries, setPopularSeries] = useState<TmdbSearchResult[]>([]);
  const [trendingMedia, setTrendingMedia] = useState<TmdbSearchResult[]>([]);

  const [loadingLists, setLoadingLists] = useState<Record<string, boolean>>({
    recent: false,
    popularMovies: false,
    popularSeries: false,
    trending: false
  });

  const [trendingFilter, setTrendingFilter] = useState<{ type: 'all' | 'movie' | 'tv'; period: 'day' | 'week' }>({
    type: 'all',
    period: 'day'
  });

  // --- Mass Import States ---
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState<ImportStatus | null>(null);

  // --- Preview, Duplicate Dialog & Feedback ---
  const [previewItem, setPreviewItem] = useState<TmdbSearchResult | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateConflictState | null>(null);
  const [importingItemId, setImportingItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; msg: string } | null>(null);

  // --- Strict 100% Manual Import Confirmation & Series Episode Selection States ---
  const [confirmMovieImport, setConfirmMovieImport] = useState<TmdbSearchResult | null>(null);
  const [seriesToImport, setSeriesToImport] = useState<TmdbSearchResult | null>(null);
  const [loadingSeriesDetails, setLoadingSeriesDetails] = useState<boolean>(false);
  const [seriesSeasons, setSeriesSeasons] = useState<any[]>([]);
  const [seasonEpisodesMap, setSeasonEpisodesMap] = useState<Record<number, any[]>>({});
  const [loadingSeasonNum, setLoadingSeasonNum] = useState<number | null>(null);
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set());

  // --- History ---
  const [historyList, setHistoryList] = useState<ImportHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // --- SOURCE MODAL ---
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [sourceModalData, setSourceModalData] = useState<any>(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    checkTmdbStatus();
    loadAllLists();
    loadHistory();
  }, []);

  useEffect(() => {
    if (activeTab !== 'mass' && !isProcessingBatch) return;
    const timer = setInterval(async () => {
      try {
        const status = await api.getMassImportStatus();
        if (status.active) {
          setBatchProgress(status);
          setIsProcessingBatch(true);
        } else if (isProcessingBatch) {
          setBatchProgress(status);
          setIsProcessingBatch(false);
          loadHistory();
          if (onCatalogUpdated) onCatalogUpdated();
        }
      } catch {
        // Ignore transient polling failures
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [onCatalogUpdated, activeTab, isProcessingBatch]);

  const checkTmdbStatus = async () => {
    setIsCheckingStatus(true);
    try {
      const res = await api.getTmdbStatus();
      setTmdbStatus(res.status);
    } catch {
      setTmdbStatus('OFFLINE');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const loadAllLists = async (forceRefresh = false) => {
    loadList('recent', 'recent', 'all', forceRefresh);
    loadList('popularMovies', 'popular', 'movie', forceRefresh);
    loadList('popularSeries', 'popular', 'tv', forceRefresh);
    loadTrending(forceRefresh);
  };

  const loadList = async (key: string, list: 'popular' | 'recent', type: 'all' | 'movie' | 'tv', refresh = false) => {
    setLoadingLists(prev => ({ ...prev, [key]: true }));
    try {
      const res = await api.getTmdbList({ list, type, refresh });
      if (key === 'recent') setRecentMedia((res.results || []).slice(0, 10));
      else if (key === 'popularMovies') setPopularMovies((res.results || []).slice(0, 10));
      else if (key === 'popularSeries') setPopularSeries((res.results || []).slice(0, 10));
    } catch (e) {
      console.error(`Failed to load ${key} list:`, e);
    } finally {
      setLoadingLists(prev => ({ ...prev, [key]: false }));
    }
  };

  const loadTrending = async (refresh = false) => {
    setLoadingLists(prev => ({ ...prev, trending: true }));
    try {
      const res = await api.getTmdbList({
        list: 'trending',
        type: trendingFilter.type,
        period: trendingFilter.period,
        refresh
      });
      setTrendingMedia((res.results || []).slice(0, 10));
    } catch (e) {
      console.error('Failed to load trending list:', e);
    } finally {
      setLoadingLists(prev => ({ ...prev, trending: false }));
    }
  };

  useEffect(() => {
    loadTrending();
  }, [trendingFilter]);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const logs = await api.getImportHistory();
      setHistoryList(Array.isArray(logs) ? logs : []);
    } catch {
      setHistoryList([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // --- SEARCH LOGIC ---
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      setShowSearchDropdown(false);
      return;
    }

    setIsSearching(true);
    setShowSearchDropdown(true);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await api.searchTmdb(trimmed, searchTypeFilter);
        setSearchResults(res.results || []);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 450);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, searchTypeFilter]);

  const markItemAsInCatalog = (tmdbId: number, mediaType: 'movie' | 'tv', existingMediaItem?: MediaItem | null) => {
    const updateList = (list: TmdbSearchResult[]) =>
      list.map(i =>
        i.tmdbId === tmdbId && i.type === mediaType
          ? { ...i, existsInCatalog: true, existingMediaItem: existingMediaItem || i.existingMediaItem }
          : i
      );

    setSearchResults(updateList);
    setRecentMedia(updateList);
    setPopularMovies(updateList);
    setPopularSeries(updateList);
    setTrendingMedia(updateList);

    if (previewItem?.tmdbId === tmdbId && previewItem?.type === mediaType) {
      setPreviewItem(prev =>
        prev
          ? { ...prev, existsInCatalog: true, existingMediaItem: existingMediaItem || prev.existingMediaItem }
          : null
      );
    }
  };

  // --- 100% MANUAL IMPORT ACTIONS & MODAL TRIGGERS ---
  const requestManualImport = async (item: TmdbSearchResult) => {
    const mediaType: 'movie' | 'tv' = item.type === 'tv' ? 'tv' : 'movie';
    if (item.existsInCatalog) {
      setDuplicateConflict({
        searched: item,
        existing: item.existingMediaItem || null,
        message: `"${item.title}" já existe no catálogo.`
      });
      return;
    }

    if (mediaType === 'tv') {
      openSeriesEpisodeSelector(item);
    } else {
      setConfirmMovieImport(item);
    }
  };

  const openSeriesEpisodeSelector = async (item: TmdbSearchResult) => {
    setSeriesToImport(item);
    setLoadingSeriesDetails(true);
    setSeriesSeasons([]);
    setSeasonEpisodesMap({});
    setSelectedEpisodes(new Set());

    try {
      const details = await api.getTmdbDetails(item.tmdbId, 'tv');
      if (details.existsInCatalog) {
        markItemAsInCatalog(item.tmdbId, 'tv', details.existingMediaItem);
        setDuplicateConflict({
          searched: item,
          existing: details.existingMediaItem,
          message: `"${item.title}" já existe no catálogo.`
        });
        setSeriesToImport(null);
        return;
      }
      const rawSeasons = details.item?.seasons || [];
      const seasonsList = rawSeasons.filter((s: any) => s.seasonNumber > 0);
      setSeriesSeasons(seasonsList);

      // Pre-load episodes for season 1
      if (seasonsList.length > 0) {
        const s1 = seasonsList[0].seasonNumber;
        const res = await api.getTmdbSeasonEpisodes(item.tmdbId, s1);
        setSeasonEpisodesMap(prev => ({ ...prev, [s1]: res.episodes || [] }));
        const initialSelected = new Set<string>();
        (res.episodes || []).forEach((ep: any) => {
          initialSelected.add(`${s1}-${ep.episodeNumber}`);
        });
        setSelectedEpisodes(initialSelected);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Erro ao carregar temporadas da série.' });
      setSeriesToImport(null);
    } finally {
      setLoadingSeriesDetails(false);
    }
  };

  const loadSeasonEpisodes = async (seasonNum: number) => {
    if (!seriesToImport) return;
    if (seasonEpisodesMap[seasonNum]) return;
    setLoadingSeasonNum(seasonNum);
    try {
      const res = await api.getTmdbSeasonEpisodes(seriesToImport.tmdbId, seasonNum);
      setSeasonEpisodesMap(prev => ({ ...prev, [seasonNum]: res.episodes || [] }));
      setSelectedEpisodes(prev => {
        const next = new Set(prev);
        (res.episodes || []).forEach((ep: any) => {
          next.add(`${seasonNum}-${ep.episodeNumber}`);
        });
        return next;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSeasonNum(null);
    }
  };

  const toggleEpisodeSelection = (seasonNum: number, episodeNum: number) => {
    const key = `${seasonNum}-${episodeNum}`;
    setSelectedEpisodes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllLoadedEpisodes = () => {
    const next = new Set<string>();
    Object.entries(seasonEpisodesMap).forEach(([sNum, eps]) => {
      if (Array.isArray(eps)) {
        eps.forEach((ep: any) => {
          next.add(`${sNum}-${ep.episodeNumber}`);
        });
      }
    });
    setSelectedEpisodes(next);
  };

  const deselectAllEpisodes = () => {
    setSelectedEpisodes(new Set());
  };

  const confirmSeriesImport = async () => {
    if (!seriesToImport) return;
    if (selectedEpisodes.size === 0) {
      setFeedback({ type: 'warning', msg: 'Selecione pelo menos um episódio para importar.' });
      return;
    }
    const epArray = Array.from(selectedEpisodes).map((k: string) => {
      const [s, e] = k.split('-');
      return { seasonNumber: Number(s), episodeNumber: Number(e) };
    });

    const item = seriesToImport;
    setSeriesToImport(null);
    await executeImport(item, false, epArray);
  };

  const confirmMovieImportAction = async () => {
    if (!confirmMovieImport) return;
    const item = confirmMovieImport;
    setConfirmMovieImport(null);
    await executeImport(item, false);
  };

  const executeImport = async (
    item: TmdbSearchResult,
    forceUpdate = false,
    selectedEps?: Array<{ seasonNumber: number; episodeNumber: number }>
  ) => {
    const mediaType: 'movie' | 'tv' = item.type === 'tv' ? 'tv' : 'movie';
    const itemKey = `${mediaType}-${item.tmdbId}`;
    if (importingItemId) return;

    setImportingItemId(itemKey);
    setFeedback(null);

    try {
      const res = await api.importTmdbMedia(item.tmdbId, mediaType, forceUpdate, selectedEps);

      if (res.exists && !res.success && !forceUpdate) {
        markItemAsInCatalog(item.tmdbId, mediaType, res.existingMediaItem);
        setDuplicateConflict({
          searched: item,
          existing: res.existingMediaItem || item.existingMediaItem || null,
          message: res.message || `"${item.title}" já existe no catálogo.`
        });
        return;
      }

      if (res.success) {
        markItemAsInCatalog(item.tmdbId, mediaType, res.item || null);
        setDuplicateConflict(null);
        setFeedback({
          type: 'success',
          msg: res.message || `"${item.title}" importado com sucesso.`
        });

        loadHistory();
        if (onCatalogUpdated) onCatalogUpdated();

        if (!forceUpdate) {
          setSourceModalData({
            contentId: item.tmdbId,
            contentType: mediaType,
            selectedTitle: res.item?.title || item.title,
            selectedPoster: resolveTmdbPosterUrl(res.item?.posterPath || item.posterPath, 'w500')
          });
          setShowSourceModal(true);
        }
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Falha na importação.' });
    } finally {
      setImportingItemId(null);
    }
  };

  // Backwards compatibility alias
  const handleImport = (item: TmdbSearchResult, forceUpdate = false) => {
    if (forceUpdate) {
      executeImport(item, true);
    } else {
      requestManualImport(item);
    }
  };

  const toggleSelection = (item: TmdbSearchResult) => {
    const key = `${item.type}-${item.tmdbId}`;
    const newSelection = new Set(selectedItems);
    if (newSelection.has(key)) newSelection.delete(key);
    else if (!item.existsInCatalog) newSelection.add(key);
    setSelectedItems(newSelection);
  };

  const handleBatchImport = async () => {
    if (selectedItems.size === 0) return;

    setIsProcessingBatch(true);
    setBatchProgress(null);

    const idsToImport = Array.from(selectedItems).map((key: string) => {
      const [type, id] = key.split('-');
      return { tmdbId: parseInt(id, 10), type: type as 'movie' | 'tv' };
    });

    try {
      const hasMovies = idsToImport.some(i => i.type === 'movie');
      const hasTv = idsToImport.some(i => i.type === 'tv');
      const contentType = hasMovies && hasTv ? 'both' : hasTv ? 'tv' : 'movie';

      await api.startMassImport({
        ids: idsToImport.map(i => i.tmdbId),
        contentType,
        batchSize: 20
      });
      setSelectedItems(new Set());
    } catch (err: any) {
      setIsProcessingBatch(false);
      setFeedback({ type: 'error', msg: err.message || 'Falha ao iniciar importação em massa.' });
    }
  };

  // --- RENDER HELPERS ---
  const SkeletonCard = () => (
    <div className="min-w-[140px] sm:min-w-[160px] bg-zinc-900 rounded-2xl border border-zinc-850 p-2 animate-pulse space-y-3">
      <div className="aspect-[2/3] bg-zinc-800 rounded-xl" />
      <div className="space-y-2 px-1 pb-1">
        <div className="h-3 bg-zinc-800 rounded w-3/4" />
        <div className="h-2 bg-zinc-800 rounded w-1/2" />
      </div>
    </div>
  );

  const MediaCarousel = ({
    title,
    icon: Icon,
    items,
    loading,
    id
  }: {
    title: string;
    icon: any;
    items: TmdbSearchResult[];
    loading: boolean;
    id: string;
  }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    const scroll = (dir: 'left' | 'right') => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollBy({ left: dir === 'left' ? -400 : 400, behavior: 'smooth' });
    };

    return (
      <div className="space-y-4">
        {title && (
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5 text-red-500" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider">{title}</h3>
            </div>
            <div className="hidden sm:flex gap-1">
              <button
                onClick={() => scroll('left')}
                className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-850 text-zinc-400 hover:text-white transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => scroll('right')}
                className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-850 text-zinc-400 hover:text-white transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x px-2">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : items.length === 0 ? (
            <div className="w-full py-8 text-center text-xs text-zinc-500 bg-zinc-900/40 rounded-2xl border border-zinc-850">
              Nenhum título disponível no momento.
            </div>
          ) : (
            items.map(item => (
              <div
                key={`${id}-${item.type}-${item.tmdbId}`}
                className="min-w-[140px] sm:min-w-[160px] bg-zinc-900 rounded-2xl border border-zinc-850 p-2 group hover:border-red-600/50 transition-all snap-start relative overflow-hidden"
              >
                <div
                  className="relative aspect-[2/3] bg-zinc-950 rounded-xl overflow-hidden cursor-pointer"
                  onClick={() => setPreviewItem(item)}
                >
                  <SafeTmdbPoster
                    path={item.posterPath}
                    alt={item.title}
                    type={item.type}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-md px-1.5 py-0.5 rounded text-[8px] font-black uppercase text-red-400 border border-red-900/30">
                    {item.type === 'movie' ? 'Filme' : 'Série'}
                  </div>
                  {item.existsInCatalog && (
                    <div className="absolute inset-0 bg-emerald-950/60 flex items-center justify-center">
                      <div className="bg-emerald-500 text-white p-1 rounded-full shadow-lg">
                        <Check className="w-4 h-4" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 px-1 space-y-1">
                  <h4 className="text-[11px] font-black text-white truncate leading-tight" title={item.title}>
                    {item.title}
                  </h4>
                  <div className="flex items-center justify-between text-[9px] text-zinc-500 font-bold tabular-nums">
                    <span>{(item.releaseDate || item.firstAirDate || '').substring(0, 4) || '—'}</span>
                    <span className="text-amber-500 flex items-center gap-0.5">
                      <Star className="w-2.5 h-2.5 fill-amber-500" /> {item.voteAverage ?? 0}
                    </span>
                  </div>

                  <div className="pt-2 flex gap-1">
                    {!item.existsInCatalog ? (
                      <>
                        <button
                          onClick={() => handleImport(item)}
                          disabled={!!importingItemId}
                          className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[9px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1"
                        >
                          {importingItemId === `${item.type}-${item.tmdbId}` ? (
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <PlusCircle className="w-2.5 h-2.5" />
                          )}
                          <span>Importar</span>
                        </button>
                        <button
                          onClick={() => toggleSelection(item)}
                          className={`w-8 rounded-lg border transition-all flex items-center justify-center ${
                            selectedItems.has(`${item.type}-${item.tmdbId}`)
                              ? 'bg-red-950/30 border-red-600 text-red-500'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-600 hover:text-white'
                          }`}
                          title="Selecionar para importação em massa"
                        >
                          <CheckCircle
                            className={`w-3.5 h-3.5 ${
                              selectedItems.has(`${item.type}-${item.tmdbId}`) ? 'fill-red-600 text-zinc-950' : ''
                            }`}
                          />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleImport(item, false)}
                        className="w-full py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-400 hover:bg-emerald-950/70 text-[9px] font-black uppercase flex items-center justify-center gap-1 transition-all"
                        title="Item já existe no acervo — clique para opções"
                      >
                        <Check className="w-2.5 h-2.5" />
                        <span>No Acervo</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. COMPACT SMART HEADER */}
      <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-4 sm:p-6 shadow-xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/5 blur-[100px] pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-red-600">
              <Zap className="w-5 h-5 fill-red-600 animate-pulse" />
              <h2 className="text-lg sm:text-xl font-black uppercase tracking-tighter text-white">
                Importação Inteligente TMDB
              </h2>
            </div>
            <p className="text-[11px] text-zinc-500 font-medium">
              Importe filmes e séries diretamente para os catálogos do RONYCINE com proteção anti-duplicados.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-zinc-950 px-3 py-2 rounded-2xl border border-zinc-850 flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    tmdbStatus === 'ONLINE' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-red-500'
                  }`}
                />
                <span className="text-[10px] font-black text-white tracking-widest">TMDB {tmdbStatus}</span>
              </div>
              <button
                onClick={() => {
                  checkTmdbStatus();
                  loadAllLists(true);
                }}
                disabled={isCheckingStatus}
                className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-all"
                title="Sincronizar TMDB"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingStatus ? 'animate-spin text-red-500' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* TABS NAVIGATION */}
      <div className="flex items-center gap-2 bg-zinc-950 p-1.5 rounded-2xl border border-zinc-900 w-fit">
        {[
          { id: 'smart', label: 'Manual & Sugestões', icon: Sparkles },
          { id: 'mass', label: 'Importação em Massa', icon: Layers },
          { id: 'history', label: 'Histórico', icon: History }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
              activeTab === tab.id
                ? 'bg-zinc-900 text-white border border-zinc-800 shadow-lg'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'smart' && (
          <motion.div
            key="smart-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-10"
          >
            {/* 2. MANUAL IMPORT & SEARCH */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 space-y-4">
                <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-5 shadow-lg relative z-50">
                  <div className="relative">
                    <Search className="w-5 h-5 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Cole o ID TMDB ou digite o título do filme ou série..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onFocus={() => searchQuery.trim() && setShowSearchDropdown(true)}
                      className="w-full bg-zinc-950 border border-zinc-850 rounded-2xl pl-12 pr-10 py-4 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-600 transition-all font-bold"
                    />
                    {isSearching ? (
                      <RefreshCw className="w-4 h-4 text-red-500 absolute right-4 top-1/2 -translate-y-1/2 animate-spin" />
                    ) : searchQuery ? (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    ) : null}
                  </div>

                  {/* SMART SEARCH DROPDOWN */}
                  <AnimatePresence>
                    {showSearchDropdown && searchResults.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-[100]"
                      >
                        <div className="max-h-[400px] overflow-y-auto divide-y divide-zinc-850">
                          {searchResults.map(item => (
                            <div
                              key={`search-${item.type}-${item.tmdbId}`}
                              className="p-3 flex items-center gap-4 hover:bg-zinc-850/50 cursor-pointer group"
                              onClick={() => {
                                setPreviewItem(item);
                                setShowSearchDropdown(false);
                              }}
                            >
                              <div className="w-10 h-14 bg-zinc-950 rounded-lg overflow-hidden shrink-0 border border-zinc-800">
                                <SafeTmdbPoster path={item.posterPath} alt={item.title} type={item.type} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h5 className="text-xs font-black text-white truncate">{item.title}</h5>
                                <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase pt-0.5">
                                  <span className={item.type === 'movie' ? 'text-blue-400' : 'text-purple-400'}>
                                    {item.type === 'movie' ? 'FILME' : 'SÉRIE'}
                                  </span>
                                  <span>•</span>
                                  <span className="font-mono">TMDB {item.tmdbId}</span>
                                  <span>•</span>
                                  <span>{(item.releaseDate || item.firstAirDate || '').substring(0, 4) || '—'}</span>
                                  <span>•</span>
                                  <span className="text-amber-500 flex items-center gap-0.5">
                                    <Star className="w-2.5 h-2.5 fill-amber-500" /> {item.voteAverage}
                                  </span>
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                {item.existsInCatalog ? (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      handleImport(item, false);
                                    }}
                                    className="px-2.5 py-1 rounded bg-emerald-950/50 text-emerald-400 hover:bg-emerald-950/80 text-[9px] font-black uppercase border border-emerald-900 transition-all"
                                  >
                                    NO ACERVO
                                  </button>
                                ) : (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      handleImport(item);
                                    }}
                                    disabled={!!importingItemId}
                                    className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-red-500 hover:border-red-600 transition-all"
                                    title="Importar agora"
                                  >
                                    {importingItemId === `${item.type}-${item.tmdbId}` ? (
                                      <RefreshCw className="w-4 h-4 animate-spin text-red-500" />
                                    ) : (
                                      <PlusCircle className="w-4 h-4" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="bg-zinc-950 p-2 text-center border-t border-zinc-850">
                          <button
                            onClick={() => setShowSearchDropdown(false)}
                            className="text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest"
                          >
                            Fechar Resultados
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-850 text-[10px] font-bold text-zinc-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    PESQUISA AUTOMÁTICA POR TÍTULO OU TMDB ID
                  </div>
                  <div className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-850 text-[10px] font-bold text-zinc-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    DETECÇÃO ANTI-DUPLICADOS E PRESERVAÇÃO DE FONTES
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4">
                <div className="bg-zinc-900/50 border border-zinc-850 rounded-3xl p-5 h-full flex flex-col justify-center gap-2.5">
                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest pl-1">
                    Filtro de Pesquisa TMDB
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setSearchTypeFilter('all')}
                      className={`py-2.5 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                        searchTypeFilter === 'all'
                          ? 'bg-red-600 text-white border-red-600 shadow-lg'
                          : 'bg-zinc-950 border-zinc-850 text-zinc-400 hover:text-white'
                      }`}
                    >
                      TODOS
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTypeFilter('movie');
                        setTrendingFilter(prev => ({ ...prev, type: 'movie' }));
                      }}
                      className={`py-2.5 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 border ${
                        searchTypeFilter === 'movie'
                          ? 'bg-red-600 text-white border-red-600 shadow-lg'
                          : 'bg-zinc-950 border-zinc-850 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Film className="w-3.5 h-3.5" /> FILMES
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTypeFilter('tv');
                        setTrendingFilter(prev => ({ ...prev, type: 'tv' }));
                      }}
                      className={`py-2.5 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 border ${
                        searchTypeFilter === 'tv'
                          ? 'bg-red-600 text-white border-red-600 shadow-lg'
                          : 'bg-zinc-950 border-zinc-850 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Tv className="w-3.5 h-3.5" /> SÉRIES
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. CAROUSEL SECTIONS */}
            <div className="space-y-12">
              <MediaCarousel
                title="Lançamentos Recentes"
                icon={Clock}
                items={recentMedia}
                loading={loadingLists.recent}
                id="recent"
              />

              <MediaCarousel
                title="Filmes Populares"
                icon={TrendingUp}
                items={popularMovies}
                loading={loadingLists.popularMovies}
                id="popular-movies"
              />

              <MediaCarousel
                title="Séries Populares"
                icon={Tv}
                items={popularSeries}
                loading={loadingLists.popularSeries}
                id="popular-series"
              />

              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-red-500" />
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">Em Alta no TMDB</h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex bg-zinc-950 rounded-xl p-1 border border-zinc-900">
                      {(['all', 'movie', 'tv'] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => setTrendingFilter(prev => ({ ...prev, type }))}
                          className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                            trendingFilter.type === type ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-400'
                          }`}
                        >
                          {type === 'all' ? 'TUDO' : type === 'movie' ? 'FILMES' : 'SÉRIES'}
                        </button>
                      ))}
                    </div>
                    <div className="flex bg-zinc-950 rounded-xl p-1 border border-zinc-900">
                      {(['day', 'week'] as const).map(period => (
                        <button
                          key={period}
                          onClick={() => setTrendingFilter(prev => ({ ...prev, period }))}
                          className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                            trendingFilter.period === period
                              ? 'bg-zinc-900 text-white'
                              : 'text-zinc-600 hover:text-zinc-400'
                          }`}
                        >
                          {period === 'day' ? 'HOJE' : 'SEMANA'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <MediaCarousel
                  title=""
                  icon={() => null}
                  items={trendingMedia}
                  loading={loadingLists.trending}
                  id="trending"
                />
              </div>
            </div>

            {/* SELECTION FAB FOR MASS IMPORT */}
            {selectedItems.size > 0 && activeTab === 'smart' && (
              <motion.div
                initial={{ opacity: 0, y: 100 }}
                animate={{ opacity: 1, y: 0 }}
                className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-zinc-900 border-2 border-red-600 p-4 rounded-[32px] shadow-2xl flex items-center gap-6 min-w-[320px]"
              >
                <div className="flex items-center gap-3 pl-2">
                  <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center text-white font-black shadow-lg shadow-red-900/50 tabular-nums">
                    {selectedItems.size}
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-white uppercase tracking-widest leading-tight">
                      Itens Selecionados
                    </p>
                    <p className="text-[9px] text-zinc-500 font-bold uppercase">Pronto para importar em massa</p>
                  </div>
                </div>
                <div className="flex gap-2 pr-2">
                  <button
                    onClick={() => setSelectedItems(new Set())}
                    className="px-4 py-2 rounded-2xl bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    Limpar
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('mass');
                      handleBatchImport();
                    }}
                    className="px-6 py-2 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-widest shadow-xl shadow-red-900/20 transition-all"
                  >
                    Importar Agora
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {activeTab === 'mass' && (
          <motion.div
            key="mass-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-zinc-900 border border-zinc-850 rounded-[32px] p-8 text-center space-y-6 relative overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-red-600 to-transparent opacity-50" />

              <div className="space-y-2">
                <Layers className="w-12 h-12 text-red-600 mx-auto opacity-50" />
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">
                  Painel de Importação em Massa
                </h3>
                <p className="text-sm text-zinc-500 max-w-lg mx-auto">
                  Acompanhe o processamento de grandes volumes de metadados do TMDB. Os lotes são processados em segundo
                  plano.
                </p>
              </div>

              {isProcessingBatch && batchProgress ? (
                <div className="max-w-md mx-auto space-y-6 bg-zinc-950 p-8 rounded-[32px] border border-zinc-900">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      <span>Progresso Geral</span>
                      <span className="text-white tabular-nums">
                        {Math.round(
                          (((batchProgress.success || 0) +
                            (batchProgress.existing || 0) +
                            (batchProgress.failures || 0)) /
                            Math.max(batchProgress.total || 1, 1)) *
                            100
                        )}
                        %
                      </span>
                    </div>
                    <div className="h-3 w-full bg-zinc-900 rounded-full overflow-hidden p-0.5 border border-zinc-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: `${
                            (((batchProgress.success || 0) +
                              (batchProgress.existing || 0) +
                              (batchProgress.failures || 0)) /
                              Math.max(batchProgress.total || 1, 1)) *
                            100
                          }%`
                        }}
                        className="h-full bg-red-600 rounded-full shadow-[0_0_10px_rgba(220,38,38,0.5)]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 tabular-nums">
                    <div className="bg-zinc-900/50 p-3 rounded-2xl border border-zinc-850/50">
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Sucessos</p>
                      <p className="text-lg font-black text-emerald-500">{batchProgress.success ?? 0}</p>
                    </div>
                    <div className="bg-zinc-900/50 p-3 rounded-2xl border border-zinc-850/50">
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Existentes</p>
                      <p className="text-lg font-black text-amber-500">{batchProgress.existing ?? 0}</p>
                    </div>
                    <div className="bg-zinc-900/50 p-3 rounded-2xl border border-zinc-850/50">
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Erros</p>
                      <p className="text-lg font-black text-red-500">{batchProgress.failures ?? 0}</p>
                    </div>
                  </div>

                  {batchProgress.currentTitle && (
                    <div className="pt-2">
                      <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                        Processando agora:
                      </p>
                      <p className="text-xs font-bold text-white truncate italic">"{batchProgress.currentTitle}"</p>
                    </div>
                  )}

                  <button
                    onClick={() => api.cancelMassImport()}
                    className="w-full py-3 rounded-2xl bg-zinc-900 hover:bg-red-950/20 text-zinc-500 hover:text-red-500 font-black text-[10px] uppercase tracking-widest transition-all border border-zinc-850"
                  >
                    Interromper Processo
                  </button>
                </div>
              ) : (
                <div className="bg-zinc-950 p-12 rounded-[32px] border border-zinc-900/50 space-y-4">
                  <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-850 text-zinc-500 text-xs italic">
                    Nenhum lote de processamento ativo no momento.
                  </div>
                  <button
                    onClick={() => setActiveTab('smart')}
                    className="px-8 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest transition-all shadow-xl shadow-red-900/20"
                  >
                    Selecionar Itens para Importar
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'history' && (
          <motion.div
            key="history-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-850 rounded-[32px] overflow-hidden shadow-xl"
          >
            <div className="p-6 border-b border-zinc-850 flex items-center justify-between bg-zinc-950">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-red-500" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Log de Atividades do TMDB</h3>
              </div>
              <button
                onClick={loadHistory}
                disabled={isLoadingHistory}
                className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingHistory ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="bg-zinc-950/50 text-zinc-500 uppercase font-black tracking-widest border-b border-zinc-850">
                    <th className="px-6 py-4">Data/Hora</th>
                    <th className="px-6 py-4">Título</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {historyList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-zinc-600 italic">
                        Nenhuma atividade registrada recentemente.
                      </td>
                    </tr>
                  ) : (
                    historyList.map(log => (
                      <tr key={log.id} className="hover:bg-zinc-850/30 transition-colors">
                        <td className="px-6 py-4 text-zinc-500 font-mono">
                          {new Date(log.timestamp).toLocaleDateString('pt-PT')}{' '}
                          {new Date(log.timestamp).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                log.type === 'movie' ? 'bg-blue-500' : 'bg-purple-500'
                              }`}
                            />
                            <span className="font-bold text-white">{log.title}</span>
                            <span className="text-[8px] font-black bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-500 font-mono">
                              {log.tmdbId}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                              log.status === 'SUCCESS'
                                ? 'bg-emerald-950/50 text-emerald-400 border-emerald-900/50'
                                : log.status === 'EXISTING'
                                ? 'bg-amber-950/50 text-amber-400 border-amber-900/50'
                                : 'bg-red-950/50 text-red-400 border-red-900/50'
                            }`}
                          >
                            {log.status === 'SUCCESS'
                              ? 'IMPORTADO'
                              : log.status === 'EXISTING'
                              ? 'EXISTENTE'
                              : 'ERRO'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-zinc-500">{(log.adminEmail || '').split('@')[0] || 'admin'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FEEDBACK TOAST */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className={`fixed top-24 right-6 z-[110] p-4 rounded-2xl border shadow-2xl flex items-center gap-4 max-w-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-950 border-emerald-800 text-emerald-400'
                : feedback.type === 'warning'
                ? 'bg-amber-950 border-amber-800 text-amber-400'
                : 'bg-red-950 border-red-800 text-red-400'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0" />
            )}
            <p className="text-[11px] font-bold leading-tight">{feedback.msg}</p>
            <button onClick={() => setFeedback(null)} className="p-1 hover:bg-black/20 rounded-lg transition-all">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DUPLICATE CONFLICT RESOLUTION MODAL */}
      <AnimatePresence>
        {duplicateConflict && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDuplicateConflict(null)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              className="relative w-full max-w-lg bg-zinc-900 border border-amber-700/60 rounded-3xl p-6 space-y-5 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-amber-950/70 border border-amber-700/60 text-amber-400">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      Conteúdo Já Existente no Catálogo
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">{duplicateConflict.message}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDuplicateConflict(null)}
                  className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-14 h-20 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0">
                  <SafeTmdbPoster
                    path={duplicateConflict.existing?.posterPath || duplicateConflict.searched.posterPath}
                    alt={duplicateConflict.existing?.title || duplicateConflict.searched.title}
                    type={duplicateConflict.searched.type}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <h4 className="font-black text-sm text-white truncate">
                    {duplicateConflict.existing?.title || duplicateConflict.searched.title}
                  </h4>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-400">
                    <span>
                      {duplicateConflict.searched.type === 'tv' ? 'Série' : 'Filme'}
                    </span>
                    <span>•</span>
                    <span>TMDB: {duplicateConflict.searched.tmdbId}</span>
                    {duplicateConflict.existing?.id && (
                      <>
                        <span>•</span>
                        <span>ID: {duplicateConflict.existing.id}</span>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Atualizar metadados preserva integralmente todas as fontes de vídeo, temporadas e episódios existentes.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {onViewCatalogItem && (
                  <button
                    onClick={() => {
                      const { searched, existing } = duplicateConflict;
                      setDuplicateConflict(null);
                      setPreviewItem(null);
                      onViewCatalogItem({
                        id: existing?.id,
                        tmdbId: searched.tmdbId,
                        type: searched.type === 'tv' ? 'tv' : 'movie',
                        title: existing?.title || searched.title
                      });
                    }}
                    className="py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                    <span>Abrir Conteúdo Existente</span>
                  </button>
                )}
                <button
                  onClick={() => executeImport(duplicateConflict.searched, true)}
                  disabled={!!importingItemId}
                  className="py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                >
                  {importingItemId ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Atualizar Metadados Manualmente</span>
                </button>
                <button
                  onClick={() => setDuplicateConflict(null)}
                  className="py-2.5 px-3 rounded-xl bg-zinc-950 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EXPLICIT MANUAL MOVIE CONFIRMATION MODAL */}
      <AnimatePresence>
        {confirmMovieImport && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmMovieImport(null)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              className="relative w-full max-w-lg bg-[#0E1015] border border-white/10 rounded-3xl p-6 space-y-5 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-red-600/10 border border-red-600/20 text-[#E50914]">
                    <Film className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">
                      Confirmação de Importação Manual
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Confirmas que pretendes importar este conteúdo para o catálogo RONYCINE?
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmMovieImport(null)}
                  className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-zinc-950/70 border border-white/5 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-16 h-24 rounded-xl overflow-hidden bg-zinc-900 border border-white/5 shrink-0">
                  <SafeTmdbPoster
                    path={confirmMovieImport.posterPath}
                    alt={confirmMovieImport.title}
                    type="movie"
                  />
                </div>
                <div className="min-w-0 space-y-1.5 flex-1">
                  <h4 className="font-black text-base text-white truncate">
                    {confirmMovieImport.title}
                  </h4>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-400">
                    <span className="px-1.5 py-0.5 bg-red-600/20 text-[#E50914] rounded font-bold uppercase">Filme</span>
                    <span>•</span>
                    <span>TMDB: {confirmMovieImport.tmdbId}</span>
                    <span>•</span>
                    <span>{(confirmMovieImport.releaseDate || '').substring(0, 4) || '—'}</span>
                    <span>•</span>
                    <span className="text-amber-500 flex items-center gap-0.5">
                      <Star className="w-2.5 h-2.5 fill-amber-500" /> {confirmMovieImport.voteAverage}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                    {confirmMovieImport.overview || 'Sinopse oficial TMDB.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmMovieImport(null)}
                  className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmMovieImportAction}
                  disabled={!!importingItemId}
                  className="px-6 py-2.5 rounded-xl bg-[#E50914] hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-red-900/30 transition-all"
                >
                  {importingItemId ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5" />
                  )}
                  <span>Confirmar Importação</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SERIES MANUAL SEASONS & EPISODES SELECTION MODAL */}
      <AnimatePresence>
        {seriesToImport && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSeriesToImport(null)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              className="relative w-full max-w-2xl max-h-[90vh] bg-[#0E1015] border border-white/10 rounded-3xl p-6 flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-purple-600/10 border border-purple-600/20 text-purple-400">
                    <Tv className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white uppercase tracking-wider font-display">
                      Importação Manual de Série & Episódios
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Visualiza e seleciona manualmente as temporadas e episódios a importar.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSeriesToImport(null)}
                  className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Series Summary */}
              <div className="py-4 flex items-center gap-4 border-b border-white/5">
                <div className="w-14 h-20 rounded-xl overflow-hidden bg-zinc-900 border border-white/5 shrink-0">
                  <SafeTmdbPoster
                    path={seriesToImport.posterPath}
                    alt={seriesToImport.title}
                    type="tv"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h4 className="font-black text-sm text-white truncate">{seriesToImport.title}</h4>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-400">
                    <span className="px-1.5 py-0.5 bg-purple-600/20 text-purple-400 rounded font-bold uppercase">Série</span>
                    <span>•</span>
                    <span>TMDB: {seriesToImport.tmdbId}</span>
                    <span>•</span>
                    <span>{seriesSeasons.length} temporadas</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-bold">{selectedEpisodes.size} episódios selecionados</span>
                  </div>
                </div>
              </div>

              {/* Episode Selection Controls */}
              <div className="flex items-center justify-between py-2.5">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Temporadas e Episódios</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllLoadedEpisodes}
                    className="text-[10px] font-bold text-red-400 hover:text-red-300 uppercase px-2 py-1 rounded bg-white/5"
                  >
                    Selecionar Todos Carregados
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllEpisodes}
                    className="text-[10px] font-bold text-zinc-400 hover:text-zinc-200 uppercase px-2 py-1 rounded bg-white/5"
                  >
                    Desmarcar Todos
                  </button>
                </div>
              </div>

              {/* Seasons & Episodes Scrollable List */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1">
                {loadingSeriesDetails ? (
                  <div className="p-8 text-center text-zinc-500 flex flex-col items-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-red-500" />
                    <span className="text-xs">A carregar detalhes da série do TMDB...</span>
                  </div>
                ) : seriesSeasons.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 text-xs">
                    Nenhuma temporada encontrada para esta série no TMDB.
                  </div>
                ) : (
                  seriesSeasons.map((season: any) => {
                    const sNum = season.seasonNumber;
                    const loadedEps = seasonEpisodesMap[sNum];
                    const isLoadingThis = loadingSeasonNum === sNum;

                    return (
                      <div key={sNum} className="bg-zinc-950/60 border border-white/5 rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-white uppercase">{season.name || `Temporada ${sNum}`}</span>
                            <span className="text-[10px] text-zinc-500 font-mono">({season.episodeCount || 0} eps)</span>
                          </div>
                          {!loadedEps ? (
                            <button
                              type="button"
                              onClick={() => loadSeasonEpisodes(sNum)}
                              disabled={isLoadingThis}
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase text-zinc-300 flex items-center gap-1.5"
                            >
                              {isLoadingThis ? <RefreshCw className="w-3 h-3 animate-spin text-red-500" /> : <ChevronRight className="w-3 h-3" />}
                              <span>Carregar Episódios</span>
                            </button>
                          ) : (
                            <span className="text-[10px] font-mono text-emerald-400 font-bold">
                              {loadedEps.filter((ep: any) => selectedEpisodes.has(`${sNum}-${ep.episodeNumber}`)).length} / {loadedEps.length} selecionados
                            </span>
                          )}
                        </div>

                        {loadedEps && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-white/5">
                            {loadedEps.map((ep: any) => {
                              const isSelected = selectedEpisodes.has(`${sNum}-${ep.episodeNumber}`);
                              return (
                                <label
                                  key={ep.episodeNumber}
                                  className={`flex items-center gap-2.5 p-2 rounded-xl border text-xs cursor-pointer transition-all ${
                                    isSelected
                                      ? 'bg-red-950/20 border-red-600/40 text-white'
                                      : 'bg-zinc-900/40 border-white/5 text-zinc-400 hover:text-zinc-200'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleEpisodeSelection(sNum, ep.episodeNumber)}
                                    className="accent-[#E50914] rounded w-3.5 h-3.5"
                                  />
                                  <span className="font-mono text-[10px] text-zinc-500 shrink-0">E{ep.episodeNumber}</span>
                                  <span className="truncate flex-1 font-medium text-[11px]">{ep.title || `Episódio ${ep.episodeNumber}`}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer Confirmation */}
              <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-[11px] text-zinc-400 text-center sm:text-left">
                  Confirmas que pretendes importar esta série com os <strong className="text-white">{selectedEpisodes.size}</strong> episódios selecionados para o catálogo RONYCINE?
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSeriesToImport(null)}
                    className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-bold uppercase tracking-wider"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmSeriesImport}
                    disabled={selectedEpisodes.size === 0 || !!importingItemId}
                    className="px-5 py-2 rounded-xl bg-[#E50914] hover:bg-red-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-red-900/30"
                  >
                    {importingItemId ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                    <span>Confirmar ({selectedEpisodes.size})</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PREVIEW MODAL */}
      <AnimatePresence>
        {previewItem && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPreviewItem(null)}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-3xl bg-zinc-900 rounded-[40px] border border-zinc-800 overflow-hidden shadow-2xl"
            >
              <button
                onClick={() => setPreviewItem(null)}
                className="absolute top-6 right-6 z-10 p-2 rounded-full bg-black/50 hover:bg-red-600 text-white transition-all border border-white/10"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="grid grid-cols-1 md:grid-cols-5 h-full">
                <div className="md:col-span-2 aspect-[2/3] md:aspect-auto relative group bg-zinc-950">
                  <SafeTmdbPoster path={previewItem.posterPath} alt={previewItem.title} type={previewItem.type} />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent" />
                </div>

                <div className="md:col-span-3 p-8 md:p-10 flex flex-col justify-between overflow-y-auto max-h-[80vh] md:max-h-none">
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="px-3 py-1 rounded-full bg-red-600 text-white text-[9px] font-black uppercase tracking-widest">
                          {previewItem.type === 'movie' ? 'FILME' : 'SÉRIE'}
                        </span>
                        <span className="text-[10px] font-black text-zinc-500 font-mono tracking-widest uppercase">
                          TMDB ID: {previewItem.tmdbId}
                        </span>
                      </div>
                      <h3 className="text-2xl sm:text-3xl font-black text-white leading-tight uppercase tracking-tighter">
                        {previewItem.title}
                      </h3>
                      <div className="flex items-center gap-4 text-[11px] font-bold text-zinc-400">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-zinc-600" />{' '}
                          {(previewItem.releaseDate || previewItem.firstAirDate || '').substring(0, 4) || '—'}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" /> {previewItem.voteAverage ?? 0}
                        </span>
                      </div>
                    </div>

                    {(previewItem as any).genres && (previewItem as any).genres.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Gêneros</p>
                        <div className="flex flex-wrap gap-2">
                          {(previewItem as any).genres.map((g: string) => (
                            <span
                              key={g}
                              className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-850 text-zinc-400 text-[10px] font-bold"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Sinopse</p>
                      <p className="text-xs text-zinc-400 leading-relaxed max-h-36 overflow-y-auto scrollbar-hide">
                        {previewItem.overview || 'Nenhuma sinopse disponível em português.'}
                      </p>
                    </div>
                  </div>

                  <div className="pt-8 space-y-3">
                    {!previewItem.existsInCatalog ? (
                      <button
                        onClick={() => handleImport(previewItem)}
                        disabled={!!importingItemId}
                        className="w-full py-4 rounded-[20px] bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-red-900/30 transition-all flex items-center justify-center gap-3"
                      >
                        {importingItemId === `${previewItem.type}-${previewItem.tmdbId}` ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <Download className="w-5 h-5" />
                        )}
                        <span>IMPORTAR AGORA</span>
                      </button>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="py-3 px-6 rounded-2xl bg-emerald-950/20 border border-emerald-900/50 flex items-center justify-center gap-3 text-emerald-500">
                          <CheckCircle2 className="w-5 h-5" />
                          <span className="text-[10px] font-black uppercase tracking-widest">
                            Já existe no catálogo
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            onClick={() => handleImport(previewItem, true)}
                            disabled={!!importingItemId}
                            className="py-3 rounded-2xl bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                          >
                            <RefreshCw className={`w-4 h-4 ${importingItemId ? 'animate-spin' : ''}`} />
                            <span>Atualizar Metadados</span>
                          </button>
                          {onViewCatalogItem && (
                            <button
                              onClick={() => {
                                const target = previewItem;
                                setPreviewItem(null);
                                onViewCatalogItem({
                                  id: target.existingMediaItem?.id,
                                  tmdbId: target.tmdbId,
                                  type: target.type === 'tv' ? 'tv' : 'movie',
                                  title: target.existingMediaItem?.title || target.title
                                });
                              }}
                              className="py-3 rounded-2xl bg-red-600/20 border border-red-600/40 text-red-400 hover:text-white hover:bg-red-600 font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                            >
                              <ExternalLink className="w-4 h-4" />
                              <span>Ver no Catálogo</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => setPreviewItem(null)}
                      className="w-full py-2.5 text-[10px] font-black text-zinc-600 hover:text-zinc-400 uppercase tracking-widest transition-all"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <SourceModal
        isOpen={showSourceModal}
        onClose={() => setShowSourceModal(false)}
        onSave={() => {
          if (onCatalogUpdated) onCatalogUpdated();
        }}
        initialData={sourceModalData}
      />
    </div>
  );
};
