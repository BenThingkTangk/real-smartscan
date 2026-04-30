// Stripe subscription checkout session
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PLANS = {
  prime: {
    name: 'Prime Elite',
    price_id: process.env.STRIPE_PRIME_PRICE_ID || null,
    amount: 999, // $9.99 in cents
    interval: 'month',
  },
  smartcast_pro: {
    name: 'SmartCast Pro',
    price_id: process.env.STRIPE_SMARTCAST_PRICE_ID || null,
    amount: 4900, // $49 in cents
    interval: 'month',
  },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { tier } = req.body || {};
  const plan = PLANS[tier];
  if (!plan) return res.status(400).json({ error: 'Invalid tier. Must be prime or smartcast_pro.' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  let user = null;
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    user = data?.user;
  }

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  
  // If no Stripe key yet — return a clear message with setup instructions
  if (!STRIPE_KEY) {
    return res.status(503).json({
      error: 'Payment processing not yet configured',
      message: 'Stripe integration coming soon. Contact support@real-smartscan.com to be notified.',
      plan: plan.name,
      price: `$${(plan.amount / 100).toFixed(2)}/month`,
      setup_required: ['STRIPE_SECRET_KEY', 'STRIPE_PRIME_PRICE_ID', 'STRIPE_SMARTCAST_PRICE_ID', 'STRIPE_WEBHOOK_SECRET'],
    });
  }

  try {
    // Dynamic Stripe integration via fetch (no npm install needed)
    const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'mode': 'subscription',
        'line_items[0][price]': plan.price_id,
        'line_items[0][quantity]': '1',
        'success_url': `${process.env.NEXT_PUBLIC_SITE_URL || 'https://real-smartscan.vercel.app'}/#/dashboard?upgraded=1`,
        'cancel_url': `${process.env.NEXT_PUBLIC_SITE_URL || 'https://real-smartscan.vercel.app'}/#/membership`,
        ...(user?.email ? { 'customer_email': user.email } : {}),
        'metadata[user_id]': user?.id || '',
        'metadata[tier]': tier,
      }),
    });
    const session = await stripeResp.json();
    if (session.error) throw new Error(session.error.message);
    return res.json({ checkout_url: session.url, session_id: session.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
