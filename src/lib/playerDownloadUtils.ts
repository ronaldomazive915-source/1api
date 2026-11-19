/**
 * RONYCINE API — SMART DOWNLOAD UTILITIES
 * Standardized filename generation, Android 1DM & ADM intent builders,
 * direct browser downloads, and web sharing.
 */

export interface DownloadFilenameOptions {
  title?: string;
  year?: number | string;
  mediaType?: 'movie' | 'tv' | 'series' | string;
  seasonNumber?: number;
  episodeNumber?: number;
  audioLanguage?: string;
  quality?: string;
  format?: string;
  extension?: string;
}

/**
 * Sanitizes strings for safe cross-platform file naming (Windows, macOS, Android, Linux).
 */
export function sanitizeFilenamePart(name: string): string {
  if (!name) return '';
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // remove forbidden filesystem chars
    .replace(/\s+/g, ' ')                  // normalize whitespace
    .trim();
}

/**
 * Generates clean, standardized file names:
 * - Movies: {Title} ({Year}) - {Audio}.mp4
 * - Series: {Title} - S{xx}E{xx} - {Audio}.mp4
 */
export function buildContentDownloadFilename(opts: DownloadFilenameOptions): string {
  const rawTitle = opts.title || 'Video';
  const cleanTitle = sanitizeFilenamePart(rawTitle);

  // Normalize audio tag
  let audioTag = (opts.audioLanguage || '').trim();
  if (!audioTag || audioTag.toLowerCase() === 'português' || audioTag.toLowerCase() === 'pt-br') {
    audioTag = 'Dublado';
  } else if (audioTag.toLowerCase().includes('legend')) {
    audioTag = 'Legendado';
  } else if (audioTag.toLowerCase().includes('original')) {
    audioTag = 'Original';
  }
  const cleanAudio = sanitizeFilenamePart(audioTag) || 'Dublado';

  // Determine extension
  let ext = (opts.extension || '').replace(/^\./, '').toLowerCase();
  if (!ext) {
    const fmt = (opts.format || '').toLowerCase();
    if (fmt === 'm3u8' || fmt === 'hls') {
      ext = 'm3u8';
    } else if (fmt === 'webm') {
      ext = 'webm';
    } else {
      ext = 'mp4';
    }
  }

  const isTv = opts.mediaType === 'tv' || opts.mediaType === 'series' || (opts.seasonNumber !== undefined && opts.episodeNumber !== undefined);

  if (isTv) {
    const s = String(opts.seasonNumber ?? 1).padStart(2, '0');
    const e = String(opts.episodeNumber ?? 1).padStart(2, '0');
    return `${cleanTitle} - S${s}E${e} - ${cleanAudio}.${ext}`;
  }

  // Movie
  const yearStr = opts.year ? ` (${opts.year})` : '';
  return `${cleanTitle}${yearStr} - ${cleanAudio}.${ext}`;
}

/**
 * Android Intent URI for 1DM (IDM Internet Download Manager)
 * Package: idm.internet.download.manager
 */
export function build1DMIntentUrl(downloadUrl: string): string {
  if (!downloadUrl) return '';
  // Encodes URL for Android Intent specification
  return `intent:${downloadUrl}#Intent;action=android.intent.action.VIEW;package=idm.internet.download.manager;type=video/*;end`;
}

/**
 * Android Intent URI for 1DM Lite
 * Package: idm.internet.download.manager.lite
 */
export function build1DMLiteIntentUrl(downloadUrl: string): string {
  if (!downloadUrl) return '';
  return `intent:${downloadUrl}#Intent;action=android.intent.action.VIEW;package=idm.internet.download.manager.lite;type=video/*;end`;
}

/**
 * Android Intent URI for ADM (Advanced Download Manager)
 * Package: com.dv.adm
 */
export function buildADMIntentUrl(downloadUrl: string): string {
  if (!downloadUrl) return '';
  return `intent:${downloadUrl}#Intent;action=android.intent.action.VIEW;package=com.dv.adm;type=video/*;end`;
}

/**
 * Attempts a direct browser download with customized filename.
 */
export function triggerDirectDownload(url: string, filename: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch (err) {
    console.error('Falha ao iniciar download direto:', err);
    return false;
  }
}

/**
 * Copies download URL or triggers Web Share API on mobile devices.
 */
export async function shareOrCopyDownload(
  title: string,
  url: string
): Promise<{ shared: boolean; copied: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: `Download: ${title}`,
        text: `Link de download para ${title}:`,
        url: url
      });
      return { shared: true, copied: false };
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        return { shared: false, copied: false };
      }
      // Fallback to clipboard if share was dismissed or rejected
    }
  }

  // Fallback to clipboard
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(url);
      return { shared: false, copied: true };
    } catch {
      // Ignored
    }
  }

  return { shared: false, copied: false };
}
