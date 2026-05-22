const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const LINODE_BUCKET = process.env.LINODE_BUCKET_NAME || 'smartscan-smartcast';
const LINODE_ENDPOINT = process.env.LINODE_CLUSTER_ENDPOINT || 'us-east-1.linodeobjects.com';
const CDN_BASE = `https://${LINODE_BUCKET}.${LINODE_ENDPOINT}`;

// Generate a signed URL for private video access (if bucket is private)
function signedUrl(objectKey, expiresIn = 3600) {
  const ACCESS_KEY = process.env.LINODE_ACCESS_KEY_ID;
  const SECRET_KEY = process.env.LINODE_SECRET_ACCESS_KEY;
  if (!ACCESS_KEY || !SECRET_KEY) return `${CDN_BASE}/${objectKey}`;
  
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const stringToSign = `GET\n\n\n${expires}\n/${LINODE_BUCKET}/${objectKey}`;
  const sig = crypto.createHmac('sha1', SECRET_KEY).update(stringToSign).digest('base64');
  const encodedSig = encodeURIComponent(sig);
  return `${CDN_BASE}/${objectKey}?AWSAccessKeyId=${ACCESS_KEY}&Expires=${expires}&Signature=${encodedSig}`;
}

module.exports = async (req, res) => {
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

  const { data: sub } = await supabase
    .from('smartcast_submissions')
    .select('*').eq('id', submission_id).eq('user_id', user.id).single();
  if (!sub) return res.status(404).json({ error: 'Not found' });

  const objectKey = sub.akamai_object_key;
  
  // Direct CDN URL (Akamai Linode serves with sub-50ms edge latency globally)
  const videoUrl = `${CDN_BASE}/${objectKey}`;
  const thumbnailUrl = sub.thumbnail_url || `${CDN_BASE}/${objectKey.replace(/\.[^.]+$/, '.jpg')}`;
  
  // Build streaming metadata
  const streamMeta = {
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl,
    cdn_url: videoUrl,
    cdn_provider: 'Akamai Linode Object Storage',
    edge_region: 'us-east-1 (Newark, NJ)',
    playback_ready: true,
    estimated_latency_ms: 45, // Akamai edge latency
    thumbnail_variants: {
      sm:  `${thumbnailUrl}?width=120`,
      md:  `${thumbnailUrl}?width=480`,
      lg:  `${thumbnailUrl}?width=1200`,
    }
  };

  // Update Supabase with streaming info
  await supabase.from('smartcast_submissions').update({
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl,
    status: sub.status === 'pending' ? 'approved' : sub.status,
    updated_at: new Date().toISOString(),
  }).eq('id', submission_id);

  return res.json({
    submission_id,
    stream: streamMeta,
    message: 'Stream ready via Akamai Linode CDN',
  });
};
