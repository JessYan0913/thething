import { getServerRuntime, reloadServerContext } from '@/lib/runtime';
import { loadAgents, serializeAgentMarkdown, type AgentDefinition } from '@the-thing/core';
import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function buildAgentDefinitionFromPayload(
  body: Record<string, unknown>,
  source: string,
  agentTypeOverride?: string,
): AgentDefinition {
  return {
    agentType: (agentTypeOverride ?? body.agentType) as string,
    displayName: (body.displayName as string) || '',
    instructions: (body.instructions as string) ?? '',
    model: (body.model as string) ?? 'inherit',
    tools: (body.tools as string[]) ?? [],
    connectors: (body.connectors as boolean) ?? true,
    skills: (body.skills as boolean) ?? true,
    mcp: (body.mcp as boolean) ?? true,
    permission: body.permission as 'smart' | 'auto-review' | 'full-trust' | undefined,
    source: source as 'builtin' | 'user' | 'project' | 'plugin',
    metadata: (body.metadata as Record<string, unknown>) ?? {},
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentType: string }> },
) {
  try {
    const { agentType } = await params;
    const rt = await getServerRuntime();
    const diskAgents = await loadAgents({
      configDir: rt.layout.configDir,
      cwd: process.cwd(),
      dirs: rt.layout.resources.agents,
    });

    const agent = diskAgents.find((a) => a.agentType === agentType);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (!agent.filePath) {
      return NextResponse.json({ error: 'Agent has no file' }, { status: 404 });
    }

    const content = await fs.readFile(agent.filePath, 'utf-8');
    return NextResponse.json({ content, filePath: agent.filePath });
  } catch (error) {
    console.error('[Agent Content API] GET error:', error);
    return NextResponse.json({ error: 'Failed to read agent content' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ agentType: string }> },
) {
  try {
    const { agentType } = await params;
    const body = await request.json() as { content?: string };

    if (!body.content) {
      return NextResponse.json({ error: 'Missing content' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const diskAgents = await loadAgents({
      configDir: rt.layout.configDir,
      cwd: process.cwd(),
      dirs: rt.layout.resources.agents,
    });

    const agent = diskAgents.find((a) => a.agentType === agentType);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (!agent.filePath) {
      return NextResponse.json({ error: 'Agent has no file' }, { status: 404 });
    }

    await fs.writeFile(agent.filePath, body.content, 'utf-8');
    await reloadServerContext();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Agent Content API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update agent content' }, { status: 500 });
  }
}
