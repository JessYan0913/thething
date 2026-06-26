import { getServerRuntime, reloadServerContext } from '@/lib/runtime';
import { loadConnectors, updateVariablesInYaml } from '@the-thing/core';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import yaml from 'js-yaml';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // 直接从磁盘读取，不依赖 context 缓存
    const rt = await getServerRuntime();
    const diskConnectors = await loadConnectors({
      configDir: rt.layout.configDir,
      cwd: process.cwd(),
      dirs: rt.layout.resources.connectors,
    });
    const connectors = diskConnectors.map((conn) => ({
      id: conn.id,
      name: conn.name,
      version: conn.version,
      description: conn.description,
      enabled: conn.enabled,
      variables: conn.variables ?? {},
      base_url: conn.base_url,
      auth: conn.auth,
      inbound: conn.inbound,
      tools: conn.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        executor: t.executor,
        timeout_ms: t.timeout_ms,
        retryable: t.retryable,
        input_schema: t.input_schema,
      })) ?? [],
      toolCount: conn.tools?.length ?? 0,
      sourcePath: conn.sourcePath,
    }));

    return NextResponse.json({ connectors });
  } catch (error) {
    console.error('[Connectors API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load connectors' }, { status: 500 });
  }
}

async function getPrimaryConnectorsDir(): Promise<string> {
  const rt = await getServerRuntime();
  const dirs = rt.layout.resources.connectors;
  return dirs[dirs.length - 1];
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { content, filename, overwrite } = body;

    if (!content || !filename) {
      return NextResponse.json({ error: 'Missing content or filename' }, { status: 400 });
    }

    // Validate filename
    if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) {
      return NextResponse.json({ error: 'File must be .yaml or .yml' }, { status: 400 });
    }

    // Parse YAML to validate it has required fields
    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.load(content) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid YAML format' }, { status: 400 });
    }

    if (!parsed.id || !parsed.name) {
      return NextResponse.json({ error: 'Connector YAML must have "id" and "name" fields' }, { status: 400 });
    }

    // Get connectors directory
    const connectorsDir = await getPrimaryConnectorsDir();
    await fs.mkdir(connectorsDir, { recursive: true });

    const filePath = path.join(connectorsDir, filename);

    // Check for existing file
    try {
      await fs.access(filePath);
      if (!overwrite) {
        return NextResponse.json({ error: 'File already exists', conflict: true }, { status: 409 });
      }
    } catch {
      // File doesn't exist, that's fine
    }

    await fs.writeFile(filePath, content, 'utf-8');
    await reloadServerContext();

    return NextResponse.json({ success: true, id: parsed.id });
  } catch (error) {
    console.error('[Connectors API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create connector' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, variables: newVars } = body;

    if (!id || !newVars) {
      return NextResponse.json({ error: 'Missing id or variables' }, { status: 400 });
    }

    // 从磁盘查找 connector
    const rt = await getServerRuntime();
    const diskConnectors = await loadConnectors({
      configDir: rt.layout.configDir,
      cwd: process.cwd(),
      dirs: rt.layout.resources.connectors,
    });
    const connector = diskConnectors.find((c) => c.id === id);
    if (!connector) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    }

    if (!connector.sourcePath) {
      return NextResponse.json({ error: 'Connector has no source file' }, { status: 400 });
    }

    // Read YAML as text (for string-level replacement)
    const content = await fs.readFile(connector.sourcePath, 'utf-8');

    // Parse for validation (check that keys exist)
    const raw = yaml.load(content) as Record<string, unknown>;
    const existingVars = (raw.variables ?? {}) as Record<string, string>;
    for (const key of Object.keys(newVars)) {
      if (!(key in existingVars)) {
        return NextResponse.json({ error: `Variable '${key}' not found in connector` }, { status: 400 });
      }
    }

    // String-level replacement — preserve comments and formatting
    const updatedContent = updateVariablesInYaml(content, newVars);
    await fs.writeFile(connector.sourcePath, updatedContent, 'utf-8');

    // Reload context
    await reloadServerContext();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Connectors API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update variables' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 });
    }

    // 从磁盘查找 connector
    const rt = await getServerRuntime();
    const diskConnectors = await loadConnectors({
      configDir: rt.layout.configDir,
      cwd: process.cwd(),
      dirs: rt.layout.resources.connectors,
    });
    const connector = diskConnectors.find((c) => c.id === id);
    if (!connector) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    }

    if (!connector.sourcePath) {
      return NextResponse.json({ error: 'Connector has no source file' }, { status: 400 });
    }

    await fs.unlink(connector.sourcePath);
    await reloadServerContext();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Connectors API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete connector' }, { status: 500 });
  }
}
