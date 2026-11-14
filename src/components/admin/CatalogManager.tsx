import React, { useState, useEffect, useRef } from 'react';
import {
  Film,
  Tv,
  Layers,
  Video,
  AlertTriangle,
  Flame,
  Search,
  LayoutList,
  LayoutGrid,
  RefreshCw,
  MoreVertical,
  Eye,
  Edit,
  RotateCw,
  Play,
  Copy,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  Plus,
  X,
  Star,
  ChevronLeft,
  ChevronRight,
  Database,
  SlidersHorizontal,
  Info,
  ShieldAlert,
  Server,
  Globe,
  EyeOff,
  RotateCcw
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  MediaItem,
  CatalogStats,
  CatalogAuditSummary,
  PlayerSource,
  Season,
  Episode
} from '../../types.js';
import {
  resolveTmdbPosterUrl,
  getMediaYear,
  formatAdminDate,
  getSourceSummaryDisplay
} from '../../lib/mediaUtils.js';

interface CatalogManagerProps {
  onSwitchTab?: (tabId: string) => void;
  onStatsUpdated?: () => void;
  onOpenSources?: (item: MediaItem, seasonNumber?: number, episodeNumber?: number) => void;
  initialFilterType?: 'all' | 'movie' | 'tv' | string;
  initialFilterGenre?: string;
  externalSearch?: { query: string; nonce: number } | null;
}

const DEFAULT_GENRES = [
  'Ação',
  'Aventura',
  'Animação',
  'Comédia',
  'Crime',
  'Documentário',
  'Drama',
  'Família',
  'Fantasia',
  'Ficção científica',
  'Guerra',
  'História',
  'Mistério',
  'Música',
  'Romance',
  'Terror',
  'Thriller',
  'Faroeste'
];

const PosterThumb: React.FC<{
  posterPath?: string | null;
  title: string;
  isSeries?: boolean;
  sizeClass?: string;
  badgeTopRight?: React.ReactNode;
}> = ({ posterPath, title, isSeries, sizeClass = 'w-11 h-16', badgeTopRight }) => {
  const [errored, setErrored] = useState(false);
  const url = resolveTmdbPosterUrl(posterPath, 'w185');

  return (
    <div
      className={`${sizeClass} bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 shrink-0 relative flex items-center justify-center`}
    >
      {url && !errored ? (
        <img
          src={url}
          alt={title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 bg-zinc-950 p-1">
          {isSeries ? <Tv className="w-4 h-4" /> : <Film className="w-4 h-4" />}
        </div>
      )}
      {badgeTopRight}
    </div>
  );
};

interface EpisodeWithSources extends Episode {
  sources?: PlayerSource[];
  sourcesCount?: number;
  sourceStatus?: string;
}

interface SeasonWithSources extends Omit<Season, 'episodes'> {
  episodes?: EpisodeWithSources[];
  episodesWithSourceCount?: number;
}

export const CatalogManager: React.FC<CatalogManagerProps> = ({
  onSwitchTab,
  onStatsUpdated,
  onOpenSources,
  initialFilterType = 'all',
  initialFilterGenre = 'all',
  externalSearch
}) => {
  const isMovieCatalog = initialFilterType === 'movie';
  const isSeriesCatalog = initialFilterType === 'tv';
  const isTypeLocked = isMovieCatalog || isSeriesCatalog;

  // --- STATE ---
  const [items, setItems] = useState<MediaItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(() => {
    try {
      const saved = sessionStorage.getItem(`ronycine_admin_catalog_${initialFilterType || 'all'}`);
      return saved ? JSON.parse(saved).page || 1 : 1;
    } catch {
      return 1;
    }
  });
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [audit, setAudit] = useState<CatalogAuditSummary | null>(null);
  const [genreOptions, setGenreOptions] = useState<string[]>(DEFAULT_GENRES);

  const [loading, setLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>('');

  // Search & Filters State
  const [searchQuery, setSearchQuery] = useState<string>(externalSearch?.query || '');
  const [debouncedSearch, setDebouncedSearch] = useState<string>(externalSearch?.query || '');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [exportMenuOpen, setExportMenuOpen] = useState<boolean>(false);

  const [filterType, setFilterType] = useState<string>(initialFilterType);
  const [filterGenre, setFilterGenre] = useState<string>(initialFilterGenre);
  const [filterPublishStatus, setFilterPublishStatus] = useState<string>('all');
  const [filterSourceStatus, setFilterSourceStatus] = useState<string>('all');
  const [filterDiagnostic, setFilterDiagnostic] = useState<string>('all');
  const [filterYearFrom, setFilterYearFrom] = useState<string>('');
  const [filterYearTo, setFilterYearTo] = useState<string>('');
  const [sortOption, setSortOption] = useState<string>('recent');

  // Multi-Selection State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modals & Details State
  const [detailsModalOpen, setDetailsModalOpen] = useState<boolean>(false);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false);
  const [detailsItem, setDetailsItem] = useState<MediaItem | null>(null);
  const [detailsSources, setDetailsSources] = useState<PlayerSource[]>([]);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);
  const [syncingSeasonNum, setSyncingSeasonNum] = useState<number | null>(null);

  const [editingItem, setEditingItem] = useState<(MediaItem & { genresText?: string }) | null>(null);
  const [diagnosticItem, setDiagnosticItem] = useState<any | null>(null);
  const [deleteModalItem, setDeleteModalItem] = useState<MediaItem | null>(null);
  const [deletePermanent, setDeletePermanent] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState<boolean>(false);

  // Dropdown & Toast
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFilterType(initialFilterType);
    setFilterGenre(initialFilterGenre);
    try {
      const saved = sessionStorage.getItem(`ronycine_admin_catalog_${initialFilterType || 'all'}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.page && typeof parsed.page === 'number') {
          setCurrentPage(parsed.page);
        }
      }
    } catch (_) {}
    setSelectedIds([]);
  }, [initialFilterType, initialFilterGenre]);

  // Persist page and filter state across navigation
  useEffect(() => {
    try {
      sessionStorage.setItem(`ronycine_admin_catalog_${initialFilterType || 'all'}`, JSON.stringify({
        page: currentPage,
        genre: filterGenre,
        publishStatus: filterPublishStatus,
        sourceStatus: filterSourceStatus,
        sort: sortOption,
        perPage: itemsPerPage,
        search: searchQuery
      }));
    } catch (_) {}
  }, [currentPage, filterGenre, filterPublishStatus, filterSourceStatus, sortOption, itemsPerPage, searchQuery, initialFilterType]);

  useEffect(() => {
    if (externalSearch && externalSearch.query !== undefined) {
      setSearchQuery(externalSearch.query);
      setDebouncedSearch(externalSearch.query);
      setCurrentPage(1);
    }
  }, [externalSearch]);

  // Load categories dynamically
  useEffect(() => {
    api
      .getCategories()
      .then(cats => {
        if (Array.isArray(cats) && cats.length > 0) {
          const names = cats.map((c: any) => c.name || c).filter(Boolean);
          setGenreOptions(Array.from(new Set([...names, ...DEFAULT_GENRES])));
        }
      })
      .catch(() => {});
  }, []);

  // Debounce search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setCurrentPage(1);
    }, 320);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Fetch Catalog Data via authenticated /api/admin/catalog with AbortController
  const fetchCatalogData = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setErrorBanner(null);

    try {
      const [catRes, statsRes] = await Promise.all([
        api.getAdminCatalog(
          {
            type: filterType,
            genre: filterGenre,
            search: debouncedSearch,
            yearFrom: filterYearFrom ? parseInt(filterYearFrom, 10) : undefined,
            yearTo: filterYearTo ? parseInt(filterYearTo, 10) : undefined,
            publishStatus: filterPublishStatus,
            sourceStatus: filterSourceStatus,
            diagnostic: filterDiagnostic,
            sort: sortOption,
            page: currentPage,
            limit: itemsPerPage
          },
          controller.signal
        ),
        api.getAdminStats()
      ]);

      if (controller.signal.aborted) return;

      setItems(catRes.items || []);
      setTotalCount(catRes.total || 0);
      setTotalPages(Math.max(1, catRes.totalPages || 1));
      setAudit(catRes.audit || null);
      setStats(statsRes);
      setLastUpdatedTime(new Date().toLocaleTimeString('pt-PT'));
      if (onStatsUpdated) onStatsUpdated();
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Erro ao carregar catálogo:', err);
      setErrorBanner(err?.message || 'Não foi possível carregar o catálogo administrativo.');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchCatalogData();
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [
    debouncedSearch,
    currentPage,
    itemsPerPage,
    filterType,
    filterGenre,
    filterPublishStatus,
    filterSourceStatus,
    filterDiagnostic,
    filterYearFrom,
    filterYearTo,
    sortOption
  ]);

  const showNotification = (msg: string) => {
    setActionSuccessMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setActionSuccessMsg(null), 4000);
  };

  // --- SELECTION ---
  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? items.map(i => i.id) : []);
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]));
  };

  const handleCopyId = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    showNotification(`${label} copiado: ${text}`);
    setActiveMenuId(null);
  };

  // --- DETAILS / SERIES EPISODE INSPECTOR ---
  const openDetailsModal = async (item: MediaItem, syncSeasons = false, targetSeason?: number) => {
    setActiveMenuId(null);
    setDetailsItem(item);
    setDetailsModalOpen(true);
    setDetailsLoading(true);
    try {
      const res = await api.getAdminCatalogDetails(item.id, syncSeasons, targetSeason);
      setDetailsItem(res.item);
      setDetailsSources(res.sources || []);
      const firstSeason = res.item?.seasons?.find(s => s.seasonNumber > 0) || res.item?.seasons?.[0];
      if (targetSeason !== undefined) {
        setSelectedSeasonNum(targetSeason);
      } else if (firstSeason) {
        setSelectedSeasonNum(firstSeason.seasonNumber);
      }
    } catch (err: any) {
      setErrorBanner(`Erro ao carregar detalhes de "${item.title}": ${err.message}`);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleSyncSeasonEpisodes = async (seasonNumber: number) => {
    if (!detailsItem) return;
    setSyncingSeasonNum(seasonNumber);
    try {
      const res = await api.getAdminCatalogDetails(detailsItem.id, true, seasonNumber);
      setDetailsItem(res.item);
      setDetailsSources(res.sources || []);
      showNotification(`✓ Episódios da Temporada ${seasonNumber} sincronizados do TMDB.`);
      fetchCatalogData();
    } catch (err: any) {
      setErrorBanner(`Erro ao sincronizar Temporada ${seasonNumber}: ${err.message}`);
    } finally {
      setSyncingSeasonNum(null);
    }
  };

  // --- ITEM ACTIONS ---
  const handleSyncTmdb = async (item: MediaItem) => {
    setActiveMenuId(null);
    if (!item.tmdbId) {
      setErrorBanner(`"${item.title}" não possui TMDB ID para sincronização.`);
      return;
    }
    showNotification(`Sincronizando "${item.title}" com o TMDB...`);
    try {
      const mediaType: 'movie' | 'tv' = item.type === 'tv' || item.type === 'series' ? 'tv' : 'movie';
      const res = await api.updateTmdbMedia(item.tmdbId, mediaType);
      if (res.success) {
        showNotification(`✓ "${item.title}" atualizado preservando fontes e episódios!`);
        fetchCatalogData();
        if (detailsModalOpen && detailsItem?.id === item.id) {
          openDetailsModal(item);
        }
      }
    } catch (err: any) {
      setErrorBanner(`Erro ao sincronizar "${item.title}": ${err.message}`);
    }
  };

  const handleTogglePublish = async (item: MediaItem) => {
    setActiveMenuId(null);
    const nextPub = item.published === false || item.status === 'DRAFT' || item.status === 'INACTIVE';
    try {
      const res = await api.publishCatalogItem(item.id, nextPub);
      showNotification(`✓ ${res.message}`);
      fetchCatalogData();
      if (detailsModalOpen && detailsItem?.id === item.id && res.item) {
        setDetailsItem(res.item);
      }
    } catch (err: any) {
      setErrorBanner(`Erro ao alterar publicação: ${err.message}`);
    }
  };

  const handleRestoreItem = async (item: MediaItem) => {
    setActiveMenuId(null);
    try {
      const res = await api.restoreCatalogItem(item.id);
      showNotification(`✓ ${res.message}`);
      fetchCatalogData();
    } catch (err: any) {
      setErrorBanner(`Erro ao restaurar item: ${err.message}`);
    }
  };

  const handleToggleTop10 = async (item: MediaItem) => {
    setActiveMenuId(null);
    try {
      const res = await api.toggleTop10(item.id);
      showNotification(res.isTop10 ? `🔥 "${item.title}" adicionado ao Top 10.` : `"${item.title}" removido do Top 10.`);
      fetchCatalogData();
    } catch (err: any) {
      setErrorBanner(`Erro ao alterar Top 10: ${err.message}`);
    }
  };

  const handleRunDiagnostics = async (item: MediaItem) => {
    setActiveMenuId(null);
    try {
      const report = await api.diagnoseMediaItem(item.id);
      setDiagnosticItem(report);
    } catch (err: any) {
      setErrorBanner(`Erro ao executar diagnóstico: ${err.message}`);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteModalItem) return;
    setIsDeleting(true);
    try {
      const res = await api.deleteCatalogItem(deleteModalItem.id, deletePermanent || Boolean(deleteModalItem.deletedAt));
      if (res.success) {
        showNotification(`✓ ${res.message || `"${deleteModalItem.title}" removido com sucesso.`}`);
        setDeleteModalItem(null);
        setDeletePermanent(false);
        setSelectedIds(prev => prev.filter(id => id !== deleteModalItem.id));
        fetchCatalogData();
      }
    } catch (err: any) {
      setErrorBanner(err.message || 'Falha ao eliminar conteúdo.');
    } finally {
      setIsDeleting(false);
    }
  };

  // --- BATCH ACTIONS ---
  const handleBatchAction = async (action: 'publish' | 'unpublish' | 'sync' | 'top10' | 'restore' | 'delete') => {
    if (selectedIds.length === 0) return;

    if (action === 'delete') {
      setShowBatchDeleteModal(true);
      return;
    }

    setIsBatchProcessing(true);
    try {
      const res = await api.batchCatalogAction(action, selectedIds);
      showNotification(`✓ ${res.message} (${res.affectedCount ?? selectedIds.length} afetados)`);
      setSelectedIds([]);
      fetchCatalogData();
    } catch (err: any) {
      setErrorBanner(`Erro na ação em massa: ${err.message}`);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleConfirmBatchDelete = async () => {
    setIsBatchProcessing(true);
    try {
      const res = await api.batchCatalogAction('delete', selectedIds, {
        permanent: deletePermanent || filterPublishStatus === 'deleted'
      });
      showNotification(`✓ ${res.message}`);
      setSelectedIds([]);
      setShowBatchDeleteModal(false);
      setDeletePermanent(false);
      fetchCatalogData();
    } catch (err: any) {
      setErrorBanner(`Erro ao eliminar em massa: ${err.message}`);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    try {
      const parsedGenres =
        editingItem.genresText !== undefined
          ? editingItem.genresText
              .split(',')
              .map(g => g.trim())
              .filter(Boolean)
          : editingItem.genres;

      const { genresText: _ignore, ...payload } = editingItem;
      const res = await api.updateMediaItem(editingItem.id, {
        ...payload,
        genres: parsedGenres
      });
      if (res.success) {
        showNotification(`✓ "${editingItem.title}" guardado com sucesso.`);
        setEditingItem(null);
        fetchCatalogData();
      }
    } catch (err: any) {
      setErrorBanner(`Erro ao guardar alterações: ${err.message}`);
    }
  };

  const handleExportData = async (format: 'json' | 'csv', onlySelected = false) => {
    setExportMenuOpen(false);
    try {
      showNotification(`A gerar ficheiro ${format.toUpperCase()}...`);
      await api.exportCatalogFile({
        format,
        type: filterType,
        genre: filterGenre !== 'all' ? filterGenre : undefined,
        publishStatus: filterPublishStatus !== 'all' ? filterPublishStatus : undefined,
        sourceStatus: filterSourceStatus !== 'all' ? filterSourceStatus : undefined,
        diagnostic: filterDiagnostic !== 'all' ? filterDiagnostic : undefined,
        search: debouncedSearch || undefined,
        yearFrom: filterYearFrom || undefined,
        yearTo: filterYearTo || undefined,
        ids: onlySelected ? selectedIds : undefined
      });
      showNotification(
        `✓ Exportação ${format.toUpperCase()} (${onlySelected ? `${selectedIds.length} selecionados` : 'catálogo'}) transferida.`
      );
    } catch (err: any) {
      setErrorBanner(`Erro ao exportar: ${err.message}`);
    }
  };

  const resetFilters = () => {
    if (!isTypeLocked) setFilterType('all');
    setFilterGenre('all');
    setFilterPublishStatus('all');
    setFilterSourceStatus('all');
    setFilterDiagnostic('all');
    setFilterYearFrom('');
    setFilterYearTo('');
    setSortOption('recent');
    setSearchQuery('');
    setCurrentPage(1);
  };

  // --- BADGE HELPERS ---
  const renderPublishBadge = (item: MediaItem) => {
    if (item.deletedAt) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-950/80 text-red-400 border border-red-800/80 inline-flex items-center gap-1">
          <Trash2 className="w-2.5 h-2.5" /> Lixeira
        </span>
      );
    }
    const isPub = item.published !== false && item.status !== 'DRAFT' && item.status !== 'INACTIVE';
    if (isPub) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Publicado
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700 inline-flex items-center gap-1">
        <EyeOff className="w-2.5 h-2.5" /> Rascunho
      </span>
    );
  };

  const renderSourceBadge = (item: MediaItem) => {
    const info = getSourceSummaryDisplay(item.sourceSummary);
    return (
      <span
        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1.5 whitespace-nowrap ${info.badgeClass}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${info.dotClass}`} />
        {info.label}
      </span>
    );
  };

  const renderDiagnosticPill = (item: MediaItem) => {
    const diag = item.diagnosticSummary;
    if (!diag) return null;
    if (diag.issues.length === 0) {
      return (
        <span className="text-[10px] text-emerald-400/90 font-semibold flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Íntegro
        </span>
      );
    }
    return (
      <span
        className="text-[10px] text-amber-400 font-semibold flex items-center gap-1 cursor-pointer hover:underline"
        title={diag.issues.join(' • ')}
        onClick={() => handleRunDiagnostics(item)}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" />
        {diag.issues[0]}
        {diag.issues.length > 1 ? ` (+${diag.issues.length - 1})` : ''}
      </span>
    );
  };

  const headerTitle = isMovieCatalog
    ? 'Catálogo de Filmes'
    : isSeriesCatalog
    ? 'Catálogo de Séries'
    : 'Gestão Completa de Catálogo';

  const headerSubtitle = isMovieCatalog
    ? 'Listagem isolada de todos os filmes registados na base de dados RONYCINE.'
    : isSeriesCatalog
    ? 'Listagem isolada de séries, temporadas, episódios e fontes associadas.'
    : 'Controle unificado sobre filmes e séries registados no acervo RONYCINE.';

  const activeFilterCount = [
    !isTypeLocked && filterType !== 'all',
    filterGenre !== 'all',
    filterPublishStatus !== 'all',
    filterSourceStatus !== 'all',
    filterDiagnostic !== 'all',
    Boolean(filterYearFrom),
    Boolean(filterYearTo)
  ].filter(Boolean).length;

  const dbSectionTotal = isMovieCatalog
    ? audit?.dbMoviesTotal ?? stats?.totalMovies ?? 0
    : isSeriesCatalog
    ? audit?.dbSeriesTotal ?? stats?.totalSeries ?? 0
    : audit?.dbTotal ?? (stats ? stats.totalMovies + stats.totalSeries : 0);

  return (
    <div className="space-y-5 text-zinc-100 font-sans">
      {/* SUCCESS TOAST */}
      {actionSuccessMsg && (
        <div className="fixed top-5 right-5 z-[140] bg-emerald-950 border border-emerald-600 text-emerald-200 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{actionSuccessMsg}</span>
        </div>
      )}

      {/* ERROR BANNER */}
      {errorBanner && (
        <div className="p-4 bg-red-950/80 border border-red-700 text-red-200 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-xs font-medium">{errorBanner}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={fetchCatalogData}
              className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
            <button onClick={() => setErrorBanner(null)} className="p-1 text-red-300 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 1. CABEÇALHO DEDICADO */}
      <div className="bg-[#0D0F15] rounded-3xl p-5 sm:p-6 border border-white/10 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div
            className={`p-3 rounded-2xl border ${
              isSeriesCatalog
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                : 'bg-brand/10 border-brand/30 text-brand'
            }`}
          >
            {isSeriesCatalog ? <Tv className="w-6 h-6" /> : <Film className="w-6 h-6" />}
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight uppercase font-outfit">
              {headerTitle}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">{headerSubtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-between lg:justify-end">
          <div className="flex items-center gap-2 px-3 py-2 bg-black/50 border border-white/10 rounded-xl text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-emerald-400 font-bold">BD Ligada</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400 font-mono tabular-nums">{lastUpdatedTime || 'Agora'}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchCatalogData}
              disabled={loading}
              className="p-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded-xl transition-all border border-zinc-700/80 disabled:opacity-50"
              title="Atualizar lista"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-brand' : ''}`} />
            </button>

            {onSwitchTab && (
              <>
                <button
                  onClick={() => onSwitchTab('import_single')}
                  className="px-3.5 py-2.5 bg-brand hover:bg-brand/90 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-brand/20 flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Importar TMDB</span>
                </button>
                <button
                  onClick={() => onSwitchTab('import_mass')}
                  className="px-3.5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 rounded-xl text-xs font-bold uppercase tracking-wider transition-all hidden sm:flex items-center gap-1.5"
                >
                  <Database className="w-4 h-4 text-brand" />
                  <span>Em Massa</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 2. KPI CARDS REAIS CONTEXTUALIZADOS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 tabular-nums">
        {isMovieCatalog ? (
          <>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-brand/10 border border-brand/20 rounded-xl text-brand">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">
                  Total de Filmes
                </span>
                <span className="text-xl font-black text-white">
                  {(stats?.totalMovies ?? audit?.dbMoviesTotal ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Publicados</span>
                <span className="text-xl font-black text-emerald-400">
                  {(stats?.publishedMovies ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Sem Fonte</span>
                <span className="text-xl font-black text-amber-400">
                  {(stats?.moviesWithoutSource ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">
                  Rascunho / Lixeira
                </span>
                <span className="text-xl font-black text-white">
                  {(stats?.unpublishedMovies ?? 0).toLocaleString('pt-PT')} /{' '}
                  {(stats?.deletedMovies ?? audit?.dbDeletedMovies ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
          </>
        ) : isSeriesCatalog ? (
          <>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400">
                <Tv className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">
                  Total de Séries
                </span>
                <span className="text-xl font-black text-white">
                  {(stats?.totalSeries ?? audit?.dbSeriesTotal ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">
                  Temporadas / Ep.
                </span>
                <span className="text-xl font-black text-white">
                  {(stats?.totalSeasons ?? 0).toLocaleString('pt-PT')} /{' '}
                  {(stats?.totalEpisodes ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Sem Fonte</span>
                <span className="text-xl font-black text-amber-400">
                  {(stats?.seriesWithoutSource ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">
                  Publicadas / Lixeira
                </span>
                <span className="text-xl font-black text-emerald-400">
                  {(stats?.publishedSeries ?? 0).toLocaleString('pt-PT')}{' '}
                  <span className="text-zinc-500 text-sm">
                    / {(stats?.deletedSeries ?? audit?.dbDeletedSeries ?? 0).toLocaleString('pt-PT')}
                  </span>
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-brand/10 border border-brand/20 rounded-xl text-brand">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Filmes</span>
                <span className="text-xl font-black text-white">
                  {(stats?.totalMovies ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400">
                <Tv className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Séries</span>
                <span className="text-xl font-black text-white">
                  {(stats?.totalSeries ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Fontes</span>
                <span className="text-xl font-black text-white">
                  {(stats?.totalLinks ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
            <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Alertas</span>
                <span className="text-xl font-black text-amber-400">
                  {(stats?.totalProblematic ?? 0).toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* INTEGRITY VERIFICATION STRIP (DB vs API vs UI) */}
      {audit && (
        <div className="bg-zinc-950/90 border border-white/10 rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono tabular-nums">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-zinc-400">
              Integridade BD:{' '}
              <strong className="text-white">
                {dbSectionTotal.toLocaleString('pt-PT')} {isSeriesCatalog ? 'séries' : isMovieCatalog ? 'filmes' : 'itens'}
              </strong>
            </span>
            <span className="text-zinc-700">|</span>
            <span className="text-zinc-400">
              API Filtrado: <strong className="text-emerald-400">{audit.filteredTotal.toLocaleString('pt-PT')}</strong>
            </span>
            <span className="text-zinc-700">|</span>
            <span className="text-zinc-400">
              Exibido na Página: <strong className="text-sky-400">{items.length}</strong> (Pág. {audit.page})
            </span>
          </div>
          {filterPublishStatus !== 'deleted' && (
            <button
              onClick={() => {
                setFilterPublishStatus('deleted');
                setCurrentPage(1);
              }}
              className="text-[10px] text-zinc-400 hover:text-red-400 transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Lixeira ({isMovieCatalog ? audit.dbDeletedMovies : isSeriesCatalog ? audit.dbDeletedSeries : audit.dbDeletedMovies + audit.dbDeletedSeries})
            </button>
          )}
        </div>
      )}

      {/* 3. PESQUISA E BARRA DE FERRAMENTAS */}
      <div className="bg-[#0D0F15] border border-white/10 rounded-3xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Pesquisar por título, título original, TMDB ID, IMDb ID ou ID interno..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-black border border-zinc-800 focus:border-brand rounded-2xl pl-11 pr-10 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                title="Limpar pesquisa"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-3 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 border ${
                showFilters || activeFilterCount > 0
                  ? 'bg-brand text-white border-brand'
                  : 'bg-black text-zinc-300 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
            </button>

            <div className="flex bg-black border border-zinc-800 rounded-2xl p-1 gap-1">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'table' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <LayoutList className="w-4 h-4" />
                <span className="hidden sm:inline">Tabela</span>
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'grid' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden sm:inline">Cards</span>
              </button>
            </div>

            {/* EXPORT DROPDOWN */}
            <div className="relative">
              <button
                onClick={() => setExportMenuOpen(prev => !prev)}
                className="px-3.5 py-3 bg-black border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded-2xl text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <Download className="w-4 h-4 text-brand" />
                <span className="hidden sm:inline">Exportar</span>
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-2 flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl p-2 shadow-2xl z-30 min-w-[180px]">
                  <button
                    onClick={() => handleExportData('csv', false)}
                    className="px-3 py-2 text-xs text-left text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl font-bold transition-all"
                  >
                    Exportar CSV ({isSeriesCatalog ? 'Séries' : isMovieCatalog ? 'Filmes' : 'Tudo'})
                  </button>
                  <button
                    onClick={() => handleExportData('json', false)}
                    className="px-3 py-2 text-xs text-left text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl font-bold transition-all"
                  >
                    Backup JSON (Seguro)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 4. FILTROS AVANÇADOS */}
        {showFilters && (
          <div className="bg-black/60 border border-zinc-800/90 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4">
            {!isTypeLocked && (
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Tipo</label>
                <select
                  value={filterType}
                  onChange={e => {
                    setFilterType(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand"
                >
                  <option value="all">Todos os Tipos</option>
                  <option value="movie">Filmes</option>
                  <option value="tv">Séries</option>
                </select>
              </div>
            )}

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Publicação & Lixeira
              </label>
              <select
                value={filterPublishStatus}
                onChange={e => {
                  setFilterPublishStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand"
              >
                <option value="all">Ativos (Publicados + Rascunhos)</option>
                <option value="published">Apenas Publicados</option>
                <option value="unpublished">Apenas Rascunhos / Ocultos</option>
                <option value="deleted">Lixeira (Eliminados)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Estado da Fonte
              </label>
              <select
                value={filterSourceStatus}
                onChange={e => {
                  setFilterSourceStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand"
              >
                <option value="all">Todas as Fontes</option>
                <option value="WITH_SOURCE">Com Fonte Associada</option>
                <option value="WITHOUT_SOURCE">Sem Fonte Associada</option>
                <option value="ONLINE">Fonte Online / Ativa</option>
                <option value="OFFLINE">Fonte Offline / Inativa</option>
                <option value="REGISTERED">Fonte Registada (Não testada)</option>
                <option value="EMBED_BLOCKED">Embed Bloqueado</option>
                <option value="UNSUPPORTED">Formato Incompatível</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Diagnóstico
              </label>
              <select
                value={filterDiagnostic}
                onChange={e => {
                  setFilterDiagnostic(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand"
              >
                <option value="all">Todos os Diagnósticos</option>
                <option value="COMPLETE">Íntegro (Sem Alertas)</option>
                <option value="INCOMPLETE">Incompleto (Com Alertas)</option>
                <option value="NO_SOURCE">Sem Fonte de Vídeo</option>
                <option value="INVALID_SOURCE">Fonte Inválida / Offline</option>
                <option value="MISSING_POSTER">Sem Poster</option>
                <option value="MISSING_TMDB">Sem TMDB ID</option>
                <option value="DUPLICATE">Duplicados TMDB</option>
                <option value="IMPORT_ERROR">Com Erro de Importação</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Gênero</label>
              <select
                value={filterGenre}
                onChange={e => {
                  setFilterGenre(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand"
              >
                <option value="all">Todos os Gêneros</option>
                {genreOptions.map(g => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Ano ({filterYearFrom || 'Mín'} – {filterYearTo || 'Máx'})
              </label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  placeholder="De"
                  value={filterYearFrom}
                  onChange={e => {
                    setFilterYearFrom(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-brand"
                />
                <input
                  type="number"
                  placeholder="Até"
                  value={filterYearTo}
                  onChange={e => {
                    setFilterYearTo(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-brand"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Ordenação
              </label>
              <select
                value={sortOption}
                onChange={e => {
                  setSortOption(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand"
              >
                <option value="recent">Mais recentes</option>
                <option value="oldest">Mais antigos</option>
                <option value="rating_high">Melhor nota</option>
                <option value="rating_low">Menor nota</option>
                <option value="title_asc">Título (A–Z)</option>
                <option value="title_desc">Título (Z–A)</option>
                <option value="tmdb_id">TMDB ID</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={resetFilters}
                className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-bold transition-all border border-zinc-800"
              >
                Limpar Filtros
              </button>
            </div>
          </div>
        )}
      </div>

      {/* BULK ACTIONS BAR */}
      {selectedIds.length > 0 && (
        <div className="bg-gradient-to-r from-red-950 via-zinc-900 to-red-950 border border-red-800/80 rounded-2xl p-4 shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-7 h-7 rounded-full bg-brand text-white font-black text-xs flex items-center justify-center shrink-0 tabular-nums">
              {selectedIds.length}
            </span>
            <span className="text-xs font-bold text-white">
              {selectedIds.length === 1 ? '1 item selecionado' : `${selectedIds.length} itens selecionados`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
            {filterPublishStatus === 'deleted' ? (
              <button
                disabled={isBatchProcessing}
                onClick={() => handleBatchAction('restore')}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restaurar
              </button>
            ) : (
              <>
                <button
                  disabled={isBatchProcessing}
                  onClick={() => handleBatchAction('publish')}
                  className="px-3 py-2 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Globe className="w-3.5 h-3.5" /> Publicar
                </button>
                <button
                  disabled={isBatchProcessing}
                  onClick={() => handleBatchAction('unpublish')}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <EyeOff className="w-3.5 h-3.5" /> Despublicar
                </button>
              </>
            )}

            <button
              disabled={isBatchProcessing}
              onClick={() => handleBatchAction('sync')}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-zinc-700"
            >
              <RotateCw className="w-3.5 h-3.5 text-sky-400" /> Sincronizar TMDB
            </button>

            <button
              disabled={isBatchProcessing}
              onClick={() => handleExportData('csv', true)}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-zinc-700"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" /> CSV Seleção
            </button>

            <button
              disabled={isBatchProcessing}
              onClick={() => handleExportData('json', true)}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-zinc-700"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" /> JSON Seleção
            </button>

            <button
              disabled={isBatchProcessing}
              onClick={() => handleBatchAction('top10')}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-zinc-700"
            >
              <Flame className="w-3.5 h-3.5 text-orange-400" /> Top 10
            </button>

            <button
              disabled={isBatchProcessing}
              onClick={() => handleBatchAction('delete')}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg"
            >
              <Trash2 className="w-3.5 h-3.5" /> Eliminar
            </button>

            <button
              onClick={() => setSelectedIds([])}
              className="p-2 text-zinc-400 hover:text-white"
              title="Desmarcar todos"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTENT VIEW */}
      {loading ? (
        <div className="py-20 text-center space-y-4">
          <RefreshCw className="w-8 h-8 text-brand animate-spin mx-auto" />
          <p className="text-xs text-zinc-400 uppercase tracking-widest font-bold">
            A carregar {isSeriesCatalog ? 'séries' : isMovieCatalog ? 'filmes' : 'catálogo'} da base de dados...
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-[#0D0F15] border border-white/10 rounded-3xl p-12 text-center space-y-4">
          {isSeriesCatalog ? (
            <Tv className="w-12 h-12 text-zinc-600 mx-auto" />
          ) : (
            <Film className="w-12 h-12 text-zinc-600 mx-auto" />
          )}
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white uppercase tracking-wider">Nenhum conteúdo encontrado</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              Nenhum registo corresponde aos critérios atuais de pesquisa ou filtro. Existem {dbSectionTotal} registos
              nesta secção da base de dados.
            </p>
          </div>
          {activeFilterCount > 0 || debouncedSearch ? (
            <button
              onClick={resetFilters}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all"
            >
              Repor Pesquisa e Filtros
            </button>
          ) : null}
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-[#0D0F15] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
          {/* DESKTOP TABLE */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-black/60 border-b border-white/10 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                  <th className="p-3.5 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === items.length && items.length > 0}
                      onChange={e => handleSelectAll(e.target.checked)}
                      className="rounded border-zinc-700 text-brand focus:ring-0 bg-zinc-900"
                    />
                  </th>
                  <th className="p-3.5 w-16">CAPA</th>
                  <th className="p-3.5">CONTEÚDO & ID</th>
                  <th className="p-3.5 w-28">ANO / GÊNEROS</th>
                  {!isMovieCatalog && <th className="p-3.5 w-28">TEMPORADAS</th>}
                  <th className="p-3.5 w-28">TMDB / IMDb</th>
                  <th className="p-3.5 w-16">NOTA</th>
                  <th className="p-3.5 w-36">PUBLICAÇÃO</th>
                  <th className="p-3.5 w-40">FONTES</th>
                  <th className="p-3.5 w-28">IMPORTADO</th>
                  <th className="p-3.5 w-28 text-right">AÇÕES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {items.map(item => {
                  const isSelected = selectedIds.includes(item.id);
                  const isSeries = item.type === 'tv' || item.type === 'series';
                  const year = getMediaYear(item);
                  const seasonsCount = item.seasonsCount ?? item.numberOfSeasons ?? item.seasons?.length ?? 0;
                  const episodesCount = item.episodesCount ?? item.numberOfEpisodes ?? 0;

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-white/[0.03] transition-colors ${isSelected ? 'bg-red-950/20' : ''}`}
                    >
                      <td className="p-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          className="rounded border-zinc-700 text-brand focus:ring-0 bg-zinc-900"
                        />
                      </td>

                      <td className="p-3.5">
                        <PosterThumb
                          posterPath={item.posterPath}
                          title={item.title}
                          isSeries={isSeries}
                          badgeTopRight={
                            item.isTop10 ? (
                              <span className="absolute top-0 right-0 bg-orange-600 text-white text-[8px] font-black px-1 py-0.5 rounded-bl">
                                T10
                              </span>
                            ) : null
                          }
                        />
                      </td>

                      <td className="p-3.5 max-w-[260px]">
                        <div className="space-y-1">
                          <button
                            onClick={() => openDetailsModal(item)}
                            className="font-bold text-white hover:text-brand text-left transition-colors line-clamp-1 block text-xs"
                          >
                            {item.title}
                          </button>
                          {item.originalTitle && item.originalTitle !== item.title && (
                            <span className="text-[10px] text-zinc-500 line-clamp-1 block italic">
                              {item.originalTitle}
                            </span>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-mono text-zinc-500 bg-black/50 px-1.5 py-0.5 rounded border border-white/5">
                              {item.id}
                            </span>
                            {!isTypeLocked && (
                              <span
                                className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                  isSeries ? 'bg-purple-950/70 text-purple-300' : 'bg-red-950/70 text-red-300'
                                }`}
                              >
                                {isSeries ? 'Série' : 'Filme'}
                              </span>
                            )}
                            {renderDiagnosticPill(item)}
                          </div>
                        </div>
                      </td>

                      <td className="p-3.5">
                        <div className="space-y-1">
                          <span className="text-zinc-300 font-mono font-bold text-[11px] block tabular-nums">
                            {year}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {(item.genres || []).slice(0, 2).map((g, idx) => (
                              <span
                                key={idx}
                                className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[9px] text-zinc-400"
                              >
                                {g}
                              </span>
                            ))}
                            {(item.genres || []).length > 2 && (
                              <span className="text-[9px] text-zinc-500">+{(item.genres || []).length - 2}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {!isMovieCatalog && (
                        <td className="p-3.5 tabular-nums">
                          {isSeries ? (
                            <button
                              onClick={() => openDetailsModal(item)}
                              className="px-2.5 py-1 rounded-lg bg-purple-950/40 hover:bg-purple-900/50 border border-purple-800/60 text-purple-300 text-[10px] font-bold inline-flex items-center gap-1.5 transition-all"
                            >
                              <Layers className="w-3 h-3" />
                              <span>
                                {seasonsCount}T · {episodesCount}E
                              </span>
                            </button>
                          ) : (
                            <span className="text-zinc-600 text-[10px]">—</span>
                          )}
                        </td>
                      )}

                      <td className="p-3.5 font-mono text-[11px] tabular-nums">
                        <div className="space-y-0.5">
                          {item.tmdbId ? (
                            <button
                              onClick={() => handleCopyId(String(item.tmdbId), 'TMDB ID')}
                              className="text-zinc-300 hover:text-white flex items-center gap-1"
                              title="Copiar TMDB ID"
                            >
                              <span>{item.tmdbId}</span>
                              <Copy className="w-2.5 h-2.5 text-zinc-600" />
                            </button>
                          ) : (
                            <span className="text-red-400 text-[10px]">Sem TMDB</span>
                          )}
                          {item.imdbId && (
                            <button
                              onClick={() => handleCopyId(item.imdbId!, 'IMDb ID')}
                              className="text-zinc-500 hover:text-amber-400 text-[10px] block"
                            >
                              {item.imdbId}
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="p-3.5 tabular-nums">
                        <div className="flex items-center gap-1 text-amber-400 font-mono font-bold text-xs">
                          <Star className="w-3 h-3 fill-amber-400" />
                          <span>{item.voteAverage ? Number(item.voteAverage).toFixed(1) : '0.0'}</span>
                        </div>
                      </td>

                      <td className="p-3.5">{renderPublishBadge(item)}</td>

                      <td className="p-3.5">
                        <div className="space-y-1">
                          {renderSourceBadge(item)}
                          {onOpenSources && (
                            <button
                              onClick={() => onOpenSources(item)}
                              className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold block hover:underline"
                            >
                              Gerir Fontes →
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="p-3.5 text-zinc-400 font-mono text-[10px] tabular-nums">
                        {formatAdminDate(item.createdAt || item.updatedAt)}
                      </td>

                      <td className="p-3.5 text-right relative">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => openDetailsModal(item)}
                            className="p-1.5 hover:bg-zinc-800 rounded-lg text-sky-400 hover:text-white transition-colors"
                            title="Ver Detalhes"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingItem({ ...item, genresText: (item.genres || []).join(', ') })}
                            className="p-1.5 hover:bg-zinc-800 rounded-lg text-amber-400 hover:text-white transition-colors"
                            title="Editar"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setActiveMenuId(activeMenuId === item.id ? null : item.id)}
                            className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
                            title="Mais ações"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>

                        {activeMenuId === item.id && (
                          <div className="absolute right-4 top-12 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-1.5 z-40 w-52 text-left space-y-0.5">
                            <button
                              onClick={() => openDetailsModal(item)}
                              className="w-full px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl flex items-center gap-2"
                            >
                              <Eye className="w-3.5 h-3.5 text-sky-400" /> Ver Detalhes
                            </button>

                            <button
                              onClick={() => {
                                setEditingItem({ ...item, genresText: (item.genres || []).join(', ') });
                                setActiveMenuId(null);
                              }}
                              className="w-full px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl flex items-center gap-2"
                            >
                              <Edit className="w-3.5 h-3.5 text-amber-400" /> Editar Metadados
                            </button>

                            {onOpenSources && (
                              <button
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onOpenSources(item);
                                }}
                                className="w-full px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl flex items-center gap-2"
                              >
                                <Server className="w-3.5 h-3.5 text-emerald-400" /> Gerir Fontes de Vídeo
                              </button>
                            )}

                            {isSeries && (
                              <button
                                onClick={() => openDetailsModal(item, true)}
                                className="w-full px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl flex items-center gap-2"
                              >
                                <Layers className="w-3.5 h-3.5 text-purple-400" /> Temporadas & Episódios
                              </button>
                            )}

                            {!item.deletedAt && (
                              <button
                                onClick={() => handleTogglePublish(item)}
                                className="w-full px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl flex items-center gap-2"
                              >
                                {item.published === false || item.status === 'DRAFT' ? (
                                  <>
                                    <Globe className="w-3.5 h-3.5 text-emerald-400" /> Publicar
                                  </>
                                ) : (
                                  <>
                                    <EyeOff className="w-3.5 h-3.5 text-zinc-400" /> Mover para Rascunho
                                  </>
                                )}
                              </button>
                            )}

                            <button
                              onClick={() => handleSyncTmdb(item)}
                              className="w-full px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl flex items-center gap-2"
                            >
                              <RotateCw className="w-3.5 h-3.5 text-sky-400" /> Atualizar TMDB
                            </button>

                            <button
                              onClick={() => handleRunDiagnostics(item)}
                              className="w-full px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl flex items-center gap-2"
                            >
                              <Info className="w-3.5 h-3.5 text-indigo-400" /> Diagnóstico Completo
                            </button>

                            <button
                              onClick={() => handleToggleTop10(item)}
                              className="w-full px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl flex items-center gap-2"
                            >
                              <Flame className="w-3.5 h-3.5 text-orange-400" />{' '}
                              {item.isTop10 ? 'Remover do Top 10' : 'Adicionar ao Top 10'}
                            </button>

                            <div className="border-t border-zinc-800 my-1" />

                            {item.deletedAt ? (
                              <button
                                onClick={() => handleRestoreItem(item)}
                                className="w-full px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-950/60 rounded-xl flex items-center gap-2"
                              >
                                <RotateCcw className="w-3.5 h-3.5" /> Restaurar para Catálogo
                              </button>
                            ) : null}

                            <button
                              onClick={() => {
                                setDeleteModalItem(item);
                                setDeletePermanent(Boolean(item.deletedAt));
                                setActiveMenuId(null);
                              }}
                              className="w-full px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-950/60 rounded-xl flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" />{' '}
                              {item.deletedAt ? 'Eliminar Definitivamente' : 'Mover para Lixeira'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* MOBILE / TABLET LIST */}
          <div className="block lg:hidden divide-y divide-white/5">
            {items.map(item => {
              const isSelected = selectedIds.includes(item.id);
              const isSeries = item.type === 'tv' || item.type === 'series';
              const year = getMediaYear(item);

              return (
                <div
                  key={item.id}
                  className={`p-4 flex items-start gap-3 hover:bg-white/[0.02] transition-all ${
                    isSelected ? 'bg-red-950/15' : ''
                  }`}
                >
                  <div className="pt-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(item.id)}
                      className="rounded border-zinc-700 text-brand focus:ring-0 bg-zinc-900"
                    />
                  </div>

                  <PosterThumb posterPath={item.posterPath} title={item.title} isSeries={isSeries} sizeClass="w-14 h-20" />

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <button
                      onClick={() => openDetailsModal(item)}
                      className="font-bold text-white text-sm hover:text-brand text-left block truncate w-full"
                    >
                      {item.title}
                    </button>
                    <p className="text-[10px] text-zinc-400 font-mono">
                      {isSeries ? 'Série' : 'Filme'} · {year} · TMDB {item.tmdbId || '—'} · ★{' '}
                      {item.voteAverage ? Number(item.voteAverage).toFixed(1) : '0.0'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {renderPublishBadge(item)}
                      {renderSourceBadge(item)}
                    </div>
                    {renderDiagnosticPill(item)}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => openDetailsModal(item)}
                      className="p-2 bg-zinc-900 border border-zinc-800 text-sky-400 rounded-lg"
                      title="Ver Detalhes"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    {onOpenSources && (
                      <button
                        onClick={() => onOpenSources(item)}
                        className="p-2 bg-zinc-900 border border-zinc-800 text-emerald-400 rounded-lg"
                        title="Gerir Fontes"
                      >
                        <Server className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteModalItem(item)}
                      className="p-2 bg-zinc-900 border border-zinc-800 text-red-400 rounded-lg"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* GRID VIEW */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {items.map(item => {
            const isSelected = selectedIds.includes(item.id);
            const isSeries = item.type === 'tv' || item.type === 'series';
            const year = getMediaYear(item);
            const posterUrl = resolveTmdbPosterUrl(item.posterPath, 'w342');

            return (
              <div
                key={item.id}
                className={`bg-[#0D0F15] border rounded-2xl overflow-hidden shadow-xl flex flex-col justify-between transition-all hover:border-zinc-700 ${
                  isSelected ? 'border-brand bg-red-950/10' : 'border-white/10'
                }`}
              >
                <div className="relative aspect-[2/3] bg-zinc-950 overflow-hidden group">
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-700">
                      {isSeries ? <Tv className="w-8 h-8" /> : <Film className="w-8 h-8" />}
                    </div>
                  )}

                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelect(item.id)}
                    className="absolute top-2 left-2 rounded border-zinc-700 text-brand focus:ring-0 bg-zinc-900/90 z-10"
                  />

                  <div className="absolute top-2 right-2">{renderPublishBadge(item)}</div>

                  <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center text-[10px] font-mono text-white bg-black/75 backdrop-blur-md px-2 py-1 rounded-lg tabular-nums">
                    <span className="flex items-center gap-1 text-amber-400 font-bold">
                      <Star className="w-3 h-3 fill-amber-400" />
                      {item.voteAverage ? Number(item.voteAverage).toFixed(1) : '0.0'}
                    </span>
                    <span>{year}</span>
                  </div>
                </div>

                <div className="p-3 space-y-2 flex-1 flex flex-col justify-between">
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono text-zinc-500 block">TMDB {item.tmdbId || '—'}</span>
                    <h4 className="font-bold text-white text-xs line-clamp-1" title={item.title}>
                      {item.title}
                    </h4>
                    <div className="pt-0.5">{renderSourceBadge(item)}</div>
                  </div>

                  <div className="flex gap-1.5 pt-2 border-t border-white/5">
                    <button
                      onClick={() => openDetailsModal(item)}
                      className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1"
                    >
                      <Eye className="w-3 h-3 text-sky-400" /> Ver
                    </button>
                    {onOpenSources && (
                      <button
                        onClick={() => onOpenSources(item)}
                        className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 rounded-lg transition-all"
                        title="Gerir Fontes"
                      >
                        <Server className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteModalItem(item)}
                      className="p-1.5 bg-zinc-800 hover:bg-red-950 text-red-400 rounded-lg transition-all"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PAGINAÇÃO */}
      <div className="bg-[#0D0F15] border border-white/10 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 tabular-nums">
        <div className="text-xs text-zinc-400 font-mono">
          Exibindo{' '}
          <span className="font-bold text-white">
            {totalCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}–
            {Math.min(currentPage * itemsPerPage, totalCount)}
          </span>{' '}
          de <span className="font-bold text-white">{totalCount.toLocaleString('pt-PT')}</span> registos filtrados
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span>Por página:</span>
            <select
              value={itemsPerPage}
              onChange={e => {
                setItemsPerPage(parseInt(e.target.value, 10));
                setCurrentPage(1);
              }}
              className="bg-black border border-zinc-800 rounded-xl px-2.5 py-1 text-xs text-white focus:outline-none"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="p-2 bg-black border border-zinc-800 rounded-xl text-zinc-300 disabled:opacity-30 hover:bg-zinc-800 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 bg-black border border-zinc-800 rounded-xl text-xs font-mono font-bold text-white">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage >= totalPages}
              className="p-2 bg-black border border-zinc-800 rounded-xl text-zinc-300 disabled:opacity-30 hover:bg-zinc-800 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* MODAL DE DETALHES + INSPETOR DE SÉRIES / EPISÓDIOS & FONTES */}
      {detailsModalOpen && detailsItem && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl relative my-auto max-h-[92vh] flex flex-col">
            <button
              onClick={() => setDetailsModalOpen(false)}
              className="absolute top-4 right-4 z-20 p-2 bg-black/70 text-white hover:bg-red-600 rounded-full transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="overflow-y-auto flex-1">
              {/* BACKDROP HEADER */}
              <div className="relative h-56 bg-zinc-950 overflow-hidden">
                {resolveTmdbPosterUrl(detailsItem.backdropPath, 'w1280') ? (
                  <img
                    src={resolveTmdbPosterUrl(detailsItem.backdropPath, 'w1280')}
                    alt={detailsItem.title}
                    className="w-full h-full object-cover opacity-60"
                  />
                ) : (
                  <div className="w-full h-full bg-zinc-950" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/50 to-transparent" />

                <div className="absolute bottom-4 left-6 right-6 flex items-end gap-4">
                  <PosterThumb
                    posterPath={detailsItem.posterPath}
                    title={detailsItem.title}
                    isSeries={detailsItem.type === 'tv' || detailsItem.type === 'series'}
                    sizeClass="w-24 h-36 shadow-2xl border-2 border-zinc-800"
                  />
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase bg-brand text-white">
                        {detailsItem.type === 'tv' || detailsItem.type === 'series' ? 'Série' : 'Filme'}
                      </span>
                      {renderPublishBadge(detailsItem)}
                      {renderSourceBadge(detailsItem)}
                    </div>
                    <h3 className="text-xl sm:text-2xl font-black text-white truncate">{detailsItem.title}</h3>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-300 font-mono">
                      <span className="text-amber-400 font-bold flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 fill-amber-400" />
                        {detailsItem.voteAverage ? Number(detailsItem.voteAverage).toFixed(1) : '0.0'}
                      </span>
                      <span>{getMediaYear(detailsItem)}</span>
                      <span>TMDB: {detailsItem.tmdbId || '—'}</span>
                      <span>ID: {detailsItem.id}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* BODY */}
              <div className="p-6 space-y-6 text-xs">
                {detailsLoading && (
                  <div className="p-4 rounded-2xl bg-black/50 border border-white/5 flex items-center gap-3 text-zinc-400">
                    <RefreshCw className="w-4 h-4 animate-spin text-brand" />
                    <span>A carregar detalhes completos, fontes e episódios...</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 space-y-2">
                    <h4 className="font-bold text-zinc-400 uppercase tracking-wider text-[10px]">Sinopse</h4>
                    <p className="text-zinc-300 leading-relaxed">
                      {detailsItem.overview || 'Sem sinopse disponível.'}
                    </p>
                  </div>
                  <div className="space-y-2 bg-black/40 p-4 rounded-2xl border border-white/5">
                    <h4 className="font-bold text-zinc-400 uppercase tracking-wider text-[10px]">Gêneros & Registo</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(detailsItem.genres || []).length > 0 ? (
                        detailsItem.genres!.map((g, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-zinc-800 text-zinc-200 rounded-md text-[10px]">
                            {g}
                          </span>
                        ))
                      ) : (
                        <span className="text-zinc-500">Sem gêneros</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 font-mono pt-1">
                      Importado: {formatAdminDate(detailsItem.createdAt)}
                    </p>
                  </div>
                </div>

                {/* FONTES ASSOCIADAS */}
                <div className="space-y-3 bg-black/40 p-4 rounded-2xl border border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-bold text-white uppercase tracking-wider text-xs flex items-center gap-2">
                      <Server className="w-4 h-4 text-emerald-400" />
                      Fontes Associadas ({detailsSources.length})
                    </h4>
                    {onOpenSources && (
                      <button
                        onClick={() => {
                          setDetailsModalOpen(false);
                          onOpenSources(detailsItem);
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> Gerir / Adicionar Fonte
                      </button>
                    )}
                  </div>
                  {detailsSources.length === 0 ? (
                    <p className="text-zinc-500 text-xs">
                      Nenhuma fonte de vídeo associada até ao momento.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {detailsSources.map(src => (
                        <div
                          key={src.id}
                          className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">
                              {src.provider || 'Servidor'} · {String(src.format || '').toUpperCase()}
                              {src.season ? ` · T${src.season}:E${src.episode}` : ''}
                            </p>
                            <p className="text-[10px] text-zinc-500 font-mono truncate">{src.url}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-700 text-[10px] font-mono text-zinc-300 shrink-0">
                            {src.status || 'registered'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* TEMPORADAS & EPISÓDIOS (PARA SÉRIES) */}
                {(detailsItem.type === 'tv' || detailsItem.type === 'series') && (
                  <div className="space-y-4 bg-black/40 p-4 rounded-2xl border border-purple-500/20">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h4 className="font-bold text-white uppercase tracking-wider text-xs flex items-center gap-2">
                        <Layers className="w-4 h-4 text-purple-400" />
                        Temporadas & Episódios ({(detailsItem.seasons || []).length} temporadas)
                      </h4>
                      <button
                        onClick={() => openDetailsModal(detailsItem, true, selectedSeasonNum)}
                        disabled={detailsLoading}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <RotateCw className={`w-3.5 h-3.5 ${detailsLoading ? 'animate-spin' : ''}`} />
                        Sincronizar Episódios da Temporada {selectedSeasonNum}
                      </button>
                    </div>

                    {detailsItem.seasons && detailsItem.seasons.length > 0 ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {(detailsItem.seasons as SeasonWithSources[]).map(s => (
                            <button
                              key={s.seasonNumber}
                              onClick={() => setSelectedSeasonNum(s.seasonNumber)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                                selectedSeasonNum === s.seasonNumber
                                  ? 'bg-purple-600 border-purple-500 text-white'
                                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                              }`}
                            >
                              {s.name || `T${s.seasonNumber}`} ({s.episodes?.length || s.episodeCount || 0})
                            </button>
                          ))}
                        </div>

                        {(() => {
                          const currentSeason = (detailsItem.seasons as SeasonWithSources[]).find(
                            s => s.seasonNumber === selectedSeasonNum
                          );
                          const episodes = currentSeason?.episodes || [];
                          if (!currentSeason) return null;

                          if (episodes.length === 0) {
                            return (
                              <div className="p-6 text-center bg-zinc-950 rounded-2xl border border-zinc-800 space-y-3">
                                <p className="text-zinc-400 text-xs">
                                  Episódios desta temporada ainda não foram hidratados localmente ({currentSeason.episodeCount || 0} previstos no TMDB).
                                </p>
                                <button
                                  onClick={() => handleSyncSeasonEpisodes(currentSeason.seasonNumber)}
                                  disabled={syncingSeasonNum === currentSeason.seasonNumber}
                                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                                >
                                  <RotateCw
                                    className={`w-3.5 h-3.5 ${
                                      syncingSeasonNum === currentSeason.seasonNumber ? 'animate-spin' : ''
                                    }`}
                                  />
                                  Carregar Episódios do TMDB
                                </button>
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                              {episodes.map(ep => (
                                <div
                                  key={`${currentSeason.seasonNumber}-${ep.episodeNumber}`}
                                  className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between gap-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 font-mono text-[10px] font-bold">
                                        E{String(ep.episodeNumber).padStart(2, '0')}
                                      </span>
                                      <p className="font-bold text-white truncate">{ep.title}</p>
                                    </div>
                                    <p className="text-[10px] text-zinc-500 mt-0.5">
                                      {ep.duration ? `${ep.duration} min · ` : ''}
                                      {ep.airDate || 'Sem data'}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                        (ep.sourcesCount || 0) > 0
                                          ? 'bg-emerald-950/70 text-emerald-400 border-emerald-800'
                                          : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                                      }`}
                                    >
                                      {(ep.sourcesCount || 0) > 0
                                        ? `${ep.sourcesCount} fonte(s) · ${ep.sourceStatus || 'OK'}`
                                        : 'Sem fonte'}
                                    </span>
                                    {onOpenSources && (
                                      <button
                                        onClick={() => {
                                          setDetailsModalOpen(false);
                                          onOpenSources(detailsItem, currentSeason.seasonNumber, ep.episodeNumber);
                                        }}
                                        className="px-2.5 py-1 bg-zinc-800 hover:bg-brand text-white rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all"
                                      >
                                        <Play className="w-3 h-3" /> Fonte
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      <p className="text-zinc-500 text-xs">
                        Nenhuma temporada registada localmente. Clique em sincronizar para obter do TMDB.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => handleTogglePublish(detailsItem)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5"
              >
                {detailsItem.published === false ? <Globe className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {detailsItem.published === false ? 'Publicar' : 'Despublicar'}
              </button>
              <button
                onClick={() => {
                  setEditingItem({ ...detailsItem, genresText: (detailsItem.genres || []).join(', ') });
                  setDetailsModalOpen(false);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5"
              >
                <Edit className="w-3.5 h-3.5" /> Editar
              </button>
              <button
                onClick={() => setDetailsModalOpen(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-xs"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <h3 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Edit className="w-5 h-5 text-amber-400" />
                Editar: {editingItem.title}
              </h3>
              <button
                onClick={() => setEditingItem(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    Título
                  </label>
                  <input
                    type="text"
                    value={editingItem.title}
                    onChange={e => setEditingItem({ ...editingItem, title: e.target.value })}
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    Título Original
                  </label>
                  <input
                    type="text"
                    value={editingItem.originalTitle || ''}
                    onChange={e => setEditingItem({ ...editingItem, originalTitle: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    TMDB ID
                  </label>
                  <input
                    type="number"
                    value={editingItem.tmdbId || 0}
                    onChange={e => setEditingItem({ ...editingItem, tmdbId: parseInt(e.target.value, 10) || 0 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    IMDb ID
                  </label>
                  <input
                    type="text"
                    value={editingItem.imdbId || ''}
                    onChange={e => setEditingItem({ ...editingItem, imdbId: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    Ano de Lançamento
                  </label>
                  <input
                    type="number"
                    value={editingItem.releaseYear || (getMediaYear(editingItem) !== '—' ? Number(getMediaYear(editingItem)) : '')}
                    onChange={e =>
                      setEditingItem({
                        ...editingItem,
                        releaseYear: parseInt(e.target.value, 10) || undefined
                      })
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    Nota (0–10)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={editingItem.voteAverage ?? 0}
                    onChange={e => setEditingItem({ ...editingItem, voteAverage: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Gêneros (separados por vírgula)
                </label>
                <input
                  type="text"
                  value={editingItem.genresText ?? (editingItem.genres || []).join(', ')}
                  onChange={e => setEditingItem({ ...editingItem, genresText: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    Poster (URL ou Path TMDB)
                  </label>
                  <input
                    type="text"
                    value={editingItem.posterPath || ''}
                    onChange={e => setEditingItem({ ...editingItem, posterPath: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    Publicação
                  </label>
                  <select
                    value={editingItem.published === false || editingItem.status === 'DRAFT' ? 'draft' : 'published'}
                    onChange={e => {
                      const pub = e.target.value === 'published';
                      setEditingItem({
                        ...editingItem,
                        published: pub,
                        status: pub ? 'ACTIVE' : 'DRAFT'
                      });
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-brand"
                  >
                    <option value="published">Publicado</option>
                    <option value="draft">Rascunho (Não publicado)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Sinopse
                </label>
                <textarea
                  rows={4}
                  value={editingItem.overview || ''}
                  onChange={e => setEditingItem({ ...editingItem, overview: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-white focus:outline-none focus:border-brand"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-brand hover:bg-brand/90 text-white font-bold rounded-xl shadow-lg"
                >
                  Guardar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE DIAGNÓSTICO INDIVIDUAL */}
      {diagnosticItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Info className="w-5 h-5 text-indigo-400" /> Diagnóstico de Integridade
              </h3>
              <button onClick={() => setDiagnosticItem(null)} className="p-1.5 text-zinc-400 hover:text-white rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 bg-zinc-950 p-3 rounded-2xl border border-zinc-800">
              <PosterThumb
                posterPath={diagnosticItem.item?.posterPath}
                title={diagnosticItem.item?.title || ''}
                isSeries={diagnosticItem.item?.type === 'tv'}
                sizeClass="w-12 h-16"
              />
              <div className="min-w-0">
                <h4 className="font-bold text-white text-sm truncate">{diagnosticItem.item?.title}</h4>
                <span className="text-xs text-zinc-500 font-mono">
                  TMDB: {diagnosticItem.item?.tmdbId || '—'} · ID: {diagnosticItem.item?.id}
                </span>
              </div>
            </div>

            <div
              className={`p-4 rounded-2xl border ${
                diagnosticItem.isOk
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-800 text-amber-300'
              }`}
            >
              <span className="font-bold text-xs flex items-center gap-2">
                {diagnosticItem.isOk ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Conteúdo 100% íntegro!
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-400" /> {diagnosticItem.issuesCount} alerta(s)
                    detetado(s)
                  </>
                )}
              </span>
              {!diagnosticItem.isOk && Array.isArray(diagnosticItem.issues) && (
                <ul className="mt-2 text-xs space-y-1 list-disc list-inside text-amber-200">
                  {diagnosticItem.issues.map((issue: string, idx: number) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5 text-xs font-mono max-h-52 overflow-y-auto">
              {Object.entries(diagnosticItem.checks || {}).map(([key, val]) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-2 bg-zinc-950 rounded-xl border border-zinc-800/60"
                >
                  <span className="uppercase text-[10px] text-zinc-400">{key}</span>
                  <span className={val ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {val ? '✓ Válido' : '✗ Ausente'}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setDiagnosticItem(null)}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider"
            >
              Fechar Diagnóstico
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE ELIMINAÇÃO INDIVIDUAL */}
      {deleteModalItem && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-red-800/80 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3 text-red-500">
              <div className="p-3 bg-red-950/80 rounded-2xl border border-red-800">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Confirmar Eliminação</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {deleteModalItem.deletedAt
                    ? 'Este registo já está na lixeira e será apagado permanentemente.'
                    : 'Por padrão o item vai para a Lixeira e pode ser restaurado.'}
                </p>
              </div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3">
              <PosterThumb
                posterPath={deleteModalItem.posterPath}
                title={deleteModalItem.title}
                isSeries={deleteModalItem.type === 'tv' || deleteModalItem.type === 'series'}
                sizeClass="w-12 h-16"
              />
              <div className="min-w-0">
                <h4 className="font-bold text-white text-sm truncate">{deleteModalItem.title}</h4>
                <div className="text-xs text-zinc-500 font-mono mt-0.5">
                  <span>{deleteModalItem.type === 'tv' ? 'Série' : 'Filme'}</span> ·{' '}
                  <span>TMDB {deleteModalItem.tmdbId || '—'}</span>
                </div>
              </div>
            </div>

            {!deleteModalItem.deletedAt && (
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deletePermanent}
                  onChange={e => setDeletePermanent(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-red-600"
                />
                <span>Eliminar permanentemente (irreversível)</span>
              </label>
            )}

            <div className="flex gap-3">
              <button
                disabled={isDeleting}
                onClick={() => {
                  setDeleteModalItem(null);
                  setDeletePermanent(false);
                }}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl"
              >
                Cancelar
              </button>
              <button
                disabled={isDeleting}
                onClick={handleDeleteItem}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> A eliminar...
                  </>
                ) : deletePermanent || deleteModalItem.deletedAt ? (
                  'Eliminar Definitivamente'
                ) : (
                  'Mover para Lixeira'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ELIMINAÇÃO EM MASSA */}
      {showBatchDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-red-800/80 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3 text-red-500">
              <div className="p-3 bg-red-950/80 rounded-2xl border border-red-800">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Eliminar em Massa?</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Selecionados: <span className="font-bold text-white">{selectedIds.length}</span> conteúdos.
                </p>
              </div>
            </div>

            {filterPublishStatus !== 'deleted' && (
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deletePermanent}
                  onChange={e => setDeletePermanent(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-red-600"
                />
                <span>Eliminar permanentemente (sem ir para a Lixeira)</span>
              </label>
            )}

            <div className="flex gap-3">
              <button
                disabled={isBatchProcessing}
                onClick={() => {
                  setShowBatchDeleteModal(false);
                  setDeletePermanent(false);
                }}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl"
              >
                Cancelar
              </button>
              <button
                disabled={isBatchProcessing}
                onClick={handleConfirmBatchDelete}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isBatchProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> A processar...
                  </>
                ) : (
                  `Confirmar (${selectedIds.length})`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
