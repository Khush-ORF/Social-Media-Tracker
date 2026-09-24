import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(desktop);
const runtime = path.join(desktop, 'build/runtime');
await fs.rm(path.join(desktop, 'build'), { recursive: true, force: true });
await fs.mkdir(runtime, { recursive: true });
for (const folder of ['app', 'public', 'sql']) {
  await fs.cp(path.join(root, folder), path.join(runtime, folder), { recursive: true });
}
for (const file of ['accounts.csv', 'package.json']) await fs.copyFile(path.join(root, file), path.join(runtime, file));
await fs.cp(path.join(root, 'data'), path.join(runtime, 'data'), {
  recursive: true,
  filter: source => !source.endsWith('-wal') && !source.endsWith('-shm'),
});
await fs.cp(path.join(root, 'node_modules'), path.join(runtime, 'node_modules'), {
  recursive: true,
  filter: source => !source.includes(`${path.sep}.cache${path.sep}`),
});
const manifest = JSON.parse(await fs.readFile(path.join(root, 'node_modules/playwright-core/browsers.json'), 'utf8'));
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA, 'ms-playwright');
for (const name of ['chromium-headless-shell', 'ffmpeg', 'winldd']) {
  const entry = manifest.browsers.find(browser => browser.name === name);
  if (!entry) continue;
  const folder = `${name.replaceAll('-', '_')}-${entry.revision}`;
  await fs.cp(path.join(cache, folder), path.join(desktop, 'build/browsers', folder), { recursive: true });
}
console.log(`Desktop runtime prepared: ${runtime}`);
