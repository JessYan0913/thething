// ============================================================
// Prepare Node.js runtime for Electron Packaging
// Copies the current Node.js executable into vendor/node/
// so the packaged desktop app can spawn the Next.js server
// without relying on the user's system Node.js or Electron's
// internal Node.js via ELECTRON_RUN_AS_NODE.
//
// Adopted from Si-Octo (ai-chatbot) prepare-node-runtime.cjs
// ============================================================

import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const vendorNodeDir = join(__dirname, '..', 'vendor', 'node');
const nodeExe = process.execPath;
const targetExe = join(vendorNodeDir, process.platform === 'win32' ? 'node.exe' : 'node');

mkdirSync(vendorNodeDir, { recursive: true });
copyFileSync(nodeExe, targetExe);

console.log(`[Prepare Node Runtime] Copied Node.js: ${nodeExe} -> ${targetExe}`);
