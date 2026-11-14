import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  AppWindow,
  BookOpen,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  LayoutDashboard,
  Lock,
  Menu,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Terminal,
  Trash2,
  Tv,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../lib/api.js';
import { OFFICIAL_BASE_URL, buildOfficialEmbedPath, buildOfficialEmbedUrl } from '../lib/siteConfig.js';
import ronycineSdkRaw from '../sdk/ronycine.ts?raw';

type PortalSection =
  | 'dashboard'
  | 'apps'
  | 'keys'
  | 'stats'
  | 'docs'
  | 'tester'
  | 'player_integration'
  | 'sdk'
  | 'app_settings';

interface RevealedSecret {
  title: string;
  key: string;
  appName?: string;
}

export const DeveloperPortalView: React.FC = () => {
  const { user, loading: authLoading, navigateTo } = useAuth();
  const [section, setSection] = useState<PortalSection>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [overview, setOverview] = useState<any>(null);
  const [apps, setApps] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);

  const [revealedSecret, setRevealedSecret] = useState<RevealedSecret | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create app state
  const [newAppName, setNewAppName] = useState('');
  const [newAppDesc, setNewAppDesc] = useState('');
  const [newAppDomains, setNewAppDomains] = useState('');
  const [creatingApp, setCreatingApp] = useState(false);

  // Create key state
  const [selectedAppForKey, setSelectedAppForKey] = useState('');
  const [newKeyName, setNewKeyName] = useState('Chave de Produção');
  const [creatingKey, setCreatingKey] = useState(false);

  // App settings state
  const [selectedAppId, setSelectedAppId] = useState('');
  const [editAppName, setEditAppName] = useState('');
  const [editAppDesc, setEditAppDesc] = useState('');
  const [editDomainInput, setEditDomainInput] = useState('');
  const [editDomainsList, setEditDomainsList] = useState<string[]>([]);
  const [savingApp, setSavingApp] = useState(false);

  // API Tester state
  const [testerApiKey, setTesterApiKey] = useState('');
  const [testerMethod, setTesterMethod] = useState<'GET' | 'POST'>('GET');
  const [testerEndpoint, setTesterEndpoint] = useState('/api/v1/filmes?page=1&limit=5');
  const [testerBody, setTesterBody] = useState('{\n  "contentId": 550,\n  "mediaType": "movie",\n  "ttlSeconds": 3600\n}');
  const [testerLoading, setTesterLoading] = useState(false);
  const [testerResult, setTesterResult] = useState<{
    status: number;
    latencyMs: number;
    headers: Record<string, string>;
    body: any;
  } | null>(null);

  // Player Integration state
  const [playerContentId, setPlayerContentId] = useState('550');
  const [playerMediaType, setPlayerMediaType] = useState<'movie' | 'tv'>('movie');
  const [playerSeason, setPlayerSeason] = useState('1');
  const [playerEpisode, setPlayerEpisode] = useState('1');
  const [playerApiKey, setPlayerApiKey] = useState('');
  const [playerDomain, setPlayerDomain] = useState('');
  const [playerTokenLoading, setPlayerTokenLoading] = useState(false);
  const [generatedPlayerUrl, setGeneratedPlayerUrl] = useState('');
  const [generatedPlaybackToken, setGeneratedPlaybackToken] = useState('');
  const [showLivePlayerPreview, setShowLivePlayerPreview] = useState(false);

  const origin = OFFICIAL_BASE_URL;

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const loadPortalData = async () => {
    if (!user) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [ovRes, appsRes, keysRes, statsRes, plansRes] = await Promise.all([
        api.getDeveloperOverview(),
        api.getDeveloperApps(),
        api.getDeveloperKeys(),
        api.getDeveloperStats(),
        api.getV1Plans().catch(() => ({ success: false, data: [] }))
      ]);
      setOverview(ovRes);
      const loadedApps = appsRes?.apps || [];
      setApps(loadedApps);
      setKeys(keysRes?.keys || []);
      setStats(statsRes?.stats || null);
      setPlans(plansRes?.data || []);

      if (loadedApps.length > 0 && !selectedAppForKey) {
        setSelectedAppForKey(loadedApps[0].id);
      }
      if (loadedApps.length > 0 && !selectedAppId) {
        const first = loadedApps[0];
        setSelectedAppId(first.id);
        setEditAppName(first.name || '');
        setEditAppDesc(first.description || '');
        setEditDomainsList(Array.isArray(first.authorizedDomains) ? first.authorizedDomains : []);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao carregar dados do Portal do Desenvolvedor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadPortalData();
    }
  }, [user?.id]);

  const selectedSettingsApp = useMemo(
    () => apps.find((a) => a.id === selectedAppId) || null,
    [apps, selectedAppId]
  );

  const handleSelectSettingsApp = (appId: string) => {
    setSelectedAppId(appId);
    const found = apps.find((a) => a.id === appId);
    if (found) {
      setEditAppName(found.name || '');
      setEditAppDesc(found.description || '');
      setEditDomainsList(Array.isArray(found.authorizedDomains) ? found.authorizedDomains : []);
    }
  };

  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return;
    setCreatingApp(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const domains = newAppDomains
        .split(/[\n,]+/)
        .map((d) => d.trim())
        .filter(Boolean);
      const res = await api.createDeveloperApp({
        name: newAppName.trim(),
        description: newAppDesc.trim(),
        authorizedDomains: domains
      });
      setRevealedSecret({
        title: 'Aplicação criada — Guarde a sua API Key agora',
        key: res.plaintextKey,
        appName: res.app?.name
      });
      setTesterApiKey(res.plaintextKey);
      setPlayerApiKey(res.plaintextKey);
      setNewAppName('');
      setNewAppDesc('');
      setNewAppDomains('');
      setSuccessMsg(`Aplicação "${res.app?.name}" criada com sucesso.`);
      await loadPortalData();
      setSelectedAppId(res.app?.id || '');
      setSelectedAppForKey(res.app?.id || '');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível criar a aplicação.');
    } finally {
      setCreatingApp(false);
    }
  };

  const handleDeleteApp = async (app: any) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await api.deleteDeveloperApp(app.id);
      setSuccessMsg(`Aplicação "${app.name}" removida.`);
      if (selectedAppId === app.id) setSelectedAppId('');
      await loadPortalData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao remover aplicação.');
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppForKey) {
      setErrorMsg('Crie ou selecione uma aplicação primeiro.');
      return;
    }
    setCreatingKey(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.createDeveloperKey(selectedAppForKey, newKeyName.trim() || 'Nova Chave');
      setRevealedSecret({
        title: 'Nova API Key gerada — Visível apenas uma vez',
        key: res.plaintextKey
      });
      setTesterApiKey(res.plaintextKey);
      setPlayerApiKey(res.plaintextKey);
      setSuccessMsg('Nova API Key criada com sucesso.');
      await loadPortalData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao gerar API Key.');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    setErrorMsg(null);
    try {
      await api.revokeDeveloperKey(keyId);
      setSuccessMsg('API Key revogada.');
      await loadPortalData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao revogar chave.');
    }
  };

  const handleRegenerateKey = async (keyId: string) => {
    setErrorMsg(null);
    try {
      const res = await api.regenerateDeveloperKey(keyId);
      setRevealedSecret({
        title: 'API Key regenerada — A chave anterior foi revogada',
        key: res.plaintextKey
      });
      setTesterApiKey(res.plaintextKey);
      setPlayerApiKey(res.plaintextKey);
      setSuccessMsg('Chave regenerada com sucesso.');
      await loadPortalData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao regenerar chave.');
    }
  };

  const handleAddDomain = () => {
    const val = editDomainInput.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!val) return;
    if (!editDomainsList.includes(val)) {
      setEditDomainsList((prev) => [...prev, val]);
    }
    setEditDomainInput('');
  };

  const handleSaveAppSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppId) return;
    setSavingApp(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await api.updateDeveloperApp(selectedAppId, {
        name: editAppName.trim(),
        description: editAppDesc.trim(),
        authorizedDomains: editDomainsList
      });
      setSuccessMsg('Configurações da aplicação guardadas com sucesso.');
      await loadPortalData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao atualizar configurações.');
    } finally {
      setSavingApp(false);
    }
  };

  const handleRunTester = async () => {
    setTesterLoading(true);
    setTesterResult(null);
    const start = performance.now();
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (testerApiKey.trim()) {
        headers['x-api-key'] = testerApiKey.trim();
      }
      if (testerMethod === 'POST') {
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(testerEndpoint, {
        method: testerMethod,
        headers,
        body: testerMethod === 'POST' ? testerBody : undefined
      });
      const latencyMs = Math.round(performance.now() - start);
      const parsedHeaders: Record<string, string> = {};
      ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-daily-limit', 'x-ratelimit-daily-remaining'].forEach((h) => {
        const v = res.headers.get(h);
        if (v !== null) parsedHeaders[h] = v;
      });
      const data = await res.json().catch(() => ({ rawStatus: res.status }));
      setTesterResult({ status: res.status, latencyMs, headers: parsedHeaders, body: data });
    } catch (err: any) {
      setTesterResult({
        status: 0,
        latencyMs: Math.round(performance.now() - start),
        headers: {},
        body: { error: err?.message || 'Falha de rede ao executar pedido' }
      });
    } finally {
      setTesterLoading(false);
    }
  };

  const handleGeneratePlayerToken = async () => {
    const cid = parseInt(playerContentId, 10);
    if (!cid || cid <= 0) {
      setErrorMsg('Informe um TMDB ID numérico válido.');
      return;
    }
    setPlayerTokenLoading(true);
    setErrorMsg(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (playerApiKey.trim()) {
        headers['x-api-key'] = playerApiKey.trim();
      }
      const res = await fetch('/api/v1/player/token', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contentId: cid,
          mediaType: playerMediaType,
          season: playerMediaType === 'tv' ? parseInt(playerSeason, 10) || 1 : undefined,
          episode: playerMediaType === 'tv' ? parseInt(playerEpisode, 10) || 1 : undefined,
          domain: playerDomain.trim() || undefined,
          ttlSeconds: 3600
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || data?.error || 'Falha ao gerar token de reprodução.');
      }
      setGeneratedPlaybackToken(data.data?.token || '');
      setGeneratedPlayerUrl(data.data?.embedUrl || '');
      setShowLivePlayerPreview(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível gerar o token do player.');
    } finally {
      setPlayerTokenLoading(false);
    }
  };

  const handleDownloadSdk = () => {
    const blob = new Blob([ronycineSdkRaw], { type: 'text/typescript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ronycine.ts';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#080808] pt-28 flex items-center justify-center">
        <RefreshCw className="w-7 h-7 text-[#E50914] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#080808] pt-28 pb-20 px-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-[#111114] border border-white/10 rounded-2xl p-8 text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-[#E50914]/15 border border-[#E50914]/30 flex items-center justify-center mx-auto text-[#E50914]">
            <Lock className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#E50914]">
              RONYCINE DEVELOPER PORTAL
            </span>
            <h1 className="text-2xl font-black text-white">Acesso ao Portal Dev</h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Autentique-se ou crie uma conta gratuita para registar aplicações, gerar API Keys reais, autorizar domínios e gerar tokens para o Player Embed.
            </p>
          </div>
          <div className="flex flex-col gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => navigateTo('login')}
              className="w-full py-3 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-colors"
            >
              Entrar ou Criar Conta
            </button>
            <button
              type="button"
              onClick={() => navigateTo('documentation')}
              className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 text-xs font-semibold rounded-xl transition-colors"
            >
              Consultar Documentação Pública
            </button>
          </div>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: PortalSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
    { id: 'apps', label: 'Minhas Aplicações', icon: AppWindow },
    { id: 'keys', label: 'API Keys', icon: KeyRound },
    { id: 'stats', label: 'Estatísticas', icon: Activity },
    { id: 'docs', label: 'Documentação', icon: BookOpen },
    { id: 'tester', label: 'Testar API', icon: Terminal },
    { id: 'player_integration', label: 'Integração do Player', icon: Tv },
    { id: 'sdk', label: 'SDK Oficial', icon: Code2 },
    { id: 'app_settings', label: 'Configurações da App', icon: Settings }
  ];

  const directEmbedPath = buildOfficialEmbedPath({
    type: playerMediaType,
    tmdbId: playerContentId || '550',
    season: playerSeason || '1',
    episode: playerEpisode || '1'
  });

  const embedPathPreview =
    generatedPlayerUrl || directEmbedPath;

  const officialEmbedDisplayUrl = generatedPlayerUrl
    ? `${origin}${generatedPlayerUrl}`
    : buildOfficialEmbedUrl({
        type: playerMediaType,
        tmdbId: playerContentId || '550',
        season: playerSeason || '1',
        episode: playerEpisode || '1'
      });

  const iframeSnippet = `<iframe
  src="${officialEmbedDisplayUrl}"
  width="100%"
  height="540"
  frameborder="0"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowfullscreen
></iframe>`;

  const tsSdkExample = `import { Ronycine } from './ronycine';

const ronycine = new Ronycine({
  apiKey: 'SUA_API_KEY_AQUI',
  baseURL: '${origin}'
});

// 1. Listar filmes com paginação
const filmes = await ronycine.getFilmes({ page: 1, limit: 20 });

// 2. Pesquisar catálogo
const busca = await ronycine.buscar('Fight Club');

// 3. Direct Play URL / Embed Oficial
const directUrl = ronycine.getDirectPlayEmbedUrl({ tmdbId: 550, type: 'movie' });
console.log('Embed URL:', directUrl);`;

  const kotlinExample = `// Kotlin / Android (Retrofit + OkHttp + WebView)
interface RonycineApiService {
    @GET("api/v1/filmes")
    suspend fun getMovies(
        @Header("x-api-key") apiKey: String,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20
    ): Response<RonycineListResponse>

    @GET("api/v1/direct-play/movie/{tmdbId}")
    suspend fun resolveMovieDirectPlay(
        @Header("x-api-key") apiKey: String,
        @Path("tmdbId") tmdbId: Int
    ): Response<DirectPlayResponse>
}

// Reproduzir no WebView Android (Direct Embed)
webView.settings.javaScriptEnabled = true
webView.settings.mediaPlaybackRequiresUserGesture = false
webView.loadUrl("${origin}/embed/550")
// Para série / episódio:
webView.loadUrl("${origin}/embed/1399/1/1")`;

  return (
    <div className="min-h-screen bg-[#080808] pt-20 pb-16 text-zinc-200">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* TOP HEADER BAR */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#E50914]">
                <Code2 className="w-3.5 h-3.5" />
                <span>Portal do Desenvolvedor</span>
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight mt-0.5">
                Console RONYCINE API
              </h1>
            </div>

            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="lg:hidden p-2 rounded-lg bg-white/5 border border-white/10 text-zinc-300"
              aria-label="Menu do Portal"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={loadPortalData}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#E50914]' : ''}`} />
              <span>Atualizar</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('apps')}
              className="px-3.5 py-2 rounded-lg bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nova Aplicação</span>
            </button>
          </div>
        </div>

        {/* ALERTS & ONE-TIME SECRET REVEAL */}
        {errorMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
            <button type="button" onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
            <button type="button" onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {revealedSecret && (
          <div className="mt-4 p-5 rounded-xl bg-[#161012] border border-[#E50914]/50 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#E50914] uppercase tracking-wider">
                  {revealedSecret.title}
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Por motivos de segurança (hash SHA-256 no servidor), esta chave não voltará a ser exibida em texto simples. Copie e guarde em local seguro.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRevealedSecret(null)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <code className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2.5 text-xs font-mono text-emerald-400 break-all">
                {revealedSecret.key}
              </code>
              <button
                type="button"
                onClick={() => copyText(revealedSecret.key, 'revealed-secret')}
                className="px-4 py-2.5 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 shrink-0"
              >
                {copiedId === 'revealed-secret' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedId === 'revealed-secret' ? 'Copiada!' : 'Copiar API Key'}</span>
              </button>
            </div>
          </div>
        )}

        {/* LAYOUT GRID: SIDEBAR + CONTENT */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT SIDEBAR */}
          <aside className={`lg:col-span-3 ${mobileNavOpen ? 'block' : 'hidden lg:block'}`}>
            <div className="bg-[#111114] border border-white/10 rounded-xl p-2 space-y-1 sticky top-24">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors text-left ${
                      active
                        ? 'bg-[#E50914] text-white'
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}

              <div className="pt-3 mt-3 border-t border-white/10 px-3 pb-2 space-y-1 text-[11px] text-zinc-500">
                <div>Conta: <span className="text-zinc-300 font-medium">{user.email}</span></div>
                <div>Plano base: <span className="text-zinc-300 font-mono">{apps[0]?.plan || 'FREE'}</span></div>
              </div>
            </div>
          </aside>

          {/* MAIN WORKSPACE */}
          <div className="lg:col-span-9 space-y-6 min-w-0">
            {/* 1. DASHBOARD */}
            {section === 'dashboard' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] text-zinc-400 uppercase font-bold">Aplicações</span>
                    <div className="text-2xl font-black text-white mt-1 tabular-nums">
                      {overview?.summary?.appsCount ?? apps.length}
                    </div>
                  </div>
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] text-zinc-400 uppercase font-bold">Chaves Ativas</span>
                    <div className="text-2xl font-black text-white mt-1 tabular-nums">
                      {overview?.summary?.activeKeysCount ?? keys.filter((k) => k.status === 'ACTIVE').length}
                    </div>
                  </div>
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] text-zinc-400 uppercase font-bold">Requisições (24h)</span>
                    <div className="text-2xl font-black text-white mt-1 tabular-nums">
                      {(overview?.summary?.requestsLast24h ?? stats?.requestsLast24h ?? 0).toLocaleString('pt-PT')}
                    </div>
                  </div>
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] text-zinc-400 uppercase font-bold">Latência Média</span>
                    <div className="text-2xl font-black text-white mt-1 tabular-nums">
                      {overview?.summary?.avgLatencyMs ?? stats?.avgLatencyMs ?? 0} ms
                    </div>
                  </div>
                </div>

                <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Suas Aplicações</h2>
                    <button
                      type="button"
                      onClick={() => setSection('apps')}
                      className="text-xs font-semibold text-[#E50914] hover:underline"
                    >
                      Gerir aplicações →
                    </button>
                  </div>

                  {apps.length === 0 ? (
                    <div className="py-8 text-center space-y-3 border border-dashed border-white/10 rounded-xl">
                      <p className="text-xs text-zinc-400">Ainda não registou nenhuma aplicação.</p>
                      <button
                        type="button"
                        onClick={() => setSection('apps')}
                        className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg"
                      >
                        Criar Primeira Aplicação
                      </button>
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {apps.map((app) => (
                        <div key={app.id} className="p-4 rounded-xl bg-black/50 border border-white/10 flex flex-col justify-between gap-3">
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-white text-sm truncate">{app.name}</span>
                              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${app.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                {app.status}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{app.description || 'Sem descrição'}</p>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono pt-2 border-t border-white/5">
                            <span>Plano: {app.plan}</span>
                            <span>{Array.isArray(app.authorizedDomains) ? app.authorizedDomains.length : 0} domínios</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <button
                    type="button"
                    onClick={() => setSection('keys')}
                    className="p-4 rounded-xl bg-[#111114] border border-white/10 hover:border-[#E50914]/50 text-left space-y-1 transition-colors"
                  >
                    <KeyRound className="w-5 h-5 text-[#E50914]" />
                    <div className="text-sm font-bold text-white pt-1">Gerar API Key</div>
                    <div className="text-xs text-zinc-400">Criar, regenerar ou revogar chaves SHA-256</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('player_integration')}
                    className="p-4 rounded-xl bg-[#111114] border border-white/10 hover:border-[#E50914]/50 text-left space-y-1 transition-colors"
                  >
                    <Tv className="w-5 h-5 text-[#E50914]" />
                    <div className="text-sm font-bold text-white pt-1">Player Embed</div>
                    <div className="text-xs text-zinc-400">Gerar tokens HMAC e código iframe</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('sdk')}
                    className="p-4 rounded-xl bg-[#111114] border border-white/10 hover:border-[#E50914]/50 text-left space-y-1 transition-colors"
                  >
                    <Code2 className="w-5 h-5 text-[#E50914]" />
                    <div className="text-sm font-bold text-white pt-1">SDK Web & Android</div>
                    <div className="text-xs text-zinc-400">Descarregar SDK TypeScript/JS oficial</div>
                  </button>
                </div>
              </div>
            )}

            {/* 2. MINHAS APLICAÇÕES */}
            {section === 'apps' && (
              <div className="space-y-6">
                <form onSubmit={handleCreateApp} className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Registar Nova Aplicação</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Nome da Aplicação *</label>
                      <input
                        type="text"
                        required
                        value={newAppName}
                        onChange={(e) => setNewAppName(e.target.value)}
                        placeholder="Ex: Meu Portal de Filmes"
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Domínios Autorizados (separados por vírgula)</label>
                      <input
                        type="text"
                        value={newAppDomains}
                        onChange={(e) => setNewAppDomains(e.target.value)}
                        placeholder="ex: meusite.com, app.meusite.com"
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Descrição</label>
                    <input
                      type="text"
                      value={newAppDesc}
                      onChange={(e) => setNewAppDesc(e.target.value)}
                      placeholder="Breve descrição da integração Web ou Android"
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={creatingApp}
                    className="px-4 py-2.5 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2"
                  >
                    {creatingApp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    <span>Criar Aplicação & Gerar API Key</span>
                  </button>
                </form>

                <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Aplicações Registadas ({apps.length})</h2>
                  {apps.length === 0 ? (
                    <p className="text-xs text-zinc-500">Nenhuma aplicação encontrada.</p>
                  ) : (
                    <div className="space-y-3">
                      {apps.map((app) => (
                        <div key={app.id} className="p-4 rounded-xl bg-black/50 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-white text-sm">{app.name}</span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-zinc-300">{app.plan}</span>
                              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${app.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                {app.status}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400">{app.description || 'Sem descrição'}</p>
                            <div className="text-[11px] font-mono text-zinc-500">
                              ID: {app.id} • Domínios: {app.authorizedDomains?.length ? app.authorizedDomains.join(', ') : 'Todos (sem restrição)'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectSettingsApp(app.id);
                                setSection('app_settings');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-200"
                            >
                              Configurar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteApp(app)}
                              className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20"
                              title="Remover aplicação"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. API KEYS */}
            {section === 'keys' && (
              <div className="space-y-6">
                <form onSubmit={handleCreateKey} className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Gerar Nova API Key</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Aplicação</label>
                      <select
                        value={selectedAppForKey}
                        onChange={(e) => setSelectedAppForKey(e.target.value)}
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none"
                      >
                        {apps.length === 0 && <option value="">Nenhuma aplicação disponível</option>}
                        {apps.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} ({a.plan})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Identificação da Chave</label>
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="Ex: Backend Produção"
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={creatingKey || apps.length === 0}
                    className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2"
                  >
                    {creatingKey ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                    <span>Gerar API Key</span>
                  </button>
                </form>

                <div className="bg-[#111114] border border-white/10 rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-white/10">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Chaves Emitidas ({keys.length})</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-black/40 text-zinc-500 text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="p-3.5">Nome / Prefixo</th>
                          <th className="p-3.5">Aplicação</th>
                          <th className="p-3.5">Estado</th>
                          <th className="p-3.5">Uso Total</th>
                          <th className="p-3.5">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {keys.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-zinc-500">Nenhuma API Key emitida.</td>
                          </tr>
                        ) : (
                          keys.map((k) => {
                            const app = apps.find((a) => a.id === k.appId);
                            return (
                              <tr key={k.id} className="hover:bg-white/[0.02]">
                                <td className="p-3.5">
                                  <div className="font-bold text-white">{k.name}</div>
                                  <div className="font-mono text-[11px] text-zinc-400">{k.keyPrefix}••••••••••••</div>
                                </td>
                                <td className="p-3.5 text-zinc-300">{app?.name || k.appId}</td>
                                <td className="p-3.5">
                                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${k.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                    {k.status}
                                  </span>
                                </td>
                                <td className="p-3.5 font-mono tabular-nums text-zinc-300">{k.requestCount ?? 0}</td>
                                <td className="p-3.5">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleRegenerateKey(k.id)}
                                      className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-200 text-[11px] font-semibold flex items-center gap-1"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                      <span>Regenerar</span>
                                    </button>
                                    {k.status === 'ACTIVE' && (
                                      <button
                                        type="button"
                                        onClick={() => handleRevokeKey(k.id)}
                                        className="px-2.5 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] font-semibold"
                                      >
                                        Revogar
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* 4. ESTATÍSTICAS */}
            {section === 'stats' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] text-zinc-400 uppercase font-bold">Req / Min</span>
                    <div className="text-2xl font-black text-white mt-1 tabular-nums">{stats?.requestsLastMinute ?? 0}</div>
                  </div>
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] text-zinc-400 uppercase font-bold">Total 24h</span>
                    <div className="text-2xl font-black text-white mt-1 tabular-nums">{stats?.requestsLast24h ?? 0}</div>
                  </div>
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] text-zinc-400 uppercase font-bold">Taxa de Erro</span>
                    <div className="text-2xl font-black text-white mt-1 tabular-nums">{stats?.errorRatePercent ?? 0}%</div>
                  </div>
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] text-zinc-400 uppercase font-bold">Latência Média</span>
                    <div className="text-2xl font-black text-white mt-1 tabular-nums">{stats?.avgLatencyMs ?? 0} ms</div>
                  </div>
                </div>

                <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Uso por Endpoint</h2>
                  {!stats?.topEndpoints?.length ? (
                    <p className="text-xs text-zinc-500">Ainda não existem requisições registadas com as suas chaves.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-black/40 text-zinc-500 text-[10px] uppercase">
                          <tr>
                            <th className="p-3">Endpoint</th>
                            <th className="p-3">Requisições</th>
                            <th className="p-3">Erros</th>
                            <th className="p-3">Latência</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-mono">
                          {stats.topEndpoints.map((ep: any) => (
                            <tr key={ep.endpoint}>
                              <td className="p-3 text-white">{ep.endpoint}</td>
                              <td className="p-3 tabular-nums">{ep.count}</td>
                              <td className="p-3 tabular-nums text-red-400">{ep.errors}</td>
                              <td className="p-3 tabular-nums text-zinc-400">{ep.avgLatencyMs} ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {stats?.recentErrors?.length > 0 && (
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-3">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Erros Recentes</h3>
                    <div className="space-y-2">
                      {stats.recentErrors.map((err: any) => (
                        <div key={err.id} className="p-3 rounded-lg bg-black/60 border border-red-500/20 flex items-center justify-between text-xs font-mono">
                          <span className="text-red-400">{err.statusCode} • {err.endpoint}</span>
                          <span className="text-zinc-500">{new Date(err.timestamp).toLocaleTimeString('pt-PT')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5. DOCUMENTAÇÃO RÁPIDA */}
            {section === 'docs' && (
              <div className="bg-[#111114] border border-white/10 rounded-xl p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">Referência Rápida da API v1</h2>
                    <p className="text-xs text-zinc-400 mt-1">
                      Envie a sua chave no header <code className="text-emerald-400">x-api-key</code> ou <code className="text-emerald-400">Authorization: Bearer rc_live_...</code>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateTo('documentation')}
                    className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shrink-0"
                  >
                    <span>Documentação Completa</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 text-xs font-mono">
                  {[
                    { m: 'GET', p: '/api/v1/filmes?page=1&limit=20', d: 'Listar filmes paginados' },
                    { m: 'GET', p: '/api/v1/filmes/{tmdbId}', d: 'Detalhes e fontes do filme' },
                    { m: 'GET', p: '/api/v1/series?page=1&limit=20', d: 'Listar séries paginadas' },
                    { m: 'GET', p: '/api/v1/series/{tmdbId}/temporadas/{s}/episodios/{e}', d: 'Detalhes e fontes do episódio' },
                    { m: 'GET', p: '/api/v1/buscar?q=termo', d: 'Pesquisa unificada' },
                    { m: 'GET', p: '/api/v1/fontes/{contentId}?type=movie', d: 'Fontes sanitizadas de reprodução' },
                    { m: 'POST', p: '/api/v1/player/token', d: 'Gerar token temporário para embed' },
                    { m: 'GET', p: '/api/v1/generos', d: 'Listar géneros do catálogo' }
                  ].map((item) => (
                    <div key={item.p} className="p-3.5 rounded-lg bg-black/50 border border-white/10 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${item.m === 'POST' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                          {item.m}
                        </span>
                        <span className="text-white truncate">{item.p}</span>
                      </div>
                      <p className="text-[11px] font-sans text-zinc-400">{item.d}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. TESTAR API */}
            {section === 'tester' && (
              <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-4">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Testador Integrado de Endpoints</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Endpoint</label>
                    <input
                      type="text"
                      value={testerEndpoint}
                      onChange={(e) => setTesterEndpoint(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#E50914] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Método</label>
                    <select
                      value={testerMethod}
                      onChange={(e) => setTesterMethod(e.target.value as 'GET' | 'POST')}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#E50914] outline-none"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Header x-api-key (opcional para rotas públicas)</label>
                  <input
                    type="text"
                    value={testerApiKey}
                    onChange={(e) => setTesterApiKey(e.target.value)}
                    placeholder="rc_live_..."
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 focus:border-[#E50914] outline-none"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Saúde', m: 'GET' as const, url: '/api/v1/saude' },
                    { label: 'Filmes (p.1)', m: 'GET' as const, url: '/api/v1/filmes?page=1&limit=5' },
                    { label: 'Séries (p.1)', m: 'GET' as const, url: '/api/v1/series?page=1&limit=5' },
                    { label: 'Buscar', m: 'GET' as const, url: '/api/v1/buscar?q=Fight' },
                    { label: 'Fontes 550', m: 'GET' as const, url: '/api/v1/fontes/550?type=movie' },
                    { label: 'Token Player', m: 'POST' as const, url: '/api/v1/player/token' }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setTesterMethod(preset.m);
                        setTesterEndpoint(preset.url);
                      }}
                      className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-zinc-300"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {testerMethod === 'POST' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Body JSON</label>
                    <textarea
                      rows={4}
                      value={testerBody}
                      onChange={(e) => setTesterBody(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg p-3 text-xs font-mono text-zinc-200 focus:border-[#E50914] outline-none"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleRunTester}
                  disabled={testerLoading}
                  className="px-5 py-2.5 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2"
                >
                  {testerLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Executar Requisição Real</span>
                </button>

                {testerResult && (
                  <div className="bg-black border border-white/10 rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-white/5 border-b border-white/10 flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-3">
                        <span className={testerResult.status >= 200 && testerResult.status < 300 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                          HTTP {testerResult.status}
                        </span>
                        <span className="text-zinc-400">{testerResult.latencyMs} ms</span>
                        {testerResult.headers['x-ratelimit-remaining'] && (
                          <span className="text-zinc-400">
                            Quota min: {testerResult.headers['x-ratelimit-remaining']}/{testerResult.headers['x-ratelimit-limit']}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(JSON.stringify(testerResult.body, null, 2), 'tester-json')}
                        className="text-zinc-400 hover:text-white flex items-center gap-1"
                      >
                        {copiedId === 'tester-json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Copiar</span>
                      </button>
                    </div>
                    <pre className="p-4 text-xs font-mono text-emerald-400 overflow-auto max-h-80">
                      {JSON.stringify(testerResult.body, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* 7. INTEGRAÇÃO DO PLAYER */}
            {section === 'player_integration' && (
              <div className="space-y-6">
                <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Gerador de Player Embed & Token Assinado</h2>
                  <div className="grid sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Tipo</label>
                      <select
                        value={playerMediaType}
                        onChange={(e) => setPlayerMediaType(e.target.value as 'movie' | 'tv')}
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none"
                      >
                        <option value="movie">Filme (movie)</option>
                        <option value="tv">Série (tv)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">TMDB ID</label>
                      <input
                        type="number"
                        value={playerContentId}
                        onChange={(e) => setPlayerContentId(e.target.value)}
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#E50914] outline-none"
                      />
                    </div>
                    {playerMediaType === 'tv' && (
                      <>
                        <div>
                          <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Temporada</label>
                          <input
                            type="number"
                            min={1}
                            value={playerSeason}
                            onChange={(e) => setPlayerSeason(e.target.value)}
                            className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#E50914] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Episódio</label>
                          <input
                            type="number"
                            min={1}
                            value={playerEpisode}
                            onChange={(e) => setPlayerEpisode(e.target.value)}
                            className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#E50914] outline-none"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">API Key (para vincular à app)</label>
                      <input
                        type="text"
                        value={playerApiKey}
                        onChange={(e) => setPlayerApiKey(e.target.value)}
                        placeholder="rc_live_... (opcional para teste público)"
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 focus:border-[#E50914] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Domínio autorizado (opcional)</label>
                      <input
                        type="text"
                        value={playerDomain}
                        onChange={(e) => setPlayerDomain(e.target.value)}
                        placeholder="ex: meusite.com"
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#E50914] outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      onClick={handleGeneratePlayerToken}
                      disabled={playerTokenLoading}
                      className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
                    >
                      {playerTokenLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                      <span>Gerar Token HMAC & Pré-visualizar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText(iframeSnippet, 'iframe-code')}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-xs font-semibold rounded-lg flex items-center gap-1.5"
                    >
                      {copiedId === 'iframe-code' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedId === 'iframe-code' ? 'Código Copiado!' : 'Copiar Código <iframe>'}</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[11px] font-semibold text-zinc-400">Snippet HTML Responsivo</label>
                    <pre className="bg-black border border-white/10 rounded-lg p-3.5 text-xs font-mono text-emerald-400 overflow-x-auto">
                      {iframeSnippet}
                    </pre>
                  </div>
                </div>

                {showLivePlayerPreview && (
                  <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Pré-visualização do Embed Oficial</span>
                      <a
                        href={embedPathPreview}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[#E50914] hover:underline flex items-center gap-1"
                      >
                        <span>Abrir em nova aba</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="aspect-video w-full bg-black rounded-xl overflow-hidden border border-white/10">
                      <iframe
                        src={embedPathPreview}
                        title="RONYCINE Player Preview"
                        className="w-full h-full border-none"
                        allowFullScreen
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 8. SDK OFICIAL */}
            {section === 'sdk' && (
              <div className="space-y-6">
                <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-white">SDK Oficial RONYCINE (TypeScript / JavaScript)</h2>
                      <p className="text-xs text-zinc-400 mt-1">
                        Cliente tipado com autenticação <code className="text-emerald-400">x-api-key</code>, paginação, fontes e geração de URL/token do player.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadSdk}
                      className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Baixar ronycine.ts</span>
                    </button>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => copyText(tsSdkExample, 'ts-sdk-ex')}
                      className="absolute right-3 top-3 px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px] text-zinc-200 flex items-center gap-1"
                    >
                      {copiedId === 'ts-sdk-ex' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>Copiar</span>
                    </button>
                    <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto">
                      {tsSdkExample}
                    </pre>
                  </div>
                </div>

                <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Android (Kotlin Retrofit + WebView)</h3>
                    <button
                      type="button"
                      onClick={() => copyText(kotlinExample, 'kotlin-ex')}
                      className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-zinc-300 flex items-center gap-1"
                    >
                      {copiedId === 'kotlin-ex' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>Copiar</span>
                    </button>
                  </div>
                  <pre className="bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto">
                    {kotlinExample}
                  </pre>
                </div>
              </div>
            )}

            {/* 9. CONFIGURAÇÕES DA APLICAÇÃO */}
            {section === 'app_settings' && (
              <div className="bg-[#111114] border border-white/10 rounded-xl p-5 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Configurações & Domínios Autorizados</h2>
                  {apps.length > 0 && (
                    <select
                      value={selectedAppId}
                      onChange={(e) => handleSelectSettingsApp(e.target.value)}
                      className="bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none"
                    >
                      {apps.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({a.plan})</option>
                      ))}
                    </select>
                  )}
                </div>

                {!selectedSettingsApp ? (
                  <p className="text-xs text-zinc-500">Crie uma aplicação primeiro para editar domínios e detalhes.</p>
                ) : (
                  <form onSubmit={handleSaveAppSettings} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Nome da App</label>
                        <input
                          type="text"
                          value={editAppName}
                          onChange={(e) => setEditAppName(e.target.value)}
                          className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Descrição</label>
                        <input
                          type="text"
                          value={editAppDesc}
                          onChange={(e) => setEditAppDesc(e.target.value)}
                          className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E50914] outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-[11px] font-semibold text-zinc-400">
                        Domínios Autorizados (CORS, API Key Origin & frame-ancestors do Player)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editDomainInput}
                          onChange={(e) => setEditDomainInput(e.target.value)}
                          placeholder="ex: meuapp.com ou *.meuapp.com"
                          className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#E50914] outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleAddDomain}
                          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg"
                        >
                          Adicionar
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        {editDomainsList.length === 0 ? (
                          <span className="text-[11px] text-zinc-500">Sem domínios configurados (acesso aberto enquanto lista estiver vazia).</span>
                        ) : (
                          editDomainsList.map((dom) => (
                            <span
                              key={dom}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-black border border-white/15 text-xs font-mono text-zinc-200"
                            >
                              <Globe className="w-3 h-3 text-[#E50914]" />
                              <span>{dom}</span>
                              <button
                                type="button"
                                onClick={() => setEditDomainsList((prev) => prev.filter((d) => d !== dom))}
                                className="text-zinc-500 hover:text-red-400"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-black/50 border border-white/10 text-xs text-zinc-400 flex flex-wrap items-center justify-between gap-2">
                      <span>Plano atual: <strong className="text-white">{selectedSettingsApp.plan}</strong></span>
                      {plans.find((p) => p.tier === selectedSettingsApp.plan) && (
                        <span className="font-mono text-[11px]">
                          Limite: {plans.find((p) => p.tier === selectedSettingsApp.plan).requestsPerMinute} req/min •{' '}
                          {plans.find((p) => p.tier === selectedSettingsApp.plan).dailyRequests.toLocaleString('pt-PT')} req/dia
                        </span>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={savingApp}
                      className="px-5 py-2.5 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2"
                    >
                      {savingApp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      <span>Guardar Configurações</span>
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
