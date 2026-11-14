import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { db } from './src/server/database.js';
import { recoveryService } from './src/server/recoveryService.js';
import { massImportService } from './src/server/massImportService.js';
import { m3uImporter, M3UImporterService } from './src/server/m3uImporterService.js';
import { MediaItem, ImportStatus, StreamSource, PlanTier, DeveloperApp, ApiKeyRecord, PlanConfig } from './src/types.js';
import {
  classifySourceUrl,
  mapToCanonicalClassification,
  mapToCanonicalState
} from './src/lib/sourceClassification.js';
import { probeVideoSource, validatePublicHttpUrl } from './src/server/sourceProbe.js';
import { OFFICIAL_BASE_URL, buildOfficialEmbedPath, buildOfficialEmbedUrl } from './src/lib/siteConfig.js';

dotenv.config();

const PORT = 3000;
const HOST = '0.0.0.0';

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'd60f5b5a778fe74b5cf4a371f008725b';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_SECURITY_CODE,
  createSessionToken,
  verifySessionToken,
  hashPassword,
  isFounderEmail,
  createPlaybackToken,
  verifyPlaybackToken,
  extractHostFromHeader,
  isHostInAuthorizedDomains,
  normalizeDomainEntry
} from './src/server/authService.js';

// Failed attempts tracker for admin rate-limiting
const loginAttempts: Record<string, { count: number; lockUntil?: number }> = {};

// Server-side Search Cache
const searchCache = new Map<string, { timestamp: number; data: any }>();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function normalizeSearchQuery(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics / accents
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper: Fetch TMDB API with error protection
async function fetchTMDB(endpoint: string, params: Record<string, string> = {}, signal?: AbortSignal) {
  try {
    const query = new URLSearchParams({
      api_key: TMDB_API_KEY,
      language: 'pt-BR',
      ...params
    });
    const url = `${TMDB_BASE_URL}${endpoint}?${query.toString()}`;
    const response = await fetch(url, { signal });
    if (!response.ok) {
      console.warn(`TMDB API response warning [${response.status}]: ${url}`);
      return null;
    }
    return await response.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.log('TMDB API fetch aborted safely:', endpoint);
    } else {
      console.error('TMDB API fetch exception:', err);
    }
    return null;
  }
}

// Helper: Format raw TMDB movie or TV item into PLAYFILME+ MediaItem
function formatTMDBMedia(raw: any, type: 'movie' | 'tv'): Partial<MediaItem> & { tmdbId: number; type: 'movie' | 'tv'; title: string } {
  const isMovie = type === 'movie';
  const title = isMovie ? (raw.title || raw.original_title) : (raw.name || raw.original_name);
  const releaseDate = isMovie ? raw.release_date : raw.first_air_date;

  const genres = raw.genres 
    ? raw.genres.map((g: any) => g.name)
    : (raw.genre_ids ? getGenreNamesByIds(raw.genre_ids, type) : []);

  const cast = raw.credits?.cast?.slice(0, 10).map((c: any) => ({
    id: c.id,
    name: c.name,
    character: c.character || '',
    profilePath: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined
  })) || [];

  const directorObj = raw.credits?.crew?.find((c: any) => c.job === 'Director');
  const director = directorObj ? directorObj.name : undefined;

  let trailerUrl: string | undefined;
  if (raw.videos?.results?.length) {
    const trailer = raw.videos.results.find((v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
    if (trailer) {
      trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
    }
  }

  const seasons = raw.seasons?.map((s: any) => ({
    id: `season-${s.season_number}`,
    seasonNumber: s.season_number,
    name: s.name || `Temporada ${s.season_number}`,
    overview: s.overview || '',
    posterPath: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : undefined,
    episodeCount: s.episode_count || 0,
    episodes: []
  })) || [];

  return {
    tmdbId: raw.id,
    type,
    status: 'ACTIVE',
    tmdbStatus: raw.status || undefined,
    title,
    originalTitle: isMovie ? raw.original_title : raw.original_name,
    overview: raw.overview || 'Sem sinopse disponível em português.',
    posterPath: raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : '',
    backdropPath: raw.backdrop_path ? `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}` : (raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : ''),
    voteAverage: raw.vote_average ? Number(raw.vote_average.toFixed(1)) : 0,
    voteCount: raw.vote_count || 0,
    releaseDate: isMovie ? releaseDate : undefined,
    firstAirDate: !isMovie ? releaseDate : undefined,
    genres,
    duration: raw.runtime || (raw.episode_run_time ? raw.episode_run_time[0] : undefined),
    seasonsCount: raw.number_of_seasons || seasons.length,
    episodesCount: raw.number_of_episodes,
    seasons,
    trailerUrl,
    cast,
    director,
    featured: raw.vote_average > 7.8,
    popular: raw.popularity > 50,
    trending: raw.popularity > 100
  };
}

function getGenreNamesByIds(ids: number[], type: 'movie' | 'tv'): string[] {
  const movieGenres: Record<number, string> = {
    28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime',
    99: 'Documentário', 18: 'Drama', 10751: 'Família', 14: 'Fantasia', 36: 'História',
    27: 'Terror', 10402: 'Música', 9648: 'Mistério', 10749: 'Romance', 878: 'Ficção Científica',
    10770: 'Cinema TV', 53: 'Thriller', 10752: 'Guerra', 37: 'Faroeste'
  };
  const tvGenres: Record<number, string> = {
    10759: 'Ação & Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário',
    18: 'Drama', 10751: 'Família', 10762: 'Kids', 9648: 'Mistério', 10763: 'News',
    10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk',
    10768: 'War & Politics', 37: 'Faroeste'
  };
  const map = type === 'movie' ? movieGenres : tvGenres;
  return ids.map(id => map[id]).filter(Boolean);
}

// --- AUTH MIDDLEWARE ---
const extractBearerSessionToken = (req: Request): string | undefined => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const val = authHeader.substring(7).trim();
    // Strictly reject API keys from acting as user/admin session tokens
    if (val.startsWith('rc_live_') || val.startsWith('rcp_')) return undefined;
    return val;
  }
  const alt = req.headers['x-admin-token'] as string | undefined;
  if (alt && !alt.startsWith('rc_live_') && !alt.startsWith('rcp_')) return alt;
  return undefined;
};

const requireUser = (req: Request, res: Response, next: any) => {
  const token = extractBearerSessionToken(req);
  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({
      success: false,
      error: 'Não autenticado',
      message: 'Faça login para aceder ao Portal de Desenvolvedores.'
    });
  }

  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Sessão inválida ou expirada',
      message: 'A sua sessão expirou. Inicie sessão novamente.'
    });
  }

  const isFounder = isFounderEmail(session.email);
  let dbUser = db.findUserByEmail(session.email);
  if (!dbUser && isFounder) {
    dbUser = db.createUser({ name: 'Fundador RONYCINE', email: session.email, role: 'founder' });
  }
  if (!dbUser) {
    return res.status(401).json({ success: false, error: 'Utilizador não encontrado.' });
  }
  if (dbUser.status === 'suspended') {
    return res.status(403).json({ success: false, error: 'Conta suspensa pelo administrador.' });
  }

  (req as any).user = {
    uid: dbUser.id,
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: isFounder ? 'founder' : dbUser.role
  };
  next();
};

const requireAdmin = (req: Request, res: Response, next: any) => {
  const token = extractBearerSessionToken(req);

  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({
      error: 'Não autorizado',
      message: 'Token de autenticação ausente. Faça login para acessar as funções administrativas.'
    });
  }

  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({
      error: 'Sessão inválida ou expirada',
      message: 'Sua sessão expirou ou é inválida. Por favor, faça login novamente.'
    });
  }

  const isFounder = isFounderEmail(session.email);
  const dbUser = db.findUserByEmail(session.email);

  if (!isFounder && (!dbUser || (dbUser.role !== 'admin' && dbUser.role !== 'founder'))) {
    return res.status(403).json({
      error: 'Acesso Negado',
      message: 'Você não possui permissões administrativas para realizar esta operação.'
    });
  }

  (req as any).user = {
    ...session,
    role: isFounder ? 'founder' : (dbUser?.role || session.role)
  };

  next();
};

const requireFounder = (req: Request, res: Response, next: any) => {
  const token = extractBearerSessionToken(req);

  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({
      error: 'Não autorizado',
      message: 'Token de autenticação ausente. Faça login com a conta de Fundador.'
    });
  }

  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({
      error: 'Sessão inválida ou expirada',
      message: 'Sua sessão expirou ou é inválida. Por favor, faça login novamente.'
    });
  }

  const isFounder = isFounderEmail(session.email);
  if (!isFounder || session.role !== 'founder') {
    return res.status(403).json({
      error: 'Acesso Negado',
      message: 'Operação exclusiva e restrita ao FUNDADOR PRINCIPAL.'
    });
  }

  (req as any).user = {
    ...session,
    role: 'founder'
  };

  next();
};

// --- RATE LIMITING & SANITIZATION FOR /api/v1/* ---
const minuteBuckets = new Map<string, { windowStart: number; count: number }>();
const dailyBuckets = new Map<string, { dayKey: string; count: number }>();
const playbackHourBuckets = new Map<string, { windowStart: number; count: number }>();

const GENRE_ID_TO_NAME: Record<number, string> = {
  28: 'Ação',
  12: 'Aventura',
  16: 'Animação',
  35: 'Comédia',
  80: 'Crime',
  99: 'Documentário',
  18: 'Drama',
  10751: 'Família',
  14: 'Fantasia',
  36: 'História',
  27: 'Terror',
  10402: 'Música',
  9648: 'Mistério',
  10749: 'Romance',
  878: 'Ficção Científica',
  10770: 'Cinema TV',
  53: 'Thriller',
  10752: 'Guerra',
  37: 'Faroeste',
  10759: 'Ação & Aventura',
  10765: 'Sci-Fi & Fantasy',
  10768: 'War & Politics'
};

function slugifyText(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeMediaForApi(m: MediaItem) {
  return {
    id: m.id,
    tmdbId: m.tmdbId,
    imdbId: m.imdbId || undefined,
    type: m.type === 'series' ? 'tv' : m.type,
    title: m.title,
    originalTitle: m.originalTitle || undefined,
    overview: m.overview || '',
    posterPath: m.posterPath || '',
    backdropPath: m.backdropPath || '',
    voteAverage: m.voteAverage || 0,
    voteCount: m.voteCount || 0,
    releaseDate: m.releaseDate || undefined,
    firstAirDate: m.firstAirDate || undefined,
    releaseYear: m.releaseYear || (m.releaseDate || m.firstAirDate ? parseInt((m.releaseDate || m.firstAirDate || '').slice(0, 4), 10) || undefined : undefined),
    genres: m.genres || [],
    duration: m.duration || undefined,
    seasonsCount: m.seasonsCount || (m.seasons ? m.seasons.length : undefined),
    episodesCount: m.episodesCount || undefined,
    seasons: m.seasons || undefined,
    trailerUrl: m.trailerUrl || undefined,
    cast: m.cast || undefined,
    director: m.director || undefined,
    featured: Boolean(m.featured),
    popular: Boolean(m.popular),
    trending: Boolean(m.trending),
    createdAt: m.createdAt || undefined,
    updatedAt: m.updatedAt || undefined
  };
}

function sanitizeSourceForApi(src: any) {
  return {
    id: src.id,
    tmdbId: Number(src.tmdbId || 0),
    type: src.type === 'series' ? 'tv' : (src.type || 'movie'),
    season: src.season ?? undefined,
    episode: src.episode ?? undefined,
    url: src.url,
    format: src.format || 'auto',
    provider: src.provider || src.serverName || 'Servidor Oficial',
    serverName: src.serverName || src.provider || 'Servidor Oficial',
    label: src.label || src.serverName || 'Servidor Principal',
    quality: src.quality || '1080p',
    audioLanguage: src.audioLanguage || 'Português',
    isPrimary: Boolean(src.isPrimary),
    priority: typeof src.priority === 'number' ? src.priority : 1,
    enabled: src.enabled !== false,
    classification: mapToCanonicalClassification(
      src.sourceKind,
      src.format,
      src.diagnostics?.recommendedPlaybackMode
    ),
    state: mapToCanonicalState(src.status),
    directPlayable: Boolean(src.diagnostics?.directPlayable),
    diagnostics: src.diagnostics
      ? {
          recommendedPlaybackMode: src.diagnostics.recommendedPlaybackMode,
          contentType: src.diagnostics.contentType,
          embedAllowed: src.diagnostics.embedAllowed,
          failureReason: src.diagnostics.failureReason
        }
      : undefined
  };
}

function getEndpointGroup(reqPath: string): string {
  const parts = reqPath.split('/').filter(Boolean); // ['api', 'v1', 'filmes', ...]
  if (parts.length >= 3) {
    if (parts[2] === 'player' && parts[3]) return `/api/v1/player/${parts[3]}`;
    return `/api/v1/${parts[2]}`;
  }
  return reqPath;
}

function extractRawApiKey(req: Request): string | undefined {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const val = authHeader.substring(7).trim();
    if (val.startsWith('rc_live_') || val.startsWith('rc_test_')) return val;
  }
  if (typeof req.query.api_key === 'string' && req.query.api_key.trim()) {
    return req.query.api_key.trim();
  }
  return undefined;
}

function checkRateBucket(bucketKey: string, limitPerMinute: number): { allowed: boolean; remaining: number; resetSeconds: number } {
  const now = Date.now();
  const entry = minuteBuckets.get(bucketKey);
  if (!entry || now - entry.windowStart >= 60 * 1000) {
    minuteBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return { allowed: true, remaining: Math.max(0, limitPerMinute - 1), resetSeconds: 60 };
  }
  const resetSeconds = Math.max(1, Math.ceil((entry.windowStart + 60 * 1000 - now) / 1000));
  if (entry.count >= limitPerMinute) {
    return { allowed: false, remaining: 0, resetSeconds };
  }
  entry.count += 1;
  return { allowed: true, remaining: Math.max(0, limitPerMinute - entry.count), resetSeconds };
}

function checkDailyBucket(appId: string, dailyLimit: number): boolean {
  const dayKey = new Date().toISOString().slice(0, 10);
  const entry = dailyBuckets.get(appId);
  if (!entry || entry.dayKey !== dayKey) {
    dailyBuckets.set(appId, { dayKey, count: 1 });
    return true;
  }
  if (entry.count >= dailyLimit) return false;
  entry.count += 1;
  return true;
}

function checkPlaybackHourQuota(appId: string, hourlyLimit: number): boolean {
  const now = Date.now();
  const entry = playbackHourBuckets.get(appId);
  if (!entry || now - entry.windowStart >= 3600 * 1000) {
    playbackHourBuckets.set(appId, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= hourlyLimit) return false;
  entry.count += 1;
  return true;
}

const v1ApiMiddleware = (req: Request, res: Response, next: any) => {
  // Let internal provider config/test routes use their own admin checks untouched
  if (req.path.startsWith('/providers')) {
    return next();
  }

  const startedAt = Date.now();
  const endpointGroup = getEndpointGroup(req.originalUrl.split('?')[0]);
  const originHost =
    extractHostFromHeader(req.headers['x-origin-domain'] as string) ||
    extractHostFromHeader(req.headers.origin as string) ||
    extractHostFromHeader(req.headers.referer as string);
  const serverHost = (req.headers.host || '').toLowerCase();
  const isExternalOrigin = Boolean(
    originHost &&
      (!serverHost ||
        (originHost !== serverHost && originHost.split(':')[0] !== serverHost.split(':')[0]) ||
        Boolean(req.headers['x-origin-domain']))
  );

  let metricContext: { appId?: string | null; keyId?: string | null; tier: string; error?: string | null } = {
    appId: null,
    keyId: null,
    tier: 'PUBLIC',
    error: null
  };

  res.on('finish', () => {
    db.recordApiMetric({
      method: req.method,
      path: req.originalUrl.split('?')[0],
      endpointGroup,
      statusCode: res.statusCode,
      latencyMs: Date.now() - startedAt,
      appId: metricContext.appId,
      keyId: metricContext.keyId,
      tier: metricContext.tier,
      origin: originHost,
      error: metricContext.error
    });
  });

  const globalCfg = db.getApiGlobalSettings();
  if (!globalCfg.enabled) {
    metricContext.error = 'API_DISABLED';
    return res.status(503).json({
      success: false,
      code: 'API_DISABLED',
      error: 'A API pública está temporariamente desativada pelo administrador.'
    });
  }

  if (globalCfg.disabledEndpoints.includes(endpointGroup)) {
    metricContext.error = 'ENDPOINT_DISABLED';
    return res.status(503).json({
      success: false,
      code: 'ENDPOINT_DISABLED',
      error: `O endpoint ${endpointGroup} está temporariamente desativado.`
    });
  }

  const rawKey = extractRawApiKey(req);

  if (rawKey) {
    const resolved = db.resolveApiKey(rawKey);
    if (!resolved.found || !resolved.key) {
      metricContext.error = 'INVALID_API_KEY';
      return res.status(401).json({
        success: false,
        code: 'INVALID_API_KEY',
        error: 'API Key inválida ou inexistente.'
      });
    }

    metricContext.keyId = resolved.key.id;
    metricContext.appId = resolved.key.appId;

    if (resolved.key.status === 'REVOKED') {
      metricContext.error = 'REVOKED_API_KEY';
      return res.status(401).json({
        success: false,
        code: 'REVOKED_API_KEY',
        error: 'Esta API Key foi revogada e não pode mais ser utilizada.'
      });
    }

    if (!resolved.app) {
      metricContext.error = 'APP_NOT_FOUND';
      return res.status(403).json({
        success: false,
        code: 'APP_NOT_FOUND',
        error: 'Aplicação associada a esta API Key não encontrada.'
      });
    }

    metricContext.tier = resolved.app.plan;

    if (resolved.app.status === 'SUSPENDED') {
      metricContext.error = 'APP_SUSPENDED';
      return res.status(403).json({
        success: false,
        code: 'APP_SUSPENDED',
        error: 'Esta aplicação encontra-se suspensa pelo administrador.'
      });
    }

    if (isExternalOrigin && resolved.app.authorizedDomains.length > 0) {
      if (!originHost || !isHostInAuthorizedDomains(originHost, resolved.app.authorizedDomains)) {
        metricContext.error = 'DOMAIN_NOT_AUTHORIZED';
        return res.status(403).json({
          success: false,
          code: 'DOMAIN_NOT_AUTHORIZED',
          error: `Domínio "${originHost}" não autorizado para a aplicação ${resolved.app.name}.`
        });
      }
    }

    const plan = db.getPlanConfig(resolved.app.plan);
    const minRate = checkRateBucket(`key:${resolved.key.id}`, plan.requestsPerMinute);
    res.setHeader('X-RateLimit-Limit', String(plan.requestsPerMinute));
    res.setHeader('X-RateLimit-Remaining', String(minRate.remaining));
    res.setHeader('X-RateLimit-Reset', String(minRate.resetSeconds));
    res.setHeader('X-RateLimit-Plan', plan.tier);

    if (!minRate.allowed) {
      metricContext.error = 'RATE_LIMIT_EXCEEDED';
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        error: `Limite de ${plan.requestsPerMinute} requisições/minuto excedido para o plano ${plan.tier}.`,
        retryAfterSeconds: minRate.resetSeconds
      });
    }

    if (!checkDailyBucket(resolved.app.id, plan.dailyRequests)) {
      metricContext.error = 'DAILY_QUOTA_EXCEEDED';
      return res.status(429).json({
        success: false,
        code: 'DAILY_QUOTA_EXCEEDED',
        error: `Quota diária de ${plan.dailyRequests} requisições excedida para o plano ${plan.tier}.`
      });
    }

    db.touchApiKeyUsage(resolved.key.id);
    (req as any).apiContext = {
      authenticated: true,
      key: resolved.key,
      app: resolved.app,
      plan,
      originHost
    };
    return next();
  }

  // Unauthenticated public request: enforce public rate limit
  if (!globalCfg.publicLimitedEnabled) {
    metricContext.error = 'API_KEY_REQUIRED';
    return res.status(401).json({
      success: false,
      code: 'API_KEY_REQUIRED',
      error: 'Acesso público desativado. Envie o cabeçalho x-api-key.'
    });
  }

  const clientIp = req.ip || '127.0.0.1';
  const pubRate = checkRateBucket(`pub:${clientIp}`, globalCfg.publicRateLimitPerMinute);
  res.setHeader('X-RateLimit-Limit', String(globalCfg.publicRateLimitPerMinute));
  res.setHeader('X-RateLimit-Remaining', String(pubRate.remaining));
  res.setHeader('X-RateLimit-Reset', String(pubRate.resetSeconds));
  res.setHeader('X-RateLimit-Plan', 'PUBLIC');

  if (!pubRate.allowed) {
    metricContext.error = 'RATE_LIMIT_EXCEEDED';
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      error: `Limite público (${globalCfg.publicRateLimitPerMinute} req/min) excedido. Utilize uma API Key.`
    });
  }

  (req as any).apiContext = {
    authenticated: false,
    tier: 'PUBLIC',
    originHost
  };
  next();
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Apply unified RONYCINE API v1 rate-limiting, key verification, domain check & monitoring
  app.use('/api/v1', v1ApiMiddleware);

  // --- API ROUTES ---

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', name: 'RONYCINE API', timestamp: new Date().toISOString() });
  });

  // Get Catalog with filtering & pagination
  app.get('/api/catalog', (req: Request, res: Response) => {
    const { type, genre, search, section, yearFrom, yearTo, minRating, maxRating, status, source, sort, page, limit } = req.query;
    const result = db.getCatalog({
      type: type as string,
      genre: genre as string,
      search: search as string,
      section: section as string,
      yearFrom: yearFrom ? parseInt(yearFrom as string) : undefined,
      yearTo: yearTo ? parseInt(yearTo as string) : undefined,
      minRating: minRating ? parseFloat(minRating as string) : undefined,
      maxRating: maxRating ? parseFloat(maxRating as string) : undefined,
      status: status as string,
      source: source as string,
      sort: sort as string,
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 50
    });
    res.json(result);
  });

  // Public Real Stats endpoint
  app.get(['/api/stats', '/api/v1/stats'], async (req: Request, res: Response) => {
    try {
      const publicStats = db.getPublicStats();
      const stats = db.getStats();
      const sources = await db.getAllVideoSources();
      res.json({
        success: true,
        moviesCount: publicStats.moviesCount,
        seriesCount: publicStats.seriesCount,
        episodesCount: publicStats.episodesCount,
        totalCatalog: publicStats.totalCatalog,
        movies: publicStats.moviesCount,
        series: publicStats.seriesCount,
        links: stats.totalLinks + sources.length,
        status: 'Online'
      });
    } catch (err) {
      const media = db.getAllMedia();
      const movies = media.filter(m => m.type === 'movie').length;
      const series = media.filter(m => m.type === 'tv' || m.type === 'series').length;
      res.json({
        success: true,
        moviesCount: movies,
        seriesCount: series,
        episodesCount: 0,
        totalCatalog: movies + series,
        movies,
        series,
        links: 0,
        status: 'Online'
      });
    }
  });

  // RONYCINE API v1 - Health & System Diagnostics
  app.get('/api/v1/saude', (req: Request, res: Response) => {
    const publicStats = db.getPublicStats();
    const globalCfg = db.getApiGlobalSettings();
    const ctx = (req as any).apiContext;
    res.json({
      success: true,
      data: {
        status: globalCfg.enabled ? 'ONLINE' : 'MAINTENANCE',
        name: 'RONYCINE API',
        version: '1.0.0',
        uptimeSeconds: Math.floor(process.uptime()),
        database: 'ok',
        catalog: {
          movies: publicStats.moviesCount,
          series: publicStats.seriesCount,
          episodes: publicStats.episodesCount,
          total: publicStats.totalCatalog
        },
        authMode: ctx?.authenticated ? `API_KEY (${ctx.plan?.tier})` : 'PUBLIC_LIMITED',
        timestamp: new Date().toISOString()
      }
    });
  });

  // RONYCINE API v1 - Plans catalog (real store config)
  app.get('/api/v1/plans', (req: Request, res: Response) => {
    const plans = Object.values(db.getPlansConfig()).filter(p => p.active !== false);
    res.json({ success: true, data: plans });
  });

  // Helper to parse & validate pagination params
  const parsePagination = (req: Request, defaultLimit = 20) => {
    const pageRaw = req.query.page !== undefined ? parseInt(String(req.query.page), 10) : 1;
    const limitRaw = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : defaultLimit;
    if (isNaN(pageRaw) || pageRaw < 1) {
      return { error: 'Parâmetro page deve ser um inteiro >= 1.' };
    }
    if (isNaN(limitRaw) || limitRaw < 1 || limitRaw > 100) {
      return { error: 'Parâmetro limit deve estar entre 1 e 100.' };
    }
    return { page: pageRaw, limit: limitRaw };
  };

  // Developer API v1 - Movies List
  app.get('/api/v1/filmes', (req: Request, res: Response) => {
    const pag = parsePagination(req, 20);
    if ('error' in pag) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: pag.error });
    }
    const { genero, genre, ano, year, ordenar, sort, q, search } = req.query;
    const yearVal = ano || year;
    const parsedYear = yearVal ? parseInt(String(yearVal), 10) : undefined;
    if (yearVal && (isNaN(parsedYear!) || parsedYear! < 1900 || parsedYear! > 2100)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: 'Parâmetro ano inválido.' });
    }

    const result = db.getCatalog({
      type: 'movie',
      genre: (genero || genre) as string,
      yearFrom: parsedYear,
      yearTo: parsedYear,
      sort: (ordenar || sort) as string,
      search: (q || search) as string,
      page: pag.page,
      limit: pag.limit
    });

    res.json({
      success: true,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      pagination: { total: result.total, page: result.page, limit: pag.limit, totalPages: result.totalPages },
      data: result.items.map(sanitizeMediaForApi)
    });
  });

  // Helper to deduplicate and normalize merged sources
  const mergeAndDedupeSources = (pSources: any[], vSources: any[]) => {
    const map = new Map<string, any>();
    for (const s of pSources) {
      if (!s?.url) continue;
      const classified = classifySourceUrl(s.originalUrl || s.url);
      map.set(s.url, {
        ...s,
        originalUrl: s.originalUrl || s.url,
        sourceKind: s.sourceKind || classified.sourceKind,
        priority: typeof s.priority === 'number' ? s.priority : 999,
        enabled: s.enabled !== false,
        diagnostics: s.diagnostics || classified.diagnostics
      });
    }
    for (const v of vSources) {
      if (!v?.url) continue;
      const classified = classifySourceUrl(v.originalUrl || v.url);
      map.set(v.url, {
        id: v.id,
        tmdbId: Number(v.contentId),
        type: v.contentType === 'series' ? 'tv' : v.contentType,
        season: v.seasonNumber,
        episode: v.episodeNumber,
        url: v.url,
        originalUrl: v.originalUrl || v.url,
        sourceKind: v.sourceKind || classified.sourceKind,
        format: v.format || classified.suggestedFormat,
        provider: v.serverName || v.providerName || v.provider || 'Servidor Oficial',
        serverName: v.serverName || v.providerName || 'Servidor Oficial',
        label: v.serverName || v.sourceName || v.quality || 'Servidor Principal',
        quality: v.quality || '1080p',
        audioLanguage: v.audioLanguage || 'Português',
        isPrimary: v.isPrimary ?? false,
        priority: typeof v.priority === 'number' ? v.priority : 1,
        enabled: v.enabled !== false,
        status: v.status || 'registered',
        diagnostics: v.diagnostics || classified.diagnostics,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt
      });
    }
    return Array.from(map.values()).sort((a, b) => {
      const enabledA = a.enabled === false ? 0 : 1;
      const enabledB = b.enabled === false ? 0 : 1;
      if (enabledB !== enabledA) return enabledB - enabledA;
      if ((b.isPrimary ? 1 : 0) !== (a.isPrimary ? 1 : 0)) return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
      const prioA = typeof a.priority === 'number' ? a.priority : 999;
      const prioB = typeof b.priority === 'number' ? b.priority : 999;
      if (prioA !== prioB) return prioA - prioB;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  };

  // Developer API v1 - Movie Details & Video Sources
  app.get('/api/v1/filmes/:tmdbId', async (req: Request, res: Response) => {
    const tmdbId = parseInt(req.params.tmdbId, 10);
    if (isNaN(tmdbId) || tmdbId <= 0) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', error: 'TMDB ID numérico positivo obrigatório' });
    }
    const item = await ensureMediaCatalogEntry(tmdbId, 'movie');
    if (!item) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Filme não encontrado na rede RONYCINE' });
    }

    const { sources } = db.getMediaAndSources(tmdbId, 'movie');
    const vSources = await db.getVideoSources({ contentId: tmdbId, contentType: 'movie' });
    const merged = mergeAndDedupeSources(sources, vSources)
      .filter(s => !isSourceDisabledOrUnavailable(s))
      .map(sanitizeSourceForApi);

    res.json({
      success: true,
      data: {
        ...sanitizeMediaForApi(item),
        sources: merged
      }
    });
  });

  // Developer API v1 - Series List
  app.get('/api/v1/series', (req: Request, res: Response) => {
    const pag = parsePagination(req, 20);
    if ('error' in pag) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: pag.error });
    }
    const { genero, genre, ano, year, ordenar, sort, q, search } = req.query;
    const yearVal = ano || year;
    const parsedYear = yearVal ? parseInt(String(yearVal), 10) : undefined;
    if (yearVal && (isNaN(parsedYear!) || parsedYear! < 1900 || parsedYear! > 2100)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: 'Parâmetro ano inválido.' });
    }

    const result = db.getCatalog({
      type: 'series',
      genre: (genero || genre) as string,
      yearFrom: parsedYear,
      yearTo: parsedYear,
      sort: (ordenar || sort) as string,
      search: (q || search) as string,
      page: pag.page,
      limit: pag.limit
    });

    res.json({
      success: true,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      pagination: { total: result.total, page: result.page, limit: pag.limit, totalPages: result.totalPages },
      data: result.items.map(sanitizeMediaForApi)
    });
  });

  // Developer API v1 - Series Details
  app.get('/api/v1/series/:tmdbId', async (req: Request, res: Response) => {
    const tmdbId = parseInt(req.params.tmdbId, 10);
    if (isNaN(tmdbId) || tmdbId <= 0) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', error: 'TMDB ID numérico positivo obrigatório' });
    }
    const item = await ensureMediaCatalogEntry(tmdbId, 'tv');
    if (!item) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Série não encontrada na rede RONYCINE' });
    }

    res.json({
      success: true,
      data: sanitizeMediaForApi(item)
    });
  });

  // Developer API v1 - Series Season Episodes
  app.get('/api/v1/series/:tmdbId/temporadas/:season', async (req: Request, res: Response) => {
    const tmdbId = parseInt(req.params.tmdbId, 10);
    const season = parseInt(req.params.season, 10);
    if (isNaN(tmdbId) || tmdbId <= 0 || isNaN(season) || season < 0) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: 'TMDB ID e Temporada devem ser numéricos válidos' });
    }

    const item = await ensureMediaCatalogEntry(tmdbId, 'tv', season);
    if (!item) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Série não encontrada' });
    }

    const freshItem = db.getMediaByTmdbAndType(tmdbId, 'tv') || item;
    const seasonObj = (freshItem.seasons || []).find(s => Number(s.seasonNumber) === season);
    if (!seasonObj) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', error: `Temporada ${season} não encontrada para esta série.` });
    }

    res.json({
      success: true,
      data: {
        tmdbId,
        seriesTitle: freshItem.title,
        seasonNumber: seasonObj.seasonNumber,
        name: seasonObj.name || `Temporada ${season}`,
        overview: seasonObj.overview || '',
        posterPath: seasonObj.posterPath || freshItem.posterPath || '',
        episodesCount: seasonObj.episodes?.length || seasonObj.episodeCount || 0,
        episodes: seasonObj.episodes || []
      }
    });
  });

  // Developer API v1 - Series Episode Sources
  app.get('/api/v1/series/:tmdbId/temporadas/:season/episodios/:episode', async (req: Request, res: Response) => {
    const tmdbId = parseInt(req.params.tmdbId, 10);
    const season = parseInt(req.params.season, 10);
    const episode = parseInt(req.params.episode, 10);

    if (isNaN(tmdbId) || tmdbId <= 0 || isNaN(season) || season < 0 || isNaN(episode) || episode <= 0) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: 'TMDB ID, Temporada e Episódio devem ser numéricos válidos' });
    }

    const item = await ensureMediaCatalogEntry(tmdbId, 'tv', season, episode);
    if (!item) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Série não encontrada' });
    }

    const freshItem = db.getMediaByTmdbAndType(tmdbId, 'tv') || item;
    const seasonObj = (freshItem.seasons || []).find(s => Number(s.seasonNumber) === season);
    const epObj = seasonObj?.episodes?.find(e => Number(e.episodeNumber) === episode);

    const { sources } = db.getMediaAndSources(tmdbId, 'tv', season, episode);
    const vSources = await db.getVideoSources({ contentId: tmdbId, contentType: 'tv', seasonNumber: season, episodeNumber: episode });
    const merged = mergeAndDedupeSources(sources, vSources)
      .filter(s => !isSourceDisabledOrUnavailable(s))
      .map(sanitizeSourceForApi);

    res.json({
      success: true,
      data: {
        tmdbId,
        type: 'tv',
        season,
        episode,
        title: freshItem.title,
        episodeTitle: epObj?.title || `Episódio ${episode}`,
        overview: epObj?.overview || '',
        stillPath: epObj?.stillPath || undefined,
        duration: epObj?.duration || undefined,
        sources: merged
      }
    });
  });

  // Developer API v1 - Catalog Search
  app.get('/api/v1/buscar', (req: Request, res: Response) => {
    const pag = parsePagination(req, 20);
    if ('error' in pag) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: pag.error });
    }
    const q = String(req.query.q || req.query.search || '').trim();
    if (!q) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: 'Parâmetro de pesquisa q é obrigatório.' });
    }
    const rawType = String(req.query.tipo || req.query.type || 'all').toLowerCase();
    const mappedType = rawType === 'filmes' ? 'movie' : rawType === 'series' ? 'tv' : rawType;

    const result = db.getCatalog({
      search: q,
      type: mappedType,
      page: pag.page,
      limit: pag.limit
    });

    res.json({
      success: true,
      query: q,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      pagination: { total: result.total, page: result.page, limit: pag.limit, totalPages: result.totalPages },
      data: result.items.map(sanitizeMediaForApi)
    });
  });

  // Developer API v1 - Popular & Recent
  app.get('/api/v1/populares', (req: Request, res: Response) => {
    const pag = parsePagination(req, 20);
    if ('error' in pag) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: pag.error });
    }
    const rawType = String(req.query.tipo || req.query.type || 'all').toLowerCase();
    const mappedType = rawType === 'filmes' ? 'movie' : rawType === 'series' ? 'tv' : rawType;
    const result = db.getCatalog({
      type: mappedType,
      sort: 'popular',
      page: pag.page,
      limit: pag.limit
    });
    res.json({
      success: true,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      pagination: { total: result.total, page: result.page, limit: pag.limit, totalPages: result.totalPages },
      data: result.items.map(sanitizeMediaForApi)
    });
  });

  app.get('/api/v1/recentes', (req: Request, res: Response) => {
    const pag = parsePagination(req, 20);
    if ('error' in pag) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: pag.error });
    }
    const rawType = String(req.query.tipo || req.query.type || 'all').toLowerCase();
    const mappedType = rawType === 'filmes' ? 'movie' : rawType === 'series' ? 'tv' : rawType;
    const result = db.getCatalog({
      type: mappedType,
      sort: 'recent',
      page: pag.page,
      limit: pag.limit
    });
    res.json({
      success: true,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      pagination: { total: result.total, page: result.page, limit: pag.limit, totalPages: result.totalPages },
      data: result.items.map(sanitizeMediaForApi)
    });
  });

  // Developer API v1 - Genres
  app.get('/api/v1/generos', (req: Request, res: Response) => {
    const summary = db.getGenresSummary();
    const nameToTmdbId = Object.fromEntries(Object.entries(GENRE_ID_TO_NAME).map(([k, v]) => [slugifyText(v), Number(k)]));
    const list = summary.map(g => {
      const slug = slugifyText(g.name);
      return {
        id: nameToTmdbId[slug] || slug,
        slug,
        name: g.name,
        count: g.count
      };
    });
    res.json({ success: true, total: list.length, data: list });
  });

  app.get('/api/v1/generos/:id', (req: Request, res: Response) => {
    const pag = parsePagination(req, 20);
    if ('error' in pag) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: pag.error });
    }
    const rawParam = decodeURIComponent(req.params.id || '').trim();
    const numericId = /^\d+$/.test(rawParam) ? parseInt(rawParam, 10) : NaN;
    const summary = db.getGenresSummary();
    let targetName = !isNaN(numericId) ? GENRE_ID_TO_NAME[numericId] : undefined;
    if (!targetName) {
      const paramSlug = slugifyText(rawParam);
      const match = summary.find(g => slugifyText(g.name) === paramSlug);
      targetName = match?.name || rawParam;
    }

    const rawType = String(req.query.tipo || req.query.type || 'all').toLowerCase();
    const mappedType = rawType === 'filmes' ? 'movie' : rawType === 'series' ? 'tv' : rawType;

    const result = db.getCatalog({
      genre: targetName,
      type: mappedType,
      page: pag.page,
      limit: pag.limit
    });

    res.json({
      success: true,
      genre: targetName,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      pagination: { total: result.total, page: result.page, limit: pag.limit, totalPages: result.totalPages },
      data: result.items.map(sanitizeMediaForApi)
    });
  });

  // Developer API v1 - Protected Sources & Playback Token Issuance
  app.get('/api/v1/fontes/:contentId', async (req: Request, res: Response) => {
    const ctx = (req as any).apiContext;
    const globalCfg = db.getApiGlobalSettings();
    if (globalCfg.requireKeyForSources && !ctx?.authenticated) {
      return res.status(401).json({
        success: false,
        code: 'API_KEY_REQUIRED',
        error: 'Este endpoint requer uma API Key válida no cabeçalho x-api-key.'
      });
    }
    if (ctx?.authenticated && ctx.plan && !ctx.plan.allowSourcesEndpoint) {
      return res.status(403).json({
        success: false,
        code: 'PLAN_RESTRICTED',
        error: `O plano ${ctx.plan.tier} não permite acesso direto ao endpoint de fontes.`
      });
    }

    const contentId = parseInt(req.params.contentId, 10);
    if (isNaN(contentId) || contentId <= 0) {
      return res.status(400).json({ success: false, code: 'INVALID_ID', error: 'ID de conteúdo numérico obrigatório.' });
    }

    const rawType = String(req.query.type || req.query.tipo || 'movie').toLowerCase();
    const mediaType: 'movie' | 'tv' = rawType === 'tv' || rawType === 'series' ? 'tv' : 'movie';
    const season = req.query.season ? parseInt(String(req.query.season), 10) : 1;
    const episode = req.query.episode ? parseInt(String(req.query.episode), 10) : 1;

    const item = await ensureMediaCatalogEntry(contentId, mediaType, season, episode);
    if (!item) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Conteúdo não encontrado.' });
    }

    const { sources } = db.getMediaAndSources(contentId, mediaType, mediaType === 'tv' ? season : undefined, mediaType === 'tv' ? episode : undefined);
    const vSources = await db.getVideoSources({
      contentId,
      contentType: mediaType,
      seasonNumber: mediaType === 'tv' ? season : undefined,
      episodeNumber: mediaType === 'tv' ? episode : undefined
    });
    const merged = mergeAndDedupeSources(sources, vSources)
      .filter(s => !isSourceDisabledOrUnavailable(s))
      .map(sanitizeSourceForApi);

    const ttlSeconds = globalCfg.playbackTokenTtlSeconds || 900;
    const playbackToken = ctx?.app
      ? createPlaybackToken(
          {
            contentId,
            mediaType,
            season: mediaType === 'tv' ? season : undefined,
            episode: mediaType === 'tv' ? episode : undefined,
            appId: ctx.app.id,
            keyId: ctx.key?.id,
            allowedDomains: ctx.app.authorizedDomains
          },
          ttlSeconds
        )
      : undefined;

    const embedPath =
      mediaType === 'tv'
        ? `/player/${contentId}?type=tv&season=${season}&episode=${episode}${playbackToken ? `&token=${playbackToken}` : ''}`
        : `/player/${contentId}?type=movie${playbackToken ? `&token=${playbackToken}` : ''}`;

    res.json({
      success: true,
      data: {
        contentId,
        mediaType,
        title: item.title,
        season: mediaType === 'tv' ? season : undefined,
        episode: mediaType === 'tv' ? episode : undefined,
        totalSources: merged.length,
        playbackToken,
        expiresIn: playbackToken ? ttlSeconds : undefined,
        embedUrl: embedPath,
        sources: merged
      }
    });
  });

  app.post('/api/v1/player/token', async (req: Request, res: Response) => {
    const ctx = (req as any).apiContext;
    if (!ctx?.authenticated || !ctx.app) {
      return res.status(401).json({
        success: false,
        code: 'API_KEY_REQUIRED',
        error: 'É necessário autenticar com uma API Key válida para gerar tokens de reprodução.'
      });
    }
    if (ctx.plan && !ctx.plan.allowEmbedPlayer) {
      return res.status(403).json({
        success: false,
        code: 'PLAN_RESTRICTED',
        error: `O plano ${ctx.plan.tier} não permite geração de sessões de player.`
      });
    }

    const { contentId, type, tipo, season, episode, domain, ttlSeconds } = req.body || {};
    const numId = parseInt(String(contentId), 10);
    if (isNaN(numId) || numId <= 0) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: 'contentId numérico positivo obrigatório.' });
    }

    const rawType = String(type || tipo || 'movie').toLowerCase();
    const mediaType: 'movie' | 'tv' = rawType === 'tv' || rawType === 'series' ? 'tv' : 'movie';
    const sNum = mediaType === 'tv' ? Math.max(0, parseInt(String(season || 1), 10) || 1) : undefined;
    const eNum = mediaType === 'tv' ? Math.max(1, parseInt(String(episode || 1), 10) || 1) : undefined;

    if (domain && typeof domain === 'string' && ctx.app.authorizedDomains.length > 0) {
      const normalized = normalizeDomainEntry(domain);
      if (!normalized || !isHostInAuthorizedDomains(normalized, ctx.app.authorizedDomains)) {
        return res.status(403).json({
          success: false,
          code: 'DOMAIN_NOT_AUTHORIZED',
          error: `Domínio "${domain}" não está na lista de domínios autorizados desta aplicação.`
        });
      }
    }

    const plan: PlanConfig = ctx.plan || db.getPlanConfig(ctx.app.plan);
    if (!checkPlaybackHourQuota(ctx.app.id, plan.maxPlaybackSessionsPerHour)) {
      return res.status(429).json({
        success: false,
        code: 'PLAYBACK_QUOTA_EXCEEDED',
        error: `Limite de ${plan.maxPlaybackSessionsPerHour} sessões de playback por hora atingido.`
      });
    }

    const globalCfg = db.getApiGlobalSettings();
    const maxTtl = globalCfg.playbackTokenTtlSeconds || 900;
    const resolvedTtl =
      ttlSeconds !== undefined && !isNaN(Number(ttlSeconds))
        ? Math.max(1, Math.min(maxTtl, Math.floor(Number(ttlSeconds))))
        : maxTtl;

    const token = createPlaybackToken(
      {
        contentId: numId,
        mediaType,
        season: sNum,
        episode: eNum,
        appId: ctx.app.id,
        keyId: ctx.key?.id,
        allowedDomains: ctx.app.authorizedDomains
      },
      resolvedTtl
    );

    const embedPath =
      mediaType === 'tv'
        ? `/player/${numId}?type=tv&season=${sNum}&episode=${eNum}&token=${token}`
        : `/player/${numId}?type=movie&token=${token}`;

    res.json({
      success: true,
      data: {
        token,
        expiresIn: resolvedTtl,
        expiresAt: new Date(Date.now() + resolvedTtl * 1000).toISOString(),
        contentId: numId,
        mediaType,
        season: sNum,
        episode: eNum,
        allowedDomains: ctx.app.authorizedDomains,
        embedUrl: embedPath
      }
    });
  });

  // ==========================================
  // RONYCINE DIRECT PLAY — RESOLUÇÃO POR TMDB ID
  // ==========================================
  const isSourceDisabledOrUnavailable = (src: any) => {
    if (!src || src.enabled === false) return true;
    const lower = String(src.status || '').toLowerCase();
    return lower === 'inactive' || lower === 'offline' || lower === 'embed_blocked' || lower === 'unsupported_format';
  };

  async function resolveDirectPlayPayload(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    requestedSeason?: number,
    requestedEpisode?: number
  ) {
    const catalogItem = await ensureMediaCatalogEntry(tmdbId, mediaType, requestedSeason, requestedEpisode);
    if (!catalogItem) {
      return {
        httpStatus: 404,
        payload: {
          success: false,
          state: 'CONTENT_NOT_FOUND' as const,
          code: 'CONTENT_NOT_FOUND',
          tmdbId,
          type: mediaType,
          season: mediaType === 'tv' ? requestedSeason : undefined,
          episode: mediaType === 'tv' ? requestedEpisode : undefined,
          watchPath:
            mediaType === 'tv' && requestedSeason && requestedEpisode
              ? `/watch/tv/${tmdbId}/${requestedSeason}/${requestedEpisode}`
              : `/watch/${mediaType}/${tmdbId}`,
          message: 'Conteúdo não encontrado na RONYCINE API.',
          error: 'Conteúdo não encontrado na RONYCINE API.',
          content: null,
          source: null,
          sources: []
        }
      };
    }

    let resolvedSeason = requestedSeason;
    let resolvedEpisode = requestedEpisode;

    if (mediaType === 'tv' && (resolvedSeason === undefined || resolvedEpisode === undefined)) {
      const { sources: allTvLocal } = db.getMediaAndSources(tmdbId, 'tv');
      const allTvVideo = await db.getVideoSources({ contentId: tmdbId, contentType: 'tv' });
      const mergedTv = mergeAndDedupeSources(allTvLocal, allTvVideo);
      const activeTvSources = mergedTv.filter(s => !isSourceDisabledOrUnavailable(s));

      const s1e1 = activeTvSources.find(s => Number(s.season || 1) === 1 && Number(s.episode || 1) === 1);
      if (s1e1) {
        resolvedSeason = 1;
        resolvedEpisode = 1;
      } else if (activeTvSources.length > 0) {
        const sortedByEp = [...activeTvSources].sort((a, b) => {
          const sa = Number(a.season || 1);
          const sb = Number(b.season || 1);
          if (sa !== sb) return sa - sb;
          return Number(a.episode || 1) - Number(b.episode || 1);
        });
        resolvedSeason = Number(sortedByEp[0].season || 1);
        resolvedEpisode = Number(sortedByEp[0].episode || 1);
      } else {
        const firstSeason = (catalogItem.seasons || []).find(s => Number(s.seasonNumber) > 0) || catalogItem.seasons?.[0];
        const firstEp = firstSeason?.episodes?.[0];
        resolvedSeason = Number(firstSeason?.seasonNumber || 1);
        resolvedEpisode = Number(firstEp?.episodeNumber || 1);
      }
    }

    const { sources: localSources } = db.getMediaAndSources(
      tmdbId,
      mediaType,
      mediaType === 'tv' ? resolvedSeason : undefined,
      mediaType === 'tv' ? resolvedEpisode : undefined
    );
    const vSources = await db.getVideoSources({
      contentId: tmdbId,
      contentType: mediaType,
      seasonNumber: mediaType === 'tv' ? resolvedSeason : undefined,
      episodeNumber: mediaType === 'tv' ? resolvedEpisode : undefined
    });

    const allSources = mergeAndDedupeSources(localSources, vSources);
    const playableSources = allSources.filter(s => !isSourceDisabledOrUnavailable(s));
    const mappedPlayable = playableSources.map(sanitizeSourceForApi);

    const watchPath =
      mediaType === 'tv'
        ? `/watch/tv/${tmdbId}/${resolvedSeason}/${resolvedEpisode}`
        : `/watch/movie/${tmdbId}`;
    const embedPath = buildOfficialEmbedPath({
      tmdbId,
      type: mediaType,
      season: resolvedSeason,
      episode: resolvedEpisode
    });
    const embedUrl = buildOfficialEmbedUrl({
      tmdbId,
      type: mediaType,
      season: resolvedSeason,
      episode: resolvedEpisode
    });

    const seasonObj =
      mediaType === 'tv'
        ? (catalogItem.seasons || []).find(s => Number(s.seasonNumber) === Number(resolvedSeason))
        : undefined;
    const epObj =
      mediaType === 'tv'
        ? seasonObj?.episodes?.find(e => Number(e.episodeNumber) === Number(resolvedEpisode))
        : undefined;

    const contentSummary = {
      ...sanitizeMediaForApi(catalogItem),
      season: mediaType === 'tv' ? resolvedSeason : undefined,
      episode: mediaType === 'tv' ? resolvedEpisode : undefined,
      episodeTitle: epObj?.title,
      episodeOverview: epObj?.overview
    };

    if (allSources.length === 0) {
      return {
        httpStatus: 200,
        payload: {
          success: false,
          state: 'NO_SOURCE_AVAILABLE' as const,
          code: 'NO_SOURCE_AVAILABLE',
          tmdbId,
          type: mediaType,
          season: mediaType === 'tv' ? resolvedSeason : undefined,
          episode: mediaType === 'tv' ? resolvedEpisode : undefined,
          watchPath,
          embedPath,
          embedUrl,
          baseUrl: OFFICIAL_BASE_URL,
          message: 'Este conteúdo ainda não possui uma fonte de reprodução disponível.',
          content: contentSummary,
          source: null,
          sources: []
        }
      };
    }

    if (playableSources.length === 0) {
      return {
        httpStatus: 200,
        payload: {
          success: false,
          state: 'SOURCE_UNAVAILABLE' as const,
          code: 'SOURCE_UNAVAILABLE',
          tmdbId,
          type: mediaType,
          season: mediaType === 'tv' ? resolvedSeason : undefined,
          episode: mediaType === 'tv' ? resolvedEpisode : undefined,
          watchPath,
          embedPath,
          embedUrl,
          baseUrl: OFFICIAL_BASE_URL,
          message: 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.',
          content: contentSummary,
          source: null,
          sources: []
        }
      };
    }

    const primary = mappedPlayable[0];
    return {
      httpStatus: 200,
      payload: {
        success: true,
        state: 'READY' as const,
        code: 'READY',
        tmdbId,
        type: mediaType,
        season: mediaType === 'tv' ? resolvedSeason : undefined,
        episode: mediaType === 'tv' ? resolvedEpisode : undefined,
        watchPath,
        embedPath,
        embedUrl,
        baseUrl: OFFICIAL_BASE_URL,
        message: 'Conteúdo pronto para reprodução direta.',
        content: contentSummary,
        source: primary,
        sources: mappedPlayable,
        alternativeSources: mappedPlayable.slice(1),
        nextEpisode:
          mediaType === 'tv'
            ? { available: true, season: resolvedSeason, episode: (resolvedEpisode || 1) + 1 }
            : undefined
      }
    };
  }

  app.get('/api/v1/direct-play/:type/:tmdbId', async (req: Request, res: Response) => {
    const rawType = String(req.params.type || '').toLowerCase();
    if (!['movie', 'filme', 'filmes', 'tv', 'series', 'serie'].includes(rawType)) {
      return res.status(400).json({
        success: false,
        state: 'INVALID_PARAMS',
        code: 'INVALID_PARAMS',
        error: 'Tipo inválido. Utilize movie ou tv.'
      });
    }
    const mediaType: 'movie' | 'tv' = rawType === 'tv' || rawType === 'series' || rawType === 'serie' ? 'tv' : 'movie';
    const tmdbId = parseInt(req.params.tmdbId, 10);
    if (isNaN(tmdbId) || tmdbId <= 0) {
      return res.status(400).json({
        success: false,
        state: 'INVALID_PARAMS',
        code: 'INVALID_ID',
        error: 'TMDB ID numérico positivo obrigatório.'
      });
    }

    const qSeason = req.query.season !== undefined ? parseInt(String(req.query.season), 10) : undefined;
    const qEpisode = req.query.episode !== undefined ? parseInt(String(req.query.episode), 10) : undefined;
    const seasonParam = mediaType === 'tv' && qSeason !== undefined && !isNaN(qSeason) && qSeason >= 0 ? qSeason : undefined;
    const episodeParam = mediaType === 'tv' && qEpisode !== undefined && !isNaN(qEpisode) && qEpisode > 0 ? qEpisode : undefined;

    const result = await resolveDirectPlayPayload(tmdbId, mediaType, seasonParam, episodeParam);
    return res.status(result.httpStatus).json(result.payload);
  });

  app.get('/api/v1/direct-play/:type/:tmdbId/:season/:episode', async (req: Request, res: Response) => {
    const rawType = String(req.params.type || '').toLowerCase();
    if (!['tv', 'series', 'serie', 'movie', 'filme'].includes(rawType)) {
      return res.status(400).json({
        success: false,
        state: 'INVALID_PARAMS',
        code: 'INVALID_PARAMS',
        error: 'Tipo inválido para episódio. Utilize tv.'
      });
    }
    const mediaType: 'movie' | 'tv' = rawType === 'movie' || rawType === 'filme' ? 'movie' : 'tv';
    const tmdbId = parseInt(req.params.tmdbId, 10);
    const season = parseInt(req.params.season, 10);
    const episode = parseInt(req.params.episode, 10);

    if (isNaN(tmdbId) || tmdbId <= 0 || isNaN(season) || season < 0 || isNaN(episode) || episode <= 0) {
      return res.status(400).json({
        success: false,
        state: 'INVALID_PARAMS',
        code: 'INVALID_PARAMS',
        error: 'TMDB ID, Temporada e Episódio devem ser numéricos válidos.'
      });
    }

    const result = await resolveDirectPlayPayload(
      tmdbId,
      mediaType,
      mediaType === 'tv' ? season : undefined,
      mediaType === 'tv' ? episode : undefined
    );
    return res.status(result.httpStatus).json(result.payload);
  });

  app.post('/api/v1/direct-play/check-availability', async (req: Request, res: Response) => {
    try {
      const { tmdbId, type, season, episode, sourceId } = req.body || {};
      const numId = parseInt(String(tmdbId), 10);
      if (isNaN(numId) || numId <= 0) {
        return res.status(400).json({ success: false, code: 'INVALID_ID', error: 'tmdbId numérico positivo obrigatório.' });
      }
      const rawType = String(type || 'movie').toLowerCase();
      const mediaType: 'movie' | 'tv' = rawType === 'tv' || rawType === 'series' || rawType === 'serie' ? 'tv' : 'movie';
      const sNum = mediaType === 'tv' ? Math.max(0, parseInt(String(season || 1), 10) || 1) : undefined;
      const eNum = mediaType === 'tv' ? Math.max(1, parseInt(String(episode || 1), 10) || 1) : undefined;

      const resolved = await resolveDirectPlayPayload(numId, mediaType, sNum, eNum);
      if (resolved.payload.state === 'CONTENT_NOT_FOUND') {
        return res.status(404).json(resolved.payload);
      }
      if (!resolved.payload.sources || resolved.payload.sources.length === 0) {
        return res.json({
          ...resolved.payload,
          checked: true,
          available: false
        });
      }

      const targetSource =
        (sourceId ? resolved.payload.sources.find((s: any) => s.id === sourceId) : undefined) ||
        resolved.payload.sources[0];

      if (!targetSource?.url) {
        return res.json({
          success: false,
          state: 'NO_SOURCE_AVAILABLE',
          checked: true,
          available: false,
          message: 'Este conteúdo ainda não possui uma fonte de reprodução disponível.'
        });
      }

      const probe = await probeVideoSource(targetSource.url);
      const isAvailable = probe.accessible || probe.status === 'online' || probe.status === 'unverifiable';

      return res.json({
        success: isAvailable,
        checked: true,
        available: isAvailable,
        state: isAvailable ? 'READY' : 'SOURCE_UNAVAILABLE',
        message: isAvailable
          ? 'Fonte verificada e disponível para reprodução.'
          : 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.',
        source: targetSource,
        probe: {
          status: probe.status,
          sourceKind: probe.sourceKind,
          detectedFormat: probe.detectedFormat,
          httpStatus: probe.diagnostics?.httpStatus,
          contentType: probe.diagnostics?.contentType,
          embedAllowed: probe.diagnostics?.embedAllowed,
          directPlayable: probe.diagnostics?.directPlayable
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Erro ao verificar disponibilidade da fonte.' });
    }
  });

  // Get Catalog Categories / Genres Summary
  app.get('/api/categories', (req: Request, res: Response) => {
    res.json(db.getGenresSummary());
  });

  // Helper to ensure media catalog entry strictly from local DB without auto-importing
  async function ensureMediaCatalogEntry(tmdbId: number, type: 'movie' | 'tv', seasonNum?: number, episodeNum?: number) {
    if (!tmdbId || isNaN(tmdbId)) return null;
    const mediaId = `${type}-${tmdbId}`;
    const candidateByType = db.getMediaByTmdbAndType(tmdbId, type);
    const candidateById =
      db.getMediaById(mediaId) ||
      (type === 'tv' ? db.getMediaById(`series-${tmdbId}`) : undefined);
    const item = candidateByType || (candidateById && db.isMediaPublished(candidateById) ? candidateById : undefined);

    // Strictly manual import & published-only rule for public/direct-play access
    if (!item || !db.isMediaPublished(item)) return null;
    return item;
  }

  // Get Media Details by ID or TMDB ID (Strictly from local catalog)
  app.get('/api/catalog/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    let item = db.getMediaById(id);

    // If item not found by literal ID, check by TMDB ID + type
    if (!item && (id.startsWith('movie-') || id.startsWith('tv-') || id.startsWith('series-') || !isNaN(Number(id)))) {
      const type: 'movie' | 'tv' = id.includes('series') || id.startsWith('tv-') ? 'tv' : 'movie';
      const cleanTmdbId = parseInt(id.replace(/^(movie|series|tv)-/, ''));

      if (!isNaN(cleanTmdbId)) {
        item = db.getMediaByTmdbAndType(cleanTmdbId, type);
      }
    }

    if (!item || !db.isMediaPublished(item)) {
      return res.status(404).json({ error: 'Conteúdo não encontrado' });
    }

    res.json(item);
  });

  // Fetch Season Episodes dynamically if requested
  app.get('/api/catalog/:id/season/:seasonNumber', async (req: Request, res: Response) => {
    const { id, seasonNumber } = req.params;
    let item = db.getMediaById(id);
    if (!item) {
      const cleanTmdbId = parseInt(id.replace(/^(movie|series|tv)-/, ''));
      if (!isNaN(cleanTmdbId)) {
        item = db.getMediaByTmdbAndType(cleanTmdbId, 'tv');
      }
    }

    if (!item || (item.type !== 'tv' && item.type !== 'series')) {
      return res.status(404).json({ error: 'Série não encontrada' });
    }

    const sNum = parseInt(seasonNumber);
    const tmdbSeason = await fetchTMDB(`/tv/${item.tmdbId}/season/${sNum}`);

    if (tmdbSeason && tmdbSeason.episodes) {
      const episodes = tmdbSeason.episodes.map((ep: any) => ({
        id: `ep-${ep.id}`,
        seasonNumber: sNum,
        episodeNumber: ep.episode_number,
        title: ep.name || `Episódio ${ep.episode_number}`,
        overview: ep.overview || 'Sinopse não disponível.',
        duration: ep.runtime || 45,
        stillPath: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : undefined,
        airDate: ep.air_date,
        voteAverage: ep.vote_average ? Number(ep.vote_average.toFixed(1)) : undefined
      }));

      // Update season in DB item
      if (item.seasons) {
        const sIndex = item.seasons.findIndex(s => s.seasonNumber === sNum);
        if (sIndex >= 0) {
          item.seasons[sIndex].episodes = episodes;
        } else {
          item.seasons.push({
            id: `season-${sNum}`,
            seasonNumber: sNum,
            name: tmdbSeason.name || `Temporada ${sNum}`,
            episodeCount: episodes.length,
            episodes
          });
        }
        db.upsertMediaItem(item as any);
      }

      return res.json({ seasonNumber: sNum, episodes });
    }

    res.json({ seasonNumber: sNum, episodes: [] });
  });

  // 2-STAGE SEARCH ENGINE (1st local catalog, 2nd TMDB)
  app.get('/api/search', async (req: Request, res: Response) => {
    const queryStr = (req.query.q as string || '').trim();
    const filterType = (req.query.type as string || 'all');

    if (!queryStr) {
      return res.json({ local: [], external: [], total: 0 });
    }

    // Step 1: Search local catalog
    const localResults = db.getCatalog({ search: queryStr, type: filterType, limit: 30 });

    // Step 2: If local results fewer than 10, search TMDB for recommendations
    let externalResults: any[] = [];
    if (localResults.items.length < 10) {
      if (filterType === 'movie' || filterType === 'all') {
        const movieSearch = await fetchTMDB('/search/movie', { query: queryStr });
        if (movieSearch?.results) {
          const formattedMovies = movieSearch.results.slice(0, 8).map((m: any) => formatTMDBMedia(m, 'movie'));
          externalResults.push(...formattedMovies);
        }
      }
      if (filterType === 'tv' || filterType === 'all') {
        const tvSearch = await fetchTMDB('/search/tv', { query: queryStr });
        if (tvSearch?.results) {
          const formattedSeries = tvSearch.results.slice(0, 8).map((t: any) => formatTMDBMedia(t, 'tv'));
          externalResults.push(...formattedSeries);
        }
      }
    }

    // Filter out external items that are already in local catalog
    const localTmdbIds = new Set(localResults.items.map(i => i.tmdbId));
    externalResults = externalResults.filter(ext => !localTmdbIds.has(ext.tmdbId));

    res.json({
      local: localResults.items,
      external: externalResults,
      total: localResults.items.length + externalResults.length
    });
  });

  // Watch Source Provider Route (Unified Lookup)
  app.get('/api/watch/source', async (req: Request, res: Response) => {
    const { type, tmdbId, imdbId, season, episode, language } = req.query;
    if (!tmdbId && !imdbId) {
      return res.status(400).json({ success: false, error: 'tmdbId ou imdbId é obrigatório' });
    }

    const t = (((type as string) === 'series' ? 'tv' : (type as string)) || 'movie') as 'movie' | 'tv';
    const id = tmdbId ? parseInt(tmdbId as string) : 0;
    const s = season ? parseInt(season as string) : 1;
    const ep = episode ? parseInt(episode as string) : 1;
    const lang = (language as 'dubbed' | 'subtitled') || 'dubbed';

    // 1. Ensure published media item exists in local catalog (strictly zero auto-import)
    let mediaItem: MediaItem | null = null;
    if (id > 0) {
      mediaItem = await ensureMediaCatalogEntry(id, t, s, ep);
    }

    if (!mediaItem) {
      return res.status(404).json({
        success: false,
        contentNotFound: true,
        code: 'CONTENT_NOT_FOUND',
        statusReason: 'not_found',
        content: undefined,
        source: null,
        sources: [],
        alternativeSources: [],
        message: 'Conteúdo não encontrado na RONYCINE API.',
        tmdbId: id,
        type: t,
        season: s,
        episode: ep,
        language: lang
      });
    }

    // 2. Gather sources from unified store + async Firestore fallback
    const { sources: localSources } = db.getMediaAndSources(id, t, s, ep);
    const vSources = await db.getVideoSources({
      contentId: id,
      contentType: t,
      seasonNumber: t === 'tv' ? s : undefined,
      episodeNumber: t === 'tv' ? ep : undefined
    });
    const allSources = mergeAndDedupeSources(localSources, vSources);
    const resolvedMedia = mediaItem;

    if (allSources.length > 0) {
      const isDisabledStatus = (src: any) => {
        if (src?.enabled === false) return true;
        const lower = (src?.status || '').toLowerCase();
        return lower === 'inactive' || lower === 'offline' || lower === 'embed_blocked' || lower === 'unsupported_format';
      };

      const playableSources = allSources.filter(src => !isDisabledStatus(src));
      const isPlayable = playableSources.length > 0;
      const primary = playableSources[0];
      const mappedPlayable = playableSources.map(src => ({
        id: src.id,
        url: src.url,
        originalUrl: src.originalUrl || src.url,
        sourceKind: src.sourceKind,
        type: src.format || 'auto',
        format: src.format || 'auto',
        provider: src.provider || src.serverName || 'Servidor Oficial',
        serverName: src.serverName || src.provider || 'Servidor Oficial',
        label: src.label || src.serverName || 'Servidor Principal',
        quality: src.quality || '1080p',
        audioLanguage: src.audioLanguage || 'Português',
        isPrimary: src.isPrimary ?? false,
        priority: typeof src.priority === 'number' ? src.priority : 1,
        enabled: src.enabled !== false,
        status: src.status || 'registered',
        diagnostics: src.diagnostics
      }));

      const primaryMapped = primary ? (mappedPlayable.find(m => m.id === primary.id) || mappedPlayable[0]) : null;

      return res.json({
        success: isPlayable,
        code: isPlayable ? 'READY' : 'SOURCE_UNAVAILABLE',
        contentNotFound: false,
        content: {
          id: resolvedMedia.id,
          title: resolvedMedia.title,
          type: t,
          tmdbId: id,
          season: t === 'tv' ? s : undefined,
          episode: t === 'tv' ? ep : undefined,
          poster: resolvedMedia.posterPath,
          backdrop: resolvedMedia.backdropPath,
          overview: resolvedMedia.overview
        },
        source: isPlayable ? primaryMapped : null,
        sources: isPlayable ? mappedPlayable : [],
        alternativeSources: isPlayable ? mappedPlayable.slice(1) : [],
        nextEpisode: t === 'tv' ? { available: true, season: s, episode: ep + 1 } : undefined,
        statusReason: isPlayable ? 'available' : 'offline',
        message: isPlayable
          ? 'Fonte de vídeo obtida com sucesso'
          : 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.',
        tmdbId: id,
        type: t,
        season: s,
        episode: ep,
        language: lang
      });
    }

    // When content exists in catalog but truly 0 sources exist in database
    res.json({
      success: false,
      contentNotFound: false,
      statusReason: 'no_source',
      content: {
        id: resolvedMedia.id,
        title: resolvedMedia.title,
        type: t,
        tmdbId: id,
        season: t === 'tv' ? s : undefined,
        episode: t === 'tv' ? ep : undefined,
        poster: resolvedMedia.posterPath,
        backdrop: resolvedMedia.backdropPath,
        overview: resolvedMedia.overview
      },
      source: null,
      sources: [],
      alternativeSources: [],
      message: 'Este conteúdo ainda não possui uma fonte de reprodução disponível.',
      tmdbId: id,
      type: t,
      season: s,
      episode: ep,
      language: lang
    });
  });

  // ==========================================
  // USER AUTHENTICATION & FOUNDER MANAGEMENT
  // ==========================================

  // 1. Standard Email & Password Login
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ 
        error: 'E-mail obrigatório', 
        message: 'Por favor, informe o seu endereço de e-mail.' 
      });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ 
        error: 'Senha obrigatória', 
        message: 'Por favor, informe a sua senha de acesso.' 
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const isFounder = isFounderEmail(cleanEmail);

    const user = db.findUserByEmail(cleanEmail);
    if (!user && !isFounder) {
      return res.status(401).json({
        error: 'Conta não encontrada',
        message: 'Não encontramos nenhuma conta com este e-mail. Verifique a digitação ou crie uma conta.'
      });
    }

    const check = db.verifyUserPassword(cleanEmail, password);
    if (!check.valid) {
      if (check.reason === 'Conta cadastrada com Google') {
        return res.status(400).json({
          error: 'Método de login diferente',
          message: 'Esta conta foi criada através do Google. Por favor, utilize o botão "Entrar com Google".'
        });
      }
      if (check.reason === 'Conta suspensa') {
        return res.status(403).json({
          error: 'Conta desativada',
          message: 'Esta conta foi temporariamente desativada pelo administrador.'
        });
      }
      return res.status(401).json({
        error: 'Credenciais inválidas',
        message: 'Senha incorreta. Verifique os dados digitados e tente novamente.'
      });
    }

    const authenticatedUser = check.user || user || db.findUserByEmail(cleanEmail)!;
    if (isFounder) {
      authenticatedUser.role = 'founder';
    }

    db.updateUserLastLogin(cleanEmail);

    const token = createSessionToken({
      id: authenticatedUser.id,
      email: authenticatedUser.email,
      role: authenticatedUser.role
    });

    db.addAuditLog(
      cleanEmail,
      'LOGIN',
      'SUCCESS',
      isFounder ? 'Login do Fundador autenticado com sucesso.' : 'Login de usuário realizado com sucesso.'
    );

    res.json({
      success: true,
      user: db.toPublicUser(authenticatedUser),
      token
    });
  });

  // 2. User Registration (Email + Password)
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { name, email, password } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({
        error: 'E-mail inválido',
        message: 'Por favor, insira um endereço de e-mail válido.'
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        error: 'Senha fraca',
        message: 'A senha de acesso deve possuir pelo menos 6 caracteres.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name && typeof name === 'string' && name.trim()) ? name.trim() : cleanEmail.split('@')[0];
    const isFounder = isFounderEmail(cleanEmail);

    const existing = db.findUserByEmail(cleanEmail);
    if (existing && existing.passwordHash) {
      return res.status(409).json({
        error: 'E-mail já cadastrado',
        message: 'Este e-mail já possui uma conta ativa. Faça login com sua senha.'
      });
    }

    const { hash, salt } = hashPassword(password);

    const user = db.createUser({
      name: cleanName,
      email: cleanEmail,
      role: isFounder ? 'founder' : 'user',
      passwordHash: hash,
      passwordSalt: salt,
      authProvider: 'password'
    });

    db.updateUserLastLogin(cleanEmail);

    const token = createSessionToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    db.addAuditLog(cleanEmail, 'REGISTER', 'SUCCESS', `Nova conta criada (${user.role}).`);

    res.json({
      success: true,
      user: db.toPublicUser(user),
      token
    });
  });

  // 3. Admin & Founder Direct Verification (Admin Lock Screen)
  app.post('/api/auth/admin-login', (req: Request, res: Response) => {
    const { email, password, securityCode } = req.body || {};

    if (!email || !password || !securityCode) {
      return res.status(400).json({
        error: 'Campos incompletos',
        message: 'Preencha o e-mail administrativo, a senha e o código de segurança OTP.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!isFounderEmail(cleanEmail)) {
      db.addAuditLog(cleanEmail, 'ADMIN_LOGIN', 'FAILED', 'Tentativa de acesso ao painel de fundador por e-mail não autorizado.');
      return res.status(403).json({
        error: 'Acesso Negado',
        message: 'Apenas a conta autorizada de Fundador possui permissão para este painel.'
      });
    }

    const check = db.verifyUserPassword(cleanEmail, password);
    if (!check.valid && password !== ADMIN_PASSWORD) {
      db.addAuditLog(cleanEmail, 'ADMIN_LOGIN', 'FAILED', 'Senha incorreta para acesso de fundador.');
      return res.status(401).json({
        error: 'Credenciais inválidas',
        message: 'A senha administrativa fornecida está incorreta.'
      });
    }

    if (securityCode.trim() !== ADMIN_SECURITY_CODE) {
      db.addAuditLog(cleanEmail, 'ADMIN_LOGIN', 'FAILED', 'Código OTP de segurança incorreto.');
      return res.status(401).json({
        error: 'Código de segurança incorreto',
        message: 'O código de segurança OTP informado é inválido.'
      });
    }

    let founderUser = db.findUserByEmail(cleanEmail);
    if (!founderUser) {
      founderUser = db.createUser({
        name: 'Fundador RONYCINE',
        email: cleanEmail,
        role: 'founder'
      });
    } else if (founderUser.role !== 'founder') {
      founderUser.role = 'founder';
    }

    db.updateUserLastLogin(cleanEmail);

    const token = createSessionToken({
      id: founderUser.id,
      email: founderUser.email,
      role: 'founder'
    });

    db.addAuditLog(cleanEmail, 'ADMIN_LOGIN', 'SUCCESS', 'Painel administrativo desbloqueado pelo Fundador com sucesso.');

    res.json({
      success: true,
      user: db.toPublicUser(founderUser),
      token
    });
  });

  // 4. Google OAuth / Firebase Authentication Callback
  app.post('/api/auth/google', (req: Request, res: Response) => {
    const { email, name, avatar, uid } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        error: 'E-mail obrigatório',
        message: 'Nenhum e-mail recebido do provedor Google.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const isFounder = isFounderEmail(cleanEmail);

    let user = db.findUserByEmail(cleanEmail);
    if (!user) {
      user = db.createUser({
        id: isFounder ? 'user-founder' : (uid || `google-${Date.now()}`),
        name: name || cleanEmail.split('@')[0],
        email: cleanEmail,
        avatar: avatar,
        role: isFounder ? 'founder' : 'user',
        authProvider: 'google'
      });
    } else {
      if (isFounder) {
        user.role = 'founder';
      }
      if (avatar && !user.avatar) user.avatar = avatar;
      if (name && (!user.name || user.name === cleanEmail.split('@')[0])) user.name = name;
    }

    db.updateUserLastLogin(cleanEmail);

    const token = createSessionToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    db.addAuditLog(
      cleanEmail,
      'GOOGLE_LOGIN',
      'SUCCESS',
      isFounder ? 'Login Google de Fundador autenticado.' : 'Login Google de usuário autenticado.'
    );

    res.json({
      success: true,
      user: db.toPublicUser(user),
      token
    });
  });

  // 5. Verify Active Session & Restore User
  app.get('/api/auth/me', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : (req.headers['x-admin-token'] as string);

    if (!token) {
      return res.status(401).json({
        error: 'Não autenticado',
        message: 'Nenhuma sessão ativa encontrada.'
      });
    }

    const session = verifySessionToken(token);
    if (!session) {
      return res.status(401).json({
        error: 'Sessão expirada',
        message: 'Sua sessão expirou ou é inválida. Por favor, faça login novamente.'
      });
    }

    const isFounder = isFounderEmail(session.email);
    let user = db.findUserByEmail(session.email);

    if (!user && isFounder) {
      user = db.createUser({
        name: 'Fundador RONYCINE',
        email: session.email,
        role: 'founder'
      });
    }

    if (!user) {
      return res.status(404).json({
        error: 'Usuário não encontrado',
        message: 'A conta de usuário associada a esta sessão não foi encontrada.'
      });
    }

    if (isFounder) {
      user.role = 'founder';
    }

    res.json({
      success: true,
      user: db.toPublicUser(user)
    });
  });

  // 6. User Logout
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    res.json({
      success: true,
      message: 'Sessão encerrada com sucesso.'
    });
  });

  // 7. Backward-compatible Sync Endpoint
  app.post('/api/auth/sync', (req: Request, res: Response) => {
    const { email, name, role } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório para sincronização' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const isFounder = isFounderEmail(cleanEmail);
    const finalRole = isFounder ? 'founder' : (role === 'admin' ? 'admin' : 'user');

    const user = db.createUser({
      name: name || cleanEmail.split('@')[0],
      email: cleanEmail,
      role: finalRole
    });

    db.updateUserLastLogin(cleanEmail);

    const token = createSessionToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    res.json({
      success: true,
      user: db.toPublicUser(user),
      token
    });
  });

  // 8. Update User Profile (Self-service, Role Protected)
  app.put('/api/user/profile', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

    if (!token) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    const session = verifySessionToken(token);
    if (!session) {
      return res.status(401).json({ error: 'Sessão expirada' });
    }

    const { name, avatar } = req.body || {};
    const user = db.findUserByEmail(session.email);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const updates: any = {};
    if (name && typeof name === 'string' && name.trim()) {
      updates.name = name.trim();
    }
    if (avatar && typeof avatar === 'string') {
      updates.avatar = avatar.trim();
    }

    // Never allow updating role or email via this route
    const updated = db.updateUser(user.email, updates);
    res.json({
      success: true,
      user: db.toPublicUser(updated || user)
    });
  });

  // WATCH PROGRESS & HISTORY ROUTES (+ /api/progress and /api/history aliases)
  app.post(['/api/user/progress', '/api/progress'], (req: Request, res: Response) => {
    const { userId, ...progressData } = req.body;
    if (!userId || !progressData.tmdbId) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    const saved = db.saveWatchProgress(userId, progressData);
    res.json(saved);
  });

  app.get(['/api/user/progress/:userId', '/api/progress/:userId'], (req: Request, res: Response) => {
    const list = db.getWatchProgressList(req.params.userId);
    res.json(list);
  });

  app.post(['/api/user/history', '/api/history'], (req: Request, res: Response) => {
    const { userId, ...itemData } = req.body;
    if (!userId || !itemData.tmdbId) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    db.addToHistory(userId, itemData);
    res.json({ success: true });
  });

  app.get(['/api/user/history/:userId', '/api/history/:userId'], (req: Request, res: Response) => {
    const list = db.getHistory(req.params.userId);
    res.json(list);
  });

  app.delete(['/api/user/history/:userId', '/api/history/:userId'], (req: Request, res: Response) => {
    db.clearHistory(req.params.userId);
    res.json({ success: true });
  });

  // MY LIST ROUTES
  app.post('/api/user/my-list', (req: Request, res: Response) => {
    const { userId, mediaId } = req.body;
    if (!userId || !mediaId) {
      return res.status(400).json({ error: 'Dados de lista inválidos' });
    }
    try {
      const result = db.toggleMyList(userId, mediaId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/user/my-list/:userId', (req: Request, res: Response) => {
    const list = db.getMyList(req.params.userId);
    res.json(list);
  });

  // --- ADMIN AREA ROUTES ---

  // Admin Login Verification
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const { email, password, securityCode } = req.body;
    const ip = req.ip || '127.0.0.1';

    // Check rate limit lock
    if (loginAttempts[ip]?.lockUntil && Date.now() < loginAttempts[ip].lockUntil!) {
      const waitSeconds = Math.ceil((loginAttempts[ip].lockUntil! - Date.now()) / 1000);
      db.addAuditLog(email || 'desconhecido', 'LOGIN_ADMIN', 'FAILED', `Bloqueio temporário por tentativas incorretas. Tente novamente em ${waitSeconds}s.`);
      return res.status(429).json({ error: 'Acesso Restrito', message: `Muitas tentativas incorretas. Aguarde ${waitSeconds} segundos.` });
    }

    const isValidEmail = (email || '').trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const isValidPassword = (password || '').trim() === ADMIN_PASSWORD.trim();
    const isValidCode = (securityCode || '').trim() === ADMIN_SECURITY_CODE.trim();

    if (isValidEmail && isValidPassword && isValidCode) {
      // Clear attempt count on success
      delete loginAttempts[ip];
      
      const adminUser = db.createUser('RONALDO MAZIVE', ADMIN_EMAIL, 'founder');
      db.addAuditLog(ADMIN_EMAIL, 'LOGIN_ADMIN', 'SUCCESS', 'Acesso administrativo autorizado com sucesso.');

      const token = createSessionToken({
        id: adminUser.id,
        email: adminUser.email,
        role: 'founder'
      });

      // Return secure session payload
      return res.json({
        success: true,
        user: adminUser,
        token
      });
    }

    // Record failed attempt
    loginAttempts[ip] = loginAttempts[ip] || { count: 0 };
    loginAttempts[ip].count += 1;

    if (loginAttempts[ip].count >= 5) {
      loginAttempts[ip].lockUntil = Date.now() + 60000; // 1 minute lock
    }

    db.addAuditLog(email || 'anonimo', 'LOGIN_ADMIN', 'FAILED', 'Tentativa de login administrativo recusada.');

    // Generic response as specified in prompt (don't reveal which field is wrong)
    res.status(401).json({
      error: 'Acesso Restrito',
      message: 'Você não possui autorização para acessar esta área.'
    });
  });

  // Admin Stats
  app.get('/api/admin/stats', requireAdmin, (req: Request, res: Response) => {
    const stats = db.getStats();
    res.json(stats);
  });

  // Admin Audit Logs
  app.get('/api/admin/logs', requireFounder, (req: Request, res: Response) => {
    const logs = db.getAuditLogs();
    res.json(logs);
  });

  // Admin Settings
  app.get('/api/admin/settings', (req: Request, res: Response) => {
    res.json(db.getSettings());
  });

  // --- RECOVERY CENTER ROUTES ---
  // --- CENTRO DE RECUPERAÇÃO API ENDPOINTS ---
  app.get('/api/admin/recovery/stats', requireFounder, (req: Request, res: Response) => {
    const statsData = db.getRecoveryStatsData();
    res.json(statsData);
  });

  app.get('/api/admin/recovery/logs', requireFounder, (req: Request, res: Response) => {
    res.json(db.getActivityLogs());
  });

  app.post('/api/admin/recovery/logs/clear', requireFounder, (req: Request, res: Response) => {
    db.clearActivityLogs();
    res.json({ success: true, message: 'Logs limpos com sucesso.' });
  });

  app.get('/api/admin/recovery/reports', requireFounder, (req: Request, res: Response) => {
    res.json(db.getRecoveryReports());
  });

  app.get('/api/admin/recovery/issues', requireFounder, (req: Request, res: Response) => {
    res.json(db.getRecoveryIssues());
  });

  app.get('/api/admin/recovery/duplicates', requireFounder, (req: Request, res: Response) => {
    res.json(db.findDuplicates());
  });

  app.post('/api/admin/recovery/analyze', requireFounder, async (req: Request, res: Response) => {
    try {
      const issues = await recoveryService.analyzeCatalog();
      res.json({ status: 'COMPLETED', issuesCount: issues.length, message: 'Análise do catálogo concluída.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/recovery/smart-restore', requireFounder, async (req: Request, res: Response) => {
    try {
      const adminEmail = (req.headers['x-user-email'] as string) || 'admin@playfilme.com';
      const report = await recoveryService.executeSmartRestore(adminEmail);
      res.json({ success: true, report, message: 'Restauração inteligente finalizada com sucesso.' });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/admin/recovery/recover-movie', requireFounder, async (req: Request, res: Response) => {
    try {
      const { tmdbId } = req.body;
      if (!tmdbId || isNaN(Number(tmdbId))) {
        return res.status(400).json({ error: 'TMDB ID numérico obrigatório.' });
      }
      const adminEmail = (req.headers['x-user-email'] as string) || 'admin@playfilme.com';
      const result = await recoveryService.recoverMovieByTmdb(Number(tmdbId), adminEmail);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/admin/recovery/recover-series', requireFounder, async (req: Request, res: Response) => {
    try {
      const { tmdbId } = req.body;
      if (!tmdbId || isNaN(Number(tmdbId))) {
        return res.status(400).json({ error: 'TMDB ID numérico obrigatório.' });
      }
      const adminEmail = (req.headers['x-user-email'] as string) || 'admin@playfilme.com';
      const result = await recoveryService.recoverSeriesByTmdb(Number(tmdbId), adminEmail);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/admin/recovery/start-batch', requireFounder, async (req: Request, res: Response) => {
    try {
      const { batchSize, filter } = req.body;
      const adminEmail = (req.headers['x-user-email'] as string) || 'admin@playfilme.com';
      recoveryService.startBatchRecovery({ batchSize, filter, adminEmail });
      res.json({ status: 'STARTED', message: 'Restauração em lotes iniciada.' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/admin/recovery/pause-batch', requireFounder, (req: Request, res: Response) => {
    recoveryService.pauseBatch();
    res.json({ status: 'PAUSED' });
  });

  app.post('/api/admin/recovery/resume-batch', requireFounder, (req: Request, res: Response) => {
    recoveryService.resumeBatch();
    res.json({ status: 'RESUMED' });
  });

  app.post('/api/admin/recovery/stop-batch', requireFounder, (req: Request, res: Response) => {
    recoveryService.stopBatch();
    res.json({ status: 'STOPPED' });
  });

  app.get('/api/admin/recovery/backup/download', requireFounder, (req: Request, res: Response) => {
    const backup = db.exportCatalogBackup();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=playfilme-backup-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(backup);
  });

  app.post('/api/admin/recovery/backup/restore', requireFounder, (req: Request, res: Response) => {
    try {
      const { items } = req.body;
      const adminEmail = (req.headers['x-user-email'] as string) || 'admin@playfilme.com';
      const result = db.mergeBackupCatalog(items, adminEmail);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Backup Center Routes
  app.get('/api/admin/backups', requireAdmin, (req: Request, res: Response) => {
    const backups = db.getBackups();
    res.json({ success: true, backups });
  });

  app.post('/api/admin/backups', requireAdmin, (req: Request, res: Response) => {
    const { categories, type } = req.body || {};
    const adminEmail = (req.headers['x-user-email'] as string) || ADMIN_EMAIL;
    const backup = db.createBackup(categories || ['movies', 'series'], type || 'manual', adminEmail);
    res.json({ success: true, backup });
  });

  app.post('/api/admin/backups/:id/restore', requireFounder, (req: Request, res: Response) => {
    const adminEmail = (req.headers['x-user-email'] as string) || ADMIN_EMAIL;
    const report = db.restoreBackup(req.params.id, adminEmail);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Backup não encontrado.' });
    }
    res.json({ success: true, report });
  });

  app.delete('/api/admin/backups/:id', requireFounder, (req: Request, res: Response) => {
    const adminEmail = (req.headers['x-user-email'] as string) || ADMIN_EMAIL;
    const success = db.deleteBackup(req.params.id, adminEmail);
    res.json({ success });
  });

  // Trash Routes
  app.get('/api/admin/trash', requireAdmin, (req: Request, res: Response) => {
    const items = db.getTrashItems();
    res.json({ success: true, items });
  });

  app.post('/api/admin/trash/:id/restore', requireAdmin, (req: Request, res: Response) => {
    const adminEmail = (req.headers['x-user-email'] as string) || ADMIN_EMAIL;
    const restored = db.restoreTrashItem(req.params.id, adminEmail);
    if (!restored) return res.status(404).json({ success: false, error: 'Item não encontrado na lixeira.' });
    res.json({ success: true, item: restored });
  });

  app.delete('/api/admin/trash/:id', requireAdmin, (req: Request, res: Response) => {
    const adminEmail = (req.headers['x-user-email'] as string) || ADMIN_EMAIL;
    const success = db.permanentDeleteTrashItem(req.params.id, adminEmail);
    res.json({ success });
  });

  app.get('/api/admin/recovery/diag/tmdb', requireFounder, async (req: Request, res: Response) => {
    const result = await recoveryService.testTmdbConnection();
    res.json(result);
  });

  app.get('/api/admin/recovery/diag/db', requireFounder, async (req: Request, res: Response) => {
    const result = await recoveryService.testDbConnection();
    res.json(result);
  });

  app.put('/api/admin/settings', requireFounder, (req: Request, res: Response) => {
    const updated = db.updateSettings(req.body);
    db.addAuditLog(ADMIN_EMAIL, 'UPDATE', 'SUCCESS', `Configurações atualizadas: Rotação Hero = ${updated.heroRotationInterval}s`);
    res.json(updated);
  });

  // --- SMART TMDB IMPORTER API ENDPOINTS ---

  // Cache for TMDB lists
  const tmdbListCache = new Map<string, { timestamp: number; data: any }>();
  const TMDB_LIST_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

  // 0. TMDB Connection Diagnostic & Status
  async function checkTmdbConnectionStatus(): Promise<{
    status: 'ONLINE' | 'OFFLINE' | 'CHAVE NÃO CONFIGURADA' | 'CHAVE INVÁLIDA' | 'VERIFICANDO';
    message: string;
    keyConfigured: boolean;
    maskedKey?: string;
    latencyMs?: number;
    timestamp: string;
  }> {
    const key = process.env.TMDB_API_KEY || TMDB_API_KEY;
    if (!key || key.trim() === '') {
      return {
        status: 'CHAVE NÃO CONFIGURADA',
        message: 'A chave da API do TMDB (TMDB_API_KEY) não foi informada nas variáveis de ambiente.',
        keyConfigured: false,
        timestamp: new Date().toISOString()
      };
    }

    const startMs = Date.now();
    try {
      const url = `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const latencyMs = Date.now() - startMs;

      if (response.status === 401 || response.status === 403) {
        return {
          status: 'CHAVE INVÁLIDA',
          message: 'A chave API do TMDB configurada foi rejeitada pelo servidor oficial (HTTP 401/403).',
          keyConfigured: true,
          maskedKey: `${key.substring(0, 4)}...${key.slice(-4)}`,
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }

      if (!response.ok) {
        return {
          status: 'OFFLINE',
          message: `Servidor do TMDB respondeu com erro HTTP ${response.status}.`,
          keyConfigured: true,
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }

      const data = await response.json();
      if (data && data.images) {
        return {
          status: 'ONLINE',
          message: 'Conexão com a API oficial do TMDB estabelecida com sucesso!',
          keyConfigured: true,
          maskedKey: `${key.substring(0, 4)}...${key.slice(-4)}`,
          latencyMs,
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          status: 'OFFLINE',
          message: 'Resposta em formato inesperado retornada pelo TMDB.',
          keyConfigured: true,
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }
    } catch (err: any) {
      return {
        status: 'OFFLINE',
        message: `Falha de rede ao conectar com api.themoviedb.org: ${err?.message || 'Sem conexão'}`,
        keyConfigured: true,
        timestamp: new Date().toISOString()
      };
    }
  }

  app.get('/api/admin/tmdb/status', requireAdmin, async (req: Request, res: Response) => {
    const diag = await checkTmdbConnectionStatus();
    res.json(diag);
  });

  app.post('/api/admin/tmdb/test', requireAdmin, async (req: Request, res: Response) => {
    const diag = await checkTmdbConnectionStatus();
    db.addAuditLog(ADMIN_EMAIL, 'TEST_TMDB', diag.status === 'ONLINE' ? 'SUCCESS' : 'FAILED', `Diagnóstico TMDB: ${diag.status} - ${diag.message}`);
    res.json(diag);
  });

  // 1. TMDB Search with Debounce, Cache & Duplication Detection
  app.get('/api/admin/tmdb/search', requireAdmin, async (req: Request, res: Response) => {
    const rawQuery = (req.query.q as string || '').trim();
    const filterType = (req.query.type as string || 'all'); // 'all' | 'movie' | 'tv'

    if (!rawQuery) {
      return res.json({ results: [] });
    }

    const normalized = normalizeSearchQuery(rawQuery);
    const cacheKey = `${normalized}_${filterType}`;
    const cached = searchCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS) {
      return res.json({ results: cached.data });
    }

    const results: any[] = [];
    const seenTmdbKeys = new Set<string>();

    const addUniqueResult = (item: any) => {
      if (!item || !item.tmdbId) return;
      const key = `${item.tmdbId}_${item.type}`;
      if (!seenTmdbKeys.has(key)) {
        seenTmdbKeys.add(key);
        results.push(item);
      }
    };

    // Check if user entered a direct numeric TMDB ID (strictly numeric digits)
    const isStrictNumeric = /^\d+$/.test(rawQuery);
    if (isStrictNumeric) {
      const directNumericId = parseInt(rawQuery, 10);
      const typesToTry: Array<'movie' | 'tv'> = filterType === 'movie' ? ['movie'] : (filterType === 'tv' ? ['tv'] : ['tv', 'movie']);
      for (const t of typesToTry) {
        try {
          const item = await fetchTMDB(`/${t}/${directNumericId}`);
          if (item && item.id) {
            const formatted = formatTMDBMedia(item, t);
            addUniqueResult(formatted);
          }
        } catch (e) {
          // ignore lookup error
        }
      }
    }

    // Always also search by Name/Title (if not strictly numeric or if direct lookup returned 0 results)
    if (results.length === 0 || !isStrictNumeric) {
      if (filterType === 'tv' || filterType === 'all') {
        const tvRes = await fetchTMDB('/search/tv', { query: rawQuery });
        if (tvRes?.results?.length) {
          const tvs = tvRes.results.slice(0, 15).map((t: any) => formatTMDBMedia(t, 'tv'));
          tvs.forEach(addUniqueResult);
        } else {
          // Fallback search without language constraint
          const fallbackRes = await fetchTMDB('/search/tv', { query: rawQuery, language: 'en-US' });
          if (fallbackRes?.results?.length) {
            const tvs = fallbackRes.results.slice(0, 15).map((t: any) => formatTMDBMedia(t, 'tv'));
            tvs.forEach(addUniqueResult);
          }
        }
      }

      if (filterType === 'movie' || filterType === 'all') {
        const movieRes = await fetchTMDB('/search/movie', { query: rawQuery });
        if (movieRes?.results?.length) {
          const movies = movieRes.results.slice(0, 15).map((m: any) => formatTMDBMedia(m, 'movie'));
          movies.forEach(addUniqueResult);
        } else {
          const fallbackMovieRes = await fetchTMDB('/search/movie', { query: rawQuery, language: 'en-US' });
          if (fallbackMovieRes?.results?.length) {
            const movies = fallbackMovieRes.results.slice(0, 15).map((m: any) => formatTMDBMedia(m, 'movie'));
            movies.forEach(addUniqueResult);
          }
        }
      }
    }

    // Attach Duplication Check for each result
    const enrichedResults = results.map((item) => {
      const existing = db.getMediaByTmdbAndType(item.tmdbId, item.type);
      return {
        ...item,
        existsInCatalog: !!existing,
        existingMediaItem: existing ? {
          id: existing.id,
          title: existing.title,
          seasonsCount: existing.seasons?.length || 0,
          episodesCount: existing.seasons?.reduce((acc, s) => acc + (s.episodes?.length || 0), 0) || 0
        } : null
      };
    });

    // Bounded searchCache (max 500 entries)
    if (searchCache.size > 500) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey) searchCache.delete(oldestKey);
    }
    searchCache.set(cacheKey, { timestamp: Date.now(), data: enrichedResults });
    res.json({ results: enrichedResults });
  });

  // 1.1 TMDB Lists (Trending, Popular, Recent)
  app.get('/api/admin/tmdb/list', requireAdmin, async (req: Request, res: Response) => {
    const listType = req.query.list as string; // 'trending' | 'popular' | 'recent'
    const mediaType = (req.query.type as string || 'all'); // 'all' | 'movie' | 'tv'
    const timeWindow = (req.query.period as string || 'day'); // 'day' | 'week'
    const page = parseInt(req.query.page as string || '1');
    const forceRefresh = req.query.refresh === 'true';

    const cacheKey = `list_${listType}_${mediaType}_${timeWindow}_${page}`;
    const cached = tmdbListCache.get(cacheKey);

    if (!forceRefresh && cached && Date.now() - cached.timestamp < TMDB_LIST_CACHE_TTL) {
      return res.json({ results: cached.data });
    }

    let endpoint = '';
    let params: any = { page: page.toString() };

    if (listType === 'trending') {
      const type = mediaType === 'all' ? 'all' : (mediaType === 'movie' ? 'movie' : 'tv');
      endpoint = `/trending/${type}/${timeWindow}`;
    } else if (listType === 'popular') {
      const type = mediaType === 'all' || mediaType === 'movie' ? 'movie' : 'tv';
      endpoint = `/${type}/popular`;
    } else if (listType === 'recent') {
      const type = mediaType === 'all' || mediaType === 'movie' ? 'movie' : 'tv';
      endpoint = `/discover/${type}`;
      params.sort_by = 'primary_release_date.desc';
      params['primary_release_date.lte'] = new Date().toISOString().split('T')[0];
      if (type === 'tv') {
        params.sort_by = 'first_air_date.desc';
        params['first_air_date.lte'] = new Date().toISOString().split('T')[0];
      }
    } else {
      return res.status(400).json({ error: 'Tipo de lista inválido' });
    }

    const data = await fetchTMDB(endpoint, params);
    if (!data || !data.results) {
      return res.json({ results: [] });
    }

    const results = data.results.map((item: any) => {
      const type: 'movie' | 'tv' = (item.media_type) ? (item.media_type === 'movie' ? 'movie' : 'tv') : (mediaType === 'tv' ? 'tv' : 'movie');
      const formatted = formatTMDBMedia(item, type);
      const existing = db.getMediaByTmdbAndType(formatted.tmdbId, formatted.type);
      return {
        ...formatted,
        existsInCatalog: !!existing,
        existingMediaItem: existing || null
      };
    });

    tmdbListCache.set(cacheKey, { timestamp: Date.now(), data: results });
    res.json({ results });
  });

  // 2. Fetch Full TMDB Details
  app.get('/api/admin/tmdb/details', requireAdmin, async (req: Request, res: Response) => {
    const tmdbId = parseInt(req.query.id as string);
    const type = (req.query.type as string === 'tv' ? 'tv' : 'movie');

    if (isNaN(tmdbId)) {
      return res.status(400).json({ error: 'TMDB ID inválido' });
    }

    const tmdbData = await fetchTMDB(`/${type}/${tmdbId}`, { append_to_response: 'credits,videos' });
    if (!tmdbData) {
      return res.status(404).json({ error: 'Conteúdo não encontrado no TMDB.' });
    }

    const formatted = formatTMDBMedia(tmdbData, type);
    const existing = db.getMediaByTmdbAndType(tmdbId, type);

    res.json({
      item: formatted,
      existsInCatalog: !!existing,
      existingMediaItem: existing || null
    });
  });

  // 2.1 Fetch TMDB Season Episodes for Manual Selection in Admin UI
  app.get('/api/admin/tmdb/series/:tmdbId/season/:seasonNumber', requireAdmin, async (req: Request, res: Response) => {
    const tmdbId = parseInt(req.params.tmdbId, 10);
    const seasonNumber = parseInt(req.params.seasonNumber, 10);

    if (isNaN(tmdbId) || isNaN(seasonNumber)) {
      return res.status(400).json({ error: 'TMDB ID e número da temporada devem ser válidos.' });
    }

    const tmdbSeason = await fetchTMDB(`/tv/${tmdbId}/season/${seasonNumber}`);
    if (!tmdbSeason || !Array.isArray(tmdbSeason.episodes)) {
      return res.status(404).json({ error: 'Temporada não encontrada no TMDB.' });
    }

    const episodes = tmdbSeason.episodes.map((ep: any) => ({
      id: `ep-${ep.id}`,
      seasonNumber,
      episodeNumber: ep.episode_number,
      title: ep.name || `Episódio ${ep.episode_number}`,
      overview: ep.overview || 'Sinopse não disponível.',
      duration: ep.runtime || 45,
      stillPath: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : undefined,
      airDate: ep.air_date,
      voteAverage: ep.vote_average ? Number(ep.vote_average.toFixed(1)) : undefined
    }));

    res.json({
      seasonNumber,
      name: tmdbSeason.name || `Temporada ${seasonNumber}`,
      overview: tmdbSeason.overview || '',
      episodes
    });
  });

  // 3. Confirm Import Media
  app.post('/api/admin/tmdb/import', requireAdmin, async (req: Request, res: Response) => {
    const { tmdbId, type, forceUpdate, selectedEpisodes } = req.body;
    const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
    const idNum = parseInt(tmdbId);
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;

    if (isNaN(idNum)) {
      return res.status(400).json({ error: 'TMDB ID inválido' });
    }

    // Strict Duplication Check on Backend
    const existing = db.getMediaByTmdbAndType(idNum, mediaType);
    if (existing && !forceUpdate) {
      db.addImportHistory({
        adminEmail,
        title: existing.title,
        tmdbId: idNum,
        type: mediaType,
        status: 'EXISTING',
        details: 'Conteúdo já existente no acervo.'
      });

      return res.status(200).json({
        success: false,
        exists: true,
        message: 'Este filme/série já está no catálogo do RONYCINE.',
        existingMediaItem: existing
      });
    }

    // Fetch full metadata
    const tmdbData = await fetchTMDB(`/${mediaType}/${idNum}`, { append_to_response: 'credits,videos' });
    if (!tmdbData) {
      return res.status(404).json({ error: 'Conteúdo não localizado na API do TMDB.' });
    }

    const formatted = formatTMDBMedia(tmdbData, mediaType);

    // If series and specific episodes were selected manually by admin
    if (mediaType === 'tv' && Array.isArray(selectedEpisodes) && selectedEpisodes.length > 0) {
      const allowedEps = new Set(selectedEpisodes.map((e: any) => `${e.seasonNumber}-${e.episodeNumber}`));
      const selectedSeasonsNums = Array.from(new Set(selectedEpisodes.map((e: any) => Number(e.seasonNumber)))) as number[];

      const populatedSeasons: any[] = [];
      for (const sNum of selectedSeasonsNums) {
        try {
          const tmdbSeason = await fetchTMDB(`/tv/${idNum}/season/${sNum}`);
          if (tmdbSeason && Array.isArray(tmdbSeason.episodes)) {
            const filteredEpisodes = tmdbSeason.episodes
              .filter((ep: any) => allowedEps.has(`${sNum}-${ep.episode_number}`))
              .map((ep: any) => ({
                id: `ep-${ep.id}`,
                seasonNumber: sNum,
                episodeNumber: ep.episode_number,
                title: ep.name || `Episódio ${ep.episode_number}`,
                overview: ep.overview || 'Sinopse não disponível.',
                duration: ep.runtime || 45,
                stillPath: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : undefined,
                airDate: ep.air_date,
                voteAverage: ep.vote_average ? Number(ep.vote_average.toFixed(1)) : undefined
              }));

            populatedSeasons.push({
              id: `season-${sNum}`,
              seasonNumber: sNum,
              name: tmdbSeason.name || `Temporada ${sNum}`,
              overview: tmdbSeason.overview || '',
              episodeCount: filteredEpisodes.length,
              episodes: filteredEpisodes
            });
          }
        } catch (err) {
          console.warn(`[TMDB Import] Erro ao obter episódios da T${sNum}:`, err);
        }
      }
      if (populatedSeasons.length > 0) {
        formatted.seasons = populatedSeasons;
        formatted.seasonsCount = populatedSeasons.length;
        formatted.episodesCount = populatedSeasons.reduce((acc, s) => acc + (s.episodes?.length || 0), 0);
      }
    }

    const { item, isNew } = db.upsertMediaItem({
      ...formatted,
      importSource: 'tmdb_single'
    });

    db.addImportHistory({
      adminEmail,
      title: item.title,
      tmdbId: item.tmdbId,
      type: mediaType,
      status: 'SUCCESS',
      details: isNew ? 'Novo item adicionado ao catálogo' : 'Dados do acervo atualizados'
    });

    db.addAuditLog(adminEmail, 'IMPORT', 'SUCCESS', `Importado [${mediaType.toUpperCase()}]: ${item.title} (TMDB: ${item.tmdbId})`);

    res.json({
      success: true,
      isNew,
      item,
      message: isNew
        ? `${item.title} foi adicionado ao catálogo do RONYCINE.`
        : `${item.title} foi atualizado no catálogo do RONYCINE.`
    });
  });

  // 4. Update Existing Catalog Media from TMDB
  app.post('/api/admin/tmdb/update', requireAdmin, async (req: Request, res: Response) => {
    const { tmdbId, type } = req.body;
    const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
    const idNum = parseInt(tmdbId);
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;

    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'TMDB ID inválido para sincronização.' });
    }

    const tmdbData = await fetchTMDB(`/${mediaType}/${idNum}`, { append_to_response: 'credits,videos' });
    if (!tmdbData) {
      return res.status(404).json({ error: 'Não foi possível atualizar do TMDB.' });
    }

    const formatted = formatTMDBMedia(tmdbData, mediaType);
    const { item } = db.upsertMediaItem(formatted);

    db.addImportHistory({
      adminEmail,
      title: item.title,
      tmdbId: item.tmdbId,
      type: mediaType,
      status: 'SUCCESS',
      details: 'Dados atualizados a partir do TMDB'
    });

    db.addAuditLog(adminEmail, 'UPDATE', 'SUCCESS', `Atualizado [${mediaType.toUpperCase()}]: ${item.title} (TMDB: ${item.tmdbId})`);

    res.json({
      success: true,
      item,
      message: `${item.title} foi atualizado com sucesso.`
    });
  });

  // 5. Import History
  app.get('/api/admin/tmdb/history', requireAdmin, (req: Request, res: Response) => {
    res.json(db.getImportHistory());
  });

  // Legacy route for compatibility
  app.post('/api/admin/import-single', requireAdmin, async (req: Request, res: Response) => {
    const { queryOrId, type } = req.body;
    const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
    const idNum = parseInt(queryOrId);

    if (!isNaN(idNum)) {
      const tmdbData = await fetchTMDB(`/${mediaType}/${idNum}`, { append_to_response: 'credits,videos' });
      if (!tmdbData) return res.status(404).json({ error: 'Não encontrado no TMDB' });
      const formatted = formatTMDBMedia(tmdbData, mediaType);
      const { item, isNew } = db.upsertMediaItem(formatted);
      return res.json({ success: true, isNew, item, message: `${item.title} adicionado.` });
    }

    const searchRes = await fetchTMDB(`/search/${mediaType}`, { query: queryOrId });
    if (searchRes?.results?.length) {
      const top = searchRes.results[0];
      const tmdbData = await fetchTMDB(`/${mediaType}/${top.id}`, { append_to_response: 'credits,videos' });
      const formatted = formatTMDBMedia(tmdbData, mediaType);
      const { item, isNew } = db.upsertMediaItem(formatted);
      return res.json({ success: true, isNew, item, message: `${item.title} adicionado.` });
    }

    res.status(404).json({ error: 'Conteúdo não localizado.' });
  });

  // ==========================================
  // MASS IMPORT API (10.000+ IDs ENGINE)
  // ==========================================
  app.get('/api/admin/mass-import/status', requireAdmin, (req: Request, res: Response) => {
    res.json(massImportService.getState());
  });

  app.post('/api/admin/mass-import', requireAdmin, async (req: Request, res: Response) => {
    const { ids, pagesCount, type, contentType, batchSize, concurrency, cacheEnabled } = req.body;
    
    const result = await massImportService.startMassImport({
      ids: Array.isArray(ids) ? ids : undefined,
      pagesCount: pagesCount ? parseInt(pagesCount, 10) : undefined,
      contentType: contentType || type || 'both',
      batchSize: batchSize ? parseInt(batchSize, 10) : 100,
      concurrency: concurrency ? parseInt(concurrency, 10) : 6,
      cacheEnabled: cacheEnabled !== false
    });

    if (!result.success) {
      return res.status(400).json({ error: result.message, status: result.state });
    }

    res.json({ success: true, message: result.message, status: result.state });
  });

  app.post('/api/admin/mass-import/pause', requireAdmin, (req: Request, res: Response) => {
    const result = massImportService.pause();
    if (!result.success) {
      return res.status(400).json({ error: result.message, status: result.state });
    }
    res.json(result);
  });

  app.post('/api/admin/mass-import/resume', requireAdmin, (req: Request, res: Response) => {
    const result = massImportService.resume();
    if (!result.success) {
      return res.status(400).json({ error: result.message, status: result.state });
    }
    res.json(result);
  });

  app.post('/api/admin/mass-import/cancel', requireAdmin, (req: Request, res: Response) => {
    const result = massImportService.cancel();
    if (!result.success) {
      return res.status(400).json({ error: result.message, status: result.state });
    }
    res.json(result);
  });

  app.post('/api/admin/mass-import/retry-errors', requireAdmin, (req: Request, res: Response) => {
    const result = massImportService.retryErrors();
    if (!result.success) {
      return res.status(400).json({ error: result.message, status: result.state });
    }
    res.json(result);
  });

  app.post('/api/admin/mass-import/clear', requireAdmin, (req: Request, res: Response) => {
    const result = massImportService.clear();
    if (!result.success) {
      return res.status(400).json({ error: result.message, status: result.state });
    }
    res.json(result);
  });

  app.get('/api/admin/mass-import/history', requireAdmin, (req: Request, res: Response) => {
    res.json(db.getMassImportReports());
  });

  app.get('/api/admin/mass-import/report/:id', requireAdmin, (req: Request, res: Response) => {
    const report = db.getMassImportReportById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Relatório não encontrado.' });
    }
    res.json(report);
  });

  app.get('/api/admin/mass-import/export', requireAdmin, (req: Request, res: Response) => {
    const reportId = req.query.reportId as string | undefined;
    const format = (req.query.format as 'txt' | 'csv' | 'json') || 'txt';
    const exported = massImportService.generateExport(reportId, format);

    res.setHeader('Content-Type', exported.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.send(exported.content);
  });

  // ==========================================
  // DEDICATED ADMIN CATALOG ENDPOINTS
  // ==========================================

  // Admin Catalog Query (Strictly separated movies/series, source + diagnostic summaries, audit totals)
  app.get('/api/admin/catalog', requireAdmin, (req: Request, res: Response) => {
    const {
      type,
      genre,
      search,
      yearFrom,
      yearTo,
      minRating,
      maxRating,
      publishStatus,
      status,
      sourceStatus,
      diagnostic,
      source,
      sort,
      page,
      limit
    } = req.query;

    const result = db.getAdminCatalog({
      type: type as string,
      genre: genre as string,
      search: search as string,
      yearFrom: yearFrom ? parseInt(yearFrom as string, 10) : undefined,
      yearTo: yearTo ? parseInt(yearTo as string, 10) : undefined,
      minRating: minRating !== undefined && minRating !== '' ? parseFloat(minRating as string) : undefined,
      maxRating: maxRating !== undefined && maxRating !== '' ? parseFloat(maxRating as string) : undefined,
      publishStatus: publishStatus as string,
      status: status as string,
      sourceStatus: sourceStatus as string,
      diagnostic: diagnostic as string,
      source: source as string,
      sort: sort as string,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 25
    });

    res.json(result);
  });

  // Admin Catalog Item Full Details + Seasons/Episodes + Per-Episode Source Status
  app.get('/api/admin/catalog/:id/details', requireAdmin, async (req: Request, res: Response) => {
    const id = req.params.id;
    const syncSeasons = req.query.syncSeasons === 'true';
    const targetSeason = req.query.season ? parseInt(req.query.season as string, 10) : undefined;

    let item = db.getMediaById(id);
    if (!item && (id.startsWith('movie-') || id.startsWith('tv-') || id.startsWith('series-') || !isNaN(Number(id)))) {
      const inferredType: 'movie' | 'tv' = id.startsWith('series-') || id.startsWith('tv-') ? 'tv' : 'movie';
      const cleanTmdbId = parseInt(id.replace(/^(movie|series|tv)-/, ''), 10);
      if (!isNaN(cleanTmdbId)) {
        item = db.getMediaByTmdbAndType(cleanTmdbId, inferredType);
      }
    }

    if (!item) {
      return res.status(404).json({ error: 'Conteúdo não encontrado no catálogo.' });
    }

    const isSeries = item.type === 'tv' || item.type === 'series';

    // Optionally hydrate missing episodes for seasons from TMDB without erasing sources or existing data
    if (isSeries && syncSeasons && item.tmdbId > 0) {
      try {
        const seasonsToSync = (item.seasons || []).filter(s =>
          targetSeason !== undefined
            ? Number(s.seasonNumber) === targetSeason
            : !s.episodes || s.episodes.length === 0
        );

        if (seasonsToSync.length > 0 || (targetSeason !== undefined && !(item.seasons || []).some(s => Number(s.seasonNumber) === targetSeason))) {
          const seasonNumbers = targetSeason !== undefined ? [targetSeason] : seasonsToSync.map(s => Number(s.seasonNumber));
          const updatedSeasons = [...(item.seasons || [])];

          for (const sNum of seasonNumbers) {
            const tmdbSeason = await fetchTMDB(`/tv/${item.tmdbId}/season/${sNum}`);
            if (tmdbSeason && Array.isArray(tmdbSeason.episodes)) {
              const episodes = tmdbSeason.episodes.map((ep: any) => ({
                id: `ep-${ep.id}`,
                seasonNumber: sNum,
                episodeNumber: ep.episode_number,
                title: ep.name || `Episódio ${ep.episode_number}`,
                overview: ep.overview || 'Sinopse não disponível.',
                duration: ep.runtime || 45,
                stillPath: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : undefined,
                airDate: ep.air_date,
                voteAverage: ep.vote_average ? Number(ep.vote_average.toFixed(1)) : undefined
              }));

              const sIdx = updatedSeasons.findIndex(s => Number(s.seasonNumber) === sNum);
              if (sIdx >= 0) {
                updatedSeasons[sIdx] = {
                  ...updatedSeasons[sIdx],
                  episodeCount: Math.max(updatedSeasons[sIdx].episodeCount || 0, episodes.length),
                  episodes
                };
              } else {
                updatedSeasons.push({
                  id: `season-${sNum}`,
                  seasonNumber: sNum,
                  name: tmdbSeason.name || `Temporada ${sNum}`,
                  overview: tmdbSeason.overview || '',
                  episodeCount: episodes.length,
                  episodes
                });
              }
            }
          }

          const upserted = db.upsertMediaItem({
            ...item,
            type: 'tv',
            seasons: updatedSeasons
          });
          item = upserted.item;
        }
      } catch (e) {
        console.warn(`[Admin Details] Falha parcial ao sincronizar temporadas de ${item.id}:`, e);
      }
    }

    const { sources: localSources } = item.tmdbId
      ? db.getMediaAndSources(item.tmdbId, isSeries ? 'tv' : 'movie')
      : { sources: [] };
    const vSources = item.tmdbId
      ? await db.getVideoSources({ contentId: item.tmdbId, contentType: isSeries ? 'tv' : 'movie' })
      : [];
    const allSources = mergeAndDedupeSources(localSources, vSources);

    const sourceSummary = db.getMediaSourceSummary(item);
    const diagnosticReport = db.diagnoseMediaItem(item.id);

    // Group episode sources for series
    const episodeSourcesMap = new Map<string, any[]>();
    if (isSeries) {
      for (const src of allSources) {
        const sNum = Number(src.season ?? src.seasonNumber ?? 0);
        const eNum = Number(src.episode ?? src.episodeNumber ?? 0);
        if (sNum > 0 && eNum > 0) {
          const key = `${sNum}:${eNum}`;
          if (!episodeSourcesMap.has(key)) episodeSourcesMap.set(key, []);
          episodeSourcesMap.get(key)!.push(src);
        }
      }
    }

    const seasonsWithSources = isSeries
      ? (item.seasons || []).map(season => {
          const sNum = Number(season.seasonNumber);
          const episodes = (season.episodes || []).map(ep => {
            const epSources = episodeSourcesMap.get(`${sNum}:${Number(ep.episodeNumber)}`) || [];
            const hasOnline = epSources.some(src => ['online', 'active'].includes((src.status || '').toLowerCase()));
            const hasBlockedOrOffline = epSources.some(src =>
              ['offline', 'inactive', 'embed_blocked', 'unsupported_format'].includes((src.status || '').toLowerCase())
            );
            const epSourceStatus =
              epSources.length === 0
                ? 'NONE'
                : hasOnline
                ? 'ONLINE'
                : hasBlockedOrOffline
                ? 'OFFLINE'
                : 'REGISTERED';

            return {
              ...ep,
              sources: epSources,
              sourcesCount: epSources.length,
              sourceStatus: epSourceStatus
            };
          });

          const totalEpWithSource = episodes.filter(e => e.sourcesCount > 0).length;
          return {
            ...season,
            episodes,
            episodesWithSourceCount: totalEpWithSource
          };
        })
      : undefined;

    res.json({
      item: {
        ...item,
        seasons: seasonsWithSources ?? item.seasons,
        sourceSummary,
        diagnosticSummary: diagnosticReport?.item.diagnosticSummary
      },
      sources: allSources,
      diagnostic: diagnosticReport
    });
  });

  // Admin Update Media Item
  app.put('/api/admin/catalog/:id', requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id;
    const updates = req.body;
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;

    const updated = db.updateMediaItem(id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Conteúdo não encontrado' });
    }

    db.addAuditLog(adminEmail, 'UPDATE', 'SUCCESS', `Editado [${updated.type.toUpperCase()}]: ${updated.title} (ID: ${updated.id})`);

    res.json({
      success: true,
      item: updated,
      message: `${updated.title} atualizado com sucesso.`
    });
  });

  // Admin Toggle Publish Status
  app.post('/api/admin/catalog/:id/publish', requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id;
    const { published } = req.body || {};
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;

    const result = db.togglePublishMedia(id, typeof published === 'boolean' ? published : undefined, adminEmail);
    if (!result) {
      return res.status(404).json({ error: 'Conteúdo não encontrado.' });
    }

    res.json({
      success: true,
      item: result.item,
      published: result.published,
      message: result.published
        ? `${result.item.title} foi publicado no catálogo.`
        : `${result.item.title} foi despublicado (movido para rascunho).`
    });
  });

  // Admin Restore Soft-Deleted Media Item
  app.post('/api/admin/catalog/:id/restore', requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id;
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;
    const restored = db.restoreMediaItem(id, adminEmail);
    if (!restored) {
      return res.status(404).json({ error: 'Conteúdo não encontrado para restauração.' });
    }
    res.json({
      success: true,
      item: restored,
      message: `${restored.title} foi restaurado para o catálogo.`
    });
  });

  // Admin Diagnose Media Item
  app.get('/api/admin/catalog/:id/diagnose', requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id;
    const report = db.diagnoseMediaItem(id);
    if (!report) {
      return res.status(404).json({ error: 'Conteúdo não encontrado' });
    }
    res.json(report);
  });

  // Admin Toggle Top 10
  app.post('/api/admin/catalog/:id/top10', requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id;
    const { position } = req.body;
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;

    try {
      const resData = db.toggleTop10(id, position);
      const action = resData.isTop10 ? 'TOP10_ADD' : 'TOP10_REMOVE';
      db.addAuditLog(adminEmail, action, 'SUCCESS', `${resData.isTop10 ? 'Adicionado ao' : 'Removido do'} Top 10: ${resData.item.title}`);
      res.json({ success: true, ...resData });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Erro ao alterar Top 10' });
    }
  });

  // Admin Batch Operations
  app.post('/api/admin/catalog/batch', requireAdmin, async (req: Request, res: Response) => {
    const { action, ids, position, permanent } = req.body;
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Nenhum item selecionado.' });
    }

    if (action === 'delete') {
      const result = db.batchDeleteMedia(ids, adminEmail, Boolean(permanent));
      return res.json({
        success: true,
        affectedCount: result.successCount,
        blockedCount: result.blockedCount,
        deletedIds: result.deletedIds,
        blockedIds: result.blockedIds,
        message: `${result.successCount} itens removidos${permanent ? ' permanentemente' : ' para a lixeira'}.${result.blockedCount > 0 ? ` ${result.blockedCount} bloqueados pelo Catalog Guard.` : ''}`
      });
    }

    if (action === 'restore') {
      let restoredCount = 0;
      for (const id of ids) {
        if (db.restoreMediaItem(id, adminEmail)) restoredCount++;
      }
      return res.json({
        success: true,
        affectedCount: restoredCount,
        message: `${restoredCount} itens restaurados para o catálogo.`
      });
    }

    if (action === 'publish' || action === 'unpublish') {
      const targetPub = action === 'publish';
      let count = 0;
      for (const id of ids) {
        if (db.togglePublishMedia(id, targetPub, adminEmail)) count++;
      }
      return res.json({
        success: true,
        affectedCount: count,
        message: `${count} itens ${targetPub ? 'publicados' : 'despublicados'} com sucesso.`
      });
    }

    if (action === 'top10') {
      let count = 0;
      for (const id of ids) {
        const item = db.getMediaById(id);
        if (item) {
          db.toggleTop10(id, position);
          count++;
        }
      }
      db.addAuditLog(adminEmail, 'TOP10_ADD', 'SUCCESS', `Atualizados ${count} itens no Top 10 em massa.`);
      return res.json({ success: true, affectedCount: count, message: `${count} itens atualizados no Top 10.` });
    }

    if (action === 'sync') {
      let syncedCount = 0;
      for (const id of ids) {
        const item = db.getMediaById(id);
        if (item && item.tmdbId > 0) {
          const type: 'movie' | 'tv' = item.type === 'tv' || item.type === 'series' ? 'tv' : 'movie';
          const tmdbData = await fetchTMDB(`/${type}/${item.tmdbId}`, { append_to_response: 'credits,videos' });
          if (tmdbData) {
            const formatted = formatTMDBMedia(tmdbData, type);
            db.upsertMediaItem(formatted);
            syncedCount++;
          }
        }
      }
      db.addAuditLog(adminEmail, 'BATCH_SYNC', 'SUCCESS', `Sincronizados ${syncedCount} itens do TMDB.`);
      return res.json({ success: true, affectedCount: syncedCount, message: `${syncedCount} itens sincronizados com o TMDB.` });
    }

    res.status(400).json({ error: 'Ação em massa inválida.' });
  });

  // Admin Export Catalog (Strict separation, authenticated, safe fields only — zero tokens/credentials)
  app.get('/api/admin/catalog/export', requireAdmin, (req: Request, res: Response) => {
    const {
      format,
      search,
      type,
      genre,
      publishStatus,
      status,
      sourceStatus,
      diagnostic,
      source,
      yearFrom,
      yearTo,
      ids
    } = req.query;
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;

    const idList = typeof ids === 'string' && ids.trim()
      ? ids.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    const catalogData = db.getAdminCatalog({
      search: search as string,
      type: type as string,
      genre: genre as string,
      publishStatus: publishStatus as string,
      status: status as string,
      sourceStatus: sourceStatus as string,
      diagnostic: diagnostic as string,
      source: source as string,
      yearFrom: yearFrom ? parseInt(yearFrom as string, 10) : undefined,
      yearTo: yearTo ? parseInt(yearTo as string, 10) : undefined,
      ids: idList,
      limit: 100000
    }).items;

    const cleanItems = catalogData.map(item => ({
      id: item.id,
      tmdbId: item.tmdbId,
      imdbId: item.imdbId || null,
      title: item.title,
      originalTitle: item.originalTitle || null,
      type: item.type === 'tv' || item.type === 'series' ? 'tv' : 'movie',
      overview: item.overview || '',
      posterPath: item.posterPath || '',
      backdropPath: item.backdropPath || '',
      releaseDate: item.releaseDate || null,
      firstAirDate: item.firstAirDate || null,
      genres: item.genres || [],
      voteAverage: item.voteAverage || 0,
      duration: item.duration || (item as any).runtime || null,
      seasonsCount: item.seasonsCount || (item.seasons ? item.seasons.length : 0),
      episodesCount: item.episodesCount || 0,
      seasons: item.seasons || undefined,
      published: item.published !== false,
      status: item.status || 'ACTIVE',
      source: item.source || null,
      sourceSummary: item.sourceSummary,
      diagnosticSummary: item.diagnosticSummary,
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null
    }));

    const dateTag = new Date().toISOString().slice(0, 10);
    const prefix =
      type === 'movie'
        ? 'ronycine-filmes'
        : type === 'tv' || type === 'series'
        ? 'ronycine-series'
        : 'ronycine-catalogo';

    db.addAuditLog(adminEmail, 'EXPORT', 'SUCCESS', `Exportado catálogo [${type || 'all'}] (${cleanItems.length} itens) em formato ${format || 'json'}.`);

    if (format === 'csv') {
      const headers = 'ID Interno,TMDB ID,IMDb ID,Título,Título Original,Tipo,Ano,Gêneros,Nota,Publicado,Status,Status Fonte,Fontes,Data Importação\n';
      const csvEsc = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const rows = cleanItems.map(item => {
        const year = (item.releaseDate || item.firstAirDate || '').substring(0, 4);
        const genresStr = (item.genres || []).join(' | ');
        const pubStr = item.published ? 'Sim' : 'Não';
        const srcStatus = item.sourceSummary?.status || 'NONE';
        const srcCount = item.sourceSummary?.totalSources ?? 0;
        return [
          csvEsc(item.id),
          item.tmdbId || '',
          csvEsc(item.imdbId || ''),
          csvEsc(item.title),
          csvEsc(item.originalTitle || ''),
          item.type,
          year,
          csvEsc(genresStr),
          item.voteAverage ?? 0,
          pubStr,
          item.status,
          srcStatus,
          srcCount,
          csvEsc(item.createdAt || '')
        ].join(',');
      }).join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${prefix}-${dateTag}.csv"`);
      return res.send('\uFEFF' + headers + rows);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${prefix}-${dateTag}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      platform: 'RONYCINE API',
      filterType: type || 'all',
      total: cleanItems.length,
      items: cleanItems
    });
  });

  // Admin Delete Media Item (Soft delete by default, ?permanent=true for permanent removal)
  app.delete('/api/admin/catalog/:id', requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id;
    const permanent = req.query.permanent === 'true';
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;
    const existing = db.getMediaById(id);

    if (!existing) {
      return res.status(404).json({ error: 'Conteúdo não encontrado.' });
    }

    const result = db.deleteMediaItem(id, adminEmail, permanent);
    if (result.success) {
      res.json({
        success: true,
        permanent,
        item: result.item,
        message: permanent
          ? 'Item removido permanentemente do catálogo.'
          : 'Item movido para a lixeira com sucesso.'
      });
    } else {
      res.status(400).json({ error: result.reason || 'Não foi possível remover o item.' });
    }
  });

  // Get Admin Users List
  app.get('/api/admin/users', requireFounder, (req: Request, res: Response) => {
    res.json(db.getAllUsers());
  });

  // ==========================================
  // M3U PLAYLIST IMPORTER API ROUTES
  // ==========================================

  // 1. Get Sources (with masked URLs for frontend security)
  app.get('/api/admin/m3u/sources', requireAdmin, async (req: Request, res: Response) => {
    try {
      const sources = await m3uImporter.getSources();
      const safeSources = sources.map(s => ({
        ...s,
        maskedUrl: M3UImporterService.maskUrl(s.url),
        // Do not return raw url to unauthorized frontend
        hasCredentials: s.url.includes('username=') || s.url.includes('password=')
      }));
      res.json(safeSources);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Falha ao buscar fontes M3U' });
    }
  });

  // 2. Update Source Configuration
  app.put('/api/admin/m3u/sources/:id', requireFounder, async (req: Request, res: Response) => {
    try {
      const { url, name, enabled, autoSync, syncIntervalMinutes, autoTmdbMatch } = req.body;
      const updates: any = {};
      if (url && typeof url === 'string') updates.url = url.trim();
      if (name && typeof name === 'string') updates.name = name.trim();
      if (typeof enabled === 'boolean') updates.enabled = enabled;
      if (typeof autoSync === 'boolean') updates.autoSync = autoSync;
      if (typeof syncIntervalMinutes === 'number') updates.syncIntervalMinutes = syncIntervalMinutes;
      if (typeof autoTmdbMatch === 'boolean') updates.autoTmdbMatch = autoTmdbMatch;

      const updated = await m3uImporter.updateSource(req.params.id, updates);
      db.addAuditLog(ADMIN_EMAIL, 'UPDATE', 'SUCCESS', `Configurações da fonte M3U [${req.params.id}] atualizadas.`);
      res.json({
        success: true,
        source: {
          ...updated,
          maskedUrl: M3UImporterService.maskUrl((updated as any)?.url || '')
        }
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Erro ao atualizar fonte M3U' });
    }
  });

  // 3. Test Playlist Connection (with SSRF protection and format validation)
  app.post('/api/admin/m3u/test', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { url, sourceId } = req.body || {};
      let targetUrl = url;
      if (!targetUrl && sourceId) {
        const source = await m3uImporter.getSource(sourceId);
        targetUrl = source?.url;
      }
      if (!targetUrl) {
        const allSources = await m3uImporter.getSources();
        if (allSources.length > 0) {
          targetUrl = allSources[0].url;
        } else {
          const defaultSource = await m3uImporter.getSource('source-default-playfilme');
          targetUrl = defaultSource?.url || process.env.M3U_PLAYLIST_URL;
        }
      }

      if (!targetUrl) {
        return res.status(200).json({ ok: false, message: 'URL da playlist não fornecida ou nenhuma fonte cadastrada.' });
      }

      const result = await m3uImporter.testConnection(targetUrl);
      res.json(result);
    } catch (err: any) {
      res.json({ ok: false, message: `Erro ao testar conexão: ${err?.message || 'Falha de rede'}` });
    }
  });

  // 4. Trigger Sync
  app.post('/api/admin/m3u/sync', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { sourceId } = req.body;
      const id = sourceId || 'source-default-playfilme';
      const jobId = await m3uImporter.runSync(id, ADMIN_EMAIL);
      db.addAuditLog(ADMIN_EMAIL, 'M3U_SYNC_START', 'SUCCESS', `Sincronização M3U disparada (Job: ${jobId})`);
      res.json({ success: true, jobId, message: 'Sincronização M3U iniciada em segundo plano.' });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Erro ao iniciar sincronização M3U' });
    }
  });

  // 5. Get Current Sync Status
  app.get('/api/admin/m3u/status', requireAdmin, async (req: Request, res: Response) => {
    try {
      const activeJob = await m3uImporter.getActiveJob();
      const sources = await m3uImporter.getSources();
      const primarySource = sources[0] || null;

      // Stats from catalog
      const catalog = db.getAllMedia();
      const m3uMovies = catalog.filter(i => i.id.startsWith('m3u-m-') || i.source === 'Imported');
      const m3uSeries = catalog.filter(i => i.id.startsWith('m3u-s-') || (i.source === 'Imported' && i.type === 'tv'));
      const channels = await m3uImporter.getLiveChannels(false);

      res.json({
        activeJob,
        isSyncing: !!(activeJob && (activeJob as any).status === 'RUNNING'),
        source: primarySource ? {
          ...primarySource,
          maskedUrl: M3UImporterService.maskUrl((primarySource as any)?.url || '')
        } : null,
        counts: {
          totalCatalog: catalog.length,
          m3uMovies: m3uMovies.length,
          m3uSeries: m3uSeries.length,
          liveChannels: channels.length
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao obter status M3U' });
    }
  });

  // 6. Cancel Sync
  app.post('/api/admin/m3u/cancel', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { jobId } = req.body;
      const cancelled = await m3uImporter.cancelSync(jobId);
      db.addAuditLog(ADMIN_EMAIL, 'M3U_SYNC_CANCEL', 'SUCCESS', 'Sincronização M3U cancelada pelo administrador.');
      res.json({ success: cancelled, message: cancelled ? 'Sincronização cancelada com sucesso.' : 'Nenhuma sincronização ativa para cancelar.' });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Erro ao cancelar sincronização' });
    }
  });

  // 7. Get Sync Jobs History
  app.get('/api/admin/m3u/jobs', requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string || '15', 10);
      const jobs = await m3uImporter.getSyncJobs(limit);
      res.json(jobs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao buscar histórico de sincronizações' });
    }
  });

  // 8. Get Sync Errors Log
  app.get('/api/admin/m3u/errors', requireAdmin, async (req: Request, res: Response) => {
    try {
      const jobId = req.query.jobId as string;
      const errors = await m3uImporter.getSyncErrors(jobId);
      res.json(errors);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao buscar logs de erro M3U' });
    }
  });

  // 9. Remove Unavailable Items
  app.post('/api/admin/m3u/remove-unavailable', requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await m3uImporter.removeUnavailableItems();
      db.addAuditLog(ADMIN_EMAIL, 'M3U_CLEANUP', 'SUCCESS', `Removidos ${result.removedMovies} filmes, ${result.removedSeries} séries e ${result.removedChannels} canais indisponíveis.`);
      res.json({
        success: true,
        ...result,
        message: `Limpeza concluída: ${result.removedMovies} filmes, ${result.removedSeries} séries e ${result.removedChannels} canais indisponíveis foram removidos.`
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao remover itens indisponíveis' });
    }
  });

  // 10. Live Channels (Public for users & player)
  app.get('/api/live-channels', async (req: Request, res: Response) => {
    try {
      const channels = await m3uImporter.getLiveChannels(true);
      res.json(channels);
    } catch (err: any) {
      res.status(500).json({ error: 'Falha ao buscar canais de TV ao vivo' });
    }
  });
  // 11. Live Channels (Admin Manager)
  app.get('/api/admin/live-channels', requireAdmin, async (req: Request, res: Response) => {
    try {
      const channels = await m3uImporter.getLiveChannels(false);
      res.json(channels);
    } catch (err: any) {
      res.status(500).json({ error: 'Falha ao buscar canais de TV' });
    }
  });

  app.post('/api/admin/live-channels', requireAdmin, async (req: Request, res: Response) => {
    try {
      const channel = { id: `ch-${Date.now()}`, ...req.body, active: req.body.active ?? true };
      await m3uImporter.addCustomChannel(channel);
      res.json(channel);
    } catch (err: any) {
      res.status(500).json({ error: 'Falha ao adicionar canal de TV' });
    }
  });

  app.put('/api/admin/live-channels/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      const updated = await m3uImporter.updateCustomChannel(req.params.id, req.body);
      res.json(updated || { success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Falha ao atualizar canal de TV' });
    }
  });

  app.delete('/api/admin/live-channels/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      await m3uImporter.deleteCustomChannel(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Falha ao remover canal de TV' });
    }
  });

  // --- VIDEO SOURCES MANAGEMENT (Admin) ---
  app.get('/api/admin/video-sources', requireAdmin, async (req: Request, res: Response) => {
    try {
      const contentId = req.query.contentId ? parseInt(req.query.contentId as string, 10) : undefined;
      const contentType = req.query.contentType as string | undefined;
      const sources = contentId || contentType
        ? await db.getVideoSources({ contentId, contentType })
        : await db.getAllVideoSources();
      res.json(sources);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao buscar fontes de vídeo' });
    }
  });

  app.post('/api/admin/video-sources', requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const rawUrl = String(body.url || '').trim();
      const classified = classifySourceUrl(rawUrl);
      if (!classified.valid) {
        return res.status(400).json({ error: classified.error || 'URL inválida.' });
      }
      const ssrf = await validatePublicHttpUrl(classified.normalizedUrl);
      if (!ssrf.safe) {
        return res.status(400).json({ error: ssrf.reason || 'URL bloqueada pela política de segurança SSRF.' });
      }

      const normType = String(body.contentType || 'movie').toLowerCase() === 'tv' || String(body.contentType || '').toLowerCase() === 'series' ? 'tv' : 'movie';
      const duplicate = db.findDuplicateVideoSource({
        contentId: Number(body.contentId),
        contentType: normType,
        url: classified.originalUrl,
        seasonNumber: normType === 'tv' ? Number(body.seasonNumber || 1) : undefined,
        episodeNumber: normType === 'tv' ? Number(body.episodeNumber || 1) : undefined
      });

      if (duplicate && !body.replaceExisting) {
        return res.status(409).json({
          error: 'Já existe uma fonte igual registada para este conteúdo.',
          code: 'DUPLICATE_SOURCE',
          existingSource: duplicate
        });
      }

      if (duplicate && body.replaceExisting) {
        await db.deleteVideoSource(duplicate.id);
      }

      // Preserve originalUrl intact (NEVER strip ?url= on PHP_VIDEO_ENDPOINT like mgeb.space/mp4.php?url=...)
      const parsedPriority = body.priority !== undefined ? Number(body.priority) : 1;
      const source = await db.addVideoSource({
        ...body,
        url: classified.originalUrl,
        originalUrl: classified.originalUrl,
        sourceKind: classified.sourceKind,
        format: body.format || classified.suggestedFormat,
        priority: !isNaN(parsedPriority) && parsedPriority > 0 ? Math.floor(parsedPriority) : 1,
        enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
        status: body.status && body.status !== 'unverified' ? body.status : 'registered',
        diagnostics: body.diagnostics || classified.diagnostics
      });
      res.json(source);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao adicionar fonte de vídeo' });
    }
  });

  app.get('/api/admin/video-sources/season-templates', requireAdmin, (req: Request, res: Response) => {
    try {
      const contentId = req.query.contentId ? parseInt(String(req.query.contentId), 10) : undefined;
      res.json({ success: true, templates: db.getSeasonSourceTemplates(contentId) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao consultar modelos de temporada.' });
    }
  });

  app.post('/api/admin/video-sources/season-templates', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { contentId, seasonNumber, baseUrl, useMgebPrefix, serverName, format, audioLanguage, quality } = req.body || {};
      const numId = parseInt(String(contentId), 10);
      const sNum = parseInt(String(seasonNumber), 10);
      if (isNaN(numId) || numId <= 0 || isNaN(sNum) || sNum < 0 || !baseUrl || typeof baseUrl !== 'string') {
        return res.status(400).json({ error: 'contentId, seasonNumber e baseUrl válidos são obrigatórios.' });
      }
      const classified = classifySourceUrl(baseUrl.trim());
      if (!classified.valid) {
        return res.status(400).json({ error: classified.error || 'URL base inválida.' });
      }
      const ssrf = await validatePublicHttpUrl(classified.normalizedUrl);
      if (!ssrf.safe) {
        return res.status(400).json({ error: ssrf.reason || 'URL bloqueada pela política de segurança SSRF.' });
      }
      const saved = db.saveSeasonSourceTemplate({
        contentId: numId,
        seasonNumber: sNum,
        baseUrl: classified.originalUrl,
        useMgebPrefix: useMgebPrefix !== false,
        serverName,
        format,
        audioLanguage,
        quality
      });
      res.json({ success: true, template: saved });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao guardar modelo de temporada.' });
    }
  });

  app.post('/api/admin/video-sources/batch-episodes', requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const contentId = parseInt(String(body.contentId), 10);
      const seasonNumber = parseInt(String(body.seasonNumber), 10);
      const episodes = Array.isArray(body.episodes) ? body.episodes : [];
      const conflictMode =
        body.conflictMode === 'overwrite' || body.conflictMode === 'add_alternative'
          ? body.conflictMode
          : 'skip';

      if (isNaN(contentId) || contentId <= 0 || isNaN(seasonNumber) || seasonNumber < 0) {
        return res.status(400).json({ error: 'TMDB ID e Temporada válidos são obrigatórios.' });
      }
      if (episodes.length === 0 || episodes.length > 500) {
        return res.status(400).json({ error: 'Forneça entre 1 e 500 episódios válidos para guardar.' });
      }

      // Enforce manual import only rule: series must already be in catalog
      const existingMedia = db.getMediaByTmdbAndType(contentId, 'tv');
      if (!existingMedia) {
        return res.status(404).json({
          error:
            'Esta série ainda não está no catálogo da RONYCINE API. Importe a série manualmente antes de guardar episódios e fontes.',
          code: 'SERIES_NOT_IN_CATALOG'
        });
      }

      // Validate every episode URL + SSRF before mutating anything
      const validatedEpisodes: any[] = [];
      for (const ep of episodes) {
        const epNum = parseInt(String(ep?.episodeNumber), 10);
        const epUrl = String(ep?.url || '').trim();
        if (isNaN(epNum) || epNum <= 0 || !epUrl) {
          return res.status(400).json({ error: `Episódio inválido na lista (número ${ep?.episodeNumber}).` });
        }
        const classified = classifySourceUrl(epUrl);
        if (!classified.valid) {
          return res.status(400).json({ error: `Episódio ${epNum}: ${classified.error || 'URL inválida.'}` });
        }
        const ssrf = await validatePublicHttpUrl(classified.normalizedUrl);
        if (!ssrf.safe) {
          return res.status(400).json({ error: `Episódio ${epNum}: ${ssrf.reason || 'URL bloqueada pela política SSRF.'}` });
        }
        validatedEpisodes.push({
          ...ep,
          episodeNumber: epNum,
          url: classified.originalUrl
        });
      }

      const adminEmail = (req as any).user?.email || ADMIN_EMAIL;
      const result = await db.saveBatchEpisodeSources({
        contentId,
        seasonNumber,
        seasonBaseUrl: typeof body.seasonBaseUrl === 'string' ? body.seasonBaseUrl : undefined,
        useMgebPrefix: body.useMgebPrefix !== false,
        serverName: body.serverName,
        format: body.format,
        audioLanguage: body.audioLanguage,
        quality: body.quality,
        isPrimary: body.isPrimary,
        priority: body.priority !== undefined ? Number(body.priority) : 1,
        enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
        conflictMode,
        adminEmail,
        episodes: validatedEpisodes
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao guardar episódios em lote.' });
    }
  });

  app.patch('/api/admin/video-sources/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      const updates = { ...(req.body || {}) };
      if (updates.priority !== undefined) {
        const parsedPriority = Number(updates.priority);
        updates.priority = !isNaN(parsedPriority) && parsedPriority > 0 ? Math.floor(parsedPriority) : 1;
      }
      if (updates.enabled !== undefined) {
        updates.enabled = Boolean(updates.enabled);
      }
      if (updates.url) {
        const classified = classifySourceUrl(String(updates.url));
        if (!classified.valid) {
          return res.status(400).json({ error: classified.error || 'URL inválida.' });
        }
        const ssrf = await validatePublicHttpUrl(classified.normalizedUrl);
        if (!ssrf.safe) {
          return res.status(400).json({ error: ssrf.reason || 'URL bloqueada pela política de segurança SSRF.' });
        }
        updates.url = classified.originalUrl;
        updates.originalUrl = classified.originalUrl;
        updates.sourceKind = updates.sourceKind || classified.sourceKind;
      }
      const source = await db.updateVideoSource(req.params.id, updates);
      res.json(source);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao atualizar fonte de vídeo' });
    }
  });

  app.delete('/api/admin/video-sources/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.deleteVideoSource(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao remover fonte de vídeo' });
    }
  });

  app.post('/api/admin/video-sources/verify-all', requireAdmin, async (req: Request, res: Response) => {
    try {
      const sources = await db.getAllVideoSources();
      for (const source of sources) {
        await db.updateVideoSource(source.id, { status: 'validating' });
        const result = await probeVideoSource(source.originalUrl || source.url);
        await db.updateVideoSource(source.id, {
          status: result.status,
          sourceKind: result.sourceKind,
          format: result.detectedFormat,
          lastVerifiedAt: result.diagnostics.testedAt || new Date().toISOString(),
          verificationResult: result.message,
          diagnostics: result.diagnostics
        });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao verificar fontes' });
    }
  });

  app.post('/api/admin/video-sources/:id/verify', requireAdmin, async (req: Request, res: Response) => {
    try {
      const sources = await db.getAllVideoSources();
      const source = sources.find(s => s.id === req.params.id);
      if (!source) return res.status(404).json({ error: 'Fonte não encontrada' });

      await db.updateVideoSource(source.id, { status: 'validating' });
      const result = await probeVideoSource(source.originalUrl || source.url);
      const updated = await db.updateVideoSource(source.id, {
        status: result.status,
        sourceKind: result.sourceKind,
        format: result.detectedFormat,
        lastVerifiedAt: result.diagnostics.testedAt || new Date().toISOString(),
        verificationResult: result.message,
        diagnostics: result.diagnostics
      });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao verificar fonte' });
    }
  });

  app.post('/api/admin/sources/verify-link', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({
          success: false,
          status: 'offline',
          message: 'URL inválida'
        });
      }

      // CRITICAL: Preserve full nested URL (e.g., https://mgeb.space/mp4.php?url=...) without stripping outer endpoint!
      const result = await probeVideoSource(url);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        status: 'unverifiable',
        message: err?.message || 'Erro ao validar link'
      });
    }
  });

  app.post('/api/admin/sources/verify-batch', requireAdmin, async (req: Request, res: Response) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (items.length === 0 || items.length > 60) {
        return res.status(400).json({ error: 'Forneça entre 1 e 60 links para verificação em lote.' });
      }

      const results: Array<{ episodeNumber: number; url: string; probe: any }> = [];
      const concurrency = 4;
      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const chunkResults = await Promise.all(
          chunk.map(async (entry: any) => {
            const epNum = Number(entry?.episodeNumber || 0);
            const url = String(entry?.url || '').trim();
            if (!url) {
              return {
                episodeNumber: epNum,
                url,
                probe: {
                  success: false,
                  accessible: false,
                  status: 'offline',
                  message: 'URL vazia.'
                }
              };
            }
            const probe = await probeVideoSource(url);
            return { episodeNumber: epNum, url, probe };
          })
        );
        results.push(...chunkResults);
      }

      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err?.message || 'Erro ao verificar lote de links.'
      });
    }
  });

  // Public Lista alias
  app.get('/api/v1/lista', async (req: Request, res: Response) => {
    try {
      const pag = parsePagination(req, 50);
      if ('error' in pag) {
        return res.status(400).json({ success: false, code: 'INVALID_PARAMS', error: pag.error });
      }
      const tipo = req.query.tipo === 'series' ? 'tv' : 'movie';
      const catalog = db.getCatalog({ type: tipo, page: pag.page, limit: pag.limit });
      res.json({
        success: true,
        type: tipo,
        count: catalog.items.length,
        total: catalog.total,
        page: catalog.page,
        totalPages: catalog.totalPages,
        pagination: { total: catalog.total, page: catalog.page, limit: pag.limit, totalPages: catalog.totalPages },
        data: catalog.items.map(sanitizeMediaForApi)
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Erro ao buscar lista' });
    }
  });

  // ==========================================
  // PLAYER SESSION, TOKEN SECURITY & TELEMETRY
  // ==========================================
  app.get('/api/player/:contentId/session', async (req: Request, res: Response) => {
    try {
      const rawId = String(req.params.contentId || '').trim();
      const inferredTypeFromPrefix = rawId.startsWith('series-') || rawId.startsWith('tv-') ? 'tv' : undefined;
      const numericId = parseInt(rawId.replace(/^(movie|series|tv)-/, ''), 10);
      if (isNaN(numericId) || numericId <= 0) {
        return res.status(400).json({ success: false, code: 'INVALID_ID', error: 'ID do conteúdo inválido.' });
      }

      const rawType = String(req.query.type || inferredTypeFromPrefix || 'movie').toLowerCase();
      const mediaType: 'movie' | 'tv' = rawType === 'tv' || rawType === 'series' ? 'tv' : 'movie';
      const season = req.query.season ? parseInt(String(req.query.season), 10) : 1;
      const episode = req.query.episode ? parseInt(String(req.query.episode), 10) : 1;
      const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';

      const originHost =
        extractHostFromHeader(req.headers['x-origin-domain'] as string) ||
        extractHostFromHeader(req.headers.origin as string) ||
        extractHostFromHeader(req.headers.referer as string);
      const serverHost = (req.headers.host || '').toLowerCase();
      const isExternalOrigin = Boolean(
        originHost &&
          (!serverHost ||
            (originHost !== serverHost && originHost.split(':')[0] !== serverHost.split(':')[0]) ||
            Boolean(req.headers['x-origin-domain']))
      );

      let verifiedApp: DeveloperApp | undefined;
      if (token) {
        const verif = verifyPlaybackToken(token);
        if (!verif.valid || !verif.payload) {
          db.recordPlaybackEvent({
            contentId: numericId,
            mediaType,
            season: mediaType === 'tv' ? season : undefined,
            episode: mediaType === 'tv' ? episode : undefined,
            origin: originHost,
            status: 'DENIED',
            errorMessage: verif.reason === 'EXPIRED' ? 'Token de reprodução expirado.' : 'Token de reprodução inválido.'
          });
          return res.status(401).json({
            success: false,
            code: verif.reason === 'EXPIRED' ? 'PLAYBACK_TOKEN_EXPIRED' : 'PLAYBACK_TOKEN_INVALID',
            error:
              verif.reason === 'EXPIRED'
                ? 'Sessão expirada: o token de reprodução não é mais válido.'
                : 'Token de reprodução inválido ou adulterado.'
          });
        }

        if (Number(verif.payload.contentId) !== numericId) {
          db.recordPlaybackEvent({
            contentId: numericId,
            mediaType,
            appId: verif.payload.appId,
            origin: originHost,
            status: 'DENIED',
            errorMessage: 'Token não corresponde ao conteúdo solicitado.'
          });
          return res.status(403).json({
            success: false,
            code: 'TOKEN_CONTENT_MISMATCH',
            error: 'Este token de reprodução não pertence a este conteúdo.'
          });
        }

        verifiedApp = db.getDeveloperAppById(verif.payload.appId);
        if (verifiedApp && verifiedApp.status === 'SUSPENDED') {
          db.recordPlaybackEvent({
            contentId: numericId,
            mediaType,
            appId: verifiedApp.id,
            origin: originHost,
            status: 'DENIED',
            errorMessage: 'Aplicação suspensa.'
          });
          return res.status(403).json({
            success: false,
            code: 'APP_SUSPENDED',
            error: 'A aplicação associada encontra-se suspensa.'
          });
        }

        const effectiveDomains = verifiedApp ? verifiedApp.authorizedDomains : verif.payload.allowedDomains;
        if (isExternalOrigin && effectiveDomains.length > 0) {
          if (!originHost || !isHostInAuthorizedDomains(originHost, effectiveDomains)) {
            db.recordPlaybackEvent({
              contentId: numericId,
              mediaType,
              appId: verif.payload.appId,
              origin: originHost,
              status: 'DENIED',
              errorMessage: `Domínio ${originHost} não autorizado.`
            });
            return res.status(403).json({
              success: false,
              code: 'DOMAIN_NOT_AUTHORIZED',
              error: `O domínio "${originHost}" não está autorizado a incorporar este player.`
            });
          }
        }
      } else {
        const globalCfg = db.getApiGlobalSettings();
        if (isExternalOrigin && globalCfg.requireDomainForEmbed) {
          db.recordPlaybackEvent({
            contentId: numericId,
            mediaType,
            origin: originHost,
            status: 'DENIED',
            errorMessage: 'Incorporação externa sem token autorizado.'
          });
          return res.status(403).json({
            success: false,
            code: 'DOMAIN_NOT_AUTHORIZED',
            error: 'Incorporação externa requer token de reprodução autorizado para o seu domínio.'
          });
        }
      }

      const resolvedMedia = await ensureMediaCatalogEntry(numericId, mediaType, season, episode);
      if (!resolvedMedia) {
        db.recordPlaybackEvent({
          contentId: numericId,
          mediaType,
          season: mediaType === 'tv' ? season : undefined,
          episode: mediaType === 'tv' ? episode : undefined,
          appId: verifiedApp?.id || null,
          origin: originHost,
          status: 'ERROR',
          errorMessage: 'Conteúdo não encontrado ou não publicado na RONYCINE API.'
        });
        return res.status(404).json({
          success: false,
          code: 'CONTENT_NOT_FOUND',
          contentNotFound: true,
          tokenVerified: Boolean(token),
          content: null,
          source: null,
          sources: [],
          alternativeSources: [],
          message: 'Conteúdo não encontrado na RONYCINE API.',
          error: 'Conteúdo não encontrado na RONYCINE API.'
        });
      }

      const { sources: localSources } = db.getMediaAndSources(numericId, mediaType, season, episode);
      const vSources = await db.getVideoSources({
        contentId: numericId,
        contentType: mediaType,
        seasonNumber: mediaType === 'tv' ? season : undefined,
        episodeNumber: mediaType === 'tv' ? episode : undefined
      });
      const allSources = mergeAndDedupeSources(localSources, vSources);

      const isDisabledStatus = (src: any) => {
        if (src?.enabled === false) return true;
        const lower = (src?.status || '').toLowerCase();
        return lower === 'inactive' || lower === 'offline' || lower === 'unsupported_format' || lower === 'embed_blocked';
      };

      const playableSources = allSources.filter(src => !isDisabledStatus(src));
      const primary = playableSources[0];
      const mappedPlayable = playableSources.map(src => ({
        ...sanitizeSourceForApi(src),
        originalUrl: src.originalUrl || src.url,
        sourceKind: src.sourceKind,
        status: src.status || 'registered',
        diagnostics: src.diagnostics
      }));

      const seasonObj =
        mediaType === 'tv'
          ? (resolvedMedia.seasons || []).find(s => Number(s.seasonNumber) === Number(season))
          : undefined;
      const epObj =
        mediaType === 'tv'
          ? seasonObj?.episodes?.find(e => Number(e.episodeNumber) === Number(episode))
          : undefined;

      if (playableSources.length > 0 && primary) {
        db.recordPlaybackEvent({
          contentId: numericId,
          mediaType,
          season: mediaType === 'tv' ? season : undefined,
          episode: mediaType === 'tv' ? episode : undefined,
          appId: verifiedApp?.id || null,
          origin: originHost,
          sourceUrl: primary.url,
          sourceType: mapToCanonicalClassification(primary.sourceKind, primary.format, primary.diagnostics?.recommendedPlaybackMode),
          status: 'STARTED'
        });

        return res.json({
          success: true,
          code: 'READY',
          tokenVerified: Boolean(token),
          appName: verifiedApp?.name,
          content: {
            id: resolvedMedia.id,
            title: resolvedMedia.title,
            type: mediaType,
            tmdbId: numericId,
            season: mediaType === 'tv' ? season : undefined,
            episode: mediaType === 'tv' ? episode : undefined,
            episodeTitle: epObj?.title,
            poster: resolvedMedia.posterPath,
            backdrop: resolvedMedia.backdropPath,
            overview: resolvedMedia.overview
          },
          source: mappedPlayable[0],
          sources: mappedPlayable,
          alternativeSources: mappedPlayable.slice(1),
          nextEpisode: mediaType === 'tv' ? { available: true, season, episode: episode + 1 } : undefined,
          message: 'Sessão de reprodução autorizada.'
        });
      }

      const errorCode = allSources.length > 0 ? 'SOURCE_UNAVAILABLE' : 'NO_SOURCE_AVAILABLE';
      db.recordPlaybackEvent({
        contentId: numericId,
        mediaType,
        season: mediaType === 'tv' ? season : undefined,
        episode: mediaType === 'tv' ? episode : undefined,
        appId: verifiedApp?.id || null,
        origin: originHost,
        status: 'ERROR',
        errorMessage: allSources.length > 0 ? 'Fontes registadas indisponíveis ou desativadas.' : 'Nenhuma fonte registada para este conteúdo.'
      });

      return res.json({
        success: false,
        code: errorCode,
        tokenVerified: Boolean(token),
        content: {
          id: resolvedMedia.id,
          title: resolvedMedia.title,
          type: mediaType,
          tmdbId: numericId,
          season: mediaType === 'tv' ? season : undefined,
          episode: mediaType === 'tv' ? episode : undefined,
          episodeTitle: epObj?.title,
          poster: resolvedMedia.posterPath,
          backdrop: resolvedMedia.backdropPath,
          overview: resolvedMedia.overview
        },
        source: null,
        sources: [],
        alternativeSources: [],
        message:
          allSources.length > 0
            ? 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.'
            : 'Este conteúdo ainda não possui uma fonte de reprodução disponível.'
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Erro ao inicializar sessão do player.' });
    }
  });

  app.post('/api/player/events', (req: Request, res: Response) => {
    try {
      const { contentId, mediaType, season, episode, status, errorMessage, sourceType, sourceUrl } = req.body || {};
      const numId = parseInt(String(contentId || 0), 10);
      if (!numId) return res.json({ success: true });
      db.recordPlaybackEvent({
        contentId: numId,
        mediaType: mediaType === 'tv' ? 'tv' : 'movie',
        season: season ? Number(season) : undefined,
        episode: episode ? Number(episode) : undefined,
        origin: extractHostFromHeader((req.headers.origin as string) || (req.headers.referer as string)),
        sourceType: sourceType || null,
        sourceUrl: sourceUrl || null,
        status: status === 'DENIED' ? 'DENIED' : status === 'STARTED' ? 'STARTED' : 'ERROR',
        errorMessage: errorMessage ? String(errorMessage).slice(0, 300) : null
      });
      res.json({ success: true });
    } catch {
      res.json({ success: true });
    }
  });

  // ==========================================
  // DEVELOPER PORTAL ROUTES (SELF-SERVICE, STRICTLY SCOPED)
  // ==========================================
  app.get('/api/developer/overview', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const apps = db.getDeveloperApps({ id: user.id, email: user.email });
    const keys = db.getApiKeysByOwner({ id: user.id, email: user.email });
    const stats = db.getApiMonitoringSummary(apps.map(a => a.id));
    const plans = db.getPlansConfig();
    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      apps,
      keys,
      stats,
      plans: Object.values(plans)
    });
  });

  app.get('/api/developer/apps', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const apps = db.getDeveloperApps({ id: user.id, email: user.email });
    const allKeys = db.getApiKeysByOwner({ id: user.id, email: user.email });
    const enriched = apps.map(a => ({
      ...a,
      keysCount: allKeys.filter(k => k.appId === a.id).length,
      activeKeysCount: allKeys.filter(k => k.appId === a.id && k.status === 'ACTIVE').length,
      totalRequests: allKeys.filter(k => k.appId === a.id).reduce((sum, k) => sum + (k.requestCount || 0), 0)
    }));
    res.json({ success: true, apps: enriched });
  });

  app.post('/api/developer/apps', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const { name, description, authorizedDomains } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Nome da aplicação deve ter pelo menos 2 caracteres.' });
    }

    const existingApps = db.getDeveloperApps({ id: user.id, email: user.email });
    const freePlan = db.getPlanConfig('FREE');
    const maxAppsAllowed = Math.max(freePlan.maxApps, ...existingApps.map(a => db.getPlanConfig(a.plan).maxApps));
    if (existingApps.length >= maxAppsAllowed) {
      return res.status(403).json({
        success: false,
        error: `Limite de ${maxAppsAllowed} aplicações atingido para o seu plano atual.`
      });
    }

    const domainsArr: string[] = Array.isArray(authorizedDomains)
      ? authorizedDomains
      : typeof authorizedDomains === 'string'
      ? authorizedDomains.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
      : [];

    if (domainsArr.length > freePlan.maxAuthorizedDomains) {
      return res.status(403).json({
        success: false,
        error: `Máximo de ${freePlan.maxAuthorizedDomains} domínios autorizados no plano FREE.`
      });
    }

    const appRecord = db.createDeveloperApp({
      ownerId: user.id,
      ownerEmail: user.email,
      name: name.trim(),
      description: typeof description === 'string' ? description : '',
      authorizedDomains: domainsArr,
      plan: 'FREE'
    });

    // Automatically issue initial key so developer gets a ready-to-use plaintext key once
    const { key, plaintextKey } = db.createApiKey({
      appId: appRecord.id,
      ownerId: user.id,
      ownerEmail: user.email,
      name: 'Chave Principal'
    });

    db.addAuditLog(user.email, 'DEV_CREATE_APP', 'SUCCESS', `Aplicação criada: ${appRecord.name} (${appRecord.id})`);

    res.status(201).json({
      success: true,
      app: appRecord,
      initialKey: key,
      plaintextKey
    });
  });

  app.put('/api/developer/apps/:id', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const existing = db.getDeveloperAppById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Aplicação não encontrada.' });
    }
    const isOwner =
      existing.ownerId === user.id ||
      existing.ownerEmail.toLowerCase() === user.email.toLowerCase() ||
      user.role === 'founder';
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Acesso negado a esta aplicação.' });
    }

    const { name, description, authorizedDomains } = req.body || {};
    const planCfg = db.getPlanConfig(existing.plan);
    let nextDomains: string[] | undefined;
    if (authorizedDomains !== undefined) {
      nextDomains = Array.isArray(authorizedDomains)
        ? authorizedDomains
        : typeof authorizedDomains === 'string'
        ? authorizedDomains.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
        : [];
      if (nextDomains.length > planCfg.maxAuthorizedDomains) {
        return res.status(403).json({
          success: false,
          error: `O plano ${existing.plan} permite até ${planCfg.maxAuthorizedDomains} domínios autorizados.`
        });
      }
    }

    const updated = db.updateDeveloperApp(existing.id, {
      name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
      description: typeof description === 'string' ? description : existing.description,
      authorizedDomains: nextDomains
    });

    res.json({ success: true, app: updated });
  });

  app.delete('/api/developer/apps/:id', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const existing = db.getDeveloperAppById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Aplicação não encontrada.' });
    }
    const isOwner =
      existing.ownerId === user.id ||
      existing.ownerEmail.toLowerCase() === user.email.toLowerCase() ||
      user.role === 'founder';
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Acesso negado a esta aplicação.' });
    }

    db.deleteDeveloperApp(existing.id);
    db.addAuditLog(user.email, 'DEV_DELETE_APP', 'SUCCESS', `Aplicação removida: ${existing.name} (${existing.id})`);
    res.json({ success: true });
  });

  app.get('/api/developer/keys', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const keys = db.getApiKeysByOwner({ id: user.id, email: user.email });
    res.json({ success: true, keys });
  });

  app.post('/api/developer/keys', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const { appId, name } = req.body || {};
    if (!appId || typeof appId !== 'string') {
      return res.status(400).json({ success: false, error: 'appId é obrigatório.' });
    }
    const appRecord = db.getDeveloperAppById(appId);
    if (!appRecord) {
      return res.status(404).json({ success: false, error: 'Aplicação não encontrada.' });
    }
    const isOwner =
      appRecord.ownerId === user.id ||
      appRecord.ownerEmail.toLowerCase() === user.email.toLowerCase() ||
      user.role === 'founder';
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Acesso negado a esta aplicação.' });
    }

    const { key, plaintextKey } = db.createApiKey({
      appId: appRecord.id,
      ownerId: user.id,
      ownerEmail: user.email,
      name: typeof name === 'string' && name.trim() ? name.trim() : 'Nova API Key'
    });

    db.addAuditLog(user.email, 'DEV_CREATE_KEY', 'SUCCESS', `Nova API Key criada para app ${appRecord.name} (${key.keyPrefix})`);
    res.status(201).json({ success: true, key, plaintextKey });
  });

  app.post('/api/developer/keys/:id/revoke', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const rec = db.getApiKeyById(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: 'API Key não encontrada.' });
    const isOwner =
      rec.ownerId === user.id ||
      rec.ownerEmail.toLowerCase() === user.email.toLowerCase() ||
      user.role === 'founder';
    if (!isOwner) return res.status(403).json({ success: false, error: 'Acesso negado.' });

    const revoked = db.revokeApiKey(rec.id);
    db.addAuditLog(user.email, 'DEV_REVOKE_KEY', 'SUCCESS', `API Key revogada: ${rec.keyPrefix}`);
    res.json({ success: true, key: revoked });
  });

  app.post('/api/developer/keys/:id/regenerate', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const rec = db.getApiKeyById(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: 'API Key não encontrada.' });
    const isOwner =
      rec.ownerId === user.id ||
      rec.ownerEmail.toLowerCase() === user.email.toLowerCase() ||
      user.role === 'founder';
    if (!isOwner) return res.status(403).json({ success: false, error: 'Acesso negado.' });

    const regen = db.regenerateApiKey(rec.id);
    if (!regen) return res.status(404).json({ success: false, error: 'API Key não encontrada.' });
    db.addAuditLog(user.email, 'DEV_REGENERATE_KEY', 'SUCCESS', `API Key regenerada para app ${rec.appId}`);
    res.json({ success: true, key: regen.key, plaintextKey: regen.plaintextKey });
  });

  app.get('/api/developer/stats', requireUser, (req: Request, res: Response) => {
    const user = (req as any).user;
    const apps = db.getDeveloperApps({ id: user.id, email: user.email });
    const summary = db.getApiMonitoringSummary(apps.map(a => a.id));
    res.json({ success: true, stats: summary });
  });

  // ==========================================
  // ADMIN DEVELOPER PLATFORM MANAGEMENT ROUTES
  // ==========================================
  app.get('/api/admin/developers', requireAdmin, (req: Request, res: Response) => {
    const apps = db.getDeveloperApps();
    const keys = db.getAllApiKeys();
    const users = db.getAllUsers();
    res.json({
      success: true,
      apps: apps.map(a => ({
        ...a,
        keysCount: keys.filter(k => k.appId === a.id).length,
        activeKeysCount: keys.filter(k => k.appId === a.id && k.status === 'ACTIVE').length,
        totalRequests: keys.filter(k => k.appId === a.id).reduce((s, k) => s + (k.requestCount || 0), 0)
      })),
      keys,
      developersCount: new Set(apps.map(a => a.ownerEmail)).size,
      usersCount: users.length
    });
  });

  app.patch('/api/admin/developer-apps/:id/status', requireAdmin, (req: Request, res: Response) => {
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;
    const { status, plan } = req.body || {};
    const existing = db.getDeveloperAppById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Aplicação não encontrada.' });

    const updates: any = {};
    if (status === 'ACTIVE' || status === 'SUSPENDED') updates.status = status;
    if (plan === 'FREE' || plan === 'DEVELOPER' || plan === 'PRO' || plan === 'ENTERPRISE') updates.plan = plan;

    const updated = db.updateDeveloperApp(existing.id, updates);
    db.addAuditLog(adminEmail, 'ADMIN_UPDATE_DEV_APP', 'SUCCESS', `App ${existing.name} atualizado: ${JSON.stringify(updates)}`);
    res.json({ success: true, app: updated });
  });

  app.post('/api/admin/api-keys/:id/revoke', requireAdmin, (req: Request, res: Response) => {
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;
    const revoked = db.revokeApiKey(req.params.id);
    if (!revoked) return res.status(404).json({ success: false, error: 'API Key não encontrada.' });
    db.addAuditLog(adminEmail, 'ADMIN_REVOKE_API_KEY', 'SUCCESS', `Chave ${revoked.keyPrefix} revogada pelo admin.`);
    res.json({ success: true, key: revoked });
  });

  app.get('/api/admin/monitoring', requireAdmin, (req: Request, res: Response) => {
    const summary = db.getApiMonitoringSummary();
    const globalCfg = db.getApiGlobalSettings();
    res.json({ success: true, monitoring: summary, settings: globalCfg });
  });

  app.get('/api/admin/api-config', requireAdmin, (req: Request, res: Response) => {
    res.json({ success: true, settings: db.getApiGlobalSettings() });
  });

  app.put('/api/admin/api-config', requireAdmin, (req: Request, res: Response) => {
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;
    const updated = db.updateApiGlobalSettings(req.body || {});
    db.addAuditLog(adminEmail, 'ADMIN_UPDATE_API_CONFIG', 'SUCCESS', 'Configurações globais da API atualizadas.');
    res.json({ success: true, settings: updated });
  });

  app.get('/api/admin/plans', requireAdmin, (req: Request, res: Response) => {
    res.json({ success: true, plans: db.getPlansConfig() });
  });

  app.put('/api/admin/plans/:tier', requireAdmin, (req: Request, res: Response) => {
    const adminEmail = (req as any).user?.email || ADMIN_EMAIL;
    const tier = String(req.params.tier || '').toUpperCase() as PlanTier;
    if (!['FREE', 'DEVELOPER', 'PRO', 'ENTERPRISE'].includes(tier)) {
      return res.status(400).json({ success: false, error: 'Plano inválido.' });
    }
    const updated = db.updatePlanConfig(tier, req.body || {});
    db.addAuditLog(adminEmail, 'ADMIN_UPDATE_PLAN', 'SUCCESS', `Limites do plano ${tier} atualizados.`);
    res.json({ success: true, plan: updated });
  });

  app.get('/api/admin/player-stats', requireAdmin, (req: Request, res: Response) => {
    res.json({
      success: true,
      stats: db.getPlaybackStats(),
      settings: db.getApiGlobalSettings()
    });
  });

  // --- RONYCINE PROVIDER RESOLVER & CONFIG API ---
  app.post('/api/v1/providers/resolve', async (req: Request, res: Response) => {
    try {
      const { url, format } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, error: 'URL inválida ou ausente.' });
      }

      const classified = classifySourceUrl(url);
      if (!classified.valid) {
        return res.status(400).json({ success: false, error: classified.error || 'URL inválida.' });
      }

      const ssrfCheck = await validatePublicHttpUrl(classified.normalizedUrl);
      if (!ssrfCheck.safe) {
        return res.status(400).json({
          success: false,
          status: 'offline',
          error: ssrfCheck.reason || 'URL bloqueada por política de segurança.'
        });
      }

      const providerConfig = db.getProviderConfig();

      // 1. UQLOAD Detection
      const uqloadMatch = url.match(/(?:uqload\.[a-z]{2,6})\/(?:embed-)?([a-zA-Z0-9]+)(?:\.html)?/i);
      if (uqloadMatch) {
        const fileCode = uqloadMatch[1];
        const embedUrl = `https://uqload.com/embed-${fileCode}.html`;
        const uqloadKey = providerConfig.uqloadApiKey || process.env.UQLOAD_API_KEY;

        if (uqloadKey) {
          try {
            const apiRes = await fetch(`https://uqload.com/api/file/direct_link?key=${encodeURIComponent(uqloadKey)}&file_code=${encodeURIComponent(fileCode)}`, {
              signal: AbortSignal.timeout(5000)
            });
            if (apiRes.ok) {
              const apiData = await apiRes.json();
              if (apiData.status === 200 && apiData.result) {
                return res.json({
                  success: true,
                  provider: 'UQLOAD',
                  sourceKind: 'DIRECT_MP4',
                  format: 'mp4',
                  isDirect: true,
                  directUrl: apiData.result,
                  embedUrl,
                  fileCode,
                  diagnostics: classified.diagnostics
                });
              }
            }
          } catch (e) {
            console.warn('[UQLOAD API] Fallback to embed due to error:', e);
          }
        }

        return res.json({
          success: true,
          provider: 'UQLOAD',
          sourceKind: 'EMBED_PLAYER',
          format: 'embed',
          isDirect: false,
          embedUrl,
          fileCode,
          diagnostics: classified.diagnostics,
          note: uqloadKey ? 'Link direto indisponível para este arquivo no UQLOAD. Usando embed oficial.' : 'Embed oficial UQLOAD.'
        });
      }

      // 2. ANONMP4 Detection
      const anonMatch = url.match(/(?:anonmp4\.[a-z]{2,6})\/(?:e|v)?\/?([a-zA-Z0-9]+)/i);
      if (anonMatch) {
        const fileCode = anonMatch[1];
        const embedUrl = `https://anonmp4.com/e/${fileCode}`;

        return res.json({
          success: true,
          provider: 'ANONMP4',
          sourceKind: 'EMBED_PLAYER',
          format: 'embed',
          isDirect: false,
          embedUrl,
          fileCode,
          diagnostics: classified.diagnostics,
          note: 'Utilizando embed oficial ANONMP4 conforme política do servidor.'
        });
      }

      // 3. Direct File Extensions (MP4 / WebM / HLS / DASH)
      if (classified.sourceKind === 'DIRECT_MP4') {
        return res.json({
          success: true,
          provider: 'Servidor Direto',
          sourceKind: 'DIRECT_MP4',
          format: 'mp4',
          isDirect: true,
          directUrl: classified.originalUrl,
          embedUrl: classified.originalUrl,
          diagnostics: classified.diagnostics
        });
      }

      if (classified.sourceKind === 'DIRECT_WEBM') {
        return res.json({
          success: true,
          provider: 'Servidor Direto',
          sourceKind: 'DIRECT_WEBM',
          format: 'webm',
          isDirect: true,
          directUrl: classified.originalUrl,
          embedUrl: classified.originalUrl,
          diagnostics: classified.diagnostics
        });
      }

      if (classified.sourceKind === 'DIRECT_HLS') {
        return res.json({
          success: true,
          provider: 'Servidor HLS',
          sourceKind: 'DIRECT_HLS',
          format: 'm3u8',
          isDirect: true,
          directUrl: classified.originalUrl,
          embedUrl: classified.originalUrl,
          diagnostics: classified.diagnostics
        });
      }

      if (classified.sourceKind === 'DIRECT_DASH') {
        return res.json({
          success: true,
          provider: 'Servidor DASH',
          sourceKind: 'DIRECT_DASH',
          format: 'dash',
          isDirect: true,
          directUrl: classified.originalUrl,
          embedUrl: classified.originalUrl,
          diagnostics: classified.diagnostics
        });
      }

      // 4. Known Embed Players
      if (classified.sourceKind === 'EMBED_PLAYER') {
        return res.json({
          success: true,
          provider: classified.suggestedServerName || 'Embed Externo',
          sourceKind: 'EMBED_PLAYER',
          format: 'embed',
          isDirect: false,
          embedUrl: classified.originalUrl,
          diagnostics: classified.diagnostics
        });
      }

      // 5. PHP_VIDEO_ENDPOINT (e.g., https://mgeb.space/mp4.php?url=...), WEB_PAGE, or UNKNOWN:
      const probe = await probeVideoSource(classified.originalUrl);
      const mode = probe.diagnostics.recommendedPlaybackMode;

      if (mode === 'html5_mp4' || mode === 'html5_webm' || mode === 'hls' || mode === 'dash') {
        return res.json({
          success: true,
          provider: classified.suggestedServerName || 'Endpoint PHP / Direto',
          sourceKind: probe.sourceKind,
          format: probe.detectedFormat,
          isDirect: true,
          directUrl: classified.originalUrl,
          embedUrl: classified.originalUrl,
          diagnostics: probe.diagnostics,
          note: probe.message
        });
      }

      if (mode === 'iframe') {
        return res.json({
          success: true,
          provider: classified.suggestedServerName || 'Player Incorporado',
          sourceKind: probe.sourceKind,
          format: 'iframe',
          isDirect: false,
          embedUrl: classified.originalUrl,
          diagnostics: probe.diagnostics,
          note: probe.message
        });
      }

      if (probe.status === 'embed_blocked') {
        return res.json({
          success: false,
          status: 'embed_blocked',
          sourceKind: probe.sourceKind,
          format: probe.detectedFormat,
          isDirect: false,
          embedUrl: classified.originalUrl,
          error: 'Esta página não permite incorporação externa.',
          diagnostics: probe.diagnostics
        });
      }

      if (probe.status === 'unsupported_format') {
        return res.json({
          success: false,
          status: 'unsupported_format',
          sourceKind: probe.sourceKind,
          format: probe.detectedFormat,
          isDirect: false,
          embedUrl: classified.originalUrl,
          error: 'A fonte não devolveu um formato de vídeo compatível.',
          diagnostics: probe.diagnostics
        });
      }

      if (probe.status === 'offline') {
        const httpCode = probe.diagnostics.httpStatus;
        return res.json({
          success: false,
          status: 'offline',
          sourceKind: probe.sourceKind,
          format: probe.detectedFormat,
          isDirect: false,
          embedUrl: classified.originalUrl,
          error: (httpCode === 401 || httpCode === 403)
            ? 'O servidor recusou o acesso.'
            : (probe.message || 'Não foi possível carregar esta fonte.'),
          diagnostics: probe.diagnostics
        });
      }

      if (format === 'mp4' || format === 'm3u8' || format === 'hls' || format === 'dash' || format === 'webm') {
        return res.json({
          success: true,
          provider: 'Fonte Externa (Validação pendente)',
          sourceKind: probe.sourceKind,
          format,
          isDirect: true,
          directUrl: classified.originalUrl,
          embedUrl: classified.originalUrl,
          diagnostics: probe.diagnostics,
          note: probe.message
        });
      }

      return res.json({
        success: false,
        status: probe.status,
        sourceKind: probe.sourceKind,
        format: probe.detectedFormat,
        isDirect: false,
        embedUrl: classified.originalUrl,
        error: probe.message || 'Não foi possível carregar esta fonte. Verifica o endereço ou adiciona outra fonte.',
        diagnostics: probe.diagnostics
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Erro ao resolver fonte' });
    }
  });

  app.get('/api/v1/providers/config', requireAdmin, (req: Request, res: Response) => {
    const config = db.getProviderConfig();
    res.json({
      success: true,
      data: {
        uqloadApiKeyConfigured: !!(config.uqloadApiKey || process.env.UQLOAD_API_KEY),
        anonmp4ApiKeyConfigured: !!(config.anonmp4ApiKey || process.env.ANONMP4_API_KEY),
        uqloadApiKeyMasked: config.uqloadApiKey ? `${config.uqloadApiKey.substring(0, 4)}...${config.uqloadApiKey.slice(-4)}` : null,
        anonmp4ApiKeyMasked: config.anonmp4ApiKey ? `${config.anonmp4ApiKey.substring(0, 4)}...${config.anonmp4ApiKey.slice(-4)}` : null
      }
    });
  });

  app.post('/api/v1/providers/config', requireAdmin, (req: Request, res: Response) => {
    try {
      const { uqloadApiKey, anonmp4ApiKey } = req.body;
      const updated = db.updateProviderConfig({ uqloadApiKey, anonmp4ApiKey });
      db.addAuditLog((req as any).user?.email || 'admin', 'UPDATE_PROVIDER_CONFIG', 'SUCCESS', 'Configurações de chaves de provedores atualizadas');
      res.json({
        success: true,
        data: {
          uqloadApiKeyConfigured: !!(updated.uqloadApiKey || process.env.UQLOAD_API_KEY),
          anonmp4ApiKeyConfigured: !!(updated.anonmp4ApiKey || process.env.ANONMP4_API_KEY),
          uqloadApiKeyMasked: updated.uqloadApiKey ? `${updated.uqloadApiKey.substring(0, 4)}...${updated.uqloadApiKey.slice(-4)}` : null,
          anonmp4ApiKeyMasked: updated.anonmp4ApiKey ? `${updated.anonmp4ApiKey.substring(0, 4)}...${updated.anonmp4ApiKey.slice(-4)}` : null
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Erro ao salvar configurações' });
    }
  });

  app.post('/api/v1/providers/test-uqload', requireAdmin, async (req: Request, res: Response) => {
    try {
      const config = db.getProviderConfig();
      const apiKey = req.body.apiKey || config.uqloadApiKey || process.env.UQLOAD_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ success: false, error: 'Chave API UQLOAD não informada.' });
      }

      const apiRes = await fetch(`https://uqload.com/api/account/info?key=${encodeURIComponent(apiKey)}`, {
        signal: AbortSignal.timeout(5000)
      });

      if (!apiRes.ok) {
        return res.json({ success: false, error: `UQLOAD retornou status HTTP ${apiRes.status}` });
      }

      const data = await apiRes.json();
      if (data.status === 200) {
        return res.json({ success: true, message: 'Conexão com UQLOAD realizada com sucesso!', accountInfo: data.result });
      } else {
        return res.json({ success: false, error: data.msg || 'Chave API inválida ou conta sem acesso.' });
      }
    } catch (err: any) {
      res.json({ success: false, error: `Falha ao testar UQLOAD: ${err.message}` });
    }
  });


  // Background Automatic Sync Scheduler DISABLED (Strict manual import rule: all imports must be triggered explicitly by admin)
  // To sync an M3U source, the administrator must use the manual sync button in the M3U Importer tab.


  // Guard unknown /api/* routes so they return JSON 404 instead of SPA HTML
  app.use('/api/*', (req: Request, res: Response) => {
    res.status(404).json({ success: false, error: `Endpoint não encontrado: ${req.originalUrl}` });
  });

  // Dynamic Content-Security-Policy frame-ancestors enforcement for Embed / Official Player routes
  app.use(['/player', '/player/*', '/embed', '/embed/*'], (req: Request, res: Response, next: any) => {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const globalCfg = db.getApiGlobalSettings();
    if (token) {
      const verif = verifyPlaybackToken(token);
      if (verif.valid && verif.payload) {
        const appRecord = db.getDeveloperAppById(verif.payload.appId);
        const domains = appRecord ? appRecord.authorizedDomains : verif.payload.allowedDomains;
        if (domains && domains.length > 0 && !domains.includes('*')) {
          const ancestors = domains.flatMap(d => [`https://${d}`, `http://${d}`]);
          res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${ancestors.join(' ')}`);
        }
      }
    } else if (globalCfg.requireDomainForEmbed) {
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    }
    next();
  });

  // --- VITE / PRODUCTION STATIC FILE MIDDLEWARE ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`🎬 RONYCINE API Server rodando em http://${HOST}:${PORT}`);
  });

  const handleShutdown = () => {
    console.log('Encerrando servidor RONYFLIX API...');
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
}

startServer();
