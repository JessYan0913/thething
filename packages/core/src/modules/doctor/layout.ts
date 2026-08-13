// ============================================================
// Doctor Layout — CLI 模式的布局推导
// ============================================================
// 复刻 app runtime 的路径推导（packages/app/lib/runtime.ts:44-60,157）：
//   - ~/.thethingrc 的 dataDir 指针（可选）
//   - 默认 ~/.thething（configDir），data 在其下
// API 路由不用此函数（用 rt.layout，权威）；仅供 CLI 脚本在无 runtime 时使用。

import fs from 'fs';
import path from 'path';
import { resolveHomeDir } from '../../primitives/paths';
import { resolveLayout, type ResolvedLayout } from '../../services/config/layout';

function readTheThingRC(homeDir: string): { dataDir?: string } | null {
  try {
    const raw = fs.readFileSync(path.join(homeDir, '.thethingrc'), 'utf-8');
    const parsed = JSON.parse(raw) as { dataDir?: string };
    return parsed && typeof parsed.dataDir === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** 推导 TheThing 的运行时布局（~/.thethingrc 感知）。 */
export function resolveTheThingLayout(): ResolvedLayout {
  const homeDir = resolveHomeDir();
  const configDir = path.join(homeDir, '.thething');
  const rc = readTheThingRC(homeDir);
  const base = rc?.dataDir ? rc.dataDir.replace(/^~/, homeDir) : configDir;
  return resolveLayout({
    resourceRoot: process.cwd(),
    configDir,
    dataDir: path.join(base, 'data'),
  });
}
