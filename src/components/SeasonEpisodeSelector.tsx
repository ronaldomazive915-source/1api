import React, { useState, useEffect, useMemo } from 'react';
import { Play, Tv, Clock, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Season, Episode } from '../types.js';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../lib/api.js';

interface SeasonEpisodeSelectorProps {
  seasons?: Season[];
  currentSeason?: number;
  currentEpisode?: number;
  onSelectEpisode?: (season: number, episode: number) => void;
  seriesId?: string;
  tmdbId?: number;
}

const EPISODES_PER_PAGE = 24;

export const SeasonEpisodeSelector: React.FC<SeasonEpisodeSelectorProps> = ({
  seasons = [],
  currentSeason: controlledSeason,
  currentEpisode: controlledEpisode,
  onSelectEpisode,
  tmdbId
}) => {
  const { navigateTo } = useAuth();
  const [internalSeason, setInternalSeason] = useState<number>(() => {
    const first = seasons.find((s) => s.seasonNumber > 0) || seasons[0];
    return first ? first.seasonNumber : 1;
  });
  const [loadedEpisodesBySeason, setLoadedEpisodesBySeason] = useState<Record<number, Episode[]>>({});
  const [loadingSeason, setLoadingSeason] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [showAll, setShowAll] = useState<boolean>(false);

  const activeSeasonNum = controlledSeason !== undefined ? controlledSeason : internalSeason;

  const validSeasons = useMemo(() => {
    if (seasons && seasons.length > 0) {
      return [...seasons].sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));
    }
    return [{ seasonNumber: 1, episodes: [] }] as Season[];
  }, [seasons]);

  const activeSeasonData = useMemo(
    () => validSeasons.find((s) => Number(s.seasonNumber) === Number(activeSeasonNum)) || validSeasons[0],
    [validSeasons, activeSeasonNum]
  );

  // Lazy-fetch real episodes if activeSeasonData.episodes is empty
  useEffect(() => {
    setPage(1);
    const localEps = activeSeasonData?.episodes || [];
    if (localEps.length > 0 || !tmdbId || loadedEpisodesBySeason[activeSeasonNum]) {
      return;
    }

    let cancelled = false;
    setLoadingSeason(true);
    api
      .getSeasonEpisodes(tmdbId, activeSeasonNum)
      .then((res) => {
        if (!cancelled && Array.isArray(res?.episodes)) {
          setLoadedEpisodesBySeason((prev) => ({
            ...prev,
            [activeSeasonNum]: res.episodes
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedEpisodesBySeason((prev) => ({
            ...prev,
            [activeSeasonNum]: []
          }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSeason(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tmdbId, activeSeasonNum, activeSeasonData, loadedEpisodesBySeason]);

  const episodesList: Episode[] = useMemo(() => {
    if (activeSeasonData?.episodes && activeSeasonData.episodes.length > 0) {
      return activeSeasonData.episodes;
    }
    return loadedEpisodesBySeason[activeSeasonNum] || [];
  }, [activeSeasonData, loadedEpisodesBySeason, activeSeasonNum]);

  const totalPages = Math.max(1, Math.ceil(episodesList.length / EPISODES_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const visibleEpisodes = showAll
    ? episodesList
    : episodesList.slice((safePage - 1) * EPISODES_PER_PAGE, safePage * EPISODES_PER_PAGE);

  const handleEpisodeClick = (seasonNum: number, episodeNum: number) => {
    if (onSelectEpisode) {
      onSelectEpisode(seasonNum, episodeNum);
    } else if (tmdbId) {
      navigateTo('watch', `tv-${tmdbId}`, { type: 'tv', tmdbId, season: seasonNum, episode: episodeNum });
    }
  };

  return (
    <div className="space-y-4 bg-[#121215] p-4 sm:p-6 rounded-2xl border border-white/5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Tv className="w-4 h-4 text-[#E50914]" />
          <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
            Temporadas & Episódios
          </h3>
          {episodesList.length > 0 && (
            <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
              ({episodesList.length})
            </span>
          )}
        </div>

        {/* Season Selector */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Temporada:
          </label>
          <select
            value={activeSeasonNum}
            onChange={(e) => {
              const sNum = parseInt(e.target.value, 10);
              setInternalSeason(sNum);
              if (onSelectEpisode) onSelectEpisode(sNum, 1);
            }}
            className="bg-black/60 border border-white/10 rounded-lg px-3 py-2 min-h-[40px] text-xs font-semibold text-white focus:border-[#E50914] focus:outline-none cursor-pointer"
          >
            {validSeasons.map((s) => (
              <option key={s.seasonNumber} value={s.seasonNumber}>
                {s.seasonNumber === 0 ? 'Especiais (T0)' : s.name || `Temporada ${s.seasonNumber}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pagination Controls for large seasons */}
      {episodesList.length > EPISODES_PER_PAGE && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs">
          <span className="text-zinc-400 tabular-nums">
            {showAll
              ? `A mostrar todos os ${episodesList.length} episódios`
              : `Página ${safePage} de ${totalPages} (${episodesList.length} episódios)`}
          </span>
          <div className="flex items-center gap-2">
            {!showAll && (
              <>
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 flex items-center gap-1"
                >
                  Seguinte
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-200 font-bold"
            >
              {showAll ? `Paginar (${EPISODES_PER_PAGE})` : 'Ver Todos'}
            </button>
          </div>
        </div>
      )}

      {/* Episode Grid */}
      {loadingSeason ? (
        <div className="py-8 flex items-center justify-center gap-2 text-xs text-zinc-400">
          <RefreshCw className="w-4 h-4 animate-spin text-[#E50914]" />
          <span>A carregar episódios reais da temporada...</span>
        </div>
      ) : visibleEpisodes.length === 0 ? (
        <div className="py-8 px-4 text-center rounded-xl bg-black/30 border border-white/5 text-xs text-zinc-400">
          Nenhum episódio disponível nesta temporada até ao momento.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {visibleEpisodes.map((ep) => {
            const epSeason = ep.seasonNumber ?? activeSeasonNum;
            const isCurrent =
              controlledEpisode !== undefined &&
              ep.episodeNumber === controlledEpisode &&
              epSeason === activeSeasonNum;

            return (
              <button
                key={`${epSeason}-${ep.episodeNumber}`}
                type="button"
                onClick={() => handleEpisodeClick(epSeason, ep.episodeNumber)}
                className={`p-3 min-h-[48px] rounded-xl flex items-center gap-3 transition-all text-left border ${
                  isCurrent
                    ? 'bg-[#E50914] text-white border-red-500 shadow-md font-bold'
                    : 'bg-black/40 hover:bg-white/5 text-zinc-300 border-white/5 hover:border-white/15'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center ${
                    isCurrent ? 'bg-white/20 text-white' : 'bg-black/60 text-[#E50914] border border-white/10'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                </div>
                <div className="truncate flex-1">
                  <div className="text-xs font-semibold truncate leading-tight">
                    E{ep.episodeNumber} · {ep.title || `Episódio ${ep.episodeNumber}`}
                  </div>
                  <div className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5 tabular-nums">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{ep.duration ? `${ep.duration}m` : '45m'}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
