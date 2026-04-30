// ============================================================
// Paths Module - 路径计算导出
// ============================================================

// 环境感知函数（允许读取 process.cwd()）
export {
  resolveProjectDir,
  resolveHomeDir,
} from './resolve';

// 全局单例管理（configDirName）
export {
  setResolvedConfigDirName,
  getResolvedConfigDirName,
  clearResolvedConfigDirName,
} from './compute';

// 纯函数版本（compute 前缀 - 接受参数，不读取环境）
export {
  computeUserConfigDir,
  computeProjectConfigDir,
  computeConfigDirs,
  computeUserDataDir,
  computeProjectDataDir,
  computeUserTokenizerCacheDir,
} from './compute';

// 便捷版本（使用全局单例 configDirName）
export {
  getUserConfigDir,
  getProjectConfigDir,
  getConfigDirs,
  getUserDataDir,
  getProjectDataDir,
  getDefaultDataDir,
  getUserTokenizerCacheDir,
} from './compute';