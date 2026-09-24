const state = {
  latest: [],
  snapshots: [],
  staticMode: false,
};

const fmt = new Intl.NumberFormat('en-US');
const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function displayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFmt.format(date);
}
const platforms = ['YouTube', 'X', 'LinkedIn', 'Instagram', 'Facebook'];

function el(id) {
  return document.getElementById(id);
}

function statusLabel(value) {
  return String(value || '').replaceAll('_', ' ');
}

function renderStats(rows) {
  const collected = rows.filter(row => row.status === 'collected').length;
  const failed = rows.filter(row => row.status === 'failed').length;
  const missing = rows.filter(row => row.status === 'count_not_found').length;
  const platforms = new Set(rows.map(row => row.platform)).size;
  el('stats').innerHTML = [
    ['Tracked rows', rows.length],
    ['Collected', collected],
    ['Missing counts', missing],
    ['Failed', failed],
    ['Platforms', platforms],
  ].map(([label, value]) => `<div class="stat"><strong>${fmt.format(value)}</strong><span>${label}</span></div>`).join('');
}

function groupedRows() {
  const accounts = new Map();
  for (const row of state.latest) {
    const key = `${row.name}\u0000${row.website || ''}`;
    if (!accounts.has(key)) {
      accounts.set(key, {
        name: row.name,
        website: row.website,
        notes: row.notes,
        platforms: {},
        lastCaptured: '',
      });
    }
    const account = accounts.get(key);
    account.platforms[row.platform] = row;
    if (String(row.captured_at) > String(account.lastCaptured)) account.lastCaptured = row.captured_at;
  }
  return [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function filteredRows() {
  const query = el('search').value.trim().toLowerCase();
  const status = el('statusFilter').value;
  return groupedRows().filter(account => {
    const searchable = [
      account.name,
      account.website,
      ...platforms.map(platform => account.platforms[platform]?.handle || ''),
      ...platforms.map(platform => account.platforms[platform]?.profile_url || ''),
    ].join(' ').toLowerCase();
    const matchesQuery = !query || searchable.includes(query);
    const matchesStatus = !status || platforms.some(platform => account.platforms[platform]?.status === status);
    return matchesQuery && matchesStatus;
  });
}

function renderLatest() {
  const rows = filteredRows();
  el('latestRows').innerHTML = rows.map(account => {
    return `<tr>
      <td><strong>${escapeHtml(account.name)}</strong><div class="muted">${escapeHtml(account.website || '')}</div></td>
      ${platforms.map(platform => renderPlatformCell(account.platforms[platform])).join('')}
      <td><time datetime="${escapeAttribute(account.lastCaptured)}" title="${escapeAttribute(account.lastCaptured)}">${escapeHtml(displayDate(account.lastCaptured))}</time></td>
      <td>${renderSourceCell(account)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">No rows yet. Run a fetch to create the first snapshot.</td></tr>';
}

function renderPlatformCell(row) {
  if (!row) return '<td><span class="muted">n.a.</span></td>';
  const observation = row;
  const count = observation.count !== '' && observation.count != null ? fmt.format(Number(observation.count)) : 'n.a.';
  const precision = observation.count_precision === 'rounded_public' ? 'rounded' : observation.count_precision === 'exact_public' ? 'exact' : '';
  const detail = [row.error, observation.raw_display_text, precision, observation.fetch_method].filter(Boolean).join(' · ');
  return `<td>
    <a class="count-link" href="${escapeAttribute(observation.source_url || observation.profile_url)}" target="_blank" rel="noreferrer">${escapeHtml(count)}</a>
    <div><span class="status ${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span></div>
    <div class="muted">${escapeHtml(detail)}</div>
  </td>`;
}

function renderSourceCell(account) {
  const links = platforms
    .map(platform => account.platforms[platform])
    .filter(Boolean)
    .map(row => {
      const url = row.source_url || row.profile_url;
      return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(row.platform)}</a>`;
    });
  return links.length ? `<div class="source-links">${links.join('')}</div>` : '<span class="muted">n.a.</span>';
}

function renderHistory() {
  const rows = [...state.snapshots].sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at))).slice(0, 30);
  el('historyRows').innerHTML = rows.map(row => `<div class="history-item">
    <strong>${escapeHtml(row.name)}</strong>
    <span>${escapeHtml(row.platform)}</span>
    <span>${row.count ? fmt.format(Number(row.count)) : 'n.a.'}</span>
    <span class="muted">${escapeHtml(displayDate(row.captured_at))} · ${escapeHtml(statusLabel(row.status))}</span>
  </div>`).join('') || '<p class="muted">No historical snapshots yet.</p>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function escapeAttribute(value) {
  return escapeHtml(value || '#');
}

async function load() {
  let latest;
  try {
    latest = await fetch('api/latest').then(res => {
      if (!res.ok) throw new Error('API unavailable');
      return res.json();
    });
    state.staticMode = false;
  } catch {
    latest = await fetch('data/latest.json').then(res => res.ok ? res.json() : { generated_at: null, rows: [] });
    state.staticMode = true;
  }
  state.latest = latest.rows || [];
  state.snapshots = [];
  el('subtitle').textContent = latest.generated_at
    ? `Latest generated ${displayDate(latest.generated_at)}${state.staticMode ? ' · read-only static mode' : ''}`
    : 'No snapshots yet';
  el('runNow').disabled = state.staticMode;
  el('runPlatform').disabled = state.staticMode;
  if (state.staticMode) {
    el('runNow').textContent = 'Fetch disabled online';
    el('runStatus').textContent = 'Read-only static viewer. Open the desktop app or local server to run collection.';
  } else {
    el('runNow').textContent = 'Run fetch now';
    el('runPlatform').disabled = false;
  }
  renderStats(state.latest);
  renderLatest();
  renderHistory();
  loadHistoryInBackground();
}

async function loadHistoryInBackground() {
  try {
    const snapshots = await fetch(state.staticMode ? 'data/snapshots.json' : 'api/snapshots')
      .then(res => res.ok ? res.json() : { rows: [] });
    state.snapshots = snapshots.rows || [];
    renderHistory();
  } catch {
    state.snapshots = [];
  }
}

async function runNow() {
  const button = el('runNow');
  if (state.staticMode) {
    el('runStatus').textContent = 'Fetch is disabled in read-only mode. Open the desktop app or local server to run collection.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Starting...';
  try {
    const platform = el('runPlatform').value;
    const res = await fetch('api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform }),
    });
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || 'Fetch failed');
    await pollRunStatus();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = 'Run fetch now';
  }
}

async function pollRunStatus() {
  const button = el('runNow');
  button.disabled = true;
  button.textContent = 'Fetching...';
  el('runPlatform').disabled = true;
  while (true) {
    const payload = await fetch('api/run-status').then(res => res.json());
    const status = payload.status || {};
    const tail = String(status.stdout || status.stderr || '').trim().split(/\r?\n/).slice(-3).join(' · ');
    el('runStatus').textContent = status.state === 'running'
      ? `Fetching ${status.platform || 'all platforms'} since ${status.started_at}${tail ? ` · ${tail}` : ''}`
      : status.state === 'complete'
        ? `Last run complete at ${status.finished_at}`
        : status.state === 'failed'
          ? `Last run failed: ${status.error}`
          : 'Idle';
    if (!payload.running) break;
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  try {
    await load();
  } finally {
    button.disabled = false;
    button.textContent = 'Run fetch now';
    el('runPlatform').disabled = false;
  }
}

el('runNow').addEventListener('click', runNow);
for (const id of ['search', 'statusFilter']) {
  el(id).addEventListener('input', renderLatest);
}
load().then(async () => {
  if (state.staticMode) return;
  const run = await fetch('api/run-status').then(res => res.json());
  if (run.running) await pollRunStatus();
}).catch(error => {
  el('latestRows').innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
});
