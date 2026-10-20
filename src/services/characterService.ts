/**
 * Character data comes from AniList, which is the only free source with a
 * usable cast list. The catalogue API exposes characters too, but the upstream
 * returns an empty list for most series, so AniList is queried by title.
 */

const ANILIST_URL = 'https://graphql.anilist.co';

export interface CharacterData {
  id: number;
  name: string;
  image?: string;
  role?: string;
  voiceActor?: {
    id: string;
    name: string;
    image?: string;
  };
}

export interface ReviewData {
  id: number;
  user: {
    id: string;
    username: string;
    avatar?: string;
  };
  rating: number;
  text: string;
  date: string;
}

const CHARACTERS_QUERY = `
  query ($search: String) {
    Media(search: $search, type: ANIME) {
      characters(sort: [ROLE, RELEVANCE], page: 1, perPage: 20) {
        edges {
          role
          node {
            id
            name { full native }
            image { large }
          }
          voiceActors(language: JAPANESE) {
            id
            name { full }
            image { large }
          }
        }
      }
    }
  }
`;

export async function fetchCharacters(title: string): Promise<CharacterData[]> {
  const search = title.trim();
  if (!search) return [];
  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: CHARACTERS_QUERY, variables: { search } }),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const edges = payload?.data?.Media?.characters?.edges;
    if (!Array.isArray(edges)) return [];
    return edges.map((edge: {
      role?: string;
      node: { id: number; name: { full: string }; image?: { large: string } };
      voiceActors?: { id: number; name: { full: string }; image?: { large: string } }[];
    }) => {
      const actor = edge.voiceActors?.[0];
      return {
        id: edge.node.id,
        name: edge.node.name.full,
        image: edge.node.image?.large,
        role: edge.role,
        voiceActor: actor
          ? { id: String(actor.id), name: actor.name.full, image: actor.image?.large }
          : undefined,
      };
    });
  } catch {
    return [];
  }
}

export async function fetchReviews(_animeId: string): Promise<ReviewData[]> {
  // AniList exposes no review list through this query, so the section stays empty.
  return [];
}
