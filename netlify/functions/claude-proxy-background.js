const https = require('https');

const SUPA_HOSTNAME  = 'ytzlpqzvaxfrkozspzoa.supabase.co';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://medadvocate.org';

// Server-pinned model allowlist + token cap — kept in sync with claude-proxy.js
// so a caller cannot select an expensive model or request unbounded tokens.
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

function httpsRequest(method, hostname, path, headers, payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname, path, method,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Verify a Supabase access token server-side via the Auth API.
function verifyUser(token) {
  return new Promise((resolve) => {
    httpsGet(SUPA_HOSTNAME, '/auth/v1/user', {
      'apikey': process.env.SUPABASE_ANON_KEY || '',
      'Authorization': 'Bearer ' + token
    }).then(r => {
      if (r.status !== 200) return resolve(null);
      try { const u = JSON.parse(r.body); resolve(u && u.id ? u : null); }
      catch { resolve(null); }
    }).catch(() => resolve(null));
  });
}

// Resolve the user_id that owns a given analysis job (two simple service-role
// reads — no FK embed assumed). Returns null if the job or patient is missing.
async function getJobOwnerUserId(jobId) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return null;
  const h = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  try {
    const jobResp = await httpsGet(
      SUPA_HOSTNAME,
      `/rest/v1/analysis_jobs?id=eq.${encodeURIComponent(jobId)}&select=patient_id`,
      h
    );
    const patientId = JSON.parse(jobResp.body)?.[0]?.patient_id;
    if (!patientId) return null;
    const patResp = await httpsGet(
      SUPA_HOSTNAME,
      `/rest/v1/patients?id=eq.${encodeURIComponent(patientId)}&select=user_id`,
      h
    );
    return JSON.parse(patResp.body)?.[0]?.user_id || null;
  } catch (e) {
    console.error('[bg] ownership lookup failed:', e.message);
    return null;
  }
}

async function updateJob(jobId, update) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) { console.error('[bg] SUPABASE_SERVICE_KEY not set'); return; }
  try {
    await httpsRequest(
      'PATCH', SUPA_HOSTNAME,
      `/rest/v1/analysis_jobs?id=eq.${encodeURIComponent(jobId)}`,
      {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal'
      },
      JSON.stringify(update)
    );
  } catch(e) { console.error('[bg] Supabase update failed:', e.message); }
}

exports.handler = async function(event) {
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

  let body;
  try {
    // Netlify invokes background functions asynchronously and base64-encodes the
    // request body (isBase64Encoded), regardless of content-type — decode before
    // parsing, or JSON.parse chokes on the '/' in the base64 alphabet.
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}');
    body = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  const { job_id, systemPrompt, messages } = body;
  if (!job_id) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing job_id' }) };
  }

  // Model + token budget are pinned/clamped server-side (mirrors claude-proxy.js)
  // so heavy tools can request the tokens they need without a caller being able
  // to pick an expensive model or an unbounded output length.
  const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  let maxTokens = parseInt(body.max_tokens, 10);
  if (!Number.isFinite(maxTokens) || maxTokens < 1) maxTokens = 3000;
  if (maxTokens > MAX_TOKENS_CAP) maxTokens = MAX_TOKENS_CAP;

  // ── OWNERSHIP: the job row must belong to the authenticated user ──
  // Checked BEFORE the Anthropic call so an attacker cannot burn API credit
  // or overwrite another user's analysis result by posting a foreign job_id.
  const ownerId = await getJobOwnerUserId(job_id);
  if (!ownerId || ownerId !== user.id) {
    return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const anthropicPayload = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages
  });

  try {
    const resp = await httpsRequest(
      'POST', 'api.anthropic.com', '/v1/messages',
      {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      anthropicPayload
    );

    if (resp.status !== 200) {
      throw new Error(`Anthropic API error ${resp.status}: ${resp.body.slice(0, 200)}`);
    }

    const result = JSON.parse(resp.body);
    await updateJob(job_id, { status: 'complete', result, updated_at: new Date().toISOString() });

  } catch(e) {
    console.error('[bg] Analysis failed:', e.message);
    await updateJob(job_id, { status: 'error', error: e.message, updated_at: new Date().toISOString() });
  }
};
