import React, { useEffect, useState } from 'react';
import { Globe, ShieldCheck, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export const Footer: React.FC = () => {
  const { navigateTo } = useAuth();
  const [apiStatus, setApiStatus] = useState<'ONLINE' | 'OFFLINE'>('ONLINE');

  useEffect(() => {
    fetch('/api/v1/saude')
      .then((res) => (res.ok ? setApiStatus('ONLINE') : setApiStatus('OFFLINE')))
      .catch(() => setApiStatus('OFFLINE'));
  }, []);

  return (
    <footer className="bg-[#080808] border-t border-white/10 pt-16 pb-24 md:pb-16 text-zinc-500 text-xs">
      <div className="max-w-[1600px] mx-auto px-6 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 pb-12 border-b border-white/10">
          {/* BRAND COL */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#E50914] flex items-center justify-center shadow-lg shadow-[#E50914]/20">
                <Globe className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-black text-white tracking-tight font-display uppercase">
                RONYCINE <span className="text-[#E50914]">API</span>
              </span>
            </div>
            <p className="text-zinc-400 leading-relaxed text-xs">
              Plataforma de distribuição de API REST, Player Embed oficial e SDK para aplicativos Web e Android integrados ao catálogo central RONYCINE.
            </p>
            <div className="flex items-center gap-4 pt-1 text-[11px] font-semibold">
              <div className={`flex items-center gap-1.5 ${apiStatus === 'ONLINE' ? 'text-emerald-400' : 'text-red-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${apiStatus === 'ONLINE' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span>API v1 {apiStatus === 'ONLINE' ? 'Operacional' : 'Indisponível'}</span>
              </div>
              <div className="flex items-center gap-1 text-zinc-400">
                <ShieldCheck className="w-3.5 h-3.5 text-[#E50914]" />
                <span>Tokens HMAC</span>
              </div>
            </div>
          </div>

          {/* PLATAFORMA */}
          <div className="md:ml-auto">
            <h4 className="text-[11px] font-bold text-white uppercase tracking-wider mb-4">Plataforma</h4>
            <ul className="space-y-2.5">
              <li>
                <button type="button" onClick={() => navigateTo('home')} className="hover:text-white transition-colors">
                  Início
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('movies')} className="hover:text-white transition-colors">
                  Catálogo de Filmes
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('series')} className="hover:text-white transition-colors">
                  Catálogo de Séries
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('developer')} className="hover:text-white transition-colors">
                  Portal do Desenvolvedor
                </button>
              </li>
            </ul>
          </div>

          {/* DESENVOLVEDORES */}
          <div className="md:ml-auto">
            <h4 className="text-[11px] font-bold text-white uppercase tracking-wider mb-4">Desenvolvedores</h4>
            <ul className="space-y-2.5">
              <li>
                <button type="button" onClick={() => navigateTo('documentation')} className="hover:text-white transition-colors">
                  Documentação da API
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('playground')} className="hover:text-white transition-colors">
                  Playground Interativo
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('resources')} className="hover:text-white transition-colors">
                  SDK Oficial & Android
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('plans')} className="hover:text-white transition-colors">
                  Planos e Limites
                </button>
              </li>
            </ul>
          </div>

          {/* CONTA & GESTÃO */}
          <div className="md:ml-auto">
            <h4 className="text-[11px] font-bold text-white uppercase tracking-wider mb-4">Suporte & Gestão</h4>
            <ul className="space-y-2.5">
              <li>
                <button type="button" onClick={() => navigateTo('faq')} className="hover:text-white transition-colors">
                  Dúvidas Frequentes
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('login')} className="hover:text-white transition-colors">
                  Acesso Desenvolvedor
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('status')} className="text-emerald-400 hover:text-emerald-300 font-semibold transition-colors flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Status do Sistema</span>
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('admin')} className="text-zinc-400 hover:text-[#E50914] transition-colors">
                  Painel Administrativo
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-zinc-600 gap-4 text-[11px]">
          <p>© {new Date().getFullYear()} RONYCINE API. Todos os direitos reservados.</p>
          <div className="flex items-center gap-3 text-zinc-500 font-mono">
            <span>API REST v1</span>
            <Zap className="w-3 h-3 text-[#E50914]" />
            <span>EMBED PLAYER + SDK</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
