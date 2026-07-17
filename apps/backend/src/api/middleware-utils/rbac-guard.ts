/**
 * RBAC Enforcement Middleware
 *
 * Applied to /admin/* routes. Resolves the authenticated user's effective
 * permissions and blocks requests that lack the required policy.
 *
 * Design decisions (per plan approval):
 * - Deny-by-default: unmapped URL → 403; no policies on route → 403
 * - Self-endpoints: GET /admin/users/me and GET /admin/me/* skip the policy
 *   check only (auth still enforced) — matches Medusa core, which registers
 *   no policies on GET /admin/users/me (handoff v7 §4.2 lockout fix)
 * - Super admin: *:* wildcard policy handled by framework's hasPermission()
 * - Feature flag: enforcement is a no-op when MEDUSA_FF_RBAC is false
 * - Auth bypass: /admin/auth* routes always pass through
 */

import { hasPermission } from "@medusajs/framework";
import {
  MedusaError,
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

// ---------------------------------------------------------------------------
// URL prefix → resource mapping (complete admin API surface as of Medusa 2.17.2)
//
// Longest-match-first. Each key is a path prefix under /admin; the value is
// the Medusa resource name (matching the Entities enums in core query-config
// files) used in policy checks.
// ---------------------------------------------------------------------------

const URL_RESOURCE_MAP: [string, string][] = [
  // Auth routes — unconditionally bypassed (not checked against RBAC)
  // Handled by the guard before this map is consulted.

  // RBAC — must come before single-segment matchers
  ["rbac/policies", "rbac_policy"],
  ["rbac/roles", "rbac_role"],
  ["rbac/me", "rbac_role"],

  // /me/* endpoints — accessible to all authenticated users (returns own data)
  ["me", "user"],

  // Sub-resources that differ from their parent
  ["orders/export", "order"],
  ["products/export", "product"],
  ["products/import", "product"],
  ["products/imports", "product"],

  // Standard resource → URL prefix (alphabetical)
  ["api-keys", "api_key"],
  ["campaigns", "campaign"],
  ["claims", "order_claim"],
  ["collections", "product_collection"],
  ["currencies", "currency"],
  ["customer-groups", "customer_group"],
  ["customers", "customer"],
  ["draft-orders", "order"],
  ["exchanges", "order_exchange"],
  ["feature-flags", "admin_config"],
  ["fulfillment-providers", "fulfillment_provider"],
  ["fulfillment-sets", "fulfillment_set"],
  ["fulfillments", "fulfillment"],
  ["index", "admin_config"],
  ["inventory-items", "inventory_item"],
  ["invites", "invite"],
  ["layouts", "admin_config"],
  ["locales", "store_locale"],
  ["notifications", "notification"],
  ["order-changes", "order_change"],
  ["order-edits", "order_change"],
  ["orders", "order"],
  ["payment-collections", "payment_collection"],
  ["payments", "payment"],
  ["plugins", "admin_config"],
  ["price-lists", "price_list"],
  ["price-preferences", "price_preference"],
  ["product-categories", "product_category"],
  ["product-options", "product_option"],
  ["product-tags", "product_tag"],
  ["product-types", "product_type"],
  ["product-variants", "product_variant"],
  ["products", "product"],
  ["promotions", "promotion"],
  ["property-labels", "property_label"],
  ["refund-reasons", "refund_reason"],
  ["regions", "region"],
  ["reservations", "reservation_item"],
  ["return-reasons", "return_reason"],
  ["returns", "return"],
  ["sales-channels", "sales_channel"],
  ["shipping-option-types", "shipping_option_type"],
  ["shipping-options", "shipping_option"],
  ["shipping-profiles", "shipping_profile"],
  ["stock-locations", "stock_location"],
  ["stores", "store"],
  ["tax-providers", "tax_provider"],
  ["tax-rates", "tax_rate"],
  ["tax-regions", "tax_region"],
  ["translations", "translation"],
  ["uploads", "file"],
  ["users", "user"],
  ["views", "admin_config"],
  ["workflows-executions", "workflow_execution"],
];

// ---------------------------------------------------------------------------
// Sub-resource routes — dynamic paths where the resource differs from the
// parent URL prefix. These endpoints contain a dynamic :id segment, so they
// can't be matched by the static prefix map. Checked BEFORE URL_RESOURCE_MAP.
//
// Sourced from Medusa's own middlewares.js files (v2.17.2):
//   payments/middlewares.js → refund, capture
//   orders/middlewares.js   → credit_line, fulfillment (sub-routes)
// ---------------------------------------------------------------------------

const SUB_RESOURCE_MAP: [RegExp, string][] = [
  // POST /admin/payments/:id/refund  → refund:create (payments/middlewares.js)
  [/^payments\/[^/]+\/refund$/, "refund"],
  // POST /admin/payments/:id/capture → capture:create (payments/middlewares.js)
  [/^payments\/[^/]+\/capture$/, "capture"],
  // POST /admin/orders/:id/credit-lines → credit_line:create (orders/middlewares.js)
  [/^orders\/[^/]+\/credit-lines$/, "credit_line"],
  // POST /admin/orders/:id/fulfillments → fulfillment:create (orders/middlewares.js)
  [/^orders\/[^/]+\/fulfillments$/, "fulfillment"],
  // POST /admin/orders/:id/fulfillments/:fid/{cancel,shipments,mark-as-delivered}
  // → fulfillment:update (orders/middlewares.js)
  [
    /^orders\/[^/]+\/fulfillments\/[^/]+\/(cancel|shipments|mark-as-delivered)$/,
    "fulfillment",
  ],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Medusa's built-in routes use `create` for POST-to-collection and `update`
// for POST-to-resource. Since we can't distinguish from URL alone, we pass
// both — the guard checks each op separately and allows if ANY passes (the
// framework's hasPermission() itself is ALL-required for arrays; see the
// operation loop in rbacGuard below).
const HTTP_OPERATION_MAP: Record<string, string | string[]> = {
  GET: "read",
  HEAD: "read",
  POST: ["create", "update"],
  DELETE: "delete",
};

/**
 * Self-endpoints — routes that return only the authenticated actor's OWN data.
 *
 * Medusa core registers NO policies on GET /admin/users/me (the only
 * /admin/users route in users/middlewares.js without a `policies` array) —
 * upstream design is that any authenticated admin can read their own identity.
 * The custom GET /admin/me/permissions endpoint exists so the dashboard can
 * discover the current user's permissions, so it must be readable before any
 * policy is known. Policy-checking these creates a bootstrap deadlock for
 * roles without user:read: the dashboard calls GET /admin/users/me on every
 * page load, locking those roles out entirely (handoff v7 §4.2).
 *
 * Scope is deliberately as narrow as Medusa core's own policy surface:
 * read-only (GET/HEAD), exact `users/me`, and `me`/`me/*` only.
 * /admin/users, /admin/users/:id (including :id="me" sub-routes like
 * /admin/users/me/roles), and the dead /admin/rbac/me/* route all remain
 * policy-checked. Authentication is NOT bypassed — the framework's
 * authenticate middleware still rejects anonymous requests to these routes.
 */
export function isSelfEndpoint(method: string, urlPath: string): boolean {
  const m = method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") {
    return false;
  }
  const path = urlPath.replace(/^\/admin\//, "").split("?")[0];
  return path === "users/me" || path === "me" || path.startsWith("me/");
}

/**
 * Resolve the URL path (relative to /admin) to a resource name.
 * Returns null for unmapped paths (→ 403 deny-by-default).
 */
function resolveResource(pathname: string): string | null {
  // Strip /admin/ prefix
  const path = pathname.replace(/^\/admin\//, "");

  // 1. Check sub-resource map first — dynamic paths with :id segments where
  //    the resource differs from the parent URL prefix (e.g. refund under
  //    /admin/payments/:id/refund maps to "refund", not "payment").
  for (const [regex, resource] of SUB_RESOURCE_MAP) {
    if (regex.test(path)) {
      return resource;
    }
  }

  // 2. Check static prefix map (longest-match-first by construction)
  for (const [prefix, resource] of URL_RESOURCE_MAP) {
    if (
      path === prefix ||
      path.startsWith(prefix + "/") ||
      path.startsWith(prefix + "?")
    ) {
      return resource;
    }
  }

  return null;
}

/**
 * Resolve the HTTP method to an RBAC operation.
 */
function resolveOperation(method: string): string | string[] {
  return HTTP_OPERATION_MAP[method.toUpperCase()] || "read";
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export async function rbacGuard(
  req: MedusaRequest,
  res: MedusaResponse,
  next: () => void,
): Promise<void> {
  // 1. Auth bypass — authentication endpoints must always pass
  const urlPath = req.originalUrl || req.url || "";
  if (
    urlPath.startsWith("/admin/auth") ||
    urlPath.startsWith("/admin/cloud/auth")
  ) {
    return next();
  }

  // 2. Self-endpoint bypass — own-data reads skip the policy check ONLY.
  // Authentication is still enforced by the framework's authenticate
  // middleware; anonymous requests to these routes are rejected there.
  if (isSelfEndpoint(req.method, urlPath)) {
    return next();
  }

  // 3. Determine resource + operation
  const resource = resolveResource(urlPath);
  if (!resource) {
    // Deny-by-default: unmapped route
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
    logger.warn(
      `[rbac-guard] Unmapped admin route blocked: ${req.method} ${urlPath}`,
    );
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You don't have permission to do this. Contact your administrator if you think this is a mistake.",
    );
  }

  const operation = resolveOperation(req.method);

  // 4. Get authenticated actor
  const actorId = (req as any).auth_context?.actor_id;
  const actorType = (req as any).auth_context?.actor_type;

  if (!actorId || !actorType) {
    // No authenticated user — let the authenticate middleware handle this
    return next();
  }

  // 5. Get user's role IDs
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: actors } = await query.graph({
    entity: actorType,
    fields: ["id", "rbac_roles.id"],
    filters: { id: actorId },
  });

  const roleIds: string[] =
    actors?.[0]?.rbac_roles?.map((r: any) => r.id).filter(Boolean) ?? [];

  // Decision #81: a user may never exist without a role. If the actor somehow
  // has zero roles (legacy path, unguarded direct DB manipulation, or a race
  // before the backstop subscriber fires), deny immediately rather than feeding
  // an empty list into hasPermission() — which short-circuits to `return true`
  // when roleIds.length is 0 (#82 HIGH — fail-open roleless-permission hole).
  // Self-endpoints and auth routes are already bypassed before this point, so
  // a legacy roleless user can still sign in but can touch nothing else.
  if (roleIds.length === 0) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
    logger.warn(
      `[rbac-guard] Denied roleless actor ${actorId} (${actorType}) — zero roles. ` +
        `This state should be unreachable per #81. Investigate how this user lost all roles.`,
    );
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You don't have permission to do this. Contact your administrator if you think this is a mistake.",
    );
  }

  // 6. Check permission
  //
  // IMPORTANT: the framework's hasPermission() treats an operation ARRAY as
  // ALL-required (AND) — it returns false unless the role holds EVERY op in
  // the list (has-permission.js: `if (!policyAllows(...)) return false`).
  // POST maps to ["create","update"] because Medusa uses POST for both, so a
  // role holding exactly one of the two (e.g. Customer Support's
  // refund:create, Store Owner's rbac_role:update) was wrongly denied every
  // POST on that resource. Enforce the intended ANY semantics by checking
  // each operation separately and allowing if any single one passes.
  const operations = Array.isArray(operation) ? operation : [operation];
  let allowed = false;
  for (const op of operations) {
    if (
      await hasPermission({
        roles: roleIds,
        actions: { resource, operation: op },
        container: req.scope,
      })
    ) {
      allowed = true;
      break;
    }
  }

  if (!allowed) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You don't have permission to do this. Contact your administrator if you think this is a mistake.",
    );
  }

  next();
}
