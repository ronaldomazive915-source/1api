import React, { useEffect, useState } from 'react';
import { Download, Code2, Smartphone, Tv, Copy, Check, Database, Film, Layers } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { OFFICIAL_BASE_URL } from '../lib/siteConfig.js';
import ronycineSdkRaw from '../sdk/ronycine.ts?raw';

export const ResourcesView: React.FC = () => {
  const { navigateTo } = useAuth();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [stats, setStats] = useState({ moviesCount: 0, seriesCount: 0, episodesCount: 0 });

  const origin = OFFICIAL_BASE_URL;

  useEffect(() => {
    fetch('/api/v1/stats')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) {
          setStats({
            moviesCount: d.moviesCount || 0,
            seriesCount: d.seriesCount || 0,
            episodesCount: d.episodesCount || 0
          });
        }
      })
      .catch(() => {});
  }, []);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const webSdkSnippet = `import { Ronycine } from './ronycine';

const ronycine = new Ronycine({
  apiKey: 'rc_live_sua_chave',
  baseURL: '${origin}'
});

const filmes = await ronycine.getFilmes({ page: 1, limit: 20 });
const directMovie = await ronycine.directPlayMovie(550);
const embedFilmeUrl = ronycine.getDirectPlayEmbedUrl({ tmdbId: 550, type: 'movie' });
const embedSerieUrl = ronycine.getDirectPlayEmbedUrl({ tmdbId: 1399, type: 'tv', season: 1, episode: 1 });
console.log(embedFilmeUrl, embedSerieUrl);`;

  const kotlinSnippet = `// Retrofit Interface (Kotlin / Android)
interface RonycineApi {
    @GET("api/v1/filmes")
    suspend fun getMovies(
        @Header("x-api-key") apiKey: String,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20
    ): Response<MoviePageResponse>

    @GET("api/v1/direct-play/movie/{tmdbId}")
    suspend fun directPlayMovie(
        @Header("x-api-key") apiKey: String,
        @Path("tmdbId") tmdbId: Int
    ): Response<DirectPlayResponse>
}

// WebView Embed Loader (Direct Play Oficial)
webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true
// Filme:
webView.loadUrl("${origin}/embed/550")
// Série T01E01:
webView.loadUrl("${origin}/embed/1399/1/1")`;

  const embedSnippet = `<!-- Player Direto de Filme (TMDB ID) -->
<iframe
  src="${origin}/embed/550"
  width="100%"
  height="540"
  frameborder="0"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowfullscreen
></iframe>

<!-- Player Direto de Série / Episódio -->
<iframe
  src="${origin}/embed/1399/1/1"
  width="100%"
  height="540"
  frameborder="0"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowfullscreen
></iframe>`;

  return (
    <div className="pt-28 pb-24 bg-[#080808] min-h-screen text-zinc-200">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 space-y-12">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/10 pb-8">
          <div className="space-y-3">
            <span className="inline-block text-xs font-bold uppercase tracking-widest text-[#E50914]">
              SDK & Ferramentas Oficiais
            </span>
            <h1 className="text-3xl sm:text-5xl font-black font-display tracking-tight text-white">
              SDK Web, Android & Player Embed
            </h1>
            <p className="text-sm text-zinc-400 max-w-2xl">
              Baixe o cliente TypeScript/JavaScript real da RONYCINE API, copie os exemplos de Retrofit + WebView para Android e integre o player oficial com segurança.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigateTo('developer')}
            className="px-5 py-2.5 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg shrink-0"
          >
            Abrir Portal do Desenvolvedor
          </button>
        </div>

        {/* REAL CATALOG METRICS */}
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl bg-[#111114] border border-white/10 flex items-center gap-4">
            <div className="w-11 h-11 rounded-lg bg-[#E50914]/15 text-[#E50914] flex items-center justify-center">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-black text-white tabular-nums">{stats.moviesCount.toLocaleString('pt-PT')}</div>
              <div className="text-xs text-zinc-400">Filmes Indexados na API</div>
            </div>
          </div>
          <div className="p-5 rounded-xl bg-[#111114] border border-white/10 flex items-center gap-4">
            <div className="w-11 h-11 rounded-lg bg-[#E50914]/15 text-[#E50914] flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-black text-white tabular-nums">{stats.seriesCount.toLocaleString('pt-PT')}</div>
              <div className="text-xs text-zinc-400">Séries Ativas na API</div>
            </div>
          </div>
          <div className="p-5 rounded-xl bg-[#111114] border border-white/10 flex items-center gap-4">
            <div className="w-11 h-11 rounded-lg bg-[#E50914]/15 text-[#E50914] flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-black text-white tabular-nums">{stats.episodesCount.toLocaleString('pt-PT')}</div>
              <div className="text-xs text-zinc-400">Episódios Disponíveis</div>
            </div>
          </div>
        </div>

        {/* 1. SDK TYPESCRIPT / JS */}
        <div className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#E50914]/15 text-[#E50914] flex items-center justify-center">
                <Code2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">SDK Oficial JavaScript / TypeScript (ronycine.ts)</h2>
                <p className="text-xs text-zinc-400">Sem dependências externas. Compatível com Browser, Node.js 18+, React, Next.js e Vite.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyText(webSdkSnippet, 'web-sdk')}
                className="px-3.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold flex items-center gap-1.5"
              >
                {copiedId === 'web-sdk' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copiar Exemplo</span>
              </button>
              <button
                type="button"
                onClick={() => downloadFile(ronycineSdkRaw, 'ronycine.ts', 'text/typescript;charset=utf-8')}
                className="px-4 py-2 rounded-lg bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Baixar ronycine.ts</span>
              </button>
            </div>
          </div>
          <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto">
            {webSdkSnippet}
          </pre>
        </div>

        {/* 2. ANDROID KOTLIN */}
        <div className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Guia Android (Kotlin Retrofit + WebView)</h2>
                <p className="text-xs text-zinc-400">Integração nativa via HTTP padrão e reprodução segura em WebView.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => copyText(kotlinSnippet, 'kotlin-sdk')}
              className="px-3.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold flex items-center gap-1.5"
            >
              {copiedId === 'kotlin-sdk' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>Copiar Kotlin</span>
            </button>
          </div>
          <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto">
            {kotlinSnippet}
          </pre>
        </div>

        {/* 3. PLAYER EMBED */}
        <div className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                <Tv className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Incorporação do Player Oficial</h2>
                <p className="text-xs text-zinc-400">URL dinâmica com token HMAC temporário e proteção de domínios.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => copyText(embedSnippet, 'embed-code')}
              className="px-3.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold flex items-center gap-1.5"
            >
              {copiedId === 'embed-code' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>Copiar Snippet</span>
            </button>
          </div>
          <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto">
            {embedSnippet}
          </pre>
        </div>
      </div>
    </div>
  );
};
