// /api/explain — OpenAI GPT-4o-mini deal explanation grounded in real prices
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { query, product, analytics, top_results } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing query' });

  if (!OPENAI_API_KEY) {
    const pct = product?.save_pct || 0;
    return res.json({
      insight: `${query} is currently ${pct}% below MSRP across ${analytics?.retailer_count || 0} retailers. ${analytics?.signal === 'BUY NOW' ? 'Strong buy signal — price is near its historical low.' : 'Pricing is within a normal range for this product.'}`,
      signal: analytics?.signal || 'GOOD DEAL',
      pros: ['Competitive pricing found', 'Multiple retailers available', 'Free shipping options present'],
      cons: ['Verify stock before purchasing'],
      best_time_to_buy: 'Current pricing is favorable',
      confidence: analytics?.deal_score || 70,
    });
  }

  try {
    const topList = (top_results || []).slice(0, 4).map(r => `${r.store}: $${r.price}`).join(', ');
    const prompt = `You are a deal analyst for R.E.A.L. SmartScan. Analyze these REAL live prices.\nProduct: "${query}"\nBest price: $${product?.best_price?.toFixed(2)}\nMSRP: $${product?.msrp?.toFixed(2)}\nSavings: ${product?.save_pct}%\nDeal score: ${analytics?.deal_score}/100\nTop sellers: ${topList}\n\nReturn ONLY JSON:\n{"insight":"2-3 sentences","signal":"${analytics?.signal}","pros":["p1","p2","p3"],"cons":["c1","c2"],"best_time_to_buy":"timing","confidence":${analytics?.deal_score}}`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
    });
    const data = await resp.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
