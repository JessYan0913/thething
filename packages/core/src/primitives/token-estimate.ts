// ============================================================
// 统一的字符级 Token 估算(CJK 校准)
// ============================================================
// 历史上估算系数散落各处且互不一致:tokenizer 用 /2.5、
// lifecycle/budget 用 /3.5、JSON 用 /2。且 /2.5 对中文严重低估
// (中文约 1~1.5 字符/token,会低估近一半)→ 压缩触发过晚。
// 本模块是唯一的字符级估算来源,所有系数集中在此。
// 见 docs/context-compaction-analysis.md #5。

/** 拉丁/ASCII 文本:约 4 字符/token */
const LATIN_CHARS_PER_TOKEN = 4;
/** CJK 文本:约 1.5 字符/token(中文/日文/韩文单字符信息密度高) */
const CJK_CHARS_PER_TOKEN = 1.5;
/** 序列化对象(JSON)结构密集,token 密度更高的修正系数 */
const DENSE_MULTIPLIER = 1.5;

// CJK 统一表意文字 + 扩展 A + 假名 + 谚文 + 兼容区 + 全角形式
// 用显式 \u 转义,避免源码里嵌字面宽字符
const CJK_REGEX =
  /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;

/** 统计字符串中的 CJK 字符数 */
function countCjk(text: string): number {
  const m = text.match(CJK_REGEX);
  return m ? m.length : 0;
}

/** 未取整的字符级 token 估算,按 CJK 占比校准 */
function rawTokensFromChars(text: string): number {
  if (!text) return 0;
  const cjk = countCjk(text);
  const other = text.length - cjk;
  return cjk / CJK_CHARS_PER_TOKEN + other / LATIN_CHARS_PER_TOKEN;
}

/**
 * 字符级 token 估算,按 CJK 占比校准。
 *
 * @param text 待估算文本
 * @param calibration 可选校准系数(见 8.2 usage 反馈校准),默认 1
 */
export function estimateTokensFromChars(text: string, calibration = 1): number {
  return Math.ceil(rawTokensFromChars(text) * calibration);
}

/**
 * 序列化对象的 token 估算(JSON 密集格式,token 密度高于自然文本)。
 *
 * @param obj 待估算对象
 * @param calibration 可选校准系数,默认 1
 */
export function estimateTokensFromObject(obj: unknown, calibration = 1): number {
  let json: string;
  try {
    json = JSON.stringify(obj);
  } catch {
    return 0;
  }
  return Math.ceil(rawTokensFromChars(json) * DENSE_MULTIPLIER * calibration);
}
