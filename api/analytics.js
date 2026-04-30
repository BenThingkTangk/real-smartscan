// PostHog server-side event tracking
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { event_type, query, result_count, best_price, deal_score, session_id } = req.body || {};
  if (!event_type || !query) return res.status(400).json({ error: 'Missing fields' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  let userId = null;
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token);
    userId = user?.id || null;
  }

  await supabase.from('search_events').insert({
    user_id: userId, session_id, query, event_type,
    result_count, best_price, deal_score
  });

  // Also forward to PostHog if key available
  const PH_KEY = process.env.POSTHOG_API_KEY;
  if (PH_KEY) {
    await fetch('https://app.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: PH_KEY,
        event: event_type,
        distinct_id: userId || session_id || 'anonymous',
        properties: { query, result_count, best_price, deal_score, source: 'smartscan-api' }
      })
    }).catch(() => {});
  }

  res.json({ ok: true });
};
