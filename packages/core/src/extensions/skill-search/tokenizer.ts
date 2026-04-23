/**
 * 分词器
 *
 * 支持 CJK (中日韩) 和英文分词：
 * - CJK: 双字符切片
 * - 英文: 单词提取 + 停用词过滤 + 词干提取
 */

/**
 * 常用英文停用词
 */
const STOP_WORDS = new Set([
  // 基础停用词
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  // 介词和连接词
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'over', 'again', 'further', 'then', 'once',
  // 代词
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  // 其他常见词
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
  'also', 'now', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'any', 'some', 'no', 'none',
]);

/**
 * CJK 字符检测范围
 *
 * 包含：
 * - U+4E00-U+9FFF: CJK Unified Ideographs (中文)
 * - U+3400-U+4DBF: CJK Unified Ideographs Extension A
 * - U+3040-U+309F: Hiragana (日文平假名)
 * - U+30A0-U+30FF: Katakana (日文片假名)
 * - U+AC00-U+D7AF: Hangul Syllables (韩文)
 */
const CJK_REGEX = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/;

/**
 * 检测是否是 CJK 字符
 *
 * @param ch - 单个字符
 * @returns 是否是 CJK 字符
 */
export function isCjk(ch: string): boolean {
  return CJK_REGEX.test(ch);
}

/**
 * 分词
 *
 * - CJK: 双字符切片 (bigram)
 * - 英文: 单词提取 + 停用词过滤
 *
 * @param text - 输入文本
 * @returns 分词结果数组
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  let i = 0;

  while (i < lower.length) {
    const ch = lower[i];

    if (ch && isCjk(ch)) {
      // CJK: 双字符切片
      let cjkRun = '';
      while (i < lower.length && lower[i] && isCjk(lower[i]!)) {
        cjkRun += lower[i];
        i++;
      }
      // 生成 bigram
      for (let j = 0; j < cjkRun.length - 1; j++) {
        tokens.push(cjkRun.slice(j, j + 2));
      }
      // 如果只有一个 CJK 字符，也保留
      if (cjkRun.length === 1) {
        tokens.push(cjkRun);
      }
    } else if (ch && /[a-z0-9]/.test(ch)) {
      // 英文: 单词提取
      let word = '';
      while (i < lower.length && lower[i] && /[a-z0-9\-_]/.test(lower[i]!)) {
        word += lower[i];
        i++;
      }
      // 清理前后连接符
      const cleaned = word.replace(/^[-_]+|[-_]+$/g, '');
      if (cleaned && !STOP_WORDS.has(cleaned)) {
        tokens.push(cleaned);
      }
    } else {
      // 其他字符：跳过
      i++;
    }
  }

  return tokens;
}

/**
 * 简化词干提取
 *
 * 仅处理常见英文词尾变化：
 * - ing, tion, ness, ment, er, s, ed, ly
 *
 * CJK 字符不进行词干提取。
 *
 * @param word - 输入单词
 * @returns 词干提取后的结果
 */
export function stem(word: string): string {
  if (word.length === 0) return word;

  // CJK 不进行词干提取
  if (isCjk(word[0]!)) return word;

  let s = word;

  // 按优先级处理词尾
  if (s.endsWith('ing') && s.length > 5) {
    s = s.slice(0, -3);
  } else if (s.endsWith('tion') && s.length > 5) {
    s = s.slice(0, -4);
  } else if (s.endsWith('ness') && s.length > 5) {
    s = s.slice(0, -4);
  } else if (s.endsWith('ment') && s.length > 5) {
    s = s.slice(0, -4);
  } else if (s.endsWith('er') && s.length > 4) {
    s = s.slice(0, -2);
  } else if (s.endsWith('ly') && s.length > 4) {
    s = s.slice(0, -2);
  } else if (s.endsWith('ed') && s.length > 4) {
    s = s.slice(0, -2);
  } else if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) {
    s = s.slice(0, -1);
  }

  return s;
}

/**
 * 分词 + 词干提取
 *
 * @param text - 输入文本
 * @returns 处理后的 token 数组
 */
export function tokenizeAndStem(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * 批量分词
 *
 * @param texts - 多个文本
 * @returns 每个 text 的 token 数组
 */
export function tokenizeBatch(texts: string[]): string[][] {
  return texts.map(tokenizeAndStem);
}

/**
 * 合并多个文本的 token
 *
 * @param texts - 多个文本
 * @returns 合并后的唯一 token 数组
 */
export function mergeTokens(texts: string[]): string[] {
  const allTokens = new Set<string>();
  for (const text of texts) {
    for (const token of tokenizeAndStem(text)) {
      allTokens.add(token);
    }
  }
  return Array.from(allTokens);
}