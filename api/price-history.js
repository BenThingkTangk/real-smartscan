// /api/price-history — 90-day simulated price history (real storage requires Supabase)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });

  // Generate deterministic 90-day history from query string hash
  const seed = q.split('').reduce((h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0);
  const rand = (s => () => { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 4294967295; })(Math.abs(seed));
  
  const basePrice = 80 + Math.abs(seed % 400);
  const now = Date.now();
  const history = Array.from({ length: 90 }, (_, i) => ({
    recordedAt: now - (89 - i) * 86400000,
    price: Math.round((basePrice + Math.sin(i * 0.3) * 15 + rand() * 20 - 10) * 100) / 100,
    store: 'Market Average',
  }));

  res.json({ history, productKey: q, is_mock: true });
};
