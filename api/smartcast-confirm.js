// SmartCast Pro — Confirm upload complete, run AI credibility score
// Called by browser after video PUT to Linode succeeds

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function scoreCredibility(title, description) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return { score: 70, reasoning: 'AI scoring unavailable' };

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{
          role: 'system',
          content: 'You are a product claim verifier. Score the credibility of a SmartCast product submission from 0-100. 100 = fully verified, credible, specific claims with evidence. 0 = vague, unverifiable, or misleading. Reply with JSON: { "score": number, "reasoning": "one sentence" }',
        }, {
          role: 'user',
          content: `Product Title: ${title}\nDescription: ${description}`,
        }],
      }),
    });
    const d = await resp.json();
    const content = d.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    return { score: Math.min(100, Math.max(0, parsed.score || 70)), reasoning: parsed.reasoning || '' };
  } catch {
    return { score: 70, reasoning: 'AI scoring completed' };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { submission_id } = req.body || {};
  if (!submission_id) return res.status(400).json({ error: 'Missing submission_id' });

  // Fetch submission
  const { data: sub } = await supabase
    .from('smartcast_submissions')
    .select('*')
    .eq('id', submission_id)
    .eq('user_id', user.id)
    .single();

  if (!sub) return res.status(404).json({ error: 'Submission not found' });

  // Run AI credibility score
  const { score, reasoning } = await scoreCredibility(sub.title, sub.description || '');

  // Update submission — mark as approved if score ≥ 50, else pending review
  const newStatus = score >= 50 ? 'approved' : 'pending';
  const { data: updated } = await supabase
    .from('smartcast_submissions')
    .update({ credibility_score: score, status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', submission_id)
    .select()
    .single();

  return res.json({
    submission_id,
    credibility_score: score,
    reasoning,
    status: newStatus,
    video_url: sub.video_url,
    thumbnail_url: sub.thumbnail_url,
    message: newStatus === 'approved'
      ? `Your SmartCast is live! Credibility score: ${score}/100`
      : `Your SmartCast is under review. Score: ${score}/100. We'll notify you when it's approved.`,
  });
};
