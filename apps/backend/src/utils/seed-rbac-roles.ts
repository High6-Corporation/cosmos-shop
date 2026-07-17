/**
 * RBAC Role Definitions — DATA ONLY (client-owned).
 *
 * These are DEFAULT roles provided by the template. Clients may add, remove,
 * or edit roles freely — this file is marked merge=ours in .gitattributes so
 * template pulls never overwrite local changes.
 *
 * Roles marked ⚠️ NOT YET VERIFIED — BENCHED are not selectable in the UI
 * (filtered by the assignable-roles endpoint). Verify them in a browser
 * before removing the bench flag.
 *
 * Imports helpers and types from seed-rbac-core.ts (template-owned, do not edit).
 */

import { RoleDef, PolicyDef } from "./seed-rbac-core";
import { allCrud, readWrite, readOnly } from "./seed-rbac-core";

// Re-export helpers for convenience (used by seed-rbac.ts entrypoint)
export { allCrud, readWrite, readOnly };

export const BOOTSTRAP_USER_ROLES: Array<{ email: string; roleName: string }> = [
  { email: "superadmin@cosmosshop.dev", roleName: "Super Admin" },
  { email: "owner@cosmosshop.dev", roleName: "Store Owner" },
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

