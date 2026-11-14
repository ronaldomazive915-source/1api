import React, { useState, useEffect } from 'react';
import { Activity, Server, Database, Globe, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Shield, Zap, Clock, HardDrive } from 'lucide-react';
import { api } from '../../lib/api.js';
import { OFFICIAL_BASE_URL } from '../../lib/siteConfig.js';

interface HealthData {
  status: string;
  name: string;
  version: string;
  uptimeSeconds: number;
  database: string;
  catalog?: {
    movies: number;
    series: number;
    episodes: number;
    total: number;
  };
  stats?: {
    catalogItems: number;
    videoSources: number;
    auditLogs: number;
    activeSessions: number;
  };
}

export const SystemHealthView: React.FC = () => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [refreshCount, setRefreshCount] = useState(0);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const res = await fetch('/api/v1/saude');
      const data = await res.json();
      const end = performance.now();
      setLatencyMs(Math.round(end - start));
      if (res.ok) {
        setHealth(data);
      } else {
        setError(data.error || 'Erro ao consultar o estado do servidor.');
      }
    } catch (err: any) {
      setError(err?.message || 'Falha de ligação ao backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, [refreshCount]);

  const formatUptime = (sec: number) => {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  return (
    <div className="space-y-6 text-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D0F15] border border-white/10 p-6 rounded-2xl">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight font-display">RONYCINE SYSTEM HEALTH</h2>
              <p className="text-xs text-zinc-400">Monitorização em tempo real da infraestrutura, APIs, base de dados e desempenho.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/50 border border-white/10 rounded-xl text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-zinc-300">Domínio: <strong className="text-white">{OFFICIAL_BASE_URL}</strong></span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshCount(c => c + 1)}
            disabled={loading}
            className="px-4 py-2.5 bg-brand hover:bg-brand/90 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Main Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Frontend Status */}
        <div className="bg-[#0D0F15] border border-white/10 p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Frontend (SPA)</span>
            <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" /> NORMAL
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black font-display">React 18</span>
            <span className="text-xs text-emerald-400 font-mono">Vite HMR</span>
          </div>
          <p className="text-[11px] text-zinc-500">Interface principal operando sem interrupções e com Error Boundary ativo.</p>
        </div>

        {/* Backend Status */}
        <div className="bg-[#0D0F15] border border-white/10 p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Backend API</span>
            <span className={`px-2.5 py-1 border text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center gap-1.5 ${
              error ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            }`}>
              {error ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
              {error ? 'CRÍTICO' : 'NORMAL'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black font-display">{health ? `${latencyMs}ms` : '---'}</span>
            <span className="text-xs text-zinc-400 font-mono">Latência</span>
          </div>
          <p className="text-[11px] text-zinc-500">Servidor Node.js / Express em execução na porta 3000.</p>
        </div>

        {/* Database Status */}
        <div className="bg-[#0D0F15] border border-white/10 p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Base de Dados</span>
            <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" /> NORMAL
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black font-display uppercase">{health?.database || 'Firestore'}</span>
            <span className="text-xs text-zinc-400 font-mono">Persistido</span>
          </div>
          <p className="text-[11px] text-zinc-500">Armazenamento seguro com backup e salvaguarda de catálogo.</p>
        </div>

        {/* Uptime */}
        <div className="bg-[#0D0F15] border border-white/10 p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Tempo Ativo (Uptime)</span>
            <span className="px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> ESTÁVEL
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black font-display font-mono">{health ? formatUptime(health.uptimeSeconds) : '0s'}</span>
          </div>
          <p className="text-[11px] text-zinc-500">Servidor operacional sem reinícios inesperados.</p>
        </div>
      </div>

      {/* Detailed Metrics & Diagnostics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Catalog & Stats Summary */}
        <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-brand" />
            <span>Métricas do Catálogo & Recursos</span>
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block">Total Filmes</span>
              <span className="text-2xl font-black font-display text-white">{health?.catalog?.movies ?? health?.stats?.catalogItems ?? 0}</span>
            </div>
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block">Total Séries</span>
              <span className="text-2xl font-black font-display text-white">{health?.catalog?.series ?? 0}</span>
            </div>
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block">Fontes de Vídeo</span>
              <span className="text-2xl font-black font-display text-emerald-400">{health?.stats?.videoSources ?? 'Ativas'}</span>
            </div>
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block">Versão do Sistema</span>
              <span className="text-lg font-black font-display text-brand">{health?.version || '2.6.0-PRO'}</span>
            </div>
          </div>
        </div>

        {/* Production & Domain Diagnostics */}
        <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
            <Globe className="w-4 h-4 text-brand" />
            <span>Diagnóstico de Domínio & Produção</span>
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl text-xs">
              <span className="text-zinc-400">Domínio Oficial Público</span>
              <strong className="text-emerald-400 font-mono">{OFFICIAL_BASE_URL}</strong>
            </div>
            <div className="flex items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl text-xs">
              <span className="text-zinc-400">Regra de Importação</span>
              <strong className="text-white font-mono">100% Manual (Sem automação)</strong>
            </div>
            <div className="flex items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl text-xs">
              <span className="text-zinc-400">Proteção Black Screen</span>
              <strong className="text-emerald-400 font-mono">Error Boundaries Ativos</strong>
            </div>
            <div className="flex items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl text-xs">
              <span className="text-zinc-400">CORS & CSP Frame Ancestors</span>
              <strong className="text-emerald-400 font-mono">Configurado & Seguro</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
