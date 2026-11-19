import { PlaybackVersionAvailability, SourceDiagnostics, SourceKind, SourceVersionType, VersionSlotAvailability } from '../types.js';

export const VERSION_TYPE_OPTIONS: Array<{ value: SourceVersionType; label: string }> = [
  { value: 'dublado', label: 'Dublado' },
  { value: 'legendado', label: 'Legendado' },
  { value: 'original', label: 'Original' },
  { value: 'multiaudio', label: 'Multiáudio' },
  { value: 'outra', label: 'Outra versão' }
];

export const AUDIO_LANGUAGE_OPTIONS: string[] = [
  'Português',
  'Inglês',
  'Espanhol',
  'Francês',
  'Outro'
];

export const SOURCE_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Automático' },
  { value: 'mp4', label: 'MP4 (Direto)' },
  { value: 'm3u8', label: 'M3U8 (HLS)' },
  { value: 'dash', label: 'MPD (DASH)' },
  { value: 'webm', label: 'WebM' },
  { value: 'php_endpoint', label: 'Endpoint PHP / Stream' },
  { value: 'embed', label: 'Embed / Iframe' }
];

export const SOURCE_QUALITY_OPTIONS: string[] = [
  '360p',
  '480p',
  '720p',
  '1080p',
  '1440p',
  '4K',
  'Automática'
];

export interface PlayerAudioPreference {
  versionType?: string;
  audioLanguage?: string;
}

export interface PlayerSubtitlePreference {
  enabled: boolean;
  language?: string;
  fontSize: 'sm' | 'md' | 'lg' | 'xl';
  color: 'white' | 'yellow' | 'cyan';
  bgOpacity: 'dark' | 'black' | 'transparent';
  offsetSeconds: number;
}

export const DEFAULT_SUBTITLE_PREFERENCE: PlayerSubtitlePreference = {
  enabled: false,
  fontSize: 'md',
  color: 'white',
  bgOpacity: 'dark',
  offsetSeconds: 0
};

const AUDIO_PREF_KEY = 'ronycine_pref_audio_version_v1';
const SUBTITLE_PREF_KEY = 'ronycine_pref_subtitle_v1';

export function loadAudioPreference(): PlayerAudioPreference {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(AUDIO_PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAudioPreference(pref: PlayerAudioPreference): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify(pref));
  } catch {
    // ignore storage quota errors
  }
}

export function loadSubtitlePreference(): PlayerSubtitlePreference {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_SUBTITLE_PREFERENCE };
  }
  try {
    const raw = window.localStorage.getItem(SUBTITLE_PREF_KEY);
    if (!raw) return { ...DEFAULT_SUBTITLE_PREFERENCE };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SUBTITLE_PREFERENCE,
      ...(typeof parsed === 'object' && parsed ? parsed : {}),
      offsetSeconds:
        typeof parsed?.offsetSeconds === 'number' && Number.isFinite(parsed.offsetSeconds)
          ? Math.max(-15, Math.min(15, parsed.offsetSeconds))
          : 0
    };
  } catch {
    return { ...DEFAULT_SUBTITLE_PREFERENCE };
  }
}

export function saveSubtitlePreference(pref: PlayerSubtitlePreference): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SUBTITLE_PREF_KEY, JSON.stringify(pref));
  } catch {
    // ignore
  }
}

export function normalizeVersionType(
  versionType?: string | null,
  labelHint?: string | null,
  languageHint?: string | null
): SourceVersionType | undefined {
  const raw = String(versionType || '').trim().toLowerCase();
  if (raw) {
    if (raw === 'dublado' || raw === 'dub' || raw === 'dubbed') return 'dublado';
    if (raw === 'legendado' || raw === 'leg' || raw === 'subtitled' || raw === 'sub') return 'legendado';
    if (raw === 'original' || raw === 'orig') return 'original';
    if (raw === 'multiaudio' || raw === 'multi-audio' || raw === 'multi-áudio' || raw === 'multiáudio' || raw === 'multi' || raw === 'dual') return 'multiaudio';
    if (raw === 'outra' || raw === 'outra versão' || raw === 'other') return 'outra';
  }

  const combined = `${labelHint || ''} ${languageHint || ''}`.toLowerCase();
  if (/\bdublado\b|\bdublagem\b|\bdubbed\b/.test(combined)) return 'dublado';
  if (/\blegendado\b|\bsubtitled\b|\bsubbed\b/.test(combined)) return 'legendado';
  if (/\bmulti[\s-]?[aá]udio\b|\bdual[\s-]?[aá]udio\b/.test(combined)) return 'multiaudio';
  if (/\boriginal\b/.test(combined)) return 'original';

  return undefined;
}

export function formatVersionTypeLabel(versionType?: string | null): string {
  const norm = normalizeVersionType(versionType);
  switch (norm) {
    case 'dublado':
      return 'Dublado';
    case 'legendado':
      return 'Legendado';
    case 'original':
      return 'Original';
    case 'multiaudio':
      return 'Multiáudio';
    case 'outra':
      return 'Outra versão';
    default:
      return '';
  }
}

export function formatSourceOrganizedLabel(src: {
  audioLanguage?: string;
  versionType?: string;
  label?: string;
  quality?: string;
}): string {
  const norm = normalizeVersionType(src.versionType, src.label, src.audioLanguage);
  const fallbackLang = norm === 'legendado' ? 'Original' : norm === 'dublado' ? 'Português' : 'Áudio Padrão';
  const language = String(src.audioLanguage || fallbackLang).trim() || fallbackLang;
  const ver = formatVersionTypeLabel(norm);
  const quality = String(src.quality || 'Automática').trim() || 'Automática';
  return [language, ver || null, quality].filter(Boolean).join(' — ');
}

export function isPresetAudioLanguage(lang?: string): boolean {
  if (!lang) return true;
  const trimmed = lang.trim().toLowerCase();
  return ['português', 'inglês', 'espanhol', 'francês'].includes(trimmed);
}

export function isHtmlOrUnsupportedSource(src: {
  format?: string;
  type?: string;
  sourceKind?: SourceKind | string;
  status?: string;
  diagnostics?: SourceDiagnostics;
}): boolean {
  const fmt = String(src.format || src.type || '').toLowerCase();
  const status = String(src.status || '').toLowerCase();
  const recMode = src.diagnostics?.recommendedPlaybackMode;
  const ct = String(src.diagnostics?.contentType || '').toLowerCase();
  const kind = String(src.sourceKind || '').toUpperCase();

  if (status === 'unsupported_format' || status === 'embed_blocked' || status === 'incompatible') return true;
  if (recMode === 'unsupported' || recMode === 'blocked') return true;
  if (fmt === 'html' || kind === 'UNKNOWN_HTML' || kind === 'WEB_PAGE') return true;

  // An explicit embed/iframe source can validly return text/html inside iframe,
  // whereas a non-embed direct stream URL returning text/html is an HTML webpage, not video.
  const isEmbedDeclared = fmt === 'embed' || fmt === 'iframe' || kind === 'EMBED_PLAYER' || recMode === 'iframe';
  if (!isEmbedDeclared && ct.includes('text/html')) {
    return true;
  }
  return false;
}

export interface SourceSelectable {
  id?: string;
  url: string;
  enabled?: boolean;
  status?: string;
  format?: string;
  type?: string;
  sourceKind?: SourceKind | string;
  versionType?: string;
  audioLanguage?: string;
  subtitleUrl?: string;
  subtitleLanguage?: string;
  label?: string;
  serverName?: string;
  quality?: string;
  isPrimary?: boolean;
  priority?: number;
  verificationResult?: string;
  diagnostics?: SourceDiagnostics;
}

export function isSourcePlayableCandidate(src: SourceSelectable): boolean {
  if (!src || !String(src.url || '').trim()) return false;
  if (src.enabled === false) return false;
  const status = String(src.status || '').toLowerCase();
  if (status === 'offline' || status === 'inactive') return false;
  if (isHtmlOrUnsupportedSource(src)) return false;
  return true;
}

export function pickPreferredSourceIndex(
  sources: SourceSelectable[],
  pref?: PlayerAudioPreference
): number {
  if (!sources || sources.length === 0) return 0;

  const viableIndices = sources
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => isSourcePlayableCandidate(s));

  if (viableIndices.length === 0) return 0;

  const prefVer = normalizeVersionType(pref?.versionType);
  const prefLang = String(pref?.audioLanguage || '').trim().toLowerCase();

  if (!prefVer && !prefLang) {
    return viableIndices[0].idx;
  }

  let bestIdx = viableIndices[0].idx;
  let bestScore = -1;

  for (const { s, idx } of viableIndices) {
    let score = 0;
    const sVer = normalizeVersionType(s.versionType, s.label || s.serverName, s.audioLanguage);
    const sLang = String(s.audioLanguage || '').trim().toLowerCase();

    if (prefVer && sVer === prefVer) score += 60;
    if (prefLang && sLang && (sLang === prefLang || sLang.includes(prefLang) || prefLang.includes(sLang))) {
      score += 40;
    }
    if (s.isPrimary) score += 8;
    const prio = typeof s.priority === 'number' && s.priority > 0 ? s.priority : 99;
    score += Math.max(0, 5 - Math.min(5, prio - 1));

    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }

  return bestIdx;
}

export function isSourceDublado(src: {
  versionType?: string;
  audioLanguage?: string;
  label?: string;
  serverName?: string;
  url?: string;
}): boolean {
  const norm = normalizeVersionType(src.versionType, src.label || src.serverName, src.audioLanguage);
  if (norm === 'dublado') return true;
  if (norm === 'legendado' || norm === 'original' || norm === 'outra') return false;

  const textMeta = `${src.audioLanguage || ''} ${src.serverName || ''} ${src.label || ''}`.toLowerCase();
  if (/\b(dublad[oa]|dub|pt-br|dublagem)\b/i.test(textMeta)) return true;
  if (/\b(portugu[eê]s|portugues)\b/i.test(textMeta) && !/\b(legendad[oa]|leg|subtitled|subbed)\b/i.test(textMeta)) {
    return true;
  }
  const urlMeta = String(src.url || '').toLowerCase();
  if (/[._/-](dublado|dub|pt-?br)[._/?&-]/i.test(urlMeta)) return true;
  return false;
}

export function isSourceLegendado(src: {
  versionType?: string;
  audioLanguage?: string;
  subtitleUrl?: string;
  label?: string;
  serverName?: string;
  url?: string;
}): boolean {
  // CRITICAL: Never treat external subtitle files (.srt/.vtt via subtitleUrl) as a full Versão Legendada video stream!
  const norm = normalizeVersionType(src.versionType, src.label || src.serverName, src.audioLanguage);
  if (norm === 'legendado') return true;
  if (norm === 'dublado' || norm === 'original' || norm === 'outra') return false;

  const textMeta = `${src.audioLanguage || ''} ${src.serverName || ''} ${src.label || ''}`.toLowerCase();
  if (/\b(legendad[oa]|leg|subtitled|subbed)\b/i.test(textMeta)) return true;
  const urlMeta = String(src.url || '').toLowerCase();
  if (/[._/-](legendado|leg|subbed)[._/?&-]/i.test(urlMeta)) return true;
  return false;
}

export function findSourceForVersion<T extends SourceSelectable>(
  sources: T[],
  version: 'dublado' | 'legendado'
): { index: number; source: T } | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;

  const viable = sources
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => isSourcePlayableCandidate(s));

  if (viable.length === 0) return null;

  const matcher = version === 'dublado' ? isSourceDublado : isSourceLegendado;
  const matches = viable.filter(({ s }) => matcher(s));

  if (matches.length === 0) {
    const multiMatch = viable.find(({ s }) => {
      const norm = normalizeVersionType(s.versionType, s.label || s.serverName, s.audioLanguage);
      return norm === 'multiaudio';
    });
    if (multiMatch) {
      return { index: multiMatch.idx, source: multiMatch.s };
    }
    return null;
  }

  matches.sort((a, b) => {
    if ((b.s.isPrimary ? 1 : 0) !== (a.s.isPrimary ? 1 : 0)) {
      return (b.s.isPrimary ? 1 : 0) - (a.s.isPrimary ? 1 : 0);
    }
    const pa = typeof a.s.priority === 'number' && a.s.priority > 0 ? a.s.priority : 99;
    const pb = typeof b.s.priority === 'number' && b.s.priority > 0 ? b.s.priority : 99;
    if (pa !== pb) return pa - pb;
    return a.idx - b.idx;
  });

  return { index: matches[0].idx, source: matches[0].s };
}

export function computeVersionAvailability(
  allRegisteredSources: SourceSelectable[],
  compatibleSources: SourceSelectable[],
  rejectedSources: Array<{ id?: string; url?: string; reason?: string; status?: string }> = []
): PlaybackVersionAvailability {
  const rejectedMap = new Map<string, { reason?: string; status?: string }>();
  for (const r of rejectedSources) {
    if (r.id) rejectedMap.set(r.id, r);
    if (r.url) rejectedMap.set(r.url.trim(), r);
  }

  const buildSlot = (version: 'dublado' | 'legendado'): VersionSlotAvailability => {
    const matcher = version === 'dublado' ? isSourceDublado : isSourceLegendado;
    const isMulti = (s: SourceSelectable) =>
      normalizeVersionType(s.versionType, s.label || s.serverName, s.audioLanguage) === 'multiaudio';

    const registeredMatches = (allRegisteredSources || []).filter(s => matcher(s) || isMulti(s));
    const validMatch = findSourceForVersion(compatibleSources || [], version);
    const validMatchesCount = (compatibleSources || []).filter(
      s => (matcher(s) || isMulti(s)) && isSourcePlayableCandidate(s)
    ).length;

    if (validMatch) {
      return {
        version,
        status: 'available',
        registeredCount: Math.max(registeredMatches.length, validMatchesCount),
        validCount: validMatchesCount,
        sourceId: validMatch.source.id,
        label: validMatch.source.serverName || validMatch.source.label,
        format: validMatch.source.format || validMatch.source.type
      };
    }

    if (registeredMatches.length > 0) {
      const sample = registeredMatches[0];
      const rej = (sample.id && rejectedMap.get(sample.id)) || rejectedMap.get((sample.url || '').trim());
      const reason =
        rej?.reason ||
        sample.diagnostics?.failureReason ||
        sample.verificationResult ||
        (sample.enabled === false
          ? `A fonte ${version === 'dublado' ? 'dublada' : 'legendada'} cadastrada está desativada.`
          : `A fonte ${version === 'dublado' ? 'dublada' : 'legendada'} cadastrada está offline ou incompatível.`);
      return {
        version,
        status: 'unavailable',
        registeredCount: registeredMatches.length,
        validCount: 0,
        sourceId: sample.id,
        label: sample.serverName || sample.label,
        format: sample.format || sample.type,
        reason
      };
    }

    return {
      version,
      status: 'not_registered',
      registeredCount: 0,
      validCount: 0,
      reason:
        version === 'dublado'
          ? 'Versão dublada não cadastrada para este conteúdo.'
          : 'Versão legendada não cadastrada para este conteúdo.'
    };
  };

  const untypedCount = (allRegisteredSources || []).filter(
    s => !isSourceDublado(s) && !isSourceLegendado(s) &&
      normalizeVersionType(s.versionType, s.label || s.serverName, s.audioLanguage) !== 'multiaudio'
  ).length;

  return {
    dublado: buildSlot('dublado'),
    legendado: buildSlot('legendado'),
    untypedCount
  };
}

export interface ParsedSubtitleCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export function parseSubtitleTimestamp(raw: string): number | null {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    seconds = Number(parts[2]);
  } else {
    minutes = Number(parts[0]);
    seconds = Number(parts[1]);
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

function sanitizeSubtitleCueText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?!i\b|b\b|u\b)[a-zA-Z0-9-]+[^>]*>/g, '')
    .replace(/\{\\[^}]+\}/g, '') // strip SSA/ASS override tags like {\an8}
    .trim();
}

export function parseSubtitleFileToCues(rawContent: string): ParsedSubtitleCue[] {
  if (!rawContent || typeof rawContent !== 'string') return [];

  const normalized = rawContent
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const blocks = normalized.split(/\n{2,}/);
  const cues: ParsedSubtitleCue[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const rawBlock = blocks[i].trim();
    if (!rawBlock) continue;

    const lines = rawBlock.split('\n').map(l => l.trimEnd());
    const header = lines[0]?.trim().toUpperCase() || '';
    if (
      header.startsWith('WEBVTT') ||
      header.startsWith('NOTE') ||
      header.startsWith('STYLE') ||
      header.startsWith('REGION')
    ) {
      continue;
    }

    let timeLineIdx = -1;
    for (let j = 0; j < Math.min(3, lines.length); j++) {
      if (lines[j].includes('-->')) {
        timeLineIdx = j;
        break;
      }
    }
    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const arrowIdx = timeLine.indexOf('-->');
    if (arrowIdx === -1) continue;

    const startStr = timeLine.slice(0, arrowIdx).trim();
    const restAfterArrow = timeLine.slice(arrowIdx + 3).trim();
    const endStr = restAfterArrow.split(/\s+/)[0] || '';

    const startSec = parseSubtitleTimestamp(startStr);
    const endSec = parseSubtitleTimestamp(endStr);
    if (startSec === null || endSec === null || endSec <= startSec) continue;

    const textLines = lines.slice(timeLineIdx + 1).join('\n');
    const cleanText = sanitizeSubtitleCueText(textLines);
    if (!cleanText) continue;

    cues.push({
      id: timeLineIdx > 0 && lines[0].trim() ? lines[0].trim() : `cue-${cues.length + 1}`,
      startSec,
      endSec,
      text: cleanText
    });
  }

  return cues.sort((a, b) => a.startSec - b.startSec);
}

function formatVttTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mmm}`;
}

export function cuesToWebVtt(cues: ParsedSubtitleCue[], offsetSeconds = 0): string {
  const lines: string[] = ['WEBVTT', ''];
  for (const cue of cues) {
    const start = Math.max(0, cue.startSec + offsetSeconds);
    const end = Math.max(start + 0.2, cue.endSec + offsetSeconds);
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(end)}`);
    lines.push(cue.text);
    lines.push('');
  }
  return lines.join('\n');
}

export function validateSubtitleUrl(rawUrl: string): {
  valid: boolean;
  normalized?: string;
  format?: 'srt' | 'vtt' | 'unknown';
  error?: string;
} {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { valid: true, normalized: undefined };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'A URL da legenda deve usar http:// ou https://.' };
    }
    const lowerPath = parsed.pathname.toLowerCase();
    const format = lowerPath.endsWith('.srt')
      ? 'srt'
      : lowerPath.endsWith('.vtt')
        ? 'vtt'
        : 'unknown';
    return { valid: true, normalized: parsed.toString(), format };
  } catch {
    return { valid: false, error: 'URL de legenda externa inválida.' };
  }
}

export function formatFileSize(bytes?: number | null): string | undefined {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${value >= 100 || unitIdx === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIdx]}`;
}

export interface DownloadCompatibilityResult {
  supported: boolean;
  mode: 'direct' | 'stream_limited' | 'unsupported';
  formatLabel: string;
  fileName: string;
  fileSizeBytes?: number;
  fileSizeFormatted?: string;
  qualityLabel: string;
  statusMessage: string;
  downloadUrl: string;
}

function sanitizeDownloadFileName(rawName: string): string {
  return rawName
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function evaluateDownloadCompatibility(
  src: {
    url: string;
    originalUrl?: string;
    format?: string;
    type?: string;
    sourceKind?: SourceKind | string;
    quality?: string;
    diagnostics?: SourceDiagnostics;
  },
  titleHint?: string
): DownloadCompatibilityResult {
  const rawUrl = String(src.url || '').trim();
  const fmt = String(src.format || src.type || 'auto').toLowerCase();
  const kind = String(src.sourceKind || '').toUpperCase();
  const recMode = src.diagnostics?.recommendedPlaybackMode;
  const contentType = String(src.diagnostics?.contentType || '').toLowerCase();
  const qualityLabel = String(src.quality || 'Automática').trim() || 'Automática';
  const fileSizeBytes =
    typeof src.diagnostics?.contentLength === 'number' && src.diagnostics.contentLength > 0
      ? src.diagnostics.contentLength
      : undefined;
  const fileSizeFormatted = formatFileSize(fileSizeBytes);

  let ext = 'mp4';
  if (fmt === 'webm' || kind === 'DIRECT_WEBM') ext = 'webm';
  else if (fmt === 'm3u8' || fmt === 'hls' || kind === 'DIRECT_HLS') ext = 'm3u8';
  else if (fmt === 'dash' || fmt === 'mpd' || kind === 'DIRECT_DASH') ext = 'mpd';

  let derivedFromUrl = '';
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSeg = segments[segments.length - 1] || '';
    if (lastSeg && !lastSeg.endsWith('.php')) {
      derivedFromUrl = decodeURIComponent(lastSeg);
    }
  } catch {
    // ignore malformed
  }

  const baseTitle = sanitizeDownloadFileName(titleHint || 'RONYCINE-Video');
  const fileName = derivedFromUrl && /\.(mp4|webm|mkv|mov|m4v|m3u8|mpd)$/i.test(derivedFromUrl)
    ? sanitizeDownloadFileName(derivedFromUrl)
    : `${baseTitle}.${ext}`;

  const isEmbed =
    fmt === 'embed' ||
    fmt === 'iframe' ||
    fmt === 'html' ||
    kind === 'EMBED_PLAYER' ||
    kind === 'UNKNOWN_HTML' ||
    recMode === 'iframe' ||
    recMode === 'unsupported' ||
    (contentType.includes('text/html') && fmt !== 'mp4' && fmt !== 'webm');

  if (isEmbed || !rawUrl) {
    return {
      supported: false,
      mode: 'unsupported',
      formatLabel: fmt === 'html' ? 'HTML' : 'Embed / Iframe',
      fileName: baseTitle,
      fileSizeBytes,
      fileSizeFormatted,
      qualityLabel,
      statusMessage: 'Esta fonte não suporta download direto.',
      downloadUrl: rawUrl
    };
  }

  const isSegmentedStream =
    fmt === 'm3u8' ||
    fmt === 'hls' ||
    fmt === 'dash' ||
    fmt === 'mpd' ||
    kind === 'DIRECT_HLS' ||
    kind === 'DIRECT_DASH' ||
    recMode === 'hls' ||
    recMode === 'dash' ||
    /\.m3u8($|\?)/i.test(rawUrl) ||
    /\.mpd($|\?)/i.test(rawUrl);

  if (isSegmentedStream) {
    return {
      supported: false,
      mode: 'stream_limited',
      formatLabel: fmt === 'dash' || fmt === 'mpd' || kind === 'DIRECT_DASH' ? 'MPD (DASH)' : 'M3U8 (HLS)',
      fileName,
      fileSizeBytes,
      fileSizeFormatted,
      qualityLabel,
      statusMessage:
        'Stream adaptativo fragmentado (HLS/DASH). Utilize um gestor compatível com playlists ou copie o link do manifesto.',
      downloadUrl: rawUrl
    };
  }

  const isDirectVideo =
    fmt === 'mp4' ||
    fmt === 'webm' ||
    fmt === 'php_endpoint' ||
    kind === 'DIRECT_MP4' ||
    kind === 'DIRECT_WEBM' ||
    kind === 'PHP_VIDEO_ENDPOINT' ||
    recMode === ('native' as any) ||
    src.diagnostics?.directPlayable === true ||
    /\.(mp4|webm|m4v|mov)($|\?)/i.test(rawUrl);

  if (isDirectVideo) {
    return {
      supported: true,
      mode: 'direct',
      formatLabel:
        fmt === 'webm' || kind === 'DIRECT_WEBM'
          ? 'WebM'
          : fmt === 'php_endpoint' || kind === 'PHP_VIDEO_ENDPOINT'
            ? 'MP4 / Endpoint Direto'
            : 'MP4',
      fileName,
      fileSizeBytes,
      fileSizeFormatted,
      qualityLabel,
      statusMessage: 'Download direto compatível.',
      downloadUrl: rawUrl
    };
  }

  return {
    supported: false,
    mode: 'unsupported',
    formatLabel: fmt.toUpperCase(),
    fileName: baseTitle,
    fileSizeBytes,
    fileSizeFormatted,
    qualityLabel,
    statusMessage: 'Esta fonte não suporta download direto.',
    downloadUrl: rawUrl
  };
}

export function buildDownloadManagerUrls(url: string, fileName: string) {
  const safeUrl = String(url || '').trim();
  const encodedTitle = encodeURIComponent(fileName || 'video.mp4');
  return {
    idmIntent: `intent:${safeUrl}#Intent;package=idm.internet.download.manager;type=video/*;S.title=${encodedTitle};end`,
    admIntent: `intent:${safeUrl}#Intent;package=com.dv.adm;type=video/*;S.title=${encodedTitle};end`,
    genericIntent: `intent:${safeUrl}#Intent;action=android.intent.action.VIEW;type=video/*;end`
  };
}
