import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { NextResponse } from 'next/server';

const execAsync = promisify(exec);

export const runtime = 'nodejs';

/**
 * 文件预览快捷链接
 *
 * 在聊天中作为文件路径的链接目标（如 /api/preview?path=...），
 * 前端会拦截点击并打开预览面板。如果用户直接访问（新标签页/中键），
 * 则在 Finder 中显示该文件作为 fallback。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    // 安全检查：确认文件存在
    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // 在 Finder 中显示文件（macOS）
    if (process.platform === 'darwin') {
      await execAsync(`open -R "${filePath}"`);
    } else if (process.platform === 'win32') {
      await execAsync(`explorer /select,"${filePath}"`);
    } else {
      await execAsync(`xdg-open "${path.dirname(filePath)}"`);
    }

    // 返回一个简单的确认页面或 JSON
    return NextResponse.json({
      success: true,
      message: 'File opened in Finder',
      path: filePath,
    });
  } catch (error) {
    console.error('[Preview API] Error:', error);
    return NextResponse.json({ error: 'Failed to preview file' }, { status: 500 });
  }
}
