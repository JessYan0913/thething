/**
 * 文件类型检测工具
 * 根据文件扩展名和 MIME 类型检测文件类别
 */

export type FileType = 'image' | 'pdf' | 'office' | 'html' | 'code' | 'markdown' | 'text' | 'unknown';

// 图片文件扩展名
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
]);

// Office 文件扩展名
const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx',
  '.xls', '.xlsx',
  '.ppt', '.pptx',
  '.odt', '.ods', '.odp',
]);

// 代码文件扩展名
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.java', '.kt', '.scala',
  '.go', '.rs', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.php',
  '.swift', '.m',
  '.sql', '.sh', '.bash', '.zsh',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.css', '.scss', '.less', '.styl',
  '.xml', '.html', '.htm',
  '.vue', '.svelte',
  '.graphql', '.gql',
  '.proto',
  '.dockerfile',
  '.makefile',
  '.cmake',
]);

// Markdown 文件扩展名
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

// 文本文件扩展名
const TEXT_EXTENSIONS = new Set([
  '.txt', '.log', '.diff', '.patch', '.csv', '.tsv',
]);

/**
 * 从文件名提取扩展名
 */
function getExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length > 1) {
    return '.' + parts[parts.length - 1].toLowerCase();
  }
  return '';
}

/**
 * 根据 MIME 类型检测文件类型
 */
function detectByMediaType(mediaType: string): FileType | null {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType === 'application/pdf') return 'pdf';
  if (mediaType === 'text/html') return 'html';
  if (mediaType.startsWith('text/')) return 'text';

  // Office MIME types
  const officeTypes = [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
  ];
  if (officeTypes.includes(mediaType)) return 'office';

  return null;
}

/**
 * 根据文件扩展名检测文件类型
 */
function detectByExtension(ext: string): FileType {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (OFFICE_EXTENSIONS.has(ext)) return 'office';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'unknown';
}

/**
 * 检测文件类型
 * @param filename 文件名
 * @param mediaType MIME 类型（可选）
 * @returns 文件类型
 */
export function detectFileType(filename: string, mediaType?: string): FileType {
  // 优先使用 MIME 类型检测
  if (mediaType) {
    const byMedia = detectByMediaType(mediaType);
    if (byMedia) return byMedia;
  }

  // 回退到扩展名检测
  const ext = getExtension(filename);
  return detectByExtension(ext);
}

/**
 * 获取文件类型的显示标签
 */
export function getFileTypeLabel(type: FileType): string {
  const labels: Record<FileType, string> = {
    image: '图片',
    pdf: 'PDF',
    office: 'Office',
    html: 'HTML',
    code: '代码',
    markdown: 'Markdown',
    text: '文本',
    unknown: '文件',
  };
  return labels[type];
}

/**
 * 检查文件类型是否支持预览
 */
export function isPreviewable(filename: string, mediaType?: string): boolean {
  const type = detectFileType(filename, mediaType);
  return type !== 'unknown';
}
