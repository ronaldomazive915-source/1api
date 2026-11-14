export const MGEB_PREFIX = 'https://mgeb.space/mp4.php?url=';

export interface MgebUrlResult {
  originalInput: string;
  innerUrl: string;
  finalUrl: string;
  hadMgebPrefix: boolean;
  valid: boolean;
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
  basePattern?: string;
  detectedStartSegment?: number;
  links: GeneratedEpisodeLink[];
}

const MGEB_PREFIX_REGEX = /^https?:\/\/mgeb\.space\/mp4\.php\?url=/i;

/**
 * Strips one or more accidental MGEB prefixes so the prefix is never duplicated.
 */
export function stripMgebPrefix(raw: string): { hadPrefix: boolean; innerUrl: string } {
  let current = (raw || '').trim();
  let hadPrefix = false;

  while (MGEB_PREFIX_REGEX.test(current)) {
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
      hadMgebPrefix: false,
      valid: false,
      error: 'Cole o endereço original da fonte.'
    };
  }

  const { hadPrefix, innerUrl } = stripMgebPrefix(trimmed);
  if (!innerUrl) {
    return {
      originalInput: trimmed,
      innerUrl: '',
      finalUrl: useMgebPrefix ? MGEB_PREFIX : '',
      hadMgebPrefix: hadPrefix,
      valid: false,
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
      finalUrl: useMgebPrefix ? `${MGEB_PREFIX}${innerUrl}` : innerUrl,
      hadMgebPrefix: hadPrefix,
      valid: false,
      error: 'Endereço inválido. Utilize uma URL completa iniciada por http:// ou https://.'
    };
  }

  if (parsedInner.protocol !== 'http:' && parsedInner.protocol !== 'https:') {
    return {
      originalInput: trimmed,
      innerUrl,
      finalUrl: useMgebPrefix ? `${MGEB_PREFIX}${innerUrl}` : innerUrl,
      hadMgebPrefix: hadPrefix,
      valid: false,
      error: `Protocolo não suportado (${parsedInner.protocol}). Utilize http:// ou https://.`
    };
  }

  if (!parsedInner.hostname || !parsedInner.hostname.includes('.')) {
    return {
      originalInput: trimmed,
      innerUrl,
      finalUrl: useMgebPrefix ? `${MGEB_PREFIX}${innerUrl}` : innerUrl,
      hadMgebPrefix: hadPrefix,
      valid: false,
      error: 'Domínio inválido no link da fonte.'
    };
  }

  const finalUrl = useMgebPrefix ? `${MGEB_PREFIX}${innerUrl}` : innerUrl;
  return {
    originalInput: trimmed,
    innerUrl,
    finalUrl,
    hadMgebPrefix: hadPrefix,
    valid: true
  };
}

/**
 * Generates sequential episode links strictly modifying ONLY the last numeric path segment
 * of the inner URL. Preserves domain, series ID, series name, MGEB prefix, and query params.
 */
export function generateEpisodeLinks(params: {
  firstLink: string;
  useMgebPrefix?: boolean;
  startEpisode: number;
  episodeCount: number;
}): EpisodeGenerationResult {
  const useMgeb = params.useMgebPrefix !== false;
  const startEp = Math.max(1, Math.floor(Number(params.startEpisode) || 1));
  const count = Math.max(1, Math.min(500, Math.floor(Number(params.episodeCount) || 1)));

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

  // Strictly match ONLY the final numeric path segment (e.g. .../4HZYF41zZ0zPPiRb0OsGi-Lanterns/1)
  const pathMatch = parsedInner.pathname.match(/^(.*\/)(\d+)(\/?)$/);
  if (!pathMatch) {
    return {
      valid: false,
      error:
        'Não foi possível identificar o número do episódio no final do endereço (ex: .../1). Informe um link válido terminado em número.',
      links: []
    };
  }

  const [, prefixPath, rawDigits, trailingSlash] = pathMatch;
  const detectedStart = parseInt(rawDigits, 10);
  const zeroPaddedWidth = rawDigits.length > 1 && rawDigits.startsWith('0') ? rawDigits.length : 0;

  const links: GeneratedEpisodeLink[] = [];
  for (let i = 0; i < count; i++) {
    const epNum = startEp + i;
    const epSegment = zeroPaddedWidth > 0 ? String(epNum).padStart(zeroPaddedWidth, '0') : String(epNum);
    const rebuiltInner = `${parsedInner.origin}${prefixPath}${epSegment}${trailingSlash}${parsedInner.search}${parsedInner.hash}`;
    const rebuiltFinal = useMgeb ? `${MGEB_PREFIX}${rebuiltInner}` : rebuiltInner;
    links.push({
      episodeNumber: epNum,
      innerUrl: rebuiltInner,
      url: rebuiltFinal
    });
  }

  return {
    valid: true,
    detectedStartSegment: detectedStart,
    basePattern: `${useMgeb ? MGEB_PREFIX : ''}${parsedInner.origin}${prefixPath}{episodio}${trailingSlash}${parsedInner.search}${parsedInner.hash}`,
    links
  };
}
