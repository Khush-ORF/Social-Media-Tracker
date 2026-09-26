import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Small GitHub release helper. It publishes only an already-built, already-
// verified installer from desktop/dist-electron.
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(directory);
const repo = 'Khush-ORF/Social-Media-Tracker';
const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  // Reuse the normal Git Credential Manager login when no token env var exists.
  const credential = spawnSync('git', ['credential', 'fill'], { cwd: root, input: `protocol=https\nhost=github.com\npath=${repo}.git\n\n`, encoding: 'utf8', timeout: 30000, windowsHide: true });
  token = credential.stdout?.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
}
if (!token) throw new Error('GitHub authentication is unavailable. Sign in using Git Credential Manager or set GH_TOKEN.');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'social-follower-tracker-release' };
async function api(route, options = {}) {
  // Thin wrapper so all GitHub calls share auth headers and consistent errors.
  const response = await fetch(`https://api.github.com/repos/${repo}${route}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}) for ${route}`);
  return response.json();
}
const repository = await api('');
if (!process.argv.includes('--publish')) {
  const releases = await api('/releases');
  console.log(JSON.stringify({ repository: repository.full_name, canPublish: Boolean(repository.permissions?.push), releases: releases.map(release => ({ tag: release.tag_name, draft: release.draft, url: release.html_url })) }));
} else {
  // Publishing is strict: checksum must match, tracked files must be committed,
  // and local HEAD must already be pushed to main.
  const tag = `v${pkg.version}`;
  const filename = `Social-Follower-Tracker-${pkg.version}-Windows-x64-Setup.exe`;
  const releaseDirectory = path.join(directory, 'dist-electron');
  const binary = await fs.readFile(path.join(releaseDirectory, filename));
  const checksums = `${createHash('sha256').update(binary).digest('hex')}  ${filename}\n`;
  const expectedChecksum = await fs.readFile(path.join(releaseDirectory, 'SHA256SUMS.txt'), 'utf8');
  if (checksums.trim() !== expectedChecksum.trim()) throw new Error('Installer does not match the verified SHA256SUMS.txt.');
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('Commit all tracked source changes before publishing.');
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
  const branch = await api('/commits/main');
  if (branch.sha !== commit) throw new Error('Push the tested source commit to main before publishing.');
  const releases = await api('/releases');
  let release = releases.find(item => item.tag_name === tag);
  if (release && !release.draft) throw new Error(`${tag} is already published. Refusing to overwrite it.`);
  if (!release) release = await api('/releases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: `Social Follower Tracker ${tag} - Windows Desktop`, body: await fs.readFile(path.join(directory, 'release-notes.md'), 'utf8'), draft: true }) });
  else release = await api(`/releases/${release.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target_commitish: commit, body: await fs.readFile(path.join(directory, 'release-notes.md'), 'utf8') }) });
  console.log(JSON.stringify({ draftRelease: release.html_url, id: release.id }));
  const verification = await fs.readFile(path.join(directory, 'VERIFICATION.md'));
  for (const [name, body, type] of [[filename, binary, 'application/octet-stream'], ['SHA256SUMS.txt', checksums, 'text/plain'], ['VERIFICATION.md', verification, 'text/markdown'], ['demo-accounts.csv', await fs.readFile(path.join(directory, 'demo-accounts.csv')), 'text/csv']]) {
    const previous = release.assets.find(asset => asset.name === name);
    if (previous) {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${previous.id}`, { method: 'DELETE', headers });
      if (!response.ok) throw new Error(`Unable to replace draft asset ${name}: ${response.status}`);
    }
    const response = await fetch(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...headers, 'content-type': type }, body });
    if (!response.ok) throw new Error(`Asset upload failed (${response.status}); release remains a draft.`);
    const asset = await response.json();
    console.log(JSON.stringify({ asset: asset.name, bytes: asset.size }));
  }
  const published = await api(`/releases/${release.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'true' }) });
  console.log(JSON.stringify({ published: published.html_url, assets: published.assets.map(asset => asset.browser_download_url) }));
}
