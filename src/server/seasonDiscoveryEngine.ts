import {
  BatchDiscoveredEpisode,
  BatchDiscoveredMovieItem,
  BatchDiscoveredSeason,
  BatchEpisodeSourceDraft,
  BatchSeriesDiscoveryGroup,
  DetailedDiscoveryState,
  DiscoveredEpisodeVerificationStatus,
  PlaybackCompatibilityStatus,
  SeasonDiscoveryJob,
  SeasonUrlPatternAdapterType
} from '../types.js';
import {
  AnalyzerDependencies,
  analyzeExternalLink,
  extractHintsFromUrl
} from './linkAnalyzer.js';
import { validatePublicHttpUrl } from './sourceProbe.js';
import { stripMgebPrefix, buildMgebUrl, formatMgebDisplayUrl } from '../lib/mgebUtils.js';
import { classifySourceUrl } from '../lib/sourceClassification.js';

export interface SeasonPatternDetectionResult {
  adapterType: SeasonUrlPatternAdapterType;
  requiresManualReview: boolean;
  cleanBaseUrl: string;
  seasonNumberHint?: number;
  providerId?: string;
  patternNotice: string;
  buildEpisodeUrl: (epNum: number) => string;
}

interface SafeFetchResult {
  ok: boolean;
  httpStatus: number | null;
  finalUrl: string;
  redirectedToRootOrCatalog: boolean;
  contentType: string | null;
  html: string;
  protectionDetected: boolean;
  protectionType: 'cloudflare' | 'captcha' | 'auth' | 'paywall' | 'forbidden' | null;
  isTransientFailure: boolean;
  isDefinitiveNotFound: boolean;
  errorMessage: string | null;
}

interface CacheEntry {
  expiresAt: number;
  result: SafeFetchResult;
}

const PAGE_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 600;

function getCachedFetch(url: string): SafeFetchResult | null {
  const entry = PAGE_CACHE.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    PAGE_CACHE.delete(url);
    return null;
  }
  return entry.result;
}

function setCachedFetch(url: string, result: SafeFetchResult) {
  if (PAGE_CACHE.size >= MAX_CACHE_ENTRIES) {
    const firstKey = PAGE_CACHE.keys().next().value;
    if (firstKey) PAGE_CACHE.delete(firstKey);
  }
  PAGE_CACHE.set(url, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result
  });
}

export function clearSeasonDiscoveryCache() {
  PAGE_CACHE.clear();
}

/**
 * URL Pattern Adapters: supports multiple provider structures without hardcoding a single site.
 * Never assumes all providers work identically; marks ambiguous URLs as manual_review_required.
 */
export function detectSeasonUrlPattern(rawUrl: string): SeasonPatternDetectionResult {
  const stripped = stripMgebPrefix(rawUrl.trim());
  const cleanUrl = (stripped.innerUrl || rawUrl).trim();
  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    return {
      adapterType: 'manual_review_required',
      requiresManualReview: true,
      cleanBaseUrl: cleanUrl,
      patternNotice: 'URL malformada — revisão manual necessária.',
      buildEpisodeUrl: () => cleanUrl
    };
  }

  const hints = extractHintsFromUrl(parsed);
  const path = parsed.pathname.replace(/\/+$/, '');
  const search = parsed.search;

  // Adapter 1: Explicit query param (?episode=1, ?ep=1, ?e=1, ?episodio=1)
  for (const key of ['episode', 'episodio', 'ep', 'e']) {
    const val = parsed.searchParams.get(key);
    if (val && /^\d{1,3}$/.test(val)) {
      return {
        adapterType: 'query_param',
        requiresManualReview: false,
        cleanBaseUrl: cleanUrl,
        seasonNumberHint: hints.hintedSeasonNumber,
        providerId: hints.providerId,
        patternNotice: `Adaptador query param (?${key}={episodio})`,
        buildEpisodeUrl: (epNum: number) => {
          const clone = new URL(parsed.toString());
          clone.searchParams.set(key, String(epNum));
          return clone.toString();
        }
      };
    }
  }

  // Adapter 2: SxxExx pattern in path/filename
  const sxxMatch = path.match(/^(.*s\d{1,2}e)(\d{1,3})([^/]*)$/i);
  if (sxxMatch) {
    const [, prefix, rawDigits, suffix] = sxxMatch;
    const width = rawDigits.length > 1 ? rawDigits.length : 0;
    return {
      adapterType: 'sxxexx_filename',
      requiresManualReview: false,
      cleanBaseUrl: cleanUrl,
      seasonNumberHint: hints.hintedSeasonNumber,
      providerId: hints.providerId,
      patternNotice: 'Adaptador SxxExx detetado no endereço.',
      buildEpisodeUrl: (epNum: number) => {
        const seg = width > 0 ? String(epNum).padStart(width, '0') : String(epNum);
        return `${parsed.origin}${prefix}${seg}${suffix}${search}`;
      }
    };
  }

  // Adapter 3: Explicit /episode/1, /episodio/1, /ep/1 segments
  const explicitEpSeg = path.match(/^(.*\/(?:episode|episodio|ep)[-_]?)\d{1,3}(\/?)$/i);
  if (explicitEpSeg) {
    const [, prefix] = explicitEpSeg;
    return {
      adapterType: 'episode_segment',
      requiresManualReview: false,
      cleanBaseUrl: `${parsed.origin}${path}${search}`,
      seasonNumberHint: hints.hintedSeasonNumber,
      providerId: hints.providerId,
      patternNotice: 'Adaptador de segmento explícito (/episodio/{n}).',
      buildEpisodeUrl: (epNum: number) => `${parsed.origin}${prefix}${epNum}${search}`
    };
  }

  // Adapter 4: /temporada/{n} or /season/{n}
  const tempMatch = path.match(/^(.*\/(?:temporada|season|temp)\/(\d{1,2}))(?:\/(\d{1,3}))?$/i);
  if (tempMatch) {
    const [, baseWithSeason, sDigits, trailingEp] = tempMatch;
    const sNum = parseInt(sDigits, 10);
    return {
      adapterType: 'temporada_segment',
      requiresManualReview: false,
      cleanBaseUrl: `${parsed.origin}${baseWithSeason}${search}`,
      seasonNumberHint: sNum,
      providerId: hints.providerId,
      patternNotice: `Adaptador de temporada na rota (/temporada/${sNum} -> Ep 2+ = /${trailingEp ? '{n}' : '{n}'}).`,
      buildEpisodeUrl: (epNum: number) => {
        if (epNum === 1 && !trailingEp) {
          return `${parsed.origin}${baseWithSeason}${search}`;
        }
        return `${parsed.origin}${baseWithSeason}/${epNum}${search}`;
      }
    };
  }

  // Adapter 5: Detail / Series Season URL where base URL = Ep 1 and Ep 2+ = base/{epNum}
  // e.g. https://ver.123pelicula.com/pt/detail/drama/gjG2CqKaqR601v37CBElT-The-Mentalist-Season-1
  // or already ending with /1 or /2
  const detailTrailingNum = path.match(/^(.*\/detail\/[^/]+)\/(\d{1,3})$/i);
  if (detailTrailingNum) {
    const [, basePath] = detailTrailingNum;
    return {
      adapterType: 'detail_trailing_number',
      requiresManualReview: false,
      cleanBaseUrl: `${parsed.origin}${basePath}${search}`,
      seasonNumberHint: hints.hintedSeasonNumber,
      providerId: hints.providerId,
      patternNotice: 'Adaptador /detail/... (Ep 1 = URL principal, Ep 2+ = /{numero}).',
      buildEpisodeUrl: (epNum: number) =>
        epNum === 1
          ? `${parsed.origin}${basePath}${search}`
          : `${parsed.origin}${basePath}/${epNum}${search}`
    };
  }

  const isDetailOrSeasonSlug =
    /\/detail\//i.test(path) ||
    /(?:season|temporada)[-_/\s]*\d{1,2}/i.test(path) ||
    /\/(?:series|serie|drama|dorama|anime)\//i.test(path);

  if (isDetailOrSeasonSlug) {
    // If there's a trailing /{n} that is NOT part of Season-N / Temporada-N
    const genericTrailing = path.match(/^(.*)\/(\d{1,3})$/);
    const basePath = genericTrailing ? genericTrailing[1] : path;
    return {
      adapterType: 'detail_trailing_number',
      requiresManualReview: false,
      cleanBaseUrl: `${parsed.origin}${basePath}${search}`,
      seasonNumberHint: hints.hintedSeasonNumber,
      providerId: hints.providerId,
      patternNotice: 'Adaptador de página principal de temporada (Ep 1 = base, Ep 2+ = base/{numero}).',
      buildEpisodeUrl: (epNum: number) =>
        epNum === 1
          ? `${parsed.origin}${basePath}${search}`
          : `${parsed.origin}${basePath}/${epNum}${search}`
    };
  }

  // Generic fallback for any valid HTTP(S) season URL: Ep 1 = exact URL, Ep 2+ = URL/{epNum}
  const genericTrailing = path.match(/^(.*)\/(\d{1,3})$/);
  const basePath = genericTrailing ? genericTrailing[1] : path;
  const endsWithNum = Boolean(genericTrailing);
  return {
    adapterType: 'detail_trailing_number',
    requiresManualReview: false,
    cleanBaseUrl: `${parsed.origin}${endsWithNum ? path : basePath}${search}`,
    seasonNumberHint: hints.hintedSeasonNumber,
    providerId: hints.providerId,
    patternNotice: endsWithNum
      ? 'Adaptador numérico final (Ep 1 = .../1, Ep 2+ = .../{numero}).'
      : 'Adaptador de URL-base da temporada (Ep 1 = base, Ep 2+ = base/{numero}).',
    buildEpisodeUrl: (epNum: number) => {
      if (epNum === 1) {
        return endsWithNum
          ? `${parsed.origin}${path}${search}`
          : `${parsed.origin}${basePath}${search}`;
      }
      return `${parsed.origin}${basePath}/${epNum}${search}`;
    }
  };
}

function decodeHtml(str: string): string {
  return (str || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIsoDurationMinutes(raw?: string | number | null): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (!raw || typeof raw !== 'string') return undefined;
  const iso = raw.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (iso) {
    const h = iso[1] ? parseInt(iso[1], 10) : 0;
    const m = iso[2] ? parseInt(iso[2], 10) : 0;
    const total = h * 60 + m;
    if (total > 0) return total;
  }
  const mins = raw.match(/(\d{1,3})\s*(?:min|m\b)/i);
  if (mins) return parseInt(mins[1], 10);
  return undefined;
}

/**
 * SSRF-safe external HTTP fetch with manual redirect validation (max 3 hops),
 * timeout, and controlled retries ONLY on transient network/5xx errors.
 */
async function safeFetchExternalPage(
  targetUrl: string,
  options?: { timeoutMs?: number; retries?: number; skipCache?: boolean }
): Promise<SafeFetchResult> {
  if (!options?.skipCache) {
    const cached = getCachedFetch(targetUrl);
    if (cached) return cached;
  }

  const timeoutMs = options?.timeoutMs ?? 6500;
  const maxRetries = options?.retries ?? 2;

  let lastResult: SafeFetchResult = {
    ok: false,
    httpStatus: null,
    finalUrl: targetUrl,
    redirectedToRootOrCatalog: false,
    contentType: null,
    html: '',
    protectionDetected: false,
    protectionType: null,
    isTransientFailure: true,
    isDefinitiveNotFound: false,
    errorMessage: 'Falha de rede ao consultar página externa.'
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let currentUrl = targetUrl;
    let redirectHops = 0;

    try {
      while (redirectHops <= 3) {
        const ssrf = await validatePublicHttpUrl(currentUrl);
        if (!ssrf.safe) {
          lastResult = {
            ok: false,
            httpStatus: null,
            finalUrl: currentUrl,
            redirectedToRootOrCatalog: false,
            contentType: null,
            html: '',
            protectionDetected: false,
            protectionType: null,
            isTransientFailure: false,
            isDefinitiveNotFound: false,
            errorMessage: ssrf.reason || 'Destino bloqueado pela política SSRF.'
          };
          return lastResult;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let resp: Response;
        try {
          resp = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
              'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8'
            }
          });
        } finally {
          clearTimeout(timer);
        }

        // Handle HTTP redirects with SSRF validation on every hop
        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get('location');
          if (!location) break;
          const nextUrl = new URL(location, currentUrl).toString();
          currentUrl = nextUrl;
          redirectHops++;
          continue;
        }

        const ct = resp.headers.get('content-type');
        const rawText = (await resp.text()).slice(0, 350000);
        const lower = rawText.toLowerCase();
        const serverHdr = (resp.headers.get('server') || '').toLowerCase();

        const targetPath = new URL(targetUrl).pathname.replace(/\/+$/, '');
        const finalPath = new URL(currentUrl).pathname.replace(/\/+$/, '');
        const redirectedToRootOrCatalog =
          redirectHops > 0 && (finalPath === '' || finalPath === '/pt' || finalPath === '/en' || !finalPath.startsWith(targetPath.replace(/\/\d+$/, '')));

        // Protection detection (Cloudflare, CAPTCHA, Auth, Paywall)
        if (
          (serverHdr.includes('cloudflare') || lower.includes('cloudflare') || lower.includes('attention required')) &&
          (resp.status === 403 || resp.status === 503 || lower.includes('cf-chl') || lower.includes('just a moment'))
        ) {
          lastResult = {
            ok: false,
            httpStatus: resp.status,
            finalUrl: currentUrl,
            redirectedToRootOrCatalog,
            contentType: ct,
            html: rawText,
            protectionDetected: true,
            protectionType: 'cloudflare',
            isTransientFailure: false,
            isDefinitiveNotFound: false,
            errorMessage: `Proteção Cloudflare (HTTP ${resp.status}) impede verificação automática direta.`
          };
          setCachedFetch(targetUrl, lastResult);
          return lastResult;
        }

        if (lower.includes('g-recaptcha') || lower.includes('hcaptcha') || lower.includes('turnstile')) {
          lastResult = {
            ok: false,
            httpStatus: resp.status,
            finalUrl: currentUrl,
            redirectedToRootOrCatalog,
            contentType: ct,
            html: rawText,
            protectionDetected: true,
            protectionType: 'captcha',
            isTransientFailure: false,
            isDefinitiveNotFound: false,
            errorMessage: 'Página protegida por CAPTCHA.'
          };
          setCachedFetch(targetUrl, lastResult);
          return lastResult;
        }

        if (resp.status === 404 || resp.status === 410) {
          lastResult = {
            ok: false,
            httpStatus: resp.status,
            finalUrl: currentUrl,
            redirectedToRootOrCatalog,
            contentType: ct,
            html: rawText,
            protectionDetected: false,
            protectionType: null,
            isTransientFailure: false,
            isDefinitiveNotFound: true,
            errorMessage: `Episódio inexistente (HTTP ${resp.status}).`
          };
          setCachedFetch(targetUrl, lastResult);
          return lastResult;
        }

        if (resp.status === 401 || resp.status === 403) {
          lastResult = {
            ok: false,
            httpStatus: resp.status,
            finalUrl: currentUrl,
            redirectedToRootOrCatalog,
            contentType: ct,
            html: rawText,
            protectionDetected: true,
            protectionType: resp.status === 401 ? 'auth' : 'forbidden',
            isTransientFailure: false,
            isDefinitiveNotFound: false,
            errorMessage: `Acesso bloqueado pelo servidor externo (HTTP ${resp.status}).`
          };
          setCachedFetch(targetUrl, lastResult);
          return lastResult;
        }

        if (resp.status === 429 || resp.status >= 500) {
          lastResult = {
            ok: false,
            httpStatus: resp.status,
            finalUrl: currentUrl,
            redirectedToRootOrCatalog,
            contentType: ct,
            html: rawText,
            protectionDetected: resp.status === 429,
            protectionType: resp.status === 429 ? 'forbidden' : null,
            isTransientFailure: true,
            isDefinitiveNotFound: false,
            errorMessage: `Falha temporária do servidor remoto (HTTP ${resp.status}).`
          };
          break; // Retry on transient
        }

        lastResult = {
          ok: resp.ok,
          httpStatus: resp.status,
          finalUrl: currentUrl,
          redirectedToRootOrCatalog,
          contentType: ct,
          html: rawText,
          protectionDetected: false,
          protectionType: null,
          isTransientFailure: false,
          isDefinitiveNotFound: false,
          errorMessage: resp.ok ? null : `HTTP ${resp.status}`
        };
        setCachedFetch(targetUrl, lastResult);
        return lastResult;
      }
    } catch (err: any) {
      lastResult = {
        ok: false,
        httpStatus: null,
        finalUrl: currentUrl,
        redirectedToRootOrCatalog: false,
        contentType: null,
        html: '',
        protectionDetected: false,
        protectionType: null,
        isTransientFailure: true,
        isDefinitiveNotFound: false,
        errorMessage:
          err?.name === 'AbortError'
            ? 'Tempo limite excedido ao consultar página externa.'
            : err?.message || 'Erro de rede ao consultar página externa.'
      };
    }

    if (attempt < maxRetries && lastResult.isTransientFailure) {
      await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
    } else {
      break;
    }
  }

  return lastResult;
}

interface ExtractedEpisodePageData {
  isNotFoundPage: boolean;
  title?: string;
  description?: string;
  image?: string;
  duration?: number;
  playbackSourceUrl?: string | null;
  structuredEpisodes: Array<{
    episodeNumber: number;
    title?: string;
    description?: string;
    image?: string;
    duration?: number;
    pageUrl?: string;
    playbackSourceUrl?: string | null;
  }>;
}

/**
 * Safely parses HTML / JSON-LD / __NEXT_DATA__ / anchors without ever executing HTML or JS.
 */
function extractEpisodeDataFromHtml(html: string, baseUrl: string, expectedEpNum?: number): ExtractedEpisodePageData {
  const result: ExtractedEpisodePageData = {
    isNotFoundPage: false,
    structuredEpisodes: []
  };

  if (!html) return result;

  // Check if content is raw JSON API response
  const trimmed = html.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      collectEpisodesFromJsonTree(json, baseUrl, result.structuredEpisodes);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        if (typeof json.title === 'string') result.title = decodeHtml(json.title);
        if (typeof json.name === 'string' && !result.title) result.title = decodeHtml(json.name);
        if (typeof json.description === 'string') result.description = decodeHtml(json.description);
        if (typeof json.image === 'string') result.image = json.image;
        result.duration = parseIsoDurationMinutes(json.duration);
        if (typeof json.videoUrl === 'string' || typeof json.streamUrl === 'string') {
          result.playbackSourceUrl = json.videoUrl || json.streamUrl;
        }
      }
      return result;
    } catch {}
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = titleMatch?.[1] ? decodeHtml(titleMatch[1]) : undefined;
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match?.[1] ? decodeHtml(h1Match[1].replace(/<[^>]+>/g, ' ')) : undefined;
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const ogDesc =
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];

  const combinedHeading = `${rawTitle || ''} ${h1Text || ''} ${ogTitle || ''}`.toLowerCase();
  if (
    /\b404\b|p[aá]gina n[aã]o encontrada|page not found|epis[oó]dio n[aã]o encontrado|episode not found|n[aã]o dispon[ií]vel/.test(
      combinedHeading
    )
  ) {
    result.isNotFoundPage = true;
    return result;
  }

  result.title = ogTitle ? decodeHtml(ogTitle) : h1Text || rawTitle;
  result.description = ogDesc ? decodeHtml(ogDesc) : undefined;
  result.image = ogImage ? decodeHtml(ogImage) : undefined;

  // Direct video/source extraction ONLY if explicit playable stream/embed exists
  const videoSrcMatch =
    html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|m3u8|webm|mpd)[^"']*)["']/i) ||
    html.match(/<video[^>]+src=["']([^"']+\.(?:mp4|m3u8|webm|mpd)[^"']*)["']/i);
  if (videoSrcMatch?.[1]) {
    try {
      const absStream = new URL(videoSrcMatch[1], baseUrl).toString();
      const cls = classifySourceUrl(absStream);
      if (cls.valid && cls.sourceKind !== 'WEB_PAGE') {
        result.playbackSourceUrl = absStream;
      }
    } catch {}
  }

  // JSON-LD parsing
  const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(ldMatch[1].trim());
      collectEpisodesFromJsonTree(parsed, baseUrl, result.structuredEpisodes);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        const atType = String(n['@type'] || '').toLowerCase();
        if (atType.includes('tvepisode') || !expectedEpNum || Number(n.episodeNumber) === expectedEpNum) {
          if (typeof n.name === 'string') result.title = decodeHtml(n.name);
          if (typeof n.description === 'string') result.description = decodeHtml(n.description);
          if (typeof n.image === 'string') result.image = n.image;
          if (!result.duration) result.duration = parseIsoDurationMinutes(n.duration || n.timeRequired);
          if (!result.playbackSourceUrl && typeof n.contentUrl === 'string') {
            const cls = classifySourceUrl(n.contentUrl);
            if (cls.valid && cls.sourceKind !== 'WEB_PAGE') result.playbackSourceUrl = n.contentUrl;
          }
        }
      }
    } catch {}
  }

  // __NEXT_DATA__ structured payload scan (read-only JSON parse)
  const nextMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch?.[1]) {
    try {
      const nextJson = JSON.parse(nextMatch[1]);
      collectEpisodesFromJsonTree(nextJson, baseUrl, result.structuredEpisodes);
    } catch {}
  }

  // Anchor episode listing extraction matching same origin/slug
  const parsedBase = new URL(baseUrl);
  const anchorRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let aMatch: RegExpExecArray | null;
  let scanned = 0;
  const seenEps = new Set(result.structuredEpisodes.map(e => e.episodeNumber));

  while ((aMatch = anchorRegex.exec(html)) !== null && scanned < 600) {
    scanned++;
    const rawHref = aMatch[1]?.trim();
    const label = decodeHtml((aMatch[2] || '').replace(/<[^>]+>/g, ' '));
    if (!rawHref || rawHref.startsWith('javascript:')) continue;
    let abs: URL;
    try {
      abs = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }
    if (abs.origin !== parsedBase.origin) continue;
    const baseClean = parsedBase.pathname.replace(/\/+$/, '').replace(/\/\d+$/, '');
    const hrefClean = abs.pathname.replace(/\/+$/, '');

    let epNum: number | null = null;
    if (baseClean && hrefClean === baseClean) {
      epNum = 1;
    } else if (baseClean && hrefClean.startsWith(baseClean + '/')) {
      const rest = hrefClean.slice(baseClean.length + 1);
      if (/^\d{1,3}$/.test(rest)) epNum = parseInt(rest, 10);
    } else {
      const se = `${abs.pathname} ${label}`.match(/(?:epis[oó]dio|episode|ep)\s*[-_:/]?\s*(\d{1,3})\b/i);
      if (se && hrefClean.includes(baseClean.split('/').pop()?.split('-')[0] || '___')) {
        epNum = parseInt(se[1], 10);
      }
    }

    if (epNum && epNum >= 1 && epNum <= 5000 && !seenEps.has(epNum)) {
      seenEps.add(epNum);
      result.structuredEpisodes.push({
        episodeNumber: epNum,
        title: label && !/^\d+$/.test(label) ? label : undefined,
        pageUrl: abs.toString()
      });
    }
  }

  result.structuredEpisodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  return result;
}

function collectEpisodesFromJsonTree(
  node: any,
  baseUrl: string,
  out: ExtractedEpisodePageData['structuredEpisodes'],
  depth = 0
) {
  if (!node || typeof node !== 'object' || depth > 7) return;
  if (Array.isArray(node)) {
    for (const item of node) collectEpisodesFromJsonTree(item, baseUrl, out, depth + 1);
    return;
  }

  const epNumRaw = node.episodeNumber ?? node.episode_number ?? node.ep ?? node.episode;
  if (
    (typeof epNumRaw === 'number' || (typeof epNumRaw === 'string' && /^\d{1,4}$/.test(epNumRaw))) &&
    (node.title || node.name || node.url || node.slug || node['@type'] === 'TVEpisode')
  ) {
    const epNum = Number(epNumRaw);
    if (epNum >= 1 && epNum <= 5000 && !out.some(e => e.episodeNumber === epNum)) {
      let resolvedUrl: string | undefined;
      if (typeof node.url === 'string') {
        try {
          resolvedUrl = new URL(node.url, baseUrl).toString();
        } catch {}
      }
      let playUrl: string | null = null;
      const candStream = node.contentUrl || node.streamUrl || node.videoUrl || node.mp4 || node.m3u8;
      if (typeof candStream === 'string') {
        const cls = classifySourceUrl(candStream);
        if (cls.valid && cls.sourceKind !== 'WEB_PAGE') playUrl = candStream;
      }
      out.push({
        episodeNumber: epNum,
        title: typeof (node.name || node.title) === 'string' ? decodeHtml(node.name || node.title) : undefined,
        description: typeof (node.description || node.overview) === 'string' ? decodeHtml(node.description || node.overview) : undefined,
        image: typeof (node.image || node.stillPath || node.thumbnailUrl) === 'string' ? (node.image || node.stillPath || node.thumbnailUrl) : undefined,
        duration: parseIsoDurationMinutes(node.duration),
        pageUrl: resolvedUrl,
        playbackSourceUrl: playUrl
      });
    }
  }

  for (const key of Object.keys(node).slice(0, 40)) {
    if (typeof node[key] === 'object') {
      collectEpisodesFromJsonTree(node[key], baseUrl, out, depth + 1);
    }
  }
}

function makeShortUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function resolveDetailedDiscoveryState(params: {
  verificationStatus: DiscoveredEpisodeVerificationStatus;
  playbackCompatibility: PlaybackCompatibilityStatus;
  protectionDetected?: boolean;
  httpStatus?: number | null;
  manualConfirmed?: boolean;
  hasProcessedMgeb?: boolean;
  hasTmdbMetadata?: boolean;
  diagnosticMessage?: string;
}): { detailedState: DetailedDiscoveryState; stateReason: string } {
  const {
    verificationStatus,
    playbackCompatibility,
    protectionDetected,
    httpStatus,
    manualConfirmed,
    hasProcessedMgeb,
    hasTmdbMetadata,
    diagnosticMessage
  } = params;

  if (playbackCompatibility === 'incompatible') {
    return {
      detailedState: 'incompatible_player',
      stateReason: diagnosticMessage || 'Fonte incompatível com reprodução direta ou embed no player.'
    };
  }

  if (playbackCompatibility === 'compatible' && (verificationStatus === 'verified' || manualConfirmed)) {
    return {
      detailedState: 'functional_source',
      stateReason: diagnosticMessage || 'Página verificada e fluxo de reprodução confirmado.'
    };
  }

  if (manualConfirmed) {
    return {
      detailedState: 'verified',
      stateReason: diagnosticMessage || 'Confirmado manualmente pelo administrador.'
    };
  }

  if (verificationStatus === 'verified') {
    return {
      detailedState: 'verified',
      stateReason:
        diagnosticMessage ||
        'Página confirmada no provedor (HTTP 200); prefixo MGEB aplicado — reprodução aguarda confirmação.'
    };
  }

  if (protectionDetected || httpStatus === 401 || httpStatus === 403) {
    return {
      detailedState: 'blocked_by_provider',
      stateReason:
        diagnosticMessage ||
        `Bloqueado pelo provedor (HTTP ${httpStatus || 403} / Cloudflare); URL com prefixo MGEB gerada e estrutura alinhada pela TMDB.`
    };
  }

  if (verificationStatus === 'pending') {
    return {
      detailedState: 'transient_error',
      stateReason:
        diagnosticMessage ||
        `Erro temporário ao consultar provedor (HTTP ${httpStatus || 'timeout'}); repetição recomendada.`
    };
  }

  if (verificationStatus === 'error') {
    return {
      detailedState: 'unverified',
      stateReason: diagnosticMessage || 'Não foi possível verificar o link na origem.'
    };
  }

  if (hasProcessedMgeb) {
    return {
      detailedState: 'mgeb_applied',
      stateReason:
        diagnosticMessage ||
        'Prefixo MGEB aplicado sobre URL gerada; reprodução ainda não confirmada.'
    };
  }

  if (hasTmdbMetadata) {
    return {
      detailedState: 'tmdb_prepared',
      stateReason: diagnosticMessage || 'Estrutura preparada pela TMDB.'
    };
  }

  return {
    detailedState: 'unverified',
    stateReason: diagnosticMessage || 'Aguardando verificação.'
  };
}

/**
 * Tests whether an MGEB-wrapped URL (or raw stream) yields a real playable stream
 * without mistakenly trusting dummy/rate-limited M3U8 placeholders (e.g. delivery-limit).
 */
export async function verifyMgebCompatibility(rawOrProcessedUrl: string): Promise<{
  compatibilityStatus: PlaybackCompatibilityStatus;
  compatibilityMessage: string;
  processedUrl: string;
  processedUrlDisplay: string;
  httpStatus: number | null;
  contentType: string | null;
}> {
  const stripped = stripMgebPrefix((rawOrProcessedUrl || '').trim());
  const built = buildMgebUrl(stripped.innerUrl || rawOrProcessedUrl, true);
  if (!built.valid) {
    return {
      compatibilityStatus: 'incompatible',
      compatibilityMessage: built.error || 'URL inválida para processamento MGEB.',
      processedUrl: built.finalUrl,
      processedUrlDisplay: built.displayFinalUrl,
      httpStatus: null,
      contentType: null
    };
  }

  let currentUrl = built.finalUrl;
  let hops = 0;

  try {
    while (hops <= 3) {
      const ssrf = await validatePublicHttpUrl(currentUrl);
      if (!ssrf.safe) {
        return {
          compatibilityStatus: 'incompatible',
          compatibilityMessage: ssrf.reason || 'Destino bloqueado pela política SSRF.',
          processedUrl: built.finalUrl,
          processedUrlDisplay: built.displayFinalUrl,
          httpStatus: null,
          contentType: null
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      let resp: Response;
      try {
        resp = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            Accept: '*/*',
            Range: 'bytes=0-8191'
          }
        });
      } finally {
        clearTimeout(timer);
      }

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (!loc) break;
        currentUrl = new URL(loc, currentUrl).toString();
        hops++;
        continue;
      }

      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (resp.status >= 400) {
        return {
          compatibilityStatus: 'unresolved',
          compatibilityMessage: `Prefixo aplicado — reprodução não confirmada (MGEB retornou HTTP ${resp.status}).`,
          processedUrl: built.finalUrl,
          processedUrlDisplay: built.displayFinalUrl,
          httpStatus: resp.status,
          contentType: ct || null
        };
      }

      const textSnippet = ct.includes('video/') ? '' : (await resp.text()).slice(0, 8192);
      const lower = textSnippet.toLowerCase();

      // Critical: MGEB frequently returns HTTP 206 M3U8 pointing to delivery-limit-* placeholders even for nonexistent URLs!
      if (
        lower.includes('delivery-limit') ||
        lower.includes('rate limit') ||
        lower.includes('limit exceeded') ||
        lower.includes('cloudflare') ||
        lower.includes('attention required')
      ) {
        return {
          compatibilityStatus: 'unresolved',
          compatibilityMessage:
            'Prefixo aplicado — reprodução não confirmada (resposta provisória/delivery-limit do endpoint MGEB).',
          processedUrl: built.finalUrl,
          processedUrlDisplay: built.displayFinalUrl,
          httpStatus: resp.status,
          contentType: ct || null
        };
      }

      if (
        ct.includes('video/mp4') ||
        ct.includes('video/webm') ||
        ct.includes('application/dash+xml')
      ) {
        return {
          compatibilityStatus: 'compatible',
          compatibilityMessage: `Fluxo direto compatível (${ct}).`,
          processedUrl: built.finalUrl,
          processedUrlDisplay: built.displayFinalUrl,
          httpStatus: resp.status,
          contentType: ct
        };
      }

      if (ct.includes('mpegurl') || textSnippet.trimStart().startsWith('#EXTM3U')) {
        // Verify referenced variant/segment does not immediately fail or resolve to HTML/delivery-limit
        const lines = textSnippet
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
        if (lines.length === 0) {
          return {
            compatibilityStatus: 'unresolved',
            compatibilityMessage: 'Prefixo aplicado — reprodução não confirmada (manifesto HLS vazio).',
            processedUrl: built.finalUrl,
            processedUrlDisplay: built.displayFinalUrl,
            httpStatus: resp.status,
            contentType: ct || null
          };
        }
        return {
          compatibilityStatus: 'compatible',
          compatibilityMessage: 'Manifesto HLS (#EXTM3U) válido devolvido sem bloqueio de limite.',
          processedUrl: built.finalUrl,
          processedUrlDisplay: built.displayFinalUrl,
          httpStatus: resp.status,
          contentType: ct || 'application/vnd.apple.mpegurl'
        };
      }

      if (ct.includes('text/html') || lower.includes('<html')) {
        return {
          compatibilityStatus: 'unresolved',
          compatibilityMessage:
            'Prefixo aplicado — reprodução não confirmada (MGEB retornou HTML em vez de fluxo de vídeo).',
          processedUrl: built.finalUrl,
          processedUrlDisplay: built.displayFinalUrl,
          httpStatus: resp.status,
          contentType: ct || null
        };
      }

      return {
        compatibilityStatus: 'unresolved',
        compatibilityMessage: `Prefixo aplicado — reprodução não confirmada (${ct || 'formato não verificado'}).`,
        processedUrl: built.finalUrl,
        processedUrlDisplay: built.displayFinalUrl,
        httpStatus: resp.status,
        contentType: ct || null
      };
    }

    return {
      compatibilityStatus: 'unresolved',
      compatibilityMessage: 'Prefixo aplicado — reprodução não confirmada (excesso de redirecionamentos).',
      processedUrl: built.finalUrl,
      processedUrlDisplay: built.displayFinalUrl,
      httpStatus: null,
      contentType: null
    };
  } catch (err: any) {
    return {
      compatibilityStatus: 'unresolved',
      compatibilityMessage: `Prefixo aplicado — reprodução não confirmada (${err?.message || 'falha de rede'}).`,
      processedUrl: built.finalUrl,
      processedUrlDisplay: built.displayFinalUrl,
      httpStatus: null,
      contentType: null
    };
  }
}

/**
 * Discovers all available episodes for a single season using:
 * 1) Structured data / public JSON
 * 2) HTML episode listing
 * 3) Controlled sequential probing with safe end-of-season detection
 * Always binds strictly to THIS season's own `mainUrl` and automatically applies MGEB prefix to every episode link.
 */
export async function discoverSeasonEpisodesBatchItem(
  season: BatchDiscoveredSeason,
  tmdbId: number,
  deps: AnalyzerDependencies,
  options: {
    maxEpisodesLimit: number;
    existingMedia?: any;
    onlyFailed?: boolean;
    manualHtml?: string;
    skipExternalVerification?: boolean;
    isAborted?: () => boolean;
    onProgress?: () => void;
  }
): Promise<BatchDiscoveredSeason> {
  const maxLimit = Math.max(1, Math.min(5000, options.maxEpisodesLimit || 250));
  const strippedMain = stripMgebPrefix(season.mainUrl);
  season.mainUrl = (strippedMain.innerUrl || season.mainUrl).trim();
  const mainBuilt = buildMgebUrl(season.mainUrl, true);
  season.processedMainUrl = mainBuilt.finalUrl || season.mainUrl;
  season.seriesId = season.seriesId || `tv-${tmdbId}`;
  season.seasonId = season.seasonId || makeShortUid(`s-${tmdbId}-${season.seasonNumber}`);

  const pattern = detectSeasonUrlPattern(season.mainUrl);
  season.adapterType = pattern.adapterType;
  season.requiresManualReview = pattern.requiresManualReview;
  season.patternNotice = pattern.patternNotice;
  season.providerId = season.providerId || pattern.providerId;

  if (pattern.requiresManualReview) {
    season.status = 'error';
    season.detailedState = 'unverified';
    season.stateReason = pattern.patternNotice;
    season.errorMessage = pattern.patternNotice;
    return season;
  }

  // Fetch official TMDB data for this exact season (never assumes counts across seasons)
  let tmdbSeason: any = null;
  for (let tTry = 0; tTry < 2; tTry++) {
    try {
      tmdbSeason = await deps.fetchTMDB(`/tv/${tmdbId}/season/${season.seasonNumber}`, {}, AbortSignal.timeout(8000));
      if (tmdbSeason && Array.isArray(tmdbSeason.episodes)) break;
    } catch {}
  }

  const tmdbEps: any[] = Array.isArray(tmdbSeason?.episodes) ? tmdbSeason.episodes : [];
  season.name =
    tmdbSeason?.name ||
    season.name ||
    (season.seasonNumber === 0 ? 'Especiais' : `Temporada ${season.seasonNumber}`);
  season.overview = tmdbSeason?.overview || season.overview;
  season.posterPath = tmdbSeason?.poster_path
    ? `https://image.tmdb.org/t/p/w500${tmdbSeason.poster_path}`
    : season.posterPath;

  const expectedCountFromTmdb = tmdbEps.length > 0 ? tmdbEps.length : Number(season.tmdbExpectedCount || 0);
  season.tmdbExpectedCount = expectedCountFromTmdb;

  // Rule 6: If TMDB is unavailable and we don't know real episode count, NEVER invent quantities; preserve mainUrl to resume later
  if (expectedCountFromTmdb <= 0 && !options.manualHtml && options.skipExternalVerification) {
    season.episodes = [];
    season.status = 'paused';
    season.detailedState = 'awaiting_verification';
    season.errorMessage = 'Metadados da TMDB temporariamente indisponíveis — link principal guardado para retoma.';
    season.stateReason = season.errorMessage;
    options.onProgress?.();
    return season;
  }

  const existingSeason = (options.existingMedia?.seasons || []).find(
    (s: any) => Number(s.seasonNumber) === season.seasonNumber
  );
  const existingEpNums = new Set<number>(
    (existingSeason?.episodes || []).map((e: any) => Number(e.episodeNumber))
  );

  const nowIso = new Date().toISOString();

  const buildTmdbEnrichedEpisode = (
    epNum: number,
    epPageUrl: string,
    overrides: Partial<BatchDiscoveredEpisode>
  ): BatchDiscoveredEpisode => {
    const tmdbEp = tmdbEps.find((e: any) => Number(e.episode_number) === epNum);
    const cleanEpOriginalUrl = stripMgebPrefix(epPageUrl).innerUrl || epPageUrl;
    // ALWAYS generate processed MGEB link from this episode's own original URL (never duplicate prefix!)
    const epMgeb = buildMgebUrl(cleanEpOriginalUrl, true);
    const explicitPlayUrl = overrides.playbackSourceUrl ? String(overrides.playbackSourceUrl).trim() : null;

    const verStatus: DiscoveredEpisodeVerificationStatus = overrides.verificationStatus || 'unconfirmed';
    let playbackCompat: PlaybackCompatibilityStatus = overrides.playbackCompatibility || 'untested';
    let compatMsg = overrides.compatibilityMessage;

    if (explicitPlayUrl && playbackCompat === 'untested') {
      const cls = classifySourceUrl(explicitPlayUrl);
      if (cls.valid && cls.sourceKind !== 'WEB_PAGE') {
        playbackCompat = 'compatible';
        compatMsg = 'Stream direto/embed explícito extraído da página.';
      }
    } else if (!compatMsg) {
      compatMsg = 'Prefixo aplicado — reprodução não confirmada (aguarda teste MGEB ou fonte direta).';
    }

    const sources: BatchEpisodeSourceDraft[] = overrides.sources ? [...overrides.sources] : [];
    if (explicitPlayUrl && sources.length === 0) {
      const playBuilt = buildMgebUrl(explicitPlayUrl, Boolean(overrides.useMgebForPlayback));
      sources.push({
        id: makeShortUid('src'),
        originalUrl: playBuilt.innerUrl || explicitPlayUrl,
        processedUrl: playBuilt.finalUrl || explicitPlayUrl,
        processedUrlDisplay: playBuilt.displayFinalUrl || explicitPlayUrl,
        version: overrides.playbackVersion || 'dublado',
        serverName: overrides.playbackVersion === 'legendado' ? 'Servidor Legendado' : 'Servidor Dublado',
        quality: '1080p',
        useMgeb: Boolean(overrides.useMgebForPlayback),
        compatibilityStatus: playbackCompat,
        compatibilityMessage: compatMsg,
        createdAt: nowIso
      });
    }

    const resolvedState = resolveDetailedDiscoveryState({
      verificationStatus: verStatus,
      playbackCompatibility: playbackCompat,
      protectionDetected: overrides.protectionDetected,
      httpStatus: overrides.httpStatus,
      manualConfirmed: overrides.manualConfirmed,
      hasProcessedMgeb: Boolean(epMgeb.finalUrl),
      hasTmdbMetadata: Boolean(tmdbEp),
      diagnosticMessage: overrides.diagnosticMessage
    });

    return {
      episodeId: overrides.episodeId || `ep-${tmdbId}-s${season.seasonNumber}-e${epNum}`,
      seriesId: season.seriesId,
      seasonId: season.seasonId,
      episodeNumber: epNum,
      title: overrides.title || tmdbEp?.name || `Episódio ${epNum}`,
      overview: overrides.overview || tmdbEp?.overview || undefined,
      stillPath:
        overrides.stillPath ||
        (tmdbEp?.still_path ? `https://image.tmdb.org/t/p/w500${tmdbEp.still_path}` : undefined),
      duration: overrides.duration || tmdbEp?.runtime || undefined,
      airDate: tmdbEp?.air_date || undefined,
      voteAverage: tmdbEp?.vote_average ? Number(tmdbEp.vote_average.toFixed(1)) : undefined,
      originalPageUrl: season.mainUrl,
      episodePageUrl: cleanEpOriginalUrl,
      originalUrl: cleanEpOriginalUrl,
      processedUrl: epMgeb.finalUrl || formatMgebDisplayUrl(cleanEpOriginalUrl),
      processedUrlDisplay: epMgeb.displayFinalUrl || formatMgebDisplayUrl(cleanEpOriginalUrl),
      playbackSourceUrl: explicitPlayUrl,
      playbackVersion: overrides.playbackVersion || 'dublado',
      useMgebForPlayback: overrides.useMgebForPlayback ?? true,
      verificationStatus: verStatus,
      detailedState: resolvedState.detailedState,
      stateReason: resolvedState.stateReason,
      playbackCompatibility: playbackCompat,
      compatibilityMessage: compatMsg,
      manualConfirmed: overrides.manualConfirmed ?? false,
      httpStatus: overrides.httpStatus ?? null,
      protectionDetected: overrides.protectionDetected ?? false,
      diagnosticMessage: overrides.diagnosticMessage || resolvedState.stateReason,
      approved: overrides.approved ?? true,
      existsInCatalog: existingEpNums.has(epNum),
      duplicateSourceExists: false,
      sources,
      createdAt: overrides.createdAt || nowIso
    };
  };

  // If retrying ONLY failed/unconfirmed/pending episodes on an existing episode list
  if (options.onlyFailed && season.episodes.length > 0) {
    season.status = 'discovering';
    season.detailedState = 'awaiting_verification';
    for (let idx = 0; idx < season.episodes.length; idx++) {
      if (options.isAborted?.()) {
        season.status = 'paused';
        return season;
      }
      const ep = season.episodes[idx];
      if (ep.verificationStatus === 'verified') continue;

      const epUrl = ep.originalUrl || ep.episodePageUrl;
      const probe = await safeFetchExternalPage(epUrl, { skipCache: true });
      if (probe.ok) {
        const parsed = extractEpisodeDataFromHtml(probe.html, probe.finalUrl, ep.episodeNumber);
        if (parsed.isNotFoundPage || probe.redirectedToRootOrCatalog) {
          ep.verificationStatus = 'not_found';
          ep.httpStatus = probe.httpStatus;
          ep.diagnosticMessage = 'Página redirecionou ou indicou episódio inexistente.';
        } else {
          ep.verificationStatus = 'verified';
          ep.httpStatus = probe.httpStatus;
          ep.protectionDetected = false;
          ep.title = parsed.title && !/^attention required/i.test(parsed.title) ? parsed.title : ep.title;
          ep.overview = parsed.description || ep.overview;
          ep.stillPath = parsed.image || ep.stillPath;
          ep.duration = parsed.duration || ep.duration;
          if (parsed.playbackSourceUrl) {
            ep.playbackSourceUrl = parsed.playbackSourceUrl;
            ep.playbackCompatibility = 'compatible';
            ep.compatibilityMessage = 'Stream explícito extraído da página.';
          }
          ep.diagnosticMessage = `Página confirmada via HTTP ${probe.httpStatus}.`;
        }
      } else if (probe.isDefinitiveNotFound) {
        ep.verificationStatus = 'not_found';
        ep.httpStatus = probe.httpStatus;
        ep.diagnosticMessage = probe.errorMessage || `HTTP ${probe.httpStatus}`;
      } else {
        ep.verificationStatus = probe.isTransientFailure ? 'pending' : 'unconfirmed';
        ep.httpStatus = probe.httpStatus;
        ep.protectionDetected = probe.protectionDetected;
        ep.diagnosticMessage = probe.errorMessage || 'Não verificado.';
      }

      const resolved = resolveDetailedDiscoveryState({
        verificationStatus: ep.verificationStatus,
        playbackCompatibility: ep.playbackCompatibility,
        protectionDetected: ep.protectionDetected,
        httpStatus: ep.httpStatus,
        manualConfirmed: ep.manualConfirmed,
        hasProcessedMgeb: Boolean(ep.processedUrl),
        hasTmdbMetadata: true,
        diagnosticMessage: ep.diagnosticMessage
      });
      ep.detailedState = resolved.detailedState;
      ep.stateReason = resolved.stateReason;
      options.onProgress?.();
    }
    finalizeSeasonCounts(season);
    return season;
  }

  // Fresh discovery for this season
  season.status = 'discovering';
  season.detailedState = 'awaiting_verification';
  season.errorMessage = null;
  season.endDetectedReason = undefined;
  const discoveredEpisodes: BatchDiscoveredEpisode[] = [];

  // Fast Deterministic Mode (Rule 3 & 5): Generate all 1..N episodes from TMDB count + season baseUrl + MGEB immediately without waiting on provider HTTP
  if (options.skipExternalVerification) {
    if (expectedCountFromTmdb <= 0) {
      season.episodes = [];
      season.status = 'paused';
      season.detailedState = 'awaiting_verification';
      season.errorMessage = 'Metadados da TMDB indisponíveis para esta temporada — link principal guardado para retoma.';
      season.stateReason = season.errorMessage;
      options.onProgress?.();
      return season;
    }

    const countToGenerate = Math.min(maxLimit, expectedCountFromTmdb);
    for (let epNum = 1; epNum <= countToGenerate; epNum++) {
      const epPageUrl = pattern.buildEpisodeUrl(epNum);
      discoveredEpisodes.push(
        buildTmdbEnrichedEpisode(epNum, epPageUrl, {
          verificationStatus: 'unconfirmed',
          diagnosticMessage:
            'Episódio gerado pela TMDB e prefixo MGEB aplicado — aguardando verificação opcional.'
        })
      );
    }
    season.episodes = discoveredEpisodes;
    season.endDetectedReason = `${countToGenerate} episódios gerados | ${countToGenerate} links MGEB aplicados | Aguardando verificação opcional.`;
    finalizeSeasonCounts(season);
    season.status = 'completed';
    season.detailedState = 'mgeb_applied';
    season.stateReason = season.endDetectedReason;
    options.onProgress?.();
    return season;
  }

  // Step 1: Fetch main season page (or inspect manual HTML)
  let mainFetch: SafeFetchResult;
  if (options.manualHtml && options.manualHtml.trim().length > 20) {
    mainFetch = {
      ok: true,
      httpStatus: 200,
      finalUrl: season.mainUrl,
      redirectedToRootOrCatalog: false,
      contentType: 'text/html',
      html: options.manualHtml,
      protectionDetected: false,
      protectionType: null,
      isTransientFailure: false,
      isDefinitiveNotFound: false,
      errorMessage: null
    };
  } else {
    mainFetch = await safeFetchExternalPage(season.mainUrl);
  }

  // Case A: Main season page is protected (e.g. Cloudflare 403 / CAPTCHA / Forbidden)
  if (!mainFetch.ok && mainFetch.protectionDetected) {
    if (expectedCountFromTmdb <= 0) {
      season.episodes = [];
      season.status = 'paused';
      season.detailedState = 'blocked_by_provider';
      season.errorMessage =
        mainFetch.errorMessage ||
        'Provedor bloqueou (HTTP 403) e TMDB não devolveu episódios — link principal guardado para retoma.';
      season.stateReason = season.errorMessage;
      options.onProgress?.();
      return season;
    }
    const countToPrepare = Math.min(maxLimit, expectedCountFromTmdb);
    for (let epNum = 1; epNum <= countToPrepare; epNum++) {
      const epPageUrl = pattern.buildEpisodeUrl(epNum);
      discoveredEpisodes.push(
        buildTmdbEnrichedEpisode(epNum, epPageUrl, {
          verificationStatus: 'unconfirmed',
          httpStatus: mainFetch.httpStatus,
          protectionDetected: true,
          diagnosticMessage:
            mainFetch.errorMessage ||
            `Episódio gerado e prefixo MGEB aplicado; verificação externa bloqueada (${mainFetch.protectionType || 'HTTP 403'}).`
        })
      );
    }
    season.episodes = discoveredEpisodes;
    season.endDetectedReason = `${countToPrepare} episódios gerados | ${countToPrepare} links MGEB aplicados | Verificação externa bloqueada pelo provedor (${mainFetch.protectionType || 'HTTP 403'}).`;
    season.errorMessage = mainFetch.errorMessage;
    finalizeSeasonCounts(season);
    season.status = 'unconfirmed';
    season.detailedState = 'blocked_by_provider';
    season.stateReason = season.endDetectedReason;
    options.onProgress?.();
    return season;
  }

  // Case B: Main season page failed with definitive 404/410
  if (!mainFetch.ok && mainFetch.isDefinitiveNotFound) {
    season.episodes = [];
    season.status = 'error';
    season.detailedState = 'unverified';
    season.errorMessage = mainFetch.errorMessage || `Página da temporada devolveu HTTP ${mainFetch.httpStatus}.`;
    season.endDetectedReason = season.errorMessage;
    season.stateReason = season.errorMessage;
    finalizeSeasonCounts(season);
    options.onProgress?.();
    return season;
  }

  // Case C: Extract structured/HTML episode links from accessible main page
  const mainParsed = mainFetch.ok ? extractEpisodeDataFromHtml(mainFetch.html, mainFetch.finalUrl, 1) : null;
  const structuredMap = new Map<number, ExtractedEpisodePageData['structuredEpisodes'][number]>();
  if (mainParsed?.structuredEpisodes?.length) {
    for (const sEp of mainParsed.structuredEpisodes) {
      if (sEp.episodeNumber <= maxLimit) {
        structuredMap.set(sEp.episodeNumber, sEp);
      }
    }
  }

  // If provider page explicitly returned Ep 1 + structured episode list (>1 episode already listed cleanly)
  if (mainFetch.ok && structuredMap.size >= 2) {
    const maxStructuredEp = Math.max(...Array.from(structuredMap.keys()));
    for (let epNum = 1; epNum <= Math.min(maxLimit, maxStructuredEp); epNum++) {
      const sEp = structuredMap.get(epNum);
      if (!sEp) continue;
      const epUrl = sEp.pageUrl || pattern.buildEpisodeUrl(epNum);
      discoveredEpisodes.push(
        buildTmdbEnrichedEpisode(epNum, epUrl, {
          title: sEp.title,
          overview: sEp.description,
          stillPath: sEp.image,
          duration: sEp.duration,
          playbackSourceUrl: sEp.playbackSourceUrl || null,
          verificationStatus: 'verified',
          httpStatus: mainFetch.httpStatus,
          diagnosticMessage: 'Descoberto na listagem estruturada da página da temporada.'
        })
      );
    }
    season.episodes = discoveredEpisodes;
    season.endDetectedReason = `${discoveredEpisodes.length} episódios extraídos diretamente da página da temporada.`;
    finalizeSeasonCounts(season);
    options.onProgress?.();
    return season;
  }

  // Case D: Sequential URL probing starting from Ep 1 up to maxLimit, stopping cleanly on real end-of-season
  if (mainFetch.ok && !mainParsed?.isNotFoundPage) {
    discoveredEpisodes.push(
      buildTmdbEnrichedEpisode(1, pattern.buildEpisodeUrl(1), {
        title: mainParsed?.title,
        overview: mainParsed?.description,
        stillPath: mainParsed?.image,
        duration: mainParsed?.duration,
        playbackSourceUrl: mainParsed?.playbackSourceUrl || null,
        verificationStatus: 'verified',
        httpStatus: mainFetch.httpStatus,
        diagnosticMessage: `Episódio 1 confirmado na origem (HTTP ${mainFetch.httpStatus}).`
      })
    );
  } else {
    // Transient network/500 on Ep 1 — record honestly as pending/error and continue probing/TMDB fallback
    discoveredEpisodes.push(
      buildTmdbEnrichedEpisode(1, pattern.buildEpisodeUrl(1), {
        verificationStatus: mainFetch.isTransientFailure ? 'pending' : 'error',
        httpStatus: mainFetch.httpStatus,
        diagnosticMessage: mainFetch.errorMessage || 'Falha temporária ao consultar Episódio 1.'
      })
    );
  }
  options.onProgress?.();

  let consecutiveTransientFailures = 0;
  let epNum = 2;

  while (epNum <= maxLimit) {
    if (options.isAborted?.()) {
      season.episodes = discoveredEpisodes;
      finalizeSeasonCounts(season);
      season.status = 'paused';
      return season;
    }

    const candidateUrl = pattern.buildEpisodeUrl(epNum);
    const probe = await safeFetchExternalPage(candidateUrl);

    if (probe.isDefinitiveNotFound) {
      season.endDetectedReason = `Fim da temporada confirmado com HTTP ${probe.httpStatus} no Episódio ${epNum}.`;
      break;
    }

    if (probe.protectionDetected) {
      const stopTarget = Math.min(maxLimit, Math.max(epNum, tmdbEps.length));
      for (let rem = epNum; rem <= stopTarget; rem++) {
        discoveredEpisodes.push(
          buildTmdbEnrichedEpisode(rem, pattern.buildEpisodeUrl(rem), {
            verificationStatus: 'unconfirmed',
            httpStatus: probe.httpStatus,
            protectionDetected: true,
            diagnosticMessage: probe.errorMessage || 'Proteção/bloqueio do provedor durante descoberta.'
          })
        );
      }
      season.endDetectedReason = `Bloqueio do provedor (${probe.protectionType || probe.httpStatus}) a partir do Ep ${epNum}.`;
      break;
    }

    if (probe.ok) {
      consecutiveTransientFailures = 0;
      const parsed = extractEpisodeDataFromHtml(probe.html, probe.finalUrl, epNum);
      if (parsed.isNotFoundPage || probe.redirectedToRootOrCatalog) {
        season.endDetectedReason = `Fim da temporada confirmado (página inexistente / redirecionamento) no Episódio ${epNum}.`;
        break;
      }

      discoveredEpisodes.push(
        buildTmdbEnrichedEpisode(epNum, candidateUrl, {
          title: parsed.title,
          overview: parsed.description,
          stillPath: parsed.image,
          duration: parsed.duration,
          playbackSourceUrl: parsed.playbackSourceUrl || null,
          verificationStatus: 'verified',
          httpStatus: probe.httpStatus,
          diagnosticMessage: `Página confirmada via HTTP ${probe.httpStatus}.`
        })
      );
      options.onProgress?.();
      epNum++;
      continue;
    }

    // Transient error (timeout / 500 / network failure): NEVER assume season ended!
    consecutiveTransientFailures++;
    discoveredEpisodes.push(
      buildTmdbEnrichedEpisode(epNum, candidateUrl, {
        verificationStatus: 'pending',
        httpStatus: probe.httpStatus,
        diagnosticMessage: probe.errorMessage || 'Falha temporária — pendente de repetição.'
      })
    );
    options.onProgress?.();

    if (consecutiveTransientFailures >= 3 && (tmdbEps.length === 0 || epNum >= tmdbEps.length)) {
      season.endDetectedReason = `Pausado no Ep ${epNum} após ${consecutiveTransientFailures} falhas temporárias consecutivas (episódios pendentes podem ser repetidos).`;
      break;
    }

    epNum++;
  }

  if (!season.endDetectedReason && epNum > maxLimit) {
    season.endDetectedReason = `Atingido o limite configurável de segurança (${maxLimit} episódios).`;
  }

  season.episodes = discoveredEpisodes;
  finalizeSeasonCounts(season);
  return season;
}

export async function discoverMovieBatchItem(
  movie: BatchDiscoveredMovieItem
): Promise<BatchDiscoveredMovieItem> {
  const cleanUrl = stripMgebPrefix(movie.originalUrl).innerUrl || movie.originalUrl;
  const built = buildMgebUrl(cleanUrl, movie.useMgeb);
  movie.originalUrl = cleanUrl;
  movie.processedUrl = built.finalUrl || cleanUrl;
  movie.processedUrlDisplay = built.displayFinalUrl || cleanUrl;

  const probe = await safeFetchExternalPage(cleanUrl);
  movie.httpStatus = probe.httpStatus;
  movie.protectionDetected = probe.protectionDetected;

  if (probe.ok) {
    const parsed = extractEpisodeDataFromHtml(probe.html, probe.finalUrl);
    if (parsed.isNotFoundPage || probe.redirectedToRootOrCatalog) {
      movie.verificationStatus = 'not_found';
      movie.detailedState = 'unverified';
      movie.stateReason = 'Página do filme redirecionou ou devolveu 404.';
      return movie;
    }

    movie.verificationStatus = 'verified';
    if (parsed.playbackSourceUrl) {
      movie.playbackCompatibility = 'compatible';
      movie.compatibilityMessage = 'Fluxo de reprodução explícito encontrado na página.';
      if (!movie.sources.some(s => s.originalUrl === parsed.playbackSourceUrl)) {
        const sBuilt = buildMgebUrl(parsed.playbackSourceUrl, false);
        movie.sources.push({
          id: makeShortUid('msrc'),
          originalUrl: sBuilt.innerUrl || parsed.playbackSourceUrl,
          processedUrl: sBuilt.finalUrl || parsed.playbackSourceUrl,
          processedUrlDisplay: sBuilt.displayFinalUrl || parsed.playbackSourceUrl,
          version: movie.version,
          serverName: movie.version === 'legendado' ? 'Servidor Legendado' : 'Servidor Dublado',
          quality: '1080p',
          useMgeb: false,
          compatibilityStatus: 'compatible',
          compatibilityMessage: 'Stream extraído diretamente da página.',
          createdAt: new Date().toISOString()
        });
      }
    }
    const resolved = resolveDetailedDiscoveryState({
      verificationStatus: 'verified',
      playbackCompatibility: movie.playbackCompatibility,
      httpStatus: probe.httpStatus,
      hasProcessedMgeb: Boolean(movie.processedUrl),
      hasTmdbMetadata: true,
      diagnosticMessage: `Página do filme confirmada (HTTP ${probe.httpStatus}); prefixo MGEB aplicado.`
    });
    movie.detailedState = resolved.detailedState;
    movie.stateReason = resolved.stateReason;
    return movie;
  }

  if (probe.protectionDetected) {
    movie.verificationStatus = 'unconfirmed';
    const resolved = resolveDetailedDiscoveryState({
      verificationStatus: 'unconfirmed',
      playbackCompatibility: movie.playbackCompatibility,
      protectionDetected: true,
      httpStatus: probe.httpStatus,
      hasProcessedMgeb: Boolean(movie.processedUrl),
      hasTmdbMetadata: true,
      diagnosticMessage: probe.errorMessage || 'Proteção Cloudflare/403 impediu verificação direta; prefixo MGEB aplicado.'
    });
    movie.detailedState = resolved.detailedState;
    movie.stateReason = resolved.stateReason;
    return movie;
  }

  movie.verificationStatus = probe.isTransientFailure ? 'pending' : 'error';
  const resolved = resolveDetailedDiscoveryState({
    verificationStatus: movie.verificationStatus,
    playbackCompatibility: movie.playbackCompatibility,
    httpStatus: probe.httpStatus,
    hasProcessedMgeb: Boolean(movie.processedUrl),
    hasTmdbMetadata: true,
    diagnosticMessage: probe.errorMessage || 'Falha ao consultar página do filme.'
  });
  movie.detailedState = resolved.detailedState;
  movie.stateReason = resolved.stateReason;
  return movie;
}

export function finalizeSeasonCounts(season: BatchDiscoveredSeason) {
  const validEps = season.episodes.filter(e => e.verificationStatus !== 'not_found');
  season.episodes = validEps;
  season.discoveredCount = validEps.length;
  season.verifiedCount = validEps.filter(
    e => e.verificationStatus === 'verified' || e.manualConfirmed
  ).length;
  season.blockedCount = validEps.filter(
    e => e.detailedState === 'blocked_by_provider'
  ).length;
  season.unconfirmedCount = validEps.filter(
    e => !e.manualConfirmed && (e.verificationStatus === 'unconfirmed' || e.verificationStatus === 'pending')
  ).length;
  season.errorCount = validEps.filter(e => e.verificationStatus === 'error').length;

  if (season.requiresManualReview) {
    season.status = 'error';
    season.detailedState = 'unverified';
    season.stateReason = season.patternNotice || 'Requer revisão manual.';
  } else if (validEps.length === 0) {
    season.status = 'error';
    season.detailedState = 'unverified';
    season.stateReason = season.errorMessage || 'Nenhum episódio encontrado.';
  } else if (season.verifiedCount === validEps.length) {
    season.status = 'completed';
    const allCompatible = validEps.every(e => e.playbackCompatibility === 'compatible');
    season.detailedState = allCompatible ? 'functional_source' : 'verified';
    season.stateReason = allCompatible
      ? 'Todos os episódios confirmados e com fontes compatíveis.'
      : 'Todos os episódios confirmados na origem; links MGEB gerados.';
  } else if (season.verifiedCount > 0) {
    season.status = 'partial';
    season.detailedState = season.blockedCount > 0 ? 'blocked_by_provider' : 'mgeb_applied';
    season.stateReason = `${season.verifiedCount} confirmado(s), ${season.unconfirmedCount} pendente(s)/não verificado(s).`;
  } else if (season.blockedCount > 0) {
    season.status = 'unconfirmed';
    season.detailedState = 'blocked_by_provider';
    season.stateReason =
      season.endDetectedReason ||
      'Bloqueado pelo provedor (Cloudflare / HTTP 403); links MGEB e estrutura TMDB preparados.';
  } else if (season.unconfirmedCount > 0) {
    season.status = 'unconfirmed';
    season.detailedState = 'mgeb_applied';
    season.stateReason = season.endDetectedReason || 'Links gerados com prefixo MGEB; aguardando verificação.';
  } else {
    season.status = 'error';
    season.detailedState = 'transient_error';
    season.stateReason = season.errorMessage || 'Erros na verificação.';
  }
}

export function recalculateJobStats(job: SeasonDiscoveryJob): SeasonDiscoveryJob {
  let totalSeasons = 0;
  let completedSeasons = 0;
  let totalEpisodesDiscovered = 0;
  let verifiedEpisodes = 0;
  let unconfirmedEpisodes = 0;
  let failedEpisodes = 0;

  if (!Array.isArray(job.movieItems)) job.movieItems = [];
  job.totalMovies = job.movieItems.length;

  for (const g of job.seriesGroups) {
    for (const s of g.seasons) {
      totalSeasons++;
      if (s.status === 'completed' || s.status === 'partial' || s.status === 'unconfirmed') {
        completedSeasons++;
      }
      totalEpisodesDiscovered += s.discoveredCount;
      verifiedEpisodes += s.verifiedCount;
      unconfirmedEpisodes += s.unconfirmedCount;
      failedEpisodes += s.errorCount;
    }
  }

  job.totalSeasons = totalSeasons;
  job.completedSeasons = completedSeasons;
  job.totalEpisodesDiscovered = totalEpisodesDiscovered;
  job.verifiedEpisodes = verifiedEpisodes;
  job.unconfirmedEpisodes = unconfirmedEpisodes;
  job.failedEpisodes = failedEpisodes;
  job.updatedAt = new Date().toISOString();
  return job;
}

/**
 * Analyzes an unlimited batch of links (movies AND series season links), identifies TMDB metadata,
 * preserves per-season independence without cross-series/cross-season mixing,
 * applies MGEB prefix cleanly, and initializes a resumable SeasonDiscoveryJob.
 */
export async function buildBatchSeasonDiscoveryJob(
  urls: Array<string | { url: string; version?: 'dublado' | 'legendado'; useMgeb?: boolean; quality?: string; serverName?: string }>,
  deps: AnalyzerDependencies,
  options?: { maxEpisodesLimit?: number; overrideTmdbId?: number }
): Promise<SeasonDiscoveryJob> {
  const maxEpisodesLimit = Math.max(1, Math.min(5000, Number(options?.maxEpisodesLimit || 250)));
  const normalizedEntries: Array<{
    rawUrl: string;
    version: 'dublado' | 'legendado';
    useMgeb: boolean;
    quality: string;
    serverName?: string;
  }> = [];
  const seenUrls = new Set<string>();

  for (const entry of urls) {
    const rawStr = typeof entry === 'string' ? entry : entry?.url;
    const stripped = stripMgebPrefix(String(rawStr || '').trim());
    const clean = (stripped.innerUrl || String(rawStr || '')).trim();
    if (!clean || seenUrls.has(clean)) continue;
    seenUrls.add(clean);
    normalizedEntries.push({
      rawUrl: clean,
      version: typeof entry === 'object' && entry?.version === 'legendado' ? 'legendado' : 'dublado',
      useMgeb: typeof entry === 'object' && entry?.useMgeb === false ? false : true,
      quality: (typeof entry === 'object' && entry?.quality) || '1080p',
      serverName: typeof entry === 'object' ? entry?.serverName : undefined
    });
  }

  const jobId = `sjob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const groupsByTmdb = new Map<number, BatchSeriesDiscoveryGroup>();
  const moviesByTmdb = new Map<number, BatchDiscoveredMovieItem>();
  const unmatchedUrls: Array<{ url: string; reason: string }> = [];
  const errors: string[] = [];
  const now = new Date().toISOString();

  // Process URL identification in controlled concurrent chunks of 4
  const CHUNK = 4;
  for (let i = 0; i < normalizedEntries.length; i += CHUNK) {
    const chunk = normalizedEntries.slice(i, i + CHUNK);
    const analyses = await Promise.all(
      chunk.map(async item => {
        try {
          let parsed: URL;
          try {
            parsed = new URL(item.rawUrl);
          } catch {
            return { item, error: 'URL inválida.' };
          }

          const ssrf = await validatePublicHttpUrl(parsed.toString());
          if (!ssrf.safe) {
            return { item, error: ssrf.reason || 'Bloqueado pela política SSRF.' };
          }

          const pattern = detectSeasonUrlPattern(parsed.toString());
          const hints = extractHintsFromUrl(parsed);
          const preferredType =
            hints.inferredType === 'movie'
              ? 'movie'
              : hints.inferredType === 'tv'
                ? 'tv'
                : undefined;

          const analysis = await analyzeExternalLink(parsed.toString(), deps, {
            preferredTmdbId: options?.overrideTmdbId,
            preferredType
          });

          return { item, parsed, pattern, hints, analysis };
        } catch (err: any) {
          return { item, error: err?.message || 'Erro ao analisar URL.' };
        }
      })
    );

    for (const res of analyses) {
      if ('error' in res || !res.analysis) {
        const msg = ('error' in res && res.error) || 'Falha ao analisar link.';
        unmatchedUrls.push({ url: res.item.rawUrl, reason: msg });
        errors.push(`${res.item.rawUrl}: ${msg}`);
        continue;
      }

      const { item, pattern, hints, analysis } = res;
      const sel = analysis.selectedCandidate || analysis.candidates[0] || null;
      if (!sel) {
        const reason = 'Não foi possível identificar filme ou série no TMDB para este link.';
        unmatchedUrls.push({ url: item.rawUrl, reason });
        errors.push(`${item.rawUrl}: ${reason}`);
        continue;
      }

      // MOVIE BRANCH: Keep inside unified batch job (single link, multi-link same movie, or multi-movie batch)
      const isMovieCandidate =
        sel.type === 'movie' &&
        (hints.inferredType !== 'tv' || !analysis.candidates.some(c => c.type === 'tv'));

      if (isMovieCandidate) {
        const built = buildMgebUrl(item.rawUrl, item.useMgeb);
        const existingCatalogMovie = deps.getExistingMedia(sel.tmdbId, 'movie');
        let movieEntry = moviesByTmdb.get(sel.tmdbId);

        const sourceSlot: BatchEpisodeSourceDraft = {
          id: makeShortUid('msrc'),
          originalUrl: built.innerUrl || item.rawUrl,
          processedUrl: built.finalUrl || item.rawUrl,
          processedUrlDisplay: built.displayFinalUrl || item.rawUrl,
          version: item.version,
          serverName:
            item.serverName?.trim() ||
            (item.version === 'legendado' ? 'Servidor Legendado MGEB' : 'Servidor Dublado MGEB'),
          quality: item.quality,
          useMgeb: item.useMgeb,
          compatibilityStatus: 'untested',
          compatibilityMessage: item.useMgeb
            ? 'Prefixo aplicado — reprodução não confirmada (aguarda teste ou reprodução).'
            : 'Link direto configurado.',
          createdAt: now
        };

        if (!movieEntry) {
          movieEntry = {
            movieId: `movie-${sel.tmdbId}`,
            tmdbId: sel.tmdbId,
            title: sel.title,
            originalTitle: sel.originalTitle,
            posterPath: sel.posterPath,
            releaseYear: sel.releaseYear,
            overview: sel.overview,
            categories: sel.suggestedCategories,
            confidence: sel.confidence,
            existsInCatalog: Boolean(existingCatalogMovie) || sel.existsInCatalog,
            originalUrl: built.innerUrl || item.rawUrl,
            processedUrl: built.finalUrl || item.rawUrl,
            processedUrlDisplay: built.displayFinalUrl || item.rawUrl,
            useMgeb: item.useMgeb,
            detailedState: 'mgeb_applied',
            stateReason: 'Filme identificado no TMDB e prefixo MGEB aplicado — aguardando verificação.',
            verificationStatus: 'unconfirmed',
            playbackCompatibility: 'untested',
            compatibilityMessage: 'Prefixo aplicado — reprodução não confirmada.',
            version: item.version,
            approved: true,
            sources: [sourceSlot],
            createdAt: now
          };
          moviesByTmdb.set(sel.tmdbId, movieEntry);
        } else {
          // Preserve all links for the same movie as separate independent sources!
          if (!movieEntry.sources.some(s => s.originalUrl === sourceSlot.originalUrl)) {
            movieEntry.sources.push(sourceSlot);
          }
        }
        continue;
      }

      // TV SEASON BRANCH: Pick TV candidate without mixing with other series or seasons
      const tvCand =
        sel.type === 'tv'
          ? sel
          : analysis.candidates.find(c => c.type === 'tv') || sel;

      if (!tvCand || tvCand.type !== 'tv') {
        const reason = 'Não foi possível identificar uma série no TMDB para este link.';
        unmatchedUrls.push({ url: item.rawUrl, reason });
        errors.push(`${item.rawUrl}: ${reason}`);
        continue;
      }

      let group = groupsByTmdb.get(tvCand.tmdbId);
      if (!group) {
        group = {
          groupKey: `tv-${tvCand.tmdbId}`,
          tmdbId: tvCand.tmdbId,
          title: tvCand.title,
          originalTitle: tvCand.originalTitle,
          posterPath: tvCand.posterPath,
          overview: tvCand.overview,
          releaseYear: tvCand.releaseYear,
          categories: tvCand.suggestedCategories,
          confidence: tvCand.confidence,
          existsInCatalog: tvCand.existsInCatalog,
          seasons: []
        };
        groupsByTmdb.set(tvCand.tmdbId, group);
      }

      const seasonNum =
        pattern.seasonNumberHint ??
        analysis.extracted.hintedSeasonNumber ??
        (group.seasons.length + 1);

      const duplicateSeason = group.seasons.find(s => s.seasonNumber === seasonNum);
      if (duplicateSeason && duplicateSeason.mainUrl === pattern.cleanBaseUrl) {
        continue;
      }

      const previewMatch = (analysis.seasonsPreview || []).find(p => p.seasonNumber === seasonNum);
      const mainBuilt = buildMgebUrl(pattern.cleanBaseUrl, true);

      group.seasons.push({
        seasonId: makeShortUid(`s-${tvCand.tmdbId}-${seasonNum}`),
        seriesId: group.groupKey,
        seasonNumber: seasonNum,
        name: previewMatch?.name || (seasonNum === 0 ? 'Especiais' : `Temporada ${seasonNum}`),
        overview: previewMatch?.overview,
        posterPath: previewMatch?.posterPath,
        mainUrl: pattern.cleanBaseUrl,
        processedMainUrl: mainBuilt.finalUrl || pattern.cleanBaseUrl,
        providerId: pattern.providerId,
        adapterType: pattern.adapterType,
        requiresManualReview: pattern.requiresManualReview,
        patternNotice: pattern.patternNotice,
        tmdbExpectedCount: previewMatch?.tmdbEpisodeCount || 0,
        discoveredCount: 0,
        verifiedCount: 0,
        unconfirmedCount: 0,
        blockedCount: 0,
        errorCount: 0,
        status: pattern.requiresManualReview ? 'error' : 'queued',
        detailedState: pattern.requiresManualReview ? 'unverified' : 'awaiting_verification',
        stateReason: pattern.requiresManualReview
          ? pattern.patternNotice
          : 'Temporada em fila para descoberta de episódios e prefixo MGEB.',
        errorMessage: pattern.requiresManualReview ? pattern.patternNotice : null,
        approved: !pattern.requiresManualReview,
        episodes: []
      });
    }
  }

  const seriesGroups = Array.from(groupsByTmdb.values()).map(g => ({
    ...g,
    seasons: g.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)
  }));
  const movieItems = Array.from(moviesByTmdb.values());
  const hasAnyItem = seriesGroups.length > 0 || movieItems.length > 0;

  const job: SeasonDiscoveryJob = {
    jobId,
    status: hasAnyItem ? 'RUNNING' : 'ERROR',
    createdAt: now,
    updatedAt: now,
    totalInputUrls: normalizedEntries.length,
    totalMovies: movieItems.length,
    totalSeasons: seriesGroups.reduce((acc, g) => acc + g.seasons.length, 0),
    completedSeasons: 0,
    totalEpisodesDiscovered: 0,
    verifiedEpisodes: 0,
    unconfirmedEpisodes: 0,
    failedEpisodes: 0,
    maxEpisodesLimit,
    currentTask: hasAnyItem
      ? `Identificados ${movieItems.length} filme(s) e ${seriesGroups.length} série(s) (${seriesGroups.reduce((a, g) => a + g.seasons.length, 0)} temporada(s)). A iniciar descoberta...`
      : 'Nenhum filme ou temporada de série válido foi identificado.',
    errors,
    movieItems,
    seriesGroups,
    unmatchedUrls
  };

  return recalculateJobStats(job);
}

/**
 * Deterministic TMDB + MGEB Series Job Builder:
 * Takes a confirmed TMDB TV ID + list of season base URLs (Season N -> Ep 1 URL),
 * immediately generates ALL expected episodes (1..tmdbEpisodeCount) for every season
 * using each season's independent baseUrl + centralized MGEB prefix,
 * completely immune to Cloudflare HTTP 403 blocks.
 */
export async function buildDeterministicSeriesJob(
  input: {
    tmdbId: number;
    seasons: Array<{
      seasonNumber: number;
      mainUrl: string;
      version?: 'dublado' | 'legendado';
      useMgeb?: boolean;
      quality?: string;
      serverName?: string;
    }>;
    verifyHttp?: boolean;
    maxEpisodesLimit?: number;
  },
  deps: AnalyzerDependencies
): Promise<SeasonDiscoveryJob> {
  const tmdbId = Number(input.tmdbId);
  const maxEpisodesLimit = Math.max(1, Math.min(5000, Number(input.maxEpisodesLimit || 250)));
  const now = new Date().toISOString();
  const jobId = `sjob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const existingMedia = deps.getExistingMedia(tmdbId, 'tv');
  let tmdbShow: any = null;
  try {
    tmdbShow = await deps.fetchTMDB(`/tv/${tmdbId}`, {}, AbortSignal.timeout(8000));
  } catch {}

  const showTitle =
    tmdbShow?.name || existingMedia?.title || `Série TMDB #${tmdbId}`;
  const showOriginalTitle =
    tmdbShow?.original_name || existingMedia?.originalTitle;
  const showPoster = tmdbShow?.poster_path
    ? `https://image.tmdb.org/t/p/w500${tmdbShow.poster_path}`
    : existingMedia?.posterPath;
  const showOverview = tmdbShow?.overview || existingMedia?.overview || '';
  const parsedAirYear = tmdbShow?.first_air_date
    ? parseInt(String(tmdbShow.first_air_date).slice(0, 4), 10)
    : NaN;
  const showYear: number | undefined = !isNaN(parsedAirYear)
    ? parsedAirYear
    : existingMedia?.releaseYear;

  const tmdbShowSeasons: any[] = Array.isArray(tmdbShow?.seasons) ? tmdbShow.seasons : [];
  const unmatchedUrls: Array<{ url: string; reason: string }> = [];
  const errors: string[] = [];
  const builtSeasons: BatchDiscoveredSeason[] = [];

  for (const sEntry of input.seasons || []) {
    const rawStr = String(sEntry.mainUrl || '').trim();
    const stripped = stripMgebPrefix(rawStr);
    const cleanMainUrl = (stripped.innerUrl || rawStr).trim();
    if (!cleanMainUrl) continue;

    let parsed: URL;
    try {
      parsed = new URL(cleanMainUrl);
    } catch {
      const reason = `Temporada ${sEntry.seasonNumber}: URL inválida.`;
      unmatchedUrls.push({ url: cleanMainUrl, reason });
      errors.push(reason);
      continue;
    }

    const ssrf = await validatePublicHttpUrl(parsed.toString());
    if (!ssrf.safe) {
      const reason = `Temporada ${sEntry.seasonNumber}: ${ssrf.reason || 'Bloqueado pela política SSRF.'}`;
      unmatchedUrls.push({ url: cleanMainUrl, reason });
      errors.push(reason);
      continue;
    }

    const sNum = Math.max(0, Math.floor(Number(sEntry.seasonNumber)));
    const pattern = detectSeasonUrlPattern(parsed.toString());
    const tmdbSeasonSummary = tmdbShowSeasons.find((ts: any) => Number(ts.season_number) === sNum);
    const useMgeb = sEntry.useMgeb !== false;
    const mainBuilt = buildMgebUrl(pattern.cleanBaseUrl, useMgeb);

    const seasonObj: BatchDiscoveredSeason = {
      seasonId: makeShortUid(`s-${tmdbId}-${sNum}`),
      seriesId: `tv-${tmdbId}`,
      seasonNumber: sNum,
      name: tmdbSeasonSummary?.name || (sNum === 0 ? 'Especiais' : `Temporada ${sNum}`),
      overview: tmdbSeasonSummary?.overview,
      posterPath: tmdbSeasonSummary?.poster_path
        ? `https://image.tmdb.org/t/p/w500${tmdbSeasonSummary.poster_path}`
        : undefined,
      mainUrl: pattern.cleanBaseUrl,
      processedMainUrl: mainBuilt.finalUrl || pattern.cleanBaseUrl,
      providerId: pattern.providerId,
      adapterType: pattern.adapterType,
      requiresManualReview: false,
      patternNotice: pattern.patternNotice,
      tmdbExpectedCount: Number(tmdbSeasonSummary?.episode_count || 0),
      discoveredCount: 0,
      verifiedCount: 0,
      unconfirmedCount: 0,
      blockedCount: 0,
      errorCount: 0,
      status: 'queued',
      detailedState: 'tmdb_prepared',
      stateReason: 'Estrutura TMDB preparada — a gerar episódios e prefixos MGEB.',
      errorMessage: null,
      approved: true,
      episodes: []
    };

    builtSeasons.push(seasonObj);
  }

  builtSeasons.sort((a, b) => a.seasonNumber - b.seasonNumber);

  // Deterministically populate all episodes for all seasons right away (in chunks of 4 TMDB calls)
  const CHUNK = 4;
  for (let i = 0; i < builtSeasons.length; i += CHUNK) {
    const chunk = builtSeasons.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async season => {
        await discoverSeasonEpisodesBatchItem(season, tmdbId, deps, {
          maxEpisodesLimit,
          existingMedia,
          skipExternalVerification: true
        });
        // Apply per-season version, quality, serverName & MGEB preference to every generated episode cleanly
        const srcEntry = input.seasons.find(item => Number(item.seasonNumber) === season.seasonNumber);
        const targetVer: 'dublado' | 'legendado' =
          srcEntry?.version === 'legendado' ? 'legendado' : 'dublado';
        const useMgeb = srcEntry?.useMgeb !== false;
        const targetQuality = String(srcEntry?.quality || '1080p');
        const targetServer =
          (srcEntry?.serverName && srcEntry.serverName.trim()) ||
          (targetVer === 'legendado' ? 'Servidor Legendado MGEB' : 'Servidor Dublado MGEB');

        season.episodes = season.episodes.map(ep => {
          const built = buildMgebUrl(ep.originalUrl, useMgeb);
          const procUrl = useMgeb ? built.finalUrl || formatMgebDisplayUrl(ep.originalUrl) : ep.originalUrl;
          const procDisp = useMgeb ? built.displayFinalUrl || formatMgebDisplayUrl(ep.originalUrl) : ep.originalUrl;
          const defaultSource: BatchEpisodeSourceDraft = {
            id: makeShortUid(`src-s${season.seasonNumber}-e${ep.episodeNumber}`),
            originalUrl: built.innerUrl || ep.originalUrl,
            processedUrl: procUrl,
            processedUrlDisplay: procDisp,
            version: targetVer,
            serverName: targetServer,
            quality: targetQuality,
            useMgeb,
            compatibilityStatus: ep.playbackCompatibility || 'untested',
            compatibilityMessage: useMgeb
              ? 'Prefixo MGEB aplicado — pronto para reprodução ou verificação opcional.'
              : 'URL original sem prefixo MGEB.',
            createdAt: now
          };

          return {
            ...ep,
            playbackVersion: targetVer,
            useMgebForPlayback: useMgeb,
            processedUrl: procUrl,
            processedUrlDisplay: procDisp,
            sources: ep.sources && ep.sources.length > 0 ? ep.sources : [defaultSource],
            detailedState: useMgeb ? 'mgeb_applied' : 'url_generated',
            stateReason: useMgeb
              ? 'Episódio gerado pela TMDB e prefixo MGEB aplicado — aguardando verificação opcional.'
              : 'Episódio gerado pela TMDB (prefixo MGEB desativado).'
          };
        });
        if (!useMgeb) {
          season.processedMainUrl = season.mainUrl;
        }
        finalizeSeasonCounts(season);
      })
    );
  }

  const group: BatchSeriesDiscoveryGroup = {
    groupKey: `tv-${tmdbId}`,
    tmdbId,
    title: showTitle,
    originalTitle: showOriginalTitle,
    posterPath: showPoster,
    overview: showOverview,
    releaseYear: showYear,
    confidence: 'high',
    existsInCatalog: Boolean(existingMedia),
    seasons: builtSeasons
  };

  const totalGenerated = builtSeasons.reduce((acc, s) => acc + s.episodes.length, 0);
  const job: SeasonDiscoveryJob = {
    jobId,
    status: input.verifyHttp ? 'RUNNING' : builtSeasons.length > 0 ? 'COMPLETED' : 'ERROR',
    createdAt: now,
    updatedAt: now,
    totalInputUrls: builtSeasons.length,
    totalMovies: 0,
    totalSeasons: builtSeasons.length,
    completedSeasons: builtSeasons.length,
    totalEpisodesDiscovered: totalGenerated,
    verifiedEpisodes: 0,
    unconfirmedEpisodes: totalGenerated,
    failedEpisodes: 0,
    maxEpisodesLimit,
    currentTask:
      builtSeasons.length > 0
        ? input.verifyHttp
          ? `${builtSeasons.length} temporada(s) e ${totalGenerated} episódio(s) gerados. A verificar origem...`
          : `${builtSeasons.length} temporada(s) e ${totalGenerated} episódio(s) gerados com prefixo MGEB (prontos para importar).`
        : 'Nenhuma temporada válida informada.',
    errors,
    movieItems: [],
    seriesGroups: builtSeasons.length > 0 ? [group] : [],
    unmatchedUrls
  };

  return recalculateJobStats(job);
}
