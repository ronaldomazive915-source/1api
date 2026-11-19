import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Tv,
  Plus,
  Trash2,
  Play,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Globe,
  Eraser,
  RotateCcw,
  PauseCircle
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  MGEB_PREFIX,
  buildMgebUrl,
  generateEpisodeLinks,
  reprocessMgebUrl,
  stripMgebPrefix,
  isImageOrTrailerUrl
} from '../../lib/mgebUtils.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';
import { SOURCE_QUALITY_OPTIONS } from '../../lib/sourceMetadata.js';
import {
  BatchDiscoveredEpisode,
  BatchDiscoveredSeason,
  BatchEpisodeSourceDraft,
  BatchSeriesDiscoveryGroup,
  SeasonDiscoveryJob,
  TmdbSearchResult
} from '../../types.js';

export interface SeasonDraftInput {
  id: string;
  seasonNumber: number;
  name: string;
  tmdbExpectedCount: number;
  mainUrl: string;
  version: 'dublado' | 'legendado';
  quality: string;
  serverName: string;
  useMgeb: boolean;
}

interface SmartSeriesImporterProps {
  externalJob: SeasonDiscoveryJob | null;
  onJobChange: (job: SeasonDiscoveryJob | null) => void;
  onJobsSaved: () => void;
  onOpenPlayer: (opts: { title: string; src: string; version: 'dublado' | 'legendado' }) => void;
  onCatalogUpdated?: () => void;
  onViewCatalogItem?: (item: {
    id?: string;
    tmdbId: number;
    type: 'movie' | 'tv';
    title: string;
    categories?: string[];
  }) => void;
}

function makeUid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseSeasonHintFromUrl(url: string): number | null {
  const clean = stripMgebPrefix(url).innerUrl || url;
  try {
    const u = new URL(clean);
    const full = `${u.pathname} ${u.search}`;
    const patterns = [
      /(?:temporada|season|temp)[-_/\s=]*(\d{1,3})\b/i,
      /\b(\d{1,2})[-_ ]?(?:a|ª)?[-_ ]?(?:temporada|season)\b/i,
      /[/-]s(\d{1,2})(?:e\d{1,3})?(?:[/-]|$)/i,
      /[?&](?:season|temporada|s)=(\d{1,3})/i
    ];
    for (const rx of patterns) {
      const m = full.match(rx);
      if (m && m[1]) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n >= 0 && n <= 200) return n;
      }
    }
  } catch {
    const m = clean.match(/(?:temporada|season|temp)[-_/\s=]*(\d{1,3})\b/i);
    if (m && m[1]) return parseInt(m[1], 10);
  }
  return null;
}

function inferTitleQueryFromUrl(url: string): string {
  const clean = stripMgebPrefix(url).innerUrl || url;
  try {
    const u = new URL(clean);
    const segments = u.pathname.split('/').filter(Boolean);
    const slug = segments[segments.length - 1] || '';
    const withoutId = slug.replace(/^[A-Za-z0-9]{14,}-/, '');
    const cleaned = withoutId
      .replace(/(?:temporada|season|temp|episode|ep)[-_/\s]*\d+.*$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    return cleaned;
  } catch {
    return '';
  }
}

export const SmartSeriesImporter: React.FC<SmartSeriesImporterProps> = ({
  externalJob,
  onJobChange,
  onJobsSaved,
  onOpenPlayer,
  onCatalogUpdated,
  onViewCatalogItem
}) => {
  // 1. TMDB Series Search & Selected Series State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchingTmdb, setSearchingTmdb] = useState(false);
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedSeries, setSelectedSeries] = useState<{
    tmdbId: number;
    title: string;
    originalTitle?: string;
    posterPath?: string;
    releaseYear?: number;
    overview?: string;
    existsInCatalog: boolean;
    numberOfSeasons?: number;
    numberOfEpisodes?: number;
  } | null>(null);

  const [loadingSeriesDetails, setLoadingSeriesDetails] = useState(false);
  const [includeSpecials, setIncludeSpecials] = useState(false);
  const [seasonDrafts, setSeasonDrafts] = useState<SeasonDraftInput[]>([]);

  // 2. Quick Paste Multiple Season Links
  const [pasteLinksText, setPasteLinksText] = useState('');
  const [recognizingLinks, setRecognizingLinks] = useState(false);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  // 3. Generation & Verification Job Controls
  const [maxEpisodesLimit, setMaxEpisodesLimit] = useState<number>(250);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // 4. Preview, Expand, Pagination & Inline Editing
  const [expandedSeasons, setExpandedSeasons] = useState<Record<string, boolean>>({});
  const [showAllEpisodesBySeason, setShowAllEpisodesBySeason] = useState<Record<string, boolean>>({});
  const [episodePageBySeason, setEpisodePageBySeason] = useState<Record<string, number>>({});
  const [seasonFilter, setSeasonFilter] = useState<'all' | 'incomplete' | 'blocked' | 'error'>('all');
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [seasonBaseDrafts, setSeasonBaseDrafts] = useState<Record<string, string>>({});

  // 5. Catalog Commit State
  const [duplicateMode, setDuplicateMode] = useState<'merge_missing' | 'update_metadata' | 'skip'>('merge_missing');
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{
    message: string;
    results: Array<{
      tmdbId: number;
      type: string;
      title: string;
      status: string;
      seasonsCount: number;
      episodesCount: number;
      sourcesCount: number;
      message: string;
    }>;
  } | null>(null);

  const job = externalJob;

  // Auto-expand first season whenever a new job arrives
  useEffect(() => {
    if (!job || !job.seriesGroups?.length) return;
    const firstGroup = job.seriesGroups[0];
    const firstSeason = firstGroup?.seasons?.[0];
    if (firstGroup && firstSeason) {
      const key = `${firstGroup.tmdbId}-${firstSeason.seasonNumber}`;
      setExpandedSeasons(prev => (Object.keys(prev).length === 0 ? { [key]: true } : prev));
    }
    const baseMap: Record<string, string> = {};
    job.seriesGroups.forEach(g => {
      g.seasons.forEach(s => {
        baseMap[`${g.tmdbId}-${s.seasonNumber}`] = s.mainUrl;
      });
    });
    setSeasonBaseDrafts(baseMap);
  }, [job?.jobId]);

  const metrics = useMemo(() => {
    let seasonsCount = 0;
    let expectedEpisodes = 0;
    let generatedEpisodes = 0;
    let mgebLinks = 0;
    let confirmedEpisodes = 0;
    let blockedOrPending = 0;
    let errorEpisodes = 0;

    if (job) {
      job.seriesGroups.forEach(g => {
        g.seasons.forEach(s => {
          seasonsCount++;
          expectedEpisodes += Number(s.tmdbExpectedCount || s.episodes.length || 0);
          s.episodes.forEach(ep => {
            generatedEpisodes++;
            if (ep.processedUrl && ep.processedUrl.includes('mgeb.space')) {
              mgebLinks++;
            }
            if (ep.verificationStatus === 'verified' || ep.playbackCompatibility === 'compatible') {
              confirmedEpisodes++;
            } else if (ep.verificationStatus === 'error' || ep.verificationStatus === 'not_found') {
              errorEpisodes++;
            } else {
              blockedOrPending++;
            }
          });
        });
      });
    }

    return {
      seasonsCount,
      expectedEpisodes,
      generatedEpisodes,
      mgebLinks,
      confirmedEpisodes,
      blockedOrPending,
      errorEpisodes
    };
  }, [job]);

  const handleCopy = (key: string, value: string) => {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1800);
  };

  const loadTmdbSeriesDetails = async (
    tmdbId: number,
    existingUrlMap?: Map<number, string>,
    showSpecials = includeSpecials
  ) => {
    setLoadingSeriesDetails(true);
    setSearchError(null);
    setGenerationError(null);
    try {
      const details = await api.getTmdbDetails(tmdbId, 'tv');
      const item = details.item;
      if (!item) throw new Error('Série não encontrada na TMDB.');

      setSelectedSeries({
        tmdbId: Number(item.tmdbId || tmdbId),
        title: item.title,
        originalTitle: item.originalTitle,
        posterPath: item.posterPath,
        releaseYear: item.releaseYear,
        overview: item.overview,
        existsInCatalog: Boolean(details.existsInCatalog),
        numberOfSeasons: item.numberOfSeasons || item.seasons?.length || 0,
        numberOfEpisodes: item.numberOfEpisodes || 0
      });

      const tmdbSeasons = (item.seasons || [])
        .filter(s => showSpecials || Number(s.seasonNumber) > 0)
        .sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));

      const builtDrafts: SeasonDraftInput[] = tmdbSeasons.map(s => {
        const sNum = Number(s.seasonNumber);
        const mappedUrl = existingUrlMap?.get(sNum) || '';
        return {
          id: makeUid(`sd-${sNum}`),
          seasonNumber: sNum,
          name: s.name || (sNum === 0 ? 'Especiais' : `Temporada ${sNum}`),
          tmdbExpectedCount: Number(s.episodeCount || 0),
          mainUrl: mappedUrl,
          version: 'dublado',
          quality: '1080p',
          serverName: 'Servidor Dublado MGEB',
          useMgeb: true
        };
      });

      // Also include any pasted season numbers beyond TMDB's list if user provided them
      if (existingUrlMap) {
        existingUrlMap.forEach((url, sNum) => {
          if (!builtDrafts.some(d => d.seasonNumber === sNum)) {
            builtDrafts.push({
              id: makeUid(`sd-${sNum}`),
              seasonNumber: sNum,
              name: sNum === 0 ? 'Especiais' : `Temporada ${sNum}`,
              tmdbExpectedCount: 0,
              mainUrl: url,
              version: 'dublado',
              quality: '1080p',
              serverName: 'Servidor Dublado MGEB',
              useMgeb: true
            });
          }
        });
        builtDrafts.sort((a, b) => a.seasonNumber - b.seasonNumber);
      }

      setSeasonDrafts(builtDrafts);
    } catch (err: any) {
      setSearchError(err?.message || 'Erro ao carregar temporadas da série na TMDB.');
    } finally {
      setLoadingSeriesDetails(false);
    }
  };

  const handleSearchSeries = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchError('Digite o nome ou TMDB ID da série.');
      return;
    }
    setSearchingTmdb(true);
    setSearchError(null);
    try {
      const res = await api.searchTmdb(q, 'tv');
      const items = res.results || [];
      setSearchResults(items);
      if (items.length === 0) {
        setSearchError(`Nenhuma série encontrada na TMDB para "${q}".`);
      } else if (/^\d+$/.test(q) && items[0]) {
        await loadTmdbSeriesDetails(items[0].tmdbId);
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Erro ao pesquisar séries na TMDB.');
    } finally {
      setSearchingTmdb(false);
    }
  };

  const handleRecognizePastedLinks = async () => {
    const rawLines = pasteLinksText
      .split(/\r?\n/)
      .map(s => stripMgebPrefix(s.trim()).innerUrl || s.trim())
      .filter(Boolean);

    if (rawLines.length === 0) {
      setPasteNotice('Cole pelo menos 1 link de temporada (Episódio 1) para preencher automaticamente.');
      return;
    }

    setRecognizingLinks(true);
    setPasteNotice(null);
    setGenerationError(null);

    try {
      // 1. Parse each link strictly to its own season number
      const urlBySeason = new Map<number, string>();
      const unhinted: string[] = [];

      rawLines.forEach(line => {
        const sHint = parseSeasonHintFromUrl(line);
        if (sHint !== null && !urlBySeason.has(sHint)) {
          urlBySeason.set(sHint, line);
        } else {
          unhinted.push(line);
        }
      });

      // Assign any URLs without explicit season keyword sequentially to unused seasons
      let nextFallback = 1;
      unhinted.forEach(line => {
        while (urlBySeason.has(nextFallback)) nextFallback++;
        urlBySeason.set(nextFallback, line);
        nextFallback++;
      });

      // 2. If a series is already selected, map strictly into its existing seasonDrafts
      if (selectedSeries) {
        setSeasonDrafts(prev => {
          const updated = [...prev];
          urlBySeason.forEach((url, sNum) => {
            const idx = updated.findIndex(d => d.seasonNumber === sNum);
            if (idx >= 0) {
              updated[idx] = { ...updated[idx], mainUrl: url };
            } else {
              updated.push({
                id: makeUid(`sd-${sNum}`),
                seasonNumber: sNum,
                name: sNum === 0 ? 'Especiais' : `Temporada ${sNum}`,
                tmdbExpectedCount: 0,
                mainUrl: url,
                version: 'dublado',
                quality: '1080p',
                serverName: 'Servidor Dublado MGEB',
                useMgeb: true
              });
            }
          });
          return updated.sort((a, b) => a.seasonNumber - b.seasonNumber);
        });
        setPasteNotice(`${rawLines.length} link(s) distribuído(s) pelas respetivas temporadas de ${selectedSeries.title}.`);
        return;
      }

      // 3. Otherwise identify the series via TMDB search on slug first (fast, immune to 403) or smart link analyzer
      let resolvedTmdbId: number | null = null;
      const guessedTitle = inferTitleQueryFromUrl(rawLines[0]);
      if (guessedTitle) {
        const tmdbRes = await api.searchTmdb(guessedTitle, 'tv');
        if (tmdbRes.results && tmdbRes.results.length > 0) {
          resolvedTmdbId = tmdbRes.results[0].tmdbId;
          setSearchResults(tmdbRes.results);
        }
      }

      if (!resolvedTmdbId) {
        const analysisRes = await api.analyzeSmartLinks({
          url: rawLines[0],
          preferredType: 'tv'
        });
        const cand = analysisRes.results?.[0]?.selectedCandidate;
        if (cand && cand.tmdbId) {
          resolvedTmdbId = cand.tmdbId;
        }
      }

      if (!resolvedTmdbId) {
        setPasteNotice(
          'Não foi possível identificar a série automaticamente pelo link. Pesquise a série pelo nome ou TMDB ID acima e clique novamente em Preencher.'
        );
        return;
      }

      await loadTmdbSeriesDetails(resolvedTmdbId, urlBySeason);
      setPasteNotice(
        `Série TMDB #${resolvedTmdbId} identificada e ${urlBySeason.size} temporada(s) preenchida(s) isoladamente.`
      );
    } catch (err: any) {
      setPasteNotice(err?.message || 'Erro ao analisar os links colados.');
    } finally {
      setRecognizingLinks(false);
    }
  };

  const addCustomSeasonRow = () => {
    setSeasonDrafts(prev => {
      const maxNum = prev.reduce((max, s) => Math.max(max, s.seasonNumber), 0);
      const nextNum = maxNum + 1;
      return [
        ...prev,
        {
          id: makeUid(`sd-${nextNum}`),
          seasonNumber: nextNum,
          name: `Temporada ${nextNum}`,
          tmdbExpectedCount: 0,
          mainUrl: '',
          version: 'dublado',
          quality: '1080p',
          serverName: 'Servidor Dublado MGEB',
          useMgeb: true
        }
      ];
    });
  };

  const updateSeasonDraft = (id: string, patch: Partial<SeasonDraftInput>) => {
    setSeasonDrafts(prev =>
      prev.map(s => {
        if (s.id !== id) return s;
        const cleanMainUrl =
          patch.mainUrl !== undefined ? stripMgebPrefix(patch.mainUrl).innerUrl || patch.mainUrl : s.mainUrl;
        return { ...s, ...patch, mainUrl: cleanMainUrl };
      })
    );
  };

  const handleGenerateAllEpisodes = async (verifyHttp = false) => {
    setGenerationError(null);
    setCommitResult(null);

    const filledSeasons = seasonDrafts.filter(s => s.mainUrl.trim().length > 0);
    if (!selectedSeries) {
      if (pasteLinksText.trim()) {
        await handleRecognizePastedLinks();
        return;
      }
      setGenerationError('Pesquise e selecione uma série na TMDB (ou cole os links das temporadas) primeiro.');
      return;
    }

    if (filledSeasons.length === 0) {
      setGenerationError('Insira o link do Episódio 1 em pelo menos 1 temporada.');
      return;
    }

    setGenerating(true);
    try {
      const res = await api.generateDeterministicSeriesJob({
        tmdbId: selectedSeries.tmdbId,
        seasons: filledSeasons.map(s => ({
          seasonNumber: s.seasonNumber,
          mainUrl: s.mainUrl.trim(),
          version: s.version,
          useMgeb: s.useMgeb,
          quality: s.quality,
          serverName: s.serverName
        })),
        verifyHttp,
        maxEpisodesLimit
      });

      if (!res?.job) throw new Error('Falha ao gerar episódios da série.');
      onJobChange(res.job);
      onJobsSaved();

      const firstGroup = res.job.seriesGroups?.[0];
      const firstSeason = firstGroup?.seasons?.[0];
      if (firstGroup && firstSeason) {
        setExpandedSeasons({ [`${firstGroup.tmdbId}-${firstSeason.seasonNumber}`]: true });
      }
    } catch (err: any) {
      setGenerationError(err?.message || 'Erro ao gerar episódios automaticamente.');
    } finally {
      setGenerating(false);
    }
  };

  const mutateJob = (updater: (draft: SeasonDiscoveryJob) => SeasonDiscoveryJob) => {
    if (!job) return;
    const cloned: SeasonDiscoveryJob = JSON.parse(JSON.stringify(job));
    const next = updater(cloned);
    // Recompute summary metrics accurately
    let totalEpisodes = 0;
    let verified = 0;
    let unconfirmed = 0;
    let failed = 0;
    next.seriesGroups.forEach(g => {
      g.seasons.forEach(s => {
        s.discoveredCount = s.episodes.length;
        s.verifiedCount = s.episodes.filter(e => e.verificationStatus === 'verified').length;
        s.blockedCount = s.episodes.filter(e => e.protectionDetected).length;
        s.unconfirmedCount = s.episodes.filter(
          e => e.verificationStatus === 'unconfirmed' || e.verificationStatus === 'pending'
        ).length;
        s.errorCount = s.episodes.filter(
          e => e.verificationStatus === 'error' || e.verificationStatus === 'not_found'
        ).length;
        totalEpisodes += s.episodes.length;
        verified += s.verifiedCount;
        unconfirmed += s.unconfirmedCount;
        failed += s.errorCount;
      });
    });
    next.totalEpisodesDiscovered = totalEpisodes;
    next.verifiedEpisodes = verified;
    next.unconfirmedEpisodes = unconfirmed;
    next.failedEpisodes = failed;
    onJobChange(next);
  };

  const handleRegenerateSingleSeason = (group: BatchSeriesDiscoveryGroup, season: BatchDiscoveredSeason) => {
    const seasonKey = `${group.tmdbId}-${season.seasonNumber}`;
    const candidateBase = (seasonBaseDrafts[seasonKey] ?? season.mainUrl).trim();
    const { innerUrl } = stripMgebPrefix(candidateBase);
    const cleanBase = (innerUrl || candidateBase).trim();
    if (!cleanBase) return;

    const targetCount = Math.max(
      Number(season.tmdbExpectedCount || 0),
      season.episodes.length,
      1
    );
    const useMgeb = season.episodes[0]?.useMgebForPlayback !== false;
    const targetVer = season.episodes[0]?.playbackVersion === 'legendado' ? 'legendado' : 'dublado';

    const gen = generateEpisodeLinks({
      firstLink: cleanBase,
      useMgebPrefix: useMgeb,
      startEpisode: 1,
      episodeCount: Math.min(maxEpisodesLimit, targetCount)
    });

    if (!gen.valid) {
      setGenerationError(gen.error || `URL inválida na Temporada ${season.seasonNumber}.`);
      return;
    }

    mutateJob(draft => {
      const g = draft.seriesGroups.find(item => item.tmdbId === group.tmdbId);
      const s = g?.seasons.find(item => item.seasonNumber === season.seasonNumber);
      if (!s) return draft;

      s.mainUrl = cleanBase;
      s.processedMainUrl = buildMgebUrl(cleanBase, useMgeb).finalUrl || cleanBase;

      const existingMap = new Map<number, BatchDiscoveredEpisode>();
      s.episodes.forEach(ep => existingMap.set(ep.episodeNumber, ep));

      s.episodes = gen.links.map(link => {
        const prevEp = existingMap.get(link.episodeNumber);
        const built = buildMgebUrl(link.innerUrl, useMgeb);
        const procUrl = useMgeb ? built.finalUrl : link.innerUrl;
        const procDisp = useMgeb ? built.displayFinalUrl : link.innerUrl;

        const nextSource: BatchEpisodeSourceDraft = {
          id: prevEp?.sources?.[0]?.id || makeUid(`src-s${s.seasonNumber}-e${link.episodeNumber}`),
          originalUrl: link.innerUrl,
          processedUrl: procUrl,
          processedUrlDisplay: procDisp,
          version: prevEp?.playbackVersion || targetVer,
          serverName:
            prevEp?.sources?.[0]?.serverName ||
            (targetVer === 'legendado' ? 'Servidor Legendado MGEB' : 'Servidor Dublado MGEB'),
          quality: prevEp?.sources?.[0]?.quality || '1080p',
          useMgeb,
          compatibilityStatus: 'untested',
          compatibilityMessage: 'Link regenerado exclusivamente para esta temporada.',
          createdAt: prevEp?.createdAt || new Date().toISOString()
        };

        return {
          episodeId: prevEp?.episodeId || `ep-${group.tmdbId}-s${s.seasonNumber}-e${link.episodeNumber}`,
          seriesId: s.seriesId,
          seasonId: s.seasonId,
          episodeNumber: link.episodeNumber,
          title: prevEp?.title || `Episódio ${link.episodeNumber}`,
          overview: prevEp?.overview,
          stillPath: prevEp?.stillPath,
          duration: prevEp?.duration,
          airDate: prevEp?.airDate,
          voteAverage: prevEp?.voteAverage,
          originalPageUrl: cleanBase,
          episodePageUrl: link.innerUrl,
          originalUrl: link.innerUrl,
          processedUrl: procUrl,
          processedUrlDisplay: procDisp,
          playbackSourceUrl: prevEp?.playbackSourceUrl || null,
          playbackVersion: prevEp?.playbackVersion || targetVer,
          useMgebForPlayback: useMgeb,
          verificationStatus: 'unconfirmed',
          detailedState: useMgeb ? 'mgeb_applied' : 'url_generated',
          stateReason: `Regenerado a partir da URL da Temporada ${s.seasonNumber}.`,
          playbackCompatibility: 'untested',
          approved: prevEp ? prevEp.approved : true,
          existsInCatalog: prevEp?.existsInCatalog,
          sources: [nextSource, ...(prevEp?.sources?.slice(1) || [])],
          createdAt: prevEp?.createdAt || new Date().toISOString()
        };
      });

      s.status = 'completed';
      s.endDetectedReason = `${s.episodes.length} episódios regenerados isoladamente para Temporada ${s.seasonNumber}.`;
      return draft;
    });
  };

  const handleUpdateEpisodeOriginalUrl = (
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
    rawInput: string
  ) => {
    const cleanOrig = stripMgebPrefix(rawInput).innerUrl || rawInput.trim();
    mutateJob(draft => {
      const g = draft.seriesGroups.find(item => item.tmdbId === tmdbId);
      const s = g?.seasons.find(item => item.seasonNumber === seasonNumber);
      const ep = s?.episodes.find(e => e.episodeNumber === episodeNumber);
      if (!ep) return draft;

      const useMgeb = ep.useMgebForPlayback !== false;
      const built = buildMgebUrl(cleanOrig, useMgeb);
      ep.originalUrl = cleanOrig;
      ep.episodePageUrl = cleanOrig;
      ep.processedUrl = built.valid ? built.finalUrl : cleanOrig;
      ep.processedUrlDisplay = built.valid ? built.displayFinalUrl : cleanOrig;
      ep.detailedState = useMgeb && built.valid ? 'mgeb_applied' : 'url_generated';

      if (ep.sources.length > 0) {
        ep.sources[0].originalUrl = cleanOrig;
        ep.sources[0].processedUrl = ep.processedUrl;
        ep.sources[0].processedUrlDisplay = ep.processedUrlDisplay;
      }
      return draft;
    });
  };

  const handleReprocessEpisodeMgeb = (
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
    toggleUseMgeb?: boolean
  ) => {
    mutateJob(draft => {
      const g = draft.seriesGroups.find(item => item.tmdbId === tmdbId);
      const s = g?.seasons.find(item => item.seasonNumber === seasonNumber);
      const ep = s?.episodes.find(e => e.episodeNumber === episodeNumber);
      if (!ep) return draft;

      const useMgeb = toggleUseMgeb !== undefined ? toggleUseMgeb : ep.useMgebForPlayback !== false;
      const re = reprocessMgebUrl(ep.originalUrl, useMgeb);
      ep.useMgebForPlayback = useMgeb;
      ep.originalUrl = re.innerUrl || ep.originalUrl;
      ep.episodePageUrl = ep.originalUrl;
      ep.processedUrl = re.valid ? re.finalUrl : ep.originalUrl;
      ep.processedUrlDisplay = re.valid ? re.displayFinalUrl : ep.originalUrl;
      ep.detailedState = useMgeb && re.valid ? 'mgeb_applied' : 'url_generated';
      ep.sources = ep.sources.map((src, idx) => {
        const sre = reprocessMgebUrl(src.originalUrl || ep.originalUrl, idx === 0 ? useMgeb : src.useMgeb);
        return {
          ...src,
          useMgeb: idx === 0 ? useMgeb : src.useMgeb,
          originalUrl: sre.innerUrl || src.originalUrl,
          processedUrl: sre.valid ? sre.finalUrl : src.originalUrl,
          processedUrlDisplay: sre.valid ? sre.displayFinalUrl : src.originalUrl
        };
      });
      return draft;
    });
  };

  const handleTestEpisodeMgeb = async (
    tmdbId: number,
    seasonNumber: number,
    ep: BatchDiscoveredEpisode
  ) => {
    if (!job) return;
    const key = `${tmdbId}-${seasonNumber}-${ep.episodeNumber}`;
    setTestingKey(key);
    try {
      const targetUrl = ep.processedUrl || ep.originalUrl;
      const res = await api.testBatchMgebSource(job.jobId, {
        url: targetUrl,
        tmdbId,
        seasonNumber,
        episodeNumber: ep.episodeNumber
      });
      if (res?.job) {
        onJobChange(res.job);
      } else if (res?.result) {
        mutateJob(draft => {
          const g = draft.seriesGroups.find(item => item.tmdbId === tmdbId);
          const s = g?.seasons.find(item => item.seasonNumber === seasonNumber);
          const targetEp = s?.episodes.find(e => e.episodeNumber === ep.episodeNumber);
          if (targetEp) {
            targetEp.playbackCompatibility = res.result.compatibilityStatus;
            targetEp.compatibilityMessage = res.result.compatibilityMessage;
          }
          return draft;
        });
      }
    } catch {
      // ignore error silently; status remains honest
    } finally {
      setTestingKey(null);
    }
  };

  const handleVerifyHttp = async (seasonNumber?: number, tmdbId?: number) => {
    if (!job) return;
    try {
      const res = await api.verifyBatchSeasonHttp(job.jobId, { seasonNumber, tmdbId });
      if (res?.job) onJobChange(res.job);
    } catch (err: any) {
      setGenerationError(err?.message || 'Não foi possível iniciar a verificação externa.');
    }
  };

  const handleCommitSeries = async () => {
    if (!job || !job.seriesGroups.length) return;
    setCommitting(true);
    setGenerationError(null);
    setCommitResult(null);

    try {
      const res = await api.commitBatchSeasonDiscovery(job.jobId, {
        seriesGroups: job.seriesGroups,
        duplicateMode
      });
      setCommitResult({
        message: res.message,
        results: res.results || []
      });
      if (res.job) onJobChange(res.job);
      onCatalogUpdated?.();
      onJobsSaved();
    } catch (err: any) {
      setGenerationError(err?.message || 'Erro ao gravar série e episódios no catálogo.');
    } finally {
      setCommitting(false);
    }
  };

  const toggleAllSeasonsExpand = (expand: boolean) => {
    if (!job) return;
    const next: Record<string, boolean> = {};
    job.seriesGroups.forEach(g => {
      g.seasons.forEach(s => {
        next[`${g.tmdbId}-${s.seasonNumber}`] = expand;
      });
    });
    setExpandedSeasons(next);
  };

  const toggleAllApproved = (approved: boolean) => {
    mutateJob(draft => {
      draft.seriesGroups.forEach(g => {
        g.seasons.forEach(s => {
          s.approved = approved;
          s.episodes.forEach(ep => {
            ep.approved = approved;
          });
        });
      });
      return draft;
    });
  };

  return (
    <div className="space-y-6">
      {/* 1. IDENTIFICAÇÃO DA SÉRIE + COLAGEM DE LINKS POR TEMPORADA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pesquisar Série na TMDB */}
        <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Passo 1 · Pesquisa Oficial TMDB (Séries)
            </p>
            <h3 className="text-base font-bold text-white mt-0.5">
              Selecionar Série por Nome ou TMDB ID
            </h3>
          </div>

          <form onSubmit={handleSearchSeries} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Ex: The Mentalist ou 5920"
                className="w-full min-h-[42px] bg-black border border-white/15 focus:border-[#E50914] rounded-lg pl-10 pr-3 text-sm text-white placeholder:text-zinc-600 outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={searchingTmdb || loadingSeriesDetails}
              className="min-h-[42px] px-4 rounded-lg bg-[#E50914] hover:bg-[#c80812] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shrink-0"
            >
              {searchingTmdb || loadingSeriesDetails ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Carregar Série
            </button>
          </form>

          {searchError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {searchError}
            </p>
          )}

          {searchResults.length > 0 && (
            <div className="divide-y divide-white/5 border border-white/10 rounded-lg max-h-64 overflow-y-auto bg-black">
              {searchResults.slice(0, 8).map(item => (
                <button
                  key={`tv-res-${item.tmdbId}`}
                  type="button"
                  onClick={() => loadTmdbSeriesDetails(item.tmdbId)}
                  className={`w-full text-left p-3 flex items-center justify-between gap-3 hover:bg-white/[0.04] transition-colors ${
                    selectedSeries?.tmdbId === item.tmdbId ? 'bg-[#E50914]/10' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.posterPath ? (
                      <img
                        src={resolveTmdbPosterUrl(item.posterPath)}
                        alt={item.title}
                        className="w-9 h-13 object-cover rounded border border-white/10 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-13 rounded bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0">
                        <Tv className="w-4 h-4 text-zinc-600" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{item.title}</p>
                      <p className="text-[11px] font-mono text-zinc-400 tabular-nums">
                        TMDB #{item.tmdbId}
                        {item.firstAirDate ? ` · ${String(item.firstAirDate).slice(0, 4)}` : ''}
                        {item.existsInCatalog ? ' · Já no Catálogo' : ' · Nova Série'}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-[#E50914] shrink-0">
                    {selectedSeries?.tmdbId === item.tmdbId ? 'Selecionada' : 'Selecionar'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Colagem Rápida de Múltiplos Links de Temporadas */}
        <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Preenchimento Rápido por Links de Temporadas
              </p>
              <h3 className="text-base font-bold text-white mt-0.5">
                Colar Links Base das Temporadas (Ep 1)
              </h3>
            </div>
            {pasteLinksText.trim() && (
              <button
                type="button"
                onClick={() => setPasteLinksText('')}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
              >
                <Eraser className="w-3.5 h-3.5" />
                Limpar
              </button>
            )}
          </div>

          <textarea
            value={pasteLinksText}
            onChange={e => setPasteLinksText(e.target.value)}
            rows={4}
            placeholder={
              'Cole 1 link por linha (Ex: Season-1, Season-2...):\nhttps://ver.123pelicula.com/pt/detail/drama/gjG2CqKaqR601v37CBElT-The-Mentalist-Season-1'
            }
            className="w-full bg-black border border-white/15 focus:border-[#E50914] rounded-lg p-3 text-xs font-mono text-white placeholder:text-zinc-600 outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-zinc-400">
              Cada temporada mantém a sua própria URL base sem misturas.
            </span>
            <button
              type="button"
              onClick={handleRecognizePastedLinks}
              disabled={recognizingLinks}
              className="min-h-[42px] px-4 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-50 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
            >
              {recognizingLinks ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Reconhecer Links e Preencher Temporadas
            </button>
          </div>

          {pasteNotice && (
            <p className="text-xs text-zinc-300 bg-black border border-white/10 rounded-lg px-3 py-2">
              {pasteNotice}
            </p>
          )}
        </div>
      </div>

      {/* 2. CONFIGURAÇÃO DAS TEMPORADAS DA SÉRIE SELECIONADA */}
      {selectedSeries && (
        <div className="bg-[#0e0e11] border border-white/10 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {selectedSeries.posterPath ? (
                <img
                  src={resolveTmdbPosterUrl(selectedSeries.posterPath)}
                  alt={selectedSeries.title}
                  className="w-12 h-18 object-cover rounded-lg border border-white/10 shrink-0"
                />
              ) : (
                <div className="w-12 h-18 rounded-lg bg-black border border-white/10 flex items-center justify-center shrink-0">
                  <Tv className="w-5 h-5 text-zinc-600" />
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <h3 className="text-lg font-bold text-white truncate">{selectedSeries.title}</h3>
                <p className="text-xs font-mono text-zinc-400 tabular-nums">
                  TMDB #{selectedSeries.tmdbId}
                  {selectedSeries.releaseYear ? ` · ${selectedSeries.releaseYear}` : ''}
                  {` · ${seasonDrafts.length} temporada(s) configurável(eis)`}
                  {selectedSeries.numberOfEpisodes ? ` · ${selectedSeries.numberOfEpisodes} eps oficiais` : ''}
                  {selectedSeries.existsInCatalog ? ' · Já no Catálogo' : ' · Nova Série'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer mr-2">
                <input
                  type="checkbox"
                  checked={includeSpecials}
                  onChange={e => {
                    const checked = e.target.checked;
                    setIncludeSpecials(checked);
                    const currentMap = new Map<number, string>();
                    seasonDrafts.forEach(s => {
                      if (s.mainUrl.trim()) currentMap.set(s.seasonNumber, s.mainUrl.trim());
                    });
                    void loadTmdbSeriesDetails(selectedSeries.tmdbId, currentMap, checked);
                  }}
                  className="accent-[#E50914]"
                />
                Incluir Especiais (T0)
              </label>

              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span>Limite/Temp:</span>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={maxEpisodesLimit}
                  onChange={e => setMaxEpisodesLimit(Math.max(1, Number(e.target.value) || 250))}
                  className="w-20 min-h-[38px] bg-black border border-white/15 rounded-lg px-2 text-xs font-mono text-white text-center outline-none tabular-nums"
                />
              </div>

              <button
                type="button"
                onClick={addCustomSeasonRow}
                className="min-h-[42px] px-3.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Adicionar Temporada
              </button>

              <button
                type="button"
                onClick={() => handleGenerateAllEpisodes(false)}
                disabled={generating}
                className="min-h-[42px] px-5 rounded-lg bg-[#E50914] hover:bg-[#c80812] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2"
              >
                {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Gerar Todos os Episódios (TMDB + MGEB)
              </button>
            </div>
          </div>

          {/* Linhas de Temporadas (100% dinâmico e isolado) */}
          <div className="divide-y divide-white/5">
            {seasonDrafts.map(draft => {
              const builtEp1 = draft.mainUrl.trim() ? buildMgebUrl(draft.mainUrl, draft.useMgeb) : null;
              const samplePattern = draft.mainUrl.trim()
                ? generateEpisodeLinks({
                    firstLink: draft.mainUrl,
                    useMgebPrefix: draft.useMgeb,
                    startEpisode: 1,
                    episodeCount: 2
                  })
                : null;

              return (
                <div key={draft.id} className="p-4 space-y-2.5 bg-black/30">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center">
                    <div className="lg:col-span-2 flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={200}
                        value={draft.seasonNumber}
                        onChange={e =>
                          updateSeasonDraft(draft.id, {
                            seasonNumber: Math.max(0, parseInt(e.target.value, 10) || 0)
                          })
                        }
                        className="w-16 min-h-[42px] bg-black border border-white/15 rounded-lg px-2 text-xs font-mono font-bold text-white text-center outline-none tabular-nums"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{draft.name}</p>
                        <p className="text-[11px] font-mono text-zinc-400 tabular-nums">
                          {draft.tmdbExpectedCount > 0 ? `${draft.tmdbExpectedCount} eps TMDB` : 'Manual'}
                        </p>
                      </div>
                    </div>

                    <div className="lg:col-span-5">
                      <input
                        type="text"
                        value={draft.mainUrl}
                        onChange={e => updateSeasonDraft(draft.id, { mainUrl: e.target.value })}
                        placeholder={`URL do Episódio 1 da Temporada ${draft.seasonNumber} (https://...)`}
                        className="w-full min-h-[42px] bg-black border border-white/15 focus:border-[#E50914] rounded-lg px-3 text-xs font-mono text-white placeholder:text-zinc-600 outline-none"
                      />
                    </div>

                    <div className="lg:col-span-2">
                      <select
                        value={draft.version}
                        onChange={e =>
                          updateSeasonDraft(draft.id, {
                            version: e.target.value === 'legendado' ? 'legendado' : 'dublado'
                          })
                        }
                        className="w-full min-h-[42px] bg-black border border-white/15 rounded-lg px-2.5 text-xs text-white outline-none"
                      >
                        <option value="dublado">Dublado</option>
                        <option value="legendado">Legendado</option>
                      </select>
                    </div>

                    <div className="lg:col-span-1">
                      <select
                        value={draft.quality}
                        onChange={e => updateSeasonDraft(draft.id, { quality: e.target.value })}
                        className="w-full min-h-[42px] bg-black border border-white/15 rounded-lg px-2 text-xs text-white outline-none"
                      >
                        {SOURCE_QUALITY_OPTIONS.map(q => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="lg:col-span-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => updateSeasonDraft(draft.id, { useMgeb: !draft.useMgeb })}
                        className={`min-h-[42px] px-3 rounded-lg border text-xs font-bold ${
                          draft.useMgeb
                            ? 'bg-[#E50914]/15 border-[#E50914]/40 text-[#ff7379]'
                            : 'bg-zinc-900 border-white/15 text-zinc-400'
                        }`}
                      >
                        {draft.useMgeb ? 'MGEB ON' : 'MGEB OFF'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setSeasonDrafts(prev => prev.filter(s => s.id !== draft.id))}
                        className="min-h-[42px] px-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"
                        title="Remover temporada da lista"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {draft.mainUrl.trim() && builtEp1 && (
                    <div className="text-[11px] font-mono space-y-0.5 pl-0 lg:pl-2">
                      <p className={builtEp1.valid ? 'text-emerald-400 break-all' : 'text-red-400'}>
                        <span className="text-zinc-500 font-sans">Ep 1 (MGEB): </span>
                        {builtEp1.valid ? builtEp1.finalUrl : builtEp1.error}
                      </p>
                      {samplePattern?.valid && samplePattern.links[1] && (
                        <p className="text-zinc-400 break-all">
                          <span className="text-zinc-500 font-sans">Padrão Ep 2+: </span>
                          {samplePattern.links[1].url}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {generationError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{generationError}</span>
        </div>
      )}

      {/* 3. RESULTADO GERADO — MÉTRICAS, PRÉ-VISUALIZAÇÃO COMPLETA E IMPORTAÇÃO */}
      {job && job.seriesGroups.length > 0 && (
        <div className="space-y-5">
          {/* Painel de Métricas Reais & Controles */}
          <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 flex-1">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Temporadas</p>
                  <p className="text-lg font-bold text-white tabular-nums">{metrics.seasonsCount}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Esperados TMDB</p>
                  <p className="text-lg font-bold text-white tabular-nums">{metrics.expectedEpisodes}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Gerados</p>
                  <p className="text-lg font-bold text-emerald-400 tabular-nums">{metrics.generatedEpisodes}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Links MGEB</p>
                  <p className="text-lg font-bold text-emerald-300 tabular-nums">{metrics.mgebLinks}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Confirmados</p>
                  <p className="text-lg font-bold text-sky-400 tabular-nums">{metrics.confirmedEpisodes}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Aguard. / Bloq.</p>
                  <p className="text-lg font-bold text-amber-300 tabular-nums">{metrics.blockedOrPending}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Erros</p>
                  <p className="text-lg font-bold text-red-400 tabular-nums">{metrics.errorEpisodes}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {job.status === 'RUNNING' ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await api.cancelBatchSeasonJob(job.jobId);
                      if (r?.job) onJobChange(r.job);
                    }}
                    className="min-h-[40px] px-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-1.5"
                  >
                    <PauseCircle className="w-4 h-4" />
                    Parar Verificação
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleVerifyHttp()}
                    className="min-h-[40px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5"
                    title="Opcional: tenta consultar as páginas externas. Se houver bloqueio HTTP 403, os episódios MGEB permanecem intactos."
                  >
                    <Globe className="w-3.5 h-3.5 text-sky-400" />
                    Verificar Origem (HTTP)
                  </button>
                )}

                <select
                  value={duplicateMode}
                  onChange={e => setDuplicateMode(e.target.value as any)}
                  className="min-h-[40px] bg-black border border-white/15 rounded-lg px-3 text-xs text-white outline-none"
                >
                  <option value="merge_missing">Duplicados: Mesclar em Falta</option>
                  <option value="update_metadata">Duplicados: Atualizar Metadados</option>
                  <option value="skip">Duplicados: Ignorar Existentes</option>
                </select>

                <button
                  type="button"
                  onClick={handleCommitSeries}
                  disabled={committing}
                  className="min-h-[40px] px-5 rounded-lg bg-[#E50914] hover:bg-[#c80812] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2"
                >
                  {committing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Importar Série Completa
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-white/5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <p className="text-zinc-300">{job.currentTask}</p>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={seasonFilter}
                  onChange={e => setSeasonFilter(e.target.value as any)}
                  className="bg-black border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                >
                  <option value="all">Mostrar: Todas as Temporadas</option>
                  <option value="incomplete">Apenas Incompletas</option>
                  <option value="blocked">Bloqueadas (HTTP 403)</option>
                  <option value="error">Com Erro</option>
                </select>

                <button
                  type="button"
                  onClick={() => toggleAllSeasonsExpand(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200"
                >
                  Expandir Todas
                </button>
                <button
                  type="button"
                  onClick={() => toggleAllSeasonsExpand(false)}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200"
                >
                  Recolher Todas
                </button>
                <button
                  type="button"
                  onClick={() => toggleAllApproved(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200"
                >
                  Marcar Tudo
                </button>
                <button
                  type="button"
                  onClick={() => toggleAllApproved(false)}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200"
                >
                  Desmarcar Tudo
                </button>
              </div>
            </div>
          </div>

          {commitResult && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-300 text-sm font-bold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{commitResult.message}</span>
                </div>
                {job.seriesGroups[0] && onViewCatalogItem && (
                  <button
                    type="button"
                    onClick={() =>
                      onViewCatalogItem({
                        tmdbId: job.seriesGroups[0].tmdbId,
                        type: 'tv',
                        title: job.seriesGroups[0].title,
                        categories: job.seriesGroups[0].categories
                      })
                    }
                    className="min-h-[38px] px-3.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs font-bold flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Ver Série no Catálogo
                  </button>
                )}
              </div>
              {commitResult.results.map(r => (
                <p key={`${r.tmdbId}-${r.title}`} className="text-xs text-zinc-300 font-mono">
                  {r.title} · {r.seasonsCount}T / {r.episodesCount}E / {r.sourcesCount} fontes MGEB · {r.message}
                </p>
              ))}
            </div>
          )}

          {/* Lista de Grupos de Séries e Temporadas */}
          {job.seriesGroups.map(group => {
            const visibleSeasons = group.seasons.filter(s => {
              if (seasonFilter === 'incomplete') {
                return s.tmdbExpectedCount > 0 && s.episodes.length < s.tmdbExpectedCount;
              }
              if (seasonFilter === 'blocked') {
                return s.blockedCount > 0 || s.detailedState === 'blocked_by_provider';
              }
              if (seasonFilter === 'error') {
                return s.errorCount > 0 || s.status === 'error';
              }
              return true;
            });

            return (
              <div key={group.groupKey} className="space-y-3">
                {/* Barra de Título da Série no Preview */}
                <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {group.posterPath && (
                      <img
                        src={resolveTmdbPosterUrl(group.posterPath)}
                        alt={group.title}
                        className="w-10 h-14 object-cover rounded border border-white/10 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <h4 className="text-base font-bold text-white truncate">{group.title}</h4>
                      <p className="text-xs font-mono text-zinc-400 tabular-nums">
                        TMDB #{group.tmdbId}
                        {group.releaseYear ? ` · ${group.releaseYear}` : ''}
                        {` · ${group.seasons.length} temporada(s)`}
                        {` · ${group.seasons.reduce((a, s) => a + s.episodes.length, 0)} episódio(s) pronto(s)`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Acordeões de Cada Temporada */}
                {visibleSeasons.map(season => {
                  const seasonKey = `${group.tmdbId}-${season.seasonNumber}`;
                  const isExpanded = Boolean(expandedSeasons[seasonKey]);
                  const showAll = showAllEpisodesBySeason[seasonKey] ?? true;
                  const currentPage = episodePageBySeason[seasonKey] || 1;
                  const pageSize = 25;
                  const totalPages = Math.max(1, Math.ceil(season.episodes.length / pageSize));
                  const displayedEpisodes = showAll
                    ? season.episodes
                    : season.episodes.slice((currentPage - 1) * pageSize, currentPage * pageSize);

                  const isIncomplete =
                    season.tmdbExpectedCount > 0 && season.episodes.length < season.tmdbExpectedCount;

                  return (
                    <div key={season.seasonId} className="bg-[#0e0e11] border border-white/10 rounded-xl overflow-hidden">
                      {/* Cabeçalho da Temporada */}
                      <div className="p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-white/5">
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={season.approved}
                            onChange={e => {
                              const checked = e.target.checked;
                              mutateJob(draft => {
                                const g = draft.seriesGroups.find(i => i.tmdbId === group.tmdbId);
                                const s = g?.seasons.find(i => i.seasonNumber === season.seasonNumber);
                                if (s) {
                                  s.approved = checked;
                                  s.episodes.forEach(ep => {
                                    ep.approved = checked;
                                  });
                                }
                                return draft;
                              });
                            }}
                            className="mt-1 w-4 h-4 accent-[#E50914] shrink-0"
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSeasons(prev => ({ ...prev, [seasonKey]: !prev[seasonKey] }))
                            }
                            className="flex items-start gap-2 text-left min-w-0 flex-1"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                            )}
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                <span className="text-sm font-bold text-white">
                                  Temporada {season.seasonNumber} — {season.name}
                                </span>
                                <span className="text-xs font-mono text-zinc-400 tabular-nums">
                                  {season.tmdbExpectedCount > 0
                                    ? `${season.tmdbExpectedCount} esperados · ${season.episodes.length} gerados`
                                    : `${season.episodes.length} gerados`}
                                  {` · ${season.episodes.filter(e => e.processedUrl.includes('mgeb.space')).length} MGEB`}
                                </span>
                                {isIncomplete ? (
                                  <span className="text-xs font-semibold text-amber-300">
                                    · Incompleta ({season.episodes.length}/{season.tmdbExpectedCount})
                                  </span>
                                ) : season.episodes.length > 0 ? (
                                  <span className="text-xs font-semibold text-emerald-400">· Completa</span>
                                ) : null}
                              </div>
                              <p className="text-[11px] font-mono text-zinc-500 truncate">
                                Base T{season.seasonNumber}: {season.mainUrl}
                              </p>
                              {season.endDetectedReason && (
                                <p className="text-[11px] text-zinc-400">{season.endDetectedReason}</p>
                              )}
                            </div>
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {isIncomplete && (
                            <button
                              type="button"
                              onClick={() => handleRegenerateSingleSeason(group, season)}
                              className="min-h-[38px] px-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-bold flex items-center gap-1.5"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Completar em Falta
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleVerifyHttp(season.seasonNumber, group.tmdbId)}
                            className="min-h-[38px] px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-xs flex items-center gap-1.5"
                          >
                            <Globe className="w-3.5 h-3.5 text-sky-400" />
                            Verificar HTTP
                          </button>
                        </div>
                      </div>

                      {/* Área Expandida da Temporada */}
                      {isExpanded && (
                        <div className="bg-black/40">
                          {/* Barra de Edição/Regeneração Isolada da Temporada */}
                          <div className="p-3.5 border-b border-white/5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1">
                              <span className="text-[11px] font-bold text-zinc-400 shrink-0">
                                Link Base T{season.seasonNumber}:
                              </span>
                              <input
                                type="text"
                                value={seasonBaseDrafts[seasonKey] ?? season.mainUrl}
                                onChange={e =>
                                  setSeasonBaseDrafts(prev => ({
                                    ...prev,
                                    [seasonKey]: e.target.value
                                  }))
                                }
                                className="flex-1 min-h-[38px] bg-black border border-white/15 rounded-lg px-2.5 text-xs font-mono text-white outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleRegenerateSingleSeason(group, season)}
                                className="min-h-[38px] px-3 rounded-lg bg-white/10 hover:bg-[#E50914] text-white text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Regenerar T{season.seasonNumber}
                              </button>
                            </div>

                            <div className="flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() =>
                                  setShowAllEpisodesBySeason(prev => ({
                                    ...prev,
                                    [seasonKey]: !showAll
                                  }))
                                }
                                className="px-2.5 py-1.5 rounded bg-white/5 hover:bg-white/10 text-zinc-300"
                              >
                                {showAll ? 'Paginar (25/pág)' : `Mostrar Todos (${season.episodes.length})`}
                              </button>
                            </div>
                          </div>

                          {/* Episódios */}
                          <div className="divide-y divide-white/5">
                            {displayedEpisodes.map(ep => {
                              const epKey = `${group.tmdbId}-${season.seasonNumber}-${ep.episodeNumber}`;
                              const builtEp = buildMgebUrl(ep.originalUrl, ep.useMgebForPlayback !== false);
                              const isTestingThis = testingKey === epKey;
                              const isBlockedAsset = isImageOrTrailerUrl(ep.originalUrl);

                              return (
                                <div key={ep.episodeId} className="p-3.5 space-y-2.5 hover:bg-white/[0.02]">
                                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                      <input
                                        type="checkbox"
                                        checked={ep.approved}
                                        onChange={e => {
                                          const checked = e.target.checked;
                                          mutateJob(draft => {
                                            const g = draft.seriesGroups.find(i => i.tmdbId === group.tmdbId);
                                            const s = g?.seasons.find(i => i.seasonNumber === season.seasonNumber);
                                            const target = s?.episodes.find(i => i.episodeNumber === ep.episodeNumber);
                                            if (target) target.approved = checked;
                                            return draft;
                                          });
                                        }}
                                        className="w-4 h-4 accent-[#E50914] shrink-0"
                                      />

                                      <span className="font-mono text-xs font-bold text-[#E50914] w-9 shrink-0 tabular-nums">
                                        E{String(ep.episodeNumber).padStart(2, '0')}
                                      </span>

                                      <input
                                        type="text"
                                        value={ep.title}
                                        onChange={e => {
                                          const val = e.target.value;
                                          mutateJob(draft => {
                                            const g = draft.seriesGroups.find(i => i.tmdbId === group.tmdbId);
                                            const s = g?.seasons.find(i => i.seasonNumber === season.seasonNumber);
                                            const target = s?.episodes.find(i => i.episodeNumber === ep.episodeNumber);
                                            if (target) target.title = val;
                                            return draft;
                                          });
                                        }}
                                        className="flex-1 min-w-0 bg-transparent border border-transparent hover:border-white/10 focus:border-white/25 rounded px-2 py-1 text-xs font-semibold text-white outline-none"
                                      />
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 text-[11px] shrink-0">
                                      {ep.duration && (
                                        <span className="font-mono text-zinc-500 tabular-nums">{ep.duration}m</span>
                                      )}
                                      <span
                                        className={`font-semibold ${
                                          ep.verificationStatus === 'verified' ||
                                          ep.playbackCompatibility === 'compatible'
                                            ? 'text-emerald-400'
                                            : ep.protectionDetected
                                            ? 'text-amber-300'
                                            : ep.verificationStatus === 'error'
                                            ? 'text-red-400'
                                            : 'text-sky-300'
                                        }`}
                                      >
                                        {ep.verificationStatus === 'verified' ||
                                        ep.playbackCompatibility === 'compatible'
                                          ? 'Confirmado'
                                          : ep.protectionDetected
                                          ? 'HTTP 403 · MGEB Pronto'
                                          : ep.verificationStatus === 'error'
                                          ? 'Erro'
                                          : ep.useMgebForPlayback !== false
                                          ? 'MGEB Aplicado'
                                          : 'Link Gerado'}
                                      </span>

                                      <select
                                        value={ep.playbackVersion === 'legendado' ? 'legendado' : 'dublado'}
                                        onChange={e => {
                                          const ver =
                                            e.target.value === 'legendado' ? 'legendado' : 'dublado';
                                          mutateJob(draft => {
                                            const g = draft.seriesGroups.find(i => i.tmdbId === group.tmdbId);
                                            const s = g?.seasons.find(i => i.seasonNumber === season.seasonNumber);
                                            const target = s?.episodes.find(
                                              i => i.episodeNumber === ep.episodeNumber
                                            );
                                            if (target) {
                                              target.playbackVersion = ver;
                                              if (target.sources[0]) target.sources[0].version = ver;
                                            }
                                            return draft;
                                          });
                                        }}
                                        className="bg-black border border-white/15 rounded px-2 py-1 text-[11px] text-white outline-none"
                                      >
                                        <option value="dublado">Dublado</option>
                                        <option value="legendado">Legendado</option>
                                      </select>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleReprocessEpisodeMgeb(
                                            group.tmdbId,
                                            season.seasonNumber,
                                            ep.episodeNumber,
                                            !(ep.useMgebForPlayback !== false)
                                          )
                                        }
                                        className={`px-2 py-1 rounded border text-[10px] font-bold ${
                                          ep.useMgebForPlayback !== false
                                            ? 'bg-[#E50914]/15 border-[#E50914]/40 text-[#ff7379]'
                                            : 'bg-zinc-900 border-white/15 text-zinc-400'
                                        }`}
                                      >
                                        {ep.useMgebForPlayback !== false ? 'MGEB ON' : 'MGEB OFF'}
                                      </button>
                                    </div>
                                  </div>

                                  {/* URL Original Editável & URL MGEB + Ações */}
                                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-center pl-0 lg:pl-7">
                                    <div className="lg:col-span-6">
                                      <input
                                        type="text"
                                        value={ep.originalUrl}
                                        onChange={e =>
                                          handleUpdateEpisodeOriginalUrl(
                                            group.tmdbId,
                                            season.seasonNumber,
                                            ep.episodeNumber,
                                            e.target.value
                                          )
                                        }
                                        className="w-full min-h-[36px] bg-black border border-white/10 focus:border-[#E50914] rounded px-2.5 text-[11px] font-mono text-zinc-300 outline-none"
                                      />
                                    </div>

                                    <div className="lg:col-span-6 flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-[11px] font-mono text-emerald-400 truncate max-w-full flex-1">
                                        {isBlockedAsset
                                          ? 'Imagem/Trailer — sem prefixo MGEB'
                                          : ep.processedUrl || builtEp.finalUrl}
                                      </p>

                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleCopy(epKey, ep.processedUrl || builtEp.finalUrl)
                                          }
                                          className="min-h-[32px] px-2.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-[11px] flex items-center gap-1"
                                          title="Copiar URL MGEB"
                                        >
                                          {copiedKey === epKey ? (
                                            <Check className="w-3 h-3 text-emerald-400" />
                                          ) : (
                                            <Copy className="w-3 h-3" />
                                          )}
                                          Copiar
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => handleTestEpisodeMgeb(group.tmdbId, season.seasonNumber, ep)}
                                          disabled={isTestingThis}
                                          className="min-h-[32px] px-2.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-[11px] flex items-center gap-1"
                                          title="Testar compatibilidade MGEB"
                                        >
                                          {isTestingThis ? (
                                            <RefreshCw className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <ShieldCheck className="w-3 h-3 text-sky-400" />
                                          )}
                                          Testar
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            onOpenPlayer({
                                              title: `${group.title} · T${season.seasonNumber}E${ep.episodeNumber} — ${ep.title}`,
                                              src: ep.processedUrl || builtEp.finalUrl,
                                              version:
                                                ep.playbackVersion === 'legendado' ? 'legendado' : 'dublado'
                                            })
                                          }
                                          className="min-h-[32px] px-2.5 rounded bg-[#E50914]/15 hover:bg-[#E50914]/25 border border-[#E50914]/40 text-white text-[11px] flex items-center gap-1"
                                          title="Abrir no Player"
                                        >
                                          <Play className="w-3 h-3" />
                                          Player
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => {
                                            mutateJob(draft => {
                                              const g = draft.seriesGroups.find(i => i.tmdbId === group.tmdbId);
                                              const s = g?.seasons.find(i => i.seasonNumber === season.seasonNumber);
                                              if (s) {
                                                s.episodes = s.episodes.filter(
                                                  i => i.episodeNumber !== ep.episodeNumber
                                                );
                                              }
                                              return draft;
                                            });
                                          }}
                                          className="min-h-[32px] px-2 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400"
                                          title="Remover episódio"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Paginação quando "Paginar (25/pág)" estiver ativo */}
                          {!showAll && totalPages > 1 && (
                            <div className="p-3 border-t border-white/5 flex items-center justify-between text-xs text-zinc-400">
                              <span className="tabular-nums">
                                Página {currentPage} de {totalPages} ({season.episodes.length} episódios)
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={currentPage <= 1}
                                  onClick={() =>
                                    setEpisodePageBySeason(prev => ({
                                      ...prev,
                                      [seasonKey]: Math.max(1, currentPage - 1)
                                    }))
                                  }
                                  className="px-3 py-1 rounded bg-white/5 disabled:opacity-30 text-white"
                                >
                                  Anterior
                                </button>
                                <button
                                  type="button"
                                  disabled={currentPage >= totalPages}
                                  onClick={() =>
                                    setEpisodePageBySeason(prev => ({
                                      ...prev,
                                      [seasonKey]: Math.min(totalPages, currentPage + 1)
                                    }))
                                  }
                                  className="px-3 py-1 rounded bg-white/5 disabled:opacity-30 text-white"
                                >
                                  Seguinte
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
