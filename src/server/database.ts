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
  Episode,
  SeasonComparisonStats,
  SeriesComparisonReport,
  BackupRecord,
  BackupImportJob,
  PlanTier,
  PlanConfig,
  DeveloperApp,
  ApiKeyRecord,
  PublicApiKey,
  ApiGlobalSettings,
  ApiRequestMetric,
  PlaybackEventLog,
  SeasonSourceTemplate,
  BatchEpisodeSourcesResult,
  WatchProgress,
  LinkImportHistoryItem,
  SeasonDiscoveryJob,
  AdCampaign,
  ConnectedSiteRecord
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
import {
  normalizeVersionType,
  isSourceDublado,
  isSourceLegendado
} from '../lib/sourceMetadata.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'playfilme_store.json');
const BACKUP_FILE = path.join(DATA_DIR, 'playfilme_store.backup.json');

export interface StoreUser extends User {
  passwordHash?: string;
  passwordSalt?: string;
  authProvider?: 'password' | 'google' | 'firebase';
  status?: 'active' | 'suspended' | 'blocked' | 'banned';
  lastLogin?: string;
}

export interface BackupSettingsConfig {
  autoBackupEnabled: boolean;
  autoBackupIntervalHours: number;
  lastBackupAt: string | null;
  lastImportAt: string | null;
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
  linkImportHistory?: LinkImportHistoryItem[];
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
  watchProgress?: WatchProgress[];
  backups?: any[];
  backupRecords?: BackupRecord[];
  backupImportJobs?: BackupImportJob[];
  backupConfig?: BackupSettingsConfig;
  seasonDiscoveryJobs?: SeasonDiscoveryJob[];
  adCampaigns?: AdCampaign[];
  connectedSites?: ConnectedSiteRecord[];
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
    linkImportHistory: [],
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
    seasonSourceTemplates: {},
    watchProgress: [],
    backupRecords: [],
    backupImportJobs: [],
    backupConfig: {
      autoBackupEnabled: false,
      autoBackupIntervalHours: 24,
      lastBackupAt: null,
      lastImportAt: null
    }
  };

  private mediaIndexByTmdbAndType = new Map<string, MediaItem>();
  private mediaIndexById = new Map<string, MediaItem>();

  constructor() {
    this.init();
  }

  private parseSeasonNum(val: any, fallback = 1): number {
    if (val === undefined || val === null || val === '') return fallback;
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.floor(n));
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
      linkImportHistory: parsed.linkImportHistory || [],
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
      watchProgress: parsed.watchProgress || [],
      backups: parsed.backups || [],
      backupRecords: parsed.backupRecords || [],
      backupImportJobs: parsed.backupImportJobs || [],
      backupConfig: {
        autoBackupEnabled: Boolean(parsed.backupConfig?.autoBackupEnabled),
        autoBackupIntervalHours: Number(parsed.backupConfig?.autoBackupIntervalHours || 24),
        lastBackupAt: parsed.backupConfig?.lastBackupAt || null,
        lastImportAt: parsed.backupConfig?.lastImportAt || null
      },
      adCampaigns: parsed.adCampaigns || [],
      connectedSites: parsed.connectedSites || []
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
        posterPath: 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
        backdropPath: 'https://image.tmdb.org/t/p/w1280/c6OLXfKAk5BKeR6broC8pYiCquX.jpg',
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
        posterPath: 'https://image.tmdb.org/t/p/w500/aqomTRKjNZkmNEeOZnEmWrFTmKU.jpg',
        backdropPath: 'https://image.tmdb.org/t/p/w1280/zZqpAXxVSBtxV9qPBcscfXBcL2w.jpg',
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

  public normalizeCategories(cats?: string[] | null): Array<'anime' | 'dorama'> {
    if (!Array.isArray(cats)) return [];
    const out = new Set<'anime' | 'dorama'>();
    for (const raw of cats) {
      const c = String(raw || '').toLowerCase().trim();
      if (c === 'anime' || c === 'animes') out.add('anime');
      else if (c === 'dorama' || c === 'doramas' || c === 'kdrama' || c === 'k-drama' || c === 'jdrama' || c === 'j-drama' || c === 'cdrama' || c === 'c-drama') {
        out.add('dorama');
      }
    }
    return Array.from(out);
  }

  public hasCategory(item: MediaItem, category: 'anime' | 'dorama'): boolean {
    if (Array.isArray(item.categories)) {
      const explicit = this.normalizeCategories(item.categories);
      if (explicit.includes(category)) return true;
      if (explicit.length > 0 || item.importSource === 'smart_importer') return false;
    }

    const genresLower = (item.genres || []).map(g => this.normalizeText(g));
    const isAnimation = genresLower.some(g => g.includes('animacao') || g.includes('animation') || g.includes('anime'));
    const origLang = (item.originalLanguage || '').toLowerCase().trim();
    const countries = (item.originCountry || []).map(c => c.toUpperCase().trim());

    if (category === 'anime') {
      return isAnimation && (origLang === 'ja' || countries.includes('JP'));
    }

    if (category === 'dorama') {
      if (isAnimation) return false;
      const isEastAsian =
        countries.some(c => ['KR', 'JP', 'CN', 'TW', 'TH'].includes(c)) ||
        ['ko', 'ja', 'zh', 'th'].includes(origLang);
      const isDramaRomance = genresLower.some(
        g => g.includes('drama') || g.includes('romance') || g.includes('soap') || g.includes('melodrama')
      );
      return isEastAsian && isDramaRomance;
    }

    return false;
  }

  public hasPlayableSource(item: MediaItem): boolean {
    const sSummary = this.getMediaSourceSummary(item);
    return (
      sSummary.hasSource &&
      sSummary.onlineCount + sSummary.registeredCount + sSummary.validatingCount + sSummary.unverifiableCount > 0
    );
  }

  private matchesSeasonEpisode(item: MediaItem, season?: number, episode?: number): boolean {
    if (season === undefined && episode === undefined) return true;
    if (this.normalizeMediaType(item.type) !== 'tv') return false;
    const seasons = Array.isArray(item.seasons) ? item.seasons : [];

    if (season !== undefined) {
      const matchedSeason = seasons.find(s => Number(s.seasonNumber) === season);
      const hasSourceMatch = (this.data.playerSources || []).some(
        p =>
          Number(p.tmdbId) === Number(item.tmdbId) &&
          this.normalizeMediaType(p.type) === 'tv' &&
          Number(p.season) === season &&
          (episode === undefined || Number(p.episode) === episode)
      ) || (this.data.videoSources || []).some(
        v =>
          Number(v.contentId) === Number(item.tmdbId) &&
          this.normalizeMediaType(v.contentType) === 'tv' &&
          Number(v.seasonNumber) === season &&
          (episode === undefined || Number(v.episodeNumber) === episode)
      );
      if (!matchedSeason && !hasSourceMatch) return false;
      if (episode === undefined) return true;
      if (hasSourceMatch) return true;
      const eps = Array.isArray(matchedSeason?.episodes) ? matchedSeason!.episodes! : [];
      if (eps.some(ep => Number(ep.episodeNumber) === episode)) return true;
      if (Number(matchedSeason?.episodeCount || 0) >= episode && episode >= 1) return true;
      return false;
    }

    // Only episode filter without season specified
    return seasons.some(
      s =>
        (Array.isArray(s.episodes) && s.episodes.some(ep => Number(ep.episodeNumber) === episode)) ||
        (Number(s.episodeCount || 0) >= Number(episode || 0))
    );
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
      case 'popularity':
        return arr.sort((a, b) => {
          const scoreA =
            Number(a.popularity || 0) * 10 +
            (a.popular ? 500 : 0) +
            (a.voteCount || 0) * 0.1 +
            (a.voteAverage || 0) * 20;
          const scoreB =
            Number(b.popularity || 0) * 10 +
            (b.popular ? 500 : 0) +
            (b.voteCount || 0) * 0.1 +
            (b.voteAverage || 0) * 20;
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
    category?: string;
    genre?: string;
    search?: string;
    section?: string;
    season?: number;
    episode?: number;
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

    if (filter?.category && filter.category !== 'all') {
      const cat = filter.category.toLowerCase().trim();
      if (cat === 'anime' || cat === 'animes') {
        list = list.filter(m => this.hasCategory(m, 'anime'));
      } else if (cat === 'dorama' || cat === 'doramas') {
        list = list.filter(m => this.hasCategory(m, 'dorama'));
      }
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

    if (filter?.season !== undefined || filter?.episode !== undefined) {
      list = list.filter(m => this.matchesSeasonEpisode(m, filter.season, filter.episode));
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
    const items = list.slice((page - 1) * limit, page * limit).map(m => {
      const counts = this.normalizeMediaType(m.type) === 'tv' ? this.countSeriesSeasonsAndEpisodes(m) : null;
      return {
        ...m,
        categories: Array.isArray(m.categories) ? this.normalizeCategories(m.categories) : [
          ...(this.hasCategory(m, 'anime') ? ['anime'] : []),
          ...(this.hasCategory(m, 'dorama') ? ['dorama'] : [])
        ],
        seasonsCount: counts ? counts.seasonsCount : m.seasonsCount,
        episodesCount: counts ? counts.episodesCount : m.episodesCount,
        hasPlayableSource: this.hasPlayableSource(m),
        inCatalog: true
      };
    });

    return { items, total, page, totalPages };
  }

  public getCatalogTrending(options?: { tab?: string; limit?: number }): MediaItem[] {
    const tab = (options?.tab || 'trending').toLowerCase();
    const limit = Math.max(1, Math.min(50, options?.limit || 18));
    let list = this.data.media.filter(m => this.isMediaPublished(m));

    if (tab === 'movies') {
      list = list.filter(m => this.normalizeMediaType(m.type) === 'movie');
    } else if (tab === 'series') {
      list = list.filter(m => this.normalizeMediaType(m.type) === 'tv');
    } else if (tab === 'animes') {
      list = list.filter(m => this.hasCategory(m, 'anime'));
    } else if (tab === 'doramas') {
      list = list.filter(m => this.hasCategory(m, 'dorama'));
    }

    const enriched = list.map(m => {
      const counts = this.normalizeMediaType(m.type) === 'tv' ? this.countSeriesSeasonsAndEpisodes(m) : null;
      return {
        ...m,
        categories: Array.isArray(m.categories)
          ? this.normalizeCategories(m.categories)
          : [
              ...(this.hasCategory(m, 'anime') ? ['anime'] : []),
              ...(this.hasCategory(m, 'dorama') ? ['dorama'] : [])
            ],
        seasonsCount: counts ? counts.seasonsCount : m.seasonsCount,
        episodesCount: counts ? counts.episodesCount : m.episodesCount,
        hasPlayableSource: this.hasPlayableSource(m),
        inCatalog: true
      };
    });

    if (tab === 'recent') {
      return enriched
        .sort(
          (a, b) =>
            new Date(b.createdAt || b.updatedAt || 0).getTime() -
            new Date(a.createdAt || a.updatedAt || 0).getTime()
        )
        .slice(0, limit);
    }

    return enriched
      .sort((a, b) => {
        const scoreA =
          (a.hasPlayableSource ? 10000 : 0) +
          (a.trending ? 3000 : 0) +
          (a.popular ? 1500 : 0) +
          Number(a.popularity || 0) * 10 +
          Number(a.voteAverage || 0) * 20;
        const scoreB =
          (b.hasPlayableSource ? 10000 : 0) +
          (b.trending ? 3000 : 0) +
          (b.popular ? 1500 : 0) +
          Number(b.popularity || 0) * 10 +
          Number(b.voteAverage || 0) * 20;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      })
      .slice(0, limit);
  }

  // Dedicated Admin Catalog Query (never hides incomplete/unpublished items, attaches source + diagnostic summaries & DB integrity audit)
  public getAdminCatalog(filter?: {
    type?: string;
    category?: string;
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

    if (filter?.category && filter.category !== 'all') {
      const cat = filter.category.toLowerCase().trim();
      if (cat === 'anime' || cat === 'animes') {
        list = list.filter(m => this.hasCategory(m, 'anime'));
      } else if (cat === 'dorama' || cat === 'doramas') {
        list = list.filter(m => this.hasCategory(m, 'dorama'));
      }
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
      const resolvedCategories = Array.isArray(m.categories)
        ? this.normalizeCategories(m.categories)
        : [
            ...(this.hasCategory(m, 'anime') ? ['anime'] : []),
            ...(this.hasCategory(m, 'dorama') ? ['dorama'] : [])
          ];
      return {
        ...m,
        categories: resolvedCategories,
        seasonsCount: counts ? counts.seasonsCount : m.seasonsCount,
        episodesCount: counts ? counts.episodesCount : m.episodesCount,
        published: m.published !== false && m.status !== 'DRAFT' && m.status !== 'INACTIVE',
        hasPlayableSource:
          sourceSummary.hasSource &&
          sourceSummary.onlineCount + sourceSummary.registeredCount + sourceSummary.validatingCount + sourceSummary.unverifiableCount > 0,
        inCatalog: true,
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

  private mergeEpisodesPreservingMetadata(existingEps?: Episode[], incomingEps?: Episode[]): Episode[] {
    const prevList = Array.isArray(existingEps) ? existingEps : [];
    const incList = Array.isArray(incomingEps) ? incomingEps : [];
    if (incList.length === 0) return [...prevList].sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
    if (prevList.length === 0) return [...incList].sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));

    const mergedMap = new Map<number, Episode>();
    for (const prev of prevList) {
      mergedMap.set(Number(prev.episodeNumber), { ...prev });
    }
    for (const inc of incList) {
      const epNum = Number(inc.episodeNumber);
      const prev = mergedMap.get(epNum);
      if (!prev) {
        mergedMap.set(epNum, { ...inc });
      } else {
        const isGenericPrev = !prev.title || /^epis[oó]dio\s+\d+$/i.test(prev.title.trim());
        const resolvedTitle =
          !inc.title
            ? prev.title
            : isGenericPrev || (prev.title && inc.title.trim() !== prev.title.trim() && !/^epis[oó]dio\s+\d+$/i.test(inc.title.trim()))
              ? inc.title
              : prev.title;
        mergedMap.set(epNum, {
          ...prev,
          ...inc,
          id: prev.id || inc.id,
          tmdbId: inc.tmdbId || prev.tmdbId,
          seasonNumber: this.parseSeasonNum(inc.seasonNumber, this.parseSeasonNum(prev.seasonNumber, 1)),
          episodeNumber: epNum,
          title: resolvedTitle || prev.title || `Episódio ${epNum}`,
          overview: inc.overview || prev.overview || '',
          stillPath: inc.stillPath || prev.stillPath,
          duration: inc.duration || prev.duration,
          airDate: inc.airDate || prev.airDate,
          voteAverage: inc.voteAverage !== undefined ? inc.voteAverage : prev.voteAverage,
          extraMetadata:
            prev.extraMetadata || inc.extraMetadata
              ? { ...(prev.extraMetadata || {}), ...(inc.extraMetadata || {}) }
              : undefined
        });
      }
    }
    return Array.from(mergedMap.values()).sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
  }

  private mergeSeasonsPreservingEpisodes(existingSeasons?: Season[], incomingSeasons?: Season[]): Season[] | undefined {
    if (!incomingSeasons || incomingSeasons.length === 0) return existingSeasons;
    if (!existingSeasons || existingSeasons.length === 0) {
      return [...incomingSeasons].sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));
    }

    const existingMap = new Map<number, Season>();
    for (const s of existingSeasons) {
      existingMap.set(Number(s.seasonNumber), s);
    }

    const merged: Season[] = incomingSeasons.map(inc => {
      const sNum = Number(inc.seasonNumber);
      const prev = existingMap.get(sNum);
      if (!prev) return inc;
      const mergedEpisodes = this.mergeEpisodesPreservingMetadata(prev.episodes, inc.episodes);
      return {
        ...prev,
        ...inc,
        id: prev.id || inc.id,
        seasonNumber: sNum,
        name: inc.name || prev.name || (sNum === 0 ? 'Especiais' : `Temporada ${sNum}`),
        overview: inc.overview || prev.overview,
        posterPath: inc.posterPath || prev.posterPath,
        episodeCount: Math.max(Number(inc.episodeCount || 0), Number(prev.episodeCount || 0), mergedEpisodes.length),
        episodes: mergedEpisodes
      };
    });

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

      if (filter?.tmdbId && Number(s.tmdbId) === Number(filter.tmdbId)) {
        if (this.normalizeContentType(s.type) === 'tv') {
          if (filter.season !== undefined && Number(s.season) !== Number(filter.season)) return false;
          if (filter.episode !== undefined && Number(s.episode) !== Number(filter.episode)) return false;
        }
        return true;
      }

      if (filter?.imdbId && s.imdbId === filter.imdbId) {
        if (this.normalizeContentType(s.type) === 'tv') {
          if (filter.season !== undefined && Number(s.season) !== Number(filter.season)) return false;
          if (filter.episode !== undefined && Number(s.episode) !== Number(filter.episode)) return false;
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

  private firestoreBackoffUntil = 0;

  private sanitizeForFirestore<T>(value: T): T {
    if (value === null || value === undefined || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value
        .filter(item => item !== undefined)
        .map(item => this.sanitizeForFirestore(item)) as unknown as T;
    }
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        clean[k] = this.sanitizeForFirestore(v);
      }
    }
    return clean as T;
  }

  private mirrorFirestoreAsync(label: string, task: () => Promise<any>) {
    if (Date.now() < this.firestoreBackoffUntil) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutSentinel = new Promise<{ timedOut: true }>(resolve => {
      timer = setTimeout(() => resolve({ timedOut: true }), 2000);
    });
    Promise.race([
      Promise.resolve()
        .then(() => task())
        .then(res => ({ timedOut: false as const, res })),
      timeoutSentinel
    ])
      .then(outcome => {
        if (timer) clearTimeout(timer);
        if (outcome && outcome.timedOut) {
          this.firestoreBackoffUntil = Date.now() + 15 * 60 * 1000;
        }
      })
      .catch((e: any) => {
        if (timer) clearTimeout(timer);
        const code = String(e?.code || '');
        const msg = String(e?.message || e || '');
        if (code === '7' || msg.includes('PERMISSION_DENIED')) {
          this.firestoreBackoffUntil = Date.now() + 15 * 60 * 1000;
          return;
        }
        this.firestoreBackoffUntil = Date.now() + 5 * 60 * 1000;
        console.info(`[Firestore Background Sync Paused] ${label}: ${msg}`);
      });
  }

  public async getVideoSources(filter?: { contentId?: number; contentType?: 'movie' | 'tv' | string; seasonNumber?: number; episodeNumber?: number; status?: string }) {
    const normType = filter?.contentType ? this.normalizeContentType(filter.contentType) : undefined;
    let list = this.data.videoSources || [];
    if (filter?.contentId) list = list.filter(s => Number(s.contentId) === Number(filter.contentId));
    if (normType) list = list.filter(s => this.normalizeContentType(s.contentType) === normType);
    if (filter?.seasonNumber !== undefined) list = list.filter(s => Number(s.seasonNumber) === Number(filter.seasonNumber));
    if (filter?.episodeNumber !== undefined) list = list.filter(s => Number(s.episodeNumber) === Number(filter.episodeNumber));
    if (filter?.status) list = list.filter(s => s.status === filter.status);
    return this.sortSources(list);
  }

  public async addVideoSource(
    source: Omit<VideoSource, 'id' | 'createdAt' | 'updatedAt'>,
    opts?: { skipSave?: boolean }
  ) {
    const id = `vid-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const normType = this.normalizeContentType(source.contentType);
    const classified = classifySourceUrl(source.url);
    const originalUrl = source.originalUrl || classified.originalUrl || source.url;
    const sourceKind = source.sourceKind || classified.sourceKind;
    const format = source.format || classified.suggestedFormat;
    const initialStatus = source.status && source.status !== 'unverified' ? source.status : 'registered';
    const parsedSeason = normType === 'tv' ? this.parseSeasonNum(source.seasonNumber, 1) : undefined;
    const parsedEp = normType === 'tv' ? Math.max(1, Number(source.episodeNumber || 1)) : undefined;

    const newSource: VideoSource = {
      ...source,
      id,
      contentId: Number(source.contentId),
      contentType: normType,
      seasonNumber: parsedSeason,
      episodeNumber: parsedEp,
      url: originalUrl,
      originalUrl,
      sourceKind,
      format,
      status: initialStatus,
      isPrimary:
        source.isPrimary ??
        (this.data.videoSources || []).filter(
          v =>
            Number(v.contentId) === Number(source.contentId) &&
            this.normalizeContentType(v.contentType) === normType &&
            (normType !== 'tv' ||
              (this.parseSeasonNum(v.seasonNumber, 1) === parsedSeason &&
                Math.max(1, Number(v.episodeNumber || 1)) === parsedEp))
        ).length === 0,
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

    this.mirrorFirestoreAsync(`add:${id}`, () =>
      adminDb.collection('videoSources').doc(id).set(this.sanitizeForFirestore(newSource))
    );

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
      subtitleLanguage: newSource.subtitleLanguage,
      versionType: newSource.versionType,
      subtitleUrl: newSource.subtitleUrl,
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

    if (!opts?.skipSave) {
      this.save();
    }
    return newSource;
  }

  public async updateVideoSource(id: string, updates: Partial<VideoSource>) {
    const now = new Date().toISOString();
    const enrichedUpdates: Partial<VideoSource> = { ...updates, updatedAt: now };

    if (updates.subtitleUrl !== undefined) {
      const cleanSub = String(updates.subtitleUrl || '').trim();
      enrichedUpdates.subtitleUrl = cleanSub || undefined;
    }

    if (updates.versionType !== undefined) {
      enrichedUpdates.versionType = normalizeVersionType(updates.versionType) || updates.versionType;
    }

    if (updates.url) {
      const classified = classifySourceUrl(updates.url);
      enrichedUpdates.url = classified.originalUrl || updates.url;
      enrichedUpdates.originalUrl = classified.originalUrl || updates.url;
      enrichedUpdates.sourceKind = updates.sourceKind || classified.sourceKind;
      enrichedUpdates.diagnostics = updates.diagnostics || classified.diagnostics;
    }

    this.mirrorFirestoreAsync(`update:${id}`, () => {
      const ref = adminDb.collection('videoSources').doc(id);
      const firestorePayload = this.sanitizeForFirestore({ ...enrichedUpdates }) as Record<string, any>;
      if (updates.subtitleUrl !== undefined && !enrichedUpdates.subtitleUrl) {
        firestorePayload.subtitleUrl = '';
      }
      return ref.update(firestorePayload);
    });

    this.data.videoSources = this.data.videoSources || [];
    const idx = this.data.videoSources.findIndex(s => s.id === id);
    const pIdx = this.data.playerSources.findIndex(s => s.id === `src-${id}` || s.id === id);
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
    } else if (pIdx >= 0) {
      const legacy = this.data.playerSources[pIdx];
      const normType = this.normalizeContentType(legacy.type);
      if (enrichedUpdates.isPrimary) {
        this.data.playerSources.forEach((s, i) => {
          if (
            i !== pIdx &&
            Number(s.tmdbId) === Number(legacy.tmdbId) &&
            this.normalizeContentType(s.type) === normType &&
            (normType !== 'tv' || (s.season === legacy.season && s.episode === legacy.episode))
          ) {
            s.isPrimary = false;
          }
        });
      }
      updatedRecord = {
        id: legacy.id,
        contentId: Number(legacy.tmdbId),
        contentType: normType,
        seasonNumber: legacy.season,
        episodeNumber: legacy.episode,
        url: enrichedUpdates.url ?? legacy.url,
        originalUrl: enrichedUpdates.originalUrl ?? legacy.originalUrl ?? legacy.url,
        sourceKind: enrichedUpdates.sourceKind ?? legacy.sourceKind,
        format: (enrichedUpdates.format ?? legacy.format) as any,
        serverName: enrichedUpdates.serverName ?? legacy.provider ?? legacy.label,
        quality: enrichedUpdates.quality ?? legacy.quality,
        audioLanguage: enrichedUpdates.audioLanguage ?? legacy.audioLanguage,
        subtitleLanguage: enrichedUpdates.subtitleLanguage ?? legacy.subtitleLanguage,
        versionType: (enrichedUpdates.versionType ?? legacy.versionType) as any,
        subtitleUrl: updates.subtitleUrl !== undefined ? enrichedUpdates.subtitleUrl : legacy.subtitleUrl,
        isPrimary: enrichedUpdates.isPrimary ?? legacy.isPrimary,
        priority: enrichedUpdates.priority ?? legacy.priority,
        enabled: enrichedUpdates.enabled ?? legacy.enabled,
        status: (enrichedUpdates.status ?? legacy.status ?? 'registered') as any,
        diagnostics: enrichedUpdates.diagnostics ?? legacy.diagnostics,
        createdAt: legacy.createdAt || now,
        updatedAt: now
      };
    } else {
      updatedRecord = { id, ...(enrichedUpdates as any) } as VideoSource;
    }

    // Sync update into playerSources
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
        subtitleLanguage: updatedRecord.subtitleLanguage ?? this.data.playerSources[pIdx].subtitleLanguage,
        versionType: updatedRecord.versionType ?? this.data.playerSources[pIdx].versionType,
        subtitleUrl: updates.subtitleUrl !== undefined ? updatedRecord.subtitleUrl : this.data.playerSources[pIdx].subtitleUrl,
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

  public async deleteVideoSource(id: string, opts?: { skipSave?: boolean }) {
    this.mirrorFirestoreAsync(`delete:${id}`, () => adminDb.collection('videoSources').doc(id).delete());

    let removedTarget: VideoSource | undefined;
    if (this.data.videoSources) {
      removedTarget = this.data.videoSources.find(s => s.id === id);
      this.data.videoSources = this.data.videoSources.filter(s => s.id !== id);
    }

    const removedUrl = removedTarget?.url;
    const targetSeason = removedTarget ? this.parseSeasonNum(removedTarget.seasonNumber, 1) : 1;
    const targetEp = removedTarget ? Math.max(1, Number(removedTarget.episodeNumber || 1)) : 1;
    this.data.playerSources = this.data.playerSources.filter(s => {
      if (s.id === `src-${id}` || s.id === id) return false;
      if (removedTarget && removedUrl && s.url === removedUrl) {
        const sameTmdb = Number(s.tmdbId) === Number(removedTarget.contentId);
        const sameType = this.normalizeContentType(s.type) === this.normalizeContentType(removedTarget.contentType);
        const sameEp =
          this.normalizeContentType(removedTarget.contentType) !== 'tv' ||
          (this.parseSeasonNum(s.season, 1) === targetSeason &&
            Math.max(1, Number(s.episode || 1)) === targetEp);
        if (sameTmdb && sameType && sameEp) return false;
      }
      return true;
    });

    if (!opts?.skipSave) {
      this.save();
    }
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
      subtitleLanguage: input.subtitleLanguage,
      versionType: input.versionType,
      subtitleUrl: input.subtitleUrl,
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
    const targetSeason = this.parseSeasonNum(params.seasonNumber, 1);
    const targetEp = Math.max(1, Number(params.episodeNumber || 1));
    return (this.data.videoSources || []).find(s => {
      if (params.excludeId && s.id === params.excludeId) return false;
      if (Number(s.contentId) !== targetId) return false;
      if (this.normalizeContentType(s.contentType) !== normType) return false;
      if (normType === 'tv') {
        if (this.parseSeasonNum(s.seasonNumber, 1) !== targetSeason) return false;
        if (Math.max(1, Number(s.episodeNumber || 1)) !== targetEp) return false;
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
    subtitleLanguage?: string;
    versionType?: string;
    subtitleUrl?: string;
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
    const seasonNumber = this.parseSeasonNum(input.seasonNumber, 1);
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

    const existingSeasons = Array.isArray(media.seasons) ? media.seasons.map(s => ({ ...s, episodes: [...(s.episodes || [])] })) : [];
    let targetSeason = existingSeasons.find(s => this.parseSeasonNum(s.seasonNumber, 1) === seasonNumber);
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

    // Build an O(1) index of existing videoSources for this series + season so large batches are instant
    const seasonSourcesByEp = new Map<number, VideoSource[]>();
    for (const s of this.data.videoSources || []) {
      if (
        Number(s.contentId) === tmdbId &&
        this.normalizeContentType(s.contentType) === 'tv' &&
        this.parseSeasonNum(s.seasonNumber, 1) === seasonNumber
      ) {
        const eNum = Math.max(1, Number(s.episodeNumber || 1));
        const list = seasonSourcesByEp.get(eNum) || [];
        list.push(s);
        seasonSourcesByEp.set(eNum, list);
      }
    }

    const epMap = new Map<number, Episode>();
    for (const existingEp of targetSeason.episodes || []) {
      epMap.set(Number(existingEp.episodeNumber), { ...existingEp });
    }

    for (const ep of input.episodes) {
      const epNum = Math.max(1, Number(ep.episodeNumber));
      const existingForEp = seasonSourcesByEp.get(epNum) || [];

      const prevEpMeta = epMap.get(epNum);
      if (!prevEpMeta) {
        epMap.set(epNum, {
          id: `ep-${tmdbId}-${seasonNumber}-${epNum}`,
          tmdbId,
          seasonNumber,
          episodeNumber: epNum,
          title: ep.title || `Episódio ${epNum}`,
          overview: ep.overview || '',
          stillPath: ep.stillPath,
          duration: ep.duration,
          airDate: ep.airDate,
          voteAverage: ep.voteAverage
        });
      } else {
        const isGenericTitle = !prevEpMeta.title || /^epis[oó]dio\s+\d+$/i.test(prevEpMeta.title.trim());
        epMap.set(epNum, {
          ...prevEpMeta,
          tmdbId: prevEpMeta.tmdbId || tmdbId,
          title: (isGenericTitle && ep.title) ? ep.title : (prevEpMeta.title || ep.title || `Episódio ${epNum}`),
          overview: prevEpMeta.overview || ep.overview || '',
          stillPath: prevEpMeta.stillPath || ep.stillPath,
          duration: prevEpMeta.duration || ep.duration,
          airDate: prevEpMeta.airDate || ep.airDate,
          voteAverage: prevEpMeta.voteAverage !== undefined ? prevEpMeta.voteAverage : ep.voteAverage
        });
      }

      const classified = classifySourceUrl(ep.url);
      if (existingForEp.length > 0) {
        if (input.conflictMode === 'skip') {
          skippedCount++;
          conflicts.push({ episodeNumber: epNum, existingCount: existingForEp.length, action: 'skipped' });
          continue;
        }

        if (input.conflictMode === 'overwrite') {
          for (const old of existingForEp) {
            await this.deleteVideoSource(old.id, { skipSave: true });
          }
          const created = await this.addVideoSource(
            {
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
              subtitleLanguage: input.subtitleLanguage,
              versionType: input.versionType,
              subtitleUrl: input.subtitleUrl,
              quality: input.quality || '1080p',
              isPrimary: input.isPrimary !== undefined ? input.isPrimary : true,
              priority: typeof input.priority === 'number' ? input.priority : 1,
              enabled: input.enabled !== undefined ? input.enabled : true,
              status: (ep.status || 'registered') as any,
              diagnostics: ep.diagnostics || classified.diagnostics
            },
            { skipSave: true }
          );
          seasonSourcesByEp.set(epNum, [created]);
          savedSources.push(created);
          updatedCount++;
          conflicts.push({ episodeNumber: epNum, existingCount: existingForEp.length, action: 'overwritten' });
          continue;
        }

        const exactDup = existingForEp.find(s => (s.originalUrl || s.url || '').trim() === classified.originalUrl.trim());
        if (exactDup) {
          skippedCount++;
          conflicts.push({ episodeNumber: epNum, existingCount: existingForEp.length, action: 'duplicate_skipped' });
          continue;
        }

        const altCreated = await this.addVideoSource(
          {
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
            subtitleLanguage: input.subtitleLanguage,
            versionType: input.versionType,
            subtitleUrl: input.subtitleUrl,
            quality: input.quality || '1080p',
            isPrimary: false,
            priority: typeof input.priority === 'number' ? Math.max(2, input.priority) : existingForEp.length + 1,
            enabled: input.enabled !== undefined ? input.enabled : true,
            status: (ep.status || 'registered') as any,
            diagnostics: ep.diagnostics || classified.diagnostics
          },
          { skipSave: true }
        );
        existingForEp.push(altCreated);
        seasonSourcesByEp.set(epNum, existingForEp);
        savedSources.push(altCreated);
        alternativeCount++;
        conflicts.push({ episodeNumber: epNum, existingCount: existingForEp.length, action: 'added_alternative' });
        continue;
      }

      const created = await this.addVideoSource(
        {
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
          subtitleLanguage: input.subtitleLanguage,
          versionType: input.versionType,
          subtitleUrl: input.subtitleUrl,
          quality: input.quality || '1080p',
          isPrimary: input.isPrimary !== undefined ? input.isPrimary : true,
          priority: typeof input.priority === 'number' ? input.priority : 1,
          enabled: input.enabled !== undefined ? input.enabled : true,
          status: (ep.status || 'registered') as any,
          diagnostics: ep.diagnostics || classified.diagnostics
        },
        { skipSave: true }
      );
      seasonSourcesByEp.set(epNum, [created]);
      savedSources.push(created);
      addedCount++;
    }

    targetSeason.episodes = Array.from(epMap.values()).sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
    targetSeason.episodeCount = Math.max(Number(targetSeason.episodeCount || 0), targetSeason.episodes.length);
    existingSeasons.sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));
    this.saveMedia({
      ...media,
      seasons: existingSeasons,
      seasonsCount: Math.max(Number(media.seasonsCount || 0), existingSeasons.length),
      episodesCount: existingSeasons.reduce((acc, s) => acc + Math.max(Number(s.episodeCount || 0), (s.episodes || []).length), 0)
    });

    if (input.seasonBaseUrl && input.seasonBaseUrl.trim()) {
      this.saveSeasonSourceTemplate({
        contentId: tmdbId,
        seasonNumber,
        baseUrl: input.seasonBaseUrl.trim(),
        useMgebPrefix: input.useMgebPrefix !== false,
        serverName: input.serverName,
        format: input.format,
        audioLanguage: input.audioLanguage,
        subtitleLanguage: input.subtitleLanguage,
        versionType: input.versionType,
        subtitleUrl: input.subtitleUrl,
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
    return this.sortSources(this.data.videoSources || []);
  }

  // --- STATS & AUDIT ---
  public getStats(): CatalogStats {
    const activeMedia = this.data.media.filter(m => !m.deletedAt);
    const movies = activeMedia.filter(m => this.normalizeMediaType(m.type) === 'movie');
    const series = activeMedia.filter(m => this.normalizeMediaType(m.type) === 'tv');
    const animes = activeMedia.filter(m => this.hasCategory(m, 'anime'));
    const doramas = activeMedia.filter(m => this.hasCategory(m, 'dorama'));
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
    let missingPoster = 0;
    let incompleteInfo = 0;
    let invalidTmdb = 0;
    let missingSource = 0;

    for (const m of movies) {
      if (this.isMediaPublished(m)) publishedMovies++;
      else unpublishedMovies++;
      const sSummary = this.getMediaSourceSummary(m);
      if (!sSummary.hasSource) moviesWithoutSource++;
      const diag = this.computeMediaDiagnostics(m, sSummary, dupMap);
      if (!diag.isComplete) totalProblematic++;
      if (!diag.checks.hasPoster) missingPoster++;
      if (!diag.checks.hasOverview || !diag.checks.hasGenres) incompleteInfo++;
      if (!diag.checks.hasTmdbId) invalidTmdb++;
      if (!diag.checks.hasSource) missingSource++;
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
      if (!diag.checks.hasPoster) missingPoster++;
      if (!diag.checks.hasOverview || !diag.checks.hasGenres) incompleteInfo++;
      if (!diag.checks.hasTmdbId) invalidTmdb++;
      if (!diag.checks.hasSource) missingSource++;
    }

    const publishedAnimes = animes.filter(m => this.isMediaPublished(m)).length;
    const publishedDoramas = doramas.filter(m => this.isMediaPublished(m)).length;

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
        categories: Array.isArray(m.categories)
          ? this.normalizeCategories(m.categories)
          : [
              ...(this.hasCategory(m, 'anime') ? ['anime'] : []),
              ...(this.hasCategory(m, 'dorama') ? ['dorama'] : [])
            ],
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
      totalAnimes: animes.length,
      totalDoramas: doramas.length,
      publishedAnimes,
      publishedDoramas,
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
      metadataAlertsCount: missingPoster + incompleteInfo + invalidTmdb,
      metadataAlerts: {
        missingPoster,
        incompleteInfo,
        invalidTmdb,
        missingSource
      },
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
    const animesCount = activeMedia.filter(m => this.hasCategory(m, 'anime')).length;
    const doramasCount = activeMedia.filter(m => this.hasCategory(m, 'dorama')).length;

    let episodesCount = 0;
    seriesList.forEach(s => {
      episodesCount += this.countSeriesSeasonsAndEpisodes(s).episodesCount;
    });

    return {
      moviesCount,
      seriesCount,
      episodesCount,
      animesCount,
      doramasCount,
      totalCatalog: moviesCount + seriesCount,
      status: 'Online'
    };
  }

  public async getAuditLogs() {
    if (Date.now() >= this.firestoreBackoffUntil) {
      try {
        const snapshot = await Promise.race([
          adminDb.collection('auditLogs').orderBy('timestamp', 'desc').limit(100).get(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 1200))
        ]);
        if (snapshot && 'docs' in snapshot) {
          const docs = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
          if (docs.length > 0) return docs;
        } else if (snapshot === null) {
          this.firestoreBackoffUntil = Date.now() + 15 * 60 * 1000;
        }
      } catch (e: any) {
        const code = String(e?.code || '');
        const msg = String(e?.message || '');
        if (code === '7' || msg.includes('PERMISSION_DENIED')) {
          this.firestoreBackoffUntil = Date.now() + 15 * 60 * 1000;
        }
      }
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
    this.data.auditLogs = this.data.auditLogs || [];
    this.data.auditLogs.unshift(log);
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs = this.data.auditLogs.slice(0, 500);
    }
    this.save();
    this.mirrorFirestoreAsync(`auditLog:${log.id}`, () =>
      adminDb.collection('auditLogs').add(this.sanitizeForFirestore(log))
    );
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
    delete (cleanUpdates as any).hasPlayableSource;
    delete (cleanUpdates as any).inCatalog;
    if (cleanUpdates.categories !== undefined) {
      cleanUpdates.categories = this.normalizeCategories(cleanUpdates.categories);
    }
    return this.saveMedia({ ...item, ...cleanUpdates, id: item.id });
  }
  public async addActivityLog(typeOrLog: any, message?: string) {
    if (typeof typeOrLog === 'string' && message) {
      return this.addAuditLog('system', typeOrLog.toUpperCase(), 'SUCCESS', message);
    }
    const log = typeOrLog;
    return this.addAuditLog(log.userEmail || 'system', log.action || 'ACTIVITY', 'SUCCESS', log.details || message || '');
  }
  public saveWatchProgress(userId: string, data: any): WatchProgress {
    const list = (this.data.watchProgress = this.data.watchProgress || []);
    const mediaType: 'movie' | 'tv' =
      data.mediaType === 'tv' || data.mediaType === 'series' ? 'tv' : 'movie';
    const tmdbId = Number(data.tmdbId || 0);
    const rawSeason = data.seasonNumber ?? data.season;
    const rawEpisode = data.episodeNumber ?? data.episode;
    const parsedSeason = rawSeason !== undefined && rawSeason !== null && rawSeason !== '' ? Number(rawSeason) : NaN;
    const parsedEpisode = rawEpisode !== undefined && rawEpisode !== null && rawEpisode !== '' ? Number(rawEpisode) : NaN;
    const seasonNumber =
      mediaType === 'tv' ? (Number.isFinite(parsedSeason) ? Math.max(0, Math.floor(parsedSeason)) : 1) : undefined;
    const episodeNumber =
      mediaType === 'tv' ? (Number.isFinite(parsedEpisode) ? Math.max(1, Math.floor(parsedEpisode)) : 1) : undefined;

    const rawPos = Math.max(0, Math.floor(Number(data.positionSeconds || 0)));
    const dur = Math.max(0, Math.floor(Number(data.durationSeconds || 0)));
    const isCompleted =
      Boolean(data.completed) || (dur > 60 && rawPos >= dur * 0.93);
    const finalPos = isCompleted ? 0 : rawPos;
    const finalPct = isCompleted
      ? 100
      : dur > 0
        ? Math.min(100, Math.max(0, Math.round((finalPos / dur) * 100)))
        : Math.min(100, Math.max(0, Math.round(Number(data.progressPercent || 0))));

    const keyId =
      mediaType === 'tv'
        ? `${userId}:tv:${tmdbId}:s${seasonNumber}:e${episodeNumber}`
        : `${userId}:movie:${tmdbId}`;

    const entry: WatchProgress = {
      id: keyId,
      userId: String(userId),
      mediaId: String(data.mediaId || `${mediaType === 'tv' ? 'series' : 'movie'}-${tmdbId}`),
      tmdbId,
      mediaType,
      title: String(data.title || 'Conteúdo'),
      posterPath: String(data.posterPath || ''),
      backdropPath: String(data.backdropPath || ''),
      ...(mediaType === 'tv' ? { seasonNumber, episodeNumber } : {}),
      progressPercent: finalPct,
      durationSeconds: dur,
      positionSeconds: finalPos,
      completed: isCompleted,
      updatedAt: new Date().toISOString()
    };

    const existingIdx = list.findIndex(p => {
      if (String(p.userId) !== String(userId)) return false;
      if (Number(p.tmdbId) !== tmdbId || p.mediaType !== mediaType) return false;
      if (mediaType === 'tv') {
        return Number(p.seasonNumber ?? 1) === seasonNumber && Number(p.episodeNumber ?? 1) === episodeNumber;
      }
      return true;
    });

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...entry };
    } else {
      list.unshift(entry);
    }

    if (list.length > 5000) {
      this.data.watchProgress = list
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5000);
    }

    this.save();
    return entry;
  }

  public toggleServer(serverId: string, enabled: boolean) {
    return { success: true, serverId, enabled };
  }

  public getWatchProgressList(userId: string): WatchProgress[] {
    const list = this.data.watchProgress || [];
    return list
      .filter(p => String(p.userId) === String(userId))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public resetWatchProgress(
    userId: string,
    filter: { tmdbId: number; mediaType?: string; seasonNumber?: number; episodeNumber?: number }
  ): { removedCount: number } {
    const list = this.data.watchProgress || [];
    const normType: 'movie' | 'tv' =
      filter.mediaType === 'tv' || filter.mediaType === 'series' ? 'tv' : 'movie';
    const tmdbId = Number(filter.tmdbId || 0);
    const before = list.length;

    this.data.watchProgress = list.filter(p => {
      if (String(p.userId) !== String(userId)) return true;
      if (Number(p.tmdbId) !== tmdbId || p.mediaType !== normType) return true;
      if (normType === 'tv') {
        const s = Number(filter.seasonNumber ?? 1);
        const e = Number(filter.episodeNumber ?? 1);
        return !(Number(p.seasonNumber ?? 1) === s && Number(p.episodeNumber ?? 1) === e);
      }
      return false;
    });

    const removedCount = before - this.data.watchProgress.length;
    if (removedCount > 0) this.save();
    return { removedCount };
  }

  public addLinkImportHistory(
    item: Omit<LinkImportHistoryItem, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ): LinkImportHistoryItem {
    const entry: LinkImportHistoryItem = {
      ...item,
      id: item.id || `lnk_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      timestamp: item.timestamp || new Date().toISOString()
    };
    this.data.linkImportHistory = this.data.linkImportHistory || [];
    this.data.linkImportHistory.unshift(entry);
    if (this.data.linkImportHistory.length > 300) {
      this.data.linkImportHistory = this.data.linkImportHistory.slice(0, 300);
    }
    this.save();
    return entry;
  }

  public getLinkImportHistory(limit = 100): LinkImportHistoryItem[] {
    return (this.data.linkImportHistory || []).slice(0, limit);
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

  // --- SERIES COMPARISON & UNLIMITED SEASON/EPISODE ANALYTICS ---
  public getSeriesComparisonStats(
    tmdbId: number,
    officialTmdbSeasons?: Array<{ seasonNumber: number; name?: string; episodeCount?: number }>
  ): SeriesComparisonReport {
    const cleanId = Number(tmdbId);
    const media = this.getMediaByTmdbAndType(cleanId, 'tv');
    const localSeasons = Array.isArray(media?.seasons) ? media!.seasons : [];

    // Gather all TV sources mapped strictly by TMDB_ID + SEASON_NUMBER + EPISODE_NUMBER
    const sourceMap = new Map<string, Array<{ status: string; url: string; enabled: boolean }>>();
    const recordSrc = (sNumRaw: any, eNumRaw: any, url: any, status: any, enabled: any) => {
      const cleanUrl = String(url || '').trim();
      if (!cleanUrl) return;
      const s = this.parseSeasonNum(sNumRaw, 1);
      const e = Math.max(1, Number(eNumRaw || 1));
      const key = `${cleanId}:${s}:${e}`;
      const list = sourceMap.get(key) || [];
      list.push({ status: String(status || 'registered').toLowerCase(), url: cleanUrl, enabled: enabled !== false });
      sourceMap.set(key, list);
    };

    for (const v of this.data.videoSources || []) {
      if (Number(v.contentId) === cleanId && this.normalizeContentType(v.contentType) === 'tv') {
        recordSrc(v.seasonNumber, v.episodeNumber, v.url, v.status, v.enabled);
      }
    }
    for (const p of this.data.playerSources || []) {
      if (Number(p.tmdbId) === cleanId && this.normalizeContentType(p.type) === 'tv') {
        recordSrc(p.season, p.episode, p.url, p.status, p.enabled);
      }
    }

    const seasonNumbers = new Set<number>();
    const officialMap = new Map<number, { seasonNumber: number; name?: string; episodeCount?: number }>();
    for (const o of officialTmdbSeasons || []) {
      const sNum = this.parseSeasonNum(o.seasonNumber, 1);
      seasonNumbers.add(sNum);
      officialMap.set(sNum, { ...o, seasonNumber: sNum });
    }
    const localSeasonMap = new Map<number, Season>();
    for (const ls of localSeasons) {
      const sNum = this.parseSeasonNum(ls.seasonNumber, 1);
      seasonNumbers.add(sNum);
      localSeasonMap.set(sNum, ls);
    }
    for (const key of sourceMap.keys()) {
      const parts = key.split(':');
      seasonNumbers.add(this.parseSeasonNum(parts[1], 1));
    }

    const sortedNums = Array.from(seasonNumbers).sort((a, b) => a - b);
    const seasonsStats: SeasonComparisonStats[] = [];

    let totalExpected = 0;
    let totalFound = 0;
    let totalWithLink = 0;
    let totalWithoutLink = 0;
    let totalValidated = 0;
    let totalErrors = 0;

    for (const sNum of sortedNums) {
      const official = officialMap.get(sNum);
      const local = localSeasonMap.get(sNum);
      const hydratedEps = Array.isArray(local?.episodes) ? local!.episodes : [];

      const epNumbersForSeason = new Set<number>();
      for (const ep of hydratedEps) {
        if (ep && ep.episodeNumber) epNumbersForSeason.add(Number(ep.episodeNumber));
      }
      for (const key of sourceMap.keys()) {
        const [, kS, kE] = key.split(':');
        if (this.parseSeasonNum(kS, 1) === sNum) {
          epNumbersForSeason.add(Number(kE));
        }
      }

      const expected = Math.max(
        Number(official?.episodeCount || 0),
        Number(local?.episodeCount || 0),
        hydratedEps.length
      );
      const found = hydratedEps.length > 0 ? hydratedEps.length : epNumbersForSeason.size;

      let withLink = 0;
      let validated = 0;
      let errCount = 0;
      let pending = 0;

      for (const eNum of epNumbersForSeason) {
        const srcs = (sourceMap.get(`${cleanId}:${sNum}:${eNum}`) || []).filter(x => x.enabled);
        if (srcs.length > 0) {
          withLink++;
          const hasOnline = srcs.some(x => x.status === 'online' || x.status === 'active');
          const allErrored = srcs.every(
            x =>
              x.status === 'offline' ||
              x.status === 'inactive' ||
              x.status === 'embed_blocked' ||
              x.status === 'unsupported_format'
          );
          if (hasOnline) validated++;
          else if (allErrored) errCount++;
          else pending++;
        }
      }

      const baseline = Math.max(expected, found);
      const withoutLink = Math.max(0, baseline - withLink);
      const difference = Math.max(0, expected - found);

      let status: SeasonComparisonStats['status'] = 'NO_LINKS';
      if (found === 0 && expected > 0) status = 'MISSING_TMDB_DATA';
      else if (withLink === 0) status = 'NO_LINKS';
      else if (withLink >= baseline && errCount === 0) status = 'COMPLETE';
      else status = 'PARTIAL';

      seasonsStats.push({
        seasonNumber: sNum,
        name: official?.name || local?.name || (sNum === 0 ? 'Especiais' : `Temporada ${sNum}`),
        isSpecial: sNum === 0,
        expectedEpisodes: expected,
        foundEpisodes: found,
        withLink,
        withoutLink,
        validatedCount: validated,
        errorCount: errCount,
        pendingCount: pending,
        difference,
        status
      });

      totalExpected += expected;
      totalFound += found;
      totalWithLink += withLink;
      totalWithoutLink += withoutLink;
      totalValidated += validated;
      totalErrors += errCount;
    }

    return {
      tmdbId: cleanId,
      mediaId: media?.id,
      title: media?.title || `Série TMDB #${cleanId}`,
      officialSeasonsCount: officialMap.size > 0 ? officialMap.size : sortedNums.length,
      localSeasonsCount: localSeasons.length,
      expectedEpisodes: totalExpected,
      foundEpisodes: totalFound,
      withLink: totalWithLink,
      withoutLink: totalWithoutLink,
      validatedCount: totalValidated,
      errorCount: totalErrors,
      difference: Math.max(0, totalExpected - totalFound),
      seasons: seasonsStats,
      generatedAt: new Date().toISOString()
    };
  }

  // --- BACKUP CENTER PRO MAX PERSISTENCE HELPERS ---
  public getBackupConfig(): BackupSettingsConfig {
    if (!this.data.backupConfig) {
      this.data.backupConfig = {
        autoBackupEnabled: false,
        autoBackupIntervalHours: 24,
        lastBackupAt: null,
        lastImportAt: null
      };
    }
    return this.data.backupConfig;
  }

  public updateBackupConfig(updates: Partial<BackupSettingsConfig>): BackupSettingsConfig {
    const cur = this.getBackupConfig();
    this.data.backupConfig = { ...cur, ...updates };
    this.save();
    return this.data.backupConfig;
  }

  public getBackupRecords(): BackupRecord[] {
    return this.data.backupRecords || [];
  }

  public saveBackupRecord(record: BackupRecord) {
    this.data.backupRecords = this.data.backupRecords || [];
    const idx = this.data.backupRecords.findIndex(r => r.id === record.id);
    if (idx >= 0) this.data.backupRecords[idx] = record;
    else this.data.backupRecords.unshift(record);
    if (this.data.backupRecords.length > 100) {
      this.data.backupRecords = this.data.backupRecords.slice(0, 100);
    }
    this.save();
  }

  public removeBackupRecord(id: string): BackupRecord | null {
    this.data.backupRecords = this.data.backupRecords || [];
    const idx = this.data.backupRecords.findIndex(r => r.id === id);
    if (idx < 0) return null;
    const [removed] = this.data.backupRecords.splice(idx, 1);
    this.save();
    return removed;
  }

  public getBackupImportJobs(): BackupImportJob[] {
    return this.data.backupImportJobs || [];
  }

  public saveBackupImportJob(job: BackupImportJob) {
    this.data.backupImportJobs = this.data.backupImportJobs || [];
    const idx = this.data.backupImportJobs.findIndex(j => j.jobId === job.jobId);
    if (idx >= 0) this.data.backupImportJobs[idx] = job;
    else this.data.backupImportJobs.unshift(job);
    if (this.data.backupImportJobs.length > 50) {
      this.data.backupImportJobs = this.data.backupImportJobs.slice(0, 50);
    }
    this.save();
  }

  public getFullSafeExportSnapshot(mode: 'full' | 'catalog') {
    const media = (this.data.media || []).filter(m => !m.deletedAt).map(m => ({ ...m }));
    const videoSources = (this.data.videoSources || []).map(v => ({ ...v }));
    const playerSources = (this.data.playerSources || []).map(p => ({ ...p }));

    if (mode === 'catalog') {
      return {
        media,
        videoSources,
        playerSources,
        seasonSourceTemplates: { ...(this.data.seasonSourceTemplates || {}) }
      };
    }

    // Full mode strictly excludes passwords, hashes, salts, plaintext API keys, and tokens
    const safeDeveloperApps = (this.data.developerApps || []).map(app => ({
      id: app.id,
      name: app.name,
      description: app.description,
      status: app.status,
      plan: app.plan,
      authorizedDomains: app.authorizedDomains,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt
    }));

    return {
      media,
      videoSources,
      playerSources,
      seasonSourceTemplates: { ...(this.data.seasonSourceTemplates || {}) },
      settings: { ...this.data.settings },
      plansConfig: { ...(this.data.plansConfig || {}) },
      apiGlobalSettings: { ...(this.data.apiGlobalSettings || {}) },
      developerApps: safeDeveloperApps,
      categories: this.getGenresSummary(),
      importHistory: (this.data.importHistory || []).slice(0, 100)
    };
  }

  public getStoreFileSizeBytes(): number {
    try {
      if (fs.existsSync(STORE_FILE)) {
        return fs.statSync(STORE_FILE).size;
      }
    } catch {}
    return 0;
  }

  public getRawMediaAndSourcesCount() {
    const activeMedia = (this.data.media || []).filter(m => !m.deletedAt);
    const movies = activeMedia.filter(m => this.normalizeMediaType(m.type) === 'movie').length;
    const seriesList = activeMedia.filter(m => this.normalizeMediaType(m.type) === 'tv');
    let seasons = 0;
    let episodes = 0;
    for (const s of seriesList) {
      const c = this.countSeriesSeasonsAndEpisodes(s);
      seasons += c.seasonsCount;
      episodes += c.episodesCount;
    }
    return {
      movies,
      series: seriesList.length,
      seasons,
      episodes,
      sources: Math.max((this.data.videoSources || []).length, (this.data.playerSources || []).length)
    };
  }

  public flushSave() {
    this.save();
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

  public upsertMediaItem(
    item: Partial<MediaItem> & { type?: string; tmdbId?: number; id?: string },
    options?: { replaceCategories?: boolean }
  ) {
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
    const existingCats = this.normalizeCategories(existing?.categories);
    const incomingCats = item.categories !== undefined ? this.normalizeCategories(item.categories) : undefined;
    const mergedCategories =
      incomingCats !== undefined
        ? options?.replaceCategories
          ? incomingCats
          : Array.from(new Set([...existingCats, ...incomingCats]))
        : existing?.categories !== undefined
          ? existingCats
          : undefined;

    const payload: MediaItem = {
      ...(existing || {}),
      ...item,
      id: resolvedId,
      type: normType,
      title: item.title || existing?.title || 'Sem título',
      overview: item.overview || existing?.overview || '',
      categories: mergedCategories,
      popularity: item.popularity !== undefined ? item.popularity : existing?.popularity,
      originCountry: item.originCountry !== undefined ? item.originCountry : existing?.originCountry,
      originalLanguage: item.originalLanguage !== undefined ? item.originalLanguage : existing?.originalLanguage,
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
        if (season !== undefined && Number(v.seasonNumber) !== Number(season)) return false;
        if (episode !== undefined && Number(v.episodeNumber) !== Number(episode)) return false;
      }
      return true;
    }).map(v => {
      const classified = classifySourceUrl(v.originalUrl || v.url);
      const normVer = normalizeVersionType(v.versionType, v.serverName || v.sourceName, v.audioLanguage);
      const safeLang =
        v.audioLanguage ||
        (normVer === 'legendado' ? 'Original' : normVer === 'dublado' ? 'Português' : undefined);
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
        audioLanguage: safeLang,
        subtitleLanguage: v.subtitleLanguage || undefined,
        versionType: normVer || v.versionType || undefined,
        subtitleUrl: v.subtitleUrl || undefined,
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

  public getRandomPlayableCatalogItem(options?: {
    type?: 'movie' | 'tv' | 'all' | string;
    excludeTmdbIds?: number[];
  }): {
    item: MediaItem;
    mediaType: 'movie' | 'tv';
    seasonNumber?: number;
    episodeNumber?: number;
    totalEligible: number;
  } | null {
    const rawType = String(options?.type || 'all').toLowerCase();
    const filterType: 'movie' | 'tv' | 'all' =
      rawType === 'movie' || rawType === 'filme'
        ? 'movie'
        : rawType === 'tv' || rawType === 'series' || rawType === 'serie'
          ? 'tv'
          : 'all';

    const isUsableSource = (src: { enabled?: boolean; status?: string; url?: string }) => {
      if (!src || src.enabled === false) return false;
      const cleanUrl = String(src.url || '').trim();
      if (!cleanUrl) return false;
      const lower = String(src.status || '').toLowerCase();
      return (
        lower !== 'offline' &&
        lower !== 'inactive' &&
        lower !== 'embed_blocked' &&
        lower !== 'unsupported_format'
      );
    };

    // Index usable sources by `${type}:${tmdbId}` in a single O(S) pass
    const movieHasSource = new Set<number>();
    const tvEpisodesByTmdb = new Map<number, Array<{ seasonNumber: number; episodeNumber: number }>>();
    const tvSeenEpKey = new Set<string>();

    const recordTvEpisode = (tmdbId: number, season?: number, episode?: number) => {
      const s = this.parseSeasonNum(season, 1);
      const e = Number(episode || 1);
      if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 1) return;
      const key = `${tmdbId}:${s}:${e}`;
      if (tvSeenEpKey.has(key)) return;
      tvSeenEpKey.add(key);
      const list = tvEpisodesByTmdb.get(tmdbId) || [];
      list.push({ seasonNumber: s, episodeNumber: e });
      tvEpisodesByTmdb.set(tmdbId, list);
    };

    for (const v of this.data.videoSources || []) {
      if (!isUsableSource(v)) continue;
      const tmdbId = Number(v.contentId || 0);
      if (tmdbId <= 0) continue;
      const normType = this.normalizeContentType(v.contentType);
      if (normType === 'movie') {
        movieHasSource.add(tmdbId);
      } else {
        recordTvEpisode(tmdbId, v.seasonNumber, v.episodeNumber);
      }
    }

    for (const p of this.data.playerSources || []) {
      if (!isUsableSource(p)) continue;
      const tmdbId = Number(p.tmdbId || 0);
      if (tmdbId <= 0) continue;
      const normType = this.normalizeContentType(p.type);
      if (normType === 'movie') {
        movieHasSource.add(tmdbId);
      } else {
        recordTvEpisode(tmdbId, p.season, p.episode);
      }
    }

    interface EligibleCandidate {
      item: MediaItem;
      mediaType: 'movie' | 'tv';
      episodes?: Array<{ seasonNumber: number; episodeNumber: number }>;
    }

    const eligible: EligibleCandidate[] = [];
    const seenCandidateKey = new Set<string>();

    for (const m of this.data.media || []) {
      if (!this.isMediaPublished(m)) continue;
      if (m.status === 'ERROR' || m.importError) continue;
      const tmdbId = Number(m.tmdbId || 0);
      if (tmdbId <= 0) continue;

      const mediaType = this.normalizeMediaType(m.type);
      if (filterType !== 'all' && mediaType !== filterType) continue;

      const candKey = `${mediaType}:${tmdbId}`;
      if (seenCandidateKey.has(candKey)) continue;

      const directUrl = String((m as any).sourceUrl || (m as any).videoUrl || '').trim();

      if (mediaType === 'movie') {
        if (!movieHasSource.has(tmdbId) && !directUrl) continue;
        seenCandidateKey.add(candKey);
        eligible.push({ item: m, mediaType: 'movie' });
      } else {
        const episodes = tvEpisodesByTmdb.get(tmdbId) || [];
        if (episodes.length === 0 && !directUrl) continue;
        seenCandidateKey.add(candKey);
        eligible.push({
          item: m,
          mediaType: 'tv',
          episodes: episodes.length > 0 ? episodes : [{ seasonNumber: 1, episodeNumber: 1 }]
        });
      }
    }

    if (eligible.length === 0) return null;

    const excludeSet = new Set(
      (options?.excludeTmdbIds || []).map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
    );
    let pool = eligible.filter(c => !excludeSet.has(Number(c.item.tmdbId)));
    if (pool.length === 0) {
      const mostRecentId = options?.excludeTmdbIds?.[0];
      pool =
        mostRecentId && eligible.length > 1
          ? eligible.filter(c => Number(c.item.tmdbId) !== Number(mostRecentId))
          : eligible;
    }

    const picked = pool[Math.floor(Math.random() * pool.length)];
    let seasonNumber: number | undefined;
    let episodeNumber: number | undefined;

    if (picked.mediaType === 'tv' && picked.episodes && picked.episodes.length > 0) {
      const s1e1 = picked.episodes.find(ep => ep.seasonNumber === 1 && ep.episodeNumber === 1);
      const chosenEp = s1e1 || picked.episodes[Math.floor(Math.random() * picked.episodes.length)];
      seasonNumber = chosenEp.seasonNumber;
      episodeNumber = chosenEp.episodeNumber;
    }

    return {
      item: picked.item,
      mediaType: picked.mediaType,
      seasonNumber,
      episodeNumber,
      totalEligible: eligible.length
    };
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
    apiType?: 'standard' | 'special';
  }): DeveloperApp {
    this.data.developerApps = this.data.developerApps || [];
    const now = new Date().toISOString();
    const cleanDomains = Array.from(
      new Set((input.authorizedDomains || []).map(d => normalizeDomainEntry(d)).filter(Boolean))
    );
    const isSpecial = input.apiType === 'special';
    const app: DeveloperApp = {
      id: `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      ownerId: input.ownerId,
      ownerEmail: input.ownerEmail.trim().toLowerCase(),
      name: input.name.trim(),
      description: (input.description || '').trim(),
      status: 'ACTIVE',
      plan: input.plan || 'FREE',
      apiType: isSpecial ? 'special' : 'standard',
      specialRequestStatus: isSpecial ? 'pending' : 'none',
      adsEnabled: !isSpecial,
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
    updates: Partial<Pick<DeveloperApp, 'name' | 'description' | 'status' | 'plan' | 'authorizedDomains' | 'apiType' | 'specialRequestStatus' | 'adsEnabled'>>
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
      apiType: updates.apiType !== undefined ? updates.apiType : current.apiType,
      specialRequestStatus: updates.specialRequestStatus !== undefined ? updates.specialRequestStatus : current.specialRequestStatus,
      adsEnabled: updates.adsEnabled !== undefined ? updates.adsEnabled : (updates.apiType === 'special' ? false : current.adsEnabled),
      authorizedDomains: cleanDomains,
      updatedAt: new Date().toISOString()
    };
    this.data.developerApps[idx] = updated;
    this.save();
    return updated;
  }

  public requestSpecialApi(appId: string): DeveloperApp | null {
    return this.updateDeveloperApp(appId, {
      apiType: 'special',
      specialRequestStatus: 'pending',
      adsEnabled: false
    });
  }

  public updateSpecialApiStatus(appId: string, status: 'approved' | 'rejected' | 'suspended' | 'standard'): DeveloperApp | null {
    if (status === 'standard') {
      return this.updateDeveloperApp(appId, {
        apiType: 'standard',
        specialRequestStatus: 'none',
        adsEnabled: true
      });
    }
    const reqStatus = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'suspended';
    const isApproved = status === 'approved';
    return this.updateDeveloperApp(appId, {
      apiType: isApproved ? 'special' : 'standard',
      specialRequestStatus: reqStatus,
      adsEnabled: !isApproved
    });
  }

  public getSpecialDeveloperApps(): DeveloperApp[] {
    return (this.data.developerApps || []).filter(
      a => a.apiType === 'special' || (a.specialRequestStatus && a.specialRequestStatus !== 'none')
    );
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

  public async getVersionSlotsForContent(params: {
    contentId: number;
    contentType: string;
    seasonNumber?: number;
    episodeNumber?: number;
  }) {
    const cleanId = Number(params.contentId);
    const normType = this.normalizeContentType(params.contentType);
    const sNum = normType === 'tv' ? this.parseSeasonNum(params.seasonNumber, 1) : undefined;
    const eNum = normType === 'tv' ? Math.max(1, Number(params.episodeNumber || 1)) : undefined;

    const { sources: localSources } = this.getMediaAndSources(cleanId, normType, sNum, eNum);
    const vSources = await this.getVideoSources({
      contentId: cleanId,
      contentType: normType,
      seasonNumber: sNum,
      episodeNumber: eNum
    });

    const byUrl = new Map<string, any>();
    for (const s of localSources) {
      byUrl.set((s.originalUrl || s.url || '').trim(), s);
    }
    for (const v of vSources) {
      const normVer = normalizeVersionType(v.versionType, v.serverName || v.sourceName, v.audioLanguage);
      byUrl.set((v.originalUrl || v.url || '').trim(), {
        ...v,
        tmdbId: Number(v.contentId),
        type: normType,
        season: v.seasonNumber,
        episode: v.episodeNumber,
        label: v.serverName || v.sourceName || v.quality || 'Servidor Principal',
        versionType: normVer || v.versionType,
        audioLanguage:
          v.audioLanguage ||
          (normVer === 'legendado' ? 'Original' : normVer === 'dublado' ? 'Português' : undefined)
      });
    }

    const all = this.sortSources(Array.from(byUrl.values()));
    const dublado: any[] = [];
    const legendado: any[] = [];
    const legacyOrOther: any[] = [];

    for (const src of all) {
      const dub = isSourceDublado(src);
      const leg = isSourceLegendado(src);
      if (dub && !leg) {
        dublado.push(src);
      } else if (leg && !dub) {
        legendado.push(src);
      } else if (dub && leg) {
        // Explicit versionType takes priority if both heuristics somehow match
        const norm = normalizeVersionType(src.versionType);
        if (norm === 'legendado') legendado.push(src);
        else if (norm === 'dublado') dublado.push(src);
        else legacyOrOther.push(src);
      } else {
        legacyOrOther.push(src);
      }
    }

    const scopeMarker = normType === 'tv' ? `[TMDB ${cleanId} T${sNum}E${eNum}]` : `[TMDB ${cleanId}]`;
    const history = (this.data.auditLogs || [])
      .filter(log => {
        const details = String(log?.details || '');
        if (!details.includes(`[TMDB ${cleanId}`)) return false;
        if (normType === 'tv') {
          return details.includes(scopeMarker) || details.includes(`[TMDB ${cleanId}]`);
        }
        return details.includes(`[TMDB ${cleanId}]`);
      })
      .slice(0, 20);

    return {
      contentId: cleanId,
      contentType: normType,
      seasonNumber: sNum,
      episodeNumber: eNum,
      dublado: {
        primary: dublado[0] || null,
        sources: dublado
      },
      legendado: {
        primary: legendado[0] || null,
        sources: legendado
      },
      legacyOrOther,
      allSources: all,
      history
    };
  }

  public async upsertVersionSourceSlot(input: {
    contentId: number;
    contentType: string;
    seasonNumber?: number;
    episodeNumber?: number;
    version: 'dublado' | 'legendado';
    url: string;
    serverName?: string;
    quality?: string;
    format?: string;
    enabled?: boolean;
    isPrimary?: boolean;
    status?: string;
    verificationResult?: string;
    diagnostics?: any;
    sourceId?: string;
    replaceExisting?: boolean;
    adminEmail?: string;
  }) {
    const cleanId = Number(input.contentId);
    const normType = this.normalizeContentType(input.contentType);
    const sNum = normType === 'tv' ? this.parseSeasonNum(input.seasonNumber, 1) : undefined;
    const eNum = normType === 'tv' ? Math.max(1, Number(input.episodeNumber || 1)) : undefined;
    const cleanUrl = String(input.url || '').trim();
    const classified = classifySourceUrl(cleanUrl);
    const canonicalUrl = classified.originalUrl || cleanUrl;
    const audioLang = input.version === 'dublado' ? 'Português' : 'Original';
    const defaultServer = input.version === 'dublado' ? 'Servidor Dublado' : 'Servidor Legendado';

    const slots = await this.getVersionSlotsForContent({
      contentId: cleanId,
      contentType: normType,
      seasonNumber: sNum,
      episodeNumber: eNum
    });

    const oppositeList = input.version === 'dublado' ? slots.legendado.sources : slots.dublado.sources;
    const duplicateInOpposite = oppositeList.find(
      s => (s.originalUrl || s.url || '').trim() === canonicalUrl
    );
    const duplicateInLegacy = slots.legacyOrOther.find(
      s => (s.originalUrl || s.url || '').trim() === canonicalUrl && s.id !== input.sourceId
    );
    const duplicateWarning = duplicateInOpposite
      ? `Atenção: esta mesma URL já está cadastrada na versão ${input.version === 'dublado' ? 'Legendada' : 'Dublada'}.`
      : duplicateInLegacy
      ? 'Atenção: esta URL já existe numa fonte legada deste conteúdo.'
      : undefined;

    const currentSlotList = input.version === 'dublado' ? slots.dublado.sources : slots.legendado.sources;
    const exactUrlMatch = currentSlotList.find(
      s => (s.originalUrl || s.url || '').trim() === canonicalUrl
    );
    const targetExisting = input.sourceId
      ? currentSlotList.find(s => s.id === input.sourceId || `src-${s.id}` === input.sourceId) ||
        slots.allSources.find(s => s.id === input.sourceId)
      : input.replaceExisting === false
      ? exactUrlMatch
      : currentSlotList[0];

    let saved: VideoSource;
    let actionLabel: 'criada' | 'atualizada';

    if (targetExisting && (input.replaceExisting !== false || input.sourceId || exactUrlMatch)) {
      const targetId = String(targetExisting.id || '').startsWith('src-') &&
        (this.data.videoSources || []).some(v => v.id === String(targetExisting.id).replace(/^src-/, ''))
        ? String(targetExisting.id).replace(/^src-/, '')
        : String(targetExisting.id);

      saved = await this.updateVideoSource(targetId, {
        url: canonicalUrl,
        originalUrl: canonicalUrl,
        sourceKind: classified.sourceKind,
        format: (input.format && input.format !== 'auto' ? input.format : classified.suggestedFormat) as any,
        serverName: input.serverName?.trim() || targetExisting.serverName || defaultServer,
        quality: input.quality || targetExisting.quality || '1080p',
        versionType: input.version,
        audioLanguage: audioLang,
        enabled: input.enabled !== undefined ? input.enabled : true,
        isPrimary: input.isPrimary !== undefined ? input.isPrimary : targetExisting.isPrimary,
        status: (input.status as any) || 'registered',
        verificationResult: input.verificationResult,
        diagnostics: input.diagnostics || classified.diagnostics
      });
      actionLabel = 'atualizada';
    } else {
      saved = await this.addVideoSource({
        contentId: cleanId,
        contentType: normType,
        seasonNumber: sNum,
        episodeNumber: eNum,
        url: canonicalUrl,
        originalUrl: canonicalUrl,
        sourceKind: classified.sourceKind,
        format: (input.format && input.format !== 'auto' ? input.format : classified.suggestedFormat) as any,
        serverName: input.serverName?.trim() || (currentSlotList.length > 0 ? `${defaultServer} #${currentSlotList.length + 1}` : defaultServer),
        quality: input.quality || '1080p',
        versionType: input.version,
        audioLanguage: audioLang,
        enabled: input.enabled !== undefined ? input.enabled : true,
        isPrimary: input.isPrimary ?? (slots.allSources.length === 0),
        priority: currentSlotList.length + (input.version === 'dublado' ? 1 : 2),
        status: (input.status as any) || 'registered',
        verificationResult: input.verificationResult,
        diagnostics: input.diagnostics || classified.diagnostics
      });
      actionLabel = 'criada';
    }

    const scopeTag = normType === 'tv' ? `[TMDB ${cleanId} T${sNum}E${eNum}]` : `[TMDB ${cleanId}]`;
    const versionTitle = input.version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada';
    await this.addAuditLog(
      input.adminEmail || ADMIN_EMAIL,
      actionLabel === 'atualizada' ? 'VERSION_SLOT_UPDATED' : 'VERSION_SLOT_CREATED',
      'SUCCESS',
      `[VERSÃO] ${scopeTag} ${versionTitle} ${actionLabel}: ${canonicalUrl}`
    );

    const refreshed = await this.getVersionSlotsForContent({
      contentId: cleanId,
      contentType: normType,
      seasonNumber: sNum,
      episodeNumber: eNum
    });

    return {
      saved,
      action: actionLabel,
      duplicateWarning,
      slots: refreshed
    };
  }

  public async deleteVersionSourceSlot(params: {
    contentId: number;
    contentType: string;
    version: 'dublado' | 'legendado';
    sourceId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    adminEmail?: string;
  }) {
    const cleanId = Number(params.contentId);
    const normType = this.normalizeContentType(params.contentType);
    const sNum = normType === 'tv' ? this.parseSeasonNum(params.seasonNumber, 1) : undefined;
    const eNum = normType === 'tv' ? Math.max(1, Number(params.episodeNumber || 1)) : undefined;

    const slots = await this.getVersionSlotsForContent({
      contentId: cleanId,
      contentType: normType,
      seasonNumber: sNum,
      episodeNumber: eNum
    });

    const list = params.version === 'dublado' ? slots.dublado.sources : slots.legendado.sources;
    const toRemove = params.sourceId
      ? list.filter(s => s.id === params.sourceId || `src-${s.id}` === params.sourceId)
      : list;

    let removedCount = 0;
    for (const src of toRemove) {
      const rawId = String(src.id || '');
      const videoId = rawId.startsWith('src-') && (this.data.videoSources || []).some(v => v.id === rawId.replace(/^src-/, ''))
        ? rawId.replace(/^src-/, '')
        : rawId;
      await this.deleteVideoSource(videoId, { skipSave: true });
      removedCount++;
    }
    if (removedCount > 0) {
      this.save();
    }

    const scopeTag = normType === 'tv' ? `[TMDB ${cleanId} T${sNum}E${eNum}]` : `[TMDB ${cleanId}]`;
    const versionTitle = params.version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada';
    await this.addAuditLog(
      params.adminEmail || ADMIN_EMAIL,
      'VERSION_SLOT_REMOVED',
      'SUCCESS',
      `[VERSÃO] ${scopeTag} ${versionTitle} removida (${removedCount} fonte${removedCount === 1 ? '' : 's'}).`
    );

    const refreshed = await this.getVersionSlotsForContent({
      contentId: cleanId,
      contentType: normType,
      seasonNumber: sNum,
      episodeNumber: eNum
    });

    return {
      removedCount,
      slots: refreshed
    };
  }

  public getSeasonDiscoveryJobs(): SeasonDiscoveryJob[] {
    return this.data.seasonDiscoveryJobs || [];
  }

  public getSeasonDiscoveryJob(jobId: string): SeasonDiscoveryJob | undefined {
    return (this.data.seasonDiscoveryJobs || []).find(j => j.jobId === jobId);
  }

  public saveSeasonDiscoveryJob(job: SeasonDiscoveryJob): SeasonDiscoveryJob {
    this.data.seasonDiscoveryJobs = this.data.seasonDiscoveryJobs || [];
    const idx = this.data.seasonDiscoveryJobs.findIndex(j => j.jobId === job.jobId);
    const updated = { ...job, updatedAt: new Date().toISOString() };
    if (idx >= 0) {
      this.data.seasonDiscoveryJobs[idx] = updated;
    } else {
      this.data.seasonDiscoveryJobs.unshift(updated);
    }
    if (this.data.seasonDiscoveryJobs.length > 25) {
      this.data.seasonDiscoveryJobs = this.data.seasonDiscoveryJobs.slice(0, 25);
    }
    this.save();
    return updated;
  }

  // --- AD CAMPAIGN MANAGEMENT METHODS ---
  public getAdCampaigns(): AdCampaign[] {
    return this.data.adCampaigns || [];
  }

  public getAdCampaignById(id: string): AdCampaign | undefined {
    return (this.data.adCampaigns || []).find(c => c.id === id);
  }

  public createAdCampaign(input: Omit<AdCampaign, 'id' | 'impressions' | 'clicks' | 'createdAt' | 'updatedAt'>): AdCampaign {
    this.data.adCampaigns = this.data.adCampaigns || [];
    const campaign: AdCampaign = {
      id: `ad-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      impressions: 0,
      clicks: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...input
    };
    this.data.adCampaigns.unshift(campaign);
    this.save();
    return campaign;
  }

  public updateAdCampaign(id: string, updates: Partial<AdCampaign>): AdCampaign | null {
    this.data.adCampaigns = this.data.adCampaigns || [];
    const idx = this.data.adCampaigns.findIndex(c => c.id === id);
    if (idx < 0) return null;
    const current = this.data.adCampaigns[idx];
    const updated: AdCampaign = {
      ...current,
      ...updates,
      id: current.id,
      updatedAt: new Date().toISOString()
    };
    this.data.adCampaigns[idx] = updated;
    this.save();
    return updated;
  }

  public deleteAdCampaign(id: string): boolean {
    this.data.adCampaigns = this.data.adCampaigns || [];
    const before = this.data.adCampaigns.length;
    this.data.adCampaigns = this.data.adCampaigns.filter(c => c.id !== id);
    if (this.data.adCampaigns.length === before) return false;
    this.save();
    return true;
  }

  public duplicateAdCampaign(id: string): AdCampaign | null {
    const orig = this.getAdCampaignById(id);
    if (!orig) return null;
    return this.createAdCampaign({
      name: `${orig.name} (Cópia)`,
      type: orig.type,
      displayLocation: [...orig.displayLocation],
      codeOrLink: orig.codeOrLink,
      status: 'DISABLED',
      frequency: { ...orig.frequency },
      startDate: orig.startDate,
      endDate: orig.endDate,
      allowedDevices: [...orig.allowedDevices],
      priority: orig.priority,
      description: orig.description,
      createdBy: orig.createdBy
    });
  }

  public recordAdImpression(id: string) {
    const c = this.getAdCampaignById(id);
    if (c) {
      c.impressions = (c.impressions || 0) + 1;
      this.save();
    }
  }

  public recordAdClick(id: string) {
    const c = this.getAdCampaignById(id);
    if (c) {
      c.clicks = (c.clicks || 0) + 1;
      this.save();
    }
  }

  // --- USER ADMIN MANAGEMENT METHODS ---
  public updateUserAdminStatus(userIdOrEmail: string, updates: {
    status?: 'active' | 'suspended' | 'blocked' | 'banned';
    adsDistributionEnabled?: boolean;
    suspensionReason?: string;
    suspensionExpiresAt?: string;
  }): StoreUser | null {
    this.data.users = this.data.users || [];
    const user = this.data.users.find(u => u.id === userIdOrEmail || u.email === userIdOrEmail);
    if (!user) return null;
    if (updates.status !== undefined) user.status = updates.status;
    if (updates.adsDistributionEnabled !== undefined) user.adsDistributionEnabled = updates.adsDistributionEnabled;
    if (updates.suspensionReason !== undefined) user.suspensionReason = updates.suspensionReason;
    if (updates.suspensionExpiresAt !== undefined) user.suspensionExpiresAt = updates.suspensionExpiresAt;
    this.save();
    return user;
  }
}

export const db = new Database();

