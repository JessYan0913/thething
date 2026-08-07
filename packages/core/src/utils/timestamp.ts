// ============================================================
// timestamp — 时间戳格式化工具
// ============================================================
// formatTimestamp: 将毫秒时间戳格式化为 YYYY-MM-DD HH:mm:ss（本地时区）。
// 说明：使用 Date 的本地时区 getter（getFullYear / getMonth / ...），
// 因此输出反映运行环境的本地时间，而非 UTC。

/**
 * 将毫秒时间戳格式化为 `YYYY-MM-DD HH:mm:ss`（本地时区）。
 *
 * @param ms - 自 Unix 纪元起的毫秒数
 * @returns 形如 `2024-01-05 13:07:09` 的字符串
 */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1); // getMonth() 从 0 开始
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const minute = pad(d.getMinutes());
  const second = pad(d.getSeconds());

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 将 `YYYY-MM-DD HH:mm:ss` 字符串解析为毫秒时间戳（按本地时区）。
 *
 * 与 [[formatTimestamp]] 互为逆运算：
 * `parseTimestamp(formatTimestamp(ms)) === ms`（同环境、同日分秒下成立）。
 *
 * @param s - 形如 `2024-01-05 13:07:09` 的字符串
 * @returns 自 Unix 纪元起的毫秒数
 * @throws 当字符串不符合 `YYYY-MM-DD HH:mm:ss` 格式时抛出错误
 */
export function parseTimestamp(s: string): number {
  const trimmed = s.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
    trimmed,
  );
  if (!match) {
    throw new Error(
      `parseTimestamp: 无效的时间格式 "${s}"，期望 "YYYY-MM-DD HH:mm:ss"`,
    );
  }

  const [, y, mo, d, h, mi, sec] = match.map(Number);
  // 用本地时区分量构造，与 formatTimestamp 的读取方向一致
  return new Date(y, mo - 1, d, h, mi, sec).getTime();
}
