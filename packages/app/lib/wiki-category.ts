// ============================================================
// Wiki category display meta — 分类是自由字符串，这里只维护
// 常见分类的展示样式；未知分类用中性样式兜底渲染。
// ============================================================

export interface WikiCategoryMeta {
  /** 显示名（未知分类直接显示原始字符串） */
  label: string
  /** 图谱节点颜色 */
  hex: string
  /** 图标/文字前景色 */
  text: string
  /** 徽章背景+前景 */
  chip: string
}

const KNOWN_CATEGORIES: Record<string, WikiCategoryMeta> = {
  user: {
    label: "用户",
    hex: "#3b82f6",
    text: "text-blue-500",
    chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  agent: {
    label: "Agent",
    hex: "#a855f7",
    text: "text-purple-500",
    chip: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  project: {
    label: "项目",
    hex: "#f59e0b",
    text: "text-amber-500",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  domain: {
    label: "领域",
    hex: "#22c55e",
    text: "text-green-500",
    chip: "bg-green-500/10 text-green-600 dark:text-green-400",
  },
  entity: {
    label: "实体",
    hex: "#06b6d4",
    text: "text-cyan-500",
    chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
  misc: {
    label: "未分类",
    hex: "#94a3b8",
    text: "text-slate-500",
    chip: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
}

const FALLBACK: Omit<WikiCategoryMeta, "label"> = {
  hex: "#94a3b8",
  text: "text-slate-500",
  chip: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
}

export function getWikiCategoryMeta(category: string): WikiCategoryMeta {
  return KNOWN_CATEGORIES[category] ?? { label: category, ...FALLBACK }
}

/** 从页面实际存在的分类生成筛选列表：已知分类按固定顺序在前，其余按名称排序 */
export function listWikiCategories(categories: Iterable<string>): string[] {
  const present = new Set(categories)
  const known = Object.keys(KNOWN_CATEGORIES).filter(c => present.has(c))
  const unknown = [...present].filter(c => !(c in KNOWN_CATEGORIES)).sort()
  return [...known, ...unknown]
}
