/**
 * GET /admin/me/permissions
 *
 * Returns the authenticated user's effective RBAC permissions as a flat
 * list of "resource:operation" strings (e.g. "product:read", "order:create").
 *
 * Consumed by the rbac-sidebar-filter widget to hide Developer-section nav
 * items from users who lack api_key / rbac_role / workflow_execution access.
 */

import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils";

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const actorId = req.auth_context?.actor_id;

  if (!actorId) {
    res.json({ permissions: [] });
    return;
  }

  // 1. Get the user's role IDs
  const { data: users } = await query.graph({
    entity: "user",
    fields: ["id", "rbac_roles.id"],
    filters: { id: actorId },
  });

  const roleIds: string[] =
    users?.[0]?.rbac_roles?.map((r: any) => r.id).filter(Boolean) ?? [];

  if (!roleIds.length) {
    res.json({ permissions: [] });
    return;
  }

  // 2. Get policies linked to those roles
  // NOTE: listRbacRolePolicies and listRbacPolicies with array filters ({ role_id: [...],
  // { id: [...] }) are unreliable with large arrays (Medusa's RBAC module may not support
  // array filtering). List ALL unfiltered and filter client-side instead.
  const rbacService = req.scope.resolve(Modules.RBAC);
  const allRolePolicies = await rbacService.listRbacRolePolicies({}, {});

  const policyIds = [
    ...new Set(
      allRolePolicies
        .filter((rp: any) => roleIds.includes(rp.role_id))
        .map((rp: any) => rp.policy_id)
        .filter(Boolean),
    ),
  ];

  if (!policyIds.length) {
    res.json({ permissions: [] });
    return;
  }

  // 3. Resolve policy keys (unfiltered, filter client-side)
  const allPolicies = await rbacService.listRbacPolicies(
    {},
    { select: ["id", "key"] },
  );

  const policyKeyMap = new Map(allPolicies.map((p: any) => [p.id, p.key]));
  const permissionKeys = policyIds
    .map((id) => policyKeyMap.get(id))
    .filter(Boolean) as string[];

  res.json({ permissions: permissionKeys });
}
