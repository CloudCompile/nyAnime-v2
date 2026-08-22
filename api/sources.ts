import { aniwavesService } from '../src/services/aniwavesService.ts';

export default async function handler(req: any, res: any) {
  const episodeId = String(req.query?.episodeId || '');
  const match = episodeId.match(/^(\d+)-episode-(\d+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid episodeId' });
  }

  try {
    const sources = await aniwavesService.getEpisodeSources(match[1], Number(match[2]));
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({ sources });
  } catch (error) {
    console.error('Video provider failed:', error);
    return res.status(502).json({ error: 'Video provider unavailable' });
  }
}
