import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  Play, 
  Pause, 
  RotateCcw, 
  XOctagon, 
  FileText, 
  Download, 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Copy, 
  FileSpreadsheet, 
  FileCode, 
  Zap, 
  ShieldCheck, 
  Layers, 
  Activity, 
  Film, 
  Tv, 
  Sliders, 
  Check, 
  RefreshCw,
  Search
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { ImportStatus, MassImportReport, MassImportItemResult } from '../../types.js';

interface MassImporterProps {
  onCatalogUpdated?: () => void;
}

export const MassImporter: React.FC<MassImporterProps> = ({ onCatalogUpdated }) => {
  // Input Modes: 'paste' | 'file' | 'popular'
  const [inputMode, setInputMode] = useState<'paste' | 'file' | 'popular'>('paste');
  
  // Paste text input
  const [rawText, setRawText] = useState('');
  const [parsedIds, setParsedIds] = useState<number[]>([]);
  
  // Popular mode options
  const [pagesCount, setPagesCount] = useState<number>(5);

  // Settings
  const [contentType, setContentType] = useState<'movie' | 'tv' | 'both'>('both');
  const [batchSize, setBatchSize] = useState<number>(100);
  const [concurrency, setConcurrency] = useState<number>(6);
  const [cacheEnabled, setCacheEnabled] = useState<boolean>(true);

  // Live status
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // History & Reports
  const [reports, setReports] = useState<MassImportReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<MassImportReport | null>(null);
  const [historyTab, setHistoryTab] = useState<'live' | 'history'>('live');

  // Logs terminal search & autoscroll
  const [logFilter, setLogFilter] = useState('');
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Polling interval
  useEffect(() => {
    fetchStatus();
    fetchHistory();

    const interval = setInterval(() => {
      fetchStatus();
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll logs when new logs arrive
  useEffect(() => {
    if (terminalEndRef.current && historyTab === 'live') {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [status?.logs?.length, historyTab]);

  // Parse raw text whenever rawText changes
  useEffect(() => {
    if (!rawText.trim()) {
      setParsedIds([]);
      return;
    }

    // Extract all integer numbers using regex
    const matches = rawText.match(/\b\d+\b/g);
    if (!matches) {
      setParsedIds([]);
      return;
    }

    const uniqueSet = new Set<number>();
    for (const m of matches) {
      const num = parseInt(m, 10);
      if (num > 0 && !isNaN(num)) {
        uniqueSet.add(num);
      }
    }

    setParsedIds(Array.from(uniqueSet));
  }, [rawText]);

  const lastStatusRef = useRef<string | null>(null);

  const fetchStatus = async () => {
    try {
      const current = await api.getMassImportStatus();
      if (current) {
        if (lastStatusRef.current && (lastStatusRef.current === 'PROCESSING' || lastStatusRef.current === 'RUNNING') && current.status === 'COMPLETED') {
          fetchHistory();
          if (onCatalogUpdated) onCatalogUpdated();
        }
        lastStatusRef.current = current.status;
      }
      setStatus(current);
    } catch (err) {
      console.error('Failed to get mass import status:', err);
    }
  };

  const fetchHistory = async () => {
    try {
      const hist = await api.getMassImportHistory();
      setReports(hist);
    } catch (err) {
      console.error('Failed to get mass import history:', err);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setRawText(content);
        setSuccessMsg(`Arquivo "${file.name}" carregado com sucesso.`);
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    };
    reader.readAsText(file);
  };

  const handlePreset = (presetType: 'movies' | 'series' | 'mix') => {
    if (presetType === 'movies') {
      // Classic blockbusters and acclaimed films
      const ids = [550, 27205, 157336, 603, 155, 13, 238, 240, 424, 680, 122, 120, 121, 278, 19995, 299534, 299536, 24428, 99861, 284054, 597, 1891, 11, 1892, 1893, 1894, 1895, 76341, 324857, 105, 862, 863, 10193, 354912, 475557, 335984, 508442, 569094, 634649, 438631, 361743, 671, 672, 673, 674, 675, 767, 12444, 12445, 693134];
      setRawText(ids.join(', '));
      setContentType('movie');
    } else if (presetType === 'series') {
      // Top acclaimed TV series
      const ids = [1399, 1396, 60059, 1402, 60625, 71446, 66732, 94605, 85552, 93405, 100088, 46952, 1418, 1668, 63174, 76479, 82856, 88396, 92783, 119051, 1429, 48866, 60735, 67195, 70523, 75219, 87108, 94997, 110316, 125988, 1408, 456, 2316, 1434, 4614, 1409, 1412, 1416, 1413, 1407, 1405, 1404, 1403, 1406, 1410, 1411, 1414, 1415, 1417, 1419];
      setRawText(ids.join(', '));
      setContentType('tv');
    } else {
      // Mix of 100 top movies and TV shows
      const ids = [
        550, 1399, 27205, 1396, 157336, 60059, 603, 1402, 155, 60625,
        13, 71446, 238, 66732, 240, 94605, 424, 85552, 680, 93405,
        122, 100088, 120, 46952, 121, 1418, 278, 1668, 19995, 63174,
        299534, 76479, 299536, 82856, 24428, 88396, 99861, 92783, 284054, 119051,
        597, 1429, 1891, 48866, 11, 60735, 1892, 67195, 1893, 70523
      ];
      setRawText(ids.join('\n'));
      setContentType('both');
    }
  };

  const handleStart = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      let payload: any = {
        contentType,
        batchSize,
        concurrency,
        cacheEnabled
      };

      if (inputMode === 'paste' || inputMode === 'file') {
        if (parsedIds.length === 0) {
          setErrorMsg('Nenhum ID TMDB válido foi detectado. Cole ao menos 1 ID válido.');
          setLoading(false);
          return;
        }
        payload.ids = parsedIds;
      } else {
        payload.pagesCount = pagesCount;
        payload.type = contentType === 'tv' ? 'tv' : 'movie';
      }

      const res = await api.startMassImport(payload);
      if (res.success) {
        setSuccessMsg(res.message);
        setStatus(res.status);
        if (onCatalogUpdated) onCatalogUpdated();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao iniciar importação em massa.');
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    try {
      const res = await api.pauseMassImport();
      setStatus(res.status);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao pausar.');
    }
  };

  const handleResume = async () => {
    try {
      const res = await api.resumeMassImport();
      setStatus(res.status);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao retomar.');
    }
  };

  const handleCancel = async () => {
    try {
      const res = await api.cancelMassImport();
      const newStatus = await api.getMassImportStatus();
      if (newStatus) setStatus(newStatus);
      fetchHistory();
      if (onCatalogUpdated) onCatalogUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao cancelar.');
    }
  };

  const handleRetryErrors = async () => {
    try {
      const res = await api.retryMassImportErrors();
      setStatus(res.status);
      setSuccessMsg('Reprocessamento de erros iniciado.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao reprocessar erros.');
    }
  };

  const handleClear = async () => {
    try {
      const res = await api.clearMassImport();
      setStatus(res.status);
      setRawText('');
      setParsedIds([]);
      fetchHistory();
      if (onCatalogUpdated) onCatalogUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao limpar.');
    }
  };

  const handleExportReport = async (reportId: string | undefined, format: 'txt' | 'csv' | 'json') => {
    try {
      await api.exportMassImportFile(reportId, format);
      setSuccessMsg(`Relatório exportado em formato ${format.toUpperCase()}.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao exportar relatório.');
    }
  };

  const isProcessing = status?.status === 'PROCESSING' || status?.status === 'RUNNING';
  const isPaused = status?.status === 'PAUSED';
  const isCompleted = status?.status === 'COMPLETED';
  const isCancelled = status?.status === 'CANCELLED';

  const progressPercent = status?.total && status.total > 0
    ? Math.min(100, Math.round(((status.processing || 0) / status.total) * 100))
    : 0;

  const filteredLogs = (status?.logs || []).filter(l => 
    !logFilter || l.toLowerCase().includes(logFilter.toLowerCase())
  );

  return (
    <div id="mass-importer-container" className="space-y-6 font-inter">
      {/* Header */}
      <div id="mass-importer-header" className="bg-[#121212]/40 backdrop-blur-xl border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand/5 rounded-full blur-[100px] pointer-events-none -mr-20 -mt-20" />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand shrink-0 shadow-xl">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-black tracking-tight text-white uppercase font-outfit">
                  Importação RONYCINE
                </h1>
                <span className="px-3 py-1 text-[10px] font-black tracking-[0.2em] uppercase rounded-full bg-brand/10 text-brand border border-brand/20">
                  Engine v4.0
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
                Processamento assíncrono de alto desempenho com integração direta TMDB e controle de cache.
              </p>
            </div>
          </div>

          <div className="flex items-center bg-black/40 p-1 rounded-2xl border border-white/5 shrink-0">
            <button
              id="tab-live-btn"
              onClick={() => setHistoryTab('live')}
              className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                historyTab === 'live'
                  ? 'bg-brand text-white shadow-lg shadow-brand/20'
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Execução
            </button>
            <button
              id="tab-history-btn"
              onClick={() => {
                setHistoryTab('history');
                fetchHistory();
              }}
              className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                historyTab === 'history'
                  ? 'bg-brand text-white shadow-lg shadow-brand/20'
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Relatórios ({reports.length})
            </button>
          </div>
        </div>

        {/* Feature Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-zinc-800/60">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 bg-zinc-900/50 px-2.5 py-1.5 rounded-lg border border-zinc-800/40">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Anti-duplicação</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-400 bg-zinc-900/50 px-2.5 py-1.5 rounded-lg border border-zinc-800/40">
            <Layers className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span>Concorrência</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-400 bg-zinc-900/50 px-2.5 py-1.5 rounded-lg border border-zinc-800/40">
            <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Taxa Inteligente</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-400 bg-zinc-900/50 px-2.5 py-1.5 rounded-lg border border-zinc-800/40">
            <Database className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>Fila Persistente</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div id="mass-import-error-banner" className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-zinc-400 hover:text-white text-xs">✕</button>
        </div>
      )}
      {successMsg && (
        <div id="mass-import-success-banner" className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="flex-1">{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-zinc-400 hover:text-white text-xs">✕</button>
        </div>
      )}

      {historyTab === 'live' ? (
        <div className="space-y-6">
          {/* Active Job Dashboard if processing or has previous state */}
          {status && status.status !== 'IDLE' && (
            <div id="mass-import-live-progress" className="bg-[#18181b] border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    isProcessing ? 'bg-amber-400 animate-pulse' :
                    isPaused ? 'bg-blue-400' :
                    isCompleted ? 'bg-emerald-400' : 'bg-red-400'
                  }`} />
                  <div>
                    <span className="text-xs uppercase font-bold tracking-wider text-zinc-400">
                      Status da Operação
                    </span>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      {isProcessing && 'Processando Fila TMDB...'}
                      {isPaused && 'Fila Pausada pelo Administrador'}
                      {isCompleted && 'Importação Concluída com Sucesso'}
                      {isCancelled && 'Importação Cancelada'}
                      {status.status === 'FAILED' && 'Falha no Processamento'}
                    </h3>
                  </div>
                </div>

                {/* Real-time Control Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isProcessing && (
                    <button
                      id="btn-pause-import"
                      onClick={handlePause}
                      className="px-3.5 py-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                    >
                      <Pause className="w-4 h-4" />
                      Pausar
                    </button>
                  )}

                  {isPaused && (
                    <button
                      id="btn-resume-import"
                      onClick={handleResume}
                      className="px-3.5 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                    >
                      <Play className="w-4 h-4" />
                      Retomar
                    </button>
                  )}

                  {(isProcessing || isPaused) && (
                    <button
                      id="btn-cancel-import"
                      onClick={handleCancel}
                      className="px-3.5 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                    >
                      <XOctagon className="w-4 h-4" />
                      Cancelar
                    </button>
                  )}

                  {(status.errorsCount || 0) > 0 && !isProcessing && (
                    <button
                      id="btn-retry-errors"
                      onClick={handleRetryErrors}
                      className="px-3.5 py-2 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/30 hover:bg-orange-500/20 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reprocessar Erros ({status.errorsCount})
                    </button>
                  )}

                  {!isProcessing && (
                    <button
                      id="btn-clear-import"
                      onClick={handleClear}
                      className="px-3.5 py-2 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Nova Importação
                    </button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-zinc-400">
                  <span>Progresso Geral ({status.processing} de {status.total} IDs)</span>
                  <span className="text-white font-mono">{progressPercent}%</span>
                </div>
                <div className="w-full h-3 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                  <div 
                    className="h-full bg-gradient-to-r from-red-600 via-red-500 to-amber-500 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {status.currentTitle && isProcessing && (
                  <p className="text-xs text-zinc-400 truncate">
                    <span className="text-zinc-500">Item atual:</span> <span className="text-zinc-200 font-medium">{status.currentTitle}</span>
                  </p>
                )}
              </div>

              {/* Stat Counters Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Total</span>
                  <div className="text-lg font-black text-white font-mono mt-0.5">{status.total}</div>
                </div>
                <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">✓ Sucessos</span>
                  <div className="text-lg font-black text-emerald-400 font-mono mt-0.5">{status.successesCount || 0}</div>
                </div>
                <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">↻ Duplicados</span>
                  <div className="text-lg font-black text-amber-400 font-mono mt-0.5">{status.duplicatesCount || 0}</div>
                </div>
                <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">✕ 404 TMDB</span>
                  <div className="text-lg font-black text-zinc-400 font-mono mt-0.5">{status.notFoundCount || 0}</div>
                </div>
                <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">⚠ Falhas</span>
                  <div className="text-lg font-black text-red-400 font-mono mt-0.5">{status.errorsCount || 0}</div>
                </div>
                <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Velocidade</span>
                  <div className="text-lg font-black text-blue-400 font-mono mt-0.5">
                    {status.speed || 0} <span className="text-[10px] font-normal text-zinc-400">it/s</span>
                  </div>
                </div>
              </div>

              {/* ETA / Lote details */}
              <div className="flex flex-wrap items-center justify-between text-xs text-zinc-400 bg-zinc-900/40 px-4 py-2.5 rounded-xl border border-zinc-800/60 gap-3">
                <div className="flex items-center gap-4">
                  <span>Tempo Decorrido: <strong className="text-zinc-200">{Math.floor((status.elapsedTime || 0) / 60)}m {(status.elapsedTime || 0) % 60}s</strong></span>
                  {status.estimatedTime ? (
                    <span>Tempo Restante (ETA): <strong className="text-zinc-200">{Math.floor(status.estimatedTime / 60)}m {status.estimatedTime % 60}s</strong></span>
                  ) : null}
                </div>
                {status.totalBatches && (
                  <div>
                    Lote <strong className="text-zinc-200">{status.currentBatch || 1}</strong> de <strong className="text-zinc-200">{status.totalBatches}</strong>
                  </div>
                )}
              </div>

              {/* Export Active Report Options */}
              <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60">
                <span className="text-xs text-zinc-400 font-medium">Exportar relatório desta operação:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleExportReport(undefined, 'txt')}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    TXT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportReport(undefined, 'csv')}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportReport(undefined, 'json')}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    JSON
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* New Import Configuration (Visible when not actively running or alongside) */}
          {(!isProcessing || isPaused) && (
            <div id="mass-import-input-section" className="bg-[#18181b] border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-4 border-b border-zinc-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-white uppercase tracking-tight">
                    Configurar Nova Carga de IDs
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Escolha a forma de inserção dos IDs e configure os parâmetros de processamento.
                  </p>
                </div>

                {/* Modes Selector */}
                <div className="flex items-center bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                  <button
                    id="mode-paste-btn"
                    onClick={() => setInputMode('paste')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${
                      inputMode === 'paste' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Colar IDs
                  </button>
                  <button
                    id="mode-file-btn"
                    onClick={() => setInputMode('file')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-1.5 ${
                      inputMode === 'file' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    Upload Arquivo
                  </button>
                  <button
                    id="mode-popular-btn"
                    onClick={() => setInputMode('popular')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${
                      inputMode === 'popular' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Páginas Populares
                  </button>
                </div>
              </div>

              {/* Mode 1: Paste Textarea */}
              {inputMode === 'paste' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                      Cole a lista de IDs TMDB (10.000, 20.000, 50.000+ suportados)
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400 font-mono">
                        IDs válidos: <strong className="text-red-400">{parsedIds.length}</strong>
                      </span>
                    </div>
                  </div>

                  <textarea
                    id="mass-import-textarea"
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Cole aqui os IDs TMDB separados por vírgula, quebra de linha ou espaço... Exemplo: 550, 27205, 157336, 1399, 1396"
                    className="w-full h-40 bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all resize-y"
                  />

                  {/* Presets */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-zinc-500">Presets rápidos de teste:</span>
                    <button
                      onClick={() => handlePreset('movies')}
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white"
                    >
                      Top 50 Filmes
                    </button>
                    <button
                      onClick={() => handlePreset('series')}
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white"
                    >
                      Top 50 Séries
                    </button>
                    <button
                      onClick={() => handlePreset('mix')}
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white"
                    >
                      Mix 50/50
                    </button>
                    {rawText && (
                      <button
                        onClick={() => setRawText('')}
                        className="px-2.5 py-1 rounded-lg bg-red-600/10 text-red-400 hover:bg-red-600/20 text-xs ml-auto"
                      >
                        Limpar Campo
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Mode 2: File Upload */}
              {inputMode === 'file' && (
                <div className="space-y-4">
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-zinc-800 hover:border-red-500/60 rounded-2xl p-8 text-center bg-zinc-900/40 hover:bg-zinc-900/80 cursor-pointer transition-all space-y-3"
                  >
                    <div className="w-12 h-12 rounded-full bg-red-600/10 text-red-500 mx-auto flex items-center justify-center">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">Clique para selecionar ou arraste o arquivo aqui</p>
                      <p className="text-xs text-zinc-400 mt-1">Suporta arquivos .txt, .csv e .json de até centenas de milhares de linhas</p>
                    </div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".txt,.csv,.json"
                      className="hidden"
                    />
                  </div>

                  {parsedIds.length > 0 && (
                    <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-800 flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Total de IDs extraídos do arquivo:</span>
                      <strong className="text-emerald-400 font-mono text-sm">{parsedIds.length} IDs únicos</strong>
                    </div>
                  )}
                </div>
              )}

              {/* Mode 3: Popular Pages */}
              {inputMode === 'popular' && (
                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Número de páginas de populares do TMDB (20 títulos por página)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[1, 5, 10, 20, 30, 40].map((pages) => (
                      <button
                        key={pages}
                        onClick={() => setPagesCount(pages)}
                        className={`p-3 rounded-xl border text-center transition-all ${
                          pagesCount === pages
                            ? 'bg-red-600/20 border-red-500 text-white font-bold'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                      >
                        <div className="text-base font-black">{pages * 20} itens</div>
                        <div className="text-[11px] opacity-70">({pages} páginas)</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Advanced Parameters Configuration */}
              <div className="pt-4 border-t border-zinc-800/80 space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
                  <Sliders className="w-4 h-4 text-red-500" />
                  Parâmetros de Otimização e Tipo
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Content Type */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-zinc-400 font-medium">Tipo de Conteúdo</label>
                    <select
                      id="select-content-type"
                      value={contentType}
                      onChange={(e: any) => setContentType(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                    >
                      <option value="both">⚡ Auto-detectar (Filmes + Séries)</option>
                      <option value="movie">🎬 Apenas Filmes (Movies)</option>
                      <option value="tv">📺 Apenas Séries (TV Shows)</option>
                    </select>
                  </div>

                  {/* Batch Size */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-zinc-400 font-medium">Tamanho do Lote (Batch)</label>
                    <select
                      id="select-batch-size"
                      value={batchSize}
                      onChange={(e) => setBatchSize(parseInt(e.target.value, 10))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                    >
                      <option value="50">50 itens / lote</option>
                      <option value="100">100 itens / lote (Recomendado)</option>
                      <option value="250">250 itens / lote</option>
                      <option value="500">500 itens / lote (Cargas Altas)</option>
                    </select>
                  </div>

                  {/* Concurrency */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-zinc-400 font-medium">Concorrência de Rede</label>
                    <select
                      id="select-concurrency"
                      value={concurrency}
                      onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                    >
                      <option value="3">3 requisições simultâneas (Lento / Seguro)</option>
                      <option value="6">6 requisições simultâneas (Balanceado)</option>
                      <option value="8">8 requisições simultâneas (Rápido)</option>
                      <option value="12">12 requisições simultâneas (Ultra)</option>
                    </select>
                  </div>

                  {/* Cache Toggle */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-zinc-400 font-medium">Cache Inteligente TMDB</label>
                    <button
                      type="button"
                      onClick={() => setCacheEnabled(!cacheEnabled)}
                      className={`w-full py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                        cacheEnabled
                          ? 'bg-emerald-600/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      {cacheEnabled ? <Check className="w-3.5 h-3.5" /> : null}
                      {cacheEnabled ? 'Cache Ativado (1h)' : 'Cache Desativado'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Start Button */}
              <div className="pt-4 flex justify-end">
                <button
                  id="btn-start-mass-import"
                  onClick={handleStart}
                  disabled={loading || (inputMode !== 'popular' && parsedIds.length === 0)}
                  className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-600/30 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4 fill-white" />
                  {loading ? 'Preparando...' : `Iniciar Importação (${inputMode === 'popular' ? `${pagesCount * 20} itens` : `${parsedIds.length} IDs`})`}
                </button>
              </div>
            </div>
          )}

          {/* Real-time Logs Terminal and Recent Results */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Logs Terminal */}
            <div id="mass-import-logs-terminal" className="bg-[#18181b] border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col h-96">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">Terminal de Logs em Tempo Real</h3>
                </div>
                <div className="relative w-40">
                  <input
                    type="text"
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    placeholder="Filtrar logs..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-[11px] text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-red-500"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto font-mono text-[11px] space-y-1.5 p-3 bg-zinc-950/80 rounded-xl mt-3 border border-zinc-900">
                {filteredLogs.length === 0 ? (
                  <p className="text-zinc-600 italic">Nenhum evento registrado ainda.</p>
                ) : (
                  filteredLogs.map((log, idx) => {
                    const isSuccess = log.includes('[SUCESSO]') || log.includes('concluída');
                    const isError = log.includes('[ERRO]') || log.includes('Falha');
                    const isWarn = log.includes('[DUPLICADO]') || log.includes('[NÃO ENCONTRADO]') || log.includes('warn');
                    return (
                      <div 
                        key={idx} 
                        className={`leading-relaxed break-all ${
                          isSuccess ? 'text-emerald-400' :
                          isError ? 'text-red-400' :
                          isWarn ? 'text-amber-400/90' :
                          'text-zinc-400'
                        }`}
                      >
                        {log}
                      </div>
                    );
                  })
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>

            {/* Recent Results Table */}
            <div id="mass-import-recent-results" className="bg-[#18181b] border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col h-96">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">Últimos Resultados Processados</h3>
                <span className="text-[11px] text-zinc-500">{(status?.recentResults || []).length} itens</span>
              </div>

              <div className="flex-1 overflow-y-auto mt-3 space-y-2">
                {(status?.recentResults || []).length === 0 ? (
                  <p className="text-xs text-zinc-600 italic p-3">Nenhum resultado processado na sessão atual.</p>
                ) : (
                  (status?.recentResults || []).map((item, idx) => (
                    <div 
                      key={idx}
                      className="p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-zinc-400 font-bold">#{item.tmdbId}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 uppercase">
                            {item.type}
                          </span>
                        </div>
                        <p className="text-zinc-200 font-medium truncate mt-0.5">{item.title}</p>
                      </div>

                      <div>
                        {item.status === 'SUCCESS' && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold uppercase">
                            Sucesso
                          </span>
                        )}
                        {item.status === 'DUPLICATE' && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-bold uppercase">
                            Duplicado
                          </span>
                        )}
                        {item.status === 'NOT_FOUND' && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 text-[10px] font-bold uppercase">
                            404 TMDB
                          </span>
                        )}
                        {item.status === 'ERROR' && (
                          <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/30 text-[10px] font-bold uppercase">
                            Erro
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* History & Reports Tab */
        <div id="mass-import-history-section" className="bg-[#18181b] border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white uppercase tracking-tight">Histórico de Relatórios de Importação</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Auditoria e exportação de todas as operações em massa já executadas.</p>
            </div>
            <button
              onClick={fetchHistory}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 hover:text-white flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </button>
          </div>

          {reports.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 space-y-2">
              <FileText className="w-8 h-8 mx-auto text-zinc-600" />
              <p className="text-sm">Nenhum relatório histórico encontrado.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {reports.map((report) => (
                <div 
                  key={report.id}
                  className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-all space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-red-600/10 text-red-500 flex items-center justify-center font-bold text-xs">
                        IMP
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">{report.title}</h4>
                        <p className="text-xs text-zinc-400">
                          {new Date(report.startedAt).toLocaleString('pt-BR')} • Duração: {report.duration}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleExportReport(report.id, 'txt')}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> TXT
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportReport(report.id, 'csv')}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportReport(report.id, 'json')}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> JSON
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-zinc-800/60 text-xs">
                    <div>Total: <strong className="text-white">{report.total}</strong></div>
                    <div>Sucesso: <strong className="text-emerald-400">{report.successCount}</strong></div>
                    <div>Duplicados: <strong className="text-amber-400">{report.duplicatesCount}</strong></div>
                    <div>Não Encontrados: <strong className="text-zinc-400">{report.notFoundCount}</strong></div>
                    <div>Erros: <strong className="text-red-400">{report.errorsCount}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
