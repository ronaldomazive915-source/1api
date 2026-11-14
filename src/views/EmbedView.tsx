import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { RonycinePlayer, VideoSourceItem } from '../components/player/RonycinePlayer.js';
import { PlayerResolveResponse } from '../types.js';
import { AlertCircle, Film, RefreshCw, ShieldAlert } from 'lucide-react';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { useAuth } from '../context/AuthContext.js';
import { resolveTmdbPosterUrl } from '../lib/mediaUtils.js';

interface ParsedEmbedRoute {
  mode: 'player' | 'embed';
  mediaType: 'movie' | 'tv';
  contentId: number;
  imdbId?: string;
  season: number;
  episode: number;
  token: string | null;
  invalidParams?: boolean;
  errorMessage?: string;
}

function isStrictPositiveInt(val?: string): boolean {
  return Boolean(val && /^\d+$/.test(val) && parseInt(val, 10) > 0);
}

function parseEmbedLocation(): ParsedEmbedRoute {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/embed/550';
  const search = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const parts = path.split('/').filter(Boolean);
  const token = search.get('token');

  // Legacy /player/{id}?type=movie|tv&season=...&episode=...&token=...
  if (parts[0] === 'player') {
    const rawId = parts[1] || '';
    const contentId = isStrictPositiveInt(rawId) ? parseInt(rawId, 10) : 0;
    const rawType = (search.get('type') || 'movie').toLowerCase();
    const mediaType: 'movie' | 'tv' = rawType === 'tv' || rawType === 'series' ? 'tv' : 'movie';
    const season = Math.max(1, parseInt(search.get('season') || '1', 10) || 1);
    const episode = Math.max(1, parseInt(search.get('episode') || '1', 10) || 1);
    if (!contentId) {
      return {
        mode: 'player',
        mediaType,
        contentId: 0,
        season,
        episode,
        token,
        invalidParams: true,
        errorMessage: 'TMDB ID inválido na URL do player.'
      };
    }
    return { mode: 'player', mediaType, contentId, season, episode, token };
  }

  // Legacy /embed/imdb/{tt...} and /embed/tv/imdb/{tt...}/{s}/{e}
  const isImdb = parts.includes('imdb');
  if (isImdb) {
    const isTv = parts[1] === 'tv';
    if (isTv) {
      return {
        mode: 'embed',
        mediaType: 'tv',
        contentId: 0,
        imdbId: parts[3],
        season: Math.max(1, parseInt(parts[4] || '1', 10) || 1),
        episode: Math.max(1, parseInt(parts[5] || '1', 10) || 1),
        token
      };
    }
    return {
      mode: 'embed',
      mediaType: 'movie',
      contentId: 0,
      imdbId: parts[2] === 'imdb' ? parts[3] : parts[2],
      season: 1,
      episode: 1,
      token
    };
  }

  // Legacy /embed/movie/{tmdbId}
  if (parts[0] === 'embed' && parts[1] === 'movie') {
    if (!isStrictPositiveInt(parts[2])) {
      return {
        mode: 'embed',
        mediaType: 'movie',
        contentId: 0,
        season: 1,
        episode: 1,
        token,
        invalidParams: true,
        errorMessage: 'ID TMDB inválido para reprodução de filme.'
      };
    }
    return {
      mode: 'embed',
      mediaType: 'movie',
      contentId: parseInt(parts[2], 10),
      season: 1,
      episode: 1,
      token
    };
  }

  // Legacy /embed/tv/{tmdbId}/{season}/{episode} or /embed/tv/{tmdbId}
  if (parts[0] === 'embed' && (parts[1] === 'tv' || parts[1] === 'series')) {
    if (!isStrictPositiveInt(parts[2])) {
      return {
        mode: 'embed',
        mediaType: 'tv',
        contentId: 0,
        season: 1,
        episode: 1,
        token,
        invalidParams: true,
        errorMessage: 'ID TMDB inválido para reprodução de série.'
      };
    }
    return {
      mode: 'embed',
      mediaType: 'tv',
      contentId: parseInt(parts[2], 10),
      season: isStrictPositiveInt(parts[3]) ? parseInt(parts[3], 10) : 1,
      episode: isStrictPositiveInt(parts[4]) ? parseInt(parts[4], 10) : 1,
      token
    };
  }

  // Official Clean Direct Embed:
  // 1) /embed/{tmdb_id}/{season_number}/{episode_number} -> Series Episode
  if (parts[0] === 'embed' && parts.length === 4) {
    if (!isStrictPositiveInt(parts[1]) || !isStrictPositiveInt(parts[2]) || !isStrictPositiveInt(parts[3])) {
      return {
        mode: 'embed',
        mediaType: 'tv',
        contentId: 0,
        season: 1,
        episode: 1,
        token,
        invalidParams: true,
        errorMessage: 'Parâmetros inválidos. Utilize /embed/{tmdb_id}/{temporada}/{episodio} com números válidos.'
      };
    }
    return {
      mode: 'embed',
      mediaType: 'tv',
      contentId: parseInt(parts[1], 10),
      season: parseInt(parts[2], 10),
      episode: parseInt(parts[3], 10),
      token
    };
  }

  // 2) /embed/{tmdb_id} -> Movie
  if (parts[0] === 'embed' && parts.length === 2) {
    if (!isStrictPositiveInt(parts[1])) {
      return {
        mode: 'embed',
        mediaType: 'movie',
        contentId: 0,
        season: 1,
        episode: 1,
        token,
        invalidParams: true,
        errorMessage: 'Parâmetro inválido. Utilize /embed/{tmdb_id} com um ID numérico válido.'
      };
    }
    return {
      mode: 'embed',
      mediaType: 'movie',
      contentId: parseInt(parts[1], 10),
      season: 1,
      episode: 1,
      token
    };
  }

  return {
    mode: 'embed',
    mediaType: 'movie',
    contentId: 0,
    season: 1,
    episode: 1,
    token,
    invalidParams: true,
    errorMessage: 'Formato de rota inválido. Utilize /embed/{tmdb_id} para filmes ou /embed/{tmdb_id}/{temporada}/{episodio} para séries.'
  };
}

export const EmbedView: React.FC = () => {
  const { watchParams } = useAuth();
  const [loading, setLoading] = useState<boolean>(true);
  const [resolved, setResolved] = useState<(PlayerResolveResponse & { tokenVerified?: boolean; appName?: string; code?: string }) | null>(null);
  const [sources, setSources] = useState<VideoSourceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSecurityError, setIsSecurityError] = useState<boolean>(false);
  const [cinemaMode, setCinemaMode] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const routeRef = useRef<ParsedEmbedRoute>(parseEmbedLocation());

  const currentHref =
    typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/embed/550';

  useEffect(() => {
    const parsed = parseEmbedLocation();
    routeRef.current = parsed;

    setLoading(true);
    setError(null);
    setErrorCode(null);
    setSources([]);
    setResolved(null);
    setIsSecurityError(false);

    if (parsed.invalidParams) {
      setError(parsed.errorMessage || 'Parâmetros de reprodução inválidos.');
      setErrorCode('INVALID_PARAMS');
      setLoading(false);
      return;
    }

    let cancelled = false;
    let fetchPromise: Promise<PlayerResolveResponse & { tokenVerified?: boolean; appName?: string; code?: string }>;

    if (parsed.imdbId) {
      fetchPromise =
        parsed.mediaType === 'tv'
          ? api.getPlayerImdbTv(parsed.imdbId, parsed.season, parsed.episode)
          : api.getPlayerImdbMovie(parsed.imdbId);
    } else {
      fetchPromise = api.getPlayerSession({
        contentId: parsed.contentId,
        type: parsed.mediaType,
        season: parsed.mediaType === 'tv' ? parsed.season : undefined,
        episode: parsed.mediaType === 'tv' ? parsed.episode : undefined,
        token: parsed.token
      });
    }

    fetchPromise
      .then((res) => {
        if (cancelled) return;
        setResolved(res);
        const list =
          res.sources && res.sources.length > 0
            ? res.sources
            : res.source?.url
              ? [res.source, ...(res.alternativeSources || [])]
              : [];

        if (res.success && list.length > 0) {
          setSources(list as VideoSourceItem[]);
          setError(null);
          setErrorCode(null);
          setIsSecurityError(false);
        } else {
          setErrorCode((res as any).code || null);
          setError(res.message || res.error || 'Este conteúdo ainda não possui uma fonte de reprodução disponível.');
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        const msg = err?.message || 'Erro ao carregar o player.';
        const lower = msg.toLowerCase();
        const security =
          lower.includes('token') ||
          lower.includes('domínio') ||
          lower.includes('autorizado') ||
          lower.includes('suspensa') ||
          lower.includes('expirado');
        setIsSecurityError(security);
        if (lower.includes('não encontrado') || lower.includes('404')) {
          setErrorCode('CONTENT_NOT_FOUND');
          setError('Conteúdo não encontrado na RONYCINE API.');
        } else {
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentHref, watchParams?.tmdbId, watchParams?.season, watchParams?.episode, watchParams?.type, reloadNonce]);

  if (loading) {
    return (
      <div className="w-screen h-[100dvh] bg-[#080808] flex flex-col items-center justify-center text-white space-y-4">
        <RefreshCw className="w-10 h-10 text-[#E50914] animate-spin" />
        <span className="text-xs uppercase tracking-widest font-bold text-zinc-400">
          Inicializando RONYCINE Embed Player...
        </span>
      </div>
    );
  }

  if (error || !resolved || sources.length === 0) {
    const parsed = routeRef.current;
    const isNotFound = errorCode === 'CONTENT_NOT_FOUND';
    const isNoSource = errorCode === 'NO_SOURCE_AVAILABLE';

    return (
      <div className="w-screen h-[100dvh] bg-[#080808] flex flex-col items-center justify-center p-6 text-center text-white">
        <div className="max-w-md w-full bg-[#111114] border border-white/10 rounded-2xl p-8 flex flex-col items-center shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-[#E50914]/15 border border-[#E50914]/30 flex items-center justify-center mb-4">
            {isSecurityError ? (
              <ShieldAlert className="w-7 h-7 text-[#E50914]" />
            ) : isNotFound ? (
              <Film className="w-7 h-7 text-[#E50914]" />
            ) : (
              <AlertCircle className="w-7 h-7 text-[#E50914]" />
            )}
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#E50914] mb-1.5">
            RONYCINE DIRECT PLAY • EMBED
          </span>
          <h2 className="text-lg sm:text-xl font-black mb-2 font-display">
            {isSecurityError
              ? 'Acesso ao Player Bloqueado'
              : isNotFound
                ? 'Conteúdo Não Encontrado'
                : isNoSource
                  ? 'Nenhuma Fonte Associada'
                  : 'Mídia Indisponível'}
          </h2>
          {resolved?.content?.title && (
            <p className="text-xs font-bold text-zinc-200 mb-2">
              {resolved.content.title}
              {parsed.mediaType === 'tv'
                ? ` — T${String(parsed.season).padStart(2, '0')} • E${String(parsed.episode).padStart(2, '0')}`
                : ''}
            </p>
          )}
          <p className="text-xs sm:text-sm text-zinc-400 mb-6 leading-relaxed">
            {error || 'Nenhuma fonte compatível configurada para este título.'}
          </p>
          {!isSecurityError && !parsed.invalidParams && !isNotFound && (
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="px-5 py-2.5 bg-[#E50914] hover:bg-red-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Tentar Novamente</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const parsed = routeRef.current;
  const contentTitle = resolved.content?.title || 'Player RONYCINE';
  const epTitleSuffix = (resolved.content as any)?.episodeTitle ? ` · ${(resolved.content as any).episodeTitle}` : '';
  const displayTitle =
    parsed.mediaType === 'tv'
      ? `${contentTitle} — T${String(parsed.season).padStart(2, '0')} • E${String(parsed.episode).padStart(2, '0')}${epTitleSuffix}`
      : contentTitle;

  const posterUrl =
    resolveTmdbPosterUrl(resolved.content?.backdrop, 'w1280') ||
    resolveTmdbPosterUrl(resolved.content?.poster, 'w500');

  const resumeKey =
    parsed.mediaType === 'tv'
      ? `tv-${parsed.contentId}-s${parsed.season}-e${parsed.episode}`
      : `movie-${parsed.contentId}`;

  return (
    <div className="w-screen h-[100dvh] bg-[#080808] overflow-hidden">
      <ErrorBoundary
        fallbackTitle="Erro no Player Incorporado"
        resetKey={`${parsed.mediaType}-${parsed.contentId}-${parsed.season}-${parsed.episode}-${reloadNonce}`}
      >
        <RonycinePlayer
          sources={sources}
          title={displayTitle}
          poster={posterUrl}
          autoplay={true}
          resumeKey={resumeKey}
          isCinemaMode={cinemaMode}
          onToggleCinemaMode={() => setCinemaMode((prev) => !prev)}
          hasNextEpisode={Boolean(resolved.nextEpisode?.available)}
          onNextEpisode={() => {
            if (resolved.nextEpisode?.season && resolved.nextEpisode?.episode && resolved.content?.tmdbId) {
              if (parsed.mode === 'embed') {
                const tokenParam = parsed.token ? `?token=${encodeURIComponent(parsed.token)}` : '';
                window.location.href = `/embed/${resolved.content.tmdbId}/${resolved.nextEpisode.season}/${resolved.nextEpisode.episode}${tokenParam}`;
              } else {
                const tokenParam = parsed.token ? `&token=${encodeURIComponent(parsed.token)}` : '';
                window.location.href = `/player/${resolved.content.tmdbId}?type=tv&season=${resolved.nextEpisode.season}&episode=${resolved.nextEpisode.episode}${tokenParam}`;
              }
            }
          }}
          onPlaybackEvent={(status, message, sourceType, sourceUrl) => {
            if (parsed.contentId > 0) {
              api.reportPlayerEvent({
                contentId: parsed.contentId,
                mediaType: parsed.mediaType,
                season: parsed.mediaType === 'tv' ? parsed.season : undefined,
                episode: parsed.mediaType === 'tv' ? parsed.episode : undefined,
                status,
                errorMessage: message,
                sourceType,
                sourceUrl
              });
            }
          }}
          standalone={true}
        />
      </ErrorBoundary>
    </div>
  );
};
