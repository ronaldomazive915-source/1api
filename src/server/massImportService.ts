import { db } from './database.js';
import { 
  ImportStatus, 
  MassImportOptions, 
  MassImportReport, 
  MassImportItemResult, 
  MediaItem 
} from '../types.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'd60f5b5a778fe74b5cf4a371f008725b';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export class MassImportService {
  private activeState: ImportStatus | null = null;
  private isRunning: boolean = false;
  private abortController: AbortController | null = null;
  private allQueueIds: number[] = [];
  private itemResults: MassImportItemResult[] = [];
  private memoryCache = new Map<string, { timestamp: number; data: any }>();
  private CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
  private speedTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Restore existing state from database on boot
    const saved = db.getMassImportState();
    if (saved) {
      this.activeState = saved;
      // If server rebooted while running/processing, put it in PAUSED state so progress isn't lost
      if (this.activeState.status === 'RUNNING' || this.activeState.status === 'PROCESSING' || this.activeState.status === 'QUEUED') {
        this.activeState.status = 'PAUSED';
        this.activeState.active = false;
        this.addLog('warn', 'Servidor reiniciado. Importação salva como PAUSADA para garantir integridade.');
        db.saveMassImportState(this.activeState);
      }
    }
  }

  public getState(): ImportStatus {
    if (!this.activeState) {
      return {
        status: 'IDLE',
        active: false,
        total: 0,
        processing: 0,
        success: 0,
        existing: 0,
        failures: 0,
        cancelled: false,
        duplicatesCount: 0,
        successesCount: 0,
        errorsCount: 0,
        notFoundCount: 0,
        ignoredCount: 0,
        elapsedTime: 0,
        speed: 0,
        estimatedTime: 0,
        logs: []
      };
    }
    return this.activeState;
  }

  private addLog(type: 'info' | 'success' | 'warn' | 'error', message: string) {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const logLine = `[${timestamp}] ${message}`;
    
    if (!this.activeState) return;
    if (!this.activeState.logs) this.activeState.logs = [];

    this.activeState.logs.push(logLine);
    if (this.activeState.logs.length > 250) {
      this.activeState.logs = this.activeState.logs.slice(-250);
    }
    this.activeState.lastUpdate = new Date().toISOString();
  }

  // Safe TMDB Fetcher with backoff, retry and rate-limit handling
  private async fetchTMDBWithRetry(
    endpoint: string, 
    params: Record<string, string> = {}, 
    retries = 3
  ): Promise<{ data: any | null; status: number; isRateLimit?: boolean }> {
    const cacheKey = `${endpoint}?${JSON.stringify(params)}`;
    if (this.activeState?.cacheEnabled) {
      const cached = this.memoryCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
        return { data: cached.data, status: 200 };
      }
    }

    const query = new URLSearchParams({
      api_key: TMDB_API_KEY,
      language: 'pt-BR',
      ...params
    });
    const url = `${TMDB_BASE_URL}${endpoint}?${query.toString()}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      if (this.activeState?.status !== 'PROCESSING' && this.activeState?.status !== 'RUNNING') {
        return { data: null, status: 0 };
      }

      try {
        const signal = this.abortController?.signal;
        const res = await fetch(url, { signal });

        if (res.status === 429) {
          // Rate limit detected
          this.activeState!.rateLimitWarning = true;
          this.addLog('warn', 'Limite temporário da API detectado (HTTP 429). Ajustando velocidade...');
          const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
          await new Promise(resolve => setTimeout(resolve, Math.max(retryAfter * 1000, 2000)));
          continue;
        }

        if (res.status === 404) {
          return { data: null, status: 404 };
        }

        if (!res.ok) {
          if (attempt === retries) {
            return { data: null, status: res.status };
          }
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, attempt * 600));
          continue;
        }

        const data = await res.json();
        if (this.activeState?.cacheEnabled) {
          this.memoryCache.set(cacheKey, { timestamp: Date.now(), data });
        }
        return { data, status: 200 };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return { data: null, status: 0 };
        }
        if (attempt === retries) {
          return { data: null, status: 500 };
        }
        await new Promise(resolve => setTimeout(resolve, attempt * 600));
      }
    }

    return { data: null, status: 500 };
  }

  // Format TMDB Payload into Playfilme MediaItem
  private formatMedia(raw: any, type: 'movie' | 'tv'): Partial<MediaItem> & { tmdbId: number; type: 'movie' | 'tv'; title: string } {
    const isMovie = type === 'movie';
    const title = isMovie ? (raw.title || raw.original_title) : (raw.name || raw.original_name);
    const releaseDate = isMovie ? raw.release_date : raw.first_air_date;

    const genres = raw.genres 
      ? raw.genres.map((g: any) => g.name)
      : (raw.genre_ids ? this.getGenreNamesByIds(raw.genre_ids, type) : []);

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
      title: title || `TMDB ${raw.id}`,
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
      trending: raw.popularity > 100,
      source: 'TMDB',
      published: true
    };
  }

  private getGenreNamesByIds(ids: number[], type: 'movie' | 'tv'): string[] {
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

  // Start or Create a Mass Import Task
  public async startMassImport(options: MassImportOptions): Promise<{ success: boolean; message: string; state: ImportStatus }> {
    if (this.activeState && (this.activeState.status === 'PROCESSING' || this.activeState.status === 'RUNNING')) {
      return { success: false, message: 'Já existe uma importação em andamento.', state: this.activeState };
    }

    let finalIds: number[] = [];

    // Mode 1: Direct IDs list provided
    if (options.ids && options.ids.length > 0) {
      // Remove duplicates and invalid IDs
      const uniqueSet = new Set<number>();
      for (const id of options.ids) {
        if (!isNaN(id) && id > 0) {
          uniqueSet.add(Math.floor(id));
        }
      }
      finalIds = Array.from(uniqueSet);
    } 
    // Mode 2: Popular pages requested
    else if (options.pagesCount && options.pagesCount > 0) {
      const type = options.contentType === 'tv' ? 'tv' : 'movie';
      this.addLog('info', `Carregando catálogo TMDB de páginas populares (${options.pagesCount} páginas)...`);
      
      for (let p = 1; p <= options.pagesCount; p++) {
        const endpoint = `/${type}/popular`;
        const res = await this.fetchTMDBWithRetry(endpoint, { page: p.toString() });
        if (res.data?.results) {
          for (const item of res.data.results) {
            if (item.id && !finalIds.includes(item.id)) {
              finalIds.push(item.id);
            }
          }
        }
      }
    }

    if (finalIds.length === 0) {
      return { success: false, message: 'Nenhum ID TMDB válido foi informado para importação.', state: this.getState() };
    }

    const opId = `imp_${Date.now()}`;
    const batchSize = Math.max(options.batchSize || 100, 10);
    const concurrency = Math.min(Math.max(options.concurrency || 6, 1), 12);
    const totalBatches = Math.ceil(finalIds.length / batchSize);

    this.allQueueIds = finalIds;
    this.itemResults = [];

    this.activeState = {
      operationId: opId,
      status: 'PROCESSING',
      active: true,
      total: finalIds.length,
      processing: 0,
      success: 0,
      existing: 0,
      failures: 0,
      cancelled: false,
      duplicatesCount: 0,
      successesCount: 0,
      errorsCount: 0,
      notFoundCount: 0,
      ignoredCount: 0,
      elapsedTime: 0,
      speed: 0,
      estimatedTime: 0,
      contentType: options.contentType || 'both',
      type: options.contentType === 'both' ? 'both' : options.contentType,
      batchSize,
      concurrency,
      cacheEnabled: options.cacheEnabled ?? true,
      totalBatches,
      currentBatch: 1,
      rateLimitWarning: false,
      startTime: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      logs: [],
      recentResults: []
    };

    this.addLog('info', `Iniciando importação em massa: ${finalIds.length} IDs únicos em ${totalBatches} lotes (Lote: ${batchSize}, Concorrência: ${concurrency}).`);
    db.saveMassImportState(this.activeState);

    // Launch worker loop asynchronously
    this.runWorkerLoop();

    return {
      success: true,
      message: `Importação de ${finalIds.length} IDs iniciada com sucesso.`,
      state: this.activeState
    };
  }

  // Worker Processing Loop
  private async runWorkerLoop() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();

    // Start Speed and ETA ticker
    if (this.speedTimer) clearInterval(this.speedTimer);
    this.speedTimer = setInterval(() => {
      if (!this.activeState || (this.activeState.status !== 'PROCESSING' && this.activeState.status !== 'RUNNING')) {
        if (this.speedTimer) clearInterval(this.speedTimer);
        return;
      }

      this.activeState.elapsedTime = (this.activeState.elapsedTime || 0) + 1;
      const processed = this.activeState.processing || 0;
      
      if (this.activeState.elapsedTime > 0) {
        this.activeState.speed = Number((processed / this.activeState.elapsedTime).toFixed(2));
        const remaining = Math.max(0, (this.activeState.total || 0) - processed);
        if (this.activeState.speed > 0) {
          this.activeState.estimatedTime = Math.ceil(remaining / this.activeState.speed);
        } else {
          this.activeState.estimatedTime = 0;
        }
      }

      db.saveMassImportState(this.activeState);
    }, 1000);

    try {
      const batchSize = this.activeState?.batchSize || 100;
      const concurrency = this.activeState?.concurrency || 6;
      const contentType = this.activeState?.contentType || 'both';

      const startIndex = this.activeState?.processing || 0;
      const total = this.allQueueIds.length;

      for (let i = startIndex; i < total; i += batchSize) {
        if (this.activeState?.status !== 'PROCESSING' && this.activeState?.status !== 'RUNNING') {
          break;
        }

        const batchNumber = Math.floor(i / batchSize) + 1;
        this.activeState.currentBatch = batchNumber;
        this.addLog('info', `Lote ${batchNumber}/${this.activeState.totalBatches} iniciado (IDs ${i + 1} a ${Math.min(i + batchSize, total)})...`);

        const batchSlice = this.allQueueIds.slice(i, i + batchSize);

        // Process batch in smaller concurrent chunks
        for (let j = 0; j < batchSlice.length; j += concurrency) {
          if (this.activeState?.status !== 'PROCESSING' && this.activeState?.status !== 'RUNNING') {
            break;
          }

          const chunk = batchSlice.slice(j, j + concurrency);
          
          await Promise.all(chunk.map(tmdbId => this.processSingleId(tmdbId, contentType)));

          // Small delay to keep network balanced
          await new Promise(resolve => setTimeout(resolve, 80));
        }

        this.addLog('info', `Lote ${batchNumber} concluído.`);
        db.saveMassImportState(this.activeState);
      }

      // Final status resolution
      if (this.activeState?.status === 'PROCESSING' || this.activeState?.status === 'RUNNING') {
        this.activeState.status = 'COMPLETED';
        this.activeState.active = false;
        this.activeState.completedAt = new Date().toISOString();

        const durationSec = this.activeState.elapsedTime || 0;
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        this.activeState.duration = `${mins}m ${secs}s`;

        this.addLog('success', `Importação concluída! Sucesso: ${this.activeState.successesCount}, Duplicados: ${this.activeState.duplicatesCount}, Não encontrados: ${this.activeState.notFoundCount}, Erros: ${this.activeState.errorsCount}`);

        // Save detailed report
        const report: MassImportReport = {
          id: `rep_${this.activeState.operationId}`,
          operationId: this.activeState.operationId || `imp_${Date.now()}`,
          title: `Importação em Massa #${this.activeState.operationId}`,
          contentType: this.activeState.contentType || 'both',
          total: this.activeState.total,
          successCount: this.activeState.successesCount || 0,
          duplicatesCount: this.activeState.duplicatesCount || 0,
          notFoundCount: this.activeState.notFoundCount || 0,
          errorsCount: this.activeState.errorsCount || 0,
          startedAt: this.activeState.startTime || new Date().toISOString(),
          completedAt: this.activeState.completedAt,
          duration: this.activeState.duration,
          status: 'COMPLETED',
          items: this.itemResults
        };

        db.addMassImportReport(report);
        db.addAuditLog(
          'ronaldomazive915@gmail.com',
          'IMPORT',
          'SUCCESS',
          `Importação em massa finalizada: ${report.successCount} novos, ${report.duplicatesCount} duplicados, ${report.errorsCount} erros.`
        );
      } else if (this.activeState?.status === 'PAUSED') {
        this.addLog('warn', 'Importação pausada pelo administrador.');
      } else if (this.activeState?.status === 'CANCELLING') {
        this.activeState.status = 'CANCELLED';
        this.activeState.active = false;
        this.activeState.cancelled = true;
        this.addLog('warn', 'Importação cancelada.');
      }

      if (this.activeState) {
        db.saveMassImportState(this.activeState);
      }
    } catch (err: any) {
      console.error('Critical Mass Import Engine Error:', err);
      if (this.activeState) {
        this.activeState.status = 'FAILED';
        this.activeState.active = false;
        this.addLog('error', `Falha crítica no processador: ${err.message || String(err)}`);
        db.saveMassImportState(this.activeState);
      }
    } finally {
      this.isRunning = false;
      if (this.speedTimer) clearInterval(this.speedTimer);
    }
  }

  // Single ID Processor with strict anti-duplication and type resolution
  private async processSingleId(tmdbId: number, preferredType: 'movie' | 'tv' | 'both'): Promise<void> {
    if (!this.activeState) return;

    this.activeState.currentTmdbId = tmdbId;
    this.activeState.processing = (this.activeState.processing || 0) + 1;

    // 1. Strict Anti-Duplication Check on DB
    // Check if it already exists as movie or tv
    const existingMovie = db.getMediaByTmdbAndType(tmdbId, 'movie');
    const existingTv = db.getMediaByTmdbAndType(tmdbId, 'tv');

    if (preferredType === 'movie' && existingMovie) {
      this.handleDuplicate(tmdbId, 'movie', existingMovie.title);
      return;
    }
    if (preferredType === 'tv' && existingTv) {
      this.handleDuplicate(tmdbId, 'tv', existingTv.title);
      return;
    }
    if (preferredType === 'both' && (existingMovie || existingTv)) {
      const existing = existingMovie || existingTv;
      const mediaType: 'movie' | 'tv' = existing!.type === 'tv' ? 'tv' : 'movie';
      this.handleDuplicate(tmdbId, mediaType, existing!.title);
      return;
    }

    // 2. Fetch from TMDB according to type configuration
    let finalType: 'movie' | 'tv' | null = null;
    let fetchedData: any = null;

    if (preferredType === 'movie') {
      const res = await this.fetchTMDBWithRetry(`/movie/${tmdbId}`, { append_to_response: 'credits,videos' });
      if (res.status === 200 && res.data) {
        finalType = 'movie';
        fetchedData = res.data;
      } else if (res.status === 404) {
        this.handleNotFound(tmdbId, 'movie');
        return;
      } else {
        this.handleError(tmdbId, 'movie', `HTTP ${res.status}`);
        return;
      }
    } else if (preferredType === 'tv') {
      const res = await this.fetchTMDBWithRetry(`/tv/${tmdbId}`, { append_to_response: 'credits,videos' });
      if (res.status === 200 && res.data) {
        finalType = 'tv';
        fetchedData = res.data;
      } else if (res.status === 404) {
        this.handleNotFound(tmdbId, 'tv');
        return;
      } else {
        this.handleError(tmdbId, 'tv', `HTTP ${res.status}`);
        return;
      }
    } else {
      // Type 'both': Auto-detect. Try Movie first, then TV fallback
      const movieRes = await this.fetchTMDBWithRetry(`/movie/${tmdbId}`, { append_to_response: 'credits,videos' });
      if (movieRes.status === 200 && movieRes.data && (movieRes.data.title || movieRes.data.original_title)) {
        finalType = 'movie';
        fetchedData = movieRes.data;
      } else {
        // Fallback to TV
        const tvRes = await this.fetchTMDBWithRetry(`/tv/${tmdbId}`, { append_to_response: 'credits,videos' });
        if (tvRes.status === 200 && tvRes.data && (tvRes.data.name || tvRes.data.original_name)) {
          finalType = 'tv';
          fetchedData = tvRes.data;
        } else if (movieRes.status === 404 && tvRes.status === 404) {
          this.handleNotFound(tmdbId, 'movie');
          return;
        } else {
          this.handleError(tmdbId, 'movie', 'Não encontrado em filmes nem séries');
          return;
        }
      }
    }

    if (!finalType || !fetchedData) {
      this.handleNotFound(tmdbId, 'movie');
      return;
    }

    // 3. Upsert into database
    try {
      const formatted = this.formatMedia(fetchedData, finalType);
      this.activeState.currentTitle = formatted.title;
      
      const { item, isNew } = db.upsertMediaItem(formatted);

      if (isNew) {
        this.activeState.successesCount = (this.activeState.successesCount || 0) + 1;
        this.activeState.success = (this.activeState.success || 0) + 1;
        this.addLog('success', `[SUCESSO] TMDB ${tmdbId} (${finalType.toUpperCase()}) importado: "${item.title}".`);
        
        const resultItem: MassImportItemResult = {
          tmdbId,
          type: finalType,
          title: item.title,
          status: 'SUCCESS',
          message: 'Importado com sucesso',
          timestamp: new Date().toISOString()
        };
        this.itemResults.push(resultItem);
        this.updateRecentResults(resultItem);
      } else {
        this.handleDuplicate(tmdbId, finalType, item.title);
      }
    } catch (upsertErr: any) {
      this.handleError(tmdbId, finalType, upsertErr.message);
    }
  }

  private handleDuplicate(tmdbId: number, type: 'movie' | 'tv', title: string) {
    if (!this.activeState) return;
    this.activeState.duplicatesCount = (this.activeState.duplicatesCount || 0) + 1;
    this.activeState.existing = (this.activeState.existing || 0) + 1;
    this.activeState.ignoredCount = (this.activeState.ignoredCount || 0) + 1;
    this.addLog('warn', `[DUPLICADO] TMDB ${tmdbId} "${title}" já existe no acervo. Ignorado.`);
    
    const resultItem: MassImportItemResult = {
      tmdbId,
      type,
      title,
      status: 'DUPLICATE',
      message: 'Já cadastrado no catálogo',
      timestamp: new Date().toISOString()
    };
    this.itemResults.push(resultItem);
    this.updateRecentResults(resultItem);
  }

  private handleNotFound(tmdbId: number, type: 'movie' | 'tv') {
    if (!this.activeState) return;
    this.activeState.notFoundCount = (this.activeState.notFoundCount || 0) + 1;
    this.activeState.failures = (this.activeState.failures || 0) + 1;
    this.addLog('warn', `[NÃO ENCONTRADO] TMDB ${tmdbId} não localizado na API.`);
    
    const resultItem: MassImportItemResult = {
      tmdbId,
      type,
      title: `TMDB ID ${tmdbId}`,
      status: 'NOT_FOUND',
      message: 'ID inexistente ou indisponível',
      timestamp: new Date().toISOString()
    };
    this.itemResults.push(resultItem);
    this.updateRecentResults(resultItem);
  }

  private handleError(tmdbId: number, type: 'movie' | 'tv', errorMsg: string) {
    if (!this.activeState) return;
    this.activeState.errorsCount = (this.activeState.errorsCount || 0) + 1;
    this.activeState.failures = (this.activeState.failures || 0) + 1;
    this.addLog('error', `[ERRO] Falha no TMDB ${tmdbId}: ${errorMsg}`);
    
    const resultItem: MassImportItemResult = {
      tmdbId,
      type,
      title: `TMDB ID ${tmdbId}`,
      status: 'ERROR',
      message: errorMsg,
      timestamp: new Date().toISOString()
    };
    this.itemResults.push(resultItem);
    this.updateRecentResults(resultItem);
  }

  private updateRecentResults(item: MassImportItemResult) {
    if (!this.activeState) return;
    if (!this.activeState.recentResults) this.activeState.recentResults = [];
    this.activeState.recentResults.unshift(item);
    if (this.activeState.recentResults.length > 50) {
      this.activeState.recentResults = this.activeState.recentResults.slice(0, 50);
    }
  }

  // Pause Active Task
  public pause(): { success: boolean; message: string; state: ImportStatus } {
    if (!this.activeState || (this.activeState.status !== 'PROCESSING' && this.activeState.status !== 'RUNNING')) {
      return { success: false, message: 'Nenhuma importação ativa para pausar.', state: this.getState() };
    }

    this.activeState.status = 'PAUSED';
    this.activeState.active = false;
    this.addLog('warn', 'Solicitação de pausa recebida. Fila pausada com segurança.');
    db.saveMassImportState(this.activeState);

    return { success: true, message: 'Importação pausada.', state: this.activeState };
  }

  // Resume Paused Task
  public resume(): { success: boolean; message: string; state: ImportStatus } {
    if (!this.activeState || this.activeState.status !== 'PAUSED') {
      return { success: false, message: 'Apenas importações pausadas podem ser retomadas.', state: this.getState() };
    }

    this.activeState.status = 'PROCESSING';
    this.activeState.active = true;
    this.addLog('info', `Retomando importação a partir do ID ${this.activeState.processing + 1}...`);
    db.saveMassImportState(this.activeState);

    this.runWorkerLoop();

    return { success: true, message: 'Importação retomada.', state: this.activeState };
  }

  // Cancel Active Task
  public cancel(): { success: boolean; message: string; state: ImportStatus } {
    if (!this.activeState || (this.activeState.status !== 'PROCESSING' && this.activeState.status !== 'RUNNING' && this.activeState.status !== 'PAUSED')) {
      return { success: false, message: 'Nenhuma operação para cancelar.', state: this.getState() };
    }

    this.activeState.status = 'CANCELLED';
    this.activeState.active = false;
    this.activeState.cancelled = true;

    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (e) {}
    }

    this.addLog('warn', 'Importação cancelada pelo administrador.');
    db.saveMassImportState(this.activeState);

    return { success: true, message: 'Importação cancelada com sucesso.', state: this.activeState };
  }

  // Retry Failed IDs from current task
  public retryErrors(): { success: boolean; message: string; state: ImportStatus } {
    if (!this.activeState) {
      return { success: false, message: 'Nenhuma tarefa para reprocessar.', state: this.getState() };
    }

    const failedIds = this.itemResults.filter(r => r.status === 'ERROR').map(r => r.tmdbId);
    if (failedIds.length === 0) {
      return { success: false, message: 'Nenhum erro registrado para reprocessar.', state: this.activeState };
    }

    return this.startMassImport({
      ids: failedIds,
      contentType: this.activeState.contentType || 'both',
      batchSize: this.activeState.batchSize || 100,
      concurrency: this.activeState.concurrency || 6,
      cacheEnabled: false
    }) as any;
  }

  // Clear/Reset Active State
  public clear(): { success: boolean; message: string; state: ImportStatus } {
    if (this.activeState && (this.activeState.status === 'PROCESSING' || this.activeState.status === 'RUNNING')) {
      return { success: false, message: 'Não é possível limpar durante o processamento ativo.', state: this.activeState };
    }

    this.activeState = {
      status: 'IDLE',
      active: false,
      total: 0,
      processing: 0,
      success: 0,
      existing: 0,
      failures: 0,
      cancelled: false,
      duplicatesCount: 0,
      successesCount: 0,
      errorsCount: 0,
      notFoundCount: 0,
      ignoredCount: 0,
      elapsedTime: 0,
      speed: 0,
      estimatedTime: 0,
      logs: []
    };

    this.allQueueIds = [];
    this.itemResults = [];
    db.saveMassImportState(this.activeState);

    return { success: true, message: 'Estado de importação resetado.', state: this.activeState };
  }

  // Generate Report Export Content
  public generateExport(reportId?: string, format: 'txt' | 'csv' | 'json' = 'txt'): { filename: string; mimeType: string; content: string } {
    let report: MassImportReport | null = null;
    
    if (reportId) {
      report = db.getMassImportReportById(reportId);
    }
    
    if (!report && this.activeState) {
      report = {
        id: `rep_${this.activeState.operationId}`,
        operationId: this.activeState.operationId || 'current',
        title: `Relatório de Importação #${this.activeState.operationId}`,
        contentType: this.activeState.contentType || 'both',
        total: this.activeState.total || 0,
        successCount: this.activeState.successesCount || 0,
        duplicatesCount: this.activeState.duplicatesCount || 0,
        notFoundCount: this.activeState.notFoundCount || 0,
        errorsCount: this.activeState.errorsCount || 0,
        startedAt: this.activeState.startTime || new Date().toISOString(),
        completedAt: this.activeState.completedAt || new Date().toISOString(),
        duration: this.activeState.duration || `${this.activeState.elapsedTime || 0}s`,
        status: this.activeState.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
        items: this.itemResults
      };
    }

    if (!report) {
      return {
        filename: 'relatorio_importacao.txt',
        mimeType: 'text/plain',
        content: 'Nenhum relatório encontrado.'
      };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'json') {
      return {
        filename: `iptv-import-report-${timestamp}.json`,
        mimeType: 'application/json',
        content: JSON.stringify(report, null, 2)
      };
    }

    if (format === 'csv') {
      let csv = 'TMDB ID,Tipo,Título,Status,Mensagem,Data/Hora\n';
      const items = report.items || [];
      for (const item of items) {
        const safeTitle = `"${(item.title || '').replace(/"/g, '""')}"`;
        const safeMsg = `"${(item.message || '').replace(/"/g, '""')}"`;
        csv += `${item.tmdbId},${item.type},${safeTitle},${item.status},${safeMsg},${item.timestamp}\n`;
      }
      return {
        filename: `iptv-import-report-${timestamp}.csv`,
        mimeType: 'text/csv',
        content: csv
      };
    }

    // Default: TXT
    let txt = `=====================================================\n`;
    txt += `  IPTV CENTRAL - RELATÓRIO DE IMPORTAÇÃO EM MASSA\n`;
    txt += `=====================================================\n\n`;
    txt += `Identificador: ${report.operationId}\n`;
    txt += `Status: ${report.status}\n`;
    txt += `Tipo de Conteúdo: ${report.contentType.toUpperCase()}\n`;
    txt += `Início: ${report.startedAt}\n`;
    txt += `Término: ${report.completedAt}\n`;
    txt += `Duração: ${report.duration}\n\n`;
    txt += `-----------------------------------------------------\n`;
    txt += `  RESUMO ESTATÍSTICO\n`;
    txt += `-----------------------------------------------------\n`;
    txt += `Total de IDs:        ${report.total}\n`;
    txt += `✓ Sucessos:          ${report.successCount}\n`;
    txt += `↻ Duplicados:        ${report.duplicatesCount}\n`;
    txt += `✕ Não Encontrados:   ${report.notFoundCount}\n`;
    txt += `⚠ Erros:             ${report.errorsCount}\n\n`;
    txt += `-----------------------------------------------------\n`;
    txt += `  ITENS PROCESSADOS (${(report.items || []).length})\n`;
    txt += `-----------------------------------------------------\n`;
    
    for (const item of (report.items || [])) {
      txt += `[${item.status}] TMDB ${item.tmdbId} (${item.type}) - ${item.title} | ${item.message || ''}\n`;
    }

    return {
      filename: `iptv-import-report-${timestamp}.txt`,
      mimeType: 'text/plain',
      content: txt
    };
  }
}

export const massImportService = new MassImportService();
