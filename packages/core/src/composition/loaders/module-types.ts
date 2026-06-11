// ============================================================
// AppModule - 统一生命周期接口
// ============================================================

import type { ResourceDirs } from '../../services/config/layout';

/**
 * 模块初始化上下文
 *
 * 由 loadAll 传递给每个 AppModule.init()，
 * 包含加载所需的所有环境信息。
 */
export interface ModuleContext {
  cwd: string;
  configDir: string;
  homeDir: string;
  env: Record<string, string | undefined>;
  resourceDirs: ResourceDirs;
}

/**
 * AppModule - 统一生命周期接口
 *
 * 每个 extension 模块（skills, agents, mcp, connector, permissions, memory）
 * 实现此接口，由 loadAll 统一调用 init/snapshot/dispose。
 */
export interface AppModule<TSnapshot = unknown> {
  /** 模块名称（用于日志和调试） */
  name: string;

  /**
   * 初始化模块（加载配置、建立连接等）
   * 在 loadAll 调用时执行
   */
  init?(context: ModuleContext): Promise<void>;

  /**
   * 获取模块快照数据
   * init 后调用，返回加载结果
   */
  snapshot?(): TSnapshot | Promise<TSnapshot>;

  /**
   * 释放模块资源（断开连接、清缓存等）
   * AppContext.dispose() 时调用
   */
  dispose?(): Promise<void>;
}
