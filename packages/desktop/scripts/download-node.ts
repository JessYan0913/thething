import { execSync } from 'child_process';
import { mkdirSync, existsSync, chmodSync, renameSync, rmSync } from 'fs';
import { join } from 'path';

const NODE_VERSION = 'v20.11.1';

const BINARIES_DIR = join(__dirname, '..', 'src-tauri', 'binaries');

function getTargetTriple(): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

function getNodeArchiveName(triple: string): { dirName: string; platform: string; arch: string; ext: string } {
  const platform = triple.includes('apple') ? 'darwin' :
                   triple.includes('windows') ? 'win' : 'linux';
  const arch = triple.includes('aarch64') ? 'arm64' : 'x64';
  const ext = triple.includes('windows') ? 'zip' : 'tar.gz';
  const dirName = `node-${NODE_VERSION}-${platform}-${arch}`;
  return { dirName, platform, arch, ext };
}

async function main() {
  const triple = process.argv[2] || getTargetTriple();
  const { dirName, ext } = getNodeArchiveName(triple);
  const isWindows = triple.includes('windows');

  const binaryName = `node-${triple}${isWindows ? '.exe' : ''}`;
  const binaryPath = join(BINARIES_DIR, binaryName);

  if (existsSync(binaryPath)) {
    console.log(`[Download Node] ${binaryName} already exists, skipping.`);
    return;
  }

  mkdirSync(BINARIES_DIR, { recursive: true });

  const url = `https://nodejs.org/dist/${NODE_VERSION}/${dirName}.${ext}`;
  const archivePath = join(BINARIES_DIR, `${dirName}.${ext}`);

  console.log(`[Download Node] Downloading Node.js ${NODE_VERSION} for ${triple}...`);
  execSync(`curl -fSL -o "${archivePath}" "${url}"`, { stdio: 'inherit' });

  console.log(`[Download Node] Extracting...`);
  if (ext === 'tar.gz') {
    execSync(`tar -xzf "${archivePath}" -C "${BINARIES_DIR}"`);
    const nodeSrc = join(BINARIES_DIR, dirName, 'bin', 'node');
    renameSync(nodeSrc, binaryPath);
    chmodSync(binaryPath, 0o755);
  } else {
    execSync(`unzip -o "${archivePath}" -d "${BINARIES_DIR}"`);
    const nodeSrc = join(BINARIES_DIR, dirName, 'node.exe');
    renameSync(nodeSrc, binaryPath);
  }

  // Clean up
  rmSync(archivePath, { force: true });
  rmSync(join(BINARIES_DIR, dirName), { recursive: true, force: true });

  console.log(`[Download Node] Ready: ${binaryPath}`);
}

main().catch((error) => {
  console.error('[Download Node] Failed:', error);
  process.exit(1);
});
