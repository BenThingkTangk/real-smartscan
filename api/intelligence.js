// /api/intelligence — Perplexity Sonar Pro, gated behind Prime tier
// Returns: 90-day price trend, Reddit sentiment %, 3 alternatives, best-time-to-buy

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { product, priceUSD, query, tier } = req.body || {};

  // Tier gate — free users get upgrade prompt
  if (!tier || tier === 'free') {
    return res.json({
      upgrade: true,
      message: 'Upgrade to Prime Elite ($9.99/mo) to unlock Perplexity Sonar AI intelligence — 90-day price trends, Reddit community sentiment, top alternatives, and best-time-to-buy predictions.',
    });
  }

  const productName = product || query || 'this product';

  // No Perplexity key → OpenAI fallback
  if (!PERPLEXITY_API_KEY) {
    if (OPENAI_API_KEY) {
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{
              role: 'user',
              content: `You are a price intelligence analyst. For "${productName}" at $${priceUSD || 'unknown'}, provide a brief but useful analysis covering: 1) whether this price is historically good, 2) general community sentiment, 3) two or three cheaper alternatives, 4) best time to buy recommendation. Keep it concise and practical.`,
            }],
          }),
        });
        const data = await resp.json();
        return res.json({
          intelligence: data.choices[0].message.content,
          citations: [],
          source: 'openai',
        });
      } catch (e) {}
    }

    // Pure demo
    return res.json({
      intelligence: `## 90-Day Price Analysis: ${productName}\n\n**Price Trend:** Current pricing is competitive — sitting near the 30-day low based on historical patterns. The market typically sees 15–20% discounts during major sale events.\n\n**Community Sentiment:** 87% positive across deal communities in the last 7 days. Users consistently report strong value at this price point.\n\n**Top Alternatives:**\n1. **Previous generation model** — ~30% cheaper, 90% of the features\n2. **Refurbished/certified pre-owned** — ~40% off, manufacturer warranty included\n3. **Competing brand equivalent** — similar specs, ~20% cheaper\n\n**Best Time to Buy:** Now is a solid entry point. Prices have been stable for 3 weeks and this is above-average savings vs. MSRP.`,
      citations: [],
      source: 'demo',
    });
  }

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [{
          role: 'user',
          content: `Research "${productName}" at $${priceUSD || 'current market price'}. Provide a structured markdown report with:\n\n**90-Day Price Trend** — Is today's price historically good? Has it been cheaper recently?\n\n**Reddit Community Sentiment** — What percentage of recent posts/comments are positive? Which subreddits are most relevant?\n\n**3 Better Alternatives** — With approximate prices and why they might be worth considering\n\n**Best Time to Buy** — Specific recommendation based on pricing patterns\n\nUse real current web data. Be specific with numbers and dates.`,
        }],
        search_recency_filter: 'month',
      }),
    });

    if (!response.ok) throw new Error(`Perplexity ${response.status}`);
    const data = await response.json();

    res.json({
      intelligence: data.choices[0].message.content,
      citations: data.citations || [],
      source: 'perplexity-sonar-pro',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
