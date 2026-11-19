export const MGEB_PREFIX = 'https://mgeb.space/mp4.php?url=';

export interface MgebUrlResult {
  originalInput: string;
  innerUrl: string;
  finalUrl: string;
  displayFinalUrl: string;
  hadMgebPrefix: boolean;
  valid: boolean;
  isDirectStream?: boolean;
  isHtmlPage?: boolean;
  compatibilityStatus?: 'mgeb_applied' | 'direct_stream' | 'html_page_needs_mgeb' | 'invalid';
  compatibilityLabel?: string;
  error?: string;
}

export interface GeneratedEpisodeLink {
  episodeNumber: number;
  url: string;
  innerUrl: string;
}

export interface EpisodeGenerationResult {
  valid: boolean;
  error?: string;
  notice?: string;
  basePattern?: string;
  detectedStartSegment?: number;
  links: GeneratedEpisodeLink[];
}

const MGEB_PREFIX_REGEX = /^https?:\/\/mgeb\.space\/mp4\.php\?url=/i;

export function formatMgebWrappedUrl(innerUrl: string): string {
  const clean = (innerUrl || '').trim();
  if (!clean) return '';
  const needsEncoding =
    clean.includes('?') ||
    clean.includes('&') ||
    clean.includes('#') ||
    clean.includes('=') ||
    /\s/.test(clean) ||
    /[^\x20-\x7E]/.test(clean);
  return `${MGEB_PREFIX}${needsEncoding ? encodeURIComponent(clean) : clean}`;
}

export function formatMgebDisplayUrl(innerUrl: string): string {
  const clean = (innerUrl || '').trim();
  if (!clean) return '';
  return `${MGEB_PREFIX}${clean}`;
}

export function isImageOrTrailerUrl(rawUrl: string): boolean {
  const clean = (rawUrl || '').trim();
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    const p = parsed.pathname.toLowerCase();
    if (
      host.includes('image.tmdb.org') ||
      host.includes('youtube.com') ||
      host.includes('youtu.be') ||
      host.includes('vimeo.com')
    ) {
      return true;
    }
    return /\.(jpe?g|png|webp|gif|svg|avif|ico)$/i.test(p);
  } catch {
    return /\.(jpe?g|png|webp|gif|svg|avif|ico)(\?|$)/i.test(clean);
  }
}

export function isLikelyDirectVideoUrl(rawUrl: string): boolean {
  const clean = (rawUrl || '').trim();
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    const p = parsed.pathname.toLowerCase();
    return (
      p.endsWith('.mp4') ||
      p.endsWith('.m4v') ||
      p.endsWith('.m3u8') ||
      p.endsWith('.webm') ||
      p.endsWith('.mpd') ||
      p.endsWith('.php')
    );
  } catch {
    return /\.(mp4|m4v|m3u8|webm|mpd|php)(\?|$)/i.test(clean);
  }
}

export function isLikelyHtmlDetailPage(rawUrl: string): boolean {
  const clean = (rawUrl || '').trim();
  if (!clean || isLikelyDirectVideoUrl(clean)) return false;
  try {
    const parsed = new URL(clean);
    const p = parsed.pathname.toLowerCase();
    return (
      p.endsWith('.html') ||
      p.endsWith('.htm') ||
      p.includes('/detail/') ||
      p.includes('/movie/') ||
      p.includes('/filme/') ||
      p.includes('/serie/') ||
      p.includes('/series/') ||
      p.includes('/tv/') ||
      p.includes('/watch/')
    );
  } catch {
    return /\/detail\/|\.html?(\?|$)/i.test(clean);
  }
}

/**
 * Strips one or more accidental MGEB prefixes (raw or percent-encoded) so the prefix is never duplicated.
 */
export function stripMgebPrefix(raw: string): { hadPrefix: boolean; innerUrl: string } {
  let current = (raw || '').trim();
  let hadPrefix = false;

  for (let i = 0; i < 6; i++) {
    if (!MGEB_PREFIX_REGEX.test(current)) break;
    hadPrefix = true;
    current = current.replace(MGEB_PREFIX_REGEX, '').trim();
    if (/^https?%3A%2F%2F/i.test(current)) {
      try {
        current = decodeURIComponent(current);
      } catch {
        // Keep literal if malformed percent-encoding
      }
    }
  }

  return { hadPrefix, innerUrl: current };
}

/**
 * Validates and combines an input URL with the fixed MGEB prefix (without ever duplicating it).
 */
export function buildMgebUrl(rawInput: string, useMgebPrefix: boolean = true): MgebUrlResult {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return {
      originalInput: trimmed,
      innerUrl: '',
      finalUrl: '',
      displayFinalUrl: '',
      hadMgebPrefix: false,
      valid: false,
      compatibilityStatus: 'invalid',
      compatibilityLabel: 'Aguardando link',
      error: 'Cole o endereço original da fonte.'
    };
  }

  const { hadPrefix, innerUrl } = stripMgebPrefix(trimmed);
  if (!innerUrl) {
    return {
      originalInput: trimmed,
      innerUrl: '',
      finalUrl: useMgebPrefix ? MGEB_PREFIX : '',
      displayFinalUrl: useMgebPrefix ? MGEB_PREFIX : '',
      hadMgebPrefix: hadPrefix,
      valid: false,
      compatibilityStatus: 'invalid',
      compatibilityLabel: 'Link vazio após prefixo',
      error: 'O link original está vazio após o prefixo MGEB.'
    };
  }

  let parsedInner: URL;
  try {
    parsedInner = new URL(innerUrl);
  } catch {
    return {
      originalInput: trimmed,
      innerUrl,
      finalUrl: useMgebPrefix ? formatMgebWrappedUrl(innerUrl) : innerUrl,
      displayFinalUrl: useMgebPrefix ? formatMgebDisplayUrl(innerUrl) : innerUrl,
      hadMgebPrefix: hadPrefix,
      valid: false,
      compatibilityStatus: 'invalid',
      compatibilityLabel: 'URL inválida',
      error: 'Endereço inválido. Utilize uma URL completa iniciada por http:// ou https://.'
    };
  }

  if (parsedInner.protocol !== 'http:' && parsedInner.protocol !== 'https:') {
    return {
      originalInput: trimmed,
      innerUrl,
      finalUrl: useMgebPrefix ? formatMgebWrappedUrl(innerUrl) : innerUrl,
      displayFinalUrl: useMgebPrefix ? formatMgebDisplayUrl(innerUrl) : innerUrl,
      hadMgebPrefix: hadPrefix,
      valid: false,
      compatibilityStatus: 'invalid',
      compatibilityLabel: 'Protocolo não suportado',
      error: `Protocolo não suportado (${parsedInner.protocol}). Utilize http:// ou https://.`
    };
  }

  if (!parsedInner.hostname || !parsedInner.hostname.includes('.')) {
    return {
      originalInput: trimmed,
      innerUrl,
      finalUrl: useMgebPrefix ? formatMgebWrappedUrl(innerUrl) : innerUrl,
      displayFinalUrl: useMgebPrefix ? formatMgebDisplayUrl(innerUrl) : innerUrl,
      hadMgebPrefix: hadPrefix,
      valid: false,
      compatibilityStatus: 'invalid',
      compatibilityLabel: 'Domínio inválido',
      error: 'Domínio inválido no link da fonte.'
    };
  }

  const skipPrefixForAsset = isImageOrTrailerUrl(innerUrl);
  const effectiveUseMgeb = useMgebPrefix && !skipPrefixForAsset;
  const isDirectStream = isLikelyDirectVideoUrl(innerUrl);
  const isHtmlPage = isLikelyHtmlDetailPage(innerUrl);
  const finalUrl = effectiveUseMgeb ? formatMgebWrappedUrl(innerUrl) : innerUrl;
  const displayFinalUrl = effectiveUseMgeb ? formatMgebDisplayUrl(innerUrl) : innerUrl;

  const compatibilityStatus: MgebUrlResult['compatibilityStatus'] = skipPrefixForAsset
    ? 'invalid'
    : effectiveUseMgeb
    ? 'mgeb_applied'
    : isDirectStream
    ? 'direct_stream'
    : 'html_page_needs_mgeb';

  const compatibilityLabel = skipPrefixForAsset
    ? 'URL de imagem/poster/trailer — prefixo MGEB não aplicável'
    : effectiveUseMgeb
    ? 'Prefixo MGEB aplicado (pronto para verificação)'
    : isDirectStream
    ? 'Fluxo direto sem prefixo'
    : 'Página HTML externa (ative MGEB ou teste antes de usar)';

  return {
    originalInput: trimmed,
    innerUrl,
    finalUrl,
    displayFinalUrl,
    hadMgebPrefix: hadPrefix,
    valid: true,
    isDirectStream,
    isHtmlPage,
    compatibilityStatus,
    compatibilityLabel
  };
}

/**
 * Centralized MGEB processing function:
 * validates URL, strips duplicated prefixes, skips posters/trailers,
 * encodes parameter cleanly, and never alters the original URL.
 */
export function applyMgebPrefix(rawInput: string): string {
  const built = buildMgebUrl(rawInput, true);
  return built.valid ? built.finalUrl : '';
}

export function reprocessMgebUrl(rawInput: string, useMgebPrefix: boolean = true): MgebUrlResult {
  const { innerUrl } = stripMgebPrefix(rawInput);
  return buildMgebUrl(innerUrl || rawInput, useMgebPrefix);
}

/**
 * Generates sequential episode links intelligently supporting any URL structure:
 * - Trailing number paths (.../1)
 * - Episode / Season path segments (.../episode/1, .../season/1, .../ep/1)
 * - Query parameter numbers (?id=123, ?ep=1, ?episode=1)
 * - Season / Base page URLs without trailing numbers (.../serie/temporada-1, alphanumeric video IDs .../video/abc123)
 * - Zero artificial limits (supports 20, 23, 30, 50, 100+ episodes).
 */
export function generateEpisodeLinks(params: {
  firstLink: string;
  useMgebPrefix?: boolean;
  startEpisode: number;
  episodeCount: number;
}): EpisodeGenerationResult {
  const useMgeb = params.useMgebPrefix !== false;
  const startEp = Math.max(1, Math.floor(Number(params.startEpisode) || 1));
  const count = Math.max(1, Math.min(100000, Math.floor(Number(params.episodeCount) || 1)));

  const built = buildMgebUrl(params.firstLink, useMgeb);
  if (!built.valid) {
    return {
      valid: false,
      error: built.error || 'Informe um link inicial válido.',
      links: []
    };
  }

  let parsedInner: URL;
  try {
    parsedInner = new URL(built.innerUrl);
  } catch {
    return {
      valid: false,
      error: 'Não foi possível analisar o endereço original.',
      links: []
    };
  }

  const links: GeneratedEpisodeLink[] = [];
  let detectedStart: number | undefined = undefined;
  let basePattern = '';
  let notice: string | undefined = undefined;

  // Strategy 1: Check query parameters for episode/ep/id/v/p numbers
  const queryParamKeys = ['episode', 'ep', 'e', 'id', 'v', 'p', 'part'];
  let matchedQueryKey: string | null = null;
  let matchedQueryVal: string | null = null;

  for (const qKey of queryParamKeys) {
    const val = parsedInner.searchParams.get(qKey);
    if (val && /^\d+$/.test(val)) {
      matchedQueryKey = qKey;
      matchedQueryVal = val;
      break;
    }
  }

  if (matchedQueryKey && matchedQueryVal) {
    detectedStart = parseInt(matchedQueryVal, 10);
    const zeroPaddedWidth = matchedQueryVal.length > 1 && matchedQueryVal.startsWith('0') ? matchedQueryVal.length : 0;
    notice = `Padrão de parâmetro de consulta detetado (?${matchedQueryKey}=${matchedQueryVal})`;

    for (let i = 0; i < count; i++) {
      const epNum = startEp + i;
      const epSegment = zeroPaddedWidth > 0 ? String(epNum).padStart(zeroPaddedWidth, '0') : String(epNum);
      const urlClone = new URL(parsedInner.toString());
      urlClone.searchParams.set(matchedQueryKey, epSegment);
      const rebuiltInner = urlClone.toString();
      const rebuiltFinal = useMgeb ? formatMgebWrappedUrl(rebuiltInner) : rebuiltInner;
      links.push({
        episodeNumber: epNum,
        innerUrl: rebuiltInner,
        url: rebuiltFinal
      });
    }

    const patternClone = new URL(parsedInner.toString());
    patternClone.searchParams.set(matchedQueryKey, '{episodio}');
    basePattern = `${useMgeb ? MGEB_PREFIX : ''}${patternClone.toString()}`;

    return {
      valid: true,
      notice,
      detectedStartSegment: detectedStart,
      basePattern,
      links
    };
  }

  // Strategy 2: Check pathname for explicit episode segments (e.g. /episode/1, /ep/1, /episodio/1) — NEVER rewrite /season/{n} or /temporada/{n}
  const segmentMatch = parsedInner.pathname.match(/\/(?:episode|ep|episodio|capitulo)\/(\d+)/i);
  if (segmentMatch) {
    const rawDigits = segmentMatch[1];
    detectedStart = parseInt(rawDigits, 10);
    const zeroPaddedWidth = rawDigits.length > 1 && rawDigits.startsWith('0') ? rawDigits.length : 0;
    notice = `Padrão de segmento de episódio detetado (${segmentMatch[0]})`;

    const fullPath = parsedInner.pathname;
    const matchIndex = fullPath.lastIndexOf(rawDigits);
    const prefixPath = fullPath.substring(0, matchIndex);
    const suffixPath = fullPath.substring(matchIndex + rawDigits.length);

    for (let i = 0; i < count; i++) {
      const epNum = startEp + i;
      const epSegment = zeroPaddedWidth > 0 ? String(epNum).padStart(zeroPaddedWidth, '0') : String(epNum);
      const rebuiltInner = `${parsedInner.origin}${prefixPath}${epSegment}${suffixPath}${parsedInner.search}${parsedInner.hash}`;
      const rebuiltFinal = useMgeb ? formatMgebWrappedUrl(rebuiltInner) : rebuiltInner;
      links.push({
        episodeNumber: epNum,
        innerUrl: rebuiltInner,
        url: rebuiltFinal
      });
    }

    basePattern = `${useMgeb ? MGEB_PREFIX : ''}${parsedInner.origin}${prefixPath}{episodio}${suffixPath}${parsedInner.search}${parsedInner.hash}`;

    return {
      valid: true,
      notice,
      detectedStartSegment: detectedStart,
      basePattern,
      links
    };
  }

  // Strategy 2.5: Check SxxExx or episode token in pathname (e.g. breaking-bad-s01e01.mp4, ep01.mp4, episodio-1.m3u8)
  const sxxExxMatch = parsedInner.pathname.match(/^(.*s\d{1,2}e)(\d{1,3})([^/]*)$/i);
  if (sxxExxMatch) {
    const [, prefixPath, rawDigits, suffixPath] = sxxExxMatch;
    detectedStart = parseInt(rawDigits, 10);
    const zeroPaddedWidth = rawDigits.length > 1 ? rawDigits.length : 0;
    notice = 'Padrão SxxExx detetado no nome do ficheiro/caminho.';

    for (let i = 0; i < count; i++) {
      const epNum = startEp + i;
      const epSegment = zeroPaddedWidth > 0 ? String(epNum).padStart(zeroPaddedWidth, '0') : String(epNum);
      const rebuiltInner = `${parsedInner.origin}${prefixPath}${epSegment}${suffixPath}${parsedInner.search}${parsedInner.hash}`;
      const rebuiltFinal = useMgeb ? formatMgebWrappedUrl(rebuiltInner) : rebuiltInner;
      links.push({
        episodeNumber: epNum,
        innerUrl: rebuiltInner,
        url: rebuiltFinal
      });
    }

    basePattern = `${useMgeb ? MGEB_PREFIX : ''}${parsedInner.origin}${prefixPath}{episodio}${suffixPath}${parsedInner.search}${parsedInner.hash}`;

    return {
      valid: true,
      notice,
      detectedStartSegment: detectedStart,
      basePattern,
      links
    };
  }

  const fileEpMatch = parsedInner.pathname.match(/^(.*?(?:ep|episodio|episode)[-_]?)(\d{1,3})(\.[a-z0-9]{2,5})$/i);
  if (fileEpMatch) {
    const [, prefixPath, rawDigits, ext] = fileEpMatch;
    detectedStart = parseInt(rawDigits, 10);
    const zeroPaddedWidth = rawDigits.length > 1 && rawDigits.startsWith('0') ? rawDigits.length : 0;
    notice = 'Padrão de episódio no ficheiro detetado.';

    for (let i = 0; i < count; i++) {
      const epNum = startEp + i;
      const epSegment = zeroPaddedWidth > 0 ? String(epNum).padStart(zeroPaddedWidth, '0') : String(epNum);
      const rebuiltInner = `${parsedInner.origin}${prefixPath}${epSegment}${ext}${parsedInner.search}${parsedInner.hash}`;
      const rebuiltFinal = useMgeb ? formatMgebWrappedUrl(rebuiltInner) : rebuiltInner;
      links.push({
        episodeNumber: epNum,
        innerUrl: rebuiltInner,
        url: rebuiltFinal
      });
    }

    basePattern = `${useMgeb ? MGEB_PREFIX : ''}${parsedInner.origin}${prefixPath}{episodio}${ext}${parsedInner.search}${parsedInner.hash}`;

    return {
      valid: true,
      notice,
      detectedStartSegment: detectedStart,
      basePattern,
      links
    };
  }

  // Strategy 3: Check trailing numeric path segment (.../1), except when that number belongs to /season/{n} or /temporada/{n}
  const isTrailingSeasonNum = /\/(?:season|temporada|temp)\/\d+\/?$/i.test(parsedInner.pathname);
  const pathMatch = !isTrailingSeasonNum
    ? parsedInner.pathname.match(/^(.*\/)(\d+)(\/?)$/)
    : null;
  if (pathMatch) {
    const [, prefixPath, rawDigits, trailingSlash] = pathMatch;
    detectedStart = parseInt(rawDigits, 10);
    const zeroPaddedWidth = rawDigits.length > 1 && rawDigits.startsWith('0') ? rawDigits.length : 0;
    notice = 'Padrão numérico final detetado no endereço.';

    for (let i = 0; i < count; i++) {
      const epNum = startEp + i;
      const epSegment = zeroPaddedWidth > 0 ? String(epNum).padStart(zeroPaddedWidth, '0') : String(epNum);
      const rebuiltInner = `${parsedInner.origin}${prefixPath}${epSegment}${trailingSlash}${parsedInner.search}${parsedInner.hash}`;
      const rebuiltFinal = useMgeb ? formatMgebWrappedUrl(rebuiltInner) : rebuiltInner;
      links.push({
        episodeNumber: epNum,
        innerUrl: rebuiltInner,
        url: rebuiltFinal
      });
    }

    basePattern = `${useMgeb ? MGEB_PREFIX : ''}${parsedInner.origin}${prefixPath}{episodio}${trailingSlash}${parsedInner.search}${parsedInner.hash}`;

    return {
      valid: true,
      notice,
      detectedStartSegment: detectedStart,
      basePattern,
      links
    };
  }

  // Strategy 4: Season page / base URL without trailing number (Rule: Ep 1 = exact baseUrl, Ep 2+ = baseUrl/{epNum})
  notice = 'Link principal da temporada identificado (Ep 1 = URL-base; Ep 2+ = /{numero}).';
  const trimmedPath = parsedInner.pathname.replace(/\/+$/, '');

  for (let i = 0; i < count; i++) {
    const epNum = startEp + i;
    const rebuiltInner =
      epNum === 1
        ? `${parsedInner.origin}${trimmedPath}${parsedInner.search}${parsedInner.hash}`
        : `${parsedInner.origin}${trimmedPath}/${epNum}${parsedInner.search}${parsedInner.hash}`;
    const rebuiltFinal = useMgeb ? formatMgebWrappedUrl(rebuiltInner) : rebuiltInner;
    links.push({
      episodeNumber: epNum,
      innerUrl: rebuiltInner,
      url: rebuiltFinal
    });
  }

  basePattern = `${useMgeb ? MGEB_PREFIX : ''}${parsedInner.origin}${trimmedPath}/{episodio}${parsedInner.search}${parsedInner.hash}`;

  return {
    valid: true,
    notice,
    detectedStartSegment: startEp,
    basePattern,
    links
  };
}
