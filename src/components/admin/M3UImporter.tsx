import React, { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Tv,
  Film,
  Layers,
  RefreshCw,
  Play,
  Pause,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Settings,
  Trash2,
  Search,
  ExternalLink,
  Shield,
  Clock,
  HardDrive,
  Sparkles,
  X,
  ChevronRight,
  Sliders,
  ListFilter,
  Eye,
  Check,
  Zap,
  Info
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { M3USource, M3USyncJob, M3USyncError } from '../../types.js';

interface M3UImporterProps {
  onCatalogUpdated?: () => void;
}

export const M3UImporter: React.FC<M3UImporterProps> = ({ onCatalogUpdated }) => {
  // Source & Sync status
  const [sources, setSources] = useState<Array<M3USource & { maskedUrl: string; hasCredentials?: boolean }>>([]);
  const [activeJob, setActiveJob] = useState<M3USyncJob | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [catalogCounts, setCatalogCounts] = useState<{ totalCatalog: number; m3uMovies: number; m3uSeries: number; liveChannels: number }>({
    totalCatalog: 0,
    m3uMovies: 0,
    m3uSeries: 0,
    liveChannels: 0
  });

  // Test connection feedback
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; previewCount?: number; sampleItems?: string[] } | null>(null);

  // Modals & Panels
  const [activeTab, setActiveTab] = useState<'overview' | 'results' | 'errors' | 'jobs'>('overview');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showCleanModal, setShowCleanModal] = useState<boolean>(false);
  const [showTestModal, setShowTestModal] = useState<boolean>(false);

  // Config Form
  const [configUrl, setConfigUrl] = useState<string>('');
  const [configName, setConfigName] = useState<string>('');
  const [configAutoSync, setConfigAutoSync] = useState<boolean>(true);
  const [configInterval, setConfigInterval] = useState<number>(60);
  const [configAutoTmdb, setConfigAutoTmdb] = useState<boolean>(true);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);

  // Job History & Errors
  const [jobsHistory, setJobsHistory] = useState<M3USyncJob[]>([]);
  const [syncErrors, setSyncErrors] = useState<M3USyncError[]>([]);
  const [filterErrorType, setFilterErrorType] = useState<string>('all');

  // Results Viewer
  const [resultsSearch, setResultsSearch] = useState<string>('');
  const [resultsType, setResultsType] = useState<'all' | 'movie' | 'tv' | 'channel'>('all');
  const [previewItems, setPreviewItems] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState<boolean>(false);

  // General Toast Feedback
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load Status and Data
  const loadStatus = async () => {
    try {
      const status = await api.getM3USyncStatus();
      setActiveJob(status.activeJob);
      setIsSyncing(status.isSyncing);
      if (status.counts) {
        setCatalogCounts(status.counts);
      }
      if (status.source) {
        setConfigName(status.source.name || '');
        setConfigAutoSync(status.source.autoSync !== false);
        setConfigInterval(status.source.syncIntervalMinutes || 60);
        setConfigAutoTmdb(status.source.autoTmdbMatch !== false);
      }
    } catch (err: any) {
      console.error('Failed to load M3U status:', err);
    }
  };

  const loadSources = async () => {
    try {
      const res = await api.getM3USources();
      setSources(res);
      if (res.length > 0 && !configUrl) {
        setConfigUrl(res[0].maskedUrl || '');
        setConfigName(res[0].name || '');
        setConfigAutoSync(res[0].autoSync !== false);
        setConfigInterval(res[0].syncIntervalMinutes || 60);
        setConfigAutoTmdb(res[0].autoTmdbMatch !== false);
      }
    } catch (err) {
      console.error('Failed to load M3U sources:', err);
    }
  };

  const loadJobsAndErrors = async () => {
    try {
      const [jobs, errs] = await Promise.all([
        api.getM3USyncJobs(10),
        api.getM3USyncErrors()
      ]);
      setJobsHistory(jobs || []);
      setSyncErrors(errs || []);
    } catch (err) {
      console.error('Failed to load jobs/errors:', err);
    }
  };

  const loadResults = async () => {
    setLoadingResults(true);
    try {
      const [catalogRes, liveRes] = await Promise.all([
        api.getCatalog({ limit: 100, source: 'Imported' }),
        api.getAdminLiveChannels()
      ]);

      const list: any[] = [];
      if (catalogRes?.items) {
        list.push(...catalogRes.items.map(i => ({ ...i, itemType: i.type === 'movie' ? 'movie' : 'tv' })));
      }
      if (liveRes && Array.isArray(liveRes)) {
        list.push(...liveRes.map(c => ({
          id: c.id,
          title: c.name,
          posterPath: c.logo || c.logoUrl,
          group: c.group || c.category,
          streamUrl: c.streamUrl,
          itemType: 'channel',
          sourceStatus: c.sourceStatus || 'available'
        })));
      }
      setPreviewItems(list);
    } catch (err) {
      console.error('Failed to load results:', err);
    } finally {
      setLoadingResults(false);
    }
  };

  useEffect(() => {
    loadStatus();
    loadSources();
    loadJobsAndErrors();
  }, []);

  // Polling during active sync
  useEffect(() => {
    if (isSyncing) {
      pollingRef.current = setInterval(() => {
        loadStatus();
        loadJobsAndErrors();
      }, 2000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [isSyncing]);

  // Actions
  const handleTestConnection = async (testUrl?: string) => {
    setIsTesting(true);
    setTestResult(null);
    setShowTestModal(true);
    try {
      const targetSourceId = sources[0]?.id || 'source-default-playfilme';
      const targetUrl = testUrl || (configUrl && !configUrl.includes('••••') ? configUrl : undefined) || sources[0]?.url;
      const res = await api.testM3UConnection({ sourceId: targetSourceId, url: targetUrl });
      setTestResult(res);
      if (res.ok) {
        showToast('✓ Conexão M3U testada e autorizada com sucesso!', 'success');
      } else {
        showToast(`Aviso: ${res.message}`, 'error');
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || 'Falha ao conectar à playlist.' });
      showToast('Falha no teste de conexão', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleStartSync = async () => {
    if (isSyncing) return;
    try {
      const res = await api.triggerM3USync(sources[0]?.id);
      setIsSyncing(true);
      showToast('⚡ Sincronização M3U iniciada em segundo plano!', 'info');
      await loadStatus();
      if (onCatalogUpdated) onCatalogUpdated();
    } catch (err: any) {
      showToast(err?.message || 'Falha ao iniciar sincronização', 'error');
    }
  };

  const handleCancelSync = async () => {
    try {
      await api.cancelM3USync(activeJob?.id);
      setIsSyncing(false);
      showToast('Sincronização cancelada pelo administrador.', 'info');
      await loadStatus();
    } catch (err: any) {
      showToast(err?.message || 'Erro ao cancelar', 'error');
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sources[0]) return;
    setIsSavingConfig(true);
    try {
      const payload: any = {
        name: configName,
        autoSync: configAutoSync,
        syncIntervalMinutes: Number(configInterval),
        autoTmdbMatch: configAutoTmdb
      };
      // Only send url if not masked
      if (configUrl && !configUrl.includes('••••••••') && configUrl.startsWith('http')) {
        payload.url = configUrl;
      }

      const res = await api.updateM3USource(sources[0].id, payload);
      showToast('✓ Configurações da fonte M3U salvas com sucesso!', 'success');
      setShowConfigModal(false);
      await loadSources();
      await loadStatus();
    } catch (err: any) {
      showToast(err?.message || 'Falha ao atualizar configurações', 'error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleRemoveUnavailable = async () => {
    try {
      const res = await api.removeM3UUnavailableItems();
      showToast(res.message || 'Limpeza realizada!', 'success');
      setShowCleanModal(false);
      await loadStatus();
      if (onCatalogUpdated) onCatalogUpdated();
    } catch (err: any) {
      showToast(err?.message || 'Erro ao executar limpeza', 'error');
    }
  };

  const currentSource = sources[0] || null;

  // Filter preview items
  const filteredPreview = previewItems.filter(item => {
    if (resultsType !== 'all' && item.itemType !== resultsType) return false;
    if (resultsSearch.trim()) {
      const q = resultsSearch.toLowerCase();
      const matchTitle = (item.title || '').toLowerCase().includes(q);
      const matchGroup = (item.group || (item.genres && item.genres.join(' ')) || '').toLowerCase().includes(q);
      return matchTitle || matchGroup;
    }
    return true;
  });

  return (
    <div className="space-y-4" id="m3u-importer-container">
      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-2xl flex items-center gap-3 text-xs font-semibold backdrop-blur-md animate-fade-in ${
          toast.type === 'success' 
            ? 'bg-emerald-950/90 text-emerald-300 border-emerald-800/80 shadow-emerald-950/40' 
            : toast.type === 'error'
            ? 'bg-red-950/90 text-red-300 border-red-800/80 shadow-red-950/40'
            : 'bg-zinc-900/90 text-zinc-200 border-zinc-700/80'
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
          {toast.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-4 sm:p-5 shadow-lg relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-red-600/10 border border-red-500/20 text-red-500">
                <Radio className="w-4 h-4" />
              </span>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                IMPORTAÇÃO INTELIGENTE M3U
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-600/20 text-red-400 border border-red-500/30 uppercase tracking-widest font-black">
                  PRO
                </span>
              </h1>
            </div>
            <p className="text-xs text-zinc-400 max-w-2xl">
              Integração profissional para sincronizar playlist autorizada e estruturar filmes, séries, temporadas, episódios e canais de TV ao vivo com segurança e integridade.
            </p>
          </div>

          {/* STATUS BADGE & HEADER ACTIONS */}
          <div className="flex items-center flex-wrap gap-2.5">
            <div className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              isSyncing 
                ? 'bg-amber-950/60 border-amber-800/80 text-amber-300 animate-pulse'
                : currentSource?.enabled
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-amber-400 animate-ping' : currentSource?.enabled ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
              <span>{isSyncing ? 'Sincronizando em tempo real' : currentSource?.enabled ? 'M3U Conectada & Pronta' : 'Desativada'}</span>
            </div>

            <button
              onClick={() => setShowConfigModal(true)}
              className="px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-750 border border-zinc-700/80 rounded-xl text-xs font-semibold text-zinc-200 hover:text-white flex items-center gap-1.5 transition-all shadow-sm"
              title="Configurações da Playlist"
            >
              <Settings className="w-3.5 h-3.5 text-zinc-400" />
              <span>Configurações</span>
            </button>
          </div>
        </div>
      </div>

      {/* ACTIVE PROGRESS BAR IF SYNCING */}
      {isSyncing && activeJob && (
        <div className="bg-gradient-to-r from-red-950/40 via-zinc-900 to-red-950/40 border border-red-800/50 rounded-2xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-red-500 animate-spin" />
              <span className="font-bold text-zinc-100 uppercase tracking-wide">Sincronização em Execução</span>
              <span className="text-zinc-500">•</span>
              <span className="text-zinc-300 font-mono text-[11px]">{activeJob.currentTask || 'Processando playlist...'}</span>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-red-400">{activeJob.progress || 0}%</span>
              <button
                onClick={handleCancelSync}
                className="px-2.5 py-1 bg-red-900/40 hover:bg-red-900/80 border border-red-700/80 text-red-200 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                <span>Cancelar</span>
              </button>
            </div>
          </div>

          {/* Visual Track */}
          <div className="w-full bg-zinc-950 rounded-full h-2.5 overflow-hidden border border-zinc-800/80 p-0.5">
            <div 
              className="bg-gradient-to-r from-red-600 via-rose-500 to-amber-500 h-full rounded-full transition-all duration-500 shadow-sm"
              style={{ width: `${Math.max(4, Math.min(100, activeJob.progress || 0))}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-zinc-400 pt-1">
            <div>Lidos: <strong className="text-zinc-200">{activeJob.totalFound || 0}</strong></div>
            <div>Novos: <strong className="text-emerald-400">{activeJob.importedCount || 0}</strong></div>
            <div>Atualizados: <strong className="text-blue-400">{activeJob.updatedCount || 0}</strong></div>
            <div>Erros: <strong className="text-red-400">{activeJob.errorCount || 0}</strong></div>
          </div>
        </div>
      )}

      {/* METRICS & METADATA OVERVIEW CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* FILMES */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3 space-y-1">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-medium">Filmes M3U</span>
            <Film className="w-3.5 h-3.5 text-red-500" />
          </div>
          <p className="text-xl font-bold font-mono text-zinc-100">{catalogCounts.m3uMovies}</p>
          <span className="text-[10px] text-zinc-500">No catálogo</span>
        </div>

        {/* SÉRIES */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3 space-y-1">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-medium">Séries M3U</span>
            <Tv className="w-3.5 h-3.5 text-red-500" />
          </div>
          <p className="text-xl font-bold font-mono text-zinc-100">{catalogCounts.m3uSeries}</p>
          <span className="text-[10px] text-zinc-500">Temporadas & EPs</span>
        </div>

        {/* TV AO VIVO */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3 space-y-1">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-medium">Canais TV</span>
            <Radio className="w-3.5 h-3.5 text-red-500" />
          </div>
          <p className="text-xl font-bold font-mono text-zinc-100">{catalogCounts.liveChannels}</p>
          <span className="text-[10px] text-emerald-400">Transmissão ativa</span>
        </div>

        {/* ÚLTIMO JOB IMPORTADOS */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3 space-y-1">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-medium">Último Sync</span>
            <Zap className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <p className="text-xl font-bold font-mono text-zinc-100">
            {jobsHistory[0]?.importedCount !== undefined ? `+${jobsHistory[0].importedCount}` : '-'}
          </p>
          <span className="text-[10px] text-zinc-500">Novos adicionados</span>
        </div>

        {/* ERROS / ALERTAS */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3 space-y-1">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-medium">Alertas / Erros</span>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <p className="text-xl font-bold font-mono text-zinc-100">{syncErrors.length}</p>
          <span className="text-[10px] text-zinc-500">Registros em log</span>
        </div>

        {/* AUTO-SYNC AGENDADO */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3 space-y-1">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-medium">Auto-Sync</span>
            <Clock className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <p className="text-xl font-bold font-mono text-zinc-100">
            {currentSource?.autoSync ? `${currentSource.syncIntervalMinutes || 60}m` : 'Off'}
          </p>
          <span className="text-[10px] text-zinc-500">{currentSource?.autoSync ? 'Automático' : 'Manual'}</span>
        </div>
      </div>

      {/* CONTROL PANEL BUTTONS */}
      <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center flex-wrap gap-2">
          {/* TEST CONNECTION BUTTON */}
          <button
            onClick={handleTestConnection}
            disabled={isTesting || isSyncing}
            className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-750 disabled:opacity-50 text-white rounded-xl text-xs font-semibold border border-zinc-700/80 flex items-center gap-2 transition-all shadow-sm active:scale-98"
          >
            {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
            <span>Testar Conexão</span>
          </button>

          {/* SYNC NOW BUTTON */}
          <button
            onClick={handleStartSync}
            disabled={isSyncing}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md active:scale-98"
          >
            {isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Agora'}</span>
          </button>

          {/* VIEW RESULTS BUTTON */}
          <button
            onClick={() => {
              setActiveTab('results');
              loadResults();
            }}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${
              activeTab === 'results'
                ? 'bg-zinc-800 text-white border-zinc-600'
                : 'bg-zinc-950/60 hover:bg-zinc-850 text-zinc-300 border-zinc-800'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-red-500" />
            <span>Ver Conteúdos</span>
          </button>

          {/* VIEW ERRORS BUTTON */}
          <button
            onClick={() => setActiveTab('errors')}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${
              activeTab === 'errors'
                ? 'bg-zinc-800 text-white border-zinc-600'
                : 'bg-zinc-950/60 hover:bg-zinc-850 text-zinc-300 border-zinc-800'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Ver Erros ({syncErrors.length})</span>
          </button>
        </div>

        {/* CLEAN UNAVAILABLE BUTTON */}
        <button
          onClick={() => setShowCleanModal(true)}
          className="px-3 py-2 bg-zinc-950 hover:bg-red-950/50 hover:text-red-300 hover:border-red-800/80 border border-zinc-800 text-zinc-400 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5"
          title="Remover conteúdos que não existem mais na playlist"
        >
          <Trash2 className="w-3.5 h-3.5 text-red-400" />
          <span>Remover Indisponíveis</span>
        </button>
      </div>

      {/* SOURCE INFO BANNER (WITH MASKED URL FOR SECURITY) */}
      <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3 sm:p-4 text-xs space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-zinc-400">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-semibold text-zinc-200">Fonte Configurada:</span>
            <span className="font-mono text-zinc-400 truncate max-w-md">{currentSource?.maskedUrl || 'Nenhuma URL configurada'}</span>
          </div>

          <div className="flex items-center gap-3 shrink-0 font-mono text-[11px]">
            <span>Último sync: <strong className="text-zinc-200">{currentSource?.lastSyncAt ? new Date(currentSource.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}</strong></span>
          </div>
        </div>
      </div>

      {/* SUB-TABS VIEWER */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* HISTÓRICO DE JOBS (8 COLS) */}
          <div className="lg:col-span-8 bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-red-500" />
                Histórico de Sincronizações
              </h3>
              <button
                onClick={loadJobsAndErrors}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Atualizar</span>
              </button>
            </div>

            <div className="space-y-2">
              {jobsHistory.map((job) => (
                <div key={job.id} className="p-3 bg-zinc-950/60 border border-zinc-800/60 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        job.status === 'COMPLETED' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50' :
                        job.status === 'RUNNING' ? 'bg-amber-950/80 text-amber-400 border border-amber-800/50 animate-pulse' :
                        job.status === 'CANCELLED' ? 'bg-zinc-800 text-zinc-300' : 'bg-red-950/80 text-red-400 border border-red-800/50'
                      }`}>
                        {job.status}
                      </span>
                      <span className="font-mono text-zinc-400 text-[11px]">
                        {new Date(job.startTime).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <p className="text-zinc-300 text-xs truncate max-w-md">{job.currentTask || 'Execução de rotina M3U'}</p>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-[11px] shrink-0 text-zinc-400">
                    <span>Lidos: <strong className="text-zinc-200">{job.totalFound || 0}</strong></span>
                    <span>Novos: <strong className="text-emerald-400">{job.importedCount || 0}</strong></span>
                    <span>Atualizados: <strong className="text-blue-400">{job.updatedCount || 0}</strong></span>
                    {job.errorCount > 0 && <span>Erros: <strong className="text-red-400">{job.errorCount}</strong></span>}
                  </div>
                </div>
              ))}

              {jobsHistory.length === 0 && (
                <div className="py-8 text-center text-zinc-500 text-xs">
                  Nenhuma sincronização realizada ainda. Clique em "Sincronizar Agora" para iniciar.
                </div>
              )}
            </div>
          </div>

          {/* DICAS & REGRAS DE INTEGRIDADE (4 COLS) */}
          <div className="lg:col-span-4 bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              Diretrizes de Integridade
            </h3>

            <div className="space-y-2 text-xs text-zinc-400">
              <div className="p-2.5 bg-zinc-950/60 border border-zinc-800/60 rounded-lg space-y-1">
                <span className="font-semibold text-zinc-200 block">Deduplicação Inteligente</span>
                <p className="text-[11px] leading-relaxed">
                  Evita duplicatas combinando título normalizado, ano de lançamento e chave de episódio (SxxExx).
                </p>
              </div>

              <div className="p-2.5 bg-zinc-950/60 border border-zinc-800/60 rounded-lg space-y-1">
                <span className="font-semibold text-zinc-200 block">Proteção do Catálogo</span>
                <p className="text-[11px] leading-relaxed">
                  Itens ausentes na playlist são marcados como indisponíveis sem apagar dados anteriores do acervo.
                </p>
              </div>

              <div className="p-2.5 bg-zinc-950/60 border border-zinc-800/60 rounded-lg space-y-1">
                <span className="font-semibold text-zinc-200 block">Segurança e Credenciais</span>
                <p className="text-[11px] leading-relaxed">
                  URLs com credenciais nunca são expostas ao frontend nem gravadas em logs públicos.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESULTS TABLE VIEW */}
      {activeTab === 'results' && (
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Conteúdos Sincronizados ({filteredPreview.length})</h3>
              <p className="text-[11px] text-zinc-400">Navegue pelos filmes, séries e canais originados da playlist</p>
            </div>

            {/* FILTERS */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Pesquisar título..."
                  value={resultsSearch}
                  onChange={(e) => setResultsSearch(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-600"
                />
              </div>

              <select
                value={resultsType}
                onChange={(e) => setResultsType(e.target.value as any)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-600"
              >
                <option value="all">Todos os tipos</option>
                <option value="movie">Filmes</option>
                <option value="tv">Séries</option>
                <option value="channel">TV ao Vivo</option>
              </select>

              <button
                onClick={loadResults}
                className="p-1.5 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg"
                title="Recarregar"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingResults ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-950 shadow-inner max-h-[480px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-zinc-900/90 text-zinc-400 uppercase tracking-wider font-bold border-b border-zinc-800 text-[10px] sticky top-0 z-10">
                <tr>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Título</th>
                  <th className="p-3">Categoria / Grupo</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-850">
                {filteredPreview.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-900/40">
                    <td className="p-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        item.itemType === 'movie' ? 'bg-blue-950/80 text-blue-400 border border-blue-800/40' :
                        item.itemType === 'tv' ? 'bg-purple-950/80 text-purple-400 border border-purple-800/40' :
                        'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40'
                      }`}>
                        {item.itemType === 'movie' ? 'Filme' : item.itemType === 'tv' ? 'Série' : 'Canal TV'}
                      </span>
                    </td>
                    <td className="p-3 font-semibold text-white max-w-xs truncate">
                      {item.title}
                    </td>
                    <td className="p-3 text-zinc-400 font-mono text-[11px] max-w-[150px] truncate">
                      {item.group || (item.genres && item.genres.join(', ')) || 'Geral'}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        item.sourceStatus === 'unavailable' ? 'bg-red-950 text-red-400' : 'bg-emerald-950 text-emerald-400'
                      }`}>
                        {item.sourceStatus === 'unavailable' ? 'Indisponível' : 'Disponível'}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {item.streamUrl ? (
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-1 rounded border border-emerald-900/40">
                          Fluxo M3U OK
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}

                {filteredPreview.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-zinc-500">
                      Nenhum item correspondente aos filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ERRORS LOG VIEW */}
      {activeTab === 'errors' && (
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Logs de Erro da Sincronização ({syncErrors.length})
            </h3>
            <button
              onClick={() => setActiveTab('overview')}
              className="text-xs text-red-500 hover:text-red-400 font-semibold"
            >
              Voltar ao Início
            </button>
          </div>

          <div className="space-y-2 max-h-[480px] overflow-y-auto">
            {syncErrors.map((err) => (
              <div key={err.id} className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl space-y-1 text-xs">
                <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                  <span className="font-mono text-red-400 font-semibold">{err.operation}</span>
                  <span className="font-mono">{new Date(err.timestamp).toLocaleTimeString('pt-BR')}</span>
                </div>
                <p className="font-semibold text-zinc-200">{err.item}</p>
                <p className="text-red-300 font-mono text-[11px]">{err.message}</p>
              </div>
            ))}

            {syncErrors.length === 0 && (
              <div className="py-8 text-center text-zinc-500 text-xs">
                Nenhum erro registrado. Todas as importações operaram com 100% de sucesso!
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CONFIGURAÇÕES DA PLAYLIST */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-red-500" />
                Configurações da Fonte M3U
              </h3>
              <button onClick={() => setShowConfigModal(false)} className="text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Nome da Fonte</label>
                <input
                  type="text"
                  required
                  value={configName}
                  onChange={(e) => setConfigName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-600"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">
                  URL da Playlist M3U autorizada
                </label>
                <input
                  type="text"
                  required
                  placeholder="https://servidor.com/get.php?username=...&password=..."
                  value={configUrl}
                  onChange={(e) => setConfigUrl(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-red-600"
                />
                <span className="text-[10px] text-zinc-500 mt-1 block">
                  * Armazenada com segurança no backend. Credenciais são mascaradas na interface.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">Intervalo de Sincronização</label>
                  <select
                    value={configInterval}
                    onChange={(e) => setConfigInterval(parseInt(e.target.value, 10))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-600"
                  >
                    <option value={15}>A cada 15 minutos</option>
                    <option value={30}>A cada 30 minutos</option>
                    <option value={60}>A cada 60 minutos (1 hora)</option>
                    <option value={120}>A cada 2 horas</option>
                    <option value={360}>A cada 6 horas</option>
                    <option value={1440}>A cada 24 horas (Diário)</option>
                  </select>
                </div>

                <div className="flex flex-col justify-center space-y-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={configAutoSync}
                      onChange={(e) => setConfigAutoSync(e.target.checked)}
                      className="accent-red-600 w-4 h-4 rounded"
                    />
                    <span className="text-xs font-medium text-zinc-200">Auto-sincronizar</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={configAutoTmdb}
                      onChange={(e) => setConfigAutoTmdb(e.target.checked)}
                      className="accent-red-600 w-4 h-4 rounded"
                    />
                    <span className="text-xs font-medium text-zinc-200">Enriquecer TMDB</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/80">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-semibold transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md"
                >
                  {isSavingConfig ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TESTE DE CONEXÃO */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Diagnóstico de Conectividade M3U
              </h3>
              <button onClick={() => setShowTestModal(false)} className="text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {isTesting ? (
              <div className="py-8 flex flex-col items-center justify-center space-y-3">
                <RefreshCw className="w-8 h-8 text-red-500 animate-spin" />
                <p className="text-xs text-zinc-300 font-semibold">Testando conexão com o servidor...</p>
                <span className="text-[10px] text-zinc-500">Validando cabeçalhos #EXTM3U e autorização</span>
              </div>
            ) : testResult ? (
              <div className="space-y-3">
                <div className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                  testResult.ok ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-red-950/40 border-red-800/60 text-red-300'
                }`}>
                  {testResult.ok ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />}
                  <div className="space-y-0.5 text-xs">
                    <strong className="block font-bold">{testResult.ok ? 'Conexão Bem-Sucedida!' : 'Falha na Conexão'}</strong>
                    <p className="text-[11px] leading-relaxed text-zinc-300">{testResult.message}</p>
                  </div>
                </div>

                {testResult.sampleItems && testResult.sampleItems.length > 0 && (
                  <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3 space-y-1.5 text-xs">
                    <span className="font-semibold text-zinc-300 text-[11px] block">Amostra de Canais/Filmes Detectados:</span>
                    <ul className="space-y-1 text-zinc-400 text-[11px] font-mono">
                      {testResult.sampleItems.map((item, idx) => (
                        <li key={idx} className="truncate">• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowTestModal(false)}
                className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white rounded-xl text-xs font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR REMOÇÃO DE INDISPONÍVEIS */}
      {showCleanModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-500" />
                Remover Itens Indisponíveis
              </h3>
              <button onClick={() => setShowCleanModal(false)} className="text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Esta ação excluirá apenas os filmes, séries e canais originados da playlist M3U que foram marcados como <strong className="text-red-400">indisponíveis</strong> durante a última sincronização.
            </p>
            <p className="text-[11px] text-zinc-500">
              Seus conteúdos manuais ou do TMDB importados separadamente permanecerão 100% seguros e intactos.
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/80">
              <button
                onClick={() => setShowCleanModal(false)}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleRemoveUnavailable}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all shadow-md"
              >
                Confirmar Limpeza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
