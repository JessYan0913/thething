// ============================================================
// Platform Configuration for Portable Build
// ============================================================

export interface PlatformConfig {
  /** Platform identifier: darwin, win32, linux */
  platform: 'darwin' | 'win32' | 'linux'
  /** Architecture: x64, arm64 */
  arch: 'x64' | 'arm64'
  /** Node executable name for this platform */
  nodeExecutable: string
  /** Output executable name */
  outputName: string
  /** Native module directory name */
  nativeDirName: string
  /** Requires codesign on macOS */
  requiresCodesign: boolean
  /** Requires postject sentinel (macOS only) */
  requiresSentinel: boolean
  /** Tauri target triple for sidecar naming */
  tauriTargetTriple: string
}

/**
 * Supported platform configurations
 */
export const PLATFORMS: Record<string, PlatformConfig> = {
  'darwin-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    nodeExecutable: 'node',
    outputName: 'thing',
    nativeDirName: 'darwin-arm64',
    requiresCodesign: true,
    requiresSentinel: true,
    tauriTargetTriple: 'aarch64-apple-darwin',
  },
  'darwin-x64': {
    platform: 'darwin',
    arch: 'x64',
    nodeExecutable: 'node',
    outputName: 'thing',
    nativeDirName: 'darwin-x64',
    requiresCodesign: true,
    requiresSentinel: true,
    tauriTargetTriple: 'x86_64-apple-darwin',
  },
  'win32-x64': {
    platform: 'win32',
    arch: 'x64',
    nodeExecutable: 'node.exe',
    outputName: 'thing.exe',
    nativeDirName: 'win32-x64',
    requiresCodesign: false,
    requiresSentinel: false,
    tauriTargetTriple: 'x86_64-pc-windows-msvc',
  },
  'linux-x64': {
    platform: 'linux',
    arch: 'x64',
    nodeExecutable: 'node',
    outputName: 'thing',
    nativeDirName: 'linux-x64',
    requiresCodesign: false,
    requiresSentinel: false,
    tauriTargetTriple: 'x86_64-unknown-linux-gnu',
  },
}

/**
 * Get current platform config
 */
export function getCurrentPlatform(): PlatformConfig {
  const platform = process.platform as 'darwin' | 'win32' | 'linux'
  const arch = process.arch as 'x64' | 'arm64'
  const key = `${platform}-${arch}`
  return PLATFORMS[key]
}

/**
 * Check if a platform key is valid
 */
export function isValidPlatform(key: string): boolean {
  return key in PLATFORMS
}

/**
 * Get platform config by key
 */
export function getPlatformConfig(key: string): PlatformConfig {
  if (!isValidPlatform(key)) {
    throw new Error(`Invalid platform: ${key}. Valid platforms: ${Object.keys(PLATFORMS).join(', ')}`)
  }
  return PLATFORMS[key]
}