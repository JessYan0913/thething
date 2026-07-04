// ============================================================
// Prepare Next.js Standalone for Electron Packaging
// ============================================================

import { mkdirSync, existsSync, copyFileSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'fs';
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

  // 4. Remove stale better-sqlite3 copies from .next/node_modules
  //    Next.js standalone includes old copies that lack dependencies (e.g. bindings).
  //    These shadow the correct standalone copy and cause MODULE_NOT_FOUND at runtime.
  console.log('[Prepare Standalone] Cleaning stale .next/node_modules...');
  const staleDir = join(OUTPUT_DIR, 'packages', 'app', '.next', 'node_modules');
  if (existsSync(staleDir)) {
    for (const name of readdirSync(staleDir)) {
      if (name.startsWith('better-sqlite3')) {
        rmSync(join(staleDir, name), { recursive: true, force: true });
        console.log(`[Prepare Standalone] Removed stale ${name}`);
      }
    }
  }

  // 4b. Copy directories for Turbopack-hashed external module names
  //     Turbopack renames external modules like "better-sqlite3" to "better-sqlite3-<hash>"
  //     at build time. The require-hook.js doesn't map these back, so we need to copy
  //     the real package under each hashed name so Node.js can resolve them.
  //     NOTE: We use rsyncCopy instead of symlinks because electron-builder's asar
  //     does not preserve symlinks.
  console.log('[Prepare Standalone] Copying Turbopack hashed module directories...');
  const chunksDir = join(appInResources, '.next', 'server', 'chunks');
  if (existsSync(chunksDir)) {
    // Collect all hashed module names from chunk files
    const allHashedNames = new Set<string>();
    const hashPattern = /require\("([a-z@][a-z0-9/._-]+)-([0-9a-f]{16})"\)/g;
    for (const file of readdirSync(chunksDir)) {
      if (!file.endsWith('.js')) continue;
      const content = readFileSync(join(chunksDir, file), 'utf8');
      for (const m of content.matchAll(hashPattern)) {
        allHashedNames.add(m[0]);
      }
    }

    // For each hashed name, copy the real package directory
    const seenPkgs = new Set<string>();
    for (const req of allHashedNames) {
      const pkgMatch = req.match(/"([a-z@][a-z0-9/._-]+)-[0-9a-f]{16}"/);
      if (!pkgMatch) continue;
      const pkg = pkgMatch[1];
      if (seenPkgs.has(pkg)) continue;
      seenPkgs.add(pkg);

      const target = join(OUTPUT_DIR, 'node_modules', pkg);
      if (!existsSync(target)) continue;

      // Find all hash variants for this package
      const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hashRegex = new RegExp('require\\("' + escapedPkg + '-([0-9a-f]{16})"\\)', 'g');
      const hashNames = new Set<string>();
      for (const file of readdirSync(chunksDir)) {
        if (!file.endsWith('.js')) continue;
        const content = readFileSync(join(chunksDir, file), 'utf8');
        for (const m of content.matchAll(hashRegex)) {
          hashNames.add(pkg + '-' + m[1]);
        }
      }

      for (const hashName of hashNames) {
        const dest = join(OUTPUT_DIR, 'node_modules', hashName);
        if (!existsSync(dest)) {
          rsyncCopy(target, dest);
          console.log('[Prepare Standalone] Copied ' + hashName + ' -> ' + pkg);
        }
      }
    }
  }

  // 5. Create native/better-sqlite3 for SEA fallback loading
  //    The bundled code looks for native/better-sqlite3/lib/index.js relative to cwd.
  //    Copy from pnpm store (system Node binding) — afterPack will replace with Electron binding later.
  console.log('[Prepare Standalone] Setting up native better-sqlite3...');
  const pnpmStore = join(ROOT_DIR, 'node_modules', '.pnpm');
  const nativeDest = join(OUTPUT_DIR, 'packages', 'app', 'native', 'better-sqlite3');
  if (!existsSync(nativeDest)) {
    mkdirSync(join(nativeDest, '..'), { recursive: true });
    const pnpmSqlitePrefix = 'better-sqlite3@';
    const pnpmSqliteDirs = readdirSync(pnpmStore).filter((d: string) => d.startsWith(pnpmSqlitePrefix));
    const sqliteFound = pnpmSqliteDirs[0];
    if (sqliteFound) {
      const sqliteSrc = join(pnpmStore, sqliteFound, 'node_modules', 'better-sqlite3');
      rsyncCopy(sqliteSrc, nativeDest);
      console.log(`[Prepare Standalone] Created native/better-sqlite3 from pnpm store`);
    } else {
      console.warn(`[Prepare Standalone] Warning: better-sqlite3 not found in pnpm store`);
    }
  }

  // 5b. Copy 'bindings' and 'file-uri-to-path' into native/better-sqlite3/node_modules/
  //     better-sqlite3's database.js calls require('bindings') internally.
  //     In the packaged app, the standard require() looks up the directory tree
  //     for node_modules/bindings. pnpm symlinks break in the packaged app,
  //     and after-pack.js replaces better-sqlite3 with a flat npm install
  //     that doesn't nest bindings inside better-sqlite3/node_modules/.
  //     So we explicitly copy them here to ensure the require() resolves.
  const nativeModulesDir = join(nativeDest, 'node_modules');
  const nativeDepsToCopy = ['bindings', 'file-uri-to-path'];
  for (const dep of nativeDepsToCopy) {
    const depPrefix = `${dep}@`;
    const depDirs = readdirSync(pnpmStore).filter((d: string) => d.startsWith(depPrefix));
    const depFound = depDirs[0];
    if (depFound) {
      const depSrc = join(pnpmStore, depFound, 'node_modules', dep);
      const depDest = join(nativeModulesDir, dep);
      if (!existsSync(depDest)) {
        mkdirSync(nativeModulesDir, { recursive: true });
        rsyncCopy(depSrc, depDest);
        console.log(`[Prepare Standalone] Copied ${dep} to native/better-sqlite3/node_modules/`);
      }
    } else {
      console.warn(`[Prepare Standalone] Warning: ${dep} not found in pnpm store`);
    }
  }

  // 6. Copy missing dependencies that Next.js standalone doesn't include with pnpm
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

  // 7. Create start-standalone.js wrapper
  console.log('[Prepare Standalone] Creating start-standalone.js wrapper...');
  const wrapperScript = `
const http = require('http');
const net = require('net');
const mod = require('module');

// Turbopack hashes external module names (e.g. "better-sqlite3-0167c515dc271f66").
// Register a require hook to map hashed names back to the real package.
const originalResolve = mod._resolveFilename;
mod._resolveFilename = function (request, parent, isMain, options) {
  const match = request.match(/^(.+)-([0-9a-f]{16})$/);
  if (match) {
    request = match[1];
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

// Parse -p <port> from command line args (passed by Electron main process)
const pIdx = process.argv.indexOf('-p');
const requestedPort = pIdx !== -1 ? parseInt(process.argv[pIdx + 1], 10) : 0;

// Find a free port by binding to port 0
function findFreePort() {
  return new Promise(function (resolve) {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

(async function main() {
  // Use requested port, or find a free one if 0 (or not specified)
  const PORT = requestedPort || await findFreePort();

  // Set PORT before requiring server.js
  // server.js uses: parseInt(process.env.PORT, 10) || 3000
  process.env.PORT = String(PORT);
  // Bind to localhost only for security
  process.env.HOSTNAME = '127.0.0.1';

  // server.js starts the Next.js server directly (no exports)
  require('./packages/app/server.js');

  // Poll until ready, then output the port for Electron
  var checkUrl = 'http://127.0.0.1:' + PORT;
  var start = Date.now();
  var timeout = 30000;

  function check() {
    http.get(checkUrl, function (res) {
      res.resume();
      console.log('THETHING_PORT=' + PORT);
      console.log('THETHING_READY');
    }).on('error', function () {
      if (Date.now() - start > timeout) {
        console.error('Server did not start within ' + (timeout / 1000) + 's');
        process.exit(1);
      }
      setTimeout(check, 200);
    });
  }
  check();
})();
`;

  const wrapperPath = join(OUTPUT_DIR, 'start-standalone.js');
  writeFileSync(wrapperPath, wrapperScript);

  console.log('[Prepare Standalone] Done!');
}

main().catch((error) => {
  console.error('[Prepare Standalone] Failed:', error);
  process.exit(1);
});
