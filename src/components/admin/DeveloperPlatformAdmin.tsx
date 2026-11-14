import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Globe,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Tv,
  Users
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { PlanConfig } from '../../types.js';

export const AdminDevelopersTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [usersCount, setUsersCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminDevelopers();
      setApps(res.apps || []);
      setKeys(res.keys || []);
      setUsersCount(res.usersCount || 0);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar desenvolvedores.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleStatusToggle = async (app: any) => {
    const nextStatus = app.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await api.updateAdminDeveloperApp(app.id, { status: nextStatus });
      setNotice(`Aplicação "${app.name}" marcada como ${nextStatus}.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar estado da aplicação.');
    }
  };

  const handlePlanChange = async (app: any, plan: string) => {
    try {
      await api.updateAdminDeveloperApp(app.id, { plan });
      setNotice(`Plano da aplicação "${app.name}" alterado para ${plan}.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar plano.');
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    try {
      await api.revokeAdminApiKey(keyId);
      setNotice('API Key revogada pelo administrador.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao revogar chave.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white uppercase font-display">Desenvolvedores & Aplicações</h3>
          <p className="text-xs text-zinc-400">Gerir aplicações externas, suspender acessos, atribuir planos e revogar chaves.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#E50914]' : ''}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">{error}</div>}
      {notice && <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">{notice}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Aplicações Registadas</div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{apps.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">API Keys Emitidas</div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{keys.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Contas na Plataforma</div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{usersCount}</div>
        </div>
      </div>

      <div className="bg-[#0D0F15] border border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/10 text-xs font-bold uppercase text-zinc-300">Aplicações</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/5 text-[10px] uppercase text-zinc-400">
              <tr>
                <th className="p-3.5">Aplicação</th>
                <th className="p-3.5">Proprietário</th>
                <th className="p-3.5">Domínios</th>
                <th className="p-3.5">Plano</th>
                <th className="p-3.5">Estado</th>
                <th className="p-3.5">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {apps.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-zinc-500">Nenhuma aplicação registada.</td></tr>
              ) : (
                apps.map((app) => (
                  <tr key={app.id} className="hover:bg-white/[0.02]">
                    <td className="p-3.5">
                      <div className="font-bold text-white">{app.name}</div>
                      <div className="font-mono text-[10px] text-zinc-500">{app.id}</div>
                    </td>
                    <td className="p-3.5 text-zinc-300">{app.ownerEmail || app.ownerUserId}</td>
                    <td className="p-3.5 font-mono text-[11px] text-zinc-400">
                      {app.authorizedDomains?.length ? app.authorizedDomains.join(', ') : 'Aberto'}
                    </td>
                    <td className="p-3.5">
                      <select
                        value={app.plan}
                        onChange={(e) => handlePlanChange(app, e.target.value)}
                        className="bg-black border border-white/15 rounded px-2 py-1 text-xs font-mono text-white"
                      >
                        <option value="FREE">FREE</option>
                        <option value="DEVELOPER">DEVELOPER</option>
                        <option value="PRO">PRO</option>
                        <option value="ENTERPRISE">ENTERPRISE</option>
                      </select>
                    </td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${app.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {app.status}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <button
                        type="button"
                        onClick={() => handleStatusToggle(app)}
                        className={`px-3 py-1 rounded text-[11px] font-bold ${
                          app.status === 'ACTIVE'
                            ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                            : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                        }`}
                      >
                        {app.status === 'ACTIVE' ? 'Suspender' : 'Reativar'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[#0D0F15] border border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/10 text-xs font-bold uppercase text-zinc-300">API Keys da Plataforma</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/5 text-[10px] uppercase text-zinc-400">
              <tr>
                <th className="p-3.5">Prefixo</th>
                <th className="p-3.5">App ID</th>
                <th className="p-3.5">Estado</th>
                <th className="p-3.5">Requisições</th>
                <th className="p-3.5">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {keys.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-zinc-500">Nenhuma chave emitida.</td></tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id}>
                    <td className="p-3.5 font-mono text-white">{k.keyPrefix}•••• ({k.name})</td>
                    <td className="p-3.5 font-mono text-zinc-400">{k.appId}</td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${k.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {k.status}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono tabular-nums">{k.requestCount ?? 0}</td>
                    <td className="p-3.5">
                      {k.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          onClick={() => handleRevokeKey(k.id)}
                          className="px-2.5 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 text-[11px] font-bold"
                        >
                          Revogar
                        </button>
                      ) : (
                        <span className="text-zinc-600 text-[11px]">Revogada</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const AdminMonitoringTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [monitoring, setMonitoring] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminMonitoring();
      setMonitoring(res.monitoring);
      setSettings(res.settings);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveSettings = async (next: any) => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await api.updateAdminApiConfig(next);
      setSettings(res.settings);
      setNotice('Configurações globais da API atualizadas.');
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const endpointToggles = ['/api/v1/filmes', '/api/v1/series', '/api/v1/buscar', '/api/v1/fontes', '/api/v1/player/token'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white uppercase font-display">Monitorização & Rate Limits</h3>
          <p className="text-xs text-zinc-400">Tráfego real da API v1, latência, erros e interruptores globais.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#E50914]' : ''}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {notice && <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">{notice}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Req / Minuto</div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{monitoring?.requestsLastMinute ?? 0}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Req (24h)</div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{monitoring?.requestsLast24h ?? 0}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Taxa de Erro</div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{monitoring?.errorRatePercent ?? 0}%</div>
        </div>
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Latência Média</div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{monitoring?.avgLatencyMs ?? 0} ms</div>
        </div>
      </div>

      {settings && (
        <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-5 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-white">Controlos Globais da API</h4>
          <div className="grid sm:grid-cols-2 gap-4 text-xs">
            <label className="flex items-center justify-between p-3 rounded-lg bg-black/50 border border-white/10 cursor-pointer">
              <span>API Pública v1 Ativa</span>
              <input
                type="checkbox"
                checked={Boolean(settings.enabled)}
                onChange={(e) => saveSettings({ enabled: e.target.checked })}
                className="accent-[#E50914] w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded-lg bg-black/50 border border-white/10 cursor-pointer">
              <span>Exigir API Key para /api/v1/fontes</span>
              <input
                type="checkbox"
                checked={Boolean(settings.requireKeyForSources)}
                onChange={(e) => saveSettings({ requireKeyForSources: e.target.checked })}
                className="accent-[#E50914] w-4 h-4"
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">Limite Público por IP (req/min)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={settings.publicRateLimitPerMinute ?? 45}
                  onChange={(e) => setSettings({ ...settings, publicRateLimitPerMinute: parseInt(e.target.value, 10) || 45 })}
                  className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 font-mono text-white"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveSettings({ publicRateLimitPerMinute: settings.publicRateLimitPerMinute })}
                  className="px-4 py-2 bg-[#E50914] text-white font-bold rounded-lg"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-zinc-400 mb-2">Desativar Endpoints Específicos</div>
            <div className="flex flex-wrap gap-2">
              {endpointToggles.map((ep) => {
                const disabled = (settings.disabledEndpoints || []).includes(ep);
                return (
                  <button
                    key={ep}
                    type="button"
                    onClick={() => {
                      const current: string[] = settings.disabledEndpoints || [];
                      const next = disabled ? current.filter((x) => x !== ep) : [...current, ep];
                      saveSettings({ disabledEndpoints: next });
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono border ${
                      disabled
                        ? 'bg-red-500/20 border-red-500/40 text-red-300'
                        : 'bg-black border-white/10 text-zinc-300'
                    }`}
                  >
                    {disabled ? `DESATIVADO: ${ep}` : `ATIVO: ${ep}`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-5 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-white">Endpoints Mais Acedidos</h4>
        {!monitoring?.topEndpoints?.length ? (
          <p className="text-xs text-zinc-500">Sem tráfego registado nesta sessão.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="text-zinc-500 text-[10px] uppercase border-b border-white/10">
                <tr>
                  <th className="py-2">Endpoint</th>
                  <th className="py-2">Chamadas</th>
                  <th className="py-2">Erros</th>
                  <th className="py-2">Latência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {monitoring.topEndpoints.map((ep: any) => (
                  <tr key={ep.endpoint}>
                    <td className="py-2 text-white">{ep.endpoint}</td>
                    <td className="py-2 tabular-nums">{ep.count}</td>
                    <td className="py-2 tabular-nums text-red-400">{ep.errors}</td>
                    <td className="py-2 tabular-nums text-zinc-400">{ep.avgLatencyMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const AdminPlayerDomainsTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminPlayerStats();
      setStats(res.stats);
      setSettings(res.settings);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateConfig = async (patch: any) => {
    try {
      const res = await api.updateAdminApiConfig(patch);
      setSettings(res.settings);
      setNotice('Política de Player & Domínios atualizada.');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white uppercase font-display">Player Embed & Domínios</h3>
          <p className="text-xs text-zinc-400">Sessões de reprodução, erros de fontes, bloqueios por domínio e expiração de tokens.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#E50914]' : ''}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {notice && <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">{notice}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Eventos Totais</div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{stats?.totalEvents ?? 0}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Iniciados</div>
          <div className="text-2xl font-black text-emerald-400 mt-1 tabular-nums">{stats?.startedCount ?? 0}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Erros de Fonte</div>
          <div className="text-2xl font-black text-amber-400 mt-1 tabular-nums">{stats?.errorCount ?? 0}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#0D0F15] border border-white/10">
          <div className="text-[11px] font-bold uppercase text-zinc-400">Bloqueados (Segurança)</div>
          <div className="text-2xl font-black text-red-400 mt-1 tabular-nums">{stats?.deniedCount ?? 0}</div>
        </div>
      </div>

      {settings && (
        <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-5 grid sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-zinc-400 mb-1">TTL Padrão do Token do Player (segundos)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={settings.playbackTokenTtlSeconds ?? 3600}
                onChange={(e) => setSettings({ ...settings, playbackTokenTtlSeconds: parseInt(e.target.value, 10) || 3600 })}
                className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 font-mono text-white"
              />
              <button
                type="button"
                onClick={() => updateConfig({ playbackTokenTtlSeconds: settings.playbackTokenTtlSeconds })}
                className="px-4 py-2 bg-[#E50914] text-white font-bold rounded-lg"
              >
                Guardar
              </button>
            </div>
          </div>
          <label className="flex items-center justify-between p-3 rounded-lg bg-black/50 border border-white/10 cursor-pointer self-end">
            <span>Exigir Domínio Autorizado no Embed</span>
            <input
              type="checkbox"
              checked={Boolean(settings.requireDomainForEmbed)}
              onChange={(e) => updateConfig({ requireDomainForEmbed: e.target.checked })}
              className="accent-[#E50914] w-4 h-4"
            />
          </label>
        </div>
      )}

      <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-5 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-white">Eventos Recentes do Player</h4>
        {!stats?.recentEvents?.length ? (
          <p className="text-xs text-zinc-500">Sem eventos recentes do Player Embed.</p>
        ) : (
          <div className="space-y-2">
            {stats.recentEvents.slice(0, 15).map((ev: any) => (
              <div key={ev.id} className="p-3 rounded-lg bg-black/50 border border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    ev.status === 'STARTED' ? 'bg-emerald-500/15 text-emerald-400' : ev.status === 'DENIED' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                  }`}>
                    {ev.status}
                  </span>
                  <span className="text-white">{ev.mediaType} #{ev.contentId}</span>
                  {ev.domain && <span className="text-zinc-400">({ev.domain})</span>}
                </div>
                <span className="text-zinc-500">{ev.errorMessage || new Date(ev.timestamp).toLocaleTimeString('pt-PT')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const AdminPlansTab: React.FC = () => {
  const [plans, setPlans] = useState<Record<string, PlanConfig>>({});
  const [loading, setLoading] = useState(true);
  const [savingTier, setSavingTier] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminPlans();
      setPlans((res.plans || {}) as Record<string, PlanConfig>);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSaveTier = async (tier: string) => {
    setSavingTier(tier);
    setNotice(null);
    try {
      await api.updateAdminPlan(tier, plans[tier]);
      setNotice(`Limites do plano ${tier} guardados na base de dados.`);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTier(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-white uppercase font-display">Planos & Limites de Quota</h3>
        <p className="text-xs text-zinc-400">Edite em tempo real as quotas aplicadas pelo middleware de Rate Limiting.</p>
      </div>

      {notice && <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">{notice}</div>}

      {loading ? (
        <RefreshCw className="w-6 h-6 text-[#E50914] animate-spin" />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {(Object.entries(plans) as Array<[string, PlanConfig]>).map(([tier, cfg]) => (
            <div key={tier} className="bg-[#0D0F15] border border-white/10 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-base font-black text-white">{cfg.name} ({tier})</span>
                <button
                  type="button"
                  disabled={savingTier === tier}
                  onClick={() => handleSaveTier(tier)}
                  className="px-3.5 py-1.5 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg"
                >
                  {savingTier === tier ? 'A guardar...' : 'Guardar Plano'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] text-zinc-400 uppercase mb-1">Req / Minuto</label>
                  <input
                    type="number"
                    value={cfg.requestsPerMinute}
                    onChange={(e) => setPlans({ ...plans, [tier]: { ...cfg, requestsPerMinute: parseInt(e.target.value, 10) || 1 } })}
                    className="w-full bg-black border border-white/10 rounded px-2.5 py-1.5 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 uppercase mb-1">Req / Dia</label>
                  <input
                    type="number"
                    value={cfg.dailyRequests}
                    onChange={(e) => setPlans({ ...plans, [tier]: { ...cfg, dailyRequests: parseInt(e.target.value, 10) || 10 } })}
                    className="w-full bg-black border border-white/10 rounded px-2.5 py-1.5 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 uppercase mb-1">Máx. Apps</label>
                  <input
                    type="number"
                    value={cfg.maxApps}
                    onChange={(e) => setPlans({ ...plans, [tier]: { ...cfg, maxApps: parseInt(e.target.value, 10) || 1 } })}
                    className="w-full bg-black border border-white/10 rounded px-2.5 py-1.5 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 uppercase mb-1">Máx. Domínios</label>
                  <input
                    type="number"
                    value={cfg.maxAuthorizedDomains}
                    onChange={(e) => setPlans({ ...plans, [tier]: { ...cfg, maxAuthorizedDomains: parseInt(e.target.value, 10) || 1 } })}
                    className="w-full bg-black border border-white/10 rounded px-2.5 py-1.5 font-mono text-white"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
