module.exports = (req, res) => {
  res.json({
    version: '1.0.0-ga',
    build: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,8) || 'unknown',
    env_check: {
      stripe: !!process.env.STRIPE_SECRET_KEY,
      stripe_prime: !!process.env.STRIPE_PRIME_PRICE_ID,
      stripe_smartcast: !!process.env.STRIPE_SMARTCAST_PRICE_ID,
      stripe_webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
      resend: !!process.env.RESEND_API_KEY,
      upstash_url: !!process.env.UPSTASH_REDIS_REST_URL,
      upstash_token: !!process.env.UPSTASH_REDIS_REST_TOKEN,
      supabase: !!process.env.SUPABASE_URL,
      serp: !!process.env.SERP_API_KEY,
    }
  });
};
