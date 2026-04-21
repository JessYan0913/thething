import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
  getToolOutputConfig,
  matchesToolPrefix,
  getMessageBudgetLimit,
  createContentReplacementState,
  cloneContentReplacementState,
  estimateContentTokens,
  calculateOutputSize,
  TOOL_OUTPUT_CONFIGS,
  setToolOutputOverrides,
  getToolOutputOverrides,
} from '../tool-output-manager'
import {
  generatePreview,
  buildPersistedOutputMessage,
  formatSize,
  getToolResultsDir,
} from '../tool-result-storage'
import {
  estimateToolResultsTotal,
} from '../message-budget'

describe('tool-output-manager', () => {
  describe('配置常量', () => {
    it('应该有合理的默认值', () => {
      expect(DEFAULT_MAX_RESULT_SIZE_CHARS).toBe(50_000)
      expect(MAX_TOOL_RESULT_TOKENS).toBe(100_000)
      expect(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS).toBe(200_000)
      expect(PREVIEW_SIZE_CHARS).toBe(2_000)
    })

    it('应该有合理的工具配置', () => {
      expect(TOOL_OUTPUT_CONFIGS['bash'].maxResultSizeChars).toBe(100_000)
      expect(TOOL_OUTPUT_CONFIGS['read_file'].maxResultSizeChars).toBe(50_000)
      expect(TOOL_OUTPUT_CONFIGS['mcp_default'].maxResultSizeChars).toBe(100_000)
      expect(TOOL_OUTPUT_CONFIGS['connector_default'].maxResultSizeChars).toBe(50_000)
    })
  })

  describe('getToolOutputConfig', () => {
    it('应该返回精确匹配的配置', () => {
      const config = getToolOutputConfig('bash')
      expect(config.maxResultSizeChars).toBe(100_000)
      expect(config.shouldPersistToDisk).toBe(true)
    })

    it('应该返回 read_file 的配置', () => {
      const config = getToolOutputConfig('read_file')
      expect(config.maxResultSizeChars).toBe(50_000)
    })

    it('应该匹配 mcp_ 前缀工具', () => {
      const config = getToolOutputConfig('mcp_some_tool')
      expect(config.maxResultSizeChars).toBe(100_000)
      expect(config.shouldPersistToDisk).toBe(true)
    })

    it('应该匹配 connector_ 前缀工具', () => {
      const config = getToolOutputConfig('connector_digital-twin_get_history_data')
      expect(config.maxResultSizeChars).toBe(50_000)
      expect(config.shouldPersistToDisk).toBe(true)
    })

    it('应该返回默认配置', () => {
      const config = getToolOutputConfig('unknown_tool')
      expect(config.maxResultSizeChars).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS)
    })
  })

  describe('setToolOutputOverrides / getToolOutputOverrides', () => {
    afterEach(() => {
      // 重置配置覆盖
      setToolOutputOverrides({})
    })

    it('应该设置和获取配置覆盖', () => {
      setToolOutputOverrides({
        thresholds: { bash: 30_000 },
        messageBudget: 100_000,
      })
      const overrides = getToolOutputOverrides()
      expect(overrides.thresholds?.bash).toBe(30_000)
      expect(overrides.messageBudget).toBe(100_000)
    })

    it('配置覆盖应该影响 getToolOutputConfig', () => {
      setToolOutputOverrides({
        thresholds: { bash: 30_000 },
      })
      const config = getToolOutputConfig('bash')
      expect(config.maxResultSizeChars).toBe(30_000)
    })

    it('配置覆盖应该影响 getMessageBudgetLimit', () => {
      setToolOutputOverrides({
        messageBudget: 100_000,
      })
      const limit = getMessageBudgetLimit()
      expect(limit).toBe(100_000)
    })

    it('重置配置覆盖应该恢复默认值', () => {
      setToolOutputOverrides({ thresholds: { bash: 30_000 } })
      expect(getToolOutputConfig('bash').maxResultSizeChars).toBe(30_000)

      setToolOutputOverrides({})
      expect(getToolOutputConfig('bash').maxResultSizeChars).toBe(100_000)
    })
  })

  describe('matchesToolPrefix', () => {
    it('应该匹配 mcp_ 前缀', () => {
      expect(matchesToolPrefix('mcp_server_tool')).toBe('mcp')
    })

    it('应该匹配 connector_ 前缀', () => {
      expect(matchesToolPrefix('connector_id_tool')).toBe('connector')
    })

    it('应该返回 null 对于无前缀工具', () => {
      expect(matchesToolPrefix('bash')).toBe(null)
      expect(matchesToolPrefix('read_file')).toBe(null)
    })
  })

  describe('createContentReplacementState', () => {
    it('应该创建空状态', () => {
      const state = createContentReplacementState()
      expect(state.seenIds.size).toBe(0)
      expect(state.replacements.size).toBe(0)
    })
  })

  describe('cloneContentReplacementState', () => {
    it('应该正确克隆状态', () => {
      const original = createContentReplacementState()
      original.seenIds.add('tool-1')
      original.seenIds.add('tool-2')
      original.replacements.set('tool-1', 'preview-1')

      const cloned = cloneContentReplacementState(original)

      expect(cloned.seenIds.size).toBe(2)
      expect(cloned.seenIds.has('tool-1')).toBe(true)
      expect(cloned.replacements.size).toBe(1)
      expect(cloned.replacements.get('tool-1')).toBe('preview-1')

      // 修改克隆不影响原始
      cloned.seenIds.add('tool-3')
      expect(original.seenIds.has('tool-3')).toBe(false)
    })
  })

  describe('estimateContentTokens', () => {
    it('应该估算字符串 Token', () => {
      const tokens = estimateContentTokens('hello world')
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(10)
    })

    it('应该估算空字符串为 0', () => {
      expect(estimateContentTokens('')).toBe(0)
    })
  })

  describe('calculateOutputSize', () => {
    it('应该计算字符串大小', () => {
      expect(calculateOutputSize('hello')).toBe(5)
    })

    it('应该计算对象大小', () => {
      const obj = { key: 'value' }
      const size = calculateOutputSize(obj)
      expect(size).toBeGreaterThan(0)
    })

    it('应该返回 0 对于 null/undefined', () => {
      expect(calculateOutputSize(null)).toBe(0)
      expect(calculateOutputSize(undefined)).toBe(0)
    })
  })
})

describe('tool-result-storage', () => {
  describe('generatePreview', () => {
    it('应该不截断小内容', () => {
      const content = 'hello world'
      const result = generatePreview(content, 100)
      expect(result.preview).toBe(content)
      expect(result.hasMore).toBe(false)
    })

    it('应该在换行边界截断大内容', () => {
      const content = 'line1\nline2\nline3\nline4\nline5'
      const result = generatePreview(content, 10)
      expect(result.hasMore).toBe(true)
      // 预览应该是第一个换行符后的内容（不超过限制）
      expect(result.preview).toContain('line1')
    })

    it('应该处理无换行的大内容', () => {
      const content = 'a'.repeat(100)
      const result = generatePreview(content, 20)
      expect(result.hasMore).toBe(true)
      expect(result.preview.length).toBe(20)
    })
  })

  describe('buildPersistedOutputMessage', () => {
    it('应该构建正确的预览消息', () => {
      const result = {
        filepath: '/path/to/file.txt',
        originalSize: 100_000,
        preview: 'preview content',
        hasMore: true,
      }
      const message = buildPersistedOutputMessage(result)

      expect(message).toContain('<persisted-output>')
      expect(message).toContain('Output too large')
      expect(message).toContain('/path/to/file.txt')
      expect(message).toContain('preview content')
      expect(message).toContain('</persisted-output>')
    })
  })

  describe('formatSize', () => {
    it('应该格式化字节', () => {
      expect(formatSize(500)).toBe('500B')
    })

    it('应该格式化 KB', () => {
      expect(formatSize(1024)).toBe('1.0KB')
      expect(formatSize(5120)).toBe('5.0KB')
    })

    it('应该格式化 MB', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0MB')
    })
  })
})

describe('message-budget', () => {
  describe('estimateToolResultsTotal', () => {
    it('应该估算空消息为 0', () => {
      const result = estimateToolResultsTotal([])
      expect(result.totalChars).toBe(0)
      expect(result.isOverBudget).toBe(false)
    })
  })

  describe('getMessageBudgetLimit', () => {
    it('应该返回默认预算', () => {
      const limit = getMessageBudgetLimit()
      expect(limit).toBe(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS)
    })
  })
})