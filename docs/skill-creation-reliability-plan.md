# 技能创建可靠性优化方案

> 创建时间：2026-07-28
> 状态：方案阶段
> 前置文档：[skill-creation-and-tool-error-analysis.md](./skill-creation-and-tool-error-analysis.md)

## 背景

[skill-creation-and-tool-error-analysis.md](./skill-creation-and-tool-error-analysis.md) 中实施了四层引导措施（A-sol-1 到 A-sol-4），但文档自身也诚实声明：

> "A-1 是模型行为问题，A-sol-1/2/4 只能降低失败概率、增强反馈，无法 100% 保证 Agent 走对。"

2026-07-28 再次发生同类故障：会话 `kLszDIXAwspC0EOteMaqb` 中用户说「封装为 skill」，AI 没有触发 `create-skill` 技能，而是直接手写了不带 YAML frontmatter 的 SKILL.md，导致技能在 `/` 面板中不可见。

本方案在此基础上，引入 **确定性机制**（脚本模板 + 写入校验 + 错误可见化），将可靠性从「概率引导」提升到「缺省正确」。

---

## 方案概览

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: 脚本化模板生成（根本修复）                        │
│ AI 运行 init-skill.sh → 自动生成带 frontmatter 的模板      │
│ AI 只需填充 TODO，格式由脚本保证                           │
├─────────────────────────────────────────────────────────┤
│ Layer 2: 系统提示强化（引导优化）                          │
│ whenToUse 中文触发短语 + CRITICAL 级指令                  │
├─────────────────────────────────────────────────────────┤
│ Layer 3: 加载器错误可见化（兜底安全网）                     │
│ API 返回 invalid 列表 → UI 展示警告                       │
│ 即使 Layer 1/2 都失败，用户也能看到问题                     │
├─────────────────────────────────────────────────────────┤
│ Layer 4: 写入时校验（源头拦截）                            │
│ POST /api/skills 写入 SKILL.md 后立即校验                  │
│ 缺少 frontmatter → 回滚 + 422 错误                        │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1：脚本化模板生成

### 设计思路

参考 WorkBuddy 的 `skill-creator/scripts/init_skill.py`。核心原则：**不靠 AI 记住 frontmatter 格式，而是让一个确定性的脚本生成模板，AI 只需填充 TODO**。

### 1a. 新增 init-skill.sh

**文件：** `packages/core/src/skills-builtin/create-skill/scripts/init-skill.sh`

**功能：**
- 接受 `<skill-name>` 参数
- 创建 `~/.thething/skills/<name>/` 目录及 `scripts/`、`references/`、`assets/` 子目录
- 生成带完整 YAML frontmatter 的 SKILL.md 模板（包含 `name`、`description`、`whenToUse` 占位符）
- 生成示例文件（`scripts/example.py`、`references/api_reference.md`、`assets/example_asset.txt`）

**实现要点���**

```bash
#!/bin/bash
set -euo pipefail

SKILL_NAME="${1:?Usage: init-skill.sh <skill-name>}"
SKILLS_DIR="$HOME/.thething/skills/$SKILL_NAME"

# 验证 skill name 格式
if ! echo "$SKILL_NAME" | grep -qE '^[a-z0-9-]+$'; then
    echo "❌ Error: Skill name must contain only lowercase letters, numbers, and hyphens"
    exit 1
fi

if [ ${#SKILL_NAME} -gt 64 ]; then
    echo "❌ Error: Skill name must be 64 characters or fewer"
    exit 1
fi

# 检查是否已存在
if [ -d "$SKILLS_DIR" ]; then
    echo "❌ Error: Skill directory already exists: $SKILLS_DIR"
    exit 1
fi

# 创建目录结构
mkdir -p "$SKILLS_DIR"/{scripts,references,assets}

# 生成 SKILL.md 模板（HEREDOC 中变量替换关闭，后续 sed 替换占位符）
SKILL_TITLE=$(echo "$SKILL_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')

cat > "$SKILLS_DIR/SKILL.md" << 'TEMPLATE_EOF'
---
name: __SKILL_NAME__
description: [TODO: What this skill does and when to use it — one concise sentence]
whenToUse: [TODO: Chinese trigger phrases, e.g. "用户要求下载抖音视频、提取无水印视频时使用"]
---

# __SKILL_TITLE__

## Overview

[TODO: 1-2 sentences explaining what this skill enables]

## Instructions

[TODO: Step-by-step workflow for the AI to follow]

## Resources

### scripts/
Executable code that can be run directly.

### references/
Documentation loaded into context as needed.

### assets/
Files used in output (templates, images, fonts, etc.).

---

**Delete unused directories before finalizing.**
TEMPLATE_EOF

# 替换占位符
sed -i '' "s/__SKILL_NAME__/$SKILL_NAME/g" "$SKILLS_DIR/SKILL.md"
sed -i '' "s/__SKILL_TITLE__/$SKILL_TITLE/g" "$SKILLS_DIR/SKILL.md"

# 生成示例文件
cat > "$SKILLS_DIR/scripts/example.py" << 'PYEOF'
#!/usr/bin/env python3
"""Example script for __SKILL_NAME__ — replace or delete."""
def main():
    print("Example script")

if __name__ == "__main__":
    main()
PYEOF
sed -i '' "s/__SKILL_NAME__/$SKILL_NAME/g" "$SKILLS_DIR/scripts/example.py"
chmod +x "$SKILLS_DIR/scripts/example.py"

cat > "$SKILLS_DIR/references/api_reference.md" << 'REFEOF'
# Reference Documentation

Replace with actual reference content or delete if not needed.
REFEOF

cat > "$SKILLS_DIR/assets/example_asset.txt" << 'ASSEOF'
Replace with actual asset files or delete if not needed.
ASSEOF

echo "✅ Skill '$SKILL_NAME' initialized at $SKILLS_DIR"
echo ""
echo "Next steps:"
echo "  1. Edit SKILL.md to fill in TODO placeholders"
echo "  2. Customize or delete example files in scripts/, references/, assets/"
echo "  3. Use /$SKILL_NAME to invoke the skill"
```

**关键设计决策：**
- 使用 shell 脚本而非 Python——TheThing 环境中 node 和 bash 必然可用，Python 不一定
- 模板用 `TEMPLATE_EOF`（单引号 HEREDOC）阻止变量展开，再用 `sed` 精确替换占位符
- 入口处校验 skill name 格式，fail-fast
- 示例文件标记为可替换，避免技能包含无意义的占位文件

### 1b. 更新 create-skill 的 SKILL.md

**文件：** `packages/core/src/skills-builtin/create-skill/SKILL.md`

**改动：**

```diff
 ---
 name: create-skill
 description: Creates an Anthropic Agent Skills-compatible SKILL.md when the user wants to create a reusable skill, package a workflow, or define a slash-command skill.
+whenToUse: "用户要求创建技能、封装为skill、新建skill、做一个skill、create a skill、package as a skill 时必须使用"
 ---
```

**改动 Step 1（当前让 AI 手动计算路径并写文件）：**

```diff
-## 1. Resolve the target directory
+## 1. Initialize the skill directory (MANDATORY — do not skip)

-Run this command to obtain the absolute user skills directory:
+FIRST, run the init script to generate a properly formatted template:

```bash
-node -e "const os=require('os'),path=require('path'); console.log(path.join(os.homedir(),'.thething','skills'))"
+bash <path-to-builtin>/scripts/init-skill.sh <skill-name>
```

-Write the Skill to `<skillsDir>/<name>/SKILL.md`.
+This creates `~/.thething/skills/<name>/` with:
+- SKILL.md with pre-filled YAML frontmatter (name + description + whenToUse)
+- scripts/, references/, assets/ directories

+The frontmatter is GUARANTEED correct — your job is now only to fill in the
+TODO placeholders in the template.
```

**改动 Step 2（当前让 AI 先收集再写）：**

```diff
 ## 2. Collect the required information

-Use **$ARGUMENTS** as the requested name or topic when provided. Ask only for missing information:
+After running the init script, ask the user only for the information you
+cannot determine from context:

 - `name`: slash-command identifier and directory name.
 - `description`: one concise sentence covering both what the Skill does and when it should be used.
 - Body: executable instructions, expected inputs and outputs, constraints, and examples where useful.

-Validate the standard metadata before writing:
+Validate before filling in the template:

 - `name` is required and at most 64 characters.
 - `name` contains only lowercase ASCII letters, digits, and hyphens.
 - `name` does not contain XML tags or the reserved words `anthropic` or `claude`.
 - `description` is required, non-empty, and at most 1024 characters.
 - `description` does not contain XML tags.
 - Phrase the description in third person and include concrete trigger terms when possible.
```

### 1c. 更新代码生成脚本

**文件：** `packages/core/scripts/generate-bundled-skills.mjs`

Parse 函数中增加 `whenToUse` 提取：

```diff
  return {
    name: metadata.name,
    description: metadata.description,
+   whenToUse: metadata.whenToUse || undefined,
    body: match[2].replace(/^\n/, '').replace(/\s+$/, ''),
  };
```

Generate 函数中增加 `whenToUse` 输出：

```diff
  export const BUNDLED_SKILLS: Skill[] = [
    {
      name: ${JSON.stringify(skill.name)},
      description: ${JSON.stringify(skill.description)},
+     whenToUse: ${JSON.stringify(skill.whenToUse)},
      sourcePath: 'builtin:create-skill',
      source: 'builtin',
      body: ${JSON.stringify(skill.body)},
    },
  ];
```

**执行：** 修改完成后运行 `pnpm --filter @the-thing/core generate:skills` 重新生成 `bundled.ts`。

---

## Layer 2：系统提示强化

### 改动

**文件：** `packages/core/src/modules/system-prompt/builder.ts`，第 119-127 行

```diff
  const skillCreationNote = '技能是配置目录中的标准 SKILL.md 文件（不是 .py 脚本、不是 Wiki 页面）。'
-   + '标准 frontmatter 必须包含 name 和 description；启动时只索引这两个元数据，匹配后再按需加载正文和资源。'
-   + '要创建技能，调用 create-skill 技能。';
+   + '\n\n⚠️ CRITICAL — 技能创建规则:\n'
+   + '- 用户提到"创建技能/封装为skill/新建skill/做个skill"时，必须调用 create-skill 技能\n'
+   + '- create-skill 会引导你运行 init-skill.sh 脚本生成带 frontmatter 的模板\n'
+   + '- 禁止直接手写 SKILL.md 文件 — 缺少 YAML frontmatter 的文件会被加载器静默丢弃\n'
+   + '- 技能不是 .py 脚本或 Wiki 页面，是标准的 SKILL.md 文件';

  const content = listing
    ? `## 技能\n\n${listing}\n\n如果有技能匹配用户需求，使用该技能。否则，按正常方式处理。\n\n${skillCreationNote}`
    : `## 技能\n\n暂无可用技能。按正常方式处理。\n\n${skillCreationNote}`;
```

**设计说明：**
- 从 "被动告知" 升级为 "强制指令"（⚠️ CRITICAL）
- 明确禁止行为（直接手写 SKILL.md）并解释后果（静默丢弃）
- 引导到正确的流程（create-skill → init-skill.sh）

---

## Layer 3：加载器错误可见化

### 设计思路

当前 `multi-source-loader` 解析失败时只 `logger.warn`，对用户完全不可见。Layer 3 让 `/api/skills` GET 返回无效技能列表，UI 层展示警告。

### 3a. API 层

**文件：** `packages/app/app/api/skills/route.ts`

在 GET 处理器中增加独立扫描：

```typescript
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const folderName = searchParams.get('folderName');

    const skills = (await loadAllSkills()).map(({ skill, folderName }) => ({
      name: skill.name,
      folderName,
      description: skill.description,
      whenToUse: skill.whenToUse,
      allowedTools: skill.allowedTools ?? [],
      model: skill.model,
      effort: skill.effort ?? 'medium',
      context: skill.context ?? 'inline',
      paths: skill.paths ?? [],
      sourcePath: skill.sourcePath,
      source: skill.source ?? 'project',
    }));

    // Single skill lookup
    if (folderName) {
      const skill = skills.find((s) => s.folderName === folderName);
      if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
      return NextResponse.json({ skill });
    }

    // === NEW: 扫描无效技能 ===
    const invalid: Array<{ folderName: string; path: string; error: string }> = [];
    try {
      const skillsDir = await getPrimarySkillsDir();
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      const validFolderNames = new Set(skills.map(s => s.folderName));

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        // 跳过已成功加载的技能
        if (validFolderNames.has(entry.name)) continue;

        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          await fs.access(skillMdPath);
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const trimmed = content.trim();

          if (!trimmed.startsWith('---')) {
            invalid.push({
              folderName: entry.name,
              path: skillMdPath,
              error: `缺少 YAML frontmatter（需要 name 和 description）`,
            });
          } else {
            // 有 frontmatter，尝试解析
            const endMatch = trimmed.slice(3).match(/\n---/);
            if (!endMatch) {
              invalid.push({
                folderName: entry.name,
                path: skillMdPath,
                error: `YAML frontmatter 未正确闭合（缺少 ---）`,
              });
            } else {
              invalid.push({
                folderName: entry.name,
                path: skillMdPath,
                error: `frontmatter 解析失败（检查 name/description 字段）`,
              });
            }
          }
        } catch {
          // SKILL.md 不存在，不是技能目录，跳过
        }
      }
    } catch {
      // 目录不存在或不可读，忽略
    }

    return NextResponse.json({ skills, invalid });
  } catch (error) {
    console.error('[Skills API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
  }
}
```

### 3b. UI 层

**文件：** `packages/app/components/slash-command-menu.tsx`

从 `/api/skills` 响应中提取 `invalid` 字段并展示。核心改动：

```tsx
// 数据获取时同时保存 invalid 列表
const [invalidSkills, setInvalidSkills] = useState<InvalidSkill[]>([]);

// fetch 时处理
const data = await res.json();
setSkills(data.skills || []);
setInvalidSkills(data.invalid || []);

// 渲染：在技能列表底部增加警告组
{invalidSkills.length > 0 && (
  <div className="slash-command-group">
    <div className="slash-command-group-label" style={{ color: 'var(--color-text-danger)' }}>
      ⚠ 加载失败的技能
    </div>
    {invalidSkills.map((s) => (
      <div
        key={s.folderName}
        className="slash-command-item"
        title={`${s.path}: ${s.error}`}
        data-invalid="true"
      >
        <span className="slash-command-item-icon">⚠</span>
        <span className="slash-command-item-label">{s.folderName}</span>
        <span className="slash-command-item-hint">{s.error}</span>
      </div>
    ))}
  </div>
)}
```

---

## Layer 4：写入时校验（可选）

### 设计思路

在 `POST /api/skills` 写入 SKILL.md 后立即校验，缺少 frontmatter 则回滚整个技能目录。

### 改动

**文件：** `packages/app/app/api/skills/route.ts`

在 `action === 'upload'` 分支中，所有文件写入完成后增加校验：

```typescript
if (action === 'upload') {
  const { folderName, files } = body;
  if (!folderName) {
    return NextResponse.json({ error: 'Missing folderName' }, { status: 400 });
  }

  const skillsDir = await ensureSkillsDir();
  const folderPath = path.join(skillsDir, folderName);

  // ... 现有的存在性检查和文件写入逻辑 ...

  if (files && typeof files === 'object') {
    for (const [relativePath, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue;
      const filePath = path.join(folderPath, relativePath);
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
    }
  }

  // === NEW: 写入后校验 SKILL.md ===
  const skillMdPath = path.join(folderPath, 'SKILL.md');
  try {
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const trimmed = content.trim();

    if (!trimmed.startsWith('---')) {
      await fs.rm(folderPath, { recursive: true, force: true });
      return NextResponse.json({
        error: 'SKILL.md 缺少 YAML frontmatter。请使用 /skill create-skill 创建技能。',
        detail: 'SKILL.md 必须以 --- 开头，包含 name 和 description 字段。',
      }, { status: 422 });
    }

    // 可选：更严格的校验（用 gray-matter + SkillFrontmatterSchema）
    const { SkillFrontmatterSchema } = await import('@the-thing/core');
    // ... parse and validate ...
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.rm(folderPath, { recursive: true, force: true });
      return NextResponse.json({
        error: '技能必须包含 SKILL.md 文件。',
      }, { status: 422 });
    }
    throw err;
  }

  await reloadServerContext();
  return NextResponse.json({ success: true });
}
```

**注意：** 此层为可选。如果 Layer 1（脚本模板）工作良好，AI 不会生成缺少 frontmatter 的 SKILL.md。但在通过 API 编程式上传技能时，此校验仍有价值。

---

## 实施顺序与依赖

```
Step 1: init-skill.sh          ← 新文件，无依赖
Step 2: SKILL.md 更新          ← 依赖 Step 1（脚本路径引用）
Step 3: generate 脚本更新       ← 依赖 Step 2（whenToUse 字段），
          + 重新生成 bundled.ts   需运行 pnpm --filter @the-thing/core generate:skills
Step 4: 系统提示强化            ← 依赖 Step 3（whenToUse 在系统提示中生效）
Step 5: API 错误可见化          ← 无依赖，可并行
Step 6: UI 无效技能展示         ← 依赖 Step 5
Step 7: 写入时校验（可选）      ← 无依赖，可并行
```

建议分两个 PR：
- **PR #1**：Step 1-4，覆盖根本性修复（脚本模板 + 触发强化）
- **PR #2**：Step 5-7，覆盖安全网（错误可见化 + 校验）

---

## 验收标准

### 功能验收

1. 在对话中输入 "帮我创建一个下载 YouTube 视频的技能" → AI 触发 `create-skill` → 运行 `init-skill.sh` → 生成带正确 frontmatter 的 SKILL.md → 用户在 `/` 面板中看到技能
2. 手动写入一个缺少 frontmatter 的 SKILL.md 到 `~/.thething/skills/test-invalid/SKILL.md` → `/api/skills` 返回的 `invalid` 包含此文件 → 前端 `/` 面板显示 "⚠ 加载失败的技能"
3. `whenToUse` 字段正确包含中文触发短语 → `budget-formatter.ts` 中 `getSkillDescription()` 正确拼接到 AI 看到的描述中

### 回归验收

- `pnpm --filter @the-thing/core generate:skills` 生成后的 `bundled.ts` 与源文件一致
- 现有的 90+ 个技能正常加载，`/api/skills` 返回的 `invalid` 为空（或只包含已知的非标准旧技能）
- 现有测试通过

### 非目标

- 不需要为超过 64 字符或含中文的旧技能名做兼容——标准迁移是预期行为
- 不需要让 AI 100% 触发 create-skill——本方案将可靠性从 "概率" 提升到 "缺省正确"，剩余的极端情况由 Layer 3 兜底

---

## 参考

| 相关文件 | 路径 |
|---------|------|
| 内置 create-skill 源 | `packages/core/src/skills-builtin/create-skill/SKILL.md` |
| 上期问题分析 | `docs/skill-creation-and-tool-error-analysis.md` |
| 技能加载器 | `packages/core/src/modules/skills/loader.ts` |
| 多源加载器（含静默跳过逻辑） | `packages/core/src/services/scanner/multi-source-loader.ts` |
| 系统提示构建器 | `packages/core/src/modules/system-prompt/builder.ts` |
| 技能 API 路由 | `packages/app/app/api/skills/route.ts` |
| 技能类型定义 | `packages/core/src/modules/skills/types.ts` |
| 预算格式化器（含 whenToUse 拼接） | `packages/core/src/modules/skills/budget-formatter.ts` |
| 代码生成脚本 | `packages/core/scripts/generate-bundled-skills.mjs` |
| 斜杠命令菜单 UI | `packages/app/components/slash-command-menu.tsx` |
| WorkBuddy 技能创建参照 | WorkBuddy 内置 `skill-creator` skill |
