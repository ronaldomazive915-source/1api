import React, { useMemo, useState } from 'react';
import {
  Search,
  Film,
  Plus,
  Trash2,
  Play,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Link2,
  Sparkles,
  ExternalLink,
  Eraser,
  ShieldCheck
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  MGEB_PREFIX,
  buildMgebUrl,
  stripMgebPrefix,
  isImageOrTrailerUrl
} from '../../lib/mgebUtils.js';
import { resolveTmdbPosterUrl } from '../../lib/mediaUtils.js';
import { SOURCE_QUALITY_OPTIONS } from '../../lib/sourceMetadata.js';
import { TmdbSearchResult } from '../../types.js';

export interface MovieSourceRow {
  id: string;
  originalUrl: string;
  version: 'dublado' | 'legendado';
  quality: string;
  serverName: string;
  useMgeb: boolean;
  testStatus: 'untested' | 'testing' | 'compatible' | 'blocked_403' | 'incompatible' | 'invalid';
  testNote?: string;
}

export interface StagedMovieItem {
  id: string;
  tmdbId: number;
  title: string;
  originalTitle?: string;
  posterPath?: string;
  releaseYear?: number;
  overview?: string;
  existsInCatalog: boolean;
  categories: Array<'anime' | 'dorama'>;
  approved: boolean;
  sources: MovieSourceRow[];
  commitStatus?: 'idle' | 'importing' | 'imported' | 'updated' | 'skipped' | 'error';
  commitMessage?: string;
}

interface SmartMovieImporterProps {
  onOpenPlayer: (opts: { title: string; src: string; version: 'dublado' | 'legendado' }) => void;
  onCatalogUpdated?: () => void;
  onViewCatalogItem?: (item: {
    id?: string;
    tmdbId: number;
    type: 'movie' | 'tv';
    title: string;
    categories?: string[];
  }) => void;
}

function makeUid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createSourceRow(index: number, url = '', version: 'dublado' | 'legendado' = 'dublado'): MovieSourceRow {
  const { innerUrl } = stripMgebPrefix(url);
  return {
    id: makeUid('msrc'),
    originalUrl: innerUrl || url.trim(),
    version,
    quality: '1080p',
    serverName: version === 'legendado' ? `Servidor Legendado #${index}` : `Servidor Dublado #${index}`,
    useMgeb: true,
    testStatus: 'untested'
  };
}

export const SmartMovieImporter: React.FC<SmartMovieImporterProps> = ({
  onOpenPlayer,
  onCatalogUpdated,
  onViewCatalogItem
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchingTmdb, setSearchingTmdb] = useState(false);
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [bulkLinksText, setBulkLinksText] = useState('');
  const [analyzingBulk, setAnalyzingBulk] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [unmatchedLinks, setUnmatchedLinks] = useState<Array<{ url: string; reason: string }>>([]);

  const [movieQueue, setMovieQueue] = useState<StagedMovieItem[]>([]);
  const [duplicateMode, setDuplicateMode] = useState<'merge_missing' | 'update_metadata' | 'skip'>('merge_missing');
  const [importingAll, setImportingAll] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [assignTargetId, setAssignTargetId] = useState<string | null>(null);

  const stats = useMemo(() => {
    let totalMovies = movieQueue.length;
    let selectedMovies = 0;
    let totalSources = 0;
    let mgebApplied = 0;
    let compatible = 0;
    let invalid = 0;
    let imported = 0;

    movieQueue.forEach(m => {
      if (m.approved) selectedMovies++;
      if (m.commitStatus === 'imported' || m.commitStatus === 'updated') imported++;
      m.sources.forEach(s => {
        if (!s.originalUrl.trim()) return;
        totalSources++;
        const built = buildMgebUrl(s.originalUrl, s.useMgeb);
        if (!built.valid || isImageOrTrailerUrl(s.originalUrl)) {
          invalid++;
        } else if (s.useMgeb) {
          mgebApplied++;
        }
        if (s.testStatus === 'compatible') compatible++;
      });
    });

    return { totalMovies, selectedMovies, totalSources, mgebApplied, compatible, invalid, imported };
  }, [movieQueue]);

  const handleCopy = (id: string, text: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 1800);
  };

  const handleSearchTmdb = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchError('Digite o título ou o TMDB ID do filme.');
      return;
    }
    setSearchingTmdb(true);
    setSearchError(null);
    try {
      const res = await api.searchTmdb(q, 'movie');
      const items = res.results || [];
      setSearchResults(items);
      if (items.length === 0) {
        setSearchError(`Nenhum filme encontrado na TMDB para "${q}".`);
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Falha ao consultar TMDB.');
    } finally {
      setSearchingTmdb(false);
    }
  };

  const addTmdbMovieToQueue = (cand: TmdbSearchResult, initialUrl = '') => {
    const yearStr = cand.releaseDate ? String(cand.releaseDate).slice(0, 4) : undefined;
    const yearNum = yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : undefined;

    setMovieQueue(prev => {
      const existing = prev.find(m => m.tmdbId === cand.tmdbId);
      if (existing) {
        if (!initialUrl.trim()) return prev;
        return prev.map(m =>
          m.tmdbId === cand.tmdbId
            ? {
                ...m,
                sources: [...m.sources, createSourceRow(m.sources.length + 1, initialUrl, 'dublado')]
              }
            : m
        );
      }

      const next: StagedMovieItem = {
        id: makeUid(`mv-${cand.tmdbId}`),
        tmdbId: cand.tmdbId,
        title: cand.title,
        posterPath: cand.posterPath,
        releaseYear: yearNum,
        overview: cand.overview,
        existsInCatalog: Boolean(cand.existsInCatalog),
        categories: [],
        approved: true,
        sources: [createSourceRow(1, initialUrl, 'dublado')],
        commitStatus: 'idle'
      };
      return [next, ...prev];
    });
  };

  const handleAnalyzeBulkMovieLinks = async () => {
    const lines = bulkLinksText
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setBulkNotice('Cole pelo menos 1 link de filme (1 por linha).');
      return;
    }

    setAnalyzingBulk(true);
    setBulkNotice(null);
    setUnmatchedLinks([]);

    try {
      const res = await api.analyzeSmartLinks({
        urls: lines,
        preferredType: 'movie'
      });

      const foundUnmatched: Array<{ url: string; reason: string }> = [];
      let addedCount = 0;

      setMovieQueue(prev => {
        const updated = [...prev];

        for (const item of res.results || []) {
          const cleanOriginal = stripMgebPrefix(item.inputUrl).innerUrl || item.inputUrl;
          const cand =
            item.selectedCandidate?.type === 'movie'
              ? item.selectedCandidate
              : item.candidates?.find(c => c.type === 'movie') || item.selectedCandidate;

          if (!cand || cand.type !== 'movie') {
            foundUnmatched.push({
              url: cleanOriginal,
              reason: item.error || 'Filme não identificado automaticamente na TMDB.'
            });
            continue;
          }

          const existingIdx = updated.findIndex(m => m.tmdbId === cand.tmdbId);
          if (existingIdx >= 0) {
            const target = updated[existingIdx];
            const alreadyHas = target.sources.some(s => s.originalUrl.trim() === cleanOriginal.trim());
            if (!alreadyHas) {
              updated[existingIdx] = {
                ...target,
                sources: [
                  ...target.sources.filter(s => s.originalUrl.trim().length > 0),
                  createSourceRow(target.sources.length + 1, cleanOriginal, 'dublado')
                ]
              };
            }
          } else {
            updated.unshift({
              id: makeUid(`mv-${cand.tmdbId}`),
              tmdbId: cand.tmdbId,
              title: cand.title,
              originalTitle: cand.originalTitle,
              posterPath: cand.posterPath,
              releaseYear: cand.releaseYear,
              overview: cand.overview,
              existsInCatalog: Boolean(cand.existsInCatalog || item.duplicateCheck?.isDuplicate),
              categories: cand.suggestedCategories || [],
              approved: true,
              sources: [createSourceRow(1, cleanOriginal, 'dublado')],
              commitStatus: 'idle'
            });
          }
          addedCount++;
        }

        return updated;
      });

      setUnmatchedLinks(foundUnmatched);
      setBulkNotice(
        `${addedCount} link(s) identificado(s) com prefixo MGEB aplicado.${
          foundUnmatched.length > 0
            ? ` ${foundUnmatched.length} link(s) precisam de seleção manual pela TMDB.`
            : ''
        }`
      );
      if (addedCount > 0 && foundUnmatched.length === 0) {
        setBulkLinksText('');
      }
    } catch (err: any) {
      setBulkNotice(err?.message || 'Erro ao analisar links de filmes.');
    } finally {
      setAnalyzingBulk(false);
    }
  };

  const updateMovieSource = (movieId: string, sourceId: string, patch: Partial<MovieSourceRow>) => {
    setMovieQueue(prev =>
      prev.map(m => {
        if (m.id !== movieId) return m;
        return {
          ...m,
          sources: m.sources.map(s => {
            if (s.id !== sourceId) return s;
            const nextOrig =
              patch.originalUrl !== undefined
                ? stripMgebPrefix(patch.originalUrl).innerUrl || patch.originalUrl
                : s.originalUrl;
            return {
              ...s,
              ...patch,
              originalUrl: nextOrig
            };
          })
        };
      })
    );
  };

  const addSourceToMovie = (movieId: string, version: 'dublado' | 'legendado' = 'dublado') => {
    setMovieQueue(prev =>
      prev.map(m =>
        m.id === movieId
          ? {
              ...m,
              sources: [...m.sources, createSourceRow(m.sources.length + 1, '', version)]
            }
          : m
      )
    );
  };

  const removeSourceFromMovie = (movieId: string, sourceId: string) => {
    setMovieQueue(prev =>
      prev.map(m => {
        if (m.id !== movieId) return m;
        const remaining = m.sources.filter(s => s.id !== sourceId);
        return {
          ...m,
          sources: remaining.length > 0 ? remaining : [createSourceRow(1)]
        };
      })
    );
  };

  const handleTestMovieSource = async (movie: StagedMovieItem, src: MovieSourceRow) => {
    const built = buildMgebUrl(src.originalUrl, src.useMgeb);
    if (!built.valid) {
      updateMovieSource(movie.id, src.id, {
        testStatus: 'invalid',
        testNote: built.error || 'URL inválida ou não compatível.'
      });
      return;
    }

    updateMovieSource(movie.id, src.id, { testStatus: 'testing', testNote: 'A verificar via MGEB...' });
    try {
      const res = await fetch('/api/admin/sources/test-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sources: [{ id: src.id, url: built.finalUrl, contentId: movie.tmdbId, contentType: 'movie' }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const r = data?.results?.[0];
        const statusStr = String(r?.status || '').toLowerCase();
        if (statusStr === 'online') {
          updateMovieSource(movie.id, src.id, {
            testStatus: 'compatible',
            testNote: r?.message || 'Fonte compatível e online.'
          });
          return;
        }
        if (r?.httpStatus === 403 || /403|cloudflare/i.test(String(r?.message || ''))) {
          updateMovieSource(movie.id, src.id, {
            testStatus: 'blocked_403',
            testNote: 'Provedor bloqueou verificação externa (HTTP 403) — MGEB pronto para reprodução.'
          });
          return;
        }
      }
      updateMovieSource(movie.id, src.id, {
        testStatus: 'untested',
        testNote: 'Prefixo MGEB válido — teste direto no player para confirmar vídeo.'
      });
    } catch {
      updateMovieSource(movie.id, src.id, {
        testStatus: 'untested',
        testNote: 'Não foi possível contactar o verificador remoto — MGEB pronto.'
      });
    }
  };

  const handleImportAllMovies = async () => {
    const approvedList = movieQueue.filter(m => m.approved);
    if (approvedList.length === 0) return;

    setImportingAll(true);
    let successCount = 0;

    for (const movie of approvedList) {
      const validSources = movie.sources
        .map(s => {
          const built = buildMgebUrl(s.originalUrl, s.useMgeb);
          return { src: s, built };
        })
        .filter(({ src, built }) => src.originalUrl.trim().length > 0 && built.valid && !isImageOrTrailerUrl(src.originalUrl));

      setMovieQueue(prev =>
        prev.map(m =>
          m.id === movie.id
            ? { ...m, commitStatus: 'importing', commitMessage: 'A gravar metadados e fontes...' }
            : m
        )
      );

      try {
        const res = await api.importSmartLinkContent({
          sourceUrl: validSources[0]?.built.innerUrl || undefined,
          tmdbId: movie.tmdbId,
          type: 'movie',
          duplicateMode,
          categories: movie.categories,
          useMgebPrefix: true,
          movieSources: validSources.map(({ src, built }, idx) => ({
            version: src.version,
            url: built.innerUrl,
            useMgebPrefix: src.useMgeb,
            serverName: src.serverName.trim() || (src.version === 'legendado' ? 'Servidor Legendado' : 'Servidor Dublado'),
            quality: src.quality || '1080p',
            enabled: true,
            isPrimary: idx === 0,
            replaceExisting: false,
            status: src.testStatus === 'compatible' ? 'online' : 'registered'
          }))
        });

        successCount++;
        setMovieQueue(prev =>
          prev.map(m =>
            m.id === movie.id
              ? {
                  ...m,
                  existsInCatalog: true,
                  commitStatus: res.duplicate ? 'skipped' : res.isNew ? 'imported' : 'updated',
                  commitMessage: res.message || `Gravado com ${validSources.length} fonte(s).`
                }
              : m
          )
        );
      } catch (err: any) {
        setMovieQueue(prev =>
          prev.map(m =>
            m.id === movie.id
              ? {
                  ...m,
                  commitStatus: 'error',
                  commitMessage: err?.message || 'Erro ao importar filme.'
                }
              : m
          )
        );
      }
    }

    setImportingAll(false);
    if (successCount > 0) {
      onCatalogUpdated?.();
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. PESQUISA TMDB OU COLAGEM EM LOTE DE FILMES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pesquisar Filme na TMDB */}
        <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Pesquisa Oficial TMDB (Filmes)
            </p>
            <h3 className="text-base font-bold text-white mt-0.5">
              Adicionar Filme por Título ou TMDB ID
            </h3>
          </div>

          <form onSubmit={handleSearchTmdb} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Ex: Heart of the Beast ou 123456"
                className="w-full min-h-[42px] bg-black border border-white/15 focus:border-[#E50914] rounded-lg pl-10 pr-3 text-sm text-white placeholder:text-zinc-600 outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={searchingTmdb}
              className="min-h-[42px] px-4 rounded-lg bg-[#E50914] hover:bg-[#c80812] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shrink-0"
            >
              {searchingTmdb ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Pesquisar
            </button>
          </form>

          {searchError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {searchError}
            </p>
          )}

          {searchResults.length > 0 && (
            <div className="divide-y divide-white/5 border border-white/10 rounded-lg max-h-72 overflow-y-auto bg-black">
              {searchResults.slice(0, 10).map(item => (
                <div
                  key={`mv-res-${item.tmdbId}`}
                  className="p-3 flex items-center justify-between gap-3 hover:bg-white/[0.03]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.posterPath ? (
                      <img
                        src={resolveTmdbPosterUrl(item.posterPath)}
                        alt={item.title}
                        className="w-9 h-13 object-cover rounded border border-white/10 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-13 rounded bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4 text-zinc-600" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{item.title}</p>
                      <p className="text-[11px] font-mono text-zinc-400 tabular-nums">
                        TMDB #{item.tmdbId}
                        {item.releaseDate ? ` · ${String(item.releaseDate).slice(0, 4)}` : ''}
                        {item.existsInCatalog ? ' · Já no Catálogo' : ' · Novo'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addTmdbMovieToQueue(item)}
                    className="min-h-[38px] px-3 rounded-lg bg-white/10 hover:bg-[#E50914] text-white text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Preparar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Colar Múltiplos Links de Filmes */}
        <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Colagem Rápida (1 ou Vários Filmes)
              </p>
              <h3 className="text-base font-bold text-white mt-0.5">
                Colar Links de Filmes para MGEB Automático
              </h3>
            </div>
            {bulkLinksText.trim() && (
              <button
                type="button"
                onClick={() => setBulkLinksText('')}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
              >
                <Eraser className="w-3.5 h-3.5" />
                Limpar
              </button>
            )}
          </div>

          <textarea
            value={bulkLinksText}
            onChange={e => setBulkLinksText(e.target.value)}
            rows={4}
            placeholder={
              'Cole 1 ou vários links de filmes (1 por linha):\nhttps://ww1.123flmsfree.com/pt/detail/movie/NArSJO2YBjCoeqfg0mlMH-Heart-of-the-Beast'
            }
            className="w-full bg-black border border-white/15 focus:border-[#E50914] rounded-lg p-3 text-xs font-mono text-white placeholder:text-zinc-600 outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-zinc-400">
              Cada link recebe o prefixo MGEB individualmente sem alterar o link original.
            </span>
            <button
              type="button"
              onClick={handleAnalyzeBulkMovieLinks}
              disabled={analyzingBulk}
              className="min-h-[42px] px-4 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-50 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
            >
              {analyzingBulk ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Identificar Filmes & Aplicar MGEB
            </button>
          </div>

          {bulkNotice && (
            <p className="text-xs text-zinc-300 bg-black border border-white/10 rounded-lg px-3 py-2">
              {bulkNotice}
            </p>
          )}

          {unmatchedLinks.length > 0 && (
            <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 space-y-2">
              <p className="text-xs font-bold text-amber-300">
                Links que precisam de escolha manual do filme TMDB:
              </p>
              {unmatchedLinks.map((u, idx) => (
                <div key={`unmatched-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-mono text-zinc-200 truncate">{u.url}</p>
                    <p className="text-[11px] text-amber-300/80">{u.reason}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setAssignTargetId(u.url)}
                      className="px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold"
                    >
                      Associar ao Filme Pesquisado
                    </button>
                  </div>
                </div>
              ))}
              {assignTargetId && searchResults.length > 0 && (
                <div className="pt-2 border-t border-white/10 flex flex-wrap gap-2">
                  {searchResults.slice(0, 5).map(cand => (
                    <button
                      key={`assign-${cand.tmdbId}`}
                      type="button"
                      onClick={() => {
                        addTmdbMovieToQueue(cand, assignTargetId);
                        setUnmatchedLinks(prev => prev.filter(item => item.url !== assignTargetId));
                        setAssignTargetId(null);
                      }}
                      className="px-2.5 py-1 rounded bg-[#E50914] text-white text-[11px] font-bold"
                    >
                      + {cand.title} (#{cand.tmdbId})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. BARRA DE CONTADORES E AÇÕES GLOBAIS (FILMES) */}
      <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-left">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Filmes na Fila</p>
            <p className="text-lg font-bold text-white tabular-nums">{stats.totalMovies}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Selecionados</p>
            <p className="text-lg font-bold text-white tabular-nums">{stats.selectedMovies}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Links / Fontes</p>
            <p className="text-lg font-bold text-white tabular-nums">{stats.totalSources}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">MGEB Aplicado</p>
            <p className="text-lg font-bold text-emerald-400 tabular-nums">{stats.mgebApplied}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Verificados</p>
            <p className="text-lg font-bold text-sky-400 tabular-nums">{stats.compatible}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Importados</p>
            <p className="text-lg font-bold text-emerald-300 tabular-nums">{stats.imported}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={duplicateMode}
            onChange={e => setDuplicateMode(e.target.value as any)}
            className="min-h-[42px] bg-black border border-white/15 rounded-lg px-3 text-xs text-white outline-none"
          >
            <option value="merge_missing">Duplicados: Mesclar Novas Fontes</option>
            <option value="update_metadata">Duplicados: Atualizar Metadados + Fontes</option>
            <option value="skip">Duplicados: Ignorar Existentes</option>
          </select>

          <button
            type="button"
            onClick={handleImportAllMovies}
            disabled={importingAll || stats.selectedMovies === 0}
            className="min-h-[42px] px-5 rounded-lg bg-[#E50914] hover:bg-[#c80812] disabled:opacity-40 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          >
            {importingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Importar Filmes ({stats.selectedMovies})
          </button>
        </div>
      </div>

      {/* 3. LISTA DE FILMES PREPARADOS E FONTES INDIVIDUAIS */}
      {movieQueue.length === 0 ? (
        <div className="bg-[#0e0e11] border border-white/10 rounded-xl p-10 text-center space-y-2">
          <Film className="w-8 h-8 text-zinc-600 mx-auto" />
          <p className="text-sm font-semibold text-white">Nenhum filme preparado nesta fila</p>
          <p className="text-xs text-zinc-400 max-w-lg mx-auto">
            Pesquise um filme na TMDB acima ou cole um ou mais links de filmes para adicionar múltiplas fontes com prefixo MGEB automático.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {movieQueue.map(movie => (
            <div key={movie.id} className="bg-[#0e0e11] border border-white/10 rounded-xl overflow-hidden">
              {/* Cabeçalho do Filme */}
              <div className="p-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={movie.approved}
                    onChange={e =>
                      setMovieQueue(prev =>
                        prev.map(m => (m.id === movie.id ? { ...m, approved: e.target.checked } : m))
                      )
                    }
                    className="mt-1.5 w-4 h-4 accent-[#E50914] shrink-0"
                  />
                  {movie.posterPath ? (
                    <img
                      src={resolveTmdbPosterUrl(movie.posterPath)}
                      alt={movie.title}
                      className="w-11 h-16 object-cover rounded border border-white/10 shrink-0"
                    />
                  ) : (
                    <div className="w-11 h-16 rounded bg-black border border-white/10 flex items-center justify-center shrink-0">
                      <Film className="w-5 h-5 text-zinc-600" />
                    </div>
                  )}
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h4 className="text-sm sm:text-base font-bold text-white truncate">{movie.title}</h4>
                      <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
                        TMDB #{movie.tmdbId}
                        {movie.releaseYear ? ` · ${movie.releaseYear}` : ''}
                        {movie.existsInCatalog ? ' · No Catálogo' : ' · Novo'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={movie.categories.includes('anime')}
                          onChange={e => {
                            const has = e.target.checked;
                            setMovieQueue(prev =>
                              prev.map(m =>
                                m.id === movie.id
                                  ? {
                                      ...m,
                                      categories: has
                                        ? Array.from(new Set([...m.categories, 'anime']))
                                        : m.categories.filter(c => c !== 'anime')
                                    }
                                  : m
                              )
                            );
                          }}
                          className="accent-[#E50914]"
                        />
                        Anime
                      </label>
                      <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={movie.categories.includes('dorama')}
                          onChange={e => {
                            const has = e.target.checked;
                            setMovieQueue(prev =>
                              prev.map(m =>
                                m.id === movie.id
                                  ? {
                                      ...m,
                                      categories: has
                                        ? Array.from(new Set([...m.categories, 'dorama']))
                                        : m.categories.filter(c => c !== 'dorama')
                                    }
                                  : m
                              )
                            );
                          }}
                          className="accent-[#E50914]"
                        />
                        Dorama
                      </label>
                      {movie.commitMessage && (
                        <span
                          className={`text-xs font-medium ${
                            movie.commitStatus === 'error'
                              ? 'text-red-400'
                              : movie.commitStatus === 'imported' || movie.commitStatus === 'updated'
                              ? 'text-emerald-400'
                              : 'text-amber-300'
                          }`}
                        >
                          {movie.commitMessage}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {(movie.commitStatus === 'imported' || movie.commitStatus === 'updated') && onViewCatalogItem && (
                    <button
                      type="button"
                      onClick={() =>
                        onViewCatalogItem({
                          tmdbId: movie.tmdbId,
                          type: 'movie',
                          title: movie.title,
                          categories: movie.categories
                        })
                      }
                      className="min-h-[38px] px-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Ver no Catálogo
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => addSourceToMovie(movie.id, 'dublado')}
                    className="min-h-[38px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovieQueue(prev => prev.filter(m => m.id !== movie.id))}
                    className="min-h-[38px] px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remover
                  </button>
                </div>
              </div>

              {/* Fontes do Filme */}
              <div className="divide-y divide-white/5">
                {movie.sources.map((src, sIdx) => {
                  const built = buildMgebUrl(src.originalUrl, src.useMgeb);
                  const isBlockedAsset = isImageOrTrailerUrl(src.originalUrl);

                  return (
                    <div key={src.id} className="p-4 space-y-3 bg-black/40">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                        <div className="md:col-span-5">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                            Link Original #{sIdx + 1}
                          </label>
                          <input
                            type="text"
                            value={src.originalUrl}
                            onChange={e => updateMovieSource(movie.id, src.id, { originalUrl: e.target.value })}
                            placeholder="https://..."
                            className="w-full min-h-[42px] bg-black border border-white/15 focus:border-[#E50914] rounded-lg px-3 text-xs font-mono text-white placeholder:text-zinc-600 outline-none"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                            Áudio
                          </label>
                          <select
                            value={src.version}
                            onChange={e =>
                              updateMovieSource(movie.id, src.id, {
                                version: e.target.value === 'legendado' ? 'legendado' : 'dublado'
                              })
                            }
                            className="w-full min-h-[42px] bg-black border border-white/15 rounded-lg px-2.5 text-xs text-white outline-none"
                          >
                            <option value="dublado">Dublado</option>
                            <option value="legendado">Legendado</option>
                          </select>
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                            Qualidade
                          </label>
                          <select
                            value={src.quality}
                            onChange={e => updateMovieSource(movie.id, src.id, { quality: e.target.value })}
                            className="w-full min-h-[42px] bg-black border border-white/15 rounded-lg px-2.5 text-xs text-white outline-none"
                          >
                            {SOURCE_QUALITY_OPTIONS.map(q => (
                              <option key={q} value={q}>
                                {q}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="md:col-span-3">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                            Servidor
                          </label>
                          <input
                            type="text"
                            value={src.serverName}
                            onChange={e => updateMovieSource(movie.id, src.id, { serverName: e.target.value })}
                            className="w-full min-h-[42px] bg-black border border-white/15 rounded-lg px-2.5 text-xs text-white outline-none"
                          />
                        </div>
                      </div>

                      {/* Preview MGEB + Estado + Ações */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
                        <div className="min-w-0 space-y-1 font-mono text-[11px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-zinc-500 font-sans font-semibold">MGEB:</span>
                            <code className="text-zinc-300 select-all">{MGEB_PREFIX}</code>
                            <button
                              type="button"
                              onClick={() => updateMovieSource(movie.id, src.id, { useMgeb: !src.useMgeb })}
                              className={`px-2 py-0.5 rounded border text-[10px] font-sans font-bold ${
                                src.useMgeb
                                  ? 'bg-[#E50914]/15 border-[#E50914]/40 text-[#ff7379]'
                                  : 'bg-zinc-900 border-white/15 text-zinc-400'
                              }`}
                            >
                              {src.useMgeb ? 'MGEB ON' : 'MGEB OFF'}
                            </button>
                          </div>

                          {src.originalUrl.trim() ? (
                            isBlockedAsset ? (
                              <p className="text-amber-400 font-sans">
                                Link de imagem/trailer detetado — prefixo MGEB não é aplicado automaticamente.
                              </p>
                            ) : (
                              <>
                                <p className="text-zinc-400 break-all">
                                  <span className="text-zinc-500 font-sans">URL Original: </span>
                                  {built.innerUrl || src.originalUrl}
                                </p>
                                <p className={built.valid ? 'text-emerald-400 break-all' : 'text-red-400 break-all'}>
                                  <span className="text-zinc-500 font-sans">URL MGEB: </span>
                                  {built.valid ? built.finalUrl : built.error}
                                </p>
                              </>
                            )
                          ) : (
                            <p className="text-zinc-500 font-sans">
                              Insira a URL original acima para gerar automaticamente o endereço MGEB.
                            </p>
                          )}

                          {src.testNote && (
                            <p
                              className={`font-sans text-[11px] ${
                                src.testStatus === 'compatible'
                                  ? 'text-emerald-400'
                                  : src.testStatus === 'blocked_403'
                                  ? 'text-amber-300'
                                  : src.testStatus === 'invalid'
                                  ? 'text-red-400'
                                  : 'text-zinc-400'
                              }`}
                            >
                              {src.testNote}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {built.valid && !isBlockedAsset && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCopy(src.id, built.finalUrl)}
                                className="min-h-[38px] px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-xs flex items-center gap-1.5"
                              >
                                {copiedId === src.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                                Copiar MGEB
                              </button>
                              <button
                                type="button"
                                onClick={() => handleTestMovieSource(movie, src)}
                                disabled={src.testStatus === 'testing'}
                                className="min-h-[38px] px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-xs flex items-center gap-1.5"
                              >
                                {src.testStatus === 'testing' ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                                )}
                                Testar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenPlayer({
                                    title: `${movie.title} (${src.version === 'legendado' ? 'Legendado' : 'Dublado'})`,
                                    src: built.finalUrl,
                                    version: src.version
                                  })
                                }
                                className="min-h-[38px] px-3 rounded-lg bg-[#E50914]/15 hover:bg-[#E50914]/25 border border-[#E50914]/40 text-white text-xs font-semibold flex items-center gap-1.5"
                              >
                                <Play className="w-3.5 h-3.5" />
                                Testar Player
                              </button>
                            </>
                          )}
                          {movie.sources.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeSourceFromMovie(movie.id, src.id)}
                              className="min-h-[38px] px-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs"
                              title="Remover fonte"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
