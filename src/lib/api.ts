import {
  MediaItem,
  PlayerSource,
  PlayerResolveResponse,
  AppSettings,
  CatalogResponse,
  SearchResults,
  CatalogStats,
  AuditLog,
  HistoryItem,
  WatchProgress,
  Episode,
  User,
  VideoSource,
  TmdbSearchResult,
  ImportHistoryItem,
  ImportStatus,
  MassImportOptions,
  SourceDiagnostics,
  SourceKind,
  SourceStatus,
  VideoFormatType,
  SeasonSourceTemplate,
  BatchEpisodeSourcesResult
} from '../types.js';

let adminEmail: string | null = null;
let adminToken: string | null = null;

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (options?.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      options.headers.forEach(([key, value]) => {
        headers[key] = value;
      });
    } else {
      Object.assign(headers, options.headers);
    }
  }

  if (adminEmail) headers['x-user-email'] = adminEmail;
  if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;

  const res = await fetch(url, {
    ...options,
    headers
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    if (isJson) {
      const errorBody = await res.json().catch(() => ({}));
      errorMsg = errorBody.message || errorBody.error || errorMsg;
    } else {
      const text = await res.text().catch(() => '');
      if (text.includes('<!doctype') || text.includes('<html')) {
        errorMsg = `HTTP ${res.status}: Servidor retornou HTML em vez de JSON (${url})`;
      } else {
        errorMsg = text || errorMsg;
      }
    }
    throw new Error(errorMsg);
  }

  if (!isJson) {
    const text = await res.text().catch(() => '');
    if (text.includes('<!doctype') || text.includes('<html')) {
      throw new Error(`Resposta inválida (HTML) recebida de ${url}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text as unknown as T;
    }
  }

  return res.json();
}

export const api = {
  // Catalog & Content
  async getCatalog(params?: { 
    type?: string; 
    genre?: string; 
    search?: string; 
    page?: number; 
    limit?: number;
    sort?: string;
    section?: string;
    source?: string;
    yearFrom?: number;
    yearTo?: number;
    minRating?: number;
    maxRating?: number;
    status?: string;
  }): Promise<CatalogResponse> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.genre) query.set('genre', params.genre);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sort) query.set('sort', params.sort);
    if (params?.section) query.set('section', params.section);
    if (params?.source) query.set('source', params.source);
    if (params?.yearFrom) query.set('yearFrom', String(params.yearFrom));
    if (params?.yearTo) query.set('yearTo', String(params.yearTo));
    if (params?.minRating) query.set('minRating', String(params.minRating));
    if (params?.maxRating) query.set('maxRating', String(params.maxRating));
    if (params?.status) query.set('status', params.status);
    return fetchJson<CatalogResponse>(`/api/catalog?${query.toString()}`);
  },

  async getAdminCatalog(
    params?: {
      type?: string;
      genre?: string;
      search?: string;
      page?: number;
      limit?: number;
      sort?: string;
      publishStatus?: string;
      status?: string;
      sourceStatus?: string;
      diagnostic?: string;
      source?: string;
      yearFrom?: number;
      yearTo?: number;
      minRating?: number;
      maxRating?: number;
    },
    signal?: AbortSignal
  ): Promise<CatalogResponse> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.genre) query.set('genre', params.genre);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sort) query.set('sort', params.sort);
    if (params?.publishStatus) query.set('publishStatus', params.publishStatus);
    if (params?.status) query.set('status', params.status);
    if (params?.sourceStatus) query.set('sourceStatus', params.sourceStatus);
    if (params?.diagnostic) query.set('diagnostic', params.diagnostic);
    if (params?.source) query.set('source', params.source);
    if (params?.yearFrom) query.set('yearFrom', String(params.yearFrom));
    if (params?.yearTo) query.set('yearTo', String(params.yearTo));
    if (params?.minRating !== undefined) query.set('minRating', String(params.minRating));
    if (params?.maxRating !== undefined) query.set('maxRating', String(params.maxRating));
    return fetchJson<CatalogResponse>(`/api/admin/catalog?${query.toString()}`, { signal });
  },

  async getAdminCatalogDetails(
    id: string,
    syncSeasons: boolean = false,
    season?: number
  ): Promise<{ item: MediaItem; sources: PlayerSource[]; diagnostic: any }> {
    const q = new URLSearchParams();
    if (syncSeasons) q.set('syncSeasons', 'true');
    if (season !== undefined) q.set('season', String(season));
    const qs = q.toString();
    return fetchJson<{ item: MediaItem; sources: PlayerSource[]; diagnostic: any }>(
      `/api/admin/catalog/${encodeURIComponent(id)}/details${qs ? `?${qs}` : ''}`
    );
  },

  async getMediaById(id: string): Promise<MediaItem> {
    return fetchJson<MediaItem>(`/api/catalog/${id}`);
  },

  async updateMediaItem(id: string, updates: Partial<MediaItem>): Promise<any> {
    return fetchJson<any>(`/api/admin/catalog/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async publishCatalogItem(id: string, published?: boolean): Promise<{ success: boolean; item: MediaItem; published: boolean; message: string }> {
    return fetchJson(`/api/admin/catalog/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ published })
    });
  },

  async restoreCatalogItem(id: string): Promise<{ success: boolean; item: MediaItem; message: string }> {
    return fetchJson(`/api/admin/catalog/${encodeURIComponent(id)}/restore`, {
      method: 'POST'
    });
  },

  async deleteCatalogItem(id: string, permanent: boolean = false): Promise<any> {
    return fetchJson<any>(`/api/admin/catalog/${encodeURIComponent(id)}${permanent ? '?permanent=true' : ''}`, {
      method: 'DELETE'
    });
  },

  async batchCatalogAction(action: string, ids: string[], positionOrOpts?: number | { position?: number; permanent?: boolean }): Promise<any> {
    const body =
      typeof positionOrOpts === 'number'
        ? { action, ids, position: positionOrOpts }
        : { action, ids, ...(positionOrOpts || {}) };
    return fetchJson<any>('/api/admin/catalog/batch', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  async diagnoseMediaItem(id: string): Promise<any> {
    return fetchJson<any>(`/api/admin/catalog/${encodeURIComponent(id)}/diagnose`);
  },

  async toggleTop10(id: string, position?: number): Promise<any> {
    return fetchJson<any>(`/api/admin/catalog/${encodeURIComponent(id)}/top10`, {
      method: 'POST',
      body: JSON.stringify({ position })
    });
  },

  async updateTmdbMedia(tmdbId: number, type: 'movie' | 'tv'): Promise<any> {
    return fetchJson<any>('/api/admin/tmdb/update', {
      method: 'POST',
      body: JSON.stringify({ tmdbId, type })
    });
  },

  async downloadAuthenticatedFile(url: string, fallbackFilename: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (adminEmail) headers['x-user-email'] = adminEmail;
    if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || errBody.error || `Falha ao exportar (HTTP ${res.status})`);
    }

    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || fallbackFilename;

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  },

  async exportCatalogFile(params: {
    format: 'csv' | 'json';
    type?: string;
    genre?: string;
    publishStatus?: string;
    status?: string;
    sourceStatus?: string;
    diagnostic?: string;
    source?: string;
    search?: string;
    yearFrom?: string;
    yearTo?: string;
    ids?: string[];
  }): Promise<void> {
    const q = new URLSearchParams();
    q.set('format', params.format);
    if (params.type) q.set('type', params.type);
    if (params.genre) q.set('genre', params.genre);
    if (params.publishStatus) q.set('publishStatus', params.publishStatus);
    if (params.status) q.set('status', params.status);
    if (params.sourceStatus) q.set('sourceStatus', params.sourceStatus);
    if (params.diagnostic) q.set('diagnostic', params.diagnostic);
    if (params.source) q.set('source', params.source);
    if (params.search) q.set('search', params.search);
    if (params.yearFrom) q.set('yearFrom', params.yearFrom);
    if (params.yearTo) q.set('yearTo', params.yearTo);
    if (params.ids && params.ids.length > 0) q.set('ids', params.ids.join(','));
    const prefix = params.type === 'movie' ? 'ronycine-filmes' : params.type === 'tv' ? 'ronycine-series' : 'ronycine-catalogo';
    await this.downloadAuthenticatedFile(`/api/admin/catalog/export?${q.toString()}`, `${prefix}.${params.format}`);
  },

  async getCategories(): Promise<any[]> {
    return fetchJson<any[]>('/api/categories');
  },

  // M3U Methods
  async getM3USyncStatus(): Promise<any> {
    return fetchJson<any>('/api/admin/m3u/status');
  },

  async getM3USources(): Promise<any[]> {
    return fetchJson<any[]>('/api/admin/m3u/sources');
  },

  async getM3USyncJobs(limit?: number): Promise<any[]> {
    return fetchJson<any[]>(`/api/admin/m3u/jobs${limit ? `?limit=${limit}` : ''}`);
  },

  async getM3USyncErrors(jobId?: string): Promise<any[]> {
    return fetchJson<any[]>(`/api/admin/m3u/errors${jobId ? `?jobId=${jobId}` : ''}`);
  },

  // Live TV Channels Methods
  async getTvChannels(): Promise<any[]> {
    return fetchJson<any[]>('/api/admin/live-channels');
  },

  async addTvChannel(channel: any): Promise<any> {
    return fetchJson<any>('/api/admin/live-channels', {
      method: 'POST',
      body: JSON.stringify(channel)
    });
  },

  async updateTvChannel(id: string, updates: any): Promise<any> {
    return fetchJson<any>(`/api/admin/live-channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async deleteTvChannel(id: string): Promise<any> {
    return fetchJson<any>(`/api/admin/live-channels/${id}`, {
      method: 'DELETE'
    });
  },

  async getFeaturedMedia(): Promise<MediaItem[]> {
    const res = await this.getCatalog({ section: 'featured', limit: 10 });
    return res.items;
  },

  // Official Player Endpoints (Used by EmbedView and HomeView)
  async getPlayerMovie(tmdbId: number): Promise<PlayerResolveResponse> {
    return fetchJson<PlayerResolveResponse>(`/api/watch/source?type=movie&tmdbId=${tmdbId}`);
  },

  async getPlayerTv(tmdbId: number, season: number, episode: number): Promise<PlayerResolveResponse> {
    return fetchJson<PlayerResolveResponse>(`/api/watch/source?type=tv&tmdbId=${tmdbId}&season=${season}&episode=${episode}`);
  },

  async getPlayerImdbMovie(imdbId: string): Promise<PlayerResolveResponse> {
    return fetchJson<PlayerResolveResponse>(`/api/watch/source?type=movie&imdbId=${imdbId}`);
  },

  async getPlayerImdbTv(imdbId: string, season: number, episode: number): Promise<PlayerResolveResponse> {
    return fetchJson<PlayerResolveResponse>(`/api/watch/source?type=tv&imdbId=${imdbId}&season=${season}&episode=${episode}`);
  },

  // RONYCINE Video Sources Management (Admin)
  async getVideoSources(params?: { contentId?: number; contentType?: string }): Promise<VideoSource[]> {
    const query = new URLSearchParams();
    if (params?.contentId) query.set('contentId', String(params.contentId));
    if (params?.contentType) query.set('contentType', params.contentType);
    return fetchJson<VideoSource[]>(`/api/admin/video-sources?${query.toString()}`);
  },

  async addVideoSource(source: Partial<VideoSource> & { replaceExisting?: boolean }): Promise<VideoSource> {
    return fetchJson<VideoSource>('/api/admin/video-sources', {
      method: 'POST',
      body: JSON.stringify(source)
    });
  },

  async updateVideoSource(id: string, updates: Partial<VideoSource>): Promise<VideoSource> {
    return fetchJson<VideoSource>(`/api/admin/video-sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  },

  async deleteVideoSource(id: string): Promise<{ success: boolean }> {
    return fetchJson<{ success: boolean }>(`/api/admin/video-sources/${id}`, {
      method: 'DELETE'
    });
  },

  async verifyVideoSource(id: string): Promise<VideoSource> {
    return fetchJson<VideoSource>(`/api/admin/video-sources/${id}/verify`, {
      method: 'POST'
    });
  },

  async verifyAllVideoSources(): Promise<{ success: boolean }> {
    return fetchJson<{ success: boolean }>('/api/admin/video-sources/verify-all', {
      method: 'POST'
    });
  },

  async getSeasonSourceTemplates(contentId?: number): Promise<{ success: boolean; templates: SeasonSourceTemplate[] }> {
    const q = contentId !== undefined ? `?contentId=${encodeURIComponent(String(contentId))}` : '';
    return fetchJson<{ success: boolean; templates: SeasonSourceTemplate[] }>(
      `/api/admin/video-sources/season-templates${q}`
    );
  },

  async saveSeasonSourceTemplate(
    template: Omit<SeasonSourceTemplate, 'updatedAt'>
  ): Promise<{ success: boolean; template: SeasonSourceTemplate }> {
    return fetchJson<{ success: boolean; template: SeasonSourceTemplate }>(
      '/api/admin/video-sources/season-templates',
      {
        method: 'POST',
        body: JSON.stringify(template)
      }
    );
  },

  async saveBatchEpisodeSources(payload: {
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
    return fetchJson<BatchEpisodeSourcesResult>('/api/admin/video-sources/batch-episodes', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // RONYCINE Provider Resolution & Config
  async verifySourceLink(url: string, format?: string): Promise<{
    success: boolean;
    accessible: boolean;
    status: SourceStatus;
    sourceKind: SourceKind;
    detectedFormat: VideoFormatType;
    originalUrl: string;
    finalUrl: string;
    message: string;
    diagnostics: SourceDiagnostics;
  }> {
    return fetchJson('/api/admin/sources/verify-link', {
      method: 'POST',
      body: JSON.stringify({ url, format })
    });
  },

  async verifyBatchSourceLinks(
    items: Array<{ episodeNumber: number; url: string }>
  ): Promise<{
    success: boolean;
    results: Array<{
      episodeNumber: number;
      url: string;
      probe: {
        success: boolean;
        accessible: boolean;
        status: SourceStatus;
        sourceKind?: SourceKind;
        detectedFormat?: VideoFormatType;
        message: string;
        diagnostics?: SourceDiagnostics;
      };
    }>;
  }> {
    return fetchJson('/api/admin/sources/verify-batch', {
      method: 'POST',
      body: JSON.stringify({ items })
    });
  },

  async resolveProviderSource(
    url: string,
    format?: string,
    signal?: AbortSignal
  ): Promise<{
    success: boolean;
    provider?: string;
    sourceKind?: SourceKind;
    format: string;
    isDirect: boolean;
    directUrl?: string;
    embedUrl: string;
    fileCode?: string;
    status?: SourceStatus | string;
    diagnostics?: SourceDiagnostics;
    note?: string;
    error?: string;
  }> {
    return fetchJson('/api/v1/providers/resolve', {
      method: 'POST',
      body: JSON.stringify({ url, format }),
      signal
    });
  },

  async getProviderConfig(): Promise<any> {
    return fetchJson('/api/v1/providers/config');
  },

  async updateProviderConfig(config: { uqloadApiKey?: string; anonmp4ApiKey?: string }): Promise<any> {
    return fetchJson('/api/v1/providers/config', {
      method: 'POST',
      body: JSON.stringify(config)
    });
  },

  async testUqloadKey(apiKey?: string): Promise<any> {
    return fetchJson('/api/v1/providers/test-uqload', {
      method: 'POST',
      body: JSON.stringify({ apiKey })
    });
  },

  // Player Sources Management (Legacy)
  async getPlayerSources(params?: { tmdbId?: number; type?: string }): Promise<PlayerSource[]> {
    const query = new URLSearchParams();
    if (params?.tmdbId) query.set('tmdbId', String(params.tmdbId));
    if (params?.type) query.set('type', params.type);
    return fetchJson<PlayerSource[]>(`/api/admin/player-sources?${query.toString()}`);
  },

  async testPlayerSourceUrl(url: string): Promise<{ success: boolean; accessible: boolean; format: string; message: string }> {
    return fetchJson<{ success: boolean; accessible: boolean; format: string; message: string }>('/api/admin/player-sources/test', {
      method: 'POST',
      body: JSON.stringify({ url })
    });
  },

  async addPlayerSource(source: Partial<PlayerSource>): Promise<{ success: boolean; source: PlayerSource }> {
    return fetchJson<{ success: boolean; source: PlayerSource }>('/api/admin/player-sources', {
      method: 'POST',
      body: JSON.stringify(source)
    });
  },

  async deletePlayerSource(id: string): Promise<{ success: boolean }> {
    return fetchJson<{ success: boolean }>(`/api/admin/player-sources/${id}`, {
      method: 'DELETE'
    });
  },

  // TMDB Importer Methods
  async getTmdbStatus(): Promise<{
    status: 'ONLINE' | 'OFFLINE' | 'CHAVE NÃO CONFIGURADA' | 'CHAVE INVÁLIDA' | 'VERIFICANDO';
    message: string;
    keyConfigured: boolean;
    maskedKey?: string;
    latencyMs?: number;
    timestamp: string;
  }> {
    return fetchJson('/api/admin/tmdb/status');
  },

  async testTmdbConnection(): Promise<{
    status: 'ONLINE' | 'OFFLINE' | 'CHAVE NÃO CONFIGURADA' | 'CHAVE INVÁLIDA' | 'VERIFICANDO';
    message: string;
    keyConfigured: boolean;
    maskedKey?: string;
    latencyMs?: number;
    timestamp: string;
  }> {
    return fetchJson('/api/admin/tmdb/test', { method: 'POST' });
  },

  async searchTmdb(query: string, type: string = 'all', signal?: AbortSignal): Promise<{ results: TmdbSearchResult[] }> {
    return fetchJson<{ results: TmdbSearchResult[] }>(`/api/admin/tmdb/search?q=${encodeURIComponent(query)}&type=${type}`, { signal });
  },

  async getTmdbList(params: { list: string; type?: string; period?: string; page?: number; refresh?: boolean }, signal?: AbortSignal): Promise<{ results: TmdbSearchResult[] }> {
    const q = new URLSearchParams({
      list: params.list,
      type: params.type || 'all',
      period: params.period || 'day',
      page: String(params.page || 1),
      refresh: params.refresh ? 'true' : 'false'
    });
    return fetchJson<{ results: TmdbSearchResult[] }>(`/api/admin/tmdb/list?${q.toString()}`, { signal });
  },

  async getTmdbDetails(tmdbId: number, type: 'movie' | 'tv', signal?: AbortSignal): Promise<{ item: MediaItem; existsInCatalog: boolean; existingMediaItem: MediaItem | null }> {
    return fetchJson(`/api/admin/tmdb/details?id=${tmdbId}&type=${type}`, { signal });
  },

  async importTmdbMedia(
    tmdbId: number,
    type: 'movie' | 'tv',
    forceUpdate: boolean = false,
    selectedEpisodes?: Array<{ seasonNumber: number; episodeNumber: number }>
  ): Promise<{ success: boolean; exists?: boolean; isNew?: boolean; item?: MediaItem; existingMediaItem?: MediaItem; message: string }> {
    return fetchJson('/api/admin/tmdb/import', {
      method: 'POST',
      body: JSON.stringify({ tmdbId, type, forceUpdate, selectedEpisodes })
    });
  },

  async getTmdbSeasonEpisodes(tmdbId: number, seasonNumber: number, signal?: AbortSignal): Promise<{ seasonNumber: number; name: string; overview: string; episodes: any[] }> {
    return fetchJson(`/api/admin/tmdb/series/${tmdbId}/season/${seasonNumber}`, { signal });
  },

  async getImportHistory(): Promise<ImportHistoryItem[]> {
    return fetchJson<ImportHistoryItem[]>('/api/admin/tmdb/history');
  },

  // Mass Import Methods
  async getMassImportStatus(): Promise<ImportStatus> {
    return fetchJson<ImportStatus>('/api/admin/mass-import/status');
  },

  async startMassImport(options: MassImportOptions): Promise<{ success: boolean; message: string; status: string }> {
    return fetchJson<{ success: boolean; message: string; status: string }>('/api/admin/mass-import', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  },

  async cancelMassImport(): Promise<{ success: boolean; message: string }> {
    return fetchJson<{ success: boolean; message: string }>('/api/admin/mass-import/cancel', {
      method: 'POST'
    });
  },



  // Recovery Management Methods
  async getRecoveryStats(): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/stats');
  },
  async getRecoveryLogs(): Promise<any[]> {
    // server.ts doesn't have this yet, but expected by RecoveryCenterView
    return [];
  },

  async getRecoveryReports(): Promise<any[]> {
    return fetchJson<any[]>('/api/admin/recovery/reports');
  },

  async executeSmartRestore(): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/smart-restore', {
      method: 'POST'
    });
  },

  async recoverMovieByTmdb(tmdbId: number): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/recover-movie', {
      method: 'POST',
      body: JSON.stringify({ tmdbId })
    });
  },

  async recoverSeriesByTmdb(tmdbId: number): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/recover-series', {
      method: 'POST',
      body: JSON.stringify({ tmdbId })
    });
  },

  async startBatchRecovery(options: any): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/start-batch', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  },

  async pauseBatchRecovery(): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/pause-batch', {
      method: 'POST'
    });
  },

  async resumeBatchRecovery(): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/resume-batch', {
      method: 'POST'
    });
  },

  async stopBatchRecovery(): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/stop-batch', {
      method: 'POST'
    });
  },

  async diagTmdb(): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/diag/tmdb');
  },

  async diagDb(): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/diag/db');
  },

  async restoreBackup(items: any[]): Promise<any> {
    return fetchJson<any>('/api/admin/recovery/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ items })
    });
  },

  async clearRecoveryLogs(): Promise<any> {
    // server.ts doesn't have this yet
    return { success: true };
  },



  // M3U Importer Management Methods
  async getAdminLiveChannels(): Promise<any[]> {
    return fetchJson<any[]>('/api/admin/live-channels');
  },

  async testM3UConnection(data: any): Promise<any> {
    return fetchJson<any>('/api/admin/m3u/test', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async triggerM3USync(sourceId?: string): Promise<any> {
    return fetchJson<any>('/api/admin/m3u/sync', {
      method: 'POST',
      body: JSON.stringify({ sourceId })
    });
  },

  async cancelM3USync(jobId: string): Promise<any> {
    return fetchJson<any>('/api/admin/m3u/cancel', {
      method: 'POST',
      body: JSON.stringify({ jobId })
    });
  },

  async updateM3USource(id: string, updates: any): Promise<any> {
    return fetchJson<any>(`/api/admin/m3u/sources/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async removeM3UUnavailableItems(): Promise<any> {
    return fetchJson<any>('/api/admin/m3u/remove-unavailable', {
      method: 'POST'
    });
  },

  // Mass Import Extended Methods
  async getMassImportHistory(): Promise<any[]> {
    return fetchJson<any[]>('/api/admin/mass-import/history');
  },

  async pauseMassImport(): Promise<any> {
    return fetchJson<any>('/api/admin/mass-import/pause', {
      method: 'POST'
    });
  },

  async resumeMassImport(): Promise<any> {
    return fetchJson<any>('/api/admin/mass-import/resume', {
      method: 'POST'
    });
  },

  async retryMassImportErrors(): Promise<any> {
    return fetchJson<any>('/api/admin/mass-import/retry-errors', {
      method: 'POST'
    });
  },

  async clearMassImport(): Promise<any> {
    return fetchJson<any>('/api/admin/mass-import/clear', {
      method: 'POST'
    });
  },

  getMassImportExportUrl(reportId?: string, format: string = 'txt'): string {
    const q = new URLSearchParams();
    if (reportId) q.set('reportId', reportId);
    q.set('format', format);
    return `/api/admin/mass-import/export?${q.toString()}`;
  },

  async exportMassImportFile(reportId?: string, format: 'txt' | 'csv' | 'json' = 'txt'): Promise<void> {
    const url = this.getMassImportExportUrl(reportId, format);
    await this.downloadAuthenticatedFile(url, `ronycine-importacao.${format}`);
  },

  // RONYCINE API V1 (Public)
  async getV1Filmes(): Promise<{ success: boolean; count: number; data: MediaItem[] }> {
    return fetchJson<{ success: boolean; count: number; data: MediaItem[] }>('/api/v1/filmes');
  },

  async getV1FilmeDetails(tmdbId: number): Promise<{ success: boolean; data: MediaItem & { sources: VideoSource[] } }> {
    return fetchJson<{ success: boolean; data: MediaItem & { sources: VideoSource[] } }>(`/api/v1/filmes/${tmdbId}`);
  },

  async getV1Series(): Promise<{ success: boolean; count: number; data: MediaItem[] }> {
    return fetchJson<{ success: boolean; count: number; data: MediaItem[] }>('/api/v1/series');
  },

  async getV1SeriesDetails(tmdbId: number): Promise<{ success: boolean; data: MediaItem }> {
    return fetchJson<{ success: boolean; data: MediaItem }>(`/api/v1/series/${tmdbId}`);
  },

  async getV1EpisodeSources(tmdbId: number, season: number, episode: number): Promise<{ success: boolean; data: { tmdbId: number; season: number; episode: number; sources: VideoSource[] } }> {
    return fetchJson<{ success: boolean; data: { tmdbId: number; season: number; episode: number; sources: VideoSource[] } }>(`/api/v1/series/${tmdbId}/temporadas/${season}/episodios/${episode}`);
  },

  async getV1Lista(tipo: 'filmes' | 'series'): Promise<{ success: boolean; type: string; count: number; data: MediaItem[] }> {
    return fetchJson<{ success: boolean; type: string; count: number; data: MediaItem[] }>(`/api/v1/lista?tipo=${tipo}`);
  },

  // RONYCINE DIRECT PLAY
  async getDirectPlay(params: {
    tmdbId: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    apiKey?: string;
  }): Promise<{
    success: boolean;
    state: 'READY' | 'CONTENT_NOT_FOUND' | 'NO_SOURCE_AVAILABLE' | 'SOURCE_UNAVAILABLE' | 'INVALID_PARAMS';
    code: string;
    tmdbId: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    watchPath: string;
    message: string;
    content: any;
    source: any;
    sources: any[];
    alternativeSources?: any[];
    nextEpisode?: { available: boolean; season: number; episode: number };
    httpStatus?: number;
  }> {
    const cleanType = params.type === 'tv' ? 'tv' : 'movie';
    const url =
      cleanType === 'tv' && params.season !== undefined && params.episode !== undefined
        ? `/api/v1/direct-play/tv/${params.tmdbId}/${params.season}/${params.episode}`
        : `/api/v1/direct-play/${cleanType}/${params.tmdbId}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (params.apiKey?.trim()) headers['x-api-key'] = params.apiKey.trim();
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => ({
      success: false,
      state: res.status === 404 ? 'CONTENT_NOT_FOUND' : 'SOURCE_UNAVAILABLE',
      code: res.status === 404 ? 'CONTENT_NOT_FOUND' : 'HTTP_ERROR',
      message:
        res.status === 404
          ? 'Conteúdo não encontrado na RONYCINE API.'
          : 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.',
      sources: []
    }));
    return { ...data, httpStatus: res.status };
  },

  async checkDirectPlayAvailability(params: {
    tmdbId: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    sourceId?: string;
  }): Promise<any> {
    return fetchJson<any>('/api/v1/direct-play/check-availability', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  // Legacy / Server resolution
  async resolvePlaybackStream(params: { tmdbId: number; type: 'movie' | 'tv'; season?: number; episode?: number; language?: string; player?: string }) {
    const query = new URLSearchParams({
      tmdbId: String(params.tmdbId),
      type: params.type
    });
    if (params.season) query.set('season', String(params.season));
    if (params.episode) query.set('episode', String(params.episode));
    if (params.language) query.set('language', params.language);
    if (params.player) query.set('player', params.player);
    return fetchJson<any>(`/api/watch/source?${query.toString()}`);
  },

  // App Settings
  async getSettings(): Promise<AppSettings> {
    return fetchJson<AppSettings>('/api/admin/settings').catch(() => ({
      heroRotationInterval: 30,
      catalogGuardEnabled: true,
      minCatalogThreshold: 5
    } as AppSettings));
  },

  async updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    return fetchJson<AppSettings>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  // Admin Stats & Logs
  async getAdminStats(): Promise<CatalogStats> {
    return fetchJson<CatalogStats>('/api/admin/stats').catch(() => ({
      totalMovies: 0,
      totalSeries: 0,
      totalSeasons: 0,
      totalEpisodes: 0,
      totalUsers: 0,
      totalViews: 0
    }));
  },

  async getAdminLogs(): Promise<AuditLog[]> {
    return fetchJson<AuditLog[]>('/api/admin/logs').catch(() => []);
  },

  async getAdminUsers(): Promise<User[]> {
    return fetchJson<User[]>('/api/admin/users');
  },

  // History & Progress
  async getHistory(userId: string): Promise<HistoryItem[]> {
    return fetchJson<HistoryItem[]>(`/api/history/${userId}`).catch(() => []);
  },

  async clearHistory(userId: string): Promise<{ success: boolean }> {
    return fetchJson<{ success: boolean }>(`/api/history/${userId}`, {
      method: 'DELETE'
    });
  },

  async getProgressList(userId: string): Promise<WatchProgress[]> {
    return fetchJson<WatchProgress[]>(`/api/progress/${userId}`).catch(() => []);
  },

  async saveWatchProgress(userId: string, progress: Partial<WatchProgress>): Promise<{ success: boolean }> {
    return fetchJson<{ success: boolean }>('/api/progress', {
      method: 'POST',
      body: JSON.stringify({ userId, ...progress })
    });
  },

  // Search
  async searchMedia(query: string, type: string = 'all'): Promise<SearchResults> {
    const q = new URLSearchParams({ q: query, type });
    return fetchJson<SearchResults>(`/api/search?${q.toString()}`);
  },

  async search(query: string, type: string = 'all'): Promise<SearchResults> {
    return this.searchMedia(query, type);
  },

  // Utils
  async getSeasonEpisodes(tmdbId: number, season: number): Promise<{ seasonNumber: number; episodes: Episode[] }> {
    const id = `tv-${tmdbId}`;
    return fetchJson<{ seasonNumber: number; episodes: Episode[] }>(`/api/catalog/${id}/season/${season}`);
  },
  
  // Authentication & Users
  async login(email: string, password: string): Promise<{ success: boolean; user: User; token: string }> {
    return fetchJson<{ success: boolean; user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  },

  async register(name: string, email: string, password: string): Promise<{ success: boolean; user: User; token: string }> {
    return fetchJson<{ success: boolean; user: User; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
  },

  async adminLogin(email: string, password: string, securityCode: string): Promise<{ success: boolean; user: User; token: string }> {
    return fetchJson<{ success: boolean; user: User; token: string }>('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({ email, password, securityCode })
    });
  },

  async googleAuth(data: { email: string; name?: string; avatar?: string; uid?: string }): Promise<{ success: boolean; user: User; token: string }> {
    return fetchJson<{ success: boolean; user: User; token: string }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getMe(): Promise<{ success: boolean; user: User }> {
    return fetchJson<{ success: boolean; user: User }>('/api/auth/me');
  },

  async logout(): Promise<{ success: boolean }> {
    return fetchJson<{ success: boolean }>('/api/auth/logout', { method: 'POST' });
  },

  async updateUserProfile(updates: { name?: string; avatar?: string }): Promise<{ success: boolean; user: User }> {
    return fetchJson<{ success: boolean; user: User }>('/api/user/profile', {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async getV1Plans(): Promise<{ success: boolean; data: any[] }> {
    return fetchJson<{ success: boolean; data: any[] }>('/api/v1/plans');
  },

  // Official Player Session & Events
  async getPlayerSession(params: {
    contentId: number | string;
    type?: 'movie' | 'tv' | string;
    season?: number;
    episode?: number;
    token?: string | null;
  }): Promise<PlayerResolveResponse & { tokenVerified?: boolean; appName?: string; code?: string }> {
    const q = new URLSearchParams();
    if (params.type) q.set('type', params.type === 'series' ? 'tv' : params.type);
    if (params.season) q.set('season', String(params.season));
    if (params.episode) q.set('episode', String(params.episode));
    if (params.token) q.set('token', params.token);
    const qs = q.toString();
    return fetchJson(`/api/player/${encodeURIComponent(String(params.contentId))}/session${qs ? `?${qs}` : ''}`);
  },

  async reportPlayerEvent(payload: {
    contentId: number;
    mediaType: 'movie' | 'tv';
    season?: number;
    episode?: number;
    status: 'STARTED' | 'ERROR' | 'DENIED';
    errorMessage?: string;
    sourceType?: string;
    sourceUrl?: string;
  }): Promise<void> {
    await fetch('/api/player/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  },

  // Developer Portal (Self-Service)
  async getDeveloperOverview(): Promise<any> {
    return fetchJson('/api/developer/overview');
  },

  async getDeveloperApps(): Promise<{ success: boolean; apps: any[] }> {
    return fetchJson('/api/developer/apps');
  },

  async createDeveloperApp(payload: { name: string; description?: string; authorizedDomains?: string[] }): Promise<{
    success: boolean;
    app: any;
    initialKey: any;
    plaintextKey: string;
  }> {
    return fetchJson('/api/developer/apps', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async updateDeveloperApp(id: string, payload: { name?: string; description?: string; authorizedDomains?: string[] }): Promise<{ success: boolean; app: any }> {
    return fetchJson(`/api/developer/apps/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  async deleteDeveloperApp(id: string): Promise<{ success: boolean }> {
    return fetchJson(`/api/developer/apps/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async getDeveloperKeys(): Promise<{ success: boolean; keys: any[] }> {
    return fetchJson('/api/developer/keys');
  },

  async createDeveloperKey(appId: string, name: string): Promise<{ success: boolean; key: any; plaintextKey: string }> {
    return fetchJson('/api/developer/keys', {
      method: 'POST',
      body: JSON.stringify({ appId, name })
    });
  },

  async revokeDeveloperKey(keyId: string): Promise<{ success: boolean; key: any }> {
    return fetchJson(`/api/developer/keys/${encodeURIComponent(keyId)}/revoke`, { method: 'POST' });
  },

  async regenerateDeveloperKey(keyId: string): Promise<{ success: boolean; key: any; plaintextKey: string }> {
    return fetchJson(`/api/developer/keys/${encodeURIComponent(keyId)}/regenerate`, { method: 'POST' });
  },

  async getDeveloperStats(): Promise<{ success: boolean; stats: any }> {
    return fetchJson('/api/developer/stats');
  },

  // Admin Developer Platform & Monitoring
  async getAdminDevelopers(): Promise<{ success: boolean; apps: any[]; keys: any[]; developersCount: number; usersCount: number }> {
    return fetchJson('/api/admin/developers');
  },

  async updateAdminDeveloperApp(id: string, updates: { status?: 'ACTIVE' | 'SUSPENDED'; plan?: string }): Promise<{ success: boolean; app: any }> {
    return fetchJson(`/api/admin/developer-apps/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  },

  async revokeAdminApiKey(keyId: string): Promise<{ success: boolean; key: any }> {
    return fetchJson(`/api/admin/api-keys/${encodeURIComponent(keyId)}/revoke`, { method: 'POST' });
  },

  async getAdminMonitoring(): Promise<{ success: boolean; monitoring: any; settings: any }> {
    return fetchJson('/api/admin/monitoring');
  },

  async updateAdminApiConfig(settings: any): Promise<{ success: boolean; settings: any }> {
    return fetchJson('/api/admin/api-config', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  async getAdminPlans(): Promise<{ success: boolean; plans: Record<string, any> }> {
    return fetchJson('/api/admin/plans');
  },

  async updateAdminPlan(tier: string, updates: any): Promise<{ success: boolean; plan: any }> {
    return fetchJson(`/api/admin/plans/${encodeURIComponent(tier)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async getAdminPlayerStats(): Promise<{ success: boolean; stats: any; settings: any }> {
    return fetchJson('/api/admin/player-stats');
  },

  // Backup Center & Trash
  async getAdminBackups(): Promise<{ success: boolean; backups: any[] }> {
    return fetchJson('/api/admin/backups');
  },

  async createAdminBackup(payload: { categories: string[]; type: 'manual' | 'automatic' }): Promise<{ success: boolean; backup: any }> {
    return fetchJson('/api/admin/backups', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async restoreAdminBackup(id: string): Promise<{ success: boolean; report: any }> {
    return fetchJson(`/api/admin/backups/${encodeURIComponent(id)}/restore`, {
      method: 'POST'
    });
  },

  async deleteAdminBackup(id: string): Promise<{ success: boolean }> {
    return fetchJson(`/api/admin/backups/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  async getAdminTrash(): Promise<any[]> {
    return fetchJson('/api/admin/trash');
  },

  async restoreAdminTrashItem(id: string): Promise<{ success: boolean }> {
    return fetchJson(`/api/admin/trash/${encodeURIComponent(id)}/restore`, {
      method: 'POST'
    });
  },

  async deletePermanentTrashItem(id: string): Promise<{ success: boolean }> {
    return fetchJson(`/api/admin/trash/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  setAdminCredentials(email: string | null, token: string | null) {
    adminEmail = email;
    adminToken = token;
  }
};


