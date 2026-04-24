// /api/search — SmartScan v2 Commerce Engine
// SerpAPI Google Shopping + SmartScan deal scoring

const SERP_API_KEY = process.env.SERP_API_KEY || '';

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });

  // Demo fallback when no SerpAPI key
  if (!SERP_API_KEY) {
    const mockPrices = [119.99, 124.99, 129.99, 139.99, 149.99];
    const stores = ['Amazon', 'Walmart', 'Best Buy', 'Target', 'eBay'];
    const results = stores.map((store, i) => ({
      store, price: mockPrices[i],
      ship: i < 3 ? 'Free' : `$${5 + i * 2}`, ship_cost: i < 3 ? 0 : 5 + i * 2,
      delivered_total: mockPrices[i] + (i < 3 ? 0 : 5 + i * 2),
      rating: (4.2 + i * 0.1).toString(), reviews: 1200 * (5 - i),
      in_stock: true, condition: 'New', thumbnail: null, url: '#', score: 0,
    }));
    const prices = results.map(r => r.price);
    results.forEach(r => { r.score = dealScore(r.price, prices, r.rating, r.ship_cost === 0); });
    results.sort((a, b) => b.score - a.score);
    const best = Math.min(...prices);
    return res.json({
      results, query: q, source: 'demo',
      product: { name: q, best_price: best, msrp: Math.round(best * 1.3), save_pct: 23, thumbnail: null },
      analytics: { deal_score: results[0].score, signal: 'GOOD DEAL', trend: 'stable', retailer_count: results.length, free_ship_count: 3 },
    });
  }

  try {
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

    const prices = results.map(r => r.price);
    results.forEach(r => { r.score = dealScore(r.price, prices, r.rating, r.ship_cost === 0); });
    results.sort((a, b) => b.score - a.score);

    const best = Math.min(...prices);
    const msrp = raw[0]?.extracted_old_price || Math.round(best * 1.3);
    const topScore = results[0]?.score || 0;
    const signal = topScore >= 75 ? 'BUY NOW' : topScore >= 55 ? 'GOOD DEAL' : 'WAIT';

    res.json({
      results, query: q, source: 'serpapi',
      product: {
        name: raw[0]?.title || q, thumbnail: raw[0]?.thumbnail || null,
        best_price: best, msrp, save_pct: Math.round((1 - best / msrp) * 100),
      },
      analytics: {
        deal_score: topScore, signal,
        trend: topScore > 70 ? 'falling' : 'stable',
        retailer_count: results.length,
        free_ship_count: results.filter(r => r.ship_cost === 0).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message, fallback: true });
  }
};
