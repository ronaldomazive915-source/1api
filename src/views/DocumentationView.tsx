import React, { useState } from 'react';
import {
  Book,
  Terminal,
  Code2,
  Copy,
  Check,
  Play,
  KeyRound,
  ShieldCheck,
  Tv,
  Smartphone,
  Zap,
  Film,
  Layers,
  Database,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
  Link2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../lib/api.js';
import { resolveTmdbPosterUrl } from '../lib/mediaUtils.js';
import {
  OFFICIAL_BASE_URL,
  buildOfficialEmbedPath,
  buildOfficialEmbedUrl
} from '../lib/siteConfig.js';

interface EndpointDoc {
  id: string;
  section: 'filmes' | 'series' | 'episodios' | 'fontes' | 'direct-play' | 'auth' | 'geral';
  method: 'GET' | 'POST';
  path: string;
  samplePath: string;
  desc: string;
  sampleBody?: string;
}

export const DocumentationView: React.FC = () => {
  const { navigateTo } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [testResult, setTestResult] = useState<{
    endpoint: string;
    status: number;
    latencyMs: number;
    body: any;
  } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Interactive Integration Language Tab
  const [integrationTab, setIntegrationTab] = useState<'js' | 'html' | 'react' | 'android'>('js');

  // Interactive RONYCINE EMBED DIRECT PLAY Tester State
  const [dpTmdbId, setDpTmdbId] = useState<string>('550');
  const [dpType, setDpType] = useState<'movie' | 'tv'>('movie');
  const [dpSeason, setDpSeason] = useState<string>('1');
  const [dpEpisode, setDpEpisode] = useState<string>('1');
  const [dpLoading, setDpLoading] = useState<boolean>(false);
  const [generatedEmbedUrl, setGeneratedEmbedUrl] = useState<string>('');
  const [dpResult, setDpResult] = useState<{
    latencyMs: number;
    response: any;
    parsedId: number;
    parsedSeason?: number;
    parsedEpisode?: number;
    type: 'movie' | 'tv';
  } | null>(null);

  const baseUrl = OFFICIAL_BASE_URL;

  const liveEmbedPath = buildOfficialEmbedPath({
    type: dpType,
    tmdbId: dpTmdbId.trim() || '550',
    season: dpSeason.trim() || '1',
    episode: dpEpisode.trim() || '1'
  });

  const liveOfficialEmbedUrl = buildOfficialEmbedUrl({
    type: dpType,
    tmdbId: dpTmdbId.trim() || '550',
    season: dpSeason.trim() || '1',
    episode: dpEpisode.trim() || '1'
  });

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const testEndpoint = async (ep: EndpointDoc) => {
    setLoadingId(ep.id);
    setTestResult(null);
    const start = performance.now();
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKeyInput.trim()) headers['x-api-key'] = apiKeyInput.trim();
      if (ep.method === 'POST') headers['Content-Type'] = 'application/json';
      const res = await fetch(ep.samplePath, {
        method: ep.method,
        headers,
        body: ep.method === 'POST' ? ep.sampleBody : undefined
      });
      const latencyMs = Math.round(performance.now() - start);
      const data = await res.json().catch(() => ({ status: res.status }));
      setTestResult({
        endpoint: `${baseUrl}${ep.samplePath}`,
        status: res.status,
        latencyMs,
        body: data
      });
    } catch (err: any) {
      setTestResult({
        endpoint: `${baseUrl}${ep.samplePath}`,
        status: 0,
        latencyMs: Math.round(performance.now() - start),
        body: { error: err?.message || 'Falha ao conectar com a API' }
      });
    } finally {
      setLoadingId(null);
    }
  };

  const handleGenerateUrl = () => {
    const numericId = Number(dpTmdbId.trim());
    if (!numericId || isNaN(numericId) || numericId <= 0) {
      setGeneratedEmbedUrl('');
      setDpResult({
        latencyMs: 0,
        parsedId: 0,
        type: dpType,
        response: {
          success: false,
          state: 'INVALID_PARAMS',
          code: 'INVALID_PARAMS',
          message: 'Informe um TMDB ID numérico positivo (ex: 550 ou 1399) antes de gerar a URL.',
          sources: []
        }
      });
      return;
    }
    setGeneratedEmbedUrl(liveOfficialEmbedUrl);
  };

  const handleTestDirectPlay = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const numericId = Number(dpTmdbId.trim());
    if (!numericId || isNaN(numericId) || numericId <= 0) {
      setDpResult({
        latencyMs: 0,
        parsedId: 0,
        type: dpType,
        response: {
          success: false,
          state: 'INVALID_PARAMS',
          code: 'INVALID_PARAMS',
          message: 'Informe um TMDB ID numérico válido (ex: 550 ou 1399).',
          sources: []
        }
      });
      return;
    }

    const parsedSeason = dpType === 'tv' ? Math.max(1, Number(dpSeason) || 1) : undefined;
    const parsedEpisode = dpType === 'tv' ? Math.max(1, Number(dpEpisode) || 1) : undefined;

    setGeneratedEmbedUrl(
      buildOfficialEmbedUrl({
        type: dpType,
        tmdbId: numericId,
        season: parsedSeason,
        episode: parsedEpisode
      })
    );

    setDpLoading(true);
    const start = performance.now();
    try {
      const response = await api.getDirectPlay({
        tmdbId: numericId,
        type: dpType,
        season: parsedSeason,
        episode: parsedEpisode,
        apiKey: apiKeyInput.trim() || undefined
      });
      const latencyMs = Math.round(performance.now() - start);
      setDpResult({
        latencyMs,
        parsedId: numericId,
        parsedSeason: response.season ?? parsedSeason,
        parsedEpisode: response.episode ?? parsedEpisode,
        type: dpType,
        response
      });
    } catch (err: any) {
      setDpResult({
        latencyMs: Math.round(performance.now() - start),
        parsedId: numericId,
        parsedSeason,
        parsedEpisode,
        type: dpType,
        response: {
          success: false,
          state: 'SOURCE_UNAVAILABLE',
          code: 'REQUEST_ERROR',
          message: err?.message || 'Não foi possível consultar o Direct Play.',
          sources: []
        }
      });
    } finally {
      setDpLoading(false);
    }
  };

  const openEmbedPlayer = (override?: { type: 'movie' | 'tv'; tmdbId: number; season?: number; episode?: number }) => {
    const targetType = override?.type || dpType;
    const numericId = override?.tmdbId || dpResult?.parsedId || Number(dpTmdbId.trim());
    if (!numericId || isNaN(numericId) || numericId <= 0) return;

    if (targetType === 'tv') {
      navigateTo('embed', {
        type: 'tv',
        tmdbId: numericId,
        season: override?.season || dpResult?.parsedSeason || (dpSeason ? Number(dpSeason) : 1),
        episode: override?.episode || dpResult?.parsedEpisode || (dpEpisode ? Number(dpEpisode) : 1)
      });
    } else {
      navigateTo('embed', {
        type: 'movie',
        tmdbId: numericId
      });
    }
  };

  const endpoints: EndpointDoc[] = [
    {
      id: 'saude',
      section: 'geral',
      method: 'GET',
      path: '/api/v1/saude',
      samplePath: '/api/v1/saude',
      desc: 'Verifica o estado operacional da API e métricas de saúde do catálogo.'
    },
    {
      id: 'plans',
      section: 'geral',
      method: 'GET',
      path: '/api/v1/plans',
      samplePath: '/api/v1/plans',
      desc: 'Consulta os planos ativos (FREE, DEVELOPER, PRO, ENTERPRISE) e seus limites.'
    },
    {
      id: 'filmes',
      section: 'filmes',
      method: 'GET',
      path: '/api/v1/filmes?page=1&limit=20&genre=...&year=...',
      samplePath: '/api/v1/filmes?page=1&limit=5',
      desc: 'Lista filmes do catálogo publicados com paginação padronizada e filtros opcionais.'
    },
    {
      id: 'filme-detalhes',
      section: 'filmes',
      method: 'GET',
      path: '/api/v1/filmes/{tmdbId}',
      samplePath: '/api/v1/filmes/550',
      desc: 'Retorna metadados completos em JSON, posters e fontes ativas sanitizadas do filme.'
    },
    {
      id: 'buscar',
      section: 'filmes',
      method: 'GET',
      path: '/api/v1/buscar?q={termo}&type=all|movie|tv&page=1&limit=20',
      samplePath: '/api/v1/buscar?q=Fight&type=all',
      desc: 'Pesquisa unificada por título, nome original ou TMDB ID.'
    },
    {
      id: 'populares',
      section: 'filmes',
      method: 'GET',
      path: '/api/v1/populares?type=all|movie|tv&limit=20',
      samplePath: '/api/v1/populares?limit=5',
      desc: 'Itens mais populares do catálogo ordenados por pontuação.'
    },
    {
      id: 'recentes',
      section: 'filmes',
      method: 'GET',
      path: '/api/v1/recentes?type=all|movie|tv&limit=20',
      samplePath: '/api/v1/recentes?limit=5',
      desc: 'Conteúdos adicionados recentemente ao catálogo.'
    },
    {
      id: 'generos',
      section: 'filmes',
      method: 'GET',
      path: '/api/v1/generos',
      samplePath: '/api/v1/generos',
      desc: 'Lista todos os géneros disponíveis com contagem de títulos.'
    },
    {
      id: 'genero-id',
      section: 'filmes',
      method: 'GET',
      path: '/api/v1/generos/{id}?page=1&limit=20',
      samplePath: '/api/v1/generos/acao?page=1&limit=5',
      desc: 'Filtra filmes e séries por identificador ou nome do género.'
    },
    {
      id: 'series',
      section: 'series',
      method: 'GET',
      path: '/api/v1/series?page=1&limit=20',
      samplePath: '/api/v1/series?page=1&limit=5',
      desc: 'Lista séries do catálogo publicadas com paginação padronizada.'
    },
    {
      id: 'serie-detalhes',
      section: 'series',
      method: 'GET',
      path: '/api/v1/series/{tmdbId}',
      samplePath: '/api/v1/series/1399',
      desc: 'Detalhes em JSON da série incluindo lista de temporadas disponíveis.'
    },
    {
      id: 'temporada',
      section: 'episodios',
      method: 'GET',
      path: '/api/v1/series/{tmdbId}/temporadas/{season}',
      samplePath: '/api/v1/series/1399/temporadas/1',
      desc: 'Lista os episódios da temporada solicitada.'
    },
    {
      id: 'episodio',
      section: 'episodios',
      method: 'GET',
      path: '/api/v1/series/{tmdbId}/temporadas/{season}/episodios/{episode}',
      samplePath: '/api/v1/series/1399/temporadas/1/episodios/1',
      desc: 'Metadados em JSON e fontes de reprodução de um episódio específico.'
    },
    {
      id: 'fontes',
      section: 'fontes',
      method: 'GET',
      path: '/api/v1/fontes/{contentId}?type=movie|tv&season=1&episode=1',
      samplePath: '/api/v1/fontes/550?type=movie',
      desc: 'Retorna exclusivamente as fontes sanitizadas (MP4, M3U8, DASH, Embed) ativas para reprodução (requer API Key).'
    },
    {
      id: 'direct-play-movie',
      section: 'direct-play',
      method: 'GET',
      path: '/api/v1/direct-play/movie/{tmdbId}',
      samplePath: '/api/v1/direct-play/movie/550',
      desc: 'Resolve um filme por TMDB ID na base local em JSON: valida publicação, fontes ativas e prioridade sem importação automática.'
    },
    {
      id: 'direct-play-tv-ep',
      section: 'direct-play',
      method: 'GET',
      path: '/api/v1/direct-play/tv/{tmdbId}/{season}/{episode}',
      samplePath: '/api/v1/direct-play/tv/1399/1/1',
      desc: 'Resolve um episódio específico em JSON por TMDB ID, temporada e episódio com fontes ativas ordenadas e próximo episódio.'
    },
    {
      id: 'direct-play-check',
      section: 'direct-play',
      method: 'POST',
      path: '/api/v1/direct-play/check-availability',
      samplePath: '/api/v1/direct-play/check-availability',
      sampleBody: JSON.stringify({ tmdbId: 550, type: 'movie' }, null, 2),
      desc: 'Verifica disponibilidade em tempo real (READY, CONTENT_NOT_FOUND, NO_SOURCE_AVAILABLE ou SOURCE_UNAVAILABLE).'
    },
    {
      id: 'player-token',
      section: 'auth',
      method: 'POST',
      path: '/api/v1/player/token',
      samplePath: '/api/v1/player/token',
      sampleBody: JSON.stringify({ contentId: 550, mediaType: 'movie', ttlSeconds: 3600 }, null, 2),
      desc: 'Gera um token HMAC temporário para incorporação em domínios restritos (/player/{contentId}?token=...).'
    }
  ];

  const embedIframeExample = `<!-- Embed Direto de Filme por TMDB ID (Responsivo 16:9) -->
<iframe
  src="${baseUrl}/embed/550"
  width="100%"
  style="aspect-ratio:16/9;border:0"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
  loading="lazy"
></iframe>

<!-- Embed Direto de Série / Episódio por TMDB ID (Responsivo 16:9) -->
<iframe
  src="${baseUrl}/embed/1399/1/1"
  width="100%"
  style="aspect-ratio:16/9;border:0"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
  loading="lazy"
></iframe>`;

  const jsIntegrationSnippet = `// RONYCINE DIRECT PLAY — JavaScript / TypeScript
const BASE_URL = '${baseUrl}';
const API_KEY = 'rc_live_sua_chave';

// 1. Abrir ou incorporar o Player Direto (HTML / Embed)
const filmeEmbedUrl = \`\${BASE_URL}/embed/550\`;
const episodioEmbedUrl = \`\${BASE_URL}/embed/1399/1/1\`;

// 2. Consultar disponibilidade e fontes em JSON via API
async function consultarDirectPlay(tmdbId, type = 'movie', season, episode) {
  const endpoint = type === 'tv' && season && episode
    ? \`\${BASE_URL}/api/v1/direct-play/tv/\${tmdbId}/\${season}/\${episode}\`
    : \`\${BASE_URL}/api/v1/direct-play/movie/\${tmdbId}\`;

  const res = await fetch(endpoint, {
    headers: { 'x-api-key': API_KEY }
  });
  const payload = await res.json();

  if (payload.state === 'READY') {
    console.log('Player Embed:', \`\${BASE_URL}\${type === 'tv' ? \`/embed/\${tmdbId}/\${season}/\${episode}\` : \`/embed/\${tmdbId}\`}\`);
    console.log('Fonte Principal:', payload.source.url);
    return payload;
  }
  console.warn(payload.state, payload.message);
  return payload;
}`;

  const htmlIntegrationSnippet = `<!-- RONYCINE EMBED DIRECT PLAY — Links & Iframe -->
<!-- Abertura direta no navegador (Filme TMDB 550) -->
<a href="${baseUrl}/embed/550" target="_blank" rel="noopener">
  Assistir Filme (TMDB 550)
</a>

<!-- Abertura direta de episódio (Série TMDB 1399 · T01E01) -->
<a href="${baseUrl}/embed/1399/1/1" target="_blank" rel="noopener">
  Assistir Série S01E01 (TMDB 1399)
</a>

${embedIframeExample}`;

  const reactIntegrationSnippet = `// RONYCINE EMBED DIRECT PLAY — React Component
import React from 'react';

const BASE_URL = '${baseUrl}';

export function RonycineEmbedPlayer({
  tmdbId,
  type = 'movie',
  season = 1,
  episode = 1
}: {
  tmdbId: number;
  type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}) {
  const embedSrc =
    type === 'tv'
      ? \`\${BASE_URL}/embed/\${tmdbId}/\${season}/\${episode}\`
      : \`\${BASE_URL}/embed/\${tmdbId}\`;

  return (
    <div className="aspect-video w-full bg-black rounded-xl overflow-hidden">
      <iframe
        src={embedSrc}
        title={\`RONYCINE Player \${tmdbId}\`}
        className="w-full h-full border-none"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}`;

  const androidSnippet = `// RONYCINE DIRECT PLAY — Android (Kotlin Retrofit + WebView)
@GET("api/v1/direct-play/movie/{tmdbId}")
suspend fun resolveMovieDirectPlay(
  @Header("x-api-key") apiKey: String,
  @Path("tmdbId") tmdbId: Int
): Response<RonycineDirectPlayResponse>

@GET("api/v1/direct-play/tv/{tmdbId}/{season}/{episode}")
suspend fun resolveEpisodeDirectPlay(
  @Header("x-api-key") apiKey: String,
  @Path("tmdbId") tmdbId: Int,
  @Path("season") season: Int,
  @Path("episode") episode: Int
): Response<RonycineDirectPlayResponse>

// Reprodução direta no WebView Android (HTML Player Oficial):
webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true
webView.settings.mediaPlaybackRequiresUserGesture = false

// Filme por TMDB ID:
webView.loadUrl("${baseUrl}/embed/550")

// Série / Episódio por TMDB ID:
webView.loadUrl("${baseUrl}/embed/1399/1/1")`;

  const renderEndpointCard = (ep: EndpointDoc) => {
    const fullUrl = `${baseUrl}${ep.samplePath}`;
    return (
      <div key={ep.id} id={`ep-${ep.id}`} className="bg-[#0c0c0f] border border-white/10 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                ep.method === 'POST' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
              }`}
            >
              {ep.method}
            </span>
            <code className="text-xs sm:text-sm font-mono font-bold text-white truncate">{ep.path}</code>
          </div>
          <button
            type="button"
            onClick={() => testEndpoint(ep)}
            disabled={loadingId === ep.id}
            className="px-3 py-1.5 bg-white/5 hover:bg-[#E50914] border border-white/10 hover:border-[#E50914] text-zinc-200 hover:text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
          >
            <Play className="w-3 h-3" />
            <span>{loadingId === ep.id ? 'Executando...' : 'Testar Endpoint'}</span>
          </button>
        </div>
        <p className="text-xs text-zinc-400">{ep.desc}</p>
        <div className="bg-black border border-white/10 rounded-lg px-3.5 py-2 flex items-center justify-between gap-3">
          <code className="text-xs font-mono text-emerald-400 truncate">{fullUrl}</code>
          <button
            type="button"
            onClick={() => copyToClipboard(fullUrl, ep.id)}
            className="text-zinc-400 hover:text-white shrink-0"
            title="Copiar URL"
          >
            {copied === ep.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#080808] text-zinc-300 font-sans selection:bg-[#E50914] selection:text-white pb-20 pt-24">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 space-y-10">
        {/* HERO HEADER */}
        <div className="border-b border-white/10 pb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#E50914]">
              <Book className="w-4 h-4" />
              <span>Documentação Oficial v1 • RONYCINE DIRECT PLAY & EMBED</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight font-display">
              RONYCINE <span className="text-[#E50914]">API DOCS</span>
            </h1>
            <p className="text-sm text-zinc-400 max-w-3xl">
              Especificação oficial dos endpoints REST v1, sistema de reprodução direta e incorporável por <strong className="text-white">TMDB ID</strong> (<code className="text-emerald-400">/embed/&#123;tmdb_id&#125;</code> e <code className="text-emerald-400">/embed/&#123;tmdb_id&#125;/&#123;temporada&#125;/&#123;episodio&#125;</code>), gestão administrativa de fontes e SDKs Web/Android.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <a
              href="#direct-play"
              className="px-4 py-2.5 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 shadow-lg shadow-[#E50914]/25"
            >
              <Zap className="w-3.5 h-3.5" />
              Testar RONYCINE Embed
            </a>
            <button
              type="button"
              onClick={() => navigateTo('developer')}
              className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-xs font-bold rounded-lg"
            >
              Portal Dev & API Keys
            </button>
            <button
              type="button"
              onClick={() => navigateTo('playground')}
              className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-xs font-semibold rounded-lg"
            >
              Playground
            </button>
          </div>
        </div>

        {/* TEST KEY BAR */}
        <div className="bg-[#111114] border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-300 shrink-0">
            <KeyRound className="w-4 h-4 text-[#E50914]" />
            <span>Header de Teste x-api-key:</span>
          </div>
          <input
            type="text"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="Opcional — cole sua chave rc_live_... para testar com sua quota"
            className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 focus:border-[#E50914] outline-none"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* SIDEBAR (9 DOCUMENTED SECTIONS + QUICK ENDPOINTS) */}
          <aside className="lg:col-span-3 space-y-6">
            <div className="bg-[#111114] border border-white/10 rounded-xl p-4 space-y-5 sticky top-24">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                  Índice Oficial (10 Secções)
                </h3>
                <nav className="space-y-1 text-xs font-medium">
                  <a href="#introducao" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-zinc-300 hover:text-white">
                    1. Introdução & Base URL
                  </a>
                  <a href="#api-filmes" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-zinc-300 hover:text-white">
                    2. API de Filmes + Direct Play
                  </a>
                  <a href="#api-series" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-zinc-300 hover:text-white">
                    3. API de Séries + Episódios
                  </a>
                  <a href="#api-episodios" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-zinc-300 hover:text-white">
                    4. API de Episódios & Temporadas
                  </a>
                  <a href="#gestao-fontes" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-zinc-300 hover:text-white">
                    5. Gestão de Fontes
                  </a>
                  <a
                    href="#direct-play"
                    className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-[#E50914]/15 border border-[#E50914]/40 text-white font-bold hover:bg-[#E50914]/25 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-[#E50914]" />
                      6. DIRECT PLAY & EMBED
                    </span>
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E50914] text-white">
                      Oficial
                    </span>
                  </a>
                  <a href="#integracoes" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-zinc-300 hover:text-white">
                    7. Exemplos de Integração
                  </a>
                  <a href="#codigos-erros" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-zinc-300 hover:text-white">
                    8. Códigos de Resposta e Erros
                  </a>
                  <a href="#seguranca" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-zinc-300 hover:text-white">
                    9. Segurança e Autenticação
                  </a>
                  <a href="#player-universal-externo" className="block px-2.5 py-1.5 rounded hover:bg-white/5 text-emerald-400 hover:text-emerald-300 font-semibold">
                    10. Integração do Player Universal
                  </a>
                </nav>
              </div>

              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                  Endpoints ({endpoints.length})
                </h3>
                <div className="space-y-1 text-[11px] font-mono max-h-72 overflow-y-auto pr-1">
                  {endpoints.map((ep) => (
                    <a
                      key={ep.id}
                      href={`#ep-${ep.id}`}
                      className="block px-2 py-1 rounded hover:bg-white/5 text-zinc-400 hover:text-white truncate"
                    >
                      <span className={ep.method === 'POST' ? 'text-blue-400 mr-1.5' : 'text-emerald-400 mr-1.5'}>
                        {ep.method}
                      </span>
                      {ep.path.split('?')[0]}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* MAIN DOCUMENTATION CONTENT */}
          <div className="lg:col-span-9 space-y-10 min-w-0">
            {/* 1. INTRODUÇÃO */}
            <section id="introducao" className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                <Server className="w-5 h-5 text-[#E50914]" />
                <h2>1. Introdução & Arquitetura da Plataforma</h2>
              </div>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                A <strong className="text-white">RONYCINE API</strong> fornece metadados estruturados do catálogo local publicado, resolução sanitizada de fontes de vídeo e reprodução direta por <strong className="text-white">TMDB ID</strong> através do sistema oficial <strong className="text-[#E50914]">RONYCINE EMBED & DIRECT PLAY</strong>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-black/70 border border-white/10 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 font-bold uppercase text-[10px]">Base URL Oficial</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(baseUrl, 'base-url-card')}
                      className="text-zinc-400 hover:text-white"
                      title="Copiar Base URL Oficial"
                    >
                      {copied === 'base-url-card' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="font-mono text-emerald-400 font-bold truncate">{baseUrl}</div>
                </div>
                <div className="bg-black/70 border border-white/10 rounded-xl p-3.5 space-y-1.5">
                  <div className="text-zinc-500 font-bold uppercase text-[10px]">Política de Catálogo</div>
                  <div className="text-zinc-200 font-semibold">Importação 100% manual no Admin</div>
                </div>
                <div className="bg-black/70 border border-white/10 rounded-xl p-3.5 space-y-1.5">
                  <div className="text-zinc-500 font-bold uppercase text-[10px]">Formatos Suportados</div>
                  <div className="text-zinc-200 font-semibold">MP4, HLS (.m3u8), DASH (.mpd), Embed</div>
                </div>
              </div>
              <div className="space-y-3 pt-2">
                {endpoints.filter((e) => e.section === 'geral').map(renderEndpointCard)}
              </div>
            </section>

            {/* 2. API DE FILMES */}
            <section id="api-filmes" className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                <Film className="w-5 h-5 text-[#E50914]" />
                <h2>2. API de Filmes, Pesquisa e Géneros</h2>
              </div>
              <p className="text-xs sm:text-sm text-zinc-400">
                Consulte o catálogo de filmes publicados, realize buscas por título/TMDB ID, filtre por popularidade/géneros ou reproduza um filme diretamente pelo TMDB ID.
              </p>

              {/* SUBSECÇÃO OFICIAL: REPRODUÇÃO DIRETA DE FILMES */}
              <div className="bg-black/80 border border-[#E50914]/40 rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#E50914]">
                      SUBSECÇÃO OFICIAL • PLAYER & JSON
                    </span>
                    <h3 className="text-base font-black text-white mt-0.5">
                      REPRODUÇÃO DIRETA DE FILMES POR TMDB ID
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEmbedPlayer({ type: 'movie', tmdbId: 550 })}
                    className="px-3.5 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Abrir Player /embed/550</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="bg-[#111114] border border-white/10 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-400 uppercase text-[10px]">
                        1. Player Visual Incorporável (HTML)
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`${baseUrl}/embed/550`, 'sec2-embed-movie')}
                        className="text-zinc-400 hover:text-white"
                        title="Copiar URL"
                      >
                        {copied === 'sec2-embed-movie' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-white bg-black px-2.5 py-1.5 rounded border border-white/10 truncate">
                      {baseUrl}/embed/&#123;tmdb_id&#125;
                    </div>
                    <div className="font-mono text-[11px] text-emerald-400 truncate">
                      Ex: {baseUrl}/embed/550
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Abre diretamente o player visual <strong className="text-zinc-200">RONYCINE CINEMA PRO</strong> no navegador ou dentro de <code className="text-zinc-200">&lt;iframe&gt;</code>. Não retorna JSON.
                    </p>
                  </div>

                  <div className="bg-[#111114] border border-white/10 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-blue-400 uppercase text-[10px]">
                        2. Endpoint JSON (Dados & Fontes)
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`${baseUrl}/api/v1/direct-play/movie/550`, 'sec2-json-movie')}
                        className="text-zinc-400 hover:text-white"
                        title="Copiar URL JSON"
                      >
                        {copied === 'sec2-json-movie' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-white bg-black px-2.5 py-1.5 rounded border border-white/10 truncate">
                      GET {baseUrl}/api/v1/direct-play/movie/&#123;tmdbId&#125;
                    </div>
                    <div className="font-mono text-[11px] text-blue-300 truncate">
                      Ex: {baseUrl}/api/v1/direct-play/movie/550
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Retorna JSON estruturado com estado (<code className="text-emerald-400">READY</code> / <code className="text-amber-400">NO_SOURCE_AVAILABLE</code>), metadados e lista ordenada de fontes ativas.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {endpoints.filter((e) => e.section === 'filmes').map(renderEndpointCard)}
              </div>
            </section>

            {/* 3. API DE SÉRIES */}
            <section id="api-series" className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                <Tv className="w-5 h-5 text-[#E50914]" />
                <h2>3. API de Séries</h2>
              </div>
              <p className="text-xs sm:text-sm text-zinc-400">
                Obtenha a lista de séries cadastradas, metadados de temporadas importadas ou reproduza diretamente qualquer episódio específico pelo TMDB ID, temporada e episódio.
              </p>

              {/* SUBSECÇÃO OFICIAL: REPRODUÇÃO DIRETA DE SÉRIES E EPISÓDIOS */}
              <div className="bg-black/80 border border-[#E50914]/40 rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#E50914]">
                      SUBSECÇÃO OFICIAL • PLAYER & EPISÓDIOS
                    </span>
                    <h3 className="text-base font-black text-white mt-0.5">
                      REPRODUÇÃO DIRETA DE SÉRIES E EPISÓDIOS
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEmbedPlayer({ type: 'tv', tmdbId: 1399, season: 1, episode: 1 })}
                    className="px-3.5 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Abrir Player /embed/1399/1/1</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="bg-[#111114] border border-white/10 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-400 uppercase text-[10px]">
                        1. Player Visual de Episódio (HTML)
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`${baseUrl}/embed/1399/1/1`, 'sec3-embed-tv')}
                        className="text-zinc-400 hover:text-white"
                        title="Copiar URL"
                      >
                        {copied === 'sec3-embed-tv' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-white bg-black px-2.5 py-1.5 rounded border border-white/10 truncate">
                      {baseUrl}/embed/&#123;tmdb_id&#125;/&#123;season_number&#125;/&#123;episode_number&#125;
                    </div>
                    <div className="font-mono text-[11px] text-emerald-400 truncate">
                      Ex: {baseUrl}/embed/1399/1/1
                    </div>
                    <ul className="text-[11px] text-zinc-400 space-y-0.5 pt-1">
                      <li><code className="text-zinc-200">tmdb_id</code>: ID oficial TMDB da série (ex: 1399)</li>
                      <li><code className="text-zinc-200">season_number</code>: Número da temporada (ex: 1)</li>
                      <li><code className="text-zinc-200">episode_number</code>: Número do episódio (ex: 1)</li>
                    </ul>
                  </div>

                  <div className="bg-[#111114] border border-white/10 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-blue-400 uppercase text-[10px]">
                        2. Endpoint JSON do Episódio
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`${baseUrl}/api/v1/direct-play/tv/1399/1/1`, 'sec3-json-tv')}
                        className="text-zinc-400 hover:text-white"
                        title="Copiar URL JSON"
                      >
                        {copied === 'sec3-json-tv' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-white bg-black px-2.5 py-1.5 rounded border border-white/10 truncate">
                      GET {baseUrl}/api/v1/direct-play/tv/&#123;tmdbId&#125;/&#123;season&#125;/&#123;episode&#125;
                    </div>
                    <div className="font-mono text-[11px] text-blue-300 truncate">
                      Ex: {baseUrl}/api/v1/direct-play/tv/1399/1/1
                    </div>
                    <p className="text-[11px] text-zinc-400 pt-1">
                      Devolve os dados em JSON da série, título do episódio, fontes ativas associadas pelo admin e próximo episódio disponível.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {endpoints.filter((e) => e.section === 'series').map(renderEndpointCard)}
              </div>
            </section>

            {/* 4. API DE EPISÓDIOS */}
            <section id="api-episodios" className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                <Layers className="w-5 h-5 text-[#E50914]" />
                <h2>4. API de Episódios & Temporadas</h2>
              </div>
              <p className="text-xs sm:text-sm text-zinc-400">
                Liste episódios de uma temporada específica ou obtenha os metadados e fontes de reprodução de um único episódio.
              </p>
              <div className="space-y-3">
                {endpoints.filter((e) => e.section === 'episodios').map(renderEndpointCard)}
              </div>
            </section>

            {/* 5. GESTÃO DE FONTES */}
            <section id="gestao-fontes" className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                <Database className="w-5 h-5 text-[#E50914]" />
                <h2>5. Gestão de Fontes & Diagnóstico Real</h2>
              </div>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Cada conteúdo pode ter múltiplas fontes de vídeo geridas no Painel Administrativo (<code className="text-zinc-200">/api/admin/video-sources</code>). O motor avalia automaticamente:
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-zinc-300">
                <li className="bg-black/60 border border-white/10 rounded-lg p-3">
                  <strong className="text-white block mb-0.5">Estado Ativo / Inativo (enabled)</strong>
                  Fontes desativadas, offline ou bloqueadas nunca são entregues ao player público.
                </li>
                <li className="bg-black/60 border border-white/10 rounded-lg p-3">
                  <strong className="text-white block mb-0.5">Ordem de Prioridade (priority & isPrimary)</strong>
                  Fontes primárias (<code className="text-emerald-400">isPrimary: true</code>) e de menor número de prioridade (<code className="text-emerald-400">priority: 1, 2...</code>) são priorizadas automaticamente com fallback seguro.
                </li>
                <li className="bg-black/60 border border-white/10 rounded-lg p-3">
                  <strong className="text-white block mb-0.5">Inspeção HTTP & Content-Type</strong>
                  Diferencia streams diretos (<code className="text-emerald-400">video/mp4</code>, <code className="text-emerald-400">application/vnd.apple.mpegurl</code>) de páginas HTML ou embeds bloqueados por <code className="text-amber-400">X-Frame-Options</code>.
                </li>
                <li className="bg-black/60 border border-white/10 rounded-lg p-3">
                  <strong className="text-white block mb-0.5">Zero Fontes Inventadas</strong>
                  Se o conteúdo não tiver fonte cadastrada ou não estiver publicado, nenhuma URL sintética é gerada.
                </li>
              </ul>
              <div className="space-y-3 pt-1">
                {endpoints.filter((e) => e.section === 'fontes').map(renderEndpointCard)}
              </div>
            </section>

            {/* 6. RONYCINE DIRECT PLAY & EMBED PLAYER */}
            <section
              id="direct-play"
              className="bg-gradient-to-b from-[#160b0d] via-[#111114] to-[#111114] border border-[#E50914]/40 rounded-2xl p-6 space-y-6 shadow-2xl shadow-[#E50914]/5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#E50914]">
                    <Zap className="w-3.5 h-3.5" />
                    <span>Especificação Oficial • Base URL {baseUrl}</span>
                  </div>
                  <h2 className="text-2xl font-black text-white tracking-tight">
                    6. RONYCINE DIRECT PLAY & EMBED PLAYER
                  </h2>
                </div>
                <span className="px-3 py-1 rounded-full bg-[#E50914]/15 border border-[#E50914]/40 text-[#E50914] text-[11px] font-bold self-start sm:self-auto">
                  Embed HTML & API JSON • Zero Auto-Import
                </span>
              </div>

              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                O <strong className="text-white">RONYCINE EMBED DIRECT PLAY</strong> disponibiliza URLs limpas baseadas em <strong className="text-white">TMDB ID</strong> para abrir o Player Oficial diretamente no navegador, em <code className="text-zinc-200">&lt;iframe&gt;</code> ou Android WebView — além de endpoints JSON para consumo programático.
              </p>

              {/* A, B, C CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-black/80 border border-emerald-500/30 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      A. Filme — Player Embed
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${baseUrl}/embed/550`, 'card-a-embed')}
                      className="text-zinc-400 hover:text-white"
                      title="Copiar exemplo"
                    >
                      {copied === 'card-a-embed' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-white bg-white/5 px-2.5 py-1.5 rounded truncate">
                    /embed/&#123;tmdb_id&#125;
                  </div>
                  <div className="font-mono text-[11px] text-emerald-400 truncate">
                    {baseUrl}/embed/550
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Abre o Player RONYCINE diretamente para o filme publicado correspondente ao TMDB ID.
                  </p>
                </div>

                <div className="bg-black/80 border border-[#E50914]/40 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#E50914]">
                      B. Série / Episódio — Embed
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${baseUrl}/embed/1399/1/1`, 'card-b-embed')}
                      className="text-zinc-400 hover:text-white"
                      title="Copiar exemplo"
                    >
                      {copied === 'card-b-embed' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-white bg-white/5 px-2.5 py-1.5 rounded truncate">
                    /embed/&#123;tmdb_id&#125;/&#123;temporada&#125;/&#123;episodio&#125;
                  </div>
                  <div className="font-mono text-[11px] text-emerald-400 truncate">
                    {baseUrl}/embed/1399/1/1
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Abre o Player do episódio específico (ex: Temporada 1, Episódio 1) com botão Próximo Episódio.
                  </p>
                </div>

                <div className="bg-black/80 border border-blue-500/30 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                      C. API JSON (Metadados & Fontes)
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${baseUrl}/api/v1/direct-play/movie/550`, 'card-c-json')}
                      className="text-zinc-400 hover:text-white"
                      title="Copiar exemplo"
                    >
                      {copied === 'card-c-json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-white bg-white/5 px-2.5 py-1.5 rounded truncate">
                    /api/v1/direct-play/movie/550
                  </div>
                  <div className="font-mono text-[11px] text-blue-300 truncate">
                    /api/v1/direct-play/tv/1399/1/1
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Retorna JSON com estado (<code className="text-emerald-400">READY</code>), metadados e lista priorizada de fontes ativas.
                  </p>
                </div>
              </div>

              {/* RESOLUTION & SECURITY RULES */}
              <div className="bg-black/50 border border-white/10 rounded-xl p-4 space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Regras de Resolução, Prioridade, Fallback & Segurança
                </h3>
                <ol className="list-decimal list-inside space-y-1 text-xs text-zinc-400">
                  <li>Valida se o <strong className="text-zinc-200">TMDB ID</strong> existe e está <strong className="text-zinc-200">publicado</strong> na base local da RONYCINE (conteúdos privados/rascunho retornam <code className="text-red-400">404 CONTENT_NOT_FOUND</code> e nunca há auto-importação).</li>
                  <li>Separa estritamente filmes (<code className="text-zinc-200">movie</code>) e séries (<code className="text-zinc-200">tv</code>) sem misturar registos.</li>
                  <li>Filtra exclusivamente fontes ativas (<code className="text-emerald-400">enabled !== false</code>) e ordena por <code className="text-zinc-200">isPrimary</code>, menor número de <code className="text-zinc-200">priority</code> e recência.</li>
                  <li>Em caso de falha da fonte principal, o Player alterna automaticamente para a próxima fonte alternativa ativa; para embeds restritos por domínio, use tokens HMAC em <code className="text-zinc-200">/api/v1/player/token</code> (<code className="text-zinc-200">frame-ancestors</code>).</li>
                </ol>
              </div>

              {/* DIRECT PLAY API ENDPOINT CARDS */}
              <div className="space-y-3">
                {endpoints.filter((e) => e.section === 'direct-play').map(renderEndpointCard)}
              </div>

              {/* INTERACTIVE EMBED DIRECT PLAY TESTER */}
              <div className="bg-black border border-[#E50914]/40 rounded-2xl p-5 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      <Play className="w-4 h-4 text-[#E50914] fill-current" />
                      TESTAR RONYCINE EMBED
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Gere URLs oficiais <code className="text-emerald-400">/embed/...</code>, valide disponibilidade real na base de dados e abra o Player diretamente.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setDpType('movie');
                        setDpTmdbId('550');
                        setGeneratedEmbedUrl(`${baseUrl}/embed/550`);
                      }}
                      className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 cursor-pointer"
                    >
                      Filme c/ fonte (550)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDpType('movie');
                        setDpTmdbId('157336');
                        setGeneratedEmbedUrl(`${baseUrl}/embed/157336`);
                      }}
                      className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 cursor-pointer"
                    >
                      Filme s/ fonte (157336)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDpType('tv');
                        setDpTmdbId('1399');
                        setDpSeason('1');
                        setDpEpisode('1');
                        setGeneratedEmbedUrl(`${baseUrl}/embed/1399/1/1`);
                      }}
                      className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 cursor-pointer"
                    >
                      Série S1E1 (1399)
                    </button>
                  </div>
                </div>

                <form onSubmit={handleTestDirectPlay} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-3 space-y-1.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Tipo
                    </label>
                    <div className="grid grid-cols-2 bg-[#111114] border border-white/10 rounded-lg p-1">
                      <button
                        type="button"
                        onClick={() => setDpType('movie')}
                        className={`py-1.5 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                          dpType === 'movie' ? 'bg-[#E50914] text-white' : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Filme
                      </button>
                      <button
                        type="button"
                        onClick={() => setDpType('tv')}
                        className={`py-1.5 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                          dpType === 'tv' ? 'bg-[#E50914] text-white' : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Série
                      </button>
                    </div>
                  </div>

                  <div className={dpType === 'tv' ? 'sm:col-span-3 space-y-1.5' : 'sm:col-span-5 space-y-1.5'}>
                    <label htmlFor="dp-tmdb-id" className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      TMDB ID
                    </label>
                    <input
                      id="dp-tmdb-id"
                      type="number"
                      min={1}
                      value={dpTmdbId}
                      onChange={(e) => setDpTmdbId(e.target.value)}
                      placeholder="Ex: 550"
                      className="w-full bg-[#111114] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-white focus:border-[#E50914] outline-none"
                    />
                  </div>

                  {dpType === 'tv' && (
                    <>
                      <div className="sm:col-span-1 space-y-1.5">
                        <label htmlFor="dp-season" className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Temp.
                        </label>
                        <input
                          id="dp-season"
                          type="number"
                          min={1}
                          value={dpSeason}
                          onChange={(e) => setDpSeason(e.target.value)}
                          placeholder="1"
                          className="w-full bg-[#111114] border border-white/10 rounded-lg px-2.5 py-2 text-sm font-mono text-white focus:border-[#E50914] outline-none"
                        />
                      </div>
                      <div className="sm:col-span-1 space-y-1.5">
                        <label htmlFor="dp-episode" className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Epis.
                        </label>
                        <input
                          id="dp-episode"
                          type="number"
                          min={1}
                          value={dpEpisode}
                          onChange={(e) => setDpEpisode(e.target.value)}
                          placeholder="1"
                          className="w-full bg-[#111114] border border-white/10 rounded-lg px-2.5 py-2 text-sm font-mono text-white focus:border-[#E50914] outline-none"
                        />
                      </div>
                    </>
                  )}

                  <div className="sm:col-span-4 flex flex-wrap sm:flex-nowrap gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateUrl}
                      className="flex-1 py-2.5 px-3 bg-white/5 hover:bg-white/10 border border-white/15 text-white text-xs font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Link2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>GERAR URL</span>
                    </button>
                    <button
                      type="submit"
                      disabled={dpLoading}
                      className="flex-1 py-2.5 px-3 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-60 text-white text-xs font-black uppercase tracking-wider rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {dpLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                      <span>{dpLoading ? 'Testando...' : 'TESTAR'}</span>
                    </button>
                  </div>
                </form>

                {/* URL FINAL PREVIEW BAR */}
                <div className="bg-[#111114] border border-white/10 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      URL Oficial Embed Gerada
                    </div>
                    <div className="font-mono text-xs sm:text-sm text-emerald-400 truncate">
                      {generatedEmbedUrl || liveOfficialEmbedUrl}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(generatedEmbedUrl || liveOfficialEmbedUrl, 'dp-final-url')}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      {copied === 'dp-final-url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>Copiar URL</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openEmbedPlayer()}
                      className="px-3.5 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-black uppercase tracking-wider rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>ABRIR PLAYER</span>
                    </button>
                  </div>
                </div>

                {/* RESULTADO DO TESTER DIRECT PLAY */}
                {dpResult && (
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
                      <div className="flex items-center gap-2.5">
                        {dpResult.response?.state === 'READY' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        ) : dpResult.response?.state === 'NO_SOURCE_AVAILABLE' ? (
                          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                        )}
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                                dpResult.response?.state === 'READY'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : dpResult.response?.state === 'NO_SOURCE_AVAILABLE'
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-red-500/20 text-red-400'
                              }`}
                            >
                              {dpResult.response?.state || 'ERROR'}
                            </span>
                            {dpResult.response?.httpStatus && (
                              <span className="text-[11px] font-mono text-zinc-400">
                                HTTP {dpResult.response.httpStatus}
                              </span>
                            )}
                            <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
                              {dpResult.latencyMs} ms
                            </span>
                          </div>
                          <p className="text-xs text-zinc-300 mt-1">{dpResult.response?.message}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => openEmbedPlayer()}
                        className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-black uppercase tracking-wider rounded-lg inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>ABRIR PLAYER</span>
                      </button>
                    </div>

                    {dpResult.response?.content && (
                      <div className="flex flex-col sm:flex-row gap-4 items-start bg-black/60 border border-white/10 rounded-lg p-3.5">
                        {dpResult.response.content.poster && (
                          <img
                            src={resolveTmdbPosterUrl(dpResult.response.content.poster, 'w185')}
                            alt={dpResult.response.content.title}
                            className="w-16 h-24 object-cover rounded border border-white/10 shrink-0"
                          />
                        )}
                        <div className="space-y-1.5 min-w-0 flex-1 text-xs">
                          <div className="font-bold text-white text-sm">
                            {dpResult.response.content.title}
                            {dpResult.response.type === 'tv' && dpResult.response.season && dpResult.response.episode
                              ? ` • T${String(dpResult.response.season).padStart(2, '0')}E${String(dpResult.response.episode).padStart(2, '0')}`
                              : ''}
                          </div>
                          <div className="font-mono text-[11px] text-emerald-400 truncate">
                            Embed: {baseUrl}{liveEmbedPath}
                          </div>
                          {Array.isArray(dpResult.response.sources) && dpResult.response.sources.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {dpResult.response.sources.map((src: any, idx: number) => (
                                <span
                                  key={src.id || idx}
                                  className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[11px] font-mono text-zinc-200"
                                >
                                  #{src.priority || idx + 1} {src.provider || 'Fonte'} ({String(src.type || src.format || 'auto').toUpperCase()})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11px] text-amber-400">
                              Nenhuma fonte ativa encontrada para este título/episódio.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <details className="bg-black border border-white/10 rounded-lg overflow-hidden">
                      <summary className="px-3.5 py-2 text-[11px] font-mono text-zinc-400 cursor-pointer hover:text-white select-none">
                        Ver resposta JSON completa
                      </summary>
                      <pre className="p-3.5 text-[11px] font-mono text-emerald-400 overflow-auto max-h-72 border-t border-white/10">
                        {JSON.stringify(dpResult.response, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            </section>

            {/* LIVE ENDPOINT TESTER RESULT (FOR REST CARDS ABOVE) */}
            {testResult && (
              <section className="bg-black border border-[#E50914]/40 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-[#111114] border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center gap-3 min-w-0">
                    <Terminal className="w-4 h-4 text-[#E50914] shrink-0" />
                    <span className="text-white font-bold truncate">{testResult.endpoint}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        testResult.status >= 200 && testResult.status < 300
                          ? 'text-emerald-400 font-bold'
                          : 'text-red-400 font-bold'
                      }
                    >
                      HTTP {testResult.status}
                    </span>
                    <span className="text-zinc-400 tabular-nums">{testResult.latencyMs} ms</span>
                  </div>
                </div>
                <pre className="p-4 text-xs font-mono text-emerald-400 overflow-auto max-h-96">
                  {JSON.stringify(testResult.body, null, 2)}
                </pre>
              </section>
            )}

            {/* 7. EXEMPLOS DE INTEGRAÇÃO */}
            <section id="integracoes" className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                  <Code2 className="w-5 h-5 text-[#E50914]" />
                  <h2>7. Exemplos de Integração (JS, HTML, React & Android)</h2>
                </div>
                <div className="flex flex-wrap gap-1.5 bg-black border border-white/10 p-1 rounded-lg">
                  {[
                    { id: 'js', label: 'JavaScript / SDK' },
                    { id: 'html', label: 'HTML / Iframe' },
                    { id: 'react', label: 'React' },
                    { id: 'android', label: 'Android Kotlin' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setIntegrationTab(tab.id as any)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                        integrationTab === tab.id ? 'bg-[#E50914] text-white' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {integrationTab === 'js' && (
                <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto">
                  {jsIntegrationSnippet}
                </pre>
              )}
              {integrationTab === 'html' && (
                <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-amber-300 overflow-x-auto">
                  {htmlIntegrationSnippet}
                </pre>
              )}
              {integrationTab === 'react' && (
                <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-cyan-300 overflow-x-auto">
                  {reactIntegrationSnippet}
                </pre>
              )}
              {integrationTab === 'android' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-300">
                    <Smartphone className="w-4 h-4 text-[#E50914]" />
                    <span>Android (Retrofit + WebView Nativa)</span>
                  </div>
                  <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto">
                    {androidSnippet}
                  </pre>
                </div>
              )}
            </section>

            {/* 8. CÓDIGOS DE RESPOSTA E ERROS */}
            <section id="codigos-erros" className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                <AlertTriangle className="w-5 h-5 text-[#E50914]" />
                <h2>8. Códigos de Resposta HTTP & Estados do Direct Play</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400 uppercase text-[11px]">
                      <th className="py-2.5 pr-4">HTTP / State</th>
                      <th className="py-2.5 pr-4">Significado</th>
                      <th className="py-2.5">Mensagem Oficial</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-zinc-300">
                    <tr>
                      <td className="py-2.5 pr-4 font-mono text-emerald-400">200 • READY</td>
                      <td className="py-2.5 pr-4">Conteúdo publicado e fonte principal ativa verificada</td>
                      <td className="py-2.5 font-mono text-[11px]">Conteúdo pronto para reprodução direta.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-mono text-amber-400">200 • NO_SOURCE_AVAILABLE</td>
                      <td className="py-2.5 pr-4">Título existe na BD sem nenhuma fonte associada</td>
                      <td className="py-2.5">Este conteúdo ainda não possui uma fonte de reprodução disponível.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-mono text-orange-400">200 / 503 • SOURCE_UNAVAILABLE</td>
                      <td className="py-2.5 pr-4">Fontes inativas, bloqueadas ou offline no probe</td>
                      <td className="py-2.5">Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-mono text-red-400">404 • CONTENT_NOT_FOUND</td>
                      <td className="py-2.5 pr-4">TMDB ID ausente no catálogo local ou não publicado</td>
                      <td className="py-2.5">Conteúdo não encontrado na RONYCINE API.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-mono text-red-400">401 / 403</td>
                      <td className="py-2.5 pr-4">API Key inválida/revogada ou domínio bloqueado no Embed</td>
                      <td className="py-2.5 font-mono text-[11px]">API_KEY_INVALID / DOMAIN_NOT_AUTHORIZED</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-mono text-zinc-400">429</td>
                      <td className="py-2.5 pr-4">Quota por minuto ou diária excedida</td>
                      <td className="py-2.5 font-mono text-[11px]">RATE_LIMIT_EXCEEDED</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 9. SEGURANÇA E AUTENTICAÇÃO */}
            <section id="seguranca" className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                <ShieldCheck className="w-5 h-5 text-[#E50914]" />
                <h2>9. Segurança, Autenticação & Player Incorporável</h2>
              </div>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Cada requisição autenticada deve incluir a chave gerada no Portal do Desenvolvedor através do cabeçalho{' '}
                <code className="text-emerald-400">x-api-key: rc_live_...</code> ou{' '}
                <code className="text-emerald-400">Authorization: Bearer rc_live_...</code>. As respostas retornam cabeçalhos em tempo real (<code className="text-zinc-200">X-RateLimit-Limit</code>,{' '}
                <code className="text-zinc-200">X-RateLimit-Remaining</code>, <code className="text-zinc-200">X-RateLimit-Daily-Remaining</code>).
                Rotas administrativas exigem JWT válido com perfil administrador, validação SSRF em fontes remotas e tokens HMAC com política <code className="text-zinc-200">Content-Security-Policy: frame-ancestors</code> para embeds externos.
              </p>
              <div className="bg-black border border-white/10 rounded-lg p-3.5 text-xs font-mono text-zinc-300 overflow-x-auto">
                curl -H "x-api-key: rc_live_sua_chave" "{baseUrl}/api/v1/direct-play/movie/550"
              </div>
              <div className="space-y-3">
                {endpoints.filter((e) => e.section === 'auth').map(renderEndpointCard)}
              </div>
            </section>

            {/* 10. INTEGRAÇÃO DO PLAYER UNIVERSAL EM SITES EXTERNOS */}
            <section id="player-universal-externo" className="bg-[#111114] border border-[#E50914]/35 rounded-2xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-white font-bold text-lg">
                  <Link2 className="w-5 h-5 text-[#E50914]" />
                  <h2>10. INTEGRAÇÃO DO PLAYER UNIVERSAL EM SITES EXTERNOS</h2>
                </div>
                <span className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider self-start sm:self-auto">
                  Player Centralizado Oficial
                </span>
              </div>

              <div className="bg-black/60 border border-white/10 rounded-xl p-4 space-y-2">
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  O player oficial <strong className="text-white">RONYCINE CINEMA PRO</strong> é servido diretamente pela infraestrutura RONYCINE API.
                  Sites externos <strong className="text-white">não precisam instalar, hospedar ou manter um player próprio</strong> — basta incorporar o endereço oficial abaixo via <code className="text-emerald-400">&lt;iframe&gt;</code>. Toda a resolução das fontes (MP4, HLS <code className="text-zinc-200">.m3u8</code>, DASH <code className="text-zinc-200">.mpd</code> ou Embed autorizado), controlo de qualidade, legendas e atualizações ficam 100% centralizadas na RONYCINE API.
                </p>
                <div className="text-[11px] font-mono text-zinc-400 pt-1">
                  SITE EXTERNO → RONYCINE EMBED (/embed/...) → DIRECT PLAY API → RESOLUÇÃO DA FONTE → PLAYER RONYCINE CINEMA PRO
                </div>
              </div>

              {/* Exemplo HTML Oficial Responsivo */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Código HTML Oficial para Incorporação (Responsivo 16:9)
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        `<iframe\n  src="${baseUrl}/embed/550"\n  width="100%"\n  style="aspect-ratio:16/9;border:0"\n  allow="autoplay; fullscreen; picture-in-picture"\n  allowfullscreen\n  loading="lazy"\n></iframe>`,
                        'sec10-iframe-official'
                      )
                    }
                    className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    {copied === 'sec10-iframe-official' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied === 'sec10-iframe-official' ? 'Copiado!' : 'Copiar Código HTML'}</span>
                  </button>
                </div>
                <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-amber-300 overflow-x-auto">
{`<iframe
  src="${baseUrl}/embed/550"
  width="100%"
  style="aspect-ratio:16/9;border:0"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
  loading="lazy"
></iframe>`}
                </pre>
              </div>

              {/* Exemplos para Filmes e Séries */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="bg-[#0c0c0f] border border-white/10 rounded-xl p-4 space-y-2">
                  <div className="font-bold text-white flex items-center justify-between">
                    <span>Exemplo — Filme (TMDB ID)</span>
                    <button
                      type="button"
                      onClick={() => openEmbedPlayer({ type: 'movie', tmdbId: 550 })}
                      className="text-[11px] text-[#E50914] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Testar Embed</span>
                    </button>
                  </div>
                  <code className="block bg-black border border-white/10 rounded-lg px-3 py-2 font-mono text-emerald-400 truncate">
                    {baseUrl}/embed/550
                  </code>
                  <p className="text-[11px] text-zinc-400">
                    Substitua <code className="text-zinc-200">550</code> pelo TMDB ID de qualquer filme publicado na biblioteca.
                  </p>
                </div>

                <div className="bg-[#0c0c0f] border border-white/10 rounded-xl p-4 space-y-2">
                  <div className="font-bold text-white flex items-center justify-between">
                    <span>Exemplo — Série / Episódio (T01E01)</span>
                    <button
                      type="button"
                      onClick={() => openEmbedPlayer({ type: 'tv', tmdbId: 1399, season: 1, episode: 1 })}
                      className="text-[11px] text-[#E50914] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Testar Embed</span>
                    </button>
                  </div>
                  <code className="block bg-black border border-white/10 rounded-lg px-3 py-2 font-mono text-sky-400 truncate">
                    {baseUrl}/embed/1399/1/1
                  </code>
                  <p className="text-[11px] text-zinc-400">
                    Formato <code className="text-zinc-200">/embed/&#123;tmdb_id&#125;/&#123;temporada&#125;/&#123;episodio&#125;</code> com suporte a próximo episódio.
                  </p>
                </div>
              </div>

              {/* Autorização de Domínios & Tokens HMAC */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="bg-black/50 border border-white/10 rounded-xl p-4 space-y-2">
                  <h3 className="font-bold text-white uppercase text-[11px] tracking-wider text-emerald-400">
                    Como Autorizar o Seu Domínio no Portal Dev
                  </h3>
                  <ol className="list-decimal list-inside space-y-1.5 text-zinc-400 leading-relaxed">
                    <li>Aceda ao <strong className="text-zinc-200">Portal Dev</strong> e crie ou selecione a sua aplicação.</li>
                    <li>Adicione os domínios autorizados (ex.: <code className="text-zinc-200">meusite.com</code> ou <code className="text-zinc-200">*.meusite.com</code>).</li>
                    <li>Guarde as alterações — o cabeçalho <code className="text-zinc-200">Content-Security-Policy: frame-ancestors</code> é atualizado automaticamente.</li>
                    <li>Nunca exponha a sua <code className="text-zinc-200">x-api-key</code> secreta no código HTML ou JavaScript público do cliente.</li>
                  </ol>
                </div>

                <div className="bg-black/50 border border-white/10 rounded-xl p-4 space-y-2">
                  <h3 className="font-bold text-white uppercase text-[11px] tracking-wider text-amber-400">
                    Sessões Assinadas com Token HMAC (Opcional)
                  </h3>
                  <p className="text-zinc-400 leading-relaxed">
                    Para embeds com validade temporária, gere no seu backend um token via <code className="text-zinc-200">POST /api/v1/player/token</code> usando a sua API Key privada e passe apenas o token público na URL:
                  </p>
                  <code className="block bg-black border border-white/10 rounded-lg px-3 py-2 font-mono text-[11px] text-zinc-300 overflow-x-auto">
                    {baseUrl}/embed/550?token=rcp_...
                  </code>
                </div>
              </div>

              {/* Respostas de Erro Esperadas */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  Exemplos de Erros & Estados de Segurança no Embed
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] font-mono">
                  <div className="bg-black border border-red-500/25 rounded-lg p-3 space-y-1">
                    <div className="text-red-400 font-bold">403 • DOMAIN_NOT_AUTHORIZED</div>
                    <div className="text-zinc-400 font-sans">Domínio externo não registado na lista de domínios autorizados do Portal Dev.</div>
                  </div>
                  <div className="bg-black border border-amber-500/25 rounded-lg p-3 space-y-1">
                    <div className="text-amber-400 font-bold">401 • PLAYBACK_TOKEN_EXPIRED</div>
                    <div className="text-zinc-400 font-sans">Token HMAC expirado ou assinatura inválida. Gere novo token no servidor.</div>
                  </div>
                  <div className="bg-black border border-orange-500/25 rounded-lg p-3 space-y-1">
                    <div className="text-orange-400 font-bold">200 • SOURCE_UNAVAILABLE</div>
                    <div className="text-zinc-400 font-sans">Nenhuma fonte compatível/verificada disponível (ex.: página HTML ou endpoint PHP inválido).</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => openEmbedPlayer({ type: 'movie', tmdbId: 550 })}
                  className="px-4 py-2.5 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg inline-flex items-center gap-2 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Testar Embed Filme (/embed/550)</span>
                </button>
                <button
                  type="button"
                  onClick={() => openEmbedPlayer({ type: 'tv', tmdbId: 1399, season: 1, episode: 1 })}
                  className="px-4 py-2.5 bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2 cursor-pointer"
                >
                  <Tv className="w-3.5 h-3.5 text-[#E50914]" />
                  <span>Testar Embed Série (/embed/1399/1/1)</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('developer')}
                  className="px-4 py-2.5 bg-black hover:bg-zinc-900 border border-white/15 text-zinc-200 text-xs font-bold rounded-lg inline-flex items-center gap-2 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Gerir Domínios no Portal Dev</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
