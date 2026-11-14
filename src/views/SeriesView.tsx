import React, { useState, useEffect } from 'react';
import { Tv, Search, SlidersHorizontal } from 'lucide-react';
import { MediaItem } from '../types.js';
import { api } from '../lib/api.js';
import { MediaCard, MediaCardSkeleton } from '../components/MediaCard.js';

export const SeriesView: React.FC = () => {
  const [series, setSeries] = useState<MediaItem[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem('ronycine_series_state');
      return saved ? JSON.parse(saved).genre || 'all' : 'all';
    } catch {
      return 'all';
    }
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem('ronycine_series_state');
      return saved ? JSON.parse(saved).query || '' : '';
    } catch {
      return '';
    }
  });
  const [loading, setLoading] = useState(true);

  const genres = ['all', 'Drama', 'Ação & Aventura', 'Comédia', 'Ficção Científica', 'Crime', 'Animação', 'Mistério', 'Documentário'];

  // Persist filter and search state
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('ronycine_series_state');
      const prev = saved ? JSON.parse(saved) : {};
      sessionStorage.setItem('ronycine_series_state', JSON.stringify({
        ...prev,
        genre: selectedGenre,
        query: searchQuery
      }));
    } catch (_) {}
  }, [selectedGenre, searchQuery]);

  // Track and restore scroll position on navigation back
  useEffect(() => {
    const handleScroll = () => {
      try {
        const saved = sessionStorage.getItem('ronycine_series_state');
        const prev = saved ? JSON.parse(saved) : {};
        sessionStorage.setItem('ronycine_series_state', JSON.stringify({
          ...prev,
          scrollY: window.scrollY
        }));
      } catch (_) {}
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    api.getCatalog({ type: 'tv', limit: 120 })
      .then((res) => {
        if (isMounted) {
          setSeries(res.items || []);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (isMounted) {
          setLoading(false);
          try {
            const saved = sessionStorage.getItem('ronycine_series_state');
            if (saved) {
              const { scrollY } = JSON.parse(saved);
              if (typeof scrollY === 'number' && scrollY > 0) {
                setTimeout(() => window.scrollTo({ top: scrollY, behavior: 'auto' }), 60);
              }
            }
          } catch (_) {}
        }
      });

    return () => { isMounted = false; };
  }, []);

  const filteredSeries = series.filter((s) => {
    const matchesGenre = selectedGenre === 'all' || s.genres?.some(g => g.toLowerCase().includes(selectedGenre.toLowerCase()));
    const matchesQuery = !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesGenre && matchesQuery;
  });

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-white pt-20 sm:pt-24 pb-20 px-3 sm:px-6 md:px-8 max-w-[1600px] mx-auto overflow-x-hidden">
      
      {/* HEADER & FILTERS */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6 pb-4 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2 text-[#E50914] mb-1">
            <Tv className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Séries & Temporadas</span>
          </div>
          <h1 className="text-xl sm:text-3xl font-black text-white uppercase tracking-tight font-display">
            Séries
          </h1>
          <p className="text-zinc-400 text-xs mt-0.5">
            {filteredSeries.length} {filteredSeries.length === 1 ? 'série disponível' : 'séries disponíveis'}
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtrar séries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#141416] border border-white/10 rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914] transition-all w-36 sm:w-48 font-medium"
            />
          </div>

          {/* Genre selector */}
          <div className="relative">
            <select
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              className="bg-[#141416] border border-white/10 rounded-md px-3 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-[#E50914] transition-all cursor-pointer"
            >
              <option value="all">Todos os Gêneros</option>
              {genres.filter(g => g !== 'all').map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* COMPACT GRID: 6-7 CARDS DESKTOP, 3 CARDS MOBILE (Requirement #2) */}
      {loading ? (
        <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-2.5 md:gap-3">
          {Array.from({ length: 14 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredSeries.length > 0 ? (
        <div className="grid grid-cols-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-2.5 md:gap-3">
          {filteredSeries.map((s) => (
            <MediaCard key={s.id} item={s} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-[#121214] rounded-xl border border-white/5">
          <Tv className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-white">Nenhuma série localizada</h3>
          <p className="text-zinc-500 text-xs mt-1">Tente pesquisar por outro título ou alterar o filtro de gênero.</p>
        </div>
      )}
    </div>
  );
};
