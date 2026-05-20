// ============================================================
// Paths Module - 路径计算导出（纯函数版本）
// ============================================================

// 环境感知函数（允许读取 process.cwd()）
export {
  resolveProjectDir,
  resolveHomeDir,
} from './resolve';

// 纯函数版本（compute 前缀 - 接受参数，不读取环境）
export {
  computeUserConfigDir,
  computeProjectConfigDir,
  computeConfigDirs,
  computeUserDataDir,
  computeProjectDataDir,
  getDefaultDataDir,
  computeUserTokenizerCacheDir,
  getUserTokenizerCacheDir,
} from './compute';