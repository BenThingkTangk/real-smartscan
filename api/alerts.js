const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { query, targetPrice, email, pushSubscription } = req.body || {};
    if (!query || !targetPrice || !email) return res.status(400).json({ error: 'Missing fields' });
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userId = null;
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }
    const { data } = await supabase.from('price_alerts').insert({
      user_id: userId, query, target_price: targetPrice, email,
      push_subscription: pushSubscription || null,
    }).select().single();
    return res.json(data);
  }
  res.status(405).end();
};
