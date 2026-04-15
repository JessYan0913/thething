import { getDb } from '../db'
import { nanoid } from 'nanoid'
import type { McpServerConfig } from './registry'

interface McpServerRow {
  id: string
  name: string
  transport_type: string
  url: string | null
  headers: string | null
  command: string | null
  args: string | null
  env: string | null
  tools_include: string | null
  tools_exclude: string | null
  enabled: number
  created_at: string
  updated_at: string
}

function rowToConfig(row: McpServerRow): McpServerConfig {
  const config: McpServerConfig = {
    name: row.name,
    enabled: row.enabled === 1,
    transport: undefined as any,
  }

  if (row.transport_type === 'sse') {
    config.transport = {
      type: 'sse',
      url: row.url ?? '',
      ...(row.headers ? { headers: JSON.parse(row.headers) } : {}),
    }
  } else if (row.transport_type === 'http') {
    config.transport = {
      type: 'http',
      url: row.url ?? '',
      ...(row.headers ? { headers: JSON.parse(row.headers) } : {}),
    }
  } else if (row.transport_type === 'stdio') {
    config.transport = {
      type: 'stdio',
      command: row.command ?? '',
      ...(row.args ? { args: JSON.parse(row.args) } : {}),
      ...(row.env ? { env: JSON.parse(row.env) } : {}),
    }
  }

  if (row.tools_include || row.tools_exclude) {
    config.tools = {
      ...(row.tools_include ? { include: JSON.parse(row.tools_include) } : {}),
      ...(row.tools_exclude ? { exclude: JSON.parse(row.tools_exclude) } : {}),
    }
  }

  return config
}

export function getMcpServerConfigs(): McpServerConfig[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC').all() as McpServerRow[]
  return rows.map(rowToConfig)
}

export function getMcpServerConfig(name: string): McpServerConfig | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(name) as McpServerRow | undefined
  return row ? rowToConfig(row) : null
}

export function addMcpServerConfig(config: McpServerConfig): McpServerConfig {
  const db = getDb()
  const id = nanoid()

  const transportType = config.transport.type
  const url = config.transport.type === 'sse' || config.transport.type === 'http'
    ? config.transport.url : null
  const headers = config.transport.type === 'sse' || config.transport.type === 'http'
    ? (config.transport as { headers?: Record<string, string> }).headers
      ? JSON.stringify((config.transport as { headers?: Record<string, string> }).headers) : null
    : null
  const command = config.transport.type === 'stdio' ? config.transport.command : null
  const args = config.transport.type === 'stdio' && config.transport.args
    ? JSON.stringify(config.transport.args) : null
  const env = config.transport.type === 'stdio' && config.transport.env
    ? JSON.stringify(config.transport.env) : null
  const enabled = config.enabled ? 1 : 0
  const toolsInclude = config.tools?.include ? JSON.stringify(config.tools.include) : null
  const toolsExclude = config.tools?.exclude ? JSON.stringify(config.tools.exclude) : null

  db.prepare(`
    INSERT INTO mcp_servers (id, name, transport_type, url, headers, command, args, env, tools_include, tools_exclude, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, config.name, transportType, url, headers, command, args, env, toolsInclude, toolsExclude, enabled)

  return getMcpServerConfig(config.name)!
}

export function updateMcpServerConfig(name: string, updates: Partial<McpServerConfig>): McpServerConfig | null {
  const existing = getMcpServerConfig(name)
  if (!existing) return null

  const merged: McpServerConfig = {
    ...existing,
    ...updates,
    transport: updates.transport ?? existing.transport,
  }

  const transportType = merged.transport.type
  const url = merged.transport.type === 'sse' || merged.transport.type === 'http'
    ? merged.transport.url : null
  const headers = merged.transport.type === 'sse' || merged.transport.type === 'http'
    ? (merged.transport as { headers?: Record<string, string> }).headers
      ? JSON.stringify((merged.transport as { headers?: Record<string, string> }).headers) : null
    : null
  const command = merged.transport.type === 'stdio' ? merged.transport.command : null
  const args = merged.transport.type === 'stdio' && merged.transport.args
    ? JSON.stringify(merged.transport.args) : null
  const env = merged.transport.type === 'stdio' && merged.transport.env
    ? JSON.stringify(merged.transport.env) : null
  const enabled = merged.enabled ? 1 : 0
  const toolsInclude = merged.tools?.include ? JSON.stringify(merged.tools.include) : null
  const toolsExclude = merged.tools?.exclude ? JSON.stringify(merged.tools.exclude) : null

  const db = getDb()
  db.prepare(`
    UPDATE mcp_servers
    SET transport_type = ?, url = ?, headers = ?, command = ?, args = ?, env = ?, tools_include = ?, tools_exclude = ?, enabled = ?, updated_at = datetime('now')
    WHERE name = ?
  `).run(transportType, url, headers, command, args, env, toolsInclude, toolsExclude, enabled, name)

  return getMcpServerConfig(name)
}

export function deleteMcpServerConfig(name: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM mcp_servers WHERE name = ?').run(name)
  return result.changes > 0
}