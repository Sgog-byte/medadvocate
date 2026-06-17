const https = require('https');

// ── Config ──────────────────────────────────────────────────
const SUPA_HOSTNAME  = 'ytzlpqzvaxfrkozspzoa.supabase.co';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://medadvocate.org';

// Server-pinned model allowlist — the client may NOT request any other model.
// Both sonnet and haiku are permitted so existing tools keep working; the
// per-tool haiku assignments will be revisited in a later pass.
const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const DEFAULT_MODEL  = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 5000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function getBearer(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : null;
}

// Verify a Supabase access token server-side via the Auth API.
// Resolves to the user object on success, or null on any failure.
function verifyUser(token) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: SUPA_HOSTNAME,
      path: '/auth/v1/user',
      method: 'GET',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY || '',
        'Authorization': 'Bearer ' + token
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { const u = JSON.parse(data); resolve(u && u.id ? u : null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

exports.handler = async function(event) {
  // CORS preflight — answered before auth (preflight requests carry no token).
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  // ── AUTH: verify the Supabase JWT before doing anything else ──
  const token = getBearer(event);
  if (!token) {
    return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing bearer token' }) };
  }
  const user = await verifyUser(token);
  if (!user) {
    return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }

  // ── Build the Anthropic payload server-side ──
  // The client supplies only `system` and `messages`. The model and
  // max_tokens are pinned/clamped here so a caller cannot select an
  // expensive model or request an unbounded number of tokens.
  let reqBody;
  try {
    // Decode a base64-encoded body (isBase64Encoded) before parsing — matches
    // claude-proxy-background.js so a base64 '/' can't break JSON.parse.
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}');
    reqBody = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const model = ALLOWED_MODELS.has(reqBody.model) ? reqBody.model : DEFAULT_MODEL;
  let maxTokens = parseInt(reqBody.max_tokens, 10);
  if (!Number.isFinite(maxTokens) || maxTokens < 1) maxTokens = 1024;
  if (maxTokens > MAX_TOKENS_CAP) maxTokens = MAX_TOKENS_CAP;

  const payload = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system: reqBody.system,
    messages: reqBody.messages
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders()
          },
          body: data
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: err.message })
      });
    });

    req.write(payload);
    req.end();
  });
};
