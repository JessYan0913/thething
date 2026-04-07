# Compaction Environment Configuration

## Feature Flags

### Session Memory Compaction

```bash
# Enable Session Memory Compaction
FEATURE_SESSION_MEMORY=true
FEATURE_SM_COMPACT=true

# Or use direct override
ENABLE_SM_COMPACT=true

# Disable Session Memory Compaction
DISABLE_SM_COMPACT=true
```

### Auto Compact

```bash
# Disable all compaction
DISABLE_COMPACT=true

# Disable auto-compact only (manual /compact still works)
DISABLE_AUTO_COMPACT=true

# Custom auto-compact window (override default threshold)
CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000

# Percentage-based trigger (0-100)
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80
```

## Time-Based MicroCompact Configuration

Default values can be overridden via environment variables:

```bash
# Gap threshold in minutes (default: 60)
# Triggers when (now - last assistant message) > threshold
MICRO_COMPACT_GAP_THRESHOLD_MINUTES=60

# Number of recent tool results to keep (default: 5)
MICRO_COMPACT_KEEP_RECENT=5
```

## Token Thresholds

Default values (defined in `types.ts`):

```typescript
COMPACT_TOKEN_THRESHOLD = 25_000
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
```

## Usage Examples

### Enable Session Memory Compaction

```bash
export FEATURE_SESSION_MEMORY=true
export FEATURE_SM_COMPACT=true
```

### Disable All Compaction for Testing

```bash
export DISABLE_COMPACT=true
```

### Set Custom Auto-Compact Threshold

```bash
# Compact at 80% of context window
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80
```