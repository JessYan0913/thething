import { getServerContext, getServerRuntime, reloadServerContext } from '@/lib/runtime';
import { serializeAgentMarkdown, type AgentDefinition } from '@the-thing/core';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

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

    const def: AgentDefinition = {
      agentType: body.agentType,
      displayName: body.displayName || '',
      description: body.description,
      tools: body.tools ?? [],
      disallowedTools: body.disallowedTools ?? [],
      model: body.model ?? 'inherit',
      effort: body.effort,
      maxTurns: body.maxTurns ?? 20,
      permissionMode: body.permissionMode ?? undefined,
      background: body.background ?? false,
      isolation: body.isolation ?? undefined,
      memory: body.memory ?? undefined,
      skills: body.skills ?? [],
      includeParentContext: body.includeParentContext ?? false,
      maxParentMessages: body.maxParentMessages ?? undefined,
      summarizeOutput: body.summarizeOutput ?? true,
      initialPrompt: body.initialPrompt ?? '',
      instructions: body.instructions ?? '',
      source: 'project',
      metadata: body.metadata ?? {},
    };

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

    const body = await request.json();
    const agentsDir = await getPrimaryAgentsDir();
    const filePath = path.join(agentsDir, `${agentType}.md`);

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const def: AgentDefinition = {
      agentType: body.agentType ?? agentType,
      displayName: body.displayName || '',
      description: body.description,
      tools: body.tools ?? [],
      disallowedTools: body.disallowedTools ?? [],
      model: body.model ?? 'inherit',
      effort: body.effort,
      maxTurns: body.maxTurns ?? 20,
      permissionMode: body.permissionMode ?? undefined,
      background: body.background ?? false,
      isolation: body.isolation ?? undefined,
      memory: body.memory ?? undefined,
      skills: body.skills ?? [],
      includeParentContext: body.includeParentContext ?? false,
      maxParentMessages: body.maxParentMessages ?? undefined,
      summarizeOutput: body.summarizeOutput ?? true,
      initialPrompt: body.initialPrompt ?? '',
      instructions: body.instructions ?? '',
      source: 'project',
      metadata: body.metadata ?? {},
    };

    if (body.agentType && body.agentType !== agentType) {
      await fs.unlink(filePath);
      const newPath = path.join(agentsDir, `${body.agentType}.md`);
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

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentType = searchParams.get('agentType');
    if (!agentType) {
      return NextResponse.json({ error: 'Missing agentType query parameter' }, { status: 400 });
    }

    const agentsDir = await getPrimaryAgentsDir();
    const filePath = path.join(agentsDir, `${agentType}.md`);

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    await fs.unlink(filePath);
    await reloadServerContext();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Agents API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
