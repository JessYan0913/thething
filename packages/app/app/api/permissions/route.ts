import { getServerRuntime } from '@/lib/runtime';
import { saveRule, removeRule, loadRules, updateRule, type PermissionBehavior } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function getResourceRoot(): Promise<string> {
  const rt = await getServerRuntime();
  return rt.layout.resourceRoot;
}

export async function GET() {
  try {
    const resourceRoot = await getResourceRoot();
    const config = await loadRules(resourceRoot);
    return NextResponse.json({ rules: config.rules });
  } catch (error) {
    console.error('[Permissions API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load rules' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { toolName: string; pattern?: string; behavior?: PermissionBehavior };
    const { toolName, pattern, behavior } = body;
    if (!toolName) {
      return NextResponse.json({ error: 'Missing toolName' }, { status: 400 });
    }
    const resourceRoot = await getResourceRoot();
    const rule = await saveRule({ toolName, pattern, behavior: behavior || 'allow' }, resourceRoot);
    return NextResponse.json({ success: true, rule });
  } catch (error) {
    console.error('[Permissions API] POST error:', error);
    return NextResponse.json({ error: 'Failed to save rule' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    const resourceRoot = await getResourceRoot();
    await removeRule(id, resourceRoot);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Permissions API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to remove rule' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    const body = await request.json() as { toolName?: string; pattern?: string; behavior?: PermissionBehavior };
    const { toolName, pattern, behavior } = body;
    const resourceRoot = await getResourceRoot();
    const rule = await updateRule(id, { toolName, pattern, behavior }, resourceRoot);
    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, rule });
  } catch (error) {
    console.error('[Permissions API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }
}
