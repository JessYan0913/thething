---
name: create-skill
description: Creates an Anthropic Agent Skills-compatible SKILL.md when the user wants to create a reusable skill, package a workflow, or define a slash-command skill.
whenToUse: 用户要求创建技能、封装为skill、新建skill、做一个skill、create a skill、package as a skill 时必须使用
---

Create a new Agent Skill as a directory containing a required `SKILL.md` and optional bundled resources.

## 1. Initialize the skill directory (MANDATORY — do not skip)

FIRST, run the init script to generate a properly formatted template. The init script is located alongside this SKILL.md at `scripts/init-skill.sh`.

Run it with the absolute path (resolve it from the path of this SKILL.md):

```bash
bash <path-to-create-skill>/scripts/init-skill.sh <skill-name>
```

This creates `~/.thething/skills/<name>/` with:
- `SKILL.md` with pre-filled YAML frontmatter (`name`, `description`, `whenToUse`)
- `scripts/`, `references/`, `assets/` directories with example files

The YAML frontmatter is GUARANTEED correct — the init script handles the format. Your job is now only to fill in the TODO placeholders in the generated template.

## 2. Collect the required information

After running the init script, fill in the TODO placeholders. Use **$ARGUMENTS** as the requested name or topic when provided. Ask only for missing information:

- `description`: one concise sentence covering both what the Skill does and when it should be used. Replace the TODO placeholder.
- `whenToUse`: Chinese trigger phrases for when this skill should be activated. Replace the TODO placeholder.
- Body: executable instructions, expected inputs and outputs, constraints, and examples where useful. Replace the TODO placeholders in each section.

Validate the standard metadata before finalizing:

- `name` is required and at most 64 characters.
- `name` contains only lowercase ASCII letters, digits, and hyphens.
- `name` does not contain XML tags or the reserved words `anthropic` or `claude`.
- `description` is required, non-empty, and at most 1024 characters.
- `description` does not contain XML tags.
- Phrase the description in third person and include concrete trigger terms when possible.

## 3. Design for progressive disclosure

Keep `SKILL.md` focused on the core workflow, preferably below 500 lines.

- Put detailed documentation in `references/`.
- Put deterministic reusable programs in `scripts/`.
- Put templates and output assets in `assets/`.
- Reference bundled files directly from `SKILL.md`; avoid deep chains of references.
- Add a table of contents to reference files longer than 100 lines.
- Use `/` in relative paths on every platform.
- Load or execute bundled resources only when the workflow needs them.

## 4. Write AI-executable instructions (CRITICAL)

The body of SKILL.md will be loaded into another AI's context. It MUST be written as **instructions for an AI to execute**, not as a human user manual.

### Writing rules

1. **Use imperative form** — write as direct commands to the AI
   - ✅ "Run `pip install -r requirements.txt`"
   - ❌ "Users can install dependencies with `pip install -r requirements.txt`"

2. **Give exact, copy-pasteable commands with FULL absolute paths** — no aliases, no assumptions about PATH
   - ✅ `python ~/.thething/skills/<name>/scripts/main.py --link "..." --action info`
   - ❌ `my-tool --link "..." --action info`

3. **Include environment setup as step 1** — install dependencies, configure API keys, create directories
   - The AI starts with a clean environment; assume nothing is pre-installed

4. **Tell the AI which tool to use** for each step
   - bash → for running commands
   - write_file → for creating or modifying files
   - read_file → for inspecting files

5. **Specify expected outputs** — what should the AI return to the user after each step?

### anti-patterns to avoid

- ❌ Human-facing command examples like `douyin-downloader --link "..."` (won't work in AI's shell)
- ❌ "The user can..." or "You can..." phrasing (skills are for AI execution, not human reading)
- ❌ Omitting dependency installation (the AI's environment is clean each session)
- ❌ Assuming tools/scripts are in PATH (always use absolute paths)

### Example: good vs bad

**Bad (human manual style):**
```markdown
## 使用方式
douyin-video-downloader --link "分享链接" --action download --output ./videos
```

**Good (AI instruction style):**
```markdown
## Instructions

1. Install dependencies:
   ```bash
   pip install -r ~/.thething/skills/douyin-video-downloader/requirements.txt
   ```

2. Get video info (use bash tool):
   ```bash
   python ~/.thething/skills/douyin-video-downloader/main.py --link "<user-provided-link>" --action info
   ```

3. Download the video (use bash tool):
   ```bash
   python ~/.thething/skills/douyin-video-downloader/main.py --link "<user-provided-link>" --action download --output ./videos
   ```

4. Tell the user the video has been downloaded and provide the file path.
```

## 5. Finalize and confirm

Delete any example files or directories that are not needed (e.g., delete `scripts/` if the skill has no scripts).

TheThing may parse optional compatibility extensions such as `model`, `effort`, `context`, `agent`, `background`, `allowedTools`, and `paths`. Treat these as TheThing or Claude Code compatibility extensions, not as fields required by the portable Agent Skills standard. Add them only when the requested behavior needs them.

Runtime semantics:
- `model` applies after activation for the remaining steps of the current user turn. It accepts aliases or a concrete model ID; `inherit` keeps the current model. A configured model allowlist is enforced.
- `effort` applies for the remaining steps of the current turn and accepts `low`, `medium`, `high`, `xhigh`, or `max`.
- `context: fork` runs the Skill body in an isolated sub-agent without parent conversation history. Use `agent` to select its type.
- Fork execution is currently synchronous and requires `background: false`; persistent background fork runs are not available yet.

## 6. Confirm

Report:

- The absolute path of the created `SKILL.md`.
- How to invoke it with `/<name>`.
- Any bundled `scripts/`, `references/`, or `assets/` created.
- Any non-standard compatibility extensions intentionally added.
