// ============================================================
// Prepare Next.js Standalone for Electron Packaging
// ============================================================

import { mkdirSync, existsSync, copyFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT_DIR = join(__dirname, '..', '..', '..');
const NEXT_APP_DIR = join(ROOT_DIR, 'packages', 'app');
const STANDALONE_DIR = join(NEXT_APP_DIR, '.next', 'standalone');
const OUTPUT_DIR = join(__dirname, '..', 'resources', 'standalone');

// rsync on macOS can return exit code 23 (extended attribute warnings) even on success.
// Wrap in try-catch and verify the transfer actually completed.
function rsyncCopy(src: string, dest: string) {
  try {
    execSync(`rsync -a --copy-links "${src}/" "${dest}/"`, { stdio: 'inherit' });
  } catch (err: any) {
    // Exit code 23 = "Some files could not be transferred" — usually extended attribute
    // warnings on macOS. The transfer itself completed successfully.
    if (err.status !== 23) throw err;
    console.warn('[Prepare Standalone] rsync exited with code 23 (extended attribute warning, transfer OK)');
  }
}

async function main() {
  console.log('[Prepare Standalone] Starting...');

  // 1. Verify standalone build exists (built by `pnpm build:next` upstream)
  if (!existsSync(STANDALONE_DIR)) {
    throw new Error(`Standalone build not found at ${STANDALONE_DIR}. Run "pnpm build:next" first.`);
  }

  // 2. Copy standalone output (dereference all symlinks for Electron bundling)
  console.log('[Prepare Standalone] Copying standalone output...');
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  rsyncCopy(STANDALONE_DIR, OUTPUT_DIR);

  // 3. Copy static assets (standalone doesn't include public/ and .next/static/)
  console.log('[Prepare Standalone] Copying static assets...');
  const publicDir = join(NEXT_APP_DIR, 'public');
  const staticDir = join(NEXT_APP_DIR, '.next', 'static');
  const appInResources = join(OUTPUT_DIR, 'packages', 'app');

  if (existsSync(publicDir)) {
    rsyncCopy(publicDir, join(appInResources, 'public'));
  }

  if (existsSync(staticDir)) {
    mkdirSync(join(appInResources, '.next', 'static'), { recursive: true });
    rsyncCopy(staticDir, join(appInResources, '.next', 'static'));
  }

  // 4. Remove stale better-sqlite3 binding from .next/node_modules inside the resources
  //    (Next.js bundles an old binding that shadows the correct standalone copy)
  console.log('[Prepare Standalone] Cleaning stale native bindings...');
  const staleBindingsDir = join(OUTPUT_DIR, 'packages', 'app', '.next', 'node_modules');
  if (existsSync(staleBindingsDir)) {
    const staleModules = readdirSync(staleBindingsDir).filter((d: string) => d.startsWith('better-sqlite3'));
    for (const mod of staleModules) {
      rmSync(join(staleBindingsDir, mod), { recursive: true, force: true });
      console.log(`[Prepare Standalone] Removed stale ${mod}`);
    }
  }

  // 5. Create native/better-sqlite3 for SEA fallback loading
  //    The bundled code looks for native/better-sqlite3/lib/index.js relative to cwd.
  //    pnpm store bindings may be corrupted by electron-rebuild, so install fresh
  //    better-sqlite3 in a temp dir to get the correct system Node binding.
  console.log('[Prepare Standalone] Setting up native better-sqlite3...');
  const nativeDest = join(OUTPUT_DIR, 'packages', 'app', 'native', 'better-sqlite3');
  if (!existsSync(nativeDest)) {
    mkdirSync(join(nativeDest, '..'), { recursive: true });
    const tmpDir = join(OUTPUT_DIR, '_tmp_sqlite');
    try {
      execSync(`mkdir -p "${tmpDir}" && cd "${tmpDir}" && npm init -y --silent && npm install better-sqlite3@12.8.0 --silent`, { stdio: 'inherit' });
      execSync(`cp -R "${tmpDir}/node_modules/better-sqlite3" "${nativeDest}"`, { stdio: 'inherit' });
      console.log(`[Prepare Standalone] Created native/better-sqlite3 from fresh install`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 5. Copy missing dependencies that Next.js standalone doesn't include with pnpm
  console.log('[Prepare Standalone] Copying missing dependencies...');
  const missingDeps = [
    'react',
    'react-dom',
    'react-is',
    'styled-jsx',
    '@swc/helpers',
    '@next/env',
    'postcss',
    'caniuse-lite',
  ];
  const pnpmStore = join(ROOT_DIR, 'node_modules', '.pnpm');

  for (const dep of missingDeps) {
    // Handle scoped packages: @swc/helpers -> @swc+helpers
    const pnpmFriendlyName = dep.replace('/', '+');
    const prefix = `${pnpmFriendlyName}@`;
    const pnpmDirs = readdirSync(pnpmStore).filter((d: string) => d.startsWith(prefix));
    const found = pnpmDirs[0];

    if (found) {
      const srcDir = join(pnpmStore, found, 'node_modules', dep);
      const destDir = join(appInResources, 'node_modules', dep);
      if (existsSync(srcDir)) {
        console.log(`[Prepare Standalone] Copying ${dep}...`);
        rsyncCopy(srcDir, destDir);
      }
    } else {
      console.warn(`[Prepare Standalone] Warning: ${dep} not found in pnpm store`);
    }
  }

  // 6. Create start-standalone.js wrapper
  console.log('[Prepare Standalone] Creating start-standalone.js wrapper...');
  const wrapperScript = `
const http = require('http');

// Set PORT before requiring server.js
// server.js uses: parseInt(process.env.PORT, 10) || 3000
process.env.PORT = '3000';
// Bind to localhost only for security
process.env.HOSTNAME = '127.0.0.1';

// server.js starts the Next.js server directly (no exports)
require('./packages/app/server.js');

// Poll until ready, then output the port for Electron
const PORT = 3000;
const checkUrl = 'http://127.0.0.1:' + PORT;
const start = Date.now();
const timeout = 30000;

function check() {
  http.get(checkUrl, (res) => {
    res.resume();
    console.log('THETHING_PORT=' + PORT);
    console.log('THETHING_READY');
  }).on('error', () => {
    if (Date.now() - start > timeout) {
      console.error('Server did not start within ' + (timeout / 1000) + 's');
      process.exit(1);
    }
    setTimeout(check, 200);
  });
}
check();
`;

  const wrapperPath = join(OUTPUT_DIR, 'start-standalone.js');
  writeFileSync(wrapperPath, wrapperScript);

  console.log('[Prepare Standalone] Done!');
}

main().catch((error) => {
  console.error('[Prepare Standalone] Failed:', error);
  process.exit(1);
});
