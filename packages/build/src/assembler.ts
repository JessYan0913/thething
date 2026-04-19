// ============================================================
// Portable Directory Assembler
// ============================================================

import fs from 'fs'
import path from 'path'
import type { PlatformConfig } from './platforms'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const BUILD_DIR = path.join(ROOT_DIR, 'dist', 'portable')
const WEB_DIST = path.join(ROOT_DIR, 'packages', 'web', 'dist')

/**
 * Assemble portable directory structure
 */
export async function assemblePortable(platform: PlatformConfig): Promise<void> {
  const platformDir = path.join(BUILD_DIR, `${platform.platform}-${platform.arch}`)
  const portableDir = path.join(BUILD_DIR, 'release', `thing-${platform.platform}-${platform.arch}`)

  // Ensure portable directory exists
  if (!fs.existsSync(portableDir)) {
    fs.mkdirSync(portableDir, { recursive: true })
  }

  // Copy executable
  const executableSrc = path.join(platformDir, platform.outputName)
  const executableDest = path.join(portableDir, platform.outputName)
  if (fs.existsSync(executableSrc)) {
    fs.copyFileSync(executableSrc, executableDest)
    // Make executable on Unix
    if (platform.platform !== 'win32') {
      fs.chmodSync(executableDest, 0o755)
    }
    console.log(`[Assembler] Copied executable: ${executableDest}`)
  } else {
    throw new Error(`Executable not found: ${executableSrc}`)
  }

  // Copy native modules
  const nativeSrc = path.join(platformDir, 'native')
  const nativeDest = path.join(portableDir, 'native')
  if (fs.existsSync(nativeSrc)) {
    copyDirectory(nativeSrc, nativeDest)
    console.log(`[Assembler] Copied native modules`)
  }

  // Copy web assets
  if (fs.existsSync(WEB_DIST)) {
    const webDest = path.join(portableDir, 'web')
    copyDirectory(WEB_DIST, webDest)
    console.log(`[Assembler] Copied web assets`)
  } else {
    console.warn(`[Assembler] Warning: Web assets not found at ${WEB_DIST}`)
    console.warn(`[Assembler] Run 'pnpm build:web' first`)
  }

  // Create data directory placeholder
  const dataDir = path.join(portableDir, 'thing-data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
    console.log(`[Assembler] Created data directory: ${dataDir}`)
  }

  // Create startup scripts
  createStartupScripts(portableDir, platform)

  // Create README
  createReadme(portableDir, platform)

  console.log(`[Assembler] Portable directory assembled: ${portableDir}`)
}

/**
 * Copy directory recursively
 */
function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Create startup scripts
 */
function createStartupScripts(portableDir: string, platform: PlatformConfig): void {
  // Unix startup script
  if (platform.platform !== 'win32') {
    const runSh = path.join(portableDir, 'run.sh')
    fs.writeFileSync(runSh, `#!/bin/bash
# The Thing - Portable Edition
# Start the server with web UI

./thing start --data-dir ./thing-data

# Keep running until Ctrl+C
echo ""
echo "Press Ctrl+C to stop the server"
`)
    fs.chmodSync(runSh, 0o755)
    console.log(`[Assembler] Created run.sh`)
  }

  // Windows startup script
  if (platform.platform === 'win32' || platform.platform === 'darwin') {
    // Always create run.bat for cross-platform compatibility
    const runBat = path.join(portableDir, 'run.bat')
    fs.writeFileSync(runBat, `@echo off
REM The Thing - Portable Edition
REM Start the server with web UI

thing.exe start --data-dir ./thing-data

echo.
echo Press Ctrl+C to stop the server
`)
    console.log(`[Assembler] Created run.bat`)
  }
}

/**
 * Create README file
 */
function createReadme(portableDir: string, platform: PlatformConfig): void {
  const readme = path.join(portableDir, 'README.txt')
  fs.writeFileSync(readme, `
================================================================================
The Thing - Portable Edition
================================================================================

Platform: ${platform.platform}-${platform.arch}

QUICK START:
------------
1. Run the startup script:
   - macOS/Linux: ./run.sh
   - Windows: run.bat

2. Or run directly:
   - macOS/Linux: ./thing start --data-dir ./thing-data
   - Windows: thing.exe start --data-dir ./thing-data

3. Open http://localhost:3456 in your browser

DATA DIRECTORY:
---------------
All data (conversations, memories, database) is stored in ./thing-data/

You can copy this folder to:
- A USB drive for portable use
- Another machine to transfer your data

COMMANDS:
---------
./thing start     - Start server with web UI
./thing status    - Show server status
./thing stop      - Stop the server
./thing chat      - Interactive CLI chat
./thing --help    - Show all commands

PORTABLE USAGE:
---------------
To use on another machine:
1. Copy the entire folder to a USB drive
2. Plug into target machine
3. Run the startup script

Data stays with you - no cloud required!

================================================================================
`)
  console.log(`[Assembler] Created README.txt`)
}