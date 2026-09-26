const state = {
  // One place for everything the screen needs. Changing state, then calling
  // renderAll(), redraws the dashboard from the latest known data.
  latest: [],
  snapshots: [],
  accounts: [],
  selectedOrganizations: new Set(),
  editorSelected: new Set(),
  staticMode: false,
  runs: [],
  pasteRows: [],
  accountPageReturn: 'dashboard',
  pastePageReturn: 'dashboard',
  view: 'latest',
  historyLayout: 'matrix',
  filters: { search: '', displayPlatform: '', status: '', dateFrom: '', dateTo: '', missingOnly: false },
  run: null,
  selectionPanelOpen: true,
  recordsRunActive: false,
};

const platforms = ['YouTube', 'LinkedIn', 'X', 'Instagram', 'Facebook'];
const accountFields = [['Facebook', 'Facebook'], ['LinkedIn', 'LinkedIn'], ['X', 'X'], ['Instagram', 'Instagram'], ['YouTube', 'Youtube']];
const fmt = new Intl.NumberFormat('en-US');
const istDateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit' });
const istDateTimeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function el(id) { return document.getElementById(id); }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function escapeAttribute(value) { return escapeHtml(value || '#'); }
function escapeInputValue(value) { return escapeHtml(value ?? ''); }
function accountName(account) { return account.Name || account.name || 'Unnamed organization'; }
function accountWebsite(account) { return account.Website || account.website || ''; }
function statusLabel(value) { return ({ collected: 'Collected', count_not_found: 'Count not found', failed: 'Failed', none: 'No record' }[value] || String(value || '').replaceAll('_', ' ')); }
function displayDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : istDateTimeFmt.format(date); }
function shortDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : istDateFmt.format(date); }
function dateKey(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function platformField(platform) { return platform === 'YouTube' ? 'Youtube' : platform; }
function platformShortLabel(platform) { return { Facebook: 'f', LinkedIn: 'in', X: 'X', Instagram: 'ig', YouTube: 'yt' }[platform] || 'link'; }
function statusClass(value) { return escapeAttribute(value || 'none'); }

function sourceIcon(row) {
  // Show a tiny platform button instead of a long URL, so tables stay narrow.
  const url = row?.source_url || row?.profile_url;
  if (!url) return '';
  const platform = row.platform || 'Source';
  return `<a class="source-icon source-${escapeAttribute(platform.toLowerCase())}" href="${escapeAttribute(url)}" target="_blank" rel="noreferrer" title="Open ${escapeAttribute(platform)} source" aria-label="Open ${escapeAttribute(platform)} source"><span aria-hidden="true">${escapeHtml(platformShortLabel(platform))}</span></a>`;
}

function fallbackOrganizationId(row) {
  const value = `${String(row.name ?? row.Name ?? '').trim()}\u0000${String(row.website ?? row.Website ?? '').trim()}`;
  try { return btoa(unescape(encodeURIComponent(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); } catch { return value; }
}

function organizationId(row) { return row.org_id || fallbackOrganizationId(row); }
function accountMatches(account, query) { return !query || [accountName(account), accountWebsite(account), ...accountFields.map(([, field]) => account[field] || '')].join(' ').toLowerCase().includes(query.toLowerCase()); }
function selectedFilterActive() { return state.selectedOrganizations.size > 0; }
function rowFor(account, platform, rows = state.latest) { return rows.find(row => organizationId(row) === organizationId(account) && row.platform === platform); }
function rowsForAccount(account, rows = state.latest) { return rows.filter(row => organizationId(row) === organizationId(account)); }
function tracked(account, platform) { return Boolean(account[platformField(platform)]); }
function formatCount(row) { return row && row.count !== '' && row.count != null && Number.isFinite(Number(row.count)) ? fmt.format(Number(row.count)) : 'n.a.'; }
function precisionLabel(row) { return row?.count_precision === 'rounded_public' ? 'rounded' : row?.count_precision === 'exact_public' ? 'exact' : ''; }
function accountSearchText(account) {
  const latest = rowsForAccount(account).flatMap(row => [row.handle, row.profile_url]);
  return [accountName(account), accountWebsite(account), ...accountFields.map(([, field]) => account[field] || ''), ...latest].join(' ').toLowerCase();
}

function currentFilters() { return state.filters; }

function accountMatchesFilters(account, mode = 'latest') {
  // The left organization choices act like a master filter. Search, platform,
  // status, date, and missing-only filters stack on top of it.
  const filters = currentFilters();
  const id = organizationId(account);
  if (selectedFilterActive() && !state.selectedOrganizations.has(id)) return false;
  if (filters.search && !accountSearchText(account).includes(filters.search.toLowerCase())) return false;
  const displayPlatforms = filters.displayPlatform ? [filters.displayPlatform] : platforms;
  const relevant = rowsForAccount(account).filter(row => displayPlatforms.includes(row.platform));
  if (filters.status && !relevant.some(row => row.status === filters.status)) return false;
  if (filters.missingOnly && !displayPlatforms.some(platform => tracked(account, platform) && rowFor(account, platform)?.status !== 'collected')) return false;
  return true;
}

function filteredAccounts(mode = 'latest') { return state.accounts.filter(account => accountMatchesFilters(account, mode)); }
function visiblePlatforms() { return state.filters.displayPlatform ? [state.filters.displayPlatform] : platforms; }

function filteredSnapshots() {
  // History uses raw snapshot rows. Latest view uses one newest row per platform.
  const filters = currentFilters();
  return state.snapshots.filter(row => {
    const id = organizationId(row);
    if (selectedFilterActive() && !state.selectedOrganizations.has(id)) return false;
    if (filters.search && ![row.name, row.website, row.handle, row.profile_url, row.platform].join(' ').toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.displayPlatform && row.platform !== filters.displayPlatform) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.missingOnly && row.status === 'collected') return false;
    const date = dateKey(row.captured_at);
    if (filters.dateFrom && date < filters.dateFrom) return false;
    if (filters.dateTo && date > filters.dateTo) return false;
    return true;
  }).sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
}

function renderMetricCell(account, platform) {
  // One platform cell can be: not tracked, never collected, collected, or failed.
  // Keeping all cases visible is important for auditability.
  if (!tracked(account, platform)) return '<td><span class="untracked">Not tracked</span></td>';
  const row = rowFor(account, platform);
  if (!row) return '<td><div class="metric-cell"><span class="count-text">n.a.</span><span class="status none">No record</span><span class="time-text">Not collected yet</span></div></td>';
  const count = formatCount(row);
  const precision = precisionLabel(row);
  const details = [row.error, row.raw_display_text, precision, row.fetch_method].filter(Boolean).join(' · ');
  const countMarkup = row.source_url || row.profile_url ? `<a class="count-link" href="${escapeAttribute(row.source_url || row.profile_url)}" target="_blank" rel="noreferrer">${escapeHtml(count)}</a>` : `<span class="count-text">${escapeHtml(count)}</span>`;
  return `<td><div class="metric-cell">${countMarkup}<span class="status ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}${precision ? ` · ${escapeHtml(precision)}` : ''}</span><span class="raw-text">${escapeHtml(details || 'No raw text')}</span><span class="time-text">${escapeHtml(displayDate(row.captured_at))} IST</span></div></td>`;
}

function renderSourceCell(rows) {
  const links = rows.filter(Boolean).map(sourceIcon).filter(Boolean);
  return links.length ? `<div class="source-links">${links.join('')}</div>` : '<span class="muted">n.a.</span>';
}

function renderStats(accounts) {
  // The small counters at the top summarize only what the current filters show.
  const display = visiblePlatforms();
  const rows = accounts.flatMap(account => display.map(platform => rowFor(account, platform)).filter(Boolean));
  el('visibleSummary').textContent = `${accounts.length} of ${state.accounts.length} organizations`;
  el('collectedSummary').textContent = `${rows.filter(row => row.status === 'collected').length} collected`;
  el('missingSummary').textContent = `${rows.filter(row => row.status === 'count_not_found').length} count not found`;
  el('failedSummary').textContent = `${rows.filter(row => row.status === 'failed').length} failed`;
  el('selectedCount').textContent = selectedFilterActive() ? `${state.selectedOrganizations.size} selected` : 'All';
  el('headerOrgMeta').textContent = `${state.accounts.length} organizations`;
  el('headerSelectionMeta').textContent = selectedFilterActive() ? `${state.selectedOrganizations.size} selected` : 'All organizations';
}

function renderLatest() {
  // Main dashboard table: one organization per row, platforms across columns.
  const display = visiblePlatforms();
  const accounts = filteredAccounts('latest');
  el('latestEmpty').hidden = state.latest.length > 0;
  el('latestTableWrap').hidden = state.latest.length === 0;
  el('latestHead').innerHTML = `<tr><th>Organization</th><th>Website</th>${display.map(platform => `<th>${escapeHtml(platform)}</th>`).join('')}<th>Last captured</th><th>Sources</th></tr>`;
  const colspan = display.length + 4;
  const body = accounts.map(account => {
    const accountRows = rowsForAccount(account);
    const lastCaptured = accountRows.reduce((latest, row) => String(row.captured_at) > String(latest) ? row.captured_at : latest, '');
    const sources = display.map(platform => rowFor(account, platform)).filter(Boolean);
    return `<tr><td><button class="org-link" data-open-account="${escapeAttribute(organizationId(account))}">${escapeHtml(accountName(account))}</button><div class="muted">${escapeHtml(accountWebsite(account))}</div></td><td><a class="website-link" href="${escapeAttribute(accountWebsite(account))}" target="_blank" rel="noreferrer">${escapeHtml(new URL(accountWebsite(account) || 'https://example.com').hostname.replace(/^www\./, ''))}</a></td>${display.map(platform => renderMetricCell(account, platform)).join('')}<td><time datetime="${escapeAttribute(lastCaptured)}">${escapeHtml(displayDate(lastCaptured) || '—')}</time></td><td>${renderSourceCell(sources)}</td></tr>`;
  }).join('');
  el('latestRows').innerHTML = body || `<tr><td colspan="${colspan}" class="muted">No organizations match the current filters.</td></tr>`;
}

function historyDateList() {
  return [...new Set(state.snapshots.map(row => dateKey(row.captured_at)).filter(Boolean))].sort();
}

function renderDateOptions() {
  const dates = historyDateList();
  const from = state.filters.dateFrom;
  const to = state.filters.dateTo;
  el('dateFrom').innerHTML = `<option value="">Earliest</option>${dates.map(date => `<option value="${date}" ${date === from ? 'selected' : ''}>${escapeHtml(date)}</option>`).join('')}`;
  el('dateTo').innerHTML = `<option value="">Latest</option>${dates.map(date => `<option value="${date}" ${date === to ? 'selected' : ''}>${escapeHtml(date)}</option>`).join('')}`;
}

function renderHistoryMatrix() {
  // History matrix: one row per organization + platform, dates across columns.
  // This mirrors the Excel dataset layout.
  const filters = currentFilters();
  const snapshots = filteredSnapshots();
  const accounts = filteredAccounts('history');
  const dates = historyDateList().filter(date => (!filters.dateFrom || date >= filters.dateFrom) && (!filters.dateTo || date <= filters.dateTo));
  const byKey = new Map();
  for (const row of snapshots) byKey.set(`${organizationId(row)}|${row.platform}|${dateKey(row.captured_at)}`, row);
  const latestByAccountPlatform = new Map();
  for (const row of state.latest) latestByAccountPlatform.set(`${organizationId(row)}|${row.platform}`, row);
  const rows = [];
  for (const account of accounts) {
    for (const platform of visiblePlatforms()) {
      if (!tracked(account, platform)) continue;
      const key = `${organizationId(account)}|${platform}`;
      const latest = latestByAccountPlatform.get(key);
      if (!latest && !dates.some(date => byKey.has(`${key}|${date}`))) continue;
      rows.push({ account, platform, latest, key });
    }
  }
  el('historyMatrixHead').innerHTML = `<tr><th>Organization</th><th>Platform</th><th>Social Media Name</th>${dates.map(date => `<th>${escapeHtml(date)}</th>`).join('')}<th>Latest status</th><th>Source</th></tr>`;
  const countColumns = dates.length + 5;
  el('historyMatrixRows').innerHTML = rows.map(({ account, platform, latest, key }) => {
    const cells = dates.map(date => {
      const row = byKey.get(`${key}|${date}`);
      if (!row) return '<td><span class="history-empty">—</span></td>';
      return `<td title="${escapeAttribute(row.raw_display_text || row.error || statusLabel(row.status))}">${row.status === 'collected' ? escapeHtml(formatCount(row)) : '<span class="history-empty">n.a.</span>'}<div class="history-empty">${escapeHtml(row.status === 'collected' ? '' : statusLabel(row.status))}</div></td>`;
    }).join('');
    return `<tr><td><strong>${escapeHtml(accountName(account))}</strong></td><td>${escapeHtml(platform)}</td><td>@${escapeHtml(account[platformField(platform)] || latest?.handle || '')}</td>${cells}<td><span class="status ${statusClass(latest?.status || 'none')}">${escapeHtml(statusLabel(latest?.status || 'none'))}</span></td><td>${sourceIcon(latest) || '<span class="muted">n.a.</span>'}</td></tr>`;
  }).join('') || `<tr><td colspan="${countColumns}" class="muted">No history matches the current filters.</td></tr>`;
}

function renderHistoryRows() {
  const rows = filteredSnapshots();
  el('historyRows').innerHTML = rows.map(row => `<tr><td><time datetime="${escapeAttribute(row.captured_at)}">${escapeHtml(shortDate(row.captured_at))}</time></td><td><strong>${escapeHtml(row.name)}</strong><div class="muted">${escapeHtml(row.website)}</div></td><td>${escapeHtml(row.platform)}</td><td class="count">${escapeHtml(formatCount(row))}</td><td><span class="status ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td><td>${escapeHtml(row.raw_display_text || row.error || '—')}</td><td>${sourceIcon(row) || '<span class="muted">n.a.</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No history matches the current filters.</td></tr>';
}

function renderView() {
  const latest = state.view === 'latest';
  el('latestPanel').hidden = !latest;
  el('historyMatrixPanel').hidden = latest || state.historyLayout !== 'matrix';
  el('historyRowsPanel').hidden = latest || state.historyLayout !== 'rows';
  el('historyLayout').hidden = latest;
  el('viewLatest').setAttribute('aria-selected', String(latest));
  el('viewHistory').setAttribute('aria-selected', String(!latest));
  if (!latest && state.historyLayout === 'matrix') renderHistoryMatrix();
  if (!latest && state.historyLayout === 'rows') renderHistoryRows();
}

function renderTargetSummary() {
  const scope = el('runScope')?.value || 'all';
  const chosen = scope === 'selected' ? state.accounts.filter(account => state.selectedOrganizations.has(organizationId(account))) : state.accounts;
  const platform = el('runPlatform')?.value || '';
  const count = chosen.reduce((total, account) => total + platforms.filter(item => (!platform || item === platform) && tracked(account, item)).length, 0);
  el('targetSummary').textContent = scope === 'selected' && !chosen.length ? 'Next run: no organizations selected.' : `Next run: ${fmt.format(count)} targets across ${fmt.format(chosen.length)} organizations.`;
}

function renderControls() {
  const mode = el('runMode')?.value || 'hybrid';
  const descriptions = { hybrid: 'Hybrid automatic: static requests first, with browser fallback only when needed.', complete: 'Completeness mode: uses browser rendering more aggressively. Better chance on dynamic pages; slower and more likely to hit rate limits.', static: 'Static-only: fastest, but expected to miss blocked or JavaScript-rendered pages.' };
  el('modeDescription').textContent = descriptions[mode] || descriptions.hybrid;
  renderTargetSummary();
}

function renderAll() {
  // Redraw every part that can be affected by data, filters, or selections.
  renderDateOptions();
  renderStats(filteredAccounts(state.view === 'latest' ? 'latest' : 'history'));
  renderSelection();
  renderLatest();
  renderHistoryRows();
  renderView();
  renderControls();
  renderSelectionPanel();
  const dirty = state.filters.search || state.filters.displayPlatform || state.filters.status || state.filters.dateFrom || state.filters.dateTo || state.filters.missingOnly;
  el('clearFilters').disabled = !dirty;
}

function persistSelection() { try { localStorage.setItem('tracker-selected-organizations', JSON.stringify([...state.selectedOrganizations])); } catch {} }
function loadPersistedSelection() { try { const values = JSON.parse(localStorage.getItem('tracker-selected-organizations') || '[]'); if (Array.isArray(values)) state.selectedOrganizations = new Set(values.map(String)); } catch {} }
function loadSelectionPanelState() { try { state.selectionPanelOpen = localStorage.getItem('tracker-organizations-panel') !== 'closed'; } catch { state.selectionPanelOpen = true; } }
function persistSelectionPanelState() { try { localStorage.setItem('tracker-organizations-panel', state.selectionPanelOpen ? 'open' : 'closed'); } catch {} }
function renderSelectionPanel() {
  const grid = el('dashboardGrid');
  const button = el('toggleSelectionPanel');
  if (!grid || !button) return;
  grid.classList.toggle('selection-collapsed', !state.selectionPanelOpen);
  button.setAttribute('aria-expanded', String(state.selectionPanelOpen));
  button.setAttribute('aria-label', state.selectionPanelOpen ? 'Hide organizations panel' : 'Show organizations panel');
  button.title = state.selectionPanelOpen ? 'Hide organizations panel' : 'Show organizations panel';
  button.textContent = state.selectionPanelOpen ? '☰' : '☷';
}
function toggleSelectionPanel() { state.selectionPanelOpen = !state.selectionPanelOpen; persistSelectionPanelState(); renderSelectionPanel(); }

function renderSelection() {
  const query = el('accountSearch')?.value.trim().toLowerCase() || '';
  const accounts = state.accounts.filter(account => accountMatches(account, query));
  el('selectionList').innerHTML = accounts.map(account => { const id = organizationId(account); const trackedCount = platforms.filter(platform => tracked(account, platform)).length; return `<label class="selection-item"><input class="org-select" type="checkbox" data-org-id="${escapeAttribute(id)}" ${state.selectedOrganizations.has(id) ? 'checked' : ''}><span><strong>${escapeHtml(accountName(account))}</strong><small>${escapeHtml(accountWebsite(account))}</small></span><em>${trackedCount}/5</em></label>`; }).join('') || '<p class="panel-note">No organizations match this search.</p>';
  el('accountMessage').textContent = `${fmt.format(state.accounts.length)} organizations · ${state.selectedOrganizations.size ? `${fmt.format(state.selectedOrganizations.size)} selected` : 'none selected, all shown'}`;
}

function renderEditor() {
  const query = el('editorSearch')?.value.trim().toLowerCase() || '';
  const accounts = state.accounts.filter(account => accountMatches(account, query));
  el('accountRows').innerHTML = accounts.map(account => { const id = organizationId(account); return `<tr data-org-id="${escapeAttribute(id)}"><td><input class="editor-select" type="checkbox" data-org-id="${escapeAttribute(id)}" ${state.editorSelected.has(id) ? 'checked' : ''} aria-label="Select ${escapeAttribute(accountName(account))}"></td><td><input class="account-value" data-field="Name" value="${escapeInputValue(account.Name)}" placeholder="Organization name" title="${escapeInputValue(account.Name)}"></td><td><input class="account-value" data-field="Website" value="${escapeInputValue(account.Website)}" placeholder="Optional website" title="${escapeInputValue(account.Website)}"></td>${accountFields.map(([label, field]) => `<td><input class="account-value" data-field="${field}" value="${escapeInputValue(account[field])}" placeholder="Optional public URL or handle" aria-label="${label} public URL or handle" title="${escapeInputValue(account[field])}"></td>`).join('')}<td><button class="delete-account btn btn-ghost" type="button">Remove</button></td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">No organizations match this search.</td></tr>';
  const dirtyLabel = `${fmt.format(state.accounts.length)} organizations · ${state.editorSelected.size ? `${state.editorSelected.size} selected` : 'no rows selected'}`;
  el('editorMessage').textContent = dirtyLabel;
  el('deleteSelectedAccounts').disabled = state.editorSelected.size === 0;
  el('deleteSelectedAccounts').textContent = `Delete selected (${state.editorSelected.size})`;
  el('clearEditorSelection').disabled = state.editorSelected.size === 0;
}

async function fetchJson(path, options) { const response = await fetch(path, options); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`); return payload; }

async function loadAccounts() {
  // In the desktop/local app, accounts come from the server. On GitHub Pages,
  // staticMode skips editing because there is no server to save changes.
  if (state.staticMode) return;
  const payload = await fetchJson('api/accounts');
  state.accounts = payload.rows || [];
  const known = new Set(state.accounts.map(organizationId));
  state.selectedOrganizations = new Set([...state.selectedOrganizations].filter(id => known.has(id)));
  state.editorSelected = new Set([...state.editorSelected].filter(id => known.has(id)));
  persistSelection();
}

async function loadHistory() { const path = state.staticMode ? 'data/snapshots.json' : 'api/history'; try { state.snapshots = (await fetchJson(path)).rows || []; } catch { state.snapshots = []; } }

function setHeaderMeta(payload) {
  const generated = (payload.latest_run_at || payload.generated_at) ? `Latest run ${displayDate(payload.latest_run_at || payload.generated_at)} IST` : 'Latest run none yet';
  const db = state.staticMode ? 'Read-only static data' : 'SQLite ready';
  el('subtitle').textContent = generated + (state.staticMode ? ' · read-only' : '');
  el('launchAccountMeta').textContent = `accounts.csv · ${fmt.format(state.accounts.length)} organizations`;
  el('launchRunMeta').textContent = generated;
  el('launchDbMeta').textContent = db;
  el('headerDbMeta').textContent = db;
  el('dbDot').className = state.staticMode ? '' : 'ready';
}

async function load() {
  // Prefer live local API data. If that fails, fall back to static public JSON so
  // the published GitHub Pages view can still show exported data.
  let payload;
  try { payload = await fetchJson('api/latest'); state.staticMode = false; } catch { payload = await fetch('data/latest.json').then(response => response.ok ? response.json() : { rows: [] }); state.staticMode = true; }
  state.latest = payload.rows || [];
  loadPersistedSelection();
  loadSelectionPanelState();
  await loadAccounts();
  if (state.staticMode) {
    const accounts = new Map();
    for (const row of state.latest) {
      const id = organizationId(row);
      if (!accounts.has(id)) accounts.set(id, { Name: row.name, Website: row.website || '', Facebook: '', LinkedIn: '', X: '', Instagram: '', Youtube: '', org_id: id });
      const account = accounts.get(id);
      account[platformField(row.platform)] = row.profile_url || row.handle || '';
    }
    state.accounts = [...accounts.values()];
  }
  await loadHistory();
  setHeaderMeta(payload);
  el('runNow').disabled = state.staticMode;
  el('clearRecords').disabled = state.staticMode;
  el('runNow').textContent = state.staticMode ? 'Fetch unavailable online' : 'Fetch now';
  renderAll();
}

function hidePages() { el('appShell').hidden = true; el('launchPanel').hidden = true; el('accountPage').hidden = true; el('pastePage').hidden = true; }
function showApp() { hidePages(); el('appShell').hidden = false; document.body.classList.remove('modal-open'); renderAll(); }
function goLaunch() { hidePages(); el('launchPanel').hidden = false; }
function showAccountPage(returnTo = 'dashboard', focusName = '') {
  // The account editor is a full page so wide rows and long URLs have room.
  state.accountPageReturn = returnTo;
  hidePages();
  el('accountPage').hidden = false;
  if (focusName) {
    const account = state.accounts.find(candidate => organizationId(candidate) === focusName);
    el('editorSearch').value = account ? accountName(account) : focusName;
  }
  renderEditor();
  el('editorSearch').focus();
}
function closeAccountPage() { if (state.accountPageReturn === 'launch') goLaunch(); else showApp(); }
function showPastePage(returnTo = 'dashboard') { state.pastePageReturn = returnTo; hidePages(); el('pastePage').hidden = false; el('pasteInput').focus(); }
function closePastePage() { if (state.pastePageReturn === 'launch') goLaunch(); else showApp(); }

function addAccount() { const account = { Name: '', Website: '', Facebook: '', LinkedIn: '', X: '', Instagram: '', Youtube: '', org_id: `new-${Date.now()}` }; state.accounts.push(account); renderEditor(); el('accountRows').querySelector(`tr[data-org-id="${CSS.escape(account.org_id)}"]`)?.querySelector('[data-field="Name"]')?.focus(); }

function removeAccount(id) { state.selectedOrganizations.delete(id); state.editorSelected.delete(id); state.accounts = state.accounts.filter(account => organizationId(account) !== id); renderEditor(); }
function deleteSelectedAccounts() { const ids = new Set(state.editorSelected); state.accounts = state.accounts.filter(account => !ids.has(organizationId(account))); state.selectedOrganizations = new Set([...state.selectedOrganizations].filter(id => !ids.has(id))); state.editorSelected.clear(); persistSelection(); renderEditor(); }

async function saveAccounts() {
  // Only visible editor inputs are read back from the table. Rows not currently
  // visible keep their existing values.
  const editedById = new Map();
  for (const row of el('accountRows').querySelectorAll('tr[data-org-id]')) { const account = state.accounts.find(candidate => organizationId(candidate) === row.dataset.orgId); if (!account) continue; const edited = { ...account }; for (const input of row.querySelectorAll('.account-value')) edited[input.dataset.field] = input.value.trim(); editedById.set(row.dataset.orgId, edited); }
  const rows = state.accounts.map(account => editedById.get(organizationId(account)) || account).filter(account => accountName(account).trim());
  const payload = await fetchJson('api/accounts', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }) });
  state.accounts = payload.rows || []; state.editorSelected.clear(); await load(); showAccountPage(state.accountPageReturn); el('editorMessage').textContent = `Saved ${state.accounts.length} organizations. A backup of accounts.csv was kept.`;
}

function detectPlatform(value) { const text = value.trim().toLowerCase(); if (text.includes('youtube.com') || text.includes('youtu.be')) return 'Youtube'; if (text.includes('linkedin.com')) return 'LinkedIn'; if (text.includes('instagram.com')) return 'Instagram'; if (text.includes('facebook.com') || text.includes('fb.com')) return 'Facebook'; if (text.includes('x.com') || text.includes('twitter.com')) return 'X'; if (/^@?[a-z0-9_.-]{2,80}$/i.test(value.trim())) return 'X'; return ''; }
function normalizePasteValue(value, platform) { const text = value.trim(); if (/^https?:\/\//i.test(text)) return text; const handle = text.replace(/^@/, '').replace(/^\/+|\/+$/g, ''); const bases = { Facebook: 'https://www.facebook.com/', LinkedIn: 'https://www.linkedin.com/company/', X: 'https://x.com/', Instagram: 'https://www.instagram.com/', Youtube: 'https://www.youtube.com/@' }; return `${bases[platform] || ''}${handle}`; }
function pasteLabel(url) { try { const parsed = new URL(url); return parsed.pathname.split('/').filter(Boolean).at(-1)?.replace(/^@/, '') || 'organization'; } catch { return 'organization'; } }

function renderPastePreview() {
  // Paste import is a helper for quick setup: each pasted URL becomes a proposed
  // new organization row that the user can review before saving.
  const valid = state.pasteRows.filter(row => row.platform && row.include);
  el('pastePreview').hidden = state.pasteRows.length === 0;
  el('pasteRows').innerHTML = state.pasteRows.map((row, index) => `<tr class="${row.platform ? '' : 'paste-row-invalid'}"><td><input type="checkbox" data-paste-index="${index}" ${row.include ? 'checked' : ''} ${row.platform ? '' : 'disabled'} aria-label="Include pasted link"></td><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.platform || 'Unrecognized')}</td><td>${escapeHtml(row.name)}</td><td><a href="${escapeAttribute(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.url)}</a></td><td>${escapeHtml(row.platform ? 'Ready to save' : 'Choose a recognized public profile URL')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing to preview.</td></tr>';
  el('savePaste').disabled = valid.length === 0;
  el('pasteSummary').textContent = `${state.pasteRows.length} detected · ${valid.length} ready to save · ${state.pasteRows.filter(row => !row.platform).length} need attention`;
}

function previewPaste() { const values = el('pasteInput').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean); state.pasteRows = values.map(value => { const platform = detectPlatform(value); const url = normalizePasteValue(value, platform); return { value, platform, url, name: pasteLabel(url), include: Boolean(platform) }; }); renderPastePreview(); }

async function savePaste() { const valid = state.pasteRows.filter(row => row.platform && row.include); if (!valid.length) return; const additions = valid.map(row => { const field = row.platform === 'Youtube' ? 'Youtube' : row.platform; return { Name: row.name, Website: '', Facebook: '', LinkedIn: '', X: '', Instagram: '', Youtube: '', [field]: row.url }; }); await fetchJson('api/accounts', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: [...state.accounts, ...additions] }) }); state.pasteRows = []; el('pasteInput').value = ''; await load(); el('runStatus').textContent = `Added ${additions.length} profile link${additions.length === 1 ? '' : 's'} to accounts.csv.`; closePastePage(); }

function updateProgress(status, running) {
  // The server stores a small live status object. This turns it into the progress
  // bar, counters, and last activity line.
  const total = Number(status.targets || 0); const completed = Number(status.completed || 0); const pct = total ? Math.min(100, completed / total * 100) : 0; const elapsed = status.started_at ? Math.max(0, Math.round((Date.now() - new Date(status.started_at).getTime()) / 1000)) : 0;
  const resultMatches = [...String(status.stdout || '').matchAll(/\.\.\. (collected|count_not_found|failed)(?=\s|$)/gm)].map(match => match[1]);
  const liveCollected = resultMatches.filter(value => value === 'collected').length;
  const liveMissing = resultMatches.filter(value => value === 'count_not_found').length;
  const liveFailed = resultMatches.filter(value => value === 'failed').length;
  el('runProgress').hidden = !status || (!running && !state.run);
  el('progressBar').style.width = `${pct.toFixed(1)}%`; el('headerProgressBar').style.width = `${pct.toFixed(1)}%`; el('headerProgressBar').classList.toggle('active', running);
  el('progressTitle').textContent = running ? 'Collection in progress' : status.state === 'failed' ? 'Run failed' : 'Run complete';
  el('progressMeta').textContent = `${status.scope === 'selected' ? 'selected organizations' : 'entire accounts.csv'} · ${status.platform || 'all platforms'} · ${status.mode || 'hybrid'}`;
  el('progressState').textContent = running ? 'Collecting' : status.state === 'failed' ? 'Failed' : 'Finished';
  el('progressCompleted').textContent = `${completed} / ${total}`;
  el('progressCollected').textContent = fmt.format(status.collected ?? liveCollected);
  el('progressMissing').textContent = fmt.format(status.count_not_found ?? status.missing ?? liveMissing);
  el('progressFailed').textContent = fmt.format(status.failed ?? liveFailed);
  el('progressElapsed').textContent = `${elapsed}s`;
  el('progressActivity').textContent = String(status.stdout || status.stderr || status.error || '').trim().split(/\r?\n/).slice(-1)[0] || (running ? 'Waiting for collector activity…' : '');
  el('dismissRun').hidden = running;
}

function renderSelectionDependentViews() {
  renderStats(filteredAccounts(state.view === 'latest' ? 'latest' : 'history'));
  renderSelection();
  renderLatest();
  renderView();
  renderTargetSummary();
}

async function runNow() {
  // Start collection from the current dropdowns and selected organizations.
  if (state.staticMode) return;
  const scope = el('runScope').value;
  if (scope === 'selected' && !state.selectedOrganizations.size) { el('runStatus').textContent = 'Select at least one organization, or choose the entire accounts.csv.'; return; }
  const button = el('runNow'); button.disabled = true; button.textContent = 'Starting…';
  try { await fetchJson('api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: el('runPlatform').value, scope, organizationIds: scope === 'selected' ? [...state.selectedOrganizations] : [], mode: el('runMode').value }) }); await pollRunStatus(); } catch (error) { el('runStatus').textContent = error.message; button.disabled = false; button.textContent = 'Fetch now'; }
}

async function pollRunStatus() {
  // Keep asking the server how the run is going until it says the run ended.
  const button = el('runNow'); button.disabled = true; button.textContent = 'Fetching…'; for (const id of ['runScope', 'runPlatform', 'runMode']) el(id).disabled = true;
  try {
    while (true) { const payload = await fetchJson('api/run-status'); const status = payload.status || {}; state.run = payload.running ? status : status; updateProgress(status, payload.running); el('runStatus').textContent = payload.running ? `Fetching ${status.completed || 0}/${status.targets || 0} · ${status.platform || 'all platforms'} · ${status.mode || 'hybrid'}` : status.state === 'complete' ? `Last run complete at ${displayDate(status.finished_at)} IST` : status.state === 'failed' ? `Last run failed: ${status.error}` : 'Idle'; if (!payload.running) break; await new Promise(resolve => setTimeout(resolve, 1500)); }
    await load();
  } finally {
    button.disabled = false;
    button.textContent = 'Fetch now';
    for (const id of ['runScope', 'runPlatform', 'runMode']) el(id).disabled = false;
  }
}

async function openRecords() {
  // Records modal lets the user delete old runs. The server creates a backup
  // before it deletes anything.
  el('recordsModal').hidden = false;
  document.body.classList.add('modal-open');
  el('recordsMessage').textContent = 'Loading run list…';
  try {
    const [runsPayload, statusPayload] = await Promise.all([fetchJson('api/runs'), fetchJson('api/run-status')]);
    state.recordsRunActive = Boolean(statusPayload.running);
    state.runs = runsPayload.runs || [];
    el('runList').innerHTML = state.runs.map(run => `<label class="run-item"><input type="checkbox" class="run-select" value="${escapeAttribute(run.run_id)}" ${state.recordsRunActive ? 'disabled' : ''}><span><strong>${escapeHtml(displayDate(run.captured_at))}</strong><small>${fmt.format(run.targets)} rows · ${fmt.format(run.collected)} collected · ${fmt.format(run.failed + run.count_not_found)} incomplete</small></span></label>`).join('') || '<p class="panel-note">No collection runs are stored.</p>';
    el('recordsMessage').textContent = state.recordsRunActive ? 'A collection is running. Finish it before deleting records.' : state.runs.length ? 'Select one or more runs to remove.' : 'No collection runs are stored.';
    updateDeleteButtons();
  } catch (error) { el('recordsMessage').textContent = error.message; }
}
function updateDeleteButtons() { el('deleteRuns').disabled = state.recordsRunActive || !document.querySelectorAll('.run-select:checked').length; el('deleteAll').disabled = state.recordsRunActive || el('deleteConfirmation').value !== 'DELETE ALL RECORDS'; }
async function deleteSelectedRuns() { const runIds = [...document.querySelectorAll('.run-select:checked')].map(input => input.value); if (!runIds.length) return; el('deleteRuns').disabled = true; try { const result = await fetchJson('api/records/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'runs', runIds }) }); await load(); await openRecords(); el('recordsMessage').textContent = `Deleted ${result.deleted_rows} rows. Backup created.`; } catch (error) { el('recordsMessage').textContent = error.message; updateDeleteButtons(); } }
async function deleteAllRecords() { if (el('deleteConfirmation').value !== 'DELETE ALL RECORDS') return; el('deleteAll').disabled = true; try { const result = await fetchJson('api/records/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) }); await load(); el('deleteConfirmation').value = ''; await openRecords(); el('recordsMessage').textContent = `Deleted ${result.deleted_rows} rows. Backup created.`; } catch (error) { el('recordsMessage').textContent = error.message; updateDeleteButtons(); } }

function updateFilter(id, value) { state.filters[id] = value; renderAll(); }
function clearFilters() { state.filters = { search: '', displayPlatform: '', status: '', dateFrom: '', dateTo: '', missingOnly: false }; for (const id of ['search', 'displayPlatform', 'statusFilter']) el(id).value = ''; el('missingOnly').checked = false; renderAll(); }

// From here down, buttons and form controls are wired to the functions above.
el('launchFetcher').addEventListener('click', showApp);
el('launchAccounts').addEventListener('click', () => showAccountPage('launch'));
el('launchPaste').addEventListener('click', () => showPastePage('launch'));
el('backToLaunch').addEventListener('click', goLaunch);
el('openAccounts').addEventListener('click', () => showAccountPage('dashboard'));
el('openAccountEditor').addEventListener('click', () => showAccountPage('dashboard'));
el('openPaste').addEventListener('click', () => showPastePage('dashboard'));
el('clearRecords').addEventListener('click', openRecords);
el('toggleSelectionPanel').addEventListener('click', toggleSelectionPanel);
el('runNow').addEventListener('click', runNow);
el('emptyRun').addEventListener('click', runNow);
el('dismissRun').addEventListener('click', () => { state.run = null; el('runProgress').hidden = true; el('headerProgressBar').classList.remove('active'); });
el('runScope').addEventListener('change', renderControls);
el('runPlatform').addEventListener('change', renderControls);
el('runMode').addEventListener('change', renderControls);
el('addAccount').addEventListener('click', addAccount);
el('saveAccounts').addEventListener('click', () => saveAccounts().catch(error => { el('editorError').hidden = false; el('editorError').textContent = error.message; }));
el('deleteSelectedAccounts').addEventListener('click', deleteSelectedAccounts);
el('editorSearch').addEventListener('input', renderEditor);
el('selectAllEditor').addEventListener('click', () => { const query = el('editorSearch').value.trim().toLowerCase(); for (const account of state.accounts.filter(item => accountMatches(item, query))) state.editorSelected.add(organizationId(account)); renderEditor(); });
el('clearEditorSelection').addEventListener('click', () => { state.editorSelected.clear(); renderEditor(); });
el('closeAccountPage').addEventListener('click', closeAccountPage);
el('closePastePage').addEventListener('click', closePastePage);
el('accountSearch').addEventListener('input', renderSelection);
el('selectVisible').addEventListener('click', () => { const query = el('accountSearch').value.trim().toLowerCase(); for (const account of state.accounts.filter(item => accountMatches(item, query))) state.selectedOrganizations.add(organizationId(account)); persistSelection(); renderAll(); });
el('clearSelected').addEventListener('click', () => { state.selectedOrganizations.clear(); persistSelection(); renderAll(); });
el('selectionList').addEventListener('change', event => { if (!event.target.matches('.org-select')) return; const id = event.target.dataset.orgId; if (event.target.checked) state.selectedOrganizations.add(id); else state.selectedOrganizations.delete(id); persistSelection(); renderSelectionDependentViews(); });
el('accountRows').addEventListener('input', event => { if (event.target.matches('.account-value')) event.target.title = event.target.value; });
el('accountRows').addEventListener('change', event => { if (!event.target.matches('.editor-select')) return; const id = event.target.dataset.orgId; if (event.target.checked) state.editorSelected.add(id); else state.editorSelected.delete(id); renderEditor(); });
el('accountRows').addEventListener('click', event => { const button = event.target.closest('.delete-account'); if (button) removeAccount(button.closest('tr').dataset.orgId); });
el('search').addEventListener('input', event => updateFilter('search', event.target.value.trim()));
el('displayPlatform').addEventListener('change', event => updateFilter('displayPlatform', event.target.value));
el('statusFilter').addEventListener('change', event => updateFilter('status', event.target.value));
el('dateFrom').addEventListener('change', event => updateFilter('dateFrom', event.target.value));
el('dateTo').addEventListener('change', event => updateFilter('dateTo', event.target.value));
el('missingOnly').addEventListener('change', event => updateFilter('missingOnly', event.target.checked));
el('clearFilters').addEventListener('click', clearFilters);
el('viewLatest').addEventListener('click', () => { state.view = 'latest'; renderAll(); });
el('viewHistory').addEventListener('click', () => { state.view = 'history'; renderAll(); });
el('historyMatrix').addEventListener('change', () => { state.historyLayout = 'matrix'; renderView(); });
el('historyRowsView').addEventListener('change', () => { state.historyLayout = 'rows'; renderView(); });
el('previewPaste').addEventListener('click', previewPaste);
el('pasteRows').addEventListener('change', event => { if (!event.target.matches('[data-paste-index]')) return; state.pasteRows[Number(event.target.dataset.pasteIndex)].include = event.target.checked; renderPastePreview(); });
el('savePaste').addEventListener('click', () => savePaste().catch(error => { el('pasteSummary').textContent = error.message; }));
el('runList').addEventListener('change', updateDeleteButtons);
el('deleteConfirmation').addEventListener('input', updateDeleteButtons);
el('deleteRuns').addEventListener('click', deleteSelectedRuns);
el('deleteAll').addEventListener('click', deleteAllRecords);
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { el(button.dataset.close).hidden = true; document.body.classList.remove('modal-open'); }));
el('recordsModal').addEventListener('click', event => { if (event.target === el('recordsModal')) { el('recordsModal').hidden = true; document.body.classList.remove('modal-open'); } });
el('exportToggle').addEventListener('click', () => { const menu = el('exportMenu'); menu.hidden = !menu.hidden; el('exportToggle').setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', event => { if (!event.target.closest('.menu-wrap')) { el('exportMenu').hidden = true; el('exportToggle').setAttribute('aria-expanded', 'false'); } const accountButton = event.target.closest('[data-open-account]'); if (accountButton) showAccountPage('dashboard', accountButton.dataset.openAccount); });

load().then(async () => { if (!state.staticMode) { const run = await fetchJson('api/run-status'); if (run.running) await pollRunStatus(); } }).catch(error => { el('launchTitle').insertAdjacentHTML('afterend', `<p class="danger-text">${escapeHtml(error.message)}</p>`); });
