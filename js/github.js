// GitHub API wrapper — triggers admin-save workflow via workflow_dispatch.
// Uses the user-provided fine-grained PAT (actions:write scope).

window.GitHubAPI = (() => {
  const WORKFLOW_FILE = 'admin-save.yml';

  async function apiFetch(path, token, opts = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  // HMAC-SHA256 as hex — used as auth token (password never leaves browser).
  async function hmacHex(message, key) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
    return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function fetchPublicJSON(owner, repo, path) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
    return res.json();
  }

  async function validateToken(owner, repo, token) {
    // minimum permission check: can we read the repo?
    return apiFetch(`/repos/${owner}/${repo}`, token);
  }

  // Dispatch the admin-save workflow with payload + HMAC token.
  async function dispatchSave(owner, repo, token, password, payload) {
    const payloadStr = JSON.stringify(payload);
    const authToken = await hmacHex(payloadStr, password);
    await apiFetch(
      `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            payload: payloadStr,
            token: authToken,
          },
        }),
      }
    );
    return { dispatchedAt: Date.now() };
  }

  // Poll recent workflow runs until we find our run (best effort).
  async function pollLatestRun(owner, repo, token, startedAt, maxSeconds = 120) {
    const deadline = Date.now() + maxSeconds * 1000;
    let run = null;
    while (Date.now() < deadline) {
      const runs = await apiFetch(
        `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`,
        token
      );
      run = (runs.workflow_runs || []).find(r =>
        new Date(r.created_at).getTime() >= startedAt - 10_000
      );
      if (run && run.status === 'completed') return run;
      await new Promise(r => setTimeout(r, 3000));
    }
    return run; // may still be in progress
  }

  function detectOwnerRepo() {
    // On GitHub Pages: https://<user>.github.io/<repo>/...
    // On user domain: may not be detectable — leave blank.
    const host = location.hostname;
    const match = host.match(/^([^.]+)\.github\.io$/);
    if (match) {
      const user = match[1];
      const parts = location.pathname.split('/').filter(Boolean);
      const repo = parts[0];
      if (repo) return `${user}/${repo}`;
    }
    return '';
  }

  return {
    fetchPublicJSON,
    validateToken,
    dispatchSave,
    pollLatestRun,
    detectOwnerRepo,
  };
})();
