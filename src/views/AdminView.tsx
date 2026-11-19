import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  ShieldAlert, 
  Lock, 
  RefreshCw, 
  Film, 
  Tv, 
  Users, 
  PlusCircle, 
  Search, 
  Activity, 
  LogOut, 
  Play, 
  LayoutDashboard, 
  BarChart3, 
  Radio, 
  Sparkles, 
  FolderHeart, 
  Compass, 
  BellRing, 
  FileText, 
  Globe, 
  Sliders, 
  Server, 
  Zap, 
  Layers, 
  History, 
  ArrowLeft, 
  Menu, 
  X, 
  Check, 
  AlertTriangle, 
  Globe2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Key,
  Database,
  Trash2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Wand2,
  Heart,
  Flame,
  Link2,
  Megaphone
} from 'lucide-react';
import { api, CATALOG_UPDATED_EVENT } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { CatalogStats, AuditLog, User, TrendingSectionResponse } from '../types.js';
import { TmdbImporter } from '../components/admin/TmdbImporter.js';
import { SmartContentImporter } from '../components/admin/SmartContentImporter.js';
import { SmartLinkImporter } from '../components/admin/SmartLinkImporter.js';
import { CatalogManager } from '../components/admin/CatalogManager.js';
import { CategoriesManager } from '../components/admin/CategoriesManager.js';
import { AdsManager } from '../components/admin/AdsManager.js';
import { UsersManager } from '../components/admin/UsersManager.js';
import { motion, AnimatePresence } from 'motion/react';

// Modular Sub-Views
import { StatsView } from '../components/admin/StatsView.js';
import { LiveTvManager } from '../components/admin/LiveTvManager.js';
import { RequestsManager } from '../components/admin/RequestsManager.js';
import { RecoveryCenterView } from '../components/admin/RecoveryCenterView.js';
import { MassImporter } from '../components/admin/MassImporter.js';
import { M3UImporter } from '../components/admin/M3UImporter.js';
import { VideoSourcesManager, PreselectedSourceMedia } from '../components/admin/VideoSourcesManager.js';
import { BackupCenterView } from '../components/admin/BackupCenterView.js';
import { ActivityLogView } from '../components/admin/ActivityLogView.js';
import { TrashView } from '../components/admin/TrashView.js';
import { SystemHealthView } from '../components/admin/SystemHealthView.js';
import { SeriesImporterPro } from '../components/admin/SeriesImporterPro.js';
import { SourceDiagnosticsView } from '../components/admin/SourceDiagnosticsView.js';
import { ServerControlCenter } from '../components/admin/ServerControlCenter.js';
import { ConnectionAnalyticsView } from '../components/admin/ConnectionAnalyticsView.js';
import {
  AdminDevelopersTab,
  AdminMonitoringTab,
  AdminPlayerDomainsTab,
  AdminPlansTab
} from '../components/admin/DeveloperPlatformAdmin.js';
import { resolveTmdbPosterUrl, formatAdminDate } from '../lib/mediaUtils.js';
import { MediaItem } from '../types.js';

interface AdminViewProps {
  initialTab?: string;
}

export const AdminView: React.FC<AdminViewProps> = ({ initialTab }) => {
  const { isAdmin, isFounder, adminLogin, logout, settings, navigateTo } = useAuth();

  // Auth Form State
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [securityCodeInput, setSecurityCodeInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Responsive Mobile Layout State
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
  const [activeTab, setActiveTab] = useState<string>(initialTab || 'overview');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (sectionTitle: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [sectionTitle]: !prev[sectionTitle]
    }));
  };

  // Stats & Data State
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);

  // Cross-tab Integration State (Search & Sources)
  const [topbarSearch, setTopbarSearch] = useState<string>('');
  const [catalogSearchPrefill, setCatalogSearchPrefill] = useState<{ query: string; nonce: number } | null>(null);
  const [sourcePreselection, setSourcePreselection] = useState<PreselectedSourceMedia | null>(null);

  // TMDB Diagnostic State
  const [tmdbState, setTmdbState] = useState<{
    status: 'ONLINE' | 'OFFLINE' | 'CHAVE NÃO CONFIGURADA' | 'CHAVE INVÁLIDA' | 'VERIFICANDO';
    message: string;
    keyConfigured: boolean;
    maskedKey?: string;
    latencyMs?: number;
    timestamp?: string;
  }>({
    status: 'VERIFICANDO',
    message: 'Testando conexão com a API oficial do TMDB...',
    keyConfigured: true
  });
  const [testingTmdb, setTestingTmdb] = useState<boolean>(false);

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Resize listener
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isAdmin || isFounder) {
      loadDashboardData();
      checkTmdbStatus();
    }
  }, [isAdmin, isFounder, activeTab]);

  useEffect(() => {
    if (!isAdmin && !isFounder) return;
    const handleCatalogUpdate = () => {
      loadDashboardData();
    };
    window.addEventListener(CATALOG_UPDATED_EVENT, handleCatalogUpdate);
    return () => window.removeEventListener(CATALOG_UPDATED_EVENT, handleCatalogUpdate);
  }, [isAdmin, isFounder, activeTab]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const loadDashboardData = async () => {
    try {
      if (activeTab === 'overview' || activeTab === 'stats') {
        const s = await api.getAdminStats();
        setStats(s);
      }
      if (activeTab === 'overview' || activeTab === 'audit' || activeTab === 'activity') {
        const logs = await api.getAdminLogs();
        setAuditLogs(Array.isArray(logs) ? logs : []);
      }
      if (activeTab === 'users') {
        const u = await api.getAdminUsers();
        setUsersList(Array.isArray(u) ? u : []);
      }
    } catch (err) {
      console.error('Failed loading admin data:', err);
    }
  };

  const checkTmdbStatus = async () => {
    try {
      const res = await api.getTmdbStatus();
      setTmdbState(res);
    } catch (err) {
      setTmdbState({
        status: 'OFFLINE',
        message: 'Falha de comunicação com o servidor backend.',
        keyConfigured: false
      });
    }
  };

  const handleTestTmdbClick = async () => {
    setTestingTmdb(true);
    setTmdbState(prev => ({ ...prev, status: 'VERIFICANDO', message: 'Executando teste de conexão...' }));
    try {
      const res = await api.testTmdbConnection();
      setTmdbState(res);
      showToast(`TMDB: ${res.status}`);
    } catch (err: any) {
      setTmdbState({
        status: 'OFFLINE',
        message: err.message || 'Erro ao testar API do TMDB.',
        keyConfigured: false
      });
      showToast('Erro no teste TMDB');
    } finally {
      setTestingTmdb(false);
    }
  };

  const handleAdminAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);

    try {
      const success = await adminLogin(emailInput, passwordInput, securityCodeInput);
      if (!success) {
        setAuthError('Credenciais inválidas ou acesso negado.');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Erro de autenticação.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSelectTab = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId !== 'video_sources') {
      setSourcePreselection(null);
    }
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleOpenSourcesForMedia = (item: MediaItem, seasonNumber?: number, episodeNumber?: number) => {
    setSourcePreselection({
      contentId: Number(item.tmdbId || 0),
      contentType: item.type === 'tv' || item.type === 'series' ? 'tv' : 'movie',
      title: item.title,
      posterPath: item.posterPath,
      seasonNumber,
      episodeNumber,
      autoOpenModal: true
    });
    setActiveTab('video_sources');
    if (isMobile) setSidebarOpen(false);
  };

  const handleTopbarSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = topbarSearch.trim();
    if (!q) return;
    setCatalogSearchPrefill({ query: q, nonce: Date.now() });
    if (activeTab !== 'catalog_movies' && activeTab !== 'catalog_series') {
      setActiveTab('catalog_movies');
    }
  };

  // Structured Sidebar Menu
  const menuSections = [
    {
      title: 'Principal',
      items: [
        { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
        { id: 'trending_admin', label: 'Tendências', icon: Flame },
        { id: 'stats', label: 'Estatísticas', icon: BarChart3 },
        { id: 'activity', label: 'Atividade', icon: Compass },
      ]
    },
    {
      title: 'Catálogo & Importação',
      items: [
        { id: 'smart_link_import', label: 'Importação Inteligente PRO', icon: Link2 },
        { id: 'smart_import', label: 'Importar Conteúdo', icon: Wand2 },
        { id: 'catalog_movies', label: 'Filmes', icon: Film },
        { id: 'catalog_series', label: 'Séries', icon: Tv },
        { id: 'catalog_animes', label: 'Animes', icon: Sparkles },
        { id: 'catalog_doramas', label: 'Doramas', icon: Heart },
        { id: 'import_series', label: 'Episódios PRO', icon: Layers },
        { id: 'import_single', label: 'Importar TMDB ID', icon: PlusCircle },
        { id: 'import_mass', label: 'Importação em Massa', icon: Sparkles },
        { id: 'import_m3u', label: 'Listas M3U', icon: FileText },
        { id: 'categories', label: 'Categorias', icon: FolderHeart },
        { id: 'tv_live', label: 'TV ao Vivo', icon: Radio },
      ]
    },
    {
      title: 'Fontes e Player',
      items: [
        { id: 'server_control', label: 'SERVIDOR', icon: Server },
        { id: 'video_sources', label: 'Fontes', icon: Layers },
        { id: 'source_diagnostics', label: 'Diagnóstico de Fontes', icon: Shield },
        { id: 'api_player', label: 'Player & Domínios', icon: Globe2 },
        { id: 'ads', label: 'Propagandas', icon: Megaphone },
      ]
    },
    {
      title: 'API e Desenvolvedores',
      items: [
        { id: 'connection_analytics', label: 'Connection Analytics', icon: BarChart3 },
        { id: 'api_developers', label: 'Desenvolvedores & Apps', icon: Key },
        { id: 'api_monitoring', label: 'Monitorização & Quotas', icon: Activity },
        { id: 'api_plans', label: 'Planos & Limites', icon: Layers },
      ]
    },
    {
      title: 'Sistema & Segurança',
      items: [
        { id: 'system_health', label: 'System Health', icon: HardDrive },
        { id: 'users', label: 'Utilizadores', icon: Users },
        { id: 'backup_center', label: 'Backup Center', icon: Database },
        { id: 'activity_log', label: 'Histórico de Atividades', icon: History },
        { id: 'recovery', label: 'Recuperação & Integridade', icon: ShieldAlert },
        { id: 'trash_view', label: 'Lixeira', icon: Trash2 },
        { id: 'requests', label: 'Pedidos', icon: BellRing },
        { id: 'settings', label: 'Configurações', icon: Sliders },
        { id: 'audit', label: 'Logs do Sistema', icon: FileText },
      ]
    }
  ];

  if (!isAdmin && !isFounder) {
    return (
      <div className="min-h-screen bg-[#07080B] flex items-center justify-center p-4 selection:bg-brand selection:text-white font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#0D0F15] border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
        >
          <div className="p-8 text-center bg-white/[0.02] border-b border-white/5">
             <div className="w-14 h-14 bg-brand/10 border border-brand/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-7 h-7 text-brand" />
             </div>
             <h1 className="text-xl font-black text-white tracking-tighter uppercase font-display">RONYCINE API</h1>
             <p className="text-[10px] text-zinc-500 mt-1 font-bold uppercase tracking-widest">Painel Administrativo Profissional</p>
          </div>

          <form onSubmit={handleAdminAuthSubmit} className="p-8 space-y-5">
            {authError && (
              <div className="bg-brand/10 border border-brand/20 text-brand p-3.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 block">Email Admin</label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-brand outline-none transition-all"
                  placeholder="ronaldomazive915@gmail.com"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 block">Senha</label>
                <input
                  type="password"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-brand outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 block">Código Segurança OTP</label>
                <input
                  type="text"
                  required
                  value={securityCodeInput}
                  onChange={(e) => setSecurityCodeInput(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-mono tracking-widest"
                  placeholder="200419"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isAuthLoading}
              className="w-full py-3.5 bg-brand hover:bg-brand/90 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl transition-all shadow-xl shadow-brand/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isAuthLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              <span>Desbloquear Painel</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('home')}
              className="w-full py-2.5 bg-transparent border border-white/10 hover:bg-white/5 text-zinc-400 hover:text-white font-bold text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar ao Catálogo Público</span>
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  const currentSection = menuSections.find(s => s.items.some(i => i.id === activeTab));
  const currentItem = currentSection?.items.find(i => i.id === activeTab) || menuSections.flatMap(s => s.items).find(i => i.id === activeTab);

  const getTmdbBadge = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return { label: 'ONLINE', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 };
      case 'CHAVE NÃO CONFIGURADA':
        return { label: 'CHAVE NÃO CONFIGURADA', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: AlertTriangle };
      case 'CHAVE INVÁLIDA':
        return { label: 'CHAVE INVÁLIDA', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: XCircle };
      case 'VERIFICANDO':
        return { label: 'VERIFICANDO...', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: RefreshCw, animate: true };
      default:
        return { label: 'OFFLINE', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: XCircle };
    }
  };

  const tmdbBadge = getTmdbBadge(tmdbState.status);
  const TmdbBadgeIcon = tmdbBadge.icon;

  return (
    <div className="min-h-screen bg-[#07080B] text-white flex overflow-hidden font-sans selection:bg-brand selection:text-white">
      
      {/* MOBILE BACKDROP OVERLAY */}
      {isMobile && sidebarOpen && (
        <div 
          onClick={() => setSidebarOpen(false)} 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden transition-opacity"
        />
      )}

      {/* COMPACT RESPONSIVE SIDEBAR */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 bg-[#0C0E14] border-r border-white/10 flex flex-col h-screen max-h-screen h-[100dvh] max-h-[100dvh] min-h-0 overscroll-contain transition-all duration-300 ${
          isMobile 
            ? (sidebarOpen ? 'translate-x-0 w-72 sm:w-80 shadow-2xl' : '-translate-x-full w-72 sm:w-80 pointer-events-none')
            : (sidebarOpen ? 'w-64' : 'w-20')
        }`}
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* LOGO BAR - PINNED TOP */}
        <div className="h-16 px-4 border-b border-white/5 flex items-center justify-between shrink-0 bg-[#0C0E14]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-brand/20">
              <Film className="w-5 h-5 text-white" />
            </div>
            {(sidebarOpen || isMobile) && (
              <div className="min-w-0">
                <h1 className="font-black text-white text-base tracking-tighter uppercase font-display leading-none">RONYCINE</h1>
                <span className="text-[9px] font-bold text-brand uppercase tracking-widest block mt-0.5">Painel Admin</span>
              </div>
            )}
          </div>
          {isMobile ? (
            <button 
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-all"
              aria-label="Fechar Menu"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:flex p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-all"
              aria-label={sidebarOpen ? "Recolher Sidebar" : "Expandir Sidebar"}
              title={sidebarOpen ? "Recolher Sidebar" : "Expandir Sidebar"}
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* NAVIGATION LINKS - INDEPENDENT SMOOTH SCROLL */}
        <div 
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 space-y-3 admin-scrollbar overscroll-contain pb-12"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {menuSections.map((sec) => {
            const isCollapsed = Boolean(collapsedSections[sec.title]);
            const hasActiveItem = sec.items.some(item => item.id === activeTab);

            return (
              <div key={sec.title} className="space-y-1">
                {(sidebarOpen || isMobile) ? (
                  <button
                    type="button"
                    onClick={() => toggleSection(sec.title)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-black text-zinc-400 hover:text-white uppercase tracking-[0.16em] rounded-lg hover:bg-white/[0.04] transition-colors group select-none"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {hasActiveItem && <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0 animate-pulse" />}
                      <span className={hasActiveItem ? 'text-white' : ''}>{sec.title}</span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 text-zinc-500 group-hover:text-zinc-300">
                      <span className="text-[9px] font-mono text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded">
                        {sec.items.length}
                      </span>
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 transition-transform" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 transition-transform" />
                      )}
                    </div>
                  </button>
                ) : (
                  <div className="h-px bg-white/10 my-2 mx-2" />
                )}

                {/* ITEMS IN SECTION */}
                {(!isCollapsed || (!sidebarOpen && !isMobile)) && (
                  <div className="space-y-0.5">
                    {sec.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleSelectTab(item.id)}
                          title={!sidebarOpen && !isMobile ? item.label : undefined}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all relative group ${
                            isActive 
                              ? 'bg-brand text-white font-black shadow-lg shadow-brand/20' 
                              : 'text-zinc-400 hover:text-white hover:bg-white/5 font-semibold'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                            isActive ? 'text-white' : 'text-zinc-500 group-hover:text-brand'
                          }`} />
                          {(sidebarOpen || isMobile) && (
                            <span className="text-xs uppercase tracking-wider truncate flex-1">{item.label}</span>
                          )}
                          {isActive && !isMobile && !sidebarOpen && (
                            <div className="absolute left-0 w-1 h-5 bg-brand rounded-r-full" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* SIDEBAR FOOTER - PINNED BOTTOM */}
        <div className="p-3 border-t border-white/5 space-y-1 shrink-0 bg-[#0C0E14]">
          <button
            onClick={() => { navigateTo('home'); if (isMobile) setSidebarOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-zinc-400 hover:text-white transition-all rounded-xl hover:bg-white/5 text-xs font-bold uppercase tracking-wider"
            title="Ir para o Catálogo Público"
          >
            <Globe2 className="w-4 h-4 shrink-0 text-emerald-400" />
            {(sidebarOpen || isMobile) && <span>Site Público</span>}
          </button>
          <button
            onClick={() => { logout(); if (isMobile) setSidebarOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-zinc-400 hover:text-brand transition-all rounded-xl hover:bg-brand/10 text-xs font-bold uppercase tracking-wider group"
            title="Sair do Painel Admin"
          >
            <LogOut className="w-4 h-4 shrink-0 text-zinc-500 group-hover:text-brand" />
            {(sidebarOpen || isMobile) && <span>Sair do Painel</span>}
          </button>
        </div>
      </aside>

      {/* MAIN VIEWPORT WRAPPER */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
        isMobile ? 'pl-0' : (sidebarOpen ? 'pl-64' : 'pl-20')
      }`}>
        
        {/* TOPBAR */}
        <header className="h-16 bg-[#090A0E]/95 backdrop-blur-md border-b border-white/5 px-4 sm:px-6 lg:px-8 flex items-center justify-between sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all active:scale-95 shrink-0"
              aria-label="Alternar Menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-wider truncate">
                <span>Painel Admin</span>
                <span>/</span>
                <span className="text-zinc-400">{currentSection?.title || 'Principal'}</span>
                <span>/</span>
                <span className="text-brand font-black truncate">{currentItem?.label || 'Dashboard'}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest hidden sm:inline">
                  RONYCINE API · Operacional
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <form
              onSubmit={handleTopbarSearchSubmit}
              className="hidden md:flex items-center bg-black/60 border border-white/10 focus-within:border-brand rounded-xl px-3 py-1.5 w-44 lg:w-60 transition-colors"
            >
              <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={topbarSearch}
                onChange={e => setTopbarSearch(e.target.value)}
                placeholder="Pesquisar catálogo..."
                className="bg-transparent border-none focus:outline-none text-xs text-white px-2.5 w-full font-medium placeholder-zinc-500"
              />
              {topbarSearch && (
                <button
                  type="button"
                  onClick={() => setTopbarSearch('')}
                  className="text-zinc-500 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </form>

            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 text-[10px]">
              <span className="text-zinc-500 font-bold uppercase">TMDB:</span>
              <span className={`font-black uppercase flex items-center gap-1 ${
                tmdbState.status === 'ONLINE' ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tmdbState.status === 'ONLINE' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {tmdbState.status}
              </span>
            </div>

            <div className="flex items-center gap-2 pl-2 border-l border-white/10">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1 justify-end">
                  {isFounder ? '👑 Fundador' : 'Administrador'}
                </p>
                <p className="text-[9px] text-zinc-500 font-mono">ronycine</p>
              </div>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs ${
                isFounder ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400' : 'bg-brand/10 border border-brand/30 text-brand'
              }`}>
                {isFounder ? '👑' : 'AD'}
              </div>
            </div>
          </div>
        </header>

        {/* CONTENT AREA */}
        <main className="flex-1 p-4 sm:p-8 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              {/* 1. VISÃO GERAL / DASHBOARD OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-6 sm:space-y-8">
                  {/* 5 CORE LIBRARY KPIS (FILMES, SÉRIES, EPISÓDIOS, ANIMES, DORAMAS) */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                    <button
                      onClick={() => handleSelectTab('catalog_movies')}
                      className="text-left bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2.5 hover:border-brand/40 transition-all group"
                    >
                      <div className="flex justify-between items-center">
                        <div className="p-2 bg-brand/10 rounded-xl text-brand">
                          <Film className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 tabular-nums">
                          {stats?.publishedMovies ?? 0} Pub.
                        </span>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Filmes</p>
                        <h3 className="text-2xl font-black text-white mt-0.5 tabular-nums">
                          {(stats?.totalMovies ?? 0).toLocaleString('pt-PT')}
                        </h3>
                        <p className="text-[10px] text-zinc-500 mt-0.5 tabular-nums">
                          {stats?.moviesWithoutSource ?? 0} sem fonte
                        </p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleSelectTab('catalog_series')}
                      className="text-left bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2.5 hover:border-brand/40 transition-all group"
                    >
                      <div className="flex justify-between items-center">
                        <div className="p-2 bg-sky-500/10 rounded-xl text-sky-400">
                          <Tv className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 tabular-nums">
                          {stats?.publishedSeries ?? 0} Pub.
                        </span>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Séries</p>
                        <h3 className="text-2xl font-black text-white mt-0.5 tabular-nums">
                          {(stats?.totalSeries ?? 0).toLocaleString('pt-PT')}
                        </h3>
                        <p className="text-[10px] text-zinc-500 mt-0.5 tabular-nums">
                          {stats?.totalSeasons ?? 0} temporadas
                        </p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleSelectTab('import_series')}
                      className="text-left bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2.5 hover:border-brand/40 transition-all group"
                    >
                      <div className="flex justify-between items-center">
                        <div className="p-2 bg-violet-500/10 rounded-xl text-violet-400">
                          <Layers className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-violet-400 uppercase">Indexados</span>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Episódios</p>
                        <h3 className="text-2xl font-black text-white mt-0.5 tabular-nums">
                          {(stats?.totalEpisodes ?? 0).toLocaleString('pt-PT')}
                        </h3>
                        <p className="text-[10px] text-zinc-500 mt-0.5 tabular-nums">
                          {stats?.seriesWithoutSource ?? 0} séries sem link
                        </p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleSelectTab('catalog_animes')}
                      className="text-left bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2.5 hover:border-brand/40 transition-all group"
                    >
                      <div className="flex justify-between items-center">
                        <div className="p-2 bg-amber-500/10 rounded-xl text-amber-400">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-amber-400 tabular-nums">
                          {stats?.publishedAnimes ?? 0} Pub.
                        </span>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Animes</p>
                        <h3 className="text-2xl font-black text-white mt-0.5 tabular-nums">
                          {(stats?.totalAnimes ?? 0).toLocaleString('pt-PT')}
                        </h3>
                        <p className="text-[10px] text-zinc-500 mt-0.5">Categoria Anime</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleSelectTab('catalog_doramas')}
                      className="text-left bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2.5 hover:border-brand/40 transition-all group col-span-2 sm:col-span-1"
                    >
                      <div className="flex justify-between items-center">
                        <div className="p-2 bg-rose-500/10 rounded-xl text-rose-400">
                          <Heart className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-rose-400 tabular-nums">
                          {stats?.publishedDoramas ?? 0} Pub.
                        </span>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Doramas</p>
                        <h3 className="text-2xl font-black text-white mt-0.5 tabular-nums">
                          {(stats?.totalDoramas ?? 0).toLocaleString('pt-PT')}
                        </h3>
                        <p className="text-[10px] text-zinc-500 mt-0.5">Dramas Asiáticos</p>
                      </div>
                    </button>
                  </div>

                  {/* OPERATIONAL DIAGNOSTIC STRIP (4 CARDS) */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    <button
                      onClick={() => handleSelectTab('video_sources')}
                      className="text-left bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2 hover:border-brand/40 transition-all"
                    >
                      <div className="flex justify-between items-center">
                        <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400">
                          <Server className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 tabular-nums">
                          {stats?.onlineLinks ?? 0} Online
                        </span>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Fontes de Vídeo</p>
                        <h3 className="text-xl font-black text-white tabular-nums">{stats?.totalLinks ?? 0}</h3>
                        <p className="text-[10px] text-zinc-500 tabular-nums">{stats?.offlineLinks ?? 0} offline</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleSelectTab('recovery')}
                      className="text-left bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2 hover:border-brand/40 transition-all"
                    >
                      <div className="flex justify-between items-center">
                        <div className="p-2 bg-amber-500/10 rounded-xl text-amber-400">
                          <AlertTriangle className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-zinc-400 tabular-nums">
                          {(stats?.deletedMovies ?? 0) + (stats?.deletedSeries ?? 0)} Lixeira
                        </span>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Alertas Metadados</p>
                        <h3 className="text-xl font-black text-white tabular-nums">
                          {stats?.metadataAlertsCount ?? stats?.totalProblematic ?? 0}
                        </h3>
                        <p className="text-[10px] text-zinc-500 truncate">
                          {stats?.metadataAlerts
                            ? `${stats.metadataAlerts.missingPoster} poster · ${stats.metadataAlerts.missingSource} fonte`
                            : 'Registos por rever'}
                        </p>
                      </div>
                    </button>

                    <div className="bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="p-2 bg-purple-500/10 rounded-xl text-purple-400">
                          <Key className="w-4 h-4" />
                        </div>
                        <button
                          onClick={handleTestTmdbClick}
                          disabled={testingTmdb}
                          className="p-1 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-300 hover:text-white text-[10px] font-bold uppercase flex items-center gap-1 border border-white/10"
                        >
                          <RefreshCw className={`w-2.5 h-2.5 ${testingTmdb ? 'animate-spin text-brand' : ''}`} />
                          <span>Testar</span>
                        </button>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">TMDB API</p>
                        <div className="mt-1">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider ${tmdbBadge.color}`}>
                            <TmdbBadgeIcon className={`w-2.5 h-2.5 ${tmdbBadge.animate ? 'animate-spin' : ''}`} />
                            {tmdbBadge.label}
                          </span>
                        </div>
                        {tmdbState.latencyMs ? (
                          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Latência: {tmdbState.latencyMs}ms</p>
                        ) : null}
                      </div>
                    </div>

                    <button
                      onClick={() => handleSelectTab('system_health')}
                      className="text-left bg-[#0D0F15] border border-white/[0.08] p-4 rounded-2xl space-y-2 hover:border-brand/40 transition-all"
                    >
                      <div className="flex justify-between items-center">
                        <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400">
                          <HardDrive className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 uppercase">Ativo</span>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Estado API & BD</p>
                        <h3 className="text-xl font-black text-white">Online</h3>
                        <p className="text-[10px] text-emerald-400/80 font-medium">Persistência íntegra</p>
                      </div>
                    </button>
                  </div>

                  {/* TMDB DIAGNOSTIC BANNER IF ISSUE DETECTED */}
                  {tmdbState.status !== 'ONLINE' && (
                    <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wider text-amber-200">
                            Status TMDB: {tmdbState.status}
                          </h4>
                          <p className="text-[11px] text-zinc-300 mt-0.5">
                            {tmdbState.message}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleTestTmdbClick}
                        disabled={testingTmdb}
                        className="px-4 py-2 bg-amber-500 text-black text-xs font-black uppercase tracking-wider rounded-xl hover:bg-amber-400 transition-all flex items-center gap-2 shrink-0"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${testingTmdb ? 'animate-spin' : ''}`} />
                        Testar Conexão Agora
                      </button>
                    </div>
                  )}

                  {/* QUICK ACCESS GRID & RECENT ACTIVITY */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
                    {/* RECENT ACTIVITY */}
                    <div className="lg:col-span-2 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold font-display uppercase tracking-tight">Atividade Recente</h3>
                        <button onClick={() => setActiveTab('audit')} className="text-[10px] font-black text-brand uppercase tracking-widest hover:underline">
                          Ver Histórico Completo
                        </button>
                      </div>
                      <div className="bg-[#0D0F15] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                        <div className="divide-y divide-white/5">
                          {(Array.isArray(auditLogs) ? auditLogs : []).slice(0, 5).map(log => (
                            <div key={log.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-all text-xs">
                              <div className="flex items-center gap-3 min-w-0 pr-2">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${log.result === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-brand/10 text-brand'}`}>
                                  {log.result === 'SUCCESS' ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-white truncate">{log.details || log.action}</p>
                                  <p className="text-[9px] text-zinc-500 font-medium uppercase mt-0.5 truncate">
                                    {log.userEmail} · {new Date(log.timestamp).toLocaleString('pt-PT')}
                                  </p>
                                </div>
                              </div>
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${log.result === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-brand/10 text-brand'}`}>
                                {log.result}
                              </span>
                            </div>
                          ))}
                          {(!Array.isArray(auditLogs) || auditLogs.length === 0) && (
                            <div className="p-10 text-center text-zinc-600 uppercase tracking-widest text-[10px] font-bold">
                              Nenhuma atividade recente registrada
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* DIRECT MANAGEMENT BUTTONS */}
                    <div className="space-y-4">
                      <h3 className="text-base font-bold font-display uppercase tracking-tight">Atalhos de Gestão</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
                        <button 
                          onClick={() => handleSelectTab('smart_link_import')}
                          className="p-3.5 bg-[#0D0F15] border border-brand/30 hover:border-brand text-white rounded-2xl flex items-center gap-3.5 transition-all group"
                        >
                          <div className="p-2 bg-brand/15 rounded-xl group-hover:bg-brand/25 transition-all text-brand">
                            <Link2 className="w-4 h-4" />
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-black uppercase tracking-wider truncate">Importação Inteligente</p>
                            <p className="text-[10px] text-zinc-500 font-medium truncate">Analisar links Seekee + TMDB</p>
                          </div>
                        </button>

                        <button 
                          onClick={() => handleSelectTab('smart_import')}
                          className="p-3.5 bg-brand hover:bg-brand/90 text-white rounded-2xl flex items-center gap-3.5 transition-all shadow-xl shadow-brand/20 group"
                        >
                          <div className="p-2 bg-white/20 rounded-xl group-hover:scale-110 transition-transform">
                            <Wand2 className="w-4 h-4" />
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-black uppercase tracking-wider truncate">Importar Conteúdo PRO</p>
                            <p className="text-[10px] opacity-80 font-medium truncate">Filmes, Séries, Animes & Doramas</p>
                          </div>
                        </button>

                        <button 
                          onClick={() => handleSelectTab('import_series')}
                          className="p-3.5 bg-[#0D0F15] border border-white/5 hover:border-brand/40 text-white rounded-2xl flex items-center gap-3.5 transition-all group"
                        >
                          <div className="p-2 bg-white/5 rounded-xl group-hover:bg-brand/20 transition-all text-sky-400">
                            <Tv className="w-4 h-4" />
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-black uppercase tracking-wider truncate">Episódios & Séries PRO</p>
                            <p className="text-[10px] text-zinc-500 font-medium truncate">Temporadas e links por episódio</p>
                          </div>
                        </button>

                        <button 
                          onClick={() => handleSelectTab('import_single')}
                          className="p-3.5 bg-[#0D0F15] border border-white/5 hover:border-brand/40 text-white rounded-2xl flex items-center gap-3.5 transition-all group"
                        >
                          <div className="p-2 bg-white/5 rounded-xl group-hover:bg-brand/20 transition-all text-brand">
                            <PlusCircle className="w-4 h-4" />
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-black uppercase tracking-wider truncate">Por TMDB ID</p>
                            <p className="text-[10px] text-zinc-500 font-medium truncate">Buscar filmes ou séries por ID</p>
                          </div>
                        </button>

                        <button 
                          onClick={() => handleSelectTab('video_sources')}
                          className="p-3.5 bg-[#0D0F15] border border-white/5 hover:border-brand/40 text-white rounded-2xl flex items-center gap-3.5 transition-all group"
                        >
                          <div className="p-2 bg-white/5 rounded-xl group-hover:bg-brand/20 transition-all text-emerald-400">
                            <Server className="w-4 h-4" />
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-black uppercase tracking-wider truncate">Gestão de Fontes</p>
                            <p className="text-[10px] text-zinc-500 font-medium truncate">MGEB, UQLOAD e Servidores</p>
                          </div>
                        </button>

                        <button 
                          onClick={() => handleSelectTab('source_diagnostics')}
                          className="p-3.5 bg-[#0D0F15] border border-white/5 hover:border-brand/40 text-white rounded-2xl flex items-center gap-3.5 transition-all group"
                        >
                          <div className="p-2 bg-white/5 rounded-xl group-hover:bg-brand/20 transition-all text-purple-400">
                            <Shield className="w-4 h-4" />
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-black uppercase tracking-wider truncate">Diagnóstico de Fontes</p>
                            <p className="text-[10px] text-zinc-500 font-medium truncate">Verificação e integridade de streams</p>
                          </div>
                        </button>

                        <button 
                          onClick={() => handleSelectTab('catalog_movies')}
                          className="p-3.5 bg-[#0D0F15] border border-white/5 hover:border-brand/40 text-white rounded-2xl flex items-center gap-3.5 transition-all group"
                        >
                          <div className="p-2 bg-white/5 rounded-xl group-hover:bg-brand/20 transition-all text-brand">
                            <Film className="w-4 h-4" />
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-black uppercase tracking-wider truncate">Gerir Filmes</p>
                            <p className="text-[10px] text-zinc-500 font-medium truncate">Catálogo de cinema e títulos</p>
                          </div>
                        </button>

                        <button 
                          onClick={() => handleSelectTab('catalog_series')}
                          className="p-3.5 bg-[#0D0F15] border border-white/5 hover:border-brand/40 text-white rounded-2xl flex items-center gap-3.5 transition-all group"
                        >
                          <div className="p-2 bg-white/5 rounded-xl group-hover:bg-brand/20 transition-all text-blue-400">
                            <Tv className="w-4 h-4" />
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-black uppercase tracking-wider truncate">Gerir Séries</p>
                            <p className="text-[10px] text-zinc-500 font-medium truncate">Temporadas e episódios</p>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* RECENT CATALOG ITEMS & RECENT TMDB IMPORTS */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-[#0D0F15] border border-white/5 rounded-2xl overflow-hidden">
                      <div className="p-4 border-b border-white/5 flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase tracking-wider text-white">Últimos Conteúdos Adicionados</h3>
                        <button onClick={() => handleSelectTab('catalog_movies')} className="text-[10px] font-black text-brand uppercase tracking-widest hover:underline">
                          Abrir Catálogo
                        </button>
                      </div>
                      <div className="divide-y divide-white/5">
                        {(stats?.recentItems || []).slice(0, 5).map(item => (
                          <div key={item.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-11 rounded-md bg-zinc-900 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                                {resolveTmdbPosterUrl(item.posterPath, 'w185') ? (
                                  <img src={resolveTmdbPosterUrl(item.posterPath, 'w185')} alt={item.title} className="w-full h-full object-cover" />
                                ) : item.type === 'tv' ? (
                                  <Tv className="w-3.5 h-3.5 text-zinc-600" />
                                ) : (
                                  <Film className="w-3.5 h-3.5 text-zinc-600" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-white truncate">{item.title}</p>
                                <p className="text-[10px] text-zinc-500 font-mono">
                                  {item.type === 'tv' ? 'Série' : 'Filme'} · {item.releaseYear || '—'} · TMDB {item.tmdbId || '—'}
                                </p>
                              </div>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${item.hasSource ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
                              {item.hasSource ? 'Com fonte' : 'Sem fonte'}
                            </span>
                          </div>
                        ))}
                        {(!stats?.recentItems || stats.recentItems.length === 0) && (
                          <div className="p-8 text-center text-xs text-zinc-500">Sem itens recentes registados.</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-[#0D0F15] border border-white/5 rounded-2xl overflow-hidden">
                      <div className="p-4 border-b border-white/5 flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase tracking-wider text-white">Últimas Importações TMDB</h3>
                        <button onClick={() => handleSelectTab('import_single')} className="text-[10px] font-black text-brand uppercase tracking-widest hover:underline">
                          Importar TMDB
                        </button>
                      </div>
                      <div className="divide-y divide-white/5">
                        {(stats?.recentImports || []).slice(0, 5).map(imp => (
                          <div key={imp.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <p className="font-bold text-white truncate">{imp.title}</p>
                              <p className="text-[10px] text-zinc-500 font-mono truncate">
                                {imp.type === 'tv' ? 'Série' : 'Filme'} · TMDB {imp.tmdbId} · {formatAdminDate(imp.timestamp)}
                              </p>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 ${
                              imp.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' :
                              imp.status === 'EXISTING' ? 'bg-amber-500/10 text-amber-400' :
                              'bg-brand/10 text-brand'
                            }`}>
                              {imp.status}
                            </span>
                          </div>
                        ))}
                        {(!stats?.recentImports || stats.recentImports.length === 0) && (
                          <div className="p-8 text-center text-xs text-zinc-500">Nenhuma importação TMDB recente registada.</div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* OTHER TABS WITH AUDITED RENDERING */}
              {activeTab === 'stats' && <StatsView stats={stats} onNavigateTab={handleSelectTab} />}
              {activeTab === 'activity' && (
                <div className="space-y-6">
                  <h3 className="text-xl font-bold font-display uppercase tracking-tight">Atividade Recente do Sistema</h3>
                  <div className="bg-[#0D0F15] border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
                    <div className="divide-y divide-white/5">
                      {(Array.isArray(auditLogs) ? auditLogs : []).map(log => (
                        <div key={log.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-all text-xs">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${log.result === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-brand/10 text-brand'}`}>
                              {log.result === 'SUCCESS' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                            </div>
                            <div>
                              <p className="font-bold text-white">{log.details || log.action}</p>
                              <p className="text-[10px] text-zinc-500 font-medium uppercase mt-0.5">{log.userEmail} · {new Date(log.timestamp).toLocaleString('pt-PT')}</p>
                            </div>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full font-black uppercase text-[9px] ${log.result === 'SUCCESS' ? 'text-emerald-400 bg-emerald-500/10' : 'text-brand bg-brand/10'}`}>
                            {log.result}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'audit' && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold font-display uppercase tracking-tight">Logs do Sistema</h3>
                    <button onClick={loadDashboardData} className="p-2.5 rounded-xl bg-[#0D0F15] border border-white/10 hover:bg-white/5 transition-all text-zinc-300">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="bg-[#0D0F15] border border-white/5 rounded-2xl overflow-hidden shadow-2xl overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-white/5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                          <th className="p-4">Data</th>
                          <th className="p-4">Utilizador</th>
                          <th className="p-4">Ação</th>
                          <th className="p-4">Detalhes</th>
                          <th className="p-4 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {(Array.isArray(auditLogs) ? auditLogs : []).map(log => (
                          <tr key={log.id} className="text-xs hover:bg-white/5 transition-all">
                            <td className="p-4 text-zinc-400 font-mono">{new Date(log.timestamp).toLocaleString('pt-PT')}</td>
                            <td className="p-4 font-bold text-white">{log.userEmail}</td>
                            <td className="p-4 font-mono text-brand uppercase text-[10px]">{log.action}</td>
                            <td className="p-4 text-zinc-400 max-w-xs truncate">{log.details}</td>
                            <td className="p-4 text-right">
                              <span className={`px-2.5 py-1 rounded-full font-black uppercase text-[9px] ${log.result === 'SUCCESS' ? 'text-emerald-400 bg-emerald-500/10' : 'text-brand bg-brand/10'}`}>
                                {log.result}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'trending_admin' && (
                <AdminTrendingPanel
                  onOpenSmartImporter={() => handleSelectTab('smart_import')}
                />
              )}
              {activeTab === 'smart_link_import' && (
                <SmartLinkImporter
                  onCatalogUpdated={loadDashboardData}
                  onViewCatalogItem={info => {
                    setCatalogSearchPrefill({ query: String(info.tmdbId || info.title), nonce: Date.now() });
                    if (info.categories?.includes('anime')) handleSelectTab('catalog_animes');
                    else if (info.categories?.includes('dorama')) handleSelectTab('catalog_doramas');
                    else handleSelectTab(info.type === 'tv' ? 'catalog_series' : 'catalog_movies');
                  }}
                />
              )}
              {activeTab === 'smart_import' && (
                <SmartContentImporter
                  onCatalogUpdated={loadDashboardData}
                  onOpenSeriesPro={() => handleSelectTab('import_series')}
                  onViewCatalogItem={info => {
                    setCatalogSearchPrefill({ query: String(info.tmdbId || info.title), nonce: Date.now() });
                    if (info.categories?.includes('anime')) handleSelectTab('catalog_animes');
                    else if (info.categories?.includes('dorama')) handleSelectTab('catalog_doramas');
                    else handleSelectTab(info.type === 'tv' ? 'catalog_series' : 'catalog_movies');
                  }}
                />
              )}
              {activeTab === 'import_series' && <SeriesImporterPro onCatalogUpdated={loadDashboardData} />}
              {activeTab === 'import_m3u' && <M3UImporter onCatalogUpdated={loadDashboardData} />}
              {activeTab === 'import_single' && (
                <TmdbImporter
                  onCatalogUpdated={loadDashboardData}
                  onViewCatalogItem={info => {
                    setCatalogSearchPrefill({ query: String(info.tmdbId || info.title), nonce: Date.now() });
                    handleSelectTab(info.type === 'tv' ? 'catalog_series' : 'catalog_movies');
                  }}
                />
              )}
              {activeTab === 'import_mass' && <MassImporter onCatalogUpdated={loadDashboardData} />}
              {activeTab === 'catalog_movies' && (
                <CatalogManager
                  key="movies"
                  initialFilterType="movie"
                  externalSearch={catalogSearchPrefill}
                  onSwitchTab={handleSelectTab}
                  onStatsUpdated={loadDashboardData}
                  onOpenSources={handleOpenSourcesForMedia}
                />
              )}
              {activeTab === 'catalog_series' && (
                <CatalogManager
                  key="series"
                  initialFilterType="tv"
                  externalSearch={catalogSearchPrefill}
                  onSwitchTab={handleSelectTab}
                  onStatsUpdated={loadDashboardData}
                  onOpenSources={handleOpenSourcesForMedia}
                />
              )}
              {activeTab === 'catalog_animes' && (
                <CatalogManager
                  key="animes"
                  initialFilterType="all"
                  initialFilterCategory="anime"
                  externalSearch={catalogSearchPrefill}
                  onSwitchTab={handleSelectTab}
                  onStatsUpdated={loadDashboardData}
                  onOpenSources={handleOpenSourcesForMedia}
                />
              )}
              {activeTab === 'catalog_doramas' && (
                <CatalogManager
                  key="doramas"
                  initialFilterType="all"
                  initialFilterCategory="dorama"
                  externalSearch={catalogSearchPrefill}
                  onSwitchTab={handleSelectTab}
                  onStatsUpdated={loadDashboardData}
                  onOpenSources={handleOpenSourcesForMedia}
                />
              )}
              {activeTab === 'categories' && <CategoriesManager onSwitchTab={handleSelectTab} />}
              {activeTab === 'server_control' && (
                <ServerControlCenter
                  onOpenPlayer={(tmdbId, type, season, episode) => {
                    navigateTo('player', { tmdbId, type, season, episode });
                  }}
                  onEditSources={(tmdbId, type) => {
                    setSourcePreselection({ tmdbId, type, title: '' });
                    setActiveTab('video_sources');
                  }}
                />
              )}
              {activeTab === 'connection_analytics' && <ConnectionAnalyticsView />}
              {activeTab === 'source_diagnostics' && <SourceDiagnosticsView />}
              {activeTab === 'video_sources' && (
                <VideoSourcesManager
                  preselectedMedia={sourcePreselection}
                  onClearPreselected={() => setSourcePreselection(null)}
                />
              )}
              {activeTab === 'tv_live' && <LiveTvManager />}
              {activeTab === 'requests' && <RequestsManager />}
              {activeTab === 'recovery' && <RecoveryCenterView />}
              {activeTab === 'api_developers' && <AdminDevelopersTab />}
              {activeTab === 'api_monitoring' && <AdminMonitoringTab />}
              {activeTab === 'api_player' && <AdminPlayerDomainsTab />}
              {activeTab === 'api_plans' && <AdminPlansTab />}
              {activeTab === 'system_health' && <SystemHealthView />}
              {activeTab === 'backup_center' && <BackupCenterView />}
              {activeTab === 'activity_log' && <ActivityLogView />}
              {activeTab === 'trash_view' && <TrashView />}

              {activeTab === 'ads' && <AdsManager />}
              {activeTab === 'users' && <UsersManager />}

              {activeTab === 'settings' && (
                <div className="max-w-4xl space-y-8">
                  {/* TMDB API DIAGNOSTICS IN SETTINGS */}
                  <div className="bg-[#0D0F15] border border-white/5 p-6 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
                          <Key className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black uppercase tracking-wider text-white">Estado da Conexão TMDB API</h4>
                          <p className="text-[10px] text-zinc-500 font-medium">Verificação em tempo real pelo servidor backend</p>
                        </div>
                      </div>

                      <button
                        onClick={handleTestTmdbClick}
                        disabled={testingTmdb}
                        className="px-4 py-2 bg-brand text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-brand/90 transition-all flex items-center gap-2 shadow-lg shadow-brand/20"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${testingTmdb ? 'animate-spin' : ''}`} />
                        TESTAR CONEXÃO TMDB
                      </button>
                    </div>

                    <div className="p-4 bg-black/60 rounded-xl border border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider ${tmdbBadge.color}`}>
                            <TmdbBadgeIcon className={`w-3.5 h-3.5 ${tmdbBadge.animate ? 'animate-spin' : ''}`} />
                            {tmdbBadge.label}
                          </span>
                          {tmdbState.maskedKey && (
                            <span className="text-[10px] font-mono text-zinc-400 bg-white/5 px-2 py-0.5 rounded">
                              Chave: {tmdbState.maskedKey}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-300 font-medium">{tmdbState.message}</p>
                      </div>

                      {tmdbState.latencyMs && (
                        <div className="text-right text-xs font-mono text-zinc-400">
                          <span className="text-[10px] text-zinc-500 uppercase block">Latência</span>
                          <span className="font-bold text-emerald-400 tabular-nums">{tmdbState.latencyMs} ms</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* PLATFORM CONFIGS */}
                  <div className="bg-[#0D0F15] border border-white/5 p-6 rounded-2xl space-y-6">
                    <h4 className="text-sm font-black uppercase tracking-wider text-white">Configurações Gerais do RONYCINE</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Intervalo de Rotação (Hero)</label>
                        <input 
                          type="number" 
                          defaultValue={settings.heroRotationInterval || 30} 
                          className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Limite por Página</label>
                        <input 
                          type="number" 
                          defaultValue={20} 
                          className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                        />
                      </div>
                    </div>
                    <button 
                      onClick={() => showToast('Configurações salvas com sucesso!')}
                      className="px-6 py-3 bg-brand text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-brand/90 transition-all shadow-xl shadow-brand/20"
                    >
                      Guardar Alterações
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* TOAST NOTIFICATION */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-[100] bg-brand text-white px-5 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase tracking-wider flex items-center gap-2 border border-white/20"
          >
            <div className="w-2 h-2 rounded-full bg-white" />
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AdminTrendingPanel: React.FC<{ onOpenSmartImporter: () => void }> = ({ onOpenSmartImporter }) => {
  const [tab, setTab] = useState<'trending' | 'movies' | 'series' | 'animes' | 'doramas' | 'recent'>('trending');
  const [data, setData] = useState<TrendingSectionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (refresh = false) => {
    setLoading(true);
    try {
      const res = await api.getTrending({ tab, refresh });
      setData(res);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
            <Flame className="w-5 h-5 text-brand" />
            Monitor de Tendências (Biblioteca vs TMDB)
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Separação estrita entre títulos já presentes no catálogo e destaques externos do TMDB para importação manual.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['trending', 'movies', 'series', 'animes', 'doramas', 'recent'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase ${
                tab === t ? 'bg-brand text-white' : 'bg-black/60 border border-white/10 text-zinc-400 hover:text-white'
              }`}
            >
              {t === 'trending' ? 'Em Alta' : t === 'movies' ? 'Filmes' : t === 'series' ? 'Séries' : t === 'animes' ? 'Animes' : t === 'doramas' ? 'Doramas' : 'Recentes'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => load(true)}
            className="p-2 rounded-lg bg-black/60 border border-white/10 text-zinc-300 hover:text-white"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-brand' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl p-5 space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wider text-emerald-400">
            Na Biblioteca RONYCINE ({data?.libraryItems?.length ?? 0})
          </h4>
          <div className="space-y-2 max-h-[480px] overflow-y-auto">
            {(data?.libraryItems || []).map(item => (
              <div key={item.id} className="p-3 rounded-xl bg-black/50 border border-white/5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{item.title}</p>
                  <p className="text-[10px] text-zinc-400 font-mono">
                    TMDB {item.tmdbId || '—'} · {item.type === 'tv' ? 'Série' : 'Filme'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${item.hasPlayableSource ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
                  {item.hasPlayableSource ? 'Com Fonte' : 'Sem Fonte'}
                </span>
              </div>
            ))}
            {(!data?.libraryItems || data.libraryItems.length === 0) && (
              <p className="text-xs text-zinc-500 py-6 text-center">Sem itens na biblioteca neste separador.</p>
            )}
          </div>
        </div>

        <div className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-sky-400">
              Tendências TMDB Externas ({data?.tmdbGlobalItems?.length ?? 0})
            </h4>
            <button
              type="button"
              onClick={onOpenSmartImporter}
              className="px-3 py-1.5 rounded-lg bg-brand text-white text-[11px] font-bold"
            >
              Abrir Importador Manual
            </button>
          </div>
          <div className="space-y-2 max-h-[480px] overflow-y-auto">
            {(data?.tmdbGlobalItems || []).map(item => (
              <div key={`${item.type}-${item.tmdbId}`} className="p-3 rounded-xl bg-black/50 border border-white/5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{item.title}</p>
                  <p className="text-[10px] text-zinc-400 font-mono">
                    TMDB {item.tmdbId} · {item.type === 'tv' ? 'Série' : 'Filme'} · {item.releaseYear || '—'}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[10px] font-bold shrink-0">
                  Não Importado
                </span>
              </div>
            ))}
            {(!data?.tmdbGlobalItems || data.tmdbGlobalItems.length === 0) && (
              <p className="text-xs text-zinc-500 py-6 text-center">Sem destaques externos disponíveis.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
