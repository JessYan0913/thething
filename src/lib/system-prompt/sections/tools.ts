import type { ToolDefinition, SystemPromptSection } from '../types';

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Registry of available tools with their descriptions.
 * Tools can be enabled/disabled based on configuration or user preferences.
 */
class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  /**
   * Register default tools provided by the application.
   */
  private registerDefaultTools(): void {
    this.register({
      name: 'web_search',
      description: '搜索互联网获取最新信息。当用户询问实时新闻、当前事件、最新技术动态时使用。',
      enabled: true,
    });

    this.register({
      name: 'calculator',
      description: '执行数学计算，包括算术运算、统计分析等。用于需要精确计算的场景。',
      enabled: true,
    });

    this.register({
      name: 'code_interpreter',
      description: '编写、调试和执行代码。支持多种编程语言。用于编程问题、代码示例等。',
      enabled: true,
    });

    this.register({
      name: 'file_reader',
      description: '读取和分析文件内容。用于文档分析、代码审查等场景。',
      enabled: true,
    });

    this.register({
      name: 'image_understanding',
      description: '理解和分析图像内容。用于图表分析、视觉问题解答等。',
      enabled: true,
    });
  }

  /**
   * Register a new tool.
   */
  register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all enabled tools.
   */
  getEnabled(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((tool) => tool.enabled);
  }

  /**
   * Get all registered tools.
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Enable a tool.
   */
  enable(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = true;
    }
  }

  /**
   * Disable a tool.
   */
  disable(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = false;
    }
  }

  /**
   * Set multiple tools' enabled state.
   */
  setEnabled(names: string[], enabled: boolean): void {
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) {
        tool.enabled = enabled;
      }
    }
  }

  /**
   * Clear all tools (for testing or reset).
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Load tools from a configuration object.
   */
  loadFromConfig(config: Record<string, boolean>): void {
    for (const [name, enabled] of Object.entries(config)) {
      if (this.tools.has(name)) {
        this.tools.get(name)!.enabled = enabled;
      }
    }
  }
}

// Global singleton instance
const globalToolRegistry = new ToolRegistry();

/**
 * Get the global tool registry.
 */
export function getToolRegistry(): ToolRegistry {
  return globalToolRegistry;
}

/**
 * Get all enabled tools as a formatted string for the system prompt.
 */
export function getEnabledToolsDescription(): string {
  const enabledTools = globalToolRegistry.getEnabled();

  if (enabledTools.length === 0) {
    return '当前无可用工具。';
  }

  const toolDescriptions = enabledTools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join('\n');

  return `【可用工具】\n${toolDescriptions}`;
}

/**
 * Creates the tools section for the system prompt.
 */
export function createToolsSection(): SystemPromptSection {
  return {
    name: 'tools',
    content: getEnabledToolsDescription(),
    cacheStrategy: 'session', // Tools change when user changes configuration
    priority: 5,
  };
}

// ============================================================================
// Tool registration helpers
// ============================================================================

/**
 * Register a custom tool.
 */
export function registerTool(definition: ToolDefinition): void {
  globalToolRegistry.register(definition);
}

/**
 * Enable a tool by name.
 */
export function enableTool(name: string): void {
  globalToolRegistry.enable(name);
}

/**
 * Disable a tool by name.
 */
export function disableTool(name: string): void {
  globalToolRegistry.disable(name);
}

/**
 * Get the list of all tool names.
 */
export function getToolNames(): string[] {
  return globalToolRegistry.getAll().map((tool) => tool.name);
}

/**
 * Get the list of enabled tool names.
 */
export function getEnabledToolNames(): string[] {
  return globalToolRegistry.getEnabled().map((tool) => tool.name);
}
