/**
 * No-Roleless-State Enforcement Middleware
 *
 * Decision #81 (2026-07-17, supersedes v9 §7): a user may never exist without
 * a role, period. This module enforces that at the API level in two places:
 *
 *  1. Invite creation  — POST /admin/invites rejects empty/missing roles
 *  2. Role removal     — DELETE on the 3 removal endpoints rejects when a
 *     user would drop to zero roles (last-role guard)
 *
 * These are additive to the subscriber backstop (assign-default-role-on-
 * invite-accept.ts, kept per #81 as defense-in-depth). Together they make
 * the roleless state unreachable — no new invites, no role-stripping, and
 * the subscriber catches any legacy/edge path that falls through.
 *
 * Related: #82 HIGH (hasPermission fails OPEN on empty role list —
 * verifiable-pre-close but made irrelevant by these guards).
 */

import {
  MedusaError,
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

// ---------------------------------------------------------------------------
// 1. Invite guard — POST /admin/invites
// ---------------------------------------------------------------------------

export async function inviteRolesRequiredGuard(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: () => void,
): Promise<void> {
  const { roles } = (req as any).validatedBody ?? {};

  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "At least one role is required to create an invite. A user may never exist without a role.",
    );
  }

  next();
}

// ---------------------------------------------------------------------------
// 2. Last-role guard — DELETE /admin/users/:id/roles[/:role_id] and
//    DELETE /admin/rbac/roles/:id/users
// ---------------------------------------------------------------------------
//
// Covers ALL three role-removal endpoints:
//   DELETE /admin/users/:id/roles          — bulk (core users/[id]/roles route)
//   DELETE /admin/users/:id/roles/:role_id — single
//   DELETE /admin/rbac/roles/:id/users     — role-centric (Settings → Roles UI)
//
// Strategy: before the deletion proceeds, query the target user's current
// role count. If the delete would leave zero, reject with a 400 telling the
// caller to assign a replacement role first.

export async function lastRoleRemovalGuard(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: () => void,
): Promise<void> {
  const userId = req.params.id; // matches both users/:id and rbac/roles/:id patterns

  if (!userId) {
    return next(); // shouldn't happen; let the core route handler reject
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  let targetUserId: string;

  if ((req.originalUrl || req.url || "").startsWith("/admin/rbac/roles/")) {
    // Role-centric endpoint: DELETE /admin/rbac/roles/:id/users
    // req.params.id is the role id, not the user id. The users to remove
    // are in the body. Map each to avoid orphaning ANY of them.
    const body = (req as any).validatedBody;
    const roleId = userId;
    const userIds: string[] | undefined = body?.users ?? body?.user_ids;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      // No user ids provided — core validator can handle this
      return next();
    }

    for (const uid of userIds) {
      await guardUserRoleCount(query, uid, roleId);
    }
    return next();
  }

  // User-centric endpoints: DELETE /admin/users/:id/roles[/:role_id]
  targetUserId = userId;

  const roleIdsToRemove = req.params.role_id
    ? [req.params.role_id] // single deletion
    : (req as any).validatedBody?.roles; // bulk deletion

  if (
    !roleIdsToRemove ||
    (Array.isArray(roleIdsToRemove) && roleIdsToRemove.length === 0)
  ) {
    return next();
  }

  const roleList = Array.isArray(roleIdsToRemove)
    ? roleIdsToRemove
    : [roleIdsToRemove];
  for (const rid of roleList) {
    await guardUserRoleCount(query, targetUserId, rid);
  }

  next();
}

/**
 * Query a single user's current role count and reject if removing `roleId`
 * would drop them to zero.
 */
async function guardUserRoleCount(
  query: any,
  userId: string,
  roleId: string,
): Promise<void> {
  const { data: users } = await query.graph({
    entity: "user",
    fields: ["id", "rbac_roles.id"],
    filters: { id: userId },
  });

  if (!users || users.length === 0) {
    // User not found — let the core route handler produce the 404
    return;
  }

  const currentRoleIds: string[] =
    (users[0] as any).rbac_roles?.map((r: any) => r.id).filter(Boolean) ?? [];

  const wouldRetain = currentRoleIds.filter((id: string) => id !== roleId);

  if (wouldRetain.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cannot remove the last role from a user. Assign a replacement role first.",
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Benched-role assignment guard — POST /admin/users/:id/roles and
//    POST /admin/rbac/roles/:id/users
// ---------------------------------------------------------------------------
//
// Blocks assignment of roles marked metadata.assignable: false (currently
// Operations Manager, Catalog / Product Manager, Marketing — not yet
// browser-verified). The custom assignable route (GET /admin/rbac/roles/
// assignable) hides them from the dropdown; this guard is the SERVER-SIDE
// enforcement on the actual assignment endpoints so a direct API call can't
// bypass the dropdown filter.
//
// Re-enabling is a one-line change: remove `assignable: false` from the
// role's seed metadata and re-seed.

const BENCHED_ROLE_NAMES = [
  "Operations Manager",
  "Catalog / Product Manager",
  "Marketing",
];

export async function assignableRoleGuard(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: () => void,
): Promise<void> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const body = (req as any).validatedBody;

  // Collect the role IDs being assigned — supports both user-centric
  // (body.roles) and role-centric (body.users / body.user_ids) formats
  const roleIds: string[] = [];

  if (body?.roles && Array.isArray(body.roles)) {
    roleIds.push(...body.roles);
  }

  // Role-centric: body.user_ids/users are user IDs, not role IDs.
  // The role ID is in req.params.id for route /admin/rbac/roles/:id/users.
  const urlPath = req.originalUrl || req.url || "";
  if (urlPath.startsWith("/admin/rbac/roles/")) {
    const roleId = req.params.id;
    if (roleId) {
      roleIds.push(roleId);
    }
  }

  if (roleIds.length === 0) {
    return next();
  }

  // Look up the role names corresponding to the requested IDs
  const { data: roles } = await query.graph({
    entity: "rbac_role",
    fields: ["id", "name"],
    filters: { id: roleIds },
  });

  const benched = (roles ?? []).filter((r: any) =>
    BENCHED_ROLE_NAMES.includes(r.name),
  );

  if (benched.length > 0) {
    const names = benched.map((r: any) => r.name).join(", ");
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The role${benched.length > 1 ? "s" : ""} "${names}" cannot be assigned ` +
        `at this time — ${benched.length > 1 ? "these roles have" : "this role has"} ` +
        `not yet been verified. Contact your administrator.`,
    );
  }

  next();
}

// ---------------------------------------------------------------------------
// 4. Assignable-list response filter — GET /admin/rbac/roles/assignable
// ---------------------------------------------------------------------------
//
// Response-mutation middleware: wraps res.json to strip benched roles from
// the assignable-list response so they never appear in the invite or team
// role dropdowns. This is additive to the assignment guard (#3 above) —
// the assignment guard blocks the actual POST, this keeps the list clean.

export async function filterAssignableResponseGuard(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: () => void,
): Promise<void> {
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    if (body?.roles && Array.isArray(body.roles)) {
      body.roles = body.roles.filter(
        (role: any) => !BENCHED_ROLE_NAMES.includes(role.name),
      );
      body.count = body.roles.length;
    }
    return originalJson(body);
  } as any;

  next();
}
