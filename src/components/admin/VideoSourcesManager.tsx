import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Plus,
  Search,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Server,
  Zap,
  Play,
  X,
  Languages,
  Layers,
  HelpCircle,
  Key,
  Check,
  Globe,
  ExternalLink,
  Film,
  AlertTriangle,
  ShieldCheck,
  Star,
  FileCode,
  Power,
  Tv,
  ChevronDown,
  ChevronRight,
  FolderTree,
  List,
  Subtitles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../lib/api.js';
import { VideoSource, MediaItem, TmdbSearchResult } from '../../types.js';
import {
  classifySourceUrl,
  getSourceKindLabel,
  getStatusDisplayInfo
} from '../../lib/sourceClassification.js';
import { RonycinePlayer } from '../player/RonycinePlayer.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';
import { MgebUrlField } from './MgebUrlField.js';
import { EpisodeGenerator } from './EpisodeGenerator.js';
import { MovieSourcePanel } from './MovieSourcePanel.js';
import { PlaybackVersionsManager } from './PlaybackVersionsManager.js';
import { buildMgebUrl, stripMgebPrefix } from '../../lib/mgebUtils.js';
import {
  AUDIO_LANGUAGE_OPTIONS,
  SOURCE_QUALITY_OPTIONS,
  VERSION_TYPE_OPTIONS,
  formatSourceOrganizedLabel,
  formatVersionTypeLabel,
  isPresetAudioLanguage,
  normalizeVersionType
} from '../../lib/sourceMetadata.js';

export interface PreselectedSourceMedia {
  contentId: number;
  contentType: 'movie' | 'tv';
  title?: string;
  posterPath?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  autoOpenModal?: boolean;
}

interface VideoSourcesManagerProps {
  preselectedMedia?: PreselectedSourceMedia | null;
  onClearPreselected?: () => void;
}

export const VideoSourcesManager: React.FC<VideoSourcesManagerProps> = ({
  preselectedMedia,
  onClearPreselected
}) => {
  const [activeTab, setActiveTab] = useState<'sources' | 'add_movie' | 'episode_generator' | 'providers'>('sources');

  // Sources State
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [currentSource, setCurrentSource] = useState<
    (Partial<VideoSource> & { selectedTitle?: string; selectedPoster?: string }) | null
  >(null);
  const [modalUseMgebPrefix, setModalUseMgebPrefix] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'tv'>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [catalogItems, setCatalogItems] = useState<MediaItem[]>([]);
  const [viewMode, setViewMode] = useState<'organized' | 'table'>('organized');
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});
  const [expandedSeasons, setExpandedSeasons] = useState<Record<string, boolean>>({});
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // Diagnostic & Play Test Modals
  const [diagnosticSource, setDiagnosticSource] = useState<VideoSource | null>(null);
  const [playTestSource, setPlayTestSource] = useState<VideoSource | null>(null);
  const [playTestDiag, setPlayTestDiag] = useState<{
    status: 'playing' | 'confirmed' | 'format_error' | 'connection_error';
    message: string;
  }>({ status: 'playing', message: 'A inicializar reprodução de teste...' });
  const [modalTestingLink, setModalTestingLink] = useState(false);
  const [modalTestMessage, setModalTestMessage] = useState<string | null>(null);

  const openPlayTest = (src: VideoSource) => {
    setPlayTestDiag({ status: 'playing', message: 'A inicializar reprodução de teste...' });
    setPlayTestSource(src);
  };

  // Modal TMDB Search State
  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbSearchType, setTmdbSearchType] = useState<'all' | 'movie' | 'tv'>('all');
  const [tmdbResults, setTmdbResults] = useState<TmdbSearchResult[]>([]);
  const [isSearchingTmdb, setIsSearchingTmdb] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form Save Feedback State
  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<VideoSource | null>(null);

  // Provider Config State
  const [uqloadApiKey, setUqloadApiKey] = useState<string>('');
  const [anonmp4ApiKey, setAnonmp4ApiKey] = useState<string>('');
  const [savingKeys, setSavingKeys] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; details?: any } | null>(null);
  const [testingKey, setTestingKey] = useState<boolean>(false);

  useEffect(() => {
    loadData();
    loadProviderConfig();
  }, []);

  useEffect(() => {
    if (preselectedMedia) {
      setActiveTab('sources');
      setFilterType(preselectedMedia.contentType);
      setSearchTerm(String(preselectedMedia.contentId));
      if (preselectedMedia.autoOpenModal) {
        setModalUseMgebPrefix(true);
        setCurrentSource({
          contentId: preselectedMedia.contentId,
          contentType: preselectedMedia.contentType,
          seasonNumber: preselectedMedia.contentType === 'tv' ? (preselectedMedia.seasonNumber ?? 1) : undefined,
          episodeNumber: preselectedMedia.contentType === 'tv' ? (preselectedMedia.episodeNumber ?? 1) : undefined,
          selectedTitle: preselectedMedia.title,
          selectedPoster: preselectedMedia.posterPath,
          audioLanguage: 'Português',
          versionType: 'dublado',
          subtitleUrl: '',
          subtitleLanguage: '',
          quality: '1080p',
          status: 'registered',
          format: 'php_endpoint',
          isPrimary: false,
          priority: 1,
          enabled: true,
          serverName: 'MGEB Endpoint'
        });
        setModalTestMessage(null);
        setSavingStatus('idle');
        setErrorMessage(null);
        setShowModal(true);
      }
    }
  }, [preselectedMedia]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sourcesRes, catalogRes] = await Promise.all([
        api.getVideoSources(),
        api.getCatalog({ limit: 100000 })
      ]);
      setSources(Array.isArray(sourcesRes) ? sourcesRes : []);
      setCatalogItems(catalogRes.items || []);
    } catch (err) {
      console.error('Failed to load sources data:', err);
      setSources([]);
    } finally {
      setLoading(false);
    }
  };

  const loadProviderConfig = async () => {
    try {
      const provRes = await api.getProviderConfig().catch(() => null);
      if (provRes?.success && provRes.data) {
        if (provRes.data.uqloadApiKeyMasked) {
          setUqloadApiKey('');
        }
      }
    } catch (err) {
      console.warn('Failed to load provider config:', err);
    }
  };

  // TMDB Search handler inside modal
  const handleSearchTmdb = async (queryToSearch?: string) => {
    const q = queryToSearch !== undefined ? queryToSearch : tmdbQuery;
    if (!q.trim()) {
      setTmdbResults([]);
      return;
    }
    setIsSearchingTmdb(true);
    try {
      const res = await api.searchTmdb(q, tmdbSearchType);
      setTmdbResults(res.results || []);
    } catch (err) {
      console.error('TMDB search failed:', err);
      setTmdbResults([]);
    } finally {
      setIsSearchingTmdb(false);
    }
  };

  const handleTmdbInputChange = (val: string) => {
    setTmdbQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      handleSearchTmdb(val);
    }, 400);
  };

  const handleSelectTmdbItem = (item: TmdbSearchResult) => {
    setCurrentSource(prev => ({
      ...prev,
      contentId: item.tmdbId,
      contentType: item.type,
      selectedTitle: item.title,
      selectedPoster: item.posterPath,
      serverName: prev?.serverName || 'Servidor Principal',
      format: prev?.format || 'embed',
      audioLanguage: prev?.audioLanguage || 'Português',
      versionType: prev?.versionType || 'dublado',
      subtitleUrl: prev?.subtitleUrl || '',
      subtitleLanguage: prev?.subtitleLanguage || '',
      quality: prev?.quality || '1080p',
      status: prev?.status || 'registered'
    }));
    setTmdbResults([]);
    setTmdbQuery('');
  };

  // URL paste classification (NEVER strip outer URL or ?url= parameter!)
  const handleUrlChange = (rawUrl: string) => {
    setDuplicateConflict(null);
    setErrorMessage(null);
    if (savingStatus === 'error') setSavingStatus('idle');
    const classified = classifySourceUrl(rawUrl);
    const currentName = currentSource?.serverName || '';
    const shouldAutoName =
      !currentName ||
      currentName === 'UQLOAD' ||
      currentName === 'AnonMP4' ||
      currentName === 'MGEB Endpoint' ||
      currentName === 'Endpoint PHP' ||
      currentName === 'Servidor Principal';

    setCurrentSource(prev => ({
      ...prev,
      url: rawUrl,
      originalUrl: rawUrl,
      sourceKind: classified.valid ? classified.sourceKind : prev?.sourceKind,
      format: (classified.valid ? classified.suggestedFormat : prev?.format || 'php_endpoint') as any,
      serverName:
        shouldAutoName && classified.suggestedServerName
          ? classified.suggestedServerName
          : currentName || 'MGEB Endpoint',
      diagnostics: classified.valid ? classified.diagnostics : prev?.diagnostics
    }));
  };

  const handleModalTestSource = async () => {
    const targetUrl = (currentSource?.originalUrl || currentSource?.url || '').trim();
    if (!targetUrl) {
      setErrorMessage('Informe uma URL para testar.');
      return;
    }
    setModalTestingLink(true);
    setModalTestMessage(null);
    setErrorMessage(null);

    try {
      const res = await api.verifySourceLink(targetUrl, currentSource?.format);
      setCurrentSource(prev => ({
        ...prev,
        url: targetUrl,
        originalUrl: targetUrl,
        sourceKind: res.sourceKind,
        format: (res.detectedFormat || prev?.format) as any,
        status: res.status,
        verificationResult: res.message,
        lastVerifiedAt: res.diagnostics?.testedAt || new Date().toISOString(),
        diagnostics: res.diagnostics
      }));
      setModalTestMessage(res.message);
    } catch (err: any) {
      setModalTestMessage(err?.message || 'Não foi possível validar a fonte.');
    } finally {
      setModalTestingLink(false);
    }
  };

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKeys(true);
    try {
      const res = await api.updateProviderConfig({
        uqloadApiKey: uqloadApiKey || undefined,
        anonmp4ApiKey: anonmp4ApiKey || undefined
      });
      if (res.success) {
        setTestResult({ success: true, message: 'Chaves de provedores guardadas com sucesso!' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: `Erro ao salvar chaves: ${err.message}` });
    } finally {
      setSavingKeys(false);
    }
  };

  const handleTestUqload = async () => {
    setTestingKey(true);
    setTestResult(null);
    try {
      const res = await api.testUqloadKey(uqloadApiKey || undefined);
      if (res.success) {
        setTestResult({
          success: true,
          message: res.message || 'Conexão com API UQLOAD realizada com sucesso!',
          details: res.accountInfo
        });
      } else {
        setTestResult({
          success: false,
          message: res.error || 'Falha de autenticação com UQLOAD.'
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: `Erro no teste: ${err.message}` });
    } finally {
      setTestingKey(false);
    }
  };

  const performSaveSource = async (replaceExisting = false) => {
    if (!currentSource) return;

    if (!currentSource.contentId) {
      setErrorMessage('Selecione ou informe um TMDB ID válido.');
      setSavingStatus('error');
      return;
    }
    if (!currentSource.url?.trim()) {
      setErrorMessage('A URL da fonte de vídeo é obrigatória.');
      setSavingStatus('error');
      return;
    }
    if (!currentSource.serverName?.trim()) {
      setErrorMessage('O nome do servidor é obrigatório.');
      setSavingStatus('error');
      return;
    }

    const evaluated = buildMgebUrl(currentSource.url, modalUseMgebPrefix);
    const finalSourceUrl = evaluated.valid ? evaluated.finalUrl : currentSource.url.trim();
    const classified = classifySourceUrl(finalSourceUrl);
    if (!classified.valid) {
      setErrorMessage(classified.error || evaluated.error || 'URL inválida.');
      setSavingStatus('error');
      return;
    }

    setSavingStatus('saving');
    setErrorMessage(null);
    setDuplicateConflict(null);

    const payload: Partial<VideoSource> & { replaceExisting?: boolean } = {
      ...currentSource,
      url: classified.originalUrl,
      originalUrl: classified.originalUrl,
      sourceKind: currentSource.sourceKind || classified.sourceKind,
      format: currentSource.format || classified.suggestedFormat,
      audioLanguage: currentSource.audioLanguage?.trim() || 'Português',
      versionType: currentSource.versionType || 'dublado',
      subtitleUrl: currentSource.subtitleUrl?.trim() ? currentSource.subtitleUrl.trim() : currentSource.id ? '' : undefined,
      subtitleLanguage: currentSource.subtitleLanguage?.trim() ? currentSource.subtitleLanguage.trim() : currentSource.id ? '' : undefined,
      status: currentSource.status || 'registered',
      diagnostics: currentSource.diagnostics || classified.diagnostics,
      ...(replaceExisting ? { replaceExisting: true } : {})
    };

    try {
      if (currentSource.id) {
        await api.updateVideoSource(currentSource.id, payload);
      } else {
        await api.addVideoSource(payload as any);
      }

      setSavingStatus('success');
      setTimeout(() => {
        setShowModal(false);
        setCurrentSource(null);
        setModalTestMessage(null);
        setDuplicateConflict(null);
        setSavingStatus('idle');
        loadData();
      }, 900);
    } catch (err: any) {
      const isDuplicate =
        err?.code === 'DUPLICATE_SOURCE' ||
        err?.status === 409 ||
        String(err?.message || '').includes('Já existe uma fonte igual');
      if (isDuplicate) {
        setDuplicateConflict(err?.existingSource || ({} as VideoSource));
        setErrorMessage(
          err?.existingSource?.serverName
            ? `Esta URL já está registada no servidor "${err.existingSource.serverName}". Clique em "Substituir Fonte Existente" para atualizar.`
            : err?.message || 'Já existe uma fonte igual registada para este conteúdo.'
        );
      } else {
        setErrorMessage(err?.message || 'Erro ao salvar fonte.');
      }
      setSavingStatus('error');
    }
  };

  const handleSaveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveSource(false);
  };

  const handleDeleteSource = async (id: string) => {
    try {
      await api.deleteVideoSource(id);
      setSources(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Failed to delete source:', err);
    }
  };

  const handleTogglePrimary = async (source: VideoSource) => {
    try {
      await api.updateVideoSource(source.id, { isPrimary: !source.isPrimary });
      await loadData();
    } catch (err) {
      console.error('Failed to update primary flag:', err);
    }
  };

  const handleToggleEnabled = async (source: VideoSource) => {
    try {
      const nextEnabled = source.enabled === false;
      await api.updateVideoSource(source.id, { enabled: nextEnabled });
      await loadData();
    } catch (err) {
      console.error('Failed to update enabled flag:', err);
    }
  };

  const verifySource = async (id: string) => {
    setVerifyingId(id);
    try {
      const updated = await api.verifyVideoSource(id);
      if (updated) {
        setSources(prev => (Array.isArray(prev) ? prev : []).map(s => (s.id === id ? updated : s)));
        setDiagnosticSource(updated);
      }
    } catch (err) {
      console.error('Verification failed:', err);
    } finally {
      setVerifyingId(null);
    }
  };

  const verifyAll = async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    try {
      await api.verifyAllVideoSources();
      await loadData();
    } catch (err) {
      console.error('Mass verification failed:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  const safeSources = Array.isArray(sources) ? sources : [];

  const filteredSources = safeSources.filter(s => {
    const media = catalogItems.find(
      m => Number(m.tmdbId) === Number(s?.contentId) && (m.type === 'series' ? 'tv' : m.type) === (s?.contentType === 'series' ? 'tv' : s?.contentType)
    );
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      (s?.serverName || '').toLowerCase().includes(q) ||
      (s?.contentId || '').toString().includes(searchTerm) ||
      (s?.originalUrl || s?.url || '').toLowerCase().includes(q) ||
      (media?.title || '').toLowerCase().includes(q) ||
      formatSourceOrganizedLabel(s).toLowerCase().includes(q);
    const normalizedSourceType = s?.contentType === 'series' ? 'tv' : s?.contentType;
    const matchesType = filterType === 'all' || normalizedSourceType === filterType;
    const normalizedStatus = getStatusDisplayInfo(s?.status).code;
    const matchesStatus = filterStatus === 'all' || normalizedStatus === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const organizedGroups = useMemo(() => {
    const movieMap = new Map<number, { contentId: number; media?: MediaItem; sources: VideoSource[] }>();
    const seriesMap = new Map<
      number,
      {
        contentId: number;
        media?: MediaItem;
        totalSources: number;
        seasons: Map<number, Map<number, VideoSource[]>>;
      }
    >();

    const findMedia = (contentId: number, type: 'movie' | 'tv') =>
      catalogItems.find(
        m => Number(m.tmdbId) === Number(contentId) && (m.type === 'series' ? 'tv' : m.type) === type
      );

    for (const src of filteredSources) {
      const normType = src.contentType === 'series' || src.contentType === 'tv' ? 'tv' : 'movie';
      const cid = Number(src.contentId || 0);
      if (normType === 'movie') {
        let entry = movieMap.get(cid);
        if (!entry) {
          entry = { contentId: cid, media: findMedia(cid, 'movie'), sources: [] };
          movieMap.set(cid, entry);
        }
        entry.sources.push(src);
      } else {
        let entry = seriesMap.get(cid);
        if (!entry) {
          entry = {
            contentId: cid,
            media: findMedia(cid, 'tv'),
            totalSources: 0,
            seasons: new Map()
          };
          seriesMap.set(cid, entry);
        }
        const sNum = Number(src.seasonNumber ?? 1);
        const eNum = Number(src.episodeNumber ?? 1);
        let epMap = entry.seasons.get(sNum);
        if (!epMap) {
          epMap = new Map();
          entry.seasons.set(sNum, epMap);
        }
        const list = epMap.get(eNum) || [];
        list.push(src);
        epMap.set(eNum, list);
        entry.totalSources += 1;
      }
    }

    const movies = Array.from(movieMap.values()).sort((a, b) =>
      (a.media?.title || `TMDB ${a.contentId}`).localeCompare(b.media?.title || `TMDB ${b.contentId}`)
    );
    const series = Array.from(seriesMap.values())
      .map(s => ({
        ...s,
        seasonsList: Array.from(s.seasons.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([seasonNumber, epMap]) => ({
            seasonNumber,
            episodes: Array.from(epMap.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([episodeNumber, epSources]) => ({
                episodeNumber,
                sources: epSources
              }))
          }))
      }))
      .sort((a, b) =>
        (a.media?.title || `TMDB ${a.contentId}`).localeCompare(b.media?.title || `TMDB ${b.contentId}`)
      );

    return { movies, series };
  }, [filteredSources, catalogItems]);

  const getBadgeStyle = (status: string) => {
    const info = getStatusDisplayInfo(status);
    switch (info.tone) {
      case 'emerald':
        return { label: info.label, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2, animate: false };
      case 'red':
        return { label: info.label, color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: XCircle, animate: false };
      case 'blue':
        return { label: info.label, color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: RefreshCw, animate: true };
      case 'amber':
        return { label: info.label, color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: AlertTriangle, animate: false };
      case 'purple':
        return { label: info.label, color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: XCircle, animate: false };
      case 'orange':
        return { label: info.label, color: 'bg-orange-500/10 text-orange-400 border-orange-500/20', icon: AlertTriangle, animate: false };
      default:
        return { label: info.label, color: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20', icon: HelpCircle, animate: false };
    }
  };

  const stats = {
    total: safeSources.length,
    online: safeSources.filter(s => getStatusDisplayInfo(s?.status).code === 'online').length,
    offline: safeSources.filter(s => ['offline', 'embed_blocked', 'unsupported_format'].includes(getStatusDisplayInfo(s?.status).code)).length,
    pending: safeSources.filter(s => ['registered', 'unverifiable', 'validating'].includes(getStatusDisplayInfo(s?.status).code)).length
  };

  const catalogMovies = useMemo(
    () => catalogItems.filter(item => item.type === 'movie'),
    [catalogItems]
  );

  const catalogSeries = useMemo(
    () => catalogItems.filter(item => item.type === 'series' || (item.type as any) === 'tv'),
    [catalogItems]
  );

  const modalLiveClassification = useMemo(() => {
    if (!currentSource?.url?.trim()) return null;
    return classifySourceUrl(currentSource.url);
  }, [currentSource?.url]);

  const openEditModalForSource = (source: VideoSource) => {
    const existingUrl = source.originalUrl || source.url || '';
    const stripped = stripMgebPrefix(existingUrl);
    setModalUseMgebPrefix(!existingUrl || stripped.hadPrefix);
    setCurrentSource({
      ...source,
      versionType:
        normalizeVersionType(source.versionType, source.serverName, source.audioLanguage) || 'dublado'
    });
    setModalTestMessage(null);
    setErrorMessage(null);
    setSavingStatus('idle');
    setShowModal(true);
  };

  return (
    <div className="space-y-8 pb-12 font-sans">
      {/* Header & Tabs */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5 bg-[#111114] border border-white/10 p-5 sm:p-6 rounded-3xl">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tighter font-display">
            RONYCINE SOURCE MANAGER PRO
          </h2>
          <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest mt-1">
            Fontes de Filmes, Gerador Automático de Episódios & Prefixo MGEB
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap bg-black p-1.5 rounded-2xl border border-white/10 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('sources')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'sources' ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            Fontes ({safeSources.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('add_movie')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'add_movie' ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Film className="w-4 h-4" />
            Fonte de Filme
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('episode_generator')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'episode_generator' ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Tv className="w-4 h-4" />
            Gerador de Episódios
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('providers')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'providers' ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Key className="w-4 h-4" />
            Chaves API
          </button>
        </div>
      </div>

      {activeTab === 'add_movie' ? (
        <MovieSourcePanel
          catalogMovies={catalogMovies}
          existingSources={safeSources}
          preselectedMovieId={preselectedMedia?.contentType === 'movie' ? preselectedMedia.contentId : undefined}
          onSourceSaved={loadData}
        />
      ) : activeTab === 'episode_generator' ? (
        <EpisodeGenerator
          catalogSeries={catalogSeries}
          existingSources={safeSources}
          preselectedSeriesId={preselectedMedia?.contentType === 'tv' ? preselectedMedia.contentId : undefined}
          onSourcesSaved={loadData}
        />
      ) : activeTab === 'sources' ? (
        <>
          {/* Preselected Context Banner when coming from Catalog */}
          {preselectedMedia && (
            <div className="bg-brand/10 border border-brand/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {resolveTmdbPosterUrl(preselectedMedia.posterPath, 'w185') && (
                  <img
                    src={resolveTmdbPosterUrl(preselectedMedia.posterPath, 'w185')}
                    alt={preselectedMedia.title || 'Poster'}
                    className="w-10 h-14 object-cover rounded-lg border border-brand/40"
                  />
                )}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand">
                    Filtrado pelo Catálogo
                  </p>
                  <p className="text-sm font-black text-white">
                    {preselectedMedia.title || `TMDB ${preselectedMedia.contentId}`}
                    {preselectedMedia.contentType === 'tv' && preselectedMedia.seasonNumber
                      ? ` · T${preselectedMedia.seasonNumber} E${preselectedMedia.episodeNumber || 1}`
                      : ''}
                  </p>
                  <p className="text-[10px] font-mono text-zinc-400">
                    Tipo: {preselectedMedia.contentType === 'movie' ? 'Filme' : 'Série'} · TMDB ID: {preselectedMedia.contentId}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {preselectedMedia.contentType === 'tv' ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab('episode_generator')}
                    className="px-3.5 py-2 bg-[#E50914] hover:bg-[#E50914]/90 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <Tv className="w-3.5 h-3.5" />
                    Abrir no Gerador de Episódios
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveTab('add_movie')}
                    className="px-3.5 py-2 bg-[#E50914] hover:bg-[#E50914]/90 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <Film className="w-3.5 h-3.5" />
                    Abrir em Fonte de Filme
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setModalUseMgebPrefix(true);
                    setCurrentSource({
                      contentId: preselectedMedia.contentId,
                      contentType: preselectedMedia.contentType,
                      seasonNumber: preselectedMedia.contentType === 'tv' ? (preselectedMedia.seasonNumber ?? 1) : undefined,
                      episodeNumber: preselectedMedia.contentType === 'tv' ? (preselectedMedia.episodeNumber ?? 1) : undefined,
                      selectedTitle: preselectedMedia.title,
                      selectedPoster: preselectedMedia.posterPath,
                      audioLanguage: 'Português',
                      versionType: 'dublado',
                      subtitleUrl: '',
                      subtitleLanguage: '',
                      quality: '1080p',
                      status: 'registered',
                      format: 'php_endpoint',
                      isPrimary: false,
                      serverName: 'MGEB Endpoint'
                    });
                    setShowModal(true);
                  }}
                  className="px-3.5 py-2 bg-white/10 hover:bg-white/15 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Modal Rápido
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setFilterType('all');
                    onClearPreselected?.();
                  }}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-[10px] font-bold uppercase"
                >
                  Mostrar Todas
                </button>
              </div>
            </div>
          )}

          {preselectedMedia && (
            <PlaybackVersionsManager
              tmdbId={preselectedMedia.contentId}
              contentType={preselectedMedia.contentType}
              title={preselectedMedia.title}
              seasonNumber={preselectedMedia.seasonNumber}
              episodeNumber={preselectedMedia.episodeNumber}
              onUpdated={loadData}
            />
          )}

          {/* Action Header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Ações Rápidas:</span>
              <button
                type="button"
                onClick={verifyAll}
                disabled={isVerifying}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/10"
              >
                <RefreshCw className={`w-4 h-4 ${isVerifying ? 'animate-spin' : ''}`} />
                Testar Todas as Fontes
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('add_movie')}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#111114] hover:bg-white/10 text-zinc-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/10"
              >
                <Film className="w-4 h-4 text-[#E50914]" />
                Adicionar Fonte Filme
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('episode_generator')}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#111114] hover:bg-white/10 text-zinc-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/10"
              >
                <Tv className="w-4 h-4 text-[#E50914]" />
                Gerar Episódios Série
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setModalUseMgebPrefix(true);
                setCurrentSource({
                  contentId: preselectedMedia?.contentId,
                  contentType: preselectedMedia?.contentType || 'movie',
                  seasonNumber: preselectedMedia?.contentType === 'tv' ? (preselectedMedia.seasonNumber ?? 1) : undefined,
                  episodeNumber: preselectedMedia?.contentType === 'tv' ? (preselectedMedia.episodeNumber ?? 1) : undefined,
                  selectedTitle: preselectedMedia?.title,
                  selectedPoster: preselectedMedia?.posterPath,
                  audioLanguage: 'Português',
                  versionType: 'dublado',
                  subtitleUrl: '',
                  subtitleLanguage: '',
                  quality: '1080p',
                  status: 'registered',
                  format: 'php_endpoint',
                  isPrimary: false,
                  priority: 1,
                  enabled: true,
                  serverName: 'MGEB Endpoint'
                });
                setTmdbQuery('');
                setTmdbResults([]);
                setModalTestMessage(null);
                setSavingStatus('idle');
                setErrorMessage(null);
                setShowModal(true);
              }}
              className="flex items-center gap-2 px-6 py-2.5 bg-brand hover:bg-brand/90 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-brand/20"
            >
              <Plus className="w-4 h-4" />
              <span>ADICIONAR FONTE</span>
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: 'Total de Fontes', value: stats.total, icon: Layers, color: 'text-brand' },
              { label: 'Fontes Online', value: stats.online, icon: CheckCircle2, color: 'text-emerald-500' },
              { label: 'Offline / Bloqueadas', value: stats.offline, icon: XCircle, color: 'text-red-500' },
              { label: 'Registadas / Pendentes', value: stats.pending, icon: HelpCircle, color: 'text-amber-500' }
            ].map((stat, i) => (
              <div key={i} className="bg-surface border border-white/5 p-6 rounded-2xl space-y-4 hover:border-brand/30 transition-all">
                <div className="flex justify-between items-start">
                  <div className={`p-3 bg-white/5 rounded-xl ${stat.color}`}>
                    <stat.icon className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">{stat.label}</p>
                  <h3 className="text-3xl font-black text-white mt-1 tabular-nums">{stat.value}</h3>
                </div>
              </div>
            ))}
          </div>

          {/* Filters & Table */}
          <div className="bg-surface border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/5 flex flex-col md:flex-row gap-4 items-center justify-between bg-white/[0.02]">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Pesquisar por servidor, TMDB ID ou URL..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-sm text-white focus:border-brand outline-none transition-all"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                <div className="flex bg-black rounded-2xl p-1 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setViewMode('organized')}
                    className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                      viewMode === 'organized' ? 'bg-brand text-white' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <FolderTree className="w-3.5 h-3.5" />
                    Organizado
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                      viewMode === 'table' ? 'bg-brand text-white' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                    Lista
                  </button>
                </div>

                <div className="flex bg-black rounded-2xl p-1 border border-white/10">
                  {['all', 'movie', 'tv'].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFilterType(t as any)}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        filterType === t ? 'bg-brand text-white' : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {t === 'all' ? 'Todos' : t === 'movie' ? 'Filmes' : 'Séries'}
                    </button>
                  ))}
                </div>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="bg-black border border-white/10 rounded-2xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 focus:border-brand outline-none"
                >
                  <option value="all">Estado: Todos</option>
                  <option value="registered">Registada</option>
                  <option value="validating">A Validar</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="unverifiable">Não Verificável</option>
                  <option value="unsupported_format">Formato Não Suportado</option>
                  <option value="embed_blocked">Incorporação Bloqueada</option>
                </select>
              </div>
            </div>

            {viewMode === 'organized' ? (
              <div className="p-6 space-y-8">
                {loading && filteredSources.length === 0 ? (
                  <div className="p-12 text-center text-xs text-zinc-500">Carregando fontes registadas...</div>
                ) : filteredSources.length === 0 ? (
                  <div className="p-16 text-center text-zinc-600 flex flex-col items-center gap-3">
                    <Layers className="w-10 h-10 opacity-20" />
                    <p className="text-[10px] font-black uppercase tracking-[0.3em]">
                      Nenhuma fonte de vídeo encontrada
                    </p>
                  </div>
                ) : (
                  <>
                    {/* FILMES ORGANIZED (Idioma — Versão — Qualidade) */}
                    {organizedGroups.movies.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                          <h4 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
                            <Film className="w-4 h-4 text-[#E50914]" />
                            Filmes ({organizedGroups.movies.length})
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {organizedGroups.movies.map(group => (
                            <div
                              key={`movie-group-${group.contentId}`}
                              className="bg-black/60 border border-white/10 rounded-2xl p-4 space-y-3"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-14 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-white/10">
                                  {resolveTmdbPosterUrl(group.media?.posterPath, 'w185') ? (
                                    <img
                                      src={resolveTmdbPosterUrl(group.media?.posterPath, 'w185')}
                                      alt={group.media?.title || 'Filme'}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-zinc-700">
                                      <Film className="w-4 h-4" />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h5 className="text-sm font-black text-white truncate">
                                    {group.media?.title || `TMDB ${group.contentId}`}
                                  </h5>
                                  <p className="text-[10px] font-mono text-zinc-500">
                                    Filme · TMDB {group.contentId} · {group.sources.length} fonte(s)
                                  </p>
                                </div>
                              </div>

                              <div className="space-y-3">
                                {(() => {
                                  const subGroups = new Map<string, VideoSource[]>();
                                  for (const sItem of group.sources) {
                                    const l = (sItem.audioLanguage || 'Português').trim() || 'Português';
                                    const v =
                                      formatVersionTypeLabel(
                                        sItem.versionType ||
                                          normalizeVersionType(undefined, sItem.serverName, sItem.audioLanguage)
                                      ) || 'Versão Padrão';
                                    const key = `${l} — ${v}`;
                                    const list = subGroups.get(key) || [];
                                    list.push(sItem);
                                    subGroups.set(key, list);
                                  }
                                  return Array.from(subGroups.entries()).map(([subLabel, subSources]) => (
                                    <div key={subLabel} className="space-y-1.5">
                                      <div className="flex items-center justify-between px-1">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                                          {subLabel}
                                        </span>
                                        <span className="text-[10px] font-mono text-zinc-600">{subSources.length}</span>
                                      </div>
                                      {subSources.map(src => {
                                        const badge = getBadgeStyle(src.status);
                                        const BadgeIcon = badge.icon;
                                  return (
                                    <div
                                      key={src.id}
                                      className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                                    >
                                      <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="text-xs font-bold text-white">
                                            {formatSourceOrganizedLabel(src)}
                                          </span>
                                          {src.isPrimary && (
                                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-black uppercase">
                                              Principal
                                            </span>
                                          )}
                                          {src.enabled === false && (
                                            <span className="px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-red-300 text-[9px] font-black uppercase">
                                              Desativada
                                            </span>
                                          )}
                                          {src.subtitleUrl && (
                                            <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[9px] font-black uppercase inline-flex items-center gap-1">
                                              <Subtitles className="w-2.5 h-2.5" /> Legenda
                                            </span>
                                          )}
                                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${badge.color}`}>
                                            <BadgeIcon className={`w-2.5 h-2.5 ${badge.animate ? 'animate-spin' : ''}`} />
                                            {badge.label}
                                          </span>
                                        </div>
                                        <p className="text-[10px] font-mono text-zinc-400 truncate">
                                          {src.serverName} · {src.format} · {src.originalUrl || src.url}
                                        </p>
                                      </div>

                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => openEditModalForSource(src)}
                                          className="p-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-lg"
                                          title="Editar"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => verifySource(src.id)}
                                          disabled={verifyingId === src.id}
                                          className="p-1.5 bg-white/5 hover:bg-white/10 text-emerald-400 rounded-lg"
                                          title="Testar"
                                        >
                                          <ShieldCheck className={`w-3.5 h-3.5 ${verifyingId === src.id ? 'animate-spin' : ''}`} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => openPlayTest(src)}
                                          className="p-1.5 bg-brand/15 hover:bg-brand text-brand hover:text-white rounded-lg"
                                          title="Reproduzir Teste"
                                        >
                                          <Play className="w-3.5 h-3.5 fill-current" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleToggleEnabled(src)}
                                          className={`p-1.5 rounded-lg ${
                                            src.enabled === false ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
                                          }`}
                                          title={src.enabled === false ? 'Ativar' : 'Desativar'}
                                        >
                                          <Power className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteSource(src.id)}
                                          className="p-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded-lg"
                                          title="Eliminar"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                                    </div>
                                  ));
                                })()}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* SÉRIES HIERARCHICAL TREE: Série -> Temporada -> Episódio -> Fontes */}
                    {organizedGroups.series.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                          <h4 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
                            <Tv className="w-4 h-4 text-[#E50914]" />
                            Séries ({organizedGroups.series.length}) · Série → Temporada → Episódio → Fontes
                          </h4>
                        </div>
                        <div className="space-y-3">
                          {organizedGroups.series.map(seriesGroup => {
                            const seriesKey = String(seriesGroup.contentId);
                            const isSeriesOpen =
                              expandedSeries[seriesKey] !== undefined
                                ? expandedSeries[seriesKey]
                                : organizedGroups.series.length <= 3 || Boolean(searchTerm.trim());

                            return (
                              <div
                                key={`series-group-${seriesKey}`}
                                className="bg-black/60 border border-white/10 rounded-2xl overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedSeries(prev => ({ ...prev, [seriesKey]: !isSeriesOpen }))
                                  }
                                  className="w-full p-4 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors text-left"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    {isSeriesOpen ? (
                                      <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                                    )}
                                    <div className="w-9 h-12 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-white/10">
                                      {resolveTmdbPosterUrl(seriesGroup.media?.posterPath, 'w185') ? (
                                        <img
                                          src={resolveTmdbPosterUrl(seriesGroup.media?.posterPath, 'w185')}
                                          alt={seriesGroup.media?.title || 'Série'}
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center text-zinc-700">
                                          <Tv className="w-4 h-4" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <h5 className="text-sm font-black text-white truncate">
                                        {seriesGroup.media?.title || `Série TMDB ${seriesGroup.contentId}`}
                                      </h5>
                                      <p className="text-[10px] font-mono text-zinc-500">
                                        TMDB {seriesGroup.contentId} · {seriesGroup.seasonsList.length} temporada(s) · {seriesGroup.totalSources} fonte(s)
                                      </p>
                                    </div>
                                  </div>
                                </button>

                                {isSeriesOpen && (
                                  <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                                    {seriesGroup.seasonsList.map(seasonEntry => {
                                      const seasonKey = `${seriesKey}-S${seasonEntry.seasonNumber}`;
                                      const isSeasonOpen =
                                        expandedSeasons[seasonKey] !== undefined
                                          ? expandedSeasons[seasonKey]
                                          : seriesGroup.seasonsList.length <= 2 || Boolean(searchTerm.trim());

                                      return (
                                        <div
                                          key={seasonKey}
                                          className="bg-white/[0.02] border border-white/10 rounded-xl overflow-hidden"
                                        >
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setExpandedSeasons(prev => ({ ...prev, [seasonKey]: !isSeasonOpen }))
                                            }
                                            className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-white/[0.03] text-left"
                                          >
                                            <div className="flex items-center gap-2">
                                              {isSeasonOpen ? (
                                                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                                              ) : (
                                                <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                                              )}
                                              <span className="text-xs font-black uppercase tracking-wider text-white">
                                                {seasonEntry.seasonNumber === 0
                                                  ? 'Especiais'
                                                  : `Temporada ${seasonEntry.seasonNumber}`}
                                              </span>
                                            </div>
                                            <span className="text-[10px] font-mono text-zinc-400">
                                              {seasonEntry.episodes.length} episódio(s)
                                            </span>
                                          </button>

                                          {isSeasonOpen && (
                                            <div className="px-3.5 pb-3 space-y-2 border-t border-white/5 pt-2">
                                              {seasonEntry.episodes.map(epEntry => (
                                                <div
                                                  key={`${seasonKey}-E${epEntry.episodeNumber}`}
                                                  className="p-2.5 rounded-xl bg-black/60 border border-white/5 space-y-2"
                                                >
                                                  <div className="flex items-center justify-between text-[11px] font-bold text-zinc-200">
                                                    <span>
                                                      Episódio {String(epEntry.episodeNumber).padStart(2, '0')}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-zinc-500">
                                                      {epEntry.sources.length} fonte(s)
                                                    </span>
                                                  </div>

                                                  <div className="space-y-1.5">
                                                    {epEntry.sources.map(src => {
                                                      const badge = getBadgeStyle(src.status);
                                                      const BadgeIcon = badge.icon;
                                                      return (
                                                        <div
                                                          key={src.id}
                                                          className="p-2.5 rounded-lg bg-white/[0.02] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                                        >
                                                          <div className="min-w-0 space-y-0.5">
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                              <span className="text-[11px] font-bold text-white">
                                                                {formatSourceOrganizedLabel(src)}
                                                              </span>
                                                              <span className="text-[10px] text-zinc-400">
                                                                · {src.serverName} ({src.format})
                                                              </span>
                                                              {src.isPrimary && (
                                                                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[9px] font-black uppercase">
                                                                  Principal
                                                                </span>
                                                              )}
                                                              {src.enabled === false && (
                                                                <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 text-[9px] font-black uppercase">
                                                                  Desativada
                                                                </span>
                                                              )}
                                                              {src.subtitleUrl && (
                                                                <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[9px] font-black uppercase">
                                                                  Legenda
                                                                </span>
                                                              )}
                                                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${badge.color}`}>
                                                                <BadgeIcon className={`w-2.5 h-2.5 ${badge.animate ? 'animate-spin' : ''}`} />
                                                                {badge.label}
                                                              </span>
                                                            </div>
                                                            <p className="text-[10px] font-mono text-zinc-500 truncate">
                                                              {src.originalUrl || src.url}
                                                            </p>
                                                          </div>

                                                          <div className="flex items-center gap-1 shrink-0">
                                                            <button
                                                              type="button"
                                                              onClick={() => openEditModalForSource(src)}
                                                              className="p-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-lg"
                                                              title="Editar"
                                                            >
                                                              <Edit2 className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                              type="button"
                                                              onClick={() => verifySource(src.id)}
                                                              disabled={verifyingId === src.id}
                                                              className="p-1.5 bg-white/5 hover:bg-white/10 text-emerald-400 rounded-lg"
                                                              title="Testar"
                                                            >
                                                              <ShieldCheck className={`w-3.5 h-3.5 ${verifyingId === src.id ? 'animate-spin' : ''}`} />
                                                            </button>
                                                            <button
                                                              type="button"
                                                              onClick={() => openPlayTest(src)}
                                                              className="p-1.5 bg-brand/15 hover:bg-brand text-brand hover:text-white rounded-lg"
                                                              title="Reproduzir Teste"
                                                            >
                                                              <Play className="w-3.5 h-3.5 fill-current" />
                                                            </button>
                                                            <button
                                                              type="button"
                                                              onClick={() => handleToggleEnabled(src)}
                                                              className={`p-1.5 rounded-lg ${
                                                                src.enabled === false ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
                                                              }`}
                                                              title={src.enabled === false ? 'Ativar' : 'Desativar'}
                                                            >
                                                              <Power className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                              type="button"
                                                              onClick={() => handleDeleteSource(src.id)}
                                                              className="p-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded-lg"
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
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-white/5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    <th className="p-6">Conteúdo</th>
                    <th className="p-6">Servidor / URL Original</th>
                    <th className="p-6">Tipo / Formato</th>
                    <th className="p-6">Idioma / Versão / Qualidade</th>
                    <th className="p-6">Estado & Diagnóstico</th>
                    <th className="p-6 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading && filteredSources.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-xs text-zinc-500">
                        Carregando fontes registadas...
                      </td>
                    </tr>
                  ) : (
                    filteredSources.map((source) => {
                      const media = catalogItems.find(
                        m => m.tmdbId === source.contentId && (m.type === 'series' ? 'tv' : m.type) === (source.contentType === 'series' ? 'tv' : source.contentType)
                      );
                      const badge = getBadgeStyle(source.status);
                      const BadgeIcon = badge.icon;
                      const displayUrl = source.originalUrl || source.url;

                      return (
                        <tr key={source.id} className="text-xs hover:bg-white/5 transition-all group/row">
                          <td className="p-6">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-14 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0 border border-white/10">
                                {resolveTmdbPosterUrl(media?.posterPath, 'w185') && (
                                  <img src={resolveTmdbPosterUrl(media?.posterPath, 'w185')} alt={media?.title || 'Poster'} className="w-full h-full object-cover" />
                                )}
                              </div>
                              <div>
                                <p className="font-black text-white uppercase tracking-tight">
                                  {media?.title || `TMDB: ${source.contentId}`}
                                </p>
                                <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1">
                                  {source.contentType === 'movie'
                                    ? 'Filme'
                                    : `Série · T${source.seasonNumber ?? 1} E${source.episodeNumber ?? 1}`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Server className="w-3.5 h-3.5 text-zinc-500" />
                                <span className={`font-bold ${source.enabled === false ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                                  {source.serverName}
                                </span>
                                {source.isPrimary && (
                                  <span className="px-2 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-black uppercase rounded-full flex items-center gap-1">
                                    <Star className="w-2.5 h-2.5 fill-amber-400" />
                                    Principal
                                  </span>
                                )}
                                <span className="px-2 py-0.5 bg-white/5 border border-white/10 text-zinc-400 text-[9px] font-mono font-bold rounded-full">
                                  #{source.priority ?? 1}
                                </span>
                                {source.enabled === false && (
                                  <span className="px-2 py-0.5 bg-red-500/15 border border-red-500/30 text-red-400 text-[9px] font-black uppercase rounded-full">
                                    Desativada
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] font-mono text-zinc-400 truncate max-w-xs" title={displayUrl}>
                                {displayUrl}
                              </p>
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="space-y-1">
                              <span className="inline-block px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg font-black uppercase text-[9px] text-zinc-200 font-mono">
                                {source.format}
                              </span>
                              {source.sourceKind && (
                                <p className="text-[9px] font-mono text-zinc-500">{source.sourceKind}</p>
                              )}
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-zinc-300">
                                <Languages className="w-3 h-3 text-zinc-500" />
                                <span className="font-bold text-[10px]">
                                  {formatSourceOrganizedLabel(source)}
                                </span>
                              </div>
                              {source.subtitleUrl && (
                                <div className="flex items-center gap-1 text-sky-400 text-[9px] font-bold uppercase">
                                  <Subtitles className="w-3 h-3" />
                                  Legenda Externa
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="space-y-1">
                              <span
                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-wider ${badge.color}`}
                              >
                                <BadgeIcon className={`w-3 h-3 ${badge.animate ? 'animate-spin' : ''}`} />
                                {badge.label}
                              </span>
                              {source.verificationResult && (
                                <p className="text-[9px] text-zinc-400 font-medium line-clamp-1 max-w-xs">
                                  {source.verificationResult}
                                </p>
                              )}
                              {source.lastVerifiedAt && (
                                <p className="text-[8px] text-zinc-600 font-bold uppercase tabular-nums">
                                  Testado: {new Date(source.lastVerifiedAt).toLocaleString('pt-PT')}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleEnabled(source)}
                                className={`p-2 rounded-xl transition-all ${
                                  source.enabled === false
                                    ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                                    : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                }`}
                                title={source.enabled === false ? 'Ativar Fonte' : 'Desativar Fonte'}
                              >
                                <Power className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleTogglePrimary(source)}
                                className={`p-2 rounded-xl transition-all ${
                                  source.isPrimary
                                    ? 'bg-amber-500/15 text-amber-400'
                                    : 'bg-white/5 hover:bg-white/10 text-zinc-500 hover:text-amber-300'
                                }`}
                                title={source.isPrimary ? 'Fonte Principal' : 'Definir como Principal'}
                              >
                                <Star className={`w-4 h-4 ${source.isPrimary ? 'fill-amber-400' : ''}`} />
                              </button>
                              <button
                                type="button"
                                onClick={() => verifySource(source.id)}
                                disabled={verifyingId === source.id}
                                className="px-2.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl transition-all flex items-center gap-1 text-[10px] font-bold"
                                title="Testar Fonte"
                              >
                                <ShieldCheck
                                  className={`w-3.5 h-3.5 ${verifyingId === source.id ? 'animate-spin text-brand' : 'text-emerald-400'}`}
                                />
                                <span className="hidden xl:inline">Testar</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openPlayTest(source)}
                                className="px-2.5 py-2 bg-brand/15 hover:bg-brand text-brand hover:text-white rounded-xl transition-all flex items-center gap-1 text-[10px] font-bold"
                                title="Reproduzir Teste"
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span className="hidden xl:inline">Reproduzir</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModalForSource(source)}
                                className="p-2 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-xl transition-all"
                                title="Editar Fonte"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSource(source.id)}
                                className="p-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl transition-all"
                                title="Eliminar Fonte"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                  {!loading && filteredSources.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-20 text-center">
                        <div className="flex flex-col items-center gap-4 text-zinc-600">
                          <Layers className="w-12 h-12 opacity-20" />
                          <p className="text-[10px] font-black uppercase tracking-[0.3em]">
                            Nenhuma fonte de vídeo encontrada
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </>
      ) : (
        /* PROVIDERS CONFIG TAB (UQLOAD, ANONMP4) */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-surface border border-white/5 p-8 rounded-3xl space-y-6">
            <div className="flex items-center gap-3 pb-6 border-b border-white/5">
              <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight text-white font-display">
                  Chaves de API dos Provedores
                </h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">
                  Guardadas com segurança no backend
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveKeys} className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-300">Chave API UQLOAD</label>
                  <a
                    href="https://uqload.com/user/settings"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1"
                  >
                    Obter Chave <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <input
                  type="password"
                  value={uqloadApiKey}
                  onChange={(e) => setUqloadApiKey(e.target.value)}
                  placeholder="Insira a API Key do UQLOAD (ex: 8847x...)"
                  className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-mono"
                />
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  A API Key autoriza a consulta de links diretos MP4 através do endpoint oficial{' '}
                  <code className="text-brand">direct_link</code>.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  Chave API ANONMP4 (Opcional)
                </label>
                <input
                  type="password"
                  value={anonmp4ApiKey}
                  onChange={(e) => setAnonmp4ApiKey(e.target.value)}
                  placeholder="Chave oficial ANONMP4 se disponibilizada pelo servidor"
                  className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-mono"
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-white/5">
                <button
                  type="submit"
                  disabled={savingKeys}
                  className="px-6 py-3 bg-brand text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-brand/90 transition-all shadow-xl shadow-brand/20 flex items-center gap-2"
                >
                  {savingKeys ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Guardar Chaves
                </button>

                <button
                  type="button"
                  onClick={handleTestUqload}
                  disabled={testingKey}
                  className="px-6 py-3 bg-white/10 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-white/20 transition-all border border-white/10 flex items-center gap-2"
                >
                  {testingKey ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4 text-emerald-400" />}
                  Testar Conexão UQLOAD
                </button>
              </div>
            </form>

            {testResult && (
              <div
                className={`p-4 rounded-2xl border text-xs font-bold ${
                  testResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-950/40 border-red-500/30 text-red-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                  )}
                  <span>{testResult.message}</span>
                </div>
                {testResult.details && (
                  <pre className="mt-2 p-3 bg-black/60 rounded-xl text-[10px] font-mono text-zinc-400 overflow-x-auto">
                    {JSON.stringify(testResult.details, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          <div className="bg-surface border border-white/5 p-8 rounded-3xl space-y-6">
            <div className="flex items-center gap-3 pb-6 border-b border-white/5">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight text-white font-display">
                  Documentação dos Provedores
                </h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">
                  Adaptadores e Diagnóstico RONYCINE
                </p>
              </div>
            </div>

            <div className="space-y-4 text-xs text-zinc-300 leading-relaxed font-medium">
              <div className="bg-black/50 p-4 rounded-2xl border border-white/5 space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-brand flex items-center gap-2">
                  <Server className="w-4 h-4" /> Endpoints PHP Externos (ex: mgeb.space/mp4.php?url=...)
                </h4>
                <p className="text-[11px] text-zinc-400">
                  O sistema preserva o endereço completo com o parâmetro <code className="text-white bg-white/10 px-1 py-0.5 rounded">?url=</code>, inspeciona o Content-Type real no backend e seleciona reprodução direta (MP4/HLS/DASH/WebM) ou Iframe conforme a resposta oficial do servidor.
                </p>
              </div>

              <div className="bg-black/50 p-4 rounded-2xl border border-white/5 space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-brand flex items-center gap-2">
                  <Server className="w-4 h-4" /> UQLOAD & ANONMP4
                </h4>
                <p className="text-[11px] text-zinc-400">
                  O adaptador extrai o código do ficheiro para resolução oficial via API quando configurada, mantendo o player incorporado seguro como fallback.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Add/Edit Source */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-3xl bg-[#0c0c0c] border border-white/10 rounded-3xl overflow-hidden shadow-2xl my-auto"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
                    <Plus className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight">
                      {currentSource?.id ? 'Editar Fonte de Vídeo' : 'Adicionar Nova Fonte'}
                    </h3>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                      Pesquisa TMDB, Diagnóstico e Associação RONYCINE
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="p-2 text-zinc-500 hover:text-white transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSaveSource} className="p-8 space-y-6 max-h-[80vh] overflow-y-auto">
                {/* 1. TMDB SEARCH SECTION */}
                <div className="bg-black/60 border border-white/10 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                      <Search className="w-4 h-4 text-brand" /> Pesquisar Filme ou Série no TMDB
                    </h4>
                    <span className="text-[10px] text-zinc-500 font-mono">Digite o título ou TMDB ID</span>
                  </div>

                  <div className="flex gap-3">
                    <select
                      value={tmdbSearchType}
                      onChange={(e) => setTmdbSearchType(e.target.value as any)}
                      className="bg-black border border-white/15 rounded-xl px-3 py-2.5 text-xs text-white font-bold uppercase outline-none focus:border-brand"
                    >
                      <option value="all">Todos</option>
                      <option value="movie">Filme</option>
                      <option value="tv">Série</option>
                    </select>

                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={tmdbQuery}
                        onChange={(e) => handleTmdbInputChange(e.target.value)}
                        placeholder="Ex: Interstellar, Avatar ou ID 157336..."
                        className="w-full bg-black border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-brand pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => handleSearchTmdb()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-white"
                      >
                        <Search className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isSearchingTmdb && (
                    <div className="text-center py-6 text-zinc-500 text-xs flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-brand" /> Pesquisando no TMDB...
                    </div>
                  )}

                  {tmdbResults.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
                      {tmdbResults.map((item) => (
                        <div
                          key={`${item.type}-${item.tmdbId}`}
                          onClick={() => handleSelectTmdbItem(item)}
                          className="bg-zinc-900/90 hover:bg-zinc-800 border border-white/10 hover:border-brand rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-all group"
                        >
                          <div className="w-12 h-16 rounded-lg bg-black overflow-hidden flex-shrink-0 border border-white/10">
                            {item.posterPath ? (
                              <img
                                src={
                                  item.posterPath.startsWith('http')
                                    ? item.posterPath
                                    : `https://image.tmdb.org/t/p/w185${item.posterPath}`
                                }
                                alt={item.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-zinc-600">
                                <Film className="w-5 h-5" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-white text-xs truncate group-hover:text-brand transition-colors">
                              {item.title}
                            </p>
                            <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                              {item.type === 'movie' ? 'Filme' : 'Série'} · TMDB: {item.tmdbId}
                            </p>
                            <p className="text-[9px] text-zinc-500 font-bold mt-1">
                              {item.releaseDate || item.firstAirDate ? (item.releaseDate || item.firstAirDate || '').substring(0, 4) : 'N/A'}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="px-2.5 py-1 bg-brand text-white rounded-lg text-[9px] font-black uppercase tracking-wider shrink-0"
                          >
                            Selecionar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected Content Preview Banner */}
                {currentSource?.contentId && (
                  <div className="p-4 bg-brand/10 border border-brand/30 rounded-2xl flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {currentSource.selectedPoster && (
                        <img
                          src={
                            currentSource.selectedPoster.startsWith('http')
                              ? currentSource.selectedPoster
                              : `https://image.tmdb.org/t/p/w185${currentSource.selectedPoster}`
                          }
                          alt={currentSource.selectedTitle || 'Poster'}
                          className="w-10 h-14 object-cover rounded-lg border border-brand/40 flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-brand text-white rounded-md">
                          Conteúdo Selecionado
                        </span>
                        <p className="font-black text-white text-sm truncate mt-1">
                          {currentSource.selectedTitle || `TMDB ID: ${currentSource.contentId}`}
                        </p>
                        <p className="text-[10px] text-zinc-400 font-mono">
                          Tipo: {currentSource.contentType === 'movie' ? 'Filme' : 'Série'} · TMDB ID: {currentSource.contentId}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 shrink-0">
                      <Check className="w-4 h-4" /> Pronto
                    </span>
                  </div>
                )}

                {/* 2. SOURCE DETAILS FORM */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Tipo de Conteúdo
                    </label>
                    <select
                      value={currentSource?.contentType || 'movie'}
                      onChange={(e) => setCurrentSource({ ...currentSource, contentType: e.target.value as any })}
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                      required
                    >
                      <option value="movie">Filme</option>
                      <option value="tv">Série</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">TMDB ID</label>
                    <input
                      type="number"
                      value={currentSource?.contentId || ''}
                      onChange={(e) =>
                        setCurrentSource({ ...currentSource, contentId: parseInt(e.target.value, 10) || undefined })
                      }
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-mono"
                      placeholder="Ex: 550"
                      required
                    />
                  </div>

                  {currentSource?.contentType === 'tv' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                          Temporada
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={currentSource?.seasonNumber ?? 1}
                          onChange={(e) => {
                            const parsed = parseInt(e.target.value, 10);
                            setCurrentSource({
                              ...currentSource,
                              seasonNumber: Math.max(0, isNaN(parsed) ? 1 : parsed)
                            });
                          }}
                          className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                          Episódio
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={currentSource?.episodeNumber || 1}
                          onChange={(e) =>
                            setCurrentSource({
                              ...currentSource,
                              episodeNumber: Math.max(1, parseInt(e.target.value, 10) || 1)
                            })
                          }
                          className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                          required
                        />
                      </div>
                    </>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Nome do Servidor
                    </label>
                    <input
                      type="text"
                      value={currentSource?.serverName || ''}
                      onChange={(e) => setCurrentSource({ ...currentSource, serverName: e.target.value })}
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                      placeholder="Ex: Servidor Principal, MGEB Endpoint, UQLOAD"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Formato da Fonte
                    </label>
                    <select
                      value={currentSource?.format || 'embed'}
                      onChange={(e) => setCurrentSource({ ...currentSource, format: e.target.value as any })}
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                      required
                    >
                      <option value="mp4">MP4 Direto</option>
                      <option value="m3u8">M3U8 / HLS</option>
                      <option value="dash">DASH (.mpd)</option>
                      <option value="webm">WebM Direto</option>
                      <option value="php_endpoint">Endpoint PHP (ex: mgeb.space/mp4.php)</option>
                      <option value="embed">Embed / Iframe</option>
                      <option value="iframe">Iframe Player</option>
                      <option value="html">Página HTML Externa</option>
                    </select>
                  </div>
                </div>

                {/* Primary, Priority & Active Toggle */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="flex items-center gap-3 p-3.5 rounded-2xl bg-black/60 border border-white/10 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(currentSource?.isPrimary)}
                      onChange={(e) => setCurrentSource({ ...currentSource, isPrimary: e.target.checked })}
                      className="w-4 h-4 accent-[#E50914] rounded"
                    />
                    <Star className={`w-4 h-4 ${currentSource?.isPrimary ? 'text-amber-400 fill-amber-400' : 'text-zinc-500'}`} />
                    <span className="text-xs font-bold text-white">Fonte principal</span>
                  </label>

                  <label className="flex items-center gap-3 p-3.5 rounded-2xl bg-black/60 border border-white/10 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentSource?.enabled !== false}
                      onChange={(e) => setCurrentSource({ ...currentSource, enabled: e.target.checked })}
                      className="w-4 h-4 accent-emerald-500 rounded"
                    />
                    <Power className={`w-4 h-4 ${currentSource?.enabled !== false ? 'text-emerald-400' : 'text-zinc-500'}`} />
                    <span className="text-xs font-bold text-white">Fonte ativa</span>
                  </label>

                  <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-black/60 border border-white/10">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Prioridade</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={currentSource?.priority ?? 1}
                      onChange={(e) =>
                        setCurrentSource({
                          ...currentSource,
                          priority: Math.max(1, parseInt(e.target.value, 10) || 1)
                        })
                      }
                      className="w-20 bg-black border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white font-mono text-center focus:border-brand outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <MgebUrlField
                    value={currentSource?.url || ''}
                    useMgebPrefix={modalUseMgebPrefix}
                    onChangeUrl={(finalUrl) => handleUrlChange(finalUrl)}
                    onToggleMgebPrefix={(nextUseMgeb) => setModalUseMgebPrefix(nextUseMgeb)}
                    onTestSource={handleModalTestSource}
                    onTogglePlayTest={() => {
                      if (currentSource?.url?.trim()) {
                        openPlayTest({
                          id: currentSource.id || 'modal-preview',
                          contentId: currentSource.contentId || 0,
                          contentType: (currentSource.contentType as any) || 'movie',
                          url: currentSource.url,
                          originalUrl: currentSource.url,
                          format: (currentSource.format as any) || classifySourceUrl(currentSource.url).suggestedFormat,
                          sourceKind: currentSource.sourceKind || classifySourceUrl(currentSource.url).sourceKind,
                          serverName: currentSource.serverName || 'Pré-visualização',
                          audioLanguage: currentSource.audioLanguage || 'Português',
                          versionType: currentSource.versionType || 'dublado',
                          subtitleUrl: currentSource.subtitleUrl || undefined,
                          subtitleLanguage: currentSource.subtitleLanguage || undefined,
                          quality: currentSource.quality || '1080p',
                          diagnostics: currentSource.diagnostics,
                          status: currentSource.status || 'registered',
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString()
                        });
                      }
                    }}
                    isTesting={modalTestingLink}
                    showPlayTest={Boolean(modalLiveClassification?.valid)}
                    label="URL Original do Vídeo ou Endpoint (Prefixo MGEB Permanente)"
                  />

                  {modalLiveClassification && modalLiveClassification.valid && (
                    <div className="p-3 bg-black/60 border border-white/10 rounded-xl text-[11px] space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-300 font-mono">
                        <span>Classificação: {getSourceKindLabel(currentSource?.sourceKind || modalLiveClassification.sourceKind)}</span>
                        <span>Domínio: {modalLiveClassification.diagnostics.domain}</span>
                      </div>
                      {modalLiveClassification.diagnostics.hasUrlParam && (
                        <p className="text-[10px] text-zinc-400 font-mono truncate">
                          Parâmetro ?url= preservado: {modalLiveClassification.diagnostics.nestedUrl}
                        </p>
                      )}
                    </div>
                  )}
                  {modalTestMessage && (
                    <p className="text-[11px] font-bold text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-xl p-2.5">
                      {modalTestMessage}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Idioma
                    </label>
                    <select
                      value={isPresetAudioLanguage(currentSource?.audioLanguage) ? currentSource?.audioLanguage || 'Português' : 'Outro'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCurrentSource({ ...currentSource, audioLanguage: val === 'Outro' ? '' : val });
                      }}
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-bold"
                    >
                      {AUDIO_LANGUAGE_OPTIONS.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                    {!isPresetAudioLanguage(currentSource?.audioLanguage) && (
                      <input
                        type="text"
                        value={currentSource?.audioLanguage || ''}
                        onChange={(e) => setCurrentSource({ ...currentSource, audioLanguage: e.target.value })}
                        className="w-full bg-black border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-white focus:border-brand outline-none mt-2"
                        placeholder="Informe o idioma (ex: Japonês, Coreano)"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Tipo de Versão
                    </label>
                    <select
                      value={currentSource?.versionType || 'dublado'}
                      onChange={(e) => setCurrentSource({ ...currentSource, versionType: e.target.value })}
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-bold"
                    >
                      {VERSION_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Qualidade</label>
                    <select
                      value={currentSource?.quality || '1080p'}
                      onChange={(e) => setCurrentSource({ ...currentSource, quality: e.target.value })}
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-bold"
                    >
                      {SOURCE_QUALITY_OPTIONS.map((q) => (
                        <option key={q} value={q}>
                          {q === 'Automática'
                            ? 'Automática / Desconhecida'
                            : q === '4K'
                              ? '4K (2160p Ultra HD)'
                              : q === '1440p'
                                ? '1440p (2K QHD)'
                                : q === '1080p'
                                  ? '1080p Full HD'
                                  : q === '720p'
                                    ? '720p HD'
                                    : q}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Legenda Externa (.srt / .vtt) — Opcional
                    </label>
                    <input
                      type="url"
                      value={currentSource?.subtitleUrl || ''}
                      onChange={(e) => setCurrentSource({ ...currentSource, subtitleUrl: e.target.value })}
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white font-mono focus:border-brand outline-none"
                      placeholder="https://.../legenda.srt ou .vtt"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Idioma da Legenda — Opcional
                    </label>
                    <input
                      type="text"
                      value={currentSource?.subtitleLanguage || ''}
                      onChange={(e) => setCurrentSource({ ...currentSource, subtitleLanguage: e.target.value })}
                      className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                      placeholder="Ex: Português, Inglês, Espanhol"
                    />
                  </div>
                </div>

                {savingStatus === 'error' && errorMessage && (
                  <div className="p-3.5 bg-brand/10 border border-brand/30 rounded-xl text-brand text-xs font-bold flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                    {duplicateConflict && !currentSource?.id && (
                      <button
                        type="button"
                        onClick={() => performSaveSource(true)}
                        className="px-3.5 py-2 min-h-[40px] bg-brand hover:bg-brand/90 text-white text-[11px] font-black uppercase tracking-wider rounded-lg shrink-0 transition-all"
                      >
                        Substituir Fonte Existente
                      </button>
                    )}
                  </div>
                )}

                {savingStatus === 'success' && (
                  <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Fonte guardada com sucesso! Atualizando catálogo...</span>
                  </div>
                )}

                <div className="pt-4 flex items-center justify-between border-t border-white/5">
                  <div className="text-[10px] font-mono text-zinc-500">
                    {savingStatus === 'saving' && (
                      <span className="text-amber-400 flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Guardando fonte...
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-6 py-3 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingStatus === 'saving'}
                      className="px-8 py-3 bg-brand hover:bg-brand/90 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-xl shadow-brand/20 disabled:opacity-50 flex items-center gap-2"
                    >
                      {savingStatus === 'saving' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      <span>Guardar Fonte</span>
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Diagnostic Inspection Modal */}
      <AnimatePresence>
        {diagnosticSource && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/85 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-2xl bg-[#0c0c0c] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileCode className="w-5 h-5 text-brand" />
                  <div>
                    <h3 className="text-base font-black text-white uppercase">Diagnóstico Técnico da Fonte</h3>
                    <p className="text-[10px] text-zinc-500 font-mono">{diagnosticSource.serverName}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setDiagnosticSource(null)} className="text-zinc-500 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4 text-xs">
                <div className="bg-black/60 p-3.5 rounded-xl border border-white/10 space-y-1">
                  <span className="text-[9px] uppercase font-black text-zinc-500 block">URL Original</span>
                  <p className="font-mono text-zinc-200 break-all">{diagnosticSource.originalUrl || diagnosticSource.url}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-black/60 p-3 rounded-xl border border-white/10">
                    <span className="text-[9px] uppercase font-black text-zinc-500 block">Tipo Detectado</span>
                    <span className="font-mono text-white">{getSourceKindLabel(diagnosticSource.sourceKind)}</span>
                  </div>
                  <div className="bg-black/60 p-3 rounded-xl border border-white/10">
                    <span className="text-[9px] uppercase font-black text-zinc-500 block">Estado</span>
                    <span className="font-mono text-white">{getStatusDisplayInfo(diagnosticSource.status).label}</span>
                  </div>
                  <div className="bg-black/60 p-3 rounded-xl border border-white/10">
                    <span className="text-[9px] uppercase font-black text-zinc-500 block">Domínio & Caminho</span>
                    <span className="font-mono text-zinc-200">
                      {diagnosticSource.diagnostics?.domain || '—'} {diagnosticSource.diagnostics?.endpointPath || ''}
                    </span>
                  </div>
                  <div className="bg-black/60 p-3 rounded-xl border border-white/10">
                    <span className="text-[9px] uppercase font-black text-zinc-500 block">HTTP / Content-Type</span>
                    <span className="font-mono text-zinc-200">
                      {diagnosticSource.diagnostics?.httpStatus ?? '—'} · {diagnosticSource.diagnostics?.contentType || '—'}
                    </span>
                  </div>
                  <div className="bg-black/60 p-3 rounded-xl border border-white/10">
                    <span className="text-[9px] uppercase font-black text-zinc-500 block">Reprodução Direta</span>
                    <span className="font-mono text-zinc-200">
                      {diagnosticSource.diagnostics?.directPlayable ? 'Compatível' : 'Não direta'}
                    </span>
                  </div>
                  <div className="bg-black/60 p-3 rounded-xl border border-white/10">
                    <span className="text-[9px] uppercase font-black text-zinc-500 block">Incorporação Iframe</span>
                    <span className="font-mono text-zinc-200">
                      {diagnosticSource.diagnostics?.embedAllowed === false ? 'Bloqueada (XFO/CSP)' : 'Permitida'}
                    </span>
                  </div>
                </div>

                {diagnosticSource.diagnostics?.hasUrlParam && (
                  <div className="bg-black/60 p-3.5 rounded-xl border border-white/10 space-y-1">
                    <span className="text-[9px] uppercase font-black text-zinc-500 block">URL Interna (?url=)</span>
                    <p className="font-mono text-zinc-300 break-all">{diagnosticSource.diagnostics.nestedUrl}</p>
                  </div>
                )}

                {diagnosticSource.verificationResult && (
                  <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-zinc-200">
                    {diagnosticSource.verificationResult}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const target = diagnosticSource;
                      setDiagnosticSource(null);
                      openPlayTest(target);
                    }}
                    className="px-4 py-2 bg-brand text-white text-xs font-black uppercase rounded-xl flex items-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Reproduzir Teste</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiagnosticSource(null)}
                    className="px-4 py-2 bg-white/10 text-white text-xs font-black uppercase rounded-xl"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Play Test Modal */}
      <AnimatePresence>
        {playTestSource && (
          <div className="fixed inset-0 z-[115] flex items-center justify-center p-4 sm:p-6 bg-black/90 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-4xl bg-[#0c0c0c] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-black text-white uppercase">
                      Teste de Reprodução — {playTestSource.serverName}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                        playTestDiag.status === 'confirmed'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : playTestDiag.status === 'format_error' || playTestDiag.status === 'connection_error'
                            ? 'bg-red-500/20 text-red-300 border border-[#E50914]/40'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {playTestDiag.status === 'confirmed'
                        ? 'REPRODUÇÃO CONFIRMADA'
                        : playTestDiag.status === 'format_error'
                          ? 'ERRO DE FORMATO'
                          : playTestDiag.status === 'connection_error'
                            ? 'ERRO DE CONEXÃO'
                            : 'TESTE EM ANDAMENTO'}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-zinc-400 truncate max-w-xl mt-0.5">
                    {playTestSource.originalUrl || playTestSource.url}
                  </p>
                  <p className="text-[11px] text-zinc-300 mt-0.5">{playTestDiag.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPlayTestSource(null)}
                  className="p-2 text-zinc-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="aspect-video bg-black">
                <ErrorBoundary fallbackTitle="Erro ao testar reprodução" resetKey={playTestSource.id}>
                  <RonycinePlayer
                    sources={[
                      {
                        id: playTestSource.id,
                        url: playTestSource.url,
                        originalUrl: playTestSource.originalUrl || playTestSource.url,
                        format: playTestSource.format || classifySourceUrl(playTestSource.url).suggestedFormat,
                        sourceKind: playTestSource.sourceKind || classifySourceUrl(playTestSource.url).sourceKind,
                        serverName: playTestSource.serverName,
                        audioLanguage: playTestSource.audioLanguage,
                        versionType: playTestSource.versionType,
                        subtitleUrl: playTestSource.subtitleUrl,
                        subtitleLanguage: playTestSource.subtitleLanguage,
                        quality: playTestSource.quality,
                        diagnostics: playTestSource.diagnostics,
                        isPrimary: true
                      }
                    ]}
                    title={playTestSource.serverName}
                    autoplay={true}
                    onPlaybackEvent={(status, message) => {
                      if (status === 'STARTED') {
                        setPlayTestDiag({
                          status: 'confirmed',
                          message: 'Stream inicializado e pronto no navegador.'
                        });
                      } else {
                        const lower = (message || '').toLowerCase();
                        setPlayTestDiag({
                          status:
                            lower.includes('formato') || lower.includes('descodificar') || lower.includes('html')
                              ? 'format_error'
                              : 'connection_error',
                          message: message || 'Erro ao iniciar reprodução.'
                        });
                      }
                    }}
                  />
                </ErrorBoundary>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
