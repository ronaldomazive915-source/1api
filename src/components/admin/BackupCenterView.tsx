import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Clock,
  HardDrive,
  FileArchive,
  FileSpreadsheet,
  FileJson,
  FileText,
  Film,
  Tv,
  Layers,
  X,
  Play,
  Pause
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  BackupExportMode,
  BackupFormat,
  BackupConflictMode,
  BackupImportFilter,
  BackupRecord,
  BackupImportPreview,
  BackupImportJob,
  BackupSystemStatus
} from '../../types.js';

type ActiveSection = 'export' | 'import' | 'history' | 'status';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDatePt(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-PT');
  } catch {
    return iso;
  }
}

export const BackupCenterView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<ActiveSection>('export');

  // Lists & status
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [systemStatus, setSystemStatus] = useState<BackupSystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Export state
  const [exportMode, setExportMode] = useState<BackupExportMode>('full');
  const [exportFormat, setExportFormat] = useState<BackupFormat>('zip');
  const [exporting, setExporting] = useState(false);
  const [lastGeneratedDownload, setLastGeneratedDownload] = useState<{
    backup: BackupRecord;
    downloadUrl: string;
  } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<BackupImportPreview | null>(null);
  const [conflictMode, setConflictMode] = useState<BackupConflictMode>('merge_new_links');
  const [activeImportJob, setActiveImportJob] = useState<BackupImportJob | null>(null);
  const [importJobsHistory, setImportJobsHistory] = useState<BackupImportJob[]>([]);

  // Inline confirm state (never uses window.confirm/alert)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'restore' | 'delete';
    backup: BackupRecord;
  } | null>(null);

  // System auto-backup config state
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [autoHours, setAutoHours] = useState(24);
  const [savingConfig, setSavingConfig] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [backupsRes, statusRes, jobsRes] = await Promise.all([
        api.getAdminBackups(),
        api.getBackupSystemStatus(),
        api.getBackupImportJobs().catch(() => ({ success: true, jobs: [] }))
      ]);
      setBackups(backupsRes.backups || []);
      if (statusRes?.status) {
        setSystemStatus(statusRes.status);
        setAutoEnabled(Boolean(statusRes.status.autoBackupEnabled));
        setAutoHours(Number(statusRes.status.autoBackupIntervalHours || 24));
      }
      if (Array.isArray(jobsRes?.jobs)) {
        setImportJobsHistory(jobsRes.jobs);
        const running = jobsRes.jobs.find(j => j.status === 'RUNNING' || j.status === 'PENDING');
        if (running && !activeImportJob) {
          setActiveImportJob(running);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar dados do Backup Center.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Poll active import job progress
  useEffect(() => {
    if (!activeImportJob || (activeImportJob.status !== 'RUNNING' && activeImportJob.status !== 'PENDING')) {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await api.getBackupImportJob(activeImportJob.jobId);
        if (res?.job) {
          setActiveImportJob(res.job);
          if (res.job.status !== 'RUNNING' && res.job.status !== 'PENDING') {
            if (res.job.status === 'COMPLETED') {
              setNotice(
                `Importação concluída: ${res.job.importedMovies} filme(s), ${res.job.importedSeries} série(s), ${res.job.importedEpisodes} episódio(s), ${res.job.importedSources} link(s).`
              );
            }
            loadAll();
          }
        }
      } catch {
        // ignore transient poll error
      }
    }, 700);
    return () => clearInterval(timer);
  }, [activeImportJob]);

  // --- EXPORT HANDLERS ---
  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.exportBackupArchive(exportMode, exportFormat);
      setLastGeneratedDownload({
        backup: res.backup,
        downloadUrl: res.downloadUrl
      });
      setNotice(
        `Backup "${res.backup.filename}" gerado (${formatBytes(res.backup.sizeBytes)}). A iniciar download...`
      );
      api.triggerSignedFileDownload(res.downloadUrl, res.backup.filename);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Erro ao gerar backup.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadRecord = async (backup: BackupRecord) => {
    setDownloadingId(backup.id);
    setError(null);
    try {
      const res = await api.getBackupDownloadToken(backup.id);
      api.triggerSignedFileDownload(res.downloadUrl, res.filename || backup.filename);
      setNotice(`Download iniciado: ${res.filename || backup.filename}`);
    } catch (err: any) {
      setError(err?.message || 'Erro ao gerar token de download.');
    } finally {
      setDownloadingId(null);
    }
  };

  // --- IMPORT HANDLERS ---
  const processSelectedFile = async (file: File) => {
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      const res = await api.analyzeBackupFile(file);
      setPreview(res.preview);
      if (res.preview.errors.length > 0 && res.preview.summary.moviesTotal + res.preview.summary.seriesTotal === 0) {
        setError(res.preview.errors[0]);
      } else {
        setNotice(
          `Ficheiro "${res.preview.filename}" analisado (${res.preview.detectedFormat.toUpperCase()}) com ${
            res.preview.summary.moviesTotal
          } filme(s) e ${res.preview.summary.seriesTotal} série(s).`
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Ficheiro inválido, não suportado ou corrompido.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processSelectedFile(file);
    e.target.value = '';
  };

  const handleStartImport = async (filter: BackupImportFilter) => {
    if (!preview?.uploadToken) return;
    setError(null);
    setNotice(null);
    try {
      const res = await api.startBackupImport({
        uploadToken: preview.uploadToken,
        filter,
        conflictMode
      });
      setActiveImportJob(res.job);
      setPreview(null);
    } catch (err: any) {
      setError(err?.message || 'Erro ao iniciar importação do backup.');
    }
  };

  const handleCancelImport = async (jobId: string) => {
    try {
      const res = await api.cancelBackupImportJob(jobId);
      setActiveImportJob(res.job);
    } catch (err: any) {
      setError(err?.message || 'Erro ao cancelar importação.');
    }
  };

  const handleResumeImport = async (jobId: string) => {
    try {
      const res = await api.resumeBackupImportJob(jobId);
      setActiveImportJob(res.job);
    } catch (err: any) {
      setError(err?.message || 'Erro ao retomar importação.');
    }
  };

  // --- HISTORY ACTIONS ---
  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { type, backup } = confirmAction;
    setConfirmAction(null);
    setError(null);
    setNotice(null);

    if (type === 'delete') {
      try {
        await api.deleteAdminBackup(backup.id);
        setNotice(`Backup "${backup.filename}" eliminado.`);
        await loadAll();
      } catch (err: any) {
        setError(err?.message || 'Erro ao eliminar backup.');
      }
      return;
    }

    if (type === 'restore') {
      try {
        const res = await api.restoreAdminBackup(backup.id, 'merge_new_links');
        if (res.job) {
          setActiveImportJob(res.job);
          setActiveSection('import');
          setNotice('Restauração iniciada com snapshot automático de rollback.');
        } else {
          setNotice('Backup restaurado com sucesso.');
        }
        await loadAll();
      } catch (err: any) {
        setError(err?.message || 'Erro ao restaurar backup.');
      }
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.updateBackupConfig({
        autoBackupEnabled: autoEnabled,
        autoBackupIntervalHours: autoHours
      });
      if (res?.status) setSystemStatus(res.status);
      setNotice('Configurações de backup automático guardadas.');
    } catch (err: any) {
      setError(err?.message || 'Erro ao guardar configurações.');
    } finally {
      setSavingConfig(false);
    }
  };

  const sections: Array<{ id: ActiveSection; label: string; icon: React.ReactNode }> = [
    { id: 'export', label: 'Exportar Backup', icon: <Download className="w-4 h-4" /> },
    { id: 'import', label: 'Importar Backup', icon: <Upload className="w-4 h-4" /> },
    { id: 'history', label: `Histórico (${backups.length})`, icon: <Clock className="w-4 h-4" /> },
    { id: 'status', label: 'Estado do Sistema', icon: <HardDrive className="w-4 h-4" /> }
  ];

  const formatOptions: Array<{
    id: BackupFormat;
    label: string;
    desc: string;
    icon: React.ReactNode;
    recommended?: boolean;
  }> = [
    {
      id: 'zip',
      label: 'ZIP (Pacote)',
      desc: 'Manifest + JSONs estruturados',
      icon: <FileArchive className="w-4 h-4" />,
      recommended: true
    },
    {
      id: 'json',
      label: 'JSON',
      desc: 'Estrutura integral legível',
      icon: <FileJson className="w-4 h-4" />
    },
    {
      id: 'csv',
      label: 'CSV (Excel PT)',
      desc: 'Tabela UTF-8 com BOM',
      icon: <FileText className="w-4 h-4" />
    },
    {
      id: 'xlsx',
      label: 'XLSX (Excel)',
      desc: 'Folhas separadas por entidade',
      icon: <FileSpreadsheet className="w-4 h-4" />
    }
  ];

  return (
    <div className="space-y-6 text-white pb-16">
      {/* HEADER */}
      <div className="bg-[#0D0F15] border border-white/10 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#E50914] mb-1">
            <Database className="w-4 h-4" />
            <span>RONYCINE Security & Portability</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight font-display">
            Backup Center Pro Max
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Exportação compatível com Chrome Android & Desktop (ZIP, JSON, CSV, XLSX), importação inteligente e rollback seguro.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAll}
          disabled={loading}
          className="px-4 py-2.5 min-h-[44px] bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-zinc-200 flex items-center justify-center gap-2 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#E50914]' : ''}`} />
          <span>Atualizar Estado</span>
        </button>
      </div>

      {/* SECTION TABS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {sections.map(sec => {
          const active = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveSection(sec.id)}
              className={`min-h-[46px] px-4 py-2.5 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                active
                  ? 'bg-[#E50914] border-[#E50914] text-white shadow-lg shadow-[#E50914]/25'
                  : 'bg-[#0D0F15] border-white/10 text-zinc-300 hover:border-white/25 hover:text-white'
              }`}
            >
              {sec.icon}
              <span className="truncate">{sec.label}</span>
            </button>
          );
        })}
      </div>

      {/* BANNERS */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/35 border border-red-500/40 text-red-200 text-xs flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-red-300 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {notice && (
        <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/35 text-emerald-200 text-xs flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-300 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* --- SECTION 1: EXPORTAR BACKUP --- */}
      {activeSection === 'export' && (
        <div className="bg-[#0D0F15] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="text-sm font-black uppercase tracking-wider text-white">1. Modo de Backup</h3>
            <p className="text-xs text-zinc-400">
              Senhas, hashes, API Keys e tokens secretos nunca são exportados em texto claro por segurança.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <button
              type="button"
              onClick={() => setExportMode('full')}
              className={`p-4 rounded-2xl border text-left transition-all ${
                exportMode === 'full'
                  ? 'bg-[#E50914]/15 border-[#E50914] text-white'
                  : 'bg-[#080808] border-white/10 text-zinc-300 hover:border-white/25'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <strong className="text-sm font-black uppercase">Backup Completo</strong>
                <ShieldCheck className={`w-4 h-4 ${exportMode === 'full' ? 'text-[#E50914]' : 'text-zinc-500'}`} />
              </div>
              <p className="text-xs text-zinc-400">
                Catálogo completo (filmes, séries, temporadas, episódios), fontes de vídeo, modelos de temporada, configurações e planos seguros.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setExportMode('catalog')}
              className={`p-4 rounded-2xl border text-left transition-all ${
                exportMode === 'catalog'
                  ? 'bg-[#E50914]/15 border-[#E50914] text-white'
                  : 'bg-[#080808] border-white/10 text-zinc-300 hover:border-white/25'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <strong className="text-sm font-black uppercase">Backup do Catálogo</strong>
                <Layers className={`w-4 h-4 ${exportMode === 'catalog' ? 'text-[#E50914]' : 'text-zinc-500'}`} />
              </div>
              <p className="text-xs text-zinc-400">
                Apenas filmes, séries, temporadas, episódios e respetivos links/fontes de reprodução para migração rápida.
              </p>
            </button>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-black uppercase tracking-wider text-white">2. Formato do Ficheiro</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {formatOptions.map(fmt => {
                const selected = exportFormat === fmt.id;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setExportFormat(fmt.id)}
                    className={`p-4 min-h-[74px] rounded-xl border text-left transition-all ${
                      selected
                        ? 'bg-[#E50914]/15 border-[#E50914] text-white'
                        : 'bg-[#080808] border-white/10 text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs font-black uppercase">
                        {fmt.icon}
                        {fmt.label}
                      </span>
                      {fmt.recommended && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold uppercase">
                          Rec.
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1">{fmt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="w-full sm:w-auto min-h-[48px] px-7 py-3 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl flex items-center justify-center gap-2.5 shadow-lg shadow-[#E50914]/25"
            >
              {exporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{exporting ? 'A gerar ficheiro de backup...' : 'DESCARREGAR BACKUP'}</span>
            </button>

            {lastGeneratedDownload && (
              <a
                href={lastGeneratedDownload.downloadUrl}
                download={lastGeneratedDownload.backup.filename}
                className="w-full sm:w-auto min-h-[48px] px-5 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 text-xs font-bold rounded-xl flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Descarregar novamente ({formatBytes(lastGeneratedDownload.backup.sizeBytes)})</span>
              </a>
            )}
          </div>
        </div>
      )}

      {/* --- SECTION 2: IMPORTAR BACKUP --- */}
      {activeSection === 'import' && (
        <div className="space-y-6">
          {/* Active Async Import Progress */}
          {activeImportJob && (
            <div className="bg-[#0D0F15] border border-white/15 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#E50914] block">
                    Tarefa de Importação · {activeImportJob.status}
                  </span>
                  <h3 className="text-sm font-black text-white">
                    {activeImportJob.filename} ({activeImportJob.format.toUpperCase()})
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {(activeImportJob.status === 'RUNNING' || activeImportJob.status === 'PENDING') && (
                    <button
                      type="button"
                      onClick={() => handleCancelImport(activeImportJob.jobId)}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-xs font-bold flex items-center gap-1.5"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Cancelar</span>
                    </button>
                  )}
                  {activeImportJob.status === 'CANCELLED' && (
                    <button
                      type="button"
                      onClick={() => handleResumeImport(activeImportJob.jobId)}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Retomar</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="text-zinc-300">{activeImportJob.currentStep}</span>
                  <span className="font-mono text-zinc-400">
                    {activeImportJob.processedOperations} / {Math.max(1, activeImportJob.totalOperations)}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#E50914] transition-all duration-200"
                    style={{
                      width: `${Math.round(
                        (activeImportJob.processedOperations / Math.max(1, activeImportJob.totalOperations)) * 100
                      )}%`
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs tabular-nums">
                <div className="p-2.5 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Filmes</span>
                  <strong className="text-white">+{activeImportJob.importedMovies} / ↻{activeImportJob.updatedMovies}</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Séries</span>
                  <strong className="text-white">+{activeImportJob.importedSeries} / ↻{activeImportJob.updatedSeries}</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Episódios</span>
                  <strong className="text-blue-400">{activeImportJob.importedEpisodes}</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Links</span>
                  <strong className="text-emerald-400">{activeImportJob.importedSources}</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Ignorados</span>
                  <strong className="text-zinc-300">{activeImportJob.skippedCount}</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Erros</span>
                  <strong className={activeImportJob.errorCount > 0 ? 'text-red-400' : 'text-zinc-400'}>
                    {activeImportJob.errorCount}
                  </strong>
                </div>
              </div>

              {activeImportJob.rollbackBackupId && (
                <div className="text-[11px] text-emerald-300 bg-emerald-950/25 border border-emerald-500/25 rounded-xl px-3 py-2 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>
                    Snapshot automático de rollback criado antes da importação (ID: <code className="font-mono">{activeImportJob.rollbackBackupId}</code>). Disponível no Histórico.
                  </span>
                </div>
              )}

              {activeImportJob.recentErrors.length > 0 && (
                <div className="text-[11px] text-red-300 bg-red-950/25 border border-red-500/30 rounded-xl p-3 max-h-32 overflow-y-auto space-y-1">
                  {activeImportJob.recentErrors.map((errMsg, idx) => (
                    <div key={idx}>• {errMsg}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Upload Zone */}
          <div
            onDragOver={e => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={e => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) processSelectedFile(file);
            }}
            className={`bg-[#0D0F15] border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
              dragActive ? 'border-[#E50914] bg-[#E50914]/10' : 'border-white/15 hover:border-white/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.json,.csv,.xlsx"
              onChange={handleFileChange}
              className="hidden"
            />
            <Upload className="w-10 h-10 text-[#E50914] mx-auto mb-3" />
            <h3 className="text-base font-black uppercase text-white">Selecionar Ficheiro de Backup</h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
              Compatível com backups exportados do RONYCINE ou ficheiros externos em <strong className="text-zinc-200">ZIP, JSON, CSV ou XLSX</strong>. O sistema valida e pré-analisa antes de modificar a base de dados.
            </p>
            <button
              type="button"
              disabled={analyzing}
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 min-h-[46px] px-6 py-3 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl inline-flex items-center gap-2"
            >
              {analyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>{analyzing ? 'A analisar ficheiro...' : 'Escolher Ficheiro (ZIP / JSON / CSV / XLSX)'}</span>
            </button>
          </div>

          {/* PRE-IMPORT PREVIEW: BACKUP DETETADO */}
          {preview && (
            <div className="bg-[#0D0F15] border border-white/15 rounded-2xl p-5 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block">
                    BACKUP DETETADO
                  </span>
                  <h3 className="text-lg font-black text-white">
                    {preview.filename} ({formatBytes(preview.sizeBytes)})
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase">
                  <span className="px-2.5 py-1 rounded-lg bg-white/10 text-zinc-200">
                    {preview.detectedFormat}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-300">
                    {preview.detectedMode}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs tabular-nums">
                <div className="p-3 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Filmes</span>
                  <strong className="text-lg font-black text-white">{preview.summary.moviesTotal}</strong>
                  <span className="block text-[10px] text-zinc-400">
                    {preview.summary.newMovies} novos · {preview.summary.existingMovies} existentes
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Séries</span>
                  <strong className="text-lg font-black text-white">{preview.summary.seriesTotal}</strong>
                  <span className="block text-[10px] text-zinc-400">
                    {preview.summary.newSeries} novas · {preview.summary.existingSeries} existentes
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Temporadas</span>
                  <strong className="text-lg font-black text-purple-400">{preview.summary.seasonsTotal}</strong>
                </div>
                <div className="p-3 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Episódios</span>
                  <strong className="text-lg font-black text-blue-400">{preview.summary.episodesTotal}</strong>
                </div>
                <div className="p-3 rounded-xl bg-[#080808] border border-white/10">
                  <span className="text-[10px] text-zinc-500 uppercase block">Fontes / Links</span>
                  <strong className="text-lg font-black text-emerald-400">{preview.summary.sourcesTotal}</strong>
                  <span className="block text-[10px] text-zinc-400">
                    {preview.summary.newSources} novos · {preview.summary.duplicateSources} dupl.
                  </span>
                </div>
              </div>

              {preview.warnings.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 space-y-1">
                  {preview.warnings.map((w, i) => (
                    <div key={i}>⚠ {w}</div>
                  ))}
                </div>
              )}

              {preview.sampleItems.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase text-zinc-400 block">
                    Pré-visualização (primeiros registos detetados)
                  </span>
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5 text-xs">
                    {preview.sampleItems.map((item, idx) => (
                      <div key={idx} className="p-2.5 flex items-center justify-between gap-2 bg-[#080808]">
                        <div className="flex items-center gap-2 min-w-0">
                          {item.type === 'movie' ? (
                            <Film className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          ) : (
                            <Tv className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          )}
                          <span className="font-bold text-white truncate">{item.title}</span>
                          {item.tmdbId && <span className="text-[10px] font-mono text-zinc-500">#{item.tmdbId}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-[10px] tabular-nums">
                          <span className="text-zinc-400">{item.linksCount} link(s)</span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold ${
                              item.existsInCatalog ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-400'
                            }`}
                          >
                            {item.existsInCatalog ? 'Existente' : 'Novo'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Conflict Strategy */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 block">
                  Gestão de Conflitos e Preservação de Links
                </label>
                <select
                  value={conflictMode}
                  onChange={e => setConflictMode(e.target.value as BackupConflictMode)}
                  className="w-full min-h-[44px] bg-[#080808] border border-white/15 focus:border-[#E50914] rounded-xl px-4 py-2.5 text-xs font-semibold text-white outline-none"
                >
                  <option value="merge_new_links">
                    Adicionar apenas links novos sem duplicar existentes (Recomendado)
                  </option>
                  <option value="skip">
                    Ignorar filmes/séries/links já existentes (apenas adicionar novos)
                  </option>
                  <option value="update_metadata_keep_links">
                    Atualizar metadados faltantes mantendo todos os links atuais
                  </option>
                  <option value="overwrite">
                    Atualizar metadados e fundir/atualizar fontes do backup
                  </option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => handleStartImport('all')}
                  className="min-h-[46px] px-5 py-2.5 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-black uppercase rounded-xl flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Importar Tudo</span>
                </button>
                <button
                  type="button"
                  disabled={preview.summary.moviesTotal === 0}
                  onClick={() => handleStartImport('movies')}
                  className="min-h-[46px] px-4 py-2.5 bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs font-bold uppercase rounded-xl flex items-center gap-2"
                >
                  <Film className="w-4 h-4 text-blue-400" />
                  <span>Apenas Filmes ({preview.summary.moviesTotal})</span>
                </button>
                <button
                  type="button"
                  disabled={preview.summary.seriesTotal === 0}
                  onClick={() => handleStartImport('series')}
                  className="min-h-[46px] px-4 py-2.5 bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs font-bold uppercase rounded-xl flex items-center gap-2"
                >
                  <Tv className="w-4 h-4 text-purple-400" />
                  <span>Apenas Séries ({preview.summary.seriesTotal})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="min-h-[46px] px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 text-xs font-bold uppercase rounded-xl"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {importJobsHistory.length > 0 && (
            <div className="bg-[#0D0F15] border border-white/10 rounded-2xl p-5 space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-zinc-300">
                Últimas Importações Realizadas ({importJobsHistory.length})
              </h4>
              <div className="space-y-2 text-xs">
                {importJobsHistory.slice(0, 5).map(j => (
                  <div key={j.jobId} className="p-3 rounded-xl bg-[#080808] border border-white/10 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="text-white block truncate">{j.filename}</strong>
                      <span className="text-[11px] text-zinc-400">
                        {formatDatePt(j.startedAt)} · {j.status} · +{j.importedMovies} filmes, +{j.importedSeries} séries, +{j.importedSources} links
                      </span>
                    </div>
                    {j.status === 'CANCELLED' && (
                      <button
                        type="button"
                        onClick={() => handleResumeImport(j.jobId)}
                        className="px-3 py-1.5 rounded-lg bg-[#E50914] text-white text-[11px] font-bold"
                      >
                        Retomar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- SECTION 3: HISTÓRICO --- */}
      {activeSection === 'history' && (
        <div className="bg-[#0D0F15] border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-white/10 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-wider text-white">
              Histórico de Backups ({backups.length})
            </h3>
          </div>

          {backups.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">
              Nenhum backup registado ainda. Gere um backup no separador Exportar.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {backups.map(b => (
                <div
                  key={b.id}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-white/[0.02]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-xs sm:text-sm font-black text-white font-mono break-all">
                        {b.filename}
                      </strong>
                      <span className="px-2 py-0.5 rounded bg-white/10 text-zinc-200 text-[10px] font-bold uppercase">
                        {b.format}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[10px] font-bold uppercase">
                        {b.mode}
                      </span>
                      {b.origin === 'pre_import_rollback' && (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-bold uppercase">
                          Rollback Automático
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-400 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
                      <span>{formatDatePt(b.createdAt)}</span>
                      <span>· {formatBytes(b.sizeBytes)}</span>
                      <span>· {b.counts.movies} filmes</span>
                      <span>· {b.counts.series} séries</span>
                      <span>· {b.counts.episodes} ep.</span>
                      <span>· {b.counts.sources} links</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={downloadingId === b.id}
                      onClick={() => handleDownloadRecord(b)}
                      className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      {downloadingId === b.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Descarregar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAction({ type: 'restore', backup: b })}
                      className="min-h-[42px] px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Restaurar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAction({ type: 'delete', backup: b })}
                      className="min-h-[42px] px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400"
                      title="Eliminar backup"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- SECTION 4: ESTADO DO SISTEMA --- */}
      {activeSection === 'status' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 text-xs tabular-nums">
            <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">Filmes Ativos</span>
              <strong className="text-2xl font-black text-white mt-1 block">
                {systemStatus?.totalMovies ?? 0}
              </strong>
            </div>
            <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">Séries Ativas</span>
              <strong className="text-2xl font-black text-white mt-1 block">
                {systemStatus?.totalSeries ?? 0}
              </strong>
            </div>
            <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">Temporadas / Episódios</span>
              <strong className="text-lg font-black text-blue-400 mt-1 block">
                {systemStatus?.totalSeasons ?? 0} / {systemStatus?.totalEpisodes ?? 0}
              </strong>
            </div>
            <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">Fontes de Vídeo</span>
              <strong className="text-2xl font-black text-emerald-400 mt-1 block">
                {systemStatus?.totalSources ?? 0}
              </strong>
            </div>
            <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">Tamanho Base de Dados</span>
              <strong className="text-lg font-black text-white mt-1 block">
                {formatBytes(systemStatus?.storeSizeBytes ?? 0)}
              </strong>
            </div>
            <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">Pasta de Backups</span>
              <strong className="text-lg font-black text-white mt-1 block">
                {formatBytes(systemStatus?.backupsDirSizeBytes ?? 0)} ({systemStatus?.backupsCount ?? 0})
              </strong>
            </div>
            <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">Último Backup</span>
              <strong className="text-xs font-bold text-zinc-200 mt-1.5 block">
                {formatDatePt(systemStatus?.lastBackupAt)}
              </strong>
            </div>
            <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">Última Importação</span>
              <strong className="text-xs font-bold text-zinc-200 mt-1.5 block">
                {formatDatePt(systemStatus?.lastImportAt)}
              </strong>
            </div>
          </div>

          <div className="bg-[#0D0F15] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-4">
            <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#E50914]" />
              <span>Política de Proteção & Auto-Backup</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="flex items-center justify-between p-4 rounded-xl bg-[#080808] border border-white/10 cursor-pointer min-h-[52px]">
                <span className="font-bold text-zinc-200">Backup Automático Agendado</span>
                <input
                  type="checkbox"
                  checked={autoEnabled}
                  onChange={e => setAutoEnabled(e.target.checked)}
                  className="w-5 h-5 accent-[#E50914]"
                />
              </label>
              <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-[#080808] border border-white/10">
                <span className="font-bold text-zinc-200">Intervalo (horas)</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={autoHours}
                  onChange={e => setAutoHours(Math.max(1, parseInt(e.target.value, 10) || 24))}
                  className="w-24 bg-black border border-white/15 rounded-lg px-3 py-1.5 text-xs font-mono text-white text-center"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="min-h-[44px] px-5 py-2.5 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-black uppercase rounded-xl"
            >
              {savingConfig ? 'A guardar...' : 'Guardar Configuração'}
            </button>
          </div>
        </div>
      )}

      {/* INLINE CONFIRMATION MODAL (MOBILE SAFE, ZERO window.confirm) */}
      {confirmAction && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#0D0F15] border border-white/15 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black uppercase text-white">
                {confirmAction.type === 'restore' ? 'Confirmar Restauração' : 'Eliminar Backup'}
              </h3>
              <button type="button" onClick={() => setConfirmAction(null)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {confirmAction.type === 'restore'
                ? `O sistema criará automaticamente um snapshot de segurança antes de restaurar "${confirmAction.backup.filename}" e fundirá links sem duplicar.`
                : `Tem a certeza de que pretende eliminar permanentemente o ficheiro "${confirmAction.backup.filename}"?`}
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                className={`min-h-[42px] px-5 py-2 rounded-xl text-white text-xs font-black uppercase ${
                  confirmAction.type === 'restore' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-[#E50914] hover:bg-red-700'
                }`}
              >
                {confirmAction.type === 'restore' ? 'Confirmar Restauro' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
