// ============================================================
// Task Complexity Estimator - 任务复杂度评估器
// ============================================================
// 基于消息内容评估任务复杂度，用于自动选择合适的模型。
//
// 评估维度：
// 1. 消息长度 - 长消息通常意味着复杂任务
// 2. 工具调用数量 - 多工具调用暗示复杂工作流
// 3. 代码/技术内容 - 包含代码片段的任务更复杂
// 4. 多步骤请求 - 包含连接词的任务更复杂
// 5. 文件操作 - 涉及文件读写的任务更复杂

import type { ModelMessage } from 'ai';

export interface ComplexityConfig {
  /** 启用的评估维度 */
  enabledDimensions?: string[];
  /** 自定义权重 */
  weights?: Partial<ComplexityWeights>;
}

export interface ComplexityWeights {
  messageLength: number;
  toolCalls: number;
  codeContent: number;
  multiStep: number;
  fileOperations: number;
}

const DEFAULT_WEIGHTS: ComplexityWeights = {
  messageLength: 0.25,
  toolCalls: 0.20,
  codeContent: 0.25,
  multiStep: 0.15,
  fileOperations: 0.15,
};

/** 多步骤关键词（中英文） */
const MULTI_STEP_KEYWORDS = [
  // 中文
  '然后', '接着', '接下来', '之后', '随后',
  '第一步', '第二步', '首先', '最后',
  '同时', '另外', '此外', '还有',
  // 英文
  'then', 'next', 'after that', 'finally',
  'first', 'second', 'third',
  'also', 'additionally', 'moreover',
];

/** 代码块模式 */
const CODE_PATTERNS = [
  /```[\s\S]*?```/g,           // Markdown 代码块
  /`[^`]+`/g,                  // 行内代码
  /(?:function|class|const|let|var|import|export)\s/g, // 代码关键字
  /[{}();]/g,                  // 代码符号
];

/** 文件操作关键词 */
const FILE_OPERATION_KEYWORDS = [
  // 中文
  '读取文件', '写入文件', '创建文件', '删除文件',
  '打开文件', '保存文件', '修改文件',
  // 英文
  'read file', 'write file', 'create file', 'delete file',
  'open file', 'save file', 'modify file',
  'readme', 'config', 'package.json',
];

/**
 * 从消息中提取文本内容
 */
function extractTextFromMessage(message: ModelMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter((p: { type: string }) => p.type === 'text')
      .map((p: { type: string; text?: string }) => p.text ?? '')
      .join(' ');
  }

  return '';
}

/**
 * 评估消息长度复杂度（0-100）
 */
function evaluateMessageLength(text: string): number {
  // 使用字节长度而非字符长度，因为中文字符更复杂
  const byteLength = new TextEncoder().encode(text).length;

  // 短消息 (< 100字节): 0-20
  if (byteLength < 100) return Math.min(20, byteLength / 5);

  // 中等消息 (100-500字节): 20-50
  if (byteLength < 500) return 20 + ((byteLength - 100) / 400) * 30;

  // 长消息 (500-1500字节): 50-80
  if (byteLength < 1500) return 50 + ((byteLength - 500) / 1000) * 30;

  // 超长消息 (>1500字节): 80-100
  return 80 + Math.min(20, (byteLength - 1500) / 500);
}

/**
 * 评估代码内容复杂度（0-100）
 */
function evaluateCodeContent(text: string): number {
  let matchCount = 0;

  for (const pattern of CODE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      matchCount += matches.length;
    }
  }

  // 根据代码匹配数量评分（更敏感的评分）
  if (matchCount === 0) return 0;
  if (matchCount === 1) return 30;
  if (matchCount === 2) return 50;
  if (matchCount <= 4) return 70;
  if (matchCount <= 8) return 85;

  return 100;
}

/**
 * 评估多步骤请求复杂度（0-100）
 */
function evaluateMultiStep(text: string): number {
  const lowerText = text.toLowerCase();
  let stepCount = 0;

  for (const keyword of MULTI_STEP_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      stepCount++;
    }
  }

  // 根据步骤关键词数量评分（更敏感的评分）
  if (stepCount === 0) return 0;
  if (stepCount === 1) return 40;
  if (stepCount === 2) return 70;
  if (stepCount === 3) return 85;

  return 100;
}

/**
 * 评估文件操作复杂度（0-100）
 */
function evaluateFileOperations(text: string): number {
  const lowerText = text.toLowerCase();
  let operationCount = 0;

  for (const keyword of FILE_OPERATION_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      operationCount++;
    }
  }

  // 检查文件路径模式
  const pathPatterns = [
    /[\/\\][\w.-]+\.[\w]+/g,  // 文件路径
    /\/[\w/]+/g,               // Unix 路径
  ];

  for (const pattern of pathPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      operationCount += matches.length;
    }
  }

  // 根据文件操作数量评分
  if (operationCount === 0) return 0;
  if (operationCount <= 2) return 30;
  if (operationCount <= 4) return 60;
  if (operationCount <= 6) return 80;

  return 100;
}

/**
 * 估算任务复杂度分数
 *
 * @param messages 对话消息历史
 * @param config 复杂度配置
 * @returns 0-100 的复杂度分数
 */
export function estimateTaskComplexity(
  messages: ModelMessage[],
  config?: ComplexityConfig,
): number {
  if (messages.length === 0) return 0;

  // 获取最后一条用户消息
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === 'user');

  if (!lastUserMessage) return 0;

  const text = extractTextFromMessage(lastUserMessage);
  if (!text.trim()) return 0;

  const weights = { ...DEFAULT_WEIGHTS, ...config?.weights };

  // 计算各维度分数
  const lengthScore = evaluateMessageLength(text);
  const codeScore = evaluateCodeContent(text);
  const multiStepScore = evaluateMultiStep(text);
  const fileScore = evaluateFileOperations(text);

  // 工具调用数量评估（基于历史消息）
  const toolCallCount = messages.reduce((count, msg) => {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      return count + msg.content.filter(
        (p: { type: string }) => p.type === 'tool-call'
      ).length;
    }
    return count;
  }, 0);

  const toolCallScore = Math.min(100, toolCallCount * 20);

  // 加权平均
  const totalScore =
    lengthScore * weights.messageLength +
    codeScore * weights.codeContent +
    multiStepScore * weights.multiStep +
    fileScore * weights.fileOperations +
    toolCallScore * weights.toolCalls;

  // 限制在 0-100 范围内
  return Math.max(0, Math.min(100, Math.round(totalScore)));
}

/**
 * 根据复杂度分数获取推荐的模型别名
 *
 * @param complexityScore 复杂度分数
 * @returns 推荐的模型别名 ('fast' | 'default' | 'smart')
 */
export function getRecommendedModel(complexityScore: number): 'fast' | 'default' | 'smart' {
  if (complexityScore < 30) return 'fast';
  if (complexityScore < 70) return 'default';
  return 'smart';
}
