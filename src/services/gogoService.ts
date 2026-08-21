
const GOGO_BASE = 'https://gogoanimeapkdl.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface GogoAnimeInfo {
  id: string;
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

export interface GogoEpisode {
  id: string;
  number: number;
  title?: string;
  url: string;
  slug: string;
  animeId: string;
}

export interface GogoVideoSource {
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

export const gogoService = {
  baseUrl: GOGO_BASE,

  async search(query: string): Promise<GogoAnimeInfo[]> {
    const html = await fetchPage(`${GOGO_BASE}/search.html?keyword=${encodeURIComponent(query)}`);
    const items: GogoAnimeInfo[] = [];

    // Match anime cards: <li class="items">...<a href="/category/slug" title="Title">...</a></li>
    const cardRegex = /<li[^>]*class="[^"]*item[^"]*"[^>]*>[\s\S]*?<a\s+href="\/category\/([^"]+)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/li>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const slug = match[1];
      const title = match[2];
      const image = match[3];

      // Extract anime ID from slug (e.g., "re-zero-kara-hajimeru-isekai-seikatsu" -> no numeric ID in gogo)
      const id = slug;

      items.push({
        id,
        title,
        slug,
        image,
      });
    }

    // Fallback: match any category link
    if (items.length === 0) {
      const linkRegex = /<a\s+href="\/category\/([^"]+)"[^>]*title="([^"]+)"[^>]*>/gi;
      while ((match = linkRegex.exec(html)) !== null) {
        const slug = match[1];
        const title = match[2];
        if (!items.some((i) => i.slug === slug)) {
          items.push({ id: slug, title, slug, image: '' });
        }
      }
    }

    return items.slice(0, 15);
  },

  async getAnimeById(slug: string): Promise<GogoAnimeInfo | null> {
    const html = await fetchPage(`${GOGO_BASE}/category/${slug}`);
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const imgMatch = html.match(/<img[^>]*src="([^"]+)"/);
    const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const epMatch = html.match(/<\/label><\/div>\s*<\/div>\s*<\/div>\s*<\/li>/i);

    // Extract episode count from the episode list
    const episodeCount = (html.match(/\/episode-/g) || []).length;

    return {
      id: slug,
      title: titleMatch?.[1]?.trim() || slug.replace(/-/g, ' '),
      slug,
      image: imgMatch?.[1],
      description: descMatch?.[1]?.replace(/<[^>]+>/g, '').trim().substring(0, 500),
      format: 'TV',
      episodes: episodeCount || undefined,
    };
  },

  async getEpisodes(slug: string): Promise<GogoEpisode[]> {
    const html = await fetchPage(`${GOGO_BASE}/category/${slug}`);

    // Extract episode links: <a href="/episode/slug-ep-1">EP 1</a>
    const epRegex = /<a\s+href="\/episode\/([^"]+)"[^>]*>([^<]*)<\/a>/gi;
    const episodes: GogoEpisode[] = [];
    let match;

    while ((match = epRegex.exec(html)) !== null) {
      const epSlug = match[1];
      const epTitle = match[2]?.trim() || `Episode ${episodes.length + 1}`;
      const epNumberMatch = epTitle.match(/EP\s*(\d+)/i) || epSlug.match(/ep-(\d+)/i);
      const epNumber = epNumberMatch ? parseInt(epNumberMatch[1]) : episodes.length + 1;

      episodes.push({
        id: `${slug}-episode-${epNumber}`,
        number: epNumber,
        title: epTitle,
        url: `${GOGO_BASE}/episode/${epSlug}`,
        slug,
        animeId: slug,
      });
    }

    return episodes;
  },

  async getEpisodeSources(slug: string, episodeNumber: number): Promise<GogoVideoSource[]> {
    const episodes = await this.getEpisodes(slug);
    const episode = episodes.find((e) => e.number === episodeNumber);
    if (!episode) return [];

    const html = await fetchPage(episode.url);

    // Extract iframe source from the page
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) {
      return [
        {
          url: iframeMatch[1],
          quality: 'auto',
          type: 'sub',
          server: 'gogo',
        },
      ];
    }

    // Look for video source URLs
    const sourceMatches = [...html.matchAll(/source\s+src=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi)];
    if (sourceMatches.length > 0) {
      return sourceMatches.map((m) => ({
        url: m[1],
        quality: m[1].includes('1080') ? '1080p' : m[1].includes('720') ? '720p' : '480p',
        isM3U8: m[1].includes('.m3u8'),
        type: 'sub',
        server: 'gogo',
      }));
    }

    // Look for data-src or other source attributes
    const dataSrcMatch = html.match(/data-src=["']([^"']+)["']/i);
    if (dataSrcMatch) {
      return [{ url: dataSrcMatch[1], quality: 'auto', type: 'sub', server: 'gogo' }];
    }

    return [];
  },

  async getTrending(): Promise<GogoAnimeInfo[]> {
    const html = await fetchPage(`${GOGO_BASE}/home`);
    const items: GogoAnimeInfo[] = [];
    const linkRegex = /<a\s+href="\/category\/([^"]+)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null && items.length < 20) {
      items.push({
        id: match[1],
        title: match[2],
        slug: match[1],
        image: match[3],
      });
    }

    return items;
  },
};
