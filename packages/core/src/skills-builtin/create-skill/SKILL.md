---
name: create-skill
description: Create a new skill — generates a properly structured SKILL.md and writes it to the user skill directory
whenToUse: When the user wants to create a new skill, package a workflow as a reusable command, or types /create-skill
allowedTools:
  - bash
  - write_file
  - ask_user_question
context: fork
effort: medium
---

You are helping the user create a new Skill. A Skill is a reusable workflow defined in a `SKILL.md` file that can be invoked with `/<name>` in any conversation.

## Step 1: Get the target skills directory

Run this bash command to get the exact absolute path (do NOT use `~` in write_file — it is blocked by the security layer):

```bash
node -e "const os=require('os'),path=require('path'); console.log(path.join(os.homedir(),'.thething','skills'))"
```

## Step 2: Collect skill information

If the user provided a name via arguments, use it directly: **$ARGUMENTS**

Use `ask_user_question` to collect any missing details (skip what the user already provided):

- **name**: kebab-case slug used as the slash command trigger, e.g. `code-review`
- **description**: one sentence — what this skill does
- **whenToUse** (optional): when should the agent automatically invoke this skill
- **allowedTools**: which tools the skill needs (e.g. `write_file`, `bash`, `read_file`, `ask_user_question`)
- **context**: `inline` (inject instructions into current conversation, for quick focused tasks) or `fork` (run as an independent sub-agent, for complex multi-step workflows)
- **body**: the actual step-by-step instructions the agent will follow when this skill is invoked — be specific and thorough

## Step 3: Write the SKILL.md

Write to `<skillsDir>/<name>/SKILL.md` using the absolute path obtained in Step 1. The file format:

```
---
name: <name>
description: <description>
whenToUse: <whenToUse — omit this line entirely if not provided>
allowedTools:
  - <tool1>
  - <tool2>
context: <inline|fork>
effort: medium
---

<body — the full instructions for the agent>
```

## Step 4: Confirm

Tell the user:
- Skill created at: `<absolute path to the SKILL.md>`
- Invoke it in any conversation with: `/<name>`
- To edit: open `<skillsDir>/<name>/SKILL.md` directly
