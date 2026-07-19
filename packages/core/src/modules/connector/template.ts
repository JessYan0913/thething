// ============================================================
// Connector 统一模板引擎
// ============================================================
//
// 统一语法（替代之前 4 处独立实现）：
//   {{path.to.value}}        — 字符串插值（解析路径，转为字符串）
//   $path.to.value           — 直引用（保留原始类型，仅作为完整值使用）
//   $json(path.to.value)     — JSON 序列化（字符串包装为 {"text": "..."}）
//   $jsonEscape(path.to.value) — JSON 转义（去掉外层引号）
//   {{timestamp}}            — Unix 毫秒时间戳
//   {{iso_timestamp}}        — ISO 8601 时间字符串
//   {{uuid}}                 — 随机 UUID

export interface TemplateContext {
  input?: Record<string, unknown>
  credentials?: Record<string, string>
  token?: string
  replyAddress?: Record<string, unknown>
  message?: Record<string, unknown>
  [key: string]: unknown
}

export function resolvePath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current == null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, root)
}

function resolveContextPath(ctx: TemplateContext, path: string): unknown {
  const dotIndex = path.indexOf('.')
  if (dotIndex === -1) {
    return ctx[path]
  }
  const root = path.slice(0, dotIndex)
  const rest = path.slice(dotIndex + 1)
  return resolvePath(ctx[root], rest)
}

function stringify(value: unknown): string {
  if (Array.isArray(value) || (value != null && typeof value === 'object')) {
    return JSON.stringify(value)
  }
  return String(value ?? '')
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template
    .replace(/\{\{timestamp\}\}/g, () => String(Date.now()))
    .replace(/\{\{iso_timestamp\}\}/g, () => new Date().toISOString())
    .replace(/\{\{uuid\}\}/g, () => crypto.randomUUID())
    .replace(/\{\{([\w.]+)\}\}/g, (_, path) => stringify(resolveContextPath(ctx, path)))
    // (?!\{) 避免匹配未解析的 ${{ var }} 字面量（var-resolver 语法），防止静默模板损坏
    .replace(/\$\{(?!\{)([^}]+)\}/g, (_, path) => {
      const value = resolveContextPath(ctx, path.trim())
      return value == null ? '' : String(value)
    })
}

export function renderObject(obj: unknown, ctx: TemplateContext): unknown {
  if (typeof obj === 'string') {
    return renderStringValue(obj, ctx)
  }

  if (Array.isArray(obj)) {
    return obj.map(item => renderObject(item, ctx))
  }

  if (obj != null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      const rendered = renderObject(value, ctx)
      if (rendered !== undefined) {
        result[key] = rendered
      }
    }
    return result
  }

  return obj
}

function renderStringValue(value: string, ctx: TemplateContext): unknown {
  const directRef = value.match(/^\$([\w.]+)$/)
  if (directRef) {
    const resolved = resolveContextPath(ctx, directRef[1])
    return resolved !== undefined ? resolved : value
  }

  const jsonMatch = value.match(/^\$json\(([\w.]+)\)$/)
  if (jsonMatch) {
    const resolved = resolveContextPath(ctx, jsonMatch[1])
    if (typeof resolved === 'string') {
      return JSON.stringify({ text: resolved })
    }
    return JSON.stringify(resolved)
  }

  const jsonEscapeMatch = value.match(/^\$jsonEscape\(([\w.]+)\)$/)
  if (jsonEscapeMatch) {
    const resolved = resolveContextPath(ctx, jsonEscapeMatch[1])
    return JSON.stringify(String(resolved ?? '')).slice(1, -1)
  }

  return renderTemplate(value, ctx)
}
