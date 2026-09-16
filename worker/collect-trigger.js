const REPO_OWNER = 'Khush-ORF';
const REPO_NAME = 'Social-Media-Tracker';
const WORKFLOW_FILE = 'collect.yml';
const REF = 'main';
const ALLOWED_ORIGIN = 'https://khush-orf.github.io';

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json; charset=utf-8',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return Response.json({ ok: false, error: 'Use POST.' }, { status: 405, headers });
    }

    if (!env.GITHUB_TOKEN) {
      return Response.json({ ok: false, error: 'Missing GITHUB_TOKEN secret.' }, { status: 500, headers });
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const platform = String(body.platform || '').trim();
    const inputs = platform ? { platform } : {};
    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'social-media-tracker-worker',
      },
      body: JSON.stringify({ ref: REF, inputs }),
    });

    if (!response.ok) {
      return Response.json({
        ok: false,
        error: `GitHub API returned ${response.status}`,
        detail: await response.text(),
      }, { status: response.status, headers });
    }

    return Response.json({
      ok: true,
      running: true,
      message: platform ? `Started ${platform} collection.` : 'Started full collection.',
    }, { status: 202, headers });
  },
};

