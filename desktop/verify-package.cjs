const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

module.exports = async ({ appOutDir }) => {
  const runtime = path.resolve(appOutDir, 'resources', 'runtime');
  for (const relative of ['app/server.mjs', 'public/app.js', 'accounts.csv', 'node_modules/playwright-core/cli.js']) {
    await fs.access(path.join(runtime, relative));
  }
  execFileSync(process.execPath, [path.join(runtime, 'node_modules/playwright-core/cli.js'), '--version'], { windowsHide: true });
  const runtimeRequire = createRequire(path.join(runtime, 'package.json'));
  for (const dependency of ['exceljs', 'playwright', 'playwright-core']) {
    const resolved = runtimeRequire.resolve(dependency);
    if (!resolved.startsWith(path.join(runtime, 'node_modules') + path.sep)) {
      throw new Error(`${dependency} resolves outside the packaged runtime: ${resolved}`);
    }
    runtimeRequire(dependency);
  }
  for (const relative of ['data', 'public/data']) {
    if (await fs.access(path.join(runtime, relative)).then(() => true, () => false)) {
      throw new Error(`Private records must not be packaged: ${relative}`);
    }
  }
  const demo = await fs.readFile(path.join(__dirname, 'demo-accounts.csv'));
  if (!demo.equals(await fs.readFile(path.join(runtime, 'accounts.csv')))) {
    throw new Error('Only the demo accounts file may be packaged.');
  }
  console.log('Package verified: bundled runtime dependencies, demo accounts, no collected records.');
};
