const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Get current live broadcasts
    const { data } = await supabase
      .from('smartcast_submissions')
      .select('*')
      .eq('status', 'live')
      .order('views', { ascending: false })
      .limit(10);
    return res.json({ live: data || [], cdn: 'Akamai Linode Edge' });
  }

  if (req.method === 'POST') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).end();
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).end();

    const { submission_id, action } = req.body || {};
    if (!submission_id || !['go_live', 'end_live'].includes(action)) {
      return res.status(400).json({ error: 'Missing submission_id or invalid action' });
    }

    const newStatus = action === 'go_live' ? 'live' : 'approved';
    await supabase.from('smartcast_submissions')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', submission_id).eq('user_id', user.id);

    return res.json({ status: newStatus, message: action === 'go_live' ? '🔴 You are LIVE on SmartCast!' : 'Broadcast ended' });
  }
};
