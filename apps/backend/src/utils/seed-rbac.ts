/**
 * RBAC Seed — thin entrypoint (template-owned).
 *
 * Imports the seed mechanism from seed-rbac-core.ts and the default role
 * definitions from seed-rbac-roles.ts, then exports a convenience function
 * that wires them together. Used by migration scripts and for manual seeding.
 *
 * The primary startup mechanism is the rbac-seed module (src/modules/rbac-seed/).
 * The subscriber fallback is in src/subscribers/seed-rbac-on-startup.ts.
 */

import { seedRbacData } from "./seed-rbac-core";
import { ROLE_DEFINITIONS, BOOTSTRAP_USER_ROLES } from "./seed-rbac-roles";
import { MedusaContainer } from "@medusajs/framework";

/**
 * Seed RBAC data with the default role definitions.
 * For custom seeding, call seedRbacData() directly with your own role list.
 */
export async function seedRbacWithDefaults(container: MedusaContainer): Promise<void> {
  return seedRbacData(container, ROLE_DEFINITIONS, BOOTSTRAP_USER_ROLES);
}

// Re-export for backward compatibility
export { seedRbacData } from "./seed-rbac-core";
export { ROLE_DEFINITIONS, BOOTSTRAP_USER_ROLES } from "./seed-rbac-roles";
export type { PolicyDef, RoleDef } from "./seed-rbac-core";
