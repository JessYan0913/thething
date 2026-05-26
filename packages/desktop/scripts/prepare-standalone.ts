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
  execSync(`rsync -a --copy-links "${STANDALONE_DIR}/" "${OUTPUT_DIR}/"`, { stdio: 'inherit' });

  // 3. Copy static assets (standalone doesn't include public/ and .next/static/)
  console.log('[Prepare Standalone] Copying static assets...');
  const publicDir = join(NEXT_APP_DIR, 'public');
  const staticDir = join(NEXT_APP_DIR, '.next', 'static');
  const appInResources = join(OUTPUT_DIR, 'packages', 'app');

  if (existsSync(publicDir)) {
    execSync(`rsync -a --copy-links "${publicDir}/" "${join(appInResources, 'public')}/"`, { stdio: 'inherit' });
  }

  if (existsSync(staticDir)) {
    mkdirSync(join(appInResources, '.next', 'static'), { recursive: true });
    execSync(`rsync -a --copy-links "${staticDir}/" "${join(appInResources, '.next', 'static')}/"`, { stdio: 'inherit' });
  }

  // 4. Copy better-sqlite3 native binding
  console.log('[Prepare Standalone] Copying better-sqlite3 native binding...');
  const sqliteBindingSrc = join(NEXT_APP_DIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const sqliteBindingDest = join(appInResources, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

  if (existsSync(sqliteBindingSrc)) {
    mkdirSync(join(sqliteBindingDest, '..'), { recursive: true });
    copyFileSync(sqliteBindingSrc, sqliteBindingDest);
  } else {
    console.warn('[Prepare Standalone] Warning: better-sqlite3 native binding not found');
  }

  // 5. Copy missing dependencies that Next.js standalone doesn't include with pnpm
  console.log('[Prepare Standalone] Copying missing dependencies...');
  const missingDeps = [
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
        execSync(`rsync -a --copy-links "${srcDir}/" "${destDir}/"`, { stdio: 'inherit' });
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
