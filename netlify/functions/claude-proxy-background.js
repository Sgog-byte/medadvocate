const https = require('https');

const SUPA_HOSTNAME = 'ytzlpqzvaxfrkozspzoa.supabase.co';

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
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { job_id, systemPrompt, messages } = JSON.parse(event.body);

  const anthropicPayload = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: systemPrompt,
    messages
  });

  try {
    const resp = await httpsRequest(
      'POST', 'api.anthropic.com', '/v1/messages',
      {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
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
