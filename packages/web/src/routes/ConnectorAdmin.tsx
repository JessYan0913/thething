import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

// ============================================================
// 类型定义
// ============================================================

interface ConnectorInfo {
  id: string
  enabled: boolean
  name: string
  version: string
  description: string
  toolCount: number
  inboundEnabled: boolean
  inboundWebhook: string | null
  authType: string
  credentials: Record<string, string>
  customSettings: Record<string, unknown>
  error?: boolean
}

interface ConnectorDetail {
  registryEntry: { id: string; enabled: boolean }
  manifest: any
  config: any
  rawConfigPath: string
  rawManifestPath: string
}

interface ToolInfo {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  executor: string
  timeoutMs?: number
  retryable?: boolean
}

interface CallLog {
  id: string
  timestamp: string
  connectorId: string
  toolName: string
  success: boolean
  durationMs: number
  input: Record<string, unknown>
  error?: string
}

interface Stats {
  totalCalls: number
  successRate: string
  avgDurationMs: number
  byConnector: Record<string, { total: number; success: number; avgMs: number }>
}

// ============================================================
// API 函数
// ============================================================

const API_BASE = '/api/connector/admin'

async function fetchConnectors(): Promise<ConnectorInfo[]> {
  const res = await fetch(`${API_BASE}/connectors`)
  const data = await res.json()
  return data.data?.connectors || []
}

async function fetchConnectorDetail(id: string): Promise<ConnectorDetail | null> {
  const res = await fetch(`${API_BASE}/connectors/${id}`)
  const data = await res.json()
  return data.data || null
}

async function toggleConnector(id: string, enabled: boolean): Promise<void> {
  await fetch(`${API_BASE}/connectors/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

async function testTool(
  connectorId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<{ success: boolean; data?: any; error?: string; timing?: any }> {
  const res = await fetch(`${API_BASE}/test-tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectorId, toolName, input: toolInput }),
  })
  const data = await res.json()
  return data.data || data
}

async function fetchLogs(
  connectorId?: string,
  limit = 50
): Promise<{ logs: CallLog[]; stats: Stats }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (connectorId) params.set('connectorId', connectorId)
  const res = await fetch(`${API_BASE}/logs?${params}`)
  const data = await res.json()
  return data.data || { logs: [], stats: { totalCalls: 0, successRate: '0%', avgDurationMs: 0, byConnector: {} } }
}

// ============================================================
// 组件
// ============================================================

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        enabled
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-800'
      }`}
    >
      {enabled ? '● 运行中' : '○ 已禁用'}
    </span>
  )
}

function AuthTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    none: 'bg-gray-100 text-gray-800',
    api_key: 'bg-blue-100 text-blue-800',
    bearer: 'bg-purple-100 text-purple-800',
    custom: 'bg-orange-100 text-orange-800',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[type] || 'bg-gray-100 text-gray-800'}`}>
      {type}
    </span>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-500 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

// Connector 卡片组件
function ConnectorCard({
  connector,
  onSelect,
  onToggle,
}: {
  connector: ConnectorInfo
  onSelect: () => void
  onToggle: () => void
}) {
  return (
    <div
      className={`bg-white rounded-lg border p-4 hover:shadow-md transition-shadow cursor-pointer ${
        connector.error ? 'border-red-200 bg-red-50' : 'border-gray-200'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-medium text-gray-900 truncate">{connector.name}</h3>
            <StatusBadge enabled={connector.enabled} />
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {connector.id} · v{connector.version}
          </p>
          <p className="text-sm text-gray-600 mt-2 line-clamp-2">{connector.description}</p>
          <div className="flex items-center gap-3 mt-3">
            <AuthTypeBadge type={connector.authType} />
            <span className="text-xs text-gray-400">
              {connector.toolCount} 个工具
            </span>
            {connector.inboundEnabled && (
              <span className="text-xs text-green-600">
                入站 ●
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className={`ml-4 px-3 py-1 text-sm rounded ${
            connector.enabled
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-green-100 text-green-700 hover:bg-green-200'
          }`}
        >
          {connector.enabled ? '禁用' : '启用'}
        </button>
      </div>
    </div>
  )
}

// 工具测试组件
function ToolTester({
  connector,
  onBack,
}: {
  connector: ConnectorInfo
  onBack: () => void
}) {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null)
  const [inputJson, setInputJson] = useState('{}')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingTools, setLoadingTools] = useState(true)

  // 从 API 获取工具列表
  useEffect(() => {
    async function loadTools() {
      setLoadingTools(true)
      try {
        const res = await fetch(`${API_BASE}/connectors/${connector.id}`)
        const data = await res.json()
        const toolList = data.data?.tools || []
        setTools(toolList)
        // 自动选择第一个工具
        if (toolList.length > 0) {
          handleToolSelect(toolList[0])
        }
      } catch (e) {
        console.error('Failed to load tools:', e)
      } finally {
        setLoadingTools(false)
      }
    }
    loadTools()
  }, [connector.id])

  const handleToolSelect = (tool: ToolInfo) => {
    setSelectedTool(tool)
    setResult(null)
    setError(null)

    // 生成默认输入模板
    const properties = tool.inputSchema?.properties || {}
    const defaultInput: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) {
        defaultInput[key] = prop.default
      }
    }
    setInputJson(JSON.stringify(defaultInput, null, 2))
  }

  const handleTest = async () => {
    if (!selectedTool) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const input = JSON.parse(inputJson)
      const res = await testTool(connector.id, selectedTool.name, input)
      setResult(res)
      if (!res.success && res.error) {
        setError(res.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          ← 返回
        </button>
        <h2 className="text-lg font-medium">测试工具 - {connector.name}</h2>
        <div />
      </div>

      {/* 工具选择 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">选择工具</label>
        <div className="space-y-2">
          {loadingTools ? (
            <p className="text-gray-500">加载工具中...</p>
          ) : tools.length === 0 ? (
            <p className="text-gray-500">该 Connector 没有可用工具</p>
          ) : (
            <select
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              value={selectedTool?.name || ''}
              onChange={(e) => {
                const toolName = e.target.value
                const tool = tools.find((t) => t.name === toolName) || null
                if (tool) handleToolSelect(tool)
              }}
            >
              <option value="">选择工具...</option>
              {tools.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.name} - {tool.description?.slice(0, 50)}
                </option>
              ))}
            </select>
          )}
        </div>
        {selectedTool && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium">{selectedTool.name}</h4>
            <p className="text-sm text-gray-600 mt-1">{selectedTool.description}</p>
            <div className="mt-2 text-xs text-gray-500">
              <span>类型: {selectedTool.executor}</span>
              {selectedTool.timeoutMs && (
                <span className="ml-2">超时: {selectedTool.timeoutMs}ms</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 输入 */}
      {selectedTool && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              工具输入 (JSON)
            </label>
            <textarea
              value={inputJson}
              onChange={(e) => setInputJson(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
              rows={6}
              placeholder='{"key": "value"}'
            />
          </div>

          <button
            onClick={handleTest}
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-md px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '测试中...' : '执行测试'}
          </button>

          {/* 结果 */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-medium text-red-800">错误</h4>
              <pre className="text-sm text-red-600 mt-2 overflow-auto">{error}</pre>
            </div>
          )}

          {result && result.success && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h4 className="font-medium text-green-800">成功</h4>
              {result.timing && (
                <p className="text-xs text-green-600 mt-1">
                  耗时: {result.timing.durationMs}ms
                </p>
              )}
              <pre className="text-sm text-green-700 mt-2 overflow-auto max-h-64">
                {JSON.stringify(result.result || result.data, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// 日志查看组件
function LogsViewer() {
  const [logs, setLogs] = useState<CallLog[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterConnector, setFilterConnector] = useState<string>('')

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchLogs(filterConnector || undefined)
      setLogs(data.logs)
      setStats(data.stats)
    } catch (e) {
      console.error('Failed to load logs:', e)
    } finally {
      setLoading(false)
    }
  }, [filterConnector])

  useEffect(() => {
    loadLogs()
    const interval = setInterval(loadLogs, 5000)
    return () => clearInterval(interval)
  }, [loadLogs])

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">调用日志</h2>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500">总调用次数</p>
            <p className="text-2xl font-bold">{stats.totalCalls}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500">成功率</p>
            <p className="text-2xl font-bold">{stats.successRate}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500">平均耗时</p>
            <p className="text-2xl font-bold">{stats.avgDurationMs}ms</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500">Connector 数</p>
            <p className="text-2xl font-bold">{Object.keys(stats.byConnector).length}</p>
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="flex items-center gap-4">
        <select
          className="border border-gray-300 rounded-md px-3 py-2"
          value={filterConnector}
          onChange={(e) => setFilterConnector(e.target.value)}
        >
          <option value="">全部 Connector</option>
        </select>
        <button
          onClick={loadLogs}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          刷新
        </button>
      </div>

      {/* 日志列表 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">时间</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Connector</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">工具</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">状态</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">耗时</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  暂无日志
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-sm">{log.connectorId}</td>
                  <td className="px-4 py-2 text-sm font-mono">{log.toolName}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                        log.success
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {log.success ? '成功' : '失败'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">{log.durationMs}ms</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Webhook 测试组件
function WebhookTester() {
  const [webhookUrl, setWebhookUrl] = useState('')
  const [payload, setPayload] = useState('{"content": "测试消息"}')
  const [response, setResponse] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const handleSend = async () => {
    setLoading(true)
    setResponse(null)

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
      let data
      try {
        data = await res.json()
      } catch {
        data = { raw: await res.text() }
      }
      setResponse({
        status: res.status,
        data,
      })
    } catch (e) {
      setResponse({
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Webhook 测试</h2>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Webhook URL</label>
        <input
          type="text"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2"
          placeholder="https://your-domain.com/api/connector/webhooks/test-service"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">发送内容 (JSON)</label>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
          rows={6}
        />
      </div>

      <button
        onClick={handleSend}
        disabled={loading || !webhookUrl}
        className="w-full bg-blue-600 text-white rounded-md px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '发送中...' : '发送测试请求'}
      </button>

      {response && (
        <div className={`p-4 rounded-lg ${response.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          {response.error ? (
            <>
              <h4 className="font-medium text-red-800">错误</h4>
              <pre className="text-sm text-red-600 mt-2">{response.error}</pre>
            </>
          ) : (
            <>
              <h4 className="font-medium text-green-800">
                响应 ({response.status})
              </h4>
              <pre className="text-sm text-green-700 mt-2 overflow-auto max-h-64">
                {JSON.stringify(response.data, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}

      {/* 快速测试 */}
      <div className="border-t pt-4">
        <p className="text-sm text-gray-500 mb-2">快速测试端点：</p>
        <div className="flex gap-2">
          <button
            onClick={() => setWebhookUrl(`${window.location.origin}/api/connector/webhooks/test-service`)}
            className="text-xs bg-gray-100 px-2 py-1 rounded hover:bg-gray-200"
          >
            本地 Test Service
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 主组件
// ============================================================

export default function ConnectorAdminPage() {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([])
  const [selectedConnector, setSelectedConnector] = useState<ConnectorInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'connectors' | 'tools' | 'logs' | 'webhook'>('connectors')

  const loadConnectors = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchConnectors()
      setConnectors(data)
    } catch (e) {
      console.error('Failed to load connectors:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConnectors()
  }, [loadConnectors])

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    await toggleConnector(id, !currentEnabled)
    await loadConnectors()
    if (selectedConnector?.id === id) {
      const updated = connectors.find((c) => c.id === id)
      setSelectedConnector(updated || null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 头部 */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Connector 管理面</h1>
          <p className="text-sm text-gray-500 mt-1">管理外部系统连接和工具调用</p>
        </div>
      </div>

      {/* 标签页 */}
      <div className="max-w-7xl mx-auto px-4 mt-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-4">
            <TabButton
              active={activeTab === 'connectors'}
              onClick={() => setActiveTab('connectors')}
            >
              Connectors ({connectors.length})
            </TabButton>
            <TabButton
              active={activeTab === 'tools'}
              onClick={() => setActiveTab('tools')}
            >
              工具测试
            </TabButton>
            <TabButton
              active={activeTab === 'logs'}
              onClick={() => setActiveTab('logs')}
            >
              调用日志
            </TabButton>
            <TabButton
              active={activeTab === 'webhook'}
              onClick={() => setActiveTab('webhook')}
            >
              Webhook 测试
            </TabButton>
          </nav>
        </div>

        {/* 内容 */}
        <div className="py-6">
          {activeTab === 'connectors' && (
            <div className="space-y-4">
              {loading ? (
                <div className="text-center py-12 text-gray-500">加载中...</div>
              ) : connectors.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">暂无 Connector</p>
                  <p className="text-sm text-gray-400 mt-1">
                    请在 connectors/ 目录添加配置文件
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {connectors.map((connector) => (
                    <ConnectorCard
                      key={connector.id}
                      connector={connector}
                      onSelect={() => setSelectedConnector(connector)}
                      onToggle={() => handleToggle(connector.id, connector.enabled)}
                    />
                  ))}
                </div>
              )}

              {/* 详情面板 */}
              {selectedConnector && (
                <div className="mt-6 bg-white border border-gray-200 rounded-lg p-6">
                  <ConnectorDetailPanel
                    connector={selectedConnector}
                    onBack={() => setSelectedConnector(null)}
                    onTestTool={() => setActiveTab('tools')}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              {selectedConnector ? (
                <ToolTester
                  connector={selectedConnector}
                  onBack={() => setActiveTab('connectors')}
                />
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">请先选择一个 Connector</p>
                  <button
                    onClick={() => setActiveTab('connectors')}
                    className="mt-2 text-blue-600 hover:text-blue-800"
                  >
                    去选择 →
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <LogsViewer />
            </div>
          )}

          {activeTab === 'webhook' && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <WebhookTester />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Connector 详情面板
function ConnectorDetailPanel({
  connector,
  onBack,
  onTestTool,
}: {
  connector: ConnectorInfo
  onBack: () => void
  onTestTool: () => void
}) {
  const [detail, setDetail] = useState<ConnectorDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const data = await fetchConnectorDetail(connector.id)
      setDetail(data)
      setLoading(false)
    }
    load()
  }, [connector.id])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          ← 返回列表
        </button>
        <button
          onClick={onTestTool}
          className="text-sm bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200"
        >
          测试工具 →
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="text-lg font-medium mb-4">{connector.name}</h3>

          <dl className="space-y-3">
            <div>
              <dt className="text-sm text-gray-500">ID</dt>
              <dd className="text-sm font-mono">{connector.id}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">版本</dt>
              <dd className="text-sm">{connector.version}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">认证方式</dt>
              <dd className="text-sm">
                <AuthTypeBadge type={connector.authType} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">状态</dt>
              <dd className="text-sm">
                <StatusBadge enabled={connector.enabled} />
              </dd>
            </div>
            {connector.inboundEnabled && (
              <div>
                <dt className="text-sm text-gray-500">Webhook</dt>
                <dd className="text-sm font-mono text-blue-600">
                  {connector.inboundWebhook}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">配置信息</h4>

          {loading ? (
            <div className="text-sm text-gray-500">加载中...</div>
          ) : detail ? (
            <div className="space-y-3">
              <div>
                <dt className="text-xs text-gray-400">Manifest 路径</dt>
                <dd className="text-xs font-mono text-gray-600">
                  {detail.rawManifestPath}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Config 路径</dt>
                <dd className="text-xs font-mono text-gray-600">
                  {detail.rawConfigPath}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Credentials</dt>
                <dd className="text-xs font-mono text-gray-600">
                  {Object.keys(connector.credentials).length === 0
                    ? '(无)'
                    : Object.entries(connector.credentials)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ')}
                </dd>
              </div>
              {detail.manifest?.tools && (
                <div>
                  <dt className="text-xs text-gray-400">可用工具</dt>
                  <dd className="text-xs">
                    {detail.manifest.tools.map((t: any) => (
                      <span
                        key={t.name}
                        className="inline-block bg-gray-100 rounded px-1.5 py-0.5 mr-1 mb-1"
                      >
                        {t.name}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-red-500">加载失败</div>
          )}
        </div>
      </div>
    </div>
  )
}
