import React from 'react';
import { Home, Film, Tv, Search, User, Heart } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export const MobileBottomNav: React.FC = () => {
  const { activeView, navigateTo } = useAuth();

  const navItems = [
    { id: 'home', label: 'Início', icon: Home },
    { id: 'movies', label: 'Filmes', icon: Film },
    { id: 'series', label: 'Séries', icon: Tv },
    { id: 'search', label: 'Buscar', icon: Search },
    { id: 'my_list', label: 'Minha Lista', icon: Heart },
  ];

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0B0B0B]/95 backdrop-blur-lg border-t border-white/10 px-2 py-1.5 safe-area-pb">
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => navigateTo(item.id)}
              className={`flex flex-col items-center justify-center py-1 px-2 min-w-[56px] transition-colors ${
                isActive ? 'text-[#E50914]' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className={`w-4 h-4 mb-0.5 ${isActive ? 'scale-110' : ''}`} />
              <span className={`text-[10px] tracking-tight ${isActive ? 'font-bold' : 'font-medium'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
