/**
 * Nav-route → required-permission map for the RBAC sidebar filter.
 *
 * Single source of truth for which permission each dashboard nav item needs.
 * Mirrors the SEMANTICS of the backend guard's URL_RESOURCE_MAP
 * (src/api/middleware-utils/rbac-guard.ts): a nav item is visible iff the
 * user could actually GET the corresponding admin API resource — so nav
 * visibility always matches real route enforcement, for any role, with no
 * role-name branches. When URL_RESOURCE_MAP gains/loses a resource, update
 * the affected entries here.
 *
 * Keys are dashboard router paths (href pathname minus the admin base path,
 * e.g. "/app"). Values are the required "resource:operation" permission.
 * Routes NOT listed here are never hidden (fail-open for nav; the rbacGuard
 * still enforces access on click) — except that every route rendered by
 * @medusajs/dashboard's useCoreRoutes/useSettingRoutes as of 2.17.2 IS
 * listed, so fail-open only applies to future/extension routes.
 *
 * /settings and /settings/profile are deliberately absent: profile is
 * self-data (same philosophy as the guard's self-endpoint bypass, handoff v7
 * §4.2) and the Settings entry must stay reachable for it.
 */
export const NAV_ROUTE_PERMISSIONS: Record<string, string> = {
  // ── Main nav (useCoreRoutes) ─────────────────────────────────
  "/orders": "order:read",
  "/draft-orders": "order:read", // guard maps draft-orders → order
  "/products": "product:read",
  "/collections": "product_collection:read",
  "/categories": "product_category:read",
  "/product-options": "product_option:read",
  "/gift-cards": "gift_card:read", // no guard mapping → deny-by-default; hidden until a policy exists
  "/inventory": "inventory_item:read",
  "/reservations": "reservation_item:read",
  "/customers": "customer:read",
  "/customer-groups": "customer_group:read",
  "/promotions": "promotion:read",
  "/campaigns": "campaign:read",
  "/price-lists": "price_list:read",

  // ── Settings nav (useSettingRoutes + useDeveloperRoutes) ─────
  "/settings/store": "store:read",
  "/settings/users": "user:read",
  "/settings/regions": "region:read",
  "/settings/locations": "stock_location:read",
  "/settings/sales-channels": "sales_channel:read",
  "/settings/product-types": "product_type:read",
  "/settings/product-tags": "product_tag:read",
  "/settings/tax-regions": "tax_region:read",
  "/settings/return-reasons": "return_reason:read",
  "/settings/refund-reasons": "refund_reason:read",
  "/settings/translations": "translation:read",
  "/settings/publishable-api-keys": "api_key:read",
  "/settings/secret-api-keys": "api_key:read",
  "/settings/workflows": "workflow_execution:read",
  "/settings/roles": "rbac_role:read",
  "/settings/policies": "rbac_policy:read",
};

/**
 * Action-link routes → required permission. Same idea as NAV_ROUTE_PERMISSIONS
 * but for WRITE-action links rendered inside pages the user can otherwise
 * see: "Create" buttons (route-modal anchors, e.g. <Link to="create">),
 * product Import/Export. Hiding these fixes the "button is visible but denies
 * on click" UX for read-only access to a page.
 *
 * These are matched by href PREFIX (they may carry ?query suffixes like
 * import/export's `${location.search}`), unlike nav routes which are matched
 * exactly. Prefixes here are terminal path segments, so prefix matching
 * cannot collide the way "/orders" vs "/draft-orders" would.
 *
 * NOT covered (needs a per-page pass, tracked as follow-up): in-page action
 * MENUS that are buttons rather than anchors — e.g. row Delete menus, and
 * order-detail flows (returns/claims/exchanges/edits/refunds map to their own
 * resources: return, order_claim, order_exchange, order_change, refund).
 */
export const ACTION_ROUTE_PERMISSIONS: Record<string, string> = {
  "/draft-orders/create": "order:create",
  "/products/create": "product:create",
  "/products/import": "product:create",
  "/products/export": "product:update", // API: POST /admin/products/export → create|update
  "/collections/create": "product_collection:create",
  "/categories/create": "product_category:create",
  "/customers/create": "customer:create",
  "/customers/import": "customer:create",
  "/customer-groups/create": "customer_group:create",
  "/inventory/create": "inventory_item:create",
  "/reservations/create": "reservation_item:create",
  "/promotions/create": "promotion:create",
  "/campaigns/create": "campaign:create",
  "/price-lists/create": "price_list:create",
  "/settings/users/invite": "invite:create",
  "/settings/regions/create": "region:create",
  "/settings/locations/create": "stock_location:create",
  "/settings/sales-channels/create": "sales_channel:create",
  "/settings/product-types/create": "product_type:create",
  "/settings/product-tags/create": "product_tag:create",
  "/settings/tax-regions/create": "tax_region:create",
  "/settings/return-reasons/create": "return_reason:create",
  "/settings/refund-reasons/create": "refund_reason:create",
  "/settings/publishable-api-keys/create": "api_key:create",
  "/settings/secret-api-keys/create": "api_key:create",
};

/**
 * Compute the nav routes to hide for a user, given their REAL permission set
 * (the /admin/me/permissions payload — resolved from the same RBAC policy
 * data the rbacGuard enforces with).
 *
 * Per-item: each route is gated by its own permission. This intentionally
 * replaces the old any-of gate (RESTRICTED_PERMISSIONS.some(...)), which
 * showed ALL Developer items as soon as the user held ANY one of them —
 * e.g. Store Owner gaining rbac_role:read (§2.4 round 2) silently unhid
 * API Keys and Workflows again.
 */
export function computeHiddenRoutes(permissions: string[]): string[] {
  const granted = new Set(permissions);
  // Wildcard *:* (Super Admin) — nothing is hidden
  if (granted.has("*:*")) return [];
  return Object.entries(NAV_ROUTE_PERMISSIONS)
    .filter(([, required]) => !granted.has(required))
    .map(([route]) => route);
}

/**
 * Compute the action-link routes (create/import/export) to hide, same
 * contract as computeHiddenRoutes but over ACTION_ROUTE_PERMISSIONS.
 */
export function computeHiddenActionRoutes(permissions: string[]): string[] {
  const granted = new Set(permissions);
  // Wildcard *:* (Super Admin) — nothing is hidden
  if (granted.has("*:*")) return [];
  return Object.entries(ACTION_ROUTE_PERMISSIONS)
    .filter(([, required]) => !granted.has(required))
    .map(([route]) => route);
}

// ---------------------------------------------------------------------------
// Delete-action hiding (b1 — MutationObserver strategy, v9 §8)
//
// Delete actions are <button> elements inside <ActionMenu> / DataTable
// dropdowns, not <a> anchors. The CSS-selector-on-href approach from
// ACTION_ROUTE_PERMISSIONS cannot target them. Instead, rbac-sidebar-filter.tsx
// uses a MutationObserver to find [role="menuitem"] elements containing BOTH
// the label text "Delete" AND an SVG icon, and hides them on pages whose
// resource lacks delete permission.
//
// Escalation path (b2): if browser verification shows any location failing to
// hide, escalate that specific location to a patch-package + usePermissions()
// check inside the Medusa dashboard source component, rather than adding
// increasingly specific MutationObserver hacks. Trigger: any Delete item still
// visible on first real-browser click despite the MutationObserver.
// ---------------------------------------------------------------------------

/**
 * URL path prefix → required delete permission.
 *
 * When a user is viewing a page matching one of these prefixes AND lacks the
 * mapped permission, all Delete-labeled menu items on the page are hidden by
 * the MutationObserver in rbac-sidebar-filter.tsx.
 */
export const DELETE_RESOURCE_MAP: Record<string, string> = {
  // ── Primary list pages ──────────────────────────────────
  "/products": "product:delete",
  "/inventory": "inventory_item:delete",
  "/customers": "customer:delete",
  "/promotions": "promotion:delete",
  "/campaigns": "campaign:delete",
  "/price-lists": "price_list:delete",
  "/collections": "product_collection:delete",
  "/categories": "product_category:delete",
  "/customer-groups": "customer_group:delete",
  "/shipping-profiles": "shipping_profile:delete",
  // ── Settings sub-pages ──────────────────────────────────
  "/settings/users": "user:delete",
  "/settings/regions": "region:delete",
  "/settings/locations": "stock_location:delete",
  "/settings/sales-channels": "sales_channel:delete",
  "/settings/product-types": "product_type:delete",
  "/settings/product-tags": "product_tag:delete",
  "/settings/tax-regions": "tax_region:delete",
  "/settings/return-reasons": "return_reason:delete",
  "/settings/refund-reasons": "refund_reason:delete",
};

/**
 * Returns the URL prefixes whose delete permission the user lacks.
 * Used by rbac-sidebar-filter.tsx to decide whether to hide Delete items
 * on the current page.
 */
export function computeResourcesWithoutDelete(permissions: string[]): string[] {
  const granted = new Set(permissions);
  // Wildcard *:* (Super Admin) — nothing is hidden
  if (granted.has("*:*")) return [];
  return Object.entries(DELETE_RESOURCE_MAP)
    .filter(([, required]) => !granted.has(required))
    .map(([path]) => path);
}

// ---------------------------------------------------------------------------
// Settings landing-page computation
// ---------------------------------------------------------------------------

/**
 * Settings sub-pages in sidebar display order with their required permissions.
 * When the user clicks "Settings" in the main nav, they should land on the
 * FIRST page in this list they have access to — not a hardcoded /settings/store
 * (which throws 400 for any role without store:read).
 *
 * Mirrors the useSettingRoutes() order in Medusa's settings-layout.tsx.
 * Profile is deliberately the fallback — it appears last here but is always
 * accessible (self-endpoint bypass on rbacGuard), so a role with zero settings
 * permissions still lands somewhere usable instead of a 400.
 */
const SETTINGS_PAGE_PERMISSIONS: [string, string][] = [
  ["/settings/store", "store:read"],
  ["/settings/users", "user:read"],
  ["/settings/roles", "rbac_role:read"],
  ["/settings/policies", "rbac_policy:read"],
  ["/settings/regions", "region:read"],
  ["/settings/tax-regions", "tax_region:read"],
  ["/settings/return-reasons", "return_reason:read"],
  ["/settings/refund-reasons", "refund_reason:read"],
  ["/settings/sales-channels", "sales_channel:read"],
  ["/settings/product-types", "product_type:read"],
  ["/settings/product-tags", "product_tag:read"],
  ["/settings/locations", "stock_location:read"],
  ["/settings/translations", "translation:read"],
  ["/settings/publishable-api-keys", "api_key:read"],
  ["/settings/secret-api-keys", "api_key:read"],
  ["/settings/workflows", "workflow_execution:read"],
  // Always-accessible fallback — last resort
  ["/settings/profile", "__always__"],
];

/**
 * Returns the best Settings landing page for the given permission set.
 * Walks SETTINGS_PAGE_PERMISSIONS in order and returns the first route the
 * user can access. Profile is the final fallback (always accessible via
 * rbacGuard's self-endpoint bypass).
 *
 * This is STRUCTURAL, not per-role — the same logic works for Customer
 * Support (only Profile), Operations Manager (whatever subset they have),
 * Store Owner (first match = Store), and any future role with zero changes.
 */
export function computeSettingsLandingPage(permissions: string[]): string {
  const granted = new Set(permissions);
  // Wildcard *:* (Super Admin) — first settings page (Store)
  if (granted.has("*:*")) return SETTINGS_PAGE_PERMISSIONS[0][0];
  for (const [route, required] of SETTINGS_PAGE_PERMISSIONS) {
    if (required === "__always__" || granted.has(required)) {
      return route;
    }
  }
  // Unreachable — Profile is always in the list with __always__
  return "/settings/profile";
}
