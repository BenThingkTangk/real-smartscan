// /api/search — SmartScan v2 Commerce Engine
// SerpAPI Google Shopping + SmartScan deal scoring + barcode support

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

// ── BARCODE LOOKUP — Open Food Facts (free, no key) ────────────────
async function lookupBarcode(code) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`, {
      headers: { 'User-Agent': 'SmartScan/2.0' }
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.status !== 1) return null;
    const p = d.product;
    return {
      name: p.product_name || p.abbreviated_product_name || null,
      image: p.image_url || p.image_front_url || null,
      brand: p.brands || null,
      category: p.categories_tags?.[0]?.replace('en:', '') || null,
    };
  } catch { return null; }
}


// —— EXTRACT IMAGES from immersive_products (no extra API call) ——————
function extractImagesFromImmersive(immersiveProducts) {
  if (!immersiveProducts || immersiveProducts.length === 0) return [];
  
  // Extract high-quality images from immersive products
  const images = [];
  for (const product of immersiveProducts.slice(0, 6)) {
    if (product.image) images.push(product.image);
    if (product.thumbnail) images.push(product.thumbnail);
  }
  
  // Return unique images, up to 6
  return [...new Set(images)].slice(0, 6);
}


// ── FULL RESULT MAPPER — extracts ALL fields from SerpAPI ──────────
const mapResult = (r) => ({
  store: r.source || r.store || 'Unknown',
  price: r.extracted_price || r.price?.extracted || 0,
  price_string: r.price?.value || (r.extracted_price ? `$${r.extracted_price}` : null),
  original_price: r.original_price?.extracted || r.extracted_old_price || null,
  savings: (r.original_price?.extracted || r.extracted_old_price)
    ? (r.original_price?.extracted || r.extracted_old_price) - (r.extracted_price || 0)
    : null,
  rating: r.rating || null,
  reviews: r.reviews || null,
  shipping: r.delivery || r.shipping || null,
  in_stock: r.in_stock !== false,
  condition: r.second_hand_condition || 'new',
  title: r.title || '',
      thumbnail: r.thumbnail || null,
      // Use standard SerpAPI thumbnail - most reliable image source
      thumbnail_hq: r.thumbnail || null,  product_id: r.product_id || null,
  link: r.link || r.product_link || null,
  store_rating: r.store_rating || null,
  extensions: r.extensions || [],
  tag: r.extensions?.find(e => ['Best Seller','On sale','Limited time deal','Bestseller'].some(t => e.includes(t))) || r.tag || null,
  badge: r.badge || null, // e.g. "Best seller", "Sale"
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (rateLimit(ip)) return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });

  let q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });

  // ── BARCODE DETECTION ───────────────────────────────────────────
  let barcodeProduct = null;
  const isBarcode = /^\d{8,14}$/.test(q);
  if (isBarcode) {
    barcodeProduct = await lookupBarcode(q);
    if (barcodeProduct?.name) {
      q = barcodeProduct.name;
    }
  }

  // Demo fallback when no SerpAPI key
  if (!SERP_API_KEY) {
    const mockPrices = [119.99, 124.99, 129.99, 139.99, 149.99];
    const stores = ['Amazon', 'Walmart', 'Best Buy', 'Target', 'eBay'];
    let results = stores.map((store, i) => ({
      store,
      price: mockPrices[i],
      price_string: `$${mockPrices[i]}`,
      original_price: mockPrices[i] * 1.2,
      savings: mockPrices[i] * 0.2,
      ship: i < 3 ? 'Free' : `$${5 + i * 2}`,
      ship_cost: i < 3 ? 0 : 5 + i * 2,
      shipping: i < 3 ? 'Free shipping' : `$${5 + i * 2} shipping`,
      delivered_total: mockPrices[i] + (i < 3 ? 0 : 5 + i * 2),
      rating: parseFloat((4.2 + i * 0.1).toFixed(1)),
      reviews: 1200 * (5 - i),
      in_stock: true,
      condition: 'new',
      thumbnail: null,
      thumbnail_hq: null,
      title: `${q} — ${store}`,
      url: '#',
      link: '#',
      score: 0,
      extensions: i < 2 ? ['Free returns', '2-day delivery'] : i < 3 ? ['Free returns'] : [],
      tag: i === 0 ? 'Best seller' : null,
      store_rating: null,
      product_id: null,
    }));
    results = filterOutliers(results);
    const prices = results.map(r => r.price);
    results.forEach(r => { r.score = dealScore(r.price, prices, r.rating, r.ship_cost === 0); });
    results.sort((a, b) => b.score - a.score);
    const marketBest = Math.min(...prices);
    const avg90day = marketBest * 1.12;
    const cat = (req.query.category || 'Electronics');
    const categoryRate = { Electronics: 0.06, Health: 0.09, Supplements: 0.15, Fashion: 0.08, Gaming: 0.06 };
    const takeRate = categoryRate[cat] || 0.08;
    const smartscanPrice = +(marketBest * (1 + takeRate)).toFixed(2);

    
      // Fetch real product images from Google Images
const knowledgePanel = {
      name: q,
      description: '',
      thumbnail: barcodeProduct?.image || null,
    images: extractImagesFromImmersive(serpData.immersive_products || [])n),      rating: null,
      reviews: null,
      specs: [],
      pros: [],
      cons: [],
      best_price: marketBest,
      price_context: null,
    };

    return res.json({
      results, query: q, source: 'demo',
      product: {
        name: q, best_price: marketBest, msrp: Math.round(marketBest * 1.3), save_pct: 23,
        thumbnail: barcodeProduct?.image || null,
      images: extractImagesFromImmersive(serpData.immersive_products || [])an),        brand: barcodeProduct?.brand || null,
        category: barcodeProduct?.category || cat,
        price_context: {
          is_good_deal: marketBest < avg90day * 0.9,
          below_avg_pct: Math.round((1 - marketBest/avg90day) * 100),
          price_trend: 'falling',
        }
      },
      knowledge_panel: knowledgePanel,
      analytics: { deal_score: results[0].score, signal: 'GOOD DEAL', trend: 'stable', retailer_count: results.length, free_ship_count: 3 },
      smartscan_direct: {
        price: smartscanPrice,
        market_best: marketBest,
        take_rate: takeRate,
        label: 'R.E.A.L. Price — includes our service fee',
      },
      barcode: isBarcode ? { code: req.query.q, product: barcodeProduct } : null,
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
    // Request immersive_products for better image quality
    url.searchParams.set('tbs', 'mr:1');
    if (req.query.free_ship === '1') url.searchParams.set('free_shipping', '1');
    if (req.query.condition) url.searchParams.set('condition', req.query.condition);

    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`SerpAPI ${resp.status}`);
    const serpData = await resp.json();
    const raw = serpData.shopping_results || [];
    const immersive = serpData.immersive_products || [];

    // Build a thumbnail map from immersive products (higher res)
    const immersiveThumbMap = {};
    immersive.forEach(ip => {
      if (ip.title && ip.thumbnail) immersiveThumbMap[ip.title.slice(0, 40)] = ip.thumbnail;
    });

    // Map results using the full field extractor
    let results = raw.filter(r => (r.extracted_price || r.price?.extracted) > 0).map(r => {
      const sc = shipCost(r.delivery || r.shipping || '');
      // Prefer higher-res image from immersive if title matches
      const titleKey = (r.title || '').slice(0, 40);
      const thumbnail = immersiveThumbMap[titleKey] || r.thumbnail || null;
      // Higher-res thumbnail from product_id
      const thumbnailHq = r.product_id
        ? `https://encrypted-tbn0.gstatic.com/shopping?q=tbn:${r.product_id}`
        : thumbnail;

      const mapped = mapResult(r);
      return {
        ...mapped,
        thumbnail: thumbnail || mapped.thumbnail,
        thumbnail_hq: thumbnailHq || mapped.thumbnail_hq,
        // Legacy fields for backward compat
        ship: r.delivery || 'See site',
        ship_cost: sc,
        delivered_total: mapped.price + sc,
        old_price: r.extracted_old_price || null,
        save_pct: r.extracted_old_price ? Math.round((1 - mapped.price / r.extracted_old_price) * 100) : null,
        url: r.product_link || r.link || '#',
        specs: r.specs || null,
        score: 0,
        inStock: mapped.in_stock,
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

    // Price context analytics
    const avg90day = prices.reduce((a, b) => a + b, 0) / prices.length || marketBest;
    const pricesLast7 = prices.slice(0, Math.ceil(prices.length / 2));
    const pricesLast14 = prices.slice(Math.ceil(prices.length / 2));
    const priceTrend = pricesLast7.reduce((a,b)=>a+b,0)/pricesLast7.length > pricesLast14.reduce((a,b)=>a+b,0)/Math.max(pricesLast14.length,1) ? 'rising' : 'falling';

    // SmartScan Direct card — market best + our margin (NEVER below market)
    const categoryRate = { Electronics: 0.06, Health: 0.09, Supplements: 0.15, Fashion: 0.08, Gaming: 0.06 };
    const cat = (req.query.category || 'Electronics');
    const takeRate = categoryRate[cat] || 0.08;
    const smartscanPrice = +(marketBest * (1 + takeRate)).toFixed(2);

    // Best product thumbnail — use highest res available
    const bestThumbnail = barcodeProduct?.image || results[0]?.thumbnail_hq || results[0]?.thumbnail || raw[0]?.thumbnail || null;

    // Collect all product images for gallery
    const allImages = [bestThumbnail, ...results.slice(0, 5).map(r => r.thumbnail_hq || r.thumbnail)].filter(Boolean);
    const uniqueImages = [...new Set(allImages)].slice(0, 6);

    // Extract Google Product Knowledge Panel data
    const productResults = serpData.product_results || {};
    const knowledgePanel = {
      name: productResults.title || serpData.search_information?.query_displayed || q,
      description: productResults.description || '',
      thumbnail: productResults.media?.[0]?.thumbnail || bestThumbnail || null,
      images: (productResults.media || []).map(m => m.thumbnail || m.image).filter(Boolean).slice(0, 6),
      rating: productResults.rating || null,
      reviews: productResults.reviews || null,
      specs: productResults.specifications || productResults.highlights || [],
      pros: productResults.pros || [],
      cons: productResults.cons || [],
      best_price: marketBest,
      price_context: {
        is_good_deal: marketBest < avg90day * 0.9,
        below_avg_pct: Math.round((1 - marketBest/avg90day) * 100),
        price_trend: priceTrend,
      },
    };

    // After building knowledgePanel, enrich with additional SerpAPI fields
    knowledgePanel.description = productResults.description ||
      productResults.snippet ||
      (productResults.highlights || []).join('. ') || '';

    // Extract brand from title or extensions
    knowledgePanel.brand = productResults.brand ||
      (results[0]?.title?.split(' ')[0]) || '';

    // Extract pros/cons from SerpAPI if available
    knowledgePanel.pros = (productResults.pros || []).slice(0, 4);
    knowledgePanel.cons = (productResults.cons || []).slice(0, 3);

    // Extract key specs from highlights/specifications
    knowledgePanel.key_specs = (productResults.specifications || [])
      .slice(0, 6)
      .map(s => ({ name: s.name || s[0], value: s.value || s[1] }));

    // Enhanced price context
    const allPricesForCtx = results.map(r => r.price).filter(p => p > 0);
    const avgPriceCtx = allPricesForCtx.length ? allPricesForCtx.reduce((a,b)=>a+b,0)/allPricesForCtx.length : 0;
    const minPriceCtx = allPricesForCtx.length ? Math.min(...allPricesForCtx) : 0;
    const maxPriceCtx = allPricesForCtx.length ? Math.max(...allPricesForCtx) : 0;
    knowledgePanel.price_context = {
      is_good_deal: minPriceCtx > 0 && minPriceCtx < avgPriceCtx * 0.92,
      below_avg_pct: avgPriceCtx > 0 ? Math.round((1 - minPriceCtx/avgPriceCtx) * 100) : 0,
      price_trend: priceTrend,
      avg_price: Math.round(avgPriceCtx * 100) / 100,
      price_spread: Math.round((maxPriceCtx - minPriceCtx) * 100) / 100,
      price_spread_pct: maxPriceCtx > 0 ? Math.round(((maxPriceCtx - minPriceCtx) / maxPriceCtx) * 100) : 0,
    };

    const responseObj = {
      results, query: q, source: 'serpapi',
      product: {
        name: raw[0]?.title || q,
        thumbnail: bestThumbnail,
        images: uniqueImages,
        brand: barcodeProduct?.brand || knowledgePanel.brand || null,
        category: barcodeProduct?.category || cat,
        best_price: marketBest, msrp,
        save_pct: Math.round((1 - marketBest / msrp) * 100),
        specs: raw[0]?.specs || productResults.specifications || null,
        description: knowledgePanel.description || '',
        pros: knowledgePanel.pros || [],
        cons: knowledgePanel.cons || [],
        key_specs: knowledgePanel.key_specs || [],
        price_context: knowledgePanel.price_context,
      },
      knowledge_panel: knowledgePanel,
      analytics: {
        deal_score: topScore, signal,
        trend: topScore > 70 ? 'falling' : 'stable',
        retailer_count: results.length,
        free_ship_count: results.filter(r => r.ship_cost === 0).length,
        avg_price: Math.round(avg90day * 100) / 100,
        price_trend: priceTrend,
      },
      smartscan_direct: {
        price: smartscanPrice,
        market_best: marketBest,
        take_rate: takeRate,
        label: 'R.E.A.L. Price — includes our service fee',
      },
      barcode: isBarcode ? { code: req.query.q, product: barcodeProduct } : null,
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
