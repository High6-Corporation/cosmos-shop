# Medusa Commerce Integration (Omnichannel, Per-Client) — Handoff Document

> **Status:** Sales Channel / inventory / pricing architecture settled and implemented. Marketplace order-ingestion module implemented and verified end-to-end (including fulfillment). Idempotency race-condition fix implemented and verified under real concurrent load. Admin UI widget for marketplace order metadata implemented and verified. Shopee/Lazada API wiring is **benched per team lead direction** — deprioritized until explicitly requested later, not abandoned. **Role-Based Access Control (Section 4.4) implemented and verified via CLI cross-role testing this session — one manual step (Store Owner dashboard walkthrough) still outstanding before it's fully closed.** New client project scoped (not started): a pen/pencil shop with a custom engraving feature (Section 4.5), to reuse the omnichannel template's per-client architecture — queued to start **after** the RBAC dashboard walkthrough closes.
> **Date:** July 13, 2026
> **Version:** v5 (supersedes v4)
> **Summary:** This session covered Role-Based Access Control end to end: (1) investigation confirming Medusa v2's official `@medusajs/rbac` module is present and activatable, with no built-in enforcement; (2) an 8-role permission model designed (including a Settings split between business-facing and technical/dev access); (3) implementation — module activation, an 8-role seed script, and a deny-by-default enforcement middleware using the framework's own `hasPermission()`; (4) a security gap found and fixed mid-session (roleless invited users defaulting to full access); (5) two documented v1 scope gaps accepted (Customer Support and Store Owner permission granularity limits, both hard limits of Medusa's policy model); (6) one flagged concern investigated and resolved as a non-issue (Order & Fulfillment Staff delete risk — Medusa has no order DELETE endpoint). Verification is CLI-complete; the Store Owner dashboard walkthrough is deferred to next session.

---

## 1. Architecture decisions (settled, unchanged from v4)

### 1.1 Sales Channels = "Site Commerce Frontend"
Each Sales Channel (Own Storefront, Shopee, Lazada) is gated by its own Publishable API Key, which scopes what products/data a given channel can see. A product can belong to multiple channels or be exclusive to one.

### 1.2 Shared inventory pool (not per-channel)
One Stock Location is linked to all three Sales Channels. This is Medusa's native pattern, not a workaround — Stock Location (where inventory lives) and Sales Channel (where it's sold) are separate concepts, and reservations happen against the shared pool regardless of which channel placed the order. Orders are tagged with `sales_channel_id` for accurate per-channel reporting; the stock pool itself is not split.

The real complexity is at the marketplace boundary, not inside Medusa: Shopee/Lazada hold their own inventory counts on their platform, so stock levels must be pushed out, and there's an inherent race window before sync catches up. Not solved yet — still open, and now explicitly benched (see Section 5).

### 1.3 Pricing — Sales Channel is a native Price List / Pricing Module rule type
Confirmed (not assumed): Medusa's Pricing Module rule engine natively supports conditioning prices on sales channel, alongside currency, region, and customer group. This means channel-specific pricing (e.g. absorbing marketplace commission) is a config/data-entry task, not a custom feature. Price Lists also support `starts_at`/`ends_at` scheduling, useful for marketplace campaigns.

### 1.4 Order ingestion — native Medusa Orders, not an external mirror
Per direction from your supervisor (wanting orders manageable inside Medusa), marketplace orders become real Medusa Orders — not just synced status data. This is required to keep the shared-stock reservation model (1.2) accurate across channels; an external-mirror approach would not decrement the shared pool for marketplace sales.

---

## 2. Marketplace Order Creation Module (implemented & verified, unchanged from v4)

### 2.1 Investigation findings (confirmed via source, not assumed)
- `createOrderWorkflow` supports creating a native Order directly from a payload, with no Cart required — Medusa's own JSDoc includes an external-import example.
- Minimum payload: `items[{ title, quantity, unit_price }]` + sales channel reference.
- Guest customers are auto-created from buyer email (`findOrCreateCustomerStep`) — no pre-existing Customer record required.
- Explicitly-provided `unit_price` sets `is_custom_price: true`, preserving marketplace pricing as-is (no Medusa Price List recalculation).
- `tax_lines` can be passed per item for pass-through tax (no Medusa tax recalculation).
- Medusa's own Draft Orders feature is a structurally identical pattern (also bypasses Cart).

### 2.2 Decisions made
| Area | Decision |
|---|---|
| Payment | Order created already paid, via Medusa's manual payment provider (`pp_system_default`), captured immediately at creation. Marketplace transaction ID stored as metadata on the payment for audit trail. No real payment capture attempted — payment already happened on the marketplace platform. **Known bug (see 2.7):** `captured_by` is not actually persisting correctly on the payment collection. |
| Tax | Pass through marketplace-computed tax as-is. No Medusa tax recalculation. |
| Pricing | Marketplace price preserved as-is (`is_custom_price: true`). No Medusa Price List recalculation. |
| Webhook route | Dedicated path `src/api/webhooks/marketplace/orders/route.ts` — not under `/store` or `/admin`, since webhook traffic is a distinct trust model (server-to-server from the marketplace, not a storefront client or an admin session). Signature verification stubbed as TODO — deferred along with the rest of marketplace wiring per the bench decision (Section 5.1). |
| Shipping mapping | Simple TypeScript config map (courier name → `shipping_option_id`) for now, with fallback to a custom shipping method (name + amount, no linked option) when no mapping exists. Documented trigger to move to a DB-backed mapping: if/when per-client instances (`medusa-{client-slug}`) need different courier mappings. Populating real entries is blocked on real Shopee/Lazada payload samples — now doubly blocked by the bench decision. |
| **Idempotency** | **Resolved.** Was: soft check-then-create with a race window. Now: a Postgres partial unique index on `(metadata->>'marketplace', metadata->>'marketplace_order_id')` enforces atomicity at the DB level; `create-or-get-order.ts` catches the constraint violation and returns the existing order. See Section 2.5 for full detail. |

### 2.3 Project structure
```
apps/backend/src/
├── admin/
│   ├── lib/client.ts                     # Admin SDK client
│   └── widgets/
│       └── marketplace-order-metadata.tsx # Order detail widget
│
├── migration-scripts/
│   └── create-marketplace-order-idempotency-index.ts  # Partial unique index
│
├── workflows/marketplace/
│   ├── create-marketplace-order.ts       # Workflow composition
│   ├── shipping-mappings.ts              # Courier → shipping option config map (still empty)
│   └── steps/
│       ├── check-idempotency.ts          # Dedupe check (fast-path pre-check)
│       ├── normalize-order-input.ts      # MarketplaceOrderInput → createOrderWorkflow shape
│       ├── create-or-get-order.ts        # Create + payment capture, or return existing
│       └── reserve-order-inventory.ts    # Inventory reservation
│
└── api/
    ├── middlewares.ts                    # Central middleware registration
    └── webhooks/marketplace/orders/
        ├── route.ts                      # POST /webhooks/marketplace/orders
        └── middlewares.ts                # Zod validation + signature TODO stub
```

### 2.4 Three gaps found in `createOrderWorkflow`'s direct-payload path — all fixed & verified

`createOrderWorkflow` (called with a direct payload, no Cart) behaves as a lower-level building block — it does **not** automatically handle several things that Medusa's own cart-completion flow (`completeCartWorkflow`) orchestrates explicitly around it.

| # | Gap | Root cause (confirmed via source) | Fix |
|---|---|---|---|
| 1 | Payment collection not auto-created | `createOrderWorkflow` doesn't create a `PaymentCollection` on the direct-payload path | Explicitly create + link one in `create-or-get-order.ts` |
| 2 | Order totals stale after tax lines | Workflow returns the pre-tax-refresh order (`total: 0`) | Re-fetch the fresh order from DB after workflow completion, in `create-or-get-order.ts` |
| 3 | Inventory never reserved | `createOrderWorkflow` calls `confirmVariantInventoryWorkflow`, a read-only availability check — never calls `reserveInventoryStep` | New step `reserve-order-inventory.ts`, using `prepareConfirmInventoryInput` |

Verified end-to-end through fulfillment on order `order_01KX5SPXR5WA5C1Z0J4DK6Y5TR`.

### 2.5 Idempotency race-condition fix (implemented & verified)

**Problem:** `check-idempotency.ts` used check-then-create — a SELECT followed by a separate INSERT via `createOrderWorkflow`. Two near-simultaneous webhook calls with the same `marketplace_order_id` could both pass the "not found" check before either finished creating the order, producing a duplicate Order.

**Implementation:**
- **Migration script** (`create-marketplace-order-idempotency-index.ts`): creates a partial unique index —
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_marketplace_idempotency"
    ON "order" ((metadata->>'marketplace'), (metadata->>'marketplace_order_id'))
    WHERE metadata->>'marketplace' IS NOT NULL
      AND metadata->>'marketplace_order_id' IS NOT NULL;
  ```
- **`create-or-get-order.ts`**: wraps `createOrderWorkflow(container).run()` in a try/catch. On a unique-constraint violation, re-queries and returns the existing order instead of throwing.

**Bug found and fixed during implementation:** the original `isUniqueConstraintViolation()` helper used an `instanceof Error` gate, which rejected the actual error object. Medusa's workflow engine throws a **plain object** on this path, not an `Error` instance. The gate now checks `err.code === '23505' || err.type === 'invalid_data' || err.type === 'duplicate_error'` directly.

**Verification:** Two concurrent webhook calls with identical `marketplace_order_id` both returned `HTTP 200` with the same `order_id`. DB query across all test orders grouped by `marketplace_order_id` with `HAVING COUNT(*) > 1` → zero rows.

**Status: closed.** Logged to Engram as `bug/marketplace-order-idempotency-db-level-fix-verified` (obs #66).

### 2.6 Admin UI widget for marketplace order metadata (implemented & verified)

Widget at `order.details.after`, surfacing `order.metadata.marketplace`, `order.metadata.marketplace_order_id`, and marketplace transaction ID (currently shows "Not yet captured" fallback due to 2.7).

**Status: closed, with one flagged gap** — the non-marketplace guard is logically sound but behaviorally unverified (all 20 dev-DB orders are marketplace orders, no negative test case existed). Logged as Engram obs #67/#69.

### 2.7 `captured_by` / `marketplace_transaction_id` not persisting — open, unrelated to RBAC work
Still not root-caused. `marketplace_transaction_id` is accepted by the step's input type but never consumed. `captured_by` doesn't survive to the API response despite being explicitly set. Needs its own investigation-mode task into Medusa's payment capture extension points. Logged as Engram obs #68.

### 2.8 Debug learnings (undocumented Medusa behavior worth flagging for future upgrades)
- `query.graph()` does **not** return `quantity` or `raw_quantity` on order line items — quantities for reservation must be sourced from the original workflow input payload, not re-queried.
- The Sales Channel ↔ Stock Location link resolves correctly via `query.graph()` in the forward direction, but the reverse traversal (variant → location_levels → stock_locations → sales_channels) does not work reliably.
- `query.graph()` returns `required_quantity` as a plain JS number, not a BigNumber object — inconsistent with other quantity fields.
- Medusa's workflow engine can throw **plain objects**, not `Error` instances, at least on the `formatException`-wrapped HTTP-layer path. Any future error-handling code that gates on `instanceof Error` should assume this is unsafe.
- **New this session:** the same "framework helper doesn't do what the surface API implies" pattern showed up again in RBAC — see Section 4.4.3. Worth treating as a general Medusa-extension caution, not a one-off.

---

## 3. Tooling setup (this project)

### 3.1 Graphify
- **Current graph (this session):** 1,366 nodes, 2,271 edges, 104 communities. 17 files re-extracted (including all 6 new/changed RBAC files), 284 files cached/unchanged, 349 deleted files pruned.
- **Flag for next session:** the node/edge/community counts dropped substantially from the marketplace session's numbers (previously 5,711 nodes / 20,676 edges / 299 communities). This tracks with "349 deleted files pruned," which is plausible if stale/generated files were cleaned up — but worth a quick sanity check next run that this wasn't an over-aggressive prune, not just assumed correct.
- Known quirk: Graphify runs are sometimes blocked by the safety classifier when invoked via Claude Code agent — run manually when this happens:
  ```bash
  cd /Users/josh/work/high6-medusa-omnichannel-template
  graphify .
  ```

### 3.2 Engram
- **Status change this session:** Engram MCP failed to resolve the project from the workspace root (multiple git repos present). Observations for this session were logged to a **file-based fallback** instead: `memory/rbac-implementation.md` (full session summary, verified/unverified/deferred explicitly separated), indexed as the 20th entry in `MEMORY.md`.
- A `.engram/config.json` was added at the project root to fix detection for next session start — **unverified** whether this actually resolves the issue; confirm at the start of the next session before assuming Engram MCP is back to normal.
- Prior observations (marketplace session): obs #66 (idempotency fix), #67 (unverified widget guard), #68 (captured_by bug), #69 (widget final disposition).
- Working pattern (reaffirmed): log a final disposition observation at task close, explicitly separating verified vs. unverified vs. deferred sub-items rather than marking a task uniformly "done."

### 3.3 Additional plugins installed
- `context7`, `frontend-design`, `medusa-dev` / MedusaDocs, `superpowers` (all `claude-plugins-official` / `medusa`).
- `medusa-dev@medusa` explicitly invoked for the RBAC investigation and implementation this session.

---

## 4. Carried forward — still open

### 4.1 Shopee & Lazada API wiring — **benched per team lead direction**
Deprioritized, not abandoned — will be requested later. Scope unchanged from v4:
- Webhook payload parsers (Shopee shape, Lazada shape → the normalized `MarketplaceOrderInput` shape already built).
- Webhook signature verification (currently a stubbed TODO in `webhooks/marketplace/orders/middlewares.ts`).
- Marketplace API client code: OAuth/auth, rate limiting, per-client credential storage/rotation.
- Which platform to prototype first — still undecided.
- Outbound sync (pushing stock levels/catalog *to* Shopee/Lazada) — not started.

**Research on record for when this resumes:**
- Selling as a registered Shopee seller requires DTI/SEC registration, BIR Certificate of Registration, and local business permits.
- Shopee Open Platform API access (Third-party Partner Platform) requires a registered business with valid documents for **production/go-live** credentials — but **sandbox testing does not**. Practical next step when resumed: get org access to the Shopee Open Platform developer console directly.

### 4.2 `captured_by` / `marketplace_transaction_id` persistence bug (Section 2.7)
Not yet investigated at the source level. Needs its own investigation-mode task.

### 4.3 Marketplace order module — remaining deferred follow-ups
- Shipping mapping config (`shipping-mappings.ts`) is currently empty — needs real courier → `shipping_option_id` entries once real Shopee/Lazada payload samples are available. Blocked on 4.1.
- ~~Admin UI for viewing marketplace order metadata~~ — done.
- ~~Unique DB constraint for idempotency~~ — done.

### 4.4 Role-Based Access Control (RBAC) — implemented this session, one item outstanding

**Status:** Investigation, role design, and implementation complete. Verified via CLI cross-role testing (Read-Only and Order & Fulfillment Staff roles, real permission-denied checks against live endpoints — not just build/lint checks). **One manual step still open: Store Owner dashboard walkthrough at `localhost:9000/app`, deferred to next session.**

#### 4.4.1 Investigation findings
- Default Medusa admin access, without any RBAC module configured, is binary — full access or none. No native "read-only admin" or "orders-only admin" concept exists in core.
- Medusa v2's official `@medusajs/rbac` module is confirmed present in `node_modules`, arriving transitively via the `@medusajs/medusa@2.17.2` dependency chain — no `npm install` needed, just activation in `medusa-config.ts`.
- The module ships data models, migrations, admin CRUD API routes, and a `policies` array syntax for route config — but **no automatic enforcement**. The `policies` array is declarative metadata only; something has to read it and actually block requests. That "something" was this session's main build.
- Origin clarified across two PRs: **#14310** (core module — data models, migrations, workflows, API routes) and **#14593** (admin dashboard integration layer — `mePermissions()`, permission hooks/guards), the latter shipping in **v2.15.5**.
- Three community plugins evaluated (`@caocuong2404/medusa-plugin-rbac`, `@devx-retailos/rbac`, `@rsc-labs/medusa-rbac`) — none provide meaningful capability over the official module + custom middleware. `@rsc-labs/medusa-rbac` is commercial/closed-source, which would mean per-client-instance licensing for a template meant to be reused across clients — ruled out on that basis.

#### 4.4.2 Roles finalized (8 total)
Designed from RBAC best-practice research (least-privilege, function-named roles) mapped onto Medusa's `resource:operation` policy grain:

| Role | Orders | Products / Inventory | Pricing / Promotions | Customers | Settings |
|---|---|---|---|---|---|
| **Store Owner** | All | Read + write | All | All | Business only (store details, regions/currency, shipping zones, tax rates, inviting business-role users) — **not** API keys, webhooks, or RBAC policy management |
| **Operations Manager** | All | Read + write | Read only | Read + write | None |
| **Order & Fulfillment Staff** | Read + write | Read only | None | Read only | None |
| **Catalog / Product Manager** | Read only | All | All | None | None |
| **Marketing** | Read only | Read only | All | None | None |
| **Customer Support** | Read + write | Read only | None | Read + write (no delete) | None |
| **Read-Only / Auditor** | Read only | Read only | Read only | Read only | Read only |
| **Developer / Platform Support** | Read only (debugging) | Read only (debugging) | None | Read only (debugging) | Technical only (API keys, webhooks, RBAC role/policy management, sales channel technical config, payment provider credentials) |

Developer/Platform Support was deliberately seeded as a **real, named role** (not an unscoped credential outside the RBAC system) — reasoning: audit-trail consistency, and a client seeing a legible "Developer" role in their user list reads as accountable/scoped access rather than an unexplained backdoor.

#### 4.4.3 Implementation
- **Module activation:** `{ key: Modules.RBAC, resolve: "@medusajs/rbac" }` in `medusa-config.ts`; `npx medusa db:migrate` created 4 tables (`rbac_role`, `rbac_policy`, `rbac_role_policy`, `rbac_role_parent`).
- **Feature flag required:** `MEDUSA_FF_RBAC=true` in `.env`. Without it, the framework's `hasPermission()`/`resolvePermissions()` are no-ops (return full access), and the `mePermissions()` HTTP endpoint 404s. Easy to miss — flagging for future sessions/other client instances of this template.
- **Seed script:** `src/migration-scripts/seed-rbac.ts` — 8 roles seeded with direct policy assignment (no role inheritance used in v1; see below for why).
  - **Note — unreconciled discrepancy:** the implementation completion report states **40 unique policies**; the Engram session log states **44 policies**. Not yet reconciled — likely just an inconsistent count somewhere rather than a functional bug, but worth a two-minute check before trusting either number in future planning.
- **Enforcement middleware:** `src/api/middleware-utils/rbac-guard.ts` (211 lines), applied to `/admin/*` in `src/api/middlewares.ts`. Design:
  - Resolves the authenticated user's roles via `query.graph({ entity: "user", fields: ["id", "rbac_roles.id"] })` — the `rbac_roles` field name was confirmed via source (not assumed) during a pre-implementation investigation spike.
  - Uses the framework's own `hasPermission()` (from `@medusajs/framework/policies/has-permission`) for the actual allow/deny decision — chosen over reimplementing permission resolution, and chosen over the repository-level `listPoliciesForRole()` (which *does* resolve role inheritance via a recursive CTE, unlike the framework helper — see below).
  - Infers `resource` from the URL and `operation` from the HTTP method (GET/HEAD → read, POST → write, DELETE → delete).
  - **Deny-by-default on two axes:** an unrecognized/unmapped URL returns 403 (does not default-allow), and a matched route with no `policies` array declared also returns 403. This was a deliberate flip from the agent's first draft, which defaulted both cases to allow — caught in review before implementation, not after.
  - `/admin/auth/*` and `/admin/cloud/auth/*` unconditionally bypass the guard (must always be reachable for login).
  - Super-admin access uses the RBAC module's built-in `*:*` wildcard policy (`SUPER_ADMIN_KEY`), assigned directly to the Store Owner role — **not** a string match on role name. (The first draft used `if (role name === "Store Owner") bypass`, which was flagged and replaced before implementation — fragile against renames or role-name collisions.)
- **Known framework quirk (worth remembering for future Medusa extension work):** `hasPermission()`/`resolvePermissions()` do **not** traverse `rbac_role_parent` (role inheritance), even though the repository-level `listPoliciesForRole()` does, via a recursive CTE with cycle detection. This is a framework-vs-repository-layer mismatch, similar in shape to the `instanceof Error` vs. plain-object issue found in the marketplace idempotency work (Section 2.5) — a second instance of "the higher-level helper doesn't do what the lower-level implementation is capable of." **Consequence:** v1's 8 roles use direct policy assignment only, no role hierarchy. If inheritance is wanted later, the enforcement layer needs to call `listPoliciesForRole()` directly instead of `hasPermission()`.
- **Security gap found and fixed mid-session:** `hasPermission()` returns `true` (full, unrestricted access) when a user's role list is empty. Medusa's own tooling (`npx medusa user`, and a built-in startup migration that assigns Super Admin to existing users) masks this in practice — but a user created through the **normal invite-accept flow**, without explicit role assignment, would land with zero roles and therefore full access. Fixed with a new subscriber, `assign-default-role-on-invite-accept.ts`, firing on `invite.accepted` and defaulting any roleless new user to **Read-Only** (the safest default — anyone needing more gets explicitly upgraded by whoever provisions them). Build-verified; **runtime verification (actually accepting a real invite and confirming the assignment fires) is still pending** — not yet done.

#### 4.4.4 Known v1 scope gaps (accepted, documented — not implementation shortcuts)
Both gaps below are hard limits of Medusa's `resource:operation` policy model, which has no sub-operation granularity. Narrowing either requires either Medusa adding finer-grained resource keys in a future release, or a custom workflow-level check layered on top of RBAC (deferred, not built this session).

| Gap | Detail |
|---|---|
| Customer Support `order:write` is full write | Originally scoped as "notes/refund request only" — not expressible at the policy level. This role can perform any order write, not just the intended subset. |
| Store Owner `sales_channel:write` includes technical config | Originally scoped as "channel assignment only" (which products go where), separate from "channel creation/technical config" (Developer's job). Medusa treats `sales_channel` as one resource — no way to split assignment from config at the policy level. |

#### 4.4.5 Flagged concern, investigated and resolved as a non-issue
Order & Fulfillment Staff's `order:write` was flagged as a possible delete/void risk (frontline staff being able to delete real orders). Investigated and resolved: **Medusa has no order DELETE endpoint** — orders are cancelled via `POST /admin/orders/:id/cancel`, never deleted from the database. The enforcement middleware already blocks the non-existent DELETE operation by construction, and `order:write` covering cancel is the correct, intended capability for this role. No workflow-level delete-block was built — none is needed.

#### 4.4.6 Verification status
| Check | Result |
|---|---|
| Build (backend) | Pass, zero errors |
| DB migrations | Pass — 4 RBAC tables created |
| Feature flag active | Confirmed (`MEDUSA_FF_RBAC=true`) |
| Seed script | Pass — 8 roles created (policy count needs reconciling, see 4.4.3) |
| Super admin (`*:*`) CLI access | Pass — verified 200 across ~10 key endpoint groups (products, orders, customers, rbac/roles, stores, sales-channels, regions, users, invites, price-lists, promotions, plugins, feature-flags) |
| Cross-role CLI testing (Read-Only, Order & Fulfillment Staff) | Pass — real request/response evidence, not just pass/fail summary. Reads allowed, writes/unscoped-resource reads correctly blocked with explicit permission-denied messages. |
| URL→resource mapping coverage | 56 resources mapped, ~230 admin routes claimed covered — self-reported by the agent; not independently cross-checked against an external route enumeration |
| Invite-accept subscriber runtime behavior | **Not yet verified** — build-verified only |
| Store Owner dashboard walkthrough (`localhost:9000/app`) | **Not done** — deferred to next session, requires a human in a browser (outside what an agent or Claude in this chat interface can do) |
| Storefront (`/store/*`) impact | **Not verified** — guard is scoped to `/admin/*` by design, but this hasn't been explicitly confirmed unaffected |

#### 4.4.7 Open items carried into next session
1. **Store Owner dashboard walkthrough** — log in at `localhost:9000/app`, click every sidebar section, confirm nothing 403s that should work. Requires a human in a browser.
2. **Invite-accept subscriber runtime check** — create a real invite without specifying roles, accept it, confirm the new user actually lands with Read-Only assigned (not just that the code builds).
3. **Confirm `/store/*` routes are unaffected** by the admin-only guard.
4. **Reconcile the 40-vs-44 policy count discrepancy** noted in 4.4.3.
5. **Sanity-check Graphify's node/edge/community count drop** this session (Section 3.1).
6. **Confirm the Engram MCP fix (`.engram/config.json`) actually resolves project detection** at the start of next session.

Once items 1–3 close, RBAC (Section 4.4) is fully done and Cosmos Bazar (Section 4.5) is unblocked to start.

### 4.5 New client project (scoped, not started) — Cosmos Bazar: pen/pencil shop with custom engraving

**Priority: queued after Role-Based Access (4.4) — nearly unblocked, pending the dashboard walkthrough and remaining open items above.**

**Client context:** Cosmos Bazar, Inc. — a real, existing business (est. 1926, Binondo, Manila) and the exclusive distributor of Pilot writing instruments and Nichiban adhesive tapes in the Philippines, also carrying other Japanese brands (Bigen, Kokuryu, Tancho). Current live site: `https://shop.cosmos-bazar.com`. This project is a **remake of an actual existing client site**, not a hypothetical — described as "kind of separate, but coming from the omnichannel template."

**Relationship to the omnichannel template:** treat this as a new per-client instance provisioned from `high6-medusa-omnichannel-template`, reusing the already-settled architecture from Section 1 (Sales Channels, shared Stock Location pool, Pricing Module rule engine) rather than a from-scratch build. The per-client provisioning approach itself is still an open decision (Section 4.6) — worth resolving that first since it directly determines how Cosmos Bazar gets stood up.

**Core feature: engraving on pens — quantity-threshold-based free/paid pricing**

Business rule: pens are sold plain by default. A customer can choose an "Engraved" variant of a pen. Engraving carries an additional fee **unless** the customer orders enough units of that variant in one go, at which point engraving becomes free.

Feasibility confirmed against Medusa v2's native capabilities (source-cited, not assumed) — no custom pricing engine required:

| Requirement | Medusa mechanism |
|---|---|
| Customer picks "Engraved" at add-to-cart | Product Option (e.g. "Engraving: Plain / Engraved") generating a separate Variant. Product Options can be **global** — defined once at the store level and reused across every pen/pencil product, rather than rebuilt per product. |
| Fee applies below a quantity threshold, free at/above it | Native **tiered pricing** on the price set via `min_quantity`/`max_quantity` on each price — e.g. tier 1: `min_quantity: 1, max_quantity: 49` at the higher (engraved) price; tier 2: `min_quantity: 50` at the same price as the Plain variant. Threshold evaluates per line item/variant automatically — no custom workflow step needed for the pricing logic itself. |
| Threshold and fee amount editable without code | Price list tiers are editable directly in the Medusa Admin dashboard (click-to-edit per variant/currency), not API-only. |
| Custom engraving text (personalization) | The Cart/Order `LineItem.metadata` field natively supports arbitrary custom data — Medusa has a documented "Personalized Products" pattern for exactly this (custom text passed in `metadata` on add-to-cart, carried through automatically to the resulting Order line item). Requires: a storefront text input, and an Admin-side widget (same `order.details.after` pattern already used for marketplace metadata, Section 2.6) so fulfillment staff can see what to actually engrave. |

**Business rule clarified with Sir JM (resolved):**
- Engraving text does **not** need to be identical across different orders/customers — no platform restriction there.
- **Within a single order, one engraving text applies per variant, regardless of quantity** — e.g. 50 units of "Engraved Blue Pen" in one order share a single engraving text, not 50 individually unique texts. This is a deliberate business-rule restriction, not a Medusa limitation, and it simplifies the build significantly.
- **Open follow-up, not yet asked:** whether this one-text-per-variant restriction is permanent or a starting point.

**Not yet decided / needs scoping before implementation:**
- Actual threshold quantity and engraving fee amount (business decision, not yet provided).
- Whether the threshold is uniform across all pen/pencil products or varies per product/SKU.
- Storefront UI/UX for the engraving text input and character limits/validation.
- Per-client instance provisioning approach (shared open item, Section 4.6) — needs resolving as a prerequisite.

### 4.6 Also still open (carried forward, unchanged)
- Per-client instance provisioning/deployment approach.
- Client access-model question (dedicated site vs. admin access) in the omnichannel architecture's context.

---

## 5. Standard structure — writing Claude Code prompts for this project

*(Unchanged — reproduced here for continuity.)*

```
## Task: [one-line description]

**Skills to invoke:** [Graphify / Engram / frontend-design / medusa-dev@medusa — pick what applies]

**Mode: [Investigation only — no file changes / Implementation — proceed after plan approval]**

### Context
[What's happening, what error/requirement prompted this, relevant file paths or
prior handoff doc references. Paste exact error messages/stack traces verbatim
where relevant — don't paraphrase them.]

### Investigation/Implementation steps
1. [Specific, ordered steps — not vague instructions]
2. ...

### Report back with / Deliverable
[What the Agent should return: a written report only, a plan for approval,
or actual code changes — be explicit about which.]

[If Implementation mode: "Do not proceed past the plan stage without my
explicit confirmation."]
```

**Rules for this project (per established working pattern):**
- **Plan-first gate:** for any implementation task, the Agent proposes a plan and stops — no code changes until the plan is explicitly approved.
- **Step-by-step confirmation:** multi-phase work proceeds one phase at a time; the Agent does not chain phases without a checkpoint.
- **Investigation before implementation:** for anything with an unverified assumption, always investigate first, report findings, and get direction before touching files. Reaffirmed this session — a pre-implementation spike caught a fragile super-admin bypass design and two fail-open defaults before any code was written.
- **Real evidence, not "should work":** claims about behavior (not just code) must be verified by actually running the thing. Reaffirmed this session — "builds cleanly" was correctly not accepted as sufficient evidence for cross-role permission enforcement; actual request/response evidence per role was required instead.
- **Inline brief pasting preferred** over referencing external files the Agent would need to locate itself.
- **This project's scope is implementation only** — stakeholder/requirements conversations (roles needed, business rules, etc.) are handled outside this workflow; when that input is missing, best-practice research + explicit sign-off stands in for it rather than proposing a stakeholder meeting.

---

## 6. Standard structure — responding to the Agent's plan or findings

*(Unchanged.)*

1. **Acknowledge what's confirmed vs. still uncertain.** Flag assumptions in the Agent's report explicitly before approving.
2. **Ask for direct verification when the report's conclusion depends on behavior, not just code.**
3. **Approve scope explicitly and narrowly.**
4. **If the Agent's fix works, close the loop with a verification step** before considering the task done.
5. **Capture the outcome in the handoff doc** before moving to the next task.

---

## References

- `medusa-omnichannel-handoff-v4.md` — Sales Channel/pricing architecture, marketplace order module, RBAC section opened as an item to start
- `medusa-omnichannel-handoff-v3.md` — Sales Channel/pricing architecture, marketplace order module v1, three-gap fix
- `medusa-omnichannel-handoff-v2.md` — project bootstrap, environment fixes, prior open items
- `medusa-omnichannel-handoff-v1.md` — architecture pivot decision, Shopee/Lazada feasibility research
- `medusa-cms-handoff-v15.md` — final state of the benched multi-tenant project, reusable patterns
- `docs/marketplace-order-idempotency-investigation.md` — full source-level investigation for Section 2.5
- `INVENTORY-RESERVATION-INVESTIGATION.md` — full source-level investigation of the reservation gap (Section 2.4)
- `memory/rbac-implementation.md` — file-based session memory for this session's RBAC work (Engram MCP fallback, see Section 3.2)
- Shopee Open Platform: https://open.shopee.com/
- Lazada Open Platform: https://open.lazada.com/
- Medusa `create-medusa-app` docs: https://docs.medusajs.com/learn/installation
- Cosmos Bazar (Section 4.5 client, current live site to be remade): https://shop.cosmos-bazar.com/about-us/
- Medusa "Personalized Products" recipe (engraving text pattern): https://docs.medusajs.com/resources/recipes/personalized-products
- Medusa Pricing Module — Price Tiers and Rules (quantity-threshold pricing): https://docs.medusajs.com/resources/commerce-modules/pricing/price-rules
- Medusa `@medusajs/rbac` module — core PR #14310 (data models, migrations, workflows, API routes) and PR #14593 (admin dashboard integration, shipped v2.15.5)