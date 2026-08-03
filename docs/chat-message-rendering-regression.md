# 对话消息渲染回归：assistant 失去左侧色条后的视觉断层

**日期**: 2026-08-02
**关联提交**: c192478 `feat(ui): 统一对话界面表现并支持 bash 直播输出与内联报告卡`
**状态**: 待修复

## 现象

对话中当 assistant 调用 `ask_user_question` 等工具、用户回答后,assistant 继续回复时,视觉上出现"断层"——前一段 assistant 文字、工具行、后一段 assistant 文字看起来是三块独立的内容,没有视觉锚把它们组合在一起。

## 根因

### 1. assistant 消息丢失左侧色条([packages/app/components/ai-elements/message.tsx](packages/app/components/ai-elements/message.tsx))

```diff
// before
"group-[.is-assistant]:text-foreground
 group-[.is-assistant]:border-l-2
 group-[.is-assistant]:border-primary/30
 group-[.is-assistant]:pl-4"

// after
"group-[.is-assistant]:text-foreground"
```

c192478 在统一界面表现时把 assistant 的左侧色条整行删除。该色条原本承担两个功能:

- **视觉分组**:把所有 assistant 内容锚定在同一条直线上,让用户一眼看出"这是同一段回应"
- **工具切入切出的视觉过渡**:工具行夹在两段 assistant 文字之间时,色条让用户知道这些是同一个回合

色条删除后,这两个功能都没了。

### 2. `ask_user_question` 工具结果在对话流里没有"回声"

[packages/app/components/Chat.tsx:1889](packages/app/components/Chat.tsx#L1889) 的 `formatToolOutput` 对 `ask_user_question` 没有特殊分支,直接走通用 JSON 输出:

```ts
return {
  content: JSON.stringify(out, null, 2),
  language: 'json',
  title: toolName,
};
```

用户在底部 `UserQuestionPanel` 完成选择后,对话流里只能看到一行 `ask user question`,展开后是一坨 `{ questions, answers, timestamp }` JSON。刚才那个漂亮面板的选项在对话里完全没有"回声"——这是历史遗留问题,但失去色条后视觉断层更刺眼。

### 3. 新增外层容器放大了间距

```tsx
// c192478 在 ConversationContent 里新增
<div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
```

间距从 `gap-2`(8px)放大到 `gap-4`(16px),配合 user 消息从 `max-w-[95%]` 收紧到 `max-w-2xl`,整体更"宽松",进一步放大了"断块"的视觉感受。

## 影响范围

不只 `ask_user_question`,所有"长 assistant 段 + 工具"序列都会出现类似断层,例如:

- assistant 长段推理 → 工具 → assistant 长段回应
- assistant 长段说明 → 多步工具 → assistant 总结

只是 `ask_user_question` 因为"问题在底部面板问、结果在对话流回显"这种空间错位,断层感最强。

## 修复方案

### 方案 A:完全还原(保守)

把色条加回去,恢复 c192478 之前的状态。

```diff
- "group-[.is-assistant]:text-foreground",
+ "group-[.is-assistant]:text-foreground group-[.is-assistant]:border-l-2 group-[.is-assistant]:border-primary/30 group-[.is-assistant]:pl-4",
```

- 优点:零风险,完全可逆
- 缺点:没有利用 c192478 的居中限宽改造,色条视觉权重偏重

### 方案 B:新平衡(推荐)

用更克制的色条,既保留视觉分组又不抢戏:

```diff
- "group-[.is-assistant]:text-foreground",
+ "group-[.is-assistant]:text-foreground group-[.is-assistant]:border-l group-[.is-assistant]:border-primary/40 group-[.is-assistant]:pl-3",
```

变化:

- `border-l-2` → `border-l`(线宽 2px → 1px)
- `border-primary/30` → `border-primary/40`(透明度 30% → 40%)
- `pl-4` → `pl-3`(缩进 16px → 12px)

- 优点:保留视觉分组功能,符合 c192478 的"克制"风格
- 缺点:透明度需肉眼微调
- 踩坑:`--primary` 是 `oklch(0.60 0.12 75)`(琥珀金),白底上叠 15% ≈ `oklch(0.94 0.018 75)`,跟背景几乎无对比度,1px 线肉眼不可见。最初试过 `/15` 看不到色条才提到 `/40`。1px + 40% 是肉眼可见下限,再低就没了

### 方案 C:工具结果定制渲染(治本)

为 `ask_user_question` 及类似"用户已选择/已回答"类工具在 `formatToolOutput` 里加专门分支,渲染为"已回答:Q1: 选项 A,Q2: 自定义 XXX"而不是 JSON。

- 优点:解决工具结果在对话流里没有"回声"的根本问题
- 缺点:涉及多工具,工作量更大;不改方案 A/B 的话视觉断层仍存在

## 建议

先做方案 B 解决最显眼的视觉问题。方案 C 单独排期,后续有空再处理。
