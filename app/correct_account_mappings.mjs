import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, parseCsv, toCsv, SNAPSHOT_COLUMNS, readAccounts, readSnapshots, writeLatest, writeHistoryMatrix } from './utils.mjs';

const corrections = [
  { old: '002-x', id: 'legacy-atlantic-africa-x', name: 'Atlantic Council Africa Center', url: 'https://x.com/acafricacenter' },
  { old: '002-linkedin', id: 'legacy-atlantic-africa-linkedin', name: 'Atlantic Council Africa Center', url: 'https://www.linkedin.com/showcase/atlantic-council-africa-center' },
  { old: '003-linkedin', id: 'legacy-aljazeera-network-linkedin', name: 'Al Jazeera Media Network', url: 'https://www.linkedin.com/company/aljazeera' },
];
const note = 'Mapping corrected 2026-09-23: historical observation belongs to this organisation, not the originally requested research centre. Excluded from active tracking.';
function correct(row, account = false) {
  const fix = corrections.find(c => (row.id === c.old || row.id === c.id) && row.profile_url === c.url);
  if (!fix) return row;
  const website = fix.id.includes('aljazeera') ? 'https://network.aljazeera.net/' : 'https://www.atlanticcouncil.org/programs/africa-center/';
  return { ...row, id: fix.id, name: fix.name, website, notes: note, ...(account ? { active: 'false' } : {}) };
}
const accountsPath = path.join(ROOT, 'accounts.csv');
const original = parseCsv(await fs.readFile(accountsPath, 'utf8'));
const accounts = original.map(row => correct(row, true));
const profiles = [
  ['linkedin', 'LinkedIn', 'company/africa-center', 'https://www.linkedin.com/company/africa-center'],
  ['youtube', 'YouTube', 'user/Africacenterorg', 'https://www.youtube.com/user/Africacenterorg/'],
  ['instagram', 'Instagram', 'africacenter_strategicstudies', 'https://www.instagram.com/africacenter_strategicstudies/'],
  ['facebook', 'Facebook', 'AfricaCenter', 'https://www.facebook.com/AfricaCenter/'],
];
for (const [suffix, platform, handle, profile_url] of profiles) {
  const id = `002-${suffix}`;
  if (!accounts.some(row => row.id === id)) accounts.push({ id, name: 'Africa Center for Strategic Studies', website: 'https://africacenter.org/', platform, handle, profile_url, active: 'true', notes: 'Verified official website social link on 2026-09-23 | Source: https://africacenter.org/' });
}
await fs.writeFile(accountsPath, toCsv(accounts, Object.keys(original[0])));
const snapshots = (await readSnapshots()).map(row => correct(row));
await fs.writeFile(path.join(ROOT, 'data/snapshots.csv'), toCsv(snapshots, SNAPSHOT_COLUMNS));
const runsDir = path.join(ROOT, 'data/runs');
for (const file of await fs.readdir(runsDir)) {
  if (!file.endsWith('.json')) continue;
  const full = path.join(runsDir, file);
  const rows = JSON.parse(await fs.readFile(full, 'utf8'));
  if (!Array.isArray(rows)) continue;
  const updated = rows.map(row => correct(row));
  if (JSON.stringify(rows) !== JSON.stringify(updated)) await fs.writeFile(full, JSON.stringify(updated, null, 2));
}
const quote = value => `'${value.replaceAll("'", "''")}'`;
const sql = corrections.map(c => `UPDATE snapshots SET account_id=${quote(c.id)}, name=${quote(c.name)}, website=${quote(correct({ id: c.id, profile_url: c.url }).website)}, notes=${quote(note)} WHERE account_id IN (${quote(c.old)}, ${quote(c.id)}) AND profile_url=${quote(c.url)};`).join('\n');
const result = spawnSync(process.env.SQLITE3_BIN || (process.platform === 'win32' ? 'C:\\msys64\\ucrt64\\bin\\sqlite3.exe' : 'sqlite3'), [path.join(ROOT, 'data/follower_tracker.sqlite')], { input: `BEGIN;\n${sql}\nCOMMIT;`, encoding: 'utf8' });
if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
await writeLatest(snapshots, await readAccounts());
await writeHistoryMatrix(snapshots);
console.log(JSON.stringify({ accounts: accounts.length, snapshots: snapshots.length, correctedProfiles: corrections.length, addedProfiles: profiles.length }));
