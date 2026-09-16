import fs from 'node:fs/promises';
import path from 'node:path';
import { HISTORY_MATRIX_CSV, LATEST_JSON, ROOT, SNAPSHOTS_CSV, readSnapshots, writeHistoryMatrix } from './utils.mjs';

const outputDir = path.join(ROOT, 'public', 'data');
await fs.mkdir(outputDir, { recursive: true });

const snapshots = await readSnapshots();
await writeHistoryMatrix(snapshots);

async function copyIfExists(from, to) {
  try {
    await fs.copyFile(from, to);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await copyIfExists(LATEST_JSON, path.join(outputDir, 'latest.json'));
await copyIfExists(SNAPSHOTS_CSV, path.join(outputDir, 'snapshots.csv'));
await copyIfExists(HISTORY_MATRIX_CSV, path.join(outputDir, 'history_matrix.csv'));
await fs.writeFile(path.join(outputDir, 'snapshots.json'), JSON.stringify({ rows: snapshots }, null, 2), 'utf8');

console.log(JSON.stringify({
  outputDir,
  snapshots: snapshots.length,
}, null, 2));

