'use client'

import { useState, useEffect, useCallback } from 'react'

// ============================================================
// 类型定义
// ============================================================

interface ToolInfo {
  connector_id: string
  connector_name: string
  tool_name: string
  tool_description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  executor: string
  timeout_ms?: number
  retryable?: boolean
}

interface ConnectorInfo {
  id: string
  name: string
  enabled: boolean
  tool_count: number
}

interface ToolResult {
  success: boolean
  result?: any
  error?: string
  timing?: {
    duration_ms: number
    timestamp: string
  }
}

// ============================================================
// API 函数
// ============================================================

const API_BASE = '/api/connector/admin'

async function fetchConnectorTools(): Promise<{ tools: ToolInfo[]; connectors: ConnectorInfo[] }> {
  const res = await fetch(`${API_BASE}/tools`)
  const data = await res.json()
  return data.data || { tools: [], connectors: [] }
}

async function executeTool(
  connectorId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  const res = await fetch(`${API_BASE}/test-tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connector_id: connectorId,
      tool_name: toolName,
      tool_input: toolInput,
    }),
  })
  const data = await res.json()
  return data.data || data
}

// ============================================================
// Connector 工具面板组件
// ============================================================

export function ConnectorToolPanel() {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedConnector, setExpandedConnector] = useState<string | null>(null)
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null)
  const [inputJson, setInputJson] = useState('{}')
  const [result, setResult] = useState<ToolResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTools = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchConnectorTools()
      setTools(data.tools)
      setConnectors(data.connectors)
    } catch (e) {
      console.error('Failed to load tools:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTools()
  }, [loadTools])

  const handleExecute = async () => {
    if (!selectedTool) return

    setExecuting(true)
    setError(null)
    setResult(null)

    try {
      const input = JSON.parse(inputJson)
      const res = await executeTool(selectedTool.connector_id, selectedTool.tool_name, input)
      setResult(res)
      if (!res.success && res.error) {
        setError(res.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON')
    } finally {
      setExecuting(false)
    }
  }

  const handleToolSelect = (tool: ToolInfo) => {
    setSelectedTool(tool)
    setResult(null)
    setError(null)

    // 生成默认输入模板
    const properties = tool.input_schema.properties || {}
    const defaultInput: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) {
        defaultInput[key] = prop.default
      }
    }
    setInputJson(JSON.stringify(defaultInput, null, 2))
  }

  // 按 connector 分组工具
  const toolsByConnector = tools.reduce((acc, tool) => {
    if (!acc[tool.connector_id]) {
      acc[tool.connector_id] = []
    }
    acc[tool.connector_id].push(tool)
    return acc
  }, {} as Record<string, ToolInfo[]>)

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">加载 Connector 工具...</div>
      </div>
    )
  }

  if (tools.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-500 mb-2">暂无 Connector 工具</div>
        <div className="text-sm text-gray-400">
          请在 connectors/ 目录添加配置文件
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 左侧：工具列表 */}
      <div className="w-64 border-r border-gray-200 overflow-y-auto">
        <div className="p-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-medium text-sm">Connector 工具</h3>
          <p className="text-xs text-gray-500 mt-1">
            {connectors.length} 个 Connector，{tools.length} 个工具
          </p>
        </div>

        <div className="divide-y divide-gray-100">
          {Object.entries(toolsByConnector).map(([connectorId, connectorTools]) => {
            const connector = connectors.find(c => c.id === connectorId)
            const isExpanded = expandedConnector === connectorId

            return (
              <div key={connectorId}>
                <button
                  onClick={() => setExpandedConnector(isExpanded ? null : connectorId)}
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50"
                >
                  <span className="font-medium text-sm">{connector?.name || connectorId}</span>
                  <span className="text-xs text-gray-400">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </button>

                {isExpanded && (
                  <div className="bg-gray-50">
                    {connectorTools.map(tool => (
                      <button
                        key={tool.tool_name}
                        onClick={() => handleToolSelect(tool)}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 ${
                          selectedTool?.tool_name === tool.tool_name && 
                          selectedTool?.connector_id === tool.connector_id
                            ? 'bg-blue-50 text-blue-700'
                            : ''
                        }`}
                      >
                        <div className="font-mono text-xs">{tool.tool_name}</div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">
                          {tool.tool_description.slice(0, 40)}...
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 右侧：工具详情和执行 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedTool ? (
          <>
            {/* 工具信息 */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-sm bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                  {selectedTool.connector_id}/{selectedTool.tool_name}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  selectedTool.retryable 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {selectedTool.retryable ? '可重试' : '不可重试'}
                </span>
              </div>
              <p className="text-sm text-gray-600">{selectedTool.tool_description}</p>
              <div className="text-xs text-gray-400 mt-1">
                类型: {selectedTool.executor}
                {selectedTool.timeout_ms && ` · 超时: ${selectedTool.timeout_ms}ms`}
              </div>
            </div>

            {/* 输入 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  输入参数 (JSON)
                </label>
                <textarea
                  value={inputJson}
                  onChange={(e) => setInputJson(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                  rows={8}
                  placeholder='{"key": "value"}'
                />
              </div>

              <button
                onClick={handleExecute}
                disabled={executing}
                className="w-full bg-blue-600 text-white rounded-md px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
              >
                {executing ? '执行中...' : '执行工具'}
              </button>

              {/* 错误 */}
              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h4 className="font-medium text-red-800 text-sm">错误</h4>
                  <pre className="text-sm text-red-600 mt-2 overflow-auto">{error}</pre>
                </div>
              )}

              {/* 结果 */}
              {result && result.success && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-green-800 text-sm">执行成功</h4>
                    {result.timing && (
                      <span className="text-xs text-green-600">
                        耗时: {result.timing.duration_ms}ms
                      </span>
                    )}
                  </div>
                  <pre className="text-sm text-green-700 overflow-auto max-h-64">
                    {JSON.stringify(result.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            选择左侧工具开始测试
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 独立的工具执行函数（供其他地方调用）
// ============================================================

export async function executeConnectorTool(
  connectorId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  return executeTool(connectorId, toolName, toolInput)
}

export async function getConnectorToolsList(): Promise<{ tools: ToolInfo[]; connectors: ConnectorInfo[] }> {
  return fetchConnectorTools()
}
