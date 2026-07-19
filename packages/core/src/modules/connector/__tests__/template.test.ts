import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderTemplate, renderObject } from '../template'
import { resolveConnectorVars, resolveEnvRefs } from '../var-resolver'

describe('renderTemplate', () => {
  it('renders {{path}} and ${path} interpolation', () => {
    const ctx = { input: { name: 'alice' }, token: 'tok' }
    expect(renderTemplate('hello {{input.name}}', ctx)).toBe('hello alice')
    expect(renderTemplate('Bearer ${token}', ctx)).toBe('Bearer tok')
  })

  it('does not corrupt unresolved ${{ var }} literals', () => {
    // 未解析的 var-resolver 语法应保留原样，而非被 ${} 正则部分匹配破坏
    const result = renderTemplate('key=${{ missing_var }}&x={{input.x}}', { input: { x: '1' } })
    expect(result).toBe('key=${{ missing_var }}&x=1')
  })

  it('replaces unresolved runtime paths with empty string', () => {
    expect(renderTemplate('v=${input.missing}', { input: {} })).toBe('v=')
  })
})

describe('resolveEnvRefs', () => {
  beforeEach(() => {
    vi.stubEnv('TEST_CONNECTOR_SECRET', 'env-secret-value')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('replaces ${ENV_VAR} with environment values', () => {
    expect(resolveEnvRefs('${TEST_CONNECTOR_SECRET}')).toBe('env-secret-value')
    expect(resolveEnvRefs('prefix-${TEST_CONNECTOR_SECRET}-suffix')).toBe('prefix-env-secret-value-suffix')
  })

  it('keeps unset env vars as literals', () => {
    expect(resolveEnvRefs('${DEFINITELY_NOT_SET_VAR_XYZ}')).toBe('${DEFINITELY_NOT_SET_VAR_XYZ}')
  })

  it('resolves env refs in connector variables end to end', () => {
    const resolved = resolveConnectorVars({
      id: 'test',
      variables: { app_secret: '${TEST_CONNECTOR_SECRET}', plain: 'value' },
      auth: { type: 'bearer', config: { token: '${{ app_secret }}' } },
    })

    expect((resolved.variables as Record<string, string>).app_secret).toBe('env-secret-value')
    const auth = resolved.auth as { config: { token: string } }
    expect(auth.config.token).toBe('env-secret-value')
  })
})

describe('renderObject', () => {
  it('preserves types with $path direct reference', () => {
    const result = renderObject(
      { count: '$input.count', nested: { flag: '$input.flag' } },
      { input: { count: 42, flag: true } },
    )
    expect(result).toEqual({ count: 42, nested: { flag: true } })
  })

  it('serializes with $json()', () => {
    const result = renderObject({ content: '$json(input.text)' }, { input: { text: 'hi' } })
    expect(result).toEqual({ content: '{"text":"hi"}' })
  })
})
