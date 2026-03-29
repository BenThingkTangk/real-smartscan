// /api/deals.js — DealNews RSS Ingestion
// Pulls hourly editorial deals from DealNews RSS feeds
// Compliant with DealNews terms: links intact, attribution shown, not rewritten as own content
// Cached in-memory for 1 hour to avoid hammering RSS

const CACHE_TTL = 3600 * 1000; // 1 hour
let cache = { data: null, timestamp: 0, etag: null };

// DealNews RSS feeds by category
const DEALNEWS_FEEDS = {
  all:         'https://www.dealnews.com/rss.xml',
  electronics: 'https://www.dealnews.com/c142/Electronics/rss.xml',
  apparel:     'https://www.dealnews.com/c1/Apparel/rss.xml',
  shoes:       'https://www.dealnews.com/c304/Shoes/rss.xml',
  sports:      'https://www.dealnews.com/c131/Sports-Outdoors/rss.xml',
  home:        'https://www.dealnews.com/c8/Home-Garden/rss.xml',
  health:      'https://www.dealnews.com/c140/Health-Beauty/rss.xml',
  tools:       'https://www.dealnews.com/c124/Tools-Hardware/rss.xml',
};

function parseRSS(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const title = get('title');
    const link = get('link') || block.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const desc = get('description');
    const pubDate = get('pubDate');
    const category = get('category');
    const enclosure = block.match(/enclosure[^>]+url="([^"]+)"/)?.[1] || null;

    if (title && link) {
      // Extract price from title/description
      const priceMatch = (title + ' ' + desc).match(/\$(\d+(?:\.\d{2})?)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : null;

      // Extract store from description
      const storeMatch = desc.match(/from\s+([A-Za-z][A-Za-z0-9\s&\.]+?)(?:\s+for|\s+via|\s+at|\s*\.|,)/i);
      const store = storeMatch ? storeMatch[1].trim() : 'DealNews';

      items.push({
        id: Buffer.from(link).toString('base64').slice(0, 16),
        title: title.slice(0, 120),
        description: desc.replace(/<[^>]+>/g, '').slice(0, 200),
        // Keep link INTACT per DealNews terms — do not modify
        url: link,
        price,
        store,
        category: category || 'General',
        image: enclosure,
        published: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        age_minutes: pubDate ? Math.round((Date.now() - new Date(pubDate).getTime()) / 60000) : 0,
        source: 'DealNews', // Attribution per DealNews terms
        source_url: 'https://www.dealnews.com',
      });
    }
  }
  return items;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const category = req.query.category || 'all';
  const limit = Math.min(parseInt(req.query.limit || '20'), 50);
  const q = (req.query.q || '').toLowerCase();

  // Serve from cache if fresh
  const now = Date.now();
  if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
    let results = cache.data;
    if (q) results = results.filter(d => d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.category.toLowerCase().includes(q));
    return res.status(200).json({
      deals: results.slice(0, limit),
      total: results.length,
      cached: true,
      cache_age_minutes: Math.round((now - cache.timestamp) / 60000),
      next_refresh_minutes: Math.round((CACHE_TTL - (now - cache.timestamp)) / 60000),
      source: 'DealNews',
      source_url: 'https://www.dealnews.com',
      attribution: 'Deal data from DealNews.com',
    });
  }

  try {
    // Fetch the feed — use category-specific or all
    const feedUrl = DEALNEWS_FEEDS[category] || DEALNEWS_FEEDS.all;
    const headers = { 'User-Agent': 'SmartScan/1.0 (+https://real-smartscan.vercel.app)', 'Accept': 'application/rss+xml, application/xml, text/xml' };
    if (cache.etag) headers['If-None-Match'] = cache.etag;

    const feedResp = await fetch(feedUrl, { headers });

    if (feedResp.status === 304) {
      // Not modified — extend cache
      cache.timestamp = now;
    } else if (feedResp.ok) {
      const xml = await feedResp.text();
      const newEtag = feedResp.headers.get('etag');
      const items = parseRSS(xml);
      cache = { data: items, timestamp: now, etag: newEtag };
    } else {
      throw new Error(`DealNews RSS error ${feedResp.status}`);
    }

    let results = cache.data || [];
    if (q) results = results.filter(d => d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q));

    return res.status(200).json({
      deals: results.slice(0, limit),
      total: results.length,
      cached: false,
      source: 'DealNews',
      source_url: 'https://www.dealnews.com',
      attribution: 'Deal data from DealNews.com — links and content © DealNews',
    });

  } catch (err) {
    console.error('DealNews RSS error:', err);
    // Return empty gracefully
    return res.status(200).json({
      deals: [],
      total: 0,
      error: err.message,
      source: 'DealNews',
      source_url: 'https://www.dealnews.com',
      attribution: 'Deal data from DealNews.com',
    });
  }
};
