import { classifySourceUrl } from '../lib/sourceClassification.js';
import { SourceDiagnostics, SourceKind, SourceStatus, VideoFormatType } from '../types.js';

export interface ProviderAdapterResult {
  handled: boolean;
  adapterName: string;
  supported: boolean;
  isDirect: boolean;
  directUrl?: string;
  embedUrl?: string;
  externalPageUrl?: string;
  status: SourceStatus;
  sourceKind: SourceKind;
  detectedFormat: VideoFormatType;
  verificationLabel:
    | 'FONTE VÁLIDA'
    | 'FORMATO IDENTIFICADO'
    | 'REPRODUÇÃO SUPORTADA'
    | 'REPRODUÇÃO CONFIRMADA'
    | 'FONTE INCOMPATÍVEL'
    | 'INCORPORAÇÃO NÃO PERMITIDA'
    | 'ERRO DE REDE'
    | 'ERRO DE CONFIGURAÇÃO';
  message: string;
  diagnostics: SourceDiagnostics;
}

function getDetailPageLabel(detailKind?: string): string {
  switch (detailKind) {
    case 'movie_detail':
      return 'página de detalhes de filme';
    case 'series_detail':
      return 'página principal de série';
    case 'episode_detail':
      return 'página de episódio';
    default:
      return 'página web externa';
  }
}

/**
 * Resolves known external provider pages (such as Cuevana detail pages) cleanly and legally.
 * Checks only documented HTTP responses, official oEmbed links, or standard OpenGraph video metadata.
 * Never bypasses Cloudflare, DRM, X-Frame-Options, or fabricates unauthorized stream URLs.
 */
export async function resolveCuevanaProviderPage(
  rawUrl: string,
  options?: { timeoutMs?: number }
): Promise<ProviderAdapterResult | null> {
  const classified = classifySourceUrl(rawUrl);
  if (!classified.valid) return null;

  const domain = (classified.diagnostics.domain || '').toLowerCase();
  const isCuevana = domain.includes('cuevana');
  if (!isCuevana || classified.sourceKind === 'PHP_VIDEO_ENDPOINT') {
    return null;
  }

  const pageLabel = getDetailPageLabel(classified.detailKind);
  const testedAt = new Date().toISOString();
  const steps: NonNullable<SourceDiagnostics['diagnosticSteps']> = [
    { step: '1. Validar URL', status: 'ok', detail: `URL válida (${classified.originalUrl})` },
    { step: '2. Identificar fornecedor', status: 'info', detail: `Fornecedor detetado: Cuevana (${domain})` },
    { step: '3. Classificar endereço', status: 'info', detail: `Classificado como ${pageLabel} (${classified.detailKind || 'web_page'}).` }
  ];

  const timeoutMs = options?.timeoutMs ?? 8000;
  try {
    const res = await fetch(classified.normalizedUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });

    const xfo = res.headers.get('x-frame-options');
    const csp = res.headers.get('content-security-policy');
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const bodyText = await res.text().catch(() => '');

    const xfoUpper = (xfo || '').toUpperCase();
    const xfoBlocked = xfoUpper.includes('SAMEORIGIN') || xfoUpper.includes('DENY');
    const cspBlocked = /frame-ancestors\s+('none'|'self')/i.test(csp || '');
    const embedAllowed = !(xfoBlocked || cspBlocked);

    const isCloudflare =
      res.status === 403 ||
      /attention required|just a moment|cloudflare/i.test(bodyText.slice(0, 3000));

    // Only inspect official public oEmbed or og:video if HTTP 200 and not Cloudflare-blocked
    if (res.ok && !isCloudflare && ct.includes('text/html')) {
      const oembedMatch = bodyText.match(/<link[^>]+type=["']application\/json\+oembed["'][^>]+href=["']([^"']+)["']/i);
      if (oembedMatch && oembedMatch[1]) {
        try {
          const oembedUrl = new URL(oembedMatch[1], classified.normalizedUrl).toString();
          const oeRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
          if (oeRes.ok) {
            const oeJson: any = await oeRes.json().catch(() => null);
            const iframeSrcMatch = typeof oeJson?.html === 'string' ? oeJson.html.match(/src=["']([^"']+)["']/i) : null;
            if (iframeSrcMatch && iframeSrcMatch[1]) {
              const officialEmbedUrl = new URL(iframeSrcMatch[1], classified.normalizedUrl).toString();
              steps.push({ step: '4. Compatibilidade', status: 'ok', detail: 'Endpoint oEmbed oficial encontrado no fornecedor.' });
              return {
                handled: true,
                adapterName: 'Cuevana',
                supported: true,
                isDirect: false,
                embedUrl: officialEmbedUrl,
                externalPageUrl: classified.originalUrl,
                status: 'online',
                sourceKind: 'EMBED_PLAYER',
                detectedFormat: 'embed',
                verificationLabel: 'REPRODUÇÃO SUPORTADA',
                message: 'Embed oficial oEmbed encontrado e autorizado pelo fornecedor.',
                diagnostics: {
                  ...classified.diagnostics,
                  httpStatus: res.status,
                  contentType: ct,
                  xFrameOptions: xfo,
                  cspFrameAncestors: csp,
                  embedAllowed: true,
                  directPlayable: false,
                  recommendedPlaybackMode: 'iframe',
                  externalPageUrl: classified.originalUrl,
                  verificationLabel: 'REPRODUÇÃO SUPORTADA',
                  diagnosticSteps: steps,
                  testedAt
                }
              };
            }
          }
        } catch {
          // Ignore malformed oEmbed and continue truthful diagnosis
        }
      }
    }

    const restrictionDetail = !embedAllowed
      ? `O fornecedor bloqueia incorporação externa (${xfo ? `X-Frame-Options: ${xfo}` : 'CSP frame-ancestors'}).`
      : isCloudflare
        ? `O servidor devolveu HTTP ${res.status} (proteção de acesso / Cloudflare) para acesso direto.`
        : 'A página HTML devolvida é informativa e não expõe fluxo MP4/HLS/DASH ou embed oficial autorizado.';

    steps.push({ step: '4. Verificar compatibilidade', status: 'error', detail: restrictionDetail });
    steps.push({
      step: '5. Método de reprodução',
      status: 'warn',
      detail: 'Sem endpoint oficial incorporável sem prefixo proxy MGEB. Disponível apenas abertura externa da página original.'
    });

    const msg =
      `Esta fonte é uma ${pageLabel} do Cuevana e não um fluxo direto de vídeo (MP4/HLS). ` +
      (!embedAllowed
        ? `O fornecedor bloqueia iframe (${xfo || 'CSP'}) e não disponibiliza API pública de incorporação.`
        : isCloudflare
          ? `O servidor recusou o acesso direto (HTTP ${res.status}).`
          : 'Não foi encontrado player oficial incorporável.') +
      ' Para reproduzir via MGEB, ative "Com Prefixo MGEB", ou abra a página original no fornecedor.';

    return {
      handled: true,
      adapterName: 'Cuevana',
      supported: false,
      isDirect: false,
      embedUrl: classified.originalUrl,
      externalPageUrl: classified.originalUrl,
      status: !embedAllowed ? 'embed_blocked' : 'unsupported_format',
      sourceKind: 'WEB_PAGE',
      detectedFormat: 'html',
      verificationLabel: !embedAllowed ? 'INCORPORAÇÃO NÃO PERMITIDA' : 'FONTE INCOMPATÍVEL',
      message: msg,
      diagnostics: {
        ...classified.diagnostics,
        httpStatus: res.status,
        contentType: ct || 'text/html',
        xFrameOptions: xfo,
        cspFrameAncestors: csp,
        embedAllowed,
        directPlayable: false,
        recommendedPlaybackMode: !embedAllowed ? 'blocked' : 'unsupported',
        failureReason: msg,
        externalPageUrl: classified.originalUrl,
        verificationLabel: !embedAllowed ? 'INCORPORAÇÃO NÃO PERMITIDA' : 'FONTE INCOMPATÍVEL',
        diagnosticSteps: steps,
        testedAt
      }
    };
  } catch (err: any) {
    const errMsg = err?.name === 'AbortError'
      ? 'Tempo limite excedido ao consultar a página do Cuevana.'
      : (err?.message || 'Erro de ligação ao consultar o fornecedor.');
    steps.push({ step: '4. Verificar compatibilidade', status: 'error', detail: errMsg });

    return {
      handled: true,
      adapterName: 'Cuevana',
      supported: false,
      isDirect: false,
      embedUrl: classified.originalUrl,
      externalPageUrl: classified.originalUrl,
      status: 'unsupported_format',
      sourceKind: 'WEB_PAGE',
      detectedFormat: 'html',
      verificationLabel: 'FONTE INCOMPATÍVEL',
      message: `Esta fonte é uma ${pageLabel} do Cuevana (página web HTML) e não um link de vídeo reproduzível diretamente. ${errMsg}`,
      diagnostics: {
        ...classified.diagnostics,
        embedAllowed: false,
        directPlayable: false,
        recommendedPlaybackMode: 'unsupported',
        failureReason: errMsg,
        externalPageUrl: classified.originalUrl,
        verificationLabel: 'FONTE INCOMPATÍVEL',
        diagnosticSteps: steps,
        testedAt
      }
    };
  }
}
