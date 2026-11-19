import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {
  BackupConflictMode,
  BackupExportMode,
  BackupFormat,
  BackupImportFilter,
  BackupImportJob,
  BackupImportPreview,
  BackupRecord,
  BackupSystemStatus,
  Episode,
  MediaItem,
  Season
} from '../types.js';
import { db } from './database.js';
import { classifySourceUrl } from '../lib/sourceClassification.js';
import { MGEB_PREFIX, stripMgebPrefix } from '../lib/mgebUtils.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DOWNLOAD_SECRET = process.env.SESSION_SECRET || 'ronycine_founder_auth_secure_key_2026';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB upload guard
const MAX_ZIP_ENTRY_BYTES = 150 * 1024 * 1024; // 150MB single decompressed entry guard
const MAX_ZIP_TOTAL_BYTES = 300 * 1024 * 1024; // 300MB total decompressed archive guard
const MAX_ZIP_RATIO = 100; // 100:1 compression ratio guard for entries > 10MB

interface NormalizedSourceEntry {
  contentId?: number;
  mediaTitle?: string;
  contentType: 'movie' | 'tv';
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  url: string;
  originalUrl: string;
  serverName?: string;
  format?: string;
  quality?: string;
  audioLanguage?: string;
  isPrimary?: boolean;
  priority?: number;
  enabled?: boolean;
  status?: string;
}

interface ParsedBackupDataset {
  uploadToken: string;
  filename: string;
  detectedFormat: BackupFormat;
  detectedMode: BackupExportMode | 'mixed';
  sizeBytes: number;
  createdAt: number;
  movies: Partial<MediaItem>[];
  series: Partial<MediaItem>[];
  sources: NormalizedSourceEntry[];
  settings?: any;
  plansConfig?: any;
  apiGlobalSettings?: any;
  seasonSourceTemplates?: Record<string, any>;
  detectedColumns: string[];
  warnings: string[];
  errors: string[];
  invalidRows: number;
}

interface ActiveImportRuntime {
  job: BackupImportJob;
  dataset: ParsedBackupDataset;
  cursor: number;
  cancelled: boolean;
  running: boolean;
}

const parsedUploadCache = new Map<string, ParsedBackupDataset>();
const activeImportJobs = new Map<string, ActiveImportRuntime>();

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

export function getMimeTypeForFormat(format: BackupFormat): string {
  switch (format) {
    case 'zip':
      return 'application/zip';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
}

function normalizeUrlDedupeMgeb(rawUrl: string): { url: string; originalUrl: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { url: '', originalUrl: '' };
  if (/^https?:\/\/(www\.)?mgeb\.space\/mp4\.php\?/i.test(trimmed)) {
    // Strip redundant duplicate MGEB prefixes cleanly so we never end up with nested mgeb?url=mgeb?url=
    const { hadPrefix, innerUrl } = stripMgebPrefix(trimmed);
    const rebuilt = hadPrefix && innerUrl ? `${MGEB_PREFIX}${innerUrl}` : trimmed;
    return { url: rebuilt, originalUrl: rebuilt };
  }
  return { url: trimmed, originalUrl: trimmed };
}

function parseIntSafe(val: any): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const str = String(val).trim();
  if (!str) return undefined;
  const n = Number(str);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function parseFloatSafe(val: any): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(String(val).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function parseSeasonSafe(val: any, fallback = 1): number {
  const n = parseIntSafe(val);
  if (n === undefined) return fallback;
  return Math.max(0, n);
}

function parseGenresSafe(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
      } catch {}
    }
    return trimmed
      .split(/[|,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}

function csvEscape(val: any): string {
  if (val === undefined || val === null) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function sanitizeZipEntryName(entryName: string): void {
  if (!entryName || typeof entryName !== 'string') {
    throw new Error('Entrada inválida detetada dentro do arquivo ZIP.');
  }
  const normalized = entryName.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some(seg => seg === '..') ||
    normalized.includes('\0')
  ) {
    throw new Error(`Ameaça de segurança bloqueada (Zip Slip): caminho ilegal "${entryName}".`);
  }
}

function buildNormalizedExportStructures(mode: BackupExportMode) {
  const snap = db.getFullSafeExportSnapshot(mode);
  const movies: any[] = [];
  const series: any[] = [];
  const seasons: any[] = [];
  const episodes: any[] = [];

  for (const rawItem of snap.media || []) {
    const normType = String(rawItem.type || '').toLowerCase();
    const isTv = normType === 'tv' || normType === 'series' || normType === 'serie';
    if (!isTv) {
      movies.push({
        id: rawItem.id,
        tmdbId: rawItem.tmdbId ?? null,
        imdbId: rawItem.imdbId ?? null,
        title: rawItem.title,
        originalTitle: rawItem.originalTitle || '',
        type: 'movie',
        overview: rawItem.overview || '',
        posterPath: rawItem.posterPath || '',
        backdropPath: rawItem.backdropPath || '',
        voteAverage: rawItem.voteAverage ?? 0,
        releaseYear: rawItem.releaseYear ?? null,
        releaseDate: rawItem.releaseDate || '',
        genres: rawItem.genres || [],
        duration: rawItem.duration ?? null,
        published: rawItem.published !== false,
        status: rawItem.status || 'ACTIVE',
        isTop10: Boolean(rawItem.isTop10),
        createdAt: rawItem.createdAt || '',
        updatedAt: rawItem.updatedAt || '',
        extraMetadata: (rawItem as any).extraMetadata
      });
    } else {
      const itemSeasons = Array.isArray(rawItem.seasons) ? rawItem.seasons : [];
      series.push({
        id: rawItem.id,
        tmdbId: rawItem.tmdbId ?? null,
        imdbId: rawItem.imdbId ?? null,
        title: rawItem.title,
        originalTitle: rawItem.originalTitle || '',
        type: 'tv',
        overview: rawItem.overview || '',
        posterPath: rawItem.posterPath || '',
        backdropPath: rawItem.backdropPath || '',
        voteAverage: rawItem.voteAverage ?? 0,
        releaseYear: rawItem.releaseYear ?? null,
        firstAirDate: rawItem.firstAirDate || rawItem.releaseDate || '',
        genres: rawItem.genres || [],
        seasonsCount: rawItem.seasonsCount ?? rawItem.numberOfSeasons ?? itemSeasons.length,
        episodesCount: rawItem.episodesCount ?? rawItem.numberOfEpisodes ?? 0,
        published: rawItem.published !== false,
        status: rawItem.status || 'ACTIVE',
        isTop10: Boolean(rawItem.isTop10),
        createdAt: rawItem.createdAt || '',
        updatedAt: rawItem.updatedAt || '',
        extraMetadata: (rawItem as any).extraMetadata
      });

      for (const s of itemSeasons) {
        const sNum = parseSeasonSafe(s.seasonNumber, 1);
        const eps = Array.isArray(s.episodes) ? s.episodes : [];
        seasons.push({
          seriesId: rawItem.id,
          tmdbId: rawItem.tmdbId ?? null,
          seriesTitle: rawItem.title,
          seasonNumber: sNum,
          name: s.name || s.title || (sNum === 0 ? 'Especiais' : `Temporada ${sNum}`),
          overview: s.overview || '',
          posterPath: s.posterPath || '',
          episodeCount: Math.max(Number(s.episodeCount || 0), eps.length)
        });

        for (const ep of eps) {
          episodes.push({
            id: ep.id || `ep-${rawItem.tmdbId || rawItem.id}-${sNum}-${ep.episodeNumber}`,
            tmdbId: rawItem.tmdbId ?? null,
            seriesId: rawItem.id,
            seriesTitle: rawItem.title,
            seasonNumber: sNum,
            episodeNumber: Number(ep.episodeNumber),
            title: ep.title || `Episódio ${ep.episodeNumber}`,
            overview: ep.overview || '',
            airDate: ep.airDate || '',
            stillPath: ep.stillPath || '',
            duration: ep.duration ?? null,
            voteAverage: ep.voteAverage ?? null,
            extraMetadata: ep.extraMetadata
          });
        }
      }
    }
  }

  // Deduplicate combined videoSources + playerSources
  const seenSourceKey = new Set<string>();
  const sources: any[] = [];
  for (const v of snap.videoSources || []) {
    const normType = String(v.contentType || 'movie').toLowerCase() === 'tv' ? 'tv' : 'movie';
    const sNum = normType === 'tv' ? parseSeasonSafe(v.seasonNumber, 1) : undefined;
    const eNum = normType === 'tv' ? Math.max(1, Number(v.episodeNumber || 1)) : undefined;
    const key = `${v.contentId}:${normType}:${sNum ?? ''}:${eNum ?? ''}:${String(v.url || '').trim()}`;
    if (!seenSourceKey.has(key)) {
      seenSourceKey.add(key);
      sources.push({
        id: v.id,
        tmdbId: Number(v.contentId),
        type: normType,
        seasonNumber: sNum ?? null,
        episodeNumber: eNum ?? null,
        url: v.url,
        originalUrl: v.originalUrl || v.url,
        serverName: v.serverName || v.providerName || v.provider || 'Servidor',
        format: v.format || 'auto',
        quality: v.quality || '1080p',
        audioLanguage: v.audioLanguage || 'Português',
        isPrimary: v.isPrimary !== false,
        priority: v.priority ?? 1,
        enabled: v.enabled !== false,
        status: v.status || 'registered',
        createdAt: v.createdAt || ''
      });
    }
  }

  for (const p of snap.playerSources || []) {
    const normType = String(p.type || 'movie').toLowerCase() === 'tv' || String(p.type || '').toLowerCase() === 'series' ? 'tv' : 'movie';
    const sNum = normType === 'tv' ? parseSeasonSafe(p.season, 1) : undefined;
    const eNum = normType === 'tv' ? Math.max(1, Number(p.episode || 1)) : undefined;
    const key = `${p.tmdbId}:${normType}:${sNum ?? ''}:${eNum ?? ''}:${String(p.url || '').trim()}`;
    if (!seenSourceKey.has(key)) {
      seenSourceKey.add(key);
      sources.push({
        id: p.id,
        tmdbId: Number(p.tmdbId || 0),
        type: normType,
        seasonNumber: sNum ?? null,
        episodeNumber: eNum ?? null,
        url: p.url,
        originalUrl: p.originalUrl || p.url,
        serverName: p.provider || p.label || 'Servidor',
        format: p.format || 'auto',
        quality: p.quality || '1080p',
        audioLanguage: p.audioLanguage || 'Português',
        isPrimary: p.isPrimary !== false,
        priority: p.priority ?? 1,
        enabled: p.enabled !== false,
        status: p.status || 'registered',
        createdAt: p.createdAt || ''
      });
    }
  }

  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: '2.0',
    platform: 'RONYCINE API',
    mode,
    exportedAt: now,
    counts: {
      movies: movies.length,
      series: series.length,
      seasons: seasons.length,
      episodes: episodes.length,
      sources: sources.length
    },
    securityNote: 'Credenciais, senhas, hashes e chaves privadas foram automaticamente excluídas desta exportação.'
  };

  return {
    manifest,
    movies,
    series,
    seasons,
    episodes,
    sources,
    rawSnap: snap
  };
}

// --- SIGNED DOWNLOAD TOKENS (ANDROID & CHROME COMPATIBLE) ---
export function createBackupDownloadToken(backupId: string, ttlSeconds = 300): string {
  const payload = {
    bid: backupId,
    exp: Date.now() + ttlSeconds * 1000
  };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(`bkpdl.${b64}`).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyBackupDownloadToken(token: string, expectedBackupId: string): boolean {
  try {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 2) return false;
    const [b64, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(`bkpdl.${b64}`).digest('base64url');
    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return false;
    }
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
    if (!payload || payload.bid !== expectedBackupId) return false;
    if (Date.now() > Number(payload.exp || 0)) return false;
    return true;
  } catch {
    return false;
  }
}

// --- EXPORT ENGINE (ZIP / JSON / CSV / XLSX) ---
export async function createBackupArchive(
  mode: BackupExportMode,
  format: BackupFormat,
  createdBy: string,
  origin: BackupRecord['origin'] = 'manual'
): Promise<BackupRecord> {
  ensureBackupsDir();

  const { manifest, movies, series, seasons, episodes, sources, rawSnap } = buildNormalizedExportStructures(mode);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const id = `bkp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const filename = format === 'zip' ? `RONYCINE_BACKUP_v1_${stamp}.zip` : format === 'json' ? `RONYCINE_BACKUP_v1_${stamp}.json` : `ronycine-${mode}-backup-${stamp}.${format}`;
  const filePath = path.join(BACKUPS_DIR, filename);

  let buffer: Buffer;

  if (format === 'zip') {
    const zip = new JSZip();
    const manifestJson = JSON.stringify({ ...manifest, backupFormat: 'RONYCINE_BACKUP', version: 1 }, null, 2);
    const moviesJson = JSON.stringify(movies, null, 2);
    const seriesJson = JSON.stringify(series, null, 2);
    const seasonsJson = JSON.stringify(seasons, null, 2);
    const episodesJson = JSON.stringify(episodes, null, 2);
    const sourcesJson = JSON.stringify(sources, null, 2);
    const metadataJson = JSON.stringify(
      {
        manifest,
        seasonSourceTemplates: rawSnap.seasonSourceTemplates || {},
        categories: (rawSnap as any).categories || [],
        settings: mode === 'full' ? (rawSnap as any).settings || {} : undefined,
        plansConfig: mode === 'full' ? (rawSnap as any).plansConfig || {} : undefined,
        apiGlobalSettings: mode === 'full' ? (rawSnap as any).apiGlobalSettings || {} : undefined,
        developerApps: mode === 'full' ? (rawSnap as any).developerApps || [] : undefined
      },
      null,
      2
    );

    const checksums = {
      'manifest.json': crypto.createHash('sha256').update(manifestJson).digest('hex'),
      'movies.json': crypto.createHash('sha256').update(moviesJson).digest('hex'),
      'series.json': crypto.createHash('sha256').update(seriesJson).digest('hex'),
      'seasons.json': crypto.createHash('sha256').update(seasonsJson).digest('hex'),
      'episodes.json': crypto.createHash('sha256').update(episodesJson).digest('hex'),
      'video_sources.json': crypto.createHash('sha256').update(sourcesJson).digest('hex'),
      'metadata.json': crypto.createHash('sha256').update(metadataJson).digest('hex')
    };

    zip.file('manifest.json', manifestJson);
    zip.file('movies.json', moviesJson);
    zip.file('series.json', seriesJson);
    zip.file('seasons.json', seasonsJson);
    zip.file('episodes.json', episodesJson);
    zip.file('video_sources.json', sourcesJson);
    zip.file('metadata.json', metadataJson);
    zip.file('checksums.json', JSON.stringify(checksums, null, 2));

    buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  } else if (format === 'json') {
    const payload = {
      backup_format: 'RONYCINE_BACKUP',
      version: 1,
      created_at: manifest.exportedAt,
      system: 'RONYCINE API',
      manifest,
      movies,
      series,
      seasons,
      episodes,
      video_sources: sources,
      media: rawSnap.media,
      playerSources: rawSnap.playerSources,
      seasonSourceTemplates: rawSnap.seasonSourceTemplates,
      ...(mode === 'full'
        ? {
            settings: (rawSnap as any).settings,
            plansConfig: (rawSnap as any).plansConfig,
            apiGlobalSettings: (rawSnap as any).apiGlobalSettings,
            developerApps: (rawSnap as any).developerApps,
            categories: (rawSnap as any).categories
          }
        : {})
    };
    buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');
  } else if (format === 'csv') {
    const headers = [
      'type',
      'tmdb_id',
      'imdb_id',
      'title',
      'original_title',
      'overview',
      'poster_path',
      'backdrop_path',
      'release_year',
      'genres',
      'season_number',
      'episode_number',
      'episode_name',
      'url',
      'original_url',
      'server_name',
      'format',
      'quality',
      'audio_language',
      'is_primary',
      'status',
      'extra_metadata'
    ];
    const rows: string[] = [headers.join(',')];

    // Map sources by content key for flat CSV rows while also emitting media without sources
    const sourceByMovie = new Map<number, any[]>();
    const sourceByEpisode = new Map<string, any[]>();
    for (const s of sources) {
      const tmdbId = Number(s.tmdbId || 0);
      if (s.type === 'tv') {
        const key = `${tmdbId}:${parseSeasonSafe(s.seasonNumber, 1)}:${Math.max(1, Number(s.episodeNumber || 1))}`;
        const list = sourceByEpisode.get(key) || [];
        list.push(s);
        sourceByEpisode.set(key, list);
      } else {
        const list = sourceByMovie.get(tmdbId) || [];
        list.push(s);
        sourceByMovie.set(tmdbId, list);
      }
    }

    for (const m of movies) {
      const mSources = m.tmdbId ? sourceByMovie.get(Number(m.tmdbId)) || [] : [];
      if (mSources.length === 0) {
        rows.push(
          [
            'movie',
            m.tmdbId ?? '',
            m.imdbId ?? '',
            m.title,
            m.originalTitle ?? '',
            m.overview ?? '',
            m.posterPath ?? '',
            m.backdropPath ?? '',
            m.releaseYear ?? '',
            (m.genres || []).join('|'),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            m.status ?? 'ACTIVE',
            m.extraMetadata ? JSON.stringify(m.extraMetadata) : ''
          ]
            .map(csvEscape)
            .join(',')
        );
      } else {
        for (const src of mSources) {
          rows.push(
            [
              'movie',
              m.tmdbId ?? '',
              m.imdbId ?? '',
              m.title,
              m.originalTitle ?? '',
              m.overview ?? '',
              m.posterPath ?? '',
              m.backdropPath ?? '',
              m.releaseYear ?? '',
              (m.genres || []).join('|'),
              '',
              '',
              '',
              src.url,
              src.originalUrl || src.url,
              src.serverName || '',
              src.format || 'auto',
              src.quality || '1080p',
              src.audioLanguage || 'Português',
              src.isPrimary ? 'true' : 'false',
              src.status || 'registered',
              m.extraMetadata ? JSON.stringify(m.extraMetadata) : ''
            ]
              .map(csvEscape)
              .join(',')
          );
        }
      }
    }

    const seriesByTmdb = new Map<number, any>();
    for (const ser of series) {
      if (ser.tmdbId) seriesByTmdb.set(Number(ser.tmdbId), ser);
    }

    const emittedSeriesTmdb = new Set<number>();
    for (const ep of episodes) {
      const ser = ep.tmdbId ? seriesByTmdb.get(Number(ep.tmdbId)) : undefined;
      if (ep.tmdbId) emittedSeriesTmdb.add(Number(ep.tmdbId));
      const key = `${Number(ep.tmdbId || 0)}:${parseSeasonSafe(ep.seasonNumber, 1)}:${Number(ep.episodeNumber)}`;
      const epSources = sourceByEpisode.get(key) || [];
      if (epSources.length === 0) {
        rows.push(
          [
            'tv',
            ep.tmdbId ?? '',
            ser?.imdbId ?? '',
            ser?.title || ep.seriesTitle || '',
            ser?.originalTitle ?? '',
            ep.overview || ser?.overview || '',
            ep.stillPath || ser?.posterPath || '',
            ser?.backdropPath ?? '',
            ser?.releaseYear ?? '',
            (ser?.genres || []).join('|'),
            ep.seasonNumber,
            ep.episodeNumber,
            ep.title,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            ser?.status ?? 'ACTIVE',
            ep.extraMetadata ? JSON.stringify(ep.extraMetadata) : ''
          ]
            .map(csvEscape)
            .join(',')
        );
      } else {
        for (const src of epSources) {
          rows.push(
            [
              'tv',
              ep.tmdbId ?? '',
              ser?.imdbId ?? '',
              ser?.title || ep.seriesTitle || '',
              ser?.originalTitle ?? '',
              ep.overview || ser?.overview || '',
              ep.stillPath || ser?.posterPath || '',
              ser?.backdropPath ?? '',
              ser?.releaseYear ?? '',
              (ser?.genres || []).join('|'),
              ep.seasonNumber,
              ep.episodeNumber,
              ep.title,
              src.url,
              src.originalUrl || src.url,
              src.serverName || '',
              src.format || 'auto',
              src.quality || '1080p',
              src.audioLanguage || 'Português',
              src.isPrimary ? 'true' : 'false',
              src.status || 'registered',
              ep.extraMetadata ? JSON.stringify(ep.extraMetadata) : ''
            ]
              .map(csvEscape)
              .join(',')
          );
        }
      }
    }

    // Emit any series that had zero hydrated episodes yet
    for (const ser of series) {
      if (ser.tmdbId && emittedSeriesTmdb.has(Number(ser.tmdbId))) continue;
      rows.push(
        [
          'tv',
          ser.tmdbId ?? '',
          ser.imdbId ?? '',
          ser.title,
          ser.originalTitle ?? '',
          ser.overview ?? '',
          ser.posterPath ?? '',
          ser.backdropPath ?? '',
          ser.releaseYear ?? '',
          (ser.genres || []).join('|'),
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          ser.status ?? 'ACTIVE',
          ser.extraMetadata ? JSON.stringify(ser.extraMetadata) : ''
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    buffer = Buffer.from('\uFEFF' + rows.join('\r\n'), 'utf-8');
  } else {
    // XLSX multi-sheet workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'RONYCINE API';
    wb.created = new Date();

    const wsManifest = wb.addWorksheet('Manifesto');
    wsManifest.columns = [
      { header: 'Propriedade', key: 'key', width: 28 },
      { header: 'Valor', key: 'value', width: 48 }
    ];
    wsManifest.addRows([
      { key: 'Plataforma', value: manifest.platform },
      { key: 'Schema', value: manifest.schemaVersion },
      { key: 'Modo', value: manifest.mode },
      { key: 'Exportado em', value: manifest.exportedAt },
      { key: 'Filmes', value: manifest.counts.movies },
      { key: 'Séries', value: manifest.counts.series },
      { key: 'Temporadas', value: manifest.counts.seasons },
      { key: 'Episódios', value: manifest.counts.episodes },
      { key: 'Fontes / Links', value: manifest.counts.sources }
    ]);

    const wsMovies = wb.addWorksheet('Filmes');
    wsMovies.columns = [
      { header: 'tmdb_id', key: 'tmdbId', width: 14 },
      { header: 'imdb_id', key: 'imdbId', width: 14 },
      { header: 'title', key: 'title', width: 34 },
      { header: 'original_title', key: 'originalTitle', width: 28 },
      { header: 'release_year', key: 'releaseYear', width: 14 },
      { header: 'genres', key: 'genres', width: 28 },
      { header: 'vote_average', key: 'voteAverage', width: 14 },
      { header: 'duration', key: 'duration', width: 12 },
      { header: 'poster_path', key: 'posterPath', width: 40 },
      { header: 'backdrop_path', key: 'backdropPath', width: 40 },
      { header: 'overview', key: 'overview', width: 55 },
      { header: 'status', key: 'status', width: 14 }
    ];
    for (const m of movies) {
      wsMovies.addRow({
        ...m,
        genres: (m.genres || []).join(', ')
      });
    }

    const wsSeries = wb.addWorksheet('Series');
    wsSeries.columns = [
      { header: 'tmdb_id', key: 'tmdbId', width: 14 },
      { header: 'imdb_id', key: 'imdbId', width: 14 },
      { header: 'title', key: 'title', width: 34 },
      { header: 'original_title', key: 'originalTitle', width: 28 },
      { header: 'release_year', key: 'releaseYear', width: 14 },
      { header: 'seasons_count', key: 'seasonsCount', width: 14 },
      { header: 'episodes_count', key: 'episodesCount', width: 14 },
      { header: 'genres', key: 'genres', width: 28 },
      { header: 'poster_path', key: 'posterPath', width: 40 },
      { header: 'backdrop_path', key: 'backdropPath', width: 40 },
      { header: 'overview', key: 'overview', width: 55 },
      { header: 'status', key: 'status', width: 14 }
    ];
    for (const s of series) {
      wsSeries.addRow({
        ...s,
        genres: (s.genres || []).join(', ')
      });
    }

    const wsEpisodes = wb.addWorksheet('Episodios');
    wsEpisodes.columns = [
      { header: 'tmdb_id', key: 'tmdbId', width: 14 },
      { header: 'series_title', key: 'seriesTitle', width: 30 },
      { header: 'season_number', key: 'seasonNumber', width: 15 },
      { header: 'episode_number', key: 'episodeNumber', width: 15 },
      { header: 'episode_name', key: 'title', width: 34 },
      { header: 'air_date', key: 'airDate', width: 14 },
      { header: 'duration', key: 'duration', width: 12 },
      { header: 'still_path', key: 'stillPath', width: 40 },
      { header: 'overview', key: 'overview', width: 50 }
    ];
    for (const ep of episodes) {
      wsEpisodes.addRow(ep);
    }

    const wsSources = wb.addWorksheet('Fontes_Links');
    wsSources.columns = [
      { header: 'tmdb_id', key: 'tmdbId', width: 14 },
      { header: 'type', key: 'type', width: 10 },
      { header: 'season_number', key: 'seasonNumber', width: 14 },
      { header: 'episode_number', key: 'episodeNumber', width: 14 },
      { header: 'url', key: 'url', width: 55 },
      { header: 'original_url', key: 'originalUrl', width: 55 },
      { header: 'server_name', key: 'serverName', width: 22 },
      { header: 'format', key: 'format', width: 14 },
      { header: 'quality', key: 'quality', width: 12 },
      { header: 'audio_language', key: 'audioLanguage', width: 14 },
      { header: 'is_primary', key: 'isPrimary', width: 12 },
      { header: 'status', key: 'status', width: 14 }
    ];
    for (const src of sources) {
      wsSources.addRow(src);
    }

    if (mode === 'full') {
      const wsCfg = wb.addWorksheet('Configuracoes');
      wsCfg.columns = [
        { header: 'Secao', key: 'section', width: 24 },
        { header: 'Dados_JSON', key: 'json', width: 80 }
      ];
      wsCfg.addRow({ section: 'settings', json: JSON.stringify((rawSnap as any).settings || {}) });
      wsCfg.addRow({ section: 'apiGlobalSettings', json: JSON.stringify((rawSnap as any).apiGlobalSettings || {}) });
      wsCfg.addRow({ section: 'plansConfig', json: JSON.stringify((rawSnap as any).plansConfig || {}) });
      wsCfg.addRow({ section: 'developerApps', json: JSON.stringify((rawSnap as any).developerApps || []) });
    }

    const outArr = await wb.xlsx.writeBuffer();
    buffer = Buffer.from(outArr as ArrayBuffer);
  }

  fs.writeFileSync(filePath, buffer);

  const record: BackupRecord = {
    id,
    filename,
    format,
    mode,
    mimeType: getMimeTypeForFormat(format),
    sizeBytes: buffer.length,
    createdAt: manifest.exportedAt,
    createdBy,
    origin,
    counts: manifest.counts,
    filePath
  };

  db.saveBackupRecord(record);
  db.updateBackupConfig({ lastBackupAt: record.createdAt });
  db.addAuditLog(createdBy, 'BACKUP_EXPORT', 'SUCCESS', `Backup ${format.toUpperCase()} (${mode}) criado: ${filename}`);

  return record;
}

export function getAllBackupHistory(): BackupRecord[] {
  const modern = db.getBackupRecords();
  const legacy = (db.getBackups() || []).map((b: any) => {
    const media = Array.isArray(b.payload?.media) ? b.payload.media : [];
    const movies = media.filter((m: any) => String(m.type || '').toLowerCase() !== 'tv' && String(m.type || '').toLowerCase() !== 'series').length;
    const seriesList = media.filter((m: any) => String(m.type || '').toLowerCase() === 'tv' || String(m.type || '').toLowerCase() === 'series');
    let seasons = 0;
    let episodes = 0;
    for (const s of seriesList) {
      const sArr = Array.isArray(s.seasons) ? s.seasons : [];
      seasons += sArr.length;
      for (const sn of sArr) {
        episodes += Array.isArray(sn.episodes) ? sn.episodes.length : Number(sn.episodeCount || 0);
      }
    }
    return {
      id: b.id,
      filename: b.filename || `legacy-backup-${b.id}.json`,
      format: 'json' as BackupFormat,
      mode: 'full' as BackupExportMode,
      mimeType: 'application/json; charset=utf-8',
      sizeBytes: Number(b.sizeBytes || 0),
      createdAt: b.createdAt,
      createdBy: 'admin',
      origin: 'legacy' as const,
      counts: {
        movies,
        series: seriesList.length,
        seasons,
        episodes,
        sources: Array.isArray(b.payload?.playerSources) ? b.payload.playerSources.length : 0
      },
      inlineLegacy: true
    };
  });

  const merged = [...modern];
  for (const leg of legacy) {
    if (!merged.some(r => r.id === leg.id)) merged.push(leg);
  }
  return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function resolveBackupFileForDownload(id: string): {
  record: BackupRecord;
  filePath?: string;
  inlineBuffer?: Buffer;
} | null {
  const modern = db.getBackupRecords().find(r => r.id === id);
  if (modern) {
    if (modern.filePath && fs.existsSync(modern.filePath)) {
      return { record: modern, filePath: modern.filePath };
    }
    const fallbackPath = path.join(BACKUPS_DIR, modern.filename);
    if (fs.existsSync(fallbackPath)) {
      return { record: modern, filePath: fallbackPath };
    }
  }

  const legacy = (db.getBackups() || []).find((b: any) => b.id === id);
  if (legacy) {
    const buf = Buffer.from(JSON.stringify(legacy.payload || {}, null, 2), 'utf-8');
    return {
      record: {
        id: legacy.id,
        filename: legacy.filename || `ronycine-backup-${legacy.id}.json`,
        format: 'json',
        mode: 'full',
        mimeType: 'application/json; charset=utf-8',
        sizeBytes: buf.length,
        createdAt: legacy.createdAt,
        createdBy: 'admin',
        origin: 'legacy',
        counts: { movies: 0, series: 0, seasons: 0, episodes: 0, sources: 0 },
        inlineLegacy: true
      },
      inlineBuffer: buf
    };
  }
  return null;
}

export function deleteBackupRecordAndFile(id: string, email: string): boolean {
  const rec = db.removeBackupRecord(id);
  if (rec) {
    const candidatePath = rec.filePath || path.join(BACKUPS_DIR, rec.filename);
    try {
      if (candidatePath && fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
    } catch {}
    db.addAuditLog(email, 'DELETE_BACKUP', 'SUCCESS', `Backup removido: ${rec.filename}`);
    return true;
  }
  return db.deleteBackup(id, email);
}

export function getBackupSystemStatus(): BackupSystemStatus {
  ensureBackupsDir();
  const counts = db.getRawMediaAndSourcesCount();
  const cfg = db.getBackupConfig();
  let dirSize = 0;
  try {
    for (const f of fs.readdirSync(BACKUPS_DIR)) {
      const full = path.join(BACKUPS_DIR, f);
      const st = fs.statSync(full);
      if (st.isFile()) dirSize += st.size;
    }
  } catch {}
  return {
    totalMovies: counts.movies,
    totalSeries: counts.series,
    totalSeasons: counts.seasons,
    totalEpisodes: counts.episodes,
    totalSources: counts.sources,
    storeSizeBytes: db.getStoreFileSizeBytes(),
    backupsDirSizeBytes: dirSize,
    backupsCount: getAllBackupHistory().length,
    lastBackupAt: cfg.lastBackupAt || null,
    lastImportAt: cfg.lastImportAt || null,
    autoBackupEnabled: Boolean(cfg.autoBackupEnabled),
    autoBackupIntervalHours: Number(cfg.autoBackupIntervalHours || 24),
    serverTime: new Date().toISOString()
  };
}

// --- FLEXIBLE ALIAS PARSING FOR SMART IMPORTER ---
const ALIAS_MAP: Record<string, string[]> = {
  type: ['type', 'media_type', 'mediatype', 'tipo', 'content_type', 'contenttype', 'categoria_tipo'],
  tmdbId: ['tmdb_id', 'tmdbid', 'id_tmdb', 'tmdb', 'content_id', 'contentid'],
  imdbId: ['imdb_id', 'imdbid', 'imdb'],
  title: ['title', 'name', 'titulo', 'nome', 'series_title', 'seriestitle', 'nome_serie', 'nome_filme'],
  originalTitle: ['original_title', 'originaltitle', 'original_name', 'titulo_original'],
  overview: ['overview', 'sinopse', 'synopsis', 'descricao', 'description'],
  posterPath: ['poster', 'poster_path', 'posterpath', 'capa', 'imagem', 'still_path', 'stillpath'],
  backdropPath: ['backdrop', 'backdrop_path', 'backdroppath', 'banner', 'fundo'],
  releaseYear: ['release_year', 'releaseyear', 'ano', 'year', 'release_date', 'releasedate', 'first_air_date'],
  voteAverage: ['vote_average', 'voteaverage', 'nota', 'rating', 'imdb_rating'],
  duration: ['duration', 'runtime', 'duracao'],
  genres: ['genres', 'generos', 'genero', 'categories', 'categorias'],
  seasonNumber: ['season', 'season_number', 'seasonnumber', 'temporada', 's', 'temp'],
  episodeNumber: ['episode', 'episode_number', 'episodenumber', 'episodio', 'ep', 'e'],
  episodeName: ['episode_name', 'episodename', 'episode_title', 'episodetitle', 'nome_episodio', 'titulo_episodio'],
  airDate: ['air_date', 'airdate', 'data_episodio', 'data_lancamento'],
  url: ['url', 'link', 'source_url', 'sourceurl', 'video_url', 'videourl', 'stream_url', 'streamurl', 'player_url', 'embed_url'],
  originalUrl: ['original_url', 'originalurl', 'raw_url'],
  serverName: ['server_name', 'servername', 'provider', 'provider_name', 'servidor', 'fonte'],
  format: ['format', 'formato', 'video_format'],
  quality: ['quality', 'qualidade', 'resolution'],
  audioLanguage: ['audio_language', 'audiolanguage', 'language', 'idioma', 'audio'],
  isPrimary: ['is_primary', 'isprimary', 'principal'],
  status: ['status', 'estado']
};

const KNOWN_NORMALIZED_KEYS = new Set(Object.values(ALIAS_MAP).flat());

function extractFieldByAliases(row: Record<string, any>, targetKey: keyof typeof ALIAS_MAP): any {
  const aliases = ALIAS_MAP[targetKey];
  const lowerMap = new Map<string, any>();
  for (const [k, v] of Object.entries(row)) {
    lowerMap.set(k.trim().toLowerCase(), v);
  }
  for (const alias of aliases) {
    if (lowerMap.has(alias)) {
      const val = lowerMap.get(alias);
      if (val !== undefined && val !== null && String(val).trim() !== '') return val;
    }
  }
  return undefined;
}

function extractExtraMetadata(row: Record<string, any>): Record<string, any> | undefined {
  const extras: Record<string, any> = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(row)) {
    const cleanKey = k.trim().toLowerCase();
    if (!cleanKey || cleanKey === 'extra_metadata' || cleanKey === 'extrametadata' || cleanKey === 'id') continue;
    if (!KNOWN_NORMALIZED_KEYS.has(cleanKey) && v !== undefined && v !== null && String(v).trim() !== '') {
      extras[k.trim()] = v;
      hasAny = true;
    }
  }
  const rawExtra = row.extra_metadata ?? row.extraMetadata;
  if (rawExtra) {
    try {
      const parsed = typeof rawExtra === 'string' ? JSON.parse(rawExtra) : rawExtra;
      if (parsed && typeof parsed === 'object') {
        Object.assign(extras, parsed);
        hasAny = true;
      }
    } catch {}
  }
  return hasAny ? extras : undefined;
}

function parseCsvText(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const lines: string[][] = [];
  let curRow: string[] = [];
  let curCell = '';
  let inQuotes = false;

  // Auto-detect delimiter from first non-empty line outside quotes
  const firstNewline = cleanText.search(/\r?\n/);
  const sampleLine = firstNewline >= 0 ? cleanText.slice(0, firstNewline) : cleanText;
  let delimiter = ',';
  const commaCount = (sampleLine.match(/,/g) || []).length;
  const semiCount = (sampleLine.match(/;/g) || []).length;
  const tabCount = (sampleLine.match(/\t/g) || []).length;
  if (semiCount > commaCount && semiCount >= tabCount) delimiter = ';';
  else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleanText[i + 1] === '"') {
          curCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        curCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        curRow.push(curCell);
        curCell = '';
      } else if (ch === '\r') {
        if (cleanText[i + 1] === '\n') i++;
        curRow.push(curCell);
        if (curRow.some(c => c.trim() !== '')) lines.push(curRow);
        curRow = [];
        curCell = '';
      } else if (ch === '\n') {
        curRow.push(curCell);
        if (curRow.some(c => c.trim() !== '')) lines.push(curRow);
        curRow = [];
        curCell = '';
      } else {
        curCell += ch;
      }
    }
  }
  if (curCell.length > 0 || curRow.length > 0) {
    curRow.push(curCell);
    if (curRow.some(c => c.trim() !== '')) lines.push(curRow);
  }

  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r];
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = (line[c] ?? '').trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
}

function ingestTabularRows(rows: Record<string, any>[], dataset: ParsedBackupDataset) {
  const movieMap = new Map<string, Partial<MediaItem>>();
  const seriesMap = new Map<string, Partial<MediaItem>>();

  for (const m of dataset.movies) {
    const k = m.tmdbId ? `tmdb:${m.tmdbId}` : `title:${(m.title || '').toLowerCase()}`;
    movieMap.set(k, m);
  }
  for (const s of dataset.series) {
    const k = s.tmdbId ? `tmdb:${s.tmdbId}` : `title:${(s.title || '').toLowerCase()}`;
    seriesMap.set(k, s);
  }

  for (const row of rows) {
    const tmdbId = parseIntSafe(extractFieldByAliases(row, 'tmdbId'));
    const rawType = String(extractFieldByAliases(row, 'type') || '').trim().toLowerCase();
    const sNumRaw = extractFieldByAliases(row, 'seasonNumber');
    const eNumRaw = extractFieldByAliases(row, 'episodeNumber');
    const epNameRaw = extractFieldByAliases(row, 'episodeName');
    const rawTitle = extractFieldByAliases(row, 'title');
    const rawUrl = extractFieldByAliases(row, 'url');
    const rawOrigUrl = extractFieldByAliases(row, 'originalUrl');

    const hasEpisodeCols = sNumRaw !== undefined || eNumRaw !== undefined || epNameRaw !== undefined;
    const isTv =
      rawType === 'tv' ||
      rawType === 'series' ||
      rawType === 'serie' ||
      rawType === 'série' ||
      (!rawType && hasEpisodeCols);

    if (!rawTitle && !tmdbId && !rawUrl) {
      dataset.invalidRows++;
      continue;
    }

    const extras = extractExtraMetadata(row);
    const posterPath = extractFieldByAliases(row, 'posterPath');
    const backdropPath = extractFieldByAliases(row, 'backdropPath');
    const overview = extractFieldByAliases(row, 'overview');
    const releaseYear = parseIntSafe(String(extractFieldByAliases(row, 'releaseYear') || '').slice(0, 4));
    const imdbId = extractFieldByAliases(row, 'imdbId');
    const genres = parseGenresSafe(extractFieldByAliases(row, 'genres'));
    const voteAverage = parseFloatSafe(extractFieldByAliases(row, 'voteAverage'));
    const duration = parseIntSafe(extractFieldByAliases(row, 'duration'));

    if (!isTv) {
      const mKey = tmdbId ? `tmdb:${tmdbId}` : `title:${String(rawTitle || '').trim().toLowerCase()}`;
      if (!movieMap.has(mKey) && (rawTitle || tmdbId)) {
        movieMap.set(mKey, {
          tmdbId,
          imdbId: imdbId ? String(imdbId).trim() : undefined,
          type: 'movie',
          title: rawTitle ? String(rawTitle).trim() : `Filme TMDB #${tmdbId}`,
          originalTitle: extractFieldByAliases(row, 'originalTitle'),
          overview: overview ? String(overview) : '',
          posterPath: posterPath ? String(posterPath) : '',
          backdropPath: backdropPath ? String(backdropPath) : '',
          releaseYear,
          genres,
          voteAverage,
          duration,
          ...(extras ? { extraMetadata: extras } : {})
        } as any);
      }

      if (rawUrl) {
        const cleanUrls = normalizeUrlDedupeMgeb(String(rawOrigUrl || rawUrl));
        const classified = classifySourceUrl(cleanUrls.originalUrl);
        if (classified.valid) {
          dataset.sources.push({
            contentId: tmdbId,
            mediaTitle: rawTitle ? String(rawTitle).trim() : undefined,
            contentType: 'movie',
            url: cleanUrls.url,
            originalUrl: cleanUrls.originalUrl,
            serverName: extractFieldByAliases(row, 'serverName') || classified.suggestedServerName,
            format: extractFieldByAliases(row, 'format') || classified.suggestedFormat,
            quality: extractFieldByAliases(row, 'quality') || '1080p',
            audioLanguage: extractFieldByAliases(row, 'audioLanguage') || 'Português',
            isPrimary: String(extractFieldByAliases(row, 'isPrimary') || '').toLowerCase() !== 'false',
            status: extractFieldByAliases(row, 'status') || 'registered'
          });
        } else {
          dataset.invalidRows++;
          dataset.warnings.push(`URL inválida ignorada (${rawTitle || tmdbId || 'linha'}): ${String(rawUrl).slice(0, 60)}`);
        }
      }
    } else {
      const sKey = tmdbId ? `tmdb:${tmdbId}` : `title:${String(rawTitle || '').trim().toLowerCase()}`;
      let ser = seriesMap.get(sKey);
      if (!ser && (rawTitle || tmdbId)) {
        ser = {
          tmdbId,
          imdbId: imdbId ? String(imdbId).trim() : undefined,
          type: 'tv',
          title: rawTitle ? String(rawTitle).trim() : `Série TMDB #${tmdbId}`,
          originalTitle: extractFieldByAliases(row, 'originalTitle'),
          overview: !hasEpisodeCols && overview ? String(overview) : '',
          posterPath: !hasEpisodeCols && posterPath ? String(posterPath) : '',
          backdropPath: backdropPath ? String(backdropPath) : '',
          releaseYear,
          genres,
          voteAverage,
          seasons: []
        };
        seriesMap.set(sKey, ser);
      }

      const sNum = parseSeasonSafe(sNumRaw, 1);
      const eNum = parseIntSafe(eNumRaw);
      if (ser && eNum !== undefined && eNum >= 1) {
        ser.seasons = ser.seasons || [];
        let targetSeason = ser.seasons.find(sn => Number(sn.seasonNumber) === sNum);
        if (!targetSeason) {
          targetSeason = {
            id: `season-${sNum}`,
            seasonNumber: sNum,
            name: sNum === 0 ? 'Especiais' : `Temporada ${sNum}`,
            episodes: [],
            episodeCount: 0
          };
          ser.seasons.push(targetSeason);
        }
        targetSeason.episodes = targetSeason.episodes || [];
        if (!targetSeason.episodes.some(ep => Number(ep.episodeNumber) === eNum)) {
          targetSeason.episodes.push({
            id: `ep-${tmdbId || 'ext'}-${sNum}-${eNum}`,
            tmdbId,
            seasonNumber: sNum,
            episodeNumber: eNum,
            title: epNameRaw ? String(epNameRaw).trim() : `Episódio ${eNum}`,
            overview: overview ? String(overview) : '',
            stillPath: posterPath ? String(posterPath) : undefined,
            airDate: extractFieldByAliases(row, 'airDate'),
            duration,
            ...(extras ? { extraMetadata: extras } : {})
          });
          targetSeason.episodeCount = Math.max(targetSeason.episodeCount || 0, targetSeason.episodes.length);
        }
      }

      if (rawUrl) {
        const cleanUrls = normalizeUrlDedupeMgeb(String(rawOrigUrl || rawUrl));
        const classified = classifySourceUrl(cleanUrls.originalUrl);
        if (classified.valid) {
          dataset.sources.push({
            contentId: tmdbId,
            mediaTitle: rawTitle ? String(rawTitle).trim() : undefined,
            contentType: 'tv',
            seasonNumber: sNum,
            episodeNumber: eNum || 1,
            episodeTitle: epNameRaw ? String(epNameRaw).trim() : undefined,
            url: cleanUrls.url,
            originalUrl: cleanUrls.originalUrl,
            serverName: extractFieldByAliases(row, 'serverName') || classified.suggestedServerName,
            format: extractFieldByAliases(row, 'format') || classified.suggestedFormat,
            quality: extractFieldByAliases(row, 'quality') || '1080p',
            audioLanguage: extractFieldByAliases(row, 'audioLanguage') || 'Português',
            isPrimary: String(extractFieldByAliases(row, 'isPrimary') || '').toLowerCase() !== 'false',
            status: extractFieldByAliases(row, 'status') || 'registered'
          });
        } else {
          dataset.invalidRows++;
          dataset.warnings.push(`URL inválida ignorada (T${sNum}:E${eNum ?? 1}): ${String(rawUrl).slice(0, 60)}`);
        }
      }
    }
  }

  dataset.movies = Array.from(movieMap.values());
  dataset.series = Array.from(seriesMap.values());
}

function ingestJsonStructure(jsonData: any, dataset: ParsedBackupDataset) {
  if (!jsonData) return;
  const root = jsonData.payload && typeof jsonData.payload === 'object' ? jsonData.payload : jsonData;

  if (Array.isArray(root)) {
    // Array could be media items or tabular flat records
    const first = root[0] || {};
    if ('seasons' in first || ('type' in first && ('genres' in first || 'posterPath' in first))) {
      for (const item of root) {
        if (!item) continue;
        const normType = String(item.type || 'movie').toLowerCase();
        if (normType === 'tv' || normType === 'series' || Array.isArray(item.seasons)) {
          dataset.series.push({ ...item, type: 'tv' });
        } else {
          dataset.movies.push({ ...item, type: 'movie' });
        }
      }
    } else {
      ingestTabularRows(root, dataset);
    }
    return;
  }

  if (typeof root !== 'object') {
    throw new Error('Estrutura JSON inválida: esperado objeto ou lista de itens.');
  }

  // Handle canonical normalized JSON (movies, series, seasons, episodes, videoSources) AND legacy store snapshot (media, playerSources)
  const movieByKey = new Map<string, Partial<MediaItem>>();
  const seriesByKey = new Map<string, Partial<MediaItem>>();

  if (Array.isArray(root.media || root.catalog)) {
    for (const item of root.media || root.catalog) {
      if (!item || !item.title) continue;
      const normType = String(item.type || 'movie').toLowerCase();
      if (normType === 'tv' || normType === 'series') {
        const key = item.tmdbId ? `tmdb:${item.tmdbId}` : `id:${item.id || item.title}`;
        seriesByKey.set(key, { ...item, type: 'tv', seasons: Array.isArray(item.seasons) ? [...item.seasons] : [] });
      } else {
        const key = item.tmdbId ? `tmdb:${item.tmdbId}` : `id:${item.id || item.title}`;
        movieByKey.set(key, { ...item, type: 'movie' });
      }
    }
  }

  if (Array.isArray(root.movies)) {
    for (const m of root.movies) {
      if (!m || (!m.title && !m.tmdbId)) continue;
      const key = m.tmdbId ? `tmdb:${m.tmdbId}` : `id:${m.id || m.title}`;
      movieByKey.set(key, { ...m, type: 'movie' });
    }
  }

  if (Array.isArray(root.series)) {
    for (const s of root.series) {
      if (!s || (!s.title && !s.tmdbId)) continue;
      const key = s.tmdbId ? `tmdb:${s.tmdbId}` : `id:${s.id || s.title}`;
      seriesByKey.set(key, { ...s, type: 'tv', seasons: Array.isArray(s.seasons) ? [...s.seasons] : [] });
    }
  }

  const findSeriesEntry = (tmdbId?: number, seriesId?: string, seriesTitle?: string): Partial<MediaItem> | undefined => {
    if (tmdbId && seriesByKey.has(`tmdb:${tmdbId}`)) return seriesByKey.get(`tmdb:${tmdbId}`);
    if (seriesId && seriesByKey.has(`id:${seriesId}`)) return seriesByKey.get(`id:${seriesId}`);
    for (const val of seriesByKey.values()) {
      if (tmdbId && Number(val.tmdbId) === Number(tmdbId)) return val;
      if (seriesId && val.id === seriesId) return val;
      if (seriesTitle && val.title?.toLowerCase() === seriesTitle.toLowerCase()) return val;
    }
    return undefined;
  };

  if (Array.isArray(root.seasons)) {
    for (const sn of root.seasons) {
      const tmdbId = parseIntSafe(sn.tmdbId);
      let ser = findSeriesEntry(tmdbId, sn.seriesId, sn.seriesTitle);
      if (!ser && (tmdbId || sn.seriesTitle)) {
        ser = {
          tmdbId,
          id: sn.seriesId,
          title: sn.seriesTitle || `Série TMDB #${tmdbId}`,
          type: 'tv',
          overview: '',
          seasons: []
        };
        seriesByKey.set(tmdbId ? `tmdb:${tmdbId}` : `id:${sn.seriesId || ser.title}`, ser);
      }
      if (ser) {
        const sNum = parseSeasonSafe(sn.seasonNumber, 1);
        ser.seasons = ser.seasons || [];
        if (!ser.seasons.some(existing => Number(existing.seasonNumber) === sNum)) {
          ser.seasons.push({
            id: sn.id || `season-${sNum}`,
            seasonNumber: sNum,
            name: sn.name || (sNum === 0 ? 'Especiais' : `Temporada ${sNum}`),
            overview: sn.overview || '',
            posterPath: sn.posterPath || '',
            episodeCount: Number(sn.episodeCount || 0),
            episodes: Array.isArray(sn.episodes) ? sn.episodes : []
          });
        }
      }
    }
  }

  if (Array.isArray(root.episodes)) {
    for (const ep of root.episodes) {
      const tmdbId = parseIntSafe(ep.tmdbId);
      let ser = findSeriesEntry(tmdbId, ep.seriesId, ep.seriesTitle);
      if (!ser && (tmdbId || ep.seriesTitle)) {
        ser = {
          tmdbId,
          id: ep.seriesId,
          title: ep.seriesTitle || `Série TMDB #${tmdbId}`,
          type: 'tv',
          overview: '',
          seasons: []
        };
        seriesByKey.set(tmdbId ? `tmdb:${tmdbId}` : `id:${ep.seriesId || ser.title}`, ser);
      }
      if (ser) {
        const sNum = parseSeasonSafe(ep.seasonNumber, 1);
        const eNum = Math.max(1, Number(ep.episodeNumber || 1));
        ser.seasons = ser.seasons || [];
        let targetSeason = ser.seasons.find(sn => Number(sn.seasonNumber) === sNum);
        if (!targetSeason) {
          targetSeason = {
            id: `season-${sNum}`,
            seasonNumber: sNum,
            name: sNum === 0 ? 'Especiais' : `Temporada ${sNum}`,
            episodes: [],
            episodeCount: 0
          };
          ser.seasons.push(targetSeason);
        }
        targetSeason.episodes = targetSeason.episodes || [];
        if (!targetSeason.episodes.some(ex => Number(ex.episodeNumber) === eNum)) {
          targetSeason.episodes.push({
            ...ep,
            tmdbId: tmdbId ?? ep.tmdbId,
            seasonNumber: sNum,
            episodeNumber: eNum,
            title: ep.title || `Episódio ${eNum}`
          });
          targetSeason.episodeCount = Math.max(Number(targetSeason.episodeCount || 0), targetSeason.episodes.length);
        }
      }
    }
  }

  dataset.movies.push(...Array.from(movieByKey.values()));
  dataset.series.push(...Array.from(seriesByKey.values()));

  const combinedRawSources = [
    ...(Array.isArray(root.videoSources) ? root.videoSources : []),
    ...(Array.isArray(root.video_sources) ? root.video_sources : []),
    ...(Array.isArray(root.playerSources) ? root.playerSources : []),
    ...(Array.isArray(root.sources) ? root.sources : [])
  ];

  const seenJsonSources = new Set<string>(
    dataset.sources.map(
      src =>
        `${src.contentId ?? ''}:${src.contentType}:${src.seasonNumber ?? ''}:${src.episodeNumber ?? ''}:${src.originalUrl || src.url}`
    )
  );

  for (const s of combinedRawSources) {
    if (!s || !s.url) continue;
    const rawType = String(s.contentType || s.type || 'movie').toLowerCase();
    const normType: 'movie' | 'tv' = rawType === 'tv' || rawType === 'series' ? 'tv' : 'movie';
    const cleanUrls = normalizeUrlDedupeMgeb(s.originalUrl || s.url);
    const classified = classifySourceUrl(cleanUrls.originalUrl);
    if (!classified.valid) {
      dataset.invalidRows++;
      continue;
    }
    const contentId = parseIntSafe(s.tmdbId ?? s.contentId);
    const seasonNumber = normType === 'tv' ? parseSeasonSafe(s.seasonNumber ?? s.season, 1) : undefined;
    const episodeNumber = normType === 'tv' ? Math.max(1, Number(s.episodeNumber ?? s.episode ?? 1)) : undefined;
    const dedupeKey = `${contentId ?? ''}:${normType}:${seasonNumber ?? ''}:${episodeNumber ?? ''}:${cleanUrls.originalUrl}`;
    if (seenJsonSources.has(dedupeKey)) continue;
    seenJsonSources.add(dedupeKey);

    dataset.sources.push({
      contentId,
      contentType: normType,
      seasonNumber,
      episodeNumber,
      url: cleanUrls.url,
      originalUrl: cleanUrls.originalUrl,
      serverName: s.serverName || s.provider || s.providerName || classified.suggestedServerName,
      format: s.format || classified.suggestedFormat,
      quality: s.quality || '1080p',
      audioLanguage: s.audioLanguage || 'Português',
      isPrimary: s.isPrimary !== undefined ? Boolean(s.isPrimary) : true,
      priority: typeof s.priority === 'number' ? s.priority : 1,
      enabled: s.enabled !== undefined ? Boolean(s.enabled) : true,
      status: s.status || 'registered'
    });
  }

  if (root.settings && typeof root.settings === 'object') {
    dataset.settings = root.settings;
    dataset.detectedMode = 'full';
  }
  if (root.plansConfig && typeof root.plansConfig === 'object') {
    dataset.plansConfig = root.plansConfig;
    dataset.detectedMode = 'full';
  }
  if (root.apiGlobalSettings && typeof root.apiGlobalSettings === 'object') {
    dataset.apiGlobalSettings = root.apiGlobalSettings;
    dataset.detectedMode = 'full';
  }
  if (root.seasonSourceTemplates && typeof root.seasonSourceTemplates === 'object') {
    dataset.seasonSourceTemplates = root.seasonSourceTemplates;
  }
}

function detectFileFormatAndValidateMagicBytes(buffer: Buffer, filename: string, mimeType?: string): BackupFormat {
  if (!buffer || buffer.length === 0) {
    throw new Error('O ficheiro enviado está vazio.');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Ficheiro excede o limite máximo permitido (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB).`);
  }

  const ext = path.extname(filename || '').toLowerCase();
  const isZipMagic =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06));

  // Block known executable / dangerous magic headers immediately (PE/MZ, ELF, Mach-O, PDF)
  if (
    (buffer[0] === 0x4d && buffer[1] === 0x5a) || // MZ (.exe/.dll)
    (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) || // ELF
    (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) // PDF
  ) {
    throw new Error('Ficheiro executável ou formato não suportado bloqueado por segurança.');
  }

  const snippet = buffer.subarray(0, 2048).toString('utf-8').toLowerCase();
  if (snippet.includes('<!doctype html') || snippet.includes('<html') || snippet.includes('<head')) {
    if (
      snippet.includes('login') ||
      snippet.includes('erro') ||
      snippet.includes('unauthorized') ||
      snippet.includes('401') ||
      snippet.includes('403') ||
      snippet.includes('token') ||
      snippet.includes('session') ||
      snippet.includes('auth') ||
      snippet.includes('não autorizado') ||
      snippet.includes('faça login')
    ) {
      throw new Error('Este arquivo não é um backup válido. Parece ser uma página de erro ou autenticação. Gere novamente o backup.');
    }
    if (snippet.includes('<table')) {
      return 'csv'; // Ingest table rows via CSV parser
    }
    throw new Error('Este arquivo é uma página HTML sem dados de catálogo válidos. Utilize um backup .zip ou .json válido.');
  }

  if (ext === '.zip' || mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
    if (!isZipMagic) {
      throw new Error('Assinatura ZIP inválida ou ficheiro ZIP corrompido. Envie um arquivo .zip autêntico.');
    }
    return 'zip';
  }

  if (
    ext === '.xlsx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    if (!isZipMagic) {
      throw new Error('Assinatura XLSX inválida ou folha Excel corrompida. Envie um ficheiro .xlsx válido.');
    }
    return 'xlsx';
  }

  if (ext === '.json' || mimeType === 'application/json') {
    if (isZipMagic) throw new Error('O ficheiro tem extensão .json mas contém conteúdo binário ZIP.');
    return 'json';
  }

  if (ext === '.csv' || mimeType === 'text/csv' || ext === '.html' || ext === '.htm') {
    if (isZipMagic || buffer.includes(0x00)) {
      throw new Error('O ficheiro contém dados binários inválidos ou está corrompido.');
    }
    return 'csv';
  }

  // Fallback inspection by content when extension is unrecognized or missing
  if (isZipMagic) return 'zip';
  const headText = buffer.subarray(0, 64).toString('utf-8').trim();
  if (headText.startsWith('{') || headText.startsWith('[')) return 'json';
  if (!buffer.includes(0x00) && (headText.includes(',') || headText.includes(';') || headText.includes('\t'))) return 'csv';

  throw new Error(`Formato não suportado (${ext || 'desconhecido'}). Utilize .zip, .json, .csv ou .xlsx.`);
}

// --- ANALYZE BACKUP FILE BEFORE IMPORT ---
export async function analyzeBackupUpload(
  buffer: Buffer,
  originalName: string,
  mimeType?: string
): Promise<BackupImportPreview> {
  const format = detectFileFormatAndValidateMagicBytes(buffer, originalName, mimeType);
  const uploadToken = `upl_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

  const dataset: ParsedBackupDataset = {
    uploadToken,
    filename: originalName || `backup.${format}`,
    detectedFormat: format,
    detectedMode: 'catalog',
    sizeBytes: buffer.length,
    createdAt: Date.now(),
    movies: [],
    series: [],
    sources: [],
    detectedColumns: [],
    warnings: [],
    errors: [],
    invalidRows: 0
  };

  if (format === 'zip') {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    } catch (err: any) {
      throw new Error(`Arquivo ZIP corrompido ou inválido: ${err?.message || 'falha na descompressão'}`);
    }

    let totalUncompressed = 0;
    const entries = Object.values(zip.files);
    if (entries.length === 0) {
      throw new Error('O arquivo ZIP está vazio.');
    }

    const combinedJson: Record<string, any> = {};

    for (const entry of entries) {
      sanitizeZipEntryName(entry.name);
      if (entry.dir) continue;

      const compressedSize = Number((entry as any)._data?.compressedSize || 1);
      const declaredUncompressed = Number((entry as any)._data?.uncompressedSize || 0);
      if (declaredUncompressed > MAX_ZIP_ENTRY_BYTES) {
        throw new Error(`ZIP Bomb bloqueado: entrada "${entry.name}" excede o limite de 150MB descomprimido.`);
      }
      if (declaredUncompressed > 10 * 1024 * 1024 && compressedSize > 0 && declaredUncompressed / compressedSize > MAX_ZIP_RATIO) {
        throw new Error(`ZIP Bomb bloqueado: rácio de compressão anómalo em "${entry.name}".`);
      }

      const contentBuf = await entry.async('nodebuffer');
      if (contentBuf.length > MAX_ZIP_ENTRY_BYTES) {
        throw new Error(`ZIP Bomb bloqueado: "${entry.name}" descomprimiu para além do limite de segurança.`);
      }
      totalUncompressed += contentBuf.length;
      if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) {
        throw new Error('ZIP Bomb bloqueado: tamanho total descomprimido excede 300MB.');
      }

      const lowerName = entry.name.toLowerCase();
      if (lowerName.endsWith('.json')) {
        let parsed: any;
        try {
          parsed = JSON.parse(contentBuf.toString('utf-8'));
        } catch {
          throw new Error(`JSON inválido dentro do ZIP em "${entry.name}".`);
        }
        const base = path.basename(lowerName);
        if (base === 'manifest.json') {
          if (parsed?.mode === 'full') dataset.detectedMode = 'full';
        } else if (base === 'movies.json' && Array.isArray(parsed)) {
          combinedJson.movies = [...(combinedJson.movies || []), ...parsed];
        } else if (base === 'series.json' && Array.isArray(parsed)) {
          combinedJson.series = [...(combinedJson.series || []), ...parsed];
        } else if (base === 'seasons.json' && Array.isArray(parsed)) {
          combinedJson.seasons = [...(combinedJson.seasons || []), ...parsed];
        } else if (base === 'episodes.json' && Array.isArray(parsed)) {
          combinedJson.episodes = [...(combinedJson.episodes || []), ...parsed];
        } else if ((base === 'video_sources.json' || base === 'sources.json') && Array.isArray(parsed)) {
          combinedJson.videoSources = [...(combinedJson.videoSources || []), ...parsed];
        } else if (base === 'metadata.json' && parsed && typeof parsed === 'object') {
          if (parsed.settings) combinedJson.settings = parsed.settings;
          if (parsed.plansConfig) combinedJson.plansConfig = parsed.plansConfig;
          if (parsed.apiGlobalSettings) combinedJson.apiGlobalSettings = parsed.apiGlobalSettings;
          if (parsed.seasonSourceTemplates) combinedJson.seasonSourceTemplates = parsed.seasonSourceTemplates;
        } else {
          ingestJsonStructure(parsed, dataset);
        }
      } else if (lowerName.endsWith('.csv')) {
        const parsedCsv = parseCsvText(contentBuf.toString('utf-8'));
        dataset.detectedColumns.push(...parsedCsv.headers);
        ingestTabularRows(parsedCsv.rows, dataset);
      }
    }

    if (Object.keys(combinedJson).length > 0) {
      ingestJsonStructure(combinedJson, dataset);
    }
  } else if (format === 'json') {
    let parsed: any;
    try {
      parsed = JSON.parse(buffer.toString('utf-8'));
    } catch {
      throw new Error('Ficheiro JSON malformado ou corrompido.');
    }
    ingestJsonStructure(parsed, dataset);
  } else if (format === 'csv') {
    const parsedCsv = parseCsvText(buffer.toString('utf-8'));
    if (parsedCsv.headers.length === 0 || parsedCsv.rows.length === 0) {
      throw new Error('O ficheiro CSV não contém cabeçalhos ou linhas de dados válidas.');
    }
    dataset.detectedColumns = parsedCsv.headers;
    ingestTabularRows(parsedCsv.rows, dataset);
  } else if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch (err: any) {
      throw new Error(`Não foi possível abrir o ficheiro XLSX: ${err?.message || 'estrutura inválida'}`);
    }

    const moviesFromSheets: Record<string, any>[] = [];
    const seriesFromSheets: Record<string, any>[] = [];
    const episodesFromSheets: Record<string, any>[] = [];
    const sourcesFromSheets: Record<string, any>[] = [];
    const genericRows: Record<string, any>[] = [];

    wb.eachSheet(ws => {
      const sheetName = (ws.name || '').toLowerCase();
      if (sheetName === 'manifesto') return;

      const headers: string[] = [];
      const sheetRows: Record<string, any>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell, colNumber) => {
            headers[colNumber] = String(cell.value ?? '').trim();
          });
          dataset.detectedColumns.push(...headers.filter(Boolean));
          return;
        }
        const obj: Record<string, any> = {};
        let hasVal = false;
        row.eachCell((cell, colNumber) => {
          const hdr = headers[colNumber];
          if (!hdr) return;
          let val: any = cell.value;
          if (val && typeof val === 'object' && 'text' in val) val = (val as any).text;
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            obj[hdr] = val;
            hasVal = true;
          }
        });
        if (hasVal) sheetRows.push(obj);
      });

      if (sheetName === 'filmes' || sheetName === 'movies') {
        for (const r of sheetRows) moviesFromSheets.push({ ...r, type: r.type || 'movie' });
      } else if (sheetName === 'series' || sheetName === 'séries') {
        for (const r of sheetRows) seriesFromSheets.push({ ...r, type: r.type || 'tv' });
      } else if (sheetName === 'episodios' || sheetName === 'episódios' || sheetName === 'episodes') {
        for (const r of sheetRows) episodesFromSheets.push({ ...r, type: 'tv' });
      } else if (sheetName.includes('fontes') || sheetName.includes('links') || sheetName.includes('sources')) {
        sourcesFromSheets.push(...sheetRows);
      } else if (sheetName === 'configuracoes' || sheetName === 'configurações') {
        for (const r of sheetRows) {
          try {
            if (r.Secao === 'settings' && r.Dados_JSON) dataset.settings = JSON.parse(r.Dados_JSON);
            if (r.Secao === 'apiGlobalSettings' && r.Dados_JSON) dataset.apiGlobalSettings = JSON.parse(r.Dados_JSON);
            if (r.Secao === 'plansConfig' && r.Dados_JSON) dataset.plansConfig = JSON.parse(r.Dados_JSON);
          } catch {}
        }
        dataset.detectedMode = 'full';
      } else {
        genericRows.push(...sheetRows);
      }
    });

    if (moviesFromSheets.length > 0) ingestTabularRows(moviesFromSheets, dataset);
    if (seriesFromSheets.length > 0) ingestTabularRows(seriesFromSheets, dataset);
    if (episodesFromSheets.length > 0) ingestTabularRows(episodesFromSheets, dataset);
    if (sourcesFromSheets.length > 0) ingestTabularRows(sourcesFromSheets, dataset);
    if (genericRows.length > 0) ingestTabularRows(genericRows, dataset);
  }

  dataset.detectedColumns = Array.from(new Set(dataset.detectedColumns.filter(Boolean)));

  if (dataset.movies.length === 0 && dataset.series.length === 0 && dataset.sources.length === 0) {
    throw new Error('Nenhum filme, série, episódio ou link válido foi encontrado neste ficheiro.');
  }

  // Prune old upload tokens (> 30 min)
  const now = Date.now();
  for (const [k, v] of parsedUploadCache.entries()) {
    if (now - v.createdAt > 30 * 60 * 1000) parsedUploadCache.delete(k);
  }
  parsedUploadCache.set(uploadToken, dataset);

  // Build preview comparison against current DB
  let seasonsTotal = 0;
  let episodesTotal = 0;
  let newMovies = 0;
  let existingMovies = 0;
  let newSeries = 0;
  let existingSeries = 0;

  const sampleItems: BackupImportPreview['sampleItems'] = [];

  for (const m of dataset.movies) {
    const exists = m.tmdbId ? Boolean(db.getMediaByTmdbAndType(Number(m.tmdbId), 'movie')) : false;
    if (exists) existingMovies++;
    else newMovies++;

    if (sampleItems.length < 15) {
      const linksCount = dataset.sources.filter(
        s => s.contentType === 'movie' && ((m.tmdbId && s.contentId === Number(m.tmdbId)) || s.mediaTitle === m.title)
      ).length;
      sampleItems.push({
        type: 'movie',
        tmdbId: m.tmdbId,
        title: m.title || 'Sem título',
        linksCount,
        existsInCatalog: exists
      });
    }
  }

  for (const ser of dataset.series) {
    const exists = ser.tmdbId ? Boolean(db.getMediaByTmdbAndType(Number(ser.tmdbId), 'tv')) : false;
    if (exists) existingSeries++;
    else newSeries++;

    const snArr = Array.isArray(ser.seasons) ? ser.seasons : [];
    seasonsTotal += snArr.length;
    for (const sn of snArr) {
      episodesTotal += Array.isArray(sn.episodes) ? sn.episodes.length : Number(sn.episodeCount || 0);
    }

    if (sampleItems.length < 20) {
      const linksCount = dataset.sources.filter(
        s => s.contentType === 'tv' && ((ser.tmdbId && s.contentId === Number(ser.tmdbId)) || s.mediaTitle === ser.title)
      ).length;
      sampleItems.push({
        type: 'tv',
        tmdbId: ser.tmdbId,
        title: ser.title || 'Sem título',
        linksCount,
        existsInCatalog: exists
      });
    }
  }

  let newSources = 0;
  let duplicateSources = 0;
  for (const src of dataset.sources) {
    if (src.contentId) {
      const dup = db.findDuplicateVideoSource({
        contentId: src.contentId,
        contentType: src.contentType,
        url: src.originalUrl || src.url,
        seasonNumber: src.seasonNumber,
        episodeNumber: src.episodeNumber
      });
      if (dup) duplicateSources++;
      else newSources++;
    } else {
      newSources++;
    }
  }

  return {
    uploadToken,
    filename: dataset.filename,
    detectedFormat: dataset.detectedFormat,
    detectedMode: dataset.detectedMode,
    sizeBytes: dataset.sizeBytes,
    summary: {
      moviesTotal: dataset.movies.length,
      seriesTotal: dataset.series.length,
      seasonsTotal,
      episodesTotal,
      sourcesTotal: dataset.sources.length,
      newMovies,
      existingMovies,
      newSeries,
      existingSeries,
      newSources,
      duplicateSources,
      invalidRows: dataset.invalidRows
    },
    detectedColumns: dataset.detectedColumns,
    warnings: dataset.warnings.slice(0, 20),
    errors: dataset.errors.slice(0, 20),
    sampleItems
  };
}

// --- ASYNC BATCHED IMPORT EXECUTION WITH AUTOMATIC ROLLBACK SNAPSHOT ---
async function executeImportRuntime(runtime: ActiveImportRuntime, adminEmail: string) {
  const { job, dataset } = runtime;
  runtime.running = true;
  job.status = 'RUNNING';
  db.saveBackupImportJob({ ...job });

  try {
    const includeMovies = job.filter === 'all' || job.filter === 'movies';
    const includeSeries = job.filter === 'all' || job.filter === 'series';

    const targetMovies = includeMovies ? dataset.movies : [];
    const targetSeries = includeSeries ? dataset.series : [];
    const targetSources = dataset.sources.filter(s =>
      s.contentType === 'movie' ? includeMovies : includeSeries
    );

    const ops: Array<{ kind: 'movie' | 'series' | 'source'; data: any }> = [
      ...targetMovies.map(d => ({ kind: 'movie' as const, data: d })),
      ...targetSeries.map(d => ({ kind: 'series' as const, data: d })),
      ...targetSources.map(d => ({ kind: 'source' as const, data: d }))
    ];
    job.totalOperations = ops.length;

    // Resolve tmdbIds by title if missing in flat CSV
    const titleToTmdb = new Map<string, number>();
    for (const item of db.getAllMedia()) {
      if (item.tmdbId && item.title && !item.deletedAt) {
        titleToTmdb.set(`${item.type === 'tv' || item.type === 'series' ? 'tv' : 'movie'}:${item.title.toLowerCase()}`, Number(item.tmdbId));
      }
    }

    const CHUNK = 40;
    for (let i = runtime.cursor; i < ops.length; i++) {
      if (runtime.cancelled) {
        job.status = 'CANCELLED';
        job.currentStep = 'Operação cancelada pelo administrador.';
        job.completedAt = new Date().toISOString();
        db.flushSave();
        db.saveBackupImportJob({ ...job });
        runtime.running = false;
        return;
      }

      const op = ops[i];
      runtime.cursor = i + 1;
      job.processedOperations = i + 1;

      try {
        if (op.kind === 'movie') {
          const m: Partial<MediaItem> = op.data;
          const existing = m.tmdbId ? db.getMediaByTmdbAndType(Number(m.tmdbId), 'movie') : undefined;
          if (existing && job.conflictMode === 'skip') {
            job.skippedCount++;
          } else {
            const safePayload: Partial<MediaItem> =
              existing && job.conflictMode !== 'overwrite'
                ? {
                    ...existing,
                    tmdbId: existing.tmdbId || m.tmdbId,
                    imdbId: existing.imdbId || m.imdbId,
                    title: existing.title || m.title || 'Sem título',
                    originalTitle: existing.originalTitle || m.originalTitle,
                    overview: existing.overview || m.overview || '',
                    posterPath: existing.posterPath || m.posterPath || '',
                    backdropPath: existing.backdropPath || m.backdropPath || '',
                    releaseYear: existing.releaseYear || m.releaseYear,
                    genres: existing.genres && existing.genres.length > 0 ? existing.genres : m.genres,
                    voteAverage: existing.voteAverage || m.voteAverage,
                    duration: existing.duration || m.duration
                  }
                : { ...m, type: 'movie' };

            const res = db.upsertMediaItem({ ...safePayload, type: 'movie' });
            if (res.isNew) job.importedMovies++;
            else job.updatedMovies++;
            if (res.item.tmdbId && res.item.title) {
              titleToTmdb.set(`movie:${res.item.title.toLowerCase()}`, Number(res.item.tmdbId));
            }
          }
          job.currentStep = `Filme: ${m.title || m.tmdbId}`;
        } else if (op.kind === 'series') {
          const s: Partial<MediaItem> = op.data;
          const existing = s.tmdbId ? db.getMediaByTmdbAndType(Number(s.tmdbId), 'tv') : undefined;
          if (existing && job.conflictMode === 'skip') {
            job.skippedCount++;
          } else {
            const safePayload: Partial<MediaItem> =
              existing && job.conflictMode !== 'overwrite'
                ? {
                    ...existing,
                    tmdbId: existing.tmdbId || s.tmdbId,
                    imdbId: existing.imdbId || s.imdbId,
                    title: existing.title || s.title || 'Sem título',
                    originalTitle: existing.originalTitle || s.originalTitle,
                    overview: existing.overview || s.overview || '',
                    posterPath: existing.posterPath || s.posterPath || '',
                    backdropPath: existing.backdropPath || s.backdropPath || '',
                    releaseYear: existing.releaseYear || s.releaseYear,
                    genres: existing.genres && existing.genres.length > 0 ? existing.genres : s.genres,
                    seasons: s.seasons
                  }
                : { ...s, type: 'tv' };

            const res = db.upsertMediaItem({ ...safePayload, type: 'tv' });
            if (res.isNew) job.importedSeries++;
            else job.updatedSeries++;
            for (const sn of s.seasons || []) {
              job.importedEpisodes += (sn.episodes || []).length;
            }
            if (res.item.tmdbId && res.item.title) {
              titleToTmdb.set(`tv:${res.item.title.toLowerCase()}`, Number(res.item.tmdbId));
            }
          }
          job.currentStep = `Série: ${s.title || s.tmdbId}`;
        } else if (op.kind === 'source') {
          const src: NormalizedSourceEntry = op.data;
          const resolvedContentId =
            src.contentId ||
            (src.mediaTitle ? titleToTmdb.get(`${src.contentType}:${src.mediaTitle.toLowerCase()}`) : undefined);

          if (!resolvedContentId) {
            job.errorCount++;
            if (job.recentErrors.length < 30) {
              job.recentErrors.push(`Fonte sem TMDB ID identificado (${src.mediaTitle || src.url})`);
            }
          } else {
            const sNum = src.contentType === 'tv' ? parseSeasonSafe(src.seasonNumber, 1) : undefined;
            const eNum = src.contentType === 'tv' ? Math.max(1, Number(src.episodeNumber || 1)) : undefined;

            const exactDup = db.findDuplicateVideoSource({
              contentId: resolvedContentId,
              contentType: src.contentType,
              url: src.originalUrl || src.url,
              seasonNumber: sNum,
              episodeNumber: eNum
            });

            if (exactDup) {
              // Never duplicate identical links
              job.skippedCount++;
            } else {
              const existingAny = await db.getVideoSources({
                contentId: resolvedContentId,
                contentType: src.contentType,
                seasonNumber: sNum,
                episodeNumber: eNum
              });

              if (
                existingAny.length > 0 &&
                (job.conflictMode === 'skip' || job.conflictMode === 'update_metadata_keep_links')
              ) {
                job.skippedCount++;
              } else {
                if (existingAny.length > 0 && job.conflictMode === 'overwrite') {
                  for (const old of existingAny) {
                    await db.deleteVideoSource(old.id, { skipSave: true });
                  }
                }
                await db.addVideoSource(
                  {
                    contentId: resolvedContentId,
                    contentType: src.contentType,
                    seasonNumber: sNum,
                    episodeNumber: eNum,
                    serverName: src.serverName || 'Servidor',
                    url: src.url,
                    originalUrl: src.originalUrl || src.url,
                    format: (src.format || 'auto') as any,
                    quality: src.quality || '1080p',
                    audioLanguage: src.audioLanguage || 'Português',
                    isPrimary: existingAny.length === 0 || job.conflictMode === 'overwrite' ? src.isPrimary !== false : false,
                    priority: typeof src.priority === 'number' ? src.priority : existingAny.length + 1,
                    enabled: src.enabled !== false,
                    status: (src.status || 'registered') as any
                  },
                  { skipSave: true }
                );
                job.importedSources++;
              }
            }
          }
          job.currentStep = `Fonte: ${src.contentType === 'tv' ? `T${src.seasonNumber}:E${src.episodeNumber}` : 'Filme'} #${resolvedContentId || '?'}`;
        }
      } catch (rowErr: any) {
        job.errorCount++;
        if (job.recentErrors.length < 30) {
          job.recentErrors.push(rowErr?.message || 'Erro inesperado ao processar linha.');
        }
      }

      if ((i + 1) % CHUNK === 0) {
        db.flushSave();
        db.saveBackupImportJob({ ...job });
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }

    // Apply safe global configs ONLY if importing full all-content and non-skip
    if (job.filter === 'all' && job.conflictMode !== 'skip') {
      if (dataset.settings && typeof dataset.settings === 'object') {
        db.updateSettings(dataset.settings);
      }
      if (dataset.seasonSourceTemplates && typeof dataset.seasonSourceTemplates === 'object') {
        for (const tpl of Object.values(dataset.seasonSourceTemplates)) {
          if (tpl && tpl.contentId && tpl.baseUrl) {
            db.saveSeasonSourceTemplate(tpl);
          }
        }
      }
    }

    job.status = 'COMPLETED';
    job.currentStep = 'Importação concluída com sucesso.';
    job.completedAt = new Date().toISOString();
    db.flushSave();
    db.updateBackupConfig({ lastImportAt: job.completedAt });
    db.saveBackupImportJob({ ...job });
    db.addAuditLog(
      adminEmail,
      'BACKUP_IMPORT',
      'SUCCESS',
      `${dataset.filename}: +${job.importedMovies} filmes, +${job.importedSeries} séries, +${job.importedSources} links (${job.skippedCount} preservados/ignorados).`
    );
  } catch (err: any) {
    job.status = 'ERROR';
    job.currentStep = `Erro crítico: ${err?.message || 'falha na importação'}`;
    job.recentErrors.unshift(job.currentStep);
    job.completedAt = new Date().toISOString();
    db.saveBackupImportJob({ ...job });
    db.addAuditLog(adminEmail, 'BACKUP_IMPORT', 'FAILED', job.currentStep);
  } finally {
    runtime.running = false;
  }
}

export async function startBackupImportJob(params: {
  uploadToken: string;
  filter: BackupImportFilter;
  conflictMode: BackupConflictMode;
  adminEmail: string;
}): Promise<BackupImportJob> {
  const dataset = parsedUploadCache.get(params.uploadToken);
  if (!dataset) {
    throw new Error('Sessão de análise expirada ou inválida. Selecione o ficheiro novamente para pré-visualizar.');
  }

  // Create automatic safety rollback snapshot before touching catalog!
  const rollbackSnapshot = await createBackupArchive(
    'full',
    'json',
    params.adminEmail,
    'pre_import_rollback'
  );

  const jobId = `impjob_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const job: BackupImportJob = {
    jobId,
    status: 'PENDING',
    filename: dataset.filename,
    format: dataset.detectedFormat,
    filter: params.filter,
    conflictMode: params.conflictMode,
    rollbackBackupId: rollbackSnapshot.id,
    totalOperations: dataset.movies.length + dataset.series.length + dataset.sources.length,
    processedOperations: 0,
    importedMovies: 0,
    updatedMovies: 0,
    importedSeries: 0,
    updatedSeries: 0,
    importedEpisodes: 0,
    importedSources: 0,
    skippedCount: 0,
    errorCount: 0,
    recentErrors: [],
    currentStep: 'Snapshot de rollback criado. A iniciar importação...',
    startedAt: new Date().toISOString(),
    completedAt: null
  };

  const runtime: ActiveImportRuntime = {
    job,
    dataset,
    cursor: 0,
    cancelled: false,
    running: false
  };
  activeImportJobs.set(jobId, runtime);
  db.saveBackupImportJob(job);

  // Kick off asynchronously in background so UI never blocks
  setImmediate(() => {
    executeImportRuntime(runtime, params.adminEmail).catch(() => {});
  });

  return job;
}

export function getImportJobStatus(jobId: string): BackupImportJob | null {
  const runtime = activeImportJobs.get(jobId);
  if (runtime) return runtime.job;
  return db.getBackupImportJobs().find(j => j.jobId === jobId) || null;
}

export function listImportJobs(): BackupImportJob[] {
  const map = new Map<string, BackupImportJob>();
  for (const j of db.getBackupImportJobs()) map.set(j.jobId, j);
  for (const r of activeImportJobs.values()) map.set(r.job.jobId, r.job);
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export function cancelImportJob(jobId: string): BackupImportJob | null {
  const runtime = activeImportJobs.get(jobId);
  if (!runtime) return null;
  runtime.cancelled = true;
  if (!runtime.running && runtime.job.status !== 'COMPLETED') {
    runtime.job.status = 'CANCELLED';
    runtime.job.currentStep = 'Operação cancelada.';
    runtime.job.completedAt = new Date().toISOString();
    db.saveBackupImportJob({ ...runtime.job });
  }
  return runtime.job;
}

export function resumeImportJob(jobId: string, adminEmail: string): BackupImportJob | null {
  const runtime = activeImportJobs.get(jobId);
  if (!runtime) return null;
  if (runtime.running || runtime.job.status === 'COMPLETED') return runtime.job;
  runtime.cancelled = false;
  runtime.job.status = 'RUNNING';
  runtime.job.completedAt = null;
  setImmediate(() => {
    executeImportRuntime(runtime, adminEmail).catch(() => {});
  });
  return runtime.job;
}
