import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Search,
  Film,
  Tv,
  Sparkles,
  Copy,
  Check,
  ChevronRight,
  ShieldCheck,
  Code2,
  Terminal,
  Zap,
  Database,
  BookOpen,
  Layers,
  Server,
  Menu,
  X,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { RonycinePlayer, VideoSourceItem } from '../components/player/RonycinePlayer';
import { OFFICIAL_BASE_URL } from '../lib/siteConfig.js';
import { ErrorBoundary } from '../components/ErrorBoundary';

interface StatsData {
  moviesCount: number;
  seriesCount: number;
  episodesCount: number;
  totalCatalog: number;
  status: string;
}

export const HomeView: React.FC = () => {
  const { navigateTo } = useAuth();
  const [stats, setStats] = useState<StatsData>({
    moviesCount: 0,
    seriesCount: 0,
    episodesCount: 0,
    totalCatalog: 0,
    status: 'Online'
  });
  const [loadingStats, setLoadingStats] = useState(true);

  const [activeCodeTab, setActiveCodeTab] = useState<'curl' | 'javascript' | 'python'>('curl');
  const [copiedCode, setCopiedCode] = useState(false);

  const origin = OFFICIAL_BASE_URL;

  useEffect(() => {
    let isMounted = true;
    setLoadingStats(true);
    fetch('/api/v1/stats')
      .then(res => res.json())
      .then(data => {
        if (isMounted && data.success) {
          setStats({
            moviesCount: data.moviesCount || data.movies || 0,
            seriesCount: data.seriesCount || data.series || 0,
            episodesCount: data.episodesCount || 0,
            totalCatalog: data.totalCatalog || ((data.moviesCount || 0) + (data.seriesCount || 0)),
            status: data.status || 'Online'
          });
        }
      })
      .catch(() => {
        fetch('/api/stats')
          .then(r => r.json())
          .then(d => {
            if (isMounted) {
              setStats({
                moviesCount: d.movies || 0,
                seriesCount: d.series || 0,
                episodesCount: 0,
                totalCatalog: (d.movies || 0) + (d.series || 0),
                status: d.status || 'Online'
              });
            }
          })
          .catch(console.error);
      })
      .finally(() => {
        if (isMounted) setLoadingStats(false);
      });

    return () => { isMounted = false; };
  }, []);

  const codeSnippets = {
    curl: `# Obter detalhes e fontes de vídeo de um filme pelo TMDB ID
curl -X GET "${origin}/api/v1/filmes/550" \\
  -H "x-api-key: rc_live_sua_chave_aqui" \\
  -H "Accept: application/json"

# Obter episódio específico de uma série
curl -X GET "${origin}/api/v1/series/1399/temporadas/1/episodios/1" \\
  -H "x-api-key: rc_live_sua_chave_aqui" \\
  -H "Accept: application/json"`,
    javascript: `// Buscar filme com o SDK oficial ou fetch autenticado
async function fetchMoviePlayer(tmdbId) {
  const response = await fetch(\`${origin}/api/v1/filmes/\${tmdbId}\`, {
    headers: { 'x-api-key': 'rc_live_sua_chave_aqui' }
  });
  const data = await response.json();

  if (data.success && data.data.sources.length > 0) {
    const primarySource = data.data.sources[0];
    console.log('Stream URL:', primarySource.url);
    return primarySource.url;
  }
  throw new Error('Fonte não disponível');
}`,
    python: `import requests

def get_series_episode(tmdb_id, season, episode, api_key):
    url = f"${origin}/api/v1/series/{tmdb_id}/temporadas/{season}/episodios/{episode}"
    headers = {"x-api-key": api_key}
    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        data = response.json()
        return data.get("data", {}).get("sources", [])
    return []

# Exemplo: Game of Thrones S01E01 (TMDB: 1399)
sources = get_series_episode(1399, 1, 1, "rc_live_sua_chave_aqui")
print(f"Fontes encontradas: {len(sources)}")`
  };

  const jsonPreview = `{
  "success": true,
  "data": {
    "tmdbId": 550,
    "type": "movie",
    "title": "Clube da Luta",
    "originalTitle": "Fight Club",
    "voteAverage": 8.4,
    "releaseYear": 1999,
    "sources": [
      {
        "id": "src-550-default",
        "format": "m3u8",
        "url": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        "provider": "Servidor Oficial RONYCINE",
        "label": "4K Ultra HD (HLS)",
        "isPrimary": true
      }
    ]
  }
}`;

  const copyCode = () => {
    navigator.clipboard.writeText(codeSnippets[activeCodeTab]);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] text-white selection:bg-[#E50914]/30 selection:text-white font-sans overflow-x-hidden">

      {/* 2. HERO PRESENTATION — RONYCINE API */}
      <section id="hero" className="relative pt-28 sm:pt-36 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="absolute inset-0 top-0 -z-10 flex items-center justify-center pointer-events-none">
          <div className="w-[500px] h-[300px] bg-[#E50914]/15 rounded-full blur-[140px]" />
          <div className="w-[300px] h-[200px] bg-blue-600/10 rounded-full blur-[120px]" />
        </div>

        <div className="text-center max-w-4xl mx-auto space-y-6">
          {/* Status line */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>API REST v1 • Embed Player • SDK Web & Android</span>
          </div>

          {/* Title */}
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-tight">
            RONYCINE <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#E50914] via-red-500 to-rose-400">API</span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-xl md:text-2xl font-bold text-zinc-200 max-w-3xl mx-auto">
            Plataforma completa de API de filmes e séries, Player Embed oficial e SDK para desenvolvedores.
          </p>

          {/* Description */}
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            Gere chaves de API com controle de domínios e rate limiting, consulte metadados e fontes verificadas (HLS/M3U8, MP4, DASH e Embeds) e incorpore o Player oficial com tokens HMAC assinados.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
            <button
              type="button"
              onClick={() => navigateTo('developer')}
              className="px-5 py-2.5 bg-[#E50914] hover:bg-[#b80710] text-white font-bold text-xs sm:text-sm rounded-lg transition-all shadow-lg shadow-[#E50914]/30 flex items-center gap-2"
            >
              <Zap className="w-4 h-4 fill-white" />
              <span>PORTAL DO DESENVOLVEDOR</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => navigateTo('documentation')}
              className="px-5 py-2.5 bg-white/10 hover:bg-white/15 text-white border border-white/10 font-bold text-xs sm:text-sm rounded-lg transition-all flex items-center gap-2"
            >
              <BookOpen className="w-4 h-4 text-[#E50914]" />
              <span>DOCUMENTAÇÃO</span>
            </button>

            <button
              type="button"
              onClick={() => scrollToSection('demo-player')}
              className="px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/15 font-bold text-xs sm:text-sm rounded-lg transition-all flex items-center gap-2"
            >
              <Play className="w-4 h-4 text-[#E50914] fill-[#E50914]" />
              <span>TESTAR PLAYER</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. ESTATÍSTICAS REAIS DO CATÁLOGO (Requirement #4) */}
      <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          
          {/* Filmes Card */}
          <div className="bg-[#0D0D12] border border-white/10 rounded-2xl p-6 relative overflow-hidden group hover:border-[#E50914]/50 transition-all">
            <div className="absolute right-3 top-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <Film className="w-20 h-20 text-[#E50914]" />
            </div>
            <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Film className="w-4 h-4 text-[#E50914]" />
              <span>Filmes Disponíveis</span>
            </div>
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              {loadingStats ? (
                <div className="h-9 w-24 bg-white/10 animate-pulse rounded" />
              ) : (
                stats.moviesCount.toLocaleString('pt-PT')
              )}
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">
              Títulos de filmes ativos no banco de dados central
            </p>
          </div>

          {/* Séries Card */}
          <div className="bg-[#0D0D12] border border-white/10 rounded-2xl p-6 relative overflow-hidden group hover:border-[#E50914]/50 transition-all">
            <div className="absolute right-3 top-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <Tv className="w-20 h-20 text-[#E50914]" />
            </div>
            <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Tv className="w-4 h-4 text-[#E50914]" />
              <span>Séries Disponíveis</span>
            </div>
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              {loadingStats ? (
                <div className="h-9 w-24 bg-white/10 animate-pulse rounded" />
              ) : (
                stats.seriesCount.toLocaleString('pt-PT')
              )}
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">
              Séries de TV cadastradas no catálogo público
            </p>
          </div>

          {/* Episódios Card */}
          <div className="bg-[#0D0D12] border border-white/10 rounded-2xl p-6 relative overflow-hidden group hover:border-[#E50914]/50 transition-all">
            <div className="absolute right-3 top-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <Layers className="w-20 h-20 text-[#E50914]" />
            </div>
            <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Layers className="w-4 h-4 text-[#E50914]" />
              <span>Episódios Disponíveis</span>
            </div>
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              {loadingStats ? (
                <div className="h-9 w-24 bg-white/10 animate-pulse rounded" />
              ) : (
                stats.episodesCount.toLocaleString('pt-PT')
              )}
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">
              Total de episódios indexados nas séries do banco
            </p>
          </div>

        </div>
      </section>

      {/* 4. PUBLIC DEMO PLAYER SECTION ("EXPERIMENTE NOSSO PLAYER") (Requirement #6) */}
      <section id="demo-player" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20">
        <div className="bg-[#0D0D14] border border-white/10 rounded-3xl p-6 sm:p-8 md:p-10 shadow-2xl relative">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#E50914] uppercase tracking-widest mb-1">
                <Sparkles className="w-4 h-4" />
                <span>DEMONSTRAÇÃO INTERATIVA PÚBLICA</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                EXPERIMENTE NOSSO PLAYER
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
                Pesquise por nome ou insira um ID TMDB para testar a busca de fontes e a reprodução de vídeo instantânea.
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold self-start md:self-auto">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Player Ativo & Operacional</span>
            </div>
          </div>

          <div className="pt-8">
            <InteractiveDemoPlayer />
          </div>
        </div>
      </section>

      {/* 5. RECURSOS E RECURSOS DA API */}
      <section id="api-resources" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20">
        <div className="text-center max-w-3xl mx-auto mb-12 space-y-3">
          <span className="text-xs font-mono font-bold text-[#E50914] uppercase tracking-widest">
            RECURSOS TÉCNICOS
          </span>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Projetado para Desenvolvedores Exigentes
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400">
            Tudo o que precisa para alimentar o seu aplicativo de reprodução ou catálogo com metadados e streams seguros.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <div className="bg-[#0B0B0E] border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#E50914]/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-[#E50914]/15 border border-[#E50914]/30 flex items-center justify-center text-[#E50914]">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">Integração Total TMDB</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Consulte conteúdos pelo ID oficial do TMDB. A nossa API resolve títulos, sinopses, capas, temporizadores e fontes automaticamente.
            </p>
          </div>

          <div className="bg-[#0B0B0E] border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#E50914]/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Server className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">Fontes de Vídeo HLS & MP4</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Suporte nativo para streams M3U8 em resolução adaptativa, links MP4 diretos e iFrames com proteção contra falhas.
            </p>
          </div>

          <div className="bg-[#0B0B0E] border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#E50914]/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">Baixa Latência & 99.9% Uptime</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Infraestrutura otimizada com caching em memória e banco centralizado em JSON + Firestore para respostas em milissegundos.
            </p>
          </div>

        </div>
      </section>

      {/* 6. CODE EXAMPLES & INTERACTIVE TABS */}
      <section id="code-examples" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20">
        <div className="bg-[#0B0B0F] border border-white/10 rounded-3xl p-6 sm:p-8 overflow-hidden">
          
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#E50914] uppercase tracking-widest mb-1">
                <Terminal className="w-4 h-4" />
                <span>INTEGRAÇÃO RÁPIDA</span>
              </div>
              <h2 className="text-xl sm:text-3xl font-black text-white tracking-tight">
                Exemplos de Integração em Código
              </h2>
            </div>

            {/* Language Selector Tabs */}
            <div className="flex items-center p-1 bg-black/60 rounded-xl border border-white/10 self-start lg:self-auto">
              <button
                type="button"
                onClick={() => setActiveCodeTab('curl')}
                className={`px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all ${
                  activeCodeTab === 'curl' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                }`}
              >
                cURL
              </button>
              <button
                type="button"
                onClick={() => setActiveCodeTab('javascript')}
                className={`px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all ${
                  activeCodeTab === 'javascript' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                }`}
              >
                JavaScript
              </button>
              <button
                type="button"
                onClick={() => setActiveCodeTab('python')}
                className={`px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all ${
                  activeCodeTab === 'python' ? 'bg-[#E50914] text-white shadow' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Python
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6 pt-6">
            
            {/* Request Code Snippet */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 px-1">
                <span>Requisição ({activeCodeTab.toUpperCase()})</span>
                <button
                  type="button"
                  onClick={copyCode}
                  className="flex items-center gap-1 text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded transition-colors text-[11px]"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
              <pre className="bg-black/80 border border-white/10 rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto leading-relaxed h-[260px]">
                <code>{codeSnippets[activeCodeTab]}</code>
              </pre>
            </div>

            {/* JSON Response Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 px-1">
                <span>Resposta Esperada (JSON)</span>
                <span className="text-[10px] text-emerald-400 font-mono font-bold">200 OK</span>
              </div>
              <pre className="bg-black/80 border border-white/10 rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed h-[260px]">
                <code>{jsonPreview}</code>
              </pre>
            </div>

          </div>
        </div>
      </section>

      {/* 7. DOCUMENTATION PREVIEW BANNER */}
      <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20">
        <div className="bg-gradient-to-r from-[#E50914]/20 via-[#0B0B0F] to-[#0B0B0F] border border-[#E50914]/30 rounded-3xl p-8 sm:p-12 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-3 max-w-2xl">
            <span className="text-xs font-mono font-bold text-[#E50914] uppercase tracking-widest">
              GUIA DO DESENVOLVEDOR
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Pronto para integrar no seu projeto?
            </h2>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Consulte a documentação completa dos endpoints `/api/v1/filmes`, `/api/v1/series`, 
              parâmetros de ordenação, schemas de resposta e autenticação de chaves.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigateTo('documentation')}
            className="px-8 py-4 bg-[#E50914] hover:bg-[#b80710] text-white font-black text-sm uppercase tracking-wider rounded-xl transition-all shadow-xl shadow-[#E50914]/40 shrink-0 flex items-center justify-center gap-2"
          >
            <BookOpen className="w-5 h-5" />
            <span>Ver Documentação Completa</span>
          </button>
        </div>
      </section>

    </div>
  );
};

/* =====================================================================
   PUBLIC INTERACTIVE DEMO PLAYER COMPONENT ("EXPERIMENTE NOSSO PLAYER")
   ===================================================================== */
const InteractiveDemoPlayer: React.FC = () => {
  const [contentType, setContentType] = useState<'movie' | 'tv'>('movie');
  const [queryInput, setQueryInput] = useState('');
  const [seasonNum, setSeasonNum] = useState(1);
  const [episodeNum, setEpisodeNum] = useState(1);

  // Search Results Dropdown State
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<any | null>(null);

  // Playback State
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [demoSources, setDemoSources] = useState<VideoSourceItem[]>([]);
  const [demoTitle, setDemoTitle] = useState<string>('');
  const [demoPoster, setDemoPoster] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Real-time Search Handler (Title or TMDB ID)
  useEffect(() => {
    if (!queryInput.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const cleanQuery = queryInput.trim();
        const res = await api.search(cleanQuery, contentType);
        if (res && (res.local || res.external)) {
          const combined = [...(res.local || []), ...(res.external || [])];
          setSearchResults(combined.slice(0, 8));
          setShowDropdown(true);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [queryInput, contentType]);

  // Handle media selection from dropdown
  const handleSelectMedia = (item: any) => {
    setSelectedMedia(item);
    setQueryInput(`${item.title} (${item.tmdbId})`);
    setShowDropdown(false);
  };

  // Perform Playback Consultation ("REPRODUZIR")
  const handlePlayback = async () => {
    setErrorMessage(null);
    setDemoSources([]);
    setIsLoadingSource(true);

    let tmdbIdToQuery: number | null = null;
    let typeToQuery: 'movie' | 'tv' = contentType;

    if (selectedMedia && selectedMedia.tmdbId) {
      tmdbIdToQuery = selectedMedia.tmdbId;
      typeToQuery = selectedMedia.type === 'tv' || selectedMedia.type === 'series' ? 'tv' : 'movie';
    } else {
      const parsed = parseInt(queryInput.replace(/\D/g, ''), 10);
      if (!isNaN(parsed) && parsed > 0) {
        tmdbIdToQuery = parsed;
      }
    }

    if (!tmdbIdToQuery) {
      setIsLoadingSource(false);
      setErrorMessage('Por favor, digite um título válido ou insira um TMDB ID numérico.');
      return;
    }

    try {
      const res =
        typeToQuery === 'movie'
          ? await api.getPlayerMovie(tmdbIdToQuery)
          : await api.getPlayerTv(tmdbIdToQuery, seasonNum, episodeNum);

      const resolvedList =
        res?.sources && res.sources.length > 0
          ? res.sources
          : res?.source?.url
            ? [res.source, ...(res.alternativeSources || [])]
            : [];

      if (res && res.success && resolvedList.length > 0) {
        setDemoSources(resolvedList as VideoSourceItem[]);
        setDemoTitle(
          res.content?.title ||
            selectedMedia?.title ||
            (typeToQuery === 'tv' ? `Série ${tmdbIdToQuery} (T${seasonNum}:E${episodeNum})` : `Filme ${tmdbIdToQuery}`)
        );
        setDemoPoster(res.content?.backdrop || res.content?.poster || selectedMedia?.backdropPath || selectedMedia?.posterPath);
      } else {
        setErrorMessage(res?.message || 'Este conteúdo ainda não possui uma fonte de demonstração disponível.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao consultar a rede de vídeo RONYCINE.');
    } finally {
      setIsLoadingSource(false);
    }
  };

  const primarySource = demoSources[0];

  return (
    <div className="grid lg:grid-cols-12 gap-8 items-start">
      {/* Left Input & Selection Form (5 Cols) */}
      <div className="lg:col-span-5 space-y-5 bg-[#09090D] border border-white/10 rounded-2xl p-5 sm:p-6">
        {/* Type Switcher (Filme vs Série) */}
        <div className="flex p-1 bg-black/80 rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => {
              setContentType('movie');
              setSelectedMedia(null);
              setQueryInput('');
              setErrorMessage(null);
              setDemoSources([]);
            }}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
              contentType === 'movie' ? 'bg-[#E50914] text-white shadow-md' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Film className="w-4 h-4" />
            <span>Filme</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setContentType('tv');
              setSelectedMedia(null);
              setQueryInput('');
              setErrorMessage(null);
              setDemoSources([]);
            }}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
              contentType === 'tv' ? 'bg-[#E50914] text-white shadow-md' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Tv className="w-4 h-4" />
            <span>Série</span>
          </button>
        </div>

        {/* Search & TMDB ID Input */}
        <div className="relative">
          <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
            Pesquisar Título ou TMDB ID
          </label>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => {
                setQueryInput(e.target.value);
                setSelectedMedia(null);
              }}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              placeholder={contentType === 'movie' ? 'Ex: Clube da Luta ou ID 550' : 'Ex: Game of Thrones ou ID 1399'}
              className="w-full bg-black/60 border border-white/15 rounded-xl py-3 pl-10 pr-10 text-xs sm:text-sm text-white placeholder:text-zinc-600 focus:border-[#E50914] focus:outline-none transition-all"
            />
            {isSearching && (
              <RefreshCw className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#E50914] animate-spin" />
            )}
          </div>

          {/* Search Dropdown Results */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-2 bg-[#0F0F14] border border-white/15 rounded-xl shadow-2xl z-30 max-h-60 overflow-y-auto py-1">
              {searchResults.map((item) => (
                <button
                  key={`${item.type}-${item.tmdbId}`}
                  type="button"
                  onClick={() => handleSelectMedia(item)}
                  className="w-full px-3 py-2 text-left hover:bg-white/10 flex items-center gap-3 transition-colors text-xs border-b border-white/5 last:border-0"
                >
                  <img
                    src={item.posterPath || 'https://via.placeholder.com/40x60?text=No+Cap'}
                    alt={item.title}
                    className="w-8 h-12 object-cover rounded bg-black shrink-0"
                  />
                  <div className="truncate">
                    <div className="font-bold text-white truncate">{item.title}</div>
                    <div className="text-[10px] text-zinc-400 flex items-center gap-2 mt-0.5">
                      <span className="text-[#E50914] font-mono font-bold">TMDB: {item.tmdbId}</span>
                      <span>•</span>
                      <span>{item.releaseYear || item.firstAirDate?.substring(0, 4) || 'TMDB'}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Season & Episode Selectors for Series */}
        {contentType === 'tv' && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                Temporada
              </label>
              <input
                type="number"
                min="1"
                value={seasonNum}
                onChange={(e) => setSeasonNum(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full bg-black/60 border border-white/15 rounded-xl py-2.5 px-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                Episódio
              </label>
              <input
                type="number"
                min="1"
                value={episodeNum}
                onChange={(e) => setEpisodeNum(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full bg-black/60 border border-white/15 rounded-xl py-2.5 px-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Submit Playback Button ("REPRODUZIR") */}
        <button
          type="button"
          onClick={handlePlayback}
          disabled={isLoadingSource}
          className="w-full py-3.5 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-[#E50914]/30 flex items-center justify-center gap-2"
        >
          {isLoadingSource ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>REPRODUZIR NO DEMO PLAYER</span>
            </>
          )}
        </button>

        {/* Selected Media Specs Preview */}
        {selectedMedia && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-3">
            <img
              src={selectedMedia.posterPath}
              alt={selectedMedia.title}
              className="w-10 h-14 object-cover rounded shadow"
            />
            <div className="text-xs truncate">
              <span className="text-[9px] font-mono text-[#E50914] font-bold block uppercase">
                Mídia Selecionada
              </span>
              <span className="font-bold text-white block truncate">{selectedMedia.title}</span>
              <span className="text-[10px] text-zinc-400">
                TMDB ID: {selectedMedia.tmdbId} | Nota: {selectedMedia.voteAverage || '8.0'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Right Video Player Screen Container (7 Cols) */}
      <div className="lg:col-span-7 bg-black border border-white/15 rounded-2xl overflow-hidden shadow-2xl relative min-h-[340px] sm:min-h-[420px] flex flex-col justify-between">
        {/* Top Player Header Status */}
        <div className="p-3 bg-gradient-to-b from-black/90 to-transparent flex items-center justify-between z-20 border-b border-white/5">
          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-300 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#E50914] shrink-0" />
            <span className="font-bold text-white truncate">
              {demoTitle || selectedMedia?.title || 'RONYCINE Video Stream Engine'}
            </span>
          </div>

          {primarySource && (
            <span className="px-2 py-0.5 text-[9px] font-mono font-bold bg-[#E50914]/20 text-[#E50914] border border-[#E50914]/40 rounded shrink-0">
              {String(primarySource.format || primarySource.type || 'AUTO').toUpperCase()} • {primarySource.serverName || primarySource.provider || 'Fonte'}
            </span>
          )}
        </div>

        {/* Main Video Display Area */}
        <div className="relative flex-1 flex items-center justify-center bg-[#050507] aspect-video">
          <ErrorBoundary fallbackTitle="Erro no Demo Player" resetKey={primarySource?.url || 'standby'}>
            {isLoadingSource ? (
              <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                <RefreshCw className="w-8 h-8 text-[#E50914] animate-spin" />
                <p className="text-xs font-mono text-zinc-400">Inicializando fonte e verificando compatibilidade...</p>
              </div>
            ) : errorMessage ? (
              <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center max-w-md">
                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-white">Fonte indisponível</h4>
                <p className="text-xs text-red-300 font-medium bg-red-500/10 border border-red-500/20 p-3 rounded-xl leading-relaxed">
                  {errorMessage}
                </p>
              </div>
            ) : demoSources.length > 0 ? (
              <div className="w-full h-full">
                <RonycinePlayer
                  sources={demoSources}
                  title={demoTitle || selectedMedia?.title}
                  poster={demoPoster}
                  autoplay={true}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center space-y-3 p-8 text-center text-zinc-600">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-500">
                  <Play className="w-8 h-8 opacity-40 fill-zinc-500" />
                </div>
                <h4 className="text-sm font-bold text-zinc-300">Aguardando Seleção de Conteúdo</h4>
                <p className="text-xs text-zinc-500 max-w-xs">
                  Selecione um filme ou série à esquerda e clique em REPRODUZIR para testar o player.
                </p>
              </div>
            )}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};
