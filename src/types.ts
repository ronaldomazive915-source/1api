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

export type SourceVersionType =
  | 'Dublado'
  | 'Legendado'
  | 'Original'
  | 'Multiáudio'
  | 'Outra versão'
  | 'dublado'
  | 'legendado'
  | 'original'
  | 'multiaudio'
  | 'outra';

export type VersionAvailabilityStatus = 'available' | 'not_registered' | 'unavailable';

export interface VersionSlotAvailability {
  version: 'dublado' | 'legendado';
  status: VersionAvailabilityStatus;
  registeredCount: number;
  validCount: number;
  sourceId?: string;
  label?: string;
  format?: string;
  reason?: string;
}

export interface PlaybackVersionAvailability {
  dublado: VersionSlotAvailability;
  legendado: VersionSlotAvailability;
  untypedCount?: number;
}

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
  maxDetectedResolution?: string;
  availableQualities?: string[];
  analysisStatus?: string;
  detailKind?: string;
  providerName?: string;
  diagnosticSteps?: Array<{ step: string; status: 'ok' | 'error' | 'warn' | 'info'; detail?: string }>;
  externalPageUrl?: string;
  verificationLabel?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'admin' | 'user' | 'founder';
  status?: 'active' | 'suspended' | 'blocked' | 'banned';
  adsDistributionEnabled?: boolean;
  suspensionReason?: string;
  suspensionExpiresAt?: string;
  lastLogin?: string;
  lastHeartbeatAt?: string;
  createdAt: string;
}

export interface AdCampaign {
  id: string;
  name: string;
  type: 'popunder' | 'banner' | 'banner_responsive' | 'video_preroll' | 'external_code' | 'url_link';
  displayLocation: string[]; // e.g. ['global', 'home', 'detail', 'movies', 'series', 'player', 'player_before', 'player_inside', 'player_after']
  codeOrLink: string;
  status: 'ACTIVE' | 'DISABLED' | 'SCHEDULED' | 'EXPIRED' | 'REVIEW' | 'ERROR';
  frequency: {
    minIntervalMinutes?: number;
    maxPerSession?: number;
    maxPerUser?: number;
  };
  startDate: string;
  endDate?: string;
  allowedDevices: string[]; // ['desktop', 'tablet', 'mobile']
  priority: number;
  description?: string;
  impressions: number;
  clicks: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
  categories?: string[]; // e.g. ['anime'], ['dorama']
  popularity?: number;
  originCountry?: string[];
  originalLanguage?: string;
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
  hasPlayableSource?: boolean;
  inCatalog?: boolean;
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
  tmdbId?: number;
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  overview?: string;
  stillPath?: string;
  duration?: number;
  airDate?: string;
  voteAverage?: number;
  link?: string;
  sourcesCount?: number;
  sourceStatus?: string;
  sources?: PlayerSource[];
  extraMetadata?: Record<string, any>;
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
  subtitleLanguage?: string;
  versionType?: SourceVersionType | string;
  subtitleUrl?: string;
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
  subtitleLanguage?: string;
  versionType?: SourceVersionType | string;
  subtitleUrl?: string;
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
  versionAvailability?: PlaybackVersionAvailability;
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
  totalAnimes?: number;
  totalDoramas?: number;
  publishedAnimes?: number;
  publishedDoramas?: number;
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
  metadataAlertsCount?: number;
  metadataAlerts?: {
    missingPoster: number;
    incompleteInfo: number;
    invalidTmdb: number;
    missingSource: number;
  };
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
    categories?: string[];
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
  completed?: boolean;
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
  versionType?: SourceVersionType | string;
  subtitleUrl?: string;
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
  apiType: 'standard' | 'special';
  specialRequestStatus?: 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';
  adsEnabled?: boolean;
  authorizedDomains: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConnectedSiteRecord {
  appId: string;
  appName: string;
  domain: string;
  developerEmail: string;
  plan: PlanTier;
  apiType: 'standard' | 'special';
  adsEnabled: boolean;
  totalSessions: number;
  lastActivityAt: string;
  status: 'active' | 'inactive';
}

export interface ApiKeyRecord {
  id: string;
  appId: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  status: 'ACTIVE' | 'REVOKED' | 'SUSPENDED' | 'DISABLED';
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
  subtitleLanguage?: string;
  versionType?: SourceVersionType | string;
  subtitleUrl?: string;
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

// --- UNLIMITED SERIES COMPARISON & PROGRESSIVE SYNC ---

export interface SeasonComparisonStats {
  seasonNumber: number;
  name: string;
  isSpecial: boolean;
  expectedEpisodes: number;
  foundEpisodes: number;
  withLink: number;
  withoutLink: number;
  validatedCount: number;
  errorCount: number;
  pendingCount: number;
  difference: number;
  status: 'COMPLETE' | 'PARTIAL' | 'NO_LINKS' | 'MISSING_TMDB_DATA';
}

export interface SeriesComparisonReport {
  tmdbId: number;
  mediaId?: string;
  title: string;
  officialSeasonsCount: number;
  localSeasonsCount: number;
  expectedEpisodes: number;
  foundEpisodes: number;
  withLink: number;
  withoutLink: number;
  validatedCount: number;
  errorCount: number;
  difference: number;
  seasons: SeasonComparisonStats[];
  generatedAt: string;
}

export interface SeriesSyncJob {
  jobId: string;
  tmdbId: number;
  title?: string;
  status: 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
  totalSeasons: number;
  processedSeasons: number;
  totalEpisodesFound: number;
  currentSeasonNumber?: number | null;
  lastError?: string | null;
  startedAt: string;
  completedAt?: string | null;
}

// --- BACKUP CENTER PRO MAX ---

export type BackupExportMode = 'full' | 'catalog';
export type BackupFormat = 'zip' | 'json' | 'csv' | 'xlsx';
export type BackupConflictMode =
  | 'skip'
  | 'update_metadata_keep_links'
  | 'merge_new_links'
  | 'overwrite';
export type BackupImportFilter = 'all' | 'movies' | 'series';

export interface BackupRecord {
  id: string;
  filename: string;
  format: BackupFormat;
  mode: BackupExportMode;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  createdBy: string;
  origin: 'manual' | 'auto' | 'pre_import_rollback' | 'legacy';
  counts: {
    movies: number;
    series: number;
    seasons: number;
    episodes: number;
    sources: number;
  };
  filePath?: string;
  inlineLegacy?: boolean;
}

export interface BackupImportPreview {
  uploadToken: string;
  filename: string;
  detectedFormat: BackupFormat;
  detectedMode: BackupExportMode | 'mixed';
  sizeBytes: number;
  summary: {
    moviesTotal: number;
    seriesTotal: number;
    seasonsTotal: number;
    episodesTotal: number;
    sourcesTotal: number;
    newMovies: number;
    existingMovies: number;
    newSeries: number;
    existingSeries: number;
    newSources: number;
    duplicateSources: number;
    invalidRows: number;
  };
  detectedColumns: string[];
  warnings: string[];
  errors: string[];
  sampleItems: Array<{
    type: 'movie' | 'tv';
    tmdbId?: number;
    title: string;
    seasonNumber?: number;
    episodeNumber?: number;
    linksCount: number;
    existsInCatalog: boolean;
  }>;
}

export interface BackupImportJob {
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'ERROR' | 'ROLLED_BACK';
  filename: string;
  format: BackupFormat;
  filter: BackupImportFilter;
  conflictMode: BackupConflictMode;
  rollbackBackupId?: string | null;
  totalOperations: number;
  processedOperations: number;
  importedMovies: number;
  updatedMovies: number;
  importedSeries: number;
  updatedSeries: number;
  importedEpisodes: number;
  importedSources: number;
  skippedCount: number;
  errorCount: number;
  recentErrors: string[];
  currentStep: string;
  startedAt: string;
  completedAt?: string | null;
}

export interface BackupSystemStatus {
  totalMovies: number;
  totalSeries: number;
  totalSeasons: number;
  totalEpisodes: number;
  totalSources: number;
  storeSizeBytes: number;
  backupsDirSizeBytes: number;
  backupsCount: number;
  lastBackupAt: string | null;
  lastImportAt: string | null;
  autoBackupEnabled: boolean;
  autoBackupIntervalHours: number;
  serverTime: string;
}

// --- SMART DASHBOARD, CATEGORIZATION & TRENDING ---

export interface SmartDetectionCandidate {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  posterPath?: string;
  backdropPath?: string;
  releaseYear?: number;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  popularity?: number;
  genres?: string[];
  originCountry?: string[];
  originalLanguage?: string;
  overview?: string;
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  existsInCatalog: boolean;
  existingMediaId?: string | null;
  detection: {
    suggestedType: 'movie' | 'tv';
    suggestedCategories: Array<'anime' | 'dorama'>;
    confidence: 'high' | 'medium' | 'low';
    needsManualChoice: boolean;
    originCountry: string[];
    originalLanguage?: string;
    reasons: string[];
  };
}

export interface PublicStatsResponse {
  success: boolean;
  moviesCount: number;
  seriesCount: number;
  episodesCount: number;
  animesCount: number;
  doramasCount: number;
  totalCatalog: number;
  movies?: number;
  series?: number;
  links?: number;
  status: 'Online' | 'Offline' | 'Maintenance' | string;
  updatedAt?: string;
}

export interface SystemServiceStatus {
  name: string;
  key: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  latencyMs?: number;
  message?: string;
}

export interface SystemStatusReport {
  overallStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  uptimeSeconds: number;
  services: SystemServiceStatus[];
  database: {
    totalMovies: number;
    totalSeries: number;
    totalSources: number;
    sizeBytes: number;
  };
}

export interface ConnectionAnalyticsSummary {
  totalRequests: number;
  successRate: number;
  averageLatencyMs: number;
  activeEndpoints: number;
}

export type LinkHealthStatus = 'online' | 'offline' | 'unverified' | 'degraded';

export interface SourceVerificationRecord {
  id: string;
  url: string;
  status: LinkHealthStatus;
  latencyMs: number;
  lastCheckedAt: string;
  errorMessage?: string;
}

export interface ServerAlert {
  id: string;
  title?: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  createdAt: string;
  timestamp?: string;
  acknowledged: boolean;
}

export interface ServerSettings {
  autoVerifyEnabled: boolean;
  verifyIntervalHours: number;
  maxConcurrentVerifications: number;
  notificationsEnabled: boolean;
}

export interface TrendingSectionResponse {
  success: boolean;
  tab: 'trending' | 'movies' | 'series' | 'animes' | 'doramas' | 'recent';
  heroSpotlight: MediaItem | null;
  libraryItems: MediaItem[];
  tmdbGlobalItems: MediaItem[];
  recentAdditions: MediaItem[];
  popularLibrary: MediaItem[];
  stats: PublicStatsResponse;
  tmdbOnline: boolean;
  updatedAt: string;
}

// --- SMART SEEKEE / EXTERNAL LINK IMPORTER ---

export interface LinkImportExtractedEpisodeLink {
  seasonNumber: number;
  episodeNumber: number;
  pageUrl: string;
  label?: string;
}

export interface LinkImportEpisodePreview {
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  duration?: number;
  airDate?: string;
  stillPath?: string;
  voteAverage?: number;
  hasSourcePageLink: boolean;
  sourcePageUrl?: string | null;
  existsInCatalog?: boolean;
}

export interface LinkImportSeasonPreview {
  seasonNumber: number;
  name: string;
  overview?: string;
  posterPath?: string;
  tmdbEpisodeCount: number;
  sourceLinksCount: number;
  existingEpisodesCount: number;
  episodes: LinkImportEpisodePreview[];
}

export interface LinkImportTmdbCandidate {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  releaseYear?: number;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  popularity?: number;
  genres?: string[];
  originCountry?: string[];
  originalLanguage?: string;
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  suggestedCategories?: Array<'anime' | 'dorama'>;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  matchReasons: string[];
  existsInCatalog: boolean;
  existingMediaId?: string | null;
  existingSeasonsCount?: number;
  existingEpisodesCount?: number;
}

export interface LinkImportAnalysisResult {
  inputUrl: string;
  normalizedUrl: string;
  domain: string;
  status: 'READY' | 'DUPLICATE' | 'LOW_CONFIDENCE' | 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_URL';
  pageAccess: {
    accessible: boolean;
    httpStatus: number | null;
    contentType: string | null;
    finalUrl: string | null;
    protectionDetected: boolean;
    protectionType?: 'cloudflare' | 'captcha' | 'auth' | 'paywall' | 'forbidden' | null;
    diagnosticMessage: string;
    isHtmlPageOnly: boolean;
  };
  extracted: {
    rawPageTitle?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    ogType?: string;
    cleanedTitle: string;
    alternativeQueries: string[];
    year?: number;
    inferredType: 'movie' | 'tv' | 'unknown';
    hintedEpisodeNumber?: number;
    hintedSeasonNumber?: number;
    languageHint?: string;
    jsonLdFound: boolean;
    detectedEpisodeLinks: LinkImportExtractedEpisodeLink[];
    unidentifiedFields: string[];
  };
  candidates: LinkImportTmdbCandidate[];
  selectedCandidate: LinkImportTmdbCandidate | null;
  seasonsPreview: LinkImportSeasonPreview[];
  tmdbTotalSeasons: number;
  tmdbTotalEpisodes: number;
  sourceEpisodeLinksFound: number;
  duplicateCheck: {
    isDuplicate: boolean;
    existingMediaId?: string | null;
    existingTitle?: string | null;
    existingSeasonsCount: number;
    existingEpisodesCount: number;
    missingSeasonsCount: number;
    missingEpisodesCount: number;
    recommendedAction: 'import_new' | 'merge_missing' | 'update_metadata' | 'skip';
  };
  warnings: string[];
  error?: string | null;
}

export interface LinkImportHistoryItem {
  id: string;
  url: string;
  domain: string;
  status: 'SUCCESS' | 'UPDATED' | 'DUPLICATE' | 'FAILED';
  tmdbId?: number;
  type?: 'movie' | 'tv';
  title: string;
  releaseYear?: number;
  seasonsImported?: number;
  episodesImported?: number;
  sourceLinksDetected?: number;
  confidence?: 'high' | 'medium' | 'low';
  details: string;
  adminEmail: string;
  timestamp: string;
}

export interface DiscoveredEpisodeSlot {
  episodeNumber: number;
  title: string;
  overview?: string;
  airDate?: string;
  stillPath?: string;
  duration?: number;
  preparedUrl?: string;
  sourceUrl: string | null;
  originalUrl: string | null;
  sourceType: 'mp4' | 'm3u8' | 'hls' | 'dash' | 'webm' | 'stream' | 'unknown' | 'html';
  isDirectStream: boolean;
  mgebApplied: boolean;
  status: 'ready' | 'found' | 'pending' | 'invalid';
  format?: string;
  version?: 'dublado' | 'legendado';
  note?: string;
}

export interface SeasonDiscoveryResult {
  seasonNumber: number;
  seasonName?: string;
  expectedEpisodes: number;
  foundCount?: number;
  pendingCount?: number;
  foundEpisodesCount: number;
  pendingEpisodesCount: number;
  readyEpisodesCount: number;
  strategy: 'html_scrape' | 'sequential_pattern' | 'mixed' | 'tmdb_only';
  status?: 'completed' | 'partial' | 'pending' | 'error';
  message?: string;
  episodes: DiscoveredEpisodeSlot[];
}

export type SeasonUrlPatternAdapterType =
  | 'detail_trailing_number'
  | 'temporada_segment'
  | 'episode_segment'
  | 'query_param'
  | 'sxxexx_filename'
  | 'manual_review_required';

export type DiscoveredEpisodeVerificationStatus =
  | 'verified'
  | 'unconfirmed'
  | 'pending'
  | 'not_found'
  | 'error';

export type DetailedDiscoveryState =
  | 'tmdb_prepared'
  | 'url_generated'
  | 'mgeb_applied'
  | 'awaiting_verification'
  | 'verified'
  | 'unverified'
  | 'blocked_by_provider'
  | 'transient_error'
  | 'incompatible_player'
  | 'functional_source';

export type PlaybackCompatibilityStatus =
  | 'untested'
  | 'compatible'
  | 'unresolved'
  | 'incompatible';

export interface BatchEpisodeSourceDraft {
  id: string;
  originalUrl: string;
  processedUrl: string;
  processedUrlDisplay: string;
  version: 'dublado' | 'legendado';
  serverName: string;
  quality: string;
  useMgeb: boolean;
  compatibilityStatus: PlaybackCompatibilityStatus;
  compatibilityMessage?: string;
  manualConfirmed?: boolean;
  createdAt: string;
}

export interface BatchDiscoveredMovieItem {
  movieId: string;
  tmdbId: number;
  title: string;
  originalTitle?: string;
  posterPath?: string;
  releaseYear?: number;
  overview?: string;
  categories?: Array<'anime' | 'dorama'>;
  confidence: 'high' | 'medium' | 'low';
  existsInCatalog: boolean;
  originalUrl: string;
  processedUrl: string;
  processedUrlDisplay: string;
  useMgeb: boolean;
  detailedState: DetailedDiscoveryState;
  stateReason: string;
  verificationStatus: DiscoveredEpisodeVerificationStatus;
  playbackCompatibility: PlaybackCompatibilityStatus;
  compatibilityMessage?: string;
  httpStatus?: number | null;
  protectionDetected?: boolean;
  version: 'dublado' | 'legendado';
  approved: boolean;
  manualConfirmed?: boolean;
  sources: BatchEpisodeSourceDraft[];
  createdAt: string;
}

export interface BatchDiscoveredEpisode {
  episodeId: string;
  seriesId: string;
  seasonId: string;
  episodeNumber: number;
  title: string;
  overview?: string;
  stillPath?: string;
  duration?: number;
  airDate?: string;
  voteAverage?: number;
  originalPageUrl: string;
  episodePageUrl: string;
  originalUrl: string;
  processedUrl: string;
  processedUrlDisplay: string;
  playbackSourceUrl?: string | null;
  playbackVersion?: 'dublado' | 'legendado';
  useMgebForPlayback?: boolean;
  verificationStatus: DiscoveredEpisodeVerificationStatus;
  detailedState: DetailedDiscoveryState;
  stateReason: string;
  playbackCompatibility: PlaybackCompatibilityStatus;
  compatibilityMessage?: string;
  manualConfirmed?: boolean;
  httpStatus?: number | null;
  protectionDetected?: boolean;
  diagnosticMessage?: string;
  approved: boolean;
  existsInCatalog?: boolean;
  duplicateSourceExists?: boolean;
  sources: BatchEpisodeSourceDraft[];
  createdAt: string;
}

export interface BatchDiscoveredSeason {
  seasonId: string;
  seriesId: string;
  seasonNumber: number;
  name: string;
  overview?: string;
  posterPath?: string;
  mainUrl: string;
  processedMainUrl: string;
  providerId?: string;
  adapterType: SeasonUrlPatternAdapterType;
  requiresManualReview: boolean;
  patternNotice?: string;
  tmdbExpectedCount: number;
  discoveredCount: number;
  verifiedCount: number;
  unconfirmedCount: number;
  blockedCount: number;
  errorCount: number;
  endDetectedReason?: string;
  status: 'queued' | 'discovering' | 'completed' | 'partial' | 'unconfirmed' | 'error' | 'paused';
  detailedState: DetailedDiscoveryState;
  stateReason?: string;
  errorMessage?: string | null;
  approved: boolean;
  episodes: BatchDiscoveredEpisode[];
}

export interface BatchSeriesDiscoveryGroup {
  groupKey: string;
  tmdbId: number;
  title: string;
  originalTitle?: string;
  posterPath?: string;
  overview?: string;
  releaseYear?: number;
  categories?: Array<'anime' | 'dorama'>;
  confidence: 'high' | 'medium' | 'low';
  existsInCatalog: boolean;
  seasons: BatchDiscoveredSeason[];
}

export interface SeasonDiscoveryJob {
  jobId: string;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
  createdAt: string;
  updatedAt: string;
  totalInputUrls: number;
  totalMovies: number;
  totalSeasons: number;
  completedSeasons: number;
  totalEpisodesDiscovered: number;
  verifiedEpisodes: number;
  unconfirmedEpisodes: number;
  failedEpisodes: number;
  maxEpisodesLimit: number;
  currentTask: string;
  errors: string[];
  movieItems: BatchDiscoveredMovieItem[];
  seriesGroups: BatchSeriesDiscoveryGroup[];
  unmatchedUrls: Array<{ url: string; reason: string }>;
}


