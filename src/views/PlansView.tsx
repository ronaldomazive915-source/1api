import React, { useEffect, useState } from 'react';
import { Check, Zap, Shield, Globe, Cpu, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { PlanConfig } from '../types.js';

export const PlansView: React.FC = () => {
  const { navigateTo } = useAuth();
  const [plans, setPlans] = useState<PlanConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getV1Plans()
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setPlans(res.data);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="pt-28 pb-24 bg-[#080808] min-h-screen selection:bg-[#E50914]/30 selection:text-white">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 space-y-14">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[#E50914]/10 border border-[#E50914]/30 text-[#E50914] text-xs font-bold uppercase tracking-wider">
            Quotas & Limites Reais da API
          </div>
          <h1 className="text-3xl sm:text-5xl font-black font-display tracking-tight text-white">
            Planos e Limites de Integração
          </h1>
          <p className="text-sm text-zinc-400 max-w-2xl mx-auto">
            Limites aplicados diretamente pelo servidor em tempo real por aplicação e API Key. Crie uma conta no Portal do Desenvolvedor para começar com o plano FREE.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-7 h-7 text-[#E50914] animate-spin" />
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {plans.map((plan) => {
              const highlight = plan.tier === 'PRO';
              return (
                <div
                  key={plan.tier}
                  className={`relative p-6 rounded-2xl border flex flex-col justify-between ${
                    highlight
                      ? 'bg-[#121216] border-[#E50914] shadow-[0_0_30px_rgba(229,9,20,0.12)]'
                      : 'bg-[#111114] border-white/10'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h3 className="text-lg font-black text-white">{plan.name}</h3>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white/10 text-zinc-300">
                        {plan.tier}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed mb-6 min-h-[36px]">
                      {plan.description}
                    </p>

                    <div className="space-y-3 text-xs border-t border-white/10 pt-4 mb-6">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Req / Minuto</span>
                        <span className="font-mono font-bold text-white tabular-nums">
                          {plan.requestsPerMinute.toLocaleString('pt-PT')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Req / Dia</span>
                        <span className="font-mono font-bold text-white tabular-nums">
                          {plan.dailyRequests.toLocaleString('pt-PT')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Máx. Aplicações</span>
                        <span className="font-mono font-bold text-white tabular-nums">{plan.maxApps}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Domínios / App</span>
                        <span className="font-mono font-bold text-white tabular-nums">{plan.maxAuthorizedDomains}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Sessões Player / h</span>
                        <span className="font-mono font-bold text-white tabular-nums">
                          {plan.maxPlaybackSessionsPerHour.toLocaleString('pt-PT')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-2 text-zinc-300">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>Player Embed Oficial {plan.allowEmbedPlayer ? 'Incluído' : 'Restrito'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-300">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>Fontes Diretas {plan.allowSourcesEndpoint ? 'Liberadas' : 'Limitadas'}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => navigateTo('developer')}
                    className={`w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all ${
                      highlight
                        ? 'bg-[#E50914] text-white hover:bg-[#b80710]'
                        : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
                    }`}
                  >
                    {plan.tier === 'FREE' ? 'Começar no Portal Dev' : 'Gerir Aplicação'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-6 border-t border-white/10">
          {[
            { title: 'Rate Limiting Real', icon: Zap, desc: 'Janela deslizante por minuto e quota diária verificada em cada chave.' },
            { title: 'Segurança SHA-256', icon: Shield, desc: 'API Keys armazenadas apenas em hash SHA-256 e tokens HMAC no player.' },
            { title: 'Controle de Domínios', icon: Globe, desc: 'Restrição por Origin/Referer e CSP frame-ancestors por aplicação.' },
            { title: 'Monitorização Ao Vivo', icon: Cpu, desc: 'Métricas reais de latência, erros e chamadas no Portal Dev e Admin.' }
          ].map((benefit) => (
            <div key={benefit.title} className="space-y-2.5 bg-[#111114] border border-white/10 rounded-xl p-5">
              <div className="w-10 h-10 rounded-lg bg-[#E50914]/10 flex items-center justify-center text-[#E50914]">
                <benefit.icon className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm text-white">{benefit.title}</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">{benefit.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
