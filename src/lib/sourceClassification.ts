import {
  CanonicalSourceClassification,
  CanonicalSourceState,
  SourceDiagnostics,
  SourceKind,
  SourceStatus,
  VideoFormatType
} from '../types.js';

export interface StaticSourceClassification {
  valid: boolean;
  error?: string;
  originalUrl: string;
  normalizedUrl: string;
  sourceKind: SourceKind;
  suggestedFormat: VideoFormatType;
  suggestedServerName?: string;
  diagnostics: SourceDiagnostics;
}

const KNOWN_EMBED_HOST_PATTERNS = [
  'uqload.',
  'anonmp4.',
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'dailymotion.com',
  'ok.ru',
  'drive.google.com',
  'player.',
  'embed.'
];

const KNOWN_EMBED_PATH_PATTERNS = [
  '/embed/',
  '/embed-',
  '/e/',
  '/iframe/'
];

export function classifySourceUrl(rawUrl: string): StaticSourceClassification {
  const trimmed = (rawUrl || '').trim();

  if (!trimmed) {
    return {
      valid: false,
      error: 'URL vazia.',
      originalUrl: trimmed,
      normalizedUrl: '',
      sourceKind: 'UNKNOWN',
      suggestedFormat: 'auto',
      diagnostics: {
        directPlayable: false,
        recommendedPlaybackMode: 'unknown',
        failureReason: 'URL vazia.'
      }
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: 'URL malformada. Utilize um endereço completo iniciado por http:// ou https://.',
      originalUrl: trimmed,
      normalizedUrl: '',
      sourceKind: 'UNKNOWN',
      suggestedFormat: 'auto',
      diagnostics: {
        directPlayable: false,
        recommendedPlaybackMode: 'unknown',
        failureReason: 'URL inválida ou malformada.'
      }
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Protocolo não permitido (${parsed.protocol}). Apenas HTTP e HTTPS são aceites.`,
      originalUrl: trimmed,
      normalizedUrl: '',
      sourceKind: 'UNKNOWN',
      suggestedFormat: 'auto',
      diagnostics: {
        domain: parsed.hostname,
        endpointPath: parsed.pathname,
        directPlayable: false,
        recommendedPlaybackMode: 'blocked',
        failureReason: `Protocolo inseguro ou não suportado: ${parsed.protocol}`
      }
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  // Extract nested ?url= parameter ONLY for inspection — NEVER overwrite originalUrl!
  const urlParamValue =
    parsed.searchParams.get('url') ??
    parsed.searchParams.get('src') ??
    parsed.searchParams.get('link') ??
    parsed.searchParams.get('file');
  const hasUrlParam = parsed.searchParams.has('url');
  let nestedUrl: string | null = null;
  if (urlParamValue) {
    try {
      nestedUrl = decodeURIComponent(urlParamValue).trim();
    } catch {
      nestedUrl = urlParamValue.trim();
    }
  }

  // 1. PHP Video Endpoint (e.g., https://mgeb.space/mp4.php?url=...)
  // CRITICAL: Do NOT classify as DIRECT_MP4 before real HTTP Content-Type inspection!
  if (pathname.endsWith('.php')) {
    const isMgeb = hostname.includes('mgeb');
    return {
      valid: true,
      originalUrl: trimmed,
      normalizedUrl: parsed.toString(),
      sourceKind: 'PHP_VIDEO_ENDPOINT',
      suggestedFormat: 'php_endpoint',
      suggestedServerName: isMgeb ? 'MGEB Endpoint' : 'Endpoint PHP',
      diagnostics: {
        domain: hostname,
        endpointPath: parsed.pathname,
        hasUrlParam,
        nestedUrl,
        isPhpEndpoint: true,
        directPlayable: false,
        recommendedPlaybackMode: 'unknown'
      }
    };
  }

  // 2. Direct video/manifest extensions (strictly by URL pathname, NOT query params!)
  if (pathname.endsWith('.mp4') || pathname.endsWith('.m4v')) {
    return {
      valid: true,
      originalUrl: trimmed,
      normalizedUrl: parsed.toString(),
      sourceKind: 'DIRECT_MP4',
      suggestedFormat: 'mp4',
      diagnostics: {
        domain: hostname,
        endpointPath: parsed.pathname,
        hasUrlParam,
        nestedUrl,
        isPhpEndpoint: false,
        directPlayable: true,
        recommendedPlaybackMode: 'html5_mp4'
      }
    };
  }

  if (pathname.endsWith('.m3u8')) {
    return {
      valid: true,
      originalUrl: trimmed,
      normalizedUrl: parsed.toString(),
      sourceKind: 'DIRECT_HLS',
      suggestedFormat: 'm3u8',
      diagnostics: {
        domain: hostname,
        endpointPath: parsed.pathname,
        hasUrlParam,
        nestedUrl,
        isPhpEndpoint: false,
        directPlayable: true,
        recommendedPlaybackMode: 'hls'
      }
    };
  }

  if (pathname.endsWith('.mpd')) {
    return {
      valid: true,
      originalUrl: trimmed,
      normalizedUrl: parsed.toString(),
      sourceKind: 'DIRECT_DASH',
      suggestedFormat: 'dash',
      diagnostics: {
        domain: hostname,
        endpointPath: parsed.pathname,
        hasUrlParam,
        nestedUrl,
        isPhpEndpoint: false,
        directPlayable: true,
        recommendedPlaybackMode: 'dash'
      }
    };
  }

  if (pathname.endsWith('.webm')) {
    return {
      valid: true,
      originalUrl: trimmed,
      normalizedUrl: parsed.toString(),
      sourceKind: 'DIRECT_WEBM',
      suggestedFormat: 'webm',
      diagnostics: {
        domain: hostname,
        endpointPath: parsed.pathname,
        hasUrlParam,
        nestedUrl,
        isPhpEndpoint: false,
        directPlayable: true,
        recommendedPlaybackMode: 'html5_webm'
      }
    };
  }

  // 3. Known Embed Players
  const matchesEmbedHost = KNOWN_EMBED_HOST_PATTERNS.some(p => hostname.includes(p));
  const matchesEmbedPath = KNOWN_EMBED_PATH_PATTERNS.some(p => pathname.includes(p));
  if (matchesEmbedHost || matchesEmbedPath) {
    let suggestedServerName: string | undefined;
    if (hostname.includes('uqload')) suggestedServerName = 'UQLOAD';
    else if (hostname.includes('anonmp4')) suggestedServerName = 'AnonMP4';

    return {
      valid: true,
      originalUrl: trimmed,
      normalizedUrl: parsed.toString(),
      sourceKind: 'EMBED_PLAYER',
      suggestedFormat: 'embed',
      suggestedServerName,
      diagnostics: {
        domain: hostname,
        endpointPath: parsed.pathname,
        hasUrlParam,
        nestedUrl,
        isPhpEndpoint: false,
        directPlayable: false,
        recommendedPlaybackMode: 'iframe'
      }
    };
  }

  // 4. HTML Web Pages
  if (
    pathname.endsWith('.html') ||
    pathname.endsWith('.htm') ||
    pathname.includes('/detail/') ||
    pathname.includes('/movie/') ||
    pathname.includes('/series/') ||
    pathname.includes('/watch')
  ) {
    return {
      valid: true,
      originalUrl: trimmed,
      normalizedUrl: parsed.toString(),
      sourceKind: 'WEB_PAGE',
      suggestedFormat: 'html',
      diagnostics: {
        domain: hostname,
        endpointPath: parsed.pathname,
        hasUrlParam,
        nestedUrl,
        isPhpEndpoint: false,
        directPlayable: false,
        recommendedPlaybackMode: 'unknown'
      }
    };
  }

  // 5. Fallback UNKNOWN (needs HTTP probe)
  return {
    valid: true,
    originalUrl: trimmed,
    normalizedUrl: parsed.toString(),
    sourceKind: 'UNKNOWN',
    suggestedFormat: 'auto',
    diagnostics: {
      domain: hostname,
      endpointPath: parsed.pathname,
      hasUrlParam,
      nestedUrl,
      isPhpEndpoint: false,
      directPlayable: false,
      recommendedPlaybackMode: 'unknown'
    }
  };
}

export function getStatusDisplayInfo(status?: SourceStatus | string): {
  code: string;
  label: string;
  tone: 'emerald' | 'red' | 'blue' | 'zinc' | 'amber' | 'purple' | 'orange';
} {
  const s = (status || 'registered').toLowerCase();
  switch (s) {
    case 'online':
    case 'active':
      return { code: 'online', label: 'ONLINE', tone: 'emerald' };
    case 'offline':
    case 'inactive':
      return { code: 'offline', label: 'OFFLINE', tone: 'red' };
    case 'validating':
    case 'verifying':
      return { code: 'validating', label: 'A VALIDAR', tone: 'blue' };
    case 'unverifiable':
    case 'playback_unverified':
      return { code: 'unverifiable', label: 'NÃO VERIFICÁVEL', tone: 'amber' };
    case 'unsupported_format':
    case 'incompatible':
      return { code: 'unsupported_format', label: 'FORMATO NÃO SUPORTADO', tone: 'purple' };
    case 'embed_blocked':
      return { code: 'embed_blocked', label: 'INCORPORAÇÃO BLOQUEADA', tone: 'orange' };
    case 'registered':
    case 'unverified':
    default:
      return { code: 'registered', label: 'REGISTADA', tone: 'zinc' };
  }
}

export function getSourceKindLabel(kind?: SourceKind | string): string {
  switch (kind) {
    case 'DIRECT_MP4':
      return 'DIRECT_MP4 (MP4 Direto)';
    case 'DIRECT_HLS':
      return 'DIRECT_HLS (M3U8 / HLS)';
    case 'DIRECT_DASH':
      return 'DIRECT_DASH (DASH .mpd)';
    case 'DIRECT_WEBM':
      return 'DIRECT_WEBM (WebM Direto)';
    case 'PHP_VIDEO_ENDPOINT':
      return 'PHP_VIDEO_ENDPOINT (.php)';
    case 'EMBED_PLAYER':
      return 'EMBED_PLAYER (Iframe)';
    case 'WEB_PAGE':
      return 'WEB_PAGE (Página HTML)';
    case 'UNKNOWN':
    default:
      return 'UNKNOWN (Desconhecido)';
  }
}

export function mapToCanonicalClassification(
  kind?: SourceKind | string,
  format?: string,
  recommendedMode?: string
): CanonicalSourceClassification {
  const f = (format || '').toLowerCase();
  const mode = (recommendedMode || '').toLowerCase();
  if (kind === 'DIRECT_MP4' || kind === 'DIRECT_WEBM' || mode === 'html5_mp4' || mode === 'html5_webm' || f === 'mp4' || f === 'webm') {
    return 'DIRECT_MP4';
  }
  if (kind === 'DIRECT_HLS' || mode === 'hls' || f === 'm3u8' || f === 'hls') {
    return 'HLS_M3U8';
  }
  if (kind === 'DIRECT_DASH' || mode === 'dash' || f === 'dash' || f === 'mpd') {
    return 'DASH_MPD';
  }
  if (kind === 'EMBED_PLAYER' || mode === 'iframe' || f === 'embed' || f === 'iframe') {
    return 'AUTHORIZED_EMBED';
  }
  if (kind === 'WEB_PAGE' || f === 'html') {
    return 'EXTERNAL_PAGE';
  }
  return 'UNKNOWN';
}

export function mapToCanonicalState(status?: SourceStatus | string): CanonicalSourceState {
  const s = (status || '').toLowerCase();
  if (s === 'online' || s === 'active') return 'ONLINE';
  if (s === 'offline' || s === 'inactive') return 'OFFLINE';
  if (s === 'registered' || s === 'validating' || s === 'verifying' || s === 'unverified') return 'PENDING';
  if (s === 'unsupported_format' || s === 'incompatible' || s === 'embed_blocked') return 'INVALID';
  return 'UNKNOWN';
}

