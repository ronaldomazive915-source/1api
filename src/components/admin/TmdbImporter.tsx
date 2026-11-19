import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  AlertTriangle,
  ArrowLeft,
  ShieldCheck,
  Mic,
  Subtitles
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { TmdbSearchResult, MediaItem, ImportHistoryItem, ImportStatus, VideoSource } from '../../types.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';
import { PlaybackVersionsManager } from './PlaybackVersionsManager.js';
import { motion, AnimatePresence } from 'motion/react';

interface TmdbImporterProps {
  onCatalogUpdated?: () => void;
  onViewCatalogItem?: (item: { id?: string; tmdbId: number; type: 'movie' | 'tv'; title: string }) => void;
}

type WizardStage = 1 | 2 | 3 | 4;

interface WizardTarget {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  posterPath?: string;
  backdropPath?: string;
  overview?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  genres?: string[];
  seasons?: any[];
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  existsInCatalog: boolean;
  existingMediaItem?: MediaItem | null;
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
  // --- Top Tabs ---
  const [activeTab, setActiveTab] = useState<'smart' | 'mass' | 'history'>('smart');
  const [tmdbStatus, setTmdbStatus] = useState<string>('OFFLINE');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  // --- 4-Stage Workflow States (inside IMPORTAÇÃO TMDB ID) ---
  const [wizardStage, setWizardStage] = useState<WizardStage>(1);
  const [wizardTarget, setWizardTarget] = useState<WizardTarget | null>(null);
  const [loadingTargetDetails, setLoadingTargetDetails] = useState(false);
  const [importingStage2, setImportingStage2] = useState(false);

  // Stage 2 / Stage 3 Series Seasons & Episodes
  const [seriesSeasons, setSeriesSeasons] = useState<any[]>([]);
  const [seasonEpisodesMap, setSeasonEpisodesMap] = useState<Record<number, any[]>>({});
  const [loadingSeasonNum, setLoadingSeasonNum] = useState<number | null>(null);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);
  const [selectedEpisodeNum, setSelectedEpisodeNum] = useState<number>(1);
  const [selectedImportSeasonNums, setSelectedImportSeasonNums] = useState<Set<number>>(new Set());

  // Live Sources summary for Stage 3 (episodes list badges) & Stage 4 (summary)
  const [contentSources, setContentSources] = useState<VideoSource[]>([]);
  const [loadingSourcesSummary, setLoadingSourcesSummary] = useState(false);
  const [verifyingAllPending, setVerifyingAllPending] = useState(false);

  // --- Smart Search States (Etapa 1) ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTypeFilter, setSearchTypeFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [loadingMoreSearch, setLoadingMoreSearch] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

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

  // --- Feedback & History ---
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; msg: string } | null>(null);
  const [historyList, setHistoryList] = useState<ImportHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // --- Initialization ---
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
          onCatalogUpdated?.();
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

  // --- SEARCH LOGIC (300ms debounce + AbortController) ---
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }

    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      setShowSearchDropdown(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setShowSearchDropdown(true);

    searchTimeoutRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const res = await api.searchTmdb(trimmed, searchTypeFilter, controller.signal, 1);
        if (!controller.signal.aborted) {
          setSearchResults(res.results || []);
          setSearchPage(res.page || 1);
          setSearchTotalPages(res.totalPages || 1);
          setSearchError(null);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        setSearchResults([]);
        setSearchPage(1);
        setSearchTotalPages(1);
        setSearchError(err?.message || 'Erro ao pesquisar no TMDB. Verifique a ligação.');
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
    };
  }, [searchQuery, searchTypeFilter, searchNonce]);

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
  };

  const refreshContentSources = useCallback(async (tmdbId: number, mediaType: 'movie' | 'tv') => {
    setLoadingSourcesSummary(true);
    try {
      const list = await api.getVideoSources({ contentId: tmdbId, contentType: mediaType });
      setContentSources(Array.isArray(list) ? list : []);
    } catch {
      setContentSources([]);
    } finally {
      setLoadingSourcesSummary(false);
    }
  }, []);

  const fetchSeasonEpisodesForWizard = useCallback(
    async (tmdbId: number, seasonNum: number) => {
      if (seasonEpisodesMap[seasonNum]?.length) return seasonEpisodesMap[seasonNum];
      setLoadingSeasonNum(seasonNum);
      try {
        const res = await api.getTmdbSeasonEpisodes(tmdbId, seasonNum);
        const eps = Array.isArray(res.episodes) ? res.episodes : [];
        setSeasonEpisodesMap(prev => ({ ...prev, [seasonNum]: eps }));
        return eps;
      } catch {
        return [];
      } finally {
        setLoadingSeasonNum(null);
      }
    },
    [seasonEpisodesMap]
  );

  // Open Stage 2 from any TMDB Search Result or direct numeric TMDB ID
  const openStage2FromResult = async (item: TmdbSearchResult, jumpToStage3IfExisting = false) => {
    const mediaType: 'movie' | 'tv' = item.type === 'tv' ? 'tv' : 'movie';
    setShowSearchDropdown(false);
    setLoadingTargetDetails(true);
    setFeedback(null);
    setSeriesSeasons([]);
    setSeasonEpisodesMap({});
    setContentSources([]);

    try {
      const details = await api.getTmdbDetails(item.tmdbId, mediaType);
      const tmdbItem = details.item;
      const existing = details.existingMediaItem;
      const target: WizardTarget = {
        tmdbId: item.tmdbId,
        type: mediaType,
        title: tmdbItem?.title || item.title,
        originalTitle: tmdbItem?.originalTitle,
        posterPath: tmdbItem?.posterPath || item.posterPath,
        backdropPath: tmdbItem?.backdropPath,
        overview: tmdbItem?.overview || item.overview,
        releaseDate: tmdbItem?.releaseDate || item.releaseDate,
        firstAirDate: tmdbItem?.firstAirDate || item.firstAirDate,
        voteAverage: tmdbItem?.voteAverage ?? item.voteAverage,
        genres: tmdbItem?.genres || [],
        seasons: tmdbItem?.seasons || existing?.seasons || [],
        numberOfSeasons: tmdbItem?.numberOfSeasons || tmdbItem?.seasons?.length,
        numberOfEpisodes: tmdbItem?.numberOfEpisodes,
        existsInCatalog: details.existsInCatalog,
        existingMediaItem: existing
      };

      setWizardTarget(target);
      if (details.existsInCatalog) {
        markItemAsInCatalog(item.tmdbId, mediaType, existing);
      }

      if (mediaType === 'tv') {
        const rawSeasons = (target.seasons || []).filter((s: any) => Number(s.seasonNumber) >= 0);
        setSeriesSeasons(rawSeasons);
        const standardSeasonNums = rawSeasons
          .filter((s: any) => Number(s.seasonNumber) > 0)
          .map((s: any) => Number(s.seasonNumber));
        setSelectedImportSeasonNums(
          new Set(
            standardSeasonNums.length > 0
              ? standardSeasonNums
              : rawSeasons.map((s: any) => Number(s.seasonNumber))
          )
        );
        const preferredSeason =
          rawSeasons.find((s: any) => Number(s.seasonNumber) > 0)?.seasonNumber ??
          rawSeasons[0]?.seasonNumber ??
          1;
        setSelectedSeasonNum(preferredSeason);
        setSelectedEpisodeNum(1);

        try {
          const epRes = await api.getTmdbSeasonEpisodes(item.tmdbId, preferredSeason);
          const eps = epRes.episodes || [];
          setSeasonEpisodesMap({ [preferredSeason]: eps });
          if (eps.length > 0) setSelectedEpisodeNum(Number(eps[0].episodeNumber || 1));
        } catch {
          // ignore initial episode load error
        }
      }

      await refreshContentSources(item.tmdbId, mediaType);
      setWizardStage(jumpToStage3IfExisting && details.existsInCatalog ? 3 : 2);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        msg: err?.message || `Erro ao carregar dados do TMDB ID ${item.tmdbId}.`
      });
    } finally {
      setLoadingTargetDetails(false);
    }
  };

  const handleDirectLookupById = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    if (/^\d+$/.test(trimmed)) {
      const idNum = parseInt(trimmed, 10);
      const preferredType: 'movie' | 'tv' = searchTypeFilter === 'tv' ? 'tv' : 'movie';
      // Try preferred type, if search already returned exact match prefer that
      const exactMatch = searchResults.find(r => r.tmdbId === idNum);
      if (exactMatch) {
        await openStage2FromResult(exactMatch);
        return;
      }
      setLoadingTargetDetails(true);
      try {
        await openStage2FromResult({
          tmdbId: idNum,
          type: preferredType,
          title: `TMDB ${idNum}`,
          overview: ''
        });
      } catch {
        if (searchTypeFilter === 'all') {
          await openStage2FromResult({
            tmdbId: idNum,
            type: preferredType === 'movie' ? 'tv' : 'movie',
            title: `TMDB ${idNum}`,
            overview: ''
          });
        }
      } finally {
        setLoadingTargetDetails(false);
      }
    } else if (searchResults.length > 0) {
      await openStage2FromResult(searchResults[0]);
    }
  };

  // Stage 2 -> Import (new or metadata refresh) -> Stage 3
  const handleStage2ImportAndProceed = async (forceUpdate = false) => {
    if (!wizardTarget) return;
    setImportingStage2(true);
    setFeedback(null);

    try {
      let selectedEps: Array<{ seasonNumber: number; episodeNumber: number }> | undefined = undefined;
      if (wizardTarget.type === 'tv' && !wizardTarget.existsInCatalog) {
        const chosenNums = Array.from(selectedImportSeasonNums);
        const epsCollected: Array<{ seasonNumber: number; episodeNumber: number }> = [];
        for (const sNum of chosenNums) {
          const eps = seasonEpisodesMap[sNum] || (await fetchSeasonEpisodesForWizard(wizardTarget.tmdbId, sNum));
          for (const ep of eps) {
            epsCollected.push({ seasonNumber: Number(sNum), episodeNumber: Number(ep.episodeNumber) });
          }
        }
        if (epsCollected.length > 0) {
          selectedEps = epsCollected;
        }
      }

      const res = await api.importTmdbMedia(
        wizardTarget.tmdbId,
        wizardTarget.type,
        forceUpdate,
        selectedEps
      );

      const savedItem = res.item || res.existingMediaItem;
      markItemAsInCatalog(wizardTarget.tmdbId, wizardTarget.type, savedItem || null);
      setWizardTarget(prev =>
        prev
          ? {
              ...prev,
              existsInCatalog: true,
              existingMediaItem: savedItem || prev.existingMediaItem,
              seasons: savedItem?.seasons || prev.seasons
            }
          : null
      );

      await refreshContentSources(wizardTarget.tmdbId, wizardTarget.type);
      loadHistory();
      onCatalogUpdated?.();

      setFeedback({
        type: 'success',
        msg: forceUpdate
          ? `Metadados de "${wizardTarget.title}" atualizados preservando as fontes existentes.`
          : `"${wizardTarget.title}" importado com sucesso! Configure agora as fontes de reprodução.`
      });
      setWizardStage(3);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        msg: err?.message || 'Erro ao importar conteúdo do TMDB.'
      });
    } finally {
      setImportingStage2(false);
    }
  };

  const handleSelectSeasonInStage3 = async (seasonNum: number) => {
    if (!wizardTarget) return;
    setSelectedSeasonNum(seasonNum);
    const eps = await fetchSeasonEpisodesForWizard(wizardTarget.tmdbId, seasonNum);
    if (eps.length > 0) {
      setSelectedEpisodeNum(Number(eps[0].episodeNumber || 1));
    } else {
      setSelectedEpisodeNum(1);
    }
  };

  const handleVerifyPendingSourcesStage4 = async () => {
    if (!wizardTarget || contentSources.length === 0) return;
    setVerifyingAllPending(true);
    try {
      const targets = contentSources.filter(s => s.status !== 'online' && s.enabled !== false);
      for (const src of targets) {
        await api.verifyVideoSource(src.id).catch(() => {});
      }
      await refreshContentSources(wizardTarget.tmdbId, wizardTarget.type);
      onCatalogUpdated?.();
      setFeedback({
        type: 'success',
        msg: `Verificação concluída em ${targets.length} fonte(s).`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err?.message || 'Falha ao verificar fontes.' });
    } finally {
      setVerifyingAllPending(false);
    }
  };

  const resetWizard = () => {
    setWizardStage(1);
    setWizardTarget(null);
    setSeriesSeasons([]);
    setSeasonEpisodesMap({});
    setContentSources([]);
    setFeedback(null);
  };

  // Sources grouped by episode for Series Stage 3 list
  const episodeSourcesMap = useMemo(() => {
    const map = new Map<string, { dub: number; leg: number; total: number; online: number }>();
    for (const src of contentSources) {
      const s = Number(src.seasonNumber ?? 1);
      const e = Number(src.episodeNumber ?? 1);
      const key = `${s}-${e}`;
      const entry = map.get(key) || { dub: 0, leg: 0, total: 0, online: 0 };
      entry.total += 1;
      if (String(src.versionType || '').toLowerCase() === 'legendado') entry.leg += 1;
      else entry.dub += 1;
      if (src.status === 'online') entry.online += 1;
      map.set(key, entry);
    }
    return map;
  }, [contentSources]);

  const stage4Stats = useMemo(() => {
    const dub = contentSources.filter(s => String(s.versionType || '').toLowerCase() !== 'legendado');
    const leg = contentSources.filter(s => String(s.versionType || '').toLowerCase() === 'legendado');
    const online = contentSources.filter(s => s.status === 'online');
    const pending = contentSources.filter(s => s.status === 'registered' || s.status === 'validating');
    const errors = contentSources.filter(
      s => s.status === 'offline' || s.status === 'unsupported_format' || s.status === 'embed_blocked'
    );
    return {
      total: contentSources.length,
      dubCount: dub.length,
      legCount: leg.length,
      onlineCount: online.length,
      pendingCount: pending.length,
      errorCount: errors.length
    };
  }, [contentSources]);

  // --- Mass Selection Helpers ---
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

  // --- Render Helpers ---
  const SkeletonCard = () => (
    <div className="min-w-[140px] sm:min-w-[160px] bg-zinc-900 rounded-2xl border border-white/10 p-2 animate-pulse space-y-3">
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
      scrollRef.current?.scrollBy({ left: dir === 'left' ? -400 : 400, behavior: 'smooth' });
    };

    return (
      <div className="space-y-3">
        {title && (
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-[#E50914]" />
              <h3 className="text-xs font-black text-white uppercase tracking-wider">{title}</h3>
            </div>
            <div className="hidden sm:flex gap-1">
              <button
                type="button"
                onClick={() => scroll('left')}
                className="p-1.5 rounded-lg bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => scroll('right')}
                className="p-1.5 rounded-lg bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex gap-3.5 overflow-x-auto pb-2 scrollbar-hide snap-x">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : items.length === 0 ? (
            <div className="w-full py-6 text-center text-xs text-zinc-500 bg-zinc-900/40 rounded-2xl border border-white/10">
              Nenhum título disponível no momento.
            </div>
          ) : (
            items.map(item => (
              <div
                key={`${id}-${item.type}-${item.tmdbId}`}
                className="min-w-[140px] sm:min-w-[155px] bg-[#0e0e11] rounded-2xl border border-white/10 p-2 group hover:border-[#E50914]/50 transition-colors snap-start relative overflow-hidden"
              >
                <div
                  className="relative aspect-[2/3] bg-zinc-950 rounded-xl overflow-hidden cursor-pointer"
                  onClick={() => openStage2FromResult(item)}
                >
                  <SafeTmdbPoster
                    path={item.posterPath}
                    alt={item.title}
                    type={item.type}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute top-2 right-2 bg-black/85 px-1.5 py-0.5 rounded text-[8px] font-black uppercase text-white border border-white/15">
                    {item.type === 'movie' ? 'Filme' : 'Série'}
                  </div>
                  {item.existsInCatalog && (
                    <div className="absolute bottom-2 left-2 bg-emerald-600 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase">
                      No Catálogo
                    </div>
                  )}
                </div>

                <div className="pt-2 px-0.5 space-y-1">
                  <h4 className="text-[11px] font-bold text-white truncate leading-tight" title={item.title}>
                    {item.title}
                  </h4>
                  <div className="flex items-center justify-between text-[10px] text-zinc-500 font-bold tabular-nums">
                    <span>{(item.releaseDate || item.firstAirDate || '').substring(0, 4) || '—'}</span>
                    <span className="text-amber-500 flex items-center gap-0.5">
                      <Star className="w-2.5 h-2.5 fill-amber-500" /> {item.voteAverage ?? 0}
                    </span>
                  </div>

                  <div className="pt-1.5 flex gap-1">
                    {!item.existsInCatalog ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openStage2FromResult(item)}
                          className="flex-1 py-1.5 rounded-lg bg-[#E50914] hover:bg-[#E50914]/90 text-white text-[9px] font-black uppercase tracking-wider flex items-center justify-center gap-1 whitespace-nowrap"
                        >
                          <PlusCircle className="w-2.5 h-2.5" />
                          <span>Selecionar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSelection(item)}
                          className={`w-7 rounded-lg border flex items-center justify-center ${
                            selectedItems.has(`${item.type}-${item.tmdbId}`)
                              ? 'bg-[#E50914]/20 border-[#E50914] text-[#E50914]'
                              : 'bg-zinc-950 border-white/10 text-zinc-500 hover:text-white'
                          }`}
                          title="Selecionar para importação em massa"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openStage2FromResult(item, true)}
                        className="w-full py-1.5 rounded-lg bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-950 text-[9px] font-black uppercase flex items-center justify-center gap-1 whitespace-nowrap"
                      >
                        <Check className="w-2.5 h-2.5" />
                        <span>Gerir Fontes</span>
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

  const activeSeasonEpisodes = seasonEpisodesMap[selectedSeasonNum] || [];
  const activeEpisodeObj = activeSeasonEpisodes.find(
    (e: any) => Number(e.episodeNumber) === Number(selectedEpisodeNum)
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. HEADER */}
      <div className="bg-[#0e0e11] border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[#E50914]">
            <Zap className="w-5 h-5" />
            <h2 className="text-lg sm:text-xl font-black uppercase tracking-tight text-white">
              IMPORTAÇÃO TMDB ID
            </h2>
          </div>
          <p className="text-xs text-zinc-400">
            Fluxo guiado em 4 etapas: Identificação TMDB, Confirmação de Metadados, Fontes Dublada/Legendada e Gravação.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-black px-3 py-2 rounded-xl border border-white/10 flex items-center gap-2.5">
            <span
              className={`w-2 h-2 rounded-full ${
                tmdbStatus === 'ONLINE' ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            <span className="text-[10px] font-black text-white tracking-widest">TMDB {tmdbStatus}</span>
            <button
              type="button"
              onClick={() => {
                checkTmdbStatus();
                loadAllLists(true);
              }}
              disabled={isCheckingStatus}
              className="p-1 rounded-lg bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white"
              title="Sincronizar TMDB"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingStatus ? 'animate-spin text-[#E50914]' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="flex items-center gap-2 bg-[#09090b] p-1.5 rounded-2xl border border-white/10 w-fit">
        {[
          { id: 'smart', label: 'Importação TMDB ID', icon: Sparkles },
          { id: 'mass', label: 'Importação em Massa', icon: Layers },
          { id: 'history', label: 'Histórico', icon: History }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[#E50914] text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'smart' && (
        <div className="space-y-6">
          {/* 4-STAGE STEPPER */}
          <div className="bg-[#0e0e11] border border-white/10 rounded-2xl p-3 sm:p-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {[
                { step: 1 as WizardStage, title: '1. Identificação', desc: 'TMDB ID ou Título' },
                { step: 2 as WizardStage, title: '2. Dados TMDB', desc: 'Metadados & Catálogo' },
                { step: 3 as WizardStage, title: '3. Fontes', desc: 'Dublada & Legendada' },
                { step: 4 as WizardStage, title: '4. Confirmação', desc: 'Resumo Final' }
              ].map(item => {
                const isActive = wizardStage === item.step;
                const isDone = wizardStage > item.step;
                const canClick =
                  item.step === 1 ||
                  (wizardTarget && (item.step === 2 || (wizardTarget.existsInCatalog && (item.step === 3 || item.step === 4))));
                return (
                  <button
                    key={item.step}
                    type="button"
                    disabled={!canClick}
                    onClick={() => canClick && setWizardStage(item.step)}
                    className={`text-left px-3 py-2.5 rounded-xl border transition-colors flex items-center gap-2.5 disabled:opacity-45 ${
                      isActive
                        ? 'bg-[#E50914]/15 border-[#E50914] text-white'
                        : isDone
                        ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-200'
                        : 'bg-black/60 border-white/10 text-zinc-400'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-lg text-[11px] font-black flex items-center justify-center shrink-0 tabular-nums ${
                        isActive
                          ? 'bg-[#E50914] text-white'
                          : isDone
                          ? 'bg-emerald-600 text-white'
                          : 'bg-zinc-900 text-zinc-400'
                      }`}
                    >
                      {isDone ? <Check className="w-3.5 h-3.5" /> : item.step}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-wide truncate">{item.title}</p>
                      <p className="text-[10px] text-zinc-400 truncate">{item.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {loadingTargetDetails && (
            <div className="bg-[#0e0e11] border border-white/10 rounded-2xl p-8 flex items-center justify-center gap-3 text-xs font-bold text-zinc-300">
              <RefreshCw className="w-4 h-4 text-[#E50914] animate-spin" />
              <span>A carregar metadados oficiais do TMDB e fontes do catálogo...</span>
            </div>
          )}

          {/* ETAPA 1 — IDENTIFICAÇÃO */}
          {!loadingTargetDetails && wizardStage === 1 && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                <div className="lg:col-span-8 bg-[#0e0e11] border border-white/10 rounded-2xl p-4 sm:p-5 relative z-40 space-y-3">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Insira o TMDB ID (ex: 550, 1396) ou pesquise pelo título..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onFocus={() => searchQuery.trim() && setShowSearchDropdown(true)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleDirectLookupById();
                        }}
                        className="w-full bg-black border border-white/15 rounded-xl pl-10 pr-9 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914] font-semibold"
                      />
                      {isSearching ? (
                        <RefreshCw className="w-4 h-4 text-[#E50914] absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
                      ) : searchQuery ? (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={handleDirectLookupById}
                      disabled={!searchQuery.trim() || loadingTargetDetails}
                      className="px-4 py-3 rounded-xl bg-[#E50914] hover:bg-[#E50914]/90 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40 whitespace-nowrap"
                    >
                      Carregar TMDB
                    </button>
                  </div>

                  {/* Dropdown de Resultados */}
                  {showSearchDropdown && searchQuery.trim().length > 0 && (
                    <div className="bg-[#09090b] border border-white/15 rounded-xl overflow-hidden">
                      {isSearching ? (
                        <div className="p-5 flex items-center justify-center gap-3 text-xs font-bold text-zinc-300">
                          <RefreshCw className="w-4 h-4 text-[#E50914] animate-spin" />
                          <span>A pesquisar "{searchQuery.trim()}" no TMDB...</span>
                        </div>
                      ) : searchError ? (
                        <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-3 bg-red-950/20">
                          <div className="flex items-center gap-2 text-xs text-red-300">
                            <AlertCircle className="w-4 h-4 text-[#E50914] shrink-0" />
                            <span>{searchError}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSearchNonce(n => n + 1)}
                            className="px-3 py-1.5 rounded-lg bg-[#E50914] text-white text-[10px] font-black uppercase"
                          >
                            Tentar novamente
                          </button>
                        </div>
                      ) : searchResults.length === 0 ? (
                        <div className="p-5 text-center space-y-1">
                          <p className="text-xs font-bold text-zinc-300">
                            Nenhum resultado encontrado para "{searchQuery.trim()}".
                          </p>
                          <p className="text-[11px] text-zinc-500">
                            Experimente inserir o TMDB ID numérico diretamente e clicar em "Carregar TMDB".
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="px-3.5 py-2 bg-black border-b border-white/10 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                            <span className="tabular-nums">Resultados ({searchResults.length})</span>
                            <span>Clique num item para abrir Etapa 2</span>
                          </div>
                          <div className="max-h-[360px] overflow-y-auto divide-y divide-white/5">
                            {searchResults.map(item => (
                              <div
                                key={`search-${item.type}-${item.tmdbId}`}
                                className="p-3 flex items-center gap-3.5 hover:bg-white/[0.04] cursor-pointer"
                                onClick={() => openStage2FromResult(item)}
                              >
                                <div className="w-10 h-14 bg-zinc-950 rounded-lg overflow-hidden shrink-0 border border-white/10">
                                  <SafeTmdbPoster path={item.posterPath} alt={item.title} type={item.type} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h5 className="text-xs font-black text-white truncate">{item.title}</h5>
                                  <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase pt-0.5 flex-wrap tabular-nums">
                                    <span className={item.type === 'movie' ? 'text-blue-400' : 'text-purple-400'}>
                                      {item.type === 'movie' ? 'FILME' : 'SÉRIE'}
                                    </span>
                                    <span>•</span>
                                    <span className="font-mono">TMDB {item.tmdbId}</span>
                                    <span>•</span>
                                    <span>{(item.releaseDate || item.firstAirDate || '').substring(0, 4) || '—'}</span>
                                    <span>•</span>
                                    <span className="text-amber-500 flex items-center gap-0.5">
                                      <Star className="w-2.5 h-2.5 fill-amber-500" /> {item.voteAverage ?? 0}
                                    </span>
                                  </div>
                                </div>
                                <div className="shrink-0 flex items-center gap-2">
                                  {item.existsInCatalog ? (
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        openStage2FromResult(item, true);
                                      }}
                                      className="px-2.5 py-1.5 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase whitespace-nowrap"
                                    >
                                      No Catálogo · Fontes
                                    </button>
                                  ) : (
                                    <span className="px-2.5 py-1.5 rounded-lg bg-[#E50914]/15 border border-[#E50914]/40 text-[#ff6b72] text-[10px] font-black uppercase whitespace-nowrap">
                                      Selecionar
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                            {searchPage < searchTotalPages && (
                              <div className="p-3 text-center bg-black">
                                <button
                                  type="button"
                                  disabled={loadingMoreSearch}
                                  onClick={async () => {
                                    const nextPage = searchPage + 1;
                                    setLoadingMoreSearch(true);
                                    try {
                                      const res = await api.searchTmdb(searchQuery.trim(), searchTypeFilter, undefined, nextPage);
                                      setSearchResults(prev => {
                                        const seen = new Set(prev.map(i => `${i.type}-${i.tmdbId}`));
                                        const merged = [...prev];
                                        for (const it of res.results || []) {
                                          if (!seen.has(`${it.type}-${it.tmdbId}`)) {
                                            seen.add(`${it.type}-${it.tmdbId}`);
                                            merged.push(it);
                                          }
                                        }
                                        return merged;
                                      });
                                      setSearchPage(nextPage);
                                      setSearchTotalPages(res.totalPages || searchTotalPages);
                                    } finally {
                                      setLoadingMoreSearch(false);
                                    }
                                  }}
                                  className="px-4 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold inline-flex items-center gap-2"
                                >
                                  {loadingMoreSearch && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                                  <span>Carregar mais (Pág {searchPage + 1}/{searchTotalPages})</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Tipo Filter */}
                <div className="lg:col-span-4 bg-[#0e0e11] border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                    Tipo de Conteúdo (Deteção Auto / Filtro)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setSearchTypeFilter('all')}
                      className={`py-2.5 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider border ${
                        searchTypeFilter === 'all'
                          ? 'bg-[#E50914] text-white border-[#E50914]'
                          : 'bg-black border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      AUTO
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTypeFilter('movie');
                        setTrendingFilter(prev => ({ ...prev, type: 'movie' }));
                      }}
                      className={`py-2.5 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1 border ${
                        searchTypeFilter === 'movie'
                          ? 'bg-[#E50914] text-white border-[#E50914]'
                          : 'bg-black border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Film className="w-3.5 h-3.5" /> FILME
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTypeFilter('tv');
                        setTrendingFilter(prev => ({ ...prev, type: 'tv' }));
                      }}
                      className={`py-2.5 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1 border ${
                        searchTypeFilter === 'tv'
                          ? 'bg-[#E50914] text-white border-[#E50914]'
                          : 'bg-black border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Tv className="w-3.5 h-3.5" /> SÉRIE
                    </button>
                  </div>
                </div>
              </div>

              {/* Carousels de Descoberta */}
              <div className="space-y-8">
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

                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-[#E50914]" />
                      <h3 className="text-xs font-black text-white uppercase tracking-wider">Em Alta no TMDB</h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex bg-black rounded-xl p-1 border border-white/10">
                        {(['all', 'movie', 'tv'] as const).map(type => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setTrendingFilter(prev => ({ ...prev, type }))}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                              trendingFilter.type === type ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {type === 'all' ? 'TUDO' : type === 'movie' ? 'FILMES' : 'SÉRIES'}
                          </button>
                        ))}
                      </div>
                      <div className="flex bg-black rounded-xl p-1 border border-white/10">
                        {(['day', 'week'] as const).map(period => (
                          <button
                            key={period}
                            type="button"
                            onClick={() => setTrendingFilter(prev => ({ ...prev, period }))}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                              trendingFilter.period === period ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
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
            </div>
          )}

          {/* ETAPA 2 — CONFIRMAÇÃO DOS DADOS TMDB */}
          {!loadingTargetDetails && wizardStage === 2 && wizardTarget && (
            <div className="bg-[#0e0e11] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#E50914]">
                    Etapa 2 de 4 · Confirmação dos Dados TMDB
                  </span>
                  <h3 className="text-lg font-black text-white">{wizardTarget.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={resetWizard}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-zinc-300 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Trocar Conteúdo
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                <div className="md:col-span-3 aspect-[2/3] max-w-[220px] rounded-xl overflow-hidden border border-white/10 bg-black">
                  <SafeTmdbPoster path={wizardTarget.posterPath} alt={wizardTarget.title} type={wizardTarget.type} />
                </div>

                <div className="md:col-span-9 space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                    <span className="px-2.5 py-1 rounded-lg bg-[#E50914] text-white font-black uppercase text-[10px]">
                      {wizardTarget.type === 'tv' ? 'Série' : 'Filme'}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-black border border-white/10 font-mono text-zinc-300 text-[11px]">
                      TMDB ID: {wizardTarget.tmdbId}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-black border border-white/10 text-zinc-300 text-[11px] flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                      {(wizardTarget.releaseDate || wizardTarget.firstAirDate || '').substring(0, 4) || '—'}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-black border border-white/10 text-amber-400 text-[11px] flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                      {wizardTarget.voteAverage ?? 0}
                    </span>
                    {wizardTarget.type === 'tv' && (
                      <span className="px-2.5 py-1 rounded-lg bg-black border border-white/10 text-zinc-300 text-[11px]">
                        {seriesSeasons.length} temporada(s)
                      </span>
                    )}
                  </div>

                  {wizardTarget.genres && wizardTarget.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {wizardTarget.genres.map(g => (
                        <span
                          key={g}
                          className="px-2.5 py-1 rounded-lg bg-black border border-white/10 text-[11px] text-zinc-300"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                    {wizardTarget.overview || 'Sinopse oficial não disponível em português.'}
                  </p>

                  {wizardTarget.existsInCatalog && (
                    <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black text-emerald-300 uppercase">
                          Já existe no catálogo RONYCINE ({contentSources.length} fonte(s) associada(s))
                        </p>
                        <p className="text-[11px] text-zinc-300">
                          Pode avançar diretamente para gerir ou adicionar fontes, ou atualizar os metadados mantendo as fontes intactas.
                        </p>
                      </div>
                      {onViewCatalogItem && (
                        <button
                          type="button"
                          onClick={() =>
                            onViewCatalogItem({
                              id: wizardTarget.existingMediaItem?.id,
                              tmdbId: wizardTarget.tmdbId,
                              type: wizardTarget.type,
                              title: wizardTarget.title
                            })
                          }
                          className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Abrir no Catálogo
                        </button>
                      )}
                    </div>
                  )}

                  {/* Se for série nova, seleção rápida de temporadas a importar */}
                  {wizardTarget.type === 'tv' && !wizardTarget.existsInCatalog && seriesSeasons.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-black border border-white/10 space-y-2.5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                        Temporadas a incluir na importação:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {seriesSeasons.map((s: any) => {
                          const sNum = Number(s.seasonNumber);
                          const active = selectedImportSeasonNums.has(sNum);
                          return (
                            <button
                              key={sNum}
                              type="button"
                              onClick={() => {
                                setSelectedImportSeasonNums(prev => {
                                  const next = new Set(prev);
                                  if (next.has(sNum)) next.delete(sNum);
                                  else next.add(sNum);
                                  return next;
                                });
                              }}
                              className={`px-3 py-1.5 rounded-lg border text-xs font-bold tabular-nums transition-colors ${
                                active
                                  ? 'bg-[#E50914]/20 border-[#E50914] text-white'
                                  : 'bg-zinc-950 border-white/10 text-zinc-400'
                              }`}
                            >
                              {sNum === 0 ? 'Especiais' : `T${sNum}`} ({s.episodeCount || 0} eps)
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stage 2 Actions */}
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    {wizardTarget.existsInCatalog ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setWizardStage(3)}
                          className="px-5 py-2.5 rounded-xl bg-[#E50914] hover:bg-[#E50914]/90 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 whitespace-nowrap"
                        >
                          <span>Avançar para Etapa 3 (Gerir Fontes)</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={importingStage2}
                          onClick={() => handleStage2ImportAndProceed(true)}
                          className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-40 whitespace-nowrap"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${importingStage2 ? 'animate-spin' : ''}`} />
                          <span>Atualizar Metadados e Avançar</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          importingStage2 ||
                          (wizardTarget.type === 'tv' && seriesSeasons.length > 0 && selectedImportSeasonNums.size === 0)
                        }
                        onClick={() => handleStage2ImportAndProceed(false)}
                        className="px-5 py-2.5 rounded-xl bg-[#E50914] hover:bg-[#E50914]/90 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40 whitespace-nowrap"
                      >
                        {importingStage2 ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        <span>
                          {importingStage2
                            ? 'A importar metadados...'
                            : 'Importar para Catálogo e Avançar para Etapa 3'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ETAPA 3 — FONTES DE REPRODUÇÃO (FILME OU SÉRIE POR TEMPORADAS/EPISÓDIOS) */}
          {!loadingTargetDetails && wizardStage === 3 && wizardTarget && (
            <div className="space-y-4">
              {/* Barra de Contexto */}
              <div className="bg-[#0e0e11] border border-white/10 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-14 rounded-lg overflow-hidden bg-black border border-white/10 shrink-0">
                    <SafeTmdbPoster path={wizardTarget.posterPath} alt={wizardTarget.title} type={wizardTarget.type} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#E50914]">
                      Etapa 3 de 4 · Fontes de Reprodução
                    </span>
                    <h3 className="text-sm sm:text-base font-black text-white truncate">
                      {wizardTarget.title}{' '}
                      <span className="text-xs font-mono font-normal text-zinc-400">
                        (TMDB {wizardTarget.tmdbId} · {wizardTarget.type === 'tv' ? 'Série' : 'Filme'})
                      </span>
                    </h3>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWizardStage(2)}
                    className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-zinc-300 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Etapa 2
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      refreshContentSources(wizardTarget.tmdbId, wizardTarget.type);
                      setWizardStage(4);
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <span>Avançar para Etapa 4 (Resumo)</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {wizardTarget.type === 'movie' ? (
                <PlaybackVersionsManager
                  tmdbId={wizardTarget.tmdbId}
                  contentType="movie"
                  title={wizardTarget.title}
                  onUpdated={() => {
                    refreshContentSources(wizardTarget.tmdbId, 'movie');
                    onCatalogUpdated?.();
                  }}
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  {/* Seletor de Temporada e Episódios */}
                  <div className="lg:col-span-4 bg-[#0e0e11] border border-white/10 rounded-2xl p-4 space-y-4">
                    <div className="space-y-2">
                      <p className="text-[11px] font-black uppercase tracking-wider text-zinc-300">
                        1. Escolha a Temporada
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {seriesSeasons.map((s: any) => {
                          const sNum = Number(s.seasonNumber);
                          const isCurrent = selectedSeasonNum === sNum;
                          return (
                            <button
                              key={sNum}
                              type="button"
                              onClick={() => handleSelectSeasonInStage3(sNum)}
                              className={`px-3 py-1.5 rounded-lg border text-xs font-bold tabular-nums transition-colors ${
                                isCurrent
                                  ? 'bg-[#E50914] border-[#E50914] text-white'
                                  : 'bg-black border-white/10 text-zinc-300 hover:border-white/30'
                              }`}
                            >
                              {sNum === 0 ? 'Especiais' : `T${sNum}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-black uppercase tracking-wider text-zinc-300">
                          2. Episódios ({activeSeasonEpisodes.length})
                        </p>
                        {loadingSeasonNum === selectedSeasonNum && (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E50914]" />
                        )}
                      </div>

                      <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
                        {activeSeasonEpisodes.length === 0 ? (
                          <p className="text-xs text-zinc-500 py-4 text-center">
                            {loadingSeasonNum === selectedSeasonNum
                              ? 'A carregar episódios...'
                              : 'Sem episódios carregados nesta temporada.'}
                          </p>
                        ) : (
                          activeSeasonEpisodes.map((ep: any) => {
                            const eNum = Number(ep.episodeNumber);
                            const isSelected = selectedEpisodeNum === eNum;
                            const counts = episodeSourcesMap.get(`${selectedSeasonNum}-${eNum}`) || {
                              dub: 0,
                              leg: 0,
                              total: 0,
                              online: 0
                            };
                            return (
                              <button
                                key={eNum}
                                type="button"
                                onClick={() => setSelectedEpisodeNum(eNum)}
                                className={`w-full text-left p-2.5 rounded-xl border transition-colors flex items-center justify-between gap-2 ${
                                  isSelected
                                    ? 'bg-[#E50914]/15 border-[#E50914] text-white'
                                    : 'bg-black border-white/10 text-zinc-300 hover:border-white/25'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold truncate">
                                    <span className="font-mono text-zinc-400 mr-1.5 tabular-nums">
                                      E{String(eNum).padStart(2, '0')}
                                    </span>
                                    {ep.title || `Episódio ${eNum}`}
                                  </p>
                                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono mt-0.5 tabular-nums">
                                    <span className={counts.dub > 0 ? 'text-emerald-400' : ''}>Dub: {counts.dub}</span>
                                    <span>·</span>
                                    <span className={counts.leg > 0 ? 'text-indigo-400' : ''}>Leg: {counts.leg}</span>
                                  </div>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold tabular-nums shrink-0 ${
                                    counts.total > 0
                                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-zinc-900 text-zinc-500 border border-white/10'
                                  }`}
                                >
                                  {counts.total}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Gestor de Fontes Isolado por Episódio Selecionado */}
                  <div className="lg:col-span-8">
                    <PlaybackVersionsManager
                      key={`${wizardTarget.tmdbId}-S${selectedSeasonNum}-E${selectedEpisodeNum}`}
                      tmdbId={wizardTarget.tmdbId}
                      contentType="tv"
                      title={wizardTarget.title}
                      seasonNumber={selectedSeasonNum}
                      episodeNumber={selectedEpisodeNum}
                      episodeTitle={activeEpisodeObj?.title}
                      onUpdated={() => {
                        refreshContentSources(wizardTarget.tmdbId, 'tv');
                        onCatalogUpdated?.();
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ETAPA 4 — CONFIRMAÇÃO E GRAVAÇÃO (RESUMO FINAL) */}
          {!loadingTargetDetails && wizardStage === 4 && wizardTarget && (
            <div className="bg-[#0e0e11] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                    Etapa 4 de 4 · Resumo Final e Verificação
                  </span>
                  <h3 className="text-lg font-black text-white">{wizardTarget.title}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWizardStage(3)}
                    className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-zinc-200 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Voltar à Etapa 3
                  </button>
                  <button
                    type="button"
                    onClick={resetWizard}
                    className="px-4 py-2 rounded-xl bg-[#E50914] hover:bg-[#E50914]/90 text-white text-xs font-black uppercase tracking-wider whitespace-nowrap"
                  >
                    Nova Importação TMDB
                  </button>
                </div>
              </div>

              {/* Métricas Reais Guardadas */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 tabular-nums">
                <div className="p-3.5 rounded-xl bg-black border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-zinc-500">Total Guardado</p>
                  <p className="text-xl font-black text-white mt-0.5">{stage4Stats.total}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-black border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-zinc-500 flex items-center gap-1">
                    <Mic className="w-3 h-3 text-emerald-400" /> Dublada
                  </p>
                  <p className="text-xl font-black text-emerald-400 mt-0.5">{stage4Stats.dubCount}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-black border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-zinc-500 flex items-center gap-1">
                    <Subtitles className="w-3 h-3 text-indigo-400" /> Legendada
                  </p>
                  <p className="text-xl font-black text-indigo-400 mt-0.5">{stage4Stats.legCount}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-black border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-zinc-500">Online Verificadas</p>
                  <p className="text-xl font-black text-emerald-400 mt-0.5">{stage4Stats.onlineCount}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-black border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-zinc-500">Pendentes / Erros</p>
                  <p className="text-xl font-black text-amber-400 mt-0.5">
                    {stage4Stats.pendingCount} / <span className="text-red-400">{stage4Stats.errorCount}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-zinc-400">
                  {loadingSourcesSummary
                    ? 'A atualizar lista de fontes guardadas...'
                    : `Todas as ${stage4Stats.total} fonte(s) abaixo estão persistidas em disco e prontas para reprodução ou verificação.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {stage4Stats.pendingCount > 0 && (
                    <button
                      type="button"
                      disabled={verifyingAllPending}
                      onClick={handleVerifyPendingSourcesStage4}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
                    >
                      {verifyingAllPending ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E50914]" />
                      ) : (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      <span>Verificar Fontes Pendentes ({stage4Stats.pendingCount})</span>
                    </button>
                  )}
                  {onViewCatalogItem && (
                    <button
                      type="button"
                      onClick={() =>
                        onViewCatalogItem({
                          id: wizardTarget.existingMediaItem?.id,
                          tmdbId: wizardTarget.tmdbId,
                          type: wizardTarget.type,
                          title: wizardTarget.title
                        })
                      }
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Ver no Catálogo</span>
                    </button>
                  )}
                </div>
              </div>

              {contentSources.length === 0 ? (
                <div className="p-6 rounded-xl bg-black border border-white/10 text-center text-xs text-zinc-400">
                  Nenhuma fonte associada ainda. Volte à Etapa 3 para adicionar links Dublado ou Legendado.
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {contentSources.map(src => (
                    <div
                      key={src.id}
                      className="p-3 rounded-xl bg-black border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white">{src.serverName || src.provider || 'Fonte'}</span>
                          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-zinc-300 uppercase">
                            {src.versionType === 'legendado' ? 'Legendada' : 'Dublada'}
                          </span>
                          {wizardTarget.type === 'tv' && (
                            <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                              T{src.seasonNumber ?? 1}E{src.episodeNumber ?? 1}
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-zinc-500 uppercase">
                            {src.quality || '1080p'} · {src.format || 'auto'}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-zinc-400 truncate">{src.originalUrl || src.url}</p>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold border shrink-0 ${
                          src.status === 'online'
                            ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/35'
                            : src.status === 'offline' || src.status === 'unsupported_format'
                            ? 'bg-red-950/50 text-red-300 border-red-500/35'
                            : 'bg-amber-950/40 text-amber-200 border-amber-500/30'
                        }`}
                      >
                        {src.status === 'online'
                          ? 'Disponível / Online'
                          : src.status === 'offline'
                          ? 'Indisponível'
                          : src.status === 'unsupported_format'
                          ? 'Formato incompatível'
                          : 'Guardada · Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* FAB Seleção em Massa */}
          {selectedItems.size > 0 && wizardStage === 1 && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-zinc-900 border-2 border-[#E50914] p-4 rounded-2xl shadow-2xl flex items-center gap-6 min-w-[320px]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#E50914] flex items-center justify-center text-white font-black tabular-nums">
                  {selectedItems.size}
                </div>
                <div>
                  <p className="text-[11px] font-black text-white uppercase">Itens Selecionados</p>
                  <p className="text-[10px] text-zinc-400">Pronto para importar em massa</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedItems(new Set())}
                  className="px-3 py-2 rounded-xl bg-black border border-white/10 text-zinc-300 text-xs font-bold"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('mass');
                    handleBatchImport();
                  }}
                  className="px-4 py-2 rounded-xl bg-[#E50914] hover:bg-[#E50914]/90 text-white text-xs font-black uppercase"
                >
                  Importar Agora
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'mass' && (
        <div className="bg-[#0e0e11] border border-white/10 rounded-2xl p-6 sm:p-8 text-center space-y-6">
          <div className="space-y-2">
            <Layers className="w-10 h-10 text-[#E50914] mx-auto" />
            <h3 className="text-lg font-black text-white uppercase tracking-tight">
              Painel de Importação em Massa
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-lg mx-auto">
              Acompanhe o processamento de metadados do TMDB em lote.
            </p>
          </div>

          {isProcessingBatch && batchProgress ? (
            <div className="max-w-md mx-auto space-y-5 bg-black p-6 rounded-2xl border border-white/10">
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] font-bold uppercase text-zinc-400">
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
                <div className="h-2.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-white/10">
                  <div
                    style={{
                      width: `${
                        (((batchProgress.success || 0) +
                          (batchProgress.existing || 0) +
                          (batchProgress.failures || 0)) /
                          Math.max(batchProgress.total || 1, 1)) *
                        100
                      }%`
                    }}
                    className="h-full bg-[#E50914]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 tabular-nums">
                <div className="bg-[#0e0e11] p-3 rounded-xl border border-white/10">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase">Sucessos</p>
                  <p className="text-lg font-black text-emerald-400">{batchProgress.success ?? 0}</p>
                </div>
                <div className="bg-[#0e0e11] p-3 rounded-xl border border-white/10">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase">Existentes</p>
                  <p className="text-lg font-black text-amber-400">{batchProgress.existing ?? 0}</p>
                </div>
                <div className="bg-[#0e0e11] p-3 rounded-xl border border-white/10">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase">Erros</p>
                  <p className="text-lg font-black text-red-400">{batchProgress.failures ?? 0}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => api.cancelMassImport()}
                className="w-full py-2.5 rounded-xl bg-zinc-900 hover:bg-red-950/30 text-zinc-300 hover:text-red-400 font-bold text-xs uppercase border border-white/10"
              >
                Interromper Processo
              </button>
            </div>
          ) : (
            <div className="bg-black p-8 rounded-2xl border border-white/10 space-y-4">
              <p className="text-xs text-zinc-400">Nenhum lote de processamento ativo no momento.</p>
              <button
                type="button"
                onClick={() => setActiveTab('smart')}
                className="px-6 py-2.5 rounded-xl bg-[#E50914] hover:bg-[#E50914]/90 text-white font-black text-xs uppercase tracking-wider"
              >
                Voltar à Importação TMDB ID
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-[#0e0e11] border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-black">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[#E50914]" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Histórico de Importações TMDB</h3>
            </div>
            <button
              type="button"
              onClick={loadHistory}
              disabled={isLoadingHistory}
              className="p-2 rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingHistory ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-black/60 text-zinc-400 uppercase font-bold border-b border-white/10">
                  <th className="px-5 py-3">Data/Hora</th>
                  <th className="px-5 py-3">Título</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {historyList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-zinc-500">
                      Nenhuma atividade registada recentemente.
                    </td>
                  </tr>
                ) : (
                  historyList.map(log => (
                    <tr key={log.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3 text-zinc-400 font-mono tabular-nums">
                        {new Date(log.timestamp).toLocaleDateString('pt-PT')}{' '}
                        {new Date(log.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{log.title}</span>
                          <span className="text-[10px] font-mono bg-black px-1.5 py-0.5 rounded border border-white/10 text-zinc-400">
                            {log.tmdbId}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            log.status === 'SUCCESS'
                              ? 'bg-emerald-950/50 text-emerald-400 border-emerald-500/30'
                              : log.status === 'EXISTING'
                              ? 'bg-amber-950/50 text-amber-400 border-amber-500/30'
                              : 'bg-red-950/50 text-red-400 border-red-500/30'
                          }`}
                        >
                          {log.status === 'SUCCESS' ? 'IMPORTADO' : log.status === 'EXISTING' ? 'EXISTENTE' : 'ERRO'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-400">{(log.adminEmail || '').split('@')[0] || 'admin'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FEEDBACK TOAST */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className={`fixed top-24 right-6 z-[110] p-4 rounded-2xl border shadow-2xl flex items-center gap-3 max-w-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                : feedback.type === 'warning'
                ? 'bg-amber-950 border-amber-700 text-amber-300'
                : 'bg-red-950 border-red-700 text-red-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : feedback.type === 'warning' ? (
              <AlertTriangle className="w-5 h-5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0" />
            )}
            <p className="text-xs font-bold leading-snug">{feedback.msg}</p>
            <button type="button" onClick={() => setFeedback(null)} className="p-1 hover:bg-black/20 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
