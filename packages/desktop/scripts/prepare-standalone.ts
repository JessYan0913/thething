// ============================================================
// Prepare Next.js Standalone for Electron Packaging
// ============================================================

import { mkdirSync, existsSync, copyFileSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT_DIR = join(__dirname, '..', '..');
const NEXT_APP_DIR = join(ROOT_DIR, 'app');
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

  // 5. Create start-standalone.js wrapper
  console.log('[Prepare Standalone] Creating start-standalone.js wrapper...');
  const wrapperScript = `
const http = require('http');
const next = require('./packages/app/server.js');

const port = parseInt(process.argv.find(a => a === '-p')
  ? process.argv[process.argv.indexOf('-p') + 1] : '3456');

const server = http.createServer(next);
server.listen(port === 0 ? 0 : port, '127.0.0.1', () => {
  const addr = server.address();
  console.log('THETHING_PORT=' + addr.port);
  console.log('THETHING_READY');
});
`;

  const wrapperPath = join(OUTPUT_DIR, 'start-standalone.js');
  writeFileSync(wrapperPath, wrapperScript);

  console.log('[Prepare Standalone] Done!');
}

main().catch((error) => {
  console.error('[Prepare Standalone] Failed:', error);
  process.exit(1);
});
