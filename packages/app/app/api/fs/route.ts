import { getServerRuntime } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { NextResponse } from 'next/server';

const execAsync = promisify(exec);

export const runtime = 'nodejs';

async function getAllowedRoots(): Promise<string[]> {
  const rt = await getServerRuntime();
  const resourceRoot = rt.layout.resourceRoot;
  const homeDir = os.homedir();
  return [resourceRoot, homeDir];
}

function expandTilde(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function isPathAllowed(resolved: string, allowedRoots: string[]): boolean {
  return allowedRoots.some(
    (root) => resolved.startsWith(root + path.sep) || resolved === root,
  );
}

/**
 * 校验目录浏览路径是否安全。
 * 允许浏览 home 目录及其子目录，以及 / 用于访问其他磁盘。
 */
function isBrowsePathAllowed(resolved: string): boolean {
  const homeDir = os.homedir();
  // 允许 home 目录及其所有子目录
  if (resolved.startsWith(homeDir + path.sep) || resolved === homeDir) return true;
  // 允许 /（根目录，用于访问其他挂载点）
  if (resolved === '/') return true;
  // macOS: 允许 /Volumes/（外部磁盘）
  if (process.platform === 'darwin' && resolved.startsWith('/Volumes/')) return true;
  return false;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'list') {
      const dirParam = searchParams.get('dir');
      if (!dirParam) {
        return NextResponse.json({ error: 'Missing dir query parameter' }, { status: 400 });
      }

      const resolvedDir = path.resolve(dirParam);
      const allowedRoots = await getAllowedRoots();
      if (!isPathAllowed(resolvedDir, allowedRoots)) {
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
      }

      try {
        await fs.access(resolvedDir);
      } catch {
        return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
      }

      const stat = await fs.stat(resolvedDir);
      if (!stat.isDirectory()) {
        return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
      }

      const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
      const items = await Promise.all(
        entries
          .filter((e) => !e.name.startsWith('.'))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) {
              return a.isDirectory() ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          })
          .map(async (e) => {
            const fullPath = path.join(resolvedDir, e.name);
            let size = 0;
            if (e.isFile()) {
              try {
                const fstat = await fs.stat(fullPath);
                size = fstat.size;
              } catch { /* ignore */ }
            }
            return {
              name: e.name,
              path: fullPath,
              type: e.isDirectory() ? 'dir' : 'file',
              size,
            };
          })
      );

      return NextResponse.json({ items, parent: path.dirname(resolvedDir) });
    }

    if (action === 'read') {
      const fileParam = searchParams.get('path');
      const encoding = searchParams.get('encoding');
      if (!fileParam) {
        return NextResponse.json({ error: 'Missing path query parameter' }, { status: 400 });
      }

      const expandedFile = expandTilde(fileParam);
      const resolvedFile = path.resolve(expandedFile);
      const allowedRoots = await getAllowedRoots();
      if (!isPathAllowed(resolvedFile, allowedRoots)) {
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
      }

      try {
        await fs.access(resolvedFile);
      } catch {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const stat = await fs.stat(resolvedFile);
      if (!stat.isFile()) {
        return NextResponse.json({ error: 'Path is not a file' }, { status: 400 });
      }

      const ext = path.extname(resolvedFile).toLowerCase();

      // 如果请求 base64 编码（用于二进制文件）
      if (encoding === 'base64') {
        const buffer = await fs.readFile(resolvedFile);
        const base64 = buffer.toString('base64');
        return NextResponse.json({
          content: base64,
          ext,
          size: stat.size,
          encoding: 'base64',
        });
      }

      // 默认以 UTF-8 文本读取
      const content = await fs.readFile(resolvedFile, 'utf-8');

      return NextResponse.json({
        content,
        ext,
        size: stat.size,
        lines: content.split('\n').length,
      });
    }

    if (action === 'browse') {
      const dirParam = searchParams.get('dir') || os.homedir();
      const resolvedDir = path.resolve(dirParam);

      if (!isBrowsePathAllowed(resolvedDir)) {
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
      }

      try {
        await fs.access(resolvedDir);
      } catch {
        return NextResponse.json({ error: 'Directory not found', items: [], parent: null }, { status: 200 });
      }

      const stat = await fs.stat(resolvedDir);
      if (!stat.isDirectory()) {
        return NextResponse.json({ items: [], parent: path.dirname(resolvedDir) });
      }

      const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
      const items = entries
        .filter((e) => !e.name.startsWith('.') && e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({
          name: e.name,
          path: path.join(resolvedDir, e.name),
        }));

      return NextResponse.json({
        current: resolvedDir,
        parent: resolvedDir === '/' ? null : path.dirname(resolvedDir),
        items,
      });
    }

    if (action === 'open') {
      const fileParam = searchParams.get('path');
      if (!fileParam) {
        return NextResponse.json({ error: 'Missing path query parameter' }, { status: 400 });
      }

      const expandedFile = expandTilde(fileParam);
      const resolvedFile = path.resolve(expandedFile);

      try {
        await fs.access(resolvedFile);
      } catch {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      // 在 macOS 上使用 open 命令在 Finder 中打开
      if (process.platform === 'darwin') {
        await execAsync(`open -R "${resolvedFile}"`);
      } else if (process.platform === 'win32') {
        // Windows: 使用 explorer 选中文件
        await execAsync(`explorer /select,"${resolvedFile}"`);
      } else {
        // Linux: 打开文件所在的目录
        await execAsync(`xdg-open "${path.dirname(resolvedFile)}"`);
      }

      return NextResponse.json({ success: true, path: resolvedFile });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[FS API] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
