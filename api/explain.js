// /api/explain.js — OpenAI powered intelligence layer
// 1. Parses natural language query into structured filter JSON (variant schema)
// 2. Generates deal explanation grounded in real SerpAPI numbers
// 3. Returns coupon-adjusted insight + pros/cons + buy timing

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const { query, product, analytics, top_results, mode } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    // MODE 1: Parse natural language into structured filter schema
    if (mode === 'parse_filters') {
      const filterPrompt = `You are a product search parser for a shopping comparison engine.

Parse this search query into a structured filter object: "${query}"

Return ONLY a JSON object in this exact schema:
{
  "brand": "brand name or null",
  "model": "product model/line or null",
  "category": "product category or null",
  "gender": "men | women | unisex | null",
  "color": "color or null",
  "size": "size value or null",
  "width": "width e.g. D, 2E or null",
  "inseam": "inseam in inches or null",
  "condition": "new | used | refurbished | null",
  "price_min": number or null,
  "price_max": number or null,
  "shipping_preference": "free | fast | any",
  "coupon_only": false,
  "canonical_query": "cleaned up search query for API"
}

Examples:
"lululemon align leggings size 6 black 25 inseam" → brand: Lululemon, model: Align, category: Leggings, color: black, size: 6, inseam: "25\""
"adidas ultraboost men size 11 wide" → brand: Adidas, model: Ultraboost, gender: men, size: 11, width: 2E
"used iphone 16 pro under 800" → condition: used, brand: Apple, model: iPhone 16 Pro, price_max: 800`;

      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', input: filterPrompt, store: false }),
      });

      if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
      const data = await resp.json();
      const text = extractText(data);
      const json = parseJSON(text);
      return res.status(200).json({ filters: json, mode: 'parse_filters' });
    }

    // MODE 2: Deal explanation (default) — grounded in real SerpAPI numbers
    const context = buildExplainContext(query, product, analytics, top_results || []);

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', input: context, store: false }),
    });

    if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
    const data = await resp.json();
    const text = extractText(data);
    const json = parseJSON(text);

    return res.status(200).json(json || {
      insight: fallbackInsight(query, product, analytics),
      signal: analytics?.signal || 'GOOD DEAL',
      pros: ['Multiple retailers with competitive pricing', 'Price comparison complete'],
      cons: ['Verify availability before purchasing'],
      best_time_to_buy: 'Prices are within normal range — good time to buy',
      confidence: analytics?.deal_score || 65,
    });

  } catch (err) {
    console.error('OpenAI explain error:', err);
    return res.status(200).json({
      insight: fallbackInsight(query, product, analytics),
      signal: analytics?.signal || 'GOOD DEAL',
      pros: ['Competitive pricing found across retailers'],
      cons: ['Verify stock before purchasing'],
      best_time_to_buy: 'Standard pricing — no urgency',
      confidence: 60,
    });
  }
};

function extractText(data) {
  let text = '';
  if (data.output) {
    for (const item of data.output) {
      if (item.type === 'message' && item.content) {
        for (const c of item.content) {
          if (c.type === 'output_text') text += c.text;
        }
      }
    }
  }
  return text || (data.choices?.[0]?.message?.content || '');
}

function parseJSON(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

function buildExplainContext(query, product, analytics, topResults) {
  const hasCoupons = topResults.filter(r => r.coupon).length > 0;
  const couponLine = hasCoupons ? `\nCoupons available: ${topResults.filter(r => r.coupon).map(r => `${r.store} (${r.coupon?.label || 'code available'})`).join(', ')}` : '';
  const resultLines = topResults.slice(0, 6).map((r, i) =>
    `${i+1}. ${r.store}: $${r.price?.toFixed(2)}${r.ship_cost === 0 ? ' (free ship)' : ` +$${r.ship_cost} ship`} | delivered $${r.delivered_total?.toFixed(2)} | score ${r.score}/100${r.coupon ? ` | coupon: ${r.coupon.label}` : ''}`
  ).join('\n');

  return `You are a deal analyst for R.E.A.L. SmartScan. Analyze these REAL live prices from Google Shopping.

Product: "${query}"
Best price: $${product?.best_price?.toFixed(2) || '?'}
Best delivered: $${product?.best_delivered?.toFixed(2) || '?'}
MSRP: $${product?.msrp?.toFixed(2) || '?'}
Savings: ${product?.save_pct || 0}%
Deal score: ${analytics?.deal_score || 0}/100
Signal: ${analytics?.signal || 'GOOD DEAL'}
Trend: ${analytics?.trend || 'stable'}
Retailers found: ${analytics?.retailer_count || 0}
Free shipping options: ${analytics?.free_ship_count || 0}${couponLine}

Top offers (LIVE from Google Shopping):
${resultLines}

Return ONLY a JSON object:
{
  "insight": "2-3 sentences about current pricing, whether it's a genuine deal, and what's driving the price",
  "signal": "${analytics?.signal || 'GOOD DEAL'}",
  "pros": ["specific pro 1", "specific pro 2", "specific pro 3"],
  "cons": ["specific con 1", "specific con 2"],
  "best_time_to_buy": "specific timing recommendation",
  "coupon_note": "mention if any coupons could reduce the price further, or null",
  "confidence": ${analytics?.deal_score || 65}
}`;
}

function fallbackInsight(query, product, analytics) {
  const pct = product?.save_pct || 0;
  const count = analytics?.retailer_count || 0;
  if (pct > 25) return `${query} is at an exceptional ${pct}% discount across ${count} retailers. Strong buy signal.`;
  if (pct > 10) return `${query} is ${pct}% below MSRP across ${count} retailers with competitive pricing.`;
  return `${query} is available from ${count} retailers. Compare delivered totals including shipping.`;
}
