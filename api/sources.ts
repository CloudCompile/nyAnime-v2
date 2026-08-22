import { aniwavesService } from '../src/services/aniwavesService.js';

export default async function handler(req: any, res: any) {
  const episodeId = String(req.query?.episodeId || '');
  const title = String(req.query?.title || '');
  const match = episodeId.match(/^(\d+)-episode-(\d+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid episodeId' });
  }

  try {
    let providerId = match[1];
    if (title) {
      const matches = await aniwavesService.search(title);
      providerId = matches[0]?.id || providerId;
    }
    const providerMatch = title ? (await aniwavesService.search(title))[0] : null;
    const sources = providerMatch
      ? await aniwavesService.getEpisodeSourcesBySlug(providerMatch.slug, providerMatch.id, Number(match[2]))
      : await aniwavesService.getEpisodeSources(providerId, Number(match[2]));
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({ sources });
  } catch (error) {
    console.error('Video provider failed:', error);
    return res.status(502).json({ error: 'Video provider unavailable' });
  }
}
