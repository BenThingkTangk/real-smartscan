const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60'); // Cache 60s at edge
  
  const category = req.query.category || null;
  const limit = Math.min(parseInt(req.query.limit || '20'), 50);
  const offset = parseInt(req.query.offset || '0');

  let query = supabase
    .from('smartcast_submissions')
    .select('id, title, description, category, price, video_url, thumbnail_url, credibility_score, views, created_at')
    .in('status', ['approved', 'live'])
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Increment views asynchronously (fire and forget)
  if (data?.length && req.query.view) {
    supabase.from('smartcast_submissions')
      .update({ views: supabase.rpc('increment', { x: 1 }) })
      .eq('id', req.query.view)
      .then(() => {}).catch(() => {});
  }

  return res.json({
    broadcasts: data || [],
    total: data?.length || 0,
    cdn_provider: 'Akamai Linode',
    cache_ttl: 60,
  });
};
