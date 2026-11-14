import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  User,
  LogOut,
  Shield,
  Menu,
  X,
  ChevronDown,
  Heart,
  Clock,
  Code2,
  KeyRound
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export const Navbar: React.FC = () => {
  const {
    user,
    activeView,
    navigateTo,
    logout,
    isAdmin,
    isFounder,
    searchQuery,
    setSearchQuery
  } = useAuth();

  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 25);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navLinks = [
    { id: 'home', label: 'Início' },
    { id: 'movies', label: 'Filmes' },
    { id: 'series', label: 'Séries' },
    { id: 'developer', label: 'Portal Dev' },
    { id: 'documentation', label: 'API Docs' },
    { id: 'playground', label: 'Playground' },
    { id: 'plans', label: 'Planos' },
    { id: 'resources', label: 'SDK' }
  ];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigateTo('search');
    }
  };

  const handleSearchIconClick = () => {
    if (!showSearchInput) {
      setShowSearchInput(true);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    } else if (searchQuery.trim()) {
      navigateTo('search');
    } else {
      setShowSearchInput(false);
    }
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
        isScrolled
          ? 'bg-[#080808]/95 backdrop-blur-md border-b border-white/10 py-2.5 shadow-lg'
          : 'bg-[#080808]/80 backdrop-blur-md border-b border-white/5 py-3'
      }`}
    >
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 md:px-8">
        <div className="flex items-center justify-between gap-3 sm:gap-5">
          {/* BRAND LOGO */}
          <button
            type="button"
            onClick={() => navigateTo('home')}
            className="flex items-center gap-2 shrink-0 group focus:outline-none"
          >
            <div className="w-8 h-8 rounded-lg bg-[#E50914] flex items-center justify-center shadow-md shadow-[#E50914]/20 group-hover:scale-105 transition-transform">
              <span className="text-white font-black text-base tracking-tighter font-display">R</span>
            </div>
            <span className="text-base sm:text-lg font-black tracking-tight text-white font-display uppercase">
              RONYCINE <span className="text-[#E50914] text-xs font-black tracking-widest ml-0.5">API</span>
            </span>
          </button>

          {/* DESKTOP NAVIGATION */}
          <nav className="hidden xl:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = activeView === link.id;
              return (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => navigateTo(link.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-white bg-[#E50914]/15 border border-[#E50914]/30'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>

          {/* ACTIONS & CONTROLS */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* SEARCH BAR */}
            <form onSubmit={handleSearchSubmit} className="relative flex items-center">
              <div
                className={`flex items-center bg-black/60 border border-white/10 rounded-full transition-all duration-200 overflow-hidden ${
                  showSearchInput
                    ? 'w-44 sm:w-56 px-3 py-1.5 border-[#E50914]/50'
                    : 'w-8 h-8 sm:w-9 sm:h-9 justify-center bg-transparent border-transparent hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  onClick={handleSearchIconClick}
                  className="text-zinc-300 hover:text-white shrink-0 p-1"
                  aria-label="Pesquisar"
                >
                  <Search className="w-4 h-4" />
                </button>

                {showSearchInput && (
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Buscar filmes, séries..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (activeView !== 'search' && e.target.value.trim().length > 1) {
                        navigateTo('search');
                      }
                    }}
                    onBlur={() => {
                      if (!searchQuery.trim()) setShowSearchInput(false);
                    }}
                    className="w-full bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none pl-2 pr-1"
                  />
                )}
              </div>
            </form>

            {/* QUICK PORTAL BUTTON ON DESKTOP */}
            <button
              type="button"
              onClick={() => navigateTo('developer')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-200 transition-colors"
            >
              <Code2 className="w-3.5 h-3.5 text-[#E50914]" />
              <span>Console Dev</span>
            </button>

            {/* USER PROFILE / LOGIN */}
            {user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full pl-1.5 pr-2.5 py-1 transition-all"
                >
                  <div className="w-6 h-6 rounded-full bg-[#E50914] text-white flex items-center justify-center text-xs font-bold">
                    {isFounder ? 'R' : user.name ? user.name.charAt(0).toUpperCase() : <User className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-xs font-medium text-zinc-200 hidden sm:inline max-w-[100px] truncate">
                    {isFounder ? 'Fundador' : user.name || 'Conta'}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 top-full mt-2 w-60 bg-[#121216] border border-white/10 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                    <div className="px-3.5 py-2.5 border-b border-white/5">
                      <p className="font-bold text-white truncate">{user.name || 'Usuário RONYCINE'}</p>
                      <p className="text-[11px] text-zinc-400 truncate">{user.email}</p>
                      <span
                        className={`inline-block mt-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          isFounder
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : isAdmin
                            ? 'bg-[#E50914]/20 text-[#E50914] border border-[#E50914]/30'
                            : 'bg-white/10 text-zinc-400'
                        }`}
                      >
                        {isFounder ? 'Fundador' : isAdmin ? 'Administrador' : 'Desenvolvedor'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => { setShowUserMenu(false); navigateTo('developer'); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-zinc-200 hover:text-white hover:bg-white/5 transition-colors text-left"
                    >
                      <KeyRound className="w-4 h-4 text-[#E50914]" />
                      <span>Portal do Desenvolvedor</span>
                    </button>

                    {(isAdmin || isFounder) && (
                      <button
                        type="button"
                        onClick={() => { setShowUserMenu(false); navigateTo('admin'); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-zinc-300 hover:text-white hover:bg-white/5 transition-colors text-left"
                      >
                        <Shield className="w-4 h-4 text-[#E50914]" />
                        <span>Painel Administrativo</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => { setShowUserMenu(false); navigateTo('my_list'); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-zinc-300 hover:text-white hover:bg-white/5 transition-colors text-left"
                    >
                      <Heart className="w-4 h-4 text-zinc-400" />
                      <span>Minha Lista</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setShowUserMenu(false); navigateTo('history'); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-zinc-300 hover:text-white hover:bg-white/5 transition-colors text-left"
                    >
                      <Clock className="w-4 h-4 text-zinc-400" />
                      <span>Histórico</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setShowUserMenu(false); navigateTo('profile'); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-zinc-300 hover:text-white hover:bg-white/5 transition-colors text-left"
                    >
                      <User className="w-4 h-4 text-zinc-400" />
                      <span>Meu Perfil</span>
                    </button>

                    <div className="h-px bg-white/5 my-1" />

                    <button
                      type="button"
                      onClick={() => { setShowUserMenu(false); logout(); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sair da Conta</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => navigateTo('login')}
                className="px-4 py-1.5 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold uppercase tracking-wider rounded-md transition-all active:scale-95 shadow"
              >
                Entrar
              </button>
            )}

            {/* MOBILE HAMBURGER BUTTON */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="xl:hidden p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-white/5"
              aria-label="Abrir menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE DROPDOWN MENU */}
      {mobileMenuOpen && (
        <div className="xl:hidden bg-[#0D0D10] border-b border-white/10 px-4 py-3 space-y-1 shadow-2xl">
          {navLinks.map((link) => {
            const isActive = activeView === link.id;
            return (
              <button
                key={link.id}
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigateTo(link.id);
                }}
                className={`w-full text-left px-3 py-2 text-xs font-semibold rounded-md transition-colors flex items-center justify-between ${
                  isActive
                    ? 'bg-[#E50914] text-white'
                    : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{link.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
