import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(desktop);
const build = path.join(desktop, 'build');
const runtime = path.join(build, 'runtime');
const sourceModules = path.join(root, 'node_modules');

if (path.dirname(build) !== desktop || path.basename(build) !== 'build') throw new Error('Unexpected Electron staging directory.');
await fs.rm(build, { recursive: true, force: true });
await fs.mkdir(runtime, { recursive: true });
for (const folder of ['app', 'public', 'sql']) {
  await fs.cp(path.join(root, folder), path.join(runtime, folder), {
    recursive: true,
    filter: source => folder !== 'public' || path.relative(path.join(root, folder), source) !== 'data',
  });
}

// Electron builds are fresh installs: include demo accounts but never live history.
await fs.copyFile(path.join(desktop, 'demo-accounts.csv'), path.join(runtime, 'accounts.csv'));
await fs.copyFile(path.join(root, 'package.json'), path.join(runtime, 'package.json'));
await fs.cp(sourceModules, path.join(runtime, 'node_modules'), {
  recursive: true,
  filter: source => {
    const relative = path.relative(sourceModules, source);
    const segments = relative.split(path.sep);
    const name = segments.at(-1) || '';
    if (segments.includes('.local-browsers')) return false;
    if (relative === `exceljs${path.sep}dist` || relative.startsWith(`exceljs${path.sep}dist${path.sep}`)) return false;
    if (source.includes(`${path.sep}.cache${path.sep}`)) return false;
    if (/\.(map|md|d\.ts)$/i.test(name)) return false;
    if (segments.includes('test') || segments.includes('tests') || segments.includes('types')) return false;
    return true;
  },
});
for (const relative of ['data', 'public/data']) {
  if (await fs.access(path.join(runtime, relative)).then(() => true, () => false)) throw new Error(`Collected data must not be packaged: ${relative}`);
}
console.log(`Electron runtime prepared with demo accounts and no seed history: ${runtime}`);
