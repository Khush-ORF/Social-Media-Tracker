import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(directory);
const repo = 'Khush-ORF/Social-Media-Tracker';
const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  const credential = spawnSync('git', ['credential', 'fill'], { cwd: root, input: `protocol=https\nhost=github.com\npath=${repo}.git\n\n`, encoding: 'utf8', timeout: 30000, windowsHide: true });
  token = credential.stdout?.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
}
if (!token) throw new Error('GitHub authentication is unavailable. Sign in using Git Credential Manager or set GH_TOKEN.');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'social-follower-tracker-release' };
async function api(route, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}${route}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}) for ${route}`);
  return response.json();
}
const repository = await api('');
if (!process.argv.includes('--publish')) {
  console.log(JSON.stringify({ repository: repository.full_name, canPublish: Boolean(repository.permissions?.push) }));
} else {
  const tag = `v${pkg.version}`;
  const filename = `Social-Follower-Tracker-${pkg.version}-Windows-x64.exe`;
  const binary = await fs.readFile(path.join(directory, 'dist', filename));
  const checksums = `${createHash('sha256').update(binary).digest('hex')}  ${filename}\n`;
  await fs.writeFile(path.join(directory, 'dist/SHA256SUMS.txt'), checksums);
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
  const branch = await api('/commits/main');
  if (branch.sha !== commit) throw new Error('Push the tested source commit to main before publishing.');
  const release = await api('/releases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: `Social Follower Tracker ${tag} - Windows Desktop`, body: await fs.readFile(path.join(directory, 'release-notes.md'), 'utf8'), draft: true }) });
  console.log(JSON.stringify({ draftRelease: release.html_url, id: release.id }));
  for (const [name, body, type] of [[filename, binary, 'application/octet-stream'], ['SHA256SUMS.txt', checksums, 'text/plain']]) {
    const response = await fetch(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...headers, 'content-type': type }, body });
    if (!response.ok) throw new Error(`Asset upload failed (${response.status}); release remains a draft.`);
    const asset = await response.json();
    console.log(JSON.stringify({ asset: asset.name, bytes: asset.size }));
  }
  const published = await api(`/releases/${release.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: false }) });
  console.log(JSON.stringify({ published: published.html_url, assets: published.assets.map(asset => asset.browser_download_url) }));
}
