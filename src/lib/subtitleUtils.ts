/**
 * RONYCINE API — SMART SUBTITLES & STYLING UTILITIES
 * Formats, converts SRT to WebVTT, manages subtitle visual styles,
 * and persists user subtitle preferences.
 */

export type SubtitleSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SubtitleColor = 'white' | 'yellow' | 'green' | 'cyan';
export type SubtitleBackground = 'none' | 'semi' | 'solid';
export type SubtitlePosition = 'bottom' | 'top';

export interface SubtitleStyleConfig {
  size: SubtitleSize;
  color: SubtitleColor;
  background: SubtitleBackground;
  position: SubtitlePosition;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleConfig = {
  size: 'medium',
  color: 'white',
  background: 'semi',
  position: 'bottom'
};

const SUBTITLES_PREF_KEY = 'ronycine_subtitles_pref';

/**
 * Reads stored subtitle styling preferences.
 */
export function readStoredSubtitleStyle(): SubtitleStyleConfig {
  if (typeof window === 'undefined') return DEFAULT_SUBTITLE_STYLE;
  try {
    const raw = localStorage.getItem(SUBTITLES_PREF_KEY);
    if (!raw) return DEFAULT_SUBTITLE_STYLE;
    const parsed = JSON.parse(raw);
    return {
      size: ['small', 'medium', 'large', 'xlarge'].includes(parsed.size) ? parsed.size : 'medium',
      color: ['white', 'yellow', 'green', 'cyan'].includes(parsed.color) ? parsed.color : 'white',
      background: ['none', 'semi', 'solid'].includes(parsed.background) ? parsed.background : 'semi',
      position: ['bottom', 'top'].includes(parsed.position) ? parsed.position : 'bottom'
    };
  } catch {
    return DEFAULT_SUBTITLE_STYLE;
  }
}

/**
 * Saves subtitle styling preferences to localStorage.
 */
export function writeStoredSubtitleStyle(config: SubtitleStyleConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SUBTITLES_PREF_KEY, JSON.stringify(config));
  } catch {}
}

/**
 * Converts SubRip (.srt) subtitle string to WebVTT format (.vtt).
 */
export function convertSrtToVtt(srtContent: string): string {
  if (!srtContent) return 'WEBVTT\n\n';

  // Strip UTF-8 BOM if present
  let clean = srtContent.replace(/^\uFEFF/, '').trim();

  // If already WebVTT, return as is
  if (clean.startsWith('WEBVTT')) {
    return clean;
  }

  // Replace timestamps: 00:01:20,000 --> 00:01:20.000
  clean = clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return `WEBVTT\n\n${clean}`;
}

/**
 * Creates an in-memory Object URL from WebVTT text.
 */
export function createVttBlobUrl(vttContent: string): string {
  const blob = new Blob([vttContent], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

/**
 * Returns CSS color hex code from color token.
 */
export function getSubtitleColorHex(color: SubtitleColor): string {
  switch (color) {
    case 'yellow':
      return '#FACC15';
    case 'green':
      return '#22C55E';
    case 'cyan':
      return '#06B6D4';
    case 'white':
    default:
      return '#FFFFFF';
  }
}

/**
 * Returns font size value.
 */
export function getSubtitleFontSize(size: SubtitleSize): { px: string; rem: string } {
  switch (size) {
    case 'small':
      return { px: '14px', rem: '0.875rem' };
    case 'large':
      return { px: '22px', rem: '1.375rem' };
    case 'xlarge':
      return { px: '28px', rem: '1.75rem' };
    case 'medium':
    default:
      return { px: '18px', rem: '1.125rem' };
  }
}

/**
 * Generates custom dynamic CSS rules for ::cue styling inside the player container.
 */
export function generateCueStyleSheet(config: SubtitleStyleConfig, containerSelector = '.ronycine-player-root'): string {
  const colorHex = getSubtitleColorHex(config.color);
  const { px } = getSubtitleFontSize(config.size);

  let bgCss = 'background-color: rgba(0, 0, 0, 0.75);';
  let shadowCss = 'text-shadow: 1px 1px 2px #000000, 0 0 1px #000000;';

  if (config.background === 'none') {
    bgCss = 'background-color: transparent;';
    shadowCss =
      'text-shadow: 2px 2px 4px #000000, -2px -2px 4px #000000, 2px -2px 4px #000000, -2px 2px 4px #000000, 0 0 6px #000000;';
  } else if (config.background === 'solid') {
    bgCss = 'background-color: #000000;';
    shadowCss = 'none;';
  }

  const positionCss =
    config.position === 'top'
      ? 'top: 6% !important; bottom: auto !important;'
      : 'bottom: 8% !important; top: auto !important;';

  return `
    ${containerSelector} ::cue {
      color: ${colorHex} !important;
      font-size: ${px} !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-weight: 600 !important;
      line-height: 1.35 !important;
      padding: 3px 8px !important;
      border-radius: 4px !important;
      ${bgCss}
      ${shadowCss}
    }
    ${containerSelector} video::cue {
      ${positionCss}
    }
  `;
}
