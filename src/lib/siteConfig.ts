export const OFFICIAL_BASE_URL = 'https://ronycineapi.ai.studio';

export function buildOfficialEmbedPath(params: {
  type: 'movie' | 'tv';
  tmdbId: number | string;
  season?: number | string;
  episode?: number | string;
}): string {
  const cleanId = String(params.tmdbId || '').trim();
  if (params.type === 'tv') {
    const s = String(params.season || '1').trim();
    const e = String(params.episode || '1').trim();
    return `/embed/${cleanId}/${s}/${e}`;
  }
  return `/embed/${cleanId}`;
}

export function buildOfficialEmbedUrl(params: {
  type: 'movie' | 'tv';
  tmdbId: number | string;
  season?: number | string;
  episode?: number | string;
}): string {
  return `${OFFICIAL_BASE_URL}${buildOfficialEmbedPath(params)}`;
}

export function buildOfficialDirectPlayApiUrl(params: {
  type: 'movie' | 'tv';
  tmdbId: number | string;
  season?: number | string;
  episode?: number | string;
}): string {
  const cleanId = String(params.tmdbId || '').trim();
  if (params.type === 'tv' && params.season !== undefined && params.episode !== undefined) {
    return `${OFFICIAL_BASE_URL}/api/v1/direct-play/tv/${cleanId}/${String(params.season).trim()}/${String(params.episode).trim()}`;
  }
  return `${OFFICIAL_BASE_URL}/api/v1/direct-play/${params.type === 'tv' ? 'tv' : 'movie'}/${cleanId}`;
}
