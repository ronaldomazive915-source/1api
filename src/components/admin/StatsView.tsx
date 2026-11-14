import React from 'react';
import {
  BarChart3,
  Film,
  Tv,
  Layers,
  Video,
  Server,
  AlertTriangle,
  Flame,
  CheckCircle2,
  XCircle,
  Users,
  Eye,
  Clock,
  Trash2,
  Star
} from 'lucide-react';
import { CatalogStats } from '../../types.js';
import { formatAdminDate, resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';

interface StatsViewProps {
  stats: CatalogStats | null;
  onNavigateTab?: (tabId: string) => void;
}

export const StatsView: React.FC<StatsViewProps> = ({ stats, onNavigateTab }) => {
  const totalMovies = stats?.totalMovies ?? 0;
  const totalSeries = stats?.totalSeries ?? 0;
  const totalCatalog = totalMovies + totalSeries;
  const totalSeasons = stats?.totalSeasons ?? 0;
  const totalEpisodes = stats?.totalEpisodes ?? 0;

  const publishedMovies = stats?.publishedMovies ?? 0;
  const unpublishedMovies = stats?.unpublishedMovies ?? 0;
  const publishedSeries = stats?.publishedSeries ?? 0;
  const unpublishedSeries = stats?.unpublishedSeries ?? 0;

  const moviesWithoutSource = stats?.moviesWithoutSource ?? 0;
  const seriesWithoutSource = stats?.seriesWithoutSource ?? 0;
  const moviesWithSource = Math.max(0, totalMovies - moviesWithoutSource);
  const seriesWithSource = Math.max(0, totalSeries - seriesWithoutSource);

  const deletedMovies = stats?.deletedMovies ?? 0;
  const deletedSeries = stats?.deletedSeries ?? 0;
  const totalDeleted = deletedMovies + deletedSeries;

  const totalLinks = stats?.totalLinks ?? 0;
  const onlineLinks = stats?.onlineLinks ?? 0;
  const offlineLinks = stats?.offlineLinks ?? 0;
  const totalProblematic = stats?.totalProblematic ?? 0;
  const top10Count = stats?.top10Count ?? 0;

  const movieSharePct = totalCatalog > 0 ? Math.round((totalMovies / totalCatalog) * 100) : 0;
  const seriesSharePct = totalCatalog > 0 ? Math.round((totalSeries / totalCatalog) * 100) : 0;
  const sourceCoveragePct =
    totalCatalog > 0 ? Math.round(((moviesWithSource + seriesWithSource) / totalCatalog) * 100) : 0;
  const publishedPct =
    totalCatalog > 0 ? Math.round(((publishedMovies + publishedSeries) / totalCatalog) * 100) : 0;

  const recentImports = stats?.recentImports || [];
  const recentItems = stats?.recentItems || [];

  return (
    <div className="space-y-6 text-zinc-100 font-inter">
      {/* HEADER */}
      <div className="bg-[#0D0F15] rounded-3xl p-5 border border-white/10 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-brand/10 border border-brand/20 rounded-2xl text-brand shrink-0">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight font-outfit uppercase">
              Estatísticas Reais do Acervo
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Indicadores calculados em tempo real diretamente da base de dados RONYCINE.
            </p>
          </div>
        </div>

        {onNavigateTab && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onNavigateTab('catalog_movies')}
              className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold uppercase tracking-wider text-zinc-200 transition-all flex items-center gap-1.5"
            >
              <Film className="w-3.5 h-3.5 text-brand" /> Catálogo Filmes
            </button>
            <button
              onClick={() => onNavigateTab('catalog_series')}
              className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold uppercase tracking-wider text-zinc-200 transition-all flex items-center gap-1.5"
            >
              <Tv className="w-3.5 h-3.5 text-purple-400" /> Catálogo Séries
            </button>
          </div>
        )}
      </div>

      {/* PRIMARY KPI CARDS (REAL DB TOTALS) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-black uppercase tracking-widest">Filmes</span>
            <Film className="w-4 h-4 text-brand" />
          </div>
          <p className="text-2xl font-black text-white tabular-nums">{totalMovies.toLocaleString('pt-PT')}</p>
          <p className="text-[11px] text-zinc-500 tabular-nums">
            {publishedMovies} publicados · {moviesWithoutSource} sem fonte
          </p>
        </div>

        <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-black uppercase tracking-widest">Séries</span>
            <Tv className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-2xl font-black text-white tabular-nums">{totalSeries.toLocaleString('pt-PT')}</p>
          <p className="text-[11px] text-zinc-500 tabular-nums">
            {publishedSeries} publicadas · {seriesWithoutSource} sem fonte
          </p>
        </div>

        <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-black uppercase tracking-widest">Temporadas / Ep.</span>
            <Layers className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-2xl font-black text-white tabular-nums">
            {totalSeasons.toLocaleString('pt-PT')} / {totalEpisodes.toLocaleString('pt-PT')}
          </p>
          <p className="text-[11px] text-zinc-500">Total estruturado nas séries</p>
        </div>

        <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-black uppercase tracking-widest">Fontes de Vídeo</span>
            <Server className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-black text-white tabular-nums">{totalLinks.toLocaleString('pt-PT')}</p>
          <p className="text-[11px] text-zinc-500 tabular-nums">
            {onlineLinks} online · {offlineLinks} offline
          </p>
        </div>

        <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-black uppercase tracking-widest">Alertas / Lixeira</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-black text-amber-400 tabular-nums">{totalProblematic.toLocaleString('pt-PT')}</p>
          <p className="text-[11px] text-zinc-500 tabular-nums">
            {totalDeleted} na lixeira ({deletedMovies}F / {deletedSeries}S)
          </p>
        </div>

        <div className="bg-[#0D0F15] border border-white/5 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] font-black uppercase tracking-widest">Utilizadores / Views</span>
            <Users className="w-4 h-4 text-zinc-300" />
          </div>
          <p className="text-2xl font-black text-white tabular-nums">{(stats?.totalUsers ?? 0).toLocaleString('pt-PT')}</p>
          <p className="text-[11px] text-zinc-500 tabular-nums flex items-center gap-1">
            <Eye className="w-3 h-3" /> {(stats?.totalViews ?? 0).toLocaleString('pt-PT')} visualizações ·{' '}
            <Flame className="w-3 h-3 text-orange-400" /> {top10Count}/10 Top10
          </p>
        </div>
      </div>

      {/* REAL DISTRIBUTION & INTEGRITY BARS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0D0F15] border border-white/5 rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">
              Separação Filmes vs Séries
            </h3>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">Total ativo: {totalCatalog}</span>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-zinc-300 flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-brand" /> Filmes ({totalMovies})
                </span>
                <span className="font-mono text-white tabular-nums">{movieSharePct}%</span>
              </div>
              <div className="h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/5">
                <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${movieSharePct}%` }} />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-zinc-300 flex items-center gap-2">
                  <Tv className="w-3.5 h-3.5 text-purple-400" /> Séries ({totalSeries})
                </span>
                <span className="font-mono text-white tabular-nums">{seriesSharePct}%</span>
              </div>
              <div className="h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all"
                  style={{ width: `${seriesSharePct}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
              <div className="bg-black/40 border border-white/5 rounded-2xl p-3">
                <span className="text-[10px] font-black uppercase text-zinc-500 block">Filmes por Estado</span>
                <p className="mt-1 font-bold text-emerald-400 tabular-nums">{publishedMovies} publicados</p>
                <p className="text-[11px] text-zinc-400 tabular-nums">
                  {unpublishedMovies} rascunhos · {deletedMovies} na lixeira
                </p>
              </div>
              <div className="bg-black/40 border border-white/5 rounded-2xl p-3">
                <span className="text-[10px] font-black uppercase text-zinc-500 block">Séries por Estado</span>
                <p className="mt-1 font-bold text-emerald-400 tabular-nums">{publishedSeries} publicadas</p>
                <p className="text-[11px] text-zinc-400 tabular-nums">
                  {unpublishedSeries} rascunhos · {deletedSeries} na lixeira
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#0D0F15] border border-white/5 rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">
              Cobertura de Fontes & Publicação
            </h3>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">{totalLinks} fontes registadas</span>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-zinc-300 flex items-center gap-2">
                  <Video className="w-3.5 h-3.5 text-emerald-400" /> Conteúdos com Fonte (
                  {moviesWithSource + seriesWithSource}/{totalCatalog})
                </span>
                <span className="font-mono text-white tabular-nums">{sourceCoveragePct}%</span>
              </div>
              <div className="h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${sourceCoveragePct}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-zinc-300 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" /> Taxa de Publicação (
                  {publishedMovies + publishedSeries}/{totalCatalog})
                </span>
                <span className="font-mono text-white tabular-nums">{publishedPct}%</span>
              </div>
              <div className="h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-sky-500 rounded-full transition-all"
                  style={{ width: `${publishedPct}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2 text-xs tabular-nums">
              <div className="bg-black/40 border border-white/5 rounded-2xl p-3">
                <span className="text-[10px] font-black uppercase text-zinc-500 block">Online</span>
                <p className="text-lg font-black text-emerald-400 mt-1">{onlineLinks}</p>
              </div>
              <div className="bg-black/40 border border-white/5 rounded-2xl p-3">
                <span className="text-[10px] font-black uppercase text-zinc-500 block">Offline</span>
                <p className="text-lg font-black text-red-400 mt-1">{offlineLinks}</p>
              </div>
              <div className="bg-black/40 border border-white/5 rounded-2xl p-3">
                <span className="text-[10px] font-black uppercase text-zinc-500 block">Sem Fonte</span>
                <p className="text-lg font-black text-amber-400 mt-1">
                  {moviesWithoutSource + seriesWithoutSource}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RECENT ITEMS & RECENT IMPORTS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Adicionados Recentemente */}
        <div className="bg-[#0D0F15] border border-white/5 rounded-3xl overflow-hidden">
          <div className="p-5 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">Adicionados Recentemente</h3>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{recentItems.length} itens</span>
          </div>
          <div className="divide-y divide-white/5">
            {recentItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">Nenhum conteúdo recente registado.</div>
            ) : (
              recentItems.map(item => {
                const poster = resolveTmdbPosterUrl(item.posterPath, 'w185');
                return (
                  <div key={item.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02]">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-12 rounded-lg bg-zinc-900 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                        {poster ? (
                          <img src={poster} alt={item.title} className="w-full h-full object-cover" />
                        ) : item.type === 'tv' ? (
                          <Tv className="w-4 h-4 text-zinc-600" />
                        ) : (
                          <Film className="w-4 h-4 text-zinc-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{item.title}</p>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                          <span className={item.type === 'tv' ? 'text-purple-400' : 'text-red-400'}>
                            {item.type === 'tv' ? 'Série' : 'Filme'}
                          </span>
                          <span>•</span>
                          <span>{item.releaseYear || '—'}</span>
                          {item.tmdbId ? (
                            <>
                              <span>•</span>
                              <span>TMDB {item.tmdbId}</span>
                            </>
                          ) : null}
                          {item.voteAverage ? (
                            <span className="text-amber-400 flex items-center gap-0.5">
                              <Star className="w-2.5 h-2.5 fill-amber-400" /> {item.voteAverage.toFixed(1)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                          item.hasSource
                            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-700/60'
                        }`}
                      >
                        {item.hasSource ? 'Com fonte' : 'Sem fonte'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                          item.published
                            ? 'bg-sky-950/60 text-sky-400 border-sky-800/60'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-700/60'
                        }`}
                      >
                        {item.published ? 'Publicado' : 'Rascunho'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Últimas Importações TMDB */}
        <div className="bg-[#0D0F15] border border-white/5 rounded-3xl overflow-hidden">
          <div className="p-5 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-emerald-400 hidden" />
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">Últimas Importações TMDB</h3>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{recentImports.length} registos</span>
          </div>
          <div className="divide-y divide-white/5">
            {recentImports.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">Nenhuma importação recente registada.</div>
            ) : (
              recentImports.map(imp => (
                <div key={imp.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          imp.type === 'tv' ? 'bg-purple-400' : 'bg-brand'
                        }`}
                      />
                      <p className="text-xs font-bold text-white truncate">{imp.title}</p>
                      <span className="text-[9px] font-mono text-zinc-500 shrink-0">TMDB {imp.tmdbId}</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                      {formatAdminDate(imp.timestamp)} · {imp.details}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 border ${
                      imp.status === 'SUCCESS'
                        ? 'bg-emerald-950/50 text-emerald-400 border-emerald-900/50'
                        : imp.status === 'EXISTING'
                        ? 'bg-amber-950/50 text-amber-400 border-amber-900/50'
                        : 'bg-red-950/50 text-red-400 border-red-900/50'
                    }`}
                  >
                    {imp.status === 'SUCCESS' ? (
                      'IMPORTADO'
                    ) : imp.status === 'EXISTING' ? (
                      'EXISTENTE'
                    ) : (
                      <span className="flex items-center gap-1">
                        <XCircle className="w-2.5 h-2.5" /> ERRO
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
