/**
 * Subscriber: assign default role on invite accept (DEFENSE-IN-DEPTH)
 *
 * Decision #81 (2026-07-17, supersedes v9 §7): a user may never exist
 * without a role. The primary enforcement is now server-side:
 *   - inviteRolesRequiredGuard — POST /admin/invites rejects empty roles
 *   - lastRoleRemovalGuard — blocks removing a user's only role
 *   - rbac-guard.ts — fail-closed for roleless actors (#82)
 *
 * This subscriber serves as a BACKSTOP for legacy/edge paths that those
 * guards don't cover — particularly invite-accept workflows where the
 * invite predates the guard, or direct DB manipulation. It should rarely
 * fire in normal operation; if it does fire, investigate what bypassed
 * the guards.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  InviteWorkflowEvents,
  Modules,
} from "@medusajs/framework/utils";
import type { IRbacModuleService } from "@medusajs/types";

const DEFAULT_ROLE_NAME = "Read-Only / Auditor";

export default async function assignDefaultRoleOnInviteAccept({
  event,
  container,
}: SubscriberArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const rbacService: IRbacModuleService = container.resolve(Modules.RBAC);

  const { id: inviteId } = event.data as { id: string };

  // Find the user created from this invite by email
  const { data: invites } = await query.graph({
    entity: "invite",
    fields: ["id", "email"],
    filters: { id: inviteId },
  });

  const email = invites?.[0]?.email;
  if (!email) {
    logger.warn(`[assign-default-role] Invite ${inviteId} not found`);
    return;
  }

  const { data: users } = await query.graph({
    entity: "user",
    fields: ["id", "email", "rbac_roles.id"],
    filters: { email },
  });

  const user = users?.[0];
  if (!user) {
    logger.warn(`[assign-default-role] No user found for email ${email}`);
    return;
  }

  // Check if user already has roles
  const existingRoles = (user as any).rbac_roles ?? [];
  if (existingRoles.length > 0) {
    logger.info(
      `[assign-default-role] User ${user.id} already has ${existingRoles.length} role(s) — skipping`,
    );
    return;
  }

  // BACKSTOP: user has zero roles — this should be unreachable per #81.
  // Log as warn so it surfaces; if it fires, investigate what bypassed
  // the inviteRolesRequiredGuard / lastRoleRemovalGuard.
  logger.warn(
    `[assign-default-role] User ${user.id} accepted invite with NO roles — ` +
    `assigning backstop default (see #81). The invite-accept path should have ` +
    `been guarded upstream.`,
  );

  // Find the default Read-Only role
  const defaultRoles = await rbacService.listRbacRoles(
    { name: DEFAULT_ROLE_NAME },
    {},
  );

  if (!defaultRoles.length) {
    logger.error(
      `[assign-default-role] Default role "${DEFAULT_ROLE_NAME}" not found`,
    );
    return;
  }

  const defaultRoleId = defaultRoles[0].id;

  // Assign default role via remote link (same mechanism as createUsersWorkflow)
  try {
    const link = container.resolve(ContainerRegistrationKeys.LINK);
    await link.create({
      user: { user_id: user.id },
      rbac: { rbac_role_id: defaultRoleId },
    });
    logger.info(
      `[assign-default-role] Assigned "${DEFAULT_ROLE_NAME}" to user ${user.id} (${email})`,
    );
  } catch (err: any) {
    logger.error(
      `[assign-default-role] Failed to assign default role: ${err.message}`,
    );
  }
}

export const config: SubscriberConfig = {
  event: InviteWorkflowEvents.ACCEPTED,
};
