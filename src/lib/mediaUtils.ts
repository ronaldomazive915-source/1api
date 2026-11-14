import { MediaItem, MediaSourceSummary } from '../types.js';

export function resolveTmdbPosterUrl(path?: string | null, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original' = 'w500'): string {
  if (!path || typeof path !== 'string') return '';
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    return `https://image.tmdb.org/t/p/${size}${trimmed}`;
  }
  return `https://image.tmdb.org/t/p/${size}/${trimmed}`;
}

export function getMediaYear(item: Pick<MediaItem, 'releaseYear' | 'releaseDate' | 'firstAirDate'>): string {
  if (item.releaseYear && Number(item.releaseYear) > 1800) {
    return String(item.releaseYear);
  }
  const dateStr = item.releaseDate || item.firstAirDate || '';
  if (dateStr.length >= 4 && /^\d{4}/.test(dateStr)) {
    return dateStr.substring(0, 4);
  }
  return '—';
}

export function formatAdminDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

export function getSourceSummaryDisplay(summary?: MediaSourceSummary): {
  label: string;
  badgeClass: string;
  dotClass: string;
} {
  if (!summary || !summary.hasSource || summary.status === 'NONE') {
    return {
      label: 'Sem fonte',
      badgeClass: 'bg-zinc-900 text-zinc-400 border-zinc-700/80',
      dotClass: 'bg-zinc-500'
    };
  }
  switch (summary.status) {
    case 'ONLINE':
      return {
        label: `${summary.totalSources} ${summary.totalSources === 1 ? 'fonte' : 'fontes'} • Online`,
        badgeClass: 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80',
        dotClass: 'bg-emerald-400'
      };
    case 'VALIDATING':
      return {
        label: `${summary.totalSources} • Validando`,
        badgeClass: 'bg-sky-950/80 text-sky-400 border-sky-800/80',
        dotClass: 'bg-sky-400 animate-pulse'
      };
    case 'OFFLINE':
      return {
        label: `${summary.totalSources} • Offline`,
        badgeClass: 'bg-red-950/80 text-red-400 border-red-800/80',
        dotClass: 'bg-red-400'
      };
    case 'UNSUPPORTED':
      return {
        label: `${summary.totalSources} • Incompatível`,
        badgeClass: 'bg-orange-950/80 text-orange-400 border-orange-800/80',
        dotClass: 'bg-orange-400'
      };
    case 'EMBED_BLOCKED':
      return {
        label: `${summary.totalSources} • Embed bloqueado`,
        badgeClass: 'bg-amber-950/80 text-amber-400 border-amber-800/80',
        dotClass: 'bg-amber-400'
      };
    case 'UNVERIFIABLE':
      return {
        label: `${summary.totalSources} • Não verificável`,
        badgeClass: 'bg-indigo-950/80 text-indigo-300 border-indigo-800/80',
        dotClass: 'bg-indigo-400'
      };
    default:
      return {
        label: `${summary.totalSources} ${summary.totalSources === 1 ? 'fonte' : 'fontes'}`,
        badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
        dotClass: 'bg-emerald-400'
      };
  }
}
