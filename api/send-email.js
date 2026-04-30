module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(503).json({ error: 'Email not configured' });

  const { to, subject, html, type } = req.body || {};
  if (!to || !subject || !html) return res.status(400).json({ error: 'Missing fields' });

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'R.E.A.L. SmartScan <no-reply@real-smartscan.com>', to, subject, html }),
  });
  const d = await r.json();
  if (!r.ok) return res.status(500).json({ error: d.message });
  return res.json({ sent: true, id: d.id });
};
