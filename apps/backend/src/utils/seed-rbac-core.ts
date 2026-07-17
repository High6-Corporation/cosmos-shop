/**
 * RBAC Seed Core — mechanism only (template-owned).
 *
 * Types, helpers (allCrud/readWrite/readOnly), and the seedRbacData function.
 * Parameterized: accepts role definitions and bootstrap user list as arguments
 * so the data lives in a client-owned file (seed-rbac-roles.ts).
 *
 * NEVER edit the role list here — use seed-rbac-roles.ts for that.
 * Sync'd with template releases; client changes stay in the roles file.
 */

/**
 * (src/migration-scripts/seed-rbac.ts) and the startup subscriber
 * (src/subscribers/seed-rbac-on-startup.ts).
 */

import { MedusaContainer } from "@medusajs/framework";
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { IRbacModuleService } from "@medusajs/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicyDef = {
  key: string;
  resource: string;
  operation: string;
  name?: string;
};

export type RoleDef = {
  name: string;
  description: string;
  metadata?: Record<string, any>;
  policies: PolicyDef[];
};

// ---------------------------------------------------------------------------
// Convenience: build policy sets for a resource
// ---------------------------------------------------------------------------

// Uses individual CRUD operations ("read"/"create"/"update"/"delete") instead
// of the "*" wildcard. This ensures the policy keys exactly match Medusa's
// registered policy set, so syncRegisteredPolicies (soft-delete on startup)
// preserves them rather than soft-deleting them as unrecognized keys.
//
// Prior to 2026-07-15 fix: allCrud emitted a single "resource:*" policy.
// syncRegisteredPolicies creates "resource:read", "resource:create",
// "resource:update", "resource:delete" from route configs — never "resource:*".
// Because the wildcard key didn't match any registered key, it was soft-deleted
// on every server restart, silently stripping the Store Owner of all commerce
// permissions (leaving only the readOnly policies whose keys DID match).
export function allCrud(resource: string): PolicyDef[] {
  return [
    { key: `${resource}:read`, resource, operation: "read" },
    { key: `${resource}:create`, resource, operation: "create" },
    { key: `${resource}:update`, resource, operation: "update" },
    { key: `${resource}:delete`, resource, operation: "delete" },
  ];
}

export function readWrite(resource: string): PolicyDef[] {
  return [
    { key: `${resource}:read`, resource, operation: "read" },
    { key: `${resource}:create`, resource, operation: "create" },
    { key: `${resource}:update`, resource, operation: "update" },
  ];
}

export function readOnly(resource: string): PolicyDef[] {
  return [{ key: `${resource}:read`, resource, operation: "read" }];
}

// ---------------------------------------------------------------------------
// Known bootstrap users — assigned fixed roles on every startup.
//
// SCOPE: These are the known local-dev / test users. This list is explicitly
// NOT a general-purpose auto-assignment mechanism for all future admin users.
// New users get roles via the invite-accept subscriber or manual assignment.
// ---------------------------------------------------------------------------

export async function seedRbacData(
  container: MedusaContainer,
  roleDefs: RoleDef[],
  bootstrapUsers: Array<{ email: string; roleName: string }>,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any;
  const rbacService: IRbacModuleService = container.resolve(Modules.RBAC);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);

  logger.info("[rbac-seed] Starting RBAC seed...");

  // 1. Collect all unique policies across all roles
  const allPolicies = new Map<string, PolicyDef>();
  for (const role of roleDefs) {
    for (const p of role.policies) {
      allPolicies.set(p.key, p);
    }
  }

  // 2. Restore-or-create missing policies (idempotent by key, STABLE IDs)
  //
  // syncRegisteredPolicies (RBAC module onApplicationStart) soft-deletes every
  // policy whose key isn't in the framework's registered Policy enum — which
  // includes all custom keys seeded here (admin_config, refund, capture,
  // credit_line, ...). Re-CREATING them produced a new row (new ID) every
  // boot, while role-policy links kept pointing at the soft-deleted
  // generation whenever a boot was interrupted (e.g. `medusa user` CLI exits
  // mid-seed) — silently stripping permissions from later-seeded roles.
  // RESTORING the soft-deleted row keeps policy IDs stable across boots, so
  // existing links never dangle. (Churn bug — Engram #76, handoff v10.)
  //
  // NOTE: listRbacPolicies({ key: hugeArray }) filter is unreliable with
  // large key sets. List ALL policies (withDeleted) and resolve client-side.
  const allExistingPolicies = await rbacService.listRbacPolicies(
    {},
    { withDeleted: true },
  );

  // Prefer restoring the generation existing role links point at, so a
  // restore re-validates stranded links. Fall back to the newest generation.
  const allExistingLinks = await rbacService.listRbacRolePolicies({}, {});
  const linkedPolicyIds = new Set(
    allExistingLinks.map((l: any) => l.policy_id),
  );

  const activeKeys = new Set<string>();
  const restorableByKey = new Map<string, any>();
  for (const p of allExistingPolicies as any[]) {
    if (!allPolicies.has(p.key)) continue;
    if (!p.deleted_at) {
      activeKeys.add(p.key);
      continue;
    }
    const cur = restorableByKey.get(p.key);
    const curLinked = cur ? linkedPolicyIds.has(cur.id) : false;
    const pLinked = linkedPolicyIds.has(p.id);
    if (
      !cur ||
      (pLinked && !curLinked) ||
      (pLinked === curLinked && p.created_at > cur.created_at)
    ) {
      restorableByKey.set(p.key, p);
    }
  }

  const policiesToRestore: string[] = [];
  const policiesToCreate: any[] = [];
  for (const [key, def] of allPolicies) {
    if (activeKeys.has(key)) continue;
    const candidate = restorableByKey.get(key);
    if (candidate) {
      policiesToRestore.push(candidate.id);
    } else {
      policiesToCreate.push({
        key: def.key,
        resource: def.resource,
        operation: def.operation,
        name: def.name || def.key,
        description: `Auto-seeded: ${def.resource}:${def.operation}`,
      });
    }
  }

  if (policiesToRestore.length > 0) {
    await rbacService.restoreRbacPolicies(policiesToRestore);
    logger.info(
      `[rbac-seed] Restored ${policiesToRestore.length} soft-deleted policies`,
    );
  }

  if (policiesToCreate.length > 0) {
    try {
      await rbacService.createRbacPolicies(policiesToCreate);
      logger.info(
        `[rbac-seed] Created ${policiesToCreate.length} new policies`,
      );
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        logger.warn(
          `[rbac-seed] Some policies already exist (race) — continuing`,
        );
      } else {
        throw err;
      }
    }
  }

  // Re-fetch all policies to get their IDs (unfiltered — array key filter is unreliable)
  const allPoliciesNow = await rbacService.listRbacPolicies({}, {});
  const policyMap = new Map(
    allPoliciesNow
      .filter((p: any) => allPolicies.has(p.key))
      .map((p: any) => [p.key, p]),
  );

  // 3. Create roles and diff-sync policy links
  //
  // Links are diff-synced (add missing / remove stale) instead of the old
  // delete-all-then-recreate. With stable policy IDs (restore above), a
  // healthy role is a no-op here, and an interrupted boot leaves links
  // exactly as they were instead of half-rebuilt. (Engram #76.)
  for (const roleDef of roleDefs) {
    const existingRoles = await rbacService.listRbacRoles(
      { name: roleDef.name },
      {},
    );
    let roleId: string;

    if (existingRoles.length > 0) {
      roleId = existingRoles[0].id;
    } else {
      const [created] = await rbacService.createRbacRoles([
        {
          name: roleDef.name,
          description: roleDef.description,
          ...(roleDef.metadata ? { metadata: roleDef.metadata } : {}),
        },
      ]);
      roleId = (created as any).id;
      logger.info(`[rbac-seed] Created role: ${roleDef.name}`);
    }

    const desiredIds = new Set<string>();
    for (const pdef of roleDef.policies) {
      const policy = policyMap.get(pdef.key);
      if (policy) {
        desiredIds.add((policy as any).id);
      } else {
        logger.warn(`[rbac-seed] Policy not found for key: ${pdef.key}`);
      }
    }

    const existingRolePolicies = await rbacService.listRbacRolePolicies(
      { role_id: roleId },
      {},
    );
    const existingPolicyIds = new Set(
      existingRolePolicies.map((rp: any) => rp.policy_id),
    );
    const staleLinkIds = existingRolePolicies
      .filter((rp: any) => !desiredIds.has(rp.policy_id))
      .map((rp: any) => rp.id);
    const rolePolicyData = [...desiredIds]
      .filter((pid) => !existingPolicyIds.has(pid))
      .map((pid) => ({ role_id: roleId, policy_id: pid }));

    if (staleLinkIds.length > 0) {
      await rbacService.deleteRbacRolePolicies(staleLinkIds);
    }

    if (rolePolicyData.length > 0) {
      try {
        await rbacService.createRbacRolePolicies(rolePolicyData);
      } catch (err: any) {
        if (err.message?.includes("already exists")) {
          logger.warn(
            `[rbac-seed] ${roleDef.name}: role-policy links already exist (race) — skipping`,
          );
        } else {
          throw err;
        }
      }
    }
    logger.info(
      `[rbac-seed] ${roleDef.name}: ${desiredIds.size} policies ` +
        `(+${rolePolicyData.length}/-${staleLinkIds.length})`,
    );
  }

  // 4. Assign bootstrap users to their roles (scope: known dev/test users only)
  for (const { email, roleName } of bootstrapUsers) {
    try {
      const { data: users } = await query.graph({
        entity: "user",
        fields: ["id", "email", "rbac_roles.id", "rbac_roles.name"],
        filters: { email },
      });

      const user = users?.[0] as any;
      if (!user) {
        logger.warn(`[rbac-seed] Bootstrap user not found: ${email}`);
        continue;
      }

      const existingRoles = user.rbac_roles ?? [];
      const alreadyAssigned = existingRoles.some(
        (r: any) => r.name === roleName,
      );

      if (alreadyAssigned) {
        logger.info(
          `[rbac-seed] ${email} already has role "${roleName}" — skipping`,
        );
        continue;
      }

      const { data: targetRoles } = await query.graph({
        entity: "rbac_role",
        fields: ["id", "name"],
        filters: { name: roleName },
      });

      const targetRole = targetRoles?.[0] as any;
      if (!targetRole) {
        logger.warn(
          `[rbac-seed] Role "${roleName}" not found (may be a built-in not yet synced) — ` +
            `skipping bootstrap assignment for ${email}`,
        );
        continue;
      }

      await link.create({
        user: { user_id: user.id },
        rbac: { rbac_role_id: targetRole.id },
      });
      logger.info(`[rbac-seed] Assigned "${roleName}" to ${email}`);
    } catch (err: any) {
      logger.error(
        `[rbac-seed] Failed to assign "${roleName}" to ${email}: ${err.message}`,
      );
    }
  }

  logger.info("[rbac-seed] RBAC seed complete");
}
// Template v1.0.1: added compatibility note for custom roles
