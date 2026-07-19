import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { loadAgentContext } from '@/lib/agent-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MCP App 的 HTML 模板是按 (server, resourceUri) 静态的，几乎不变。
 * 落地成文件缓存后：
 * 1. 历史对话回看不再依赖活着的 MCP 服务器（治 -32001）；
 * 2. 同一模板跨对话复用，避免重复往返。
 * 需要刷新时删除 <dataDir>/mcp-app-cache/ 即可。
 * v2：缓存改为 JSON（html + ui 元数据），旧 .html 缓存自然失效不再命中。
 */
function cachePath(dataDir: string, serverName: string, resourceUri: string): string {
  const hash = createHash('sha256').update(`${serverName}::${resourceUri}`).digest('hex').slice(0, 32);
  return path.join(dataDir, 'mcp-app-cache', `${hash}.json`);
}

interface ResourcePayload {
  html: string;
  /** 服务器在 _meta.ui 声明的安全/展示元数据（csp、permissions、prefersBorder…） */
  ui: Record<string, unknown> | null;
}

// 进程内 in-flight 去重：旧对话里 N 个 App 同时挂载只打一次服务器，
// 避免并发把单条 stdio 管道压垮
const inFlight = new Map<string, Promise<ResourcePayload>>();

/**
 * POST /api/mcp/resource
 *
 * 获取 MCP App 的 HTML 资源及其 _meta.ui（优先读文件缓存，未命中再走服务器并回写缓存）
 *
 * Body: { serverName: string, resourceUri: string }
 * Response: { html: string, ui: object | null }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serverName, resourceUri } = body;

    if (!serverName || !resourceUri) {
      return NextResponse.json(
        { error: 'Missing serverName or resourceUri' },
        { status: 400 }
      );
    }

    const context = await loadAgentContext();
    const mcpRegistry = context.mcpRegistry;

    if (!mcpRegistry) {
      return NextResponse.json(
        { error: 'MCP Registry not available' },
        { status: 503 }
      );
    }

    const file = cachePath(context.layout.dataDir, serverName, resourceUri);

    // 1. 命中文件缓存 → 直接返回（不碰服务器）
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf-8')) as ResourcePayload;
      return NextResponse.json(cached);
    } catch {
      // 未命中，继续
    }

    // 2. 校验 server 存在
    const serverConfig = mcpRegistry.servers.find((s: { name: string }) => s.name === serverName);
    if (!serverConfig) {
      return NextResponse.json(
        { error: `MCP server "${serverName}" not found` },
        { status: 404 }
      );
    }

    // 3. in-flight 去重后拉取（readResourceSafe 内含超时 + 一次自动重连重试）
    const key = `${serverName}::${resourceUri}`;
    let fetchPromise = inFlight.get(key);
    if (!fetchPromise) {
      fetchPromise = (async (): Promise<ResourcePayload> => {
        const result = await mcpRegistry.readResourceSafe(serverName, resourceUri);
        type ContentItem = { mimeType?: string; text?: string; _meta?: Record<string, unknown> };
        const htmlContent = (result.contents as ContentItem[]).find((c) =>
          c.mimeType?.includes('html') || c.mimeType === 'text/html;profile=mcp-app'
        );
        if (!htmlContent?.text) {
          throw new Error('No HTML content found in resource');
        }
        // _meta.ui 提取：规范要求内容项优先，listing 级兜底
        const contentUi = htmlContent._meta?.ui;
        const listingUi = (result as { _meta?: { ui?: unknown } })._meta?.ui;
        const ui = (contentUi ?? listingUi ?? null) as Record<string, unknown> | null;

        const payload: ResourcePayload = { html: htmlContent.text, ui };
        // 回写缓存（失败不影响本次返回）
        await fs.mkdir(path.dirname(file), { recursive: true })
          .then(() => fs.writeFile(file, JSON.stringify(payload), 'utf-8'))
          .catch(() => {});
        return payload;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, fetchPromise);
    }

    const payload = await fetchPromise;
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[MCP Resource API]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
