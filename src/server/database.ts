import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  MediaItem,
  PlayerSource,
  StreamSource,
  AppSettings,
  VideoSource,
  User,
  ImportHistoryItem,
  MassImportReport,
  ImportStatus,
  CatalogStats,
  MediaSourceSummary,
  MediaDiagnosticSummary,
  Season,
  PlanTier,
  PlanConfig,
  DeveloperApp,
  ApiKeyRecord,
  PublicApiKey,
  ApiGlobalSettings,
  ApiRequestMetric,
  PlaybackEventLog,
  SeasonSourceTemplate,
  BatchEpisodeSourcesResult
} from '../types.js';
import { adminDb } from './firebaseAdmin.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  verifyPassword,
  generateApiKeyPair,
  hashApiKey,
  normalizeDomainEntry
} from './authService.js';
import { classifySourceUrl } from '../lib/sourceClassification.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'playfilme_store.json');
const BACKUP_FILE = path.join(DATA_DIR, 'playfilme_store.backup.json');

export interface StoreUser extends User {
  passwordHash?: string;
  passwordSalt?: string;
  authProvider?: 'password' | 'google' | 'firebase';
  status?: 'active' | 'suspended';
  lastLogin?: string;
}

interface StoreData {
  media: MediaItem[];
  playerSources: PlayerSource[];
  streamSources: StreamSource[];
  users: StoreUser[];
  settings: AppSettings;
  providerConfig?: { uqloadApiKey?: string; anonmp4ApiKey?: string };
  videoSources?: VideoSource[];
  auditLogs?: any[];
  importHistory?: ImportHistoryItem[];
  massImportReports?: MassImportReport[];
  massImportState?: ImportStatus | null;
  recoveryState?: any;
  recoveryIssues?: any[];
  recoveryReports?: any[];
  developerApps?: DeveloperApp[];
  apiKeys?: ApiKeyRecord[];
  plansConfig?: Record<PlanTier, PlanConfig>;
  apiGlobalSettings?: ApiGlobalSettings;
  apiMonitoring?: ApiRequestMetric[];
  playbackEvents?: PlaybackEventLog[];
  seasonSourceTemplates?: Record<string, SeasonSourceTemplate>;
  backups?: any[];
}

const DEFAULT_PLANS_CONFIG: Record<PlanTier, PlanConfig> = {
  FREE: {
    tier: 'FREE',
    name: 'FREE',
    audience: 'Testes e protótipos iniciais',
    description: 'Ideal para explorar a API, testar metadados do catálogo e validar a primeira integração.',
    requestsPerMinute: 30,
    dailyRequests: 1000,
    maxApps: 2,
    maxAuthorizedDomains: 2,
    maxPlaybackSessionsPerHour: 30,
    allowEmbedPlayer: true,
    allowSourcesEndpoint: true,
    features: [
      '30 requisições / minuto',
      '1.000 requisições / dia',
      'Até 2 aplicações registadas',
      'Até 2 domínios autorizados por app',
      'Embed Player com token temporário'
    ],
    active: true
  },
  DEVELOPER: {
    tier: 'DEVELOPER',
    name: 'DEVELOPER',
    audience: 'Projetos Web e Apps Android',
    description: 'Para desenvolvedores independentes com tráfego recorrente e múltiplos domínios autorizados.',
    requestsPerMinute: 120,
    dailyRequests: 25000,
    maxApps: 5,
    maxAuthorizedDomains: 5,
    maxPlaybackSessionsPerHour: 300,
    allowEmbedPlayer: true,
    allowSourcesEndpoint: true,
    features: [
      '120 requisições / minuto',
      '25.000 requisições / dia',
      'Até 5 aplicações registadas',
      'Até 5 domínios autorizados por app',
      'Acesso completo a fontes e player SDK'
    ],
    active: true
  },
  PRO: {
    tier: 'PRO',
    name: 'PRO',
    audience: 'Plataformas em crescimento',
    description: 'Limites elevados, múltiplas chaves por aplicação e alta disponibilidade para produção.',
    requestsPerMinute: 360,
    dailyRequests: 150000,
    maxApps: 15,
    maxAuthorizedDomains: 15,
    maxPlaybackSessionsPerHour: 2000,
    allowEmbedPlayer: true,
    allowSourcesEndpoint: true,
    features: [
      '360 requisições / minuto',
      '150.000 requisições / dia',
      'Até 15 aplicações registadas',
      'Até 15 domínios autorizados por app',
      'Prioridade de resolução de fontes'
    ],
    active: true
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    name: 'ENTERPRISE',
    audience: 'Operações de grande escala',
    description: 'Configuração dedicada, limites customizáveis pelo administrador e suporte avançado de domínios.',
    requestsPerMinute: 1200,
    dailyRequests: 1000000,
    maxApps: 50,
    maxAuthorizedDomains: 50,
    maxPlaybackSessionsPerHour: 20000,
    allowEmbedPlayer: true,
    allowSourcesEndpoint: true,
    features: [
      '1.200 requisições / minuto',
      '1.000.000 requisições / dia',
      'Até 50 aplicações registadas',
      'Até 50 domínios autorizados por app',
      'Sessões de playback de alta capacidade'
    ],
    active: true
  }
};

const DEFAULT_API_GLOBAL_SETTINGS: ApiGlobalSettings = {
  enabled: true,
  publicLimitedEnabled: true,
  publicRateLimitPerMinute: 40,
  requireKeyForSources: true,
  requireDomainForEmbed: true,
  playbackTokenTtlSeconds: 900,
  disabledEndpoints: []
};

class Database {
  private metricSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private data: StoreData = {
    media: [],
    playerSources: [],
    streamSources: [],
    users: [],
    settings: {
      heroRotationInterval: 30,
      catalogGuardEnabled: true,
      minCatalogThreshold: 5
    },
    importHistory: [],
    massImportReports: [],
    massImportState: null,
    recoveryState: { status: 'IDLE', lastSnapshot: null },
    recoveryIssues: [],
    recoveryReports: [],
    developerApps: [],
    apiKeys: [],
    plansConfig: { ...DEFAULT_PLANS_CONFIG },
    apiGlobalSettings: { ...DEFAULT_API_GLOBAL_SETTINGS },
    apiMonitoring: [],
    playbackEvents: [],
    seasonSourceTemplates: {}
  };

  private mediaIndexByTmdbAndType = new Map<string, MediaItem>();
  private mediaIndexById = new Map<string, MediaItem>();

  constructor() {
    this.init();
  }

  private rebuildFastIndices() {
    this.mediaIndexByTmdbAndType.clear();
    this.mediaIndexById.clear();
    for (const m of this.data.media) {
      if (m.id) this.mediaIndexById.set(m.id, m);
      if (!m.deletedAt && m.tmdbId) {
        const norm = this.normalizeMediaType(m.type);
        this.mediaIndexByTmdbAndType.set(`${Number(m.tmdbId)}_${norm}`, m);
      }
    }
  }

  private applyParsedStore(parsed: any) {
    this.data = {
      media: parsed.media || parsed.catalog || [],
      playerSources: parsed.playerSources || [],
      streamSources: parsed.streamSources || [],
      users: parsed.users || [],
      settings: { ...this.data.settings, ...(parsed.settings || {}) },
      providerConfig: parsed.providerConfig,
      videoSources: parsed.videoSources || [],
      auditLogs: parsed.auditLogs || [],
      importHistory: parsed.importHistory || [],
      massImportReports: parsed.massImportReports || [],
      massImportState: parsed.massImportState || null,
      recoveryState: parsed.recoveryState || { status: 'IDLE', lastSnapshot: null },
      recoveryIssues: parsed.recoveryIssues || [],
      recoveryReports: parsed.recoveryReports || [],
      developerApps: parsed.developerApps || [],
      apiKeys: parsed.apiKeys || [],
      plansConfig: {
        FREE: { ...DEFAULT_PLANS_CONFIG.FREE, ...(parsed.plansConfig?.FREE || {}) },
        DEVELOPER: { ...DEFAULT_PLANS_CONFIG.DEVELOPER, ...(parsed.plansConfig?.DEVELOPER || {}) },
        PRO: { ...DEFAULT_PLANS_CONFIG.PRO, ...(parsed.plansConfig?.PRO || {}) },
        ENTERPRISE: { ...DEFAULT_PLANS_CONFIG.ENTERPRISE, ...(parsed.plansConfig?.ENTERPRISE || {}) }
      },
      apiGlobalSettings: { ...DEFAULT_API_GLOBAL_SETTINGS, ...(parsed.apiGlobalSettings || {}) },
      apiMonitoring: parsed.apiMonitoring || [],
      playbackEvents: parsed.playbackEvents || [],
      seasonSourceTemplates: parsed.seasonSourceTemplates || {},
      backups: parsed.backups || []
    };
    this.rebuildFastIndices();
  }

  private normalizeRecoveredMediaPaths(items: MediaItem[]): MediaItem[] {
    return items.map(m => {
      const normalizeImg = (val?: string, size: 'w500' | 'w1280' = 'w500') => {
        if (!val || typeof val !== 'string') return val;
        const trimmed = val.trim();
        if (!trimmed) return trimmed;
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
        if (trimmed.startsWith('/')) return `https://image.tmdb.org/t/p/${size}${trimmed}`;
        return trimmed;
      };
      return {
        ...m,
        posterPath: normalizeImg(m.posterPath, 'w500') || '',
        backdropPath: normalizeImg(m.backdropPath, 'w1280') || normalizeImg(m.posterPath, 'w500') || ''
      };
    });
  }

  private tryReadBackupStore(): any | null {
    try {
      if (!fs.existsSync(BACKUP_FILE)) return null;
      const raw = fs.readFileSync(BACKUP_FILE, 'utf-8');
      if (!raw || !raw.trim()) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // Clean up stale atomic write temp files if a previous process exited abruptly
      try {
        for (const entry of fs.readdirSync(DATA_DIR)) {
          if (entry.startsWith('playfilme_store.json.tmp.')) {
            fs.unlinkSync(path.join(DATA_DIR, entry));
          }
        }
      } catch {}

      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.applyParsedStore(parsed);

        if (!this.data.playerSources || this.data.playerSources.length === 0) {
          this.seedInitialSources();
          this.save();
        }
      } else {
        const backupParsed = this.tryReadBackupStore();
        if (backupParsed && Array.isArray(backupParsed.media || backupParsed.catalog) && (backupParsed.media || backupParsed.catalog).length > 0) {
          this.applyParsedStore(backupParsed);
          this.data.media = this.normalizeRecoveredMediaPaths(this.data.media);
          if (!this.data.playerSources || this.data.playerSources.length === 0) {
            this.seedInitialSources();
          }
          this.save();
        } else {
          this.seedInitialData();
          this.save();
        }
      }

      this.ensureFounderAccount();
    } catch (err) {
      console.error('Error initializing database store:', err);
      // Preserve corrupted file instead of silently overwriting
      try {
        if (fs.existsSync(STORE_FILE)) {
          const corruptCopy = path.join(DATA_DIR, `playfilme_store.corrupt.${Date.now()}.json`);
          fs.copyFileSync(STORE_FILE, corruptCopy);
          console.warn(`[DB Recovery] Corrupted store archived at ${corruptCopy}`);
        }
      } catch {}

      const backupParsed = this.tryReadBackupStore();
      if (backupParsed && Array.isArray(backupParsed.media || backupParsed.catalog) && (backupParsed.media || backupParsed.catalog).length > 0) {
        this.applyParsedStore(backupParsed);
        this.data.media = this.normalizeRecoveredMediaPaths(this.data.media);
        if (!this.data.playerSources || this.data.playerSources.length === 0) {
          this.seedInitialSources();
        }
        console.info(`[DB Recovery] Restored ${this.data.media.length} catalog items from backup.`);
        this.save();
      } else {
        this.seedInitialData();
        this.save();
      }
      this.ensureFounderAccount();
    }
  }

  private ensureFounderAccount() {
    let founder = this.data.users.find(u => u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    if (!founder) {
      founder = {
        id: 'user-founder',
        name: 'Fundador RONYCINE',
        email: ADMIN_EMAIL,
        role: 'founder',
        status: 'active',
        createdAt: '2026-09-23T13:06:06.729Z',
        lastLogin: new Date().toISOString()
      };
      this.data.users.unshift(founder);
      this.save();
    } else {
      let modified = false;
      if (founder.role !== 'founder') {
        founder.role = 'founder';
        modified = true;
      }
      if (founder.status !== 'active') {
        founder.status = 'active';
        modified = true;
      }
      if (modified) {
        this.save();
      }
    }
  }

  private save() {
    try {
      if (this.metricSaveTimer) {
        clearTimeout(this.metricSaveTimer);
        this.metricSaveTimer = null;
      }
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const serialized = JSON.stringify(this.data, null, 2);
      const tmpFile = `${STORE_FILE}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmpFile, serialized, 'utf-8');
      fs.renameSync(tmpFile, STORE_FILE);
    } catch (err) {
      console.error('Failed to write database file atomically:', err);
    }
  }

  private seedInitialData() {
    this.data.media = [
      {
        id: 'movie-550',
        tmdbId: 550,
        imdbId: 'tt0137523',
        title: 'Clube da Luta',
        originalTitle: 'Fight Club',
        type: 'movie',
        overview: 'Um homem desiludido que sofre de insônia encontra um vendedor de sabão carismático e forma um clube de lutas underground.',
        posterPath: 'https://image.tmdb.org/t/p/w500/pB8BM2pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
        backdropPath: 'https://image.tmdb.org/t/p/original/hZk2L1A33c94P39423.jpg',
        voteAverage: 8.4,
        releaseYear: 1999,
        genres: ['Drama', 'Thriller'],
        duration: 139,
        featured: true
      },
      {
        id: 'tv-1399',
        tmdbId: 1399,
        imdbId: 'tt0944947',
        title: 'Game of Thrones',
        originalTitle: 'Game of Thrones',
        type: 'tv',
        overview: 'Em uma terra onde os verões duram décadas e os invernos uma vida inteira, os problemas estão apenas começando.',
        posterPath: 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnb39393.jpg',
        backdropPath: 'https://image.tmdb.org/t/p/original/su833839393.jpg',
        voteAverage: 8.5,
        releaseYear: 2011,
        numberOfSeasons: 8,
        numberOfEpisodes: 73,
        genres: ['Drama', 'Fantasia', 'Ação'],
        featured: true
      }
    ];

    this.seedInitialSources();
  }

  public seedInitialSources() {
    // Seed sample sources for RONYCINE Player
    this.data.playerSources = [
      {
        id: 'src-550-default',
        tmdbId: 550,
        type: 'movie',
        format: 'm3u8',
        url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        provider: 'Servidor Oficial',
        label: 'Servidor Oficial (HLS)',
        isPrimary: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'src-1399-s1e1',
        tmdbId: 1399,
        type: 'tv',
        season: 1,
        episode: 1,
        format: 'm3u8',
        url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        provider: 'Servidor Oficial',
        label: 'Servidor Principal T1:E1 (HLS)',
        isPrimary: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  private normalizeText(val?: string | null): string {
    return (val || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private normalizeMediaType(type?: string | null): 'movie' | 'tv' {
    const t = (type || 'movie').toLowerCase().trim();
    if (t === 'tv' || t === 'series' || t === 'serie' || t === 'tv_series') return 'tv';
    return 'movie';
  }

  private extractMediaYear(m: MediaItem): number {
    if (m.releaseYear && Number(m.releaseYear) > 1800) return Number(m.releaseYear);
    const d = m.releaseDate || m.firstAirDate || '';
    const y = parseInt(d.substring(0, 4), 10);
    return Number.isNaN(y) ? 0 : y;
  }

  public isMediaPublished(m: MediaItem): boolean {
    if (m.deletedAt) return false;
    if (m.published === false) return false;
    if (m.status === 'INACTIVE' || m.status === 'DRAFT') return false;
    return true;
  }

  private countSeriesSeasonsAndEpisodes(m: MediaItem): { seasonsCount: number; episodesCount: number } {
    const seasonsArr = Array.isArray(m.seasons) ? m.seasons : [];
    const seasonsCount = Math.max(
      Number(m.seasonsCount || 0),
      Number(m.numberOfSeasons || 0),
      seasonsArr.filter(s => s.seasonNumber !== 0).length || seasonsArr.length
    );
    let episodesCount = Math.max(Number(m.episodesCount || 0), Number(m.numberOfEpisodes || 0));
    if (episodesCount === 0 && seasonsArr.length > 0) {
      episodesCount = seasonsArr.reduce((acc, s) => {
        if (Array.isArray(s.episodes) && s.episodes.length > 0) return acc + s.episodes.length;
        return acc + Number(s.episodeCount || 0);
      }, 0);
    }
    return { seasonsCount, episodesCount };
  }

  private getDuplicateTmdbMap(excludeDeleted = true): Map<string, MediaItem[]> {
    const map = new Map<string, MediaItem[]>();
    for (const m of this.data.media) {
      if (excludeDeleted && m.deletedAt) continue;
      if (!m.tmdbId || Number(m.tmdbId) <= 0) continue;
      const key = `${this.normalizeMediaType(m.type)}:${Number(m.tmdbId)}`;
      const arr = map.get(key) || [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }

  public getMediaSourceSummary(item: MediaItem): MediaSourceSummary {
    const normType = this.normalizeMediaType(item.type);
    const tmdbId = Number(item.tmdbId || 0);
    const seenUrls = new Map<string, string>();

    if (tmdbId > 0) {
      for (const p of this.data.playerSources) {
        if (Number(p.tmdbId) === tmdbId && this.normalizeMediaType(p.type) === normType && p.url) {
          seenUrls.set(p.url, (p.status || 'registered').toLowerCase());
        }
      }
      for (const v of this.data.videoSources || []) {
        if (Number(v.contentId) === tmdbId && this.normalizeMediaType(v.contentType) === normType && v.url) {
          seenUrls.set(v.url, (v.status || 'registered').toLowerCase());
        }
      }
    }

    if ((item as any).sourceUrl && !seenUrls.has((item as any).sourceUrl)) {
      seenUrls.set((item as any).sourceUrl, 'registered');
    }
    if ((item as any).videoUrl && !seenUrls.has((item as any).videoUrl)) {
      seenUrls.set((item as any).videoUrl, 'registered');
    }

    let onlineCount = 0;
    let offlineCount = 0;
    let validatingCount = 0;
    let unverifiableCount = 0;
    let unsupportedCount = 0;
    let embedBlockedCount = 0;
    let registeredCount = 0;

    for (const st of seenUrls.values()) {
      if (st === 'online' || st === 'active') onlineCount++;
      else if (st === 'offline' || st === 'inactive') offlineCount++;
      else if (st === 'validating' || st === 'verifying') validatingCount++;
      else if (st === 'unverifiable' || st === 'playback_unverified') unverifiableCount++;
      else if (st === 'unsupported_format' || st === 'incompatible') unsupportedCount++;
      else if (st === 'embed_blocked') embedBlockedCount++;
      else registeredCount++;
    }

    const totalSources = seenUrls.size;
    const hasSource = totalSources > 0;
    let status: MediaSourceSummary['status'] = 'NONE';
    if (hasSource) {
      if (onlineCount > 0) status = 'ONLINE';
      else if (validatingCount > 0) status = 'VALIDATING';
      else if (registeredCount > 0) status = 'REGISTERED';
      else if (unverifiableCount > 0) status = 'UNVERIFIABLE';
      else if (embedBlockedCount > 0) status = 'EMBED_BLOCKED';
      else if (unsupportedCount > 0) status = 'UNSUPPORTED';
      else status = 'OFFLINE';
    }

    return {
      totalSources,
      onlineCount,
      offlineCount,
      validatingCount,
      unverifiableCount,
      unsupportedCount,
      embedBlockedCount,
      registeredCount,
      hasSource,
      status
    };
  }

  public computeMediaDiagnostics(
    item: MediaItem,
    sourceSummary?: MediaSourceSummary,
    dupMap?: Map<string, MediaItem[]>
  ): MediaDiagnosticSummary {
    const sSummary = sourceSummary || this.getMediaSourceSummary(item);
    const dMap = dupMap || this.getDuplicateTmdbMap(true);
    const normType = this.normalizeMediaType(item.type);
    const dupCount = item.tmdbId ? (dMap.get(`${normType}:${Number(item.tmdbId)}`)?.length || 0) : 0;

    const checks = {
      hasTmdbId: Boolean(item.tmdbId && Number(item.tmdbId) > 0),
      hasTitle: Boolean(item.title && item.title.trim().length > 0),
      hasPoster: Boolean(item.posterPath && item.posterPath.trim().length >= 5),
      hasOverview: Boolean(item.overview && item.overview.trim().length >= 15),
      hasGenres: Array.isArray(item.genres) && item.genres.length > 0,
      hasSource: sSummary.hasSource,
      hasValidSource:
        sSummary.hasSource &&
        sSummary.onlineCount + sSummary.registeredCount + sSummary.validatingCount + sSummary.unverifiableCount > 0,
      noImportError: !item.importError && item.status !== 'ERROR',
      notDuplicate: dupCount <= 1,
      isPublished: this.isMediaPublished(item)
    };

    const issues: string[] = [];
    if (item.deletedAt) issues.push('Item movido para a Lixeira');
    if (!checks.hasTmdbId) issues.push('Sem TMDB ID');
    if (!checks.hasTitle) issues.push('Sem título');
    if (!checks.hasPoster) issues.push('Sem poster/capa');
    if (!checks.hasOverview) issues.push('Sinopse ausente ou incompleta');
    if (!checks.hasGenres) issues.push('Sem gêneros associados');
    if (!checks.hasSource) issues.push('Sem fonte de vídeo associada');
    else if (!checks.hasValidSource) issues.push('Fonte inválida, bloqueada ou offline');
    if (!checks.noImportError) issues.push(item.importError || 'Marcado com erro de importação');
    if (!checks.notDuplicate) issues.push(`Registro duplicado no catálogo (${dupCount}x)`);
    if (!checks.isPublished && !item.deletedAt) issues.push('Não publicado');

    let status: MediaDiagnosticSummary['status'] = 'COMPLETE';
    if (item.deletedAt) status = 'DELETED';
    else if (!checks.noImportError) status = 'ERROR';
    else if (!checks.isPublished) status = 'UNPUBLISHED';
    else if (issues.length > 0) status = 'INCOMPLETE';

    return {
      isComplete: issues.length === 0,
      status,
      issues,
      checks
    };
  }

  private sortMediaList(list: MediaItem[], sort?: string): MediaItem[] {
    const arr = [...list];
    switch (sort) {
      case 'oldest':
        return arr.sort(
          (a, b) => new Date(a.createdAt || a.updatedAt || 0).getTime() - new Date(b.createdAt || b.updatedAt || 0).getTime()
        );
      case 'updated':
        return arr.sort(
          (a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
        );
      case 'rating':
      case 'rating_high':
        return arr.sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0));
      case 'rating_low':
        return arr.sort((a, b) => (a.voteAverage || 0) - (b.voteAverage || 0));
      case 'popular':
        return arr.sort((a, b) => {
          const scoreA = (a.popular ? 100000 : 0) + (a.voteCount || 0) + (a.voteAverage || 0) * 100;
          const scoreB = (b.popular ? 100000 : 0) + (b.voteCount || 0) + (b.voteAverage || 0) * 100;
          return scoreB - scoreA;
        });
      case 'year':
        return arr.sort((a, b) => this.extractMediaYear(b) - this.extractMediaYear(a));
      case 'title_asc':
        return arr.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'pt'));
      case 'title_desc':
        return arr.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'pt'));
      case 'tmdb_id':
        return arr.sort((a, b) => Number(a.tmdbId || 0) - Number(b.tmdbId || 0));
      case 'recent':
      case 'newest':
      default:
        return arr.sort(
          (a, b) => new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime()
        );
    }
  }

  // Media Operations (Public Catalog)
  public getCatalog(filter?: {
    type?: string;
    genre?: string;
    search?: string;
    section?: string;
    yearFrom?: number;
    yearTo?: number;
    minRating?: number;
    maxRating?: number;
    status?: string;
    source?: string;
    sort?: string;
    page?: number;
    limit?: number;
  }) {
    let list = this.data.media.filter(m => !m.deletedAt);

    if (filter?.type && filter.type !== 'all') {
      const targetNorm = this.normalizeMediaType(filter.type);
      list = list.filter(m => this.normalizeMediaType(m.type) === targetNorm);
    }

    if (filter?.status && filter.status !== 'all') {
      list = list.filter(m => (m.status || 'ACTIVE') === filter.status);
    } else {
      list = list.filter(m => this.isMediaPublished(m));
    }

    if (filter?.genre && filter.genre !== 'all') {
      const gNorm = this.normalizeText(filter.genre);
      list = list.filter(m => m.genres?.some(g => this.normalizeText(g) === gNorm));
    }

    if (filter?.search) {
      const qRaw = filter.search.trim().toLowerCase();
      const qNorm = this.normalizeText(filter.search);
      list = list.filter(
        m =>
          this.normalizeText(m.title).includes(qNorm) ||
          this.normalizeText(m.originalTitle).includes(qNorm) ||
          (m.id && m.id.toLowerCase().includes(qRaw)) ||
          (m.imdbId && m.imdbId.toLowerCase().includes(qRaw)) ||
          (m.tmdbId && String(m.tmdbId).includes(qRaw))
      );
    }

    if (filter?.section === 'featured') {
      list = list.filter(m => m.featured);
    } else if (filter?.section === 'trending') {
      list = list.filter(m => m.trending);
    } else if (filter?.section === 'popular') {
      list = list.filter(m => m.popular);
    }

    if (filter?.yearFrom) {
      list = list.filter(m => {
        const year = this.extractMediaYear(m);
        return year > 0 && year >= filter.yearFrom!;
      });
    }

    if (filter?.yearTo) {
      list = list.filter(m => {
        const year = this.extractMediaYear(m);
        return year > 0 && year <= filter.yearTo!;
      });
    }

    if (filter?.minRating !== undefined) {
      list = list.filter(m => (m.voteAverage || 0) >= filter.minRating!);
    }

    if (filter?.maxRating !== undefined) {
      list = list.filter(m => (m.voteAverage || 0) <= filter.maxRating!);
    }

    if (filter?.source && filter.source !== 'all') {
      list = list.filter(m => m.source === filter.source);
    }

    list = this.sortMediaList(list, filter?.sort);

    const page = Math.max(1, filter?.page || 1);
    const limit = Math.max(1, filter?.limit || 20);
    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const items = list.slice((page - 1) * limit, page * limit);

    return { items, total, page, totalPages };
  }

  // Dedicated Admin Catalog Query (never hides incomplete/unpublished items, attaches source + diagnostic summaries & DB integrity audit)
  public getAdminCatalog(filter?: {
    type?: string;
    genre?: string;
    search?: string;
    yearFrom?: number;
    yearTo?: number;
    minRating?: number;
    maxRating?: number;
    publishStatus?: string; // 'all' | 'published' | 'unpublished' | 'deleted'
    status?: string;
    sourceStatus?: string; // 'all' | 'WITH_SOURCE' | 'WITHOUT_SOURCE' | 'ONLINE' | 'OFFLINE' | 'VALIDATING' | 'UNSUPPORTED' | 'EMBED_BLOCKED' | 'REGISTERED'
    diagnostic?: string; // 'all' | 'COMPLETE' | 'INCOMPLETE' | 'MISSING_POSTER' | 'MISSING_TMDB' | 'DUPLICATE' | 'NO_SOURCE' | 'INVALID_SOURCE' | 'IMPORT_ERROR'
    source?: string;
    ids?: string[];
    sort?: string;
    page?: number;
    limit?: number;
  }) {
    const dbMoviesTotal = this.data.media.filter(m => !m.deletedAt && this.normalizeMediaType(m.type) === 'movie').length;
    const dbSeriesTotal = this.data.media.filter(m => !m.deletedAt && this.normalizeMediaType(m.type) === 'tv').length;
    const dbDeletedMovies = this.data.media.filter(m => Boolean(m.deletedAt) && this.normalizeMediaType(m.type) === 'movie').length;
    const dbDeletedSeries = this.data.media.filter(m => Boolean(m.deletedAt) && this.normalizeMediaType(m.type) === 'tv').length;

    const dupMap = this.getDuplicateTmdbMap(true);
    const showDeletedOnly = filter?.publishStatus === 'deleted' || filter?.status === 'DELETED';

    let list = this.data.media.filter(m => (showDeletedOnly ? Boolean(m.deletedAt) : !m.deletedAt));

    if (filter?.ids && filter.ids.length > 0) {
      const idSet = new Set(filter.ids);
      list = list.filter(m => idSet.has(m.id));
    }

    if (filter?.type && filter.type !== 'all') {
      const targetNorm = this.normalizeMediaType(filter.type);
      list = list.filter(m => this.normalizeMediaType(m.type) === targetNorm);
    }

    if (filter?.publishStatus === 'published') {
      list = list.filter(m => this.isMediaPublished(m));
    } else if (filter?.publishStatus === 'unpublished') {
      list = list.filter(m => !this.isMediaPublished(m));
    }

    if (filter?.status && filter.status !== 'all' && filter.status !== 'DELETED') {
      if (filter.status === 'INCOMPLETE') {
        list = list.filter(m => {
          const s = this.getMediaSourceSummary(m);
          const d = this.computeMediaDiagnostics(m, s, dupMap);
          return !d.isComplete || m.status === 'INCOMPLETE';
        });
      } else {
        list = list.filter(m => (m.status || 'ACTIVE') === filter.status);
      }
    }

    if (filter?.genre && filter.genre !== 'all') {
      const gNorm = this.normalizeText(filter.genre);
      list = list.filter(m => m.genres?.some(g => this.normalizeText(g) === gNorm));
    }

    if (filter?.search) {
      const qRaw = filter.search.trim().toLowerCase();
      const qNorm = this.normalizeText(filter.search);
      list = list.filter(
        m =>
          this.normalizeText(m.title).includes(qNorm) ||
          this.normalizeText(m.originalTitle).includes(qNorm) ||
          (m.id && m.id.toLowerCase().includes(qRaw)) ||
          (m.imdbId && m.imdbId.toLowerCase().includes(qRaw)) ||
          (m.tmdbId !== undefined && m.tmdbId !== null && String(m.tmdbId).includes(qRaw))
      );
    }

    if (filter?.yearFrom) {
      list = list.filter(m => {
        const year = this.extractMediaYear(m);
        return year > 0 && year >= filter.yearFrom!;
      });
    }

    if (filter?.yearTo) {
      list = list.filter(m => {
        const year = this.extractMediaYear(m);
        return year > 0 && year <= filter.yearTo!;
      });
    }

    if (filter?.minRating !== undefined) {
      list = list.filter(m => (m.voteAverage || 0) >= filter.minRating!);
    }

    if (filter?.maxRating !== undefined) {
      list = list.filter(m => (m.voteAverage || 0) <= filter.maxRating!);
    }

    if (filter?.source && filter.source !== 'all') {
      list = list.filter(m => m.source === filter.source);
    }

    // Enrich with sourceSummary & diagnosticSummary before source/diagnostic filters
    let enriched: MediaItem[] = list.map(m => {
      const sourceSummary = this.getMediaSourceSummary(m);
      const diagnosticSummary = this.computeMediaDiagnostics(m, sourceSummary, dupMap);
      const counts = this.normalizeMediaType(m.type) === 'tv' ? this.countSeriesSeasonsAndEpisodes(m) : null;
      return {
        ...m,
        seasonsCount: counts ? counts.seasonsCount : m.seasonsCount,
        episodesCount: counts ? counts.episodesCount : m.episodesCount,
        published: m.published !== false && m.status !== 'DRAFT' && m.status !== 'INACTIVE',
        sourceSummary,
        diagnosticSummary
      };
    });

    if (filter?.sourceStatus && filter.sourceStatus !== 'all') {
      const st = filter.sourceStatus.toUpperCase();
      enriched = enriched.filter(m => {
        const ss = m.sourceSummary!;
        if (st === 'WITH_SOURCE') return ss.hasSource;
        if (st === 'WITHOUT_SOURCE' || st === 'NONE') return !ss.hasSource;
        if (st === 'ONLINE') return ss.onlineCount > 0;
        if (st === 'OFFLINE') return ss.offlineCount > 0;
        if (st === 'VALIDATING') return ss.validatingCount > 0;
        if (st === 'UNSUPPORTED') return ss.unsupportedCount > 0;
        if (st === 'EMBED_BLOCKED') return ss.embedBlockedCount > 0;
        if (st === 'REGISTERED') return ss.registeredCount > 0;
        return ss.status === st;
      });
    }

    if (filter?.diagnostic && filter.diagnostic !== 'all') {
      const diag = filter.diagnostic.toUpperCase();
      enriched = enriched.filter(m => {
        const ds = m.diagnosticSummary!;
        if (diag === 'COMPLETE') return ds.isComplete;
        if (diag === 'INCOMPLETE') return !ds.isComplete;
        if (diag === 'MISSING_POSTER') return !ds.checks.hasPoster;
        if (diag === 'MISSING_TMDB') return !ds.checks.hasTmdbId;
        if (diag === 'DUPLICATE') return !ds.checks.notDuplicate;
        if (diag === 'NO_SOURCE') return !ds.checks.hasSource;
        if (diag === 'INVALID_SOURCE') return ds.checks.hasSource && !ds.checks.hasValidSource;
        if (diag === 'IMPORT_ERROR') return !ds.checks.noImportError;
        return true;
      });
    }

    enriched = this.sortMediaList(enriched, filter?.sort);

    const page = Math.max(1, filter?.page || 1);
    const limit = Math.max(1, filter?.limit || 25);
    const total = enriched.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage = Math.min(page, totalPages);
    const items = enriched.slice((safePage - 1) * limit, safePage * limit);

    return {
      items,
      total,
      page: safePage,
      totalPages,
      audit: {
        dbTotal: dbMoviesTotal + dbSeriesTotal,
        dbMoviesTotal,
        dbSeriesTotal,
        dbDeletedMovies,
        dbDeletedSeries,
        filteredTotal: total,
        returnedCount: items.length,
        page: safePage,
        limit
      }
    };
  }

  public getGenresSummary() {
    const genres: Record<string, number> = {};
    this.data.media
      .filter(m => !m.deletedAt)
      .forEach(m => {
        m.genres?.forEach(g => {
          genres[g] = (genres[g] || 0) + 1;
        });
      });
    return Object.entries(genres)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  public getMediaById(id: string): MediaItem | undefined {
    return this.mediaIndexById.get(id) || this.data.media.find(m => m.id === id);
  }

  public getMediaByTmdbAndType(tmdbId: number, type: 'movie' | 'tv' | 'series'): MediaItem | undefined {
    const cleanId = Number(tmdbId);
    const normType = this.normalizeMediaType(type);
    const key = `${cleanId}_${normType}`;
    const indexed = this.mediaIndexByTmdbAndType.get(key);
    if (indexed && !indexed.deletedAt) return indexed;
    return this.data.media.find(m => !m.deletedAt && Number(m.tmdbId) === cleanId && this.normalizeMediaType(m.type) === normType);
  }

  private mergeSeasonsPreservingEpisodes(existingSeasons?: Season[], incomingSeasons?: Season[]): Season[] | undefined {
    if (!incomingSeasons || incomingSeasons.length === 0) return existingSeasons;
    if (!existingSeasons || existingSeasons.length === 0) return incomingSeasons;

    const existingMap = new Map<number, Season>();
    for (const s of existingSeasons) {
      existingMap.set(Number(s.seasonNumber), s);
    }

    const merged: Season[] = incomingSeasons.map(inc => {
      const prev = existingMap.get(Number(inc.seasonNumber));
      if (!prev) return inc;
      const preservedEpisodes =
        Array.isArray(inc.episodes) && inc.episodes.length > 0
          ? inc.episodes
          : Array.isArray(prev.episodes)
          ? prev.episodes
          : [];
      return {
        ...prev,
        ...inc,
        id: prev.id || inc.id,
        episodeCount: Math.max(Number(inc.episodeCount || 0), Number(prev.episodeCount || 0), preservedEpisodes.length),
        episodes: preservedEpisodes
      };
    });

    // Retain any custom local season not present in incoming
    for (const prev of existingSeasons) {
      if (!merged.some(m => Number(m.seasonNumber) === Number(prev.seasonNumber))) {
        merged.push(prev);
      }
    }

    return merged.sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));
  }

  public saveMedia(item: MediaItem): MediaItem {
    const idx = this.data.media.findIndex(m => m.id === item.id);
    const now = new Date().toISOString();
    let saved: MediaItem;
    if (idx >= 0) {
      const existing = this.data.media[idx];
      const mergedSeasons = this.mergeSeasonsPreservingEpisodes(existing.seasons, item.seasons);
      const updated: MediaItem = {
        ...existing,
        ...item,
        id: existing.id,
        seasons: mergedSeasons,
        published: item.published !== undefined ? item.published : existing.published !== undefined ? existing.published : true,
        status: item.status || existing.status || 'ACTIVE',
        createdAt: existing.createdAt || item.createdAt || now,
        updatedAt: now
      };
      this.data.media[idx] = updated;
      saved = updated;
    } else {
      const created: MediaItem = {
        ...item,
        published: item.published !== undefined ? item.published : true,
        status: item.status || 'ACTIVE',
        createdAt: item.createdAt || now,
        updatedAt: now
      };
      this.data.media.push(created);
      saved = created;
    }

    // Update fast lookup indices
    if (saved.id) this.mediaIndexById.set(saved.id, saved);
    if (saved.tmdbId && !saved.deletedAt) {
      this.mediaIndexByTmdbAndType.set(`${Number(saved.tmdbId)}_${this.normalizeMediaType(saved.type)}`, saved);
    }
    this.save();
    return saved;
  }

  // Player Sources Operations (Rule 6, 8, 12)
  public getPlayerSources(filter?: { tmdbId?: number; imdbId?: string; type?: 'movie' | 'tv'; season?: number; episode?: number; status?: 'active' | 'inactive' }): PlayerSource[] {
    return this.data.playerSources.filter(s => {
      if (filter?.status && s.status !== filter.status) return false;
      if (filter?.type && s.type !== filter.type) return false;

      if (filter?.tmdbId && s.tmdbId === filter.tmdbId) {
        if (s.type === 'tv') {
          if (filter.season !== undefined && s.season !== filter.season) return false;
          if (filter.episode !== undefined && s.episode !== filter.episode) return false;
        }
        return true;
      }

      if (filter?.imdbId && s.imdbId === filter.imdbId) {
        if (s.type === 'tv') {
          if (filter.season !== undefined && s.season !== filter.season) return false;
          if (filter.episode !== undefined && s.episode !== filter.episode) return false;
        }
        return true;
      }

      if (!filter?.tmdbId && !filter?.imdbId) return true;

      return false;
    });
  }

  public getAllPlayerSources(): PlayerSource[] {
    return this.data.playerSources;
  }

  public addPlayerSource(source: Omit<PlayerSource, 'id' | 'createdAt' | 'updatedAt'>): PlayerSource {
    const newSource: PlayerSource = {
      ...source,
      id: `src-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (newSource.isPrimary) {
      // Unset primary for other sources of the same media
      this.data.playerSources.forEach(s => {
        if (s.tmdbId === newSource.tmdbId && s.type === newSource.type && s.season === newSource.season && s.episode === newSource.episode) {
          s.isPrimary = false;
        }
      });
    }

    this.data.playerSources.push(newSource);
    this.save();
    return newSource;
  }

  public updatePlayerSource(id: string, updates: Partial<PlayerSource>): PlayerSource | undefined {
    const src = this.data.playerSources.find(s => s.id === id);
    if (!src) return undefined;

    Object.assign(src, updates, { updatedAt: new Date().toISOString() });
    this.save();
    return src;
  }

  public deletePlayerSource(id: string): boolean {
    const initialLen = this.data.playerSources.length;
    this.data.playerSources = this.data.playerSources.filter(s => s.id !== id);
    if (this.data.playerSources.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Stream Sources Operations
  public getStreamSources(filter?: { tmdbId?: number; mediaType?: 'movie' | 'tv'; season?: number; episode?: number; status?: string; provider?: string }) {
    return this.data.streamSources.filter(s => {
      if (filter?.tmdbId && s.tmdbId !== filter.tmdbId) return false;
      if (filter?.mediaType && s.mediaType !== filter.mediaType) return false;
      if (filter?.season !== undefined && s.season !== filter.season) return false;
      if (filter?.episode !== undefined && s.episode !== filter.episode) return false;
      if (filter?.status && s.status !== filter.status) return false;
      if (filter?.provider && s.provider !== filter.provider) return false;
      return true;
    });
  }

  // App Settings
  public getSettings(): AppSettings {
    return this.data.settings;
  }

  public updateSettings(settings: Partial<AppSettings>): AppSettings {
    Object.assign(this.data.settings, settings);
    this.save();
    return this.data.settings;
  }

  // Provider Config (Uqload, AnonMp4, etc)
  public getProviderConfig() {
    return this.data.providerConfig || {};
  }

  public updateProviderConfig(config: Partial<{ uqloadApiKey: string; anonmp4ApiKey: string }>) {
    this.data.providerConfig = { ...(this.data.providerConfig || {}), ...config };
    this.save();
    return this.data.providerConfig;
  }

  // --- VIDEO SOURCES WITH FIRESTORE & LOCAL FALLBACK ---
  private normalizeContentType(ct?: string): 'movie' | 'tv' {
    const lower = (ct || 'movie').toLowerCase();
    return lower === 'tv' || lower === 'series' || lower === 'serie' ? 'tv' : 'movie';
  }

  private sortSources<T extends { isPrimary?: boolean; priority?: number; enabled?: boolean; status?: string; createdAt?: string }>(list: T[]): T[] {
    const score = (s: T) => {
      if (s.enabled === false) return 0;
      const st = (s.status || '').toLowerCase();
      if (st === 'offline' || st === 'inactive' || st === 'embed_blocked' || st === 'unsupported_format') return 0;
      if (st === 'online' || st === 'active') return 3;
      if (st === 'registered' || st === 'unverified' || st === 'unverifiable') return 2;
      return 1;
    };
    return [...list].sort((a, b) => {
      const enabledA = a.enabled === false ? 0 : 1;
      const enabledB = b.enabled === false ? 0 : 1;
      if (enabledB !== enabledA) return enabledB - enabledA;
      if ((b.isPrimary ? 1 : 0) !== (a.isPrimary ? 1 : 0)) {
        return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
      }
      const prioA = typeof a.priority === 'number' ? a.priority : 999;
      const prioB = typeof b.priority === 'number' ? b.priority : 999;
      if (prioA !== prioB) return prioA - prioB;
      const sa = score(a);
      const sb = score(b);
      if (sb !== sa) return sb - sa;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }

  public async getVideoSources(filter?: { contentId?: number; contentType?: 'movie' | 'tv' | string; seasonNumber?: number; episodeNumber?: number; status?: string }) {
    const normType = filter?.contentType ? this.normalizeContentType(filter.contentType) : undefined;
    try {
      let query: any = adminDb.collection('videoSources');
      if (filter?.contentId) query = query.where('contentId', '==', Number(filter.contentId));
      if (normType) query = query.where('contentType', '==', normType);
      if (filter?.seasonNumber !== undefined) query = query.where('seasonNumber', '==', Number(filter.seasonNumber));
      if (filter?.episodeNumber !== undefined) query = query.where('episodeNumber', '==', Number(filter.episodeNumber));
      if (filter?.status) query = query.where('status', '==', filter.status);

      const snapshot = await query.orderBy('createdAt', 'desc').get();
      const docs = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as VideoSource[];
      if (docs.length > 0) return this.sortSources(docs);
    } catch (e) {
      console.warn('[Firestore Warning] Falling back to local store for videoSources:', (e as any)?.message);
    }

    let list = this.data.videoSources || [];
    if (filter?.contentId) list = list.filter(s => Number(s.contentId) === Number(filter.contentId));
    if (normType) list = list.filter(s => this.normalizeContentType(s.contentType) === normType);
    if (filter?.seasonNumber !== undefined) list = list.filter(s => Number(s.seasonNumber) === Number(filter.seasonNumber));
    if (filter?.episodeNumber !== undefined) list = list.filter(s => Number(s.episodeNumber) === Number(filter.episodeNumber));
    if (filter?.status) list = list.filter(s => s.status === filter.status);
    return this.sortSources(list);
  }

  public async addVideoSource(source: Omit<VideoSource, 'id' | 'createdAt' | 'updatedAt'>) {
    const id = `vid-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const normType = this.normalizeContentType(source.contentType);
    const classified = classifySourceUrl(source.url);
    const originalUrl = source.originalUrl || classified.originalUrl || source.url;
    const sourceKind = source.sourceKind || classified.sourceKind;
    const format = source.format || classified.suggestedFormat;
    // Never mark a newly added source as 'online' unless explicitly verified
    const initialStatus = source.status && source.status !== 'unverified' ? source.status : 'registered';

    const newSource: VideoSource = {
      ...source,
      id,
      contentId: Number(source.contentId),
      contentType: normType,
      seasonNumber: normType === 'tv' ? Number(source.seasonNumber || 1) : undefined,
      episodeNumber: normType === 'tv' ? Number(source.episodeNumber || 1) : undefined,
      url: originalUrl,
      originalUrl,
      sourceKind,
      format,
      status: initialStatus,
      isPrimary: source.isPrimary ?? ((this.data.videoSources || []).filter(v =>
        Number(v.contentId) === Number(source.contentId) &&
        this.normalizeContentType(v.contentType) === normType &&
        (normType !== 'tv' || (Number(v.seasonNumber || 1) === Number(source.seasonNumber || 1) && Number(v.episodeNumber || 1) === Number(source.episodeNumber || 1)))
      ).length === 0),
      priority: typeof source.priority === 'number' ? source.priority : 1,
      enabled: source.enabled !== undefined ? source.enabled : true,
      diagnostics: source.diagnostics || classified.diagnostics,
      createdAt: now,
      updatedAt: now
    };

    // Enforce single primary per movie or episode
    this.data.videoSources = this.data.videoSources || [];
    if (newSource.isPrimary) {
      this.data.videoSources.forEach(s => {
        if (
          Number(s.contentId) === newSource.contentId &&
          this.normalizeContentType(s.contentType) === normType &&
          (normType !== 'tv' || (s.seasonNumber === newSource.seasonNumber && s.episodeNumber === newSource.episodeNumber))
        ) {
          s.isPrimary = false;
        }
      });
    }

    try {
      await adminDb.collection('videoSources').doc(id).set(newSource);
    } catch (e) {
      console.warn('[Firestore Warning] Saved videoSource to local store:', (e as any)?.message);
    }

    this.data.videoSources.unshift(newSource);

    // Sync to playerSources so player lookup instantly finds it
    const playerEquivalent: PlayerSource = {
      id: `src-${id}`,
      tmdbId: newSource.contentId,
      type: normType,
      season: newSource.seasonNumber,
      episode: newSource.episodeNumber,
      url: newSource.url,
      originalUrl: newSource.originalUrl,
      sourceKind: newSource.sourceKind,
      provider: newSource.serverName || newSource.providerName || newSource.provider || 'Servidor Oficial',
      format: newSource.format,
      label: newSource.serverName || newSource.sourceName || newSource.quality || 'Servidor Principal',
      quality: newSource.quality,
      isPrimary: newSource.isPrimary,
      priority: newSource.priority,
      enabled: newSource.enabled,
      status: newSource.status,
      audioLanguage: newSource.audioLanguage,
      diagnostics: newSource.diagnostics,
      createdAt: newSource.createdAt,
      updatedAt: newSource.updatedAt
    };

    if (playerEquivalent.isPrimary) {
      this.data.playerSources.forEach(s => {
        if (
          Number(s.tmdbId) === playerEquivalent.tmdbId &&
          this.normalizeContentType(s.type) === normType &&
          (normType !== 'tv' || (s.season === playerEquivalent.season && s.episode === playerEquivalent.episode))
        ) {
          s.isPrimary = false;
        }
      });
    }

    const existingIdx = this.data.playerSources.findIndex(
      s => s.id === `src-${id}` || (s.url === newSource.url && Number(s.tmdbId) === newSource.contentId && s.season === newSource.seasonNumber && s.episode === newSource.episodeNumber)
    );
    if (existingIdx >= 0) {
      this.data.playerSources[existingIdx] = { ...this.data.playerSources[existingIdx], ...playerEquivalent };
    } else {
      this.data.playerSources.unshift(playerEquivalent);
    }

    this.save();
    return newSource;
  }

  public async updateVideoSource(id: string, updates: Partial<VideoSource>) {
    const now = new Date().toISOString();
    const enrichedUpdates: Partial<VideoSource> = { ...updates, updatedAt: now };

    if (updates.url) {
      const classified = classifySourceUrl(updates.url);
      enrichedUpdates.url = classified.originalUrl || updates.url;
      enrichedUpdates.originalUrl = classified.originalUrl || updates.url;
      enrichedUpdates.sourceKind = updates.sourceKind || classified.sourceKind;
      enrichedUpdates.diagnostics = updates.diagnostics || classified.diagnostics;
    }

    try {
      const ref = adminDb.collection('videoSources').doc(id);
      await ref.update(enrichedUpdates);
    } catch (e) {
      console.warn('[Firestore Warning] Updated videoSource in local store:', (e as any)?.message);
    }

    this.data.videoSources = this.data.videoSources || [];
    const idx = this.data.videoSources.findIndex(s => s.id === id);
    let updatedRecord: VideoSource;

    if (idx >= 0) {
      const target = { ...this.data.videoSources[idx], ...enrichedUpdates };
      if (enrichedUpdates.isPrimary) {
        const normType = this.normalizeContentType(target.contentType);
        this.data.videoSources.forEach((s, i) => {
          if (
            i !== idx &&
            Number(s.contentId) === Number(target.contentId) &&
            this.normalizeContentType(s.contentType) === normType &&
            (normType !== 'tv' || (s.seasonNumber === target.seasonNumber && s.episodeNumber === target.episodeNumber))
          ) {
            s.isPrimary = false;
          }
        });
      }
      this.data.videoSources[idx] = target;
      updatedRecord = target;
    } else {
      updatedRecord = { id, ...(enrichedUpdates as any) } as VideoSource;
    }

    // Sync update into playerSources
    const pIdx = this.data.playerSources.findIndex(s => s.id === `src-${id}` || s.id === id);
    if (pIdx >= 0) {
      this.data.playerSources[pIdx] = {
        ...this.data.playerSources[pIdx],
        url: updatedRecord.url ?? this.data.playerSources[pIdx].url,
        originalUrl: updatedRecord.originalUrl ?? this.data.playerSources[pIdx].originalUrl,
        sourceKind: updatedRecord.sourceKind ?? this.data.playerSources[pIdx].sourceKind,
        format: updatedRecord.format ?? this.data.playerSources[pIdx].format,
        provider: updatedRecord.serverName ?? updatedRecord.providerName ?? this.data.playerSources[pIdx].provider,
        label: updatedRecord.serverName ?? updatedRecord.sourceName ?? this.data.playerSources[pIdx].label,
        quality: updatedRecord.quality ?? this.data.playerSources[pIdx].quality,
        audioLanguage: updatedRecord.audioLanguage ?? this.data.playerSources[pIdx].audioLanguage,
        isPrimary: updatedRecord.isPrimary ?? this.data.playerSources[pIdx].isPrimary,
        priority: updatedRecord.priority ?? this.data.playerSources[pIdx].priority,
        enabled: updatedRecord.enabled ?? this.data.playerSources[pIdx].enabled,
        status: updatedRecord.status ?? this.data.playerSources[pIdx].status,
        diagnostics: updatedRecord.diagnostics ?? this.data.playerSources[pIdx].diagnostics,
        updatedAt: now
      };
    }

    this.save();
    return updatedRecord;
  }

  public async deleteVideoSource(id: string) {
    try {
      await adminDb.collection('videoSources').doc(id).delete();
    } catch (e) {
      console.warn('[Firestore Warning] Deleted videoSource from local store:', (e as any)?.message);
    }

    let removedTarget: VideoSource | undefined;
    if (this.data.videoSources) {
      removedTarget = this.data.videoSources.find(s => s.id === id);
      this.data.videoSources = this.data.videoSources.filter(s => s.id !== id);
    }

    const removedUrl = removedTarget?.url;
    this.data.playerSources = this.data.playerSources.filter(s => {
      if (s.id === `src-${id}` || s.id === id) return false;
      if (removedTarget && removedUrl && s.url === removedUrl) {
        const sameTmdb = Number(s.tmdbId) === Number(removedTarget.contentId);
        const sameType = this.normalizeContentType(s.type) === this.normalizeContentType(removedTarget.contentType);
        const sameEp =
          this.normalizeContentType(removedTarget.contentType) !== 'tv' ||
          (Number(s.season || 1) === Number(removedTarget.seasonNumber || 1) &&
            Number(s.episode || 1) === Number(removedTarget.episodeNumber || 1));
        if (sameTmdb && sameType && sameEp) return false;
      }
      return true;
    });

    this.save();
    return true;
  }

  public getSeasonSourceTemplates(contentId?: number): SeasonSourceTemplate[] {
    const map = this.data.seasonSourceTemplates || {};
    const list = Object.values(map);
    if (contentId !== undefined && !isNaN(contentId)) {
      return list
        .filter(t => Number(t.contentId) === Number(contentId))
        .sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));
    }
    return list;
  }

  public saveSeasonSourceTemplate(input: Omit<SeasonSourceTemplate, 'updatedAt'>): SeasonSourceTemplate {
    this.data.seasonSourceTemplates = this.data.seasonSourceTemplates || {};
    const key = `${Number(input.contentId)}-${Number(input.seasonNumber)}`;
    const record: SeasonSourceTemplate = {
      contentId: Number(input.contentId),
      seasonNumber: Number(input.seasonNumber),
      baseUrl: String(input.baseUrl || '').trim(),
      useMgebPrefix: input.useMgebPrefix !== false,
      serverName: input.serverName,
      format: input.format,
      audioLanguage: input.audioLanguage,
      quality: input.quality,
      updatedAt: new Date().toISOString()
    };
    this.data.seasonSourceTemplates[key] = record;
    this.save();
    return record;
  }

  public findDuplicateVideoSource(params: {
    contentId: number;
    contentType: string;
    url: string;
    seasonNumber?: number;
    episodeNumber?: number;
    excludeId?: string;
  }): VideoSource | undefined {
    const normType = this.normalizeContentType(params.contentType);
    const cleanUrl = (params.url || '').trim();
    const targetId = Number(params.contentId);
    return (this.data.videoSources || []).find(s => {
      if (params.excludeId && s.id === params.excludeId) return false;
      if (Number(s.contentId) !== targetId) return false;
      if (this.normalizeContentType(s.contentType) !== normType) return false;
      if (normType === 'tv') {
        if (Number(s.seasonNumber || 1) !== Number(params.seasonNumber || 1)) return false;
        if (Number(s.episodeNumber || 1) !== Number(params.episodeNumber || 1)) return false;
      }
      return (s.originalUrl || s.url || '').trim() === cleanUrl;
    });
  }

  public async saveBatchEpisodeSources(input: {
    contentId: number;
    seasonNumber: number;
    seasonBaseUrl?: string;
    useMgebPrefix?: boolean;
    serverName?: string;
    format?: string;
    audioLanguage?: string;
    quality?: string;
    isPrimary?: boolean;
    priority?: number;
    enabled?: boolean;
    conflictMode: 'skip' | 'overwrite' | 'add_alternative';
    adminEmail: string;
    episodes: Array<{
      episodeNumber: number;
      url: string;
      title?: string;
      overview?: string;
      stillPath?: string;
      duration?: number;
      airDate?: string;
      voteAverage?: number;
      status?: string;
      diagnostics?: any;
    }>;
  }): Promise<BatchEpisodeSourcesResult> {
    const tmdbId = Number(input.contentId);
    const seasonNumber = Math.max(0, Number(input.seasonNumber));
    const media = this.getMediaByTmdbAndType(tmdbId, 'tv');
    if (!media) {
      throw new Error(
        'Esta série ainda não foi importada para o catálogo da RONYCINE API. Importe-a manualmente antes de guardar episódios e fontes.'
      );
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let alternativeCount = 0;
    const conflicts: Array<{ episodeNumber: number; existingCount: number; action: string }> = [];
    const savedSources: VideoSource[] = [];

    // 1. Update episodes inside existing series season ONLY for explicitly confirmed episodes
    const existingSeasons = Array.isArray(media.seasons) ? media.seasons.map(s => ({ ...s, episodes: [...(s.episodes || [])] })) : [];
    let targetSeason = existingSeasons.find(s => Number(s.seasonNumber) === seasonNumber);
    if (!targetSeason) {
      targetSeason = {
        id: `season-${seasonNumber}`,
        seasonNumber,
        name: seasonNumber === 0 ? 'Especiais' : `Temporada ${seasonNumber}`,
        episodes: [],
        episodeCount: 0
      };
      existingSeasons.push(targetSeason);
    }

    for (const ep of input.episodes) {
      const epNum = Math.max(1, Number(ep.episodeNumber));
      const existingForEp = (this.data.videoSources || []).filter(
        s =>
          Number(s.contentId) === tmdbId &&
          this.normalizeContentType(s.contentType) === 'tv' &&
          Number(s.seasonNumber || 1) === seasonNumber &&
          Number(s.episodeNumber || 1) === epNum
      );

      // Associate episode metadata into the season if not already present (preserving existing custom data)
      const epList = targetSeason.episodes || [];
      const existingEpMetaIdx = epList.findIndex(e => Number(e.episodeNumber) === epNum);
      if (existingEpMetaIdx < 0) {
        epList.push({
          id: `ep-${tmdbId}-${seasonNumber}-${epNum}`,
          seasonNumber,
          episodeNumber: epNum,
          title: ep.title || `Episódio ${epNum}`,
          overview: ep.overview || '',
          stillPath: ep.stillPath,
          duration: ep.duration,
          airDate: ep.airDate,
          voteAverage: ep.voteAverage
        });
      }
      targetSeason.episodes = epList;

      const classified = classifySourceUrl(ep.url);
      if (existingForEp.length > 0) {
        if (input.conflictMode === 'skip') {
          skippedCount++;
          conflicts.push({ episodeNumber: epNum, existingCount: existingForEp.length, action: 'skipped' });
          continue;
        }

        if (input.conflictMode === 'overwrite') {
          for (const old of existingForEp) {
            await this.deleteVideoSource(old.id);
          }
          const created = await this.addVideoSource({
            contentId: tmdbId,
            contentType: 'tv',
            seasonNumber,
            episodeNumber: epNum,
            serverName: input.serverName || classified.suggestedServerName || 'MGEB Endpoint',
            url: classified.originalUrl,
            originalUrl: classified.originalUrl,
            sourceKind: classified.sourceKind,
            format: (input.format || classified.suggestedFormat) as any,
            audioLanguage: input.audioLanguage || 'Português',
            quality: input.quality || '1080p',
            isPrimary: input.isPrimary !== undefined ? input.isPrimary : true,
            priority: typeof input.priority === 'number' ? input.priority : 1,
            enabled: input.enabled !== undefined ? input.enabled : true,
            status: (ep.status || 'registered') as any,
            diagnostics: ep.diagnostics || classified.diagnostics
          });
          savedSources.push(created);
          updatedCount++;
          conflicts.push({ episodeNumber: epNum, existingCount: existingForEp.length, action: 'overwritten' });
          continue;
        }

        // add_alternative: check exact duplicate first
        const exactDup = existingForEp.find(s => (s.originalUrl || s.url || '').trim() === classified.originalUrl.trim());
        if (exactDup) {
          skippedCount++;
          conflicts.push({ episodeNumber: epNum, existingCount: existingForEp.length, action: 'duplicate_skipped' });
          continue;
        }

        const altCreated = await this.addVideoSource({
          contentId: tmdbId,
          contentType: 'tv',
          seasonNumber,
          episodeNumber: epNum,
          serverName: input.serverName || classified.suggestedServerName || 'MGEB Endpoint',
          url: classified.originalUrl,
          originalUrl: classified.originalUrl,
          sourceKind: classified.sourceKind,
          format: (input.format || classified.suggestedFormat) as any,
          audioLanguage: input.audioLanguage || 'Português',
          quality: input.quality || '1080p',
          isPrimary: false,
          priority: typeof input.priority === 'number' ? Math.max(2, input.priority) : existingForEp.length + 1,
          enabled: input.enabled !== undefined ? input.enabled : true,
          status: (ep.status || 'registered') as any,
          diagnostics: ep.diagnostics || classified.diagnostics
        });
        savedSources.push(altCreated);
        alternativeCount++;
        conflicts.push({ episodeNumber: epNum, existingCount: existingForEp.length, action: 'added_alternative' });
        continue;
      }

      const created = await this.addVideoSource({
        contentId: tmdbId,
        contentType: 'tv',
        seasonNumber,
        episodeNumber: epNum,
        serverName: input.serverName || classified.suggestedServerName || 'MGEB Endpoint',
        url: classified.originalUrl,
        originalUrl: classified.originalUrl,
        sourceKind: classified.sourceKind,
        format: (input.format || classified.suggestedFormat) as any,
        audioLanguage: input.audioLanguage || 'Português',
        quality: input.quality || '1080p',
        isPrimary: input.isPrimary !== undefined ? input.isPrimary : true,
        priority: typeof input.priority === 'number' ? input.priority : 1,
        enabled: input.enabled !== undefined ? input.enabled : true,
        status: (ep.status || 'registered') as any,
        diagnostics: ep.diagnostics || classified.diagnostics
      });
      savedSources.push(created);
      addedCount++;
    }

    // Sort episodes and update counts safely on targetSeason
    targetSeason.episodes = (targetSeason.episodes || []).sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
    targetSeason.episodeCount = Math.max(Number(targetSeason.episodeCount || 0), targetSeason.episodes.length);
    existingSeasons.sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));
    this.saveMedia({
      ...media,
      seasons: existingSeasons,
      seasonsCount: Math.max(Number(media.seasonsCount || 0), existingSeasons.length),
      episodesCount: existingSeasons.reduce((acc, s) => acc + Math.max(Number(s.episodeCount || 0), (s.episodes || []).length), 0)
    });

    // Save per-season base URL template if provided
    if (input.seasonBaseUrl && input.seasonBaseUrl.trim()) {
      this.saveSeasonSourceTemplate({
        contentId: tmdbId,
        seasonNumber,
        baseUrl: input.seasonBaseUrl.trim(),
        useMgebPrefix: input.useMgebPrefix !== false,
        serverName: input.serverName,
        format: input.format,
        audioLanguage: input.audioLanguage,
        quality: input.quality
      });
    }

    this.addAuditLog(
      input.adminEmail,
      'BATCH_SAVE_EPISODE_SOURCES',
      'SUCCESS',
      `${media.title} T${seasonNumber}: ${addedCount} adicionadas, ${updatedCount} atualizadas, ${alternativeCount} alternativas, ${skippedCount} ignoradas.`
    );

    return {
      success: true,
      contentId: tmdbId,
      seasonNumber,
      addedCount,
      updatedCount,
      skippedCount,
      alternativeCount,
      conflicts,
      savedSources,
      message: `Temporada ${seasonNumber} processada: ${addedCount} novas, ${updatedCount} atualizadas, ${alternativeCount} alternativas, ${skippedCount} ignoradas.`
    };
  }

  public async getAllVideoSources() {
    try {
      const snapshot = await adminDb.collection('videoSources').orderBy('createdAt', 'desc').get();
      const docs = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as VideoSource[];
      if (docs.length > 0) return docs;
    } catch (e) {
      // fallback below
    }
    return this.data.videoSources || [];
  }

  // --- STATS & AUDIT ---
  public getStats(): CatalogStats {
    const activeMedia = this.data.media.filter(m => !m.deletedAt);
    const movies = activeMedia.filter(m => this.normalizeMediaType(m.type) === 'movie');
    const series = activeMedia.filter(m => this.normalizeMediaType(m.type) === 'tv');
    const deletedMovies = this.data.media.filter(m => Boolean(m.deletedAt) && this.normalizeMediaType(m.type) === 'movie').length;
    const deletedSeries = this.data.media.filter(m => Boolean(m.deletedAt) && this.normalizeMediaType(m.type) === 'tv').length;

    let totalSeasons = 0;
    let totalEpisodes = 0;
    series.forEach(s => {
      const counts = this.countSeriesSeasonsAndEpisodes(s);
      totalSeasons += counts.seasonsCount;
      totalEpisodes += counts.episodesCount;
    });

    const dupMap = this.getDuplicateTmdbMap(true);
    let publishedMovies = 0;
    let unpublishedMovies = 0;
    let moviesWithoutSource = 0;
    let totalProblematic = 0;

    for (const m of movies) {
      if (this.isMediaPublished(m)) publishedMovies++;
      else unpublishedMovies++;
      const sSummary = this.getMediaSourceSummary(m);
      if (!sSummary.hasSource) moviesWithoutSource++;
      const diag = this.computeMediaDiagnostics(m, sSummary, dupMap);
      if (!diag.isComplete) totalProblematic++;
    }

    let publishedSeries = 0;
    let unpublishedSeries = 0;
    let seriesWithoutSource = 0;

    for (const s of series) {
      if (this.isMediaPublished(s)) publishedSeries++;
      else unpublishedSeries++;
      const sSummary = this.getMediaSourceSummary(s);
      if (!sSummary.hasSource) seriesWithoutSource++;
      const diag = this.computeMediaDiagnostics(s, sSummary, dupMap);
      if (!diag.isComplete) totalProblematic++;
    }

    const vSources = this.data.videoSources || [];
    const uniqueSourceUrls = new Map<string, string>();
    for (const ps of this.data.playerSources) {
      uniqueSourceUrls.set(`${ps.tmdbId}-${this.normalizeMediaType(ps.type)}-${ps.season || 0}-${ps.episode || 0}-${ps.url}`, (ps.status || 'registered').toLowerCase());
    }
    for (const vs of vSources) {
      uniqueSourceUrls.set(`${vs.contentId}-${this.normalizeMediaType(vs.contentType)}-${vs.seasonNumber || 0}-${vs.episodeNumber || 0}-${vs.url}`, (vs.status || 'registered').toLowerCase());
    }

    let onlineLinks = 0;
    let offlineLinks = 0;
    for (const st of uniqueSourceUrls.values()) {
      if (st === 'online' || st === 'active') onlineLinks++;
      else if (st === 'offline' || st === 'inactive' || st === 'embed_blocked' || st === 'unsupported_format') offlineLinks++;
    }

    const recentItems = [...activeMedia]
      .sort((a, b) => new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime())
      .slice(0, 8)
      .map(m => ({
        id: m.id,
        tmdbId: m.tmdbId,
        title: m.title,
        type: this.normalizeMediaType(m.type),
        posterPath: m.posterPath,
        releaseYear: this.extractMediaYear(m) || undefined,
        voteAverage: m.voteAverage,
        createdAt: m.createdAt || m.updatedAt,
        hasSource: this.getMediaSourceSummary(m).hasSource,
        published: this.isMediaPublished(m)
      }));

    const recentImports = (this.data.importHistory || []).slice(0, 8);

    return {
      totalMovies: movies.length,
      totalSeries: series.length,
      totalSeasons,
      totalEpisodes,
      totalUsers: this.data.users.length,
      totalViews: 0,
      publishedMovies,
      publishedSeries,
      unpublishedMovies,
      unpublishedSeries,
      moviesWithoutSource,
      seriesWithoutSource,
      deletedMovies,
      deletedSeries,
      totalProblematic,
      top10Count: activeMedia.filter(m => m.isTop10).length,
      totalLinks: uniqueSourceUrls.size,
      onlineLinks,
      offlineLinks,
      recentImports,
      recentItems
    };
  }

  public getPublicStats() {
    const activeMedia = this.data.media.filter(m => this.isMediaPublished(m));
    const moviesCount = activeMedia.filter(m => this.normalizeMediaType(m.type) === 'movie').length;
    const seriesList = activeMedia.filter(m => this.normalizeMediaType(m.type) === 'tv');
    const seriesCount = seriesList.length;

    let episodesCount = 0;
    seriesList.forEach(s => {
      episodesCount += this.countSeriesSeasonsAndEpisodes(s).episodesCount;
    });

    return {
      moviesCount,
      seriesCount,
      episodesCount,
      totalCatalog: moviesCount + seriesCount,
      status: 'Online'
    };
  }

  public async getAuditLogs() {
    try {
      const snapshot = await adminDb.collection('auditLogs').orderBy('timestamp', 'desc').limit(100).get();
      const docs = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      if (docs.length > 0) return docs;
    } catch (e) {
      // fallback below
    }
    return this.data.auditLogs || [];
  }

  public async addAuditLog(userEmail: string, action: string, result: 'SUCCESS' | 'FAILED', details: string) {
    const log = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      userId: userEmail,
      userEmail,
      action,
      result,
      details,
      timestamp: new Date().toISOString()
    };
    try {
      await adminDb.collection('auditLogs').add(log);
    } catch (e) {
      // Clean fallback to local store
    }
    this.data.auditLogs = this.data.auditLogs || [];
    this.data.auditLogs.unshift(log);
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs = this.data.auditLogs.slice(0, 500);
    }
    this.save();
    return log;
  }

  // --- RECOVERY & MEDIA MANAGEMENT ---
  public getRecoveryStatsData() {
    const active = this.data.media.filter(m => !m.deletedAt);
    return { status: 'healthy', totalCatalog: active.length };
  }
  public getRecoveryState() {
    return this.data.recoveryState || { status: 'IDLE', lastSnapshot: null };
  }
  public updateRecoveryState(state: any) {
    this.data.recoveryState = { ...(this.data.recoveryState || {}), ...state };
    this.save();
    return this.data.recoveryState;
  }
  public addRecoverySnapshot(id: string, action: string) {
    this.data.recoveryState = {
      ...(this.data.recoveryState || {}),
      lastSnapshot: `${action} (${new Date().toISOString()})`
    };
    this.save();
  }
  public addRecoveryReport(report: any) {
    this.data.recoveryReports = this.data.recoveryReports || [];
    this.data.recoveryReports.unshift(report);
    if (this.data.recoveryReports.length > 50) {
      this.data.recoveryReports = this.data.recoveryReports.slice(0, 50);
    }
    this.save();
    return report;
  }
  public getRecoveryIssues() {
    return this.data.recoveryIssues || [];
  }
  public setRecoveryIssues(issues: any[]) {
    this.data.recoveryIssues = issues;
    this.save();
  }
  public findDuplicates() {
    const map = this.getDuplicateTmdbMap(true);
    const duplicates: Array<{ tmdbId: number; type: 'movie' | 'tv'; count: number; items: MediaItem[] }> = [];
    for (const [key, items] of map.entries()) {
      if (items.length > 1) {
        const [typeStr, tmdbStr] = key.split(':');
        duplicates.push({
          tmdbId: Number(tmdbStr),
          type: typeStr === 'tv' ? 'tv' : 'movie',
          count: items.length,
          items
        });
      }
    }
    return duplicates;
  }

  public addMediaItem(item: MediaItem) {
    return this.saveMedia(item);
  }
  public updateMediaItem(id: string, updates: Partial<MediaItem>): MediaItem | null {
    const item = this.getMediaById(id);
    if (!item) return null;
    const cleanUpdates = { ...updates };
    delete (cleanUpdates as any).sourceSummary;
    delete (cleanUpdates as any).diagnosticSummary;
    return this.saveMedia({ ...item, ...cleanUpdates, id: item.id });
  }
  public async addActivityLog(typeOrLog: any, message?: string) {
    if (typeof typeOrLog === 'string' && message) {
      return this.addAuditLog('system', typeOrLog.toUpperCase(), 'SUCCESS', message);
    }
    const log = typeOrLog;
    return this.addAuditLog(log.userEmail || 'system', log.action || 'ACTIVITY', 'SUCCESS', log.details || message || '');
  }
  public saveWatchProgress(userId: string, data: any) {
    return { userId, ...data, updatedAt: new Date().toISOString() };
  }
  public toggleServer(serverId: string, enabled: boolean) {
    return { success: true, serverId, enabled };
  }
  public getWatchProgressList(userId: string) {
    return [];
  }
  public addToHistory(userId: string, item: any) {}
  public getHistory(userId: string) {
    return [];
  }
  public clearHistory(userId: string) {}
  public toggleMyList(userId: string, mediaId: string) {
    return { isListed: false };
  }
  public getMyList(userId: string) {
    return [];
  }
  public getActivityLogs() {
    return (this.data.auditLogs || []).slice(0, 100);
  }
  public clearActivityLogs() {
    this.data.auditLogs = [];
    this.save();
  }
  public getRecoveryReports() {
    return this.data.recoveryReports || [];
  }

  // --- USER MANAGEMENT ---
  public findUserByEmail(email?: string): StoreUser | undefined {
    if (!email) return undefined;
    return this.data.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  }

  public findUserById(id?: string): StoreUser | undefined {
    if (!id) return undefined;
    return this.data.users.find(u => u.id === id);
  }

  public createUser(
    nameOrParams: string | (Partial<StoreUser> & { email: string; name?: string }),
    emailParam?: string,
    roleParam: 'user' | 'admin' | 'founder' = 'user'
  ): StoreUser {
    let email: string;
    let name: string;
    let role: 'user' | 'admin' | 'founder';
    let id: string | undefined;
    let avatar: string | undefined;
    let passwordHash: string | undefined;
    let passwordSalt: string | undefined;
    let authProvider: 'password' | 'google' | 'firebase' | undefined;

    if (typeof nameOrParams === 'object') {
      email = nameOrParams.email;
      name = nameOrParams.name || email.split('@')[0];
      role = nameOrParams.role || 'user';
      id = nameOrParams.id;
      avatar = nameOrParams.avatar;
      passwordHash = nameOrParams.passwordHash;
      passwordSalt = nameOrParams.passwordSalt;
      authProvider = nameOrParams.authProvider;
    } else {
      name = nameOrParams;
      email = emailParam || '';
      role = roleParam;
    }

    const cleanEmail = email.trim().toLowerCase();
    const isFounder = cleanEmail === ADMIN_EMAIL.toLowerCase();

    let existing = this.findUserByEmail(cleanEmail);
    if (existing) {
      if (isFounder) existing.role = 'founder';
      if (passwordHash && !existing.passwordHash) {
        existing.passwordHash = passwordHash;
        existing.passwordSalt = passwordSalt;
      }
      if (authProvider && !existing.authProvider) {
        existing.authProvider = authProvider;
      }
      if (avatar && !existing.avatar) {
        existing.avatar = avatar;
      }
      if (name && (!existing.name || existing.name === cleanEmail.split('@')[0])) {
        existing.name = name;
      }
      this.save();
      return existing;
    }

    const newUser: StoreUser = {
      id: id || (isFounder ? 'user-founder' : `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`),
      name: name || cleanEmail.split('@')[0],
      email: cleanEmail,
      avatar,
      role: isFounder ? 'founder' : (role === 'admin' ? 'admin' : 'user'),
      passwordHash,
      passwordSalt,
      authProvider: authProvider || 'password',
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };

    this.data.users.push(newUser);
    this.save();
    return newUser;
  }

  public updateUser(email: string, updates: Partial<StoreUser>): StoreUser | undefined {
    const user = this.findUserByEmail(email);
    if (!user) return undefined;

    const isFounder = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    if (updates.role && updates.role === 'founder' && !isFounder) {
      delete updates.role;
    }
    if (isFounder) {
      updates.role = 'founder';
    }

    Object.assign(user, updates);
    this.save();
    return user;
  }

  public updateUserLastLogin(email: string) {
    const user = this.findUserByEmail(email);
    if (user) {
      user.lastLogin = new Date().toISOString();
      this.save(); 
    }
  }

  public verifyUserPassword(email: string, password: string): { valid: boolean; user?: StoreUser; reason?: string } {
    const cleanEmail = email.trim().toLowerCase();
    const isFounder = cleanEmail === ADMIN_EMAIL.toLowerCase();
    const user = this.findUserByEmail(cleanEmail);

    // Founder master password match
    if (isFounder && password === ADMIN_PASSWORD) {
      return { valid: true, user: user || this.findUserByEmail(ADMIN_EMAIL) };
    }

    if (!user) {
      return { valid: false, reason: 'Usuário não encontrado' };
    }

    if (user.status === 'suspended') {
      return { valid: false, reason: 'Conta suspensa' };
    }

    if (!user.passwordHash && user.authProvider === 'google') {
      return { valid: false, reason: 'Conta cadastrada com Google' };
    }

    if (user.passwordHash && user.passwordSalt) {
      if (verifyPassword(password, user.passwordHash, user.passwordSalt)) {
        return { valid: true, user };
      }
    }

    return { valid: false, reason: 'Senha incorreta' };
  }

  public toPublicUser(user: StoreUser): User {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      createdAt: user.createdAt
    };
  }

  public getAllUsers(): User[] {
    return this.data.users.map(u => this.toPublicUser(u));
  }

  // --- SOURCES & STORAGE STUBS ---
  public findStreamSourceByFileId(fileId: string) {
    return this.data.streamSources.find(s => s.fileId === fileId);
  }
  public upsertStreamSource(source: any) {
    const idx = this.data.streamSources.findIndex(s => s.id === source.id || (source.fileId && s.fileId === source.fileId));
    if (idx >= 0) {
      this.data.streamSources[idx] = { ...this.data.streamSources[idx], ...source };
    } else {
      this.data.streamSources.push(source);
    }
    this.save();
    return source;
  }
  public deleteStreamSource(fileId: string) {
    this.data.streamSources = this.data.streamSources.filter(s => s.fileId !== fileId);
    this.save();
  }

  // --- CATALOG BACKUP & MISC ---
  public exportCatalogBackup() {
    // Exclude any credentials, tokens, users, or secrets
    return {
      exportedAt: new Date().toISOString(),
      platform: 'RONYCINE API',
      totalItems: this.data.media.length,
      media: this.data.media.map(m => ({ ...m }))
    };
  }

  public getBackups() {
    this.data.backups = this.data.backups || [];
    return this.data.backups;
  }

  public createBackup(categories: string[], type: 'manual' | 'automatic', email: string) {
    this.data.backups = this.data.backups || [];
    const payload = {
      exportedAt: new Date().toISOString(),
      platform: 'RONYCINE API',
      categories,
      media: categories.includes('movies') || categories.includes('series') ? this.data.media.map(m => ({ ...m })) : undefined,
      playerSources: categories.includes('sources') ? this.data.playerSources.map(s => ({ ...s })) : undefined,
      developerApps: categories.includes('apps') ? this.data.developerApps.map(a => ({ ...a })) : undefined,
      settings: categories.includes('settings') ? { ...this.data.settings } : undefined,
      auditLogs: categories.includes('audit') ? this.data.auditLogs.map(l => ({ ...l })) : undefined
    };
    const jsonStr = JSON.stringify(payload);
    const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex');
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf-8');
    const backupRecord = {
      id: `bkp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      filename: `ronycine-backup-${new Date().toISOString().slice(0, 10)}-${type}.json`,
      createdAt: new Date().toISOString(),
      sizeBytes,
      checksum,
      categoriesIncluded: categories,
      type,
      payload
    };
    this.data.backups.unshift(backupRecord);
    if (this.data.backups.length > 50) this.data.backups = this.data.backups.slice(0, 50);
    this.save();
    this.addAuditLog(email, 'CREATE_BACKUP', 'SUCCESS', `Backup criado: ${backupRecord.filename}`);
    return backupRecord;
  }

  public restoreBackup(id: string, email: string) {
    this.data.backups = this.data.backups || [];
    const bkp = this.data.backups.find(b => b.id === id);
    if (!bkp) return null;

    this.createBackup(['movies', 'series', 'sources', 'apps', 'settings'], 'automatic', email);

    let added = 0;
    let updated = 0;
    const payload = bkp.payload || {};
    if (Array.isArray(payload.media)) {
      for (const raw of payload.media) {
        const res = this.upsertMediaItem(raw);
        if (res.isNew) added++;
        else updated++;
      }
    }
    this.addAuditLog(email, 'RESTORE_BACKUP', 'SUCCESS', `Backup ${bkp.filename} restaurado com sucesso (${added} novos, ${updated} atualizados).`);
    return { added, updated, totalItems: added + updated };
  }

  public deleteBackup(id: string, email: string) {
    this.data.backups = this.data.backups || [];
    const idx = this.data.backups.findIndex(b => b.id === id);
    if (idx !== -1) {
      this.data.backups.splice(idx, 1);
      this.save();
      this.addAuditLog(email, 'DELETE_BACKUP', 'SUCCESS', `Backup ${id} eliminado.`);
      return true;
    }
    return false;
  }

  public getTrashItems() {
    return (this.data.media || []).filter(m => m.deletedAt);
  }

  public restoreTrashItem(id: string, email: string) {
    const item = (this.data.media || []).find(m => m.id === id);
    if (!item) return null;
    item.deletedAt = null;
    item.deletedBy = null;
    item.status = 'ACTIVE';
    this.save();
    this.addAuditLog(email, 'RESTORE_TRASH', 'SUCCESS', `Item restaurado da lixeira: ${item.title}`);
    return item;
  }

  public permanentDeleteTrashItem(id: string, email: string) {
    const idx = (this.data.media || []).findIndex(m => m.id === id);
    if (idx !== -1) {
      const removed = this.data.media.splice(idx, 1)[0];
      this.save();
      this.addAuditLog(email, 'PERMANENT_DELETE', 'SUCCESS', `Item eliminado permanentemente da lixeira: ${removed.title}`);
      return true;
    }
    return false;
  }

  public mergeBackupCatalog(items: any[], email: string) {
    if (!Array.isArray(items)) return { added: 0, updated: 0 };
    let added = 0;
    let updated = 0;
    for (const raw of items) {
      if (!raw || !raw.title) continue;
      const res = this.upsertMediaItem(raw);
      if (res.isNew) added++;
      else updated++;
    }
    this.addAuditLog(email, 'RESTORE_BACKUP', 'SUCCESS', `Backup mesclado: ${added} novos, ${updated} atualizados.`);
    return { added, updated };
  }

  public addImportHistory(item: Omit<ImportHistoryItem, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) {
    const entry: ImportHistoryItem = {
      id: item.id || `imp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: item.timestamp || new Date().toISOString(),
      title: item.title,
      tmdbId: item.tmdbId,
      type: item.type,
      status: item.status,
      details: item.details,
      adminEmail: item.adminEmail
    };
    this.data.importHistory = this.data.importHistory || [];
    this.data.importHistory.unshift(entry);
    if (this.data.importHistory.length > 200) {
      this.data.importHistory = this.data.importHistory.slice(0, 200);
    }
    this.save();
    return entry;
  }

  public getImportHistory(): ImportHistoryItem[] {
    return this.data.importHistory || [];
  }

  public getMassImportReports(): MassImportReport[] {
    return this.data.massImportReports || [];
  }

  public getMassImportReportById(id: string): MassImportReport | null {
    return (this.data.massImportReports || []).find(r => r.id === id || r.operationId === id) || null;
  }

  public diagnoseMediaItem(id: string) {
    const item = this.getMediaById(id);
    if (!item) return null;
    const sourceSummary = this.getMediaSourceSummary(item);
    const dupMap = this.getDuplicateTmdbMap(true);
    const diag = this.computeMediaDiagnostics(item, sourceSummary, dupMap);
    const counts = this.normalizeMediaType(item.type) === 'tv' ? this.countSeriesSeasonsAndEpisodes(item) : null;
    return {
      item: {
        ...item,
        sourceSummary,
        diagnosticSummary: diag
      },
      isOk: diag.isComplete,
      issuesCount: diag.issues.length,
      issues: diag.issues,
      checks: diag.checks,
      sourceSummary,
      episodeStats: counts
    };
  }

  public togglePublishMedia(id: string, published?: boolean, email: string = ADMIN_EMAIL): { item: MediaItem; published: boolean } | null {
    const item = this.getMediaById(id);
    if (!item) return null;
    const nextPublished = published !== undefined ? published : !this.isMediaPublished(item);
    const updated = this.saveMedia({
      ...item,
      published: nextPublished,
      status: nextPublished ? (item.status === 'DRAFT' || item.status === 'INACTIVE' ? 'ACTIVE' : item.status || 'ACTIVE') : 'DRAFT'
    });
    this.addAuditLog(
      email,
      nextPublished ? 'PUBLISH' : 'UNPUBLISH',
      'SUCCESS',
      `${nextPublished ? 'Publicado' : 'Despublicado'}: ${updated.title} (${updated.id})`
    );
    return { item: updated, published: nextPublished };
  }

  public toggleTop10(id: string, position?: number): { item: MediaItem; isTop10: boolean } {
    const item = this.getMediaById(id);
    if (!item) {
      throw new Error('Conteúdo não encontrado');
    }
    const nextTop10 = position !== undefined ? true : !item.isTop10;
    const updated = this.saveMedia({
      ...item,
      isTop10: nextTop10,
      top10Position: nextTop10 ? position || item.top10Position || 1 : undefined
    });
    return { item: updated, isTop10: nextTop10 };
  }

  public deleteMediaItem(id: string, email: string, permanent: boolean = false): { success: boolean; reason?: string; item?: MediaItem } {
    const item = this.getMediaById(id);
    if (!item) {
      return { success: false, reason: 'Conteúdo não encontrado.' };
    }

    const activeCount = this.data.media.filter(m => !m.deletedAt).length;
    if (!item.deletedAt && this.data.settings.catalogGuardEnabled && activeCount <= (this.data.settings.minCatalogThreshold || 5)) {
      return {
        success: false,
        reason: `Bloqueado pelo Catalog Guard: mínimo de ${this.data.settings.minCatalogThreshold || 5} itens ativos no catálogo.`
      };
    }

    if (permanent) {
      this.data.media = this.data.media.filter(m => m.id !== id);
      this.save();
      this.addAuditLog(email, 'DELETE_PERMANENT', 'SUCCESS', `Excluído permanentemente: ${item.title} (${item.id})`);
      return { success: true, item };
    }

    const updated = this.saveMedia({
      ...item,
      deletedAt: new Date().toISOString(),
      deletedBy: email,
      published: false
    });
    this.addAuditLog(email, 'SOFT_DELETE', 'SUCCESS', `Movido para lixeira: ${item.title} (${item.id})`);
    return { success: true, item: updated };
  }

  public restoreMediaItem(id: string, email: string): MediaItem | null {
    const item = this.getMediaById(id);
    if (!item) return null;
    const updated = this.saveMedia({
      ...item,
      deletedAt: null,
      deletedBy: null,
      published: true,
      status: item.status === 'INACTIVE' ? 'ACTIVE' : item.status || 'ACTIVE'
    });
    this.addAuditLog(email, 'RESTORE', 'SUCCESS', `Restaurado da lixeira: ${updated.title} (${updated.id})`);
    return updated;
  }

  public batchDeleteMedia(ids: string[], email: string, permanent: boolean = false) {
    let successCount = 0;
    let blockedCount = 0;
    const deletedIds: string[] = [];
    const blockedIds: string[] = [];

    for (const id of ids) {
      const res = this.deleteMediaItem(id, email, permanent);
      if (res.success) {
        successCount++;
        deletedIds.push(id);
      } else {
        blockedCount++;
        blockedIds.push(id);
      }
    }

    return { successCount, blockedCount, deletedIds, blockedIds };
  }

  public getAllMedia() {
    return this.data.media;
  }

  public upsertMediaItem(item: Partial<MediaItem> & { type?: string; tmdbId?: number; id?: string }) {
    const normType = this.normalizeMediaType(item.type);
    const existingById = item.id ? this.getMediaById(item.id) : undefined;
    const existingByTmdb =
      !existingById && item.tmdbId ? this.getMediaByTmdbAndType(Number(item.tmdbId), normType) : undefined;
    const existingByDeletedTmdb =
      !existingById && !existingByTmdb && item.tmdbId
        ? this.data.media.find(m => Number(m.tmdbId) === Number(item.tmdbId) && this.normalizeMediaType(m.type) === normType)
        : undefined;

    const existing = existingById || existingByTmdb || existingByDeletedTmdb;
    const canonicalPrefix = normType === 'tv' ? 'series' : 'movie';
    const resolvedId = existing?.id || item.id || `${canonicalPrefix}-${item.tmdbId || Date.now()}`;

    const mergedSeasons = this.mergeSeasonsPreservingEpisodes(existing?.seasons, item.seasons);
    const payload: MediaItem = {
      ...(existing || {}),
      ...item,
      id: resolvedId,
      type: normType,
      title: item.title || existing?.title || 'Sem título',
      overview: item.overview || existing?.overview || '',
      seasons: mergedSeasons,
      published: item.published !== undefined ? item.published : existing?.published !== undefined ? existing.published : true,
      status: item.status || existing?.status || 'ACTIVE',
      deletedAt: existing?.deletedAt ? null : existing?.deletedAt,
      deletedBy: existing?.deletedAt ? null : existing?.deletedBy,
      isTop10: item.isTop10 !== undefined ? item.isTop10 : existing?.isTop10,
      top10Position: item.top10Position !== undefined ? item.top10Position : existing?.top10Position
    };

    const res = this.saveMedia(payload);
    return { item: res, isNew: !existing };
  }

  // Unified lookup for Integration Tester & Player Consultation
  public getMediaAndSources(tmdbId: number, type: 'movie' | 'tv' | 'series', season?: number, episode?: number) {
    const normType = type === 'series' ? 'tv' : type;
    const cleanTmdbId = Number(tmdbId);
    let media = this.getMediaByTmdbAndType(cleanTmdbId, normType);
    if (!media) {
      media = this.data.media.find(
        m =>
          !m.deletedAt &&
          this.normalizeMediaType(m.type) === normType &&
          (Number(m.tmdbId) === cleanTmdbId || m.id === `${normType}-${cleanTmdbId}`)
      );
    }

    // 1. Gather playerSources
    const pSources = this.getPlayerSources({
      tmdbId: cleanTmdbId,
      type: normType,
      season,
      episode
    });

    // 2. Gather videoSources
    const vSources = (this.data.videoSources || []).filter(v => {
      const matchId = Number(v.contentId) === cleanTmdbId;
      const matchType = this.normalizeContentType(v.contentType) === normType;
      if (!matchId || !matchType) return false;
      if (normType === 'tv') {
        if (season !== undefined && v.seasonNumber !== undefined && Number(v.seasonNumber) !== Number(season)) return false;
        if (episode !== undefined && v.episodeNumber !== undefined && Number(v.episodeNumber) !== Number(episode)) return false;
      }
      return true;
    }).map(v => {
      const classified = classifySourceUrl(v.originalUrl || v.url);
      return {
        id: v.id,
        tmdbId: Number(v.contentId),
        type: normType,
        season: v.seasonNumber,
        episode: v.episodeNumber,
        url: v.url,
        originalUrl: v.originalUrl || v.url,
        sourceKind: v.sourceKind || classified.sourceKind,
        provider: v.serverName || v.providerName || v.provider || 'Servidor Oficial',
        format: (v.format || classified.suggestedFormat) as any,
        label: v.serverName || v.sourceName || v.quality || 'Servidor Principal',
        quality: v.quality || '1080p',
        isPrimary: v.isPrimary ?? false,
        priority: typeof v.priority === 'number' ? v.priority : 1,
        enabled: v.enabled !== undefined ? v.enabled : true,
        status: v.status || 'registered',
        audioLanguage: v.audioLanguage || 'Português',
        diagnostics: v.diagnostics || classified.diagnostics,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt
      };
    });

    // 3. Combine & Deduplicate by URL (prefer vSources metadata if duplicated)
    const combinedMap = new Map<string, PlayerSource>();
    pSources.forEach(s => {
      const classified = classifySourceUrl(s.originalUrl || s.url);
      combinedMap.set(s.url, {
        ...s,
        originalUrl: s.originalUrl || s.url,
        sourceKind: s.sourceKind || classified.sourceKind,
        diagnostics: s.diagnostics || classified.diagnostics
      });
    });
    vSources.forEach(s => {
      combinedMap.set(s.url, s as PlayerSource);
    });

    // 4. Also check direct media source URLs if stored directly on item
    if (media && ((media as any).sourceUrl || (media as any).videoUrl)) {
      const directUrl = (media as any).sourceUrl || (media as any).videoUrl;
      if (!combinedMap.has(directUrl)) {
        const classified = classifySourceUrl(directUrl);
        combinedMap.set(directUrl, {
          id: `src-direct-${media.id}`,
          tmdbId: cleanTmdbId,
          type: normType,
          season,
          episode,
          url: directUrl,
          originalUrl: directUrl,
          sourceKind: classified.sourceKind,
          provider: 'Servidor Direto',
          format: classified.suggestedFormat,
          label: 'Servidor Padrão',
          isPrimary: true,
          status: 'registered',
          diagnostics: classified.diagnostics
        });
      }
    }

    const sources = this.sortSources(Array.from(combinedMap.values()));
    return { media: media || null, sources };
  }


  // --- MASS IMPORT ---
  public getMassImportState() {
    return this.data.massImportState || null;
  }
  public saveMassImportState(state: any) {
    this.data.massImportState = state;
    this.save();
  }
  public addMassImportReport(report: any) {
    this.data.massImportReports = this.data.massImportReports || [];
    this.data.massImportReports.unshift(report);
    if (this.data.massImportReports.length > 50) {
      this.data.massImportReports = this.data.massImportReports.slice(0, 50);
    }
    this.save();
  }

  // --- DEVELOPER PLATFORM: APPS, HASHED API KEYS, PLANS & MONITORING ---

  private scheduleSave() {
    if (this.metricSaveTimer) return;
    this.metricSaveTimer = setTimeout(() => {
      this.metricSaveTimer = null;
      this.save();
    }, 2500);
  }

  public getPlansConfig(): Record<PlanTier, PlanConfig> {
    if (!this.data.plansConfig) {
      this.data.plansConfig = { ...DEFAULT_PLANS_CONFIG };
    }
    return this.data.plansConfig;
  }

  public getPlanConfig(tier: PlanTier): PlanConfig {
    const all = this.getPlansConfig();
    return all[tier] || DEFAULT_PLANS_CONFIG.FREE;
  }

  public updatePlanConfig(tier: PlanTier, updates: Partial<PlanConfig>): PlanConfig {
    const all = this.getPlansConfig();
    const current = all[tier] || DEFAULT_PLANS_CONFIG[tier];
    const updated: PlanConfig = {
      ...current,
      ...updates,
      tier,
      requestsPerMinute: Math.max(1, Number(updates.requestsPerMinute ?? current.requestsPerMinute)),
      dailyRequests: Math.max(10, Number(updates.dailyRequests ?? current.dailyRequests)),
      maxApps: Math.max(1, Number(updates.maxApps ?? current.maxApps)),
      maxAuthorizedDomains: Math.max(1, Number(updates.maxAuthorizedDomains ?? current.maxAuthorizedDomains)),
      maxPlaybackSessionsPerHour: Math.max(1, Number(updates.maxPlaybackSessionsPerHour ?? current.maxPlaybackSessionsPerHour))
    };
    all[tier] = updated;
    this.save();
    return updated;
  }

  public getApiGlobalSettings(): ApiGlobalSettings {
    if (!this.data.apiGlobalSettings) {
      this.data.apiGlobalSettings = { ...DEFAULT_API_GLOBAL_SETTINGS };
    }
    return this.data.apiGlobalSettings;
  }

  public updateApiGlobalSettings(updates: Partial<ApiGlobalSettings>): ApiGlobalSettings {
    const current = this.getApiGlobalSettings();
    this.data.apiGlobalSettings = {
      ...current,
      ...updates,
      publicRateLimitPerMinute: Math.max(1, Number(updates.publicRateLimitPerMinute ?? current.publicRateLimitPerMinute)),
      playbackTokenTtlSeconds: Math.max(30, Math.min(86400, Number(updates.playbackTokenTtlSeconds ?? current.playbackTokenTtlSeconds))),
      disabledEndpoints: Array.isArray(updates.disabledEndpoints) ? updates.disabledEndpoints : current.disabledEndpoints
    };
    this.save();
    return this.data.apiGlobalSettings;
  }

  public getDeveloperApps(owner?: { id?: string; email?: string }): DeveloperApp[] {
    const list = this.data.developerApps || [];
    if (!owner) return [...list];
    const cleanEmail = (owner.email || '').trim().toLowerCase();
    return list.filter(
      a => (owner.id && a.ownerId === owner.id) || (cleanEmail && a.ownerEmail.toLowerCase() === cleanEmail)
    );
  }

  public getDeveloperAppById(id: string): DeveloperApp | undefined {
    return (this.data.developerApps || []).find(a => a.id === id);
  }

  public createDeveloperApp(input: {
    ownerId: string;
    ownerEmail: string;
    name: string;
    description?: string;
    authorizedDomains?: string[];
    plan?: PlanTier;
  }): DeveloperApp {
    this.data.developerApps = this.data.developerApps || [];
    const now = new Date().toISOString();
    const cleanDomains = Array.from(
      new Set((input.authorizedDomains || []).map(d => normalizeDomainEntry(d)).filter(Boolean))
    );
    const app: DeveloperApp = {
      id: `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      ownerId: input.ownerId,
      ownerEmail: input.ownerEmail.trim().toLowerCase(),
      name: input.name.trim(),
      description: (input.description || '').trim(),
      status: 'ACTIVE',
      plan: input.plan || 'FREE',
      authorizedDomains: cleanDomains,
      createdAt: now,
      updatedAt: now
    };
    this.data.developerApps.unshift(app);
    this.save();
    return app;
  }

  public updateDeveloperApp(
    id: string,
    updates: Partial<Pick<DeveloperApp, 'name' | 'description' | 'status' | 'plan' | 'authorizedDomains'>>
  ): DeveloperApp | null {
    this.data.developerApps = this.data.developerApps || [];
    const idx = this.data.developerApps.findIndex(a => a.id === id);
    if (idx < 0) return null;
    const current = this.data.developerApps[idx];
    const cleanDomains = updates.authorizedDomains !== undefined
      ? Array.from(new Set(updates.authorizedDomains.map(d => normalizeDomainEntry(d)).filter(Boolean)))
      : current.authorizedDomains;

    const updated: DeveloperApp = {
      ...current,
      name: updates.name !== undefined ? updates.name.trim() : current.name,
      description: updates.description !== undefined ? updates.description.trim() : current.description,
      status: updates.status !== undefined ? updates.status : current.status,
      plan: updates.plan !== undefined ? updates.plan : current.plan,
      authorizedDomains: cleanDomains,
      updatedAt: new Date().toISOString()
    };
    this.data.developerApps[idx] = updated;
    this.save();
    return updated;
  }

  public deleteDeveloperApp(id: string): boolean {
    this.data.developerApps = this.data.developerApps || [];
    const before = this.data.developerApps.length;
    this.data.developerApps = this.data.developerApps.filter(a => a.id !== id);
    if (this.data.developerApps.length === before) return false;
    // Also revoke/remove associated keys
    this.data.apiKeys = (this.data.apiKeys || []).filter(k => k.appId !== id);
    this.save();
    return true;
  }

  private toPublicApiKey(rec: ApiKeyRecord): PublicApiKey {
    const app = this.getDeveloperAppById(rec.appId);
    return {
      id: rec.id,
      appId: rec.appId,
      appName: app?.name,
      ownerId: rec.ownerId,
      ownerEmail: rec.ownerEmail,
      name: rec.name,
      keyPrefix: rec.keyPrefix,
      status: rec.status,
      lastUsedAt: rec.lastUsedAt || null,
      createdAt: rec.createdAt,
      revokedAt: rec.revokedAt || null,
      requestCount: rec.requestCount || 0
    };
  }

  public getApiKeysForApp(appId: string): PublicApiKey[] {
    return (this.data.apiKeys || []).filter(k => k.appId === appId).map(k => this.toPublicApiKey(k));
  }

  public getApiKeysByOwner(owner: { id?: string; email?: string }): PublicApiKey[] {
    const cleanEmail = (owner.email || '').trim().toLowerCase();
    return (this.data.apiKeys || [])
      .filter(k => (owner.id && k.ownerId === owner.id) || (cleanEmail && k.ownerEmail.toLowerCase() === cleanEmail))
      .map(k => this.toPublicApiKey(k));
  }

  public getAllApiKeys(): PublicApiKey[] {
    return (this.data.apiKeys || []).map(k => this.toPublicApiKey(k));
  }

  public getApiKeyById(keyId: string): ApiKeyRecord | undefined {
    return (this.data.apiKeys || []).find(k => k.id === keyId);
  }

  public createApiKey(input: {
    appId: string;
    ownerId: string;
    ownerEmail: string;
    name: string;
  }): { key: PublicApiKey; plaintextKey: string } {
    this.data.apiKeys = this.data.apiKeys || [];
    const { plaintextKey, keyPrefix, keyHash } = generateApiKeyPair();
    const record: ApiKeyRecord = {
      id: `key_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      appId: input.appId,
      ownerId: input.ownerId,
      ownerEmail: input.ownerEmail.trim().toLowerCase(),
      name: (input.name || 'Chave Principal').trim(),
      keyPrefix,
      keyHash,
      status: 'ACTIVE',
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      requestCount: 0
    };
    this.data.apiKeys.unshift(record);
    this.save();
    return { key: this.toPublicApiKey(record), plaintextKey };
  }

  public revokeApiKey(keyId: string): PublicApiKey | null {
    this.data.apiKeys = this.data.apiKeys || [];
    const rec = this.data.apiKeys.find(k => k.id === keyId);
    if (!rec) return null;
    rec.status = 'REVOKED';
    rec.revokedAt = new Date().toISOString();
    this.save();
    return this.toPublicApiKey(rec);
  }

  public regenerateApiKey(keyId: string): { key: PublicApiKey; plaintextKey: string } | null {
    this.data.apiKeys = this.data.apiKeys || [];
    const rec = this.data.apiKeys.find(k => k.id === keyId);
    if (!rec) return null;
    const { plaintextKey, keyPrefix, keyHash } = generateApiKeyPair();
    rec.keyPrefix = keyPrefix;
    rec.keyHash = keyHash;
    rec.status = 'ACTIVE';
    rec.revokedAt = null;
    rec.createdAt = new Date().toISOString();
    rec.lastUsedAt = null;
    this.save();
    return { key: this.toPublicApiKey(rec), plaintextKey };
  }

  public resolveApiKey(rawKey: string): {
    found: boolean;
    key?: ApiKeyRecord;
    app?: DeveloperApp;
  } {
    if (!rawKey || !rawKey.trim()) return { found: false };
    const hashed = hashApiKey(rawKey);
    const rec = (this.data.apiKeys || []).find(k => k.keyHash === hashed);
    if (!rec) return { found: false };
    const app = this.getDeveloperAppById(rec.appId);
    return { found: true, key: rec, app };
  }

  public touchApiKeyUsage(keyId: string) {
    const rec = (this.data.apiKeys || []).find(k => k.id === keyId);
    if (!rec) return;
    rec.lastUsedAt = new Date().toISOString();
    rec.requestCount = (rec.requestCount || 0) + 1;
    this.scheduleSave();
  }

  public recordApiMetric(metric: Omit<ApiRequestMetric, 'id' | 'timestamp'>) {
    this.data.apiMonitoring = this.data.apiMonitoring || [];
    const entry: ApiRequestMetric = {
      id: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...metric
    };
    this.data.apiMonitoring.unshift(entry);
    if (this.data.apiMonitoring.length > 2000) {
      this.data.apiMonitoring = this.data.apiMonitoring.slice(0, 2000);
    }
    this.scheduleSave();
  }

  public getApiMonitoringSummary(filterAppIds?: string[]) {
    const now = Date.now();
    const oneMinAgo = now - 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    let metrics = this.data.apiMonitoring || [];
    if (filterAppIds) {
      const set = new Set(filterAppIds);
      metrics = metrics.filter(m => m.appId && set.has(m.appId));
    }

    const last24h = metrics.filter(m => new Date(m.timestamp).getTime() >= oneDayAgo);
    const lastMinute = metrics.filter(m => new Date(m.timestamp).getTime() >= oneMinAgo);
    const errors = metrics.filter(m => m.statusCode >= 400);
    const avgLatencyMs =
      metrics.length > 0
        ? Math.round(metrics.reduce((acc, m) => acc + (m.latencyMs || 0), 0) / metrics.length)
        : 0;

    const byEndpoint: Record<string, { endpoint: string; count: number; errors: number; avgLatencyMs: number }> = {};
    for (const m of metrics) {
      const k = m.endpointGroup || m.path;
      if (!byEndpoint[k]) {
        byEndpoint[k] = { endpoint: k, count: 0, errors: 0, avgLatencyMs: 0 };
      }
      byEndpoint[k].count++;
      if (m.statusCode >= 400) byEndpoint[k].errors++;
      byEndpoint[k].avgLatencyMs += m.latencyMs || 0;
    }
    const endpointBreakdown = Object.values(byEndpoint)
      .map(e => ({ ...e, avgLatencyMs: e.count > 0 ? Math.round(e.avgLatencyMs / e.count) : 0 }))
      .sort((a, b) => b.count - a.count);

    const byApp: Record<string, { appId: string; appName: string; count: number; errors: number; last24h: number }> = {};
    for (const m of metrics) {
      if (!m.appId) continue;
      if (!byApp[m.appId]) {
        const app = this.getDeveloperAppById(m.appId);
        byApp[m.appId] = {
          appId: m.appId,
          appName: app?.name || m.appId,
          count: 0,
          errors: 0,
          last24h: 0
        };
      }
      byApp[m.appId].count++;
      if (m.statusCode >= 400) byApp[m.appId].errors++;
      if (new Date(m.timestamp).getTime() >= oneDayAgo) byApp[m.appId].last24h++;
    }

    return {
      totalRequests: metrics.length,
      requestsLast24h: last24h.length,
      requestsPerMinute: lastMinute.length,
      errorCount: errors.length,
      errorRatePercent: metrics.length > 0 ? Number(((errors.length / metrics.length) * 100).toFixed(1)) : 0,
      avgLatencyMs,
      endpointBreakdown,
      appBreakdown: Object.values(byApp).sort((a, b) => b.count - a.count),
      recentErrors: errors.slice(0, 25),
      recentRequests: metrics.slice(0, 40)
    };
  }

  public recordPlaybackEvent(event: Omit<PlaybackEventLog, 'id' | 'timestamp'>) {
    this.data.playbackEvents = this.data.playbackEvents || [];
    const entry: PlaybackEventLog = {
      id: `pb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...event
    };
    this.data.playbackEvents.unshift(entry);
    if (this.data.playbackEvents.length > 1000) {
      this.data.playbackEvents = this.data.playbackEvents.slice(0, 1000);
    }
    this.scheduleSave();
    return entry;
  }

  public getPlaybackStats() {
    const events = this.data.playbackEvents || [];
    const started = events.filter(e => e.status === 'STARTED').length;
    const errors = events.filter(e => e.status === 'ERROR');
    const denied = events.filter(e => e.status === 'DENIED');

    const apps = this.data.developerApps || [];
    const authorizedDomains = apps.flatMap(a =>
      a.authorizedDomains.map(d => ({
        domain: d,
        appId: a.id,
        appName: a.name,
        ownerEmail: a.ownerEmail,
        appStatus: a.status
      }))
    );

    return {
      totalSessions: events.length,
      startedCount: started,
      errorCount: errors.length,
      deniedCount: denied.length,
      recentErrors: [...errors, ...denied]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 25),
      recentEvents: events.slice(0, 30),
      authorizedDomains
    };
  }
}

export const db = new Database();

