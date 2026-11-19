import { db } from './database.js';
import { MediaItem, MediaType, RecoveryIssue, RecoveryState, RecoveryReportItem, TmdbDiagResult, DbDiagResult } from '../types.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '15d2ea6d0dc1d476efbca3eba2b9bbfb';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

class RecoveryService {
  private isProcessing = false;
  private isPaused = false;
  private stopRequested = false;
  private currentAbortController: AbortController | null = null;

  constructor() {
    const state = db.getRecoveryState();
    if (state.status === 'RUNNING') {
      // Mark as PAUSED on startup so user can resume if desired
      db.updateRecoveryState({ status: 'PAUSED' });
    }
  }

  // --- TMDB Helper ---
  private async fetchTMDB(endpoint: string, params: Record<string, string> = {}): Promise<any | null> {
    try {
      const query = new URLSearchParams({
        api_key: TMDB_API_KEY,
        language: 'pt-BR',
        ...params
      });
      const url = `${TMDB_BASE_URL}${endpoint}?${query.toString()}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (err) {
      return null;
    }
  }

  // --- Diagnostic Tools ---
  public async testTmdbConnection(): Promise<TmdbDiagResult> {
    const start = Date.now();
    try {
      const data = await this.fetchTMDB('/configuration');
      const latencyMs = Date.now() - start;

      if (data && data.images) {
        const msg = `API TMDB conectada com sucesso em ${latencyMs}ms.`;
        db.addActivityLog('success', `✓ Conexão TMDB estabelecida (${latencyMs}ms)`);
        return {
          ok: true,
          latencyMs,
          statusText: '200 OK',
          rateLimit: '40 req/s (Standard)',
          tmdbKeyPresent: Boolean(TMDB_API_KEY),
          message: msg
        };
      } else {
        const msg = 'TMDB respondeu com erro ou chave de API inválida.';
        db.addActivityLog('error', `✕ Falha ao conectar ao TMDB (${latencyMs}ms)`);
        return {
          ok: false,
          latencyMs,
          statusText: 'Invalid Response',
          tmdbKeyPresent: Boolean(TMDB_API_KEY),
          message: msg
        };
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const msg = `Erro de rede ao conectar ao TMDB: ${err?.message || 'Timeout'}`;
      db.addActivityLog('error', `✕ Erro TMDB: ${msg}`);
      return {
        ok: false,
        latencyMs,
        statusText: 'Connection Error',
        tmdbKeyPresent: Boolean(TMDB_API_KEY),
        message: msg
      };
    }
  }

  public async testDbConnection(): Promise<DbDiagResult> {
    const start = Date.now();
    try {
      // 1. Test Read
      const stats = db.getRecoveryStatsData();
      const readOk = stats.totalCatalog >= 0;

      // 2. Test Write
      db.addActivityLog('info', '✓ Teste de integridade do banco de dados executado.');
      const writeOk = true;

      const latencyMs = Date.now() - start;
      const msg = `Banco de dados local operacional: ${stats.totalCatalog} itens registrados (${latencyMs}ms).`;
      db.addActivityLog('success', `✓ Banco conectado (${stats.totalCatalog} registros, ${latencyMs}ms)`);

      return {
        ok: readOk && writeOk,
        latencyMs,
        readOk,
        writeOk,
        totalItems: stats.totalCatalog,
        storageType: 'JSON_PERSISTENT_STORE',
        message: msg
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      db.addActivityLog('error', `✕ Falha no teste do banco: ${err?.message}`);
      return {
        ok: false,
        latencyMs,
        readOk: false,
        writeOk: false,
        totalItems: 0,
        storageType: 'JSON_PERSISTENT_STORE',
        message: `Falha ao acessar armazenamento: ${err?.message}`
      };
    }
  }

  // --- Catalog Analysis ---
  public async analyzeCatalog(): Promise<RecoveryIssue[]> {
    const catalog = db.getCatalog({ limit: Number.MAX_SAFE_INTEGER }).items;
    const issues: RecoveryIssue[] = [];
    const now = new Date().toISOString();

    db.addActivityLog('info', '✓ Verificando catálogo para diagnóstico completo...');
    db.updateRecoveryState({ status: 'ANALYZING', processedItems: 0, totalItems: catalog.length });

    for (const item of catalog) {
      const itemIssues = this.diagnoseItem(item);
      if (itemIssues.length > 0) {
        itemIssues.forEach(prob => {
          issues.push({
            id: `issue-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
            mediaId: item.id,
            tmdbId: item.tmdbId,
            type: item.type,
            title: item.title,
            problem: prob.msg,
            message: prob.msg,
            severity: prob.severity,
            detectedAt: now
          });
        });
      }
    }

    // Check for duplicates
    const duplicates = db.findDuplicates();
    duplicates.forEach(dup => {
      issues.push({
        id: `issue-dup-${dup.tmdbId}-${dup.type}`,
        mediaId: dup.items[0].id,
        tmdbId: dup.tmdbId,
        type: dup.type,
        title: dup.items[0].title,
        problem: `Registros duplicados encontrados (${dup.count} instâncias)`,
        message: `Registros duplicados encontrados (${dup.count} instâncias)`,
        severity: 'medium',
        detectedAt: now
      });
      db.addActivityLog('warn', `⚠ Conteúdo duplicado identificado: ${dup.items[0].title} (TMDB ID: ${dup.tmdbId})`);
    });

    db.setRecoveryIssues(issues);
    db.updateRecoveryState({ status: 'IDLE', issuesFound: issues.length });
    db.addActivityLog('success', `✓ Diagnóstico finalizado: ${catalog.length} itens analisados, ${issues.length} apontamentos.`);

    return issues;
  }

  public diagnoseItem(item: MediaItem): { msg: string; severity: 'high' | 'medium' | 'low' }[] {
    const issues: { msg: string; severity: 'high' | 'medium' | 'low' }[] = [];

    if (!item.tmdbId || item.tmdbId <= 0) issues.push({ msg: 'ID TMDB ausente ou inválido', severity: 'high' });
    if (!item.posterPath || item.posterPath.length < 5) issues.push({ msg: 'Poster/capa ausente', severity: 'medium' });
    if (!item.backdropPath || item.backdropPath.length < 5) issues.push({ msg: 'Backdrop ausente', severity: 'low' });
    if (!item.overview || item.overview.trim().length < 20) issues.push({ msg: 'Sinopse incompleta ou ausente', severity: 'medium' });
    if (!item.genres || item.genres.length === 0) issues.push({ msg: 'Gêneros ausentes', severity: 'low' });
    if (item.published === false) issues.push({ msg: 'Marcado como NÃO PUBLICADO', severity: 'medium' });

    if (item.type === 'tv') {
      const hasSeasons = item.seasons && item.seasons.length > 0;
      if (!hasSeasons && (item.seasonsCount || 0) > 0) {
        issues.push({ msg: 'Estrutura de temporadas corrompida ou ausente', severity: 'high' });
      }
    }

    return issues;
  }

  // --- Smart Restoration ---
  public async executeSmartRestore(adminEmail: string): Promise<RecoveryReportItem> {
    if (this.isProcessing) {
      throw new Error('Uma operação de recuperação já está em andamento.');
    }

    this.isProcessing = true;
    const startTime = Date.now();
    const catalog = db.getCatalog({ limit: Number.MAX_SAFE_INTEGER }).items;

    db.addActivityLog('info', '✓ TMDB conectado. Iniciando Restauração Inteligente...');
    db.addActivityLog('info', `✓ Verificando catálogo (${catalog.length} títulos)...`);

    db.updateRecoveryState({
      status: 'RUNNING',
      totalItems: catalog.length,
      processedItems: 0,
      successCount: 0,
      errorCount: 0,
      ignoredCount: 0,
      startTime: new Date().toISOString(),
      currentAction: 'Restauração Inteligente'
    });

    let added = 0;
    let updated = 0;
    let ignored = 0;
    let duplicates = 0;
    let errors = 0;
    const details: string[] = [];

    // Check duplicates first
    const dups = db.findDuplicates();
    duplicates = dups.reduce((acc, curr) => acc + (curr.count - 1), 0);
    if (duplicates > 0) {
      db.addActivityLog('warn', `⚠ ${duplicates} conteúdos duplicados ignorados para evitar perda de dados.`);
    }

    for (let i = 0; i < catalog.length; i++) {
      const item = catalog[i];
      const issues = this.diagnoseItem(item);

      if (issues.length === 0 && item.published !== false && item.status === 'ACTIVE') {
        ignored++;
        db.updateRecoveryState({
          processedItems: i + 1,
          ignoredCount: ignored
        });
        continue;
      }

      try {
        // Create Snapshot before change
        db.addRecoverySnapshot(item.id, 'Restauração Inteligente');

        const updates: Partial<MediaItem> = {
          updatedAt: new Date().toISOString()
        };
        let modified = false;

        // Auto-fix published and status
        if (item.published === false) {
          updates.published = true;
          modified = true;
        }
        if (item.status === 'INCOMPLETE' || item.status === 'ERROR') {
          updates.status = 'ACTIVE';
          modified = true;
        }

        // If TMDB ID is valid and has missing metadata, fetch from TMDB
        if (item.tmdbId && item.tmdbId > 0 && (issues.length > 0)) {
          const endpoint = item.type === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
          const tmdbData = await this.fetchTMDB(endpoint, { append_to_response: 'credits,videos' });

          if (tmdbData) {
            if (!item.posterPath && tmdbData.poster_path) {
              updates.posterPath = `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`;
              modified = true;
            }
            if (!item.backdropPath && tmdbData.backdrop_path) {
              updates.backdropPath = `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`;
              modified = true;
            }
            if ((!item.overview || item.overview.length < 20) && tmdbData.overview) {
              updates.overview = tmdbData.overview;
              modified = true;
            }
            if ((!item.genres || item.genres.length === 0) && tmdbData.genres?.length) {
              updates.genres = tmdbData.genres.map((g: any) => g.name);
              modified = true;
            }
            if (!item.duration && (tmdbData.runtime || tmdbData.episode_run_time?.[0])) {
              updates.duration = tmdbData.runtime || tmdbData.episode_run_time?.[0];
              modified = true;
            }
            if (!item.voteAverage && tmdbData.vote_average) {
              updates.voteAverage = Number(tmdbData.vote_average.toFixed(1));
              modified = true;
            }
            if (item.type === 'tv' && (!item.seasons || item.seasons.length === 0) && tmdbData.seasons?.length) {
              updates.seasons = tmdbData.seasons.map((s: any) => ({
                id: `season-${s.season_number}`,
                seasonNumber: s.season_number,
                name: s.name || `Temporada ${s.season_number}`,
                overview: s.overview || '',
                posterPath: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : undefined,
                episodeCount: s.episode_count || 0,
                episodes: []
              }));
              updates.seasonsCount = tmdbData.number_of_seasons || updates.seasons.length;
              updates.episodesCount = tmdbData.number_of_episodes;
              modified = true;
            }
          }
        }

        if (modified) {
          db.updateMediaItem(item.id, updates);
          updated++;
          const fieldNames = Object.keys(updates).filter(k => k !== 'updatedAt').join(', ');
          details.push(`✓ Conteúdo atualizado: ${item.title} (${fieldNames || 'Status/Publicação'})`);
          db.addActivityLog('success', `✓ Conteúdo atualizado: ${item.title}`);
        } else {
          ignored++;
        }
      } catch (err: any) {
        errors++;
        details.push(`✕ Erro ao processar ${item.title}: ${err?.message || 'Falha'}`);
        db.addActivityLog('error', `✕ Erro ao recuperar ${item.title}: ${err?.message}`);
      }

      db.updateRecoveryState({
        processedItems: i + 1,
        successCount: updated,
        errorCount: errors,
        ignoredCount: ignored,
        lastProcessedId: item.id
      });

      // Small pacing to avoid rate limit
      if (i % 10 === 0) {
        await new Promise(r => setTimeout(r, 40));
      }
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1) + 's';

    // Clear issues after smart restore
    await this.analyzeCatalog();

    const report = db.addRecoveryReport({
      operation: 'Restauração Inteligente',
      target: `Catálogo Completo (${catalog.length} itens)`,
      totalProcessed: catalog.length,
      addedCount: added,
      updatedCount: updated,
      ignoredCount: ignored,
      duplicatesCount: duplicates,
      errorsCount: errors,
      adminEmail,
      duration: durationSec,
      status: errors > 0 ? 'WARNING' : 'SUCCESS',
      details: details.slice(0, 100)
    });

    db.updateRecoveryState({
      status: 'COMPLETED',
      currentAction: undefined
    });

    db.addActivityLog('success', `✓ Restauração inteligente concluída em ${durationSec} (${updated} atualizados, ${ignored} preservados).`);
    this.isProcessing = false;

    return report;
  }

  // --- Single Movie Recovery ---
  public async recoverMovieByTmdb(tmdbId: number, adminEmail: string): Promise<{ success: boolean; item?: MediaItem; action: string; message: string }> {
    const startTime = Date.now();
    db.addActivityLog('info', `✓ TMDB conectado: buscando filme ID ${tmdbId}...`);

    const raw = await this.fetchTMDB(`/movie/${tmdbId}`, { append_to_response: 'credits,videos' });
    if (!raw || !raw.id) {
      db.addActivityLog('error', `✕ Filme não encontrado no TMDB para o ID ${tmdbId}`);
      throw new Error(`Filme não encontrado no TMDB (ID ${tmdbId}). Verifique o identificador numérico.`);
    }

    db.addActivityLog('success', `✓ Filme encontrado: ${raw.title || raw.original_title}`);

    const existing = db.getMediaByTmdbAndType(tmdbId, 'movie');
    const now = new Date().toISOString();

    if (existing) {
      // Merge missing fields ONLY
      db.addRecoverySnapshot(existing.id, 'Recuperação Individual de Filme');

      const updates: Partial<MediaItem> = {
        updatedAt: now,
        published: true,
        status: 'ACTIVE'
      };

      if (!existing.posterPath && raw.poster_path) updates.posterPath = `https://image.tmdb.org/t/p/w500${raw.poster_path}`;
      if (!existing.backdropPath && raw.backdrop_path) updates.backdropPath = `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}`;
      if ((!existing.overview || existing.overview.length < 20) && raw.overview) updates.overview = raw.overview;
      if ((!existing.genres || existing.genres.length === 0) && raw.genres?.length) updates.genres = raw.genres.map((g: any) => g.name);
      if (!existing.duration && raw.runtime) updates.duration = raw.runtime;
      if (!existing.voteAverage && raw.vote_average) updates.voteAverage = Number(raw.vote_average.toFixed(1));

      const updated = db.updateMediaItem(existing.id, updates);
      db.addActivityLog('success', `✓ Conteúdo atualizado: ${existing.title} (ID TMDB ${tmdbId})`);

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      db.addRecoveryReport({
        operation: 'Recuperar Filme',
        target: `${existing.title} (TMDB ${tmdbId})`,
        totalProcessed: 1,
        addedCount: 0,
        updatedCount: 1,
        ignoredCount: 0,
        duplicatesCount: 0,
        errorsCount: 0,
        adminEmail,
        duration: durationSec,
        status: 'SUCCESS',
        details: [`Filme existente atualizado com dados oficiais do TMDB: ${Object.keys(updates).join(', ')}`]
      });

      return {
        success: true,
        item: updated,
        action: 'UPDATED',
        message: `Filme "${existing.title}" atualizado com sucesso.`
      };
    } else {
      // Insert new movie
      const newId = `movie-${tmdbId}-${Date.now()}`;
      const genres = raw.genres ? raw.genres.map((g: any) => g.name) : [];
      const cast = raw.credits?.cast?.slice(0, 10).map((c: any) => ({
        id: c.id,
        name: c.name,
        character: c.character || '',
        profilePath: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined
      })) || [];
      const directorObj = raw.credits?.crew?.find((c: any) => c.job === 'Director');

      let trailerUrl: string | undefined;
      if (raw.videos?.results?.length) {
        const trailer = raw.videos.results.find((v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
        if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }

      const newMedia: MediaItem = {
        id: newId,
        tmdbId,
        type: 'movie',
        title: raw.title || raw.original_title,
        originalTitle: raw.original_title || raw.title,
        overview: raw.overview || 'Sem sinopse disponível.',
        posterPath: raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : '',
        backdropPath: raw.backdrop_path ? `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}` : '',
        voteAverage: raw.vote_average ? Number(raw.vote_average.toFixed(1)) : 0,
        voteCount: raw.vote_count || 0,
        releaseDate: raw.release_date,
        genres,
        duration: raw.runtime,
        trailerUrl,
        cast,
        director: directorObj ? directorObj.name : undefined,
        featured: (raw.vote_average || 0) > 7.8,
        popular: (raw.popularity || 0) > 40,
        trending: (raw.popularity || 0) > 80,
        status: 'ACTIVE',
        published: true,
        source: 'TMDB',
        createdAt: now,
        updatedAt: now
      };

      const added = db.addMediaItem(newMedia);
      db.addActivityLog('success', `✓ Filme adicionado ao catálogo: ${newMedia.title}`);

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      db.addRecoveryReport({
        operation: 'Recuperar Filme',
        target: `${newMedia.title} (TMDB ${tmdbId})`,
        totalProcessed: 1,
        addedCount: 1,
        updatedCount: 0,
        ignoredCount: 0,
        duplicatesCount: 0,
        errorsCount: 0,
        adminEmail,
        duration: durationSec,
        status: 'SUCCESS',
        details: [`Novo filme inserido no catálogo com metadados completos do TMDB.`]
      });

      return {
        success: true,
        item: added,
        action: 'ADDED',
        message: `Novo filme "${newMedia.title}" adicionado ao catálogo.`
      };
    }
  }

  // --- Single Series Recovery ---
  public async recoverSeriesByTmdb(tmdbId: number, adminEmail: string): Promise<{ success: boolean; item?: MediaItem; action: string; message: string }> {
    const startTime = Date.now();
    db.addActivityLog('info', `✓ TMDB conectado: buscando série ID ${tmdbId}...`);

    const raw = await this.fetchTMDB(`/tv/${tmdbId}`, { append_to_response: 'credits,videos' });
    if (!raw || !raw.id) {
      db.addActivityLog('error', `✕ Série não encontrada no TMDB para o ID ${tmdbId}`);
      throw new Error(`Série não encontrada no TMDB (ID ${tmdbId}). Verifique o identificador numérico.`);
    }

    db.addActivityLog('success', `✓ Série encontrada: ${raw.name || raw.original_name} (${raw.number_of_seasons || 0} temporadas)`);

    const existing = db.getMediaByTmdbAndType(tmdbId, 'tv');
    const now = new Date().toISOString();

    const seasons = raw.seasons?.map((s: any) => ({
      id: `season-${s.season_number}`,
      seasonNumber: s.season_number,
      name: s.name || `Temporada ${s.season_number}`,
      overview: s.overview || '',
      posterPath: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : undefined,
      episodeCount: s.episode_count || 0,
      episodes: []
    })) || [];

    if (existing) {
      db.addRecoverySnapshot(existing.id, 'Recuperação Individual de Série');

      const updates: Partial<MediaItem> = {
        updatedAt: now,
        published: true,
        status: 'ACTIVE'
      };

      if (!existing.posterPath && raw.poster_path) updates.posterPath = `https://image.tmdb.org/t/p/w500${raw.poster_path}`;
      if (!existing.backdropPath && raw.backdrop_path) updates.backdropPath = `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}`;
      if ((!existing.overview || existing.overview.length < 20) && raw.overview) updates.overview = raw.overview;
      if ((!existing.genres || existing.genres.length === 0) && raw.genres?.length) updates.genres = raw.genres.map((g: any) => g.name);
      if (!existing.voteAverage && raw.vote_average) updates.voteAverage = Number(raw.vote_average.toFixed(1));
      
      // Update seasons if missing
      if (!existing.seasons || existing.seasons.length === 0 || existing.seasons.length !== seasons.length) {
        updates.seasons = seasons;
        updates.seasonsCount = raw.number_of_seasons || seasons.length;
        updates.episodesCount = raw.number_of_episodes;
      }

      const updated = db.updateMediaItem(existing.id, updates);
      db.addActivityLog('success', `✓ Conteúdo atualizado: Série ${existing.title}`);

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      db.addRecoveryReport({
        operation: 'Recuperar Série',
        target: `${existing.title} (TMDB ${tmdbId})`,
        totalProcessed: 1,
        addedCount: 0,
        updatedCount: 1,
        ignoredCount: 0,
        duplicatesCount: 0,
        errorsCount: 0,
        adminEmail,
        duration: durationSec,
        status: 'SUCCESS',
        details: [`Série existente atualizada: temporadas verificadas e metadados sincronizados.`]
      });

      return {
        success: true,
        item: updated,
        action: 'UPDATED',
        message: `Série "${existing.title}" atualizada com sucesso.`
      };
    } else {
      const newId = `tv-${tmdbId}-${Date.now()}`;
      const genres = raw.genres ? raw.genres.map((g: any) => g.name) : [];
      const cast = raw.credits?.cast?.slice(0, 10).map((c: any) => ({
        id: c.id,
        name: c.name,
        character: c.character || '',
        profilePath: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined
      })) || [];

      let trailerUrl: string | undefined;
      if (raw.videos?.results?.length) {
        const trailer = raw.videos.results.find((v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
        if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }

      const newMedia: MediaItem = {
        id: newId,
        tmdbId,
        type: 'tv',
        title: raw.name || raw.original_name,
        originalTitle: raw.original_name || raw.name,
        overview: raw.overview || 'Sem sinopse disponível.',
        posterPath: raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : '',
        backdropPath: raw.backdrop_path ? `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}` : '',
        voteAverage: raw.vote_average ? Number(raw.vote_average.toFixed(1)) : 0,
        voteCount: raw.vote_count || 0,
        firstAirDate: raw.first_air_date,
        genres,
        duration: raw.episode_run_time?.[0],
        seasonsCount: raw.number_of_seasons || seasons.length,
        episodesCount: raw.number_of_episodes,
        seasons,
        trailerUrl,
        cast,
        featured: (raw.vote_average || 0) > 7.8,
        popular: (raw.popularity || 0) > 40,
        trending: (raw.popularity || 0) > 80,
        status: 'ACTIVE',
        published: true,
        source: 'TMDB',
        createdAt: now,
        updatedAt: now
      };

      const added = db.addMediaItem(newMedia);
      db.addActivityLog('success', `✓ Série adicionada ao catálogo: ${newMedia.title}`);

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      db.addRecoveryReport({
        operation: 'Recuperar Série',
        target: `${newMedia.title} (TMDB ${tmdbId})`,
        totalProcessed: 1,
        addedCount: 1,
        updatedCount: 0,
        ignoredCount: 0,
        duplicatesCount: 0,
        errorsCount: 0,
        adminEmail,
        duration: durationSec,
        status: 'SUCCESS',
        details: [`Nova série inserida no catálogo com ${seasons.length} temporadas registradas.`]
      });

      return {
        success: true,
        item: added,
        action: 'ADDED',
        message: `Nova série "${newMedia.title}" adicionada ao catálogo.`
      };
    }
  }

  // --- Batch Restoration ---
  public async startBatchRecovery(options: {
    batchSize?: number;
    filter?: 'all' | 'issues_only' | 'movies_only' | 'series_only';
    adminEmail: string;
  }) {
    if (this.isProcessing) {
      throw new Error('Processamento em lote já em andamento.');
    }

    const batchSize = Math.min(100, Math.max(10, options.batchSize || 50));
    const allCatalog = db.getCatalog({ limit: Number.MAX_SAFE_INTEGER }).items;

    let targetItems: MediaItem[] = [];
    if (options.filter === 'movies_only') {
      targetItems = allCatalog.filter(i => i.type === 'movie');
    } else if (options.filter === 'series_only') {
      targetItems = allCatalog.filter(i => i.type === 'tv');
    } else if (options.filter === 'issues_only') {
      const issues = db.getRecoveryIssues();
      const issueMediaIds = new Set(issues.map(i => i.mediaId));
      targetItems = allCatalog.filter(i => issueMediaIds.has(i.id) || i.published === false || i.status !== 'ACTIVE');
    } else {
      targetItems = allCatalog;
    }

    this.isProcessing = true;
    this.isPaused = false;
    this.stopRequested = false;

    db.addActivityLog('info', `✓ Iniciando Restauração em Lotes (${targetItems.length} itens em lotes de ${batchSize})...`);
    db.updateRecoveryState({
      status: 'RUNNING',
      totalItems: targetItems.length,
      processedItems: 0,
      successCount: 0,
      errorCount: 0,
      ignoredCount: 0,
      startTime: new Date().toISOString(),
      currentAction: `Restauração em Lotes (${options.filter || 'all'})`
    });

    this.runBatchLoop(targetItems, batchSize, options.adminEmail);
  }

  private async runBatchLoop(items: MediaItem[], batchSize: number, adminEmail: string) {
    const startTime = Date.now();
    let success = 0;
    let ignored = 0;
    let errors = 0;
    const totalBatches = Math.ceil(items.length / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      if (this.stopRequested) {
        db.addActivityLog('warn', '⚠ Processamento em lote cancelado pelo administrador.');
        db.updateRecoveryState({ status: 'IDLE', currentAction: undefined });
        this.isProcessing = false;
        return;
      }

      while (this.isPaused) {
        await new Promise(r => setTimeout(r, 1000));
        if (this.stopRequested) {
          db.updateRecoveryState({ status: 'IDLE', currentAction: undefined });
          this.isProcessing = false;
          return;
        }
      }

      const startIdx = batchIndex * batchSize;
      const endIdx = Math.min(items.length, startIdx + batchSize);
      const batchItems = items.slice(startIdx, endIdx);

      db.addActivityLog('info', `✓ Verificando lote ${batchIndex + 1}/${totalBatches} (${batchItems.length} itens)`);

      for (let j = 0; j < batchItems.length; j++) {
        if (this.stopRequested) break;
        const item = batchItems[j];
        const overallIndex = startIdx + j;

        try {
          const itemIssues = this.diagnoseItem(item);
          if (itemIssues.length > 0 || item.published === false) {
            db.addRecoverySnapshot(item.id, 'Restauração em Lote');
            
            const updates: Partial<MediaItem> = {
              updatedAt: new Date().toISOString(),
              published: true,
              status: 'ACTIVE'
            };

            // Fetch TMDB if needed
            if (item.tmdbId && item.tmdbId > 0 && itemIssues.length > 0) {
              const endpoint = item.type === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
              const tmdbData = await this.fetchTMDB(endpoint);
              if (tmdbData) {
                if (!item.posterPath && tmdbData.poster_path) updates.posterPath = `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`;
                if (!item.backdropPath && tmdbData.backdrop_path) updates.backdropPath = `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`;
                if ((!item.overview || item.overview.length < 20) && tmdbData.overview) updates.overview = tmdbData.overview;
                if ((!item.genres || item.genres.length === 0) && tmdbData.genres?.length) updates.genres = tmdbData.genres.map((g: any) => g.name);
              }
            }

            db.updateMediaItem(item.id, updates);
            success++;
          } else {
            ignored++;
          }
        } catch (err: any) {
          errors++;
          db.addActivityLog('error', `✕ Erro no lote: ${item.title}`);
        }

        db.updateRecoveryState({
          processedItems: overallIndex + 1,
          successCount: success,
          ignoredCount: ignored,
          errorCount: errors,
          lastProcessedId: item.id
        });

        // Delay between items to avoid spam
        await new Promise(r => setTimeout(r, 30));
      }

      // Small pause between batches
      await new Promise(r => setTimeout(r, 200));
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1) + 's';

    db.addRecoveryReport({
      operation: 'Restauração em Lotes',
      target: `${items.length} itens processados`,
      totalProcessed: items.length,
      addedCount: 0,
      updatedCount: success,
      ignoredCount: ignored,
      duplicatesCount: 0,
      errorsCount: errors,
      adminEmail,
      duration: durationSec,
      status: errors > 0 ? 'WARNING' : 'SUCCESS',
      details: [`Lote finalizado com sucesso: ${success} atualizados, ${ignored} íntegros, ${errors} erros.`]
    });

    db.updateRecoveryState({ status: 'COMPLETED', currentAction: undefined });
    db.addActivityLog('success', `✓ Processamento em lotes finalizado: ${success} atualizados, ${ignored} preservados (${durationSec}).`);

    this.isProcessing = false;
  }

  public pauseBatch() {
    this.isPaused = true;
    db.updateRecoveryState({ status: 'PAUSED' });
    db.addActivityLog('info', 'Processamento em lote pausado pelo administrador.');
  }

  public resumeBatch() {
    this.isPaused = false;
    db.updateRecoveryState({ status: 'RUNNING' });
    db.addActivityLog('info', 'Processamento em lote retomado.');
  }

  public stopBatch() {
    this.stopRequested = true;
    this.isPaused = false;
  }

  public getIsProcessing() {
    return this.isProcessing;
  }
}

export const recoveryService = new RecoveryService();
