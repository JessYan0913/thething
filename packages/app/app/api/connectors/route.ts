import { getServerContext, reloadServerContext } from '@/lib/runtime';
import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import yaml from 'js-yaml';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const context = await getServerContext();
    const connectors = context.connectors.map((conn) => ({
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

/**
 * 更新 YAML 文件中的 variables 区域，保留原文件注释和格式。
 * 只在 variables 块内做字符串级替换，不重写整个文件。
 */
function updateVariablesInYaml(content: string, newVars: Record<string, string>): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inVariables = false;
  let varBlockIndent = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect the start of the variables block
    if (!inVariables) {
      const varMatch = line.match(/^(\s*)variables:\s*$/);
      if (varMatch) {
        inVariables = true;
        varBlockIndent = varMatch[1].length;
      }
      result.push(line);
      continue;
    }

    // Empty lines stay inside the block
    if (trimmed === '') {
      result.push(line);
      continue;
    }

    // Comments stay inside the block
    if (trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }

    // Check if we've left the variables block
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= varBlockIndent) {
      inVariables = false;
      result.push(line);
      continue;
    }

    // We're inside the variables block — check if this line is a key: value pair to update
    const keyMatch = line.match(/^(\s*)([\w-]+):\s*/);
    if (keyMatch) {
      const key = keyMatch[2];
      if (key in newVars) {
        // Preserve any trailing comment
        const afterKey = line.slice(keyMatch[0].length);
        const commentMatch = afterKey.match(/(\s*#.*)$/);
        const comment = commentMatch ? commentMatch[1] : '';

        // Escape value for YAML double-quoted string
        const escapedValue = newVars[key]
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');

        result.push(`${keyMatch[1]}${key}: "${escapedValue}"${comment}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, variables: newVars } = body;

    if (!id || !newVars) {
      return NextResponse.json({ error: 'Missing id or variables' }, { status: 400 });
    }

    const context = await getServerContext();
    const connector = context.connectors.find((c) => c.id === id);
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

    const context = await getServerContext();
    const connector = context.connectors.find((c) => c.id === id);
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
