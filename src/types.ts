export type VideoFormatType =
  | 'mp4'
  | 'm3u8'
  | 'hls'
  | 'dash'
  | 'mpd'
  | 'webm'
  | 'embed'
  | 'iframe'
  | 'php_endpoint'
  | 'html'
  | 'auto';

export type SourceKind =
  | 'DIRECT_MP4'
  | 'DIRECT_HLS'
  | 'DIRECT_DASH'
  | 'DIRECT_WEBM'
  | 'PHP_VIDEO_ENDPOINT'
  | 'EMBED_PLAYER'
  | 'WEB_PAGE'
  | 'UNKNOWN';

export type SourceStatus =
  | 'registered'
  | 'validating'
  | 'online'
  | 'offline'
  | 'unverifiable'
  | 'unsupported_format'
  | 'embed_blocked'
  | 'unverified'
  | 'active'
  | 'inactive'
  | 'verifying'
  | 'incompatible'
  | 'playback_unverified';

export type RecommendedPlaybackMode =
  | 'html5_mp4'
  | 'html5_webm'
  | 'hls'
  | 'dash'
  | 'iframe'
  | 'blocked'
  | 'unsupported'
  | 'unknown';

export interface SourceDiagnostics {
  domain?: string;
  endpointPath?: string;
  hasUrlParam?: boolean;
  nestedUrl?: string | null;
  isPhpEndpoint?: boolean;
  httpStatus?: number | null;
  contentType?: string | null;
  contentLength?: number | null;
  acceptRanges?: string | null;
  finalUrl?: string | null;
  redirectChain?: string[];
  xFrameOptions?: string | null;
  cspFrameAncestors?: string | null;
  embedAllowed?: boolean | null;
  directPlayable?: boolean;
  recommendedPlaybackMode?: RecommendedPlaybackMode;
  failureReason?: string | null;
  corsNote?: string | null;
  testedAt?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'admin' | 'user' | 'founder';
  createdAt: string;
}

export interface MediaSourceSummary {
  totalSources: number;
  onlineCount: number;
  offlineCount: number;
  validatingCount: number;
  unverifiableCount: number;
  unsupportedCount: number;
  embedBlockedCount: number;
  registeredCount: number;
  hasSource: boolean;
  status: 'NONE' | 'ONLINE' | 'OFFLINE' | 'VALIDATING' | 'UNSUPPORTED' | 'EMBED_BLOCKED' | 'REGISTERED' | 'UNVERIFIABLE';
}

export interface MediaDiagnosticSummary {
  isComplete: boolean;
  status: 'COMPLETE' | 'INCOMPLETE' | 'ERROR' | 'UNPUBLISHED' | 'DELETED';
  issues: string[];
  checks: {
    hasTmdbId: boolean;
    hasTitle: boolean;
    hasPoster: boolean;
    hasOverview: boolean;
    hasGenres: boolean;
    hasSource: boolean;
    hasValidSource: boolean;
    noImportError: boolean;
    notDuplicate: boolean;
    isPublished: boolean;
  };
}

export interface MediaItem {
  id: string;
  tmdbId?: number;
  imdbId?: string;
  title: string;
  originalTitle?: string;
  type: 'movie' | 'tv' | 'series' | string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  bannerUrl?: string;
  voteAverage?: number;
  releaseYear?: number;
  releaseDate?: string;
  genres?: string[];
  duration?: number; // in minutes
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  featured?: boolean;
  trending?: boolean;
  popular?: boolean;
  topRated?: boolean;
  isTop10?: boolean;
  top10Position?: number;
  seasons?: Season[];
  createdAt?: string;
  updatedAt?: string;
  published?: boolean;
  status?: 'ACTIVE' | 'INACTIVE' | 'INCOMPLETE' | 'ERROR' | 'DRAFT' | 'SYNCING' | string;
  tmdbStatus?: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  importError?: string | null;
  importSource?: string;
  seasonsCount?: number;
  episodesCount?: number;
  voteCount?: number;
  firstAirDate?: string;
  trailerUrl?: string;
  cast?: any[];
  director?: string;
  source?: string;
  sourceSummary?: MediaSourceSummary;
  diagnosticSummary?: MediaDiagnosticSummary;
}

export interface Season {
  id?: string;
  seasonNumber: number;
  title?: string;
  name?: string;
  overview?: string;
  posterPath?: string;
  episodeCount?: number;
  episodes?: Episode[];
}

export interface Episode {
  id?: string;
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  overview?: string;
  stillPath?: string;
  duration?: number;
  airDate?: string;
  voteAverage?: number;
}

export interface PlayerSource {
  id: string;
  tmdbId?: number;
  imdbId?: string;
  type: 'movie' | 'tv' | 'series' | string;
  season?: number;
  episode?: number;
  format: VideoFormatType | string;
  sourceKind?: SourceKind;
  url: string;
  originalUrl?: string;
  provider: string;
  label?: string;
  quality?: string;
  audioLanguage?: string;
  isPrimary?: boolean;
  priority?: number;
  enabled?: boolean;
  status: SourceStatus | string;
  diagnostics?: SourceDiagnostics;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlayerResolvedSource {
  id?: string;
  type: VideoFormatType;
  sourceKind?: SourceKind;
  url: string;
  originalUrl?: string;
  provider: string;
  label?: string;
  quality?: string;
  audioLanguage?: string;
  isPrimary?: boolean;
  priority?: number;
  enabled?: boolean;
  status?: string;
  diagnostics?: SourceDiagnostics;
}

export interface PlayerContentMetadata {
  id: string;
  title: string;
  type: 'movie' | 'tv';
  tmdbId?: number;
  imdbId?: string;
  season?: number;
  episode?: number;
  poster?: string;
  backdrop?: string;
  duration?: number;
  overview?: string;
}

export interface PlayerResolveResponse {
  success: boolean;
  content?: PlayerContentMetadata;
  source: PlayerResolvedSource | null;
  sources?: PlayerResolvedSource[];
  alternativeSources?: PlayerResolvedSource[];
  nextEpisode?: {
    available: boolean;
    season?: number;
    episode?: number;
  };
  statusReason?: string;
  error?: string;
  message?: string;
}

export interface AppSettings {
  heroRotationInterval: number;
  catalogGuardEnabled: boolean;
  minCatalogThreshold: number;
  brandingName?: string;
  primaryColor?: string;
}

export interface StreamSource {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  fileId?: string;
  title?: string;
  size?: number;
  folderName?: string;
  provider: string;
  playbackUrl?: string;
  status: 'PENDING' | 'UPLOADING' | 'READY' | 'FAILED';
  createdAt: string;
  updatedAt?: string;
}

export interface CatalogAuditSummary {
  dbTotal: number;
  dbMoviesTotal: number;
  dbSeriesTotal: number;
  dbDeletedMovies: number;
  dbDeletedSeries: number;
  filteredTotal: number;
  returnedCount: number;
  page: number;
  limit: number;
}

export interface CatalogResponse {
  items: MediaItem[];
  total: number;
  page: number;
  totalPages: number;
  audit?: CatalogAuditSummary;
}

export interface SearchResults {
  local: MediaItem[];
  external: MediaItem[];
}

export interface CatalogStats {
  totalMovies: number;
  totalSeries: number;
  totalSeasons: number;
  totalEpisodes: number;
  totalUsers: number;
  totalViews: number;
  publishedMovies?: number;
  publishedSeries?: number;
  unpublishedMovies?: number;
  unpublishedSeries?: number;
  moviesWithoutSource?: number;
  seriesWithoutSource?: number;
  deletedMovies?: number;
  deletedSeries?: number;
  totalProblematic?: number;
  top10Count?: number;
  totalLinks?: number;
  onlineLinks?: number;
  offlineLinks?: number;
  recentImports?: ImportHistoryItem[];
  recentItems?: Array<{
    id: string;
    tmdbId?: number;
    title: string;
    type: 'movie' | 'tv';
    posterPath?: string;
    releaseYear?: number;
    voteAverage?: number;
    createdAt?: string;
    hasSource: boolean;
    published: boolean;
  }>;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  details: string;
  result: 'SUCCESS' | 'FAILED';
  timestamp: string;
}

export type MediaType = 'movie' | 'tv';

export interface RecoveryIssue {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  problem?: string;
  detectedAt?: string;
  tmdbId?: number;
  mediaType?: MediaType;
  mediaId?: string;
  title?: string;
}

export interface RecoveryState {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED' | 'ANALYZING';
  lastSnapshot?: string | null;
  issuesFound?: number;
  processedItems?: number;
  totalItems?: number;
  successCount?: number;
  errorCount?: number;
  ignoredCount?: number;
  startTime?: string;
  currentAction?: string;
  lastProcessedId?: string;
}

export interface RecoveryReportItem {
  id: string;
  timestamp: string;
  action?: string;
  result?: string;
  operation?: string;
  target?: string;
  totalProcessed?: number;
  addedCount?: number;
  updatedCount?: number;
  ignoredCount?: number;
  duplicatesCount?: number;
  errorsCount?: number;
  adminEmail?: string;
  duration?: string;
  status?: string;
  details?: string[];
}

export interface TmdbDiagResult {
  ok: boolean;
  latencyMs: number;
  statusText: string;
  rateLimit?: string;
  tmdbKeyPresent: boolean;
  message: string;
}

export interface DbDiagResult {
  ok: boolean;
  latencyMs: number;
  readOk: boolean;
  writeOk: boolean;
  totalItems: number;
  storageType: string;
  message: string;
}

export interface ImportStatus {
  operationId?: string;
  status: 'IDLE' | 'RUNNING' | 'PROCESSING' | 'COMPLETED' | 'PAUSED' | 'QUEUED' | 'CANCELLED' | 'FAILED' | 'CANCELLING' | 'pending' | 'completed';
  active?: boolean;
  total?: number;
  processing?: number;
  success?: number;
  existing?: number;
  failures?: number;
  cancelled?: boolean;
  duplicatesCount?: number;
  successesCount?: number;
  errorsCount?: number;
  notFoundCount?: number;
  ignoredCount?: number;
  elapsedTime?: number;
  speed?: number;
  estimatedTime?: number;
  logs?: string[];
  contentType?: 'movie' | 'tv' | 'both';
  type?: string;
  batchSize?: number;
  concurrency?: number;
  cacheEnabled?: boolean;
  totalBatches?: number;
  currentBatch?: number;
  rateLimitWarning?: boolean;
  startTime?: string;
  lastUpdate?: string;
  recentResults?: any[];
  completedAt?: string;
  duration?: string;
  currentTmdbId?: number;
  currentTitle?: string;
}

export interface MassImportOptions {
  ids?: number[];
  pagesCount?: number;
  type?: 'movie' | 'tv' | 'both';
  contentType?: 'movie' | 'tv' | 'both';
  batchSize?: number;
  concurrency?: number;
  cacheEnabled?: boolean;
}

export interface MassImportItemResult {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  status: 'SUCCESS' | 'ERROR' | 'DUPLICATE' | 'NOT_FOUND' | 'success' | 'failed' | 'duplicate' | 'not_found';
  message?: string;
  timestamp: string;
  error?: string;
}

export interface MassImportReport {
  id: string;
  operationId: string;
  title: string;
  contentType: 'movie' | 'tv' | 'both';
  total: number;
  successCount: number;
  duplicatesCount: number;
  notFoundCount: number;
  errorsCount: number;
  startedAt: string;
  completedAt: string;
  duration: string;
  status: 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'WARNING' | 'SUCCESS';
  items?: MassImportItemResult[];
  options?: MassImportOptions;
  logs?: string[];
}

export interface HistoryItem {
  id: string;
  userId: string;
  mediaId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string;
  backdropPath?: string;
  lastWatchedAt: string;
  progressPercent: number;
  seasonNumber?: number;
  episodeNumber?: number;
}
export interface TmdbSearchResult {
  tmdbId: number;
  title: string;
  type: 'movie' | 'tv';
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  overview?: string;
  existsInCatalog?: boolean;
  existingMediaItem?: MediaItem | null;
}

export interface ImportHistoryItem {
  id: string;
  title: string;
  tmdbId: number;
  type: 'movie' | 'tv';
  status: 'SUCCESS' | 'EXISTING' | 'ERROR';
  details: string;
  timestamp: string;
  adminEmail: string;
}

export interface WatchProgress {
  id: string;
  userId: string;
  mediaId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string;
  backdropPath: string;
  seasonNumber?: number;
  episodeNumber?: number;
  progressPercent: number;
  durationSeconds: number;
  positionSeconds: number;
  updatedAt: string;
}

export interface VideoSource {
  id: string;
  contentId: number;
  contentType: 'movie' | 'tv' | 'series' | string;
  seasonNumber?: number;
  episodeNumber?: number;
  serverName?: string;
  providerName?: string;
  provider?: string;
  sourceName?: string;
  isPrimary?: boolean;
  priority?: number;
  enabled?: boolean;
  url: string;
  originalUrl?: string;
  sourceKind?: SourceKind;
  format: 'mp4' | 'm3u8' | 'hls' | 'dash' | 'mpd' | 'webm' | 'embed' | 'iframe' | 'php_endpoint' | 'html' | 'external' | string;
  audioLanguage?: string;
  subtitleLanguage?: string;
  quality?: string;
  status: SourceStatus | string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  verificationResult?: string;
  diagnostics?: SourceDiagnostics;
}


export interface NormalizedProviderSource {
  id: string;
  provider: string;
  serverName?: string;
  format: 'mp4' | 'm3u8' | 'hls' | 'dash' | 'embed' | 'iframe';
  url: string;
  quality?: string;
  language?: string;
  status: 'available' | 'offline' | 'unverified';
}

export interface RecoveryStatsData {
  status: string;
  totalCatalog: number;
}

export interface ActivityLogEvent {
  type: string;
  message: string;
}

export interface M3USource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  autoSync: boolean;
  syncIntervalMinutes: number;
  autoTmdbMatch: boolean;
  lastSyncAt?: string;
}

export interface M3USyncJob {
  id: string;
  sourceId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt: string;
  completedAt?: string;
  totalItems?: number;
  processedItems?: number;
  addedMovies?: number;
  addedSeries?: number;
  addedChannels?: number;
  errors?: number;
}

export interface M3USyncError {
  id: string;
  jobId: string;
  timestamp: string;
  message: string;
  itemTitle?: string;
  itemUrl?: string;
}

// --- RONYCINE DEVELOPER PLATFORM, API KEYS, PLANS & MONITORING ---

export type CanonicalSourceClassification =
  | 'DIRECT_MP4'
  | 'HLS_M3U8'
  | 'DASH_MPD'
  | 'AUTHORIZED_EMBED'
  | 'EXTERNAL_PAGE'
  | 'UNKNOWN';

export type CanonicalSourceState =
  | 'ONLINE'
  | 'OFFLINE'
  | 'PENDING'
  | 'INVALID'
  | 'UNKNOWN';

export type PlanTier = 'FREE' | 'DEVELOPER' | 'PRO' | 'ENTERPRISE';

export interface PlanConfig {
  tier: PlanTier;
  name: string;
  audience: string;
  description: string;
  requestsPerMinute: number;
  dailyRequests: number;
  maxApps: number;
  maxAuthorizedDomains: number;
  maxPlaybackSessionsPerHour: number;
  allowEmbedPlayer: boolean;
  allowSourcesEndpoint: boolean;
  features: string[];
  active: boolean;
}

export interface DeveloperApp {
  id: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  description: string;
  status: 'ACTIVE' | 'SUSPENDED';
  plan: PlanTier;
  authorizedDomains: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  appId: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  status: 'ACTIVE' | 'REVOKED';
  lastUsedAt?: string | null;
  createdAt: string;
  revokedAt?: string | null;
  requestCount: number;
}

export interface PublicApiKey {
  id: string;
  appId: string;
  appName?: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  keyPrefix: string;
  status: 'ACTIVE' | 'REVOKED';
  lastUsedAt?: string | null;
  createdAt: string;
  revokedAt?: string | null;
  requestCount: number;
}

export interface ApiGlobalSettings {
  enabled: boolean;
  publicLimitedEnabled: boolean;
  publicRateLimitPerMinute: number;
  requireKeyForSources: boolean;
  requireDomainForEmbed: boolean;
  playbackTokenTtlSeconds: number;
  disabledEndpoints: string[];
}

export interface ApiRequestMetric {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  endpointGroup: string;
  statusCode: number;
  latencyMs: number;
  appId?: string | null;
  keyId?: string | null;
  tier: string;
  origin?: string | null;
  error?: string | null;
}

export interface PlaybackEventLog {
  id: string;
  timestamp: string;
  contentId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  appId?: string | null;
  origin?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  status: 'STARTED' | 'ERROR' | 'DENIED';
  errorMessage?: string | null;
}

export interface SeasonSourceTemplate {
  contentId: number;
  seasonNumber: number;
  baseUrl: string;
  useMgebPrefix: boolean;
  serverName?: string;
  format?: string;
  audioLanguage?: string;
  quality?: string;
  updatedAt: string;
}

export interface BatchEpisodeSourcesResult {
  success: boolean;
  contentId: number;
  seasonNumber: number;
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  alternativeCount: number;
  conflicts: Array<{ episodeNumber: number; existingCount: number; action: string }>;
  savedSources: VideoSource[];
  message: string;
}
