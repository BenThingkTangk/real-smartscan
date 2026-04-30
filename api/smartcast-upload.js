// SmartCast Pro — Akamai Linode Object Storage upload handler
// Generates pre-signed S3 URLs for direct browser-to-Linode uploads
// Video never passes through our server — goes straight to Linode edge

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LINODE_ACCESS_KEY  = process.env.LINODE_ACCESS_KEY_ID;
const LINODE_SECRET_KEY  = process.env.LINODE_SECRET_ACCESS_KEY;
const LINODE_BUCKET      = process.env.LINODE_BUCKET_NAME || 'smartscan-smartcast';
const LINODE_REGION      = 'us-east-1';
const LINODE_ENDPOINT    = process.env.LINODE_CLUSTER_ENDPOINT || 'us-east-1.linodeobjects.com';
const LINODE_HOST        = `${LINODE_BUCKET}.${LINODE_ENDPOINT}`;

// AWS Signature V4 presigned URL generator (works with Linode S3-compatible API)
function presignedPut(objectKey, contentType, expiresIn = 3600) {
  const now     = new Date();
  const date    = now.toISOString().replace(/[-:]/g,'').slice(0,8);
  const datetime= now.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';
  const service = 's3';
  const scope   = `${date}/${LINODE_REGION}/${service}/aws4_request`;
  const host    = LINODE_HOST;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    `${LINODE_ACCESS_KEY}/${scope}`,
    'X-Amz-Date':          datetime,
    'X-Amz-Expires':       String(expiresIn),
    'X-Amz-SignedHeaders': 'content-type;host',
  });

  const canonicalRequest = [
    'PUT',
    `/${objectKey}`,
    queryParams.toString(),
    `content-type:${contentType}\nhost:${host}\n`,
    'content-type;host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${LINODE_SECRET_KEY}`, date), LINODE_REGION), service),
    'aws4_request'
  );
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  queryParams.set('X-Amz-Signature', signature);

  return {
    upload_url:   `https://${host}/${objectKey}?${queryParams.toString()}`,
    object_key:   objectKey,
    public_url:   `https://${host}/${objectKey}`,
    cdn_url:      `https://${host}/${objectKey}`,
    expires_in:   expiresIn,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Check tier — SmartCast upload requires prime or smartcast_pro
  const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
  if (!profile || !['prime','smartcast_pro'].includes(profile.tier)) {
    return res.status(403).json({ error: 'SmartCast Pro required', upgrade_url: '/#/membership' });
  }

  if (req.method === 'POST') {
    const { file_name, content_type, title, description, category, price } = req.body || {};

    if (!file_name || !content_type) return res.status(400).json({ error: 'Missing file_name or content_type' });

    // Validate content type
    const allowedTypes = ['video/mp4','video/mov','video/quicktime','video/webm','video/avi','video/m4v'];
    if (!allowedTypes.includes(content_type.toLowerCase())) {
      return res.status(400).json({ error: 'Only video files allowed (mp4, mov, webm, avi)' });
    }

    // Max file size check via content-length header hint
    const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
    if (req.body.file_size && req.body.file_size > MAX_BYTES) {
      return res.status(400).json({ error: 'File too large. Maximum 2GB.' });
    }

    // Build object key: user/date/uuid_filename
    const ext = file_name.split('.').pop()?.toLowerCase() || 'mp4';
    const uuid = crypto.randomUUID();
    const datePrefix = new Date().toISOString().slice(0,7); // YYYY-MM
    const objectKey = `smartcast/${user.id}/${datePrefix}/${uuid}.${ext}`;
    const thumbKey  = `thumbnails/${user.id}/${datePrefix}/${uuid}.jpg`;

    // Generate presigned PUT URL for video
    const videoPresign = presignedPut(objectKey, content_type, 3600);

    // Generate presigned PUT URL for thumbnail
    const thumbPresign = presignedPut(thumbKey, 'image/jpeg', 3600);

    // Create pending SmartCast submission in Supabase
    const { data: submission, error: dbErr } = await supabase
      .from('smartcast_submissions')
      .insert({
        user_id:         user.id,
        title:           title || file_name,
        description:     description || '',
        category:        category || 'General',
        price:           price ? parseFloat(price) : null,
        video_url:       videoPresign.public_url,
        thumbnail_url:   thumbPresign.public_url,
        akamai_object_key: objectKey,
        status:          'pending',
      })
      .select()
      .single();

    if (dbErr) return res.status(500).json({ error: 'DB error', detail: dbErr.message });

    return res.json({
      submission_id:      submission.id,
      video_upload: {
        upload_url:       videoPresign.upload_url,
        object_key:       videoPresign.object_key,
        public_url:       videoPresign.public_url,
        cdn_url:          videoPresign.cdn_url,
        expires_in:       videoPresign.expires_in,
        method:           'PUT',
        headers: { 'Content-Type': content_type },
      },
      thumbnail_upload: {
        upload_url:       thumbPresign.upload_url,
        object_key:       thumbPresign.object_key,
        public_url:       thumbPresign.public_url,
        method:           'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
      },
      message: 'Upload directly to Akamai Linode edge using the upload_url. No file size limit on PUT. Call /api/smartcast-confirm once complete.',
    });
  }

  res.status(405).end();
};
