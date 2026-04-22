import fs from 'fs/promises';
import path from 'path';
import {
  MEMORY_TYPES_PROMPT,
  WHAT_NOT_TO_SAVE,
  TRUSTING_RECALL_SECTION,
  WHEN_TO_ACCESS_SECTION,
} from './types';
import { memoryFreshnessNote } from './memory-age';
import type { RelevantMemory } from './find-relevant';
import type { ScannedMemory } from './memory-scan';

// 从统一配置模块导入常量
import {
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
} from '../config/defaults';

// 重新导出供其他模块使用
export { MAX_ENTRYPOINT_LINES, MAX_ENTRYPOINT_BYTES };

export const ENTRYPOINT_NAME = 'MEMORY.md';

export async function loadEntrypoint(memoryDir: string): Promise<string> {
  const entrypointPath = path.join(memoryDir, ENTRYPOINT_NAME);
  try {
    const content = await fs.readFile(entrypointPath, 'utf-8');
    return truncateEntrypointContent(content);
  } catch {
    return '';
  }
}

export function truncateEntrypointContent(content: string): string {
  if (content.length > MAX_ENTRYPOINT_BYTES) {
    content = content.slice(0, MAX_ENTRYPOINT_BYTES);
    const lastNewline = content.lastIndexOf('\n');
    if (lastNewline > 0) {
      content = content.slice(0, lastNewline);
    }
  }

  const lines = content.split('\n');
  if (lines.length > MAX_ENTRYPOINT_LINES) {
    return lines.slice(0, MAX_ENTRYPOINT_LINES).join('\n');
  }

  return content;
}

export async function buildMemoryPrompt(
  memoryDir: string,
  extraGuidelines?: string[],
): Promise<string> {
  const lines: string[] = [];

  lines.push(MEMORY_TYPES_PROMPT);

  lines.push(WHAT_NOT_TO_SAVE);

  lines.push(WHEN_TO_ACCESS_SECTION);

  lines.push(TRUSTING_RECALL_SECTION);

  if (extraGuidelines) {
    lines.push(...extraGuidelines);
  }

  return lines.join('\n\n');
}

export async function buildMemorySection(
  memories: RelevantMemory[],
  memoryDir?: string,
): Promise<string> {
  if (memories.length === 0) {
    return '';
  }

  const { readMemoryContent } = await import('./memory-scan');
  const parts: string[] = [];

  for (const memory of memories) {
    const content = await readMemoryContent(memory.path);
    if (content === null) continue;

    const ageNote = memoryFreshnessNote(memory.mtimeMs);

    parts.push(`--- memory: ${path.basename(memory.path)}`);
    if (ageNote) parts.push(ageNote.note);
    parts.push(content);
    parts.push(`--- end: ${path.basename(memory.path)}`);
    parts.push('');
  }

  return parts.join('\n');
}

export async function ensureEntrypointExists(memoryDir: string): Promise<void> {
  const entrypointPath = path.join(memoryDir, ENTRYPOINT_NAME);

  try {
    await fs.access(entrypointPath);
  } catch {
    const initialContent = `# MEMORY.md - 记忆入口索引

> 本文件是记忆系统的入口点。每次对话从这里开始。
> 限制: ${MAX_ENTRYPOINT_LINES} 行 / ${MAX_ENTRYPOINT_BYTES} 字节

## 用户记忆 (user)

## 反馈记忆 (feedback)

## 项目记忆 (project)

## 参考记忆 (reference)
`;
    await fs.writeFile(entrypointPath, initialContent, 'utf-8');
  }
}

export async function rebuildEntrypoint(
  memoryDir: string,
): Promise<void> {
  const { scanMemoryFiles } = await import('./memory-scan');
  const memories = await scanMemoryFiles(memoryDir);

  if (memories.length === 0) {
    const emptyContent = `# MEMORY.md - 记忆入口索引

> 本文件是记忆系统的入口点。每次对话从这里开始。
> 限制: ${MAX_ENTRYPOINT_LINES} 行 / ${MAX_ENTRYPOINT_BYTES} 字节
`;
    await fs.writeFile(path.join(memoryDir, ENTRYPOINT_NAME), emptyContent, 'utf-8');
    return;
  }

  const sectionHeaders: Record<string, string> = {
    user: '## 用户记忆 (user)',
    feedback: '## 反馈记忆 (feedback)',
    project: '## 项目记忆 (project)',
    reference: '## 参考记忆 (reference)',
  };

  const grouped: Record<string, ScannedMemory[]> = {
    user: [],
    feedback: [],
    project: [],
    reference: [],
  };

  for (const memory of memories) {
    if (grouped[memory.type]) {
      grouped[memory.type].push(memory);
    }
  }

  const lines: string[] = [
    '# MEMORY.md - 记忆入口索引',
    '',
    `> 本文件是记忆系统的入口点。每次对话从这里开始。`,
    `> 限制: ${MAX_ENTRYPOINT_LINES} 行 / ${MAX_ENTRYPOINT_BYTES} 字节`,
    '',
  ];

  for (const [type, header] of Object.entries(sectionHeaders)) {
    const typeMemories = grouped[type];
    if (typeMemories.length > 0) {
      lines.push(header);
      lines.push('');
      for (const memory of typeMemories) {
        lines.push(`- [${memory.name}](${memory.filename}) — ${memory.description}`);
      }
      lines.push('');
    }
  }

  let content = lines.join('\n');
  content = truncateEntrypointContent(content);

  await fs.writeFile(path.join(memoryDir, ENTRYPOINT_NAME), content, 'utf-8');
}

export async function deleteMemoryFile(
  memoryDir: string,
  filename: string,
): Promise<void> {
  const filePath = path.join(memoryDir, filename);
  try {
    await fs.unlink(filePath);
  } catch {
    // 文件可能不存在
  }

  await rebuildEntrypoint(memoryDir);
}

export async function appendToEntrypoint(
  memoryDir: string,
  memoryInfo: { filename: string; name: string; description: string; type: string },
): Promise<void> {
  const entrypointPath = path.join(memoryDir, ENTRYPOINT_NAME);

  let content: string;
  try {
    content = await fs.readFile(entrypointPath, 'utf-8');
  } catch {
    content = `# MEMORY.md - 记忆入口索引\n\n`;
  }

  const sectionHeaders: Record<string, string> = {
    user: '## 用户记忆 (user)',
    feedback: '## 反馈记忆 (feedback)',
    project: '## 项目记忆 (project)',
    reference: '## 参考记忆 (reference)',
  };

  const sectionHeader = sectionHeaders[memoryInfo.type] || '## 其他记忆';

  const entryLine = `- [${memoryInfo.name}](${memoryInfo.filename}) — ${memoryInfo.description}`;

  const sections = content.split(/^## /m);

  let updated = false;
  const newSections = sections.map((section) => {
    if (section.trimStart().startsWith(memoryInfo.type) || section.includes(sectionHeader)) {
      if (!section.includes(memoryInfo.filename)) {
        updated = true;
        return section + entryLine + '\n';
      }
    }
    return section;
  });

  let newContent: string;
  if (updated) {
    newContent = sections[0] + newSections.slice(1).map((s) => '## ' + s).join('');
  } else {
    newContent = content.trimEnd() + '\n\n' + sectionHeader + '\n\n' + entryLine + '\n';
  }

  newContent = truncateEntrypointContent(newContent);

  await fs.writeFile(entrypointPath, newContent, 'utf-8');
}
