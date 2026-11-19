import React, { useState, useEffect, useRef } from 'react';
import {
  Server,
  Activity,
  Film,
  Tv,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  Search,
  Filter,
  Play,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Shield,
  Download,
  Upload,
  Settings,
  Bell,
  FileSpreadsheet,
  FileCode,
  Zap,
  Radio,
  StopCircle,
  Check,
  AlertCircle,
  FolderArchive,
  Layers,
  Database,
  Eye,
  CheckCheck,
  Trash2,
  ArrowUpRight
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  LinkHealthStatus,
  SourceVerificationRecord,
  ServerAlert,
  ServerSettings
} from '../../types.js';

interface ServerControlCenterProps {
  onOpenPlayer?: (tmdbId: number, type: 'movie' | 'tv', season?: number, episode?: number) => void;
  onEditSources?: (tmdbId: number, type: 'movie' | 'tv') => void;
}

type ControlSection =
  | 'overview'
  | 'movies_links'
  | 'series_links'
  | 'monitoring'
  | 'sources_online'
  | 'sources_offline'
  | 'sources_error'
  | 'links_recent'
  | 'links_old'
  | 'check_history'
  | 'alerts'
  | 'reports'
  | 'backup_restore'
  | 'server_settings';

export const ServerControlCenter: React.FC<ServerControlCenterProps> = ({
  onOpenPlayer,
  onEditSources
}) => {
  const [activeSection, setActiveSection] = useState<ControlSection>('overview');

  // Stats & Overview
  const [stats, setStats] = useState<any>(null);
  const [statsRange, setStatsRange] = useState<string>('7d');
  const [isLoadingStats, setIsLoadingStats] = useState<boolean>(true);

  // Movies Links
  const [moviesData, setMoviesData] = useState<any>({ items: [], totalItems: 0, page: 1, totalPages: 1 });
  const [movieSearch, setMovieSearch] = useState<string>('');
  const [movieStatusFilter, setMovieStatusFilter] = useState<string>('todos');
  const [moviePage, setMoviePage] = useState<number>(1);
  const [isLoadingMovies, setIsLoadingMovies] = useState<boolean>(false);

  // Series Links Tree
  const [seriesTree, setSeriesTree] = useState<any[]>([]);
  const [seriesSearch, setSeriesSearch] = useState<string>('');
  const [isLoadingSeries, setIsLoadingSeries] = useState<boolean>(false);
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});
  const [expandedSeasons, setExpandedSeasons] = useState<Record<string, boolean>>({});

  // Filtered Sources (online, offline, error, recent, old)
  const [filteredSources, setFilteredSources] = useState<any[]>([]);
  const [isLoadingFiltered, setIsLoadingFiltered] = useState<boolean>(false);

  // Monitoring & Batch Verification Queue
  const [verifyProgress, setVerifyProgress] = useState<any>({
    running: false,
    total: 0,
    processed: 0,
    online: 0,
    offline: 0,
    error: 0,
    status: 'IDLE',
    currentItemTitle: '',
    currentUrl: ''
  });
  const progressPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check History
  const [historyRecords, setHistoryRecords] = useState<SourceVerificationRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);

  // Alerts
  const [alerts, setAlerts] = useState<ServerAlert[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState<boolean>(false);

  // Server Settings
  const [settingsData, setSettingsData] = useState<ServerSettings | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);

  // Backup & Restore ZIP
  const [isGeneratingZip, setIsGeneratingZip] = useState<boolean>(false);
  const [zipRestoreFile, setZipRestoreFile] = useState<File | null>(null);
  const [zipPreview, setZipPreview] = useState<any>(null);
  const [isInspectingZip, setIsInspectingZip] = useState<boolean>(false);
  const [isRestoringZip, setIsRestoringZip] = useState<boolean>(false);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [selectiveRestore, setSelectiveRestore] = useState({
    catalog: true,
    sources: true,
    settings: true,
    developers: true
  });

  // Toast / Feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Initial loads
  useEffect(() => {
    loadStats();
    loadAlerts();
    loadSettings();
  }, []);

  // Poll progress if batch running
  useEffect(() => {
    const checkProgress = async () => {
      try {
        const res = await api.getVerifyProgress();
        if (res.success && res.data) {
          setVerifyProgress(res.data);
          if (res.data.running) {
            if (!progressPollingRef.current) {
              progressPollingRef.current = setInterval(checkProgress, 1200);
            }
          } else {
            if (progressPollingRef.current) {
              clearInterval(progressPollingRef.current);
              progressPollingRef.current = null;
            }
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    checkProgress();
    return () => {
      if (progressPollingRef.current) clearInterval(progressPollingRef.current);
    };
  }, []);

  // Watch section changes to load appropriate data
  useEffect(() => {
    if (activeSection === 'overview') {
      loadStats();
    } else if (activeSection === 'movies_links') {
      loadMovies();
    } else if (activeSection === 'series_links') {
      loadSeries();
    } else if (['sources_online', 'sources_offline', 'sources_error', 'links_recent', 'links_old'].includes(activeSection)) {
      const filterKey = activeSection === 'sources_online' ? 'online'
        : activeSection === 'sources_offline' ? 'offline'
        : activeSection === 'sources_error' ? 'error'
        : activeSection === 'links_recent' ? 'recent' : 'old';
      loadFilteredSources(filterKey);
    } else if (activeSection === 'check_history') {
      loadHistory();
    } else if (activeSection === 'alerts') {
      loadAlerts();
    } else if (activeSection === 'server_settings') {
      loadSettings();
    }
  }, [activeSection, statsRange, moviePage, movieStatusFilter]);

  // Load functions
  const loadStats = async () => {
    setIsLoadingStats(true);
    try {
      const res = await api.getServerStats(statsRange);
      if (res.success) setStats(res.data);
    } catch {
      showToast('Falha ao carregar métricas do servidor.', 'error');
    } finally {
      setIsLoadingStats(false);
    }
  };

  const loadMovies = async () => {
    setIsLoadingMovies(true);
    try {
      const res = await api.getMovieLinks({
        search: movieSearch,
        status: movieStatusFilter,
        page: moviePage,
        limit: 15
      });
      if (res.success) setMoviesData(res.data);
    } catch {
      showToast('Erro ao carregar links de filmes.', 'error');
    } finally {
      setIsLoadingMovies(false);
    }
  };

  const loadSeries = async () => {
    setIsLoadingSeries(true);
    try {
      const res = await api.getSeriesLinks({ search: seriesSearch });
      if (res.success) setSeriesTree(res.data);
    } catch {
      showToast('Erro ao carregar estrutura de séries.', 'error');
    } finally {
      setIsLoadingSeries(false);
    }
  };

  const loadFilteredSources = async (filterKey: string) => {
    setIsLoadingFiltered(true);
    try {
      const res = await api.getFilteredSources(filterKey, 100);
      if (res.success) setFilteredSources(res.data);
    } catch {
      showToast('Erro ao listar fontes filtradas.', 'error');
    } finally {
      setIsLoadingFiltered(false);
    }
  };

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await api.getVerificationsHistory({ limit: 100 });
      if (res.success) setHistoryRecords(res.data);
    } catch {
      showToast('Erro ao carregar histórico de verificações.', 'error');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadAlerts = async () => {
    setIsLoadingAlerts(true);
    try {
      const res = await api.getServerAlerts(false);
      if (res.success) setAlerts(res.data);
    } catch {
      // ignore
    } finally {
      setIsLoadingAlerts(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await api.getServerSettings();
      if (res.success) setSettingsData(res.data);
    } catch {
      // ignore
    }
  };

  // Actions
  const handleVerifySingle = async (source: any) => {
    showToast('A verificar fonte em tempo real...', 'info');
    try {
      const res = await api.verifySingleSource({
        sourceId: source.id,
        url: source.url,
        tmdbId: source.tmdbId,
        type: source.type,
        season: source.season,
        episode: source.episode
      });
      if (res.success) {
        showToast(`Fonte verificada: ${res.data.health.toUpperCase()} (${res.data.latencyMs}ms)`, res.data.health === 'online' ? 'success' : 'error');
        if (activeSection === 'movies_links') loadMovies();
        else if (activeSection === 'series_links') loadSeries();
        else loadStats();
      }
    } catch (err: any) {
      showToast(`Falha na verificação: ${err.message}`, 'error');
    }
  };

  const handleStartBatch = async (scope: 'all' | 'movies' | 'series' | 'season', contentId?: string) => {
    try {
      const res = await api.verifyBatch({ scope, contentId });
      if (res.success) {
        showToast('Verificação em lote iniciada!', 'success');
        // Start polling
        if (progressPollingRef.current) clearInterval(progressPollingRef.current);
        progressPollingRef.current = setInterval(async () => {
          const p = await api.getVerifyProgress();
          if (p.success) {
            setVerifyProgress(p.data);
            if (!p.data.running) {
              if (progressPollingRef.current) {
                clearInterval(progressPollingRef.current);
                progressPollingRef.current = null;
              }
              loadStats();
              if (activeSection === 'movies_links') loadMovies();
              if (activeSection === 'series_links') loadSeries();
            }
          }
        }, 1200);
      }
    } catch (err: any) {
      showToast(`Erro ao iniciar verificação: ${err.message}`, 'error');
    }
  };

  const handleCancelBatch = async () => {
    try {
      const res = await api.cancelVerifyBatch();
      if (res.success) {
        showToast('Verificação cancelada.', 'info');
        setVerifyProgress((prev: any) => ({ ...prev, running: false, status: 'CANCELLED' }));
        if (progressPollingRef.current) {
          clearInterval(progressPollingRef.current);
          progressPollingRef.current = null;
        }
      }
    } catch {
      showToast('Falha ao cancelar verificação.', 'error');
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    showToast('URL copiado para a área de transferência!', 'success');
  };

  const handleAcknowledgeAlert = async (id: string) => {
    await api.acknowledgeServerAlert(id);
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    showToast('Alerta confirmado.', 'info');
  };

  const handleClearAlerts = async () => {
    await api.clearServerAlerts();
    setAlerts([]);
    showToast('Todos os alertas foram eliminados.', 'info');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsData) return;
    setIsSavingSettings(true);
    try {
      const res = await api.updateServerSettings(settingsData);
      if (res.success) {
        showToast('Configurações do servidor salvas com sucesso!', 'success');
      }
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ZIP Backup & Restore
  const handleDownloadZipBackup = async () => {
    setIsGeneratingZip(true);
    showToast('A compilar e compactar arquivo ZIP completo...', 'info');
    try {
      const res = await fetch('/api/admin/server/backup-zip', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token') || ''}`
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RONYCINE_BACKUP_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast('Backup ZIP descarregado com sucesso!', 'success');
    } catch (err: any) {
      showToast(`Falha ao descarregar backup: ${err.message}`, 'error');
    } finally {
      setIsGeneratingZip(false);
    }
  };

  const handleZipFileSelected = async (file: File) => {
    setZipRestoreFile(file);
    setZipPreview(null);
    setRestoreResult(null);
    setIsInspectingZip(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const res = await api.previewZipBackup(base64);
        if (res.success && (res.data.valid || res.data.errors.length === 0)) {
          setZipPreview(res.data);
          showToast('Arquivo ZIP validado com sucesso!', 'success');
        } else {
          showToast(res.data?.error || res.data?.errors?.[0] || 'Arquivo ZIP inválido ou corrompido.', 'error');
        }
        setIsInspectingZip(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setIsInspectingZip(false);
      showToast('Erro ao ler arquivo ZIP.', 'error');
    }
  };

  const handleExecuteZipRestore = async () => {
    if (!zipRestoreFile) return;
    setIsRestoringZip(true);
    showToast('A restaurar arquivo ZIP (snapshot de segurança gerado)...', 'info');

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const res = await api.restoreZipBackup(base64, selectiveRestore);
        if (res.success) {
          setRestoreResult(res.data || res);
          showToast('Restauração ZIP concluída com sucesso!', 'success');
          loadStats();
        } else {
          showToast(res.error || 'Falha na restauração do arquivo.', 'error');
        }
        setIsRestoringZip(false);
      };
      reader.readAsDataURL(zipRestoreFile);
    } catch (err: any) {
      setIsRestoringZip(false);
      showToast(`Erro na restauração: ${err.message}`, 'error');
    }
  };

  const sectionsList: Array<{ id: ControlSection; label: string; icon: any; count?: number }> = [
    { id: 'overview', label: 'Visão Geral', icon: Activity },
    { id: 'movies_links', label: 'Links de Filmes', icon: Film, count: stats?.totalMovies },
    { id: 'series_links', label: 'Links de Séries', icon: Tv, count: stats?.totalSeries },
    { id: 'monitoring', label: 'Monitorização em Tempo Real', icon: Radio },
    { id: 'sources_online', label: 'Fontes Online', icon: CheckCircle2, count: stats?.sourcesOnline },
    { id: 'sources_offline', label: 'Fontes Offline', icon: XCircle, count: stats?.sourcesOffline },
    { id: 'sources_error', label: 'Fontes com Erro', icon: AlertTriangle, count: stats?.sourcesError },
    { id: 'links_recent', label: 'Links Recentes', icon: Clock },
    { id: 'links_old', label: 'Links Antigos (+30d)', icon: Database },
    { id: 'check_history', label: 'Histórico de Verificações', icon: Layers },
    { id: 'alerts', label: 'Alertas do Servidor', icon: Bell, count: alerts.filter(a => !a.acknowledged).length },
    { id: 'reports', label: 'Relatórios & Exportação', icon: FileSpreadsheet },
    { id: 'backup_restore', label: 'Backup & Restauração ZIP', icon: FolderArchive },
    { id: 'server_settings', label: 'Configurações do Servidor', icon: Settings }
  ];

  return (
    <div className="space-y-6">
      {/* TOAST ALERT NOTIFICATION */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3.5 rounded-xl border shadow-2xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider backdrop-blur-md transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-300 shadow-emerald-950/40'
              : toast.type === 'error'
              ? 'bg-red-950/90 border-red-500/30 text-red-300 shadow-red-950/40'
              : 'bg-zinc-900/90 border-white/20 text-white shadow-black/60'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
          {toast.type === 'info' && <RefreshCw className="w-4 h-4 text-brand animate-spin shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* HEADER BANNER */}
      <div className="bg-gradient-to-r from-[#111111] via-[#0E0E0E] to-[#151515] border border-white/10 rounded-2xl p-6 sm:p-8 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-md bg-brand text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-brand/20">
                ULTRA CONTROL
              </span>
              <span className="flex items-center gap-1.5 text-xs font-mono text-zinc-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                SISTEMA OPERACIONAL
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight font-display flex items-center gap-3">
              <Server className="w-8 h-8 text-brand shrink-0" />
              RONYCINE SERVER CONTROL CENTER
            </h1>
            <p className="text-xs text-zinc-400 max-w-2xl">
              Centro de comando de infraestrutura de streaming: monitorização de links, testes de reprodução reais, isolamento de episódios, alertas de integridade e backups certificados.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleStartBatch('all')}
              disabled={verifyProgress.running}
              className="px-4 py-2.5 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-brand/20 active:scale-95"
            >
              {verifyProgress.running ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>A Verificar...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Verificar Todos os Links</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownloadZipBackup}
              disabled={isGeneratingZip}
              className="px-4 py-2.5 bg-[#1F222A] hover:bg-[#282C37] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all border border-white/10 flex items-center gap-2"
            >
              <FolderArchive className="w-4 h-4 text-amber-400" />
              <span>Backup ZIP Completo</span>
            </button>
          </div>
        </div>

        {/* BATCH PROGRESS BAR IF RUNNING */}
        {verifyProgress.running && (
          <div className="mt-6 pt-6 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                <span className="text-white font-bold">Verificação em Curso:</span>
                <span className="text-zinc-400 truncate max-w-md">{verifyProgress.currentItemTitle}</span>
              </div>
              <div className="flex items-center gap-4 text-zinc-300">
                <span>{verifyProgress.processed} / {verifyProgress.total}</span>
                <span className="text-emerald-400 font-bold">{verifyProgress.online} Online</span>
                <span className="text-red-400 font-bold">{verifyProgress.offline} Offline</span>
                <button
                  onClick={handleCancelBatch}
                  className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-[10px] font-bold uppercase tracking-wider"
                >
                  Cancelar
                </button>
              </div>
            </div>
            <div className="w-full h-2 bg-black/60 rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-brand to-emerald-500 transition-all duration-300 rounded-full"
                style={{ width: `${verifyProgress.total > 0 ? (verifyProgress.processed / verifyProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 14 SECTIONS NAVIGATION BAR */}
      <div className="bg-[#0C0E14] border border-white/10 rounded-2xl p-2 overflow-x-auto scrollbar-none flex items-center gap-1.5">
        {sectionsList.map(sec => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2 shrink-0 ${
                isActive
                  ? 'bg-brand text-white shadow-lg shadow-brand/20'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-zinc-400'}`} />
              <span>{sec.label}</span>
              {sec.count !== undefined && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-black/30 text-white' : 'bg-white/10 text-zinc-400'
                  }`}
                >
                  {sec.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* SECTION CONTENT SWITCHER */}
      <div className="bg-[#0C0E14] border border-white/10 rounded-2xl p-6 sm:p-8">
        
        {/* ================================================= */}
        {/* SECTION 1: VISÃO GERAL (OVERVIEW) */}
        {/* ================================================= */}
        {activeSection === 'overview' && (
          <div className="space-y-8">
            {/* KPI METRIC CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-1">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Total Fontes</span>
                <span className="text-2xl font-black text-white font-mono">{stats?.totalSources ?? 0}</span>
                <span className="text-[10px] text-zinc-500 block">Cadastradas no sistema</span>
              </div>

              <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-4 space-y-1">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest block flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3" /> Online
                </span>
                <span className="text-2xl font-black text-emerald-400 font-mono">{stats?.sourcesOnline ?? 0}</span>
                <span className="text-[10px] text-emerald-500/70 block">{stats?.onlineRatePercent ?? 0}% de taxa</span>
              </div>

              <div className="bg-red-950/20 border border-red-500/20 rounded-xl p-4 space-y-1">
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest block flex items-center gap-1.5">
                  <XCircle className="w-3 h-3" /> Offline
                </span>
                <span className="text-2xl font-black text-red-400 font-mono">{stats?.sourcesOffline ?? 0}</span>
                <span className="text-[10px] text-red-500/70 block">{stats?.offlineRatePercent ?? 0}% do catálogo</span>
              </div>

              <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-4 space-y-1">
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest block flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> Com Erro
                </span>
                <span className="text-2xl font-black text-amber-400 font-mono">{stats?.sourcesError ?? 0}</span>
                <span className="text-[10px] text-amber-500/70 block">{stats?.errorRatePercent ?? 0}% do catálogo</span>
              </div>

              <div className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-1">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Latência Média</span>
                <span className="text-2xl font-black text-white font-mono">{stats?.avgLatencyMs ?? 0} ms</span>
                <span className="text-[10px] text-zinc-500 block">Tempo de resposta</span>
              </div>

              <div className="bg-brand/10 border border-brand/20 rounded-xl p-4 space-y-1">
                <span className="text-[10px] font-bold text-brand uppercase tracking-widest block">Disponibilidade</span>
                <span className="text-2xl font-black text-brand font-mono">{stats?.overallAvailabilityPercent ?? 0}%</span>
                <span className="text-[10px] text-zinc-400 block">Saúde do ecossistema</span>
              </div>
            </div>

            {/* CATALOG BREAKDOWN (MOVIES, SERIES, EPISODES) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-black/30 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    <Film className="w-4 h-4 text-brand" /> Filmes
                  </span>
                  <span className="text-xs font-mono text-zinc-400">{stats?.totalMovies ?? 0} total</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-zinc-300">
                    <span>Com fontes ativas:</span>
                    <span className="font-bold text-emerald-400 font-mono">{stats?.moviesWithSourcesCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Sem fontes cadastradas:</span>
                    <span className="font-bold text-red-400 font-mono">{stats?.moviesWithoutSourcesCount ?? 0}</span>
                  </div>
                </div>
              </div>

              <div className="bg-black/30 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    <Tv className="w-4 h-4 text-purple-400" /> Séries
                  </span>
                  <span className="text-xs font-mono text-zinc-400">{stats?.totalSeries ?? 0} total</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-zinc-300">
                    <span>Com fontes ativas:</span>
                    <span className="font-bold text-emerald-400 font-mono">{stats?.seriesWithSourcesCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Sem fontes cadastradas:</span>
                    <span className="font-bold text-red-400 font-mono">{stats?.seriesWithoutSourcesCount ?? 0}</span>
                  </div>
                </div>
              </div>

              <div className="bg-black/30 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-400" /> Episódios
                  </span>
                  <span className="text-xs font-mono text-zinc-400">{stats?.totalEpisodes ?? 0} total</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-zinc-300">
                    <span>Com fontes ativas:</span>
                    <span className="font-bold text-emerald-400 font-mono">{stats?.episodesWithSourcesCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Sem fontes cadastradas:</span>
                    <span className="font-bold text-red-400 font-mono">{stats?.episodesWithoutSourcesCount ?? 0}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* AVAILABILITY TIMELINE CHART */}
            <div className="bg-black/40 border border-white/10 rounded-xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" /> Gráfico de Disponibilidade & Saúde das Fontes
                  </h3>
                  <p className="text-[11px] text-zinc-500">Histórico de integridade ao longo do tempo</p>
                </div>

                <div className="flex items-center gap-1.5 bg-[#0C0E14] border border-white/10 rounded-xl p-1 shrink-0">
                  {['today', '7d', '30d', '90d'].map(range => (
                    <button
                      key={range}
                      onClick={() => setStatsRange(range)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        statsRange === range ? 'bg-brand text-white shadow' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {range === 'today' ? 'Hoje' : range === '7d' ? '7 Dias' : range === '30d' ? '30 Dias' : '90 Dias'}
                    </button>
                  ))}
                </div>
              </div>

              {/* TIMELINE VISUALIZER */}
              <div className="h-44 flex items-end gap-2 pt-6">
                {stats?.timeline?.map((item: any, idx: number) => {
                  const pct = Math.max(8, item.availabilityPercent);
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                      <div className="text-[9px] font-mono text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {item.availabilityPercent}%
                      </div>
                      <div className="w-full bg-white/5 rounded-t-md relative flex items-end justify-center overflow-hidden h-32">
                        <div
                          className="w-full bg-gradient-to-t from-emerald-600 to-emerald-400 group-hover:from-brand group-hover:to-red-400 transition-all rounded-t-md"
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-zinc-500 truncate w-full text-center">
                        {item.date}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RECENT ALERTS PREVIEW */}
            {stats?.recentAlerts && stats.recentAlerts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Bell className="w-4 h-4 text-amber-400" /> Alertas Recentes do Servidor
                  </h3>
                  <button
                    onClick={() => setActiveSection('alerts')}
                    className="text-xs text-brand hover:underline font-bold"
                  >
                    Ver Todos os Alertas
                  </button>
                </div>
                <div className="space-y-2">
                  {stats.recentAlerts.map((alt: ServerAlert) => (
                    <div
                      key={alt.id}
                      className="bg-black/50 border border-amber-500/20 rounded-xl p-4 flex items-start justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300">
                            {alt.severity}
                          </span>
                          <span className="text-xs font-bold text-white">{alt.title}</span>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {new Date(alt.timestamp).toLocaleTimeString('pt-PT')}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400">{alt.message}</p>
                      </div>
                      {!alt.acknowledged && (
                        <button
                          onClick={() => handleAcknowledgeAlert(alt.id)}
                          className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold shrink-0 transition-all"
                        >
                          Confirmar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================= */}
        {/* SECTION 2: LINKS DE FILMES (MOVIES_LINKS) */}
        {/* ================================================= */}
        {activeSection === 'movies_links' && (
          <div className="space-y-6">
            {/* SEARCH AND FILTERS */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Pesquisar por título, TMDB ID ou URL..."
                  value={movieSearch}
                  onChange={(e) => {
                    setMovieSearch(e.target.value);
                    setMoviePage(1);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && loadMovies()}
                  className="w-full bg-black/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-brand transition-all"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: 'todos', label: 'Todos' },
                  { id: 'online', label: 'Online' },
                  { id: 'offline', label: 'Offline' },
                  { id: 'com_erros', label: 'Com Erros' },
                  { id: 'sem_fontes', label: 'Sem Fontes' },
                  { id: 'nunca_verificados', label: 'Não Verificados' },
                  { id: 'recentes', label: 'Recentes (7d)' },
                  { id: 'antigos', label: 'Antigos (+30d)' }
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setMovieStatusFilter(f.id);
                      setMoviePage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      movieStatusFilter === f.id
                        ? 'bg-brand text-white shadow'
                        : 'bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* MOVIES LIST */}
            {isLoadingMovies ? (
              <div className="py-20 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-brand animate-spin mx-auto" />
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">A carregar catálogo de filmes...</p>
              </div>
            ) : moviesData.items.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-white/10 rounded-2xl space-y-3">
                <Film className="w-10 h-10 text-zinc-600 mx-auto" />
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Nenhum filme encontrado</h4>
                <p className="text-xs text-zinc-500">Tente ajustar o termo de pesquisa ou o filtro selecionado.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {moviesData.items.map((movie: any) => (
                  <div
                    key={movie.id}
                    className="bg-black/40 border border-white/10 hover:border-white/20 rounded-xl p-4 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    {/* POSTER & DETAILS */}
                    <div className="flex items-center gap-4 min-w-0">
                      <img
                        src={movie.posterPath || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=200'}
                        alt={movie.title}
                        className="w-12 h-16 object-cover rounded-lg shrink-0 border border-white/10 bg-zinc-900"
                        onError={(e: any) => { e.target.src = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=200'; }}
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-white text-sm truncate">{movie.title}</h4>
                          <span className="text-[10px] font-mono bg-white/10 text-zinc-300 px-1.5 py-0.5 rounded">
                            {movie.releaseYear || 'N/A'}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500">
                            TMDB #{movie.tmdbId}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              movie.health === 'online'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : movie.health === 'offline'
                                ? 'bg-red-500/20 text-red-400'
                                : movie.health === 'error'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {movie.health.toUpperCase()}
                          </span>

                          <span className="text-zinc-400 text-[11px]">
                            {movie.sourcesCount} {movie.sourcesCount === 1 ? 'fonte' : 'fontes'}
                          </span>

                          {movie.alternativeSourcesCount > 0 && (
                            <span className="text-brand text-[11px] font-bold">
                              +{movie.alternativeSourcesCount} alternativa{movie.alternativeSourcesCount > 1 ? 's' : ''}
                            </span>
                          )}

                          {movie.lastVerifiedAt && (
                            <span className="text-zinc-500 text-[10px] font-mono">
                              Última verificação: {new Date(movie.lastVerifiedAt).toLocaleDateString('pt-PT')}
                            </span>
                          )}
                        </div>

                        {/* PRIMARY URL PREVIEW */}
                        {movie.primarySource && (
                          <p className="text-[11px] font-mono text-zinc-400 truncate max-w-lg">
                            <span className="text-zinc-600">URL:</span> {movie.primarySource.url}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* ACTIONS */}
                    <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                      {movie.primarySource && (
                        <>
                          <button
                            onClick={() => handleCopyUrl(movie.primarySource.url)}
                            className="p-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-lg transition-all"
                            title="Copiar URL"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleVerifySingle(movie.primarySource)}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
                            title="Verificar agora"
                          >
                            <RefreshCw className="w-3 h-3 text-blue-400" />
                            <span>Verificar</span>
                          </button>

                          <button
                            onClick={() => onOpenPlayer?.(movie.tmdbId, 'movie')}
                            className="px-3 py-1.5 bg-brand hover:bg-brand/90 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-brand/20"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Testar Player</span>
                          </button>
                        </>
                      )}

                      <button
                        onClick={() => onEditSources?.(movie.tmdbId, 'movie')}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white rounded-lg text-xs font-bold transition-all"
                      >
                        Gerir Fontes
                      </button>
                    </div>
                  </div>
                ))}

                {/* PAGINATION */}
                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <span className="text-xs text-zinc-500">
                    A exibir {moviesData.items.length} de {moviesData.totalItems} filmes
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={moviePage <= 1}
                      onClick={() => setMoviePage(prev => Math.max(1, prev - 1))}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white text-xs font-bold rounded-lg transition-all"
                    >
                      Anterior
                    </button>
                    <span className="text-xs font-mono text-zinc-400">
                      Página {moviePage} de {moviesData.totalPages || 1}
                    </span>
                    <button
                      disabled={moviePage >= moviesData.totalPages}
                      onClick={() => setMoviePage(prev => prev + 1)}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white text-xs font-bold rounded-lg transition-all"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================= */}
        {/* SECTION 3: LINKS DE SÉRIES (SERIES_LINKS TREE) */}
        {/* ================================================= */}
        {activeSection === 'series_links' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Pesquisar série por nome ou TMDB ID..."
                  value={seriesSearch}
                  onChange={(e) => setSeriesSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadSeries()}
                  className="w-full bg-black/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-brand transition-all"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleStartBatch('series')}
                  disabled={verifyProgress.running}
                  className="px-4 py-2.5 bg-brand hover:bg-brand/90 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  <span>Verificar Todas as Séries</span>
                </button>
              </div>
            </div>

            {/* SERIES HIERARCHICAL TREE */}
            {isLoadingSeries ? (
              <div className="py-20 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-brand animate-spin mx-auto" />
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">A carregar estrutura isolada de séries...</p>
              </div>
            ) : seriesTree.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-white/10 rounded-2xl space-y-3">
                <Tv className="w-10 h-10 text-zinc-600 mx-auto" />
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Nenhuma série registada</h4>
                <p className="text-xs text-zinc-500">Adicione séries pelo importador para organizar temporadas e episódios.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {seriesTree.map((series: any) => {
                  const isSeriesOpen = !!expandedSeries[series.id];
                  return (
                    <div
                      key={series.id}
                      className="bg-black/50 border border-white/10 rounded-xl overflow-hidden transition-all"
                    >
                      {/* SÉRIE HEADER */}
                      <div
                        onClick={() => setExpandedSeries(prev => ({ ...prev, [series.id]: !prev[series.id] }))}
                        className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {isSeriesOpen ? (
                            <ChevronDown className="w-4 h-4 text-brand shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                          )}
                          <img
                            src={series.posterPath || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=200'}
                            alt={series.title}
                            className="w-8 h-12 object-cover rounded shrink-0 bg-zinc-900 border border-white/10"
                            onError={(e: any) => { e.target.src = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=200'; }}
                          />
                          <div className="min-w-0">
                            <h4 className="font-bold text-white text-sm truncate">{series.title}</h4>
                            <p className="text-[11px] text-zinc-400 font-mono">
                              TMDB #{series.tmdbId} · {series.totalSeasons} Temporadas · {series.totalEpisodes} Episódios
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              series.health === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {series.totalSources} Fontes
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditSources?.(series.tmdbId, 'tv');
                            }}
                            className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold"
                          >
                            Gerir Fontes
                          </button>
                        </div>
                      </div>

                      {/* TEMPORADAS TREE */}
                      {isSeriesOpen && (
                        <div className="p-4 pt-0 space-y-3 border-t border-white/5 bg-[#08090C]">
                          {series.seasons?.map((season: any) => {
                            const seasonKey = `${series.id}_s${season.seasonNumber}`;
                            const isSeasonOpen = !!expandedSeasons[seasonKey];
                            return (
                              <div
                                key={seasonKey}
                                className="border border-white/5 rounded-lg overflow-hidden bg-black/40"
                              >
                                {/* TEMPORADA HEADER */}
                                <div
                                  onClick={() => setExpandedSeasons(prev => ({ ...prev, [seasonKey]: !prev[seasonKey] }))}
                                  className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.02]"
                                >
                                  <div className="flex items-center gap-2">
                                    {isSeasonOpen ? (
                                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                                    )}
                                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                                      Temporada {season.seasonNumber}
                                    </span>
                                    <span className="text-[10px] text-zinc-500 font-mono">
                                      ({season.episodesCount} episódios · {season.sourcesCount} fontes)
                                    </span>
                                  </div>

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartBatch('season', String(series.tmdbId));
                                    }}
                                    className="px-2 py-0.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded text-[10px] font-bold"
                                  >
                                    Verificar Temporada
                                  </button>
                                </div>

                                {/* EPISÓDIOS LIST (STRICT ISOLATION) */}
                                {isSeasonOpen && (
                                  <div className="p-3 pt-0 space-y-2 border-t border-white/5">
                                    {season.episodes?.map((ep: any) => (
                                      <div
                                        key={ep.id}
                                        className="p-3 bg-zinc-950/60 border border-white/5 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                      >
                                        <div className="space-y-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <span className="w-5 h-5 rounded bg-brand/20 text-brand text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                                              E{ep.episodeNumber}
                                            </span>
                                            <span className="text-xs font-bold text-white truncate">{ep.title}</span>
                                            <span
                                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${
                                                ep.health === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                                              }`}
                                            >
                                              {ep.health}
                                            </span>
                                          </div>

                                          {ep.primarySource ? (
                                            <p className="text-[10px] font-mono text-zinc-400 truncate max-w-md">
                                              Fonte: {ep.primarySource.url}
                                            </p>
                                          ) : (
                                            <p className="text-[10px] text-red-400/80 italic">Sem fonte associada</p>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                          {ep.primarySource && (
                                            <>
                                              <button
                                                onClick={() => handleVerifySingle(ep.primarySource)}
                                                className="p-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded transition-all"
                                                title="Verificar Fonte"
                                              >
                                                <RefreshCw className="w-3 h-3" />
                                              </button>
                                              <button
                                                onClick={() => onOpenPlayer?.(series.tmdbId, 'tv', season.seasonNumber, ep.episodeNumber)}
                                                className="px-2.5 py-1 bg-brand hover:bg-brand/90 text-white rounded text-[11px] font-bold flex items-center gap-1.5"
                                              >
                                                <Play className="w-3 h-3 fill-current" />
                                                <span>Reproduzir</span>
                                              </button>
                                            </>
                                          )}
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
            )}
          </div>
        )}

        {/* ================================================= */}
        {/* SECTION 4: MONITORIZAÇÃO EM TEMPO REAL */}
        {/* ================================================= */}
        {activeSection === 'monitoring' && (
          <div className="space-y-6">
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6 space-y-6">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand animate-pulse" /> Motor de Sondagem em Tempo Real
              </h3>
              <p className="text-xs text-zinc-400">
                O motor executa testes de integridade diretos respeitando o limite de concorrência configurado para evitar bloqueios de rede.
              </p>

              {/* ACTION BUTTONS */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => handleStartBatch('all')}
                  disabled={verifyProgress.running}
                  className="px-5 py-3 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-brand/20"
                >
                  <Zap className="w-4 h-4" />
                  <span>Verificar Todo o Catálogo</span>
                </button>

                <button
                  onClick={() => handleStartBatch('movies')}
                  disabled={verifyProgress.running}
                  className="px-4 py-3 bg-[#1A1D24] hover:bg-[#222731] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all border border-white/10 flex items-center gap-2"
                >
                  <Film className="w-4 h-4 text-brand" />
                  <span>Verificar Apenas Filmes</span>
                </button>

                <button
                  onClick={() => handleStartBatch('series')}
                  disabled={verifyProgress.running}
                  className="px-4 py-3 bg-[#1A1D24] hover:bg-[#222731] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all border border-white/10 flex items-center gap-2"
                >
                  <Tv className="w-4 h-4 text-purple-400" />
                  <span>Verificar Apenas Séries</span>
                </button>

                {verifyProgress.running && (
                  <button
                    onClick={handleCancelBatch}
                    className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2"
                  >
                    <StopCircle className="w-4 h-4" />
                    <span>Parar Verificação</span>
                  </button>
                )}
              </div>

              {/* STATUS CARD */}
              <div className="bg-black/60 border border-white/10 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Estado da Fila</span>
                  <span
                    className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      verifyProgress.status === 'RUNNING'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : verifyProgress.status === 'COMPLETED'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {verifyProgress.status}
                  </span>
                </div>

                {verifyProgress.running && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-zinc-400">Progresso:</span>
                      <span className="text-white font-bold">
                        {verifyProgress.processed} / {verifyProgress.total} ({verifyProgress.total > 0 ? Math.round((verifyProgress.processed / verifyProgress.total) * 100) : 0}%)
                      </span>
                    </div>
                    <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden border border-white/10">
                      <div
                        className="h-full bg-brand rounded-full transition-all duration-300"
                        style={{ width: `${verifyProgress.total > 0 ? (verifyProgress.processed / verifyProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="text-[11px] font-mono text-zinc-400 truncate">
                      <span className="text-zinc-600">Alvo Atual:</span> {verifyProgress.currentItemTitle} ({verifyProgress.currentUrl})
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* SECTIONS 5-9: FONTES ONLINE, OFFLINE, ERRO, RECENTES, ANTIGAS */}
        {/* ================================================= */}
        {['sources_online', 'sources_offline', 'sources_error', 'links_recent', 'links_old'].includes(activeSection) && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  {activeSection === 'sources_online' ? 'Fontes Online Operacionais'
                    : activeSection === 'sources_offline' ? 'Fontes Offline / Inacessíveis'
                    : activeSection === 'sources_error' ? 'Fontes com Erro de Formato / Bloqueadas'
                    : activeSection === 'links_recent' ? 'Links Cadastrados Recentemente (Últimos 7 dias)'
                    : 'Links Antigos (+30 dias)'}
                </h3>
                <p className="text-xs text-zinc-500">Total encontrado: {filteredSources.length} fontes</p>
              </div>

              <button
                onClick={() => {
                  const key = activeSection === 'sources_online' ? 'online'
                    : activeSection === 'sources_offline' ? 'offline'
                    : activeSection === 'sources_error' ? 'error'
                    : activeSection === 'links_recent' ? 'recent' : 'old';
                  loadFilteredSources(key);
                }}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Atualizar</span>
              </button>
            </div>

            {isLoadingFiltered ? (
              <div className="py-20 text-center">
                <RefreshCw className="w-8 h-8 text-brand animate-spin mx-auto mb-2" />
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">A carregar fontes...</p>
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-white/10 rounded-2xl space-y-2">
                <CheckCircle2 className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Nenhuma fonte encontrada nesta categoria.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredSources.map((src: any) => (
                  <div
                    key={src.id}
                    className="bg-black/40 border border-white/10 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white truncate">{src.mediaTitle}</span>
                        <span className="text-[10px] font-mono text-zinc-500">TMDB #{src.tmdbId}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            src.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {src.status}
                        </span>
                        {src.latencyMs && (
                          <span className="text-[10px] font-mono text-zinc-400">{src.latencyMs}ms</span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-zinc-400 truncate max-w-xl">{src.url}</p>
                      {src.lastVerificationMessage && (
                        <p className="text-[10px] text-zinc-500 italic">{src.lastVerificationMessage}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        onClick={() => handleCopyUrl(src.url)}
                        className="p-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded"
                        title="Copiar URL"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleVerifySingle(src)}
                        className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 rounded text-xs font-bold flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Verificar</span>
                      </button>
                      <button
                        onClick={() => onOpenPlayer?.(src.tmdbId, src.type === 'tv' ? 'tv' : 'movie', src.season, src.episode)}
                        className="px-2.5 py-1 bg-brand hover:bg-brand/90 text-white rounded text-xs font-bold flex items-center gap-1.5"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Testar</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================================================= */}
        {/* SECTION 10: HISTÓRICO DE VERIFICAÇÕES */}
        {/* ================================================= */}
        {activeSection === 'check_history' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-brand" /> Histórico Auditado de Verificações
                </h3>
                <p className="text-xs text-zinc-500">Registo persistente de testes e sondagens executadas</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await api.clearVerificationsHistory();
                    setHistoryRecords([]);
                    showToast('Histórico limpo.', 'info');
                  }}
                  className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-bold"
                >
                  Limpar Histórico
                </button>
                <button
                  onClick={loadHistory}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Atualizar</span>
                </button>
              </div>
            </div>

            {isLoadingHistory ? (
              <div className="py-20 text-center">
                <RefreshCw className="w-8 h-8 text-brand animate-spin mx-auto mb-2" />
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">A carregar histórico...</p>
              </div>
            ) : historyRecords.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-white/10 rounded-2xl">
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Nenhum registo de verificação guardado.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 text-zinc-400 uppercase text-[10px] tracking-wider font-bold">
                    <tr>
                      <th className="py-3 px-3">Data/Hora</th>
                      <th className="py-3 px-3">Conteúdo</th>
                      <th className="py-3 px-3">Formato</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Latência</th>
                      <th className="py-3 px-3">Mensagem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono">
                    {historyRecords.map(rec => (
                      <tr key={rec.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-3 text-zinc-500 text-[11px]">
                          {new Date(rec.verifiedAt).toLocaleString('pt-PT')}
                        </td>
                        <td className="py-3 px-3 text-white font-sans font-bold">
                          {rec.mediaTitle} {rec.seasonNumber !== undefined ? `(S${rec.seasonNumber}E${rec.episodeNumber})` : ''}
                        </td>
                        <td className="py-3 px-3 text-zinc-400 uppercase text-[10px]">
                          {rec.sourceKind}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              rec.health === 'online'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : rec.health === 'offline'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-amber-500/20 text-amber-400'
                            }`}
                          >
                            {rec.health}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-zinc-300">
                          {rec.latencyMs ? `${rec.latencyMs} ms` : '—'}
                        </td>
                        <td className="py-3 px-3 text-zinc-400 font-sans truncate max-w-xs">
                          {rec.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================================================= */}
        {/* SECTION 11: ALERTAS DO SERVIDOR */}
        {/* ================================================= */}
        {activeSection === 'alerts' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-400" /> Alertas do Servidor & Falhas Críticas
                </h3>
                <p className="text-xs text-zinc-500">Notificações automáticas de transição e indisponibilidade</p>
              </div>

              {alerts.length > 0 && (
                <button
                  onClick={handleClearAlerts}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold"
                >
                  Limpar Todos
                </button>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-white/10 rounded-2xl space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Nenhum alerta ativo</h4>
                <p className="text-xs text-zinc-500">Todas as fontes e limites do servidor operam normalmente.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map(alt => (
                  <div
                    key={alt.id}
                    className={`border rounded-xl p-4 flex items-start justify-between gap-4 ${
                      alt.acknowledged
                        ? 'bg-black/30 border-white/5 opacity-60'
                        : alt.severity === 'CRITICAL' || alt.severity === 'HIGH'
                        ? 'bg-red-950/20 border-red-500/30'
                        : 'bg-amber-950/20 border-amber-500/30'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            alt.severity === 'CRITICAL' ? 'bg-red-500 text-white' : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {alt.severity}
                        </span>
                        <h4 className="font-bold text-white text-xs">{alt.title}</h4>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {new Date(alt.timestamp).toLocaleString('pt-PT')}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300">{alt.message}</p>
                    </div>

                    {!alt.acknowledged && (
                      <button
                        onClick={() => handleAcknowledgeAlert(alt.id)}
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold shrink-0 transition-all"
                      >
                        Confirmar Leitura
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================================================= */}
        {/* SECTION 12: RELATÓRIOS E EXPORTAÇÃO */}
        {/* ================================================= */}
        {activeSection === 'reports' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Exportação de Relatórios de Fontes
              </h3>
              <p className="text-xs text-zinc-500">Exporte os dados completos do servidor para análise offline</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-black/40 border border-white/10 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Exportar para CSV (Excel)</h4>
                    <p className="text-[11px] text-zinc-400">Planilha estruturada com BOM UTF-8 compatível</p>
                  </div>
                </div>
                <a
                  href={`/api/admin/server/export/csv?auth=${localStorage.getItem('admin_token') || ''}`}
                  download="ronycine_fontes_export.csv"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40"
                >
                  <Download className="w-4 h-4" />
                  <span>Descarregar Ficheiro CSV</span>
                </a>
              </div>

              <div className="bg-black/40 border border-white/10 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                    <FileCode className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Exportar para JSON Completo</h4>
                    <p className="text-[11px] text-zinc-400">Objetos estruturados com metadados para desenvolvedores</p>
                  </div>
                </div>
                <a
                  href={`/api/admin/server/export/json?auth=${localStorage.getItem('admin_token') || ''}`}
                  download="ronycine_fontes_export.json"
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-950/40"
                >
                  <Download className="w-4 h-4" />
                  <span>Descarregar Ficheiro JSON</span>
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* SECTION 13: BACKUP & RESTAURAÇÃO ZIP */}
        {/* ================================================= */}
        {activeSection === 'backup_restore' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <FolderArchive className="w-4 h-4 text-amber-400" /> Sistema Profissional de Backup & Restauração ZIP
              </h3>
              <p className="text-xs text-zinc-500">
                Gere e restaure pacotes ZIP completos com manifest.json, verificação de integridade SHA-256 e snapshot de segurança automático.
              </p>
            </div>

            {/* GENERATE ZIP CARD */}
            <div className="bg-gradient-to-r from-black/60 to-zinc-950 border border-white/10 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300">
                  EXPORTAÇÃO CERTIFICADA
                </span>
                <h4 className="font-bold text-white text-base">Gerar Arquivo RONYCINE_BACKUP.zip</h4>
                <p className="text-xs text-zinc-400 max-w-xl">
                  Empacota filmes, séries, fontes, configurações de aplicação, configurações de servidor e registos de desenvolvedores com hashes criptográficos SHA-256 para cada arquivo.
                </p>
              </div>

              <button
                onClick={handleDownloadZipBackup}
                disabled={isGeneratingZip}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shrink-0 shadow-xl shadow-amber-500/20 active:scale-95"
              >
                {isGeneratingZip ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>A Empacotar...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Descarregar Backup ZIP</span>
                  </>
                )}
              </button>
            </div>

            {/* RESTORE ZIP UPLOAD ZONE */}
            <div className="bg-black/40 border border-white/10 rounded-xl p-6 space-y-6">
              <h4 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                <Upload className="w-4 h-4 text-brand" /> Restaurar a partir de Arquivo ZIP
              </h4>

              <div className="border-2 border-dashed border-white/10 hover:border-brand/40 rounded-xl p-8 text-center transition-all bg-black/20">
                <input
                  type="file"
                  id="zip-upload-input"
                  accept=".zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleZipFileSelected(file);
                  }}
                  className="hidden"
                />
                <label htmlFor="zip-upload-input" className="cursor-pointer space-y-3 block">
                  <FolderArchive className="w-10 h-10 text-brand mx-auto" />
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-white uppercase tracking-wider block">
                      {zipRestoreFile ? zipRestoreFile.name : 'Clique para selecionar o ficheiro RONYCINE_BACKUP.zip'}
                    </span>
                    <span className="text-[11px] text-zinc-500 block">Formato ZIP com manifest.json</span>
                  </div>
                </label>
              </div>

              {/* ZIP PREVIEW & CONFLICTS */}
              {isInspectingZip && (
                <div className="py-6 text-center space-y-2">
                  <RefreshCw className="w-6 h-6 text-brand animate-spin mx-auto" />
                  <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">A validar integridade do ficheiro ZIP...</p>
                </div>
              )}

              {zipPreview && (
                <div className="bg-[#0C0E14] border border-white/10 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase tracking-wider">
                      <CheckCircle2 className="w-4 h-4" /> Arquivo Validado e Íntegro
                    </span>
                    <span className="text-[11px] font-mono text-zinc-500">
                      Gerado em: {new Date(zipPreview.manifest?.generatedAt).toLocaleString('pt-PT')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-black/40 border border-white/5 rounded-lg p-3">
                      <span className="text-[10px] text-zinc-500 block uppercase">Filmes</span>
                      <span className="text-base font-bold text-white font-mono">{zipPreview.summary?.movies ?? 0}</span>
                    </div>
                    <div className="bg-black/40 border border-white/5 rounded-lg p-3">
                      <span className="text-[10px] text-zinc-500 block uppercase">Séries</span>
                      <span className="text-base font-bold text-white font-mono">{zipPreview.summary?.series ?? 0}</span>
                    </div>
                    <div className="bg-black/40 border border-white/5 rounded-lg p-3">
                      <span className="text-[10px] text-zinc-500 block uppercase">Fontes</span>
                      <span className="text-base font-bold text-white font-mono">{zipPreview.summary?.playerSources ?? 0}</span>
                    </div>
                    <div className="bg-black/40 border border-white/5 rounded-lg p-3">
                      <span className="text-[10px] text-zinc-500 block uppercase">Integridade SHA-256</span>
                      <span className="text-base font-bold text-emerald-400 font-mono">100% OK</span>
                    </div>
                  </div>

                  {/* SELECTIVE RESTORATION CHECKBOXES */}
                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <span className="text-xs font-bold text-white uppercase tracking-wider block">
                      Seleção de Componentes para Restaurar:
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { key: 'catalog', label: 'Catálogo (Filmes e Séries)' },
                        { key: 'sources', label: 'Fontes de Reprodução' },
                        { key: 'settings', label: 'Configurações' },
                        { key: 'developers', label: 'Projetos de Devs' }
                      ].map(item => (
                        <label key={item.key} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(selectiveRestore as any)[item.key]}
                            onChange={(e) => setSelectiveRestore(prev => ({ ...prev, [item.key]: e.target.checked }))}
                            className="rounded bg-black border-white/20 text-brand focus:ring-brand"
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* CONFIRM RESTORE BUTTON */}
                  <div className="pt-2 flex items-center justify-between">
                    <p className="text-[10px] text-zinc-500 italic">
                      * Um snapshot de emergência será gerado automaticamente antes de qualquer substituição.
                    </p>
                    <button
                      onClick={handleExecuteZipRestore}
                      disabled={isRestoringZip}
                      className="px-6 py-2.5 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-brand/20"
                    >
                      {isRestoringZip ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>A Restaurar...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Confirmar e Restaurar</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* RESTORE RESULT NOTICE */}
              {restoreResult && (
                <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-5 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Restauração Concluída com Sucesso!</span>
                  </div>
                  <p className="text-xs text-zinc-300">
                    Foram restaurados {restoreResult.restored?.movies} filmes, {restoreResult.restored?.series} séries e {restoreResult.restored?.sources} fontes.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* SECTION 14: CONFIGURAÇÕES DO SERVIDOR */}
        {/* ================================================= */}
        {activeSection === 'server_settings' && (
          <form onSubmit={handleSaveSettings} className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-4 h-4 text-brand" /> Configurações Avançadas do Servidor
              </h3>
              <p className="text-xs text-zinc-500">Ajuste os parâmetros de concorrência, limites de timeout e alertas</p>
            </div>

            {settingsData && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <label className="text-zinc-300 font-bold uppercase tracking-wider text-[11px]">
                      Concorrência Máxima de Sondagens (1 a 8)
                    </label>
                    <span className="font-mono text-brand font-bold">{settingsData.maxConcurrentProbes} processos</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="8"
                    value={settingsData.maxConcurrentProbes}
                    onChange={(e) => setSettingsData({ ...settingsData, maxConcurrentProbes: Number(e.target.value) })}
                    className="w-full accent-brand"
                  />
                  <p className="text-[10px] text-zinc-500">Número de checagens de URL disparadas simultaneamente na fila.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-zinc-300 font-bold uppercase tracking-wider text-[11px] block">
                    Timeout da Sondagem (Milissegundos)
                  </label>
                  <input
                    type="number"
                    min="2000"
                    max="30000"
                    step="500"
                    value={settingsData.probeTimeoutMs}
                    onChange={(e) => setSettingsData({ ...settingsData, probeTimeoutMs: Number(e.target.value) })}
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-brand font-mono"
                  />
                  <p className="text-[10px] text-zinc-500">Tempo limite para conexão e leitura de bytes de cabeçalho (recomendado: 6500ms).</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-zinc-300 font-bold uppercase tracking-wider text-[11px] block">
                    Intervalo de Auto-Verificação (Horas)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={settingsData.autoVerifyIntervalHours}
                    onChange={(e) => setSettingsData({ ...settingsData, autoVerifyIntervalHours: Number(e.target.value) })}
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-brand font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-zinc-300 font-bold uppercase tracking-wider text-[11px] block">
                    Disparar Alerta após Falhas Consecutivas
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={settingsData.alertConsecutiveFailsThreshold}
                    onChange={(e) => setSettingsData({ ...settingsData, alertConsecutiveFailsThreshold: Number(e.target.value) })}
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-brand font-mono"
                  />
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-3 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settingsData.autoVerifyEnabled}
                      onChange={(e) => setSettingsData({ ...settingsData, autoVerifyEnabled: e.target.checked })}
                      className="rounded bg-black border-white/20 text-brand focus:ring-brand"
                    />
                    <span className="font-bold">Ativar monitorização automática em background</span>
                  </label>
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="px-6 py-3 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-brand/20"
                  >
                    {isSavingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    <span>Guardar Configurações</span>
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
