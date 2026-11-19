import React, { useState, useEffect } from 'react';
import {
  Activity,
  Globe,
  Smartphone,
  Tv,
  Laptop,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  BarChart3,
  Layers,
  Clock,
  Shield,
  Key,
  Database,
  ArrowUpRight,
  Monitor,
  Tablet,
  Cpu
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { ConnectionAnalyticsSummary } from '../../types.js';

export const ConnectionAnalyticsView: React.FC = () => {
  const [range, setRange] = useState<string>('7d');
  const [analytics, setAnalytics] = useState<ConnectionAnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'websites' | 'apps' | 'devices' | 'playbacks' | 'requests'>('websites');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.getConnectionAnalytics(range);
      if (res.success && res.data) {
        setAnalytics(res.data);
      }
    } catch (err) {
      console.error('Failed to load connection analytics', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [range]);

  return (
    <div className="space-y-6">
      {/* HEADER BANNER */}
      <div className="bg-gradient-to-r from-[#111319] via-[#0E1015] to-[#151820] border border-white/10 rounded-2xl p-6 sm:p-8 relative overflow-hidden shadow-2xl">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-md bg-brand text-white text-[10px] font-black uppercase tracking-widest">
                ANALYTICS & CONEXÕES
              </span>
              <span className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                TELEMETRIA ATIVA
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight font-display flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-brand shrink-0" />
              RONYCINE CONNECTION ANALYTICS
            </h1>
            <p className="text-xs text-zinc-400 max-w-2xl">
              Monitorização centralizada de websites parceiros, aplicações móveis conectadas, reproduções ativas, tráfego de API e métricas estimadas de dispositivos.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded-xl p-1">
              {['today', '7d', '30d', '90d'].map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    range === r ? 'bg-brand text-white shadow' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {r === 'today' ? 'Hoje' : r === '7d' ? '7 Dias' : r === '30d' ? '30 Dias' : '90 Dias'}
                </button>
              ))}
            </div>

            <button
              onClick={loadData}
              className="p-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl border border-white/10 transition-all"
              title="Recarregar"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-brand' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-[#0C0E14] border border-white/10 rounded-xl p-4 space-y-1">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-blue-400" /> Websites
          </span>
          <span className="text-2xl font-black text-white font-mono">{analytics?.websites?.length ?? 0}</span>
          <span className="text-[10px] text-zinc-500 block">Domínios integrados</span>
        </div>

        <div className="bg-[#0C0E14] border border-white/10 rounded-xl p-4 space-y-1">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" /> Aplicativos
          </span>
          <span className="text-2xl font-black text-white font-mono">{analytics?.apps?.length ?? 0}</span>
          <span className="text-[10px] text-zinc-500 block">Android, iOS e Web</span>
        </div>

        <div className="bg-[#0C0E14] border border-white/10 rounded-xl p-4 space-y-1">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block flex items-center gap-1.5">
            <Monitor className="w-3.5 h-3.5 text-purple-400" /> Disp. Estimados
          </span>
          <span className="text-2xl font-black text-white font-mono">{analytics?.devices?.estimatedUniqueDevices ?? 0}</span>
          <span className="text-[10px] text-zinc-500 block">Estimativa por sessão</span>
        </div>

        <div className="bg-[#0C0E14] border border-white/10 rounded-xl p-4 space-y-1">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5 text-brand" /> Reproduções
          </span>
          <span className="text-2xl font-black text-brand font-mono">{analytics?.playbacks?.playbackStarted ?? 0}</span>
          <span className="text-[10px] text-zinc-500 block">{analytics?.playbacks?.completionRatePercent ?? 0}% completas</span>
        </div>

        <div className="bg-[#0C0E14] border border-white/10 rounded-xl p-4 space-y-1">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-amber-400" /> Requisições API
          </span>
          <span className="text-2xl font-black text-white font-mono">{analytics?.apiRequests?.totalRequests ?? 0}</span>
          <span className="text-[10px] text-zinc-500 block">{analytics?.apiRequests?.avgLatencyMs ?? 0} ms latência média</span>
        </div>
      </div>

      {/* SUB-TABS */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto scrollbar-none">
        {[
          { id: 'websites', label: 'Websites Conectados', count: analytics?.websites?.length ?? 0 },
          { id: 'apps', label: 'Aplicativos Registados', count: analytics?.apps?.length ?? 0 },
          { id: 'devices', label: 'Dispositivos & Sistemas', isEstimated: true },
          { id: 'playbacks', label: 'Métricas de Reprodução' },
          { id: 'requests', label: 'Requisições da API' }
        ].map((tab: any) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-brand text-white shadow-lg shadow-brand/20'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-black/40 text-white">
                {tab.count}
              </span>
            )}
            {tab.isEstimated && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                Estimado
              </span>
            )}
          </button>
        ))}
      </div>

      {/* TAB CONTENTS */}
      <div className="bg-[#0C0E14] border border-white/10 rounded-2xl p-6 sm:p-8">
        
        {/* TAB 1: WEBSITES */}
        {activeTab === 'websites' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" /> Websites e Domínios Autorizados
              </h3>
              <span className="text-xs text-zinc-500">{analytics?.websites?.length ?? 0} websites registados</span>
            </div>

            {(!analytics?.websites || analytics.websites.length === 0) ? (
              <div className="py-12 text-center border border-dashed border-white/10 rounded-xl space-y-2">
                <Globe className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Nenhum website conectado ainda.</p>
                <p className="text-xs text-zinc-500">Adicione domínios na aba de Desenvolvedores ou através das API Keys.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {analytics.websites.map((w, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between gap-4 text-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white font-mono">{w.domain}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                            w.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {w.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Projeto: {w.projectName || 'Padrão'} · Desenvolvedor: {w.developerEmail || 'N/A'}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-white block">{w.totalSessions} sessões</span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {w.lastActivityAt ? `Atividade: ${new Date(w.lastActivityAt).toLocaleDateString('pt-PT')}` : 'Sem atividade recente'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: APPS */}
        {activeTab === 'apps' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" /> Aplicativos Registados & Dispositivos Nativos
              </h3>
              <span className="text-xs text-zinc-500">{analytics?.apps?.length ?? 0} aplicações</span>
            </div>

            {(!analytics?.apps || analytics.apps.length === 0) ? (
              <div className="py-12 text-center border border-dashed border-white/10 rounded-xl space-y-2">
                <Smartphone className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Nenhum aplicativo registado.</p>
                <p className="text-xs text-zinc-500">Cadastre aplicações Android, iOS ou Web no Portal do Desenvolvedor.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {analytics.apps.map(app => (
                  <div key={app.id} className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <h4 className="font-bold text-white text-xs">{app.name}</h4>
                        <span className="text-[10px] font-mono text-zinc-500 block truncate">{app.applicationId}</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                          app.platform === 'android' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                        }`}
                      >
                        {app.platform}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-500">Sessões:</span>
                      <span className="text-white font-bold">{app.totalSessions}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DEVICES */}
        {activeTab === 'devices' && (
          <div className="space-y-6">
            {/* ESTIMATED NOTICE */}
            <div className="bg-purple-950/20 border border-purple-500/30 rounded-xl p-4 flex items-start gap-3 text-xs">
              <Shield className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-purple-300 uppercase tracking-wider">
                  Métricas de Dispositivos Baseadas em Estimativas Pseudonimizadas
                </span>
                <p className="text-purple-200/80">
                  Os valores exibidos abaixo são estimativas anônimas computadas por sessão segura e cabeçalhos de navegador. Nenhum identificador único invasivo ou dado de rastreamento é armazenado.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* BY DEVICE TYPE */}
              <div className="bg-black/40 border border-white/10 rounded-xl p-5 space-y-4">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-brand" /> Distribuição por Tipo de Ecrã
                </h4>

                <div className="space-y-3">
                  {[
                    { label: 'Mobile (Smartphones)', val: analytics?.devices?.byType?.mobile ?? 0, icon: Smartphone, color: 'text-emerald-400' },
                    { label: 'Tablet (iPads / Android Tabs)', val: analytics?.devices?.byType?.tablet ?? 0, icon: Tablet, color: 'text-blue-400' },
                    { label: 'Desktop (Computadores & Laptops)', val: analytics?.devices?.byType?.desktop ?? 0, icon: Laptop, color: 'text-purple-400' },
                    { label: 'Smart TV / Android TV / Box', val: analytics?.devices?.byType?.tv ?? 0, icon: Tv, color: 'text-amber-400' }
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-zinc-300">
                        <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
                        <span>{item.label}</span>
                      </span>
                      <span className="font-mono font-bold text-white">{item.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* BY OS */}
              <div className="bg-black/40 border border-white/10 rounded-xl p-5 space-y-4">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-brand" /> Distribuição por Sistema Operativo
                </h4>

                <div className="space-y-3">
                  {Object.entries(analytics?.devices?.byOs || {}).length === 0 ? (
                    <p className="text-xs text-zinc-500">Sem dados de telemetria de sistema no período.</p>
                  ) : (
                    Object.entries(analytics?.devices?.byOs || {}).map(([os, count]) => (
                      <div key={os} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300 capitalize">{os}</span>
                        <span className="font-mono font-bold text-white">{count}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PLAYBACKS */}
        {activeTab === 'playbacks' && (
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Play className="w-4 h-4 text-brand" /> Estatísticas Reais de Reprodução
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-black/40 border border-white/10 rounded-xl p-4">
                <span className="text-[10px] text-zinc-500 uppercase block">Players Carregados</span>
                <span className="text-xl font-bold font-mono text-white">{analytics?.playbacks?.playersLoaded ?? 0}</span>
              </div>
              <div className="bg-black/40 border border-white/10 rounded-xl p-4">
                <span className="text-[10px] text-zinc-500 uppercase block">Playbacks Iniciados</span>
                <span className="text-xl font-bold font-mono text-emerald-400">{analytics?.playbacks?.playbackStarted ?? 0}</span>
              </div>
              <div className="bg-black/40 border border-white/10 rounded-xl p-4">
                <span className="text-[10px] text-zinc-500 uppercase block">Playbacks Concluídos</span>
                <span className="text-xl font-bold font-mono text-blue-400">{analytics?.playbacks?.playbackCompleted ?? 0}</span>
              </div>
              <div className="bg-black/40 border border-white/10 rounded-xl p-4">
                <span className="text-[10px] text-zinc-500 uppercase block">Erros de Reprodução</span>
                <span className="text-xl font-bold font-mono text-red-400">{analytics?.playbacks?.playbackErrors ?? 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: API REQUESTS */}
        {activeTab === 'requests' && (
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" /> Tráfego de API por Endpoint
            </h3>

            {(!analytics?.apiRequests?.byEndpoint || analytics.apiRequests.byEndpoint.length === 0) ? (
              <p className="text-xs text-zinc-500">Sem chamadas externas registadas no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="border-b border-white/10 text-zinc-400 uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Endpoint</th>
                      <th className="py-2.5 px-3">Total Requisições</th>
                      <th className="py-2.5 px-3">Erros</th>
                      <th className="py-2.5 px-3">Latência Média</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {analytics.apiRequests.byEndpoint.map((ep, i) => (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3 text-white font-bold">{ep.endpoint}</td>
                        <td className="py-2.5 px-3 text-zinc-300">{ep.count}</td>
                        <td className="py-2.5 px-3 text-red-400">{ep.errors}</td>
                        <td className="py-2.5 px-3 text-zinc-400">{ep.avgLatencyMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
