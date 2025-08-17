// /api/rnh.js
export default async function handler(req, res) {
  const feedUrl = "https://www.radionewshub.com/sitemaps/news.php?feed=H2lujdhEZ3";
  try {
    const rssRes = await fetch(feedUrl);
    if (!rssRes.ok) throw new Error('Feed fetch error');
    const xml = await rssRes.text();
    // Parse RSS feed for top 2 headlines/links
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,2).map(itemXml => {
      const title = itemXml[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
        || itemXml[1].match(/<title>(.*?)<\/title>/)?.[1] || 'Untitled';
      const link = itemXml[1].match(/<link>(.*?)<\/link>/)?.[1] || '#';
      return { title, link };
    });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Could not load news' });
  }
}
