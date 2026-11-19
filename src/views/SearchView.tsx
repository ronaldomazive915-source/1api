import React, { useState, useEffect, useRef } from 'react';
import { Search as SearchIcon, SlidersHorizontal, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { MediaItem } from '../types.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { MediaCard, MediaCardSkeleton } from '../components/MediaCard.js';

export const SearchView: React.FC = () => {
  const { searchQuery, setSearchQuery } = useAuth();
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'tv'>('all');
  const [filterCategory, setFilterCategory] = useState<'all' | 'anime' | 'dorama'>('all');
  const [yearFilter, setYearFilter] = useState('');
  const [seasonFilter, setSeasonFilter] = useState('');
  const [episodeFilter, setEpisodeFilter] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'popular' | 'rating' | 'title_asc'>('recent');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [localResults, setLocalResults] = useState<MediaItem[]>([]);
  const [externalResults, setExternalResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, filterType, filterCategory, yearFilter, seasonFilter, episodeFilter, sortBy]);

  useEffect(() => {
    const hasFilterCriteria =
      searchQuery.trim().length > 0 ||
      filterCategory !== 'all' ||
      yearFilter.trim().length === 4 ||
      seasonFilter.trim().length > 0;

    if (!hasFilterCriteria) {
      setLocalResults([]);
      setExternalResults([]);
      setTotalPages(1);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      const parsedYear = /^\d{4}$/.test(yearFilter.trim()) ? parseInt(yearFilter.trim(), 10) : undefined;
      const parsedSeason = seasonFilter.trim() !== '' ? parseInt(seasonFilter.trim(), 10) : undefined;
      const parsedEpisode = episodeFilter.trim() !== '' ? parseInt(episodeFilter.trim(), 10) : undefined;

      api
        .searchMedia(searchQuery.trim(), filterType, {
          category: filterCategory,
          year: parsedYear,
          season: parsedSeason !== undefined && !isNaN(parsedSeason) ? parsedSeason : undefined,
          episode: parsedEpisode !== undefined && !isNaN(parsedEpisode) ? parsedEpisode : undefined,
          sort: sortBy,
          page,
          signal: controller.signal
        })
        .then((res) => {
          setLocalResults(res.local || []);
          setExternalResults(res.external || []);
          setTotalPages(res.totalPages || 1);
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') console.error(err);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 260);

    return () => {
      clearTimeout(timer);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [searchQuery, filterType, filterCategory, yearFilter, seasonFilter, episodeFilter, sortBy, page]);

  const clearFilters = () => {
    setFilterType('all');
    setFilterCategory('all');
    setYearFilter('');
    setSeasonFilter('');
    setEpisodeFilter('');
    setSortBy('recent');
  };

  return (
    <div className="min-h-screen bg-[#080808] text-white pt-20 sm:pt-24 pb-20 px-3 sm:px-6 md:px-8 max-w-[1600px] mx-auto overflow-x-hidden">
      {/* SEARCH HEADER & FILTERS */}
      <div className="mb-8 space-y-4">
        <div className="max-w-3xl relative">
          <SearchIcon className="w-5 h-5 text-[#E50914] absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Pesquisar por título, TMDB ID ou IMDb ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#111216] border border-white/10 rounded-xl py-3 pl-12 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914] transition-all font-medium"
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Limpar pesquisa"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* FILTER TOOLBAR */}
        <div className="flex flex-wrap items-center gap-2.5 bg-[#0E0F14] border border-white/[0.08] rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 mr-1">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#E50914]" />
            <span>Filtros:</span>
          </div>

          <div className="inline-flex bg-black/50 border border-white/10 rounded-lg p-0.5">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'movie', label: 'Filmes' },
              { id: 'tv', label: 'Séries' }
            ].map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setFilterType(type.id as any)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  filterType === type.id ? 'bg-[#E50914] text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value as any)}
            aria-label="Categoria"
            className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-[#E50914]"
          >
            <option value="all">Todas Categorias</option>
            <option value="anime">Animes</option>
            <option value="dorama">Doramas</option>
          </select>

          <input
            type="number"
            min="1900"
            max="2100"
            placeholder="Ano"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="w-20 bg-black/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
          />

          <input
            type="number"
            min="0"
            placeholder="Temp."
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value)}
            className="w-20 bg-black/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
          />

          <input
            type="number"
            min="1"
            placeholder="Ep."
            value={episodeFilter}
            onChange={(e) => setEpisodeFilter(e.target.value)}
            className="w-20 bg-black/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
          />

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            aria-label="Ordenação"
            className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-[#E50914]"
          >
            <option value="recent">Mais Recentes</option>
            <option value="popular">Mais Populares</option>
            <option value="rating">Melhor Nota</option>
            <option value="title_asc">Título (A–Z)</option>
          </select>

          {(filterType !== 'all' || filterCategory !== 'all' || yearFilter || seasonFilter || episodeFilter || sortBy !== 'recent') && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* RESULTS GRID */}
      {loading ? (
        <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2.5 sm:gap-3">
          {Array.from({ length: 14 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      ) : !searchQuery.trim() && filterCategory === 'all' && !yearFilter && !seasonFilter ? (
        <div className="text-center py-24 bg-[#111216] rounded-xl border border-white/[0.06] text-zinc-500">
          <SearchIcon className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
          <p className="text-xs font-medium">Digite um título, TMDB ID ou selecione uma categoria e filtros acima.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {/* LOCAL RESULTS */}
          {localResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 bg-[#E50914] rounded-full" />
                  <h2 className="text-sm font-bold text-white tracking-tight uppercase">
                    Biblioteca RONYCINE ({localResults.length})
                  </h2>
                </div>
                <span className="text-[11px] text-emerald-400 font-medium">Catalogado</span>
              </div>
              <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2.5 sm:gap-3">
                {localResults.map((item) => (
                  <MediaCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* EXTERNAL TMDB PREVIEWS */}
          {externalResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 bg-sky-400 rounded-full" />
                  <h2 className="text-sm font-bold text-white tracking-tight uppercase">
                    Resultados Globais TMDB ({externalResults.length})
                  </h2>
                </div>
                <span className="text-[11px] text-zinc-400">Pré-visualização — Ainda não importado</span>
              </div>
              <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2.5 sm:gap-3">
                {externalResults.map((item) => (
                  <MediaCard key={item.id || `ext-${item.type}-${item.tmdbId}`} item={item} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg bg-[#14151A] border border-white/10 text-xs font-semibold text-zinc-200 disabled:opacity-40 flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Anterior
                  </button>
                  <span className="text-xs text-zinc-400 tabular-nums">
                    Página {page} de {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg bg-[#14151A] border border-white/10 text-xs font-semibold text-zinc-200 disabled:opacity-40 flex items-center gap-1"
                  >
                    Próxima
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {localResults.length === 0 && externalResults.length === 0 && (
            <div className="text-center py-24 bg-[#111216] rounded-xl border border-white/[0.06] text-zinc-500">
              <p className="text-xs">
                Nenhum resultado encontrado{searchQuery ? <> para <span className="text-white font-bold">"{searchQuery}"</span></> : ''}.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
