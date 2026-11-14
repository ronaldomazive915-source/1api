import React, { useState } from 'react';
import { Activity, Server, Database, Globe, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Shield, Play, Check } from 'lucide-react';
import { api } from '../../lib/api.js';

interface DiagnosticResult {
  step: string;
  status: 'OK' | 'ERRO' | 'CONFIRMADA' | 'NÃO CONFIRMADA' | 'PENDENTE';
  message: string;
}

export const SourceDiagnosticsView: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [testTmdbId, setTestTmdbId] = useState('550');
  const [testType, setTestType] = useState<'movie' | 'tv'>('movie');

  const runDiagnostics = async () => {
    setRunning(true);
    const checks: DiagnosticResult[] = [];
    const idNum = parseInt(testTmdbId, 10) || 550;

    // 1. DATABASE CHECK
    try {
      const saude = await fetch('/api/v1/saude').then(r => r.json());
      if (saude.success || saude.data?.status === 'ONLINE') {
        checks.push({ step: 'DATABASE', status: 'OK', message: 'Conexão com a base de dados operando normalmente.' });
      } else {
        checks.push({ step: 'DATABASE', status: 'ERRO', message: 'Falha na resposta de saúde da base de dados.' });
      }
    } catch (err: any) {
      checks.push({ step: 'DATABASE', status: 'ERRO', message: err?.message || 'Exceção ao contactar base de dados.' });
    }

    // 2. ASSOCIATION CHECK
    try {
      const sources = await api.getPlayerSources({ tmdbId: idNum, type: testType });
      if (sources && sources.length > 0) {
        checks.push({ step: 'ASSOCIAÇÃO', status: 'OK', message: `${sources.length} fonte(s) ativa(s) associada(s) ao conteúdo TMDB #${idNum}.` });
      } else {
        checks.push({ step: 'ASSOCIAÇÃO', status: 'ERRO', message: `Nenhuma fonte encontrada associada ao TMDB #${idNum}.` });
      }
    } catch (err: any) {
      checks.push({ step: 'ASSOCIAÇÃO', status: 'ERRO', message: err?.message || 'Erro ao consultar fontes associadas.' });
    }

    // 3. API CHECK (Direct Play)
    try {
      const dpUrl = testType === 'movie' ? `/api/v1/direct-play/movie/${idNum}` : `/api/v1/direct-play/tv/${idNum}/1/1`;
      const dpRes = await fetch(dpUrl).then(r => r.json());
      if (dpRes.success || dpRes.state === 'READY') {
        checks.push({ step: 'API', status: 'OK', message: `Endpoint Direct Play devolveu sucesso (State: ${dpRes.state || 'READY'}).` });
      } else {
        checks.push({ step: 'API', status: 'ERRO', message: dpRes.message || dpRes.error || 'Endpoint Direct Play sem fontes disponíveis.' });
      }
    } catch (err: any) {
      checks.push({ step: 'API', status: 'ERRO', message: err?.message || 'Falha ao consultar API Direct Play.' });
    }

    // 4. PLAYER SESSION CHECK
    try {
      const sessRes = await fetch(`/api/player/${idNum}/session?type=${testType}`).then(r => r.json());
      if (sessRes.success && sessRes.source) {
        checks.push({ step: 'PLAYER', status: 'OK', message: `Sessão do player inicializada com fonte: ${sessRes.source.label || sessRes.source.url}` });
      } else {
        checks.push({ step: 'PLAYER', status: 'ERRO', message: sessRes.error || 'Sessão do player não pôde inicializar.' });
      }
    } catch (err: any) {
      checks.push({ step: 'PLAYER', status: 'ERRO', message: err?.message || 'Exceção na sessão do player.' });
    }

    // 5. REPRODUÇÃO CHECK
    try {
      const dpUrl = testType === 'movie' ? `/api/v1/direct-play/movie/${idNum}` : `/api/v1/direct-play/tv/${idNum}/1/1`;
      const dpRes = await fetch(dpUrl).then(r => r.json());
      if (dpRes.source?.url) {
        checks.push({ step: 'REPRODUÇÃO', status: 'CONFIRMADA', message: `URL de reprodução pronta para streaming: ${dpRes.source.url}` });
      } else {
        checks.push({ step: 'REPRODUÇÃO', status: 'NÃO CONFIRMADA', message: 'Nenhuma URL de streaming confirmada para este teste.' });
      }
    } catch {
      checks.push({ step: 'REPRODUÇÃO', status: 'NÃO CONFIRMADA', message: 'Não foi possível confirmar reprodução.' });
    }

    setResults(checks);
    setRunning(false);
  };

  return (
    <div className="space-y-6 text-white max-w-6xl mx-auto pb-12">
      <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight font-display">RONYCINE SOURCE DIAGNOSTICS</h2>
              <p className="text-xs text-zinc-400">Diagnóstico avançado de persistência, associação, endpoints de API e prontidão de reprodução.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={testType}
            onChange={e => setTestType(e.target.value as any)}
            className="bg-black border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-brand outline-none"
          >
            <option value="movie">Filme</option>
            <option value="tv">Série (Temp 1 / Ep 1)</option>
          </select>
          <input
            type="number"
            value={testTmdbId}
            onChange={e => setTestTmdbId(e.target.value)}
            placeholder="TMDB ID"
            className="bg-black border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-brand outline-none w-28 font-mono"
          />
          <button
            type="button"
            onClick={runDiagnostics}
            disabled={running}
            className="px-5 py-2.5 bg-brand hover:bg-brand/90 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            <span>Executar Diagnóstico</span>
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Resultados da Auditoria de Fontes</h3>
          <div className="space-y-3">
            {results.map((res, idx) => (
              <div key={idx} className="bg-black/50 border border-white/5 p-4 rounded-xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    res.status === 'OK' || res.status === 'CONFIRMADA' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
                  }`}>
                    {res.status === 'OK' || res.status === 'CONFIRMADA' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-tight text-white font-mono">{res.step}</h4>
                    <p className="text-xs text-zinc-400 mt-0.5">{res.message}</p>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                  res.status === 'OK' || res.status === 'CONFIRMADA' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                  {res.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
