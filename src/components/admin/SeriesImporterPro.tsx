import React, { useState } from 'react';
import {
  Search,
  Tv,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Check,
  ChevronRight,
  ChevronLeft,
  Globe,
  PlusCircle,
  Play
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { TmdbSearchResult } from '../../types.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';

interface SeriesImporterProProps {
  onCatalogUpdated?: () => void;
  onViewCatalogItem?: (item: { id?: string; tmdbId: number; type: 'movie' | 'tv'; title: string }) => void;
}

const MGEB_PREFIX = 'https://mgeb.space/mp4.php?url=';

export const SeriesImporterPro: React.FC<SeriesImporterProProps> = ({
  onCatalogUpdated,
  onViewCatalogItem
}) => {
  // --- Wizard Step State (1: Search, 2: Seasons, 3: Episodes & Links, 4: Summary & Confirm)
  const [step, setStep] = useState<number>(1);

  // --- Search & Input State ---
  const [nameQuery, setNameQuery] = useState('');
  const [idQuery, setIdQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<TmdbSearchResult | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // --- Base Source URL & MGEB Generator State ---
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [seasonBaseUrls, setSeasonBaseUrls] = useState<Record<number, string>>({});

  // --- Seasons State ---
  const [seasonsList, setSeasonsList] = useState<any[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set<number>());

  // --- Episodes State ---
  const [seasonEpisodesMap, setSeasonEpisodesMap] = useState<Record<number, any[]>>({});
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set<string>());
  const [episodeCustomUrls, setEpisodeCustomUrls] = useState<Record<string, string>>({});

  // --- Import Execution State ---
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; msg: string } | null>(null);

  const showFeedback = (type: 'success' | 'error' | 'warning', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  // --- STEP 1: SEARCH SERIES ---
  const handleSearchByName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameQuery.trim()) return;
    setIsSearching(true);
    setFeedback(null);
    try {
      const res = await api.searchTmdb(nameQuery.trim(), 'tv');
      setSearchResults(res.results || []);
      if ((res.results || []).length === 0) {
        showFeedback('warning', 'Nenhuma série encontrada com este nome.');
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao pesquisar séries no TMDB.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchById = async (e: React.FormEvent) => {
    e.preventDefault();
    const tmdbIdNum = parseInt(idQuery.trim(), 10);
    if (isNaN(tmdbIdNum) || tmdbIdNum <= 0) {
      showFeedback('warning', 'Insira um TMDB ID numérico válido.');
      return;
    }
    setIsSearching(true);
    setFeedback(null);
    try {
      const details = await api.getTmdbDetails(tmdbIdNum, 'tv');
      if (details && details.item) {
        const item: TmdbSearchResult = {
          tmdbId: details.item.tmdbId,
          title: details.item.title,
          overview: details.item.overview,
          posterPath: details.item.posterPath,
          backdropPath: details.item.backdropPath,
          releaseDate: details.item.firstAirDate,
          type: 'tv'
        };
        setSelectedSeries(item);
        setSeriesDetails(details.item);
        setSeasonsList(details.item.seasons || []);
        const allSeasonNums = new Set<number>((details.item.seasons || []).map((s: any) => Number(s.seasonNumber)));
        setSelectedSeasons(allSeasonNums);
        setStep(2);
      } else {
        showFeedback('error', 'Série não encontrada para o ID TMDB informado.');
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao carregar detalhes do TMDB.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = async (item: TmdbSearchResult) => {
    setSelectedSeries(item);
    setIsSearching(true);
    try {
      const details = await api.getTmdbDetails(item.tmdbId, 'tv');
      if (details && details.item) {
        setSeriesDetails(details.item);
        setSeasonsList(details.item.seasons || []);
        const allSeasonNums = new Set<number>((details.item.seasons || []).map((s: any) => Number(s.seasonNumber)));
        setSelectedSeasons(allSeasonNums);
        setStep(2);
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao carregar detalhes da série.');
    } finally {
      setIsSearching(false);
    }
  };

  // --- STEP 2: LOAD SEASONS & EPISODES ---
  const toggleSeasonSelection = (seasonNumber: number) => {
    const next = new Set<number>(selectedSeasons);
    if (next.has(seasonNumber)) {
      next.delete(seasonNumber);
    } else {
      next.add(seasonNumber);
    }
    setSelectedSeasons(next);
  };

  const selectAllSeasons = () => {
    const all = new Set<number>(seasonsList.map(s => Number(s.seasonNumber)));
    setSelectedSeasons(all);
  };

  const deselectAllSeasons = () => {
    setSelectedSeasons(new Set<number>());
  };

  const handleProceedToEpisodes = async () => {
    if (selectedSeasons.size === 0) {
      showFeedback('warning', 'Selecione pelo menos uma temporada.');
      return;
    }
    setLoadingDetails(true);
    try {
      const newMap: Record<number, any[]> = {};
      const newSelectedEp = new Set<string>();

      const seasonNumsArray = Array.from(selectedSeasons) as number[];
      for (const sNum of seasonNumsArray) {
        if (!seasonEpisodesMap[sNum]) {
          const epData = await api.getTmdbSeasonEpisodes(selectedSeries!.tmdbId, sNum);
          newMap[sNum] = epData.episodes || [];
        } else {
          newMap[sNum] = seasonEpisodesMap[sNum];
        }
        const eps = newMap[sNum] || [];
        for (const ep of eps) {
          newSelectedEp.add(`${sNum}_${ep.episodeNumber}`);
        }
      }

      setSeasonEpisodesMap(prev => ({ ...prev, ...newMap }));
      setSelectedEpisodes(newSelectedEp);
      setStep(3);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao carregar episódios das temporadas.');
    } finally {
      setLoadingDetails(false);
    }
  };

  // --- STEP 3: EPISODES & URL GENERATOR ---
  const toggleEpisodeSelection = (seasonNum: number, epNum: number) => {
    const key = `${seasonNum}_${epNum}`;
    const next = new Set<string>(selectedEpisodes);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelectedEpisodes(next);
  };

  const selectAllEpisodesInSeason = (seasonNum: number) => {
    const eps = seasonEpisodesMap[seasonNum] || [];
    const next = new Set<string>(selectedEpisodes);
    for (const ep of eps) {
      next.add(`${seasonNum}_${ep.episodeNumber}`);
    }
    setSelectedEpisodes(next);
  };

  const deselectAllEpisodesInSeason = (seasonNum: number) => {
    const eps = seasonEpisodesMap[seasonNum] || [];
    const next = new Set<string>(selectedEpisodes);
    for (const ep of eps) {
      next.delete(`${seasonNum}_${ep.episodeNumber}`);
    }
    setSelectedEpisodes(next);
  };

  const applyMgebGeneratorForSeason = (seasonNum: number) => {
    const base = seasonBaseUrls[seasonNum] || baseUrlInput;
    if (!base || typeof base !== 'string' || !base.trim()) {
      showFeedback('warning', 'Insira uma URL base válida para esta temporada.');
      return;
    }

    const cleanBase = base.trim();
    const eps = seasonEpisodesMap[seasonNum] || [];
    const nextUrls = { ...episodeCustomUrls };

    for (const ep of eps) {
      const key = `${seasonNum}_${ep.episodeNumber}`;
      let generated = cleanBase;
      if (/\/\d+$/.test(cleanBase)) {
        generated = cleanBase.replace(/\/\d+$/, `/${ep.episodeNumber}`);
      } else {
        generated = `${cleanBase.replace(/\/+$/, '')}/${ep.episodeNumber}`;
      }
      nextUrls[key] = generated;
    }

    setEpisodeCustomUrls(nextUrls);
    showFeedback('success', `Links gerados automaticamente para a Temporada ${seasonNum}!`);
  };

  // --- STEP 4: CONFIRM IMPORT ---
  const handleConfirmImport = async () => {
    if (!selectedSeries) return;
    setIsImporting(true);
    setImportProgress({ current: 0, total: selectedSeasons.size, message: 'A preparar importação da série...' });

    try {
      await api.importTmdbMedia(selectedSeries.tmdbId, 'tv', true);
      
      let savedSourcesCount = 0;
      const sortedSeasons = (Array.from(selectedSeasons) as number[]).sort((a, b) => a - b);
      
      for (let i = 0; i < sortedSeasons.length; i++) {
        const sNum = sortedSeasons[i];
        setImportProgress({
          current: i + 1,
          total: sortedSeasons.length,
          message: `A importar Temporada ${sNum} e associar fontes...`
        });

        const eps = seasonEpisodesMap[sNum] || [];
        for (const ep of eps) {
          const key = `${sNum}_${ep.episodeNumber}`;
          if (!selectedEpisodes.has(key)) continue;

          const customUrl = episodeCustomUrls[key];
          if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
            await api.addVideoSource({
              contentId: selectedSeries.tmdbId,
              contentType: 'tv',
              seasonNumber: sNum,
              episodeNumber: ep.episodeNumber,
              url: customUrl.trim(),
              originalUrl: customUrl.trim(),
              serverName: 'Servidor Principal MGEB',
              format: 'mp4',
              priority: 1,
              enabled: true,
              status: 'active'
            });
            savedSourcesCount++;
          }
        }
      }

      setImportResult({
        success: true,
        title: selectedSeries.title,
        tmdbId: selectedSeries.tmdbId,
        seasonsImported: selectedSeasons.size,
        episodesImported: selectedEpisodes.size,
        sourcesAdded: savedSourcesCount
      });
      setStep(4);
      if (onCatalogUpdated) onCatalogUpdated();
      showFeedback('success', 'Série importada com sucesso para o catálogo!');
    } catch (err: any) {
      showFeedback('error', err?.message || 'Erro ao confirmar importação da série.');
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="space-y-6 text-white max-w-7xl mx-auto pb-16">
      {/* HEADER & WIZARD STEPPER */}
      <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight font-display">RONYCINE SERIES IMPORTER PRO</h2>
              <p className="text-xs text-zinc-400">Importação profissional de séries, temporadas, episódios e gerador de fontes MGEB.</p>
            </div>
          </div>
        </div>

        {/* Stepper Indicator */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
          {[
            { num: 1, label: 'Pesquisar' },
            { num: 2, label: 'Temporadas' },
            { num: 3, label: 'Episódios & Links' },
            { num: 4, label: 'Resumo & Importar' }
          ].map(st => (
            <div
              key={st.num}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                step === st.num
                  ? 'bg-brand text-white shadow-lg shadow-brand/20'
                  : step > st.num
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                  : 'bg-white/5 border border-white/10 text-zinc-500'
              }`}
            >
              <span>{st.num}.</span>
              <span>{st.label}</span>
            </div>
          ))}
        </div>
      </div>

      {feedback && (
        <div className={`p-4 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center gap-3 ${
          feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
          feedback.type === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
          'bg-brand/10 border border-brand/20 text-brand'
        }`}>
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* --- STEP 1: SEARCH SERIES --- */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <Search className="w-4 h-4 text-brand" />
                <span>Campo A — Pesquisar pelo Nome</span>
              </h3>
              <form onSubmit={handleSearchByName} className="space-y-4">
                <input
                  type="text"
                  value={nameQuery}
                  onChange={e => setNameQuery(e.target.value)}
                  placeholder="Ex: Game of Thrones, Breaking Bad..."
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-brand outline-none transition-all"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="w-full py-3 bg-brand hover:bg-brand/90 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-brand/20 flex items-center justify-center gap-2"
                >
                  {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span>Pesquisar no TMDB</span>
                </button>
              </form>
            </div>

            <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <Tv className="w-4 h-4 text-brand" />
                <span>Campo B — Pesquisar pelo TMDB ID</span>
              </h3>
              <form onSubmit={handleSearchById} className="space-y-4">
                <input
                  type="number"
                  value={idQuery}
                  onChange={e => setIdQuery(e.target.value)}
                  placeholder="Ex: 1399 (Game of Thrones)..."
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-mono tracking-widest"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
                  <span>Carregar por ID TMDB</span>
                </button>
              </form>
            </div>
          </div>

          {searchResults.length > 0 && (
            <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Resultados da Pesquisa</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {searchResults.map(item => (
                  <div
                    key={item.tmdbId}
                    onClick={() => handleSelectSearchResult(item)}
                    className="bg-black/40 border border-white/5 hover:border-brand/50 rounded-xl overflow-hidden cursor-pointer transition-all group flex flex-col"
                  >
                    <div className="aspect-[2/3] bg-zinc-900 relative overflow-hidden">
                      <img
                        src={resolveTmdbPosterUrl(item.posterPath)}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                        <span className="w-full py-2 bg-brand text-white text-[10px] font-black uppercase tracking-widest rounded-lg text-center shadow-lg">
                          Selecionar Série
                        </span>
                      </div>
                    </div>
                    <div className="p-3 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-black text-white line-clamp-1">{item.title}</h4>
                        <p className="text-[10px] text-zinc-400 mt-0.5">{item.releaseDate ? item.releaseDate.substring(0, 4) : 'N/D'}</p>
                      </div>
                      <span className="text-[9px] font-mono text-zinc-500 mt-2">TMDB: {item.tmdbId}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- STEP 2: SELECT SEASONS & BASE URL --- */}
      {step === 2 && selectedSeries && (
        <div className="space-y-6">
          <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl flex flex-col md:flex-row gap-6 items-start">
            <div className="w-32 aspect-[2/3] bg-zinc-900 rounded-xl overflow-hidden shrink-0 border border-white/10">
              <img
                src={resolveTmdbPosterUrl(selectedSeries.posterPath)}
                alt={selectedSeries.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 bg-brand/10 border border-brand/20 text-brand text-[10px] font-black uppercase tracking-widest rounded-lg">
                  Série TMDB #{selectedSeries.tmdbId}
                </span>
                <span className="text-xs text-zinc-400 font-mono">{seasonsList.length} Temporadas disponíveis</span>
              </div>
              <h2 className="text-2xl font-black font-display text-white">{selectedSeries.title}</h2>
              <p className="text-xs text-zinc-300 leading-relaxed max-w-3xl">{selectedSeries.overview || 'Sem sinopse disponível.'}</p>
            </div>
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider"
            >
              Trocar Série
            </button>
          </div>

          <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-brand" />
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">URL da Série / Fonte Base (Prefixo MGEB)</h3>
            </div>
            <p className="text-xs text-zinc-400">Insira a URL base para gerar automaticamente os links dos episódios com o prefixo <code className="text-brand font-mono">{MGEB_PREFIX}</code>.</p>
            <div className="flex gap-3">
              <input
                type="text"
                value={baseUrlInput}
                onChange={e => setBaseUrlInput(e.target.value)}
                placeholder="Ex: https://ver.123pelicula.com/pt/detail/drama/lanterns/1"
                className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-brand outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  if (baseUrlInput.trim()) {
                    const map: Record<number, string> = {};
                    for (const s of seasonsList) {
                      map[Number(s.seasonNumber)] = baseUrlInput.trim();
                    }
                    setSeasonBaseUrls(map);
                    showFeedback('success', 'URL base aplicada a todas as temporadas.');
                  }
                }}
                className="px-5 py-3 bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shrink-0"
              >
                Aplicar a Todas
              </button>
            </div>
          </div>

          <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Temporadas Disponíveis ({seasonsList.length})</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllSeasons}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                >
                  Selecionar Todas
                </button>
                <button
                  type="button"
                  onClick={deselectAllSeasons}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                >
                  Desmarcar Todas
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {seasonsList.map(season => {
                const sNum = Number(season.seasonNumber);
                const isSelected = selectedSeasons.has(sNum);
                return (
                  <div
                    key={season.id || sNum}
                    onClick={() => toggleSeasonSelection(sNum)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-brand/10 border-brand/50 text-white shadow-lg shadow-brand/10'
                        : 'bg-black/40 border-white/5 text-zinc-400 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-lg flex items-center justify-center border ${
                        isSelected ? 'bg-brand border-brand text-white' : 'border-white/20 bg-black'
                      }`}>
                        {isSelected && <Check className="w-3 h-3" />}
                      </div>
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-tight text-white">{season.name || `Temporada ${sNum}`}</h4>
                        <p className="text-[10px] text-zinc-400 mt-0.5">{season.episode_count || 0} episódios</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleProceedToEpisodes}
              disabled={loadingDetails || selectedSeasons.size === 0}
              className="px-8 py-3.5 bg-brand hover:bg-brand/90 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl transition-all shadow-xl shadow-brand/20 flex items-center gap-2 disabled:opacity-50"
            >
              {loadingDetails ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              <span>Avançar para Episódios & Fontes</span>
            </button>
          </div>
        </div>
      )}

      {/* --- STEP 3: SELECT EPISODES & GENERATE MGEB LINKS --- */}
      {step === 3 && selectedSeries && (
        <div className="space-y-6">
          <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-brand block">Configuração de Episódios</span>
              <h2 className="text-xl font-black font-display text-white mt-0.5">{selectedSeries.title}</h2>
            </div>
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar às Temporadas</span>
            </button>
          </div>

          {(Array.from(selectedSeasons) as number[]).sort((a, b) => a - b).map(sNum => {
            const episodes = seasonEpisodesMap[sNum] || [];
            const seasonBase = seasonBaseUrls[sNum] || baseUrlInput;

            return (
              <div key={sNum} className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/5">
                  <div>
                    <h3 className="text-base font-black uppercase tracking-tight font-display text-white">Temporada {sNum}</h3>
                    <p className="text-xs text-zinc-400">{episodes.length} episódios detetados no TMDB.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={seasonBase}
                      onChange={e => setSeasonBaseUrls({ ...seasonBaseUrls, [sNum]: e.target.value })}
                      placeholder={`URL base Temp ${sNum} (ex: .../season-${sNum}/1)`}
                      className="bg-black border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-brand outline-none w-64 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => applyMgebGeneratorForSeason(sNum)}
                      className="px-4 py-2 bg-brand hover:bg-brand/90 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all"
                    >
                      Gerar Links MGEB
                    </button>
                    <button
                      type="button"
                      onClick={() => selectAllEpisodesInSeason(sNum)}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-bold uppercase"
                    >
                      Sel. Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => deselectAllEpisodesInSeason(sNum)}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-bold uppercase text-zinc-400"
                    >
                      Limpar
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                  {episodes.map(ep => {
                    const key = `${sNum}_${ep.episodeNumber}`;
                    const isEpSelected = selectedEpisodes.has(key);
                    const epUrl = episodeCustomUrls[key] || '';

                    return (
                      <div
                        key={ep.id || ep.episodeNumber}
                        className={`p-3 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 transition-all ${
                          isEpSelected ? 'bg-black/60 border-brand/30' : 'bg-black/20 border-white/5 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => toggleEpisodeSelection(sNum, ep.episodeNumber)}
                            className={`w-5 h-5 rounded-lg flex items-center justify-center border shrink-0 ${
                              isEpSelected ? 'bg-brand border-brand text-white' : 'border-white/20 bg-black'
                            }`}
                          >
                            {isEpSelected && <Check className="w-3 h-3" />}
                          </button>
                          <div>
                            <span className="text-xs font-black text-white font-mono">E{ep.episodeNumber}</span>
                            <span className="text-xs font-bold text-zinc-300 ml-2">{ep.name || `Episódio ${ep.episodeNumber}`}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-1 max-w-xl">
                          <span className="text-[10px] font-bold text-zinc-500 font-mono shrink-0">URL Fonte:</span>
                          <input
                            type="text"
                            value={epUrl}
                            onChange={e => setEpisodeCustomUrls({ ...episodeCustomUrls, [key]: e.target.value })}
                            placeholder={`${MGEB_PREFIX}https://.../${ep.episodeNumber}`}
                            className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:border-brand outline-none font-mono"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              disabled={selectedEpisodes.size === 0}
              className="px-8 py-3.5 bg-brand hover:bg-brand/90 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl transition-all shadow-xl shadow-brand/20 flex items-center gap-2 disabled:opacity-50"
            >
              <span>Ver Resumo da Importação</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* --- STEP 4: SUMMARY & CONFIRM IMPORT --- */}
      {step === 4 && selectedSeries && (
        <div className="space-y-6">
          <div className="bg-[#0D0F15] border border-white/10 p-6 rounded-2xl space-y-6">
            <div className="border-b border-white/5 pb-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-brand block">Confirmação Manual</span>
              <h2 className="text-2xl font-black font-display text-white mt-1">Resumo da Importação da Série</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Revise os dados abaixo antes de confirmar a gravação definitiva no catálogo RONYCINE API.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Série Selecionada</span>
                <p className="text-lg font-black font-display text-white mt-1 truncate">{selectedSeries.title}</p>
                <span className="text-xs font-mono text-zinc-400">TMDB ID: {selectedSeries.tmdbId}</span>
              </div>
              <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Temporadas Selecionadas</span>
                <p className="text-2xl font-black font-display text-brand mt-1">{selectedSeasons.size}</p>
              </div>
              <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Episódios Selecionados</span>
                <p className="text-2xl font-black font-display text-emerald-400 mt-1">{selectedEpisodes.size}</p>
              </div>
              <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Fontes MGEB Atribuídas</span>
                <p className="text-2xl font-black font-display text-blue-400 mt-1">{Object.values(episodeCustomUrls).filter(u => u && typeof u === 'string' && u.trim()).length}</p>
              </div>
            </div>

            {importResult ? (
              <div className="bg-emerald-500/10 border border-emerald-500/30 p-6 rounded-2xl text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black uppercase tracking-tight text-emerald-400 font-display">Série Importada com Sucesso!</h3>
                <p className="text-xs text-zinc-300">A série <strong className="text-white">{importResult.title}</strong> foi guardada no catálogo com {importResult.seasonsImported} temporadas e {importResult.episodesImported} episódios.</p>
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setImportResult(null);
                    setSelectedSeries(null);
                  }}
                  className="px-6 py-3 bg-brand text-white text-xs font-bold uppercase tracking-wider rounded-xl"
                >
                  Importar Outra Série
                </button>
              </div>
            ) : (
              <div className="space-y-4 pt-4">
                {isImporting && importProgress && (
                  <div className="bg-black/60 border border-white/10 p-5 rounded-xl space-y-3">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                      <span className="text-brand">{importProgress.message}</span>
                      <span className="text-zinc-400">Progresso: {importProgress.current} / {importProgress.total}</span>
                    </div>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand transition-all duration-300"
                        style={{ width: `${(importProgress.current / Math.max(1, importProgress.total)) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    disabled={isImporting}
                    className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={isImporting}
                    className="px-10 py-4 bg-brand hover:bg-brand/90 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl transition-all shadow-xl shadow-brand/30 flex items-center gap-3 disabled:opacity-50 active:scale-95"
                  >
                    {isImporting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                    <span>CONFIRMAR IMPORTAÇÃO</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
