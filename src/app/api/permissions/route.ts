import { removeRule, saveRule, loadRules } from '@thething/core';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { toolName, pattern, behavior } = body;

    if (!toolName) {
      return NextResponse.json({ error: 'Missing toolName' }, { status: 400 });
    }

    const rule = await saveRule({
      toolName,
      pattern,
      behavior: behavior || 'allow',
    });

    return NextResponse.json({ success: true, rule });
  } catch (error) {
    console.error('[Permissions API] Error:', error);
    return NextResponse.json({ error: 'Failed to save rule' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    await removeRule(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Permissions API] Error:', error);
    return NextResponse.json({ error: 'Failed to remove rule' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const config = await loadRules();
    return NextResponse.json({ rules: config.rules });
  } catch (error) {
    console.error('[Permissions API] Error:', error);
    return NextResponse.json({ error: 'Failed to load rules' }, { status: 500 });
  }
}