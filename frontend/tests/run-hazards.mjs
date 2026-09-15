import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(root, '.hazards-test-'));
try {
  const tests = ['shared-hazards', 'hazard-picker'];
  await build({
    absWorkingDir: root, entryPoints: tests.map(name => `tests/${name}.test.ts`),
    outdir: temporary, outExtension: { '.js': '.cjs' }, bundle: true,
    platform: 'node', format: 'cjs', external: ['jsdom'],
    define: { 'import.meta.env': JSON.stringify({ VITE_API_BASE_URL: 'http://test/api/v1' }) },
  });
  const result = spawnSync(process.execPath, ['--test', ...tests.map(name => join(temporary, `${name}.test.cjs`))], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
