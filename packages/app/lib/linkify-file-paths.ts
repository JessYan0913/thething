/**
 * 检测文本中的文件路径，将可预览的文件类型包装为 markdown 链接
 * 使用 https://preview.local/ URL 标识，由 Streamdown 的自定义 a 组件处理点击
 *
 * 注意：使用 https:// 协议而不是自定义 scheme（如 preview://），因为 Streamdown
 * 内部使用的 rehype-sanitize 只允许标准协议（http:, https:, mailto: 等），
 * 自定义协议会被剥离 href 属性，导致链接无法点击。
 *
 * 如果提供 basePath，相对路径会被转换为绝对路径后再生成预览链接，
 * 避免服务端 API 的 CWD 与 Agent 返回路径的基准目录不一致导致 404。
 */

// 二进制/可预览文件扩展名
const BINARY_EXTS = /\.(?:docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|webp|html|svg)\b/i;

// 匹配可能的文件路径（绝对路径、相对路径、或纯文件名）
// 支持中文字符、连字符、下划线、点号
const FILE_PATH_PATTERN = /([\/~]?[\w一-鿿\-\.\/]+(?:\.[a-zA-Z]{1,10}))/g;

// 匹配已有的 markdown 链接语法 [text](url)
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

// 匹配已有的 preview 链接（用于阻止二次 linkify）
const PREVIEW_LINK = /\[[^\]]*\]\(https:\/\/preview\.local\/[^)]*\)/g;

export const PREVIEW_URL_PREFIX = 'https://preview.local/';

/**
 * 将文本中的可预览文件路径转换为 markdown 链接
 * 格式: [path](https://preview.local/encoded-path)
 * 不会重复处理已经是 markdown 链接的文本
 *
 * @param text 原始文本
 * @param basePath 可选的基础路径（如项目根目录），相对路径会被补全为绝对路径
 * @param knownFiles 可选的已知文件映射 { basename -> fullRelativePath }，
 *                   用于从 tool-glob 输出中解析纯文件名
 */
export function linkifyFilePaths(text: string, basePath?: string, knownFiles?: Record<string, string>): string {
  // 先提取已有的 markdown 链接，用占位符替换，避免二次处理
  const placeholders: string[] = [];
  const protected_ = text.replace(MARKDOWN_LINK, (full) => {
    const idx = placeholders.length;
    placeholders.push(full);
    return `\x00LINK${idx}\x00`;
  });

  // 对非链接部分执行文件路径检测
  const linked = protected_.replace(FILE_PATH_PATTERN, (match) => {
    if (BINARY_EXTS.test(match) && !match.startsWith('<')) {
      // 判断是否是纯文件名（不包含目录分隔符 /）
      const isBareFilename = !match.includes('/');

      // 优先从 knownFiles 中查找纯文件名的完整路径
      if (isBareFilename && knownFiles && knownFiles[match]) {
        const knownPath = knownFiles[match];
        const absolutePath = basePath && !knownPath.startsWith('/')
          ? basePath + '/' + knownPath
          : knownPath;
        const encoded = encodeURIComponent(absolutePath);
        return `[${match}](${PREVIEW_URL_PREFIX}${encoded})`;
      }

      // 如果是相对路径且有 basePath，补全为绝对路径
      const absolutePath = basePath && !match.startsWith('/') && !match.startsWith('~')
        ? basePath + '/' + match
        : match;
      const encoded = encodeURIComponent(absolutePath);
      return `[${match}](${PREVIEW_URL_PREFIX}${encoded})`;
    }
    return match;
  });

  // 还原被保护的 markdown 链接
  const withLinks = linked.replace(/\x00LINK(\d+)\x00/g, (_, idx) => placeholders[Number(idx)]);

  // 剥离预览链接两侧的反引号（内联代码标记），避免 Streamdown 渲染为代码块而非链接
  return withLinks.replace(new RegExp('`(\\[[^\\]]*\\]\\(https:\\/\\/preview\\.local\\/[^)]*\\))`', 'g'), '$1');
}

/**
 * 从预览 URL 中解码文件路径
 * 支持新的 https://preview.local/ 格式和旧的 preview:// 格式（向后兼容）
 */
export function decodePreviewPath(url: string): string | null {
  let path: string | null = null;

  if (url.startsWith(PREVIEW_URL_PREFIX)) {
    path = url.slice(PREVIEW_URL_PREFIX.length);
  } else if (url.startsWith('preview://')) {
    path = url.slice('preview://'.length);
  }

  if (!path) return null;

  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
