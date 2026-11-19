import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Clapperboard, Search, Tv, Film } from 'lucide-react';
import { MediaItem } from '../types.js';
import { api, CATALOG_UPDATED_EVENT } from '../lib/api.js';
import { MediaCard, MediaCardSkeleton } from '../components/MediaCard.js';

interface CategoryCatalogViewProps {
  category: 'anime' | 'dorama';
}

export const CategoryCatalogView: React.FC<CategoryCatalogViewProps> = ({ category }) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const isAnime = category === 'anime';
  const title = isAnime ? 'Animes' : 'Doramas';
  const subtitle = isAnime
    ? 'Animações japonesas e produções de anime catalogadas na RONYCINE API'
    : 'Produções asiáticas de drama e romance disponíveis no acervo';

  const loadCategoryCatalog = useCallback(() => {
    setLoading(true);
    api
      .getCatalog({
        category,
        type: typeFilter === 'all' ? undefined : typeFilter,
        limit: 120
      })
      .then((res) => {
        setItems(res.items || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [category, typeFilter]);

  useEffect(() => {
    loadCategoryCatalog();
  }, [loadCategoryCatalog]);

  useEffect(() => {
    const handler = () => loadCategoryCatalog();
    window.addEventListener(CATALOG_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CATALOG_UPDATED_EVENT, handler);
  }, [loadCategoryCatalog]);

  const filtered = items.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.originalTitle && item.originalTitle.toLowerCase().includes(q)) ||
      String(item.tmdbId || '').includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#080808] text-white pt-20 sm:pt-24 pb-20 px-3 sm:px-6 md:px-8 max-w-[1600px] mx-auto overflow-x-hidden">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2 text-[#E50914] mb-1">
            {isAnime ? <Sparkles className="w-4 h-4" /> : <Clapperboard className="w-4 h-4" />}
            <span className="text-[10px] font-black uppercase tracking-widest">Catálogo Oficial RONYCINE</span>
          </div>
          <h1 className="text-xl sm:text-3xl font-black text-white uppercase tracking-tight font-display">
            {title}
          </h1>
          <p className="text-zinc-400 text-xs mt-0.5">
            {subtitle} · {filtered.length} {filtered.length === 1 ? 'título' : 'títulos'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={`Filtrar ${title.toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#14151A] border border-white/10 rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914] transition-all w-40 sm:w-52 font-medium"
            />
          </div>

          <div className="inline-flex bg-[#14151A] border border-white/10 rounded-md p-0.5">
            {[
              { id: 'all', label: 'Todos', icon: null },
              { id: 'tv', label: 'Séries', icon: Tv },
              { id: 'movie', label: 'Filmes', icon: Film }
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTypeFilter(opt.id as 'all' | 'movie' | 'tv')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                  typeFilter === opt.id
                    ? 'bg-[#E50914] text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2.5 sm:gap-3">
          {Array.from({ length: 14 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2.5 sm:gap-3">
          {filtered.map((item) => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-[#111216] rounded-xl border border-white/[0.07]">
          {isAnime ? (
            <Sparkles className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
          ) : (
            <Clapperboard className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
          )}
          <h3 className="text-sm font-bold text-white">Nenhum título em {title}</h3>
          <p className="text-zinc-500 text-xs mt-1 max-w-md mx-auto">
            Importe conteúdos através do Painel Administrativo usando a secção Importar Conteúdo → {isAnime ? 'Importar Anime' : 'Importar Dorama'}.
          </p>
        </div>
      )}
    </div>
  );
};
