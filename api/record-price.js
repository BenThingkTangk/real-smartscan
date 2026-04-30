// Called by nightly cron — records current best price to price_history
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function slugify(q) { return q.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0,60); }

module.exports = async (req, res) => {
  // Allow either x-cron-secret OR Vercel's own cron header
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const hasSecret = req.headers['x-cron-secret'] === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) return res.status(401).end();
  
  const query = req.query.q || '';
  if (!query) return res.status(400).json({ error: 'Missing q' });

  // Fetch current price from search API
  const SERP_KEY = process.env.SERP_API_KEY || '';
  if (!SERP_KEY) return res.status(200).json({ skipped: true });

  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(query)}&api_key=${SERP_KEY}&num=10&gl=us&hl=en`;
  const resp = await fetch(url);
  const data = await resp.json();
  const prices = (data.shopping_results || []).map(r => r.extracted_price).filter(p => p > 0);
  if (!prices.length) return res.json({ skipped: true });

  const best = Math.min(...prices);
  const store = data.shopping_results?.find(r => r.extracted_price === best)?.source || 'unknown';
  
  await supabase.from('price_history').insert({ query, query_slug: slugify(query), price: best, store });
  return res.json({ recorded: true, price: best });
};
