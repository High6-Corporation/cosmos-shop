/**
 * Re-export from utils/seed-rbac for backward compatibility.
 *
 * Migration scripts that previously imported from this path continue
 * to work. New code should import directly from utils/seed-rbac.
 */

export {
  seedRbacData,
  seedRbacWithDefaults,
  ROLE_DEFINITIONS,
  BOOTSTRAP_USER_ROLES,
} from "../utils/seed-rbac";

export type { PolicyDef, RoleDef } from "../utils/seed-rbac-core";
