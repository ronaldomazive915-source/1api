import dns from 'node:dns/promises';
import net from 'node:net';
import { classifySourceUrl } from '../lib/sourceClassification.js';
import { RecommendedPlaybackMode, SourceDiagnostics, SourceKind, SourceStatus, VideoFormatType } from '../types.js';
import { resolveCuevanaProviderPage } from './providerAdapters.js';
import { detectQualityFromUrlOrMetadata, extractQualitiesFromHlsManifest } from '../lib/videoQualityUtils.js';

export interface ProbeOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  allowLoopbackForTest?: boolean;
}

export interface ProbeResult {
  success: boolean;
  accessible: boolean;
  status: SourceStatus;
  sourceKind: SourceKind;
  detectedFormat: VideoFormatType;
  originalUrl: string;
  finalUrl: string;
  message: string;
  diagnostics: SourceDiagnostics;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(n => parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast / reserved

  return false;
}

function isPrivateOrReservedIp(ipRaw: string): boolean {
  const ip = ipRaw.replace(/^\[|\]$/g, '').toLowerCase();
  const ver = net.isIP(ip);
  if (ver === 4) {
    return isPrivateOrReservedIpv4(ip);
  }
  if (ver === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // Unique local fc00::/7
    if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true; // fe80::/10
    if (ip.startsWith('::ffff:')) {
      const v4 = ip.slice(7);
      if (net.isIP(v4) === 4) return isPrivateOrReservedIpv4(v4);
    }
    return false;
  }
  return true;
}

export async function validatePublicHttpUrl(
  rawUrl: string,
  options?: { allowLoopbackForTest?: boolean }
): Promise<{ safe: boolean; reason?: string; parsed?: URL }> {
  let parsed: URL;
  try {
    parsed = new URL((rawUrl || '').trim());
  } catch {
    return { safe: false, reason: 'URL inválida ou malformada.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Protocolo bloqueado (${parsed.protocol}). Apenas HTTP e HTTPS são permitidos.` };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    return { safe: false, reason: 'Hostname ausente na URL.' };
  }

  if (options?.allowLoopbackForTest) {
    return { safe: true, parsed };
  }

  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { safe: false, reason: 'Destino local ou interno bloqueado pela política de segurança SSRF.' };
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      return { safe: false, reason: 'Endereço IP privado ou reservado bloqueado pela política de segurança SSRF.' };
    }
    return { safe: true, parsed };
  }

  // Resolve DNS records with a bounded 1200ms timeout to guard against DNS rebinding without stalling saves
  try {
    const records = await Promise.race<Array<{ address: string }> | null>([
      dns.lookup(host, { all: true }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 1200))
    ]);
    if (records && records.length > 0) {
      for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
          return { safe: false, reason: 'Domínio resolve para endereço IP privado ou reservado (bloqueio SSRF).' };
        }
      }
    }
  } catch {
    // Allow network-layer error reporting cleanly in probe if DNS transiently fails or host doesn't exist
    return { safe: true, parsed };
  }

  return { safe: true, parsed };
}

export function isUrlSafeSync(rawUrl: string): boolean {
  try {
    const parsed = new URL((rawUrl || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host === 'localhost.localdomain' ||
      host === 'metadata.google.internal' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    if (net.isIP(host)) {
      return !isPrivateOrReservedIp(host);
    }
    return true;
  } catch {
    return false;
  }
}

function parseFramePolicy(headers: Headers): {
  xFrameOptions: string | null;
  cspFrameAncestors: string | null;
  embedAllowed: boolean;
} {
  const xfo = headers.get('x-frame-options');
  const csp = headers.get('content-security-policy');

  let embedAllowed = true;
  let cspFrameAncestors: string | null = null;

  if (xfo) {
    const upper = xfo.toUpperCase();
    if (upper.includes('DENY') || upper.includes('SAMEORIGIN')) {
      embedAllowed = false;
    }
  }

  if (csp) {
    const match = csp.match(/frame-ancestors\s+([^;]+)/i);
    if (match && match[1]) {
      cspFrameAncestors = match[1].trim();
      const lower = cspFrameAncestors.toLowerCase();
      if (lower.includes("'none'") || lower === "'self'") {
        embedAllowed = false;
      } else if (lower.includes("'self'") && !lower.includes('*') && !lower.includes('https:')) {
        embedAllowed = false;
      }
    }
  }

  return {
    xFrameOptions: xfo,
    cspFrameAncestors,
    embedAllowed
  };
}

async function readBoundedSnippet(
  response: Response,
  maxBytes = 4096
): Promise<{ buffer: Buffer; text: string }> {
  if (!response.body) return { buffer: Buffer.alloc(0), text: '' };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // ignore stream cancellation errors
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }

  const merged = Buffer.concat(chunks.map(c => Buffer.from(c))).subarray(0, maxBytes);
  return {
    buffer: merged,
    text: merged.toString('utf-8')
  };
}

function detectFormatFromMagicOrDisposition(
  buffer: Buffer,
  text: string,
  contentDisposition: string | null
): 'mp4' | 'webm' | 'm3u8' | 'dash' | null {
  const disp = (contentDisposition || '').toLowerCase();
  if (disp.includes('.mp4') || disp.includes('.m4v')) return 'mp4';
  if (disp.includes('.webm')) return 'webm';
  if (disp.includes('.m3u8')) return 'm3u8';
  if (disp.includes('.mpd')) return 'dash';

  if (buffer.length >= 8) {
    const headerSlice = buffer.subarray(0, 64);
    if (
      headerSlice.includes(Buffer.from('ftyp')) ||
      headerSlice.subarray(4, 8).toString('ascii') === 'moov' ||
      headerSlice.subarray(4, 8).toString('ascii') === 'mdat' ||
      headerSlice.subarray(4, 8).toString('ascii') === 'free'
    ) {
      return 'mp4';
    }
    if (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return 'webm';
    }
  }

  const trimmed = text.trimStart();
  if (trimmed.startsWith('#EXTM3U')) return 'm3u8';
  if (trimmed.includes('<MPD')) return 'dash';

  return null;
}

async function fetchWithValidatedRedirects(
  initialUrl: string,
  method: 'HEAD' | 'GET',
  options: ProbeOptions
): Promise<{
  response: Response;
  finalUrl: string;
  redirectChain: string[];
}> {
  const timeoutMs = options.timeoutMs ?? 12000;
  const maxRedirects = options.maxRedirects ?? 5;
  const redirectChain: string[] = [];
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const ssrfCheck = await validatePublicHttpUrl(currentUrl, {
      allowLoopbackForTest: options.allowLoopbackForTest
    });
    if (!ssrfCheck.safe) {
      throw new Error(`SSRF_BLOCKED:${ssrfCheck.reason}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*'
      };
      if (method === 'GET') {
        headers['Range'] = 'bytes=0-4095';
      }

      const res = await fetch(currentUrl, {
        method,
        headers,
        redirect: 'manual',
        signal: controller.signal
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (res.body) {
          res.body.cancel().catch(() => {});
        }
        if (!location) {
          return { response: res, finalUrl: currentUrl, redirectChain };
        }
        const nextUrl = new URL(location, currentUrl).toString();
        redirectChain.push(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      return { response: res, finalUrl: currentUrl, redirectChain };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('TOO_MANY_REDIRECTS:Excesso de redirecionamentos HTTP.');
}

export async function probeVideoSource(rawUrl: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const classified = classifySourceUrl(rawUrl);
  const testedAt = new Date().toISOString();

  if (!classified.valid) {
    return {
      success: false,
      accessible: false,
      status: 'offline',
      sourceKind: 'UNKNOWN',
      detectedFormat: 'auto',
      originalUrl: rawUrl,
      finalUrl: rawUrl,
      message: classified.error || 'URL inválida.',
      diagnostics: {
        ...classified.diagnostics,
        failureReason: classified.error || 'URL inválida.',
        testedAt
      }
    };
  }

  const ssrfInitial = await validatePublicHttpUrl(classified.normalizedUrl, {
    allowLoopbackForTest: options.allowLoopbackForTest
  });
  if (!ssrfInitial.safe) {
    return {
      success: false,
      accessible: false,
      status: 'offline',
      sourceKind: classified.sourceKind,
      detectedFormat: classified.suggestedFormat,
      originalUrl: classified.originalUrl,
      finalUrl: classified.normalizedUrl,
      message: ssrfInitial.reason || 'URL bloqueada por política de segurança SSRF.',
      diagnostics: {
        ...classified.diagnostics,
        directPlayable: false,
        recommendedPlaybackMode: 'blocked',
        failureReason: ssrfInitial.reason || 'Bloqueio SSRF.',
        testedAt
      }
    };
  }

  const baseSteps: NonNullable<SourceDiagnostics['diagnosticSteps']> = [
    { step: '1. Validar URL', status: 'ok', detail: `URL válida (${classified.originalUrl})` },
    {
      step: '2. Identificar formato/origem',
      status: 'info',
      detail: `Classificação inicial: ${classified.sourceKind}${classified.providerName ? ` · Fornecedor: ${classified.providerName}` : ''}`
    }
  ];

  // Provider-specific inspection (e.g., Cuevana detail pages without MGEB prefix)
  const providerAdapter = await resolveCuevanaProviderPage(classified.normalizedUrl, {
    timeoutMs: options.timeoutMs ?? 10000
  });
  if (providerAdapter?.handled) {
    return {
      success: providerAdapter.supported,
      accessible: providerAdapter.supported,
      status: providerAdapter.status,
      sourceKind: providerAdapter.sourceKind,
      detectedFormat: providerAdapter.detectedFormat,
      originalUrl: classified.originalUrl,
      finalUrl: providerAdapter.embedUrl || classified.originalUrl,
      message: providerAdapter.message,
      diagnostics: providerAdapter.diagnostics
    };
  }

  try {
    // 1. Controlled HEAD probe
    let probe = await fetchWithValidatedRedirects(classified.normalizedUrl, 'HEAD', options);
    let usedGetFallback = false;

    const headStatus = probe.response.status;
    const headContentType = (probe.response.headers.get('content-type') || '').toLowerCase();

    // Fallback to bounded GET if HEAD is unsupported/rejected or missing Content-Type
    if (
      headStatus === 405 ||
      headStatus === 501 ||
      headStatus === 400 ||
      headStatus === 403 ||
      !headContentType ||
      headContentType.includes('octet-stream') ||
      headContentType.includes('mpegurl') ||
      headContentType.includes('dash+xml') ||
      headContentType.includes('text/html') ||
      headContentType.includes('text/plain') ||
      classified.sourceKind === 'PHP_VIDEO_ENDPOINT'
    ) {
      if (probe.response.body) {
        probe.response.body.cancel().catch(() => {});
      }
      probe = await fetchWithValidatedRedirects(classified.normalizedUrl, 'GET', options);
      usedGetFallback = true;
    }

    const res = probe.response;
    const httpStatus = res.status;
    const rawContentType = res.headers.get('content-type') || '';
    const mimeType = rawContentType.split(';')[0].trim().toLowerCase();
    const contentDisposition = res.headers.get('content-disposition');
    const contentLengthHeader = res.headers.get('content-length');
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
    const acceptRanges = res.headers.get('accept-ranges');
    const framePolicy = parseFramePolicy(res.headers);

    let snippet = '';
    let snippetBuffer: Buffer = Buffer.alloc(0);
    if (
      usedGetFallback &&
      res.body &&
      (mimeType.includes('text/') ||
        mimeType.includes('mpegurl') ||
        mimeType.includes('xml') ||
        mimeType.includes('json') ||
        mimeType === '' ||
        mimeType === 'application/octet-stream' ||
        mimeType.startsWith('video/'))
    ) {
      const readRes = await readBoundedSnippet(res, 4096);
      snippet = readRes.text;
      snippetBuffer = readRes.buffer;
    } else if (res.body) {
      res.body.cancel().catch(() => {});
    }

    const magicDetected = detectFormatFromMagicOrDisposition(snippetBuffer, snippet, contentDisposition);
    const cleanedSnippet = snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const isUpstreamErrorBody =
      !magicDetected &&
      (mimeType.includes('text/plain') || mimeType.includes('text/html') || mimeType === '') &&
      /falha ao baixar|bloqueio de rede|cloudflare|attention required|just a moment|access denied|file not found|video not found/i.test(
        cleanedSnippet.slice(0, 600)
      );

    const qualityDetection = detectQualityFromUrlOrMetadata(probe.finalUrl || classified.originalUrl);
    const availableQualities = snippet.includes('#EXTM3U')
      ? extractQualitiesFromHlsManifest(snippet)
      : qualityDetection.availableQualities;

    const baseDiagnostics: SourceDiagnostics = {
      ...classified.diagnostics,
      httpStatus,
      contentType: rawContentType || null,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      acceptRanges: acceptRanges || null,
      finalUrl: probe.finalUrl,
      redirectChain: probe.redirectChain,
      xFrameOptions: framePolicy.xFrameOptions,
      cspFrameAncestors: framePolicy.cspFrameAncestors,
      embedAllowed: framePolicy.embedAllowed,
      externalPageUrl: classified.sourceKind === 'WEB_PAGE' ? (probe.finalUrl || classified.originalUrl) : classified.diagnostics.externalPageUrl,
      maxDetectedResolution: qualityDetection.maxDetectedResolution,
      availableQualities,
      analysisStatus: 'identified',
      testedAt
    };

    // HTTP error responses (4xx / 5xx)
    if (httpStatus >= 400) {
      const isForbiddenOrBlocked = httpStatus === 401 || httpStatus === 403;
      const isWebPageOrEmbedBlocked = isForbiddenOrBlocked && (classified.sourceKind === 'WEB_PAGE' || !framePolicy.embedAllowed);
      const reason = isWebPageOrEmbedBlocked
        ? `HTTP ${httpStatus} — O fornecedor recusou o acesso direto e bloqueia incorporação externa (${framePolicy.xFrameOptions || framePolicy.cspFrameAncestors || 'proteção Cloudflare/WAF'}).`
        : isForbiddenOrBlocked
          ? `HTTP ${httpStatus} — O servidor recusou o acesso direto.`
          : httpStatus === 404 || httpStatus === 410
            ? `HTTP ${httpStatus} — Conteúdo não encontrado no servidor de origem.`
            : `HTTP ${httpStatus} — Erro retornado pelo servidor de origem.`;

      const verificationLabel = isWebPageOrEmbedBlocked ? 'INCORPORAÇÃO NÃO PERMITIDA' : 'ERRO DE REDE';
      return {
        success: false,
        accessible: false,
        status: isWebPageOrEmbedBlocked ? 'embed_blocked' : 'offline',
        sourceKind: classified.sourceKind,
        detectedFormat: classified.sourceKind === 'WEB_PAGE' ? 'html' : classified.suggestedFormat,
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: reason,
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: false,
          recommendedPlaybackMode: isWebPageOrEmbedBlocked ? 'blocked' : 'unknown',
          failureReason: reason,
          verificationLabel,
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Testar disponibilidade', status: 'error', detail: reason }
          ]
        }
      };
    }

    // Upstream proxy / MGEB plain-text or HTML error (even with HTTP 200)
    if (isUpstreamErrorBody && classified.sourceKind === 'PHP_VIDEO_ENDPOINT') {
      const snippetPreview = cleanedSnippet.slice(0, 140);
      const reason = `O servidor intermediário retornou um erro em vez de vídeo: "${snippetPreview}"`;
      return {
        success: false,
        accessible: false,
        status: 'offline',
        sourceKind: 'PHP_VIDEO_ENDPOINT',
        detectedFormat: 'html',
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: reason,
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: false,
          recommendedPlaybackMode: 'unknown',
          failureReason: reason,
          verificationLabel: 'ERRO DE REDE',
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Verificar fluxo devolvido', status: 'error', detail: reason }
          ]
        }
      };
    }

    // 2. Inspect real MIME / body snippet / magic bytes
    const finalPathname = (() => {
      try {
        return new URL(probe.finalUrl).pathname.toLowerCase();
      } catch {
        return '';
      }
    })();

    // A) Direct MP4 (MIME, extension, Content-Disposition, or binary ftyp atom)
    if (
      mimeType === 'video/mp4' ||
      mimeType === 'video/m4v' ||
      magicDetected === 'mp4' ||
      (mimeType === 'application/octet-stream' && finalPathname.endsWith('.mp4'))
    ) {
      const detectedKind: SourceKind =
        classified.sourceKind === 'PHP_VIDEO_ENDPOINT' ? 'PHP_VIDEO_ENDPOINT' : 'DIRECT_MP4';
      const msg =
        detectedKind === 'PHP_VIDEO_ENDPOINT'
          ? 'Endpoint PHP devolveu fluxo de vídeo MP4 compatível.'
          : 'Vídeo MP4 direto verificado e acessível.';
      return {
        success: true,
        accessible: true,
        status: 'online',
        sourceKind: detectedKind,
        detectedFormat: 'mp4',
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: msg,
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: true,
          recommendedPlaybackMode: 'html5_mp4',
          failureReason: null,
          verificationLabel: 'REPRODUÇÃO SUPORTADA',
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Resposta HTTP', status: 'ok', detail: `HTTP ${httpStatus} · ${rawContentType || 'video/mp4'}` },
            { step: '4. Compatibilidade', status: 'ok', detail: msg }
          ]
        }
      };
    }

    // B) Direct WebM
    if (
      mimeType === 'video/webm' ||
      magicDetected === 'webm' ||
      (mimeType === 'application/octet-stream' && finalPathname.endsWith('.webm'))
    ) {
      const detectedKind: SourceKind =
        classified.sourceKind === 'PHP_VIDEO_ENDPOINT' ? 'PHP_VIDEO_ENDPOINT' : 'DIRECT_WEBM';
      const msg =
        detectedKind === 'PHP_VIDEO_ENDPOINT'
          ? 'Endpoint PHP devolveu vídeo WebM compatível.'
          : 'Vídeo WebM direto verificado e acessível.';
      return {
        success: true,
        accessible: true,
        status: 'online',
        sourceKind: detectedKind,
        detectedFormat: 'webm',
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: msg,
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: true,
          recommendedPlaybackMode: 'html5_webm',
          failureReason: null,
          verificationLabel: 'REPRODUÇÃO SUPORTADA',
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Resposta HTTP', status: 'ok', detail: `HTTP ${httpStatus} · ${rawContentType || 'video/webm'}` },
            { step: '4. Compatibilidade', status: 'ok', detail: msg }
          ]
        }
      };
    }

    // C) HLS / M3U8
    if (
      mimeType.includes('mpegurl') ||
      magicDetected === 'm3u8' ||
      snippet.trimStart().startsWith('#EXTM3U')
    ) {
      const detectedKind: SourceKind =
        classified.sourceKind === 'PHP_VIDEO_ENDPOINT' ? 'PHP_VIDEO_ENDPOINT' : 'DIRECT_HLS';
      const msg =
        detectedKind === 'PHP_VIDEO_ENDPOINT'
          ? 'Endpoint devolveu manifesto HLS (M3U8) válido para reprodução direta.'
          : 'Manifesto HLS (M3U8) verificado com sucesso.';
      return {
        success: true,
        accessible: true,
        status: 'online',
        sourceKind: detectedKind,
        detectedFormat: 'm3u8',
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: msg,
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: true,
          recommendedPlaybackMode: 'hls',
          failureReason: null,
          verificationLabel: 'REPRODUÇÃO SUPORTADA',
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Resposta HTTP', status: 'ok', detail: `HTTP ${httpStatus} · ${rawContentType || 'application/vnd.apple.mpegurl'}` },
            { step: '4. Manifesto HLS', status: 'ok', detail: 'Assinatura #EXTM3U confirmada; pronto para hls.js.' }
          ]
        }
      };
    }

    // D) DASH / MPD
    if (
      mimeType.includes('dash+xml') ||
      snippet.includes('<MPD') ||
      (mimeType.includes('xml') && finalPathname.endsWith('.mpd'))
    ) {
      const detectedKind: SourceKind =
        classified.sourceKind === 'PHP_VIDEO_ENDPOINT' ? 'PHP_VIDEO_ENDPOINT' : 'DIRECT_DASH';
      const msg =
        detectedKind === 'PHP_VIDEO_ENDPOINT'
          ? 'Endpoint devolveu manifesto DASH (.mpd) válido.'
          : 'Manifesto DASH (.mpd) verificado com sucesso.';
      return {
        success: true,
        accessible: true,
        status: 'online',
        sourceKind: detectedKind,
        detectedFormat: 'dash',
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: msg,
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: true,
          recommendedPlaybackMode: 'dash',
          failureReason: null,
          verificationLabel: 'REPRODUÇÃO SUPORTADA',
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Resposta HTTP', status: 'ok', detail: `HTTP ${httpStatus} · ${rawContentType || 'application/dash+xml'}` },
            { step: '4. Manifesto DASH', status: 'ok', detail: msg }
          ]
        }
      };
    }

    // E) HTML Page / PHP returning text/html
    if (mimeType.includes('text/html') || mimeType.includes('application/xhtml') || snippet.toLowerCase().includes('<html')) {
      const resolvedKind: SourceKind =
        classified.sourceKind === 'PHP_VIDEO_ENDPOINT'
          ? 'PHP_VIDEO_ENDPOINT'
          : classified.sourceKind === 'EMBED_PLAYER'
            ? 'EMBED_PLAYER'
            : 'WEB_PAGE';

      if (!framePolicy.embedAllowed) {
        const blockReason = `Servidor retornou text/html com restrição de incorporação (${framePolicy.xFrameOptions || framePolicy.cspFrameAncestors || 'frame-ancestors'}).`;
        return {
          success: false,
          accessible: true,
          status: 'embed_blocked',
          sourceKind: resolvedKind,
          detectedFormat: 'html',
          originalUrl: classified.originalUrl,
          finalUrl: probe.finalUrl,
          message: 'Esta página não permite incorporação externa (X-Frame-Options / CSP).',
          diagnostics: {
            ...baseDiagnostics,
            directPlayable: false,
            recommendedPlaybackMode: 'blocked',
            failureReason: blockReason,
            externalPageUrl: probe.finalUrl || classified.originalUrl,
            verificationLabel: 'INCORPORAÇÃO NÃO PERMITIDA',
            diagnosticSteps: [
              ...baseSteps,
              { step: '3. Resposta HTTP', status: 'warn', detail: `HTTP ${httpStatus} · ${rawContentType || 'text/html'}` },
              { step: '4. Política de Iframe', status: 'error', detail: blockReason }
            ]
          }
        };
      }

      if (resolvedKind === 'WEB_PAGE' || resolvedKind === 'PHP_VIDEO_ENDPOINT') {
        const hasVideoTag = /<video[\s>]|<iframe[\s>]/i.test(snippet);
        if (!hasVideoTag || resolvedKind === 'WEB_PAGE') {
          const htmlReason =
            resolvedKind === 'PHP_VIDEO_ENDPOINT'
              ? `O endpoint devolveu HTML sem fluxo de vídeo compatível (${cleanedSnippet.slice(0, 120) || 'sem stream'}).`
              : 'O endereço devolveu uma página HTML informativa (text/html) e não um fluxo direto MP4/HLS/DASH ou embed oficial.';
          return {
            success: false,
            accessible: true,
            status: 'unsupported_format',
            sourceKind: resolvedKind,
            detectedFormat: 'html',
            originalUrl: classified.originalUrl,
            finalUrl: probe.finalUrl,
            message: htmlReason,
            diagnostics: {
              ...baseDiagnostics,
              directPlayable: false,
              recommendedPlaybackMode: 'unsupported',
              failureReason: htmlReason,
              externalPageUrl: probe.finalUrl || classified.originalUrl,
              verificationLabel: 'FONTE INCOMPATÍVEL',
              diagnosticSteps: [
                ...baseSteps,
                { step: '3. Resposta HTTP', status: 'warn', detail: `HTTP ${httpStatus} · ${rawContentType || 'text/html'}` },
                { step: '4. Compatibilidade', status: 'error', detail: htmlReason }
              ]
            }
          };
        }
      }

      // Authorized Embed player returning embeddable HTML with video/player markup
      const hasEmbeddedMediaTag = /<video[\s>]|<iframe[\s>]|source\s+src=|hls\.js|jwplayer|plyr|videojs/i.test(snippet);
      return {
        success: hasEmbeddedMediaTag,
        accessible: true,
        status: hasEmbeddedMediaTag ? 'online' : 'unverifiable',
        sourceKind: resolvedKind,
        detectedFormat: 'iframe',
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: hasEmbeddedMediaTag
          ? 'Player incorporado compatível detetado (Iframe).'
          : 'Não foi possível confirmar a reprodução automaticamente. A fonte necessita de teste no player.',
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: false,
          recommendedPlaybackMode: 'iframe',
          failureReason: hasEmbeddedMediaTag
            ? null
            : 'O servidor devolveu HTTP 200 em HTML, sem confirmação automática de fluxo de vídeo direto.',
          verificationLabel: hasEmbeddedMediaTag ? 'REPRODUÇÃO SUPORTADA' : 'FORMATO IDENTIFICADO',
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Resposta HTTP', status: 'ok', detail: `HTTP ${httpStatus} · HTML embeddable` }
          ]
        }
      };
    }

    // F) Any other video/* MIME
    if (mimeType.startsWith('video/')) {
      return {
        success: true,
        accessible: true,
        status: 'online',
        sourceKind: classified.sourceKind,
        detectedFormat: classified.suggestedFormat,
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: `Fluxo de vídeo (${mimeType}) acessível.`,
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: true,
          recommendedPlaybackMode: 'html5_mp4',
          failureReason: null,
          verificationLabel: 'REPRODUÇÃO SUPORTADA',
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Resposta HTTP', status: 'ok', detail: `HTTP ${httpStatus} · ${rawContentType}` }
          ]
        }
      };
    }

    // G) Binary octet-stream on PHP endpoint or CDN without explicit Content-Type text error -> needs browser playback test
    if (
      (mimeType === 'application/octet-stream' || mimeType === '') &&
      (classified.sourceKind === 'PHP_VIDEO_ENDPOINT' ||
        classified.sourceKind === 'DIRECT_MP4' ||
        classified.sourceKind === 'DIRECT_WEBM')
    ) {
      return {
        success: true,
        accessible: true,
        status: 'unverifiable',
        sourceKind: classified.sourceKind,
        detectedFormat: classified.suggestedFormat,
        originalUrl: classified.originalUrl,
        finalUrl: probe.finalUrl,
        message: 'Stream binário detetado sem cabeçalho MIME explícito; pronto para teste no player.',
        diagnostics: {
          ...baseDiagnostics,
          directPlayable: true,
          recommendedPlaybackMode: classified.sourceKind === 'DIRECT_WEBM' ? 'html5_webm' : 'html5_mp4',
          failureReason: null,
          verificationLabel: 'FORMATO IDENTIFICADO',
          diagnosticSteps: [
            ...baseSteps,
            { step: '3. Resposta HTTP', status: 'info', detail: `HTTP ${httpStatus} · ${rawContentType || 'binário'}` }
          ]
        }
      };
    }

    // H) Unsupported Content-Type (JSON error, plain text, image, etc.)
    const unsupportedReason = mimeType
      ? `A fonte não devolveu um formato de vídeo compatível (Content-Type: ${mimeType}).`
      : 'O servidor não informou um Content-Type de vídeo compatível.';

    return {
      success: false,
      accessible: true,
      status: 'unsupported_format',
      sourceKind: classified.sourceKind,
      detectedFormat: classified.suggestedFormat,
      originalUrl: classified.originalUrl,
      finalUrl: probe.finalUrl,
      message: unsupportedReason,
      diagnostics: {
        ...baseDiagnostics,
        directPlayable: false,
        recommendedPlaybackMode: 'unsupported',
        failureReason: unsupportedReason,
        verificationLabel: 'FONTE INCOMPATÍVEL',
        diagnosticSteps: [
          ...baseSteps,
          { step: '3. Compatibilidade', status: 'error', detail: unsupportedReason }
        ]
      }
    };
  } catch (err: any) {
    const rawMsg = err?.message || 'Erro de ligação.';
    if (rawMsg.startsWith('SSRF_BLOCKED:')) {
      const reason = rawMsg.replace('SSRF_BLOCKED:', '');
      return {
        success: false,
        accessible: false,
        status: 'offline',
        sourceKind: classified.sourceKind,
        detectedFormat: classified.suggestedFormat,
        originalUrl: classified.originalUrl,
        finalUrl: classified.normalizedUrl,
        message: reason,
        diagnostics: {
          ...classified.diagnostics,
          directPlayable: false,
          recommendedPlaybackMode: 'blocked',
          failureReason: reason,
          testedAt
        }
      };
    }

    if (err?.name === 'AbortError' || rawMsg.toLowerCase().includes('abort')) {
      return {
        success: false,
        accessible: false,
        status: 'unverifiable',
        sourceKind: classified.sourceKind,
        detectedFormat: classified.suggestedFormat,
        originalUrl: classified.originalUrl,
        finalUrl: classified.normalizedUrl,
        message: 'Não foi possível confirmar a reprodução automaticamente. A fonte necessita de teste no player.',
        diagnostics: {
          ...classified.diagnostics,
          directPlayable: false,
          recommendedPlaybackMode: 'unknown',
          failureReason: 'Tempo limite excedido ao aguardar resposta do servidor remoto.',
          corsNote: 'Sem confirmação automática do servidor remoto; teste no player do navegador.',
          testedAt
        }
      };
    }

    return {
      success: false,
      accessible: false,
      status: 'unverifiable',
      sourceKind: classified.sourceKind,
      detectedFormat: classified.suggestedFormat,
      originalUrl: classified.originalUrl,
      finalUrl: classified.normalizedUrl,
      message: 'Não foi possível confirmar a reprodução automaticamente. A fonte necessita de teste no player.',
      diagnostics: {
        ...classified.diagnostics,
        directPlayable: false,
        recommendedPlaybackMode: 'unknown',
        failureReason: rawMsg,
        corsNote: 'O servidor externo pode bloquear inspeção automática ou estar inacessível a partir deste ambiente.',
        testedAt
      }
    };
  }
}
