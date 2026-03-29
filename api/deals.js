// /api/deals.js — DealNews RSS Ingestion (Fixed URLs)
// Real working feeds: https://www.dealnews.com/?rss=1 format
// Compliant with DealNews terms: links intact, attribution shown, not rewritten as own content

const CACHE_TTL = 3600 * 1000; // 1 hour cache
let cache = { data: null, timestamp: 0 };

// CORRECT DealNews RSS feed URLs (verified working March 2026)
const FEEDS = {
  all:         'https://www.dealnews.com/?rss=1&sort=time',
  hot:         'https://www.dealnews.com/?rss=1&sort=hotness',
  editors:     'https://www.dealnews.com/f1682/Staff-Pick/?rss=1',
  electronics: 'https://www.dealnews.com/c142/Electronics/?rss=1',
  home:        'https://www.dealnews.com/c304/Home-Garden/Appliances/?rss=1',
  features:    'https://www.dealnews.com/rss/features/',
};

function parseRSS(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];

    const getTag = (tag) => {
      const m = block.match(new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>` +
        `|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`
      ));
      return m ? (m[1] !== undefined ? m[1] : m[2] || '').trim() : '';
    };

    const title = getTag('title');
    // <link> in RSS 2.0 is a text node after </title> before </link>
    const linkMatch = block.match(/<link>([^<]+)<\/link>/);
    const link = linkMatch ? linkMatch[1].trim() : '';
    const desc = getTag('description');
    const pubDate = getTag('pubDate');
    const guid = getTag('guid');

    if (!title) continue;
    const url = link || guid || '';
    if (!url) continue;

    // Extract price from title (e.g. "Flashlight for $11 + free shipping")
    const priceMatch = title.match(/for \$(\d+(?:\.\d{2})?)/i) ||
                       title.match(/\$(\d+(?:\.\d{2})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : null;

    // Extract store from description HTML (e.g. "Buy Now at Amazon")
    const storeMatch = desc.match(/Buy Now at ([A-Za-z0-9][A-Za-z0-9\s\.\-&]+?)(?:<|$)/);
    const store = storeMatch ? storeMatch[1].trim() : '';

    // Extract image from description HTML img tag
    const imgMatch = desc.match(/<img[^>]+src='([^']+)'/);
    const image = imgMatch ? imgMatch[1] : null;

    // Extract coupon code from title/description
    const couponMatch = (title + ' ' + desc).match(/coupon code[^"]*"([A-Z0-9]{5,})"/) ||
                        (title + ' ' + desc).match(/code "([A-Z0-9]{5,})"/);
    const coupon = couponMatch ? couponMatch[1] : null;

    // Extract savings from description
    const savingsMatch = desc.match(/savings of \$(\d+(?:\.\d{2})?)/i);
    const savings = savingsMatch ? parseFloat(savingsMatch[1]) : null;

    const published = pubDate ? new Date(pubDate) : new Date();
    const age_minutes = Math.round((Date.now() - published.getTime()) / 60000);

    items.push({
      id: Buffer.from(url).toString('base64').slice(0, 16),
      title: title.slice(0, 120),
      // Keep link INTACT — DealNews terms: do not modify referral codes
      url,
      price,
      store,
      image,
      coupon,
      savings,
      age_minutes: Math.max(0, age_minutes),
      published: published.toISOString(),
      source: 'DealNews',
      source_url: 'https://www.dealnews.com',
    });
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
  const q = (req.query.q || '').toLowerCase().trim();

  // Return cached data if fresh
  const now = Date.now();
  if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
    let results = cache.data;
    if (q) results = results.filter(d =>
      d.title.toLowerCase().includes(q) || (d.store || '').toLowerCase().includes(q)
    );
    return res.status(200).json({
      deals: results.slice(0, limit),
      total: results.length,
      cached: true,
      cache_age_minutes: Math.round((now - cache.timestamp) / 60000),
      source: 'DealNews',
      source_url: 'https://www.dealnews.com',
      attribution: 'Deal data from DealNews.com',
    });
  }

  try {
    const feedUrl = FEEDS[category] || FEEDS.all;
    const resp = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'SmartScan/1.0 (+https://real-smartscan.vercel.app)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    if (!resp.ok) throw new Error(`DealNews RSS ${resp.status} for ${feedUrl}`);

    const xml = await resp.text();
    if (!xml.includes('<item>')) throw new Error('No items in feed');

    const items = parseRSS(xml);
    cache = { data: items, timestamp: now };

    let results = items;
    if (q) results = results.filter(d =>
      d.title.toLowerCase().includes(q) || (d.store || '').toLowerCase().includes(q)
    );

    return res.status(200).json({
      deals: results.slice(0, limit),
      total: results.length,
      cached: false,
      source: 'DealNews',
      source_url: 'https://www.dealnews.com',
      attribution: 'Deal data from DealNews.com — links © DealNews',
    });

  } catch (err) {
    console.error('DealNews error:', err.message);
    return res.status(200).json({
      deals: [],
      total: 0,
      error: err.message,
      source: 'DealNews',
      source_url: 'https://www.dealnews.com',
    });
  }
};
