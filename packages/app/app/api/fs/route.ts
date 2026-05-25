import { getServerRuntime } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function getAllowedRoots(): Promise<string[]> {
  const rt = await getServerRuntime();
  const resourceRoot = rt.layout.resourceRoot;
  const homeDir = os.homedir();
  return [resourceRoot, homeDir];
}

function isPathAllowed(resolved: string, allowedRoots: string[]): boolean {
  return allowedRoots.some(
    (root) => resolved.startsWith(root + path.sep) || resolved === root,
  );
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
      if (!fileParam) {
        return NextResponse.json({ error: 'Missing path query parameter' }, { status: 400 });
      }

      const resolvedFile = path.resolve(fileParam);
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

      const content = await fs.readFile(resolvedFile, 'utf-8');
      const ext = path.extname(resolvedFile).toLowerCase();

      return NextResponse.json({
        content,
        ext,
        size: stat.size,
        lines: content.split('\n').length,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[FS API] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
