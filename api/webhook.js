// Stripe webhook — updates user tier in Supabase after payment
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];
  
  let event;
  try {
    if (WEBHOOK_SECRET && sig) {
      // Verify signature
      const payload = JSON.stringify(req.body);
      const [, ts] = sig.match(/t=(\d+)/) || [];
      const [, v1] = sig.match(/v1=([a-f0-9]+)/) || [];
      const computed = crypto.createHmac('sha256', WEBHOOK_SECRET)
        .update(`${ts}.${payload}`).digest('hex');
      if (computed !== v1) return res.status(400).json({ error: 'Invalid signature' });
    }
    event = req.body;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const TIER_MAP = {
    [process.env.STRIPE_PRIME_PRICE_ID]:     'prime',
    [process.env.STRIPE_SMARTCAST_PRICE_ID]: 'smartcast_pro',
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const tier   = session.metadata?.tier || 'prime';
    if (userId) {
      await supabase.from('profiles').update({
        tier, stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        subscription_status: 'active', updated_at: new Date().toISOString(),
      }).eq('id', userId);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await supabase.from('profiles').update({
      tier: 'free', subscription_status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('stripe_subscription_id', sub.id);
  }

  res.json({ received: true });
};
