import React, { useState, useEffect } from 'react';
import { Search as SearchIcon, Film, Tv } from 'lucide-react';
import { MediaItem } from '../types.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { MediaCard, MediaCardSkeleton } from '../components/MediaCard.js';

export const SearchView: React.FC = () => {
  const { searchQuery, setSearchQuery } = useAuth();
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'tv'>('all');
  const [localResults, setLocalResults] = useState<MediaItem[]>([]);
  const [externalResults, setExternalResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setLocalResults([]);
      setExternalResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      api.searchMedia(searchQuery, filterType)
        .then((res) => {
          setLocalResults(res.local || []);
          setExternalResults(res.external || []);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, filterType]);

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-white pt-20 sm:pt-24 pb-20 px-3 sm:px-6 md:px-8 max-w-[1600px] mx-auto overflow-x-hidden">
      
      {/* SEARCH INPUT & FILTERS */}
      <div className="mb-8 space-y-4 max-w-2xl">
        <div className="relative">
          <SearchIcon className="w-5 h-5 text-[#E50914] absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Pesquisar por título, diretor, ator..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#141416] border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914] transition-all font-medium"
            autoFocus
          />
        </div>

        {/* Type Filter Buttons */}
        <div className="flex items-center gap-2">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'movie', label: 'Filmes' },
            { id: 'tv', label: 'Séries' },
          ].map((type) => {
            const isActive = filterType === type.id;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => setFilterType(type.id as any)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-[#E50914] text-white shadow'
                    : 'bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {type.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* RESULTS GRID */}
      {loading ? (
        <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-2.5 md:gap-3">
          {Array.from({ length: 14 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      ) : searchQuery.trim() === '' ? (
        <div className="text-center py-24 bg-[#121214] rounded-xl border border-white/5 text-zinc-500">
          <SearchIcon className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
          <p className="text-xs font-medium">Digite o nome de um filme ou série para pesquisar.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* LOCAL RESULTS */}
          {localResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 bg-[#E50914] rounded-full" />
                <h3 className="text-sm font-bold text-white tracking-tight uppercase">
                  No Acervo RONYCINE ({localResults.length})
                </h3>
              </div>
              <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-2.5 md:gap-3">
                {localResults.map((item) => (
                  <MediaCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* EXTERNAL TMDB SUGGESTIONS */}
          {externalResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 bg-blue-500 rounded-full" />
                <h3 className="text-sm font-bold text-white tracking-tight uppercase">
                  Sugestões Globais TMDB ({externalResults.length})
                </h3>
              </div>
              <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-2.5 md:gap-3 opacity-90 hover:opacity-100 transition-opacity">
                {externalResults.map((item) => (
                  <MediaCard key={item.id || item.tmdbId} item={item} />
                ))}
              </div>
            </div>
          )}

          {localResults.length === 0 && externalResults.length === 0 && (
            <div className="text-center py-24 bg-[#121214] rounded-xl border border-white/5 text-zinc-500">
              <p className="text-xs">Nenhum resultado encontrado para <span className="text-white font-bold">"{searchQuery}"</span></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
