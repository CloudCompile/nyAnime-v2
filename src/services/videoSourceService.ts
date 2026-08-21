
import { v4 as uuidv4 } from 'uuid';
import { anilistService, AnimeResult } from './anilistService';
import { aniwavesService, AniwavesVideoSource } from './aniwavesService';
import { gogoService, GogoVideoSource } from './gogoService';

export interface VideoSource {
  id: string;
  provider: string;
  embedUrl?: string;
  directUrl?: string;
  quality?: string;
  isWorking?: boolean;
}

export interface EpisodeInfo {
  id: string;
  number: number;
  title?: string;
  image?: string;
  description?: string;
  duration?: string;
}

// Map anilist IDs to aniwaves slugs for direct access
const ANIME_SLUG_MAP: Record<string, string> = {
  // Popular anime with known aniwaves slugs
  "21355": "re-zero-kara-hajimeru-isekai-seikatsu",
  "1735": "jujutsu-kaisen-tv",
  "21": "one-piece",
  "16498": "shingeki-no-kyojin",
  "11061": "hunter-x-hunter-2011",
  "20": "naruto-shippuden",
  "5114": "fullmetal-alchemist-brotherhood",
  "1535": "death-note",
  "1": "cowboy-bebop",
  "269": "bleach",
  "11757": "sword-art-online",
  "21087": "konosuba",
  "25777": "shoku-tatsu-kishi",
  "97945": "made-in-abyss",
  "101922": "koukaku-kidoutai-sac-2045",
};

const createEmbedUrl = (sourceUrl: string, isM3U8: boolean): string => {
  if (!sourceUrl || !sourceUrl.startsWith('http')) return '';
  if (isM3U8) {
    return `https://hls-player.lovable.app/?url=${encodeURIComponent(sourceUrl)}`;
  }
  return `https://player.lovable.app/?url=${encodeURIComponent(sourceUrl)}`;
};

export const fetchEpisodes = async (anilistId: string): Promise<EpisodeInfo[]> => {
  console.log(`Fetching episodes for anime ID: ${anilistId}`);

  try {
    // Get anime info from AniList
    const animeData = await anilistService.getById(parseInt(anilistId));
    if (!animeData) {
      console.log(`No anime data found for ID: ${anilistId}`);
      return generateDummyEpisodes(anilistId, 12);
    }

    // Try to get episodes from aniwaves first
    try {
      const aniwavesEpisodes = await aniwavesService.getEpisodes(anilistId);
      if (aniwavesEpisodes.length > 0) {
        console.log(`Found ${aniwavesEpisodes.length} episodes from aniwaves`);
        return aniwavesEpisodes.map((ep) => ({
          id: ep.id,
          number: ep.number,
          title: ep.title,
          image: ep.image,
          description: '',
          duration: '',
        }));
      }
    } catch (e) {
      console.log(`Aniwaves episode fetch failed: ${e}`);
    }

    // Fallback: use AniList episode count
    const epCount = animeData.episodes || 12;
    console.log(`Generating ${epCount} episodes from AniList data`);
    return generateDummyEpisodes(anilistId, epCount);
  } catch (error) {
    console.error('Error in fetchEpisodes:', error);
    return generateDummyEpisodes(anilistId, 12);
  }
};

export const fetchVideoSources = async (episodeId: string): Promise<VideoSource[]> => {
  console.log(`Fetching video sources for episode ID: ${episodeId}`);

  const match = episodeId.match(/^(\d+)-episode-(\d+)$/);
  if (!match) {
    console.error(`Invalid episode ID format: ${episodeId}`);
    return [];
  }

  const animeId = match[1];
  const episodeNumber = parseInt(match[2]);
  const sources: VideoSource[] = [];

  try {
    // Get anime title from AniList for fallback
    let animeTitle = '';
    try {
      const animeData = await anilistService.getById(parseInt(animeId));
      animeTitle = animeData?.titleRomaji || '';
    } catch {}

    // Strategy 1: Try aniwaves directly
    try {
      console.log(`Trying aniwaves for episode ${episodeNumber}`);
      const aniwavesSources = await aniwavesService.getEpisodeSources(animeId, episodeNumber);
      if (aniwavesSources.length > 0) {
        console.log(`Found ${aniwavesSources.length} sources from aniwaves`);
        aniwavesSources.forEach((src, idx) => {
          sources.push({
            id: uuidv4(),
            provider: `aniwaves-${src.type || 'sub'}`,
            embedUrl: src.url,
            directUrl: src.url,
            quality: src.quality || 'auto',
            isWorking: true,
          });
        });
        if (sources.length > 0) return sources;
      }
    } catch (e) {
      console.log(`Aniwaves source fetch failed: ${e}`);
    }

    // Strategy 2: Try gogoanime via consumet
    try {
      console.log(`Trying gogoanime for "${animeTitle}" episode ${episodeNumber}`);
      const gogoSlug = ANIME_SLUG_MAP[animeId];
      if (gogoSlug) {
        const gogoSources = await gogoService.getEpisodeSources(gogoSlug, episodeNumber);
        if (gogoSources.length > 0) {
          console.log(`Found ${gogoSources.length} sources from gogoanime`);
          gogoSources.forEach((src, idx) => {
            sources.push({
              id: uuidv4(),
              provider: `gogoanime-${src.type || 'sub'}`,
              embedUrl: src.url,
              directUrl: src.url,
              quality: src.quality || 'auto',
              isWorking: true,
            });
          });
          if (sources.length > 0) return sources;
        }
      }
    } catch (e) {
      console.log(`Gogoanime source fetch failed: ${e}`);
    }

    // Strategy 3: Try gogoanime by searching
    try {
      console.log(`Trying gogoanime search for "${animeTitle}" episode ${episodeNumber}`);
      const gogoResults = await gogoService.search(animeTitle);
      if (gogoResults.length > 0) {
        const gogoSources = await gogoService.getEpisodeSources(gogoResults[0].slug, episodeNumber);
        if (gogoSources.length > 0) {
          console.log(`Found ${gogoSources.length} sources from gogoanime search`);
          gogoSources.forEach((src, idx) => {
            sources.push({
              id: uuidv4(),
              provider: `gogoanime-search-${src.type || 'sub'}`,
              embedUrl: src.url,
              directUrl: src.url,
              quality: src.quality || 'auto',
              isWorking: true,
            });
          });
        }
      }
    } catch (e) {
      console.log(`Gogoanime search failed: ${e}`);
    }

    // Final fallback: return empty or dummy
    if (sources.length === 0) {
      console.log("No sources found after all attempts");
      sources.push({
        id: uuidv4(),
        provider: "error",
        embedUrl: `https://player.lovable.app/?error=true`,
        quality: "No sources",
        isWorking: false,
      });
      window.dispatchEvent(new CustomEvent('streaming-issue', {
        detail: { animeId, episodeId }
      }));
    }

    return sources;
  } catch (error) {
    console.error('Error in fetchVideoSources:', error);
    return [{
      id: uuidv4(),
      provider: "error",
      embedUrl: `https://player.lovable.app/?error=true`,
      quality: "Error",
      isWorking: false,
    }];
  }
};

const generateDummyEpisodes = (animeId: string, count: number): EpisodeInfo[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `${animeId}-episode-${i + 1}`,
    number: i + 1,
    title: `Episode ${i + 1}`,
    description: '',
    duration: '',
  }));
};
