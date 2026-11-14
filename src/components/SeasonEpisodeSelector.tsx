import React, { useState } from 'react';
import { Play, Tv, Clock } from 'lucide-react';
import { Season, Episode } from '../types.js';
import { useAuth } from '../context/AuthContext.js';

interface SeasonEpisodeSelectorProps {
  seasons?: Season[];
  currentSeason?: number;
  currentEpisode?: number;
  onSelectEpisode?: (season: number, episode: number) => void;
  seriesId?: string;
  tmdbId?: number;
}

export const SeasonEpisodeSelector: React.FC<SeasonEpisodeSelectorProps> = ({
  seasons = [],
  currentSeason: controlledSeason,
  currentEpisode: controlledEpisode,
  onSelectEpisode,
  tmdbId
}) => {
  const { navigateTo } = useAuth();
  const [internalSeason, setInternalSeason] = useState(1);
  const activeSeasonNum = controlledSeason !== undefined ? controlledSeason : internalSeason;

  const validSeasons = seasons && seasons.length > 0 ? seasons : [
    { seasonNumber: 1, episodes: [] }
  ];

  const activeSeasonData = validSeasons.find(s => s.seasonNumber === activeSeasonNum) || validSeasons[0];

  const episodesList: (Episode | { episodeNumber: number; seasonNumber: number; title: string; duration?: number; overview?: string })[] =
    activeSeasonData?.episodes && activeSeasonData.episodes.length > 0
      ? activeSeasonData.episodes
      : Array.from({ length: 10 }, (_, i) => ({
          episodeNumber: i + 1,
          seasonNumber: activeSeasonNum,
          title: `Episódio ${i + 1}`,
          duration: 45
        }));

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
        </div>

        {/* Season Selector */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Temporada:
          </label>
          <select
            value={activeSeasonNum}
            onChange={(e) => {
              const sNum = parseInt(e.target.value);
              setInternalSeason(sNum);
              if (onSelectEpisode) onSelectEpisode(sNum, 1);
            }}
            className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus:border-[#E50914] focus:outline-none cursor-pointer"
          >
            {validSeasons.map((s) => (
              <option key={s.seasonNumber} value={s.seasonNumber}>
                Temporada {s.seasonNumber}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Episode Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {episodesList.map((ep) => {
          const isCurrent = controlledEpisode !== undefined && ep.episodeNumber === controlledEpisode && ep.seasonNumber === activeSeasonNum;

          return (
            <button
              key={ep.episodeNumber}
              type="button"
              onClick={() => handleEpisodeClick(ep.seasonNumber || activeSeasonNum, ep.episodeNumber)}
              className={`p-3 rounded-xl flex items-center gap-3 transition-all text-left border ${
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
                <div className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{ep.duration ? `${ep.duration}m` : '45m'}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
