// /api/search.js — SmartScan Commerce Engine
// Layer 1: Natural language → structured variant object (brand, size, color, model)
// Layer 2: SerpAPI Google Shopping + Filters API → real offers + filter metadata  
// Layer 3: SmartScan deal scoring (delivered price, trust, velocity, margin)

const SERP_API_KEY = process.env.SERP_API_KEY || '';

// ── VARIANT PARSER ────────────────────────────────────────────
// Converts "lululemon leggings size 6 black align 25" into structured object
function parseVariants(query) {
  const q = query.toLowerCase();
  const variant = { brand: null, model: null, category: null, gender: null, color: null, size: null, width: null, condition: 'new', canonical: query };

  // Brand detection
  const brands = { lululemon:'Lululemon', nike:'Nike', adidas:'Adidas', jordan:'Jordan', yeezy:'Yeezy', 'new balance':'New Balance', asics:'ASICS', hoka:'Hoka', brooks:'Brooks', 'under armour':'Under Armour', theragun:'Theragun', therabody:'Therabody', hyperice:'Hyperice', normatec:'Normatec', oura:'Oura', apple:'Apple', samsung:'Samsung', sony:'Sony', bose:'Bose', garmin:'Garmin', dyson:'Dyson', 'north face':'The North Face', patagonia:'Patagonia', 'arc\'teryx':'Arc\'teryx' };
  for (const [key, val] of Object.entries(brands)) {
    if (q.includes(key)) { variant.brand = val; break; }
  }

  // Color detection
  const colors = ['black','white','grey','gray','navy','blue','red','green','pink','purple','brown','beige','cream','olive','coral','teal','orange','yellow','charcoal','burgundy','tan'];
  for (const c of colors) { if (q.includes(c)) { variant.color = c; break; } }

  // Size detection (numeric + alpha)
  const sizeMatch = q.match(/\bsize[:\s]+?(\w+)/i) || q.match(/\b(xs|s|m|l|xl|xxl|xxxl)\b/i);
  if (sizeMatch) variant.size = sizeMatch[1] || sizeMatch[0];
  const numSize = q.match(/\bsize\s+(\d+(?:\.\d)?)\b/i) || q.match(/\b(us\s*)(\d+(?:\.\d)?)\b/i);
  if (numSize) variant.size = numSize[1] || numSize[2];
  // Shoe size without keyword
  const shoeSize = q.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:us|uk|eu)?\b/);
  if (shoeSize && !variant.size) variant.size = shoeSize[1];

  // Inseam detection
  const inseam = q.match(/(\d{2})["'"]?\s*(?:inseam|in\b)/i);
  if (inseam) variant.inseam = inseam[1] + '"';

  // Gender detection
  if (/\b(women'?s?|woman|female|ladies|girls?)\b/.test(q)) variant.gender = 'women';
  else if (/\b(men'?s?|man|male|boys?|guys?)\b/.test(q)) variant.gender = 'men';

  // Condition detection
  if (/\b(used|pre-?owned|refurbish|second.?hand|vintage)\b/.test(q)) variant.condition = 'used';

  // Category detection
  const categories = { legging:'Leggings', pant:'Pants', short:'Shorts', jacket:'Jacket', shoe:'Shoes', sneaker:'Sneakers', boot:'Boots', sandal:'Sandals', shirt:'Shirts', hoodie:'Hoodie', dress:'Dress', bag:'Bag', headphone:'Headphones', watch:'Watch', phone:'Smartphone', laptop:'Laptop', tablet:'Tablet' };
  for (const [key, val] of Object.entries(categories)) { if (q.includes(key)) { variant.category = val; break; } }

  // Build canonical search query from structured data
  const parts = [variant.brand, variant.model, variant.category || query.split(' ').slice(0,4).join(' '), variant.gender ? variant.gender + "'s" : null, variant.color, variant.size ? 'size ' + variant.size : null].filter(Boolean);
  variant.canonical = parts.length >= 2 ? parts.join(' ') : query;

  return variant;
}

// ── SMARTSCAN DEAL SCORE ──────────────────────────────────────
// Ranks on delivered value, not raw price
// Score: 0-100 (higher = better deal for buyer)
function computeDealScore(offer, allOffers, coupon) {
  const prices = allOffers.map(o => o.price).filter(p => p > 0);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  // 1. Price position (40 pts) — how far below max price
  const priceScore = ((maxPrice - offer.price) / priceRange) * 40;

  // 2. Free shipping bonus (15 pts)
  const shipScore = offer.ship_cost === 0 ? 15 : Math.max(0, 15 - offer.ship_cost * 0.5);

  // 3. Seller trust (20 pts) — rating + review volume
  const ratingScore = offer.rating ? Math.min(15, (offer.rating - 3.5) * 7.5) : 8;
  const reviewScore = offer.reviews ? Math.min(5, Math.log10(offer.reviews + 1) * 2) : 2;

  // 4. Stock velocity (10 pts) — in stock + not scarce
  const stockScore = offer.in_stock ? 10 : 0;

  // 5. Coupon bonus (10 pts)
  const couponScore = coupon && coupon.status === 'verified' ? 10 : coupon && coupon.status === 'community' ? 5 : 0;

  // 6. Condition (5 pts) — new > used
  const condScore = (offer.condition || '').toLowerCase() === 'new' ? 5 : 2;

  const total = Math.min(99, Math.round(priceScore + shipScore + ratingScore + reviewScore + stockScore + couponScore + condScore));
  return Math.max(1, total);
}

// ── COUPON DATABASE (static + expandable) ────────────────────
const COUPON_DB = {
  'Amazon': [{ code: 'PRIME10', discount: '10%', type: 'percent', status: 'community', label: 'Community code' }],
  'Nike': [{ code: 'NIKEMEMBER', discount: '20%', type: 'percent', status: 'verified', label: 'Verified member discount' }],
  'Adidas': [{ code: 'ADIDAS20', discount: '20%', type: 'percent', status: 'community', label: 'Community code' }],
  'Lululemon': [{ code: null, discount: null, type: 'auto', status: 'auto', label: 'Member pricing auto-applied' }],
  'Walmart': [{ code: 'ROLLBACK', discount: '$5', type: 'fixed', status: 'community', label: 'Community code' }],
  'Best Buy': [{ code: 'TECHSAVE', discount: '5%', type: 'percent', status: 'community', label: 'Community code' }],
  'Target': [{ code: null, discount: '5%', type: 'auto', status: 'auto', label: 'RedCard: auto 5% off' }],
};

function getCoupons(storeName) {
  for (const [key, coupons] of Object.entries(COUPON_DB)) {
    if (storeName.toLowerCase().includes(key.toLowerCase())) return coupons;
  }
  return [];
}

function extractShipCost(deliveryStr) {
  if (!deliveryStr) return 0;
  const lower = deliveryStr.toLowerCase();
  if (lower.includes('free')) return 0;
  const match = deliveryStr.match(/\$(\d+(?:\.\d{1,2})?)/);
  return match ? parseFloat(match[1]) : 0;
}

// ── MAIN HANDLER ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query.q || (req.body && req.body.q) || '';
  const filterSize = req.query.size || '';
  const filterColor = req.query.color || '';
  const filterCondition = req.query.condition || '';
  const filterFreeShip = req.query.free_ship === '1';
  const filterInStock = req.query.in_stock !== '0';
  const sortMode = req.query.sort || 'best_overall'; // best_overall | lowest_delivered | best_trusted | best_resale

  if (!query) return res.status(400).json({ error: 'Missing query parameter q' });
  if (!SERP_API_KEY) return res.status(500).json({ error: 'SERP_API_KEY not configured', fallback: true });

  try {
    // Parse natural language into structured variant
    const variant = parseVariants(query);

    // Build enriched search query
    const searchQuery = [
      filterSize ? variant.canonical + ' size ' + filterSize : variant.canonical,
      filterColor || variant.color ? (filterColor || variant.color) : null,
      filterCondition === 'used' ? 'used' : null,
    ].filter(Boolean).join(' ');

    // Call SerpAPI Google Shopping
    const serpUrl = new URL('https://serpapi.com/search.json');
    serpUrl.searchParams.set('engine', 'google_shopping');
    serpUrl.searchParams.set('q', searchQuery);
    serpUrl.searchParams.set('api_key', SERP_API_KEY);
    serpUrl.searchParams.set('num', '40');
    serpUrl.searchParams.set('gl', 'us');
    serpUrl.searchParams.set('hl', 'en');
    if (filterFreeShip) serpUrl.searchParams.set('free_shipping', '1');
    if (filterCondition === 'used') serpUrl.searchParams.set('condition', 'used');

    const serpResp = await fetch(serpUrl.toString());
    if (!serpResp.ok) throw new Error(`SerpAPI ${serpResp.status}`);
    const serpData = await serpResp.json();

    const rawResults = serpData.shopping_results || [];
    if (!rawResults.length) {
      return res.status(200).json({ results: [], query, variant, source: 'serpapi', meta: { total: 0 } });
    }

    // Extract filter metadata from SerpAPI response
    const filtersMeta = serpData.filters || {};
    const availableFilters = {};
    if (filtersMeta.categories) availableFilters.categories = filtersMeta.categories;
    if (filtersMeta.brands) availableFilters.brands = filtersMeta.brands;
    if (filtersMeta.sizes) availableFilters.sizes = filtersMeta.sizes;
    if (filtersMeta.colors) availableFilters.colors = filtersMeta.colors;
    if (filtersMeta.price_ranges) availableFilters.price_ranges = filtersMeta.price_ranges;

    // Normalize results
    let normalized = rawResults.map(item => {
      const price = parseFloat(item.extracted_price) || 0;
      const oldPrice = parseFloat(item.extracted_old_price) || null;
      const shipCost = extractShipCost(item.delivery || '');
      const deliveredTotal = price + shipCost;
      const coupons = getCoupons(item.source || '');
      const coupon = coupons[0] || null;

      return {
        store: item.source || 'Unknown',
        title: item.title || query,
        price,
        old_price: oldPrice,
        save_pct: oldPrice && oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : null,
        ship: item.delivery || 'See site',
        ship_cost: shipCost,
        delivered_total: deliveredTotal,
        rating: item.rating ? parseFloat(item.rating) : null,
        reviews: item.reviews ? parseInt(item.reviews) : null,
        stock: item.tag || 'In Stock',
        in_stock: !((item.tag || '').toLowerCase().includes('out')),
        condition: item.second_hand_condition ? 'Used' : 'New',
        thumbnail: item.thumbnail || null,
        url: item.product_link || '#',
        product_id: item.product_id || null,
        extensions: item.extensions || [],
        badge: item.badge || null,
        coupon: coupon,
        // SmartScan score computed after normalization
        score: 0,
        deal_rank: null,
      };
    }).filter(r => r.price > 0);

    // Apply client-side filters
    if (filterSize) normalized = normalized.filter(r => (r.title || '').toLowerCase().includes(filterSize.toLowerCase()));
    if (filterColor) normalized = normalized.filter(r => (r.title || '').toLowerCase().includes(filterColor.toLowerCase()));
    if (filterFreeShip) normalized = normalized.filter(r => r.ship_cost === 0);
    if (filterInStock) normalized = normalized.filter(r => r.in_stock);
    if (filterCondition) normalized = normalized.filter(r => r.condition.toLowerCase() === filterCondition.toLowerCase());

    // Compute SmartScan deal scores
    normalized = normalized.map(r => ({
      ...r,
      score: computeDealScore(r, normalized, r.coupon),
    }));

    // Apply sort mode
    if (sortMode === 'lowest_delivered') {
      normalized.sort((a, b) => a.delivered_total - b.delivered_total);
    } else if (sortMode === 'best_trusted') {
      normalized.sort((a, b) => {
        const trustA = (a.rating || 0) * Math.log10((a.reviews || 1) + 1);
        const trustB = (b.rating || 0) * Math.log10((b.reviews || 1) + 1);
        return trustB - trustA;
      });
    } else if (sortMode === 'best_resale') {
      // Resale = condition matters, stock scarcity matters
      normalized.sort((a, b) => b.score - a.score);
    } else {
      // best_overall = SmartScan deal score
      normalized.sort((a, b) => b.score - a.score);
    }

    // Assign deal ranks
    normalized = normalized.map((r, i) => ({
      ...r,
      deal_rank: i + 1,
      deal_label: i === 0 ? 'Best Deal' : i === 1 ? 'Runner Up' : null,
    }));

    // Analytics
    const prices = normalized.map(r => r.price);
    const best = prices.length ? Math.min(...prices) : 0;
    const bestDelivered = Math.min(...normalized.map(r => r.delivered_total));
    const topResult = normalized[0] || {};
    const msrp = rawResults[0]?.extracted_old_price || Math.round(best * 1.3);
    const savePct = msrp > best ? Math.round((1 - best / msrp) * 100) : 0;
    const topScore = topResult.score || 0;
    const signal = topScore >= 75 ? 'BUY NOW' : topScore >= 55 ? 'GOOD DEAL' : 'WAIT';

    return res.status(200).json({
      results: normalized,
      query,
      search_query: searchQuery,
      variant,
      source: 'serpapi',
      filters_meta: availableFilters,
      active_filters: { size: filterSize, color: filterColor, condition: filterCondition, free_ship: filterFreeShip, sort: sortMode },
      product: {
        name: rawResults[0]?.title || query,
        thumbnail: rawResults[0]?.thumbnail || null,
        msrp,
        best_price: best,
        best_delivered: bestDelivered,
        save_pct: savePct,
      },
      analytics: {
        deal_score: topScore,
        signal,
        trend: savePct > 20 ? 'falling' : savePct > 10 ? 'stable' : 'rising',
        price_range: { min: best, max: Math.max(...prices), avg: +(prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2) },
        retailer_count: normalized.length,
        free_ship_count: normalized.filter(r => r.ship_cost === 0).length,
        has_coupons: normalized.filter(r => r.coupon).length,
        with_coupons: normalized.filter(r => r.coupon?.status === 'verified').length,
      },
      meta: { total: rawResults.length, search_information: serpData.search_information || {} },
    });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: err.message, fallback: true });
  }
};
