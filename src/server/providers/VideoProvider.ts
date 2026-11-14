import { VideoFormatType } from '../../types.js';

export interface VideoProviderResolveResult {
  url: string;
  type: VideoFormatType;
  provider: string;
  label?: string;
  quality?: string;
}

export interface VideoProvider {
  name: string;
  resolveMovie(tmdbId: number, imdbId?: string): Promise<VideoProviderResolveResult | null>;
  resolveEpisode(tmdbId: number, season: number, episode: number, imdbId?: string): Promise<VideoProviderResolveResult | null>;
  validateUrl(url: string): Promise<boolean>;
}
