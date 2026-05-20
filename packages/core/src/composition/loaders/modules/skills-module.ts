// ============================================================
// Skills Module - AppModule adapter for skills loader
// ============================================================

import type { AppModule, ModuleContext } from '../module-types';
import { loadSkills, clearSkillsCache, type LoadSkillsOptions } from '../../../modules/skills/loader';
import type { Skill } from '../../../modules/skills/types';

export function createSkillsModule(loadOptions?: LoadSkillsOptions): AppModule<Skill[]> {
  let loadedSkills: Skill[] = [];

  return {
    name: 'skills',

    async init(context: ModuleContext): Promise<void> {
      const options: LoadSkillsOptions = {
        cwd: context.cwd,
        configDirName: context.configDirName,
        homeDir: context.homeDir,
        dirs: context.resourceDirs.skills,
        ...loadOptions,
      };
      loadedSkills = await loadSkills(options);
    },

    snapshot(): Skill[] {
      return loadedSkills;
    },

    async dispose(): Promise<void> {
      clearSkillsCache();
      loadedSkills = [];
    },
  };
}
