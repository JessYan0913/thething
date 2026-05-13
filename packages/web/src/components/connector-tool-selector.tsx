'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { XIcon, ChevronRightIcon, PlayIcon, LoaderIcon } from 'lucide-react'

// ============================================================
// 类型定义
// ============================================================

interface ToolInfo {
  connectorId: string
  connectorName: string
  toolName: string
  toolDescription: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  executor: string
  timeoutMs?: number
  retryable?: boolean
}

interface ToolResult {
  success: boolean
  result?: any
  error?: string
  timing?: {
    durationMs: number
    timestamp: string
  }
}

// ============================================================
// API 函数
// ============================================================

const API_BASE = '/api/connector/admin'

async function fetchConnectorTools(): Promise<{ tools: ToolInfo[] }> {
  const res = await fetch(`${API_BASE}/tools`)
  const data = await res.json()
  return data.data || { tools: [] }
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
      connectorId,
      toolName,
      input: toolInput,
    }),
  })
  const data = await res.json()
  return data.data || data
}

// ============================================================
// Connector 工具选择器组件（嵌入到输入框上方）
// ============================================================

export function ConnectorToolSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null)
  const [inputJson, setInputJson] = useState('{}')
  const [result, setResult] = useState<ToolResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 加载工具列表
  useEffect(() => {
    if (isOpen && tools.length === 0) {
      setLoading(true)
      fetchConnectorTools()
        .then(data => {
          setTools(data.tools)
          // 自动选择第一个工具
          if (data.tools.length > 0) {
            handleToolSelect(data.tools[0])
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [isOpen])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleToolSelect = (tool: ToolInfo) => {
    setSelectedTool(tool)
    setResult(null)
    setError(null)

    // 生成默认输入模板
    const properties = tool.inputSchema.properties || {}
    const defaultInput: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) {
        defaultInput[key] = prop.default
      }
    }
    setInputJson(JSON.stringify(defaultInput, null, 2))
  }

  const handleExecute = async () => {
    if (!selectedTool) return

    setExecuting(true)
    setError(null)
    setResult(null)

    try {
      const input = JSON.parse(inputJson)
      const res = await executeTool(selectedTool.connectorId, selectedTool.toolName, input)
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

  const handleInsertToChat = () => {
    if (!result?.success) return

    // 将结果格式化为可以插入到聊天输入框的文本
    const text = `【Connector 工具执行结果】
Connector: ${selectedTool?.connectorId}
Tool: ${selectedTool?.toolName}
结果: ${JSON.stringify(result.result, null, 2)}`

    // 复制到剪贴板
    navigator.clipboard.writeText(text).then(() => {
      setIsOpen(false)
    })
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* 触发按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-100 text-purple-700 rounded-full hover:bg-purple-200 transition-colors"
        title="Connector 工具"
      >
        <PlayIcon className="w-4 h-4" />
        <span>工具</span>
        {tools.length > 0 && (
          <span className="bg-purple-200 text-purple-800 text-xs px-1.5 py-0.5 rounded-full">
            {tools.length}
          </span>
        )}
      </button>

      {/* 弹出面板 */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 right-0 w-[500px] max-h-[70vh] bg-white rounded-lg shadow-xl border border-gray-200 flex flex-col z-50">
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <h3 className="font-medium">Connector 工具测试</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-200 rounded"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <LoaderIcon className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : tools.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8 text-gray-500">
              暂无 Connector 工具
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex border-b border-gray-200">
                {/* 工具列表 */}
                <div className="w-48 border-r border-gray-200 overflow-y-auto max-h-[50vh]">
                  {tools.map((tool, index) => (
                    <button
                      key={`${tool.connectorId}-${tool.toolName}`}
                      onClick={() => handleToolSelect(tool)}
                      className={`w-full px-3 py-2 text-left border-b border-gray-100 hover:bg-gray-50 ${
                        selectedTool?.toolName === tool.toolName &&
                        selectedTool?.connectorId === tool.connectorId
                          ? 'bg-blue-50 border-l-2 border-l-blue-500'
                          : ''
                      }`}
                    >
                      <div className="font-mono text-xs text-gray-600">
                        {tool.connectorId}
                      </div>
                      <div className="text-sm font-medium truncate">
                        {tool.toolName}
                      </div>
                    </button>
                  ))}
                </div>

                {/* 工具详情和执行 */}
                <div className="flex-1 overflow-y-auto max-h-[50vh]">
                  {selectedTool ? (
                    <div className="p-4 space-y-3">
                      <div>
                        <div className="font-medium text-sm">{selectedTool.toolName}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {selectedTool.toolDescription}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          输入参数 (JSON)
                        </label>
                        <textarea
                          value={inputJson}
                          onChange={(e) => setInputJson(e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono"
                          rows={4}
                        />
                      </div>

                      <button
                        onClick={handleExecute}
                        disabled={executing}
                        className="w-full bg-blue-600 text-white rounded px-3 py-1.5 text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        {executing ? (
                          <>
                            <LoaderIcon className="w-3 h-3 animate-spin" />
                            执行中...
                          </>
                        ) : (
                          <>
                            <PlayIcon className="w-3 h-3" />
                            执行
                          </>
                        )}
                      </button>

                      {error && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
                          {error}
                        </div>
                      )}

                      {result && (
                        <div className={`p-2 rounded text-xs ${
                          result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={result.success ? 'text-green-700' : 'text-red-700'}>
                              {result.success ? '执行成功' : '执行失败'}
                            </span>
                            {result.timing && (
                              <span className="text-gray-500">
                                {result.timing.durationMs}ms
                              </span>
                            )}
                          </div>
                          <pre className={`overflow-auto max-h-32 ${
                            result.success ? 'text-green-700' : 'text-red-700'
                          }`}>
                            {JSON.stringify(result.result || result.error, null, 2)}
                          </pre>
                          {result.success && (
                            <button
                              onClick={handleInsertToChat}
                              className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                            >
                              复制结果到输入框 →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                      选择工具
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
