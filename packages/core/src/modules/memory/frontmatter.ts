// ============================================================
// Frontmatter - 统一的 frontmatter 解析/格式化
// ============================================================
// 从 types.ts 和 memory-scan.ts 中提取，消除重复实现

import type { MemoryType, MemorySource, MemoryFileData } from './types';

/**
 * 类型守卫：检查字符串是否为有效的 MemoryType
 */
export function isMemoryType(type: string): type is MemoryType {
  return ['user', 'feedback', 'project', 'reference'].includes(type);
}

/**
 * 类型守卫：检查字符串是否为有效的 MemorySource
 */
export function isMemorySource(source: string): source is MemorySource {
  return ['explicit', 'inferred', 'promoted'].includes(source);
}

/**
 * 将 MemoryFileData 序列化为 YAML frontmatter 字符串
 */
export function formatMemoryFrontmatter(data: MemoryFileData): string {
  const lines = [
    '---',
    `name: ${data.name}`,
    `description: ${data.description}`,
    `type: ${data.type}`,
  ];
  if (data.source) lines.push(`source: ${data.source}`);
  if (data.confidence != null) lines.push(`confidence: ${data.confidence}`);
  if (data.validUntil != null) lines.push(`validUntil: ${data.validUntil}`);
  if (data.supersededBy) lines.push(`supersededBy: ${data.supersededBy}`);
  if (data.subject) lines.push(`subject: ${data.subject}`);
  if (data.aliases && data.aliases.length > 0) lines.push(`aliases: [${data.aliases.join(', ')}]`);
  if (data.context && data.context.length > 0) lines.push(`context: [${data.context.join(', ')}]`);
  if (data.stability) lines.push(`stability: ${data.stability}`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * 从 .md 文件内容中解析 frontmatter
 * 返回解析后的 MemoryFileData（包含 body content），解析失败返回 null
 */
export function parseMemoryFrontmatter(content: string): MemoryFileData | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const frontmatterStr = frontmatterMatch[1];
  const bodyContent = frontmatterMatch[2].trim();

  const nameMatch = frontmatterStr.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatterStr.match(/^description:\s*(.+)$/m);
  const typeMatch = frontmatterStr.match(/^type:\s*(.+)$/m);
  const sourceMatch = frontmatterStr.match(/^source:\s*(.+)$/m);
  const confidenceMatch = frontmatterStr.match(/^confidence:\s*(.+)$/m);
  const validUntilMatch = frontmatterStr.match(/^validUntil:\s*(.+)$/m);
  const supersededByMatch = frontmatterStr.match(/^supersededBy:\s*(.+)$/m);
  const subjectMatch = frontmatterStr.match(/^subject:\s*(.+)$/m);
  const aliasesMatch = frontmatterStr.match(/^aliases:\s*\[(.+)\]$/m);
  const contextMatch = frontmatterStr.match(/^context:\s*\[(.+)\]$/m);
  const stabilityMatch = frontmatterStr.match(/^stability:\s*(.+)$/m);

  if (!nameMatch || !typeMatch) return null;

  const type = typeMatch[1].trim();
  if (!isMemoryType(type)) return null;

  const source = sourceMatch?.[1].trim();
  const confidence = confidenceMatch ? parseFloat(confidenceMatch[1].trim()) : undefined;
  const validUntil = validUntilMatch?.[1].trim();
  const supersededBy = supersededByMatch?.[1].trim();

  return {
    name: nameMatch[1].trim(),
    description: descMatch?.[1].trim() || '',
    type,
    content: bodyContent,
    source: source && isMemorySource(source) ? source : undefined,
    confidence: confidence != null && !isNaN(confidence) ? confidence : undefined,
    validUntil: validUntil ? Number(validUntil) : undefined,
    supersededBy: supersededBy && supersededBy !== 'null' ? supersededBy : undefined,
    subject: subjectMatch?.[1]?.trim() || undefined,
    aliases: aliasesMatch?.[1]?.split(',').map(s => s.trim()).filter(Boolean) || undefined,
    context: contextMatch?.[1]?.split(',').map(s => s.trim()).filter(Boolean) || undefined,
    stability: stabilityMatch?.[1]?.trim() as 'identity' | 'state' | 'pattern' | undefined,
  };
}

/**
 * 从 .md 文件内容中解析 frontmatter 为简单的 key-value 对
 * 用于 API 路由等需要原始字段的场景
 */
export function parseFrontmatterRaw(content: string): { data: Record<string, string>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const raw = match[1];
  const body = match[2].trim();
  const data: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const sep = line.indexOf(':');
    if (sep > 0) {
      data[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
    }
  }

  return { data, body };
}
