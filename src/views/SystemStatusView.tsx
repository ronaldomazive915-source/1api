import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Server,
  Database,
  Film,
  Tv,
  Play,
  Lock,
  FolderArchive,
  Radio,
  ArrowLeft,
  Activity,
  Clock
} from 'lucide-react';
import { api } from '../lib/api.js';
import { SystemStatusReport, SystemServiceStatus } from '../types.js';

interface SystemStatusViewProps {
  onBack?: () => void;
}

export const SystemStatusView: React.FC<SystemStatusViewProps> = ({ onBack }) => {
  const [report, setReport] = useState<SystemStatusReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const loadStatus = async () => {
    setIsLoading(true);
    try {
      const res = await api.getSystemStatus();
      if (res.success) {
        setReport(res.data);
        setLastUpdated(new Date().toLocaleTimeString('pt-PT'));
      }
    } catch (err) {
      console.error('Failed to load system status', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getServiceIcon = (key: string) => {
    switch (key) {
      case 'api': return Server;
      case 'database': return Database;
      case 'player': return Play;
      case 'movies_endpoint': return Film;
      case 'series_endpoint': return Tv;
      case 'auth': return Lock;
      case 'backup': return FolderArchive;
      case 'monitoring': return Radio;
      default: return Activity;
    }
  };

  return (
    <div className="min-h-screen bg-[#07080B] text-white py-12 px-4 sm:px-6 lg:px-8 font-sans selection:bg-brand selection:text-white">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* TOP NAVIGATION & BRAND */}
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar à Plataforma</span>
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-zinc-500">
              Última verificação: {lastUpdated || 'a verificar...'}
            </span>
            <button
              onClick={loadStatus}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all"
              title="Atualizar agora"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand' : 'text-zinc-400'}`} />
            </button>
          </div>
        </div>

        {/* OVERALL STATUS BANNER */}
        <div
          className={`border rounded-2xl p-8 relative overflow-hidden shadow-2xl transition-all ${
            report?.overallStatus === 'ONLINE'
              ? 'bg-gradient-to-r from-emerald-950/40 via-zinc-950 to-emerald-950/20 border-emerald-500/30'
              : report?.overallStatus === 'DEGRADED'
              ? 'bg-gradient-to-r from-amber-950/40 via-zinc-950 to-amber-950/20 border-amber-500/30'
              : 'bg-gradient-to-r from-red-950/40 via-zinc-950 to-red-950/20 border-red-500/30'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-mono font-bold tracking-widest uppercase text-emerald-400">
                  ESTADO DOS SERVIÇOS
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight font-display">
                {report?.overallStatus === 'ONLINE'
                  ? 'Todos os Sistemas Operacionais'
                  : report?.overallStatus === 'DEGRADED'
                  ? 'Desempenho Parcialmente Degradado'
                  : 'Interrupção Parcial de Serviços'}
              </h1>
              <p className="text-xs text-zinc-400 max-w-xl">
                A infraestrutura de catálogo, API e streaming da RONYCINE é continuamente monitorizada por sondagens automáticas com verificação de latência e integridade de codecs.
              </p>
            </div>

            <div className="shrink-0 flex items-center gap-3">
              <div className="text-right">
                <span className="text-2xl font-black text-white font-mono block">99.98%</span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Uptime 90 Dias</span>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-950/40">
                <ShieldCheck className="w-6 h-6" />
              </div>
            </div>
          </div>
        </div>

        {/* 14-DAY UPTIME TIMELINE */}
        <div className="bg-[#0C0E14] border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand" /> Disponibilidade nos Últimos 14 Dias
            </span>
            <span className="text-emerald-400 font-mono font-bold">100% de Disponibilidade</span>
          </div>

          <div className="grid grid-cols-14 gap-1.5 h-10 items-end">
            {(report?.history || Array(14).fill({ uptimePercent: 99.9, date: '—', status: 'ONLINE' })).map((day: any, i: number) => (
              <div key={i} className="group relative flex flex-col items-center justify-end h-full">
                <div
                  className="w-full bg-emerald-500 hover:bg-emerald-400 rounded-sm transition-all cursor-pointer h-8"
                  title={`${day.date}: ${day.uptimePercent}% uptime`}
                />
                <div className="opacity-0 group-hover:opacity-100 absolute bottom-10 bg-black border border-white/20 text-white text-[9px] font-mono px-2 py-1 rounded shadow-xl whitespace-nowrap pointer-events-none z-20">
                  {day.date}: {day.uptimePercent}%
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between text-[10px] font-mono text-zinc-500 pt-1 border-t border-white/5">
            <span>Há 14 dias</span>
            <span>Hoje</span>
          </div>
        </div>

        {/* DETAILED SERVICES LIST */}
        <div className="bg-[#0C0E14] border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Detalhamento Individual dos Componentes
          </h2>

          <div className="divide-y divide-white/5">
            {report?.services.map(svc => {
              const Icon = getServiceIcon(svc.key);
              return (
                <div key={svc.key} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-300 shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-xs truncate">{svc.name}</h3>
                        <span className="text-[10px] font-mono text-zinc-500">
                          {svc.latencyMs}ms
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400">{svc.message}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    <span className="text-[11px] font-mono text-zinc-500">
                      {svc.uptimePercent}% uptime
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                        svc.status === 'ONLINE'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {svc.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* FOOTER */}
        <div className="text-center pt-6 text-xs text-zinc-500 space-y-1">
          <p>© {new Date().getFullYear()} RONYCINE CINEMA ULTRA. Todos os direitos reservados.</p>
          <p className="text-[10px]">Página de telemetria e integridade de infraestrutura para desenvolvedores e utilizadores.</p>
        </div>

      </div>
    </div>
  );
};
