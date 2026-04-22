import type { SystemPromptSection } from "../types";
import { getAvailableSkillsMetadata } from "../../skills/metadata-loader";
import { formatSkillMetadataOnly } from "../../skills/prompt-injection";

export async function createSkillsSection(cwd?: string): Promise<SystemPromptSection> {
  const skillsMetadata = await getAvailableSkillsMetadata({ cwd });

  if (skillsMetadata.length === 0) {
    return {
      name: "skills",
      content: null,
      cacheStrategy: "session",
      priority: 5,
    };
  }

  const content = formatSkillMetadataOnly(skillsMetadata);

  return {
    name: "skills",
    content,
    cacheStrategy: "session",
    priority: 5,
  };
}

