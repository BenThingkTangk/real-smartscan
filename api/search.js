// /api/search — SmartScan v2 Commerce Engine
// SerpAPI Google Shopping + SmartScan deal scoring

const SERP_API_KEY = process.env.SERP_API_KEY || '';

// ── REDIS CACHE (Upstash REST API — no npm needed) ──────────────────
async function cacheGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}

async function cacheSet(key, value, ttlSeconds = 300) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}/ex/${ttlSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {}
}

// Simple in-memory rate limiter (100 req/min per IP)
const rateMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const window = 60_000; // 1 min
  const limit = 100;
  const entry = rateMap.get(ip) || { count: 0, reset: now + window };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + window; }
  entry.count++;
  rateMap.set(ip, entry);
  if (rateMap.size > 10000) { // cleanup
    const old = now - window;
    for (const [k,v] of rateMap) { if (v.reset < old) rateMap.delete(k); }
  }
  return entry.count > limit;
}

function shipCost(s) {
  if (!s) return 0;
  if (s.toLowerCase().includes('free')) return 0;
  const m = s.match(/\$(\d+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : 0;
}

function dealScore(price, allPrices, rating, freeShip) {
  const min = Math.min(...allPrices), max = Math.max(...allPrices), range = max - min || 1;
  const priceScore = ((max - price) / range) * 45;
  const shipScore = freeShip ? 15 : 0;
  const ratingScore = rating ? Math.min(20, (parseFloat(rating) - 3) * 8) : 10;
  return Math.min(99, Math.max(1, Math.round(priceScore + shipScore + ratingScore)));
}

function slugify(q) { return q.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60); }

// ── OUTLIER FILTERING ── removes results with absurd price discrepancies
function filterOutliers(items) {
  if (items.length < 3) return items;
  const prices = items.map(r => r.price).sort((a,b) => a-b);
  // Remove bottom/top 10% extremes for median calc
  const trimmed = prices.slice(Math.floor(prices.length * 0.1), Math.ceil(prices.length * 0.9));
  const median = trimmed[Math.floor(trimmed.length / 2)];
  const floor = median * 0.55;   // never more than 45% below median
  const ceiling = median * 2.5;  // never more than 2.5x median
  return items.filter(r => r.price >= floor && r.price <= ceiling);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (rateLimit(ip)) return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });

  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });

  // Demo fallback when no SerpAPI key
  if (!SERP_API_KEY) {
    const mockPrices = [119.99, 124.99, 129.99, 139.99, 149.99];
    const stores = ['Amazon', 'Walmart', 'Best Buy', 'Target', 'eBay'];
    let results = stores.map((store, i) => ({
      store, price: mockPrices[i],
      ship: i < 3 ? 'Free' : `$${5 + i * 2}`, ship_cost: i < 3 ? 0 : 5 + i * 2,
      delivered_total: mockPrices[i] + (i < 3 ? 0 : 5 + i * 2),
      rating: (4.2 + i * 0.1).toString(), reviews: 1200 * (5 - i),
      in_stock: true, condition: 'New', thumbnail: null, url: '#', score: 0,
    }));
    results = filterOutliers(results);
    const prices = results.map(r => r.price);
    results.forEach(r => { r.score = dealScore(r.price, prices, r.rating, r.ship_cost === 0); });
    results.sort((a, b) => b.score - a.score);
    const marketBest = Math.min(...prices);
    const cat = (req.query.category || 'Electronics');
    const categoryRate = { Electronics: 0.06, Health: 0.09, Supplements: 0.15, Fashion: 0.08, Gaming: 0.06 };
    const takeRate = categoryRate[cat] || 0.08;
    const smartscanPrice = +(marketBest * (1 + takeRate)).toFixed(2);
    return res.json({
      results, query: q, source: 'demo',
      product: { name: q, best_price: marketBest, msrp: Math.round(marketBest * 1.3), save_pct: 23, thumbnail: null },
      analytics: { deal_score: results[0].score, signal: 'GOOD DEAL', trend: 'stable', retailer_count: results.length, free_ship_count: 3 },
      smartscan_direct: {
        price: smartscanPrice,
        market_best: marketBest,
        take_rate: takeRate,
        label: 'R.E.A.L. Price — includes our service fee',
      },
    });
  }

  try {
    // Check Redis cache before calling SerpAPI
    const cacheKey = `search:${q}:${req.query.free_ship||''}:${req.query.condition||''}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, source: 'cache' });

    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_shopping');
    url.searchParams.set('q', q);
    url.searchParams.set('api_key', SERP_API_KEY);
    url.searchParams.set('num', '40');
    url.searchParams.set('gl', 'us');
    url.searchParams.set('hl', 'en');
    if (req.query.free_ship === '1') url.searchParams.set('free_shipping', '1');
    if (req.query.condition) url.searchParams.set('condition', req.query.condition);

    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`SerpAPI ${resp.status}`);
    const serpData = await resp.json();
    const raw = serpData.shopping_results || [];

    let results = raw.filter(r => r.extracted_price > 0).map(r => {
      const sc = shipCost(r.delivery || '');
      return {
        store: r.source, title: r.title,
        price: r.extracted_price,
        old_price: r.extracted_old_price || null,
        save_pct: r.extracted_old_price ? Math.round((1 - r.extracted_price / r.extracted_old_price) * 100) : null,
        ship: r.delivery || 'See site', ship_cost: sc,
        delivered_total: r.extracted_price + sc,
        rating: r.rating || null, reviews: r.reviews || null,
        in_stock: !((r.tag || '').toLowerCase().includes('out')),
        condition: r.second_hand_condition ? 'Used' : 'New',
        thumbnail: r.thumbnail || null, url: r.product_link || '#', score: 0,
      };
    });

    // Apply outlier filtering BEFORE computing deal scores
    results = filterOutliers(results);

    const prices = results.map(r => r.price);
    results.forEach(r => { r.score = dealScore(r.price, prices, r.rating, r.ship_cost === 0); });
    results.sort((a, b) => b.score - a.score);

    const marketBest = Math.min(...prices);
    const msrp = raw[0]?.extracted_old_price || Math.round(marketBest * 1.3);
    const topScore = results[0]?.score || 0;
    const signal = topScore >= 75 ? 'BUY NOW' : topScore >= 55 ? 'GOOD DEAL' : 'WAIT';

    // SmartScan Direct card — market best + our margin (NEVER below market)
    const categoryRate = { Electronics: 0.06, Health: 0.09, Supplements: 0.15, Fashion: 0.08, Gaming: 0.06 };
    const cat = (req.query.category || 'Electronics');
    const takeRate = categoryRate[cat] || 0.08;
    const smartscanPrice = +(marketBest * (1 + takeRate)).toFixed(2);

    const responseObj = {
      results, query: q, source: 'serpapi',
      product: {
        name: raw[0]?.title || q, thumbnail: raw[0]?.thumbnail || null,
        best_price: marketBest, msrp, save_pct: Math.round((1 - marketBest / msrp) * 100),
      },
      analytics: {
        deal_score: topScore, signal,
        trend: topScore > 70 ? 'falling' : 'stable',
        retailer_count: results.length,
        free_ship_count: results.filter(r => r.ship_cost === 0).length,
      },
      smartscan_direct: {
        price: smartscanPrice,
        market_best: marketBest,
        take_rate: takeRate,
        label: 'R.E.A.L. Price — includes our service fee',
      },
    };
    await cacheSet(cacheKey, responseObj, 300); // 5 min cache
    res.json(responseObj);
  } catch (e) {
    // Report to Sentry via fetch (no SDK needed)
    const sentryDsn = process.env.SENTRY_DSN;
    if (sentryDsn && e.message !== 'Rate limit exceeded') {
      const [, proj] = sentryDsn.match(/sentry\.io\/([\w]+)/) || [];
      if (proj) {
        fetch(`https://sentry.io/api/${proj}/store/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${sentryDsn.split('@')[0].split('//')[1]},sentry_client=custom/1.0` },
          body: JSON.stringify({ message: e.message, level: 'error', platform: 'node', logger: 'api/search' }),
        }).catch(() => {});
      }
    }
    res.status(500).json({ error: e.message, fallback: true });
  }
};
