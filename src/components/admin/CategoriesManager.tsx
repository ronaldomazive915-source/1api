import React, { useState, useEffect } from 'react';
import { 
  FolderHeart, 
  Search, 
  Film, 
  Tv, 
  Eye, 
  Star, 
  Calendar, 
  ArrowLeft, 
  Check, 
  SlidersHorizontal,
  ChevronRight,
  Layers,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { MediaItem } from '../../types.js';

interface CategoriesManagerProps {
  onSwitchTab?: (tabId: string) => void;
}

interface CategoryInfo {
  id: string;
  name: string;
  count: number;
  moviesCount: number;
  seriesCount: number;
  icon?: string;
  active: boolean;
}

export const CategoriesManager: React.FC<CategoriesManagerProps> = ({ onSwitchTab }) => {
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  // Category Details state (loaded on-demand only when a category is clicked)
  const [categoryItems, setCategoryItems] = useState<MediaItem[]>([]);
  const [loadingCategoryItems, setLoadingCategoryItems] = useState<boolean>(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState<string>('');
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage] = useState<number>(24);

  // Load category summary
  useEffect(() => {
    loadCategoryStats();
  }, []);

  const loadCategoryStats = async () => {
    setLoading(true);
    try {
      // Fetch accurate server-side genre distribution
      const catList = await api.getCategories();
      if (Array.isArray(catList) && catList.length > 0) {
        const seenIds = new Set<string>();
        const uniqueCats = catList.filter((c, idx) => {
          const key = c.id || `cat-${idx}`;
          if (seenIds.has(key)) return false;
          seenIds.add(key);
          return true;
        });
        setCategories(uniqueCats);
      } else {
        const res = await api.getCatalog({ limit: 1000 });
        const items = res?.items || [];

        const defaultGenres = [
          'Ação', 'Aventura', 'Animação', 'Comédia', 'Crime', 'Documentário', 'Drama',
          'Família', 'Fantasia', 'Ficção Científica', 'Mistério', 'Romance', 'Suspense',
          'Terror', 'Guerra', 'Música'
        ];

        const getCleanId = (str: string) => {
          return str.trim().toLowerCase()
            .replace(/[áàãâä]/g, 'a')
            .replace(/[éèêë]/g, 'e')
            .replace(/[íìîï]/g, 'i')
            .replace(/[óòõôö]/g, 'o')
            .replace(/[úùûü]/g, 'u')
            .replace(/ç/g, 'c')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'outros';
        };

        const genreStats: { [id: string]: { name: string; total: number; movies: number; series: number } } = {};

        defaultGenres.forEach(name => {
          const id = getCleanId(name);
          if (!genreStats[id]) {
            genreStats[id] = { name, total: 0, movies: 0, series: 0 };
          }
        });

        items.forEach(item => {
          if (item.genres && Array.isArray(item.genres)) {
            item.genres.forEach(g => {
              if (typeof g === 'string' && g.trim()) {
                const rawName = g.trim();
                const id = getCleanId(rawName);
                if (!genreStats[id]) {
                  genreStats[id] = { name: rawName, total: 0, movies: 0, series: 0 };
                }
                genreStats[id].total++;
                if (item.type === 'movie') genreStats[id].movies++;
                else if (item.type === 'tv') genreStats[id].series++;
              }
            });
          }
        });

        const fallbackList: CategoryInfo[] = Object.keys(genreStats).map(id => ({
          id,
          name: genreStats[id].name,
          count: genreStats[id].total,
          moviesCount: genreStats[id].movies,
          seriesCount: genreStats[id].series,
          active: true
        })).sort((a, b) => b.count - a.count);

        setCategories(fallbackList);
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCategory = async (genreName: string) => {
    setSelectedCategory(genreName);
    setLoadingCategoryItems(true);
    setCategorySearchQuery('');
    setCategoryTypeFilter('all');
    setCurrentPage(1);

    try {
      const res = await api.getCatalog({ genre: genreName, limit: 100 });
      setCategoryItems(res?.items || []);
    } catch (err) {
      console.error('Failed to load category items:', err);
      setCategoryItems([]);
    } finally {
      setLoadingCategoryItems(false);
    }
  };

  // Filtered items in selected category
  const filteredCategoryItems = categoryItems.filter(item => {
    if (categoryTypeFilter !== 'all' && item.type !== categoryTypeFilter) return false;
    if (categorySearchQuery.trim()) {
      const q = categorySearchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.originalTitle && item.originalTitle.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filteredCategoryItems.length / itemsPerPage) || 1;
  const paginatedItems = filteredCategoryItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="space-y-4 font-sans">
      {/* 1. If NO category selected: SHOW COMPACT CATEGORIES GRID */}
      {!selectedCategory ? (
        <>
          {/* Header Summary */}
          <div className="bg-zinc-900 border border-zinc-800/80 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center text-red-500 shrink-0">
                <FolderHeart className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider">
                  Categorias do Catálogo
                </h2>
                <p className="text-xs text-zinc-400">
                  Clique em uma categoria para visualizar e gerenciar somente os conteúdos associados a ela.
                </p>
              </div>
            </div>
            <div className="text-[11px] text-zinc-400 font-mono bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
              {categories.length} Categorias Mapeadas
            </div>
          </div>

          {/* Categories Grid (Compact Cards) */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-3.5 space-y-2 animate-pulse">
                  <div className="h-4 bg-zinc-800 rounded w-2/3"></div>
                  <div className="h-3 bg-zinc-800/60 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {categories.map((cat, idx) => (
                <button
                  key={`${cat.id}-${idx}`}
                  onClick={() => handleSelectCategory(cat.name)}
                  className="bg-zinc-900/90 hover:bg-zinc-850 border border-zinc-800/80 hover:border-red-600/50 rounded-xl p-3.5 text-left transition-all group flex flex-col justify-between h-24 hover:shadow-lg hover:shadow-red-950/20"
                >
                  <div className="flex items-start justify-between w-full">
                    <span className="font-extrabold text-xs text-white uppercase tracking-wide group-hover:text-red-400 transition-colors line-clamp-1">
                      {cat.name}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-red-500 group-hover:translate-x-0.5 transition-all shrink-0 ml-1" />
                  </div>
                  
                  <div className="space-y-0.5">
                    <div className="text-sm font-black font-mono text-zinc-200">
                      {cat.count} <span className="text-[10px] font-normal text-zinc-500">títulos</span>
                    </div>
                    <div className="text-[9px] text-zinc-500 font-mono flex items-center gap-1.5">
                      <span>🎬 {cat.moviesCount}</span>
                      <span>•</span>
                      <span>📺 {cat.seriesCount}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        /* 2. If category IS SELECTED: SHOW ON-DEMAND CONTENTS ONLY */
        <div className="space-y-4 animate-in fade-in duration-200">
          
          {/* Back Button & Category Header */}
          <div className="bg-zinc-900 border border-zinc-800/80 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedCategory(null)}
                className="p-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-zinc-300 hover:text-white transition-colors"
                title="Voltar para todas as categorias"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Categoria</span>
                  <span className="text-zinc-600">/</span>
                  <h2 className="text-sm font-black text-white uppercase tracking-wider">
                    {selectedCategory}
                  </h2>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Exibindo {filteredCategoryItems.length} conteúdos nesta categoria
                </p>
              </div>
            </div>

            {/* Quick Filters */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-56">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={`Pesquisar em ${selectedCategory}...`}
                  value={categorySearchQuery}
                  onChange={(e) => {
                    setCategorySearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-600 transition-colors"
                />
              </div>

              <div className="flex bg-zinc-950 border border-zinc-800 rounded-xl p-0.5 text-xs shrink-0">
                <button
                  onClick={() => { setCategoryTypeFilter('all'); setCurrentPage(1); }}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${categoryTypeFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => { setCategoryTypeFilter('movie'); setCurrentPage(1); }}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${categoryTypeFilter === 'movie' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                >
                  Filmes
                </button>
                <button
                  onClick={() => { setCategoryTypeFilter('tv'); setCurrentPage(1); }}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${categoryTypeFilter === 'tv' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                >
                  Séries
                </button>
              </div>
            </div>
          </div>

          {/* Category Contents Grid */}
          {loadingCategoryItems ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl aspect-[2/3] animate-pulse"></div>
              ))}
            </div>
          ) : paginatedItems.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {paginatedItems.map((item, idx) => (
                <div 
                  key={`${item.id || item.tmdbId || 'cat-item'}-${idx}`}
                  className="bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 rounded-xl overflow-hidden group transition-all flex flex-col"
                >
                  {/* Poster Thumbnail */}
                  <div className="relative aspect-[2/3] bg-zinc-950 overflow-hidden">
                    {item.posterPath ? (
                      <img
                        src={item.posterPath.startsWith('http') ? item.posterPath : `https://image.tmdb.org/t/p/w342${item.posterPath}`}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-700">
                        {item.type === 'movie' ? <Film className="w-8 h-8" /> : <Tv className="w-8 h-8" />}
                      </div>
                    )}

                    {/* Media Type Badge */}
                    <span className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                      item.type === 'movie' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                    }`}>
                      {item.type === 'movie' ? 'Filme' : 'Série'}
                    </span>

                    {/* Rating Badge */}
                    {typeof item.voteAverage === 'number' && item.voteAverage > 0 && (
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-amber-400 text-[9px] font-bold flex items-center gap-0.5 backdrop-blur-sm border border-zinc-800">
                        <Star className="w-2.5 h-2.5 fill-amber-400" />
                        {item.voteAverage.toFixed(1)}
                      </span>
                    )}
                  </div>

                  {/* Info Footer */}
                  <div className="p-2.5 space-y-1 flex-1 flex flex-col justify-between">
                    <h3 className="font-extrabold text-xs text-white truncate" title={item.title}>
                      {item.title}
                    </h3>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                      <span>{item.releaseDate ? item.releaseDate.substring(0, 4) : item.firstAirDate ? item.firstAirDate.substring(0, 4) : 'N/A'}</span>
                      {item.type === 'tv' && (
                        <span>{item.seasons ? item.seasons.length : (item.seasonsCount || 1)}T</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500 space-y-2">
              <FolderHeart className="w-10 h-10 mx-auto text-zinc-700" />
              <p className="text-xs font-bold text-zinc-300">Nenhum conteúdo encontrado nesta categoria com os filtros atuais.</p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800/80 rounded-xl px-4 py-2.5 text-xs text-zinc-400">
              <span>Página {currentPage} de {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-white text-xs disabled:opacity-40 transition-colors"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-white text-xs disabled:opacity-40 transition-colors"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};
