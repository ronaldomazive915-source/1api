import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Film,
  Tv,
  Heart,
  Wand2,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Star,
  Calendar,
  Globe,
  Layers,
  Link2,
  ExternalLink,
  Check,
  X
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { SmartDetectionCandidate } from '../../types.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';

type ImporterMode = 'smart' | 'movie' | 'series' | 'anime' | 'dorama';

interface SmartContentImporterProps {
  initialMode?: ImporterMode;
  onCatalogUpdated?: () => void;
  onOpenSeriesPro?: (tmdbId: number) => void;
  onViewCatalogItem?: (item: { id?: string; tmdbId: number; type: 'movie' | 'tv'; title: string; categories?: string[] }) => void;
}

const MODES: Array<{
  id: ImporterMode;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
}> = [
  {
    id: 'smart',
    label: 'Deteção Inteligente',
    subtitle: 'Analisa país, idioma e géneros antes de confirmar',
    icon: Wand2,
    accentClass: 'text-[#E50914] bg-[#E50914]/15 border-[#E50914]/30'
  },
  {
    id: 'movie',
    label: 'Importar Filme',
    subtitle: 'Pesquisa por título ou TMDB ID + fonte inicial opcional',
    icon: Film,
    accentClass: 'text-red-400 bg-red-500/15 border-red-500/30'
  },
  {
    id: 'series',
    label: 'Importar Série',
    subtitle: 'Todas as temporadas e episódios ilimitados via TMDB',
    icon: Tv,
    accentClass: 'text-sky-400 bg-sky-500/15 border-sky-500/30'
  },
  {
    id: 'anime',
    label: 'Importar Anime',
    subtitle: 'Filmes ou séries guardados com categoria Anime sem duplicar',
    icon: Sparkles,
    accentClass: 'text-amber-400 bg-amber-500/15 border-amber-500/30'
  },
  {
    id: 'dorama',
    label: 'Importar Dorama',
    subtitle: 'Dramas asiáticos com origem e categoria Dorama oficial',
    icon: Heart,
    accentClass: 'text-rose-400 bg-rose-500/15 border-rose-500/30'
  }
];

export const SmartContentImporter: React.FC<SmartContentImporterProps> = ({
  initialMode = 'smart',
  onCatalogUpdated,
  onOpenSeriesPro,
  onViewCatalogItem
}) => {
  const [mode, setMode] = useState<ImporterMode>(initialMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTypeFilter, setSearchTypeFilter] = useState<'all' | 'movie' | 'tv'>(
    initialMode === 'movie' ? 'movie' : initialMode === 'series' ? 'tv' : 'all'
  );

  const [candidates, setCandidates] = useState<SmartDetectionCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SmartDetectionCandidate | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Array<'anime' | 'dorama'>>([]);
  const [confirmManualChoice, setConfirmManualChoice] = useState(false);
  const [forceUpdateExisting, setForceUpdateExisting] = useState(false);

  // Movie optional initial link
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceFormat, setSourceFormat] = useState<'auto' | 'mp4' | 'm3u8' | 'embed'>('auto');
  const [sourceServer, setSourceServer] = useState('Servidor Principal');
  const [sourceQuality, setSourceQuality] = useState('1080p');
  const [sourceAudio, setSourceAudio] = useState('Legendado');

  // Series full sync options
  const [importAllSeasons, setImportAllSeasons] = useState(true);
  const [includeSpecials, setIncludeSpecials] = useState(true);

  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<{
    title: string;
    tmdbId: number;
    type: 'movie' | 'tv';
    categories: string[];
    updatedExisting: boolean;
    message: string;
  } | null>(null);

  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMode(initialMode);
    if (initialMode === 'movie') setSearchTypeFilter('movie');
    else if (initialMode === 'series') setSearchTypeFilter('tv');
    else setSearchTypeFilter('all');
  }, [initialMode]);

  const handleModeChange = (nextMode: ImporterMode) => {
    setMode(nextMode);
    setImportSuccess(null);
    setImportError(null);
    if (nextMode === 'movie') setSearchTypeFilter('movie');
    else if (nextMode === 'series') setSearchTypeFilter('tv');
    else setSearchTypeFilter('all');

    if (selected) {
      if (nextMode === 'anime') {
        setSelectedCategories(prev => (prev.includes('anime') ? prev : [...prev, 'anime']));
      } else if (nextMode === 'dorama') {
        setSelectedCategories(prev => (prev.includes('dorama') ? prev : [...prev, 'dorama']));
      }
    }
  };

  const runDetectionSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchError('Digite um título ou um TMDB ID numérico para pesquisar.');
      return;
    }

    if (searchAbortRef.current) searchAbortRef.current.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearching(true);
    setSearchError(null);
    setImportError(null);
    setImportSuccess(null);

    try {
      const res = await api.detectTmdbContent(
        {
          query: trimmed,
          type: searchTypeFilter === 'all' ? undefined : searchTypeFilter
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      const list = Array.isArray(res?.candidates) ? res.candidates : [];
      setCandidates(list);
      if (list.length === 0) {
        setSearchError('Nenhum resultado encontrado no TMDB para essa pesquisa.');
      } else if (list.length === 1) {
        selectCandidate(list[0]);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setSearchError(err?.message || 'Erro ao consultar o TMDB.');
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  };

  const selectCandidate = (candidate: SmartDetectionCandidate) => {
    setSelected(candidate);
    setImportError(null);
    setImportSuccess(null);
    setForceUpdateExisting(false);
    setSourceUrl('');

    const suggested = new Set<'anime' | 'dorama'>(candidate.detection?.suggestedCategories || []);
    if (mode === 'anime') suggested.add('anime');
    if (mode === 'dorama') suggested.add('dorama');

    setSelectedCategories(Array.from(suggested));
    setConfirmManualChoice(!candidate.detection?.needsManualChoice || mode === 'anime' || mode === 'dorama');
  };

  const toggleCategory = (cat: 'anime' | 'dorama') => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
    setConfirmManualChoice(true);
  };

  const handleConfirmImport = async () => {
    if (!selected) return;
    if (selected.detection?.needsManualChoice && !confirmManualChoice) {
      setImportError('Confirme manualmente se este título pertence a Animes, Doramas ou apenas Filmes/Séries.');
      return;
    }
    if (selected.existsInCatalog && !forceUpdateExisting) {
      setImportError('Este título já existe no catálogo. Marque a opção para atualizar metadados sem duplicar.');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const payload: Parameters<typeof api.importTmdbWithOptions>[0] = {
        tmdbId: selected.tmdbId,
        type: selected.type,
        categories: selectedCategories,
        forceUpdate: forceUpdateExisting,
        importSource: `SMART_IMPORTER_${mode.toUpperCase()}`
      };

      if (selected.type === 'tv') {
        payload.importAllSeasons = importAllSeasons;
        payload.includeSpecials = includeSpecials;
      } else if (sourceUrl.trim()) {
        payload.initialSource = {
          url: sourceUrl.trim(),
          format: sourceFormat,
          serverName: sourceServer.trim() || 'Servidor Principal',
          quality: sourceQuality.trim() || '1080p',
          audioLanguage: sourceAudio.trim() || 'Legendado'
        };
      }

      const res = await api.importTmdbWithOptions(payload);
      if (res?.exists && !forceUpdateExisting) {
        setImportError(res.message || 'Conteúdo já existe no catálogo.');
        return;
      }

      setImportSuccess({
        title: selected.title,
        tmdbId: selected.tmdbId,
        type: selected.type,
        categories: selectedCategories,
        updatedExisting: Boolean(forceUpdateExisting || res?.updated),
        message:
          res?.message ||
          `"${selected.title}" importado com sucesso na base de dados RONYCINE.`
      });

      // Sync candidate exists flag locally
      setCandidates(prev =>
        prev.map(c =>
          c.tmdbId === selected.tmdbId && c.type === selected.type
            ? { ...c, existsInCatalog: true }
            : c
        )
      );
      setSelected(prev => (prev ? { ...prev, existsInCatalog: true } : prev));
      onCatalogUpdated?.();
    } catch (err: any) {
      setImportError(err?.message || 'Erro ao importar conteúdo no servidor.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6 text-zinc-100">
      {/* HEADER */}
      <div className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-[#E50914] uppercase tracking-widest mb-1">
            <Wand2 className="w-4 h-4" />
            <span>IMPORTAÇÃO MANUAL CONTROLADA</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">IMPORTAR CONTEÚDO</h2>
          <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
            Adiciona filmes, séries, animes e doramas à biblioteca RONYCINE com deteção inteligente e confirmação explícita.
          </p>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/50 border border-white/[0.08] text-xs font-medium text-zinc-300 shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Sem importação automática</span>
        </div>
      </div>

      {/* 5 MODE SELECTOR CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {MODES.map(item => {
          const Icon = item.icon;
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleModeChange(item.id)}
              className={`text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-2.5 ${
                active
                  ? 'bg-[#14161F] border-[#E50914] shadow-lg shadow-[#E50914]/15'
                  : 'bg-[#0D0F15] border-white/[0.08] hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${item.accentClass}`}>
                  <Icon className="w-4 h-4" />
                </div>
                {active && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#E50914]">Ativo</span>
                )}
              </div>
              <div>
                <div className="text-xs sm:text-sm font-bold text-white">{item.label}</div>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{item.subtitle}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* SEARCH BAR */}
      <form
        onSubmit={runDetectionSearch}
        className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-3"
      >
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={
                mode === 'movie'
                  ? 'Pesquisar filme por título ou TMDB ID (ex: 550)...'
                  : mode === 'series'
                    ? 'Pesquisar série por título ou TMDB ID (ex: 1399)...'
                    : 'Pesquisar título ou TMDB ID (ex: Solo Leveling, Goblin, 550)...'
              }
              className="w-full bg-black/70 border border-white/10 focus:border-[#E50914] rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCandidates([]);
                  setSelected(null);
                  setSearchError(null);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <select
            value={searchTypeFilter}
            onChange={e => setSearchTypeFilter(e.target.value as 'all' | 'movie' | 'tv')}
            disabled={mode === 'movie' || mode === 'series'}
            className="bg-black/70 border border-white/10 rounded-xl px-3.5 py-3 text-xs font-bold text-white focus:border-[#E50914] focus:outline-none disabled:opacity-60"
          >
            <option value="all">Filmes & Séries</option>
            <option value="movie">Apenas Filmes</option>
            <option value="tv">Apenas Séries</option>
          </select>

          <button
            type="submit"
            disabled={isSearching}
            className="px-6 py-3 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2 shrink-0"
          >
            {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Analisar TMDB</span>
          </button>
        </div>

        {searchError && (
          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{searchError}</span>
          </div>
        )}
      </form>

      {/* RESULTS & CONFIRMATION WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Candidate List */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-mono text-zinc-400 px-1">
            <span>RESULTADOS TMDB ({candidates.length})</span>
            {candidates.length > 0 && <span>Selecione para rever</span>}
          </div>

          {candidates.length === 0 ? (
            <div className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl p-8 text-center space-y-2">
              <Search className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-xs font-semibold text-zinc-300">Nenhum candidato carregado</p>
              <p className="text-[11px] text-zinc-500">
                Pesquise um filme, série, anime ou dorama acima para pré-visualizar metadados e confirmar a importação.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
              {candidates.map(cand => {
                const isSelected = selected?.tmdbId === cand.tmdbId && selected?.type === cand.type;
                const poster = resolveTmdbPosterUrl(cand.posterPath, 'w185');
                return (
                  <button
                    key={`${cand.type}-${cand.tmdbId}`}
                    type="button"
                    onClick={() => selectCandidate(cand)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                      isSelected
                        ? 'bg-[#151824] border-[#E50914]'
                        : 'bg-[#0D0F15] border-white/[0.08] hover:border-white/25'
                    }`}
                  >
                    <div className="w-12 h-[72px] rounded-lg bg-black border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                      {poster ? (
                        <img src={poster} alt={cand.title} className="w-full h-full object-cover" />
                      ) : cand.type === 'tv' ? (
                        <Tv className="w-4 h-4 text-zinc-600" />
                      ) : (
                        <Film className="w-4 h-4 text-zinc-600" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs sm:text-sm font-bold text-white line-clamp-1">{cand.title}</h4>
                        {cand.existsInCatalog && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[9px] font-bold uppercase shrink-0">
                            No Catálogo
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400 font-mono tabular-nums">
                        <span>{cand.type === 'tv' ? 'Série' : 'Filme'}</span>
                        <span>·</span>
                        <span>{cand.releaseYear || '—'}</span>
                        <span>·</span>
                        <span>TMDB {cand.tmdbId}</span>
                        {cand.voteAverage ? (
                          <>
                            <span>·</span>
                            <span className="text-amber-400">★ {Number(cand.voteAverage).toFixed(1)}</span>
                          </>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {cand.detection?.suggestedCategories?.map(cat => (
                          <span
                            key={cat}
                            className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-bold uppercase"
                          >
                            Sugestão: {cat}
                          </span>
                        ))}
                        {cand.detection?.needsManualChoice && (
                          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-300 text-[9px] font-medium">
                            Escolha manual
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Confirmation Panel */}
        <div className="lg:col-span-7">
          {!selected ? (
            <div className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl p-10 text-center space-y-3">
              <Wand2 className="w-10 h-10 text-[#E50914] mx-auto opacity-80" />
              <h3 className="text-base font-bold text-white">Pré-visualização & Confirmação</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                Selecione um resultado à esquerda para inspecionar metadados oficiais do TMDB, confirmar a categoria (Filme, Série, Anime ou Dorama) e adicionar fontes se desejar.
              </p>
            </div>
          ) : (
            <div className="bg-[#0D0F15] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
              {/* Top Metadata Summary */}
              <div className="p-5 sm:p-6 border-b border-white/[0.08] flex flex-col sm:flex-row gap-4">
                <div className="w-24 h-36 rounded-xl bg-black border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                  {resolveTmdbPosterUrl(selected.posterPath, 'w342') ? (
                    <img
                      src={resolveTmdbPosterUrl(selected.posterPath, 'w342')}
                      alt={selected.title}
                      className="w-full h-full object-cover"
                    />
                  ) : selected.type === 'tv' ? (
                    <Tv className="w-7 h-7 text-zinc-600" />
                  ) : (
                    <Film className="w-7 h-7 text-zinc-600" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-[#E50914]/15 border border-[#E50914]/30 text-[#E50914] text-[10px] font-bold uppercase">
                      {selected.type === 'tv' ? 'Série' : 'Filme'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-black/60 border border-white/10 text-zinc-300 text-[10px] font-mono">
                      TMDB #{selected.tmdbId}
                    </span>
                    {selected.originalLanguage && (
                      <span className="px-2 py-0.5 rounded bg-black/60 border border-white/10 text-zinc-300 text-[10px] font-mono uppercase flex items-center gap-1">
                        <Globe className="w-3 h-3 text-zinc-400" />
                        {selected.originalLanguage}
                        {selected.originCountry && selected.originCountry.length > 0
                          ? ` (${selected.originCountry.join(', ')})`
                          : ''}
                      </span>
                    )}
                  </div>

                  <h3 className="text-lg sm:text-xl font-black text-white leading-tight">{selected.title}</h3>
                  {selected.originalTitle && selected.originalTitle !== selected.title && (
                    <p className="text-xs text-zinc-400 italic">{selected.originalTitle}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-300 tabular-nums">
                    {selected.releaseYear && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                        {selected.releaseYear}
                      </span>
                    )}
                    {typeof selected.voteAverage === 'number' && selected.voteAverage > 0 && (
                      <span className="flex items-center gap-1 text-amber-400 font-bold">
                        <Star className="w-3.5 h-3.5 fill-amber-400" />
                        {selected.voteAverage.toFixed(1)}
                      </span>
                    )}
                    {selected.type === 'tv' && selected.numberOfSeasons ? (
                      <span className="flex items-center gap-1 text-sky-300 font-mono">
                        <Layers className="w-3.5 h-3.5" />
                        {selected.numberOfSeasons} Temp. · {selected.numberOfEpisodes || 0} Ep.
                      </span>
                    ) : null}
                  </div>

                  {selected.genres && selected.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {selected.genres.map((g, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-white/[0.05] text-zinc-300 text-[10px]">
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-5 sm:p-6 space-y-5">
                {selected.overview && (
                  <p className="text-xs text-zinc-300 leading-relaxed">{selected.overview}</p>
                )}

                {/* SMART DETECTION ANALYSIS */}
                <div className="p-4 rounded-xl bg-black/50 border border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Wand2 className="w-3.5 h-3.5 text-[#E50914]" />
                      Análise de Categoria ({selected.detection?.confidence || 'medium'})
                    </span>
                    {selected.detection?.needsManualChoice && (
                      <span className="text-[10px] font-bold uppercase text-amber-300">
                        Requer confirmação manual
                      </span>
                    )}
                  </div>
                  <ul className="text-[11px] text-zinc-400 space-y-1 list-disc list-inside">
                    {(selected.detection?.reasons || []).map((r, idx) => (
                      <li key={idx}>{r}</li>
                    ))}
                  </ul>
                </div>

                {/* MANUAL CATEGORY OVERRIDE */}
                <div className="space-y-2.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 block">
                    Classificação no Catálogo RONYCINE
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    <div className="px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs font-bold text-white flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Tipo Base: {selected.type === 'tv' ? 'Séries' : 'Filmes'}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleCategory('anime')}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center gap-2 ${
                        selectedCategories.includes('anime')
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                          : 'bg-black/50 border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Incluir em Animes</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleCategory('dorama')}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center gap-2 ${
                        selectedCategories.includes('dorama')
                          ? 'bg-rose-500/20 border-rose-400 text-rose-200'
                          : 'bg-black/50 border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Heart className="w-3.5 h-3.5" />
                      <span>Incluir em Doramas</span>
                    </button>
                  </div>

                  {selected.detection?.needsManualChoice && (
                    <label className="flex items-center gap-2 text-xs text-amber-200 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmManualChoice}
                        onChange={e => setConfirmManualChoice(e.target.checked)}
                        className="rounded border-zinc-700 bg-black text-[#E50914]"
                      />
                      <span>Confirmo manualmente a classificação selecionada acima antes de guardar.</span>
                    </label>
                  )}
                </div>

                {/* DUPLICATE GUARD */}
                {selected.existsInCatalog && (
                  <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/35 space-y-2.5">
                    <div className="flex items-start gap-2.5 text-xs text-amber-200">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Este título já existe no catálogo RONYCINE.</p>
                        <p className="text-[11px] text-amber-200/80 mt-0.5">
                          Não será criado nenhum registo duplicado. Pode atualizar os metadados/categorias preservando todas as fontes e episódios.
                        </p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={forceUpdateExisting}
                        onChange={e => setForceUpdateExisting(e.target.checked)}
                        className="rounded border-zinc-700 bg-black text-[#E50914]"
                      />
                      <span>Atualizar metadados e categorias sem duplicar (preservar links existentes)</span>
                    </label>
                  </div>
                )}

                {/* MOVIE OPTIONAL LINK OR SERIES OPTIONS */}
                {selected.type === 'movie' ? (
                  <div className="p-4 rounded-xl bg-black/50 border border-white/[0.08] space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <Link2 className="w-4 h-4 text-[#E50914]" />
                      <span>Fonte de Vídeo Inicial (Opcional)</span>
                    </div>
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={e => setSourceUrl(e.target.value)}
                      placeholder="https://... (.mp4, .m3u8 ou embed autorizado)"
                      className="w-full bg-black border border-white/10 focus:border-[#E50914] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none"
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <select
                        value={sourceFormat}
                        onChange={e => setSourceFormat(e.target.value as any)}
                        className="bg-black border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white"
                      >
                        <option value="auto">Formato Auto</option>
                        <option value="m3u8">HLS (M3U8)</option>
                        <option value="mp4">MP4 Direto</option>
                        <option value="embed">Embed / iFrame</option>
                      </select>
                      <input
                        type="text"
                        value={sourceQuality}
                        onChange={e => setSourceQuality(e.target.value)}
                        placeholder="Qualidade"
                        className="bg-black border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white"
                      />
                      <input
                        type="text"
                        value={sourceAudio}
                        onChange={e => setSourceAudio(e.target.value)}
                        placeholder="Idioma"
                        className="bg-black border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white"
                      />
                      <input
                        type="text"
                        value={sourceServer}
                        onChange={e => setSourceServer(e.target.value)}
                        placeholder="Servidor"
                        className="bg-black border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-black/50 border border-white/[0.08] space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-sky-400" />
                        Sincronização Ilimitada de Temporadas e Episódios
                      </span>
                      {onOpenSeriesPro && (
                        <button
                          type="button"
                          onClick={() => onOpenSeriesPro(selected.tmdbId)}
                          className="text-[11px] font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1"
                        >
                          <span>Abrir em Séries PRO</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={importAllSeasons}
                        onChange={e => setImportAllSeasons(e.target.checked)}
                        className="rounded border-zinc-700 bg-black text-[#E50914]"
                      />
                      <span>Importar todas as temporadas oficiais e todos os episódios (sem limite artificial)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeSpecials}
                        onChange={e => setIncludeSpecials(e.target.checked)}
                        className="rounded border-zinc-700 bg-black text-[#E50914]"
                      />
                      <span>Incluir temporada de Especiais (T0) se existir no TMDB</span>
                    </label>
                  </div>
                )}

                {importError && (
                  <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-200 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{importError}</span>
                  </div>
                )}

                {importSuccess && (
                  <div className="p-4 rounded-xl bg-emerald-950/35 border border-emerald-500/35 space-y-3">
                    <div className="flex items-start gap-2.5 text-xs text-emerald-200">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">{importSuccess.message}</p>
                        <p className="text-[11px] text-emerald-200/80 mt-0.5">
                          As estatísticas da página inicial e o catálogo foram atualizados automaticamente.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {onViewCatalogItem && (
                        <button
                          type="button"
                          onClick={() =>
                            onViewCatalogItem({
                              tmdbId: importSuccess.tmdbId,
                              type: importSuccess.type,
                              title: importSuccess.title,
                              categories: importSuccess.categories
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                        >
                          Ver no Catálogo
                        </button>
                      )}
                      {importSuccess.type === 'tv' && onOpenSeriesPro && (
                        <button
                          type="button"
                          onClick={() => onOpenSeriesPro(importSuccess.tmdbId)}
                          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"
                        >
                          Gerir Episódios e Links (Séries PRO)
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* CONFIRMATION SUBMIT */}
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setImportError(null);
                      setImportSuccess(null);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold"
                  >
                    Limpar Seleção
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={isImporting}
                    className="px-6 py-2.5 rounded-xl bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-[#E50914]/25"
                  >
                    {isImporting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>A importar...</span>
                      </>
                    ) : selected.existsInCatalog ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Confirmar Atualização Sem Duplicar</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Confirmar e Guardar na Biblioteca</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
