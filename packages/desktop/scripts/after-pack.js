// ============================================================
// afterPack hook: Install and rebuild better-sqlite3 for Electron
// ============================================================
// electron-builder's npmRebuild only handles modules in the `files` config.
// Native modules coming through `extraResources` (like agent's better-sqlite3)
// are NOT rebuilt. This hook installs, rebuilds, and replaces better-sqlite3
// with versions compiled for Electron's Node.js.
//
// Reference: CodePilot (op7418/CodePilot) afterPack approach

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  let electronVersion = context.electronVersion;
  if (!electronVersion) {
    const electronPkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'node_modules', 'electron', 'package.json'), 'utf8')
    );
    electronVersion = electronPkg.version;
  }
  const arch = context.arch === 3 ? 'arm64' : 'x64';

  console.log(`[afterPack] Rebuilding better-sqlite3 for Electron ${electronVersion} (${arch})`);

  // 1. Install better-sqlite3 fresh (with all deps like bindings) and rebuild for Electron
  const workDir = path.join(process.cwd(), '_tmp_rebuild');
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });

    execSync('npm init -y --silent', { cwd: workDir, stdio: 'inherit' });
    execSync('npm install better-sqlite3 @electron/rebuild --silent', { cwd: workDir, stdio: 'inherit' });
    execSync(
      `./node_modules/.bin/electron-rebuild -f -o better-sqlite3 -v ${electronVersion} -a ${arch}`,
      { cwd: workDir, stdio: 'inherit', timeout: 180000 }
    );

    const rebuiltDir = path.join(workDir, 'node_modules', 'better-sqlite3');
    if (!fs.existsSync(path.join(rebuiltDir, 'build', 'Release', 'better_sqlite3.node'))) {
      throw new Error('Rebuilt .node file not found');
    }

    // Verify bindings and file-uri-to-path are installed at the top level (flat npm node_modules)
    const bindingsDir = path.join(workDir, 'node_modules', 'bindings');
    const fileUriToPathDir = path.join(workDir, 'node_modules', 'file-uri-to-path');
    if (!fs.existsSync(bindingsDir)) {
      throw new Error('bindings module not found in node_modules');
    }
    if (!fs.existsSync(fileUriToPathDir)) {
      throw new Error('file-uri-to-path module not found in node_modules');
    }

    console.log(`[afterPack] Rebuilt better-sqlite3 with bindings`);

    // 2. Replace native/better-sqlite3 in the packaged app
    // On macOS, appOutDir is e.g. dist/mac-arm64/ and the .app bundle is inside it.
    // Resources live at <app>.app/Contents/Resources/. On Windows/Linux, resources/
    // is directly inside appOutDir.
    let resourcesDir = path.join(appOutDir, 'resources');
    if (!fs.existsSync(resourcesDir)) {
      // macOS: find the .app bundle and look inside Contents/Resources/
      const appBundle = fs.readdirSync(appOutDir).find((d) => d.endsWith('.app'));
      if (appBundle) {
        resourcesDir = path.join(appOutDir, appBundle, 'Contents', 'Resources');
      }
    }
    if (!fs.existsSync(resourcesDir)) {
      console.warn('[afterPack] resources/ not found, skipping');
      return;
    }

    // Ensure standalone/node_modules exists in packaged app
    // electron-builder may exclude it from extraResources despite the **/* filter
    const standaloneNmDir = path.join(resourcesDir, 'agent', 'node_modules');
    if (!fs.existsSync(standaloneNmDir)) {
      const srcNmDir = path.join(process.cwd(), 'vendor', 'agent', 'node_modules');
      if (fs.existsSync(srcNmDir)) {
        console.log('[afterPack] Copying standalone/node_modules to packaged app...');
        execSync(`cp -R "${srcNmDir}" "${standaloneNmDir}"`, { stdio: 'inherit' });
      }
    }

    // Find and replace all better-sqlite3 package directories
    function replaceSqliteDirs(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'better-sqlite3' && fs.existsSync(path.join(full, 'lib', 'index.js'))) {
            fs.rmSync(full, { recursive: true, force: true });
            execSync(`cp -R "${rebuiltDir}" "${full}"`, { stdio: 'inherit' });
            // Ensure 'bindings' and 'file-uri-to-path' are available inside
            // better-sqlite3/node_modules/. database.js calls require('bindings')
            // and the standard require() looks up the directory tree. Flat npm
            // install puts these at the top level, not nested — so we must
            // copy them explicitly.
            const destModulesDir = path.join(full, 'node_modules');
            for (const dep of ['bindings', 'file-uri-to-path']) {
              const srcDep = path.join(workDir, 'node_modules', dep);
              const destDep = path.join(destModulesDir, dep);
              if (!fs.existsSync(destDep)) {
                fs.mkdirSync(destModulesDir, { recursive: true });
                execSync(`cp -R "${srcDep}" "${destDep}"`, { stdio: 'inherit' });
                console.log(`[afterPack] Copied ${dep} to: ${destDep}`);
              }
            }
            console.log(`[afterPack] Replaced: ${full}`);
          } else {
            replaceSqliteDirs(full);
          }
        }
      }
    }

    replaceSqliteDirs(resourcesDir);
    console.log('[afterPack] Done');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};
