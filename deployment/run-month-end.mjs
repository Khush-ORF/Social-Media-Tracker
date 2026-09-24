import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(deployDir);
const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const [year, month, day] = localDate.split('-').map(Number);
const finalDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
if (day !== finalDay) {
  console.log(`IST date ${localDate} is not month end; no collection run.`);
  process.exit(0);
}

const collector = path.join(repoRoot, 'app', 'collect.mjs');
const child = spawn(process.execPath, [collector, '--all', '--render', '--concurrency', '4'], {
  cwd: repoRoot,
  env: { ...process.env, TRACKER_DATA_ROOT: process.env.TRACKER_DATA_ROOT || path.join(deployDir, 'runtime'), COLLECT_RENDER: 'true' },
  stdio: 'inherit',
});
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('close', code => { process.exitCode = code ?? 1; });
