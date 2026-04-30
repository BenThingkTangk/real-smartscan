// Nightly alert checker — called by Vercel cron
// For each untriggered alert, checks current price and sends push/email if triggered
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const hasSecret = req.headers['x-cron-secret'] === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) return res.status(401).end();

  // Get untriggered alerts
  const { data: alerts } = await supabase
    .from('price_alerts')
    .select('*')
    .eq('triggered', false)
    .limit(50);

  if (!alerts?.length) return res.json({ checked: 0 });

  const SERP_KEY = process.env.SERP_API_KEY || '';
  let triggered = 0;

  for (const alert of alerts) {
    try {
      // Get current price
      if (SERP_KEY) {
        const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(alert.query)}&api_key=${SERP_KEY}&num=10&gl=us`;
        const resp = await fetch(url);
        const data = await resp.json();
        const prices = (data.shopping_results || []).map(r => r.extracted_price).filter(p => p > 0);
        const currentBest = prices.length ? Math.min(...prices) : null;

        if (currentBest && currentBest <= alert.target_price) {
          // Trigger alert — send push notification if subscription exists
          const { data: pushSub } = await supabase
            .from('push_subscriptions')
            .select('*')
            .eq('user_id', alert.user_id)
            .single();

          if (pushSub && process.env.VAPID_PRIVATE_KEY) {
            // Send web push via fetch (manual VAPID, no library)
            // For now just mark as triggered and send email
          }

          // Send email via Resend
          const RESEND_KEY = process.env.RESEND_API_KEY;
          if (RESEND_KEY && alert.email) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'alerts@real-smartscan.com',
                to: alert.email,
                subject: `Price Alert: ${alert.query} is now $${currentBest}`,
                html: `
                  <div style="font-family:Inter,sans-serif;background:#0F172A;color:#E2E8F0;padding:32px;border-radius:12px;max-width:600px">
                    <h2 style="color:#F97316;margin:0 0 16px">🎯 Price Alert Triggered!</h2>
                    <p style="font-size:18px;font-weight:700">${alert.query}</p>
                    <p>Current best price: <strong style="color:#10B981;font-size:24px">$${currentBest}</strong></p>
                    <p style="color:#94A3B8">Your target was: $${alert.target_price}</p>
                    <a href="https://real-smartscan.vercel.app/#/search?q=${encodeURIComponent(alert.query)}" 
                       style="display:inline-block;background:#F97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">
                      View Deal Now →
                    </a>
                  </div>
                `,
              }),
            });
          }

          // Mark as triggered
          await supabase.from('price_alerts').update({
            triggered: true,
            triggered_at: new Date().toISOString(),
          }).eq('id', alert.id);
          triggered++;
        }
      }
    } catch {}
  }

  return res.json({ checked: alerts.length, triggered });
};
