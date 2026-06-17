import { getServerContext, getServerRuntime, reloadServerContext } from '@/lib/runtime';
import { serializeAgentMarkdown, type AgentDefinition } from '@the-thing/core';
import { promises as fs } from 'fs';
import path from 'path';
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
    description: body.description as string,
    tools: (body.tools as string[]) ?? [],
    disallowedTools: (body.disallowedTools as string[]) ?? [],
    model: (body.model as string) ?? 'inherit',
    effort: body.effort as 'low' | 'medium' | 'high' | number | undefined,
    maxTurns: (body.maxTurns as number) ?? 20,
    permissionMode: body.permissionMode as 'acceptEdits' | 'plan' | 'bypassPermissions' | undefined,
    background: (body.background as boolean) ?? false,
    isolation: body.isolation as 'worktree' | undefined,
    memory: body.memory as 'user' | 'project' | 'local' | undefined,
    skills: (body.skills as string[]) ?? [],
    includeParentContext: (body.includeParentContext as boolean) ?? false,
    maxParentMessages: body.maxParentMessages as number | undefined,
    summarizeOutput: (body.summarizeOutput as boolean) ?? true,
    initialPrompt: (body.initialPrompt as string) ?? '',
    instructions: (body.instructions as string) ?? '',
    source: source as 'builtin' | 'user' | 'project' | 'plugin',
    metadata: (body.metadata as Record<string, unknown>) ?? {},
  };
}

async function getPrimaryAgentsDir(): Promise<string> {
  const rt = await getServerRuntime();
  const dirs = rt.layout.resources.agents;
  return dirs[dirs.length - 1];
}

async function ensureAgentsDir(): Promise<string> {
  const dir = await getPrimaryAgentsDir();
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  return dir;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentType = searchParams.get('agentType');
    const context = await getServerContext();

    if (agentType) {
      const agent = context.agents.find((a) => a.agentType === agentType);
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
      return NextResponse.json({
        agentType: agent.agentType,
        description: agent.description,
        displayName: agent.displayName,
        tools: agent.tools ?? [],
        disallowedTools: agent.disallowedTools ?? [],
        model: agent.model ?? 'inherit',
        effort: agent.effort,
        maxTurns: agent.maxTurns ?? 20,
        permissionMode: agent.permissionMode ?? null,
        background: agent.background ?? false,
        isolation: agent.isolation ?? null,
        memory: agent.memory ?? null,
        skills: agent.skills ?? [],
        includeParentContext: agent.includeParentContext ?? false,
        maxParentMessages: agent.maxParentMessages ?? null,
        summarizeOutput: agent.summarizeOutput ?? true,
        initialPrompt: agent.initialPrompt ?? '',
        instructions: agent.instructions ?? '',
        source: agent.source,
        filePath: agent.filePath,
        metadata: agent.metadata ?? {},
      });
    }

    // Read persisted metadata for built-in agents
    let persistedMeta: Record<string, Record<string, unknown>> = {};
    try {
      const agentsDir = await ensureAgentsDir();
      const metaRaw = await fs.readFile(path.join(agentsDir, '.agent-metadata.json'), 'utf-8');
      persistedMeta = JSON.parse(metaRaw);
    } catch {
      // No persisted metadata file
    }

    const agents = context.agents.map((agent) => ({
      agentType: agent.agentType,
      description: agent.description,
      displayName: agent.displayName,
      tools: agent.tools,
      model: agent.model,
      effort: agent.effort,
      maxTurns: agent.maxTurns,
      permissionMode: agent.permissionMode,
      background: agent.background,
      memory: agent.memory,
      skills: agent.skills,
      source: agent.source,
      filePath: agent.filePath,
      metadata: { ...(agent.metadata ?? {}), ...(persistedMeta[agent.agentType] ?? {}) },
    }));

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('[Agents API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agentType } = body;

    if (!agentType || !body.description) {
      return NextResponse.json({ error: 'Missing required fields: agentType, description' }, { status: 400 });
    }

    const agentsDir = await ensureAgentsDir();
    const filePath = path.join(agentsDir, `${agentType}.md`);

    try {
      await fs.access(filePath);
      return NextResponse.json({ error: 'Agent already exists' }, { status: 409 });
    } catch {
      // File doesn't exist, proceed
    }

    const def = buildAgentDefinitionFromPayload(body, 'project');

    const content = serializeAgentMarkdown(def);
    await fs.writeFile(filePath, content, 'utf-8');
    await reloadServerContext();

    return NextResponse.json({ success: true, filePath });
  } catch (error) {
    console.error('[Agents API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentType = searchParams.get('agentType');
    if (!agentType) {
      return NextResponse.json({ error: 'Missing agentType query parameter' }, { status: 400 });
    }

    const context = await getServerContext();
    const agent = context.agents.find((a) => a.agentType === agentType);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const body = await request.json();
    const filePath = agent.filePath;
    if (!filePath) {
      return NextResponse.json({ error: 'Agent has no file path' }, { status: 400 });
    }

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'Agent file not found' }, { status: 404 });
    }

    const def = buildAgentDefinitionFromPayload(body, 'project', agentType);

    if (body.agentType && body.agentType !== agentType) {
      await fs.unlink(filePath);
      const newPath = path.join(path.dirname(filePath), `${body.agentType}.md`);
      await fs.writeFile(newPath, serializeAgentMarkdown(def), 'utf-8');
    } else {
      await fs.writeFile(filePath, serializeAgentMarkdown(def), 'utf-8');
    }

    await reloadServerContext();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Agents API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentType = searchParams.get('agentType');
    if (!agentType) {
      return NextResponse.json({ error: 'Missing agentType query parameter' }, { status: 400 });
    }

    const context = await getServerContext();
    const agent = context.agents.find((a) => a.agentType === agentType);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const body = await request.json() as { metadata?: Record<string, unknown> };
    const updatedMetadata = { ...(agent.metadata ?? {}), ...(body.metadata ?? {}) };

    // Built-in agents can only update metadata, not rewrite the file
    if (agent.source === 'builtin') {
      // Update in-memory only via context reload won't persist,
      // so we store enabled state separately
      const agentsDir = await ensureAgentsDir();
      const metaPath = path.join(agentsDir, '.agent-metadata.json');
      let allMeta: Record<string, Record<string, unknown>> = {};
      try {
        const raw = await fs.readFile(metaPath, 'utf-8');
        allMeta = JSON.parse(raw);
      } catch {
        // File doesn't exist yet
      }
      allMeta[agentType] = updatedMetadata;
      await fs.writeFile(metaPath, JSON.stringify(allMeta, null, 2), 'utf-8');
      await reloadServerContext();
      return NextResponse.json({ success: true, metadata: updatedMetadata });
    }

    // User/project agents: update the .md file
    const filePath = agent.filePath;
    if (!filePath) {
      return NextResponse.json({ error: 'Agent has no file path' }, { status: 400 });
    }

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'Agent file not found' }, { status: 404 });
    }

    const def = buildAgentDefinitionFromPayload(
      { ...agent, metadata: updatedMetadata } as Record<string, unknown>,
      agent.source,
    );

    await fs.writeFile(filePath, serializeAgentMarkdown(def), 'utf-8');
    await reloadServerContext();

    return NextResponse.json({ success: true, metadata: updatedMetadata });
  } catch (error) {
    console.error('[Agents API] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update agent metadata' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentType = searchParams.get('agentType');
    if (!agentType) {
      return NextResponse.json({ error: 'Missing agentType query parameter' }, { status: 400 });
    }

    const context = await getServerContext();
    const agent = context.agents.find((a) => a.agentType === agentType);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const filePath = agent.filePath;
    if (!filePath) {
      return NextResponse.json({ error: 'Agent has no file path' }, { status: 400 });
    }

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'Agent file not found' }, { status: 404 });
    }

    await fs.unlink(filePath);
    await reloadServerContext();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Agents API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
