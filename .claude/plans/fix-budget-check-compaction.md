# Fix: Budget Check Should Use Full Compaction Pipeline

## Problem

`checkInitialBudget` only applies Layer 2 compression and tool filtering. When these fail with a long conversation history, it throws an error instead of applying the emergency compression layers (2.5, 3, and fallback truncation) that exist in `compactBeforeStep`.

Error seen:
```
上下文超限(421066 tokens > 128000 窗口上限),已尝试 Layer 2: freed 396712 tokens。请减少本轮消息量或开始新会话。
```

## Root Cause

`budget-check.ts:checkInitialBudget` implements its own limited compression:
- Line 56-68: Layer 2 (lifecycle with `keepRecentSteps=1`)
- Line 72-84: Tool filtering
- Line 86-96: Give up and return failure

Meanwhile, `compaction/index.ts:compactBeforeStep` has the full pipeline:
- Layer 2 → Layer 2.5 → Layer 3 → Fallback truncation

These two code paths diverged.

## Solution

Make `checkInitialBudget` use the full emergency compression pipeline when Layer 2 fails:

### Strategy 1: Apply emergency compression to messages (RECOMMENDED)

After Layer 2 fails, instead of giving up, call the emergency compression function:

```typescript
// In budget-check.ts after Layer 2
if (currentEstimation.exceedsLimit) {
  // Try emergency compression (Layer 2.5 → 3 → truncation)
  const compressed = await applyEmergencyCompression(currentMessages, {
    model: context.model,
    fallbackModels: context.fallbackModels,
    modelName,
    contextLimit,
    tools: currentTools,
    instructions,
    targetTokens: currentEstimation.modelLimit * 0.8,
  });
  currentMessages = compressed;
  actions.push(`Emergency compression applied`);
  // Re-estimate
  currentEstimation = await estimateFullRequest(...);
}
```

Need to export `applyEmergencyCompression` from `compaction/index.ts` (currently it's private).

### Strategy 2: Just call compactBeforeStep

Simpler alternative - replace the Layer 2 logic with a call to `compactBeforeStep`:

```typescript
if (currentEstimation.exceedsLimit) {
  currentMessages = await compactBeforeStep(currentMessages, config, {
    model: context.model,
    fallbackModels: context.fallbackModels,
    modelName,
    conversationId: context.conversationId,
    dataStore: context.dataStore,
    contextLimit,
    tools: currentTools,
    instructions,
  });
  actions.push(`Applied full compaction pipeline`);
}
```

## Implementation Plan

1. Export `applyEmergencyCompression` from `compaction/index.ts`
2. Modify `checkInitialBudget` in `budget-check.ts`:
   - After Layer 2, check if still exceeds
   - If yes, call emergency compression
   - Update actions log
   - Re-estimate and check again
3. Tool filtering should remain as fallback if message compression isn't enough

## Expected Outcome

Instead of throwing an error, the system will:
1. Try Layer 2 (tool output compression)
2. Try Layer 2.5 (deterministic message compression)
3. Try Layer 3 (LLM summary)
4. Fall back to truncation (guaranteed to work)

This matches the documented architecture in `context-compaction-architecture.md`.
