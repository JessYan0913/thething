// ============================================================
// Server Runtime - 应用进程级别的 CoreRuntime 管理
// ============================================================
//
// CoreRuntime 的生命周期跟随应用进程：
// - 启动时初始化一次
// - 所有路由共享同一个 runtime
// - 应用关闭时 dispose

import {
  bootstrap,
  createContext,
  type CoreRuntime,
  type AppContext,
} from '@the-thing/core'
import { getServerProjectDir, getServerDataDir, getServerTokenizerConfig } from './config'

let runtimeInstance: CoreRuntime | null = null
let contextInstance: AppContext | null = null

/**
 * 主动初始化 Server Runtime
 *
 * 通常在 server 启动时调用，确保 runtime 和 context 立即就绪。
 * 如果已经初始化，则跳过。
 */
export async function initServerRuntime(): Promise<CoreRuntime> {
  if (runtimeInstance) {
    return runtimeInstance
  }

  const projectDir = getServerProjectDir()
  const dataDir = getServerDataDir()
  const tokenizerConfig = getServerTokenizerConfig()

  console.log(`[Server Runtime] Initializing with projectDir: ${projectDir}, dataDir: ${dataDir}`)

  runtimeInstance = await bootstrap({
    dataDir,
    cwd: projectDir,
    tokenizerConfig,
  })

  // 立即创建 context
  contextInstance = await createContext({
    runtime: runtimeInstance,
    cwd: runtimeInstance.cwd,
  })

  console.log('[Server Runtime] Initialized successfully')
  return runtimeInstance
}

/**
 * 获取 Server 的 CoreRuntime 实例
 *
 * 如果未初始化，会自动初始化。
 * Server 作为独立应用，使用自己的项目目录和数据目录。
 */
export async function getServerRuntime(): Promise<CoreRuntime> {
  return initServerRuntime()
}

/**
 * 获取 Server 的 AppContext 实例
 *
 * 如果未初始化，会自动使用 runtime 创建。
 */
export async function getServerContext(): Promise<AppContext> {
  if (!contextInstance) {
    const runtime = await getServerRuntime()
    contextInstance = await createContext({
      runtime,
      cwd: runtime.cwd,
    })
    console.log('[Server Context] Created successfully')
  }
  return contextInstance
}

/**
 * 重新加载 AppContext
 *
 * 当配置文件变更时调用，返回新的 context。
 * 原 context 保持不变（不可变设计）。
 */
export async function reloadServerContext(): Promise<AppContext> {
  const context = await getServerContext()
  contextInstance = await context.reload()
  console.log('[Server Context] Reloaded successfully')
  return contextInstance
}

/**
 * 关闭 Server Runtime
 *
 * 应用关闭时调用，清理所有资源。
 */
export async function disposeServerRuntime(): Promise<void> {
  if (runtimeInstance) {
    await runtimeInstance.dispose()
    runtimeInstance = null
    contextInstance = null
    console.log('[Server Runtime] Disposed successfully')
  }
}

/**
 * 获取数据存储实例（便捷方法）
 */
export async function getServerDataStore() {
  const runtime = await getServerRuntime()
  return runtime.dataStore
}