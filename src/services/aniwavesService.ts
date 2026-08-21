
const ANIWAVES_BASE = 'https://lite.aniwaves.ru';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface AniwavesAnimeInfo {
  id: string;
  malId?: number;
  anilistId?: number;
  title: string;
  slug: string;
  image?: string;
  description?: string;
  genre?: string[];
  year?: string;
  status?: string;
  format?: string;
  episodes?: number;
  rating?: number;
}

export interface AniwavesEpisode {
  id: string;
  number: number;
  title?: string;
  url: string;
  slug: string;
  animeId: string;
  animeSlug: string;
  image?: string;
}

export interface AniwavesVideoSource {
  url: string;
  quality?: string;
  isM3U8?: boolean;
  type?: 'sub' | 'dub';
  server?: string;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
  return res.text();
}

function parseJsonLd(html: string) {
  const scripts = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/gs) || [];
  const results: any[] = [];
  for (const script of scripts) {
    try {
      const json = script.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
      const data = JSON.parse(json);
      if (data['@graph']) {
        results.push(...data['@graph']);
      } else {
        results.push(data);
      }
    } catch {}
  }
  return results;
}

async function parseAnimeInfo(html: string, slug: string, animeId: string): Promise<AniwavesAnimeInfo | null> {
  const jsonLd = parseJsonLd(html);
  const series = jsonLd.find((d: any) => d['@type'] === 'TVSeries') ||
                 jsonLd.find((d: any) => d['@type'] === 'VideoObject');
  if (!series) return null;

  return {
    id: animeId,
    anilistId: parseInt(animeId),
    title: series.name || slug.replace(/-/g, ' '),
    slug,
    image: series.image,
    description: series.description,
    genre: series.genre,
    year: series.datePublished?.substring(0, 4),
    status: series.endDate ? 'Finished' : 'Ongoing',
    format: series.numberOfEpisodes ? 'TV' : undefined,
    episodes: series.numberOfEpisodes,
    rating: series.aggregateRating?.ratingValue,
  };
}

export const aniwavesService = {
  baseUrl: ANIWAVES_BASE,

  async search(query: string): Promise<AniwavesAnimeInfo[]> {
    const html = await fetchPage(`${ANIWAVES_BASE}/filter?keyword=${encodeURIComponent(query)}&page=1`);
    const items: AniwavesAnimeInfo[] = [];
    const links = [...html.matchAll(/href="\/watch-anime\/([^"]+?)-(\d+)"[^>]*>/gi)];

    for (const link of links) {
      const slug = link[1];
      const id = link[2];
      const url = `${ANIWAVES_BASE}/watch-anime/${slug}-${id}`;

      try {
        const pageHtml = await fetchPage(url);
        const info = await parseAnimeInfo(pageHtml, slug, id);
        if (info) items.push(info);
      } catch {}
    }

    return items;
  },

  async getAnimeById(anilistId: string): Promise<AniwavesAnimeInfo | null> {
    const html = await fetchPage(`${ANIWAVES_BASE}/filter?id=${anilistId}`);
    const linkMatch = html.match(/href="\/watch-anime\/([^"]+?)-(\d+)"[^>]*>/i);
    if (!linkMatch || linkMatch[2] !== anilistId) return null;

    const slug = linkMatch[1];
    const pageHtml = await fetchPage(`${ANIWAVES_BASE}/watch-anime/${slug}-${anilistId}`);
    return parseAnimeInfo(pageHtml, slug, anilistId);
  },

  async getAnimeByAnilistId(anilistId: number): Promise<AniwavesAnimeInfo | null> {
    return this.getAnimeById(String(anilistId));
  },

  async getEpisodes(animeId: string): Promise<AniwavesEpisode[]> {
    const info = await this.getAnimeById(animeId);
    if (!info) return [];

    const watchHtml = await fetchPage(`${ANIWAVES_BASE}/watch-anime/${info.slug}-${animeId}/ep-1`);
    const jsonLd = parseJsonLd(watchHtml);
    const series = jsonLd.find((d: any) => d['@type'] === 'TVSeries');
    const epCount = series?.numberOfEpisodes || info.episodes || 12;

    const episodes: AniwavesEpisode[] = [];
    for (let i = 1; i <= epCount; i++) {
      episodes.push({
        id: `${animeId}-episode-${i}`,
        number: i,
        url: `${ANIWAVES_BASE}/watch-anime/${info.slug}-${animeId}/ep-${i}`,
        slug: info.slug,
        animeId,
        animeSlug: info.slug,
      });
    }
    return episodes;
  },

  async getEpisodeSources(animeId: string, episodeNumber: number): Promise<AniwavesVideoSource[]> {
    const info = await this.getAnimeById(animeId);
    if (!info) return [];

    const html = await fetchPage(`${ANIWAVES_BASE}/watch-anime/${info.slug}-${animeId}/ep-${episodeNumber}`);
    const jsonLd = parseJsonLd(html);

    const episode = jsonLd.find((d: any) => d['@type'] === 'TVEpisode' && d.episodeNumber === episodeNumber);
    if (!episode) return [];

    const sources: AniwavesVideoSource[] = [];

    if (episode.encoding) {
      for (const enc of episode.encoding) {
        if (enc.embedUrl) {
          sources.push({
            url: enc.embedUrl,
            quality: enc.inLanguage === 'en' ? 'Dub' : 'Sub',
            type: enc.inLanguage === 'en' ? 'dub' : 'sub',
            server: 'aniwaves',
          });
        }
      }
    }

    if (sources.length === 0 && episode.url) {
      sources.push({ url: episode.url, quality: 'Sub', type: 'sub', server: 'aniwaves' });
    }

    if (sources.length === 0 && episode.embedUrl) {
      sources.push({ url: episode.embedUrl, quality: 'Sub', type: 'sub', server: 'aniwaves' });
    }

    return sources;
  },

  async getTrending(): Promise<AniwavesAnimeInfo[]> {
    const html = await fetchPage(`${ANIWAVES_BASE}/home`);
    const items: AniwavesAnimeInfo[] = [];
    const links = [...html.matchAll(/href="\/watch-anime\/([^"]+?)-(\d+)"[^>]*>/gi)];

    for (const link of links) {
      const slug = link[1];
      const id = link[2];
      const url = `${ANIWAVES_BASE}/watch-anime/${slug}-${id}`;

      try {
        const pageHtml = await fetchPage(url);
        const info = await parseAnimeInfo(pageHtml, slug, id);
        if (info) items.push(info);
      } catch {}
    }

    return items.slice(0, 20);
  },
};
