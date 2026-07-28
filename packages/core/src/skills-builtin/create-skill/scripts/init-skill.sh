#!/bin/bash
# ============================================================
# init-skill.sh — 初始化一个新的 Agent Skill 目录
# ============================================================
# 用法: bash init-skill.sh <skill-name>
#
# 在 ~/.thething/skills/<name>/ 下创���：
#   - SKILL.md（带完整 YAML frontmatter 模板）
#   - scripts/、references/、assets/ 子目录及示例文件
#
# AI 只需填充模板中的 TODO 占位符，frontmatter 格式由脚本保证正确。
# ============================================================

set -euo pipefail

SKILL_NAME="${1:?Usage: init-skill.sh <skill-name>}"
SKILLS_DIR="$HOME/.thething/skills/$SKILL_NAME"

# ---- 校验 ----

if ! echo "$SKILL_NAME" | grep -qE '^[a-z0-9-]+$'; then
  echo "Error: Skill name must contain only lowercase letters, numbers, and hyphens"
  exit 1
fi

if [ ${#SKILL_NAME} -gt 64 ]; then
  echo "Error: Skill name must be 64 characters or fewer"
  exit 1
fi

if [ -d "$SKILLS_DIR" ]; then
  echo "Error: Skill directory already exists: $SKILLS_DIR"
  exit 1
fi

# ---- 生成目录结构 ----

mkdir -p "$SKILLS_DIR"/{scripts,references,assets}

# 生成标题（hyphen-case → Title Case）
SKILL_TITLE=$(echo "$SKILL_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')

# ---- 生成 SKILL.md 模板 ----
# 注意: YAML 中 [ ] 是数组语法，因此占位符使用 TODO: 纯文本格式

cat > "$SKILLS_DIR/SKILL.md" << TEMPLATE_EOF
---
name: ${SKILL_NAME}
description: "TODO: What this skill does and when to use it — one concise sentence"
whenToUse: "TODO: Chinese trigger phrases, e.g. 用户要求下载抖音视频时使用"
---

# ${SKILL_TITLE}

## Overview

TODO: 1-2 sentences explaining what this skill enables

## Instructions

TODO: Write step-by-step instructions for the AI to execute. Follow these rules:

1. **Use imperative form** — write as commands to the AI (e.g. "Run:", "Write:", "Check:")
2. **Give exact, copy-pasteable commands with full paths** — no aliases, no assumptions about PATH or environment
   - WRONG: \`douyin-downloader --link "..." --action info\`
   - RIGHT: \`python ~/.thething/skills/${SKILL_NAME}/scripts/download.py --link "..." --action info\`
3. **Include environment setup as the first step** — install dependencies, configure API keys, create directories
4. **Specify which tool to use** for each step (bash for commands, write_file for file creation, read_file for inspection)
5. **Keep instructions self-contained** — another instance of this AI should be able to follow them without external docs

Example structure:
\`\`\`
1. Install dependencies: \`pip install -r ~/.thething/skills/${SKILL_NAME}/requirements.txt\`
2. Run the script: \`python ~/.thething/skills/${SKILL_NAME}/scripts/main.py --input "..."\`
3. Return the output to the user
\`\`\`

## Resources

### scripts/
Executable code (Python/Bash/etc.) that can be run directly via bash.

### references/
Documentation loaded into context as needed.

### assets/
Files used in output (templates, images, fonts, etc.).

---

Delete any unused directories before finalizing.
TEMPLATE_EOF

# ---- 生成示例文件 ----

cat > "$SKILLS_DIR/scripts/example.py" << PYEOF
#!/usr/bin/env python3
"""Example helper script for ${SKILL_NAME} — replace with actual implementation or delete."""
def main():
    print("Example script for ${SKILL_NAME}")

if __name__ == "__main__":
    main()
PYEOF
chmod +x "$SKILLS_DIR/scripts/example.py"

cat > "$SKILLS_DIR/references/api_reference.md" << 'REFEOF'
# Reference Documentation

Replace this file with actual reference documentation, or delete if not needed.

Suitable for: API docs, database schemas, domain knowledge, company policies, detailed workflow guides.
REFEOF

cat > "$SKILLS_DIR/assets/example_asset.txt" << 'ASSEOF'
Replace this file with actual assets (templates, images, fonts, boilerplate code), or delete if not needed.
ASSEOF

# ---- 输出 ----

echo "Skill '${SKILL_NAME}' initialized at ${SKILLS_DIR}"
echo ""
echo "Next steps:"
echo "  1. Edit SKILL.md to fill in TODO placeholders"
echo "  2. Customize or delete example files in scripts/, references/, assets/"
echo "  3. Use /${SKILL_NAME} to invoke the skill"
