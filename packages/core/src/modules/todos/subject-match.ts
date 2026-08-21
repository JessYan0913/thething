/**
 * Subject 规范化——用于「标题比对」的提示场景（重复 lint）。
 * trim + 折叠连续空白 + 小写：字面差异但不影响语义的标题能对齐，
 * 让"识别 布局"与"识别布局"视为同一标题。
 *
 * 注意：这是**提示用**的比对，不是去重判定。系统不拦、不小判，
 * 仅用于把「清单里可能已有同标题任务」这件事显性告知给模型。
 */
export function normalizeSubject(subject: string): string {
  return subject.replace(/\s+/g, ' ').trim().toLowerCase();
}