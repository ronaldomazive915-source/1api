import React from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { MediaCard } from '../components/MediaCard.js';

export const MyListView: React.FC = () => {
  const { myListItems, navigateTo } = useAuth();

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-white pt-20 sm:pt-24 pb-20 px-3 sm:px-6 md:px-8 max-w-[1600px] mx-auto overflow-x-hidden">
      
      {/* HEADER */}
      <div className="space-y-1 mb-6 pb-4 border-b border-white/5">
        <div className="flex items-center gap-1.5 text-[#E50914] text-[10px] font-black uppercase tracking-widest">
          <Heart className="w-3.5 h-3.5 fill-[#E50914]" />
          <span>Curadoria Pessoal</span>
        </div>
        <h1 className="text-xl sm:text-3xl font-black text-white uppercase tracking-tight font-display">
          Minha Lista
        </h1>
        <p className="text-xs text-zinc-400">
          {myListItems.length} {myListItems.length === 1 ? 'título salvo' : 'títulos salvos'} para assistir a qualquer momento.
        </p>
      </div>

      {/* COMPACT GRID: 6-7 CARDS DESKTOP, 3 CARDS MOBILE */}
      {myListItems && myListItems.length > 0 ? (
        <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-2.5 md:gap-3">
          {myListItems.map((item) => (
            item.media ? <MediaCard key={item.id || item.media.id} item={item.media} /> : null
          ))}
        </div>
      ) : (
        <div className="text-center py-24 bg-[#121214] rounded-xl border border-white/5 space-y-3">
          <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto text-zinc-600">
            <Heart className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-white">Sua lista está vazia</h3>
            <p className="text-xs text-zinc-500 max-w-xs mx-auto">
              Adicione filmes e séries clicando no botão "＋ Minha Lista" em qualquer título.
            </p>
          </div>
          <button
            onClick={() => navigateTo('home')}
            className="px-6 py-2 bg-[#E50914] text-white text-xs font-bold uppercase tracking-wider rounded-md hover:bg-[#b80710] transition-all"
          >
            Explorar Catálogo
          </button>
        </div>
      )}
    </div>
  );
};
