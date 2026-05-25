// ============================================================
// Prepare Next.js Standalone for Tauri Packaging
// ============================================================

import { execSync } from 'child_process';
import { mkdirSync, cpSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = join(__dirname, '..', '..');
const NEXT_APP_DIR = join(ROOT_DIR, 'app');
const STANDALONE_DIR = join(NEXT_APP_DIR, '.next', 'standalone');
const TAURI_RESOURCES_DIR = join(__dirname, '..', 'src-tauri', 'resources', 'app');

async function main() {
  console.log('[Prepare Standalone] Starting...');

  // 1. Build Next.js standalone
  console.log('[Prepare Standalone] Building Next.js...');
  execSync('npm run build', { cwd: NEXT_APP_DIR, stdio: 'inherit' });

  // 2. Copy standalone output to Tauri resources
  console.log('[Prepare Standalone] Copying standalone output...');
  if (existsSync(TAURI_RESOURCES_DIR)) {
    execSync(`rm -rf ${TAURI_RESOURCES_DIR}`);
  }
  mkdirSync(TAURI_RESOURCES_DIR, { recursive: true });
  cpSync(STANDALONE_DIR, TAURI_RESOURCES_DIR, { recursive: true });

  // 3. Copy static assets (standalone doesn't include public/ and .next/static/)
  console.log('[Prepare Standalone] Copying static assets...');
  const publicDir = join(NEXT_APP_DIR, 'public');
  const staticDir = join(NEXT_APP_DIR, '.next', 'static');

  if (existsSync(publicDir)) {
    cpSync(publicDir, join(TAURI_RESOURCES_DIR, 'public'), { recursive: true });
  }

  if (existsSync(staticDir)) {
    mkdirSync(join(TAURI_RESOURCES_DIR, '.next', 'static'), { recursive: true });
    cpSync(staticDir, join(TAURI_RESOURCES_DIR, '.next', 'static'), { recursive: true });
  }

  // 4. Copy better-sqlite3 native binding
  console.log('[Prepare Standalone] Copying better-sqlite3 native binding...');
  const sqliteBindingSrc = join(NEXT_APP_DIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const sqliteBindingDest = join(TAURI_RESOURCES_DIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

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
const next = require('./server.js');

const port = parseInt(process.argv.find(a => a === '-p')
  ? process.argv[process.argv.indexOf('-p') + 1] : '3456');

const server = http.createServer(next);
server.listen(port === 0 ? 0 : port, '127.0.0.1', () => {
  const addr = server.address();
  console.log('THETHING_PORT=' + addr.port);
  console.log('THETHING_READY');
});
`;

  const wrapperPath = join(TAURI_RESOURCES_DIR, 'start-standalone.js');
  require('fs').writeFileSync(wrapperPath, wrapperScript);

  console.log('[Prepare Standalone] Done!');
}

main().catch((error) => {
  console.error('[Prepare Standalone] Failed:', error);
  process.exit(1);
});
