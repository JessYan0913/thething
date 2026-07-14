/**
 * 检测文本中的文件路径，将文件路径包装为可点击的链接
 * 使用 /api/preview?path= 作为链接目标，由前端组件拦截点击并打开预览面板。
 *
 * 如果用户直接点击链接（新标签页/中键），/api/preview 会在 Finder 中显示文件。
 */

// 文件扩展名（所有可能被点击预览的文件）
const PREVIEW_EXTS = /\.(?:docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|webp|svg|html?|tsx?|jsx?|js|mjs|cjs|py|go|rs|java|kt|scala|c|cpp|h|hpp|rb|php|swift|sql|sh|bash|zsh|json|yaml|yml|toml|ini|env|css|scss|less|styl|xml|vue|svelte|graphql|gql|proto|md|mdx|txt|log|diff|patch|csv|tsv)\b/i;

// 匹配可能的文件路径（绝对路径、相对路径、或纯文件名）
// 支持中文字符、连字符、下划线、点号
const FILE_PATH_PATTERN = /([\/~]?[\w一-鿿\-\.\/]+(?:\.[a-zA-Z]{1,10}))/g;

// 匹配已有的 markdown 链接语法 [text](url)
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

export const PREVIEW_URL_PREFIX = '/api/preview?path=';

/**
 * 将文本中的文件路径转换为可点击的链接
 * 格式: [path](/api/preview?path=encoded-path)
 * 不会重复处理已经是 markdown 链接的文本
 *
 * @param text 原始文本
 * @param basePath 可选的基础路径（如项目根目录），相对路径会被补全为绝对路径
 */
export function linkifyFilePaths(text: string, basePath?: string): string {
  // 先提取已有的 markdown 链接，用占位符替换，避免二次处理
  const placeholders: string[] = [];
  const protected_ = text.replace(MARKDOWN_LINK, (full) => {
    const idx = placeholders.length;
    placeholders.push(full);
    return `\x00LINK${idx}\x00`;
  });

  // 对非链接部分执行文件路径检测
  const linked = protected_.replace(FILE_PATH_PATTERN, (match) => {
    if (PREVIEW_EXTS.test(match) && !match.startsWith('<')) {
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
  return linked.replace(/\x00LINK(\d+)\x00/g, (_, idx) => placeholders[Number(idx)]);
}
