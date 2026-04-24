// /api/smartcast — SmartCast broadcast engine submissions
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

// In-memory store (use Supabase for persistence in production)
let submissions = [
  { id: 1, productName: 'io2-Water Hydrogen Generator', brandName: 'io2-water', description: 'Molecular hydrogen water generator with 1.2+ ppm H2 concentration. Clinically studied antioxidant benefits.', category: 'Health Devices', pricePoint: 299, credibilityScore: 84, status: 'featured', views: 4821, clicks: 347, createdAt: Date.now() - 7 * 86400000 },
  { id: 2, productName: 'CarbonFlex Recovery Backpack', brandName: 'R.E.A.L.', description: 'Carbon fiber structured recovery pack with cooling compartments. Built for serious athletes.', category: 'Recovery', pricePoint: 299, credibilityScore: 91, status: 'approved', views: 2104, clicks: 189, createdAt: Date.now() - 3 * 86400000 },
];
let nextId = 3;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const status = req.query.status;
    const results = status ? submissions.filter(s => s.status === status) : submissions;
    return res.json(results);
  }

  if (req.method === 'POST') {
    const { productName, brandName, description, category, pricePoint, websiteUrl } = req.body || {};
    if (!productName || !brandName || !description) return res.status(400).json({ error: 'productName, brandName, description required' });

    const submission = {
      id: nextId++, productName, brandName, description, category: category || 'General',
      pricePoint: parseFloat(pricePoint) || null, websiteUrl: websiteUrl || null,
      credibilityScore: null, status: 'pending', views: 0, clicks: 0, createdAt: Date.now(),
    };
    submissions.unshift(submission);

    // Run Perplexity credibility check async
    if (PERPLEXITY_API_KEY) {
      (async () => {
        try {
          const r = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'sonar-pro',
              messages: [{ role: 'user', content: `Verify claims for "${productName}" by ${brandName}: "${description}". Return JSON: {"score":0-100,"verdict":"verified|unverified|mixed","summary":"one sentence"}` }],
            }),
          });
          if (r.ok) {
            const data = await r.json();
            const text = data.choices[0].message.content;
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              const sub = submissions.find(s => s.id === submission.id);
              if (sub) sub.credibilityScore = parsed.score || 50;
            }
          }
        } catch {}
      })();
    } else {
      // Demo score after delay
      setTimeout(() => {
        const sub = submissions.find(s => s.id === submission.id);
        if (sub) sub.credibilityScore = 55 + Math.floor(Math.random() * 40);
      }, 1500);
    }

    return res.json(submission);
  }

  res.status(405).json({ error: 'Method not allowed' });
};
