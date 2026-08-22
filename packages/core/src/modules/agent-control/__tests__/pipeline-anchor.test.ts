import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentPipeline, type AgentPipelineConfig } from '../pipeline';
import type { PipelineContext } from '../../session/interfaces';
import { estimateRequestBudget } from '../../compaction/request-budget';
import { recordUsageSample } from '../../compaction/tokenizer';

vi.mock('../../compaction/request-budget', () => ({
  estimateRequestBudget: vi.fn(async () => ({
    messagesTokens: 100,
    instructionsTokens: 50,
    toolsTokens: 20,
    tokenizerBuffer: 0,
    totalTokens: 300,
    totalTokensWithBuffer: 300,
    exceedsLimit: false,
    exceedsLimitWithBuffer: false,
    availableBudget: 127700,
    utilizationPercent: 0.2,
    outputReserve: 100,
    modelLimit: 128000,
    triggerTokens: 110000,
    hardLimitTokens: 125000,
    shouldTrigger: false,
    shouldForce: false,
  })),
}));

vi.mock('../../compaction/tokenizer', () => ({
  recordUsageSample: vi.fn(),
  estimateMessagesTokens: vi.fn(async () => 10),
}));

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const todoStore = {
    getRevision: () => 0,
    getTodosByConversation: () => [],
  };
  const compaction = { executed: false, messages: [] };
  return {
    tokenBudget: { recordEstimate: vi.fn(), reportCompaction: vi.fn() } as never,
    costTracker: { reportCompaction: vi.fn() } as never,
    compactionTracker: { tickStep: vi.fn(), recordAttempt: vi.fn(), recordResult: vi.fn() },
    denialTracker: { isThresholdExceeded: () => false, getInjectMessage: () => null },
    contentReplacementState: {} as never,
    toolOutputConfig: {} as never,
    compact: vi.fn(async () => compaction),
    aborted: false,
    turnCount: 1,
    model: 'test-model',
    skillTurnOverride: undefined,
    conversationId: 'conv-1',
    layout: {} as never,
    goalState: null,
    exhaustFlag: undefined,
    lastEstimation: undefined,
    todoStore,
    telemetry: {} as never,
    ...overrides,
  } as PipelineContext;
}

type PrepareStep = ReturnType<typeof createAgentPipeline>;
function makePrepare(
  overrides: Partial<PipelineContext> = {},
  configOverrides: Partial<AgentPipelineConfig> = {},
): PrepareStep {
  const ctx = makeContext(overrides);
  const config: AgentPipelineConfig = {
    sessionState: ctx as never,
    instructions: 'do the thing',
    tools: { read: {} as never },
    resolveModel: (name) => name as never,
    ...configOverrides,
  };
  return createAgentPipeline(config);
}

const step = {
  toolCallId: 'call_1',
  toolName: 'read_file',
  args: { path: '/f1' },
  operation: {
    type: 'tool-result',
    toolCallId: 'call_1',
    output: {},
    input: {},
    state: 'output-available',
    stepNumber: 0,
  },
  usage: { inputTokens: 10000, outputTokens: 500 },
} as never;

describe('pipeline usage-anchor gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops the anchor when compaction just ran — falls back to re-buffering', async () => {
    const prepare = makePrepare({
      compact: vi.fn(async () => ({ executed: true, messages: [], tokensFreed: 40 } as never)),
    });

    await prepare({
      stepNumber: 1,
      messages: [{ role: 'user', content: 'hi' }],
      steps: [step],
    } as never);

    expect(estimateRequestBudget).toHaveBeenCalledTimes(1);
    // 6th arg: anchor → dropped to undefined (compaction 前的 usage 已过期)
    const [, , , , , anchor] = vi.mocked(estimateRequestBudget).mock.calls[0];
    expect(anchor).toBeUndefined();
    // 回退全量重估仍在进行（buffer/rebalance 由真实 estimateRequestBudget 处理，
    // 该行为已在 request-budget.test.ts 覆盖；此处只断言管线把锚点剔除了）
    const est = await vi.mocked(estimateRequestBudget).mock.results[0].value;
    expect(est.totalTokens).toBe(300);
    expect(est.outputReserve).toBe(100);
  });

  it('uses the anchor from previous step usage when nothing compacted', async () => {
    await makePrepare()({ stepNumber: 1, messages: [{ role: 'user', content: 'hi' }], steps: [step] } as never);

    expect(estimateRequestBudget).toHaveBeenCalledTimes(1);
    const [, , , , , anchor] = vi.mocked(estimateRequestBudget).mock.calls[0];
    expect(anchor).toEqual({ inputTokens: 10000, outputTokens: 500 });
    // anchored ⇒ pairing skipped
    expect(recordUsageSample).not.toHaveBeenCalled();
  });

  it('unaligned (compaction-ran) path records the usage pairing sample', async () => {
    // compacted → anchor dropped → pairing runs on previous-step estimation
    await makePrepare({
      compact: vi.fn(async () => ({ executed: true, messages: [], tokensFreed: 40 } as never)),
      lastEstimation: { totalTokens: 300, outputReserve: 100 } as never,
    })({ stepNumber: 1, messages: [{ role: 'user', content: 'hi' }], steps: [step] } as never);

    expect(recordUsageSample).toHaveBeenCalledTimes(1);
    // pairing = (model, lastEstimation.totalTokens − outputReserve, lastStep usage.inputTokens)
    const usage = step as { usage: { inputTokens: number } };
    expect(recordUsageSample).toHaveBeenCalledWith('test-model', 300 - 100, usage.usage.inputTokens);
  });
});