
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
  query($id: Int) {
    Media(id: $id) {
      characters(role: MAIN, page: 1, perPage: 20) {
        edges {
          role
          node {
            id
            name { full native }
            image { large }
          }
        }
      }
      staff { edges { node { id name { full } image { large } } role } }
    }
  }
`;

export async function fetchCharacters(animeId: number): Promise<CharacterData[]> {
  try {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: CHARACTERS_QUERY, variables: { id: animeId } }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const edges = data.data?.Media?.characters?.edges || [];
    return edges.map((e: any) => ({
      id: e.node.id,
      name: e.node.name.full,
      image: e.node.image?.large,
      role: e.role,
    }));
  } catch {
    return [];
  }
}

export async function fetchReviews(_animeId: number): Promise<ReviewData[]> {
  // Reviews not available via AniList, return empty
  return [];
}
