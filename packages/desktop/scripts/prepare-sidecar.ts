import { buildSea, compileNativeModules, getCurrentPlatform } from '@the-thing/build'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_DIR = path.resolve(__dirname, '..')
const BINARIES_DIR = path.join(DESKTOP_DIR, 'src-tauri', 'binaries')
const ROOT_DIR = path.resolve(DESKTOP_DIR, '..', '..')

async function prepareSidecar() {
  const platform = getCurrentPlatform()
  if (!platform) {
    throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`)
  }

  const platformKey = `${platform.platform}-${platform.arch}`
  console.log(`[Sidecar] Building for ${platformKey} (${platform.tauriTargetTriple})`)

  // Step 1: Build SEA executable
  console.log('[Sidecar] Building SEA executable...')
  await buildSea(platform)

  // Step 2: Compile native modules
  console.log('[Sidecar] Compiling native modules...')
  await compileNativeModules(platform)

  // Step 3: Copy to Tauri binaries directory
  fs.mkdirSync(BINARIES_DIR, { recursive: true })

  const seaOutputDir = path.join(ROOT_DIR, 'dist', 'portable', platformKey)
  const seaBinary = path.join(seaOutputDir, platform.outputName)
  const targetName = `thing-${platform.tauriTargetTriple}${platform.platform === 'win32' ? '.exe' : ''}`
  const targetPath = path.join(BINARIES_DIR, targetName)

  fs.copyFileSync(seaBinary, targetPath)
  if (platform.platform !== 'win32') {
    fs.chmodSync(targetPath, 0o755)
  }
  console.log(`[Sidecar] Binary: ${targetPath}`)

  // Step 4: Copy native modules alongside binary
  const nativeSrc = path.join(seaOutputDir, 'native')
  const nativeDst = path.join(BINARIES_DIR, 'native')
  if (fs.existsSync(nativeSrc)) {
    fs.cpSync(nativeSrc, nativeDst, { recursive: true })
    console.log(`[Sidecar] Native modules: ${nativeDst}`)
  }

  console.log('[Sidecar] Done')
}

prepareSidecar().catch((err) => {
  console.error('[Sidecar] Failed:', err)
  process.exit(1)
})
