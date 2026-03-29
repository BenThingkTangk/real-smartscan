// /api/explain — OpenAI Responses API explainer
// Architecture from PDF: Use OpenAI as the explainer (summaries, pros/cons, "why best deal")
// but keep the numbers coming from /api/search so the model stays grounded.
// Model: gpt-4o-mini (cost-efficient, fast, reliable tool-calling)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  const { query, product, analytics, top_results } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing query' });

  // Build a grounded context from the real SerpAPI data
  const context = buildContext(query, product, analytics, top_results || []);

  try {
    const openaiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: context,
        store: false,
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      throw new Error(`OpenAI error ${openaiResp.status}: ${errText}`);
    }

    const data = await openaiResp.json();

    // Extract text from Responses API output
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

    // Parse the structured JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(200).json({ insight: text.slice(0, 300), signal: analytics?.signal || 'GOOD DEAL', pros: [], cons: [] });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);

  } catch (err) {
    console.error('OpenAI explain error:', err);
    // Graceful fallback — generate a basic insight without AI
    return res.status(200).json({
      insight: generateFallbackInsight(query, product, analytics),
      signal: analytics?.signal || 'GOOD DEAL',
      pros: ['Competitive pricing found', 'Multiple retailers available'],
      cons: ['Verify stock before purchasing'],
      confidence: 60,
    });
  }
}

function buildContext(query, product, analytics, topResults) {
  const resultSummary = topResults.slice(0, 5).map((r, i) =>
    `${i + 1}. ${r.store}: $${r.price}${r.ship_cost === 0 ? ' (free shipping)' : ` (+$${r.ship_cost} shipping)`} - ${r.in_stock ? 'In Stock' : 'Out of Stock'}${r.rating ? ` - ${r.rating}★` : ''}`
  ).join('\n');

  return `You are a price intelligence analyst for R.E.A.L. SmartScan. Based on REAL live data from Google Shopping, provide a structured analysis.

Product searched: "${query}"
Best price found: $${product?.best_price || 'N/A'}
MSRP: $${product?.msrp || 'N/A'}
Savings: ${product?.save_pct || 0}%
Deal Score: ${analytics?.deal_score || 0}/100
Price trend: ${analytics?.trend || 'stable'}
Retailers found: ${analytics?.retailer_count || 0}

Top results (REAL prices from Google Shopping):
${resultSummary}

Respond with ONLY a JSON object in this exact format:
{
  "insight": "2-3 sentence market insight about this product's pricing right now",
  "signal": "${analytics?.signal || 'GOOD DEAL'}",
  "pros": ["pro 1", "pro 2", "pro 3"],
  "cons": ["con 1", "con 2"],
  "best_time_to_buy": "brief recommendation on timing",
  "confidence": ${analytics?.deal_score || 70}
}`;
}

function generateFallbackInsight(query, product, analytics) {
  const savePct = product?.save_pct || 0;
  const trend = analytics?.trend || 'stable';
  const count = analytics?.retailer_count || 0;
  if (savePct > 25) return `${query} is currently at an exceptional discount — ${savePct}% below MSRP across ${count} retailers. Prices are ${trend}, making this a strong buy moment.`;
  if (savePct > 10) return `${query} offers solid savings at ${savePct}% below retail. Found across ${count} retailers with competitive pricing.`;
  return `${query} is available from ${count} retailers. Compare total costs including shipping for the best overall deal.`;
}
