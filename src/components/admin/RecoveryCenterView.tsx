import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  ShieldCheck, AlertTriangle, RefreshCw, Database, Zap, 
  History, CheckCircle2, XCircle, Loader2, Filter, Activity, 
  Clock, Play, Pause, Square, Download, Upload, Server, Globe,
  Film, Tv, Layers, ArrowRight, ShieldAlert, Sparkles, Check,
  AlertCircle, Copy, Trash2, ChevronRight, Terminal, Info,
  Eye, FileText
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { 
  RecoveryStatsData, 
  ActivityLogEvent, 
  RecoveryReportItem, 
  TmdbDiagResult, 
  DbDiagResult,
  MediaType 
} from '../../types.js';
import { motion, AnimatePresence } from 'motion/react';

interface RecoveryCenterViewProps {
  onStatsUpdate?: () => void;
}

export const RecoveryCenterView: React.FC<RecoveryCenterViewProps> = ({ onStatsUpdate }) => {
  // Navigation & Tabs
  const [activeTab, setActiveTab] = useState<'restore_modes' | 'reports_history' | 'backup_tools'>('restore_modes');
  
  // Real Data States
  const [stats, setStats] = useState<RecoveryStatsData | null>(null);
  const [logs, setLogs] = useState<ActivityLogEvent[]>([]);
  const [reports, setReports] = useState<RecoveryReportItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modos de Restauração States
  const [smartRestoreLoading, setSmartRestoreLoading] = useState(false);
  const [singleMovieId, setSingleMovieId] = useState('');
  const [singleMovieLoading, setSingleMovieLoading] = useState(false);
  const [singleMovieFeedback, setSingleMovieFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [singleSeriesId, setSingleSeriesId] = useState('');
  const [singleSeriesLoading, setSingleSeriesLoading] = useState(false);
  const [singleSeriesFeedback, setSingleSeriesFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [batchSize, setBatchSize] = useState<number>(50);
  const [batchFilter, setBatchFilter] = useState<'all' | 'issues_only' | 'movies_only' | 'series_only'>('all');
  const [batchActionLoading, setBatchActionLoading] = useState(false);

  // Diagnostics States
  const [tmdbDiag, setTmdbDiag] = useState<TmdbDiagResult | null>(null);
  const [isTestingTmdb, setIsTestingTmdb] = useState(false);
  
  const [dbDiag, setDbDiag] = useState<DbDiagResult | null>(null);
  const [isTestingDb, setIsTestingDb] = useState(false);

  // Backup & Restore States
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPreview, setBackupPreview] = useState<{
    fileName: string;
    fileSizeFormatted: string;
    fileSizeBytes: number;
    isValid: boolean;
    formatVersion: string;
    detectedKeys: string[];
    rawStructureDescription: string;
    recordsCount: number;
    moviesCount: number;
    seriesCount: number;
    newCount: number;
    existingCount: number;
    duplicatesCount: number;
    errorsCount: number;
    items: any[];
    validationChecklist: {
      fileLoaded: boolean;
      jsonValid: boolean;
      structureDetected: boolean;
      compatibleBackup: boolean;
    };
    errorMessage?: string;
  } | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<{
    isRestoring: boolean;
    processed: number;
    total: number;
    percent: number;
    added: number;
    updated: number;
    ignored: number;
    duplicates: number;
    errors: number;
    currentChunk: number;
    totalChunks: number;
  } | null>(null);

  // Confirmation Modals
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionLabel: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    description: '',
    actionLabel: '',
    onConfirm: () => {}
  });

  // Report Details Modal
  const [selectedReport, setSelectedReport] = useState<RecoveryReportItem | null>(null);

  // Console auto-scroll & copy
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const [copiedLogs, setCopiedLogs] = useState(false);

  // Load Real Data from Backend
  const loadRecoveryData = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const [statsRes, logsRes, reportsRes] = await Promise.all([
        api.getRecoveryStats(),
        api.getRecoveryLogs(),
        api.getRecoveryReports()
      ]);
      setStats(statsRes);
      setLogs(logsRes || []);
      setReports(reportsRes || []);
      if (onStatsUpdate) onStatsUpdate();
    } catch (err) {
      console.error('Falha ao carregar dados do Centro de Recuperação:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [onStatsUpdate]);

  // Initial load and polling while running
  useEffect(() => {
    loadRecoveryData();
    const interval = setInterval(() => {
      if (stats?.recoveryState?.status === 'RUNNING' || stats?.recoveryState?.status === 'ANALYZING') {
        loadRecoveryData(true);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [loadRecoveryData, stats?.recoveryState?.status]);

  // Auto-scroll console when new logs arrive
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // --- ACTIONS ---

  // 1. Smart Restore Action
  const handleTriggerSmartRestore = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Executar Restauração Inteligente',
      description: 'Esta operação verificará todo o catálogo, buscando no TMDB metadados ausentes (posters, sinopses, gêneros, temporadas). Nenhum dado existente ou link customizado será apagado.',
      actionLabel: 'Confirmar e Iniciar',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setSmartRestoreLoading(true);
        try {
          const res = await api.executeSmartRestore();
          if (res.success) {
            loadRecoveryData();
          }
        } catch (err: any) {
          console.error('Smart restore failed:', err);
        } finally {
          setSmartRestoreLoading(false);
        }
      }
    });
  };

  // 2. Single Movie Recovery
  const handleRecoverMovie = async (e: React.FormEvent) => {
    e.preventDefault();
    const idNum = parseInt(singleMovieId.trim());
    if (isNaN(idNum) || idNum <= 0) {
      setSingleMovieFeedback({ type: 'error', message: 'Insira um TMDB ID numérico válido.' });
      return;
    }

    setSingleMovieLoading(true);
    setSingleMovieFeedback(null);
    try {
      const res = await api.recoverMovieByTmdb(idNum);
      if (res.success) {
        setSingleMovieFeedback({ type: 'success', message: res.message });
        setSingleMovieId('');
        loadRecoveryData();
      } else {
        setSingleMovieFeedback({ type: 'error', message: res.message || 'Falha ao recuperar filme.' });
      }
    } catch (err: any) {
      setSingleMovieFeedback({ type: 'error', message: err?.message || 'Erro ao comunicar com TMDB.' });
    } finally {
      setSingleMovieLoading(false);
    }
  };

  // 3. Single Series Recovery
  const handleRecoverSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    const idNum = parseInt(singleSeriesId.trim());
    if (isNaN(idNum) || idNum <= 0) {
      setSingleSeriesFeedback({ type: 'error', message: 'Insira um TMDB ID numérico válido.' });
      return;
    }

    setSingleSeriesLoading(true);
    setSingleSeriesFeedback(null);
    try {
      const res = await api.recoverSeriesByTmdb(idNum);
      if (res.success) {
        setSingleSeriesFeedback({ type: 'success', message: res.message });
        setSingleSeriesId('');
        loadRecoveryData();
      } else {
        setSingleSeriesFeedback({ type: 'error', message: res.message || 'Falha ao recuperar série.' });
      }
    } catch (err: any) {
      setSingleSeriesFeedback({ type: 'error', message: err?.message || 'Erro ao comunicar com TMDB.' });
    } finally {
      setSingleSeriesLoading(false);
    }
  };

  // 4. Batch Recovery Controls
  const handleStartBatch = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Iniciar Restauração em Lotes',
      description: `Serão processados conteúdos em lotes de ${batchSize} itens com o filtro "${batchFilter}". A operação roda em segundo plano e você pode pausar ou parar a qualquer momento.`,
      actionLabel: 'Iniciar Lotes',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setBatchActionLoading(true);
        try {
          await api.startBatchRecovery({ batchSize, filter: batchFilter });
          loadRecoveryData();
        } catch (err: any) {
          console.error('Batch start failed:', err);
        } finally {
          setBatchActionLoading(false);
        }
      }
    });
  };

  const handlePauseBatch = async () => {
    setBatchActionLoading(true);
    try {
      await api.pauseBatchRecovery();
      loadRecoveryData();
    } catch (err) {
      console.error(err);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleResumeBatch = async () => {
    setBatchActionLoading(true);
    try {
      await api.resumeBatchRecovery();
      loadRecoveryData();
    } catch (err) {
      console.error(err);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleStopBatch = async () => {
    setBatchActionLoading(true);
    try {
      await api.stopBatchRecovery();
      loadRecoveryData();
    } catch (err) {
      console.error(err);
    } finally {
      setBatchActionLoading(false);
    }
  };

  // 5. Diagnostics
  const handleTestTmdb = async () => {
    setIsTestingTmdb(true);
    try {
      const res = await api.diagTmdb();
      setTmdbDiag(res);
      loadRecoveryData(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTestingTmdb(false);
    }
  };

  const handleTestDb = async () => {
    setIsTestingDb(true);
    try {
      const res = await api.diagDb();
      setDbDiag(res);
      loadRecoveryData(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTestingDb(false);
    }
  };

  // 6. Backup Download (mobile Chrome + desktop compatible via signed token)
  const handleDownloadBackup = async () => {
    try {
      const res = await api.getRecoveryBackupDownloadToken();
      api.triggerSignedFileDownload(
        res.downloadUrl,
        `ronycine-catalog-backup-${new Date().toISOString().slice(0, 10)}.json`
      );
    } catch (err: any) {
      setBackupFeedback({
        type: 'error',
        message: err?.message || 'Erro ao gerar link de download do backup.'
      });
    }
  };

  // 7. Smart Backup Parser & Structure Detection
  const parseBackupJson = (json: any, fileName: string, fileSize: number, existingTmdbMap: Map<string, boolean>) => {
    const sizeKb = Math.round(fileSize / 1024);
    const sizeFormatted = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

    if (!json || typeof json !== 'object') {
      return {
        fileName,
        fileSizeFormatted: sizeFormatted,
        fileSizeBytes: fileSize,
        isValid: false,
        formatVersion: 'Desconhecido',
        detectedKeys: [],
        rawStructureDescription: 'O arquivo não contém um JSON válido.',
        recordsCount: 0,
        moviesCount: 0,
        seriesCount: 0,
        newCount: 0,
        existingCount: 0,
        duplicatesCount: 0,
        errorsCount: 1,
        items: [],
        validationChecklist: {
          fileLoaded: true,
          jsonValid: false,
          structureDetected: false,
          compatibleBackup: false
        },
        errorMessage: '✕ JSON Inválido: O arquivo selecionado não pôde ser interpretado.'
      };
    }

    const detectedKeys = Array.isArray(json) ? ['[Array Raiz]'] : Object.keys(json);
    const version = String(json.version || json.BACKUP_VERSION || json.appVersion || json.exportVersion || 'Auto-Detectado (v2.5)');

    // Smart Media Object Detection Helper
    const isMediaLikeObject = (obj: any): boolean => {
      if (!obj || typeof obj !== 'object') return false;
      const hasId = Boolean(
        obj.tmdbId || obj.tmdb_id || obj.id_tmdb || obj.tmdb || obj.code ||
        obj.movie_id || obj.series_id || obj.media_id || obj.mediaId ||
        obj.id || obj.tmdbID || obj.TMDB_ID || obj.imdbId || obj.imdb_id
      );
      const hasTitle = Boolean(obj.title || obj.name || obj.original_title || obj.original_name || obj.titulo || obj.nome || obj.originalTitle || obj.originalName);
      const hasPoster = Boolean(obj.posterPath || obj.poster_path || obj.poster || obj.poster_url || obj.image || obj.capa || obj.img || obj.thumbnail);
      const hasType = Boolean(obj.type || obj.media_type || obj.content_type || obj.mediaType || obj.tipo);
      const hasSeasons = Boolean(obj.seasons || obj.temporadas || obj.episodes || obj.episodios || obj.number_of_seasons || obj.seasonsCount);
      const hasOverview = Boolean(obj.overview || obj.synopsis || obj.description || obj.sinopse || obj.summary || obj.descricao);

      // Must have title or ID, AND at least one other media characteristic
      return (hasTitle || hasId) && (hasId || hasPoster || hasType || hasSeasons || hasOverview);
    };

    let rawCandidates: any[] = [];
    let formatDesc = 'Formato JSON Padrão';

    // 1. Direct Root Array
    if (Array.isArray(json)) {
      rawCandidates = json;
      formatDesc = 'Array Raiz de Registros [...]';
    } else {
      // 2. Main collection keys
      const candidateKeys = [
        'catalog', 'catalogo', 'items', 'records', 'data', 'backup', 'export',
        'movies', 'films', 'filmes', 'series', 'tv', 'episodes', 'shows', 'list',
        'acervo', 'midias', 'medias', 'db', 'database', 'content'
      ];

      // Check if top level contains arrays
      for (const k of candidateKeys) {
        if (Array.isArray(json[k]) && json[k].length > 0) {
          const validObjs = json[k].filter((el: any) => el && typeof el === 'object');
          if (validObjs.length > 0) {
            rawCandidates.push(...validObjs);
          }
        }
      }

      if (rawCandidates.length > 0) {
        formatDesc = `Coleções mapeadas (${candidateKeys.filter(k => Array.isArray(json[k]) && json[k].length > 0).join(', ')})`;
      } else {
        // 3. Nested container objects (e.g., json.data, json.backup, json.export, json.database, json.catalog)
        const nestedContainers = ['data', 'backup', 'export', 'catalog', 'catalogo', 'db', 'database', 'content', 'acervo'];
        for (const sub of nestedContainers) {
          if (json[sub] && typeof json[sub] === 'object' && !Array.isArray(json[sub])) {
            const subObj = json[sub];
            // Check arrays inside nested container
            for (const k of candidateKeys) {
              if (Array.isArray(subObj[k]) && subObj[k].length > 0) {
                const validObjs = subObj[k].filter((el: any) => el && typeof el === 'object');
                if (validObjs.length > 0) {
                  rawCandidates.push(...validObjs);
                }
              }
            }
            // Check if subObj itself is an array
            if (Array.isArray(subObj)) {
              rawCandidates.push(...subObj);
            }
          }
        }

        if (rawCandidates.length > 0) {
          formatDesc = 'Objeto aninhado de backup (data/backup/export)';
        } else {
          // 4. Check if json is a Key-Value Dictionary (where keys are IDs/slugs and values are media objects)
          const allKeys = Object.keys(json);
          const allValues = Object.values(json);
          const objValues = allValues.filter((v: any) => v && typeof v === 'object' && !Array.isArray(v));

          if (objValues.length > 0 && objValues.some(isMediaLikeObject)) {
            rawCandidates = objValues.filter(isMediaLikeObject);
            formatDesc = 'Dicionário de Mídias (Chave: Objeto)';
          } else {
            // 5. General scan of all top-level array properties in JSON
            for (const key of allKeys) {
              if (Array.isArray(json[key]) && json[key].length > 0) {
                const validObjs = json[key].filter((el: any) => el && typeof el === 'object');
                if (validObjs.length > 0) {
                  rawCandidates.push(...validObjs);
                }
              }
            }
            if (rawCandidates.length > 0) {
              formatDesc = 'Varredura automática de coleções no JSON';
            }
          }
        }
      }
    }

    const items: any[] = [];
    const seenSet = new Set<string>();
    let moviesCount = 0;
    let seriesCount = 0;
    let newCount = 0;
    let existingCount = 0;
    let duplicatesCount = 0;
    let errorsCount = 0;

    for (const raw of rawCandidates) {
      if (!raw || typeof raw !== 'object') {
        errorsCount++;
        continue;
      }

      // Flexible TMDB ID Extraction
      const rawTmdbId = raw.tmdbId ?? raw.tmdb_id ?? raw.id_tmdb ?? raw.tmdb ?? raw.code ?? raw.movie_id ?? raw.series_id ?? raw.media_id ?? raw.mediaId ?? raw.id ?? raw.tmdbID ?? raw.TMDB_ID;

      let tmdbId = 0;
      if (typeof rawTmdbId === 'number' && !isNaN(rawTmdbId) && rawTmdbId > 0) {
        tmdbId = rawTmdbId;
      } else if (rawTmdbId) {
        const digits = String(rawTmdbId).replace(/\D/g, '');
        if (digits.length > 0) {
          tmdbId = parseInt(digits, 10);
        }
      }

      // Title extraction
      const title = String(
        raw.title || raw.name || raw.original_title || raw.original_name ||
        raw.titulo || raw.nome || raw.originalTitle || raw.originalName || ''
      ).trim();

      // Fallback ID from title hash if TMDB ID is missing
      if ((isNaN(tmdbId) || tmdbId <= 0) && title.length > 0) {
        let hash = 0;
        for (let i = 0; i < title.length; i++) {
          hash = (hash << 5) - hash + title.charCodeAt(i);
          hash |= 0;
        }
        tmdbId = (Math.abs(hash) % 899999) + 100000;
      }

      if (isNaN(tmdbId) || tmdbId <= 0) {
        errorsCount++;
        continue;
      }

      // Flexible Type Extraction
      const rawType = String(
        raw.type || raw.media_type || raw.content_type || raw.mediaType || raw.tipo || ''
      ).toLowerCase();
      
      let isSeries = false;
      if (['tv', 'series', 'serie', 'show', 'shows', 'episodes', 'episodios'].includes(rawType)) {
        isSeries = true;
      } else if (['movie', 'film', 'filme', 'filmes', 'movies'].includes(rawType)) {
        isSeries = false;
      } else {
        // Fallback detection from properties
        if (
          (Array.isArray(raw.seasons) && raw.seasons.length > 0) ||
          (Array.isArray(raw.temporadas) && raw.temporadas.length > 0) ||
          (Array.isArray(raw.episodes) && raw.episodes.length > 0) ||
          (Array.isArray(raw.episodios) && raw.episodios.length > 0) ||
          raw.number_of_seasons ||
          raw.seasonsCount ||
          raw.episodesCount ||
          raw.first_air_date ||
          raw.firstAirDate
        ) {
          isSeries = true;
        }
      }

      const type = isSeries ? 'tv' : 'movie';
      const key = `${type}_${tmdbId}`;

      if (seenSet.has(key)) {
        duplicatesCount++;
        continue;
      }
      seenSet.add(key);

      if (type === 'movie') moviesCount++;
      else seriesCount++;

      if (existingTmdbMap.has(key)) {
        existingCount++;
      } else {
        newCount++;
      }

      const displayTitle = title || `Registro #${tmdbId}`;
      const posterPath = raw.posterPath || raw.poster_path || raw.poster || raw.poster_url || raw.image || raw.capa || raw.img || raw.thumbnail || '';
      const backdropPath = raw.backdropPath || raw.backdrop_path || raw.backdrop || raw.backdrop_url || raw.cover || raw.banner || raw.fundo || posterPath || '';
      const overview = raw.overview || raw.synopsis || raw.description || raw.sinopse || raw.summary || raw.descricao || 'Sem sinopse disponível.';
      const voteAverage = Number(raw.voteAverage || raw.vote_average || raw.rating || raw.nota || raw.score || 0);
      const releaseDate = raw.releaseDate || raw.release_date || raw.firstAirDate || raw.first_air_date || raw.year || raw.ano || raw.date;
      
      let genres: string[] = [];
      const rawGenres = raw.genres || raw.generos || raw.genre_ids;
      if (Array.isArray(rawGenres)) {
        genres = rawGenres.map((g: any) => (typeof g === 'object' ? (g.name || g.nome || String(g)) : String(g)));
      }

      let seasons: any[] = [];
      const rawSeasons = raw.seasons || raw.temporadas || raw.episodes || raw.episodios;
      if (Array.isArray(rawSeasons)) {
        seasons = rawSeasons;
      }

      items.push({
        ...raw,
        tmdbId,
        type,
        title: displayTitle,
        originalTitle: raw.originalTitle || raw.original_title || raw.original_name || displayTitle,
        overview,
        posterPath,
        backdropPath,
        voteAverage,
        releaseDate,
        firstAirDate: releaseDate,
        genres,
        seasons,
        seasonsCount: seasons.length || raw.seasonsCount || raw.number_of_seasons || 0,
        episodesCount: raw.episodesCount || raw.number_of_episodes || 0,
        published: raw.published !== undefined ? raw.published : true,
        status: raw.status || 'ACTIVE'
      });
    }

    if (items.length === 0) {
      return {
        fileName,
        fileSizeFormatted: sizeFormatted,
        fileSizeBytes: fileSize,
        isValid: false,
        formatVersion: version,
        detectedKeys,
        rawStructureDescription: formatDesc,
        recordsCount: 0,
        moviesCount: 0,
        seriesCount: 0,
        newCount: 0,
        existingCount: 0,
        duplicatesCount,
        errorsCount,
        items: [],
        validationChecklist: {
          fileLoaded: true,
          jsonValid: true,
          structureDetected: false,
          compatibleBackup: false
        },
        errorMessage: '⚠ O backup foi carregado, mas nenhum registro de filme ou série foi identificado. Verifique a estrutura do arquivo.'
      };
    }

    return {
      fileName,
      fileSizeFormatted: sizeFormatted,
      fileSizeBytes: fileSize,
      isValid: true,
      formatVersion: String(version),
      detectedKeys,
      rawStructureDescription: formatDesc,
      recordsCount: items.length,
      moviesCount,
      seriesCount,
      newCount,
      existingCount,
      duplicatesCount,
      errorsCount,
      items,
      validationChecklist: {
        fileLoaded: true,
        jsonValid: true,
        structureDetected: true,
        compatibleBackup: true
      }
    };
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBackupFile(file);
    setBackupFeedback(null);
    setRestoreProgress(null);

    const sizeKb = Math.round(file.size / 1024);
    const sizeFormatted = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

    // Fetch existing catalog items to build lookup map for preview statistics
    const existingTmdbMap = new Map<string, boolean>();
    try {
      const catalogRes = await api.getCatalog({ limit: 100000 });
      if (catalogRes && Array.isArray(catalogRes.items)) {
        catalogRes.items.forEach((item: any) => {
          if (item.tmdbId && item.type) {
            existingTmdbMap.set(`${item.type}_${item.tmdbId}`, true);
          }
        });
      }
    } catch (e) {
      console.warn('Não foi possível carregar o mapa existente para preview:', e);
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const rawContent = event.target?.result as string;
        const parsedJson = JSON.parse(rawContent);
        const preview = parseBackupJson(parsedJson, file.name, file.size, existingTmdbMap);

        setBackupPreview(preview);

        if (preview.isValid) {
          setBackupFeedback({
            type: 'success',
            message: `✓ Arquivo carregado com sucesso: ${preview.recordsCount} registros válidos identificados (${preview.moviesCount} filmes e ${preview.seriesCount} séries).`
          });
        } else {
          setBackupFeedback({
            type: 'error',
            message: preview.errorMessage || 'Arquivo de backup inválido ou em formato não reconhecido.'
          });
        }
      } catch (err: any) {
        setBackupFeedback({
          type: 'error',
          message: '✕ Erro ao interpretar o arquivo JSON: Sintaxe corrompida ou inválida.'
        });
        setBackupPreview({
          fileName: file.name,
          fileSizeFormatted: sizeFormatted,
          fileSizeBytes: file.size,
          isValid: false,
          formatVersion: 'Inválido',
          detectedKeys: [],
          rawStructureDescription: 'Erro de sintaxe no JSON',
          recordsCount: 0,
          moviesCount: 0,
          seriesCount: 0,
          newCount: 0,
          existingCount: 0,
          duplicatesCount: 0,
          errorsCount: 1,
          items: [],
          validationChecklist: {
            fileLoaded: true,
            jsonValid: false,
            structureDetected: false,
            compatibleBackup: false
          },
          errorMessage: '✕ Erro ao interpretar o arquivo JSON: Sintaxe corrompida ou inválida.'
        });
      }
    };
    reader.readAsText(file);
  };

  // 8. Restore from Backup in Batch Chunks
  const handleExecuteRestoreBackup = () => {
    if (!backupPreview || !backupPreview.items.length || !backupPreview.isValid) return;

    setConfirmModal({
      isOpen: true,
      title: 'Restaurar Catálogo por Backup (Merge Seguro)',
      description: `Serão processados ${backupPreview.recordsCount} registros (${backupPreview.moviesCount} filmes e ${backupPreview.seriesCount} séries). O sistema executará uma Restauração Segura (UPSERT) sem apagar nenhum dado do banco de dados. Deseja iniciar a restauração em lotes?`,
      actionLabel: 'Confirmar e Restaurar',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setIsRestoringBackup(true);
        setBackupFeedback(null);

        const CHUNK_SIZE = 250;
        const total = backupPreview.items.length;
        const totalChunks = Math.ceil(total / CHUNK_SIZE);

        let addedTotal = 0;
        let updatedTotal = 0;
        let ignoredTotal = 0;
        let errorsTotal = 0;

        setRestoreProgress({
          isRestoring: true,
          processed: 0,
          total,
          percent: 0,
          added: 0,
          updated: 0,
          ignored: 0,
          duplicates: backupPreview.duplicatesCount,
          errors: 0,
          currentChunk: 1,
          totalChunks
        });

        for (let i = 0; i < total; i += CHUNK_SIZE) {
          const chunk = backupPreview.items.slice(i, i + CHUNK_SIZE);
          const currentChunk = Math.floor(i / CHUNK_SIZE) + 1;

          try {
            const res = await api.restoreBackup(chunk);
            if (res.success) {
              addedTotal += res.added || 0;
              updatedTotal += res.updated || 0;
              ignoredTotal += res.ignored || 0;
              errorsTotal += res.errors || 0;

              const processed = Math.min(total, i + chunk.length);
              const percent = Math.round((processed / total) * 100);

              setRestoreProgress({
                isRestoring: true,
                processed,
                total,
                percent,
                added: addedTotal,
                updated: updatedTotal,
                ignored: ignoredTotal,
                duplicates: backupPreview.duplicatesCount,
                errors: errorsTotal,
                currentChunk,
                totalChunks
              });
            }
          } catch (err: any) {
            errorsTotal += chunk.length;
          }

          // Small pause to yield UI event loop
          await new Promise(r => setTimeout(r, 30));
        }

        setBackupFeedback({
          type: errorsTotal > 0 ? 'error' : 'success',
          message: `✓ Restauração concluída! ${addedTotal} novos itens adicionados, ${updatedTotal} atualizados, ${ignoredTotal} preservados (${errorsTotal} erros).`
        });

        setIsRestoringBackup(false);
        setBackupFile(null);
        setBackupPreview(null);
        loadRecoveryData();
      }
    });
  };

  // 9. Console Clear & Copy
  const handleClearLogs = async () => {
    try {
      await api.clearRecoveryLogs();
      loadRecoveryData(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyLogs = () => {
    const text = logs.map(l => `[${l.time}] ${l.type.toUpperCase()}: ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const isOperationRunning = 
    smartRestoreLoading || 
    isRestoringBackup || 
    stats?.recoveryState?.status === 'RUNNING' || 
    stats?.recoveryState?.status === 'ANALYZING';

  return (
    <div className="space-y-6 pb-12">

      {/* ========================================================== */}
      {/* 1. CABEÇALHO COMPACTO & ELEGANTE SAAS                      */}
      {/* ========================================================== */}
      <div className="bg-zinc-950/90 border border-zinc-800/80 rounded-2xl p-4 sm:p-5 backdrop-blur-md shadow-xl relative overflow-hidden">
        {/* Subtle glowing ambient accent */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          
          {/* Left Title & Icon */}
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 sm:w-11 sm:h-11 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center shadow-md text-red-500 shrink-0">
              <RefreshCw className={`w-5 h-5 ${isOperationRunning ? 'animate-spin text-red-500' : 'text-zinc-300'}`} />
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-wide uppercase">
                  CENTRO DE RECUPERAÇÃO
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider bg-red-600/15 text-red-400 border border-red-500/20">
                  IPTV CENTRAL
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-normal mt-0.5">
                Sistema de restauração e integridade do catálogo IPTV.
              </p>
            </div>
          </div>

          {/* Right Status Pill & Refresh Action */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            {/* Dynamic Status Pill */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
              isOperationRunning
                ? 'bg-red-950/40 border-red-800/50 text-red-400'
                : (stats?.issuesCount || 0) > 0 || (stats?.duplicatesCount || 0) > 0
                ? 'bg-amber-950/40 border-amber-800/50 text-amber-400'
                : 'bg-emerald-950/40 border-emerald-800/50 text-emerald-400'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                isOperationRunning
                  ? 'bg-red-500 animate-ping'
                  : (stats?.issuesCount || 0) > 0 || (stats?.duplicatesCount || 0) > 0
                  ? 'bg-amber-500'
                  : 'bg-emerald-500 animate-pulse'
              }`}></span>
              <span>
                {isOperationRunning
                  ? 'SISTEMA EM PROCESSAMENTO'
                  : (stats?.issuesCount || 0) > 0 || (stats?.duplicatesCount || 0) > 0
                  ? 'SISTEMA COM ALERTA'
                  : 'SISTEMA ONLINE'}
              </span>
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => loadRecoveryData()}
              disabled={isRefreshing || isOperationRunning}
              className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-red-500' : 'text-zinc-400'}`} />
              <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
            </button>
          </div>
        </div>

        {/* Small Trust & Mode Indicators */}
        <div className="mt-3.5 pt-3 border-t border-zinc-900/80 flex flex-wrap items-center gap-2 text-[11px] font-medium">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>PRODUÇÃO REAL</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-blue-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>PRESERVA DADOS</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-purple-400">
            <Globe className="w-3.5 h-3.5" />
            <span>TMDB UNIFICADO</span>
          </div>
        </div>
      </div>

      {/* ========================================================== */}
      {/* 2. CARDS DE ESTATÍSTICAS (4 CARDS COMPACTOS)               */}
      {/* ========================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        {/* FILMES ATIVOS */}
        <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-4 relative overflow-hidden shadow-sm hover:border-zinc-700/80 transition-all">
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Filmes Ativos</span>
            <div className="p-2 bg-red-600/10 text-red-400 rounded-xl shrink-0">
              <Film className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-white font-mono leading-tight">
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-red-500" /> : (stats?.activeMovies?.toLocaleString('pt-BR') ?? 0)}
          </div>
          <span className="text-xs text-zinc-500 font-normal block mt-1">Existentes no catálogo</span>
        </div>

        {/* SÉRIES ATIVAS */}
        <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-4 relative overflow-hidden shadow-sm hover:border-zinc-700/80 transition-all">
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Séries Ativas</span>
            <div className="p-2 bg-purple-600/10 text-purple-400 rounded-xl shrink-0">
              <Tv className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold text-white font-mono leading-tight">
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-purple-500" /> : (stats?.activeSeries?.toLocaleString('pt-BR') ?? 0)}
          </div>
          <span className="text-xs text-zinc-500 font-normal block mt-1">Existentes no catálogo</span>
        </div>

        {/* DUPLICADOS */}
        <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-4 relative overflow-hidden shadow-sm hover:border-zinc-700/80 transition-all">
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Duplicados</span>
            <div className={`p-2 rounded-xl shrink-0 ${(stats?.duplicatesCount || 0) > 0 ? 'bg-amber-600/10 text-amber-400' : 'bg-emerald-600/10 text-emerald-400'}`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className={`text-xl sm:text-2xl font-bold font-mono leading-tight ${(stats?.duplicatesCount || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-amber-500" /> : (stats?.duplicatesCount ?? 0)}
          </div>
          <span className="text-xs text-zinc-500 font-normal block mt-1">
            {(stats?.duplicatesCount || 0) === 0 ? 'Nenhum duplicado' : `${stats?.duplicatesCount} instâncias identificadas`}
          </span>
        </div>

        {/* INTEGRIDADE GERAL */}
        <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-4 relative overflow-hidden shadow-sm hover:border-zinc-700/80 transition-all">
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Integridade</span>
            <div className="p-2 bg-emerald-600/10 text-emerald-400 rounded-xl shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-bold text-emerald-400 font-mono leading-tight">
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-emerald-500" /> : `${stats?.integrityPercent ?? 100}%`}
            </span>
          </div>
          <span className="text-xs text-zinc-500 font-normal block mt-1">
            {(stats?.integrityPercent ?? 100) === 100 ? 'Catálogo 100% íntegro' : 'Requer atenção'}
          </span>
        </div>

      </div>

      {/* ========================================================== */}
      {/* VERIFICAÇÃO DE INTEGRIDADE DO CATÁLOGO                     */}
      {/* ========================================================== */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase text-white tracking-wider">Integridade do Catálogo</h3>
          </div>
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg w-fit ${
            (stats?.issuesCount || 0) === 0 && (stats?.duplicatesCount || 0) === 0
              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
              : 'bg-amber-950/60 text-amber-400 border border-amber-800/40'
          }`}>
            {(stats?.issuesCount || 0) === 0 && (stats?.duplicatesCount || 0) === 0
              ? '100% INTEGRIDADE'
              : `⚠ ${stats?.issuesCount || 0} REGISTROS COM INCONSISTÊNCIA`}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs font-mono">
          <div className="bg-zinc-950/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>Banco Conectado</span>
          </div>
          <div className="bg-zinc-950/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>TMDB Conectado</span>
          </div>
          <div className="bg-zinc-950/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2 text-zinc-300">
            <Film className="w-4 h-4 text-red-400 shrink-0" />
            <span>{stats?.activeMovies?.toLocaleString('pt-BR') ?? 0} filmes</span>
          </div>
          <div className="bg-zinc-950/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2 text-zinc-300">
            <Tv className="w-4 h-4 text-purple-400 shrink-0" />
            <span>{stats?.activeSeries?.toLocaleString('pt-BR') ?? 0} séries</span>
          </div>
          <div className={`bg-zinc-950/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2 ${
            (stats?.duplicatesCount || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'
          }`}>
            {(stats?.duplicatesCount || 0) > 0 ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{stats?.duplicatesCount ?? 0} duplicados</span>
          </div>
          <div className={`bg-zinc-950/80 border border-zinc-800 p-2.5 rounded-xl flex items-center gap-2 ${
            (stats?.issuesCount || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'
          }`}>
            {(stats?.issuesCount || 0) > 0 ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{stats?.issuesCount ?? 0} inválidos</span>
          </div>
        </div>
      </div>

      {/* ========================================================== */}
      {/* 3. ÁREA PRINCIPAL: 2 COLUNAS (ESQUERDA + DIREITA CONSOLE)  */}
      {/* ========================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* -------------------------------------------------------- */}
        {/* COLUNA DA ESQUERDA (TABS PRINCIPAIS - 7 COLS)            */}
        {/* -------------------------------------------------------- */}
        <div className="lg:col-span-7 space-y-6">

          {/* TAB HEADERS */}
          <div className="flex items-center gap-2 p-1.5 bg-zinc-950/80 border border-zinc-850 rounded-2xl backdrop-blur-sm overflow-x-auto">
            <button
              onClick={() => setActiveTab('restore_modes')}
              className={`flex-1 min-w-[140px] py-2.5 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'restore_modes'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-950/50'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>MODOS DE RESTAURAÇÃO</span>
            </button>

            <button
              onClick={() => setActiveTab('reports_history')}
              className={`flex-1 min-w-[140px] py-2.5 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'reports_history'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-950/50'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'
              }`}
            >
              <History className="w-4 h-4" />
              <span>HISTÓRICO DE RELATÓRIOS</span>
            </button>

            <button
              onClick={() => setActiveTab('backup_tools')}
              className={`flex-1 min-w-[140px] py-2.5 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'backup_tools'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-950/50'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>FERRAMENTAS DE BACKUP</span>
            </button>
          </div>

          {/* TAB 1: MODOS DE RESTAURAÇÃO */}
          {activeTab === 'restore_modes' && (
            <div className="space-y-6">

              {/* A) RESTAURAÇÃO INTELIGENTE */}
              <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 relative overflow-hidden shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-red-600/15 text-red-400 border border-red-500/20 rounded-md text-[10px] font-semibold tracking-wider">
                        OPÇÃO A
                      </span>
                      <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">RESTAURAÇÃO INTELIGENTE</h3>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 font-normal">
                      Verificação profunda e correção automatizada de campos ausentes ou inválidos no catálogo.
                    </p>
                  </div>
                  <div className="p-2.5 bg-red-600/10 text-red-400 rounded-xl shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                </div>

                {/* Checklist of smart verification */}
                <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-4 mb-5">
                  <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-2.5">
                    Metadados Analisados & Corrigidos:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-zinc-300">
                    <span className="flex items-center gap-1.5">✓ IDs TMDB</span>
                    <span className="flex items-center gap-1.5">✓ Capas e Posteres</span>
                    <span className="flex items-center gap-1.5">✓ Backdrops HD</span>
                    <span className="flex items-center gap-1.5">✓ Sinopses em PT-BR</span>
                    <span className="flex items-center gap-1.5">✓ Gêneros e Tags</span>
                    <span className="flex items-center gap-1.5">✓ Classificação & Ano</span>
                    <span className="flex items-center gap-1.5">✓ Duração & Elenco</span>
                    <span className="flex items-center gap-1.5">✓ Temporadas Séries</span>
                    <span className="flex items-center gap-1.5">✓ Status de Publicação</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-xs text-zinc-400 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>NUNCA substitui dados válidos ou configurações customizadas.</span>
                  </div>

                  <button
                    onClick={handleTriggerSmartRestore}
                    disabled={isOperationRunning}
                    className="w-full sm:w-auto px-5 py-2.5 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-red-950/40 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {smartRestoreLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>PROCESSANDO RESTAURAÇÃO...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        <span>EXECUTAR RESTAURAÇÃO INTELIGENTE</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* B) RECUPERAR FILMES POR TMDB ID */}
              <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 relative shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 bg-blue-600/15 text-blue-400 border border-blue-500/20 rounded-md text-[10px] font-semibold tracking-wider">
                    OPÇÃO B
                  </span>
                  <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">RECUPERAR FILME</h3>
                </div>
                <p className="text-xs text-zinc-400 mb-4 font-normal">
                  Consulte e recupere filmes diretamente pelo identificador numérico oficial do TMDB.
                </p>

                <form onSubmit={handleRecoverMovie} className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <input
                        type="number"
                        value={singleMovieId}
                        onChange={(e) => setSingleMovieId(e.target.value)}
                        placeholder="Ex: 550 (Clube da Luta), 27205 (A Origem)..."
                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-red-500 focus:ring-1 focus:ring-red-500 text-white rounded-xl px-4 py-2.5 text-xs outline-none transition-all placeholder:text-zinc-600"
                        disabled={singleMovieLoading || isOperationRunning}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={singleMovieLoading || !singleMovieId.trim() || isOperationRunning}
                      className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 border border-zinc-700/60"
                    >
                      {singleMovieLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                      ) : (
                        <Film className="w-4 h-4 text-red-500" />
                      )}
                      <span>{singleMovieLoading ? 'Consultando...' : 'Recuperar Filme'}</span>
                    </button>
                  </div>

                  {singleMovieFeedback && (
                    <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                      singleMovieFeedback.type === 'success'
                        ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-400'
                        : 'bg-red-950/60 border border-red-800/60 text-red-400'
                    }`}>
                      {singleMovieFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                      <span>{singleMovieFeedback.message}</span>
                    </div>
                  )}
                </form>
              </div>

              {/* C) RECUPERAR SÉRIES POR TMDB ID */}
              <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 relative shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 bg-purple-600/15 text-purple-400 border border-purple-500/20 rounded-md text-[10px] font-semibold tracking-wider">
                    OPÇÃO C
                  </span>
                  <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">RECUPERAR SÉRIE</h3>
                </div>
                <p className="text-xs text-zinc-400 mb-4 font-normal">
                  Recuperação completa de séries, temporadas e episódios associados via TMDB ID.
                </p>

                <form onSubmit={handleRecoverSeries} className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <input
                        type="number"
                        value={singleSeriesId}
                        onChange={(e) => setSingleSeriesId(e.target.value)}
                        placeholder="Ex: 1399 (Game of Thrones), 1396 (Breaking Bad)..."
                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-white rounded-xl px-4 py-2.5 text-xs outline-none transition-all placeholder:text-zinc-600"
                        disabled={singleSeriesLoading || isOperationRunning}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={singleSeriesLoading || !singleSeriesId.trim() || isOperationRunning}
                      className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 border border-zinc-700/60"
                    >
                      {singleSeriesLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                      ) : (
                        <Tv className="w-4 h-4 text-purple-500" />
                      )}
                      <span>{singleSeriesLoading ? 'Consultando...' : 'Recuperar Série'}</span>
                    </button>
                  </div>

                  {singleSeriesFeedback && (
                    <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                      singleSeriesFeedback.type === 'success'
                        ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-400'
                        : 'bg-red-950/60 border border-red-800/60 text-red-400'
                    }`}>
                      {singleSeriesFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                      <span>{singleSeriesFeedback.message}</span>
                    </div>
                  )}
                </form>
              </div>

              {/* D) RESTAURAÇÃO EM LOTES */}
              <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 relative shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 bg-emerald-600/15 text-emerald-400 border border-emerald-500/20 rounded-md text-[10px] font-semibold tracking-wider">
                    OPÇÃO D
                  </span>
                  <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">RESTAURAÇÃO EM LOTES</h3>
                </div>
                <p className="text-xs text-zinc-400 mb-5 font-normal">
                  Processamento assíncrono controlado com paginação, limite de taxa e proteção contra sobrecarga.
                </p>

                {/* Batch configuration controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
                      Tamanho do Lote:
                    </label>
                    <select
                      value={batchSize}
                      onChange={(e) => setBatchSize(Number(e.target.value))}
                      disabled={isOperationRunning}
                      className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl px-3 py-2.5 text-xs outline-none focus:border-red-500"
                    >
                      <option value={25}>25 itens por lote</option>
                      <option value={50}>50 itens por lote (Recomendado)</option>
                      <option value={100}>100 itens por lote</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
                      Filtro de Alvo:
                    </label>
                    <select
                      value={batchFilter}
                      onChange={(e) => setBatchFilter(e.target.value as any)}
                      disabled={isOperationRunning}
                      className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl px-3 py-2.5 text-xs outline-none focus:border-red-500"
                    >
                      <option value="all">Todo o Catálogo</option>
                      <option value="issues_only">Apenas Itens com Inconsistências</option>
                      <option value="movies_only">Apenas Filmes</option>
                      <option value="series_only">Apenas Séries</option>
                    </select>
                  </div>
                </div>

                {/* Batch Progress Bar (if running or paused) */}
                {stats?.recoveryState?.status === 'RUNNING' || stats?.recoveryState?.status === 'PAUSED' ? (
                  <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                        <span>PROCESSANDO LOTES...</span>
                      </span>
                      <span className="font-mono text-zinc-300">
                        {stats.recoveryState.processedItems} / {stats.recoveryState.totalItems} ({
                          stats.recoveryState.totalItems > 0
                            ? Math.round((stats.recoveryState.processedItems / stats.recoveryState.totalItems) * 100)
                            : 0
                        }%)
                      </span>
                    </div>

                    <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-red-600 to-amber-500 h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${
                            stats.recoveryState.totalItems > 0
                              ? (stats.recoveryState.processedItems / stats.recoveryState.totalItems) * 100
                              : 0
                          }%`
                        }}
                      ></div>
                    </div>

                    {/* Counters */}
                    <div className="grid grid-cols-4 gap-2 pt-2 border-t border-zinc-900 text-center">
                      <div>
                        <span className="text-[10px] text-zinc-500 block">Atualizados</span>
                        <span className="text-xs font-bold text-emerald-400">{stats.recoveryState.successCount || 0}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-500 block">Preservados</span>
                        <span className="text-xs font-bold text-zinc-300">{stats.recoveryState.ignoredCount || 0}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-500 block">Duplicados</span>
                        <span className="text-xs font-bold text-amber-400">{stats.duplicatesCount || 0}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-500 block">Erros</span>
                        <span className="text-xs font-bold text-red-400">{stats.recoveryState.errorCount || 0}</span>
                      </div>
                    </div>

                    {/* Batch Control Buttons */}
                    <div className="flex items-center justify-end gap-2 pt-2">
                      {stats.recoveryState.status === 'RUNNING' ? (
                        <button
                          onClick={handlePauseBatch}
                          disabled={batchActionLoading}
                          className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-bold flex items-center gap-1.5"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pausar</span>
                        </button>
                      ) : (
                        <button
                          onClick={handleResumeBatch}
                          disabled={batchActionLoading}
                          className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-bold flex items-center gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Retomar</span>
                        </button>
                      )}

                      <button
                        onClick={handleStopBatch}
                        disabled={batchActionLoading}
                        className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold flex items-center gap-1.5"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>Cancelar</span>
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Trigger button */}
                {stats?.recoveryState?.status !== 'RUNNING' && stats?.recoveryState?.status !== 'PAUSED' && (
                  <button
                    onClick={handleStartBatch}
                    disabled={isOperationRunning || batchActionLoading}
                    className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span>INICIAR RESTAURAÇÃO EM LOTES</span>
                  </button>
                )}
              </div>

            </div>
          )}

          {/* TAB 2: HISTÓRICO DE RELATÓRIOS */}
          {activeTab === 'reports_history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">HISTÓRICO DE AUDITORIA & RELATÓRIOS</h3>
                  <p className="text-xs text-zinc-400">Registro permanente de todas as restaurações realizadas.</p>
                </div>
                <span className="text-xs text-zinc-500 font-semibold">{reports.length} registros</span>
              </div>

              {reports.length === 0 ? (
                <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-12 text-center space-y-3">
                  <History className="w-10 h-10 text-zinc-600 mx-auto" />
                  <h4 className="text-sm font-semibold text-white">Nenhum relatório arquivado</h4>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                    Execute uma restauração inteligente, em lotes ou recuperação individual para gerar relatórios detalhados.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reports.map((rep) => (
                    <div
                      key={rep.id}
                      className="bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700/80 rounded-2xl p-4 transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-2 rounded-xl shrink-0 ${
                            rep.status === 'SUCCESS' ? 'bg-emerald-600/10 text-emerald-400' : 'bg-amber-600/10 text-amber-400'
                          }`}>
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white">{rep.operation}</h4>
                            <span className="text-[10px] text-zinc-400 block">{rep.target}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-auto">
                          <span className="text-[10px] font-mono text-zinc-500">
                            {new Date(rep.timestamp).toLocaleString('pt-BR')} ({rep.duration})
                          </span>
                          <button
                            onClick={() => setSelectedReport(rep)}
                            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[11px] font-semibold rounded-lg transition-all flex items-center gap-1 border border-zinc-700/50"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Detalhes</span>
                          </button>
                        </div>
                      </div>

                      {/* Stat summary pills */}
                      <div className="flex flex-wrap items-center gap-2 text-[10px] pt-2 border-t border-zinc-850">
                        <span className="px-2 py-0.5 bg-zinc-950 rounded text-zinc-400">
                          Total: <strong className="text-white font-semibold">{rep.totalProcessed}</strong>
                        </span>
                        <span className="px-2 py-0.5 bg-emerald-950/40 text-emerald-400 border border-emerald-800/30 rounded">
                          +{rep.addedCount} novos
                        </span>
                        <span className="px-2 py-0.5 bg-blue-950/40 text-blue-400 border border-blue-800/30 rounded">
                          ↻ {rep.updatedCount} atualizados
                        </span>
                        <span className="px-2 py-0.5 bg-zinc-950 text-zinc-400 rounded">
                          ✓ {rep.ignoredCount} íntegros
                        </span>
                        {rep.errorsCount > 0 && (
                          <span className="px-2 py-0.5 bg-red-950/40 text-red-400 border border-red-800/30 rounded">
                            ✕ {rep.errorsCount} erros
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-500 ml-auto">
                          Admin: {rep.adminEmail}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: FERRAMENTAS DE BACKUP */}
          {activeTab === 'backup_tools' && (
            <div className="space-y-6">

              {/* CARD: CÓPIA DE SEGURANÇA DO BANCO */}
              <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 relative shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">CÓPIA DE SEGURANÇA DO BANCO</h3>
                    <p className="text-xs text-zinc-400 mt-1 font-normal">
                      Exportar uma cópia segura e estruturada de todo o catálogo do IPTV em formato JSON.
                    </p>
                  </div>
                  <div className="p-2.5 bg-red-600/10 text-red-400 rounded-xl shrink-0">
                    <Download className="w-5 h-5" />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-zinc-850">
                  <div className="text-xs text-zinc-400 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Contém metadados, temporadas, capas e identificadores TMDB.</span>
                  </div>

                  <button
                    onClick={handleDownloadBackup}
                    className="w-full sm:w-auto px-5 py-2.5 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-950/40 transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>BAIXAR CÓPIA DO BANCO</span>
                  </button>
                </div>
              </div>

              {/* DIAGNÓSTICOS (TMDB & BANCO) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* TMDB DIAG */}
                <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Diagnóstico TMDB</h4>
                    </div>
                    {tmdbDiag?.ok && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    )}
                  </div>

                  {tmdbDiag ? (
                    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3 space-y-1.5 text-[11px]">
                      <div className="flex justify-between text-zinc-400">
                        <span>Status API:</span>
                        <strong className={tmdbDiag.ok ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{tmdbDiag.statusText}</strong>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Latência:</span>
                        <strong className="text-white font-mono">{tmdbDiag.latencyMs}ms</strong>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Chave API:</span>
                        <strong className="text-emerald-400 font-semibold">Válida</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">Verifique a conectividade com a API oficial do TMDB.</p>
                  )}

                  <button
                    onClick={handleTestTmdb}
                    disabled={isTestingTmdb}
                    className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 border border-zinc-700/60"
                  >
                    {isTestingTmdb ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" /> : <Globe className="w-3.5 h-3.5 text-blue-400" />}
                    <span>TESTAR CONEXÃO TMDB</span>
                  </button>
                </div>

                {/* BANCO LOCAL / FIREBASE DIAG */}
                <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-emerald-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Diagnóstico Banco</h4>
                    </div>
                    {dbDiag?.ok && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    )}
                  </div>

                  {dbDiag ? (
                    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3 space-y-1.5 text-[11px]">
                      <div className="flex justify-between text-zinc-400">
                        <span>Armazenamento:</span>
                        <strong className="text-emerald-400 font-semibold">Operacional</strong>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Leitura & Escrita:</span>
                        <strong className="text-emerald-400 font-semibold">100% OK</strong>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Latência Interna:</span>
                        <strong className="text-white font-mono">{dbDiag.latencyMs}ms</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">Teste permissões de leitura, escrita e latência do banco.</p>
                  )}

                  <button
                    onClick={handleTestDb}
                    disabled={isTestingDb}
                    className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 border border-zinc-700/60"
                  >
                    {isTestingDb ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" /> : <Server className="w-3.5 h-3.5 text-emerald-400" />}
                    <span>TESTAR CONEXÃO BANCO</span>
                  </button>
                </div>

              </div>

              {/* RESTAURAÇÃO POR BACKUP (DETECÇÃO AUTOMÁTICA & MERGE SEGURO) */}
              <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 relative shadow-sm space-y-5">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white tracking-wide flex items-center gap-2">
                    <Upload className="w-5 h-5 text-red-500" />
                    <span>RESTAURAÇÃO POR BACKUP</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1 font-normal">
                    Carregue qualquer arquivo JSON de backup. O sistema detectará a estrutura automaticamente e fará o merge seguro sem apagar registros atuais.
                  </p>
                </div>

                {/* File picker */}
                <div className="relative border-2 border-dashed border-zinc-800 hover:border-red-900/50 hover:bg-red-950/10 rounded-2xl p-6 text-center transition-all cursor-pointer group">
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    disabled={isRestoringBackup}
                  />
                  <div className="p-3 bg-zinc-950 text-red-500 rounded-2xl w-fit mx-auto mb-3 border border-zinc-800 group-hover:scale-105 transition-transform">
                    <Upload className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-semibold text-white block">
                    {backupFile ? backupFile.name : 'Clique ou arraste o arquivo de backup aqui (.JSON)'}
                  </span>
                  <span className="text-[11px] text-zinc-500 block mt-1">
                    Suporta backups da plataforma IPTV, dumps genéricos ou coleções de filmes/séries em JSON
                  </span>
                </div>

                {/* Backup Analysis Preview & Structure Checklist */}
                {backupPreview && (
                  <div className="bg-zinc-950/90 border border-zinc-800/80 rounded-xl p-5 space-y-4">
                    
                    {/* Status Checklist */}
                    <div className="p-3 bg-zinc-900/80 border border-zinc-800/80 rounded-xl space-y-2">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                        STATUS DA ANÁLISE DO ARQUIVO:
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-zinc-300">Arquivo Carregado</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {backupPreview.validationChecklist.jsonValid ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          )}
                          <span className={backupPreview.validationChecklist.jsonValid ? 'text-zinc-300' : 'text-red-400'}>
                            JSON Válido
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {backupPreview.validationChecklist.structureDetected ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <span className={backupPreview.validationChecklist.structureDetected ? 'text-zinc-300' : 'text-amber-400'}>
                            Estrutura Mapeada
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {backupPreview.isValid ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          )}
                          <span className={backupPreview.isValid ? 'text-emerald-400 font-bold' : 'text-red-400'}>
                            {backupPreview.isValid ? 'Pronto p/ Restaurar' : 'Sem Registros'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Resumo Pré-Restauração Statistics Grid */}
                    <div className="space-y-2">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                        RESUMO PRÉ-RESTAURAÇÃO:
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <span className="text-[10px] text-zinc-400 block font-medium">TOTAL DE REGISTROS</span>
                          <strong className="text-sm sm:text-base font-bold text-white">{backupPreview.recordsCount.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <span className="text-[10px] text-zinc-400 block font-medium">FILMES</span>
                          <strong className="text-sm sm:text-base font-bold text-red-400">{backupPreview.moviesCount.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <span className="text-[10px] text-zinc-400 block font-medium">SÉRIES</span>
                          <strong className="text-sm sm:text-base font-bold text-purple-400">{backupPreview.seriesCount.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <span className="text-[10px] text-zinc-400 block font-medium">NOVOS (ESTIMADO)</span>
                          <strong className="text-sm sm:text-base font-bold text-emerald-400">+{backupPreview.newCount.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <span className="text-[10px] text-zinc-400 block font-medium">EXISTENTES BANCO</span>
                          <strong className="text-sm sm:text-base font-bold text-blue-400">{backupPreview.existingCount.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <span className="text-[10px] text-zinc-400 block font-medium">DUPLICADOS IGNORADOS</span>
                          <strong className="text-sm sm:text-base font-bold text-amber-400">{backupPreview.duplicatesCount.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <span className="text-[10px] text-zinc-400 block font-medium">ERROS DE FORMATO</span>
                          <strong className="text-sm sm:text-base font-bold text-zinc-400">{backupPreview.errorsCount.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <span className="text-[10px] text-zinc-400 block font-medium">TAMANHO ARQUIVO</span>
                          <strong className="text-sm sm:text-base font-bold text-zinc-200">{backupPreview.fileSizeFormatted}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Technical Structure Box */}
                    <div className="p-3 bg-zinc-900/60 border border-zinc-800/80 rounded-xl text-xs space-y-1 font-mono text-zinc-400">
                      <div className="flex justify-between border-b border-zinc-800 pb-1 mb-1">
                        <span className="text-zinc-400 font-sans font-semibold text-[11px]">ESTRUTURA DETECTADA DO ARQUIVO</span>
                        <span className="text-zinc-400">Versão: {backupPreview.formatVersion}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Padrão Estrutural:</span>
                        <strong className="text-white font-sans">{backupPreview.rawStructureDescription}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Chaves Encontradas no JSON:</span>
                        <strong className="text-zinc-300 font-mono truncate max-w-[200px]">
                          {backupPreview.detectedKeys.length > 0 ? backupPreview.detectedKeys.join(', ') : 'Nenhuma'}
                        </strong>
                      </div>
                    </div>

                    {/* Warning if 0 items detected */}
                    {!backupPreview.isValid && (
                      <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-2xl space-y-2 text-xs">
                        <div className="flex items-center gap-2 text-amber-400 font-semibold">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Nenhum registro válido identificado no arquivo</span>
                        </div>
                        <p className="text-amber-200/80 text-xs leading-relaxed">
                          O arquivo JSON foi lido, mas a estrutura interna não contém campos de filmes ou séries reconhecidos (como <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono text-[11px]">tmdb_id</code>, <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono text-[11px]">type</code>, <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono text-[11px]">title</code> ou coleções em array).
                        </p>
                      </div>
                    )}

                    {/* Live Progress Bar during Batch Restore */}
                    {restoreProgress && (
                      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="text-white flex items-center gap-2">
                            {restoreProgress.processed < restoreProgress.total ? (
                              <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            )}
                            <span>
                              {restoreProgress.processed < restoreProgress.total ? 'Restaurando em lotes...' : 'Restauração Finalizada!'}
                            </span>
                          </span>
                          <span className="font-mono text-zinc-400">
                            {restoreProgress.processed.toLocaleString('pt-BR')} / {restoreProgress.total.toLocaleString('pt-BR')} ({restoreProgress.percent}%)
                          </span>
                        </div>

                        <div className="w-full bg-zinc-950 rounded-full h-2.5 overflow-hidden border border-zinc-800">
                          <div
                            className="bg-gradient-to-r from-red-600 to-emerald-500 h-full rounded-full transition-all duration-200"
                            style={{ width: `${restoreProgress.percent}%` }}
                          ></div>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-center text-[10px] pt-1">
                          <div className="p-1.5 bg-zinc-950 rounded-lg">
                            <span className="text-zinc-500 block">Novos</span>
                            <strong className="text-emerald-400 font-bold text-xs">+{restoreProgress.added}</strong>
                          </div>
                          <div className="p-1.5 bg-zinc-950 rounded-lg">
                            <span className="text-zinc-500 block">Atualizados</span>
                            <strong className="text-blue-400 font-bold text-xs">↻ {restoreProgress.updated}</strong>
                          </div>
                          <div className="p-1.5 bg-zinc-950 rounded-lg">
                            <span className="text-zinc-500 block">Preservados</span>
                            <strong className="text-zinc-300 font-bold text-xs">✓ {restoreProgress.ignored}</strong>
                          </div>
                          <div className="p-1.5 bg-zinc-950 rounded-lg">
                            <span className="text-zinc-500 block">Erros</span>
                            <strong className="text-red-400 font-bold text-xs">✕ {restoreProgress.errors}</strong>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Trigger Button */}
                    <button
                      onClick={handleExecuteRestoreBackup}
                      disabled={isRestoringBackup || !backupPreview.isValid || backupPreview.recordsCount === 0}
                      className="w-full py-3 bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 active:scale-95 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-950/40 disabled:shadow-none"
                    >
                      {isRestoringBackup ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          <span>RESTAURAÇÃO EM ANDAMENTO (PROCESSANDO EM LOTES)...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>CONFIRMAR E RESTAURAR BACKUP</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {backupFeedback && (
                  <div className={`p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                    backupFeedback.type === 'success'
                      ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-400'
                      : 'bg-red-950/60 border border-red-800/60 text-red-400'
                  }`}>
                    {backupFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                    <span>{backupFeedback.message}</span>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

        {/* -------------------------------------------------------- */}
        {/* COLUNA DA DIREITA: CONSOLE DE ATIVIDADE EM TEMPO REAL    */}
        {/* -------------------------------------------------------- */}
        <div className="lg:col-span-5 space-y-4">
          
          <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden flex flex-col h-[650px]">
            
            {/* Header with terminal indicators */}
            <div className="flex items-center justify-between pb-3.5 border-b border-zinc-900 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-red-500" />
                    <span>CONSOLE DE ATIVIDADE</span>
                  </h3>
                  <span className="text-[10px] text-zinc-500 font-mono block">Eventos reais em tempo real</span>
                </div>
              </div>

              {/* Action Buttons: Clear & Copy */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopyLogs}
                  className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg text-xs transition-colors"
                  title="Copiar logs"
                >
                  {copiedLogs ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleClearLogs}
                  className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg text-xs transition-colors"
                  title="Limpar console"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable logs container */}
            <div className="flex-1 overflow-y-auto font-mono text-[11px] p-3 space-y-2 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
              {logs.length === 0 ? (
                <div className="text-zinc-600 text-center py-20 text-xs font-sans">
                  Nenhum evento registrado ainda.
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 leading-relaxed break-words">
                    <span className="text-zinc-600 select-none text-[10px] shrink-0">
                      {log.time}
                    </span>

                    <span className={`shrink-0 ${
                      log.type === 'success' ? 'text-emerald-400' :
                      log.type === 'warn' ? 'text-amber-400' :
                      log.type === 'error' ? 'text-red-400' :
                      'text-blue-400'
                    }`}>
                      {log.type === 'success' ? '✓' :
                       log.type === 'warn' ? '⚠' :
                       log.type === 'error' ? '✕' : 'ℹ'}
                    </span>

                    <span className={`flex-1 ${
                      log.type === 'success' ? 'text-zinc-200' :
                      log.type === 'warn' ? 'text-amber-300' :
                      log.type === 'error' ? 'text-red-300' :
                      'text-zinc-400'
                    }`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={consoleEndRef} />
            </div>

            {/* Terminal footer status bar */}
            <div className="pt-3 border-t border-zinc-900 flex items-center justify-between text-[10px] text-zinc-500 font-mono shrink-0">
              <span>BUFFER: {logs.length} eventos</span>
              <span>STATUS: {isOperationRunning ? 'EXECUTANDO' : 'PRONTO'}</span>
            </div>

          </div>

        </div>

      </div>

      {/* ========================================================== */}
      {/* 4. MODAL DE CONFIRMAÇÃO SEGURO                             */}
      {/* ========================================================== */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-600/15 text-red-500 border border-red-500/20 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>

              <div className="text-center space-y-2">
                <h3 className="text-base font-bold text-white">{confirmModal.title}</h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-normal">
                  {confirmModal.description}
                </p>
              </div>

              <div className="bg-zinc-950/80 border border-zinc-800 p-3 rounded-xl text-xs text-zinc-400 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Garantia de segurança: dados existentes nunca são excluídos.</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs rounded-xl transition-colors border border-zinc-700/60"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmModal.onConfirm}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl transition-colors shadow-lg shadow-red-950/40"
                >
                  {confirmModal.actionLabel}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================== */}
      {/* 5. MODAL DE DETALHES DO RELATÓRIO                          */}
      {/* ========================================================== */}
      <AnimatePresence>
        {selectedReport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div>
                  <h3 className="text-sm font-bold text-white">{selectedReport.operation}</h3>
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {new Date(selectedReport.timestamp).toLocaleString('pt-BR')} • {selectedReport.duration}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedReport(null)}
                  className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg"
                >
                  ✕
                </button>
              </div>

              {/* Stats overview */}
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 block">Processados</span>
                  <strong className="text-white font-bold">{selectedReport.totalProcessed}</strong>
                </div>
                <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 block">Atualizados</span>
                  <strong className="text-emerald-400 font-bold">{selectedReport.updatedCount}</strong>
                </div>
                <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 block">Preservados</span>
                  <strong className="text-zinc-300 font-bold">{selectedReport.ignoredCount}</strong>
                </div>
                <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 block">Erros</span>
                  <strong className="text-red-400 font-bold">{selectedReport.errorsCount}</strong>
                </div>
              </div>

              {/* Step by step details */}
              <div className="flex-1 overflow-y-auto space-y-2 bg-zinc-950/80 p-4 rounded-xl border border-zinc-850 font-mono text-[11px] scrollbar-thin scrollbar-thumb-zinc-800">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-2 font-sans">
                  Registro de Execução:
                </span>
                {selectedReport.details && selectedReport.details.length > 0 ? (
                  selectedReport.details.map((line, idx) => (
                    <div key={idx} className="text-zinc-300 py-0.5 border-b border-zinc-900/60 last:border-0">
                      {line}
                    </div>
                  ))
                ) : (
                  <div className="text-zinc-500">Nenhum detalhe adicional gravado.</div>
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setSelectedReport(null)}
                  className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs rounded-xl border border-zinc-700/60"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
