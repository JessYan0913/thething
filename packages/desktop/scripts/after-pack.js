// ============================================================
// afterPack hook (minimal)
// ============================================================
// better-sqlite3 is compiled for the system Node.js during
// pnpm install, and the server runs with vendor/node/node.exe
// (same version) — no rebuild needed.
//
// If native module ABI issues arise in the future, run the
// rebuild in prepare-standalone.ts targeting system Node.js,
// NOT in afterPack (which targets Electron's bundled Node.js).

module.exports = async function afterPack(_context) {
  console.log('[afterPack] Skipping native module rebuild — using pnpm-installed binaries');
};
