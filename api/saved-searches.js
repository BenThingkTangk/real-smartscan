const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  if (req.method === 'GET') {
    const { data } = await supabase.from('saved_searches').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    return res.json(data || []);
  }
  if (req.method === 'POST') {
    const { query, label } = req.body || {};
    if (!query) return res.status(400).json({ error: 'Missing query' });
    const { data } = await supabase.from('saved_searches').insert({ user_id: user.id, query, label: label || query }).select().single();
    return res.json(data);
  }
  if (req.method === 'DELETE') {
    const id = req.query.id;
    await supabase.from('saved_searches').delete().eq('id', id).eq('user_id', user.id);
    return res.json({ success: true });
  }
  res.status(405).end();
};
