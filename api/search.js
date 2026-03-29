// /api/search — SerpAPI Google Shopping layer
// Architecture from PDF: Search/data layer → ranking/analytics → LLM summary/UI
// SerpAPI returns structured: extracted_price, seller, rating, reviews, delivery, thumbnail

const SERP_API_KEY = process.env.SERP_API_KEY || '';

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query.q || (req.body && req.body.q) || '';
  if (!query) return res.status(400).json({ error: 'Missing query parameter q' });

  if (!SERP_API_KEY) {
    return res.status(500).json({ error: 'SERP_API_KEY not configured', fallback: true });
  }

  try {
    // Step 1: Fetch SerpAPI Google Shopping results
    const serpUrl = new URL('https://serpapi.com/search.json');
    serpUrl.searchParams.set('engine', 'google_shopping');
    serpUrl.searchParams.set('q', query);
    serpUrl.searchParams.set('api_key', SERP_API_KEY);
    serpUrl.searchParams.set('num', '20');
    serpUrl.searchParams.set('gl', 'us');
    serpUrl.searchParams.set('hl', 'en');

    const serpResp = await fetch(serpUrl.toString());
    if (!serpResp.ok) {
      throw new Error(`SerpAPI error ${serpResp.status}: ${await serpResp.text()}`);
    }
    const serpData = await serpResp.json();

    const rawResults = serpData.shopping_results || [];
    if (rawResults.length === 0) {
      return res.status(200).json({ results: [], query, source: 'serpapi', meta: { total: 0 } });
    }

    // Step 2: Normalize SerpAPI results into unified schema
    const normalized = rawResults.map(item => {
      const price = item.extracted_price || 0;
      const oldPrice = item.extracted_old_price || null;
      const shipCost = extractShipCost(item.delivery || '');
      const total = price + shipCost;

      return {
        store: item.source || 'Unknown',
        title: item.title || query,
        price: price,
        old_price: oldPrice,
        save_pct: oldPrice && oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : null,
        ship: item.delivery || 'See site',
        ship_cost: shipCost,
        total: total,
        rating: item.rating || null,
        reviews: item.reviews || null,
        stock: item.tag || 'In Stock',
        in_stock: !((item.tag || '').toLowerCase().includes('out')),
        condition: item.second_hand_condition ? 'Used' : 'New',
        thumbnail: item.thumbnail || null,
        url: item.product_link || '#',
        position: item.position || 0,
        extensions: item.extensions || [],
        badge: item.badge || null,
      };
    })
    .filter(r => r.price > 0)
    .sort((a, b) => a.price - b.price);

    // Step 3: Compute analytics
    const prices = normalized.map(r => r.price);
    const best = prices.length ? Math.min(...prices) : 0;
    const worst = prices.length ? Math.max(...prices) : 0;
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

    // Get product info from first result
    const firstResult = rawResults[0] || {};
    const msrp = firstResult.extracted_old_price || Math.round(best * 1.3);
    const savePct = msrp > best ? Math.round((1 - best / msrp) * 100) : 0;

    // Step 4: Build rank tiers
    const dealScore = Math.min(99, Math.round(
      (savePct * 0.6) +
      (normalized.filter(r => r.ship_cost === 0).length / normalized.length * 30) +
      (normalized[0]?.rating ? normalized[0].rating * 5 : 15)
    ));

    const trend = savePct > 20 ? 'falling' : savePct > 10 ? 'stable' : 'rising';
    const signal = dealScore >= 75 ? 'BUY NOW' : dealScore >= 55 ? 'GOOD DEAL' : 'WAIT';

    return res.status(200).json({
      results: normalized,
      query,
      source: 'serpapi',
      product: {
        name: firstResult.title || query,
        thumbnail: firstResult.thumbnail || null,
        msrp,
        best_price: best,
        save_pct: savePct,
      },
      analytics: {
        deal_score: dealScore,
        signal,
        trend,
        price_range: { min: best, max: worst, avg: Math.round(avg * 100) / 100 },
        retailer_count: normalized.length,
        free_shipping_count: normalized.filter(r => r.ship_cost === 0).length,
      },
      meta: {
        total: rawResults.length,
        search_information: serpData.search_information || {},
      },
    });

  } catch (err) {
    console.error('SerpAPI error:', err);
    return res.status(500).json({ error: err.message, fallback: true });
  }
}

function extractShipCost(deliveryStr) {
  if (!deliveryStr) return 0;
  const lower = deliveryStr.toLowerCase();
  if (lower.includes('free')) return 0;
  const match = deliveryStr.match(/\$(\d+(?:\.\d{1,2})?)/);
  return match ? parseFloat(match[1]) : 0;
}
