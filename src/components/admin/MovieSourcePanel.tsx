import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Film,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Star,
  Power,
  Play,
  Trash2,
  Save,
  Server,
  ShieldCheck,
  X,
  ExternalLink
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { MediaItem, TmdbSearchResult, VideoSource } from '../../types.js';
import { MgebUrlField } from './MgebUrlField.js';
import { buildMgebUrl, stripMgebPrefix } from '../../lib/mgebUtils.js';
import { classifySourceUrl, getStatusDisplayInfo } from '../../lib/sourceClassification.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';
import { RonycinePlayer } from '../player/RonycinePlayer.js';
import { ErrorBoundary } from '../ErrorBoundary.js';

interface MovieSourcePanelProps {
  catalogMovies: MediaItem[];
  existingSources: VideoSource[];
  preselectedMovieId?: number;
  onSourceSaved: () => void;
}

export const MovieSourcePanel: React.FC<MovieSourcePanelProps> = ({
  catalogMovies,
  existingSources,
  preselectedMovieId,
  onSourceSaved
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [tmdbResults, setTmdbResults] = useState<TmdbSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedMovie, setSelectedMovie] = useState<{
    tmdbId: number;
    title: string;
    posterPath?: string;
    releaseDate?: string;
    inCatalog: boolean;
  } | null>(null);

  // Source fields
  const [sourceUrl, setSourceUrl] = useState('');
  const [useMgebPrefix, setUseMgebPrefix] = useState(true);
  const [serverName, setServerName] = useState('MGEB Endpoint');
  const [format, setFormat] = useState<string>('php_endpoint');
  const [audioLanguage, setAudioLanguage] = useState('Português');
  const [quality, setQuality] = useState('1080p');
  const [isPrimary, setIsPrimary] = useState(true);
  const [priority, setPriority] = useState(1);
  const [enabled, setEnabled] = useState(true);

  // Probe & playback test
  const [testingSource, setTestingSource] = useState(false);
  const [probeMessage, setProbeMessage] = useState<{ status: string; text: string } | null>(null);
  const [probeDiagnostics, setProbeDiagnostics] = useState<any>(null);
  const [playTestUrl, setPlayTestUrl] = useState<string | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmOverwriteDuplicate, setConfirmOverwriteDuplicate] = useState(false);

  // Sync preselected movie if provided
  useEffect(() => {
    if (preselectedMovieId && (!selectedMovie || selectedMovie.tmdbId !== preselectedMovieId)) {
      const localMatch = catalogMovies.find(m => Number(m.tmdbId) === Number(preselectedMovieId));
      if (localMatch) {
        setSelectedMovie({
          tmdbId: localMatch.tmdbId,
          title: localMatch.title,
          posterPath: localMatch.posterPath,
          releaseDate: localMatch.releaseDate,
          inCatalog: true
        });
      } else {
        api.getTmdbDetails(preselectedMovieId, 'movie')
          .then(res => {
            if (res?.item) {
              setSelectedMovie({
                tmdbId: res.item.tmdbId,
                title: res.item.title,
                posterPath: res.item.posterPath,
                releaseDate: res.item.releaseDate,
                inCatalog: Boolean(res.existsInCatalog)
              });
            }
          })
          .catch(() => {});
      }
    }
  }, [preselectedMovieId, catalogMovies]);

  // Filtered catalog movies matching search query (local quick-pick, zero auto-import)
  const matchingCatalogMovies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalogMovies.slice(0, 8);
    return catalogMovies
      .filter(
        m =>
          m.title.toLowerCase().includes(q) ||
          String(m.tmdbId).includes(q) ||
          (m.originalTitle || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [catalogMovies, searchQuery]);

  const handleSearchInput = (val: string) => {
    setSearchQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setTmdbResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await api.searchTmdb(val, 'movie');
        setTmdbResults(res.results || []);
      } catch {
        setTmdbResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  const handleSelectMovie = (movie: {
    tmdbId: number;
    title: string;
    posterPath?: string;
    releaseDate?: string;
  }) => {
    const inCatalog = catalogMovies.some(m => Number(m.tmdbId) === Number(movie.tmdbId));
    setSelectedMovie({ ...movie, inCatalog });
    setTmdbResults([]);
    setFeedback(null);
    setConfirmOverwriteDuplicate(false);
  };

  const handleUrlChange = (finalUrl: string, innerUrl: string) => {
    setSourceUrl(finalUrl);
    setProbeMessage(null);
    setFeedback(null);
    setConfirmOverwriteDuplicate(false);

    const candidate = finalUrl || innerUrl;
    if (candidate) {
      const classified = classifySourceUrl(candidate);
      if (classified.valid) {
        setFormat(classified.suggestedFormat);
        if (
          !serverName ||
          serverName === 'Servidor Principal' ||
          serverName === 'MGEB Endpoint' ||
          serverName === 'UQLOAD' ||
          serverName === 'AnonMP4'
        ) {
          setServerName(classified.suggestedServerName || 'MGEB Endpoint');
        }
      }
    }
  };

  const handleToggleMgeb = (nextUseMgeb: boolean) => {
    setUseMgebPrefix(nextUseMgeb);
    if (!nextUseMgeb && serverName === 'MGEB Endpoint') {
      setServerName('Servidor Principal');
    } else if (nextUseMgeb && serverName === 'Servidor Principal') {
      setServerName('MGEB Endpoint');
    }
  };

  // Existing sources registered for selected movie
  const movieSources = useMemo(() => {
    if (!selectedMovie) return [];
    return existingSources.filter(
      s => Number(s.contentId) === Number(selectedMovie.tmdbId) && s.contentType === 'movie'
    );
  }, [existingSources, selectedMovie]);

  const urlEvaluation = useMemo(() => {
    const { innerUrl } = stripMgebPrefix(sourceUrl);
    return buildMgebUrl(useMgebPrefix ? innerUrl : sourceUrl, useMgebPrefix);
  }, [sourceUrl, useMgebPrefix]);

  const duplicateSource = useMemo(() => {
    if (!selectedMovie || !urlEvaluation.valid) return null;
    const normalizedTarget = urlEvaluation.finalUrl.trim().toLowerCase();
    return movieSources.find(
      s => (s.originalUrl || s.url || '').trim().toLowerCase() === normalizedTarget
    ) || null;
  }, [selectedMovie, movieSources, urlEvaluation]);

  const handleTestSource = async () => {
    if (!urlEvaluation.valid) {
      setFeedback({ type: 'error', text: urlEvaluation.error || 'Informe uma URL válida antes de testar.' });
      return;
    }
    setTestingSource(true);
    setProbeMessage(null);
    try {
      const res = await api.verifySourceLink(urlEvaluation.finalUrl, format);
      setProbeDiagnostics(res.diagnostics || null);
      if (res.detectedFormat) setFormat(res.detectedFormat);
      setProbeMessage({
        status: res.status,
        text: res.message
      });
    } catch (err: any) {
      setProbeMessage({
        status: 'unverifiable',
        text: err?.message || 'Não foi possível testar a fonte automaticamente.'
      });
    } finally {
      setTestingSource(false);
    }
  };

  const handleSave = async (e: React.FormEvent, replaceExisting = false) => {
    e.preventDefault();
    if (!selectedMovie) {
      setFeedback({ type: 'error', text: 'Selecione um filme primeiro (pesquise por nome ou TMDB ID).' });
      return;
    }
    if (!urlEvaluation.valid) {
      setFeedback({ type: 'error', text: urlEvaluation.error || 'A URL da fonte é inválida.' });
      return;
    }
    if (!serverName.trim()) {
      setFeedback({ type: 'error', text: 'Informe o nome do servidor.' });
      return;
    }
    if (duplicateSource && !replaceExisting && !confirmOverwriteDuplicate) {
      setConfirmOverwriteDuplicate(true);
      setFeedback({
        type: 'error',
        text: `Esta URL já está registada no servidor "${duplicateSource.serverName}". Clique em "Substituir Fonte Existente" para atualizar.`
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await api.addVideoSource({
        contentId: selectedMovie.tmdbId,
        contentType: 'movie',
        url: urlEvaluation.finalUrl,
        originalUrl: urlEvaluation.finalUrl,
        serverName: serverName.trim(),
        format: format as any,
        audioLanguage: audioLanguage.trim() || 'Português',
        quality,
        isPrimary,
        priority: Math.max(1, Number(priority) || 1),
        enabled,
        status: (probeMessage?.status as any) || 'registered',
        verificationResult: probeMessage?.text,
        diagnostics: probeDiagnostics || undefined,
        replaceExisting: replaceExisting || confirmOverwriteDuplicate
      });

      setConfirmOverwriteDuplicate(false);
      setFeedback({
        type: 'success',
        text: `Fonte "${serverName.trim()}" guardada com sucesso para ${selectedMovie.title} (TMDB ${selectedMovie.tmdbId}).`
      });
      onSourceSaved();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Erro ao guardar a fonte do filme.'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExisting = async (id: string) => {
    try {
      await api.deleteVideoSource(id);
      onSourceSaved();
    } catch (err) {
      console.error('Erro ao eliminar fonte:', err);
    }
  };

  const posterUrl = selectedMovie ? resolveTmdbPosterUrl(selectedMovie.posterPath, 'w342') : '';

  return (
    <div className="space-y-6">
      {/* Main Header */}
      <div className="bg-[#111114] border border-white/10 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#E50914]/15 border border-[#E50914]/30 flex items-center justify-center text-[#E50914] shrink-0">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">
              ADICIONAR FONTE AO FILME
            </h3>
            <p className="text-xs text-zinc-400">
              Prefixo MGEB permanente, deteção de duplicados e teste imediato no player
            </p>
          </div>
        </div>
        <div className="text-xs font-mono text-zinc-400 bg-black/60 border border-white/10 rounded-xl px-3.5 py-2">
          Prefixo MGEB: <span className="text-[#E50914] font-bold">{useMgebPrefix ? 'ATIVO' : 'DESATIVADO'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column: Search + MGEB URL + Settings */}
        <form onSubmit={(e) => handleSave(e, false)} className="xl:col-span-7 space-y-6">
          {/* Step 1: Search Movie */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                <Search className="w-4 h-4 text-[#E50914]" />
                1. Pesquisar Filme por Nome ou TMDB ID
              </h4>
              <span className="text-[11px] text-zinc-500">Sem importação automática na pesquisa</span>
            </div>

            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="Digite o título do filme ou TMDB ID (ex: Interstellar ou 157336)..."
                className="w-full bg-[#080808] border border-white/15 rounded-xl pl-11 pr-4 py-3 text-sm text-white focus:border-[#E50914] outline-none transition-colors"
              />
              {isSearching && (
                <RefreshCw className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#E50914] animate-spin" />
              )}
            </div>

            {/* Catalog quick selection */}
            {matchingCatalogMovies.length > 0 && tmdbResults.length === 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                  Filmes no Catálogo Local
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                  {matchingCatalogMovies.map((item) => {
                    const thumb = resolveTmdbPosterUrl(item.posterPath, 'w185');
                    const isSelected = selectedMovie?.tmdbId === item.tmdbId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          handleSelectMovie({
                            tmdbId: item.tmdbId,
                            title: item.title,
                            posterPath: item.posterPath,
                            releaseDate: item.releaseDate
                          })
                        }
                        className={`text-left p-2.5 rounded-xl border transition-all flex items-center gap-3 ${
                          isSelected
                            ? 'bg-[#E50914]/15 border-[#E50914] text-white'
                            : 'bg-[#080808] border-white/10 hover:border-white/25 text-zinc-200'
                        }`}
                      >
                        <div className="w-9 h-12 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-white/10">
                          {thumb ? (
                            <img src={thumb} alt={item.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-600">
                              <Film className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate text-white">{item.title}</p>
                          <p className="text-[11px] font-mono text-zinc-400">
                            TMDB: {item.tmdbId} {item.releaseDate ? `· ${item.releaseDate.slice(0, 4)}` : ''}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Read-only TMDB remote search results */}
            {tmdbResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Resultados TMDB (Leitura Apenas)
                  </p>
                  <button
                    type="button"
                    onClick={() => setTmdbResults([])}
                    className="text-[11px] text-zinc-400 hover:text-white"
                  >
                    Fechar resultados
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1">
                  {tmdbResults.map((item) => {
                    const thumb = resolveTmdbPosterUrl(item.posterPath, 'w185');
                    const inCat = catalogMovies.some(m => Number(m.tmdbId) === Number(item.tmdbId));
                    return (
                      <button
                        key={`${item.type}-${item.tmdbId}`}
                        type="button"
                        onClick={() =>
                          handleSelectMovie({
                            tmdbId: item.tmdbId,
                            title: item.title,
                            posterPath: item.posterPath,
                            releaseDate: item.releaseDate
                          })
                        }
                        className="text-left p-2.5 rounded-xl bg-[#080808] border border-white/10 hover:border-[#E50914] transition-all flex items-center gap-3"
                      >
                        <div className="w-9 h-12 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-white/10">
                          {thumb ? (
                            <img src={thumb} alt={item.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-600">
                              <Film className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate text-white">{item.title}</p>
                          <p className="text-[11px] font-mono text-zinc-400">
                            TMDB: {item.tmdbId} · {inCat ? 'No catálogo' : 'Fora do catálogo'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Fixed MGEB Prefix + Source URL */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
            <h4 className="text-xs font-black uppercase tracking-wider text-white">
              2. Endereço da Fonte com Prefixo MGEB
            </h4>

            <MgebUrlField
              value={sourceUrl}
              useMgebPrefix={useMgebPrefix}
              onChangeUrl={handleUrlChange}
              onToggleMgebPrefix={handleToggleMgeb}
              onTestSource={handleTestSource}
              onTogglePlayTest={() => urlEvaluation.valid && setPlayTestUrl(urlEvaluation.finalUrl)}
              isTesting={testingSource}
              showPlayTest={urlEvaluation.valid}
              label="URL Original do Filme"
            />

            {duplicateSource && (
              <div className="p-3.5 rounded-xl bg-amber-950/35 border border-amber-500/40 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Fonte duplicada detetada: esta URL já existe em <strong>{duplicateSource.serverName}</strong>.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleSave(e as any, true)}
                  disabled={saving}
                  className="px-3 py-1.5 bg-amber-500 text-black font-black text-[11px] uppercase rounded-lg whitespace-nowrap hover:bg-amber-400 transition-colors"
                >
                  Substituir Fonte Existente
                </button>
              </div>
            )}

            {probeMessage && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  probeMessage.status === 'online'
                    ? 'bg-emerald-950/35 border-emerald-500/35 text-emerald-300'
                    : probeMessage.status === 'offline' || probeMessage.status === 'embed_blocked'
                    ? 'bg-red-950/35 border-red-500/35 text-red-300'
                    : 'bg-amber-950/35 border-amber-500/35 text-amber-300'
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold uppercase text-[11px] mb-0.5">
                    Resultado do Teste: {getStatusDisplayInfo(probeMessage.status).label}
                  </p>
                  <p>{probeMessage.text}</p>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Server Details & Save */}
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
            <h4 className="text-xs font-black uppercase tracking-wider text-white">
              3. Configuração do Servidor e Prioridade
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Nome do Servidor
                </label>
                <input
                  type="text"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  className="w-full bg-[#080808] border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white focus:border-[#E50914] outline-none"
                  placeholder="Ex: MGEB Endpoint, Servidor Principal"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Formato da Fonte
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full bg-[#080808] border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white focus:border-[#E50914] outline-none"
                >
                  <option value="php_endpoint">Endpoint PHP (MGEB)</option>
                  <option value="mp4">MP4 Direto</option>
                  <option value="m3u8">M3U8 / HLS</option>
                  <option value="dash">DASH (.mpd)</option>
                  <option value="webm">WebM Direto</option>
                  <option value="embed">Embed / Iframe</option>
                  <option value="iframe">Iframe Player</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Idioma do Áudio
                </label>
                <input
                  type="text"
                  value={audioLanguage}
                  onChange={(e) => setAudioLanguage(e.target.value)}
                  className="w-full bg-[#080808] border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white focus:border-[#E50914] outline-none"
                  placeholder="Ex: Português, Legendado"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Qualidade
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full bg-[#080808] border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white focus:border-[#E50914] outline-none"
                >
                  <option value="Automática">Automática</option>
                  <option value="4K">4K Ultra HD</option>
                  <option value="1080p">1080p Full HD</option>
                  <option value="720p">720p HD</option>
                  <option value="480p">480p SD</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[#080808] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                  className="w-4 h-4 accent-[#E50914]"
                />
                <Star className={`w-4 h-4 ${isPrimary ? 'text-amber-400 fill-amber-400' : 'text-zinc-500'}`} />
                <span className="text-xs font-bold text-white">Fonte Principal</span>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[#080808] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
                <Power className={`w-4 h-4 ${enabled ? 'text-emerald-400' : 'text-zinc-500'}`} />
                <span className="text-xs font-bold text-white">Fonte Ativa</span>
              </label>

              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#080808] border border-white/10">
                <span className="text-xs font-bold text-zinc-400">Prioridade</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={priority}
                  onChange={(e) => setPriority(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-16 bg-[#111114] border border-white/15 rounded-lg px-2 py-1 text-xs font-mono text-center text-white focus:border-[#E50914] outline-none"
                />
              </div>
            </div>

            {feedback && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                  feedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-[#E50914]/10 border-[#E50914]/35 text-red-300'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-white/10">
              {urlEvaluation.valid && (
                <button
                  type="button"
                  onClick={() => setPlayTestUrl(urlEvaluation.finalUrl)}
                  className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 text-[#E50914]" />
                  Testar Player
                </button>
              )}

              <button
                type="submit"
                disabled={saving || !selectedMovie || !urlEvaluation.valid}
                className="px-6 py-2.5 bg-[#E50914] hover:bg-[#c80812] disabled:opacity-45 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-[#E50914]/20 whitespace-nowrap transition-all"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar Fonte do Filme
              </button>
            </div>
          </div>
        </form>

        {/* Right Column: Selected Movie Card + Existing Sources */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
            <h4 className="text-xs font-black uppercase tracking-wider text-white">
              Filme Selecionado & Fontes Existentes
            </h4>

            {selectedMovie ? (
              <div className="space-y-5">
                <div className="flex items-start gap-4 p-4 rounded-xl bg-[#080808] border border-white/10">
                  <div className="w-16 h-24 rounded-lg bg-zinc-900 overflow-hidden shrink-0 border border-white/10">
                    {posterUrl ? (
                      <img src={posterUrl} alt={selectedMovie.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600">
                        <Film className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <h5 className="text-base font-black text-white leading-tight">{selectedMovie.title}</h5>
                    <p className="text-xs font-mono text-zinc-400">
                      TMDB ID: {selectedMovie.tmdbId}
                      {selectedMovie.releaseDate ? ` · ${selectedMovie.releaseDate.slice(0, 4)}` : ''}
                    </p>
                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase border ${
                          selectedMovie.inCatalog
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                            : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        }`}
                      >
                        {selectedMovie.inCatalog ? 'No Catálogo' : 'Fora do Catálogo (Leitura TMDB)'}
                      </span>
                      <a
                        href={`/#/watch/movie/${selectedMovie.tmdbId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-bold text-[#E50914] hover:underline inline-flex items-center gap-1"
                      >
                        Abrir Watch <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>

                {!selectedMovie.inCatalog && (
                  <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs leading-relaxed">
                    Este filme foi consultado em modo leitura no TMDB e ainda não foi importado manualmente para o catálogo público.
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      Fontes Registadas ({movieSources.length})
                    </span>
                  </div>

                  {movieSources.length === 0 ? (
                    <div className="p-6 text-center rounded-xl bg-[#080808] border border-dashed border-white/10 text-xs text-zinc-500">
                      Nenhuma fonte registada para este filme ainda.
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                      {movieSources.map((src) => {
                        const displayUrl = src.originalUrl || src.url;
                        const statusInfo = getStatusDisplayInfo(src.status);
                        return (
                          <div
                            key={src.id}
                            className="p-3.5 rounded-xl bg-[#080808] border border-white/10 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <Server className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                <span className="text-xs font-bold text-white truncate">{src.serverName}</span>
                                {src.isPrimary && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-black uppercase">
                                    Principal
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setPlayTestUrl(displayUrl)}
                                  className="p-1.5 rounded-lg bg-[#E50914]/15 text-[#E50914] hover:bg-[#E50914] hover:text-white transition-colors"
                                  title="Testar no Player"
                                >
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteExisting(src.id)}
                                  className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
                                  title="Remover Fonte"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] font-mono text-zinc-400 break-all">{displayUrl}</p>
                            <div className="flex items-center justify-between text-[10px] text-zinc-500">
                              <span>
                                {src.format} · {src.quality} · {src.audioLanguage}
                              </span>
                              <span className="font-bold text-zinc-300">{statusInfo.label}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-12 px-4 text-center rounded-xl bg-[#080808] border border-dashed border-white/10 space-y-2">
                <Film className="w-8 h-8 text-zinc-700 mx-auto" />
                <p className="text-xs font-bold text-zinc-400">Nenhum filme selecionado</p>
                <p className="text-[11px] text-zinc-600">
                  Pesquise à esquerda pelo nome ou TMDB ID para configurar a fonte com prefixo MGEB.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Play Test Modal */}
      {playTestUrl && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-4xl bg-[#0c0c0c] border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-black text-white uppercase truncate">
                  Teste de Reprodução — {selectedMovie?.title || serverName}
                </h4>
                <p className="text-[11px] font-mono text-zinc-400 truncate">{playTestUrl}</p>
              </div>
              <button
                type="button"
                onClick={() => setPlayTestUrl(null)}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="aspect-video bg-black">
              <ErrorBoundary fallbackTitle="Erro no teste de reprodução" resetKey={playTestUrl}>
                <RonycinePlayer
                  sources={[
                    {
                      id: `preview-${Date.now()}`,
                      url: playTestUrl,
                      originalUrl: playTestUrl,
                      format: format as any,
                      serverName,
                      audioLanguage,
                      quality,
                      isPrimary: true
                    }
                  ]}
                  title={selectedMovie?.title || serverName}
                  autoplay={true}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
