import { getServerContext, reloadServerContext } from '@/lib/runtime';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function getPrimarySkillsDir(): Promise<string> {
  const { getServerRuntime } = await import('@/lib/runtime');
  const rt = await getServerRuntime();
  return rt.layout.resources.skills[0];
}

async function ensureSkillsDir(): Promise<string> {
  const dir = await getPrimarySkillsDir();
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  return dir;
}

// GET / — list all skills, or get single skill by folderName
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const folderName = searchParams.get('folderName');

    const context = await getServerContext();
    const skills = context.skills.map((skill) => {
      const sourceDir = path.dirname(skill.sourcePath);
      return {
        name: skill.name,
        folderName: path.basename(sourceDir),
        description: skill.description,
        whenToUse: skill.whenToUse,
        allowedTools: skill.allowedTools,
        model: skill.model,
        effort: skill.effort,
        context: skill.context,
        paths: skill.paths,
        sourcePath: skill.sourcePath,
        source: skill.source ?? 'project',
      };
    });

    // Single skill lookup
    if (folderName) {
      const skill = skills.find((s) => s.folderName === folderName);
      if (!skill) {
        return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
      }
      return NextResponse.json({ skill });
    }

    return NextResponse.json({ skills });
  } catch (error) {
    console.error('[Skills API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
  }
}

// POST / — create skill (upload or create from content)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'upload') {
      // Simplified upload - in production would handle multipart
      const { folderName, files } = body;
      if (!folderName) {
        return NextResponse.json({ error: 'Missing folderName' }, { status: 400 });
      }

      const skillsDir = await ensureSkillsDir();
      const folderPath = path.join(skillsDir, folderName);

      try {
        const stat = await fs.stat(folderPath);
        if (stat.isDirectory() && !body.overwrite) {
          return NextResponse.json({ error: 'Skill already exists' }, { status: 409 });
        }
      } catch {
        // Directory doesn't exist, proceed
      }

      await fs.mkdir(folderPath, { recursive: true });

      if (files && typeof files === 'object') {
        for (const [relativePath, content] of Object.entries(files)) {
          if (typeof content !== 'string') continue;
          const filePath = path.join(folderPath, relativePath);
          const fileDir = path.dirname(filePath);
          await fs.mkdir(fileDir, { recursive: true });
          await fs.writeFile(filePath, content, 'utf-8');
        }
      }

      await reloadServerContext();
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[Skills API] POST error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

// DELETE / — delete skill
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
    }

    const skillsDir = await getPrimarySkillsDir();
    const folderPath = path.join(skillsDir, name);

    try {
      await fs.access(folderPath);
    } catch {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    await fs.rm(folderPath, { recursive: true, force: true });
    await reloadServerContext();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Skills API] DELETE error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
