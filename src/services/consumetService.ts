
import { ANIME } from "@consumet/extensions";

// Define providers
const PROVIDERS = {
  GOGOANIME: "gogoanime",
  ANIWAVES: "aniwaves",
} as const;

export type AnimeProvider = (typeof PROVIDERS)[keyof typeof PROVIDERS];

// Define streaming servers
export const STREAMING_SERVERS = {
  VidStreaming: "vidstreaming",
  GogoCDN: "gogocdn",
  StreamSB: "streamsb",
  MegaCloud: "megacloud",
  MixDrop: "mixdrop",
  UpCloud: "upcloud",
  VidCloud: "vidcloud",
  StreamTape: "streamtape",
  VizCloud: "vizcloud",
  MyCloud: "mycloud",
  Filemoon: "filemoon",
} as const;

export type StreamingServer = (typeof STREAMING_SERVERS)[keyof typeof STREAMING_SERVERS];

// Provider instances cache
const providerInstances: Record<string, any> = {};

// Get or create provider instance
const getProvider = (providerName: AnimeProvider = PROVIDERS.GOGOANIME) => {
  if (!providerInstances[providerName]) {
    switch (providerName) {
      case PROVIDERS.GOGOANIME:
        // Use the working gogoanime domain
        providerInstances[providerName] = new ANIME.Gogoanime("https://gogoanime.by/");
        break;
      default:
        providerInstances[providerName] = new ANIME.Gogoanime("https://gogoanime.by/");
    }
  }
  return providerInstances[providerName];
};

export const searchAnime = async (query: string, providerName: AnimeProvider = PROVIDERS.GOGOANIME) => {
  try {
    console.log(`Searching for "${query}" using ${providerName} provider`);
    const provider = getProvider(providerName);
    const results = await provider.search(query);
    console.log(`Found ${results.results.length} results for "${query}"`);
    return results.results;
  } catch (error) {
    console.error(`Error searching for anime "${query}":`, error);
    return [];
  }
};

export const getAnimeInfo = async (
  animeId: string,
  providerName: AnimeProvider = PROVIDERS.GOGOANIME,
) => {
  try {
    console.log(`Getting info for anime ID: ${animeId} using ${providerName} provider`);
    const provider = getProvider(providerName);
    const info = await provider.fetchAnimeInfo(animeId);
    console.log(`Got info for "${info.title}" with ${info.episodes?.length || 0} episodes`);
    return info;
  } catch (error) {
    console.error(`Error getting anime info for ID "${animeId}":`, error);
    return null;
  }
};

export const getEpisodeSources = async (
  episodeId: string,
  providerName: AnimeProvider = PROVIDERS.GOGOANIME,
  server?: StreamingServer,
) => {
  try {
    console.log(`Getting sources for episode ID: ${episodeId} using ${providerName} provider`);
    const provider = getProvider(providerName);
    const sources = await provider.fetchEpisodeSources(episodeId, server);
    console.log(`Found ${sources.sources?.length || 0} sources for episode ${episodeId}`);
    return sources;
  } catch (error) {
    console.error(`Error getting episode sources for ID "${episodeId}":`, error);
    return null;
  }
};

export const getSourcesFromMultipleProviders = async (
  animeTitle: string,
  episodeNumber: number,
  providers: AnimeProvider[] = [PROVIDERS.GOGOANIME],
) => {
  console.log(`Trying to get sources for "${animeTitle}" episode ${episodeNumber} from multiple providers`);

  for (const provider of providers) {
    try {
      console.log(`Trying provider: ${provider}`);
      const result = await searchAnime(animeTitle, provider);

      if (!result.length) continue;

      const animeId = result[0].id;
      const animeInfo = await getAnimeInfo(animeId, provider);

      if (!animeInfo?.episodes?.length) continue;

      const episode = animeInfo.episodes.find((ep: any) =>
        Number(ep.number) === episodeNumber ||
        Number(ep.id.split('-').pop()) === episodeNumber
      );

      if (!episode) continue;

      const sources = await getEpisodeSources(episode.id, provider);
      if (sources?.sources?.length) {
        console.log(`Found sources using provider ${provider}`);
        return { provider, title: animeInfo.title, episode, sources };
      }
    } catch (error) {
      console.error(`Error with provider ${provider}:`, error);
    }
  }

  return null;
};

export const getAvailableServers = async (
  episodeId: string,
  providerName: AnimeProvider = PROVIDERS.GOGOANIME,
) => {
  try {
    const provider = getProvider(providerName);
    if (!provider.fetchEpisodeServers) return [];
    return await provider.fetchEpisodeServers(episodeId);
  } catch (error) {
    console.error(`Error getting servers for episode "${episodeId}":`, error);
    return [];
  }
};

export const searchAndGetEpisodeLinks = async (
  title: string,
  episodeNumber: number,
  providerName: AnimeProvider = PROVIDERS.GOGOANIME,
) => {
  try {
    const searchResults = await searchAnime(title, providerName);
    if (!searchResults.length) return null;

    const animeId = searchResults[0].id;
    const animeInfo = await getAnimeInfo(animeId, providerName);
    if (!animeInfo?.episodes?.length) return null;

    const episode = animeInfo.episodes.find((ep: any) =>
      Number(ep.number) === episodeNumber ||
      Number(ep.id.split('-').pop()) === episodeNumber
    );
    if (!episode) return null;

    const sources = await getEpisodeSources(episode.id, providerName);
    return { title: animeInfo.title, episode, sources };
  } catch (error) {
    console.error(`Error in searchAndGetEpisodeLinks for "${title}" episode ${episodeNumber}:`, error);
    return null;
  }
};

export { PROVIDERS };
