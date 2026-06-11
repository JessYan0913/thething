// ============================================================
// Permissions Module - AppModule adapter for permissions loader
// ============================================================

import type { AppModule, ModuleContext } from '../module-types';
import { loadPermissions, type LoadPermissionsOptions } from '../permissions';
import type { PermissionRule } from '../../../modules/permissions/types';

export function createPermissionsModule(loadOptions?: LoadPermissionsOptions): AppModule<PermissionRule[]> {
  let loadedPermissions: PermissionRule[] = [];

  return {
    name: 'permissions',

    async init(context: ModuleContext): Promise<void> {
      const options: LoadPermissionsOptions = {
        cwd: context.cwd,
        configDir: context.configDir,
        homeDir: context.homeDir,
        dirs: context.resourceDirs.permissions,
        ...loadOptions,
      };
      loadedPermissions = await loadPermissions(options);
    },

    snapshot(): PermissionRule[] {
      return loadedPermissions;
    },

    async dispose(): Promise<void> {
      loadedPermissions = [];
    },
  };
}
