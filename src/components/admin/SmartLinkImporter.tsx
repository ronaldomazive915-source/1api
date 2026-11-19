import React, { useCallback, useEffect, useState } from 'react';
import {
  Film,
  Tv,
  History,
  Copy,
  Check,
  RefreshCw,
  Play,
  X,
  RotateCcw,
  Link2
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { MGEB_PREFIX } from '../../lib/mgebUtils.js';
import { formatAdminDate } from '../../lib/mediaUtils.js';
import { LinkImportHistoryItem, SeasonDiscoveryJob } from '../../types.js';
import { RonycinePlayer } from '../player/RonycinePlayer.js';
import { SmartMovieImporter } from './SmartMovieImporter.js';
import { SmartSeriesImporter } from './SmartSeriesImporter.js';

interface SmartLinkImporterProps {
  onCatalogUpdated?: () => void;
  onViewCatalogItem?: (item: {
    id?: string;
    tmdbId: number;
    type: 'movie' | 'tv';
    title: string;
    categories?: string[];
  }) => void;
}

export const SmartLinkImporter: React.FC<SmartLinkImporterProps> = ({
  onCatalogUpdated,
  onViewCatalogItem
}) => {
  const [workspaceTab, setWorkspaceTab] = useState<'movies' | 'series' | 'history'>('series');
  const [copiedPrefix, setCopiedPrefix] = useState(false);

  const [activeSeriesJob, setActiveSeriesJob] = useState<SeasonDiscoveryJob | null>(null);
  const [savedSeasonJobs, setSavedSeasonJobs] = useState<SeasonDiscoveryJob[]>([]);
  const [history, setHistory] = useState<LinkImportHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [playerModal, setPlayerModal] = useState<{
    isOpen: boolean;
    title: string;
    src: string;
    version: 'dublado' | 'legendado';
  } | null>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await api.getSmartLinkImportHistory();
      if (res?.success && Array.isArray(res.history)) {
        setHistory(res.history);
      }
    } catch {
      // ignore transient error
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const loadSavedJobs = useCallback(async () => {
    try {
      const res = await api.listBatchSeasonJobs();
      if (res?.success && Array.isArray(res.jobs)) {
        setSavedSeasonJobs(res.jobs);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    void loadSavedJobs();
  }, [loadHistory, loadSavedJobs]);

  useEffect(() => {
    if (!activeSeriesJob || activeSeriesJob.status !== 'RUNNING') return;
    const jobId = activeSeriesJob.jobId;
    const timer = setInterval(async () => {
      try {
        const res = await api.getBatchSeasonJob(jobId);
        if (res?.success && res.job) {
          setActiveSeriesJob(res.job);
          if (res.job.status !== 'RUNNING') {
            void loadSavedJobs();
          }
        }
      } catch {
        // continue polling on transient glitch
      }
    }, 900);
    return () => clearInterval(timer);
  }, [activeSeriesJob?.jobId, activeSeriesJob?.status, loadSavedJobs]);

  const handleCopyPrefix = () => {
    navigator.clipboard?.writeText(MGEB_PREFIX);
    setCopiedPrefix(true);
    setTimeout(() => setCopiedPrefix(false), 1800);
  };

  const handleOpenPlayer = useCallback(
    (opts: { title: string; src: string; version: 'dublado' | 'legendado' }) => {
      setPlayerModal({ isOpen: true, ...opts });
    },
    []
  );

  const handleCatalogChanged = useCallback(() => {
    void loadHistory();
    void loadSavedJobs();
    onCatalogUpdated?.();
  }, [loadHistory, loadSavedJobs, onCatalogUpdated]);

  return (
    <div className="space-y-6">
      {/* 1. CABEÇALHO PRINCIPAL + PREFIXO OFICIAL MGEB */}
      <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg sm:text-xl font-black tracking-tight text-white uppercase">
              Importação Inteligente PRO
            </h2>
            <p className="text-xs text-zinc-400">
              Áreas independentes para Filmes e Séries com identificação oficial TMDB, geração automática de todos os episódios por temporada e aplicação automática do prefixo MGEB.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-black border border-white/10 rounded-lg px-3 py-2 shrink-0 max-w-full">
            <Link2 className="w-4 h-4 text-[#E50914] shrink-0" />
            <div className="min-w-0">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                Prefixo Oficial MGEB
              </span>
              <code className="text-xs font-mono text-zinc-200 truncate block select-all">
                {MGEB_PREFIX}
              </code>
            </div>
            <button
              type="button"
              onClick={handleCopyPrefix}
              className="min-h-[34px] px-2.5 rounded bg-white/5 hover:bg-white/10 text-zinc-200 text-xs flex items-center gap-1 shrink-0"
            >
              {copiedPrefix ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedPrefix ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>

        {/* 2. SELETOR DE ÁREAS COMPLETAMENTE SEPARADAS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={() => setWorkspaceTab('movies')}
            className={`min-h-[46px] px-4 rounded-lg border text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
              workspaceTab === 'movies'
                ? 'bg-[#E50914] border-[#E50914] text-white'
                : 'bg-black border-white/10 text-zinc-300 hover:border-white/25 hover:text-white'
            }`}
          >
            <Film className="w-4 h-4" />
            Importar Filmes
          </button>

          <button
            type="button"
            onClick={() => setWorkspaceTab('series')}
            className={`min-h-[46px] px-4 rounded-lg border text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
              workspaceTab === 'series'
                ? 'bg-[#E50914] border-[#E50914] text-white'
                : 'bg-black border-white/10 text-zinc-300 hover:border-white/25 hover:text-white'
            }`}
          >
            <Tv className="w-4 h-4" />
            Importar Séries
          </button>

          <button
            type="button"
            onClick={() => {
              setWorkspaceTab('history');
              void loadHistory();
              void loadSavedJobs();
            }}
            className={`min-h-[46px] px-4 rounded-lg border text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
              workspaceTab === 'history'
                ? 'bg-white text-black border-white'
                : 'bg-black border-white/10 text-zinc-300 hover:border-white/25 hover:text-white'
            }`}
          >
            <History className="w-4 h-4" />
            Histórico & Sessões ({savedSeasonJobs.length})
          </button>
        </div>
      </div>

      {/* 3. SECÇÃO A — IMPORTAR FILMES (100% SEPARADA) */}
      {workspaceTab === 'movies' && (
        <SmartMovieImporter
          onOpenPlayer={handleOpenPlayer}
          onCatalogUpdated={handleCatalogChanged}
          onViewCatalogItem={onViewCatalogItem}
        />
      )}

      {/* 4. SECÇÃO B — IMPORTAR SÉRIES (100% SEPARADA) */}
      {workspaceTab === 'series' && (
        <SmartSeriesImporter
          externalJob={activeSeriesJob}
          onJobChange={setActiveSeriesJob}
          onJobsSaved={() => void loadSavedJobs()}
          onOpenPlayer={handleOpenPlayer}
          onCatalogUpdated={handleCatalogChanged}
          onViewCatalogItem={onViewCatalogItem}
        />
      )}

      {/* 5. HISTÓRICO E SESSÕES GUARDADAS */}
      {workspaceTab === 'history' && (
        <div className="space-y-5">
          {/* Sessões de Descoberta / Geração Guardadas */}
          <div className="bg-[#0e0e11] border border-white/10 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">Sessões de Séries Guardadas</h3>
                <p className="text-xs text-zinc-400">
                  Recarregue qualquer geração anterior para rever, editar ou retomar sem perder episódios.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadSavedJobs()}
                className="min-h-[38px] px-3 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-200 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizar
              </button>
            </div>

            <div className="divide-y divide-white/5">
              {savedSeasonJobs.map(j => (
                <div
                  key={j.jobId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-white">
                        {j.seriesGroups.map(g => g.title).join(', ') || `Operação ${j.jobId}`}
                      </span>
                      <span className="font-mono text-zinc-400 tabular-nums">
                        · {j.totalSeasons}T · {j.totalEpisodesDiscovered} eps · {j.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 truncate">{j.currentTask}</p>
                    <p className="text-[10px] font-mono text-zinc-500 tabular-nums">
                      {formatAdminDate(j.updatedAt || j.createdAt)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveSeriesJob(j);
                      setWorkspaceTab('series');
                    }}
                    className="min-h-[38px] px-3.5 rounded-lg bg-[#E50914] hover:bg-[#c80812] text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Carregar na Área de Séries
                  </button>
                </div>
              ))}

              {savedSeasonJobs.length === 0 && (
                <div className="p-8 text-center text-xs text-zinc-500">
                  Nenhuma sessão de geração de séries guardada ainda.
                </div>
              )}
            </div>
          </div>

          {/* Auditoria de Importações */}
          <div className="bg-[#0e0e11] border border-white/10 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">Registo de Importações no Catálogo</h3>
                <p className="text-xs text-zinc-400">Histórico real de filmes e séries gravados.</p>
              </div>
              <button
                type="button"
                onClick={() => void loadHistory()}
                disabled={loadingHistory}
                className="min-h-[38px] px-3 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-200 flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>

            <div className="divide-y divide-white/5">
              {history.map(item => (
                <div
                  key={item.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-bold uppercase text-[10px] ${
                          item.status === 'SUCCESS'
                            ? 'text-emerald-400'
                            : item.status === 'UPDATED'
                            ? 'text-sky-400'
                            : item.status === 'DUPLICATE'
                            ? 'text-amber-300'
                            : 'text-red-400'
                        }`}
                      >
                        {item.status}
                      </span>
                      <span className="font-bold text-white">{item.title}</span>
                      {item.tmdbId && (
                        <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                          TMDB #{item.tmdbId} · {item.type === 'tv' ? 'Série' : 'Filme'}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 truncate">{item.details}</p>
                    {item.url && <p className="text-[10px] font-mono text-zinc-500 truncate">{item.url}</p>}
                  </div>
                  <div className="text-left sm:text-right text-[10px] font-mono text-zinc-500 shrink-0 tabular-nums">
                    <p>{formatAdminDate(item.timestamp)}</p>
                    <p className="text-zinc-600">{item.adminEmail}</p>
                  </div>
                </div>
              ))}

              {history.length === 0 && (
                <div className="p-8 text-center text-xs text-zinc-500">
                  Nenhum registo de importação encontrado no histórico.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL DE PRÉ-VISUALIZAÇÃO NO PLAYER */}
      {playerModal?.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0e0e11] border border-white/15 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Play className="w-4 h-4 text-[#E50914] shrink-0" />
                <h4 className="text-sm font-bold text-white truncate">{playerModal.title}</h4>
              </div>
              <button
                type="button"
                onClick={() => setPlayerModal(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="aspect-video w-full bg-black relative">
              <RonycinePlayer
                src={playerModal.src}
                title={playerModal.title}
                autoplay={true}
                standalone={true}
              />
            </div>

            <div className="p-3 bg-black border-t border-white/10 text-[11px] font-mono text-zinc-400 truncate">
              Origem do Stream: {playerModal.src}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
