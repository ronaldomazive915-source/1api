import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, AppSettings } from '../types.js';
import { api } from '../lib/api.js';
import { auth, googleProvider } from '../lib/firebase.js';
import { signInWithPopup } from 'firebase/auth';

export interface WatchRouteParams {
  type?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
}

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  isFounder: boolean;
  loading: boolean;
  activeView: string;
  setActiveView: (view: string) => void;
  previousView: string | null;
  selectedMediaId: string | null;
  setSelectedMediaId: (id: string | null) => void;
  watchParams: WatchRouteParams | null;
  setWatchParams: (params: WatchRouteParams | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  settings: AppSettings;
  navigateTo: (
    view: string,
    mediaIdOrWatchData?: string | WatchRouteParams,
    watchData?: WatchRouteParams,
    options?: { replace?: boolean }
  ) => void;
  goBack: (fallbackView?: string) => void;
  myList: string[];
  myListItems: Array<{ id: string; media: any }>;
  isMediaInMyList: (id: string | number) => boolean;
  toggleMyList: (mediaOrId: any) => void;
  watchHistory: any[];
  addToHistory: (item: any) => void;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  googleLogin: () => Promise<User>;
  adminLogin: (email: string, password?: string, securityCode?: string) => Promise<boolean>;
  logout: () => void;
  updateCurrentUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_STORAGE_KEY = 'ronycine_auth_token';
const USER_STORAGE_KEY = 'ronycine_auth_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [previousView, setPreviousView] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>({
    heroRotationInterval: 30,
    catalogGuardEnabled: true,
    minCatalogThreshold: 5
  });

  // --- URL ROUTING & BROWSER HISTORY HELPERS ---
  const normalizeViewName = (rawView: string): string => {
    switch (rawView) {
      case 'docs':
        return 'documentation';
      case 'movie_detail':
      case 'series_detail':
        return 'media_detail';
      default:
        return rawView;
    }
  };

  const getPathForView = (
    viewName: string,
    mediaId?: string | null,
    wParams?: WatchRouteParams | null
  ): string => {
    const normalized = normalizeViewName(viewName);
    switch (normalized) {
      case 'home':
        return '/';
      case 'movies':
      case 'catalog':
        return '/movies';
      case 'series':
        return '/series';
      case 'animes':
        return '/animes';
      case 'doramas':
        return '/doramas';
      case 'search':
        return '/search';
      case 'media_detail':
        return mediaId ? `/media/${mediaId}` : '/movies';
      case 'watch': {
        if (wParams?.tmdbId) {
          const normalizedType = wParams.type === 'series' || wParams.type === 'tv' ? 'tv' : 'movie';
          if (normalizedType === 'tv') {
            if (wParams.season !== undefined && wParams.episode !== undefined) {
              return `/watch/tv/${wParams.tmdbId}/${wParams.season}/${wParams.episode}`;
            }
            return `/watch/tv/${wParams.tmdbId}`;
          }
          return `/watch/movie/${wParams.tmdbId}`;
        }
        return '/watch';
      }
      case 'documentation':
        return '/documentation';
      case 'developer':
        return '/developer';
      case 'admin':
        return '/admin';
      case 'my_list':
        return '/my-list';
      case 'history':
        return '/history';
      case 'profile':
        return '/profile';
      case 'login':
        return '/login';
      case 'playground':
        return '/playground';
      case 'plans':
        return '/plans';
      case 'resources':
        return '/resources';
      case 'faq':
        return '/faq';
      case 'status':
        return '/status';
      case 'embed': {
        if (wParams?.tmdbId) {
          const normalizedType = wParams.type === 'series' || wParams.type === 'tv' ? 'tv' : 'movie';
          if (normalizedType === 'tv') {
            return `/embed/${wParams.tmdbId}/${wParams.season || 1}/${wParams.episode || 1}`;
          }
          return `/embed/${wParams.tmdbId}`;
        }
        if (
          typeof window !== 'undefined' &&
          (window.location.pathname.startsWith('/embed') || window.location.pathname.startsWith('/player'))
        ) {
          return window.location.pathname + window.location.search;
        }
        return '/embed/550';
      }
      default:
        return '/';
    }
  };

  const parseCurrentPath = (): {
    view: string;
    selectedMediaId: string | null;
    watchParams: WatchRouteParams | null;
  } => {
    if (typeof window === 'undefined') {
      return { view: 'home', selectedMediaId: null, watchParams: null };
    }

    const pathname = window.location.pathname;
    const search = window.location.search;

    if (pathname.startsWith('/embed') || pathname.startsWith('/player')) return { view: 'embed', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/developer')) return { view: 'developer', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/documentation') || pathname.startsWith('/docs')) return { view: 'documentation', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/admin')) return { view: 'admin', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/movies') || pathname.startsWith('/catalogo')) return { view: 'movies', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/series')) return { view: 'series', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/animes')) return { view: 'animes', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/doramas')) return { view: 'doramas', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/search')) return { view: 'search', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/my-list')) return { view: 'my_list', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/history')) return { view: 'history', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/profile')) return { view: 'profile', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/login')) return { view: 'login', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/playground')) return { view: 'playground', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/plans')) return { view: 'plans', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/resources') || pathname.startsWith('/sdk')) return { view: 'resources', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/faq')) return { view: 'faq', selectedMediaId: null, watchParams: null };
    if (pathname.startsWith('/status') || pathname.startsWith('/saude')) return { view: 'status', selectedMediaId: null, watchParams: null };

    if (pathname.startsWith('/media/') || pathname.startsWith('/movie/') || pathname.startsWith('/tv/')) {
      const parts = pathname.split('/');
      const mediaId = parts[2] || null;
      return { view: 'media_detail', selectedMediaId: mediaId, watchParams: null };
    }

    if (pathname.startsWith('/watch')) {
      const segments = pathname.split('/').filter(Boolean); // ['watch', 'tv'|'movie', tmdbId, season?, episode?]
      if (segments.length >= 3) {
        const rawType = segments[1].toLowerCase();
        const type = rawType === 'tv' || rawType === 'series' || rawType === 'serie' ? 'tv' : 'movie';
        const parsedId = parseInt(segments[2], 10);
        const tmdbId = !isNaN(parsedId) && parsedId > 0 ? parsedId : undefined;
        const parsedSeason = segments[3] !== undefined ? parseInt(segments[3], 10) : undefined;
        const parsedEpisode = segments[4] !== undefined ? parseInt(segments[4], 10) : undefined;
        const season = parsedSeason !== undefined && !isNaN(parsedSeason) ? parsedSeason : undefined;
        const episode = parsedEpisode !== undefined && !isNaN(parsedEpisode) ? parsedEpisode : undefined;

        return {
          view: 'watch',
          selectedMediaId: tmdbId ? `${type}-${tmdbId}` : null,
          watchParams: tmdbId ? { type, tmdbId, season, episode } : null
        };
      }

      const params = new URLSearchParams(search);
      const rawType = (params.get('type') || 'movie').toLowerCase();
      const type = rawType === 'series' || rawType === 'tv' ? 'tv' : 'movie';
      const parsedId = params.get('tmdbId') ? parseInt(params.get('tmdbId')!, 10) : NaN;
      const tmdbId = !isNaN(parsedId) && parsedId > 0 ? parsedId : undefined;
      const rawSeason = params.get('season');
      const rawEpisode = params.get('episode');
      const season = rawSeason !== null && !isNaN(parseInt(rawSeason, 10)) ? parseInt(rawSeason, 10) : (type === 'tv' ? undefined : 1);
      const episode = rawEpisode !== null && !isNaN(parseInt(rawEpisode, 10)) ? parseInt(rawEpisode, 10) : (type === 'tv' ? undefined : 1);

      return {
        view: 'watch',
        selectedMediaId: tmdbId ? `${type}-${tmdbId}` : null,
        watchParams: tmdbId ? { type, tmdbId, season, episode } : null
      };
    }

    return { view: 'home', selectedMediaId: null, watchParams: null };
  };

  const [activeView, setActiveView] = useState<string>(() => {
    const parsed = parseCurrentPath();
    return parsed.view;
  });

  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(() => {
    const parsed = parseCurrentPath();
    return parsed.selectedMediaId;
  });

  const [watchParams, setWatchParams] = useState<{ type?: string; tmdbId?: number; season?: number; episode?: number } | null>(() => {
    const parsed = parseCurrentPath();
    return parsed.watchParams;
  });

  const [searchQuery, setSearchQuery] = useState<string>('');

  // My List State
  const [myList, setMyList] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('ronycine_my_list');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [myListItems, setMyListItems] = useState<Array<{ id: string; media: any }>>(() => {
    try {
      const saved = localStorage.getItem('ronycine_my_list_items');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const isMediaInMyList = (id: string | number) => {
    if (!id) return false;
    const strId = String(id);
    return myList.includes(strId) || myListItems.some(item => String(item.id) === strId || String(item.media?.id) === strId || String(item.media?.tmdbId) === strId);
  };

  const toggleMyList = (mediaOrId: any) => {
    if (!mediaOrId) return;
    const id = typeof mediaOrId === 'object' ? String(mediaOrId.id || mediaOrId.tmdbId) : String(mediaOrId);
    const mediaObj = typeof mediaOrId === 'object' ? mediaOrId : null;

    setMyList(prev => {
      let next: string[];
      if (prev.includes(id)) {
        next = prev.filter(x => x !== id);
      } else {
        next = [...prev, id];
      }
      try { localStorage.setItem('ronycine_my_list', JSON.stringify(next)); } catch (_) {}
      return next;
    });

    setMyListItems(prev => {
      const exists = prev.some(item => String(item.id) === id || String(item.media?.id) === id);
      let next: Array<{ id: string; media: any }>;
      if (exists) {
        next = prev.filter(item => String(item.id) !== id && String(item.media?.id) !== id);
      } else if (mediaObj) {
        next = [{ id, media: mediaObj }, ...prev];
      } else {
        next = prev;
      }
      try { localStorage.setItem('ronycine_my_list_items', JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  // Watch History State
  const [watchHistory, setWatchHistory] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('ronycine_watch_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const addToHistory = (item: any) => {
    if (!item) return;
    setWatchHistory(prev => {
      const filtered = prev.filter(p => p.id !== item.id && p.tmdbId !== item.tmdbId);
      const next = [{ ...item, watchedAt: new Date().toISOString() }, ...filtered].slice(0, 20);
      try { localStorage.setItem('ronycine_watch_history', JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  // 1. Session Restoration & Browser PopState Navigation Listener
  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);

    // Initial replaceState to seed initial history state
    const initialParsed = parseCurrentPath();
    const initialPath = getPathForView(initialParsed.view, initialParsed.selectedMediaId, initialParsed.watchParams);
    window.history.replaceState(
      {
        view: initialParsed.view,
        selectedMediaId: initialParsed.selectedMediaId,
        watchParams: initialParsed.watchParams
      },
      '',
      initialPath
    );

    const restoreSession = async () => {
      try {
        const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem('ronyflix_token');
        const storedUserJson = localStorage.getItem(USER_STORAGE_KEY) || localStorage.getItem('ronyflix_user');

        if (storedToken) {
          let cachedEmail: string | null = null;
          if (storedUserJson) {
            try {
              const parsed = JSON.parse(storedUserJson);
              cachedEmail = parsed.email || null;
            } catch (_) {}
          }

          api.setAdminCredentials(cachedEmail, storedToken);

          // Verify with backend
          const res = await api.getMe();
          if (res?.success && res.user) {
            setUser(res.user);
            api.setAdminCredentials(res.user.email, storedToken);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(res.user));
          } else {
            clearSession();
          }
        } else {
          clearSession();
        }
      } catch (err) {
        console.warn('[AUTH] Could not restore session from server:', err);
        clearSession();
      } finally {
        setLoading(false);
      }
    };

    restoreSession();

    // Browser & Android Back/Forward Gesture Listener
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.view) {
        const s = event.state;
        if (s.selectedMediaId !== undefined) setSelectedMediaId(s.selectedMediaId);
        if (s.watchParams !== undefined) setWatchParams(s.watchParams);
        if (s.searchQuery !== undefined) setSearchQuery(s.searchQuery);
        setActiveView(s.view);
      } else {
        // Fallback safely by parsing location
        const parsed = parseCurrentPath();
        setSelectedMediaId(parsed.selectedMediaId);
        setWatchParams(parsed.watchParams);
        setActiveView(parsed.view);

        window.history.replaceState(
          { view: parsed.view, selectedMediaId: parsed.selectedMediaId, watchParams: parsed.watchParams },
          '',
          window.location.pathname + window.location.search
        );
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const clearSession = () => {
    setUser(null);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem('ronyflix_token');
    localStorage.removeItem('ronyflix_user');
    api.setAdminCredentials(null, null);
  };

  const saveSession = (authUser: User, token: string) => {
    setUser(authUser);
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(authUser));
    api.setAdminCredentials(authUser.email, token);
  };

  interface HistoryStackEntry {
    view: string;
    selectedMediaId: string | null;
    watchParams: WatchRouteParams | null;
    searchQuery: string;
    scrollY?: number;
  }

  const [internalHistoryStack, setInternalHistoryStack] = useState<HistoryStackEntry[]>([]);

  const navigateTo = (
    rawView: string,
    mediaIdOrWatchData?: string | WatchRouteParams,
    watchData?: WatchRouteParams,
    options?: { replace?: boolean }
  ) => {
    const view = normalizeViewName(rawView);
    if (activeView !== 'login' && activeView !== view) {
      setPreviousView(activeView);
    }

    // Push previous view state onto internal stack so back navigation stays inside the app
    if (!options?.replace && view !== activeView) {
      setInternalHistoryStack(prev => [
        ...prev,
        {
          view: activeView,
          selectedMediaId,
          watchParams,
          searchQuery,
          scrollY: typeof window !== 'undefined' ? window.scrollY : 0
        }
      ]);
    }

    let resolvedMediaId: string | undefined;
    let resolvedWatchData: WatchRouteParams | undefined = watchData;

    if (mediaIdOrWatchData !== undefined && typeof mediaIdOrWatchData === 'object' && mediaIdOrWatchData !== null) {
      resolvedWatchData = {
        ...mediaIdOrWatchData,
        type: mediaIdOrWatchData.type === 'series' ? 'tv' : mediaIdOrWatchData.type
      };
      if (resolvedWatchData.tmdbId) {
        resolvedMediaId = `${resolvedWatchData.type || 'movie'}-${resolvedWatchData.tmdbId}`;
      }
    } else if (typeof mediaIdOrWatchData === 'string') {
      resolvedMediaId = mediaIdOrWatchData;
    }

    if (resolvedWatchData?.type === 'series') {
      resolvedWatchData = { ...resolvedWatchData, type: 'tv' };
    }

    const nextMediaId = resolvedMediaId !== undefined ? resolvedMediaId : selectedMediaId;
    const nextWatchData = resolvedWatchData !== undefined ? resolvedWatchData : watchParams;

    if (resolvedMediaId !== undefined) setSelectedMediaId(resolvedMediaId);
    if (resolvedWatchData !== undefined) setWatchParams(resolvedWatchData);
    setActiveView(view);

    const path = getPathForView(view, nextMediaId, nextWatchData);
    const statePayload = {
      view,
      selectedMediaId: nextMediaId,
      watchParams: nextWatchData,
      searchQuery
    };

    if (options?.replace) {
      window.history.replaceState(statePayload, '', path);
    } else {
      if (window.location.pathname + window.location.search !== path || window.history.state?.view !== view) {
        window.history.pushState(statePayload, '', path);
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = (fallbackView?: string) => {
    if (internalHistoryStack.length > 0) {
      const prevEntry = internalHistoryStack[internalHistoryStack.length - 1];
      setInternalHistoryStack(prev => prev.slice(0, prev.length - 1));

      setActiveView(prevEntry.view);
      setSelectedMediaId(prevEntry.selectedMediaId);
      setWatchParams(prevEntry.watchParams);
      if (prevEntry.searchQuery !== undefined) setSearchQuery(prevEntry.searchQuery);

      const path = getPathForView(prevEntry.view, prevEntry.selectedMediaId, prevEntry.watchParams);
      window.history.replaceState(
        {
          view: prevEntry.view,
          selectedMediaId: prevEntry.selectedMediaId,
          watchParams: prevEntry.watchParams,
          searchQuery: prevEntry.searchQuery
        },
        '',
        path
      );

      if (prevEntry.scrollY !== undefined) {
        setTimeout(() => {
          window.scrollTo({ top: prevEntry.scrollY, behavior: 'auto' });
        }, 30);
      }
      return;
    }

    // Safe internal fallback: never exit app to external site or close platform
    navigateTo(fallbackView || previousView || 'home', undefined, undefined, { replace: true });
  };

  // Standard Email & Password Login
  const login = async (email: string, password: string): Promise<User> => {
    const res = await api.login(email, password);
    if (res.success && res.user && res.token) {
      saveSession(res.user, res.token);
      return res.user;
    }
    throw new Error('Falha na autenticação.');
  };

  // User Registration
  const register = async (name: string, email: string, password: string): Promise<User> => {
    const res = await api.register(name, email, password);
    if (res.success && res.user && res.token) {
      saveSession(res.user, res.token);
      return res.user;
    }
    throw new Error('Falha no cadastro.');
  };

  // Google OAuth via Firebase + Backend Verification
  const googleLogin = async (): Promise<User> => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const fbUser = result.user;

      if (!fbUser.email) {
        throw new Error('E-mail não fornecido pelo Google.');
      }

      const res = await api.googleAuth({
        email: fbUser.email,
        name: fbUser.displayName || undefined,
        avatar: fbUser.photoURL || undefined,
        uid: fbUser.uid
      });

      if (res.success && res.user && res.token) {
        saveSession(res.user, res.token);
        return res.user;
      }
      throw new Error('Não foi possível validar o acesso com o Google no servidor.');
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        throw new Error('Janela de login com o Google foi fechada antes da conclusão.');
      }
      if (err.code === 'auth/cancelled-popup-request') {
        throw new Error('Solicitação de login cancelada.');
      }
      if (err.code === 'auth/popup-blocked') {
        throw new Error('O navegador bloqueou a janela pop-up do Google. Permita pop-ups para este site.');
      }
      if (err.code === 'auth/network-request-failed') {
        throw new Error('Erro de conexão com o Google. Verifique sua conexão de rede.');
      }
      if (err.code === 'auth/operation-not-allowed') {
        throw new Error('O login com Google não está ativado no console Firebase.');
      }
      throw new Error(err.message || 'Falha ao autenticar com o Google.');
    }
  };

  // Direct Admin & Founder Unlock
  const adminLogin = async (email: string, password?: string, securityCode?: string): Promise<boolean> => {
    if (!password || !securityCode) {
      throw new Error('Preencha a senha e o código OTP de segurança.');
    }

    const res = await api.adminLogin(email, password, securityCode);
    if (res.success && res.user && res.token) {
      saveSession(res.user, res.token);
      return true;
    }
    return false;
  };

  const logout = () => {
    api.logout().catch(() => {});
    clearSession();
    if (activeView === 'admin') {
      setActiveView('home');
    }
  };

  const updateCurrentUser = (updates: Partial<User>) => {
    setUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, ...updates };
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'founder';
  const isFounder = user?.role === 'founder';

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        isFounder,
        loading,
        activeView,
        setActiveView,
        previousView,
        selectedMediaId,
        setSelectedMediaId,
        watchParams,
        setWatchParams,
        searchQuery,
        setSearchQuery,
        settings,
        navigateTo,
        goBack,
        myList,
        myListItems,
        isMediaInMyList,
        toggleMyList,
        watchHistory,
        addToHistory,
        login,
        register,
        googleLogin,
        adminLogin,
        logout,
        updateCurrentUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
