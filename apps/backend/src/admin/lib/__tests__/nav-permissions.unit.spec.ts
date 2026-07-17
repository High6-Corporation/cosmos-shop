/**
 * Unit tests for the role-agnostic nav-visibility computation.
 *
 * Permission fixtures below are the REAL seeded policy sets (DB-verified in
 * the v7 §4.2 / sidebar-filter sessions), so these tests double as a spec of
 * expected sidebar state per role. No role names exist in the implementation
 * — a "role" here is nothing but its permission set.
 */
import {
  NAV_ROUTE_PERMISSIONS,
  computeHiddenActionRoutes,
  computeHiddenRoutes,
  computeResourcesWithoutDelete,
  computeSettingsLandingPage,
} from "../nav-permissions";

// Customer Support: 11 policies (DB-verified 2026-07-16: 9 prior +
// return_reason:read + refund_reason:read from settings-scope session)
const CUSTOMER_SUPPORT = [
  "order:read",
  "order:create",
  "order:update",
  "customer:read",
  "customer:create",
  "customer:update",
  "product:read",
  "inventory_item:read",
  "refund:create",
  "return_reason:read",
  "refund_reason:read",
];

describe("computeHiddenRoutes", () => {
  it("hides nothing for a wildcard-free full permission set", () => {
    const everything = Object.values(NAV_ROUTE_PERMISSIONS);
    expect(computeHiddenRoutes(everything)).toEqual([]);
  });

  it("hides everything for an empty permission set (roleless user)", () => {
    const hidden = computeHiddenRoutes([]);
    expect(hidden.sort()).toEqual(Object.keys(NAV_ROUTE_PERMISSIONS).sort());
  });

  describe("Customer Support (the v7 §4.2-follow-up symptom)", () => {
    const hidden = computeHiddenRoutes(CUSTOMER_SUPPORT);

    it.each([
      "/orders",
      "/draft-orders",
      "/products",
      "/customers",
      "/inventory",
    ])("keeps %s visible", (route) => {
      expect(hidden).not.toContain(route);
    });

    it.each([
      "/promotions",
      "/campaigns",
      "/price-lists",
      "/categories",
      "/collections",
      "/customer-groups",
      "/settings/store",
      "/settings/users",
      "/settings/publishable-api-keys",
      "/settings/workflows",
      "/settings/roles",
    ])("hides %s (deny-on-click today)", (route) => {
      expect(hidden).toContain(route);
    });

    it("keeps Return/Refund Reasons settings visible (granted read access)", () => {
      expect(hidden).not.toContain("/settings/return-reasons");
      expect(hidden).not.toContain("/settings/refund-reasons");
    });
  });

  describe("per-item gating (regression: any-of Developer gate)", () => {
    it("a user with ONLY rbac_role:read still has api-keys and workflows hidden", () => {
      // Store Owner gained rbac_role:read in §2.4 round 2; under the old
      // RESTRICTED_PERMISSIONS.some() gate that unhid ALL Developer items.
      const hidden = computeHiddenRoutes(["rbac_role:read"]);
      expect(hidden).not.toContain("/settings/roles");
      expect(hidden).toContain("/settings/publishable-api-keys");
      expect(hidden).toContain("/settings/secret-api-keys");
      expect(hidden).toContain("/settings/workflows");
      expect(hidden).toContain("/settings/policies");
    });
  });

  it("never hides unmapped routes (fail-open for extensions) or /settings itself", () => {
    const hidden = computeHiddenRoutes([]);
    expect(hidden).not.toContain("/settings");
    expect(hidden).not.toContain("/settings/profile");
    expect(hidden).not.toContain("/some-future-extension");
  });
});

describe("computeHiddenActionRoutes", () => {
  it("hides write-action links for read-only page access (Customer Support on Products/Inventory)", () => {
    const hidden = computeHiddenActionRoutes(CUSTOMER_SUPPORT);
    expect(hidden).toContain("/products/create");
    expect(hidden).toContain("/products/import");
    expect(hidden).toContain("/products/export");
    expect(hidden).toContain("/inventory/create");
    expect(hidden).toContain("/reservations/create");
  });

  it("keeps action links the user can actually perform (Customer Support creates orders/customers)", () => {
    const hidden = computeHiddenActionRoutes(CUSTOMER_SUPPORT);
    expect(hidden).not.toContain("/draft-orders/create");
    expect(hidden).not.toContain("/customers/create");
    expect(hidden).not.toContain("/customers/import");
  });

  it("gates each action by its own permission, not the page's read permission", () => {
    // read-only product access must not unlock product writes
    const hidden = computeHiddenActionRoutes(["product:read"]);
    expect(hidden).toContain("/products/create");
    expect(hidden).toContain("/products/import");
    expect(hidden).toContain("/products/export");
  });
});

describe("computeSettingsLandingPage", () => {
  it("returns /settings/store for Store Owner (has store:read)", () => {
    const landing = computeSettingsLandingPage([
      "store:read",
      "user:read",
      "customer:read",
    ]);
    expect(landing).toBe("/settings/store");
  });

  it("returns /settings/return-reasons for Customer Support (has return_reason:read, first in order)", () => {
    const landing = computeSettingsLandingPage(CUSTOMER_SUPPORT);
    expect(landing).toBe("/settings/return-reasons");
  });

  it("returns /settings/profile for empty permissions (roleless user)", () => {
    const landing = computeSettingsLandingPage([]);
    expect(landing).toBe("/settings/profile");
  });

  it("returns first accessible page in sidebar order", () => {
    // User has region:read and sales_channel:read but NOT store:read or user:read
    const landing = computeSettingsLandingPage([
      "region:read",
      "sales_channel:read",
    ]);
    // regions comes before sales-channels in the list
    expect(landing).toBe("/settings/regions");
  });

  it("returns /settings/users when user:read is the first match", () => {
    const landing = computeSettingsLandingPage(["user:read"]);
    expect(landing).toBe("/settings/users");
  });

  it("skips unmatched entries and falls through to the first match", () => {
    // translations is late in the list, user has only that
    const landing = computeSettingsLandingPage(["translation:read"]);
    expect(landing).toBe("/settings/translations");
  });
});

// ---------------------------------------------------------------------------
// Super Admin wildcard (*:*) — nothing hidden, everything visible
// ---------------------------------------------------------------------------

describe("Super Admin wildcard (*:*)", () => {
  const wildcard = ["*:*"];

  it("hides zero nav routes", () => {
    expect(computeHiddenRoutes(wildcard)).toEqual([]);
  });

  it("hides zero action routes", () => {
    expect(computeHiddenActionRoutes(wildcard)).toEqual([]);
  });

  it("hides zero delete resources", () => {
    expect(computeResourcesWithoutDelete(wildcard)).toEqual([]);
  });

  it("lands on first settings page (/settings/store)", () => {
    expect(computeSettingsLandingPage(wildcard)).toBe("/settings/store");
  });
});
