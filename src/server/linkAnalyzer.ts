import { validatePublicHttpUrl } from './sourceProbe.js';
import { MGEB_PREFIX, stripMgebPrefix, generateEpisodeLinks, buildMgebUrl } from '../lib/mgebUtils.js';
import { classifySourceUrl } from '../lib/sourceClassification.js';
import {
  LinkImportAnalysisResult,
  LinkImportExtractedEpisodeLink,
  LinkImportSeasonPreview,
  LinkImportTmdbCandidate,
  MediaItem
} from '../types.js';

export interface AnalyzerDependencies {
  fetchTMDB: (endpoint: string, params?: Record<string, string>, signal?: AbortSignal) => Promise<any>;
  formatTMDBMedia: (raw: any, type: 'movie' | 'tv') => Partial<MediaItem> & { tmdbId: number; type: 'movie' | 'tv'; title: string };
  detectContentCategory: (
    raw: any,
    type: 'movie' | 'tv'
  ) => {
    suggestedType: 'movie' | 'tv';
    suggestedCategories: Array<'anime' | 'dorama'>;
    confidence: 'high' | 'medium' | 'low';
    needsManualChoice: boolean;
    originCountry: string[];
    originalLanguage?: string;
    reasons: string[];
  };
  getExistingMedia: (tmdbId: number, type: 'movie' | 'tv') => MediaItem | undefined;
}

function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, num) => {
      const n = parseInt(num, 10);
      return Number.isFinite(n) && n > 0 ? String.fromCharCode(n) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparisonText(str?: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str?: string): string[] {
  const clean = normalizeComparisonText(str);
  if (!clean) return [];
  const stopWords = new Set(['a', 'o', 'os', 'as', 'the', 'an', 'of', 'de', 'da', 'do', 'e', 'and', 'story']);
  const rawTokens = clean.split(' ').filter(Boolean);
  const meaningful = rawTokens.filter(t => t.length > 1 && !stopWords.has(t));
  return meaningful.length > 0 ? meaningful : rawTokens;
}

function stripStreamingNoise(rawTitle: string): { cleaned: string; year?: number; typeHint?: 'movie' | 'tv' } {
  let text = decodeHtmlEntities(rawTitle || '');
  let year: number | undefined;
  let typeHint: 'movie' | 'tv' | undefined;

  const yearMatch = text.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }

  if (/\b(s\d{1,2}e\d{1,2}|temporada|season|episodio|episódio|episode|ep\s*\d+|serie|série|drama|dorama|anime)\b/i.test(text)) {
    typeHint = 'tv';
  } else if (/\b(filme|movie|pelicula|película)\b/i.test(text)) {
    typeHint = 'movie';
  }

  // Strip domain / site suffixes like "| SiteName" or "— Playspelis"
  text = text.split(/\s+(?:\||—|–|•)\s+/)[0] || text;

  // Strip leading random alphanumeric prefix hash (Seekee/Playspelis/123pelicula style: "gjG2CqKaqR601v37CBElT-The-Mentalist-Season-1")
  text = text.replace(/^[a-zA-Z0-9]{10,}-(?=[A-Za-z])/, '');

  // Convert hyphens/underscores to spaces BEFORE noise regexes so "Season-1" and "Temporada-6" match cleanly
  text = text.replace(/[-_]+/g, ' ');

  // Strip common streaming noise words and season/episode suffixes
  text = text
    .replace(/\((?:19\d{2}|20\d{2}|dublado|legendado|hd|full\s*hd|4k|online|gr[aá]tis)\)/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(
      /\b(?:assistir|ver|online|gr[aá]tis|gratis|completo|dublado|legendado|dual\s*[aá]udio|hd|fullhd|1080p|720p|4k|bluray|web\s*dl|seekee|playspelis|(?:temporada|season|temp)\s*\d*|epis[oó]dio\s*\d*|episode\s*\d*|s\d{1,2}\s*e\d{1,3})\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (year && text.endsWith(String(year))) {
    text = text.slice(0, -4).trim();
  }

  return { cleaned: text, year, typeHint };
}

export function extractHintsFromUrl(parsedUrl: URL): {
  slugTitle: string;
  alternativeQueries: string[];
  year?: number;
  inferredType: 'movie' | 'tv' | 'unknown';
  hintedEpisodeNumber?: number;
  hintedSeasonNumber?: number;
  providerId?: string;
  languageHint?: string;
} {
  const segments = parsedUrl.pathname.split('/').filter(Boolean).map(s => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });

  let languageHint: string | undefined;
  if (segments[0] && /^(pt|en|es|fr|pt-br|pt-pt)$/i.test(segments[0])) {
    languageHint = segments[0].toLowerCase();
  }

  const lowerPath = parsedUrl.pathname.toLowerCase();
  let inferredType: 'movie' | 'tv' | 'unknown' = 'unknown';
  if (/\/(series|serie|tv|drama|dorama|anime|episodes?|temporada|season)\b/.test(lowerPath)) {
    inferredType = 'tv';
  } else if (/\/(movie|movies|filme|filmes|pelicula)\b/.test(lowerPath)) {
    inferredType = 'movie';
  }

  let hintedEpisodeNumber: number | undefined;
  let hintedSeasonNumber: number | undefined;

  const seMatch =
    lowerPath.match(/s(\d{1,2})e(\d{1,3})/i) ||
    lowerPath.match(/(?:temporada|season)[-_/\s]*(\d{1,2}).*?(?:epis[oó]dio|episode|ep)[-_/\s]*(\d{1,3})/i);
  if (seMatch) {
    hintedSeasonNumber = parseInt(seMatch[1], 10);
    hintedEpisodeNumber = parseInt(seMatch[2], 10);
    inferredType = 'tv';
  } else {
    const seasonSegMatch =
      lowerPath.match(/\/(?:temporada|season|temp)\/(\d{1,2})(?:\/|$)/i) ||
      lowerPath.match(/[-_/](?:temporada|season|temp)[-_/\s]*(\d{1,2})(?:\/|$|-)/i) ||
      lowerPath.match(/(\d{1,2})(?:a|ª)?[-_\s]*(?:temporada|season)\b/i);
    if (seasonSegMatch) {
      const sNum = parseInt(seasonSegMatch[1], 10);
      if (sNum >= 0 && sNum <= 99) {
        hintedSeasonNumber = sNum;
        inferredType = 'tv';
      }
    }

    const lastSeg = segments[segments.length - 1];
    const prevSeg = segments[segments.length - 2] || '';
    if (lastSeg && /^\d{1,3}$/.test(lastSeg) && !/^(temporada|season|temp)$/i.test(prevSeg)) {
      const n = parseInt(lastSeg, 10);
      if (n >= 1 && n <= 300) {
        hintedEpisodeNumber = n;
        if (inferredType === 'unknown') inferredType = 'tv';
      }
    }
  }

  const genericSegments = new Set([
    'pt', 'en', 'es', 'fr', 'pt-br', 'pt-pt',
    'detail', 'details', 'drama', 'movie', 'movies', 'filme', 'filmes',
    'series', 'serie', 'tv', 'anime', 'dorama', 'watch', 'assistir', 'play', 'embed', 'video',
    'temporada', 'season', 'episodio', 'episode'
  ]);

  const titleCandidates = segments
    .filter(s => !genericSegments.has(s.toLowerCase()) && !/^\d+$/.test(s) && s.length >= 3)
    .sort((a, b) => b.length - a.length);

  const rawSlug = titleCandidates[0] || '';
  const providerIdMatch = rawSlug.match(/^([a-zA-Z0-9]{10,})-(?=[A-Za-z])/);
  const providerId = providerIdMatch?.[1];

  const { cleaned, year, typeHint } = stripStreamingNoise(rawSlug);
  if (inferredType === 'unknown' && typeHint) {
    inferredType = typeHint;
  }

  const alternativeQueries: string[] = [];
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length >= 4) {
    const firstHalf = words.slice(0, Math.min(4, words.length)).join(' ');
    const secondHalf = words.slice(Math.max(0, words.length - 4)).join(' ');
    if (firstHalf && firstHalf.toLowerCase() !== cleaned.toLowerCase()) alternativeQueries.push(firstHalf);
    if (words.length >= 5) {
      const firstThree = words.slice(0, 3).join(' ');
      if (firstThree && !alternativeQueries.includes(firstThree)) alternativeQueries.push(firstThree);
    }
    if (secondHalf && secondHalf.toLowerCase() !== cleaned.toLowerCase() && !alternativeQueries.includes(secondHalf)) {
      alternativeQueries.push(secondHalf);
    }
  }

  return {
    slugTitle: cleaned,
    alternativeQueries,
    year,
    inferredType,
    hintedEpisodeNumber,
    hintedSeasonNumber,
    providerId,
    languageHint
  };
}

function parseMetaTag(html: string, attrName: string, attrValue: string): string | undefined {
  const escapedVal = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(
    `<meta[^>]+${attrName}=["']${escapedVal}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const m1 = html.match(re1);
  if (m1?.[1]) return decodeHtmlEntities(m1[1]);

  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*${attrName}=["']${escapedVal}["'][^>]*>`,
    'i'
  );
  const m2 = html.match(re2);
  if (m2?.[1]) return decodeHtmlEntities(m2[1]);

  return undefined;
}

function extractEpisodeLinksFromHtml(
  html: string,
  baseUrl: URL
): LinkImportExtractedEpisodeLink[] {
  const found = new Map<string, LinkImportExtractedEpisodeLink>();
  const anchorRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let scanned = 0;

  while ((match = anchorRegex.exec(html)) !== null && scanned < 600) {
    scanned++;
    const rawHref = match[1]?.trim();
    const rawLabel = decodeHtmlEntities((match[2] || '').replace(/<[^>]+>/g, ' '));
    if (!rawHref || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) continue;

    let absUrl: URL;
    try {
      absUrl = new URL(rawHref, baseUrl.toString());
    } catch {
      continue;
    }

    if (absUrl.origin !== baseUrl.origin) continue;
    const combinedText = `${absUrl.pathname} ${absUrl.search} ${rawLabel}`;

    let season = 1;
    let episode: number | null = null;

    const se = combinedText.match(/s(\d{1,2})\s*[eEx×-]\s*(\d{1,3})/i) ||
      combinedText.match(/(\d{1,2})\s*[x×]\s*(\d{1,3})/i) ||
      combinedText.match(/temporada\s*(\d{1,2}).{0,20}epis[oó]dio\s*(\d{1,3})/i);

    if (se) {
      season = Math.max(1, parseInt(se[1], 10));
      episode = parseInt(se[2], 10);
    } else {
      const epOnly =
        rawLabel.match(/^(?:ep(?:is[oó]dio|isode)?\.?\s*)?(\d{1,3})$/i) ||
        absUrl.pathname.match(/\/(?:ep|episode|episodio)?[-_]?(\d{1,3})\/?$/i);
      if (epOnly && (absUrl.pathname.includes('/detail/') || /ep|epis/i.test(rawLabel + absUrl.pathname))) {
        const epNum = parseInt(epOnly[1], 10);
        if (epNum >= 1 && epNum <= 300) {
          episode = epNum;
        }
      }
    }

    if (episode !== null && episode > 0 && episode <= 500) {
      const key = `${season}:${episode}`;
      if (!found.has(key)) {
        found.set(key, {
          seasonNumber: season,
          episodeNumber: episode,
          pageUrl: absUrl.toString(),
          label: rawLabel || `T${season} E${episode}`
        });
      }
    }
  }

  return Array.from(found.values()).sort(
    (a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber
  );
}

export function parsePublicHtmlMetadata(html: string, baseUrl: URL) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawPageTitle = titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]) : undefined;
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match?.[1] ? decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, ' ')) : undefined;

  const ogTitle = parseMetaTag(html, 'property', 'og:title');
  const ogDescription =
    parseMetaTag(html, 'property', 'og:description') ||
    parseMetaTag(html, 'name', 'description');
  const ogImage = parseMetaTag(html, 'property', 'og:image');
  const ogType = parseMetaTag(html, 'property', 'og:type');

  let jsonLdFound = false;
  let jsonLdTitle: string | undefined;
  let jsonLdAltTitle: string | undefined;
  let jsonLdType: 'movie' | 'tv' | undefined;
  let jsonLdYear: number | undefined;
  const detectedEpisodeLinks = extractEpisodeLinksFromHtml(html, baseUrl);

  const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(ldMatch[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of items) {
        if (!node || typeof node !== 'object') continue;
        jsonLdFound = true;
        const atType = String(node['@type'] || '').toLowerCase();
        if (atType.includes('tvseries') || atType.includes('tvepisode')) jsonLdType = 'tv';
        else if (atType.includes('movie')) jsonLdType = 'movie';
        if (typeof node.name === 'string' && !jsonLdTitle) jsonLdTitle = decodeHtmlEntities(node.name);
        if (typeof node.alternateName === 'string' && !jsonLdAltTitle) jsonLdAltTitle = decodeHtmlEntities(node.alternateName);
        if (typeof node.datePublished === 'string') {
          const ym = node.datePublished.match(/\b(19\d{2}|20\d{2})\b/);
          if (ym) jsonLdYear = parseInt(ym[1], 10);
        }
      }
    } catch {}
  }

  return {
    rawPageTitle,
    h1Text,
    ogTitle,
    ogDescription,
    ogImage,
    ogType,
    jsonLdFound,
    jsonLdTitle,
    jsonLdAltTitle,
    jsonLdType,
    jsonLdYear,
    detectedEpisodeLinks
  };
}

function detectProtectionFromResponse(status: number | null, html: string, headers: Headers): {
  detected: boolean;
  type: 'cloudflare' | 'captcha' | 'auth' | 'paywall' | 'forbidden' | null;
  reason: string | null;
} {
  const lower = (html || '').toLowerCase();
  const server = (headers.get('server') || '').toLowerCase();

  if (
    (server.includes('cloudflare') || lower.includes('cloudflare')) &&
    (status === 403 || status === 503 || lower.includes('attention required') || lower.includes('cf-chl') || lower.includes('just a moment'))
  ) {
    return {
      detected: true,
      type: 'cloudflare',
      reason: `Acesso automático bloqueado por proteção Cloudflare (HTTP ${status || 403}). O RONYCINE respeita esta proteção e não tenta contorná-la.`
    };
  }

  if (lower.includes('g-recaptcha') || lower.includes('hcaptcha') || lower.includes('turnstile')) {
    return {
      detected: true,
      type: 'captcha',
      reason: 'A página exige verificação CAPTCHA; os metadados internos não puderam ser lidos automaticamente.'
    };
  }

  if (status === 401) {
    return {
      detected: true,
      type: 'auth',
      reason: 'A página exige autenticação (HTTP 401).'
    };
  }

  if (status === 402 || lower.includes('subscribe to watch') || lower.includes('assine para assistir')) {
    return {
      detected: true,
      type: 'paywall',
      reason: 'Conteúdo protegido por subscrição/paywall.'
    };
  }

  if (status === 403 || status === 429) {
    return {
      detected: true,
      type: 'forbidden',
      reason: `Acesso recusado pelo servidor externo (HTTP ${status}).`
    };
  }

  return { detected: false, type: null, reason: null };
}

function scoreTmdbCandidate(
  candidate: any,
  queries: string[],
  preferredType: 'movie' | 'tv' | 'unknown',
  targetYear?: number
): { score: number; confidence: 'high' | 'medium' | 'low'; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const titleNorm = normalizeComparisonText(candidate.title);
  const origNorm = normalizeComparisonText(candidate.originalTitle);
  const allCandidateTokens = new Set([...tokenize(candidate.title), ...tokenize(candidate.originalTitle)]);

  let bestTextScore = 0;
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const qNorm = normalizeComparisonText(q);
    if (!qNorm) continue;

    if (titleNorm === qNorm || origNorm === qNorm) {
      bestTextScore = Math.max(bestTextScore, 60);
    } else if (
      (titleNorm && qNorm.includes(titleNorm)) ||
      (origNorm && qNorm.includes(origNorm)) ||
      (titleNorm && titleNorm.includes(qNorm)) ||
      (origNorm && origNorm.includes(qNorm))
    ) {
      bestTextScore = Math.max(bestTextScore, 46);
    } else {
      const qTokens = tokenize(q);
      if (qTokens.length > 0 && allCandidateTokens.size > 0) {
        const hits = qTokens.filter(t => allCandidateTokens.has(t)).length;
        const ratio = hits / Math.max(qTokens.length, allCandidateTokens.size);
        bestTextScore = Math.max(bestTextScore, Math.round(ratio * 42));
      }
    }
  }

  score += bestTextScore;
  if (bestTextScore >= 50) reasons.push('Correspondência forte de título/título original');
  else if (bestTextScore >= 28) reasons.push('Correspondência parcial de palavras-chave');
  else reasons.push('Correspondência aproximada por pesquisa TMDB');

  if (preferredType !== 'unknown') {
    if (candidate.type === preferredType) {
      score += 22;
      reasons.push(`Tipo compatível (${preferredType === 'tv' ? 'Série' : 'Filme'})`);
    } else {
      score -= 8;
    }
  }

  if (targetYear && candidate.releaseYear) {
    if (Number(candidate.releaseYear) === targetYear) {
      score += 18;
      reasons.push(`Ano coincidente (${targetYear})`);
    } else if (Math.abs(Number(candidate.releaseYear) - targetYear) === 1) {
      score += 8;
    }
  }

  if ((candidate.popularity || 0) >= 20) {
    score += 5;
  }

  const clamped = Math.max(0, Math.min(100, score));
  const confidence: 'high' | 'medium' | 'low' =
    clamped >= 70 ? 'high' : clamped >= 45 ? 'medium' : 'low';

  return { score: clamped, confidence, reasons };
}

export async function buildSeasonsPreviewForSeries(
  tmdbId: number,
  deps: AnalyzerDependencies,
  detectedEpisodeLinks: LinkImportExtractedEpisodeLink[],
  existingMedia?: MediaItem
): Promise<{
  seasonsPreview: LinkImportSeasonPreview[];
  tmdbTotalSeasons: number;
  tmdbTotalEpisodes: number;
  sourceEpisodeLinksFound: number;
}> {
  const tmdbSeries = await deps.fetchTMDB(`/tv/${tmdbId}`);
  if (!tmdbSeries || !Array.isArray(tmdbSeries.seasons)) {
    return {
      seasonsPreview: [],
      tmdbTotalSeasons: 0,
      tmdbTotalEpisodes: 0,
      sourceEpisodeLinksFound: detectedEpisodeLinks.length
    };
  }

  const linkMap = new Map<string, string>();
  for (const link of detectedEpisodeLinks) {
    linkMap.set(`${link.seasonNumber}:${link.episodeNumber}`, link.pageUrl);
  }

  // Do not artificially limit seasons (support 2, 7, 12, 20+ seasons)
  // Include regular seasons (> 0) and specials (= 0) if available
  const candidateSeasons = tmdbSeries.seasons.filter((s: any) => typeof s.season_number === 'number');
  const seasonsToInspect = candidateSeasons;
  const seasonsPreview: LinkImportSeasonPreview[] = [];

  const CHUNK = 4;
  for (let i = 0; i < seasonsToInspect.length; i += CHUNK) {
    const batch = seasonsToInspect.slice(i, i + CHUNK);
    const results = await Promise.all(
      batch.map(async (sn: any) => {
        const sNum = Number(sn.season_number);
        const existingSeason = (existingMedia?.seasons || []).find(
          es => Number(es.seasonNumber) === sNum
        );
        const existingEpSet = new Set(
          (existingSeason?.episodes || []).map(ep => Number(ep.episodeNumber))
        );

        try {
          const tmdbSeason = await deps.fetchTMDB(
            `/tv/${tmdbId}/season/${sNum}`,
            {},
            AbortSignal.timeout(8000)
          );
          const eps = Array.isArray(tmdbSeason?.episodes) ? tmdbSeason.episodes : [];
          let sourceLinksCount = 0;
          const mappedEps = eps.map((ep: any) => {
            const epNum = Number(ep.episode_number);
            const srcUrl = linkMap.get(`${sNum}:${epNum}`) || null;
            if (srcUrl) sourceLinksCount++;
            return {
              seasonNumber: sNum,
              episodeNumber: epNum,
              title: ep.name || `Episódio ${epNum}`,
              overview: ep.overview || 'Sinopse não disponível.',
              duration: ep.runtime || 45,
              airDate: ep.air_date,
              stillPath: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : undefined,
              voteAverage: ep.vote_average ? Number(ep.vote_average.toFixed(1)) : undefined,
              hasSourcePageLink: Boolean(srcUrl),
              sourcePageUrl: srcUrl,
              existsInCatalog: existingEpSet.has(epNum)
            };
          });

          return {
            seasonNumber: sNum,
            name: tmdbSeason?.name || sn.name || `Temporada ${sNum}`,
            overview: tmdbSeason?.overview || sn.overview || '',
            posterPath: tmdbSeason?.poster_path
              ? `https://image.tmdb.org/t/p/w500${tmdbSeason.poster_path}`
              : sn.poster_path
                ? `https://image.tmdb.org/t/p/w500${sn.poster_path}`
                : undefined,
            tmdbEpisodeCount: Math.max(Number(sn.episode_count || 0), mappedEps.length),
            sourceLinksCount,
            existingEpisodesCount: existingEpSet.size,
            episodes: mappedEps
          } as LinkImportSeasonPreview;
        } catch {
          return {
            seasonNumber: sNum,
            name: sn.name || `Temporada ${sNum}`,
            overview: sn.overview || '',
            tmdbEpisodeCount: Number(sn.episode_count || 0),
            sourceLinksCount: 0,
            existingEpisodesCount: existingEpSet.size,
            episodes: []
          } as LinkImportSeasonPreview;
        }
      })
    );
    seasonsPreview.push(...results);
  }

  seasonsPreview.sort((a, b) => a.seasonNumber - b.seasonNumber);

  const tmdbTotalSeasons = candidateSeasons.length;
  const tmdbTotalEpisodes = candidateSeasons.reduce(
    (acc: number, s: any) => acc + Number(s.episode_count || 0),
    0
  );

  return {
    seasonsPreview,
    tmdbTotalSeasons,
    tmdbTotalEpisodes,
    sourceEpisodeLinksFound: detectedEpisodeLinks.length
  };
}

export async function analyzeExternalLink(
  inputUrl: string,
  deps: AnalyzerDependencies,
  options?: { manualHintTitle?: string; manualHtml?: string; preferredTmdbId?: number; preferredType?: 'movie' | 'tv' }
): Promise<LinkImportAnalysisResult> {
  const trimmedUrl = (inputUrl || '').trim();
  const warnings: string[] = [];
  const unidentifiedFields: string[] = [];

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return {
      inputUrl: trimmedUrl,
      normalizedUrl: trimmedUrl,
      domain: '',
      status: 'INVALID_URL',
      pageAccess: {
        accessible: false,
        httpStatus: null,
        contentType: null,
        finalUrl: null,
        protectionDetected: false,
        protectionType: null,
        diagnosticMessage: 'URL inválida. Informe um endereço completo com http:// ou https://.',
        isHtmlPageOnly: false
      },
      extracted: {
        cleanedTitle: '',
        alternativeQueries: [],
        inferredType: 'unknown',
        jsonLdFound: false,
        detectedEpisodeLinks: [],
        unidentifiedFields: ['URL válida']
      },
      candidates: [],
      selectedCandidate: null,
      seasonsPreview: [],
      tmdbTotalSeasons: 0,
      tmdbTotalEpisodes: 0,
      sourceEpisodeLinksFound: 0,
      duplicateCheck: {
        isDuplicate: false,
        existingSeasonsCount: 0,
        existingEpisodesCount: 0,
        missingSeasonsCount: 0,
        missingEpisodesCount: 0,
        recommendedAction: 'skip'
      },
      warnings: ['Link inválido'],
      error: 'Link inválido ou malformado.'
    };
  }

  const ssrf = await validatePublicHttpUrl(parsedUrl.toString());
  if (!ssrf.safe) {
    return {
      inputUrl: trimmedUrl,
      normalizedUrl: parsedUrl.toString(),
      domain: parsedUrl.hostname,
      status: 'INVALID_URL',
      pageAccess: {
        accessible: false,
        httpStatus: null,
        contentType: null,
        finalUrl: null,
        protectionDetected: false,
        protectionType: null,
        diagnosticMessage: ssrf.reason || 'Destino bloqueado pela política de segurança.',
        isHtmlPageOnly: false
      },
      extracted: {
        cleanedTitle: '',
        alternativeQueries: [],
        inferredType: 'unknown',
        jsonLdFound: false,
        detectedEpisodeLinks: [],
        unidentifiedFields: ['Acesso permitido ao domínio']
      },
      candidates: [],
      selectedCandidate: null,
      seasonsPreview: [],
      tmdbTotalSeasons: 0,
      tmdbTotalEpisodes: 0,
      sourceEpisodeLinksFound: 0,
      duplicateCheck: {
        isDuplicate: false,
        existingSeasonsCount: 0,
        existingEpisodesCount: 0,
        missingSeasonsCount: 0,
        missingEpisodesCount: 0,
        recommendedAction: 'skip'
      },
      warnings: [ssrf.reason || 'URL bloqueada'],
      error: ssrf.reason || 'URL bloqueada pela política SSRF.'
    };
  }

  const urlHints = extractHintsFromUrl(parsedUrl);
  let httpStatus: number | null = null;
  let contentType: string | null = null;
  let finalUrl: string | null = parsedUrl.toString();
  let htmlText = '';
  let pageAccessible = false;
  let protectionInfo: ReturnType<typeof detectProtectionFromResponse> = {
    detected: false,
    type: null,
    reason: null
  };
  let diagnosticMessage = '';

  if (options?.manualHtml && options.manualHtml.trim().length > 20) {
    htmlText = options.manualHtml.trim().slice(0, 350000);
    pageAccessible = true;
    httpStatus = 200;
    contentType = 'text/html';
    diagnosticMessage = 'Metadados lidos a partir do HTML público fornecido pelo administrador.';
  } else {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      try {
        const resp = await fetch(parsedUrl.toString(), {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8'
          }
        });
        httpStatus = resp.status;
        contentType = resp.headers.get('content-type');
        finalUrl = resp.url || parsedUrl.toString();

        const rawSnippet = await resp.text();
        htmlText = rawSnippet.slice(0, 350000);
        protectionInfo = detectProtectionFromResponse(httpStatus, htmlText, resp.headers);

        if (resp.ok && !protectionInfo.detected) {
          pageAccessible = true;
          diagnosticMessage = 'Página pública acessível e analisada com sucesso.';
        } else if (protectionInfo.detected) {
          diagnosticMessage =
            protectionInfo.reason ||
            `Página protegida (HTTP ${httpStatus}). Apenas pistas públicas da URL foram usadas para correspondência TMDB.`;
          warnings.push(diagnosticMessage);
        } else {
          diagnosticMessage = `Página devolveu HTTP ${httpStatus} (${resp.statusText || 'Indisponível'}).`;
          warnings.push(diagnosticMessage);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      diagnosticMessage = `Não foi possível aceder à página externa (${err?.name === 'AbortError' ? 'Tempo esgotado' : err?.message || 'Erro de rede'}).`;
      warnings.push(diagnosticMessage);
    }
  }

  const htmlMeta =
    pageAccessible && htmlText && (!contentType || contentType.includes('html') || htmlText.includes('<'))
      ? parsePublicHtmlMetadata(htmlText, parsedUrl)
      : {
          rawPageTitle: undefined,
          h1Text: undefined,
          ogTitle: undefined,
          ogDescription: undefined,
          ogImage: undefined,
          ogType: undefined,
          jsonLdFound: false,
          jsonLdTitle: undefined,
          jsonLdAltTitle: undefined,
          jsonLdType: undefined,
          jsonLdYear: undefined,
          detectedEpisodeLinks: [] as LinkImportExtractedEpisodeLink[]
        };

  const primaryRawTitle =
    options?.manualHintTitle?.trim() ||
    htmlMeta.jsonLdTitle ||
    htmlMeta.ogTitle ||
    htmlMeta.h1Text ||
    htmlMeta.rawPageTitle ||
    '';

  const strippedFromHtml = primaryRawTitle ? stripStreamingNoise(primaryRawTitle) : { cleaned: '' };
  const cleanedTitle = strippedFromHtml.cleaned || urlHints.slugTitle || '';

  const inferredType: 'movie' | 'tv' | 'unknown' =
    options?.preferredType ||
    htmlMeta.jsonLdType ||
    (htmlMeta.ogType?.includes('tv') || htmlMeta.ogType?.includes('episode')
      ? 'tv'
      : htmlMeta.ogType?.includes('movie')
        ? 'movie'
        : undefined) ||
    strippedFromHtml.typeHint ||
    urlHints.inferredType;

  const year = htmlMeta.jsonLdYear || strippedFromHtml.year || urlHints.year;

  const queryPool: string[] = [];
  const pushQuery = (q?: string) => {
    const clean = (q || '').trim();
    if (clean && clean.length >= 2 && !queryPool.some(x => x.toLowerCase() === clean.toLowerCase())) {
      queryPool.push(clean);
    }
  };

  pushQuery(options?.manualHintTitle);
  pushQuery(strippedFromHtml.cleaned);
  pushQuery(htmlMeta.jsonLdAltTitle ? stripStreamingNoise(htmlMeta.jsonLdAltTitle).cleaned : undefined);
  pushQuery(urlHints.slugTitle);
  for (const alt of urlHints.alternativeQueries) pushQuery(alt);

  if (!cleanedTitle) {
    unidentifiedFields.push('Título automático');
  }
  if (!year) {
    unidentifiedFields.push('Ano de lançamento na página/URL');
  }
  if (htmlMeta.detectedEpisodeLinks.length === 0) {
    unidentifiedFields.push('Links públicos de episódios na página de origem');
  }

  // Note explicitly when URL is an HTML detail page rather than a direct video file
  const isHtmlPageOnly = !/\.(mp4|m3u8|mpd|webm)(?:$|\?)/i.test(parsedUrl.pathname);
  if (isHtmlPageOnly) {
    warnings.push(
      'O link analisado aponta para uma página web informativa/agregadora e não para um ficheiro de vídeo direto (.mp4/.m3u8). O RONYCINE importa os metadados oficiais via TMDB sem criar fontes de vídeo fictícias.'
    );
  }

  // Search TMDB across extracted query candidates
  const rawTmdbMap = new Map<string, { item: any; type: 'movie' | 'tv' }>();

  if (options?.preferredTmdbId) {
    const typesToTry: Array<'movie' | 'tv'> = options.preferredType
      ? [options.preferredType]
      : inferredType === 'movie'
        ? ['movie', 'tv']
        : ['tv', 'movie'];
    for (const t of typesToTry) {
      const data = await deps.fetchTMDB(`/${t}/${options.preferredTmdbId}`);
      if (data?.id) {
        rawTmdbMap.set(`${t}:${data.id}`, { item: data, type: t });
      }
    }
  }

  if (rawTmdbMap.size === 0) {
    for (const q of queryPool.slice(0, 4)) {
      const [ptRes, enRes] = await Promise.all([
        deps.fetchTMDB('/search/multi', { query: q, page: '1' }),
        deps.fetchTMDB('/search/multi', { query: q, language: 'en-US', page: '1' })
      ]);

      for (const list of [ptRes?.results, enRes?.results]) {
        if (!Array.isArray(list)) continue;
        for (const r of list) {
          if (!r || (r.media_type !== 'movie' && r.media_type !== 'tv')) continue;
          const mType: 'movie' | 'tv' = r.media_type === 'tv' ? 'tv' : 'movie';
          const key = `${mType}:${r.id}`;
          if (!rawTmdbMap.has(key)) {
            rawTmdbMap.set(key, { item: r, type: mType });
          }
        }
      }
      if (rawTmdbMap.size >= 8) break;
    }
  }

  // Hydrate top 6 TMDB matches for complete metadata + duplicate inspection
  const preliminary = Array.from(rawTmdbMap.values()).slice(0, 6);
  const candidates: LinkImportTmdbCandidate[] = [];

  await Promise.all(
    preliminary.map(async ({ item, type }) => {
      const full = await deps.fetchTMDB(`/${type}/${item.id}`).catch(() => null);
      const sourceObj = full && full.id ? full : item;
      const formatted = deps.formatTMDBMedia(sourceObj, type);
      const detection = deps.detectContentCategory(sourceObj, type);
      const existing = deps.getExistingMedia(Number(formatted.tmdbId), type);

      const scored = scoreTmdbCandidate(formatted, queryPool, inferredType, year);
      const existingSeasonsCount = existing?.seasons?.length || 0;
      const existingEpisodesCount = (existing?.seasons || []).reduce(
        (acc, s) => acc + (s.episodes?.length || 0),
        0
      );

      candidates.push({
        tmdbId: Number(formatted.tmdbId),
        type,
        title: formatted.title,
        originalTitle: formatted.originalTitle,
        overview: formatted.overview,
        posterPath: formatted.posterPath,
        backdropPath: formatted.backdropPath,
        releaseYear: formatted.releaseYear,
        releaseDate: formatted.releaseDate,
        firstAirDate: formatted.firstAirDate,
        voteAverage: formatted.voteAverage,
        popularity: formatted.popularity,
        genres: formatted.genres,
        originCountry: formatted.originCountry || detection.originCountry,
        originalLanguage: formatted.originalLanguage || detection.originalLanguage,
        numberOfSeasons: formatted.numberOfSeasons,
        numberOfEpisodes: formatted.numberOfEpisodes,
        suggestedCategories: detection.suggestedCategories,
        confidence: scored.confidence,
        score: scored.score,
        matchReasons: scored.reasons,
        existsInCatalog: Boolean(existing),
        existingMediaId: existing?.id || null,
        existingSeasonsCount,
        existingEpisodesCount
      });
    })
  );

  candidates.sort((a, b) => b.score - a.score || (b.popularity || 0) - (a.popularity || 0));

  const selectedCandidate = candidates[0] || null;
  let seasonsPreview: LinkImportSeasonPreview[] = [];
  let tmdbTotalSeasons = selectedCandidate?.numberOfSeasons || 0;
  let tmdbTotalEpisodes = selectedCandidate?.numberOfEpisodes || 0;

  const existingForSelected = selectedCandidate
    ? deps.getExistingMedia(selectedCandidate.tmdbId, selectedCandidate.type)
    : undefined;

  if (selectedCandidate && selectedCandidate.type === 'tv') {
    const previewRes = await buildSeasonsPreviewForSeries(
      selectedCandidate.tmdbId,
      deps,
      htmlMeta.detectedEpisodeLinks,
      existingForSelected
    );
    seasonsPreview = previewRes.seasonsPreview;
    tmdbTotalSeasons = previewRes.tmdbTotalSeasons || tmdbTotalSeasons;
    tmdbTotalEpisodes = previewRes.tmdbTotalEpisodes || tmdbTotalEpisodes;
  }

  const existingSeasonsCount = existingForSelected?.seasons?.length || 0;
  const existingEpisodesCount = (existingForSelected?.seasons || []).reduce(
    (acc, s) => acc + (s.episodes?.length || 0),
    0
  );
  const missingSeasonsCount =
    selectedCandidate?.type === 'tv'
      ? Math.max(0, tmdbTotalSeasons - existingSeasonsCount)
      : 0;
  const missingEpisodesCount =
    selectedCandidate?.type === 'tv'
      ? Math.max(0, tmdbTotalEpisodes - existingEpisodesCount)
      : 0;

  const isDuplicate = Boolean(selectedCandidate?.existsInCatalog);
  const recommendedAction: 'import_new' | 'merge_missing' | 'update_metadata' | 'skip' = !selectedCandidate
    ? 'skip'
    : !isDuplicate
      ? 'import_new'
      : missingEpisodesCount > 0
        ? 'merge_missing'
        : 'update_metadata';

  let status: LinkImportAnalysisResult['status'] = 'READY';
  if (!selectedCandidate) {
    status = !pageAccessible && !cleanedTitle ? 'UNAVAILABLE' : 'NOT_FOUND';
  } else if (isDuplicate) {
    status = 'DUPLICATE';
  } else if (selectedCandidate.confidence === 'low') {
    status = 'LOW_CONFIDENCE';
  }

  return {
    inputUrl: trimmedUrl,
    normalizedUrl: parsedUrl.toString(),
    domain: parsedUrl.hostname,
    status,
    pageAccess: {
      accessible: pageAccessible,
      httpStatus,
      contentType,
      finalUrl,
      protectionDetected: protectionInfo.detected,
      protectionType: protectionInfo.type,
      diagnosticMessage:
        diagnosticMessage || 'Análise concluída a partir das informações públicas disponíveis.',
      isHtmlPageOnly
    },
    extracted: {
      rawPageTitle: htmlMeta.rawPageTitle,
      ogTitle: htmlMeta.ogTitle,
      ogDescription: htmlMeta.ogDescription,
      ogImage: htmlMeta.ogImage,
      ogType: htmlMeta.ogType,
      cleanedTitle,
      alternativeQueries: queryPool,
      year,
      inferredType,
      hintedEpisodeNumber: urlHints.hintedEpisodeNumber,
      hintedSeasonNumber: urlHints.hintedSeasonNumber,
      languageHint: urlHints.languageHint,
      jsonLdFound: htmlMeta.jsonLdFound,
      detectedEpisodeLinks: htmlMeta.detectedEpisodeLinks,
      unidentifiedFields
    },
    candidates,
    selectedCandidate,
    seasonsPreview,
    tmdbTotalSeasons,
    tmdbTotalEpisodes,
    sourceEpisodeLinksFound: htmlMeta.detectedEpisodeLinks.length,
    duplicateCheck: {
      isDuplicate,
      existingMediaId: existingForSelected?.id || null,
      existingTitle: existingForSelected?.title || null,
      existingSeasonsCount,
      existingEpisodesCount,
      missingSeasonsCount,
      missingEpisodesCount,
      recommendedAction
    },
    warnings,
    error: !selectedCandidate
      ? 'Nenhum conteúdo correspondente foi encontrado no TMDB com segurança. Pode pesquisar manualmente por título ou TMDB ID.'
      : null
  };
}

export interface DiscoveredEpisodeItem {
  episodeNumber: number;
  title: string;
  originalUrl?: string;
  preparedUrl?: string;
  sourceUrl: string | null;
  sourceType: 'mp4' | 'm3u8' | 'hls' | 'dash' | 'webm' | 'stream' | 'unknown' | 'html';
  isDirectStream: boolean;
  mgebApplied: boolean;
  status: 'found' | 'ready' | 'pending' | 'invalid';
  format?: string;
  version: 'dublado' | 'legendado';
  overview?: string;
  airDate?: string;
  stillPath?: string;
  duration?: number;
}

export interface SeasonDiscoveryResult {
  seasonNumber: number;
  seasonName: string;
  expectedEpisodes: number;
  foundCount: number;
  pendingCount: number;
  foundEpisodesCount: number;
  pendingEpisodesCount: number;
  readyEpisodesCount: number;
  strategy: 'html_scrape' | 'sequential_pattern' | 'mixed' | 'tmdb_only';
  status: 'completed' | 'partial' | 'pending' | 'error';
  message: string;
  episodes: DiscoveredEpisodeItem[];
}

export async function discoverSeasonEpisodes(
  tmdbId: number,
  seasonNumber: number,
  firstEpisodeUrl: string,
  deps: AnalyzerDependencies,
  options?: {
    expectedEpisodeCount?: number;
    version?: 'dublado' | 'legendado';
    manualHtml?: string;
    useMgebPrefix?: boolean;
  }
): Promise<SeasonDiscoveryResult> {
  const version = options?.version || 'dublado';
  let tmdbSeason: any = null;

  try {
    tmdbSeason = await deps.fetchTMDB(
      `/tv/${tmdbId}/season/${seasonNumber}`,
      {},
      AbortSignal.timeout(10000)
    );
  } catch {
    // If season fetch fails, fall back to empty or options count
  }

  const rawEpisodes = Array.isArray(tmdbSeason?.episodes) ? tmdbSeason.episodes : [];
  const expectedEpisodes = Math.max(
    rawEpisodes.length,
    Number(options?.expectedEpisodeCount || 0),
    1
  );
  const seasonName =
    tmdbSeason?.name ||
    (seasonNumber === 0 ? 'Especiais' : `Temporada ${seasonNumber}`);

  const trimmedFirstUrl = (firstEpisodeUrl || '').trim();
  if (!trimmedFirstUrl) {
    const fallbackList: DiscoveredEpisodeItem[] = [];
    for (let i = 1; i <= expectedEpisodes; i++) {
      const epData = rawEpisodes.find((e: any) => Number(e.episode_number) === i);
      fallbackList.push({
        episodeNumber: i,
        title: epData?.name || `Episódio ${i}`,
        sourceUrl: null,
        originalUrl: undefined,
        preparedUrl: undefined,
        sourceType: 'unknown',
        isDirectStream: false,
        mgebApplied: false,
        status: 'pending',
        version,
        overview: epData?.overview,
        airDate: epData?.air_date,
        stillPath: epData?.still_path ? `https://image.tmdb.org/t/p/w500${epData.still_path}` : undefined,
        duration: epData?.runtime || 45
      });
    }

    return {
      seasonNumber,
      seasonName,
      expectedEpisodes,
      foundCount: 0,
      pendingCount: expectedEpisodes,
      foundEpisodesCount: 0,
      pendingEpisodesCount: expectedEpisodes,
      readyEpisodesCount: 0,
      strategy: 'tmdb_only',
      status: 'pending',
      message: 'Insira o link inicial do episódio 1 para descobrir os episódios desta temporada.',
      episodes: fallbackList
    };
  }

  // 1. Scrape or extract links from the page if accessible
  const htmlExtractedLinks = new Map<number, string>();
  const strippedFirst = stripMgebPrefix(trimmedFirstUrl);
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(strippedFirst.innerUrl || trimmedFirstUrl);
  } catch {}

  if (options?.manualHtml && parsedUrl) {
    const extracted = extractEpisodeLinksFromHtml(options.manualHtml, parsedUrl);
    for (const item of extracted) {
      if (item.seasonNumber === seasonNumber || item.seasonNumber === 1) {
        htmlExtractedLinks.set(item.episodeNumber, item.pageUrl);
      }
    }
  } else if (parsedUrl) {
    try {
      const ssrf = await validatePublicHttpUrl(parsedUrl.toString());
      if (ssrf.safe) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const resp = await fetch(parsedUrl.toString(), {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
          });
          if (resp.ok) {
            const rawHtml = await resp.text();
            const extracted = extractEpisodeLinksFromHtml(rawHtml.slice(0, 350000), parsedUrl);
            for (const item of extracted) {
              if (item.seasonNumber === seasonNumber || item.seasonNumber === 1) {
                htmlExtractedLinks.set(item.episodeNumber, item.pageUrl);
              }
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch {
      // Ignore network errors and continue to pattern generator
    }
  }

  // 2. Synthesize sequential links using intelligent URL pattern extrapolation
  const generatedResult = generateEpisodeLinks({
    firstLink: trimmedFirstUrl,
    useMgebPrefix: false,
    startEpisode: 1,
    episodeCount: expectedEpisodes
  });

  const generatedMap = new Map<number, string>();
  if (generatedResult.valid && Array.isArray(generatedResult.links)) {
    for (const g of generatedResult.links) {
      generatedMap.set(g.episodeNumber, g.innerUrl);
    }
  }

  // 3. Merge and prepare episodes
  const finalEpisodes: DiscoveredEpisodeItem[] = [];
  let foundCount = 0;
  let readyEpisodesCount = 0;
  let usedHtmlCount = 0;
  let usedGenCount = 0;

  for (let epNum = 1; epNum <= expectedEpisodes; epNum++) {
    const epData = rawEpisodes.find((e: any) => Number(e.episode_number) === epNum);
    const htmlUrl = htmlExtractedLinks.get(epNum);
    const genUrl = generatedMap.get(epNum);
    if (htmlUrl) usedHtmlCount++;
    else if (genUrl) usedGenCount++;

    const rawTargetUrl = htmlUrl || genUrl || (epNum === 1 ? strippedFirst.innerUrl : undefined);

    let preparedUrl: string | undefined = undefined;
    let status: DiscoveredEpisodeItem['status'] = 'pending';
    let format: string | undefined = undefined;
    let sourceType: DiscoveredEpisodeItem['sourceType'] = 'unknown';
    let isDirectStream = false;
    let mgebApplied = false;
    let cleanInnerUrl: string | undefined = undefined;

    if (rawTargetUrl) {
      const stripped = stripMgebPrefix(rawTargetUrl);
      cleanInnerUrl = stripped.innerUrl || rawTargetUrl;
      const classified = classifySourceUrl(cleanInnerUrl);
      format = classified.suggestedFormat;

      isDirectStream =
        classified.sourceKind === 'DIRECT_MP4' ||
        classified.sourceKind === 'DIRECT_HLS' ||
        classified.sourceKind === 'DIRECT_DASH' ||
        classified.sourceKind === 'DIRECT_WEBM' ||
        classified.sourceKind === 'PHP_VIDEO_ENDPOINT' ||
        /\.(mp4|m3u8|webm|mpd)($|\?)/i.test(cleanInnerUrl);

      if (classified.sourceKind === 'DIRECT_MP4') sourceType = 'mp4';
      else if (classified.sourceKind === 'DIRECT_HLS') sourceType = 'm3u8';
      else if (classified.sourceKind === 'DIRECT_DASH') sourceType = 'dash';
      else if (classified.sourceKind === 'DIRECT_WEBM') sourceType = 'webm';
      else if (isDirectStream) sourceType = 'stream';
      else if (classified.sourceKind === 'WEB_PAGE') sourceType = 'html';

      const shouldApplyMgeb =
        options?.useMgebPrefix === true ||
        (options?.useMgebPrefix !== false && (isDirectStream || strippedFirst.hadPrefix || stripped.hadPrefix));

      const built = buildMgebUrl(cleanInnerUrl, shouldApplyMgeb);
      preparedUrl = built.finalUrl || cleanInnerUrl;
      mgebApplied = shouldApplyMgeb;

      if (isDirectStream) {
        status = 'ready';
        readyEpisodesCount++;
      } else {
        status = 'found';
      }
      foundCount++;
    }

    finalEpisodes.push({
      episodeNumber: epNum,
      title: epData?.name || `Episódio ${epNum}`,
      originalUrl: cleanInnerUrl || rawTargetUrl,
      preparedUrl,
      sourceUrl: preparedUrl || null,
      sourceType,
      isDirectStream,
      mgebApplied,
      status,
      format,
      version,
      overview: epData?.overview,
      airDate: epData?.air_date,
      stillPath: epData?.still_path ? `https://image.tmdb.org/t/p/w500${epData.still_path}` : undefined,
      duration: epData?.runtime || 45
    });
  }

  const pendingCount = Math.max(0, expectedEpisodes - foundCount);
  const strategy: SeasonDiscoveryResult['strategy'] =
    usedHtmlCount > 0 && usedGenCount > 0
      ? 'mixed'
      : usedHtmlCount > 0
      ? 'html_scrape'
      : usedGenCount > 0
      ? 'sequential_pattern'
      : 'tmdb_only';

  const statusSummary: SeasonDiscoveryResult['status'] =
    foundCount === expectedEpisodes ? 'completed' : foundCount > 0 ? 'partial' : 'pending';

  const message =
    foundCount === expectedEpisodes
      ? `Todos os ${expectedEpisodes} episódios da ${seasonName} foram descobertos com sucesso.`
      : foundCount > 0
      ? `${foundCount} de ${expectedEpisodes} episódios descobertos. Pode preencher os restantes manualmente.`
      : 'Nenhum episódio descoberto automaticamente. Insira os links manualmente.';

  return {
    seasonNumber,
    seasonName,
    expectedEpisodes,
    foundCount,
    pendingCount,
    foundEpisodesCount: foundCount,
    pendingEpisodesCount: pendingCount,
    readyEpisodesCount,
    strategy,
    status: statusSummary,
    message,
    episodes: finalEpisodes
  };
}

