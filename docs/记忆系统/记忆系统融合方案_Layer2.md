# 记忆系统融合方案：Layer 2 信任层

## 背景

当前记忆系统（Layer 1 基础层）已实现：Markdown 文件存储、四类分类（user/feedback/project/reference）、新鲜度追踪、召回频率统计。

v3 设计框架提出了完整的认知架构：三层分类、两轴置信度、关联图、冷却池、双信号调度、被动验证晋升。

**本方案目标：** 取 v3 中解决核心问题的机制，融入当前实现，以最小代价获得最大提升。

---

## 核心问题分析

Agent 记忆系统的三个主要失败模式：

| 失败模式 | 表现 | 根因 |
|---------|------|------|
| 噪音污染 | 系统自动归纳的猜测被当作事实使用 | 显式/隐式记忆无区分 |
| 逆向干扰 | 旧信息和新信息权重相同 | 无置信度和时效性管理 |
| 黑箱不可信 | 管理员无法判断哪些记忆有用 | 无来源追溯和使用统计展示 |

**关键洞察：** 给每条记忆标注「来源可靠性」和「时效性」两个分数，让检索和展示都消费这两个分数，可以同时解决以上三个问题。

---

## 架构分层

```
┌─────────────────────────────────────────────┐
│          Layer 3: 智能层（后续阶段）           │
│   关联图 · 冷却池 · 离线处理 · 被动验证       │
├─────────────────────────────────────────────┤
│          Layer 2: 信任层（本方案）             │
│   两轴置信度 · 显隐分离 · 晋升机制 · UI 增强  │
├─────────────────────────────────────────────┤
│          Layer 1: 基础层（已实现）             │
│   Markdown存储 · 四类分类 · 新鲜度 · 召回追踪  │
└─────────────────────────────────────────────┘
```

**本次只实施 Layer 2。** 它是整个系统的信任基石，也是用户感知提升最大的一层。

---

## 一、数据模型扩展

### 1.1 Frontmatter Schema（向后兼容）

```yaml
---
name: 用户偏好简洁代码
description: 用户明确表示喜欢简洁的代码风格
type: feedback

# === Layer 2 新增字段 ===
source: explicit              # explicit | inferred | promoted
confidence: 0.95              # 可靠性轴 (0-1)
validUntil: null              # 时效性轴（时间戳或 null 表示永久有效）
supersededBy: null            # 被哪条新记忆替代（filePath）
---

用户多次提到喜欢简洁代码，不喜欢过度抽象...
```

### 1.2 字段定义

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `source` | enum | `explicit` | 记忆来源：`explicit`=用户显式要求 / `inferred`=系统自动归纳 / `promoted`=从 inferred 晋升 |
| `confidence` | float | `0.8` | 可靠性分数 (0-1)。写入时根据 source 设定初始值 |
| `validUntil` | timestamp \| null | `null` | 过期时间戳。null 表示不过期 |
| `supersededBy` | string \| null | `null` | 替代它的新记忆的 filePath |

### 1.3 各来源的初始置信度

| source | 初始 confidence | 依据 |
|--------|----------------|------|
| `explicit` | 0.9 | 用户明确说过，可靠性最高 |
| `inferred` | 0.3 | 系统自动归纳，噪音率高 |
| `promoted` | 0.6 | 经过验证的归纳，中等可靠 |

### 1.4 旧数据兼容策略

现有文件没有 Layer 2 字段时，API 读取时自动 fallback：

```typescript
function applyDefaults(entry: ScannedMemo): ScannedMemo {
  return {
    ...entry,
    source: entry.source ?? 'explicit',      // 旧记忆假设为手动创建
    confidence: entry.confidence ?? 0.8,
    validUntil: entry.validUntil ?? null,
    supersededBy: entry.supersededBy ?? null,
  }
}
```

---

## 二、写入路径分离

### 2.1 三条写入路径

```
路径 1: 显式写入
  触发: 用户主动说"记住 X"，或通过 UI 手动创建
  写入: source=explicit, confidence=0.9
  特点: 直接写入，立即可召回，不经过验证

路径 2: 隐式写入
  触发: LLM 从对话中自动提取（extractMemoriesFromConversation）
  写入: source=inferred, confidence=0.3
  特点: 写入后低优先级召回，等待被动验证

路径 3: 晋升写入
  触发: inferred 记忆满足晋升条件（见第五节）
  写入: source=promoted, confidence=0.6
  特点: 从 inferred 升级，可靠性中等
```

### 2.2 API 变更

**POST /api/memory**（创建）：

```typescript
// 请求体新增字段
interface CreateMemoryRequest {
  name: string
  description?: string
  type: MemoryType
  content: string
  userId: string
  source?: 'explicit' | 'inferred'    // 新增，默认 'explicit'
}
```

**PUT /api/memory**（编辑）：

```typescript
// 请求体新增字段
interface UpdateMemoryRequest {
  filePath: string
  name: string
  description?: string
  type: MemoryType
  content: string
  // 用户编辑时自动：confidence = 0.9（用户确认过，可靠性提升）
}
```

### 2.3 用户编辑的特殊效应

当用户主动编辑一条记忆时：
- `confidence` 重置为 0.9（用户确认了内容，可靠性最高）
- `source` 保持不变（保留来源追溯）
- `validUntil` 重置为 null（内容已更新，重新计时）

这对应 v3 框架第九部分的「用户编辑 = 最高优先级写入路径」。

---

## 三、检索重排

### 3.1 三阶段检索

```
Stage 1: 关键词匹配（现有逻辑不变）
  输入: 用户查询
  输出: 候选集 + matchScore

Stage 2: 置信度加权
  finalScore = matchScore × confidence × recencyWeight
  按 finalScore 降序排列

Stage 3: 类型感知截断
  确保至少 30% 的召回槽位留给 explicit 记忆
  剩余槽位按 finalScore 分配
```

### 3.2 recencyWeight 计算

```typescript
function computeRecencyWeight(lastRecalledAt: number): number {
  const DAY_MS = 86400000
  const daysSinceAccess = (Date.now() - lastRecalledAt) / DAY_MS
  return Math.max(0.2, 1.0 - daysSinceAccess * 0.02)
  // 50 天未召回 → 权重降到 0.2（下限）
  // 100 天未召回 → 仍然是 0.2（不会完全消失）
}
```

### 3.3 关键设计决策

**explicit 记忆不随时间衰减 confidence。**

理由：用户明确说过的话，不会因为时间久而变成假的。时间衰减只作用于 inferred 记忆——因为系统归纳的结论可能随时间失效。

```
explicit 记忆: finalScore = matchScore × 0.9 × recencyWeight
inferred 记忆: finalScore = matchScore × 0.3 × recencyWeight
promoted 记忆: finalScore = matchScore × 0.6 × recencyWeight
```

### 3.4 检索实现变更

修改 `findRelevantMemories` 函数：

```typescript
// 修改前
result.score = tokenMatchScore(matchTokens, memory)

// 修改后
const baseScore = tokenMatchScore(matchTokens, memory)
const confidence = memory.confidence ?? 0.8
const recencyWeight = computeRecencyWeight(memory.lastRecalledAt ?? memory.mtimeMs)
result.score = baseScore * confidence * recencyWeight
```

---

## 四、遗忘机制

### 4.1 四级状态

| 状态 | 条件 | 召回行为 | UI 表现 |
|------|------|---------|--------|
| 活跃 | `confidence ≥ 0.5` 且 30 天内有召回 | 正常召回 | 正常显示 |
| 休眠 | `confidence < 0.5` 或 30 天未召回 | 降低召回权重（×0.3） | 灰色标记 |
| 待归档 | 休眠超过 90 天 | 不主动召回 | 黄色警告 |
| 归档 | 用户确认过期 | 移出召回池 | 仅搜索可见 |

### 4.2 状态转换

```
活跃 → 休眠: confidence < 0.5 或 30 天未召回
休眠 → 活跃: 被用户召回且未否定（confidence 恢复）
休眠 → 待归档: 持续休眠超过 90 天
待归档 → 归档: 用户确认
待归档 → 活跃: 用户确认仍有效
```

### 4.3 实现方式

**不做复杂的后台任务。** 利用现有的 `mtimeMs` 和 `lastRecalledAt`，在检索时动态计算状态：

```typescript
function getMemoryStatus(entry: MemoryEntry): 'active' | 'dormant' | 'pending_archive' {
  const DAY_MS = 86400000
  const daysSinceAccess = (Date.now() - (entry.lastRecalledAt ?? entry.mtimeMs)) / DAY_MS

  if (entry.confidence < 0.5 || daysSinceAccess > 30) {
    if (daysSinceAccess > 90) return 'pending_archive'
    return 'dormant'
  }
  return 'active'
}
```

---

## 五、晋升机制

### 5.1 晋升条件

一条 `inferred` 记忆满足以下条件时自动晋升为 `promoted`：

| 条件 | 阈值 | 说明 |
|------|------|------|
| 召回次数 | `recallCount ≥ 3` | 被多次需要，说明有价值 |
| 未被纠正 | 近 5 次召回无否定信号 | 内容仍然准确 |
| 年龄 | 创建超过 7 天 | 经过足够时间检验 |

### 5.2 晋升动作

```typescript
function promoteMemory(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    source: 'promoted',
    confidence: 0.6,
  }
}
```

### 5.3 晋升通知（可选）

晋升时可选通知用户：

> 基于最近的互动，我注意到「用户偏好简洁代码」——如果不准确可以告诉我。

**设计原则：** 非阻塞、可忽略，不打断主流程。

### 5.4 用户纠正的惩罚

如果用户在晋升通知中否定了记忆内容：

```typescript
// 强负向信号
entry.confidence = Math.max(0.1, entry.confidence - 0.4)
```

大幅度下调（0.4），因为用户主动纠正包含的信息量远大于被动忽略。

---

## 六、UI 增强

### 6.1 记忆列表（中栏）

每个列表项新增：

```
[图标] 用户偏好简洁代码
       feedback · explicit · 0.9 · 2天前
       用户明确表示喜欢简洁的代码风格
```

- `explicit/inferred/promoted`：来源标签，颜色区分
- `0.9`：置信度分数
- `2天前`：新鲜度（现有功能）

### 6.2 详情面板（右栏）

头部新增元数据区：

```
用户偏好简洁代码
[feedback] [explicit] @user1
来源: 用户显式声明 · 可靠性: 0.95 · 最后召回: 2天前 · 召回次数: 5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
用户多次提到喜欢简洁代码...
```

### 6.3 筛选功能

类型筛选新增来源维度：

```
[全部] [用户] [反馈] [项目] [参考] | [显式] [归纳] [已晋升]
```

### 6.4 批量操作

新增操作：「晋升所有符合条件的归纳记忆」

---

## 七、实施计划

### Phase 1：数据模型 + 写入分离（1-2 天）

**目标：** 新记忆带来源标注，旧数据自动兼容

- [ ] 扩展 `MemoryEntryView` 接口，新增 `source`、`confidence`、`validUntil`、`supersededBy`
- [ ] API GET 返回新增字段
- [ ] API POST 支持 `source` 参数
- [ ] API PUT 编辑时自动重置 `confidence=0.9`
- [ ] 旧数据 fallback 逻辑
- [ ] UI 展示来源标签

**验证：** 新建记忆带 `source=inferred`，确认列表中显示正确标签

### Phase 2：检索重排（1-2 天）

**目标：** 显式记忆优先召回

- [ ] 实现 `computeRecencyWeight` 函数
- [ ] 修改 `findRelevantMemories` 加入 confidence 加权
- [ ] 检索结果确保 explicit 记忆优先
- [ ] dormant 记忆降权

**验证：** 同时存在 explicit 和 inferred 记忆时，explicit 排在前面

### Phase 3：UI 增强（1 天）

**目标：** 管理员能看到记忆质量

- [ ] 详情面板显示完整元数据
- [ ] 筛选功能支持按来源过滤
- [ ] 休眠/待归档状态视觉标记

**验证：** 筛选 `inferred` 只显示系统归纳的记忆

### Phase 4：晋升机制（2-3 天）

**目标：** 经过验证的归纳记忆自动升级

- [ ] 实现晋升条件判断
- [ ] 实现晋升动作（修改 source 和 confidence）
- [ ] 可选：晋升通知
- [ ] 用户纠正 → confidence 大幅下调

**验证：** 一条 inferred 记忆被召回 3 次后自动变为 promoted

---

## 八、不做什么

| 机制 | 不做的理由 | 未来是否需要 |
|------|-----------|------------|
| 关联图 | 当前检索量不足，收益低 | Layer 3 |
| 冷却池 | inferred 低置信度已起到类似缓冲作用 | Layer 3 |
| 双信号调度 | 简单定时任务够用 | 视实际需求 |
| 写时复制锁 | 本地单用户不需要 | 多用户时再考虑 |
| 版本化切换 | `supersededBy` 字段已足够 | 视实际需求 |
| 向量检索 | 本地 embedding 依赖过重 | 可选增强 |

---

## 九、关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| explicit 初始 confidence | 0.9 | 用户明确说过 |
| inferred 初始 confidence | 0.3 | 系统归纳，噪音率高 |
| promoted 初始 confidence | 0.6 | 经过验证 |
| 编辑时 confidence 重置 | 0.9 | 用户确认过 |
| 休眠阈值（天） | 30 | 超过 30 天未召回 |
| 待归档阈值（天） | 90 | 休眠超过 90 天 |
| recencyWeight 半衰期 | 50 天 | 权重降到 0.2 |
| explicit 最低召回占比 | 30% | 确保用户记忆优先 |
| 晋升最小召回次数 | 3 | inferred 记忆需被召回至少 3 次 |
| 晋升最小年龄（天） | 7 | 经过足够时间检验 |
| 用户纠正惩罚 | -0.4 | 大幅下调，用户纠正信息量大 |

---

## 十、预期效果

| 指标 | 改进前 | 改进后 |
|------|--------|--------|
| 噪音污染 | inferred 和 explicit 等权 | inferred 降权 70%，explicit 优先 |
| 逆向干扰 | 无时间感知 | 50 天以上记忆自动降权 |
| 可信度感知 | 无法区分来源 | 每条记忆带来源标签和置信度 |
| 记忆有效性 | 被动过期提示 | 四级状态管理 + 晋升机制 |
| 用户控制力 | 只能删除 | 可编辑（自动提权）、可筛选、可批量晋升 |
