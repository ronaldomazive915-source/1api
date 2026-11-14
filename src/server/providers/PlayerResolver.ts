import { PlayerResolveResponse, PlayerResolvedSource, VideoFormatType } from '../../types.js';
import { db } from '../database.js';
import { probeVideoSource } from '../sourceProbe.js';

function mapStoredFormat(format?: string): VideoFormatType {
  const f = (format || '').toLowerCase();
  if (f === 'mp4') return 'mp4';
  if (f === 'webm') return 'webm';
  if (f === 'm3u8' || f === 'hls') return 'm3u8';
  if (f === 'dash' || f === 'mpd') return 'dash';
  if (f === 'php_endpoint') return 'php_endpoint';
  if (f === 'html') return 'html';
  if (f === 'iframe') return 'iframe';
  if (f === 'embed') return 'embed';
  return 'auto';
}

export const playerResolver = {
  async resolveMovie(tmdbId: number | string, _options?: { imdb?: boolean }): Promise<PlayerResolveResponse> {
    const numId = Number(tmdbId);
    const media = db.getMediaById(`movie-${numId}`) || db.getMediaByTmdbAndType(numId, 'movie');

    const resolvedSources: PlayerResolvedSource[] = [];

    try {
      const dbSources = await db.getVideoSources({ contentId: numId, contentType: 'movie' });
      for (const s of dbSources) {
        if (s.status !== 'offline' && s.status !== 'inactive') {
          resolvedSources.push({
            id: s.id,
            type: mapStoredFormat(s.format),
            sourceKind: s.sourceKind,
            url: s.url,
            originalUrl: s.originalUrl || s.url,
            provider: s.serverName || 'Servidor RONYCINE',
            label: `${s.serverName || 'Servidor'} (${s.quality || '1080p'})`,
            quality: s.quality || '1080p',
            audioLanguage: s.audioLanguage || 'Português',
            isPrimary: s.isPrimary ?? false,
            status: s.status || 'registered',
            diagnostics: s.diagnostics
          });
        }
      }
    } catch (e) {
      console.warn('[PlayerResolver] Error loading DB video sources:', e);
    }

    const ordered = [
      ...resolvedSources.filter(s => s.isPrimary),
      ...resolvedSources.filter(s => !s.isPrimary)
    ];

    const primarySource: PlayerResolvedSource =
      ordered.length > 0
        ? ordered[0]
        : {
            type: 'embed',
            url: '',
            provider: 'Servidor RONYCINE',
            label: 'Sem fonte cadastrada',
            quality: '1080p'
          };

    const alternativeSources = ordered.slice(1);

    return {
      success: ordered.length > 0,
      content: {
        id: `movie-${numId}`,
        title: media?.title || `Filme TMDB ${numId}`,
        type: 'movie',
        tmdbId: numId,
        poster: media?.posterPath,
        backdrop: media?.backdropPath,
        overview: media?.overview
      },
      source: primarySource,
      sources: ordered,
      alternativeSources
    };
  },

  async resolveEpisode(tmdbId: number | string, season: number, episode: number, _options?: { imdb?: boolean }): Promise<PlayerResolveResponse> {
    const numId = Number(tmdbId);
    const media = db.getMediaById(`tv-${numId}`) || db.getMediaByTmdbAndType(numId, 'tv');

    const resolvedSources: PlayerResolvedSource[] = [];

    try {
      const dbSources = await db.getVideoSources({
        contentId: numId,
        contentType: 'tv',
        seasonNumber: season,
        episodeNumber: episode
      });
      for (const s of dbSources) {
        if (s.status !== 'offline' && s.status !== 'inactive') {
          resolvedSources.push({
            id: s.id,
            type: mapStoredFormat(s.format),
            sourceKind: s.sourceKind,
            url: s.url,
            originalUrl: s.originalUrl || s.url,
            provider: s.serverName || 'Servidor RONYCINE',
            label: `${s.serverName || 'Servidor'} (${s.quality || '1080p'})`,
            quality: s.quality || '1080p',
            audioLanguage: s.audioLanguage || 'Português',
            isPrimary: s.isPrimary ?? false,
            status: s.status || 'registered',
            diagnostics: s.diagnostics
          });
        }
      }
    } catch (e) {
      console.warn('[PlayerResolver] Error loading DB video sources for TV:', e);
    }

    const ordered = [
      ...resolvedSources.filter(s => s.isPrimary),
      ...resolvedSources.filter(s => !s.isPrimary)
    ];

    const primarySource: PlayerResolvedSource =
      ordered.length > 0
        ? ordered[0]
        : {
            type: 'embed',
            url: '',
            provider: 'Servidor RONYCINE',
            label: `T${season}:E${episode} Sem fonte cadastrada`,
            quality: '1080p'
          };

    const alternativeSources = ordered.slice(1);

    return {
      success: ordered.length > 0,
      content: {
        id: `tv-${numId}`,
        title: media?.title || `Série TMDB ${numId}`,
        type: 'tv',
        tmdbId: numId,
        season,
        episode,
        poster: media?.posterPath,
        backdrop: media?.backdropPath,
        overview: media?.overview
      },
      source: primarySource,
      sources: ordered,
      alternativeSources,
      nextEpisode: {
        available: true,
        season,
        episode: episode + 1
      }
    };
  },

  async testSource(url: string) {
    if (!url) {
      return {
        success: false,
        accessible: false,
        format: 'unknown',
        message: 'URL vazia'
      };
    }
    const probe = await probeVideoSource(url);
    return {
      success: probe.success,
      accessible: probe.accessible,
      status: probe.status,
      sourceKind: probe.sourceKind,
      format: probe.detectedFormat,
      message: probe.message,
      diagnostics: probe.diagnostics
    };
  }
};
