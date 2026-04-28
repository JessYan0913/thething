// ============================================================
// Resource Layout - 资源目录配置
// ============================================================

import { computeUserConfigDir, computeProjectConfigDir } from '../foundation/paths';

/**
 * 描述所有资源文件的目录布局。
 * 一旦确定，在 AppContext 生命周期内不变。
 */
export interface ResourceLayout {
  /** Skills 目录（可多目录：用户级 + 项目级） */
  skills: string[];
  /** Agents 目录 */
  agents: string[];
  /** MCP 配置目录 */
  mcps: string[];
  /** Connectors 目录 */
  connectors: string[];
  /** Permissions 目录 */
  permissions: string[];
  /** Memory 目录 */
  memory: string[];
}

/**
 * 根据 cwd 和 homeDir 计算默认的资源目录布局。
 * 这是一个纯函数，可测试，可 mock。
 *
 * @param cwd 项目工作目录
 * @param homeDir 用户 home 目录
 * @returns 默认的资源目录布局
 */
export function buildDefaultResourceLayout(cwd: string, homeDir: string): ResourceLayout {
  return {
    skills: [
      computeUserConfigDir(homeDir, 'skills'),    // 用户全局
      computeProjectConfigDir(cwd, 'skills'),     // 项目级
    ],
    agents: [
      computeUserConfigDir(homeDir, 'agents'),
      computeProjectConfigDir(cwd, 'agents'),
    ],
    mcps: [
      computeUserConfigDir(homeDir, 'mcps'),
      computeProjectConfigDir(cwd, 'mcps'),
    ],
    connectors: [
      computeProjectConfigDir(cwd, 'connectors'),
    ],
    permissions: [
      computeUserConfigDir(homeDir, 'permissions'),
      computeProjectConfigDir(cwd, 'permissions'),
    ],
    memory: [
      computeProjectConfigDir(cwd, 'memory'),
    ],
  };
}