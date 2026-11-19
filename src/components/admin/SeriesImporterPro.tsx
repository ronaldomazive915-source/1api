import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Tv,
  Film,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Check,
  ChevronRight,
  ChevronLeft,
  Globe,
  Play,
  ShieldCheck,
  X,
  Star,
  Layers,
  AlertTriangle
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { TmdbSearchResult, SeriesComparisonReport, SeriesSyncJob } from '../../types.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';
import { MGEB_PREFIX, generateEpisodeLinks } from '../../lib/mgebUtils.js';
import { classifySourceUrl } from '../../lib/sourceClassification.js';
import { RonycinePlayer } from '../player/RonycinePlayer.js';
import { ErrorBoundary } from '../ErrorBoundary.js';

interface SeriesImporterProProps {
  onCatalogUpdated?: () => void;
  onViewCatalogItem?: (item: { id?: string; tmdbId: number; type: 'movie' | 'tv'; title: string }) => void;
}

interface FailedEpisodeJob {
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  url: string;
  error: string;
}

type SearchFilterType = 'tv' | 'all' | 'movie';
type PlaybackDiagStatus = 'idle' | 'playing' | 'confirmed' | 'format_error' | 'connection_error';

const EPISODES_PER_PAGE = 25;

export const SeriesImporterPro: React.FC<SeriesImporterProProps> = ({
  onCatalogUpdated,
  onViewCatalogItem
}) => {
  // 5-Step Wizard:
  // 1: Pesquisar | 2: Identificar Série | 3: Temporadas | 4: Episódios e Fontes | 5: Confirmar Importação
  const [step, setStep] = useState<number>(1);
  const [maxVisitedStep, setMaxVisitedStep] = useState<number>(1);

  // --- Step 1: Live Search State (300ms debounce + AbortController) ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<SearchFilterType>('tv');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [loadingMoreSearch, setLoadingMoreSearch] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // --- Step 2: Identified Series State ---
  const [selectedSeries, setSelectedSeries] = useState<TmdbSearchResult | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<any | null>(null);
  const [existsInCatalog, setExistsInCatalog] = useState<boolean>(false);
  const [existingCatalogEpisodes, setExistingCatalogEpisodes] = useState<Set<string>>(new Set());
  const [existingCatalogSourcesMap, setExistingCatalogSourcesMap] = useState<Record<string, number>>({});
  const [comparisonReport, setComparisonReport] = useState<SeriesComparisonReport | null>(null);
  const [syncJob, setSyncJob] = useState<SeriesSyncJob | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // --- Step 3: Seasons State ---
  const [seasonsList, setSeasonsList] = useState<any[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set());
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [useMgebPrefix, setUseMgebPrefix] = useState(true);
  const [seasonBaseUrls, setSeasonBaseUrls] = useState<Record<number, string>>({});
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  // --- Step 4: Episodes & Sources State ---
  const [seasonEpisodesMap, setSeasonEpisodesMap] = useState<Record<number, any[]>>({});
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set());
  const [episodeCustomUrls, setEpisodeCustomUrls] = useState<Record<string, string>>({});
  const [episodeVerifyStatus, setEpisodeVerifyStatus] = useState<
    Record<string, { status: 'idle' | 'testing' | 'online' | 'offline' | 'unverifiable' | 'error'; message?: string }>
  >({});
  const [activeSeasonTab, setActiveSeasonTab] = useState<number>(1);
  const [episodePageBySeason, setEpisodePageBySeason] = useState<Record<number, number>>({});
  const [showAllInSeason, setShowAllInSeason] = useState<Record<number, boolean>>({});
  const [showTreeOverview, setShowTreeOverview] = useState<boolean>(false);
  const [serverName, setServerName] = useState('MGEB Endpoint');
  const [audioLanguage, setAudioLanguage] = useState('Português');
  const [quality, setQuality] = useState('1080p');

  // Inline Player Test Modal
  const [playTestEp, setPlayTestEp] = useState<{
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    url: string;
  } | null>(null);
  const [playerDiagStatus, setPlayerDiagStatus] = useState<PlaybackDiagStatus>('idle');
  const [playerDiagMsg, setPlayerDiagMsg] = useState<string>('');

  // --- Step 5: Controlled Import Queue State ---
  const [isImporting, setIsImporting] = useState(false);
  const cancelImportRef = useRef<boolean>(false);
  const [importCancelledInfo, setImportCancelledInfo] = useState<{ completedKeys: string[]; remainingCount: number } | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [failedJobs, setFailedJobs] = useState<FailedEpisodeJob[]>([]);
  const [importResult, setImportResult] = useState<{
    title: string;
    tmdbId: number;
    seasonsImported: number;
    episodesImported: number;
    sourcesAdded: number;
    failedCount: number;
  } | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; msg: string } | null>(null);

  const showFeedback = (type: 'success' | 'error' | 'warning', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(prev => (prev?.msg === msg ? null : prev)), 5000);
  };

  const goToStep = (nextStep: number) => {
    setStep(nextStep);
    setMaxVisitedStep(prev => Math.max(prev, nextStep));
  };

  // --- LIVE DEBOUNCED SEARCH (300ms + AbortController) ---
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }

    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    searchDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const res = await api.searchTmdb(trimmed, searchFilter, controller.signal, 1);
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
        setSearchError(err?.message || 'Erro ao pesquisar séries no TMDB.');
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
    };
  }, [searchQuery, searchFilter, searchNonce]);

  // --- SELECT SERIES FOR STEP 2 (READ-ONLY INSPECT, NEVER AUTO-IMPORTS) ---
  const handleSelectSeries = async (item: TmdbSearchResult) => {
    if (item.type === 'movie') {
      showFeedback(
        'warning',
        `"${item.title}" é um filme. Utilize o Importador TMDB ou selecione uma série para configurar temporadas e episódios.`
      );
      return;
    }

    setLoadingDetails(true);
    setFeedback(null);
    try {
      const [details, existingSources] = await Promise.all([
        api.getTmdbDetails(item.tmdbId, 'tv'),
        api.getVideoSources({ contentId: item.tmdbId, contentType: 'tv' }).catch(() => [])
      ]);

      if (details && details.item) {
        const seasons = (details.item.seasons || []).filter((s: any) => Number(s.seasonNumber) >= 0);
        setSelectedSeries({
          ...item,
          title: details.item.title || item.title,
          posterPath: details.item.posterPath || item.posterPath,
          backdropPath: details.item.backdropPath || item.backdropPath,
          overview: details.item.overview || item.overview,
          existsInCatalog: Boolean(details.existsInCatalog),
          existingMediaItem: details.existingMediaItem
        });
        setSeriesDetails(details.item);
        setExistsInCatalog(Boolean(details.existsInCatalog));

        // Index existing imported episodes & video sources if series already exists
        const importedSet = new Set<string>();
        const existingItem = details.existingMediaItem;
        if (existingItem?.seasons) {
          for (const s of existingItem.seasons) {
            for (const ep of s.episodes || []) {
              importedSet.add(`${Number(s.seasonNumber)}_${Number(ep.episodeNumber)}`);
            }
          }
        }
        setExistingCatalogEpisodes(importedSet);

        const srcCounts: Record<string, number> = {};
        for (const src of existingSources || []) {
          const sNum = Number(src.seasonNumber ?? 1);
          const eNum = Number(src.episodeNumber ?? 1);
          const key = `${sNum}_${eNum}`;
          srcCounts[key] = (srcCounts[key] || 0) + 1;
        }
        setExistingCatalogSourcesMap(srcCounts);
        if (details.comparisonStats) {
          setComparisonReport(details.comparisonStats);
        } else {
          api.getSeriesComparison(item.tmdbId, true).then(c => setComparisonReport(c.report)).catch(() => {});
        }
        setImportCancelledInfo(null);

        setSeasonsList(seasons);
        // Reset per-series episode selections cleanly only when picking a different series
        if (!selectedSeries || selectedSeries.tmdbId !== item.tmdbId) {
          const defaultSelected = new Set<number>(
            seasons.filter((s: any) => Number(s.seasonNumber) > 0).map((s: any) => Number(s.seasonNumber))
          );
          if (defaultSelected.size === 0 && seasons.length > 0) {
            defaultSelected.add(Number(seasons[0].seasonNumber));
          }
          setSelectedSeasons(defaultSelected);
          setSeasonEpisodesMap({});
          setSelectedEpisodes(new Set());
          setEpisodeCustomUrls({});
          setEpisodeVerifyStatus({});
          setFailedJobs([]);
          setImportResult(null);
          setMaxVisitedStep(2);
        }
        goToStep(2);
      } else {
        showFeedback('error', 'Não foi possível carregar os detalhes desta série.');
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao carregar metadados da série.');
    } finally {
      setLoadingDetails(false);
    }
  };

  // Poll progressive multi-season server sync
  useEffect(() => {
    if (!syncJob || syncJob.status !== 'RUNNING') return;
    const t = setInterval(async () => {
      try {
        const res = await api.getSeriesSyncStatus(syncJob.tmdbId, syncJob.jobId);
        if (res?.job) {
          setSyncJob(res.job);
          if (res.job.status !== 'RUNNING') {
            api.getSeriesComparison(syncJob.tmdbId, true).then(c => setComparisonReport(c.report)).catch(() => {});
            if (onCatalogUpdated) onCatalogUpdated();
          }
        }
      } catch {
        // ignore transient errors
      }
    }, 1000);
    return () => clearInterval(t);
  }, [syncJob, onCatalogUpdated]);

  const handleStartFullSync = async () => {
    if (!selectedSeries?.tmdbId) return;
    try {
      const res = await api.syncSeriesAllSeasons(selectedSeries.tmdbId, { includeSpecials: true });
      if (res?.job) {
        setSyncJob(res.job);
        setExistsInCatalog(true);
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao sincronizar temporadas.');
    }
  };

  const handleCancelFullSync = async () => {
    if (!syncJob) return;
    try {
      const res = await api.cancelSeriesSync(syncJob.tmdbId, syncJob.jobId);
      if (res?.job) setSyncJob(res.job);
    } catch {
      // ignore
    }
  };

  // --- STEP 3 -> STEP 4: LAZY LOAD SELECTED SEASONS ---
  const toggleSeasonSelection = (seasonNumber: number) => {
    setSelectedSeasons(prev => {
      const next = new Set(prev);
      if (next.has(seasonNumber)) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });
  };

  const handleProceedToEpisodes = async () => {
    if (!selectedSeries || selectedSeasons.size === 0) {
      showFeedback('warning', 'Selecione pelo menos uma temporada.');
      return;
    }

    setLoadingEpisodes(true);
    try {
      const sortedSeasons = Array.from<number>(selectedSeasons).sort((a, b) => a - b);
      const nextMap: Record<number, any[]> = { ...seasonEpisodesMap };
      const nextSelectedEps = new Set<string>(selectedEpisodes);

      // Load missing seasons with bounded concurrency (max 3)
      const missingSeasons = sortedSeasons.filter(sNum => !nextMap[sNum]);
      for (let i = 0; i < missingSeasons.length; i += 3) {
        const chunk = missingSeasons.slice(i, i + 3);
        const results = await Promise.all(
          chunk.map(sNum =>
            api.getTmdbSeasonEpisodes(selectedSeries.tmdbId, sNum).then(res => ({ sNum, res }))
          )
        );
        for (const { sNum, res } of results) {
          const eps = res.episodes || [];
          nextMap[sNum] = eps;
          for (const ep of eps) {
            nextSelectedEps.add(`${sNum}_${ep.episodeNumber}`);
          }
        }
      }

      // Ensure already-cached seasons also have episodes selected if user newly selected the season
      for (const sNum of sortedSeasons) {
        const eps = nextMap[sNum] || [];
        const hasAnyFromSeason = eps.some(ep => nextSelectedEps.has(`${sNum}_${ep.episodeNumber}`));
        if (!hasAnyFromSeason) {
          for (const ep of eps) {
            nextSelectedEps.add(`${sNum}_${ep.episodeNumber}`);
          }
        }
      }

      setSeasonEpisodesMap(nextMap);
      setSelectedEpisodes(nextSelectedEps);
      if (!sortedSeasons.includes(activeSeasonTab)) {
        setActiveSeasonTab(sortedSeasons[0]);
      }
      goToStep(4);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao carregar episódios das temporadas selecionadas.');
    } finally {
      setLoadingEpisodes(false);
    }
  };

  // --- STEP 4: SMART MGEB GENERATOR USING generateEpisodeLinks ---
  const applySmartGeneratorForSeason = (seasonNum: number) => {
    const rawBase = (seasonBaseUrls[seasonNum] ?? baseUrlInput).trim();
    const episodes = seasonEpisodesMap[seasonNum] || [];
    if (!rawBase) {
      showFeedback('warning', `Insira a URL do 1º episódio da Temporada ${seasonNum}.`);
      return;
    }
    if (episodes.length === 0) {
      showFeedback('warning', `A Temporada ${seasonNum} não possui episódios carregados.`);
      return;
    }

    const firstEpNum = Number(episodes[0]?.episodeNumber || 1);
    const maxEpNum = Math.max(...episodes.map(e => Number(e.episodeNumber || 1)));
    const spanCount = Math.max(episodes.length, maxEpNum - firstEpNum + 1);

    const gen = generateEpisodeLinks({
      firstLink: rawBase,
      useMgebPrefix,
      startEpisode: firstEpNum,
      episodeCount: spanCount
    });

    if (!gen.valid) {
      showFeedback('error', gen.error || 'URL base incompatível com o gerador sequencial.');
      return;
    }

    const linkByEp = new Map<number, string>();
    for (const l of gen.links) {
      linkByEp.set(l.episodeNumber, l.url);
    }

    setEpisodeCustomUrls(prev => {
      const next = { ...prev };
      for (const ep of episodes) {
        const epNum = Number(ep.episodeNumber);
        const generatedUrl = linkByEp.get(epNum);
        if (generatedUrl) {
          next[`${seasonNum}_${epNum}`] = generatedUrl;
        }
      }
      return next;
    });

    showFeedback('success', `${episodes.length} links gerados com segurança para a Temporada ${seasonNum}.`);
  };

  const handleVerifyEpisodeUrl = async (key: string, url: string) => {
    if (!url.trim()) return;
    setEpisodeVerifyStatus(prev => ({ ...prev, [key]: { status: 'testing' } }));
    try {
      const res = await api.verifySourceLink(url.trim());
      setEpisodeVerifyStatus(prev => ({
        ...prev,
        [key]: {
          status: res.status === 'online' ? 'online' : res.status === 'offline' ? 'offline' : 'unverifiable',
          message: res.message
        }
      }));
    } catch (err: any) {
      setEpisodeVerifyStatus(prev => ({
        ...prev,
        [key]: {
          status: 'error',
          message: err?.message || 'Erro ao verificar ligação.'
        }
      }));
    }
  };

  const toggleEpisodeSelection = (seasonNum: number, epNum: number) => {
    const key = `${seasonNum}_${epNum}`;
    setSelectedEpisodes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllEpisodesInSeason = (seasonNum: number) => {
    const eps = seasonEpisodesMap[seasonNum] || [];
    setSelectedEpisodes(prev => {
      const next = new Set(prev);
      for (const ep of eps) next.add(`${seasonNum}_${ep.episodeNumber}`);
      return next;
    });
  };

  const deselectAllEpisodesInSeason = (seasonNum: number) => {
    const eps = seasonEpisodesMap[seasonNum] || [];
    setSelectedEpisodes(prev => {
      const next = new Set(prev);
      for (const ep of eps) next.delete(`${seasonNum}_${ep.episodeNumber}`);
      return next;
    });
  };

  // --- COMPUTED SUMMARY FOR STEP 5 ---
  const sortedSelectedSeasons = useMemo(
    () => Array.from<number>(selectedSeasons).sort((a, b) => a - b),
    [selectedSeasons]
  );

  const selectedEpisodesPayload = useMemo(() => {
    const list: Array<{ seasonNumber: number; episodeNumber: number; title: string; url: string }> = [];
    for (const sNum of sortedSelectedSeasons) {
      const eps = seasonEpisodesMap[sNum] || [];
      for (const ep of eps) {
        const key = `${sNum}_${ep.episodeNumber}`;
        if (!selectedEpisodes.has(key)) continue;
        const customUrl = (episodeCustomUrls[key] || '').trim();
        list.push({
          seasonNumber: sNum,
          episodeNumber: Number(ep.episodeNumber),
          title: ep.name || ep.title || `Episódio ${ep.episodeNumber}`,
          url: customUrl
        });
      }
    }
    return list;
  }, [sortedSelectedSeasons, seasonEpisodesMap, selectedEpisodes, episodeCustomUrls]);

  const episodesWithSourcesCount = useMemo(
    () => selectedEpisodesPayload.filter(e => Boolean(e.url)).length,
    [selectedEpisodesPayload]
  );

  // --- STEP 5: CONTROLLED MANUAL IMPORT, CANCEL & RESUMABLE CHECKPOINT ---
  const runImportQueue = async (jobsOverride?: FailedEpisodeJob[], skipAlreadyCompleted = false) => {
    if (!selectedSeries) return;
    cancelImportRef.current = false;
    setIsImporting(true);
    setFeedback(null);

    const checkpointKey = `ronycine_series_checkpoint_${selectedSeries.tmdbId}`;
    let completedSet = new Set<string>();
    if (skipAlreadyCompleted) {
      try {
        const raw = localStorage.getItem(checkpointKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) completedSet = new Set(parsed);
        }
      } catch {}
    } else if (!jobsOverride) {
      try {
        localStorage.removeItem(checkpointKey);
      } catch {}
    }

    try {
      const allJobs: FailedEpisodeJob[] = jobsOverride
        ? jobsOverride
        : selectedEpisodesPayload
            .filter(ep => Boolean(ep.url))
            .map(ep => ({
              seasonNumber: ep.seasonNumber,
              episodeNumber: ep.episodeNumber,
              title: ep.title,
              url: ep.url,
              error: ''
            }));

      const jobs = skipAlreadyCompleted
        ? allJobs.filter(j => !completedSet.has(`${j.seasonNumber}_${j.episodeNumber}`))
        : allJobs;

      const totalSteps = (jobsOverride || skipAlreadyCompleted ? 0 : 1) + jobs.length;
      let completedSteps = 0;

      // 1. Import series + strictly selected episodes (only on fresh full run)
      if (!jobsOverride && !skipAlreadyCompleted) {
        setImportProgress({
          current: 0,
          total: Math.max(1, totalSteps),
          message: `A registar "${selectedSeries.title}" e ${selectedEpisodesPayload.length} episódio(s) selecionado(s)...`
        });
        await api.importTmdbMedia(
          selectedSeries.tmdbId,
          'tv',
          true,
          selectedEpisodesPayload.map(e => ({
            seasonNumber: e.seasonNumber,
            episodeNumber: e.episodeNumber
          }))
        );
        completedSteps = 1;
        setImportProgress({
          current: completedSteps,
          total: Math.max(1, totalSteps),
          message:
            jobs.length > 0
              ? `Série registada. A guardar ${jobs.length} fonte(s) de vídeo...`
              : 'Série e episódios registados no catálogo.'
        });
      }

      // 2. Save sources with controlled concurrency (max 3 concurrent) + progressive checkpoint
      const failures: FailedEpisodeJob[] = [];
      let savedSourcesCount = 0;
      const CONCURRENCY = 3;

      for (let i = 0; i < jobs.length; i += CONCURRENCY) {
        if (cancelImportRef.current) {
          const remaining = jobs.length - i;
          setImportCancelledInfo({
            completedKeys: Array.from(completedSet),
            remainingCount: remaining
          });
          showFeedback(
            'warning',
            `Operação cancelada pelo utilizador. ${savedSourcesCount} fonte(s) guardada(s); restam ${remaining}. Pode retomar sem duplicar.`
          );
          if (onCatalogUpdated) onCatalogUpdated();
          api.getSeriesComparison(selectedSeries.tmdbId, true).then(c => setComparisonReport(c.report)).catch(() => {});
          return;
        }

        const chunk = jobs.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async job => {
            try {
              const classified = classifySourceUrl(job.url);
              if (!classified.valid) {
                throw new Error(classified.error || 'URL inválida.');
              }
              await api.addVideoSource({
                contentId: selectedSeries.tmdbId,
                contentType: 'tv',
                seasonNumber: job.seasonNumber,
                episodeNumber: job.episodeNumber,
                url: classified.originalUrl,
                originalUrl: classified.originalUrl,
                sourceKind: classified.sourceKind,
                format: classified.suggestedFormat,
                serverName: serverName.trim() || classified.suggestedServerName || 'Servidor Principal',
                audioLanguage: audioLanguage.trim() || 'Português',
                quality,
                isPrimary: true,
                priority: 1,
                enabled: true,
                status: 'registered',
                diagnostics: classified.diagnostics,
                replaceExisting: true
              });
              savedSourcesCount++;
              completedSet.add(`${job.seasonNumber}_${job.episodeNumber}`);
            } catch (err: any) {
              failures.push({
                ...job,
                error: err?.message || 'Falha ao guardar fonte.'
              });
            } finally {
              completedSteps++;
              setImportProgress({
                current: completedSteps,
                total: Math.max(1, totalSteps),
                message: `T${job.seasonNumber}:E${job.episodeNumber} processado (${completedSteps}/${Math.max(1, totalSteps)})`
              });
            }
          })
        );
        try {
          localStorage.setItem(checkpointKey, JSON.stringify(Array.from(completedSet)));
        } catch {}
      }

      if (failures.length === 0) {
        try {
          localStorage.removeItem(checkpointKey);
        } catch {}
        setImportCancelledInfo(null);
      }

      setFailedJobs(failures);
      setImportResult(prev => ({
        title: selectedSeries.title,
        tmdbId: selectedSeries.tmdbId,
        seasonsImported: selectedSeasons.size,
        episodesImported: selectedEpisodesPayload.length,
        sourcesAdded: ((jobsOverride || skipAlreadyCompleted) && prev ? prev.sourcesAdded : 0) + savedSourcesCount,
        failedCount: failures.length
      }));
      setExistsInCatalog(true);
      api.getSeriesComparison(selectedSeries.tmdbId, true).then(c => setComparisonReport(c.report)).catch(() => {});

      if (onCatalogUpdated) onCatalogUpdated();
      if (failures.length === 0) {
        showFeedback('success', 'Importação manual concluída com sucesso!');
      } else {
        showFeedback('warning', `Importação concluída com ${failures.length} falha(s) de fonte. Pode tentar novamente.`);
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao confirmar importação manual da série.');
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  // --- PAGINATED EPISODES VIEW IN STEP 4 ---
  const activeEpisodes = seasonEpisodesMap[activeSeasonTab] || [];
  const activePage = episodePageBySeason[activeSeasonTab] || 1;
  const isShowingAll = Boolean(showAllInSeason[activeSeasonTab]);
  const totalPages = Math.max(1, Math.ceil(activeEpisodes.length / EPISODES_PER_PAGE));
  const safePage = Math.min(activePage, totalPages);
  const visibleEpisodes = isShowingAll
    ? activeEpisodes
    : activeEpisodes.slice((safePage - 1) * EPISODES_PER_PAGE, safePage * EPISODES_PER_PAGE);

  const stepsMeta = [
    { num: 1, label: 'Pesquisar' },
    { num: 2, label: 'Identificar Série' },
    { num: 3, label: 'Temporadas' },
    { num: 4, label: 'Episódios e Fontes' },
    { num: 5, label: 'Confirmar' }
  ];

  return (
    <div className="space-y-6 text-white max-w-7xl mx-auto pb-16">
      {/* HEADER & 5-STEP WIZARD */}
      <div className="bg-[#111114] border border-white/10 p-5 sm:p-6 rounded-2xl shadow-xl flex flex-col xl:flex-row xl:items-center justify-between gap-5">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#E50914]/15 border border-[#E50914]/30 flex items-center justify-center text-[#E50914] shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-black uppercase tracking-tight font-display">
              RONYCINE SERIES IMPORTER PRO ULTRA
            </h2>
            <p className="text-xs text-zinc-400">
              Pesquisa ao vivo, seleção manual estrita, gerador MGEB inteligente e teste no player.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 xl:pb-0">
          {stepsMeta.map(st => {
            const canClick = st.num <= maxVisitedStep && !isImporting;
            return (
              <button
                key={st.num}
                type="button"
                disabled={!canClick}
                onClick={() => canClick && goToStep(st.num)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition-all ${
                  step === st.num
                    ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/25'
                    : step > st.num
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                      : canClick
                        ? 'bg-white/10 border border-white/15 text-zinc-200 hover:bg-white/15'
                        : 'bg-white/5 border border-white/10 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <span className="font-mono">{st.num}.</span>
                <span>{st.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border text-xs font-bold flex items-center gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
              : feedback.type === 'warning'
                ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                : 'bg-[#E50914]/15 border-[#E50914]/35 text-red-200'
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* --- STEP 1: LIVE SMART SEARCH --- */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="bg-[#111114] border border-white/10 p-5 sm:p-6 rounded-2xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Search className="w-4 h-4 text-[#E50914]" />
                  <span>Pesquisa ao Vivo por Título ou TMDB ID</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Apenas leitura no TMDB. Nada é importado até à confirmação final na etapa 5.
                </p>
              </div>

              <div className="flex items-center gap-1.5 bg-black p-1 rounded-xl border border-white/10 self-start">
                {(
                  [
                    { id: 'tv', label: 'Séries' },
                    { id: 'all', label: 'Todos' },
                    { id: 'movie', label: 'Filmes' }
                  ] as const
                ).map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSearchFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${
                      searchFilter === f.id
                        ? 'bg-[#E50914] text-white'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <Search className="w-5 h-5 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Digite o nome da série ou cole o TMDB ID (ex: Game of Thrones, 1399, Breaking Bad)..."
                className="w-full bg-[#080808] border border-white/15 focus:border-[#E50914] rounded-2xl pl-12 pr-12 py-3.5 text-sm text-white placeholder-zinc-500 outline-none font-semibold transition-colors"
              />
              {isSearching ? (
                <RefreshCw className="w-4 h-4 text-[#E50914] animate-spin absolute right-4 top-1/2 -translate-y-1/2" />
              ) : searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  aria-label="Limpar pesquisa"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>

            {/* LIVE RESULTS AREA DIRECTLY BELOW INPUT */}
            {!searchQuery.trim() ? (
              <div className="py-10 px-4 text-center rounded-xl bg-[#080808] border border-dashed border-white/10 space-y-2">
                <Tv className="w-8 h-8 text-zinc-700 mx-auto" />
                <p className="text-xs font-bold text-zinc-300">Escreve para pesquisar no TMDB...</p>
                <p className="text-[11px] text-zinc-500">
                  Suporta títulos parciais ("Game of"), nomes completos ou ID numérico direto (ex: 1399).
                </p>
              </div>
            ) : isSearching ? (
              <div className="py-10 px-4 flex flex-col items-center justify-center gap-3 rounded-xl bg-[#080808] border border-white/10">
                <RefreshCw className="w-6 h-6 text-[#E50914] animate-spin" />
                <p className="text-xs font-bold text-zinc-300">A pesquisar "{searchQuery.trim()}"...</p>
              </div>
            ) : searchError ? (
              <div className="p-6 rounded-xl bg-red-950/20 border border-[#E50914]/35 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-xs text-red-200">
                  <AlertTriangle className="w-5 h-5 text-[#E50914] shrink-0" />
                  <div>
                    <p className="font-bold">Erro ao pesquisar no TMDB</p>
                    <p className="text-zinc-400 mt-0.5">{searchError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSearchNonce(n => n + 1)}
                  className="px-4 py-2 bg-[#E50914] hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-xl shrink-0"
                >
                  Tentar novamente
                </button>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="py-10 px-4 text-center rounded-xl bg-[#080808] border border-white/10 space-y-1.5">
                <p className="text-xs font-bold text-zinc-300">
                  Nenhum resultado encontrado para "{searchQuery.trim()}".
                </p>
                <p className="text-[11px] text-zinc-500">
                  Experimente outro termo ou pesquise pelo TMDB ID numérico exato.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-black uppercase tracking-wider text-zinc-300">
                    Resultados encontrados ({searchResults.length})
                  </span>
                  {loadingDetails && (
                    <span className="text-zinc-400 flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E50914]" />
                      A carregar detalhes...
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {searchResults.map(item => (
                    <button
                      key={`${item.type}-${item.tmdbId}`}
                      type="button"
                      disabled={loadingDetails}
                      onClick={() => handleSelectSeries(item)}
                      className="text-left bg-[#080808] border border-white/10 hover:border-[#E50914] rounded-xl overflow-hidden cursor-pointer transition-all group flex flex-col"
                    >
                      <div className="aspect-[2/3] w-full bg-zinc-900 relative overflow-hidden">
                        {item.posterPath ? (
                          <img
                            src={resolveTmdbPosterUrl(item.posterPath, 'w342')}
                            alt={item.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 gap-1">
                            {item.type === 'movie' ? <Film className="w-6 h-6" /> : <Tv className="w-6 h-6" />}
                            <span className="text-[9px] font-bold uppercase">Sem Poster</span>
                          </div>
                        )}
                        <div className="absolute top-2 left-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              item.existsInCatalog
                                ? 'bg-emerald-600 text-white'
                                : 'bg-black/80 text-zinc-200 border border-white/15'
                            }`}
                          >
                            {item.existsInCatalog ? 'NO CATÁLOGO' : 'FORA DO CATÁLOGO'}
                          </span>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2.5">
                          <span className="w-full py-2 bg-[#E50914] text-white text-[10px] font-black uppercase tracking-widest rounded-lg text-center">
                            {item.type === 'movie' ? 'Filme' : 'Selecionar Série'}
                          </span>
                        </div>
                      </div>
                      <div className="p-3 flex-1 flex flex-col justify-between w-full">
                        <div>
                          <h4 className="text-xs font-black text-white line-clamp-1">{item.title}</h4>
                          <div className="flex items-center justify-between text-[10px] text-zinc-400 mt-1">
                            <span>{(item.firstAirDate || item.releaseDate || '').slice(0, 4) || '—'}</span>
                            {typeof item.voteAverage === 'number' && item.voteAverage > 0 && (
                              <span className="flex items-center gap-0.5 text-amber-400 font-bold">
                                <Star className="w-2.5 h-2.5 fill-amber-400" />
                                {item.voteAverage.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-500 mt-2 block">
                          TMDB #{item.tmdbId} · {item.type === 'movie' ? 'FILME' : 'SÉRIE'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {searchPage < searchTotalPages && (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      disabled={loadingMoreSearch}
                      onClick={async () => {
                        const nextPage = searchPage + 1;
                        setLoadingMoreSearch(true);
                        try {
                          const res = await api.searchTmdb(searchQuery.trim(), searchFilter, undefined, nextPage);
                          setSearchResults(prev => {
                            const seen = new Set(prev.map(i => `${i.type}-${i.tmdbId}`));
                            const merged = [...prev];
                            for (const item of res.results || []) {
                              if (!seen.has(`${item.type}-${item.tmdbId}`)) {
                                seen.add(`${item.type}-${item.tmdbId}`);
                                merged.push(item);
                              }
                            }
                            return merged;
                          });
                          setSearchPage(nextPage);
                          setSearchTotalPages(res.totalPages || searchTotalPages);
                        } catch {
                          // ignore
                        } finally {
                          setLoadingMoreSearch(false);
                        }
                      }}
                      className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white flex items-center gap-2 disabled:opacity-50"
                    >
                      {loadingMoreSearch && <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E50914]" />}
                      <span>Carregar mais resultados (Página {searchPage + 1} de {searchTotalPages})</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- STEP 2: IDENTIFY SERIES --- */}
      {step === 2 && selectedSeries && (
        <div className="space-y-6">
          <div className="bg-[#111114] border border-white/10 p-6 rounded-2xl flex flex-col md:flex-row gap-6 items-start">
            <div className="w-36 aspect-[2/3] bg-zinc-900 rounded-xl overflow-hidden shrink-0 border border-white/10">
              <img
                src={resolveTmdbPosterUrl(selectedSeries.posterPath, 'w342')}
                alt={selectedSeries.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-3 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 bg-[#E50914]/15 border border-[#E50914]/35 text-[#E50914] text-[10px] font-black uppercase tracking-widest rounded-lg">
                  Série TMDB #{selectedSeries.tmdbId}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${
                    existsInCatalog
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                      : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  }`}
                >
                  {existsInCatalog ? 'Já no Catálogo (Atualização Manual)' : 'Nova Série (Não Importada)'}
                </span>
                <span className="text-xs text-zinc-400 font-mono">
                  {seasonsList.length} Temporada(s) · {seriesDetails?.releaseYear || selectedSeries.firstAirDate?.slice(0, 4) || '—'}
                </span>
              </div>

              <h2 className="text-2xl font-black font-display text-white">{selectedSeries.title}</h2>
              <p className="text-xs text-zinc-300 leading-relaxed max-w-3xl">
                {selectedSeries.overview || 'Sem sinopse disponível.'}
              </p>

              {existsInCatalog && onViewCatalogItem && (
                <button
                  type="button"
                  onClick={() =>
                    onViewCatalogItem({
                      id: selectedSeries.existingMediaItem?.id || `tv-${selectedSeries.tmdbId}`,
                      tmdbId: selectedSeries.tmdbId,
                      type: 'tv',
                      title: selectedSeries.title
                    })
                  }
                  className="text-xs font-bold text-emerald-400 hover:underline"
                >
                  Ver item atual no catálogo
                </button>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2">
                {syncJob?.status === 'RUNNING' ? (
                  <button
                    type="button"
                    onClick={handleCancelFullSync}
                    className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs font-bold flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Cancelar Sync ({syncJob.processedSeasons}/{syncJob.totalSeasons} temporadas)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartFullSync}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#E50914]" />
                    <span>Sincronizar Todas as Temporadas no Servidor (Lotes)</span>
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider shrink-0"
            >
              Trocar Série
            </button>
          </div>

          {comparisonReport && (
            <div className="bg-[#111114] border border-white/10 p-5 rounded-2xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#E50914]" />
                  Comparação Inteligente TMDB vs Catálogo RONYCINE
                </h3>
                <span className="text-[11px] text-zinc-400">
                  Nunca inventa episódios em falta no fornecedor
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 text-xs tabular-nums">
                <div className="bg-[#080808] border border-white/10 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block">Temporadas TMDB</span>
                  <strong className="text-lg font-black text-white">{comparisonReport.officialSeasonsCount}</strong>
                </div>
                <div className="bg-[#080808] border border-white/10 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block">Esperados TMDB</span>
                  <strong className="text-lg font-black text-zinc-200">{comparisonReport.expectedEpisodes}</strong>
                </div>
                <div className="bg-[#080808] border border-white/10 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block">Encontrados</span>
                  <strong className="text-lg font-black text-blue-400">{comparisonReport.foundEpisodes}</strong>
                </div>
                <div className="bg-[#080808] border border-white/10 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block">Com Link</span>
                  <strong className="text-lg font-black text-emerald-400">{comparisonReport.withLink}</strong>
                </div>
                <div className="bg-[#080808] border border-white/10 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block">Sem Link</span>
                  <strong className="text-lg font-black text-amber-400">{comparisonReport.withoutLink}</strong>
                </div>
                <div className="bg-[#080808] border border-white/10 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block">Validados</span>
                  <strong className="text-lg font-black text-emerald-400">{comparisonReport.validatedCount}</strong>
                </div>
                <div className="bg-[#080808] border border-white/10 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block">Com Erro</span>
                  <strong className="text-lg font-black text-red-400">{comparisonReport.errorCount}</strong>
                </div>
              </div>
              {comparisonReport.seasons.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1 text-[11px] tabular-nums">
                  {comparisonReport.seasons.map(cs => (
                    <div key={cs.seasonNumber} className="p-2.5 rounded-xl bg-[#080808] border border-white/10 flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <strong className="text-white">{cs.seasonNumber === 0 ? 'Especiais (T0)' : cs.name}</strong>
                        {cs.difference > 0 ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold text-[10px]">
                            -{cs.difference} em falta
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-bold text-[10px]">
                            Completa
                          </span>
                        )}
                      </div>
                      <div className="text-zinc-400 flex flex-wrap gap-x-2">
                        <span>Esp: {cs.expectedEpisodes}</span>
                        <span>· Enc: {cs.foundEpisodes}</span>
                        <span>· Link: {cs.withLink}</span>
                        <span>· Sem: {cs.withoutLink}</span>
                        {cs.errorCount > 0 && <span className="text-red-400">· Err: {cs.errorCount}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="bg-[#111114] border border-white/10 p-6 rounded-2xl space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#E50914]" />
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Configuração Padrão de Fontes (Opcional)
                </h3>
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useMgebPrefix}
                  onChange={e => setUseMgebPrefix(e.target.checked)}
                  className="w-4 h-4 accent-[#E50914]"
                />
                <span>Prefixo MGEB ({MGEB_PREFIX})</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 flex gap-2">
                <input
                  type="text"
                  value={baseUrlInput}
                  onChange={e => setBaseUrlInput(e.target.value)}
                  placeholder="URL do 1º episódio para pré-preencher temporadas (ex: https://ver.123pelicula.com/.../1)"
                  className="flex-1 bg-[#080808] border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white focus:border-[#E50914] outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (baseUrlInput.trim()) {
                      const map: Record<number, string> = {};
                      for (const s of seasonsList) map[Number(s.seasonNumber)] = baseUrlInput.trim();
                      setSeasonBaseUrls(map);
                      showFeedback('success', 'Modelo base aplicado a todas as temporadas.');
                    }
                  }}
                  className="px-4 py-2.5 bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold rounded-xl shrink-0"
                >
                  Aplicar a Todas
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={serverName}
                  onChange={e => setServerName(e.target.value)}
                  placeholder="Servidor"
                  className="bg-[#080808] border border-white/15 rounded-xl px-3 py-2.5 text-xs text-white focus:border-[#E50914] outline-none"
                />
                <select
                  value={quality}
                  onChange={e => setQuality(e.target.value)}
                  className="bg-[#080808] border border-white/15 rounded-xl px-3 py-2.5 text-xs text-white focus:border-[#E50914] outline-none"
                >
                  <option value="1080p">1080p</option>
                  <option value="4K">4K</option>
                  <option value="720p">720p</option>
                  <option value="Automática">Auto</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar à Pesquisa</span>
            </button>
            <button
              type="button"
              onClick={() => goToStep(3)}
              className="px-7 py-3.5 bg-[#E50914] hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-xl shadow-[#E50914]/25 flex items-center gap-2"
            >
              <span>Escolher Temporadas</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* --- STEP 3: SELECT SEASONS --- */}
      {step === 3 && selectedSeries && (
        <div className="space-y-6">
          <div className="bg-[#111114] border border-white/10 p-6 rounded-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-black uppercase tracking-tight text-white">
                  Temporadas de {selectedSeries.title} ({seasonsList.length})
                </h3>
                <p className="text-xs text-zinc-400">
                  Selecione exatamente quais temporadas deseja carregar para revisão e importação manual.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSeasons(new Set(seasonsList.map(s => Number(s.seasonNumber))))}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] font-bold uppercase"
                >
                  Selecionar Todas
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSeasons(new Set())}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] font-bold uppercase text-zinc-400"
                >
                  Desmarcar Todas
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {seasonsList.map(season => {
                const sNum = Number(season.seasonNumber);
                const isSelected = selectedSeasons.has(sNum);
                const epCount = Number(season.episodeCount ?? season.episode_count ?? 0);
                return (
                  <button
                    key={season.id || sNum}
                    type="button"
                    onClick={() => toggleSeasonSelection(sNum)}
                    className={`p-4 rounded-xl border text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-[#E50914]/15 border-[#E50914] text-white shadow-lg shadow-[#E50914]/10'
                        : 'bg-[#080808] border-white/10 text-zinc-400 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 ${
                          isSelected ? 'bg-[#E50914] border-[#E50914] text-white' : 'border-white/20 bg-black'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-black uppercase text-white truncate">
                          {season.name || (sNum === 0 ? 'Especiais' : `Temporada ${sNum}`)}
                        </h4>
                        <p className="text-[11px] text-zinc-400 tabular-nums mt-0.5">
                          {epCount} episódios
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => goToStep(2)}
              className="px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>
            <button
              type="button"
              onClick={handleProceedToEpisodes}
              disabled={loadingEpisodes || selectedSeasons.size === 0}
              className="px-7 py-3.5 bg-[#E50914] hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-xl shadow-[#E50914]/25 flex items-center gap-2 disabled:opacity-50"
            >
              {loadingEpisodes ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
              <span>{loadingEpisodes ? 'A carregar episódios...' : 'Carregar Episódios & Fontes'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* --- STEP 4: EPISODES & SMART MGEB GENERATOR (PAGINATED / WINDOWED) --- */}
      {step === 4 && selectedSeries && (
        <div className="space-y-6">
          {/* Season Switcher Tabs */}
          <div className="bg-[#111114] border border-white/10 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {sortedSelectedSeasons.map(sNum => {
                const count = (seasonEpisodesMap[sNum] || []).length;
                const active = activeSeasonTab === sNum;
                return (
                  <button
                    key={sNum}
                    type="button"
                    onClick={() => setActiveSeasonTab(sNum)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
                      active
                        ? 'bg-[#E50914] border-[#E50914] text-white'
                        : 'bg-[#080808] border-white/10 text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    T{sNum} <span className="opacity-75 font-mono">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400 tabular-nums">
              <span>Selecionados: <strong className="text-white">{selectedEpisodes.size}</strong></span>
              <span>·</span>
              <span>Com fonte: <strong className="text-emerald-400">{episodesWithSourcesCount}</strong></span>
              <button
                type="button"
                onClick={() => setShowTreeOverview(v => !v)}
                className="ml-2 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold text-[11px]"
              >
                {showTreeOverview ? 'Ocultar Árvore' : 'Estrutura em Árvore'}
              </button>
            </div>
          </div>

          {showTreeOverview && (
            <div className="bg-[#0D0F15] border border-white/10 p-4 rounded-2xl space-y-2 max-h-72 overflow-y-auto font-mono text-xs">
              <div className="font-black text-white">{selectedSeries.title} (TMDB #{selectedSeries.tmdbId})</div>
              {sortedSelectedSeasons.map(sNum => {
                const eps = seasonEpisodesMap[sNum] || [];
                const withLinks = eps.filter(ep => Boolean((episodeCustomUrls[`${sNum}_${ep.episodeNumber}`] || '').trim()) || (existingCatalogSourcesMap[`${sNum}_${ep.episodeNumber}`] || 0) > 0).length;
                return (
                  <div key={`tree-${sNum}`} className="pl-3 border-l border-white/15 space-y-1">
                    <div className="flex items-center justify-between text-zinc-200 font-bold">
                      <span>├── {sNum === 0 ? 'Especiais (T0)' : `Temporada ${sNum}`} ({eps.length} eps · {withLinks} c/ link)</span>
                      <button
                        type="button"
                        onClick={() => setActiveSeasonTab(sNum)}
                        className="text-[10px] text-[#E50914] hover:underline"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Active Season Generator & Paginated Episode List */}
          <div className="bg-[#111114] border border-white/10 p-5 sm:p-6 rounded-2xl space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h3 className="text-base font-black uppercase tracking-tight text-white">
                  {activeSeasonTab === 0 ? 'Especiais (T0)' : `Temporada ${activeSeasonTab}`} — Episódios & Fontes
                </h3>
                <p className="text-xs text-zinc-400 tabular-nums">
                  {activeEpisodes.length} episódios disponíveis no TMDB.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={seasonBaseUrls[activeSeasonTab] ?? baseUrlInput}
                  onChange={e => setSeasonBaseUrls(prev => ({ ...prev, [activeSeasonTab]: e.target.value }))}
                  placeholder="Link do Episódio 1 (ex: https://.../1)"
                  className="bg-[#080808] border border-white/15 focus:border-[#E50914] rounded-xl px-3.5 py-2 text-xs text-white outline-none w-full sm:w-72 font-mono"
                />
                <button
                  type="button"
                  onClick={() => applySmartGeneratorForSeason(activeSeasonTab)}
                  className="px-4 py-2 bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all whitespace-nowrap"
                >
                  Gerar Links MGEB
                </button>
                <button
                  type="button"
                  onClick={() => selectAllEpisodesInSeason(activeSeasonTab)}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[11px] font-bold uppercase"
                >
                  Sel. Todos
                </button>
                <button
                  type="button"
                  onClick={() => deselectAllEpisodesInSeason(activeSeasonTab)}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[11px] font-bold uppercase text-zinc-400"
                >
                  Limpar
                </button>
              </div>
            </div>

            {/* Pagination bar for large seasons */}
            {activeEpisodes.length > EPISODES_PER_PAGE && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#080808] border border-white/10 rounded-xl px-4 py-2.5 text-xs">
                <span className="text-zinc-400 tabular-nums">
                  {isShowingAll
                    ? `A mostrar todos os ${activeEpisodes.length} episódios`
                    : `Página ${safePage} de ${totalPages} (${activeEpisodes.length} episódios)`}
                </span>
                <div className="flex items-center gap-2">
                  {!isShowingAll && (
                    <>
                      <button
                        type="button"
                        disabled={safePage <= 1}
                        onClick={() => setEpisodePageBySeason(prev => ({ ...prev, [activeSeasonTab]: Math.max(1, safePage - 1) }))}
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40"
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        disabled={safePage >= totalPages}
                        onClick={() => setEpisodePageBySeason(prev => ({ ...prev, [activeSeasonTab]: Math.min(totalPages, safePage + 1) }))}
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40"
                      >
                        Seguinte
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAllInSeason(prev => ({ ...prev, [activeSeasonTab]: !prev[activeSeasonTab] }))}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-200 font-bold"
                  >
                    {isShowingAll ? `Paginar (${EPISODES_PER_PAGE})` : 'Mostrar todos'}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1 admin-scrollbar">
              {visibleEpisodes.map(ep => {
                const key = `${activeSeasonTab}_${ep.episodeNumber}`;
                const isEpSelected = selectedEpisodes.has(key);
                const epUrl = episodeCustomUrls[key] || '';
                const isImported = existingCatalogEpisodes.has(key);
                const existingSrcCount = existingCatalogSourcesMap[key] || 0;
                const vState = episodeVerifyStatus[key];
                const hasUrl = Boolean(epUrl.trim());

                return (
                  <div
                    key={ep.id || key}
                    className={`p-3.5 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-all ${
                      isEpSelected ? 'bg-[#080808] border-white/15' : 'bg-black/30 border-white/5 opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0 lg:w-72 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleEpisodeSelection(activeSeasonTab, ep.episodeNumber)}
                        className={`w-5 h-5 mt-0.5 rounded-md flex items-center justify-center border shrink-0 ${
                          isEpSelected ? 'bg-[#E50914] border-[#E50914] text-white' : 'border-white/20 bg-black'
                        }`}
                      >
                        {isEpSelected && <Check className="w-3.5 h-3.5" />}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black text-white font-mono">
                            E{String(ep.episodeNumber).padStart(2, '0')}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                              isImported
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {isImported ? 'IMPORTADO' : 'POR IMPORTAR'}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                              hasUrl || existingSrcCount > 0
                                ? vState?.status === 'online'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : vState?.status === 'offline' || vState?.status === 'error'
                                    ? 'bg-red-500/15 text-red-400'
                                    : 'bg-blue-500/15 text-blue-300'
                                : 'bg-amber-500/10 text-amber-400'
                            }`}
                          >
                            {hasUrl
                              ? vState?.status === 'online'
                                ? 'FONTE ONLINE'
                                : vState?.status === 'offline' || vState?.status === 'error'
                                  ? 'FONTE COM ERRO'
                                  : 'COM FONTE (NÃO VERIFICADA)'
                              : existingSrcCount > 0
                                ? `${existingSrcCount} FONTE(S)`
                                : 'SEM FONTE'}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-zinc-200 truncate mt-0.5">
                          {ep.name || ep.title || `Episódio ${ep.episodeNumber}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <input
                        type="text"
                        value={epUrl}
                        onChange={e => setEpisodeCustomUrls(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder={`${MGEB_PREFIX}https://.../${ep.episodeNumber}`}
                        className="flex-1 min-w-0 bg-black border border-white/15 focus:border-[#E50914] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                      />
                      <button
                        type="button"
                        disabled={!hasUrl || vState?.status === 'testing'}
                        onClick={() => handleVerifyEpisodeUrl(key, epUrl)}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-emerald-400 disabled:opacity-35 shrink-0"
                        title="Verificar ligação"
                      >
                        {vState?.status === 'testing' ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!hasUrl}
                        onClick={() => {
                          setPlayerDiagStatus('playing');
                          setPlayerDiagMsg('A carregar reprodução de teste...');
                          setPlayTestEp({
                            seasonNumber: activeSeasonTab,
                            episodeNumber: ep.episodeNumber,
                            title: ep.name || ep.title || `Episódio ${ep.episodeNumber}`,
                            url: epUrl.trim()
                          });
                        }}
                        className="px-3 py-2 rounded-lg bg-[#E50914]/15 hover:bg-[#E50914] border border-[#E50914]/35 text-[#E50914] hover:text-white disabled:opacity-35 text-[11px] font-bold flex items-center gap-1.5 shrink-0 transition-colors"
                        title="Testar no Player"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span className="hidden sm:inline">Testar</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => goToStep(3)}
              className="px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar às Temporadas</span>
            </button>
            <button
              type="button"
              onClick={() => goToStep(5)}
              disabled={selectedEpisodesPayload.length === 0}
              className="px-7 py-3.5 bg-[#E50914] hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-xl shadow-[#E50914]/25 flex items-center gap-2 disabled:opacity-50"
            >
              <span>Revisar & Confirmar ({selectedEpisodesPayload.length})</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* --- STEP 5: CONFIRM IMPORT & CONTROLLED QUEUE --- */}
      {step === 5 && selectedSeries && (
        <div className="space-y-6">
          <div className="bg-[#111114] border border-white/10 p-6 rounded-2xl space-y-6">
            <div className="border-b border-white/10 pb-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#E50914] block">
                Confirmação Manual Obrigatória
              </span>
              <h2 className="text-2xl font-black font-display text-white mt-1">
                Resumo da Importação — {selectedSeries.title}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Revise os itens selecionados. Os formatos são classificados automaticamente conforme cada URL (sem forçar MP4/Ativo).
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 tabular-nums">
              <div className="bg-[#080808] border border-white/10 p-4 rounded-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Série</span>
                <p className="text-base font-black text-white mt-1 truncate">{selectedSeries.title}</p>
                <span className="text-xs font-mono text-zinc-400">TMDB #{selectedSeries.tmdbId}</span>
              </div>
              <div className="bg-[#080808] border border-white/10 p-4 rounded-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Temporadas</span>
                <p className="text-2xl font-black font-display text-[#E50914] mt-1">{selectedSeasons.size}</p>
              </div>
              <div className="bg-[#080808] border border-white/10 p-4 rounded-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Episódios</span>
                <p className="text-2xl font-black font-display text-emerald-400 mt-1">{selectedEpisodesPayload.length}</p>
              </div>
              <div className="bg-[#080808] border border-white/10 p-4 rounded-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Fontes a Gravar</span>
                <p className="text-2xl font-black font-display text-blue-400 mt-1">{episodesWithSourcesCount}</p>
              </div>
            </div>

            {isImporting && importProgress && (
              <div className="bg-[#080808] border border-white/15 p-5 rounded-xl space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2 text-xs font-bold uppercase tracking-wider tabular-nums">
                  <span className="text-[#E50914]">{importProgress.message}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400">
                      {importProgress.current} / {importProgress.total}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        cancelImportRef.current = true;
                      }}
                      className="px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-[10px] font-black"
                    >
                      Cancelar Operação
                    </button>
                  </div>
                </div>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#E50914] transition-all duration-200"
                    style={{ width: `${(importProgress.current / Math.max(1, importProgress.total)) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {importCancelledInfo && !isImporting && (
              <div className="bg-amber-950/25 border border-amber-500/40 p-5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <strong className="text-amber-300 block uppercase">Importação interrompida ({importCancelledInfo.remainingCount} episódios restantes)</strong>
                  <span className="text-zinc-300">Os episódios já processados foram guardados com segurança. Pode retomar do ponto exato.</span>
                </div>
                <button
                  type="button"
                  onClick={() => runImportQueue(undefined, true)}
                  className="px-4 py-2 bg-[#E50914] hover:bg-red-700 text-white font-black uppercase rounded-xl"
                >
                  Retomar Importação
                </button>
              </div>
            )}

            {failedJobs.length > 0 && !isImporting && (
              <div className="bg-red-950/25 border border-[#E50914]/40 p-5 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase text-red-300">
                    {failedJobs.length} fonte(s) falharam ao gravar
                  </span>
                  <button
                    type="button"
                    onClick={() => runImportQueue(failedJobs)}
                    className="px-4 py-2 bg-[#E50914] hover:bg-red-700 text-white text-xs font-black uppercase rounded-lg"
                  >
                    Tentar Novamente Falhados
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 text-xs font-mono text-zinc-300">
                  {failedJobs.map(f => (
                    <div key={`${f.seasonNumber}_${f.episodeNumber}`}>
                      T{f.seasonNumber}:E{f.episodeNumber} — {f.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importResult && failedJobs.length === 0 ? (
              <div className="bg-emerald-500/10 border border-emerald-500/30 p-6 rounded-2xl text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black uppercase tracking-tight text-emerald-400 font-display">
                  Importação Manual Concluída!
                </h3>
                <p className="text-xs text-zinc-300">
                  <strong className="text-white">{importResult.title}</strong> guardada com {importResult.seasonsImported} temporada(s),{' '}
                  {importResult.episodesImported} episódio(s) e {importResult.sourcesAdded} fonte(s).
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      goToStep(1);
                      setMaxVisitedStep(1);
                      setImportResult(null);
                      setSelectedSeries(null);
                    }}
                    className="px-6 py-3 bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl"
                  >
                    Importar Outra Série
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStep(4)}
                    className="px-5 py-3 bg-white/10 hover:bg-white/15 text-white text-xs font-bold uppercase tracking-wider rounded-xl"
                  >
                    Editar Episódios
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap justify-between items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => goToStep(4)}
                  disabled={isImporting}
                  className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-40 flex items-center gap-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Voltar aos Episódios</span>
                </button>
                <button
                  type="button"
                  onClick={() => runImportQueue()}
                  disabled={isImporting}
                  className="px-8 py-4 bg-[#E50914] hover:bg-red-700 text-white font-black text-xs uppercase tracking-[0.18em] rounded-xl shadow-xl shadow-[#E50914]/30 flex items-center gap-2.5 disabled:opacity-50"
                >
                  {isImporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                  <span>CONFIRMAR IMPORTAÇÃO</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* INLINE TEST PLAYER MODAL */}
      {playTestEp && selectedSeries && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-4xl bg-[#111111] border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-black text-white truncate">
                    Teste — {selectedSeries.title} · T{playTestEp.seasonNumber} E{playTestEp.episodeNumber}
                  </h4>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                      playerDiagStatus === 'confirmed'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : playerDiagStatus === 'format_error' || playerDiagStatus === 'connection_error'
                          ? 'bg-red-500/20 text-red-300 border border-[#E50914]/40'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {playerDiagStatus === 'confirmed'
                      ? 'REPRODUÇÃO CONFIRMADA'
                      : playerDiagStatus === 'format_error'
                        ? 'ERRO DE FORMATO'
                        : playerDiagStatus === 'connection_error'
                          ? 'ERRO DE CONEXÃO'
                          : 'TESTE EM ANDAMENTO'}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">{playTestEp.url}</p>
                {playerDiagMsg && <p className="text-[11px] text-zinc-300 mt-0.5">{playerDiagMsg}</p>}
              </div>
              <button
                type="button"
                onClick={() => setPlayTestEp(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="aspect-video bg-black">
              <ErrorBoundary fallbackTitle="Erro ao testar episódio" resetKey={playTestEp.url}>
                <RonycinePlayer
                  sources={[
                    {
                      id: `importer-test-${playTestEp.seasonNumber}-${playTestEp.episodeNumber}`,
                      url: playTestEp.url,
                      originalUrl: playTestEp.url,
                      format: classifySourceUrl(playTestEp.url).suggestedFormat,
                      sourceKind: classifySourceUrl(playTestEp.url).sourceKind,
                      serverName,
                      audioLanguage,
                      quality,
                      isPrimary: true
                    }
                  ]}
                  title={`${selectedSeries.title} • T${playTestEp.seasonNumber} E${playTestEp.episodeNumber}`}
                  autoplay={true}
                  onPlaybackEvent={(status, message) => {
                    if (status === 'STARTED') {
                      setPlayerDiagStatus('confirmed');
                      setPlayerDiagMsg('Stream inicializado e pronto no navegador.');
                    } else {
                      const lower = (message || '').toLowerCase();
                      setPlayerDiagStatus(
                        lower.includes('formato') || lower.includes('descodificar') || lower.includes('html')
                          ? 'format_error'
                          : 'connection_error'
                      );
                      setPlayerDiagMsg(message || 'Falha ao iniciar reprodução.');
                    }
                  }}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
