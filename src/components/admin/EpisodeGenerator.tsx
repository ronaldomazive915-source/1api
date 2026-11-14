import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Tv,
  Film,
  Zap,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  Play,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Save,
  Bookmark,
  Layers,
  ChevronRight,
  Info,
  X,
  Star,
  Power
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  MediaItem,
  Season,
  SeasonSourceTemplate,
  TmdbSearchResult,
  VideoSource
} from '../../types.js';
import { MgebUrlField } from './MgebUrlField.js';
import {
  MGEB_PREFIX,
  generateEpisodeLinks,
  stripMgebPrefix
} from '../../lib/mgebUtils.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';
import { RonycinePlayer } from '../player/RonycinePlayer.js';
import { ErrorBoundary } from '../ErrorBoundary.js';

interface EpisodeGeneratorProps {
  catalogSeries: MediaItem[];
  existingSources: VideoSource[];
  preselectedSeriesId?: number;
  onSourcesSaved: () => void;
}

interface LinkValidationState {
  status: 'idle' | 'testing' | 'online' | 'offline' | 'unverifiable' | 'embed_blocked' | 'unsupported_format';
  message?: string;
}

export const EpisodeGenerator: React.FC<EpisodeGeneratorProps> = ({
  catalogSeries,
  existingSources,
  preselectedSeriesId,
  onSourcesSaved
}) => {
  // Series search & selection
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedSeries, setSelectedSeries] = useState<MediaItem | null>(null);
  const [existsInCatalog, setExistsInCatalog] = useState<boolean>(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Season & episode range config
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);
  const [startEpisode, setStartEpisode] = useState<number>(1);
  const [episodeCount, setEpisodeCount] = useState<number>(8);
  const [seasonEpisodesMeta, setSeasonEpisodesMeta] = useState<Record<number, any>>({});
  const [seasonTemplates, setSeasonTemplates] = useState<Record<number, SeasonSourceTemplate>>({});
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);

  // First URL & MGEB settings (stored cleanly per active season)
  const [firstLinkUrl, setFirstLinkUrl] = useState<string>('');
  const [useMgebPrefix, setUseMgebPrefix] = useState<boolean>(true);
  const [serverName, setServerName] = useState<string>('MGEB Endpoint');
  const [format, setFormat] = useState<string>('php_endpoint');
  const [audioLanguage, setAudioLanguage] = useState<string>('Português');
  const [quality, setQuality] = useState<string>('1080p');
  const [isPrimary, setIsPrimary] = useState<boolean>(true);
  const [priority, setPriority] = useState<number>(1);
  const [enabled, setEnabled] = useState<boolean>(true);

  // Preview, clipboard, validation & saving
  const [previewNonce, setPreviewNonce] = useState<number>(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [validations, setValidations] = useState<Record<number, LinkValidationState>>({});
  const [testingBatch, setTestingBatch] = useState(false);
  const [playTestEpisode, setPlayTestEpisode] = useState<{ episodeNumber: number; url: string; title?: string } | null>(null);

  // Confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [conflictMode, setConflictMode] = useState<'skip' | 'add_alternative' | 'overwrite'>('skip');
  const [savingBatch, setSavingBatch] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectSeriesById = async (tmdbId: number, fallbackItem?: Partial<MediaItem>) => {
    setLoadingDetails(true);
    setSaveFeedback(null);
    setTemplateNotice(null);
    setValidations({});
    const localMatch = catalogSeries.find(m => Number(m.tmdbId) === Number(tmdbId));
    setExistsInCatalog(Boolean(localMatch));

    try {
      const [detailsRes, templatesRes] = await Promise.all([
        api.getTmdbDetails(tmdbId, 'tv').catch(() => null),
        api.getSeasonSourceTemplates(tmdbId).catch(() => ({ success: false, templates: [] }))
      ]);

      const tmplMap: Record<number, SeasonSourceTemplate> = {};
      for (const t of templatesRes?.templates || []) {
        tmplMap[Number(t.seasonNumber)] = t;
      }
      setSeasonTemplates(tmplMap);

      const resolvedSeries: MediaItem | null = detailsRes?.item
        ? {
            ...(localMatch || {}),
            ...detailsRes.item,
            seasons:
              Array.isArray(detailsRes.item.seasons) && detailsRes.item.seasons.length > 0
                ? detailsRes.item.seasons
                : localMatch?.seasons || []
          }
        : localMatch || (fallbackItem ? ({ ...fallbackItem, tmdbId, type: 'tv' } as MediaItem) : null);

      if (detailsRes?.existsInCatalog !== undefined) {
        setExistsInCatalog(Boolean(detailsRes.existsInCatalog));
      }

      if (resolvedSeries) {
        setSelectedSeries(resolvedSeries);
        const usableSeasons = (resolvedSeries.seasons || []).filter(s => Number(s.seasonNumber) > 0);
        const firstSeason = usableSeasons[0] || resolvedSeries.seasons?.[0];
        const initialSeasonNum = firstSeason ? Number(firstSeason.seasonNumber) : 1;
        applySeasonSelection(initialSeasonNum, resolvedSeries, tmplMap);
      }
    } finally {
      setLoadingDetails(false);
    }
  };

  const applySeasonSelection = async (
    seasonNum: number,
    seriesOverride?: MediaItem | null,
    templatesOverride?: Record<number, SeasonSourceTemplate>
  ) => {
    const targetSeries = seriesOverride || selectedSeries;
    const tmpls = templatesOverride || seasonTemplates;
    setSelectedSeasonNum(seasonNum);
    setStartEpisode(1);
    setValidations({});
    setSaveFeedback(null);

    const seasonObj = (targetSeries?.seasons || []).find(s => Number(s.seasonNumber) === Number(seasonNum));
    const realCount = Number(seasonObj?.episodeCount || seasonObj?.episodes?.length || 0);
    setEpisodeCount(realCount > 0 ? realCount : 1);

    const savedTmpl = tmpls[seasonNum];
    if (savedTmpl) {
      setFirstLinkUrl(savedTmpl.baseUrl || '');
      setUseMgebPrefix(savedTmpl.useMgebPrefix !== false);
      if (savedTmpl.serverName) setServerName(savedTmpl.serverName);
      if (savedTmpl.format) setFormat(savedTmpl.format);
      if (savedTmpl.audioLanguage) setAudioLanguage(savedTmpl.audioLanguage);
      if (savedTmpl.quality) setQuality(savedTmpl.quality);
      setTemplateNotice(`Modelo salvo da Temporada ${seasonNum} carregado automaticamente.`);
    } else {
      setFirstLinkUrl('');
      setUseMgebPrefix(true);
      setTemplateNotice(null);
    }

    // Read-only metadata lookup for episode titles (never imports to DB!)
    if (targetSeries?.tmdbId) {
      try {
        const sData = await api.getTmdbSeasonEpisodes(Number(targetSeries.tmdbId), seasonNum);
        const epMap: Record<number, any> = {};
        for (const ep of sData?.episodes || []) {
          epMap[Number(ep.episodeNumber)] = ep;
        }
        setSeasonEpisodesMeta(epMap);
        if (Array.isArray(sData?.episodes) && sData.episodes.length > 0 && realCount === 0) {
          setEpisodeCount(sData.episodes.length);
        }
      } catch {
        const localEpMap: Record<number, any> = {};
        for (const ep of seasonObj?.episodes || []) {
          localEpMap[Number(ep.episodeNumber)] = ep;
        }
        setSeasonEpisodesMeta(localEpMap);
      }
    }
  };

  useEffect(() => {
    if (preselectedSeriesId) {
      selectSeriesById(preselectedSeriesId);
    } else if (!selectedSeries && catalogSeries.length > 0) {
      const firstCat = catalogSeries[0];
      if (firstCat?.tmdbId) selectSeriesById(Number(firstCat.tmdbId), firstCat);
    }
  }, [preselectedSeriesId]);

  const handleSearchSeries = async (qOverride?: string) => {
    const q = (qOverride !== undefined ? qOverride : searchQuery).trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await api.searchTmdb(q, 'tv');
      setSearchResults(res.results || []);
    } catch {
      // Fallback to local catalog search if TMDB key is unavailable
      const lower = q.toLowerCase();
      const localHits: TmdbSearchResult[] = catalogSeries
        .filter(
          m =>
            (m.title || '').toLowerCase().includes(lower) ||
            String(m.tmdbId || '') === q
        )
        .map(m => ({
          tmdbId: Number(m.tmdbId),
          title: m.title,
          type: 'tv',
          posterPath: m.posterPath,
          firstAirDate: m.firstAirDate,
          voteAverage: m.voteAverage,
          overview: m.overview,
          existsInCatalog: true,
          existingMediaItem: m
        }));
      setSearchResults(localHits);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchInput = (val: string) => {
    setSearchQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      handleSearchSeries(val);
    }, 380);
  };

  const selectedSeasonObj: Season | undefined = useMemo(() => {
    return (selectedSeries?.seasons || []).find(s => Number(s.seasonNumber) === Number(selectedSeasonNum));
  }, [selectedSeries, selectedSeasonNum]);

  const endEpisode = useMemo(() => {
    return Math.max(startEpisode, startEpisode + Math.max(1, episodeCount) - 1);
  }, [startEpisode, episodeCount]);

  // Real-time automatic episode link generator
  const generatedResult = useMemo(() => {
    if (!firstLinkUrl.trim()) {
      return { valid: false, error: undefined, links: [] };
    }
    return generateEpisodeLinks({
      firstLink: firstLinkUrl,
      useMgebPrefix,
      startEpisode,
      episodeCount
    });
  }, [firstLinkUrl, useMgebPrefix, startEpisode, episodeCount, previewNonce]);

  // Existing sources map per episode for current series + season
  const existingEpisodeSourcesMap = useMemo(() => {
    const map: Record<number, VideoSource[]> = {};
    if (!selectedSeries?.tmdbId) return map;
    for (const s of existingSources) {
      const normType = s.contentType === 'series' ? 'tv' : s.contentType;
      if (
        Number(s.contentId) === Number(selectedSeries.tmdbId) &&
        normType === 'tv' &&
        Number(s.seasonNumber || 1) === Number(selectedSeasonNum)
      ) {
        const epNum = Number(s.episodeNumber || 1);
        if (!map[epNum]) map[epNum] = [];
        map[epNum].push(s);
      }
    }
    return map;
  }, [existingSources, selectedSeries?.tmdbId, selectedSeasonNum]);

  const conflictingEpisodes = useMemo(() => {
    return generatedResult.links.filter(l => (existingEpisodeSourcesMap[l.episodeNumber] || []).length > 0);
  }, [generatedResult.links, existingEpisodeSourcesMap]);

  const copyText = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleCopyAllLinks = () => {
    if (!generatedResult.valid || generatedResult.links.length === 0) return;
    const allText = generatedResult.links.map(l => l.url).join('\n');
    copyText(allText, 'all-links');
  };

  const handleTestSingleEpisode = async (epNum: number, url: string) => {
    setValidations(prev => ({ ...prev, [epNum]: { status: 'testing' } }));
    try {
      const res = await api.verifySourceLink(url, format);
      setValidations(prev => ({
        ...prev,
        [epNum]: {
          status: (res.status as any) || 'unverifiable',
          message: res.message
        }
      }));
    } catch (err: any) {
      setValidations(prev => ({
        ...prev,
        [epNum]: {
          status: 'unverifiable',
          message:
            err?.message ||
            'Não foi possível confirmar a reprodução automaticamente. A fonte necessita de teste no player.'
        }
      }));
    }
  };

  const handleTestAllLinks = async () => {
    if (!generatedResult.valid || generatedResult.links.length === 0) return;
    setTestingBatch(true);
    const pendingState: Record<number, LinkValidationState> = {};
    for (const l of generatedResult.links) {
      pendingState[l.episodeNumber] = { status: 'testing' };
    }
    setValidations(pendingState);

    try {
      const res = await api.verifyBatchSourceLinks(
        generatedResult.links.map(l => ({ episodeNumber: l.episodeNumber, url: l.url }))
      );
      const nextState: Record<number, LinkValidationState> = {};
      for (const item of res.results || []) {
        nextState[item.episodeNumber] = {
          status: (item.probe?.status as any) || 'unverifiable',
          message: item.probe?.message
        };
      }
      setValidations(nextState);
    } catch (err: any) {
      const errState: Record<number, LinkValidationState> = {};
      for (const l of generatedResult.links) {
        errState[l.episodeNumber] = {
          status: 'unverifiable',
          message:
            err?.message ||
            'Não foi possível confirmar a reprodução automaticamente. A fonte necessita de teste no player.'
        };
      }
      setValidations(errState);
    } finally {
      setTestingBatch(false);
    }
  };

  const handleSaveSeasonTemplateOnly = async () => {
    if (!selectedSeries?.tmdbId || !firstLinkUrl.trim()) return;
    setSavingTemplate(true);
    setTemplateNotice(null);
    try {
      const res = await api.saveSeasonSourceTemplate({
        contentId: Number(selectedSeries.tmdbId),
        seasonNumber: selectedSeasonNum,
        baseUrl: firstLinkUrl.trim(),
        useMgebPrefix,
        serverName,
        format,
        audioLanguage,
        quality
      });
      setSeasonTemplates(prev => ({ ...prev, [selectedSeasonNum]: res.template }));
      setTemplateNotice(`Modelo da Temporada ${selectedSeasonNum} guardado para continuar mais tarde.`);
    } catch (err: any) {
      setTemplateNotice(err?.message || 'Erro ao guardar modelo da temporada.');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleConfirmSaveBatch = async () => {
    if (!selectedSeries?.tmdbId || !generatedResult.valid || generatedResult.links.length === 0) return;
    setSavingBatch(true);
    setSaveFeedback(null);

    try {
      const res = await api.saveBatchEpisodeSources({
        contentId: Number(selectedSeries.tmdbId),
        seasonNumber: selectedSeasonNum,
        seasonBaseUrl: firstLinkUrl.trim(),
        useMgebPrefix,
        serverName: serverName.trim() || 'MGEB Endpoint',
        format,
        audioLanguage,
        quality,
        isPrimary,
        priority,
        enabled,
        conflictMode,
        episodes: generatedResult.links.map(l => {
          const meta = seasonEpisodesMeta[l.episodeNumber];
          const valState = validations[l.episodeNumber];
          return {
            episodeNumber: l.episodeNumber,
            url: l.url,
            title: meta?.title,
            overview: meta?.overview,
            stillPath: meta?.stillPath,
            duration: meta?.duration,
            airDate: meta?.airDate,
            voteAverage: meta?.voteAverage,
            status: valState && valState.status !== 'idle' && valState.status !== 'testing' ? valState.status : 'registered'
          };
        })
      });

      setShowConfirmModal(false);
      setSaveFeedback({ type: 'success', text: res.message });
      onSourcesSaved();
    } catch (err: any) {
      setShowConfirmModal(false);
      setSaveFeedback({ type: 'error', text: err?.message || 'Erro ao guardar episódios.' });
    } finally {
      setSavingBatch(false);
    }
  };

  const renderValidationBadge = (epNum: number) => {
    const state = validations[epNum];
    if (!state || state.status === 'idle') {
      return <span className="text-[11px] font-medium text-zinc-500">Não testado</span>;
    }
    if (state.status === 'testing') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400">
          <RefreshCw className="w-3 h-3 animate-spin" />A testar...
        </span>
      );
    }
    if (state.status === 'online') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400" title={state.message}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          Confirmado
        </span>
      );
    }
    if (state.status === 'offline' || state.status === 'embed_blocked' || state.status === 'unsupported_format') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400" title={state.message}>
          <XCircle className="w-3.5 h-3.5" />
          {state.status === 'embed_blocked' ? 'Embed bloqueado' : state.status === 'unsupported_format' ? 'Formato incompatível' : 'Offline'}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400" title={state.message}>
        <HelpCircle className="w-3.5 h-3.5" />
        Necessita teste no player
      </span>
    );
  };

  const seasonsList = useMemo(() => {
    const raw = selectedSeries?.seasons || [];
    return [...raw].sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));
  }, [selectedSeries]);

  const handleNextSeason = () => {
    if (!seasonsList.length) {
      applySeasonSelection(selectedSeasonNum + 1);
      return;
    }
    const idx = seasonsList.findIndex(s => Number(s.seasonNumber) === Number(selectedSeasonNum));
    if (idx >= 0 && idx + 1 < seasonsList.length) {
      applySeasonSelection(Number(seasonsList[idx + 1].seasonNumber));
    } else {
      applySeasonSelection(selectedSeasonNum + 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Main 2-Column Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Series Selection + Season Config + First Link */}
        <div className="xl:col-span-7 space-y-5 min-w-0">
          {/* 3.1 Selecionar Série */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-black text-white tracking-tight flex items-center gap-2">
                  <Tv className="w-4 h-4 text-[#E50914]" />
                  RONYCINE EPISODE GENERATOR
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Pesquisa TMDB apenas para metadados de temporadas — importação continua 100% manual.
                </p>
              </div>
              {loadingDetails && (
                <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E50914]" />A carregar metadados...
                </span>
              )}
            </div>

            {/* Search Input */}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSearchSeries())}
                  placeholder="Pesquisar série por nome ou TMDB ID (ex: Lanterns, Game of Thrones, 1399)..."
                  className="w-full bg-black border border-white/15 focus:border-[#E50914] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => handleSearchSeries()}
                disabled={isSearching}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
              >
                {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Pesquisar TMDB</span>
              </button>
            </div>

            {/* Quick Select from Local Catalog */}
            {catalogSeries.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-zinc-500">Séries no catálogo local:</span>
                <div className="flex flex-wrap gap-1.5">
                  {catalogSeries.slice(0, 8).map(cs => {
                    const isSelected = Number(selectedSeries?.tmdbId) === Number(cs.tmdbId);
                    return (
                      <button
                        key={cs.id}
                        type="button"
                        onClick={() => selectSeriesById(Number(cs.tmdbId), cs)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          isSelected
                            ? 'bg-[#E50914] border-[#E50914] text-white'
                            : 'bg-black/70 border-white/10 text-zinc-300 hover:border-white/25 hover:text-white'
                        }`}
                      >
                        {cs.title} ({cs.tmdbId})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pt-1">
                {searchResults.map(item => (
                  <button
                    key={`${item.type}-${item.tmdbId}`}
                    type="button"
                    onClick={() => {
                      selectSeriesById(item.tmdbId, item as any);
                      setSearchResults([]);
                    }}
                    className="text-left bg-black/80 hover:bg-zinc-900 border border-white/10 hover:border-[#E50914] rounded-xl p-2.5 flex items-center gap-3 transition-colors"
                  >
                    <div className="w-10 h-14 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-white/10">
                      {item.posterPath ? (
                        <img
                          src={resolveTmdbPosterUrl(item.posterPath, 'w185')}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600">
                          <Tv className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">{item.title}</p>
                      <p className="text-[11px] font-mono text-zinc-400">
                        TMDB: {item.tmdbId} · {item.firstAirDate ? item.firstAirDate.slice(0, 4) : '—'}
                      </p>
                      <p className={`text-[11px] font-semibold mt-0.5 ${item.existsInCatalog ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {item.existsInCatalog ? 'No catálogo local' : 'Apenas consulta TMDB'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Selected Series Card + Selectable Season List */}
            {selectedSeries && (
              <div className="bg-black/70 border border-white/10 rounded-xl p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="w-14 h-20 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-white/10">
                    {selectedSeries.posterPath ? (
                      <img
                        src={resolveTmdbPosterUrl(selectedSeries.posterPath, 'w185')}
                        alt={selectedSeries.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600">
                        <Film className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h4 className="text-base font-black text-white truncate">{selectedSeries.title}</h4>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 tabular-nums">
                      <span className="font-mono">TMDB ID: {selectedSeries.tmdbId}</span>
                      <span aria-hidden="true">·</span>
                      <span>{seasonsList.filter(s => Number(s.seasonNumber) > 0).length || selectedSeries.seasonsCount || 0} temporadas</span>
                      {selectedSeries.tmdbStatus && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Estado TMDB: {selectedSeries.tmdbStatus}</span>
                        </>
                      )}
                    </div>
                    <p className={`text-xs font-semibold ${existsInCatalog ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {existsInCatalog
                        ? 'Série presente no catálogo local RONYCINE — pronta para associar episódios e fontes.'
                        : 'Série apenas consultada no TMDB. Importe-a manualmente no Importador TMDB antes de guardar episódios.'}
                    </p>
                  </div>
                </div>

                {/* Seasons List */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                    Selecionar Temporada
                  </span>
                  {seasonsList.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {seasonsList.map(season => {
                        const sNum = Number(season.seasonNumber);
                        const isActive = sNum === selectedSeasonNum;
                        const epCountReal = Number(season.episodeCount ?? season.episodes?.length ?? 0);
                        const hasSavedTemplate = Boolean(seasonTemplates[sNum]?.baseUrl);
                        const seasonSavedSourcesCount = existingSources.filter(
                          src =>
                            Number(src.contentId) === Number(selectedSeries.tmdbId) &&
                            (src.contentType === 'tv' || src.contentType === 'series') &&
                            Number(src.seasonNumber || 1) === sNum
                        ).length;

                        return (
                          <button
                            key={sNum}
                            type="button"
                            onClick={() => applySeasonSelection(sNum)}
                            className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                              isActive
                                ? 'bg-[#E50914]/15 border-[#E50914] text-white'
                                : 'bg-[#111114] border-white/10 text-zinc-300 hover:border-white/25 hover:text-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold truncate">
                                {sNum === 0 ? 'Especiais' : `Temporada ${sNum}`}
                              </span>
                              {hasSavedTemplate && (
                                <Bookmark className="w-3 h-3 text-emerald-400 shrink-0" title="Modelo de URL salvo" />
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 tabular-nums mt-0.5">
                              {epCountReal > 0 ? `${epCountReal} episódios` : 'Sem episódios anunciados'}
                              {seasonSavedSourcesCount > 0 ? ` · ${seasonSavedSourcesCount} fontes` : ''}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-400">
                      Nenhuma temporada anunciada nos metadados disponíveis. Pode ajustar o número da temporada manualmente abaixo.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3.2 Configuração da Temporada & Primeiro Link */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Configuração da Temporada & Primeiro Link
              </h3>
              <button
                type="button"
                onClick={handleSaveSeasonTemplateOnly}
                disabled={savingTemplate || !selectedSeries?.tmdbId || !firstLinkUrl.trim()}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-[11px] font-bold text-zinc-200 hover:text-white flex items-center gap-1.5 disabled:opacity-40"
              >
                {savingTemplate ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5 text-emerald-400" />}
                <span>Guardar URL desta Temporada</span>
              </button>
            </div>

            {selectedSeasonObj && Number(selectedSeasonObj.episodeCount ?? 0) === 0 && (
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Esta temporada ainda não tem episódios anunciados no TMDB. Nenhum episódio foi inventado; defina apenas se tiver um intervalo confirmado.
                </span>
              </div>
            )}

            {templateNotice && (
              <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{templateNotice}</span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase">Temporada</label>
                <input
                  type="number"
                  min={0}
                  value={selectedSeasonNum}
                  onChange={(e) => applySeasonSelection(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-black border border-white/15 focus:border-[#E50914] rounded-xl px-3 py-2 text-sm font-mono text-white outline-none tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase">Episódio Inicial</label>
                <input
                  type="number"
                  min={1}
                  value={startEpisode}
                  onChange={(e) => setStartEpisode(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full bg-black border border-white/15 focus:border-[#E50914] rounded-xl px-3 py-2 text-sm font-mono text-white outline-none tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase">Total Episódios</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={episodeCount}
                  onChange={(e) => setEpisodeCount(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
                  className="w-full bg-black border border-white/15 focus:border-[#E50914] rounded-xl px-3 py-2 text-sm font-mono text-white outline-none tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase">Último Episódio</label>
                <div className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-sm font-mono text-emerald-400 font-bold tabular-nums">
                  {endEpisode}
                </div>
              </div>
            </div>

            {/* MGEB Prefix + First Link Input */}
            <MgebUrlField
              label={`Primeiro Link da Temporada ${selectedSeasonNum}`}
              value={firstLinkUrl}
              useMgebPrefix={useMgebPrefix}
              onToggleMgebPrefix={setUseMgebPrefix}
              onChangeUrl={(finalUrl) => setFirstLinkUrl(finalUrl)}
              placeholder="https://ver.123pelicula.com/pt/detail/drama/4HZYF41zZ0zPPiRb0OsGi-Lanterns/1"
              helperText="Cole apenas o endereço do 1º episódio da temporada. O sistema altera exclusivamente o último segmento numérico (/1, /2, ..., /N) preservando domínio, ID e nome da série."
            />

            {/* Generator Segment Validation Feedback */}
            {firstLinkUrl.trim() && !generatedResult.valid && generatedResult.error && (
              <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-xs text-red-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Geração automática bloqueada</p>
                  <p className="mt-0.5">{generatedResult.error}</p>
                </div>
              </div>
            )}

            {generatedResult.valid && generatedResult.basePattern && (
              <div className="p-3 rounded-xl bg-black/70 border border-white/10 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                  Padrão Detetado (Segmento Inicial: {generatedResult.detectedStartSegment})
                </span>
                <code className="text-xs font-mono text-zinc-200 break-all block">
                  {generatedResult.basePattern}
                </code>
              </div>
            )}

            {/* Common Source Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase">Nome do Servidor</label>
                <input
                  type="text"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  className="w-full bg-black border border-white/15 focus:border-[#E50914] rounded-xl px-3 py-2 text-xs text-white outline-none font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase">Formato</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full bg-black border border-white/15 focus:border-[#E50914] rounded-xl px-3 py-2 text-xs text-white outline-none font-semibold"
                >
                  <option value="php_endpoint">Endpoint PHP (MGEB)</option>
                  <option value="mp4">MP4 Direto</option>
                  <option value="m3u8">M3U8 / HLS</option>
                  <option value="dash">DASH (.mpd)</option>
                  <option value="embed">Embed / Iframe</option>
                  <option value="iframe">Iframe Player</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase">Idioma & Qualidade</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    value={audioLanguage}
                    onChange={(e) => setAudioLanguage(e.target.value)}
                    className="w-full bg-black border border-white/15 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                    placeholder="Áudio"
                  />
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className="w-full bg-black border border-white/15 rounded-xl px-2 py-2 text-xs text-white outline-none"
                  >
                    <option value="1080p">1080p</option>
                    <option value="4K">4K</option>
                    <option value="720p">720p</option>
                    <option value="Automática">Auto</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-black/60 border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                  className="w-4 h-4 accent-[#E50914]"
                />
                <Star className={`w-4 h-4 ${isPrimary ? 'text-amber-400 fill-amber-400' : 'text-zinc-500'}`} />
                <span className="text-xs font-bold text-white">Fonte principal</span>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-black/60 border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
                <Power className={`w-4 h-4 ${enabled ? 'text-emerald-400' : 'text-zinc-500'}`} />
                <span className="text-xs font-bold text-white">Fontes ativas</span>
              </label>

              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-black/60 border border-white/10">
                <span className="text-xs font-bold text-zinc-300">Prioridade</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={priority}
                  onChange={(e) => setPriority(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-16 bg-black border border-white/15 rounded-lg px-2 py-1 text-xs font-mono text-white text-center"
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: How it Works + Season Summary + Live Generated Links Preview */}
        <div className="xl:col-span-5 space-y-5 min-w-0">
          {/* Como Funciona */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-4 space-y-2.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
              <Info className="w-4 h-4 text-[#E50914]" />
              Como Funciona
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-xs text-zinc-400">
              <li>Selecione a série e escolha a temporada com episódios reais.</li>
              <li>Cole apenas o link do primeiro episódio com o prefixo MGEB ativo.</li>
              <li>Revise e teste os links gerados em tempo real na pré-visualização.</li>
              <li>Clique em <strong className="text-white">Guardar Episódios</strong> e escolha o modo para conflitos existentes.</li>
            </ol>
          </div>

          {/* Resumo da Temporada */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-4 space-y-2.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-white">Resumo da Temporada</h4>
            <div className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
              <div className="bg-black/60 border border-white/10 rounded-xl p-2.5">
                <span className="text-[10px] text-zinc-500 uppercase block">Série / Temporada</span>
                <span className="font-bold text-white truncate block">
                  {selectedSeries ? `${selectedSeries.title} · T${selectedSeasonNum}` : 'Nenhuma selecionada'}
                </span>
              </div>
              <div className="bg-black/60 border border-white/10 rounded-xl p-2.5">
                <span className="text-[10px] text-zinc-500 uppercase block">Intervalo de Episódios</span>
                <span className="font-bold text-white font-mono">
                  E{String(startEpisode).padStart(2, '0')} → E{String(endEpisode).padStart(2, '0')} ({episodeCount})
                </span>
              </div>
              <div className="bg-black/60 border border-white/10 rounded-xl p-2.5">
                <span className="text-[10px] text-zinc-500 uppercase block">Links Prontos</span>
                <span className="font-bold text-emerald-400 font-mono">{generatedResult.links.length}</span>
              </div>
              <div className="bg-black/60 border border-white/10 rounded-xl p-2.5">
                <span className="text-[10px] text-zinc-500 uppercase block">Episódios c/ Fonte</span>
                <span className={`font-bold font-mono ${conflictingEpisodes.length > 0 ? 'text-amber-400' : 'text-zinc-300'}`}>
                  {conflictingEpisodes.length} existentes
                </span>
              </div>
            </div>
          </div>

          {/* PRÉ-VISUALIZAÇÃO DOS LINKS */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between gap-2 bg-white/[0.02]">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#E50914]" />
                  PRÉ-VISUALIZAÇÃO DOS LINKS
                </h4>
                <p className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">
                  {generatedResult.valid
                    ? `${generatedResult.links.length} episódios prontos na Temporada ${selectedSeasonNum}`
                    : 'Cole o primeiro link terminado em número para gerar'}
                </p>
              </div>
              {generatedResult.valid && generatedResult.links.length > 0 && (
                <button
                  type="button"
                  onClick={handleCopyAllLinks}
                  className="px-2.5 py-1.5 bg-white/5 hover:bg-white/15 border border-white/10 rounded-lg text-[11px] font-bold text-zinc-200 flex items-center gap-1 shrink-0"
                >
                  {copiedKey === 'all-links' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'all-links' ? 'Copiados' : 'Copiar Todos'}</span>
                </button>
              )}
            </div>

            <div className="max-h-[460px] overflow-y-auto divide-y divide-white/5">
              {generatedResult.valid && generatedResult.links.length > 0 ? (
                generatedResult.links.map(item => {
                  const epMeta = seasonEpisodesMeta[item.episodeNumber];
                  const existingForEp = existingEpisodeSourcesMap[item.episodeNumber] || [];
                  const hasConflict = existingForEp.length > 0;

                  return (
                    <div key={item.episodeNumber} className="p-3.5 space-y-2 hover:bg-white/[0.02]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-black font-mono text-white tabular-nums">
                            Episódio {String(item.episodeNumber).padStart(2, '0')}
                          </span>
                          {epMeta?.title && (
                            <span className="text-[11px] text-zinc-400 truncate max-w-[180px]" title={epMeta.title}>
                              · {epMeta.title}
                            </span>
                          )}
                          {hasConflict && (
                            <span className="text-[10px] font-bold text-amber-400">
                              · Já tem {existingForEp.length} fonte(s)
                            </span>
                          )}
                        </div>
                        {renderValidationBadge(item.episodeNumber)}
                      </div>

                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-black border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-emerald-400 truncate">
                          {item.url}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyText(item.url, `ep-${item.episodeNumber}`)}
                          className="p-1.5 bg-white/5 hover:bg-white/15 border border-white/10 rounded-lg text-zinc-300 hover:text-white shrink-0"
                          title="Copiar link"
                        >
                          {copiedKey === `ep-${item.episodeNumber}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTestSingleEpisode(item.episodeNumber, item.url)}
                          disabled={validations[item.episodeNumber]?.status === 'testing'}
                          className="p-1.5 bg-white/5 hover:bg-white/15 border border-white/10 rounded-lg text-zinc-300 hover:text-white shrink-0"
                          title="Testar este link"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPlayTestEpisode({
                              episodeNumber: item.episodeNumber,
                              url: item.url,
                              title: epMeta?.title
                            })
                          }
                          className="p-1.5 bg-[#E50914]/15 hover:bg-[#E50914] border border-[#E50914]/30 rounded-lg text-[#E50914] hover:text-white shrink-0"
                          title="Testar no Player"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                      </div>

                      {validations[item.episodeNumber]?.message && (
                        <p className="text-[10px] text-zinc-400 leading-snug">
                          {validations[item.episodeNumber].message}
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-10 text-center space-y-2 text-zinc-500">
                  <Zap className="w-8 h-8 mx-auto opacity-30" />
                  <p className="text-xs font-semibold">Pré-visualização vazia</p>
                  <p className="text-[11px] max-w-xs mx-auto">
                    Cole um endereço válido terminado com o número do episódio (ex:{' '}
                    <code className="text-zinc-300">{MGEB_PREFIX}https://.../1</code>).
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {saveFeedback && (
        <div
          className={`p-4 rounded-xl border text-xs font-bold flex items-center gap-2.5 ${
            saveFeedback.type === 'success'
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : 'bg-red-950/30 border-red-500/30 text-red-300'
          }`}
        >
          {saveFeedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{saveFeedback.text}</span>
        </div>
      )}

      {/* Footer Action Bar */}
      <div className="bg-[#111114] border border-white/10 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewNonce(n => n + 1)}
            disabled={!firstLinkUrl.trim()}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-zinc-200 rounded-xl flex items-center gap-1.5 disabled:opacity-40"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Atualizar Pré-visualização</span>
          </button>

          <button
            type="button"
            onClick={handleTestAllLinks}
            disabled={testingBatch || !generatedResult.valid || generatedResult.links.length === 0}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-zinc-200 rounded-xl flex items-center gap-1.5 disabled:opacity-40"
          >
            {testingBatch ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E50914]" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
            <span>{testingBatch ? 'A testar lote...' : 'Testar Links'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyAllLinks}
            disabled={!generatedResult.valid || generatedResult.links.length === 0}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-zinc-200 rounded-xl flex items-center gap-1.5 disabled:opacity-40"
          >
            {copiedKey === 'all-links' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>Copiar Links</span>
          </button>

          <button
            type="button"
            onClick={handleNextSeason}
            disabled={!selectedSeries}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-zinc-200 rounded-xl flex items-center gap-1.5 disabled:opacity-40"
          >
            <span>Próxima Temporada</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setConflictMode(conflictingEpisodes.length > 0 ? 'skip' : 'skip');
            setShowConfirmModal(true);
          }}
          disabled={!selectedSeries?.tmdbId || !generatedResult.valid || generatedResult.links.length === 0}
          className="px-6 py-2.5 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider rounded-xl flex items-center gap-2 shadow-lg shadow-[#E50914]/25 cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>GUARDAR EPISÓDIOS</span>
        </button>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && selectedSeries && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#111114] border border-white/15 rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-black text-white uppercase tracking-tight">
                Confirmar Gravação de Episódios
              </h3>
              <button type="button" onClick={() => setShowConfirmModal(false)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!existsInCatalog && (
              <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>
                  Esta série ainda não foi importada manualmente no catálogo RONYCINE. Importe-a no Importador TMDB antes de guardar episódios e fontes.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
              <div className="bg-black/70 border border-white/10 rounded-xl p-3 col-span-2">
                <span className="text-[10px] text-zinc-500 uppercase block">Série</span>
                <span className="font-bold text-white text-sm">{selectedSeries.title} (TMDB {selectedSeries.tmdbId})</span>
              </div>
              <div className="bg-black/70 border border-white/10 rounded-xl p-3">
                <span className="text-[10px] text-zinc-500 uppercase block">Temporada</span>
                <span className="font-bold text-white font-mono">Temporada {selectedSeasonNum}</span>
              </div>
              <div className="bg-black/70 border border-white/10 rounded-xl p-3">
                <span className="text-[10px] text-zinc-500 uppercase block">Total de Episódios</span>
                <span className="font-bold text-emerald-400 font-mono">{generatedResult.links.length}</span>
              </div>
              <div className="bg-black/70 border border-white/10 rounded-xl p-3">
                <span className="text-[10px] text-zinc-500 uppercase block">Primeiro Episódio</span>
                <span className="font-bold text-white font-mono">Episódio {startEpisode}</span>
              </div>
              <div className="bg-black/70 border border-white/10 rounded-xl p-3">
                <span className="text-[10px] text-zinc-500 uppercase block">Último Episódio</span>
                <span className="font-bold text-white font-mono">Episódio {endEpisode}</span>
              </div>
            </div>

            {conflictingEpisodes.length > 0 && (
              <div className="space-y-2.5 p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{conflictingEpisodes.length} episódio(s) deste intervalo já possuem fontes guardadas</span>
                </div>
                <div className="space-y-1.5 text-xs text-zinc-300">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="conflictMode"
                      checked={conflictMode === 'skip'}
                      onChange={() => setConflictMode('skip')}
                      className="accent-[#E50914]"
                    />
                    <span>Ignorar episódios existentes (preservar fontes atuais)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="conflictMode"
                      checked={conflictMode === 'add_alternative'}
                      onChange={() => setConflictMode('add_alternative')}
                      className="accent-[#E50914]"
                    />
                    <span>Adicionar como fonte alternativa (sem duplicar URLs iguais)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="conflictMode"
                      checked={conflictMode === 'overwrite'}
                      onChange={() => setConflictMode('overwrite')}
                      className="accent-[#E50914]"
                    />
                    <span>Atualizar / substituir fontes existentes destes episódios</span>
                  </label>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 text-xs font-bold rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmSaveBatch}
                disabled={savingBatch || !existsInCatalog}
                className="px-5 py-2 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-40 text-white text-xs font-black uppercase rounded-xl flex items-center gap-2"
              >
                {savingBatch ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{savingBatch ? 'A guardar...' : 'Confirmar e Guardar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Play Test Modal */}
      {playTestEpisode && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-3xl bg-[#111114] border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-white truncate">
                  Teste — {selectedSeries?.title} · T{selectedSeasonNum} E{playTestEpisode.episodeNumber}
                  {playTestEpisode.title ? ` (${playTestEpisode.title})` : ''}
                </h4>
                <p className="text-[11px] font-mono text-zinc-400 truncate">{playTestEpisode.url}</p>
              </div>
              <button type="button" onClick={() => setPlayTestEpisode(null)} className="text-zinc-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="aspect-video bg-black">
              <ErrorBoundary fallbackTitle="Erro no teste do episódio" resetKey={playTestEpisode.url}>
                <RonycinePlayer
                  sources={[
                    {
                      id: `ep-preview-${playTestEpisode.episodeNumber}`,
                      url: playTestEpisode.url,
                      originalUrl: playTestEpisode.url,
                      format: format as any,
                      serverName,
                      audioLanguage,
                      quality,
                      isPrimary: true
                    }
                  ]}
                  title={`${selectedSeries?.title || 'Série'} • S${String(selectedSeasonNum).padStart(2, '0')}E${String(playTestEpisode.episodeNumber).padStart(2, '0')}`}
                  autoplay={true}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
