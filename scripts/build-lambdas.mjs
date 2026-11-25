// Bundles each API handler with esbuild and zips it to dist/lambda/<name>.zip.
//
// Output per function (consumed by terraform/, task 17.3):
//   dist/lambda/<name>/index.js      CommonJS bundle (AWS SDK bundled, source map inline)
//   dist/lambda/<name>.zip           contains only index.js at the zip root
// Lambda settings: runtime nodejs20.x, architecture arm64, handler "index.handler".
// Set NODE_OPTIONS=--enable-source-maps on the function for readable stack traces.
//
// Zipping uses the system `zip` CLI (preinstalled on macOS and most Linux images).
// Usage: npm run build:lambdas

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const handlersDir = path.join(repoRoot, 'services/api/src/handlers');
const outRoot = path.join(repoRoot, 'dist/lambda');

export const FUNCTIONS = ['trips', 'invites', 'items', 'catalog', 'checks', 'explain', 'reminder'];

rmSync(outRoot, { recursive: true, force: true });

for (const name of FUNCTIONS) {
  const outDir = path.join(outRoot, name);
  mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(handlersDir, `${name}.ts`)],
    outfile: path.join(outDir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    sourcemap: 'inline',
    // Bundle everything, including the AWS SDK.
    external: [],
    logLevel: 'warning',
  });

  // The repo is "type": "module"; this marker lets Node load the CJS bundle locally.
  // It is not included in the zip (Lambda treats index.js as CJS by default).
  writeFileSync(path.join(outDir, 'package.json'), '{ "type": "commonjs" }\n');

  const zipPath = path.join(outRoot, `${name}.zip`);
  // -X: omit extra file attributes (uid/gid) from the zip.
  execFileSync('zip', ['-q', '-X', zipPath, 'index.js'], { cwd: outDir, stdio: 'inherit' });
  console.log(`built ${path.relative(repoRoot, zipPath)}`);
}
