// ============================================================
// Download Node.js Binary for Tauri Packaging
// ============================================================

import { execSync } from 'child_process';
import { mkdirSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import https from 'https';
import http from 'http';

const NODE_VERSION = 'v20.11.1';
const TARGET_TRIPLES = [
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
];

const BINARIES_DIR = join(__dirname, '..', 'src-tauri', 'binaries');

function getNodeUrl(targetTriple: string): string {
  const platform = targetTriple.includes('apple') ? 'darwin' : 
                   targetTriple.includes('windows') ? 'win' : 'linux';
  const arch = targetTriple.includes('aarch64') ? 'arm64' : 'x64';
  const ext = targetTriple.includes('windows') ? 'zip' : 'tar.gz';
  
  return `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${platform}-${arch}.${ext}`;
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
        return;
      }
      
      const file = require('fs').createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', reject);
  });
}

async function main() {
  const targetTriple = process.argv[2] || 'aarch64-apple-darwin';
  
  console.log(`[Download Node] Downloading Node.js ${NODE_VERSION} for ${targetTriple}...`);
  
  mkdirSync(BINARIES_DIR, { recursive: true });
  
  const url = getNodeUrl(targetTriple);
  const ext = targetTriple.includes('windows') ? 'zip' : 'tar.gz';
  const archivePath = join(BINARIES_DIR, `node-${targetTriple}.${ext}`);
  
  console.log(`[Download Node] Downloading from ${url}...`);
  await downloadFile(url, archivePath);
  
  console.log(`[Download Node] Extracting...`);
  if (ext === 'tar.gz') {
    execSync(`tar -xzf ${archivePath} -C ${BINARIES_DIR}`);
  } else {
    execSync(`unzip -o ${archivePath} -d ${BINARIES_DIR}`);
  }
  
  console.log(`[Download Node] Done!`);
}

main().catch((error) => {
  console.error('[Download Node] Failed:', error);
  process.exit(1);
});
