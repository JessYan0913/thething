import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const rt = await getServerRuntime();
    const projects = rt.dataStore.projectStore.listProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error('[Projects API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load projects' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { id?: string; name: string; path: string };
    if (!body.name || !body.path) {
      return NextResponse.json({ error: 'Missing name or path' }, { status: 400 });
    }
    const rt = await getServerRuntime();
    const id = body.id || crypto.randomUUID();
    const project = rt.dataStore.projectStore.createProject(id, body.name, body.path);
    return NextResponse.json({ project });
  } catch (error) {
    console.error('[Projects API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id: string; name?: string; path?: string };
    if (!body.id) {
      return NextResponse.json({ error: 'Missing project id' }, { status: 400 });
    }
    const rt = await getServerRuntime();
    rt.dataStore.projectStore.updateProject(body.id, { name: body.name, path: body.path });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Projects API] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing project id' }, { status: 400 });
    }
    const rt = await getServerRuntime();
    rt.dataStore.projectStore.deleteProject(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Projects API] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
