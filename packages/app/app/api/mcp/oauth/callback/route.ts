import { NextRequest, NextResponse } from 'next/server';
import { loadAgentContext } from '@/lib/agent-context';
import { parseOAuthState } from '@the-thing/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 授权结果页（浏览器在完成授权后重定向回来，展示结果并引导关闭） */
function resultPage(title: string, detail: string, ok: boolean): NextResponse {
  const color = ok ? '#16a34a' : '#dc2626';
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc">
  <div style="text-align:center;padding:32px;max-width:420px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,.06)">
    <div style="font-size:48px;margin-bottom:12px">${ok ? '✅' : '⚠️'}</div>
    <h1 style="font-size:18px;margin:0 0 8px;color:#0f172a">${title}</h1>
    <p style="font-size:14px;color:${color};margin:0 0 16px">${detail}</p>
    <p style="font-size:13px;color:#64748b;margin:0">可以关闭此窗口并返回 The Thing。</p>
  </div>
</body>
</html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/**
 * GET /api/mcp/oauth/callback?code=..&state=..
 *
 * OAuth 授权服务器的 localhost redirect 目标。授权服务器只回跳注册的
 * redirect_uri（不带服务器标识）并追加 code/state；服务器名编码在 state 中
 * （mcp-oauth.ts 的 parseOAuthState），这里解析后完成 token 交换并重连。
 * query 中的 ?server= 仍被接受（显式指定时的兼容路径）。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') ?? '';
  const state = searchParams.get('state') ?? '';
  const serverFromQuery = searchParams.get('server');

  if (!code || !state) {
    return resultPage('授权参数不完整', '缺少 code / state 参数', false);
  }

  // 服务器标识：优先 query（兼容），否则从 state 还原（真实流程路径）
  const { serverName } = parseOAuthState(state);
  const name = serverFromQuery ?? serverName;
  if (!name) {
    return resultPage('授权参数不完整', '无法从回调识别 MCP 服务器', false);
  }

  try {
    const context = await loadAgentContext();
    const mcpRegistry = context.mcpRegistry;
    if (!mcpRegistry) {
      return resultPage('授权失败', 'MCP Registry 不可用', false);
    }
    const result = await mcpRegistry.completeOAuth(name, code, state);
    if (!result.ok) {
      return resultPage('授权失败', result.error ?? '未知错误', false);
    }
    return resultPage('授权成功', '已连接 MCP 服务器，可以开始使用。', true);
  } catch (error) {
    return resultPage('授权失败', error instanceof Error ? error.message : String(error), false);
  }
}
