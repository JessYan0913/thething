import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConnectorRegistry } from '../registry'

describe('ConnectorRegistry loadConnector (Zod validation)', () => {
  let tmpDir: string
  let registry: ConnectorRegistry

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'))
    registry = new ConnectorRegistry(tmpDir)
  })

  afterEach(() => {
    registry.dispose()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeYaml(name: string, content: string): string {
    const filePath = path.join(tmpDir, name)
    fs.writeFileSync(filePath, content, 'utf-8')
    return filePath
  }

  it('loads a valid connector', async () => {
    const filePath = writeYaml('valid.yaml', `
id: my-api
name: My API
tools:
  - name: ping
    description: ping the api
    executor: mock
    executor_config:
      response: { ok: true }
    input_schema:
      type: object
      properties: {}
`)
    await registry.loadConnector(filePath)
    const def = registry.getDefinition('my-api')
    expect(def).toBeDefined()
    expect(def!.enabled).toBe(true)
    expect(def!.tools).toHaveLength(1)
  })

  it('rejects connector with invalid executor type', async () => {
    const filePath = writeYaml('bad-executor.yaml', `
id: bad-api
name: Bad API
tools:
  - name: run
    description: run sql
    executor: sql
    executor_config:
      query: "SELECT 1"
    input_schema:
      type: object
      properties: {}
`)
    await expect(registry.loadConnector(filePath)).rejects.toThrow(/Invalid connector definition/)
    expect(registry.getDefinition('bad-api')).toBeUndefined()
  })

  it('rejects connector missing id', async () => {
    const filePath = writeYaml('no-id.yaml', `
name: No ID
`)
    await expect(registry.loadConnector(filePath)).rejects.toThrow()
  })

  it('rejects connector with malformed inbound config', async () => {
    const filePath = writeYaml('bad-inbound.yaml', `
id: bad-inbound
name: Bad Inbound
inbound:
  enabled: true
`)
    // inbound.protocol 必填
    await expect(registry.loadConnector(filePath)).rejects.toThrow(/Invalid connector definition/)
  })
})
