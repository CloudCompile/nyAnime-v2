
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

// Stubs for backward compatibility — actual source fetching is in videoSourceService.ts
export const getEpisodeSources = async (_episodeId: string, _provider?: AnimeProvider, _server?: StreamingServer) => null;
export const getAvailableServers = async (_episodeId: string, _provider?: AnimeProvider) => [];
export const searchAnime = async (_query: string, _provider?: AnimeProvider) => [];
export const getAnimeInfo = async (_id: string, _provider?: AnimeProvider) => null;
export const getSourcesFromMultipleProviders = async (_title: string, _ep: number, _providers?: AnimeProvider[]) => null;
export const searchAndGetEpisodeLinks = async (_title: string, _ep: number, _provider?: AnimeProvider) => null;

export { PROVIDERS };
