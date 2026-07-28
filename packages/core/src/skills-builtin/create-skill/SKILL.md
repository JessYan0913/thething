---
name: create-skill
description: Creates an Anthropic Agent Skills-compatible SKILL.md when the user wants to create a reusable skill, package a workflow, or define a slash-command skill.
---

Create a new Agent Skill as a directory containing a required `SKILL.md` and optional bundled resources.

## 1. Resolve the target directory

Run this command to obtain the absolute user skills directory. Do not pass `~` to file tools.

```bash
node -e "const os=require('os'),path=require('path'); console.log(path.join(os.homedir(),'.thething','skills'))"
```

Write the Skill to `<skillsDir>/<name>/SKILL.md`.

## 2. Collect the required information

Use **$ARGUMENTS** as the requested name or topic when provided. Ask only for missing information:

- `name`: slash-command identifier and directory name.
- `description`: one concise sentence covering both what the Skill does and when it should be used.
- Body: executable instructions, expected inputs and outputs, constraints, and examples where useful.

Validate the standard metadata before writing:

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

## 4. Write the standard SKILL.md

Default to the cross-product Agent Skills standard. Do not emit product-specific fields unless the user explicitly requests them.

```markdown
---
name: <name>
description: <what the Skill does and when to use it>
---

<imperative, step-by-step instructions>
```

TheThing may parse optional compatibility extensions such as `model`, `effort`, `context`, `agent`, `background`, `allowedTools`, `whenToUse`, and `paths`. Treat these as TheThing or Claude Code compatibility extensions, not as fields required by the portable Agent Skills standard. Add them only when the requested behavior needs them.

Runtime semantics:
- `model` applies after activation for the remaining steps of the current user turn. It accepts aliases or a concrete model ID; `inherit` keeps the current model. A configured model allowlist is enforced.
- `effort` applies for the remaining steps of the current turn and accepts `low`, `medium`, `high`, `xhigh`, or `max`.
- `context: fork` runs the Skill body in an isolated sub-agent without parent conversation history. Use `agent` to select its type.
- Fork execution is currently synchronous and requires `background: false`; persistent background fork runs are not available yet.

## 5. Confirm

Report:

- The absolute path of the created `SKILL.md`.
- How to invoke it with `/<name>`.
- Any bundled `scripts/`, `references/`, or `assets/` created.
- Any non-standard compatibility extensions intentionally added.
