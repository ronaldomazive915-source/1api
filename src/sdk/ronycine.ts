/**
 * RONYCINE API — SDK Oficial JavaScript / TypeScript
 * Módulo local compatível com Browser (fetch API) e Node.js 18+
 */

export interface RonycineConfig {
  apiKey?: string;
  baseURL?: string;
  timeoutMs?: number;
}

export interface CatalogQueryParams {
  page?: number;
  limit?: number;
  genero?: string;
  ano?: number;
  ordenar?: 'recent' | 'popular' | 'rating' | 'year' | 'title_asc';
  q?: string;
}

export interface ApiPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  total?: number;
  page?: number;
  totalPages?: number;
  pagination?: ApiPagination;
  error?: string;
  code?: string;
}

export interface PlaybackTokenRequest {
  contentId: number;
  type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  domain?: string;
  ttlSeconds?: number;
}

export interface PlaybackTokenResponse {
  token: string;
  expiresIn: number;
  expiresAt: string;
  contentId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  allowedDomains: string[];
  embedUrl: string;
}

export class RonycineError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'RonycineError';
    this.status = status;
    this.code = code;
  }
}

export class Ronycine {
  private apiKey?: string;
  private baseURL: string;
  private timeoutMs: number;

  constructor(config: RonycineConfig = {}) {
    this.apiKey = config.apiKey?.trim() || undefined;
    const defaultOrigin = 'https://ronycineapi.ai.studio';
    this.baseURL = (config.baseURL || defaultOrigin).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 15000;
  }

  public setApiKey(apiKey?: string) {
    this.apiKey = apiKey?.trim() || undefined;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {})
    };

    try {
      const response = await fetch(`${this.baseURL}${path}`, {
        ...init,
        headers: {
          ...headers,
          ...(init.headers as Record<string, string> | undefined)
        },
        signal: controller.signal
      });

      const payload = await response.json().catch(() => ({
        success: false,
        error: `Resposta inválida (HTTP ${response.status})`
      }));

      if (!response.ok || payload.success === false) {
        throw new RonycineError(
          payload.error || payload.message || `Erro HTTP ${response.status}`,
          response.status,
          payload.code
        );
      }

      return payload as ApiResponse<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildQuery(params: Record<string, unknown> = {}): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        qs.set(k, String(v));
      }
    }
    const str = qs.toString();
    return str ? `?${str}` : '';
  }

  public saude() {
    return this.request<{
      status: string;
      name: string;
      version: string;
      uptimeSeconds: number;
      database: string;
      catalog: { movies: number; series: number; episodes: number; total: number };
      authMode: string;
      timestamp: string;
    }>('/api/v1/saude');
  }

  public getFilmes(params: CatalogQueryParams = {}) {
    return this.request<any[]>(`/api/v1/filmes${this.buildQuery(params as Record<string, unknown>)}`);
  }

  public getFilme(tmdbId: number) {
    return this.request<any>(`/api/v1/filmes/${encodeURIComponent(String(tmdbId))}`);
  }

  public getSeries(params: CatalogQueryParams = {}) {
    return this.request<any[]>(`/api/v1/series${this.buildQuery(params as Record<string, unknown>)}`);
  }

  public getSerie(tmdbId: number) {
    return this.request<any>(`/api/v1/series/${encodeURIComponent(String(tmdbId))}`);
  }

  public getTemporada(tmdbId: number, season: number) {
    return this.request<any>(
      `/api/v1/series/${encodeURIComponent(String(tmdbId))}/temporadas/${encodeURIComponent(String(season))}`
    );
  }

  public getEpisodio(tmdbId: number, season: number, episode: number) {
    return this.request<any>(
      `/api/v1/series/${encodeURIComponent(String(tmdbId))}/temporadas/${encodeURIComponent(String(season))}/episodios/${encodeURIComponent(String(episode))}`
    );
  }

  public buscar(q: string, options: { tipo?: 'all' | 'movie' | 'tv'; page?: number; limit?: number } = {}) {
    return this.request<any[]>(
      `/api/v1/buscar${this.buildQuery({ q, ...options })}`
    );
  }

  public populares(options: { tipo?: 'all' | 'movie' | 'tv'; page?: number; limit?: number } = {}) {
    return this.request<any[]>(`/api/v1/populares${this.buildQuery(options)}`);
  }

  public recentes(options: { tipo?: 'all' | 'movie' | 'tv'; page?: number; limit?: number } = {}) {
    return this.request<any[]>(`/api/v1/recentes${this.buildQuery(options)}`);
  }

  public generos() {
    return this.request<Array<{ id: number | string; slug: string; name: string; count: number }>>('/api/v1/generos');
  }

  public getGenero(idOrSlug: string | number, options: { tipo?: 'all' | 'movie' | 'tv'; page?: number; limit?: number } = {}) {
    return this.request<any[]>(
      `/api/v1/generos/${encodeURIComponent(String(idOrSlug))}${this.buildQuery(options)}`
    );
  }

  public getFontes(
    contentId: number,
    options: { type?: 'movie' | 'tv'; season?: number; episode?: number } = {}
  ) {
    return this.request<any>(
      `/api/v1/fontes/${encodeURIComponent(String(contentId))}${this.buildQuery(options)}`
    );
  }

  public createPlayerToken(payload: PlaybackTokenRequest) {
    return this.request<PlaybackTokenResponse>('/api/v1/player/token', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public directPlayMovie(tmdbId: number) {
    return this.request<any>(`/api/v1/direct-play/movie/${encodeURIComponent(String(tmdbId))}`);
  }

  public directPlayEpisode(tmdbId: number, season: number, episode: number) {
    return this.request<any>(
      `/api/v1/direct-play/tv/${encodeURIComponent(String(tmdbId))}/${encodeURIComponent(String(season))}/${encodeURIComponent(String(episode))}`
    );
  }

  public getDirectPlayEmbedUrl(params: {
    tmdbId: number;
    type?: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): string {
    if (params.type === 'tv') {
      return `${this.baseURL}/embed/${params.tmdbId}/${params.season || 1}/${params.episode || 1}`;
    }
    return `${this.baseURL}/embed/${params.tmdbId}`;
  }

  public getPlayerEmbedUrl(params: {
    contentId: number;
    type?: 'movie' | 'tv';
    season?: number;
    episode?: number;
    token?: string;
  }): string {
    const type = params.type === 'tv' ? 'tv' : 'movie';
    const qs = new URLSearchParams({ type });
    if (type === 'tv') {
      qs.set('season', String(params.season || 1));
      qs.set('episode', String(params.episode || 1));
    }
    if (params.token) {
      qs.set('token', params.token);
    }
    return `${this.baseURL}/player/${params.contentId}?${qs.toString()}`;
  }
}

export default Ronycine;
