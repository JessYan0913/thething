import type { SystemPromptSection } from "../types";
import { getAvailableSkillsMetadata } from "@/lib/skills/metadata-loader";
import { formatSkillMetadataOnly } from "@/lib/skills/prompt-injection";

export async function createSkillsSection(): Promise<SystemPromptSection> {
  const skillsMetadata = await getAvailableSkillsMetadata();

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

