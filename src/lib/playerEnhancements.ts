import { SourceDiagnostics, SourceKind } from '../types.js';

export const SOURCE_VERSION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Dublado', label: 'Dublado' },
  { value: 'Legendado', label: 'Legendado' },
  { value: 'Original', label: 'Original' },
  { value: 'Multiáudio', label: 'Multiáudio' },
  { value: 'Outra versão', label: 'Outra versão' }
];

export const AUDIO_LANGUAGE_PRESETS = ['Português', 'Inglês', 'Espanhol', 'Francês'] as const;

export const ADMIN_QUALITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Automática', label: 'Automática' },
  { value: '360p', label: '360p SD' },
  { value: '480p', label: '480p SD' },
  { value: '720p', label: '720p HD' },
  { value: '1080p', label: '1080p Full HD' },
  { value: '1440p', label: '1440p 2K QHD' },
  { value: '4K', label: '4K Ultra HD' }
];

export const ADMIN_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'php_endpoint', label: 'Endpoint PHP (MGEB)' },
  { value: 'mp4', label: 'MP4 Direto' },
  { value: 'm3u8', label: 'M3U8 / HLS Stream' },
  { value: 'dash', label: 'DASH (.mpd)' },
  { value: 'webm', label: 'WebM Direto' },
  { value: 'embed', label: 'Embed / Iframe' },
  { value: 'iframe', label: 'Iframe Player' },
  { value: 'html', label: 'Página HTML Externa' },
  { value: 'auto', label: 'Automático' }
];

export function normalizeVersionType(raw?: string | null): string {
  const val = (raw || '').trim();
  if (!val) return '';
  const lower = val.toLowerCase();
  if (lower === 'dublado' || lower === 'dub' || lower === 'dubbed') return 'Dublado';
  if (lower === 'legendado' || lower === 'leg' || lower === 'sub' || lower === 'subtitled') return 'Legendado';
  if (lower === 'original' || lower === 'orig') return 'Original';
  if (lower === 'multiaudio' || lower === 'multi-audio' || lower === 'multi-áudio' || lower === 'multiáudio' || lower === 'multi') {
    return 'Multiáudio';
  }
  if (lower === 'outra' || lower === 'outra versão' || lower === 'other') return 'Outra versão';
  return val;
}

export function inferSourceVersionType(src: {
  versionType?: string;
  audioLanguage?: string;
  serverName?: string;
  label?: string;
}): string {
  const explicit = normalizeVersionType(src.versionType);
  if (explicit) return explicit;

  const combined = [src.audioLanguage, src.serverName, src.label]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!combined) return '';
  if (/\b(multi[\s-]?[aá]udio|dual[\s-]?[aá]udio)\b/i.test(combined)) return 'Multiáudio';
  if (/\b(legendad[oa]|leg|subbed|subtitled)\b/i.test(combined)) return 'Legendado';
  if (/\b(dublad[oa]|dub|pt-br|dublagem)\b/i.test(combined)) return 'Dublado';
  if (/\b(original|orig)\b/i.test(combined)) return 'Original';
  return '';
}

export function formatSourceVersionBadge(src: {
  audioLanguage?: string;
  versionType?: string;
  serverName?: string;
  label?: string;
  quality?: string;
}): {
  language: string;
  versionType: string;
  quality: string;
  fullLabel: string;
  shortLabel: string;
} {
  const language = (src.audioLanguage || '').trim();
  const versionType = inferSourceVersionType(src);
  const quality = (src.quality || '').trim();

  const parts = [language, versionType, quality].filter(Boolean);
  const shortParts = [language, versionType].filter(Boolean);

  return {
    language,
    versionType,
    quality,
    fullLabel: parts.join(' — ') || src.serverName || src.label || 'Fonte de Vídeo',
    shortLabel: shortParts.join(' — ') || src.serverName || src.label || 'Fonte Padrão'
  };
}

// --- Preferences Persistence (Audio / Version & Subtitles) ---

const AUDIO_PREF_KEY = 'ronycine_audio_version_pref_v1';
const SUBTITLE_PREF_KEY = 'ronycine_subtitle_prefs_v1';

export interface AudioVersionPref {
  audioLanguage?: string;
  versionType?: string;
}

export function readAudioVersionPref(): AudioVersionPref {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(AUDIO_PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      audioLanguage: typeof parsed?.audioLanguage === 'string' ? parsed.audioLanguage : undefined,
      versionType: typeof parsed?.versionType === 'string' ? parsed.versionType : undefined
    };
  } catch {
    return {};
  }
}

export function writeAudioVersionPref(pref: AudioVersionPref): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      AUDIO_PREF_KEY,
      JSON.stringify({
        audioLanguage: pref.audioLanguage || '',
        versionType: normalizeVersionType(pref.versionType)
      })
    );
  } catch {}
}

export function findPreferredSourceIndex(
  sources: Array<{
    audioLanguage?: string;
    versionType?: string;
    serverName?: string;
    label?: string;
  }>,
  pref: AudioVersionPref
): number {
  if (!Array.isArray(sources) || sources.length <= 1) return 0;

  const targetLang = (pref.audioLanguage || '').trim().toLowerCase();
  const targetVer = normalizeVersionType(pref.versionType).toLowerCase();
  if (!targetLang && !targetVer) return 0;

  let bestIndex = 0;
  let bestScore = 0;

  sources.forEach((src, idx) => {
    const srcLang = (src.audioLanguage || '').trim().toLowerCase();
    const srcVer = inferSourceVersionType(src).toLowerCase();

    const langMatch = Boolean(targetLang && srcLang && (srcLang === targetLang || srcLang.includes(targetLang) || targetLang.includes(srcLang)));
    const verMatch = Boolean(targetVer && srcVer && srcVer === targetVer);

    let score = 0;
    if (langMatch && verMatch) score = 100;
    else if (verMatch) score = 60;
    else if (langMatch) score = 40;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  });

  return bestScore > 0 ? bestIndex : 0;
}

export type SubtitleFontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SubtitleColor = '#FFFFFF' | '#FACC15' | '#38BDF8';
export type SubtitleBgOpacity = 'dark' | 'semi' | 'transparent';

export interface SubtitlePrefsState {
  enabled: boolean;
  preferredLang: string;
  fontSize: SubtitleFontSize;
  color: SubtitleColor;
  bgOpacity: SubtitleBgOpacity;
  syncOffsetSeconds: number;
}

export const DEFAULT_SUBTITLE_PREFS: SubtitlePrefsState = {
  enabled: false,
  preferredLang: '',
  fontSize: 'medium',
  color: '#FFFFFF',
  bgOpacity: 'semi',
  syncOffsetSeconds: 0
};

export function readSubtitlePrefs(): SubtitlePrefsState {
  if (typeof window === 'undefined') return { ...DEFAULT_SUBTITLE_PREFS };
  try {
    const raw = localStorage.getItem(SUBTITLE_PREF_KEY);
    if (!raw) return { ...DEFAULT_SUBTITLE_PREFS };
    const parsed = JSON.parse(raw);
    const fontSize: SubtitleFontSize =
      parsed?.fontSize === 'small' || parsed?.fontSize === 'medium' || parsed?.fontSize === 'large' || parsed?.fontSize === 'xlarge'
        ? parsed.fontSize
        : 'medium';
    const color: SubtitleColor =
      parsed?.color === '#FFFFFF' || parsed?.color === '#FACC15' || parsed?.color === '#38BDF8'
        ? parsed.color
        : '#FFFFFF';
    const bgOpacity: SubtitleBgOpacity =
      parsed?.bgOpacity === 'dark' || parsed?.bgOpacity === 'semi' || parsed?.bgOpacity === 'transparent'
        ? parsed.bgOpacity
        : 'semi';
    const syncOffset = Number(parsed?.syncOffsetSeconds);

    return {
      enabled: Boolean(parsed?.enabled),
      preferredLang: typeof parsed?.preferredLang === 'string' ? parsed.preferredLang : '',
      fontSize,
      color,
      bgOpacity,
      syncOffsetSeconds: Number.isFinite(syncOffset) ? Math.max(-30, Math.min(30, syncOffset)) : 0
    };
  } catch {
    return { ...DEFAULT_SUBTITLE_PREFS };
  }
}

export function writeSubtitlePrefs(prefs: SubtitlePrefsState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SUBTITLE_PREF_KEY, JSON.stringify(prefs));
  } catch {}
}

// --- Subtitle Parser (.srt & .vtt) + Sync Engine ---

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export function parseSubtitleTimestamp(ts: string): number | null {
  const clean = ts.trim().replace(',', '.').split(/\s+/)[0];
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) {
      return h * 3600 + m * 60 + s;
    }
  } else if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (Number.isFinite(m) && Number.isFinite(s)) {
      return m * 60 + s;
    }
  }
  return null;
}

function cleanSubtitleCueLine(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '') // Strip ASS/SSA style tags like {\an8}
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function parseSubtitleTextToCues(rawText: string): SubtitleCue[] {
  if (!rawText || typeof rawText !== 'string') return [];
  const normalized = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map(l => l.trimEnd())
      .filter(l => l.trim().length > 0);
    if (lines.length === 0) continue;

    const firstUpper = lines[0].trim().toUpperCase();
    if (
      firstUpper.startsWith('WEBVTT') ||
      firstUpper.startsWith('NOTE') ||
      firstUpper.startsWith('STYLE') ||
      firstUpper.startsWith('REGION')
    ) {
      continue;
    }

    let arrowIdx = lines.findIndex(l => l.includes('-->'));
    if (arrowIdx < 0) continue;

    const timeLine = lines[arrowIdx];
    const [rawStart, rawEndWithSettings] = timeLine.split('-->');
    if (!rawStart || !rawEndWithSettings) continue;

    const start = parseSubtitleTimestamp(rawStart);
    const end = parseSubtitleTimestamp(rawEndWithSettings);
    if (start === null || end === null || end < start) continue;

    const textLines = lines
      .slice(arrowIdx + 1)
      .map(cleanSubtitleCueLine)
      .map(l => l.trim())
      .filter(Boolean);

    if (textLines.length === 0) continue;
    cues.push({
      start,
      end,
      text: textLines.join('\n')
    });
  }

  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Computes active subtitle text at `currentTimeSec` factoring in `syncOffsetSeconds`.
 * Positive offset (+0.5s) delays the subtitle display (cue at 10.0s shows at 10.5s).
 * Negative offset (-0.5s) advances the subtitle display (cue at 10.0s shows at 9.5s).
 */
export function getActiveSubtitleText(
  cues: SubtitleCue[],
  currentTimeSec: number,
  syncOffsetSeconds = 0
): string {
  if (!cues || cues.length === 0 || !Number.isFinite(currentTimeSec)) return '';
  const adjustedTime = currentTimeSec - syncOffsetSeconds;
  const activeLines: string[] = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.start > adjustedTime) break;
    if (adjustedTime >= cue.start && adjustedTime <= cue.end) {
      activeLines.push(cue.text);
    }
  }

  return activeLines.join('\n');
}

// --- Honest Download Compatibility & External Manager Links ---

export interface DownloadInspectionResult {
  supported: boolean;
  mode: 'direct_file' | 'stream_playlist' | 'unsupported';
  formatLabel: string;
  qualityLabel: string;
  sizeLabel: string;
  suggestedFilename: string;
  compatibilityText: string;
  warningText?: string;
  directUrl?: string;
}

export function formatBytesReadable(bytes?: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return 'Não informado pelo servidor';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx++;
  }
  return `${val >= 100 || unitIdx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[unitIdx]}`;
}

function sanitizeFilenameBase(title?: string): string {
  const base = (title || 'ronycine_video')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return base || 'ronycine_video';
}

export function inspectDownloadCompatibility(
  source:
    | {
        url?: string;
        originalUrl?: string;
        format?: string;
        quality?: string;
        sourceKind?: SourceKind;
        diagnostics?: SourceDiagnostics;
      }
    | undefined,
  resolvedData:
    | {
        isDirect?: boolean;
        directUrl?: string;
        embedUrl?: string;
        format?: string;
        sourceKind?: SourceKind;
      }
    | null,
  title?: string
): DownloadInspectionResult {
  const fmt = (resolvedData?.format || source?.format || '').toLowerCase();
  const kind = resolvedData?.sourceKind || source?.sourceKind;
  const candidateUrl = resolvedData?.directUrl || source?.originalUrl || source?.url || '';
  const lowerUrl = candidateUrl.toLowerCase();

  const qualityFromDiag =
    source?.diagnostics?.maxDetectedResolution ||
    (Array.isArray(source?.diagnostics?.availableQualities) && source.diagnostics!.availableQualities.length > 0
      ? source.diagnostics!.availableQualities[source.diagnostics!.availableQualities.length - 1]
      : '');
  const qualityLabel = (source?.quality || qualityFromDiag || '').trim() || 'Não declarada';
  const sizeLabel = formatBytesReadable(source?.diagnostics?.contentLength);

  const isEmbedOrPage =
    !resolvedData?.isDirect ||
    kind === 'EMBED_PLAYER' ||
    kind === 'WEB_PAGE' ||
    fmt === 'embed' ||
    fmt === 'iframe' ||
    fmt === 'html' ||
    !candidateUrl;

  if (isEmbedOrPage) {
    return {
      supported: false,
      mode: 'unsupported',
      formatLabel: fmt ? fmt.toUpperCase() : 'EMBED / PÁGINA EXTERNA',
      qualityLabel,
      sizeLabel: 'Indisponível',
      suggestedFilename: `${sanitizeFilenameBase(title)}.mp4`,
      compatibilityText: 'Esta fonte não suporta download direto.',
      warningText: 'Fontes incorporadas (iframe/embed) ou páginas externas não expõem um fluxo de ficheiro direto.'
    };
  }

  const isHls = fmt === 'm3u8' || fmt === 'hls' || kind === 'DIRECT_HLS' || lowerUrl.includes('.m3u8');
  const isDash = fmt === 'dash' || fmt === 'mpd' || kind === 'DIRECT_DASH' || lowerUrl.includes('.mpd');
  const isWebm = fmt === 'webm' || kind === 'DIRECT_WEBM' || lowerUrl.includes('.webm');

  const safeBase = sanitizeFilenameBase(title);
  const safeQual = qualityLabel !== 'Não declarada' && qualityLabel !== 'Automática'
    ? `_${qualityLabel.replace(/[^a-zA-Z0-9]/g, '')}`
    : '';

  if (isHls || isDash) {
    const ext = isHls ? 'm3u8' : 'mpd';
    return {
      supported: true,
      mode: 'stream_playlist',
      formatLabel: isHls ? 'HLS / M3U8 Stream' : 'DASH / MPD Stream',
      qualityLabel,
      sizeLabel,
      suggestedFilename: `${safeBase}${safeQual}.${ext}`,
      compatibilityText: 'Stream segmentado — recomendado abrir no 1DM ou gestor com suporte a streams.',
      warningText: 'Downloads diretos pelo navegador guardam apenas a playlist; utilize 1DM ou ADM para capturar segmentos de vídeo.',
      directUrl: candidateUrl
    };
  }

  const ext = isWebm ? 'webm' : 'mp4';
  return {
    supported: true,
    mode: 'direct_file',
    formatLabel: isWebm ? 'WebM Direto' : fmt === 'php_endpoint' ? 'Endpoint Direto MP4' : 'MP4 Direto',
    qualityLabel,
    sizeLabel,
    suggestedFilename: `${safeBase}${safeQual}.${ext}`,
    compatibilityText: 'Download direto compatível com navegador, 1DM e ADM.',
    directUrl: candidateUrl
  };
}

export function buildDownloadManagerUrls(url: string): {
  directUrl: string;
  oneDmIntent: string;
  admIntent: string;
  isAndroid: boolean;
} {
  const cleanUrl = (url || '').trim();
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  try {
    const parsed = new URL(cleanUrl);
    const scheme = parsed.protocol.replace(':', '') || 'https';
    const hostAndPath = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    return {
      directUrl: cleanUrl,
      oneDmIntent: `intent://${hostAndPath}#Intent;scheme=${scheme};type=video/*;package=idm.internet.download.manager;end`,
      admIntent: `intent://${hostAndPath}#Intent;scheme=${scheme};type=video/*;package=com.dv.adm;end`,
      isAndroid
    };
  } catch {
    return {
      directUrl: cleanUrl,
      oneDmIntent: cleanUrl,
      admIntent: cleanUrl,
      isAndroid
    };
  }
}
