// /api/deals — DealNews RSS feed (live deals, attributed per their terms)
const CACHE_TTL = 3600 * 1000;
let cache = { data: null, ts: 0 };

const FEEDS = {
  all:         'https://www.dealnews.com/?rss=1&sort=time',
  hot:         'https://www.dealnews.com/?rss=1&sort=hotness',
  editors:     'https://www.dealnews.com/f1682/Staff-Pick/?rss=1',
  electronics: 'https://www.dealnews.com/c142/Electronics/?rss=1',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const category = req.query.category || 'hot';
  const limit = Math.min(parseInt(req.query.limit || '20'), 50);
  const now = Date.now();

  if (cache.data && now - cache.ts < CACHE_TTL) {
    return res.json({ deals: cache.data.slice(0, limit), cached: true, source: 'DealNews', source_url: 'https://www.dealnews.com', attribution: 'Deal data from DealNews.com' });
  }

  try {
    const feedUrl = FEEDS[category] || FEEDS.hot;
    const r = await fetch(feedUrl, { headers: { 'User-Agent': 'SmartScan/2.0 (+https://real-smartscan.vercel.app)' } });
    if (!r.ok) throw new Error(`DealNews ${r.status}`);
    const xml = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const get = tag => { const x = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return x ? (x[1] ?? x[2] ?? '').trim() : ''; };
      const title = get('title');
      const link = block.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() || '';
      if (!title || !link) continue;
      const price = (title + get('description')).match(/\$(\d+(?:\.\d{2})?)/)?.[1];
      const age = Math.round((Date.now() - new Date(get('pubDate')).getTime()) / 60000);
      items.push({ title: title.slice(0, 100), url: link, price: price ? parseFloat(price) : null, age_minutes: Math.max(0, age), source: 'DealNews' });
      if (items.length >= 40) break;
    }
    cache = { data: items, ts: now };
    res.json({ deals: items.slice(0, limit), cached: false, source: 'DealNews', source_url: 'https://www.dealnews.com', attribution: 'Deal data from DealNews.com — links © DealNews' });
  } catch (e) {
    res.status(500).json({ error: e.message, deals: [] });
  }
};
