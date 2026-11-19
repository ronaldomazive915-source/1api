export interface VideoQualityInfo {
  id: string;
  label: string;
  resolution?: string;
  width?: number;
  height?: number;
  badge: 'SD' | 'HD' | 'FHD' | '2K' | '4K';
}

export const SUPPORTED_VIDEO_QUALITIES: VideoQualityInfo[] = [
  { id: '144p', label: '144p', resolution: '256x144', width: 256, height: 144, badge: 'SD' },
  { id: '240p', label: '240p', resolution: '426x240', width: 426, height: 240, badge: 'SD' },
  { id: '360p', label: '360p', resolution: '640x360', width: 640, height: 360, badge: 'SD' },
  { id: '480p', label: '480p SD', resolution: '854x480', width: 854, height: 480, badge: 'SD' },
  { id: '576p', label: '576p', resolution: '1024x576', width: 1024, height: 576, badge: 'SD' },
  { id: '720p', label: '720p HD', resolution: '1280x720', width: 1280, height: 720, badge: 'HD' },
  { id: '1080p', label: '1080p Full HD', resolution: '1920x1080', width: 1920, height: 1080, badge: 'FHD' },
  { id: '1440p', label: '1440p 2K', resolution: '2560x1440', width: 2560, height: 1440, badge: '2K' },
  { id: '2160p', label: '2160p 4K UHD', resolution: '3840x2160', width: 3840, height: 2160, badge: '4K' }
];

export function parseHeightFromLabelOrResolution(str?: string): number {
  if (!str) return 480;
  const lower = str.toLowerCase();
  if (lower.includes('4k') || lower.includes('2160') || lower.includes('uhd')) return 2160;
  if (lower.includes('1440') || lower.includes('2k') || lower.includes('qhd')) return 1440;
  if (lower.includes('1080') || lower.includes('fhd') || lower.includes('full')) return 1080;
  if (lower.includes('720') || lower.includes('hd')) return 720;
  if (lower.includes('576')) return 576;
  if (lower.includes('480') || lower.includes('sd')) return 480;
  if (lower.includes('360')) return 360;
  if (lower.includes('240')) return 240;
  if (lower.includes('144')) return 144;
  const match = str.match(/(\d{3,4})p?/);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return 480;
}

export function heightToQualityLabel(height: number): { id: string; label: string; badge: 'SD' | 'HD' | 'FHD' | '2K' | '4K' } {
  if (height >= 2160) return { id: '2160p', label: '2160p 4K UHD', badge: '4K' };
  if (height >= 1440) return { id: '1440p', label: '1440p 2K', badge: '2K' };
  if (height >= 1080) return { id: '1080p', label: '1080p Full HD', badge: 'FHD' };
  if (height >= 720) return { id: '720p', label: '720p HD', badge: 'HD' };
  if (height >= 576) return { id: '576p', label: '576p SD', badge: 'SD' };
  if (height >= 480) return { id: '480p', label: '480p SD', badge: 'SD' };
  if (height >= 360) return { id: '360p', label: '360p SD', badge: 'SD' };
  if (height >= 240) return { id: '240p', label: '240p SD', badge: 'SD' };
  return { id: '144p', label: '144p SD', badge: 'SD' };
}

export function extractQualitiesFromHlsManifest(manifestText: string): string[] {
  const heights = new Set<number>();
  const lines = manifestText.split('\n');
  for (const line of lines) {
    if (line.includes('RESOLUTION=')) {
      const match = line.match(/RESOLUTION=\d+x(\d+)/i);
      if (match && match[1]) {
        const h = parseInt(match[1], 10);
        if (!isNaN(h) && h > 0) heights.add(h);
      }
    }
  }
  if (heights.size === 0) {
    // Fallback: check any 1080p/720p mentions in text
    if (/2160|4k/i.test(manifestText)) heights.add(2160);
    if (/1440|2k/i.test(manifestText)) heights.add(1440);
    if (/1080|fhd/i.test(manifestText)) heights.add(1080);
    if (/720/i.test(manifestText)) heights.add(720);
    if (/480/i.test(manifestText)) heights.add(480);
  }
  if (heights.size === 0) heights.add(1080); // Default professional assumption

  const sorted = Array.from(heights).sort((a, b) => a - b);
  return sorted.map(h => heightToQualityLabel(h).label);
}

export function detectQualityFromUrlOrMetadata(url: string, declaredQuality?: string): {
  maxDetectedResolution: string;
  availableQualities: string[];
  analysisStatus: 'identified' | 'pending' | 'inaccessible' | 'unsupported' | 'unknown' | 'error';
} {
  const lower = url.toLowerCase();
  let peakHeight = 1080; // Default modern HD/FHD

  if (lower.includes('4k') || lower.includes('2160p') || lower.includes('uhd') || lower.includes('3840x2160')) {
    peakHeight = 2160;
  } else if (lower.includes('2k') || lower.includes('1440p') || lower.includes('qhd') || lower.includes('2560x1440')) {
    peakHeight = 1440;
  } else if (lower.includes('1080p') || lower.includes('fhd') || lower.includes('fullhd') || lower.includes('1920x1080')) {
    peakHeight = 1080;
  } else if (lower.includes('720p') || lower.includes('hd') || lower.includes('1280x720')) {
    peakHeight = 720;
  } else if (lower.includes('480p') || lower.includes('854x480')) {
    peakHeight = 480;
  } else if (lower.includes('360p')) {
    peakHeight = 360;
  } else if (declaredQuality) {
    peakHeight = parseHeightFromLabelOrResolution(declaredQuality);
  }

  const standardHeights = [480, 720, 1080, 1440, 2160].filter(h => h <= peakHeight);
  if (standardHeights.length === 0) standardHeights.push(peakHeight);

  const availableQualities = standardHeights.map(h => heightToQualityLabel(h).label);
  const maxInfo = heightToQualityLabel(peakHeight);

  return {
    maxDetectedResolution: maxInfo.label,
    availableQualities,
    analysisStatus: 'identified'
  };
}
