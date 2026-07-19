// ============================================================
// Prepare Next.js Standalone for Electron Packaging
// Adopted from Si-Octo (ai-chatbot) approach:
// - Hardlink-based copy for speed and disk space
// - pnpm symlink materialization (flat node_modules)
// - Source code pruning
// - Incremental build with git hash
// - EBUSY retry for Windows
// ============================================================

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, lstatSync, realpathSync, readlinkSync, rmSync, statSync, linkSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';

const ROOT_DIR = join(__dirname, '..', '..', '..');
const NEXT_APP_DIR = join(ROOT_DIR, 'packages', 'app');
const STANDALONE_DIR = join(NEXT_APP_DIR, '.next', 'standalone');
const VENDOR_DIR = join(__dirname, '..', 'vendor');
const VENDOR_AGENT_DIR = join(VENDOR_DIR, 'agent');
const HASH_FILE = join(VENDOR_DIR, '.agent-hash');

const MISSING_DEPENDENCIES = [
  'react',
  'react-dom',
  'react-is',
  'styled-jsx',
  '@swc/helpers',
  '@next/env',
  'postcss',
  'caniuse-lite',
  'bindings',
  'file-uri-to-path',
];

const IGNORED_PACKAGE_ENTRIES = new Set(['.bin']);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleepSync(ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { /* spin */ }
}

function rmSyncRetry(target: string, options: Parameters<typeof rmSync>[1] = {}) {
  const maxRetries = 10;
  const retryDelay = 1000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      rmSync(target, options);
      return;
    } catch (err: any) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < maxRetries) {
        console.warn(`[Prepare Standalone] ${err.code} on "${target}", retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})...`);
        sleepSync(retryDelay);
        continue;
      }
      // Last resort: try PowerShell Remove-Item which handles Windows locks better
      if (attempt >= maxRetries) {
        try { execSync(`powershell -Command "Remove-Item -Recurse -Force '${target}'" 2>$null`, { stdio: 'ignore' }); } catch {}
        if (!existsSync(target)) return;
      }
      throw err;
    }
  }
}

function assertDir(dir: string, label: string) {
  if (!existsSync(dir)) {
    throw new Error(`${label} not found: ${dir}`);
  }
}

function getAgentGitHash(): string | null {
  try {
    const hash = execSync('git rev-parse HEAD:packages/app', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
    // Check for uncommitted changes — incremental build would serve stale content
    const hasChanges = !!execSync('git status --porcelain packages/app', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
    return hasChanges ? hash + '-dirty' : hash;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

function copyFileHardlink(src: string, dest: string) {
  mkdirSync(dirname(dest), { recursive: true });
  try {
    linkSync(src, dest);
  } catch {
    cpSync(src, dest);
  }
}

function copyDirHardlink(source: string, target: string) {
  assertDir(source, 'Source directory');
  rmSyncRetry(target, { recursive: true, force: true });

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const srcPath = join(dir, entry.name);
      const destPath = join(target, relative(source, srcPath));
      if (entry.isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        walk(srcPath);
      } else if (entry.isFile()) {
        copyFileHardlink(srcPath, destPath);
      } else if (entry.isSymbolicLink()) {
        // readdirSync Dirent on Windows returns isDirectory/isFile = false
        // for symlinks regardless of target type. Resolve and copy.
        let resolved: string;
        try {
          resolved = realpathSync(srcPath);
        } catch {
          // realpathSync may fail on Windows (EPERM) with pnpm junction points.
          // fs.readlinkSync does not have this limitation — read the target
          // manually and resolve the relative path.
          try {
            const linkTarget = readlinkSync(srcPath);
            resolved = resolve(dirname(srcPath), linkTarget);
          } catch {
            console.warn(`[Prepare Standalone] Warning: skipping unresolvable symlink: ${srcPath}`);
            return;
          }
        }
        try {
          const stat = statSync(resolved);
          if (stat.isDirectory()) {
            mkdirSync(destPath, { recursive: true });
            cpSync(resolved, destPath, { recursive: true, dereference: true });
          } else {
            copyFileHardlink(resolved, destPath);
          }
        } catch {
          console.warn(`[Prepare Standalone] Warning: symlink target not accessible: ${srcPath} -> ${resolved}`);
        }
      }
    }
  };
  walk(source);
}

function copyDir(source: string, target: string) {
  assertDir(source, 'Source directory');
  rmSyncRetry(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, dereference: true });
}

// ---------------------------------------------------------------------------
// Symlink materialization helpers (pnpm node_modules handling)
// ---------------------------------------------------------------------------

function getPackageEntries(nodeModulesDir: string): string[] {
  if (!existsSync(nodeModulesDir)) return [];

  const entries: string[] = [];
  for (const dirent of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (IGNORED_PACKAGE_ENTRIES.has(dirent.name)) continue;

    const entryPath = join(nodeModulesDir, dirent.name);
    if (dirent.name.startsWith('@')) {
      if (!dirent.isDirectory()) continue;
      for (const scopedDirent of readdirSync(entryPath, { withFileTypes: true })) {
        entries.push(join(entryPath, scopedDirent.name));
      }
      continue;
    }

    entries.push(entryPath);
  }

  return entries;
}

function copyMaterializedPackage(sourcePackagePath: string, targetPackagePath: string) {
  const stat = lstatSync(sourcePackagePath);
  let realSource: string;
  if (stat.isSymbolicLink()) {
    try {
      realSource = realpathSync(sourcePackagePath);
    } catch {
      // Windows EPERM workaround — use readlinkSync to resolve pnpm junction targets
      const linkTarget = readlinkSync(sourcePackagePath);
      realSource = resolve(dirname(sourcePackagePath), linkTarget);
    }
  } else {
    realSource = sourcePackagePath;
  }

  cpSync(realSource, targetPackagePath, { recursive: true, dereference: true });
  return stat.isSymbolicLink();
}

function materializePackageLinksInPlace(nodeModulesDir: string) {
  if (!existsSync(nodeModulesDir)) return 0;

  let count = 0;
  for (const packagePath of getPackageEntries(nodeModulesDir)) {
    if (!existsSync(packagePath)) continue;
    if (!lstatSync(packagePath).isSymbolicLink()) continue;

    copyMaterializedPackage(packagePath, packagePath);
    count += 1;
  }
  return count;
}

function flattenStandaloneNodeModules() {
  const hoistedNodeModulesDir = join(VENDOR_AGENT_DIR, 'node_modules', '.pnpm', 'node_modules');
  const appNodeModulesDir = join(VENDOR_AGENT_DIR, 'packages', 'app', 'node_modules');
  const tracedExternalNodeModulesDir = join(VENDOR_AGENT_DIR, 'packages', 'app', '.next', 'node_modules');

  assertDir(hoistedNodeModulesDir, 'Next standalone hoisted node_modules');
  mkdirSync(appNodeModulesDir, { recursive: true });

  let materializedCount = 0;
  let copiedCount = 0;

  for (const packagePath of getPackageEntries(hoistedNodeModulesDir)) {
    if (!existsSync(packagePath)) continue;

    const relativePackagePath = relative(hoistedNodeModulesDir, packagePath);
    if (copyMaterializedPackage(packagePath, join(appNodeModulesDir, relativePackagePath))) {
      materializedCount += 1;
    }
    copiedCount += 1;
  }

  const appMaterializedCount = materializePackageLinksInPlace(appNodeModulesDir);
  const tracedExternalMaterializedCount = materializePackageLinksInPlace(tracedExternalNodeModulesDir);
  rmSync(join(VENDOR_AGENT_DIR, 'node_modules'), { recursive: true, force: true });

  console.log(`[Prepare Standalone] Materialized ${materializedCount} standalone package links`);
  console.log(`[Prepare Standalone] Flattened ${copiedCount} runtime packages into the app node_modules`);
  console.log(`[Prepare Standalone] Materialized ${appMaterializedCount} app package links`);
  console.log(`[Prepare Standalone] Materialized ${tracedExternalMaterializedCount} traced external package links`);
  console.log('[Prepare Standalone] Removed standalone root node_modules after flattening');
}

// ---------------------------------------------------------------------------
// Copy missing dependencies from pnpm store
// ---------------------------------------------------------------------------

function copyMissingDeps() {
  const pnpmStore = join(ROOT_DIR, 'node_modules', '.pnpm');
  const appInResources = join(VENDOR_AGENT_DIR, 'packages', 'app');

  for (const dep of MISSING_DEPENDENCIES) {
    const pnpmFriendlyName = dep.replace('/', '+');
    const prefix = `${pnpmFriendlyName}@`;
    const pnpmDirs = readdirSync(pnpmStore).filter((d) => d.startsWith(prefix));
    const found = pnpmDirs[0];

    if (found) {
      const srcDir = join(pnpmStore, found, 'node_modules', dep);
      const destDir = join(appInResources, 'node_modules', dep);
      if (existsSync(srcDir)) {
        console.log(`[Prepare Standalone] Copying missing dep: ${dep}...`);
        cpSync(srcDir, destDir, { recursive: true, dereference: true });
      }
    } else {
      console.warn(`[Prepare Standalone] Warning: missing dep ${dep} not found in pnpm store`);
    }
  }
}

// ---------------------------------------------------------------------------
// Native better-sqlite3 setup
// ---------------------------------------------------------------------------

function setupNativeBetterSqlite3() {
  const pnpmStore = join(ROOT_DIR, 'node_modules', '.pnpm');
  const nativeDest = join(VENDOR_AGENT_DIR, 'packages', 'app', 'native', 'better-sqlite3');

  if (!existsSync(nativeDest)) {
    mkdirSync(join(nativeDest, '..'), { recursive: true });
    const pnpmSqlitePrefix = 'better-sqlite3@';
    const pnpmSqliteDirs = readdirSync(pnpmStore).filter((d) => d.startsWith(pnpmSqlitePrefix));
    const sqliteFound = pnpmSqliteDirs[0];
    if (sqliteFound) {
      const sqliteSrc = join(pnpmStore, sqliteFound, 'node_modules', 'better-sqlite3');
      cpSync(sqliteSrc, nativeDest, { recursive: true, dereference: true });
      console.log('[Prepare Standalone] Created native/better-sqlite3 from pnpm store');
    } else {
      console.warn('[Prepare Standalone] Warning: better-sqlite3 not found in pnpm store');
    }
  }

  // Copy bindings and file-uri-to-path into native/better-sqlite3/node_modules/
  const nativeModulesDir = join(nativeDest, 'node_modules');
  const nativeDepsToCopy = ['bindings', 'file-uri-to-path'];
  for (const dep of nativeDepsToCopy) {
    const depPrefix = `${dep}@`;
    const depDirs = readdirSync(pnpmStore).filter((d) => d.startsWith(depPrefix));
    const depFound = depDirs[0];
    if (depFound) {
      const depSrc = join(pnpmStore, depFound, 'node_modules', dep);
      const depDest = join(nativeModulesDir, dep);
      if (!existsSync(depDest)) {
        mkdirSync(nativeModulesDir, { recursive: true });
        cpSync(depSrc, depDest, { recursive: true, dereference: true });
        console.log(`[Prepare Standalone] Copied ${dep} to native/better-sqlite3/node_modules/`);
      }
    } else {
      console.warn(`[Prepare Standalone] Warning: ${dep} not found in pnpm store`);
    }
  }
}

// ---------------------------------------------------------------------------
// Electron-ABI better-sqlite3 binary
// ---------------------------------------------------------------------------
// The server runs via ELECTRON_RUN_AS_NODE (Electron's internal Node.js),
// whose ABI differs from the system Node.js that pnpm compiled against.
// Download the official Electron prebuild and replace both copies.

function setupElectronSqliteBinary() {
  const electronPkg = JSON.parse(
    readFileSync(join(__dirname, '..', 'node_modules', 'electron', 'package.json'), 'utf8')
  );
  const electronVersion: string = electronPkg.version;

  const pnpmStore = join(ROOT_DIR, 'node_modules', '.pnpm');
  const prebuildDirs = readdirSync(pnpmStore).filter((d) => d.startsWith('prebuild-install@'));
  if (!prebuildDirs[0]) {
    throw new Error('prebuild-install not found in pnpm store (it is a dependency of better-sqlite3)');
  }
  const prebuildBin = join(pnpmStore, prebuildDirs[0], 'node_modules', 'prebuild-install', 'bin.js');

  const nativeDir = join(VENDOR_AGENT_DIR, 'packages', 'app', 'native', 'better-sqlite3');
  console.log(`[Prepare Standalone] Downloading better-sqlite3 prebuild for Electron ${electronVersion} (${process.platform}-${process.arch})...`);
  execSync(
    `node "${prebuildBin}" --runtime electron --target ${electronVersion} --arch ${process.arch} --platform ${process.platform}`,
    { cwd: nativeDir, stdio: 'inherit' }
  );

  const builtBinary = join(nativeDir, 'build', 'Release', 'better_sqlite3.node');
  const nodeModulesBinary = join(
    VENDOR_AGENT_DIR, 'packages', 'app', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'
  );
  if (existsSync(dirname(nodeModulesBinary))) {
    rmSync(nodeModulesBinary, { force: true });
    cpSync(builtBinary, nodeModulesBinary);
    console.log('[Prepare Standalone] Replaced node_modules/better-sqlite3 binary with Electron build');
  }
}

// ---------------------------------------------------------------------------
// Prune better-sqlite3 build sources — runtime only needs build/Release + lib
// ---------------------------------------------------------------------------

function pruneNativeSqliteSources() {
  const nativeDir = join(VENDOR_AGENT_DIR, 'packages', 'app', 'native', 'better-sqlite3');
  for (const entry of ['deps', 'src', 'binding.gyp', 'README.md']) {
    const target = join(nativeDir, entry);
    if (existsSync(target)) {
      rmSyncRetry(target, { recursive: true, force: true });
      console.log(`[Prepare Standalone] Pruned native/better-sqlite3/${entry}`);
    }
  }
  // build/ artifacts other than Release/ (obj files, gyp intermediates)
  const buildDir = join(nativeDir, 'build');
  if (existsSync(buildDir)) {
    for (const entry of readdirSync(buildDir)) {
      if (entry === 'Release') continue;
      rmSyncRetry(join(buildDir, entry), { recursive: true, force: true });
    }
  }
  const releaseDir = join(buildDir, 'Release');
  if (existsSync(releaseDir)) {
    for (const entry of readdirSync(releaseDir)) {
      if (!entry.endsWith('.node')) {
        rmSyncRetry(join(releaseDir, entry), { recursive: true, force: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Handle Turbopack hashed module names
// ---------------------------------------------------------------------------

function copyHashedModules() {
  const appInResources = join(VENDOR_AGENT_DIR, 'packages', 'app');
  const chunksDir = join(appInResources, '.next', 'server', 'chunks');

  if (!existsSync(chunksDir)) return;

  console.log('[Prepare Standalone] Copying Turbopack hashed module directories...');

  const allHashedNames = new Set<string>();
  const hashPattern = /require\("([a-z@][a-z0-9/._-]+)-([0-9a-f]{16})"\)/g;
  for (const file of readdirSync(chunksDir)) {
    if (!file.endsWith('.js')) continue;
    const content = readFileSync(join(chunksDir, file), 'utf8');
    for (const m of content.matchAll(hashPattern)) {
      allHashedNames.add(m[0]);
    }
  }

  const seenPkgs = new Set<string>();
  for (const req of allHashedNames) {
    const pkgMatch = req.match(/"([a-z@][a-z0-9/._-]+)-[0-9a-f]{16}"/);
    if (!pkgMatch) continue;
    const pkg = pkgMatch[1];
    if (seenPkgs.has(pkg)) continue;
    seenPkgs.add(pkg);

    const target = existsSync(join(VENDOR_AGENT_DIR, 'node_modules', pkg))
      ? join(VENDOR_AGENT_DIR, 'node_modules', pkg)
      : join(VENDOR_AGENT_DIR, 'node_modules', '.pnpm', 'node_modules', pkg);
    if (!existsSync(target)) continue;

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
      const dest = join(VENDOR_AGENT_DIR, 'node_modules', hashName);
      if (!existsSync(dest)) {
        copyDir(target, dest);
        console.log(`[Prepare Standalone] Copied ${hashName} -> ${pkg}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Source code pruning — ship only compiled output, no source
// ---------------------------------------------------------------------------

function pruneSourceDirs() {
  const appDir = join(VENDOR_AGENT_DIR, 'packages', 'app');
  const sourceDirs = ['app', 'components', 'hooks', 'i18n', 'lib', 'types', 'docs'];
  for (const dir of sourceDirs) {
    const target = join(appDir, dir);
    if (existsSync(target)) {
      rmSyncRetry(target, { recursive: true, force: true });
      console.log(`[Prepare Standalone] Pruned source: ${dir}/`);
    }
  }

  const sourceFiles = ['next.config.ts', 'next.config.mjs', 'next-env.d.ts', 'tsconfig.json', 'tsconfig.*.json', 'tsconfig.tsbuildinfo', 'postcss.config.mjs', 'instrumentation.ts'];
  for (const pattern of sourceFiles) {
    if (pattern.includes('*')) {
      // Glob-like pattern matching
      const prefix = pattern.replace('*', '');
      for (const entry of readdirSync(appDir)) {
        if (entry.startsWith(prefix)) {
          const target = join(appDir, entry);
          if (statSync(target).isFile()) {
            rmSyncRetry(target, { force: true });
            console.log(`[Prepare Standalone] Pruned source file: ${entry}`);
          }
        }
      }
    } else {
      const target = join(appDir, pattern);
      if (existsSync(target)) {
        rmSyncRetry(target, { force: true });
        console.log(`[Prepare Standalone] Pruned source file: ${pattern}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Create start-standalone.js wrapper
// ---------------------------------------------------------------------------

function createWrapperScript() {
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
    try {
      return originalResolve.call(this, match[1], parent, isMain, options);
    } catch (e) {
      return originalResolve.call(this, request, parent, isMain, options);
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

// Parse -p <port> from command line args
const pIdx = process.argv.indexOf('-p');
const requestedPort = pIdx !== -1 ? parseInt(process.argv[pIdx + 1], 10) : 0;

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
  const PORT = requestedPort || await findFreePort();
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = '127.0.0.1';

  require('./packages/app/server.js');

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

  const wrapperPath = join(VENDOR_AGENT_DIR, 'start-standalone.js');
  writeFileSync(wrapperPath, wrapperScript);
  console.log('[Prepare Standalone] Created start-standalone.js wrapper');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[Prepare Standalone] Starting...');

  // 1. Verify standalone build exists
  if (!existsSync(STANDALONE_DIR)) {
    throw new Error(`Standalone build not found at ${STANDALONE_DIR}. Run "pnpm build:next" first.`);
  }

  // 2. Check incremental build via git hash
  const currentHash = getAgentGitHash();
  if (currentHash && existsSync(VENDOR_AGENT_DIR) && existsSync(HASH_FILE)) {
    const storedHash = readFileSync(HASH_FILE, 'utf8').trim();
    if (storedHash === currentHash) {
      console.log('[Prepare Standalone] vendor/agent is up-to-date, skipping (hash match)');
      return;
    }
  }

  // 3. Copy standalone output with symlink dereference
  // 3. Copy standalone output using hardlinks for speed
  // copyDirHardlink handles symlinks by resolving them via realpathSync
  // before hardlinking (pnpm's node_modules uses symlinks extensively).
  console.log('[Prepare Standalone] Copying standalone output...');
  rmSyncRetry(VENDOR_AGENT_DIR, { recursive: true, force: true });
  mkdirSync(VENDOR_AGENT_DIR, { recursive: true });
  copyDirHardlink(STANDALONE_DIR, VENDOR_AGENT_DIR);

  // 4. Copy static assets
  console.log('[Prepare Standalone] Copying static assets...');
  const publicDir = join(NEXT_APP_DIR, 'public');
  const staticDir = join(NEXT_APP_DIR, '.next', 'static');
  const appInResources = join(VENDOR_AGENT_DIR, 'packages', 'app');

  if (existsSync(publicDir)) {
    copyDir(publicDir, join(appInResources, 'public'));
  }
  if (existsSync(staticDir)) {
    copyDir(staticDir, join(appInResources, '.next', 'static'));
  }

  // 5. Flatten pnpm node_modules (materialize symlinks)
  console.log('[Prepare Standalone] Flattening pnpm node_modules...');
  flattenStandaloneNodeModules();

  // 6. Copy Turbopack hashed module directories
  copyHashedModules();

  // 7. Setup native better-sqlite3
  console.log('[Prepare Standalone] Setting up native better-sqlite3...');
  setupNativeBetterSqlite3();

  // 7b. Replace sqlite binary with Electron-ABI prebuild, then prune sources
  setupElectronSqliteBinary();
  pruneNativeSqliteSources();

  // 8. Copy missing dependencies from pnpm store
  console.log('[Prepare Standalone] Copying missing dependencies...');
  copyMissingDeps();

  // 9. Prune source code directories
  console.log('[Prepare Standalone] Pruning source code...');
  pruneSourceDirs();

  // 10. Create start-standalone.js wrapper
  createWrapperScript();

  // 11. Write git hash for incremental builds
  if (currentHash) {
    mkdirSync(dirname(HASH_FILE), { recursive: true });
    writeFileSync(HASH_FILE, currentHash);
  }

  console.log('[Prepare Standalone] Done!');
}

main().catch((error) => {
  console.error('[Prepare Standalone] Failed:', error);
  process.exit(1);
});
