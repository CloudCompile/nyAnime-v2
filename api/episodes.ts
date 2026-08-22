import { aniwavesService } from '../src/services/aniwavesService.js';

export default async function handler(req: any, res: any) {
  const animeId = String(req.query?.animeId || '');
  if (!/^\d+$/.test(animeId)) {
    return res.status(400).json({ error: 'Invalid animeId' });
  }

  try {
    const episodes = await aniwavesService.getEpisodes(animeId);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ episodes });
  } catch (error) {
    console.error('Episode provider failed:', error);
    return res.status(502).json({ error: 'Episode provider unavailable' });
  }
}
