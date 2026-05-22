const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const start = Date.now();
  
  const checks = { status: 'ok', timestamp: new Date().toISOString(), latency: {} };
  
  // Check Supabase
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const t = Date.now();
    await sb.from('profiles').select('count').limit(1);
    checks.latency.supabase = Date.now() - t + 'ms';
    checks.supabase = 'connected';
  } catch(e) {
    checks.supabase = 'error: ' + e.message.slice(0,50);
    checks.status = 'degraded';
  }
  
  // Check SerpAPI
  try {
    const t = Date.now();
    const r = await fetch(`https://serpapi.com/account?api_key=${process.env.SERP_API_KEY}`);
    const d = await r.json();
    checks.latency.serp = Date.now() - t + 'ms';
    checks.serp = d.account_id ? 'connected' : 'error';
    checks.serp_searches_left = d.plan_searches_left;
  } catch(e) {
    checks.serp = 'error';
    checks.status = 'degraded';
  }
  
  checks.latency.total = Date.now() - start + 'ms';
  checks.version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,8) || 'local';
  
  res.status(checks.status === 'ok' ? 200 : 503).json(checks);
};
