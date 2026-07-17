/**
 * Shared RBAC seed logic — used by both the standalone exec script
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

type RoleDef = {
  name: string;
  description: string;
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
function allCrud(resource: string): PolicyDef[] {
  return [
    { key: `${resource}:read`, resource, operation: "read" },
    { key: `${resource}:create`, resource, operation: "create" },
    { key: `${resource}:update`, resource, operation: "update" },
    { key: `${resource}:delete`, resource, operation: "delete" },
  ];
}

function readWrite(resource: string): PolicyDef[] {
  return [
    { key: `${resource}:read`, resource, operation: "read" },
    { key: `${resource}:create`, resource, operation: "create" },
    { key: `${resource}:update`, resource, operation: "update" },
  ];
}

function readOnly(resource: string): PolicyDef[] {
  return [{ key: `${resource}:read`, resource, operation: "read" }];
}

// ---------------------------------------------------------------------------
// Known bootstrap users — assigned fixed roles on every startup.
//
// SCOPE: These are the known local-dev / test users. This list is explicitly
// NOT a general-purpose auto-assignment mechanism for all future admin users.
// New users get roles via the invite-accept subscriber or manual assignment.
// ---------------------------------------------------------------------------

const BOOTSTRAP_USER_ROLES: Array<{ email: string; roleName: string }> = [
  { email: "medusa.test@high6.com", roleName: "Super Admin" },
  { email: "owner.test@high6.dev", roleName: "Store Owner" },
];

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

export const ROLE_DEFINITIONS: RoleDef[] = [
  // 1. Store Owner — explicit business-scope policies (no *:* wildcard)
  // Uses individual CRUD operations matching registered policy keys so
  // syncRegisteredPolicies preserves all policies across server restarts.
  {
    name: "Store Owner",
    description:
      "Full commerce access: manage orders, products, inventory, customers, " +
      "pricing, promotions, fulfillments, returns, settings. " +
      "Read-only on payments and tax providers. " +
      "Can read and assign RBAC roles but cannot manage role/policy definitions. " +
      "Excludes API keys, webhooks, and developer-only technical settings.",
    policies: [
      // ── Orders ──────────────────────────────────────────────
      ...allCrud("order"),
      ...allCrud("order_change"),
      ...allCrud("order_claim"),
      ...allCrud("order_exchange"),
      ...allCrud("credit_line"), // gap: POST /admin/orders/:id/credit-lines (orders/middlewares.js)
      // ── Products & Catalog ─────────────────────────────────
      ...allCrud("product"),
      ...allCrud("product_category"),
      ...allCrud("product_collection"),
      ...allCrud("product_option"),
      ...allCrud("product_option_value"), // gap: product-options/middlewares.js option-value CRUD
      ...allCrud("product_type"),
      ...allCrud("product_tag"),
      ...allCrud("product_variant"),
      // ── Inventory ──────────────────────────────────────────
      ...allCrud("inventory_item"),
      { key: "inventory_item:*", resource: "inventory_item", operation: "*" }, // batch routes use PolicyOperation.ALL
      ...allCrud("inventory_level"),
      { key: "inventory_level:*", resource: "inventory_level", operation: "*" }, // location-levels batch uses PolicyOperation.ALL
      ...allCrud("reservation_item"),
      // ── Pricing ────────────────────────────────────────────
      ...allCrud("price"),
      { key: "price:*", resource: "price", operation: "*" }, // price batch routes use PolicyOperation.ALL
      ...allCrud("price_list"),
      ...allCrud("price_preference"),
      // ── Promotions & Campaigns ─────────────────────────────
      ...allCrud("promotion"),
      ...allCrud("campaign"),
      // ── Customers ──────────────────────────────────────────
      ...allCrud("customer"),
      ...allCrud("customer_address"), // gap: customers/middlewares.js address CRUD
      ...allCrud("customer_group"),
      // ── Payments ───────────────────────────────────────────
      ...readOnly("payment"), // intentionally read-only: payment methods are infra
      ...allCrud("capture"), // gap: POST /admin/payments/:id/capture (payments/middlewares.js)
      ...allCrud("refund"), // gap: POST /admin/payments/:id/refund (payments/middlewares.js)
      ...readOnly("payment_collection"),
      // ── Fulfillment & Shipping ─────────────────────────────
      ...allCrud("fulfillment"),
      ...allCrud("fulfillment_set"),
      ...allCrud("service_zone"), // gap: POST /admin/fulfillment-sets/:id/service-zones (fulfillment-sets/middlewares.js)
      ...readOnly("fulfillment_provider"), // gap: needed to see available providers for shipping setup; read-only (was excluded)
      ...allCrud("shipping_option"),
      ...allCrud("shipping_option_type"),
      ...allCrud("shipping_profile"),
      // ── Returns & Refunds ──────────────────────────────────
      ...allCrud("return"),
      ...allCrud("return_reason"),
      ...allCrud("refund_reason"),
      // ── Store, Regions, Taxes ──────────────────────────────
      ...allCrud("store"),
      ...allCrud("store_locale"),
      ...allCrud("region"),
      ...allCrud("currency"),
      ...allCrud("tax_rate"),
      ...allCrud("tax_region"),
      ...readOnly("tax_provider"), // gap: needed to see available tax providers; read-only (was excluded)
      // ── Multi-language ─────────────────────────────────────
      ...allCrud("translation"), // gap: translations/middlewares.js
      ...allCrud("translation_setting"), // gap: translations/middlewares.js
      // ── Sales Channels & Locations ─────────────────────────
      ...allCrud("stock_location"),
      ...allCrud("sales_channel"),
      // ── Users & Files ──────────────────────────────────────
      ...allCrud("invite"),
      ...allCrud("user"),
      ...allCrud("file"),
      ...readOnly("notification"), // gap: needed for operational visibility; read-only (was excluded)
      // ── Dashboard Layouts ──────────────────────────────────
      ...readOnly("admin_config"),
      // ── Role Assignment (not role management) ──────────────
      { key: "rbac_role:read", resource: "rbac_role", operation: "read" },
      { key: "rbac_role:update", resource: "rbac_role", operation: "update" },
    ],
  },

  // 2. Operations Manager
  {
    name: "Operations Manager",
    description:
      "⚠️ NOT YET VERIFIED — BENCHED. Manages orders, products, inventory, " +
      "and customers. Read-only on pricing and promotions. " +
      "No user management or settings access.",
    metadata: { assignable: false },
    policies: [
      ...allCrud("order"),
      ...readWrite("product"),
      ...readWrite("inventory_item"),
      ...readWrite("customer"),
      ...readOnly("price_list"),
      ...readOnly("promotion"),
    ],
  },

  // 3. Order & Fulfillment Staff
  {
    name: "Order & Fulfillment Staff",
    description:
      "✅ VERIFIED. Processes orders and fulfillments. " +
      "Read-only on products, inventory, and customers. " +
      "Can create fulfillments and view shipping options and stock locations. " +
      "No access to pricing, promotions, or user management.",
    policies: [
      ...readWrite("order"),
      ...readOnly("product"),
      ...readOnly("inventory_item"),
      ...readOnly("customer"),
      ...readWrite("fulfillment"),
      ...readOnly("return"),
      // ── Sub-resource gaps (parent granted, sub-resource needed for detail pages) ──
      {
        key: "product_variant:read",
        resource: "product_variant",
        operation: "read",
      }, // gap: product detail variants list
      {
        key: "reservation_item:read",
        resource: "reservation_item",
        operation: "read",
      }, // gap: inventory detail reservations
      {
        key: "customer_group:read",
        resource: "customer_group",
        operation: "read",
      }, // gap: customer detail groups
      // ── Fulfillment sub-resources (needed to create fulfillments) ──
      {
        key: "stock_location:read",
        resource: "stock_location",
        operation: "read",
      }, // gap: fulfillment Location dropdown
      {
        key: "shipping_option:read",
        resource: "shipping_option",
        operation: "read",
      }, // gap: fulfillment Shipping Method dropdown
      {
        key: "fulfillment_set:read",
        resource: "fulfillment_set",
        operation: "read",
      }, // gap: fulfillment service zones
      {
        key: "fulfillment_provider:read",
        resource: "fulfillment_provider",
        operation: "read",
      }, // gap: fulfillment provider list
    ],
  },

  // 4. Catalog / Product Manager
  {
    name: "Catalog / Product Manager",
    description:
      "⚠️ NOT YET VERIFIED — BENCHED. Full access to products, categories, " +
      "collections, inventory, pricing, and promotions. " +
      "Read-only on orders. No user management or settings access.",
    metadata: { assignable: false },
    policies: [
      ...readOnly("order"),
      ...allCrud("product"),
      ...allCrud("product_category"),
      ...allCrud("product_collection"),
      ...allCrud("product_option"),
      ...allCrud("product_type"),
      ...allCrud("product_tag"),
      ...allCrud("product_variant"),
      ...allCrud("inventory_item"),
      ...allCrud("price_list"),
      ...allCrud("promotion"),
    ],
  },

  // 5. Marketing
  {
    name: "Marketing",
    description:
      "⚠️ NOT YET VERIFIED — BENCHED. Full access to price lists and promotions. " +
      "Read-only on orders, products, and inventory. " +
      "No user management or settings access.",
    metadata: { assignable: false },
    policies: [
      ...readOnly("order"),
      ...readOnly("product"),
      ...readOnly("inventory_item"),
      ...allCrud("price_list"),
      ...allCrud("promotion"),
    ],
  },

  // 6. Customer Support
  {
    name: "Customer Support",
    description:
      "✅ VERIFIED. View and update orders (no delete), manage customers. " +
      "Can issue refunds. Read-only on products and inventory. " +
      "View-only access to Return Reasons and Refund Reasons settings. " +
      "No access to pricing, promotions, or user management.",
    policies: [
      ...readWrite("order"),
      ...readWrite("customer"),
      ...readOnly("product"),
      ...readOnly("inventory_item"),
      // v5 §4.4.4 / v6 §4.4.10: explicitly scoped for refund handling.
      { key: "refund:create", resource: "refund", operation: "create" },
      // Core requires payment:read on ALL /admin/payments/* routes (wildcard
      // matcher in payments/middlewares.js) — the refund POST is unreachable
      // without it. Execution dependency of the approved refund capability,
      // not a scope expansion. Browser-confirmed 403 as support.test 2026-07-16.
      { key: "payment:read", resource: "payment", operation: "read" },
      // Product-owner decision 2026-07-16: view-only access to reason-code
      // lookup data behind refund processing.
      {
        key: "return_reason:read",
        resource: "return_reason",
        operation: "read",
      },
      {
        key: "refund_reason:read",
        resource: "refund_reason",
        operation: "read",
      },
    ],
  },

  // 7. Read-Only / Auditor
  {
    name: "Read-Only / Auditor",
    description:
      "✅ VERIFIED. Read-only access across all commerce resources and settings. " +
      "Can view orders, products, inventory, customers, pricing, and promotions. " +
      "No write, create, or delete access on any resource. " +
      "Assigned manually like every other role — invites now require an explicit role per #81.",
    policies: [
      ...readOnly("order"),
      ...readOnly("product"),
      ...readOnly("inventory_item"),
      ...readOnly("customer"),
      ...readOnly("price_list"),
      ...readOnly("promotion"),
      ...readOnly("store"),
      ...readOnly("region"),
      ...readOnly("currency"),
      ...readOnly("tax_rate"),
      ...readOnly("shipping_option"),
      ...readOnly("shipping_profile"),
      ...readOnly("sales_channel"),
      ...readOnly("fulfillment"),
      ...readOnly("return"),
      ...readOnly("payment"),
      ...readOnly("user"),
      // ── Sub-resource gaps (parent granted, sub-resource needed for detail pages) ──
      { key: "tax_region:read", resource: "tax_region", operation: "read" }, // gap: store settings tax regions
      { key: "store_locale:read", resource: "store_locale", operation: "read" }, // gap: store settings locales
      {
        key: "price_preference:read",
        resource: "price_preference",
        operation: "read",
      }, // gap: store settings price preferences
      // ── Batch: v5 §4.4.2 parent-column resources (Products/Inventory, Pricing/Promos, Customers, Settings) ──
      {
        key: "product_variant:read",
        resource: "product_variant",
        operation: "read",
      }, // gap: product detail variants
      {
        key: "product_category:read",
        resource: "product_category",
        operation: "read",
      }, // gap: product categories sidebar
      {
        key: "product_collection:read",
        resource: "product_collection",
        operation: "read",
      }, // gap: product collections view
      { key: "product_type:read", resource: "product_type", operation: "read" }, // gap: product types filter
      { key: "product_tag:read", resource: "product_tag", operation: "read" }, // gap: product tags filter
      {
        key: "customer_group:read",
        resource: "customer_group",
        operation: "read",
      }, // gap: customer detail groups
      {
        key: "reservation_item:read",
        resource: "reservation_item",
        operation: "read",
      }, // gap: inventory detail reservations
      { key: "campaign:read", resource: "campaign", operation: "read" }, // gap: promotions campaigns
      {
        key: "return_reason:read",
        resource: "return_reason",
        operation: "read",
      }, // gap: returns reasons
      {
        key: "shipping_option_type:read",
        resource: "shipping_option_type",
        operation: "read",
      }, // gap: shipping settings option types
      {
        key: "stock_location:read",
        resource: "stock_location",
        operation: "read",
      }, // gap: inventory/fulfillment locations
    ],
  },

  // 8. Developer / Platform Support
  {
    name: "Developer / Platform Support",
    description:
      "✅ VERIFIED. Manages technical settings: API keys, webhooks, RBAC roles " +
      "and policies, sales channels, payments, and workflow executions. " +
      "Read-only access to orders, products, customers, and inventory for debugging. " +
      "Can create and delete API keys, roles, and sales channels. " +
      "No access to pricing, promotions, or store/region settings.",
    policies: [
      ...allCrud("api_key"),
      ...allCrud("rbac_role"),
      ...allCrud("rbac_policy"),
      ...allCrud("sales_channel"),
      ...allCrud("payment"),
      ...allCrud("workflow_execution"),
      ...allCrud("admin_config"),
      ...readOnly("order"),
      ...readOnly("product"),
      ...readOnly("customer"),
      ...readOnly("inventory_item"),
      ...readOnly("user"),
      // ── Sub-resource reads (v5 §4.4.2: Orders / Products/Inventory /
      // Customers all "Read only (debugging)") — required for those detail
      // pages to render, not a scope expansion. Same batch pattern applied to
      // Read-Only/Auditor. Browser-confirmed 403s as dev.test 2026-07-16:
      // product_variant, stock_location, reservation_item.
      {
        key: "product_variant:read",
        resource: "product_variant",
        operation: "read",
      }, // gap: order detail line items + product detail variants
      {
        key: "product_category:read",
        resource: "product_category",
        operation: "read",
      }, // gap: product detail organize section
      {
        key: "product_collection:read",
        resource: "product_collection",
        operation: "read",
      }, // gap: product detail organize section
      { key: "product_type:read", resource: "product_type", operation: "read" }, // gap: product detail type / list filter
      { key: "product_tag:read", resource: "product_tag", operation: "read" }, // gap: product detail tags / list filter
      {
        key: "reservation_item:read",
        resource: "reservation_item",
        operation: "read",
      }, // gap: inventory detail reservations
      {
        key: "stock_location:read",
        resource: "stock_location",
        operation: "read",
      }, // gap: inventory detail location levels
      {
        key: "customer_group:read",
        resource: "customer_group",
        operation: "read",
      }, // gap: customer detail groups
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed function — idempotent, safe to call repeatedly
// ---------------------------------------------------------------------------

export async function seedRbacData(container: MedusaContainer): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any;
  const rbacService: IRbacModuleService = container.resolve(Modules.RBAC);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);

  logger.info("[rbac-seed] Starting RBAC seed...");

  // 1. Collect all unique policies across all roles
  const allPolicies = new Map<string, PolicyDef>();
  for (const role of ROLE_DEFINITIONS) {
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
  for (const roleDef of ROLE_DEFINITIONS) {
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
  for (const { email, roleName } of BOOTSTRAP_USER_ROLES) {
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
