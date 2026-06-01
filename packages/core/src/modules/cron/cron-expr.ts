const FIELD_RANGES: [number, number][] = [
  [0, 59],  // minute
  [0, 23],  // hour
  [1, 31],  // day of month
  [1, 12],  // month
  [0, 6],   // day of week (0 = Sunday)
]

interface ParsedField {
  values: Set<number>
}

function parseField(field: string, [min, max]: [number, number]): ParsedField {
  const values = new Set<number>()

  for (const part of field.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/)
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1
    const base = stepMatch ? stepMatch[1] : trimmed

    let rangeMin: number
    let rangeMax: number

    if (base === '*') {
      rangeMin = min
      rangeMax = max
    } else {
      const dashMatch = base.match(/^(\d+)-(\d+)$/)
      if (dashMatch) {
        rangeMin = parseInt(dashMatch[1], 10)
        rangeMax = parseInt(dashMatch[2], 10)
      } else {
        const val = parseInt(base, 10)
        if (isNaN(val) || val < min || val > max) {
          throw new Error(`Invalid cron value "${trimmed}" (valid: ${min}-${max})`)
        }
        values.add(val)
        continue
      }
    }

    if (rangeMin < min || rangeMax > max || rangeMin > rangeMax) {
      throw new Error(`Invalid cron range "${trimmed}" (valid: ${min}-${max})`)
    }
    if (step < 1) {
      throw new Error(`Invalid step "${step}"`)
    }

    for (let i = rangeMin; i <= rangeMax; i += step) {
      values.add(i)
    }
  }

  if (values.size === 0) {
    throw new Error(`Empty cron field: "${field}"`)
  }

  return { values }
}

function parseExpression(expression: string): ParsedField[] {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${fields.length}: "${expression}"`)
  }
  return fields.map((f, i) => parseField(f, FIELD_RANGES[i]))
}

export function matches(expression: string, date: Date): boolean {
  const fields = parseExpression(expression)
  const vals = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ]
  return fields.every((field, i) => field.values.has(vals[i]))
}

export function nextOccurrence(expression: string, after: Date): Date {
  const fields = parseExpression(expression)
  const candidate = new Date(after.getTime())
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  // Brute-force scan with a safety cap (2 years ≈ 1_051_200 minutes)
  const maxIterations = 1_051_200
  for (let i = 0; i < maxIterations; i++) {
    const vals = [
      candidate.getMinutes(),
      candidate.getHours(),
      candidate.getDate(),
      candidate.getMonth() + 1,
      candidate.getDay(),
    ]
    if (fields.every((field, j) => field.values.has(vals[j]))) {
      return candidate
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  throw new Error(`No next occurrence found for "${expression}" within 2 years`)
}

export function validate(expression: string): string | null {
  try {
    parseExpression(expression)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
