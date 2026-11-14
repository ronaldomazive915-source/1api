import React, { useState } from 'react';
import { Terminal, Send, Copy, Check, RefreshCw, Globe, KeyRound, Plus, Trash2 } from 'lucide-react';

interface ParamRow {
  key: string;
  value: string;
}

const PRESETS = [
  { label: 'Listar Filmes (Paginado)', method: 'GET' as const, path: '/api/v1/filmes', params: [{ key: 'page', value: '1' }, { key: 'limit', value: '5' }], body: '' },
  { label: 'Detalhes do Filme (550)', method: 'GET' as const, path: '/api/v1/filmes/550', params: [], body: '' },
  { label: 'Listar Séries', method: 'GET' as const, path: '/api/v1/series', params: [{ key: 'page', value: '1' }, { key: 'limit', value: '5' }], body: '' },
  { label: 'Episódio S01E01 (1399)', method: 'GET' as const, path: '/api/v1/series/1399/temporadas/1/episodios/1', params: [], body: '' },
  { label: 'Buscar no Catálogo', method: 'GET' as const, path: '/api/v1/buscar', params: [{ key: 'q', value: 'Fight' }, { key: 'type', value: 'all' }], body: '' },
  { label: 'Fontes de Vídeo (550)', method: 'GET' as const, path: '/api/v1/fontes/550', params: [{ key: 'type', value: 'movie' }], body: '' },
  {
    label: 'Gerar Token Player (POST)',
    method: 'POST' as const,
    path: '/api/v1/player/token',
    params: [],
    body: JSON.stringify({ contentId: 550, mediaType: 'movie', ttlSeconds: 3600 }, null, 2)
  }
];

export const PlaygroundView: React.FC = () => {
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [endpoint, setEndpoint] = useState('/api/v1/filmes');
  const [apiKey, setApiKey] = useState('');
  const [params, setParams] = useState<ParamRow[]>([
    { key: 'page', value: '1' },
    { key: 'limit', value: '5' }
  ]);
  const [bodyJson, setBodyJson] = useState(
    JSON.stringify({ contentId: 550, mediaType: 'movie', ttlSeconds: 3600 }, null, 2)
  );
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [response, setResponse] = useState<{
    url: string;
    status: number;
    timeMs: number;
    rateHeaders: Record<string, string>;
    data: any;
  } | null>(null);

  const buildRequestUrl = () => {
    const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const q = new URLSearchParams();
    params.forEach((p) => {
      if (p.key.trim()) q.set(p.key.trim(), p.value.trim());
    });
    const qs = q.toString();
    return qs ? `${cleanPath}${cleanPath.includes('?') ? '&' : '?'}${qs}` : cleanPath;
  };

  const handleSend = async () => {
    setLoading(true);
    const targetUrl = buildRequestUrl();
    const startedAt = performance.now();
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey.trim()) headers['x-api-key'] = apiKey.trim();
      if (method === 'POST') headers['Content-Type'] = 'application/json';

      const res = await fetch(targetUrl, {
        method,
        headers,
        body: method === 'POST' ? bodyJson : undefined
      });
      const timeMs = Math.round(performance.now() - startedAt);
      const rateHeaders: Record<string, string> = {};
      ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-daily-limit', 'x-ratelimit-daily-remaining'].forEach((h) => {
        const val = res.headers.get(h);
        if (val !== null) rateHeaders[h] = val;
      });
      const data = await res.json().catch(() => ({ rawStatus: res.status }));
      setResponse({ url: targetUrl, status: res.status, timeMs, rateHeaders, data });
    } catch (err: any) {
      setResponse({
        url: targetUrl,
        status: 0,
        timeMs: Math.round(performance.now() - startedAt),
        rateHeaders: {},
        data: { error: err?.message || 'Erro de rede ao executar pedido' }
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyResponse = () => {
    if (!response) return;
    navigator.clipboard.writeText(JSON.stringify(response.data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="pt-28 pb-20 px-4 sm:px-8 max-w-[1500px] mx-auto min-h-screen bg-[#080808]">
      <div className="flex flex-col gap-6">
        <div className="space-y-2 border-b border-white/10 pb-6">
          <div className="flex items-center gap-2 text-[#E50914]">
            <Terminal className="w-4 h-4" />
            <span className="text-xs font-black uppercase tracking-widest">API Playground Real</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white font-display">
            Teste a RONYCINE API em Tempo Real
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl">
            Execute requisições HTTP reais diretamente contra os endpoints <code className="text-emerald-400">/api/v1/*</code>, valide a sua <code className="text-zinc-200">x-api-key</code> e inspecione cabeçalhos de Rate Limiting.
          </p>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setMethod(p.method);
                setEndpoint(p.path);
                setParams(p.params.length ? p.params : []);
                if (p.body) setBodyJson(p.body);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#111114] hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300"
            >
              <span className={p.method === 'POST' ? 'text-blue-400 font-mono mr-1.5' : 'text-emerald-400 font-mono mr-1.5'}>
                {p.method}
              </span>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6 items-stretch">
          {/* Request Panel */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-5 flex flex-col">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <Globe className="w-4 h-4 text-[#E50914]" />
              <h3>Configuração da Requisição</h3>
            </div>

            <div className="flex gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
                className="bg-black border border-white/15 rounded-lg px-3 py-2.5 text-xs font-mono font-bold text-[#E50914] outline-none"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="flex-1 bg-black border border-white/15 rounded-lg px-3 py-2.5 text-xs text-white outline-none focus:border-[#E50914] font-mono"
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400 uppercase mb-1.5">
                <KeyRound className="w-3.5 h-3.5 text-[#E50914]" />
                <span>API Key (Header x-api-key)</span>
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="rc_live_... (opcional para rotas públicas)"
                className="w-full bg-black border border-white/15 rounded-lg px-3 py-2 text-xs text-emerald-400 outline-none focus:border-[#E50914] font-mono"
              />
            </div>

            {/* Query Parameters */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Query Params</span>
                <button
                  type="button"
                  onClick={() => setParams((prev) => [...prev, { key: '', value: '' }])}
                  className="text-[11px] font-bold text-[#E50914] hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Adicionar</span>
                </button>
              </div>
              {params.length === 0 ? (
                <p className="text-xs text-zinc-600">Sem parâmetros de consulta.</p>
              ) : (
                <div className="space-y-2">
                  {params.map((row, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        placeholder="Chave"
                        value={row.key}
                        onChange={(e) =>
                          setParams((prev) => prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))
                        }
                        className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
                      />
                      <input
                        placeholder="Valor"
                        value={row.value}
                        onChange={(e) =>
                          setParams((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))
                        }
                        className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setParams((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-zinc-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {method === 'POST' && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1.5">JSON Body</label>
                <textarea
                  rows={5}
                  value={bodyJson}
                  onChange={(e) => setBodyJson(e.target.value)}
                  className="w-full bg-black border border-white/15 rounded-lg p-3 text-xs font-mono text-zinc-200 outline-none focus:border-[#E50914]"
                />
              </div>
            )}

            <button
              type="button"
              onClick={handleSend}
              disabled={loading}
              className="mt-auto w-full py-3 bg-[#E50914] hover:bg-[#b80710] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>Executar Requisição Real</span>
            </button>
          </div>

          {/* Response Panel */}
          <div className="bg-black border border-white/10 rounded-2xl flex flex-col overflow-hidden min-h-[420px]">
            <div className="px-5 py-3.5 bg-[#111114] border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="font-bold text-zinc-400 uppercase">Resposta</span>
                {response && (
                  <>
                    <span
                      className={`px-2 py-0.5 rounded font-bold ${
                        response.status >= 200 && response.status < 300
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      HTTP {response.status}
                    </span>
                    <span className="text-zinc-400 tabular-nums">{response.timeMs} ms</span>
                    {response.rateHeaders['x-ratelimit-remaining'] && (
                      <span className="text-zinc-500">
                        Rate: {response.rateHeaders['x-ratelimit-remaining']}/{response.rateHeaders['x-ratelimit-limit']}
                      </span>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={handleCopyResponse}
                disabled={!response}
                className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white disabled:opacity-30 flex items-center gap-1 text-xs"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>

            <div className="flex-1 p-5 font-mono text-xs overflow-auto max-h-[560px]">
              {response ? (
                <pre className="text-emerald-400 leading-relaxed">
                  {JSON.stringify(response.data, null, 2)}
                </pre>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-3">
                  <Terminal className="w-10 h-10 opacity-30" />
                  <p className="text-xs font-semibold uppercase tracking-wider">Clique em Executar Requisição Real</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
