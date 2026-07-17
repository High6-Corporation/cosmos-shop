# Medusa Commerce Integration (Omnichannel, Per-Client) — Handoff Document

> **Status:** Sales Channel / inventory / pricing architecture settled and implemented. Marketplace order-ingestion module implemented and verified end-to-end (including fulfillment). Idempotency race-condition fix implemented and verified under real concurrent load. Admin UI widget for marketplace order metadata implemented and verified. Shopee/Lazada API wiring is **benched per team lead direction** — deprioritized until explicitly requested later, not abandoned. New client project scoped (not started): a pen/pencil shop with a custom engraving feature, to reuse the omnichannel template's per-client architecture — queued to start **after** the Role-Based Access item (Section 4.4).
> **Date:** July 13, 2026
> **Version:** v4 (supersedes v3)
> **Summary:** Session 4 covered: (1) DB-level fix for the marketplace order idempotency race condition (partial unique index + catch-and-resolve), investigated, implemented, and verified under real concurrent load — including a self-found runtime bug in the error-shape detection logic; (2) Admin UI widget surfacing marketplace order metadata on the Order detail page, investigated and implemented; (3) discovery of a new bug during widget verification — `captured_by` / `marketplace_transaction_id` not persisting correctly; (4) confirmation from team lead that Shopee/Lazada marketplace API wiring is benched for now; (5) scoping of a new client project — Cosmos Bazar (pen/pencil shop) — including a custom engraving pricing/personalization feature, feasibility-confirmed against Medusa's native capabilities, with one open business-rule question resolved by Sir JM.

---

## 1. Architecture decisions (settled, unchanged from v3)

### 1.1 Sales Channels = "Site Commerce Frontend"
Each Sales Channel (Own Storefront, Shopee, Lazada) is gated by its own Publishable API Key, which scopes what products/data a given channel can see. A product can belong to multiple channels or be exclusive to one.

### 1.2 Shared inventory pool (not per-channel)
One Stock Location is linked to all three Sales Channels. This is Medusa's native pattern, not a workaround — Stock Location (where inventory lives) and Sales Channel (where it's sold) are separate concepts, and reservations happen against the shared pool regardless of which channel placed the order. Orders are tagged with `sales_channel_id` for accurate per-channel reporting; the stock pool itself is not split.

The real complexity is at the marketplace boundary, not inside Medusa: Shopee/Lazada hold their own inventory counts on their platform, so stock levels must be pushed out, and there's an inherent race window before sync catches up. Not solved yet — still open, and now explicitly benched (see Section 4).

### 1.3 Pricing — Sales Channel is a native Price List / Pricing Module rule type
Confirmed (not assumed): Medusa's Pricing Module rule engine natively supports conditioning prices on sales channel, alongside currency, region, and customer group. This means channel-specific pricing (e.g. absorbing marketplace commission) is a config/data-entry task, not a custom feature. Price Lists also support `starts_at`/`ends_at` scheduling, useful for marketplace campaigns.

### 1.4 Order ingestion — native Medusa Orders, not an external mirror
Per direction from your supervisor (wanting orders manageable inside Medusa), marketplace orders become real Medusa Orders — not just synced status data. This is required to keep the shared-stock reservation model (1.2) accurate across channels; an external-mirror approach would not decrement the shared pool for marketplace sales.

---

## 2. Marketplace Order Creation Module (implemented & verified)

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
| Payment | Order created already paid, via Medusa's manual payment provider (`pp_system_default`), captured immediately at creation. Marketplace transaction ID stored as metadata on the payment for audit trail. No real payment capture attempted — payment already happened on the marketplace platform. **Known bug (see 4.2 → moved to 2.6):** `captured_by` is not actually persisting correctly on the payment collection. |
| Tax | Pass through marketplace-computed tax as-is. No Medusa tax recalculation. |
| Pricing | Marketplace price preserved as-is (`is_custom_price: true`). No Medusa Price List recalculation. |
| Webhook route | Dedicated path `src/api/webhooks/marketplace/orders/route.ts` — not under `/store` or `/admin`, since webhook traffic is a distinct trust model (server-to-server from the marketplace, not a storefront client or an admin session). Signature verification stubbed as TODO — deferred along with the rest of marketplace wiring per the bench decision (Section 4.1). |
| Shipping mapping | Simple TypeScript config map (courier name → `shipping_option_id`) for now, with fallback to a custom shipping method (name + amount, no linked option) when no mapping exists. Documented trigger to move to a DB-backed mapping: if/when per-client instances (`medusa-{client-slug}`) need different courier mappings. Populating real entries is blocked on real Shopee/Lazada payload samples — now doubly blocked by the bench decision. |
| **Idempotency** | **Resolved this session.** Was: soft check-then-create with a race window. Now: a Postgres partial unique index on `(metadata->>'marketplace', metadata->>'marketplace_order_id')` enforces atomicity at the DB level; `create-or-get-order.ts` catches the constraint violation and returns the existing order. See Section 2.5 for full detail. |

### 2.3 Project structure
```
apps/backend/src/
├── admin/
│   ├── lib/client.ts                     # Admin SDK client (new — see 2.7)
│   └── widgets/
│       └── marketplace-order-metadata.tsx # Order detail widget (new — see 2.7)
│
├── migration-scripts/
│   └── create-marketplace-order-idempotency-index.ts  # Partial unique index (new — see 2.5)
│
├── workflows/marketplace/
│   ├── create-marketplace-order.ts       # Workflow composition
│   ├── shipping-mappings.ts              # Courier → shipping option config map (still empty)
│   └── steps/
│       ├── check-idempotency.ts          # Dedupe check (fast-path pre-check, kept per 2.5)
│       ├── normalize-order-input.ts      # MarketplaceOrderInput → createOrderWorkflow shape
│       ├── create-or-get-order.ts        # Create + payment capture, or return existing (updated — see 2.5)
│       └── reserve-order-inventory.ts    # Inventory reservation
│
└── api/
    ├── middlewares.ts                    # Central middleware registration
    └── webhooks/marketplace/orders/
        ├── route.ts                      # POST /webhooks/marketplace/orders
        └── middlewares.ts                # Zod validation + signature TODO stub
```

### 2.4 Three gaps found in `createOrderWorkflow`'s direct-payload path — all fixed & verified (v3, unchanged)

`createOrderWorkflow` (called with a direct payload, no Cart) behaves as a lower-level building block — it does **not** automatically handle several things that Medusa's own cart-completion flow (`completeCartWorkflow`) orchestrates explicitly around it.

| # | Gap | Root cause (confirmed via source) | Fix |
|---|---|---|---|
| 1 | Payment collection not auto-created | `createOrderWorkflow` doesn't create a `PaymentCollection` on the direct-payload path | Explicitly create + link one in `create-or-get-order.ts` |
| 2 | Order totals stale after tax lines | Workflow returns the pre-tax-refresh order (`total: 0`) | Re-fetch the fresh order from DB after workflow completion, in `create-or-get-order.ts` |
| 3 | Inventory never reserved | `createOrderWorkflow` calls `confirmVariantInventoryWorkflow`, a read-only availability check — never calls `reserveInventoryStep` | New step `reserve-order-inventory.ts`, using `prepareConfirmInventoryInput` |

Verified end-to-end through fulfillment on order `order_01KX5SPXR5WA5C1Z0J4DK6Y5TR` (v3 session).

### 2.5 Idempotency race-condition fix (implemented & verified this session)

**Problem:** `check-idempotency.ts` used check-then-create — a SELECT followed by a separate INSERT via `createOrderWorkflow`. Two near-simultaneous webhook calls with the same `marketplace_order_id` could both pass the "not found" check before either finished creating the order, producing a duplicate Order.

**Investigation (source-confirmed, full report: `docs/marketplace-order-idempotency-investigation.md`):**
- `order.metadata` is a native Postgres `jsonb` column — confirmed via the DML entity, the DML→SQL type mapping layer, and the initial core migration (three independent sources).
- Medusa's migration system supports raw SQL via `this.addSql()` / migration scripts (`pgConnection.raw()`), with existing core-module precedent for partial unique indexes (`WHERE deleted_at IS NULL`-style patterns in the Customer and Return Reason tables).
- A **migration script** (not a MikroORM module migration) is the right mechanism for a project-level DDL change to a core table — access to `pgConnection.raw()`, tracked in `script_migrations`, idempotent via `IF NOT EXISTS`.
- MikroORM maps Postgres `23505` to `UniqueConstraintViolationException`; Medusa's repository-layer `dbErrorMapper` may re-wrap it as `MedusaError(INVALID_DATA)` before it reaches application code — flagged as an unknown requiring runtime verification, not assumed.

**Implementation:**
- **Migration script** (`create-marketplace-order-idempotency-index.ts`): creates a partial unique index —
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_marketplace_idempotency"
    ON "order" ((metadata->>'marketplace'), (metadata->>'marketplace_order_id'))
    WHERE metadata->>'marketplace' IS NOT NULL
      AND metadata->>'marketplace_order_id' IS NOT NULL;
  ```
- **`create-or-get-order.ts`**: wraps `createOrderWorkflow(container).run()` in a try/catch. On a unique-constraint violation, re-queries and returns the existing order instead of throwing. `checkIdempotencyStep` is kept as a fast-path optimization for the common case; the index is the atomic safety net for the race.

**Bug found and fixed during implementation (not caught by build/investigation — only by the live concurrency test):** the original `isUniqueConstraintViolation()` helper used an `instanceof Error` gate, which rejected the actual error object. Medusa's workflow engine throws a **plain object** (constructed via `formatException` at the HTTP layer), not an `Error` instance, on this path. The gate was removed; the function now checks `err.code === '23505' || err.type === 'invalid_data' || err.type === 'duplicate_error'` directly on the object's properties.

**Verification (real evidence, captured this session):**
- Index confirmed created: `SELECT indexname FROM pg_indexes WHERE indexname = 'IDX_order_marketplace_idempotency'` → 1 row.
- Two concurrent webhook calls with identical `marketplace_order_id` (`FINAL-1783915666767`) both returned `HTTP 200` with the **same** `order_id` (`order_01KXCTHQC9XM5ME7BQNEJNGEEN`).
- Server log captured the actual error shape that fired: `MedusaError (err.type === 'invalid_data')` — confirming the repository-layer wrapping was real, not just a theoretical risk.
- DB query across all test orders grouped by `marketplace_order_id` with `HAVING COUNT(*) > 1` → zero rows. No duplicates.

**Status: closed.** Logged to Engram as `bug/marketplace-order-idempotency-db-level-fix-verified` (obs #66).

### 2.6 Admin UI widget for marketplace order metadata (implemented & verified this session)

**Scope:** a widget at the `order.details.after` extension zone, surfacing marketplace-specific data directly on the native Order detail page — no new navigation, no custom Admin API route (the order object is already injected via `DetailWidgetProps<AdminOrder>`, and `metadata` is already in `defaultAdminRetrieveOrderFields`).

**Displays:**
- `order.metadata.marketplace`
- `order.metadata.marketplace_order_id`
- Marketplace transaction ID (from `order.payment_collections[0]?.payments[0]?.captures[0]?.captured_by`) — currently shows a **"Not yet captured" fallback** due to the bug found below (2.7), not a bug in the widget itself.

**Files created:**
| File | Lines |
|---|---|
| `lib/client.ts` | 9 |
| `marketplace-order-metadata.tsx` | 82 |

**Verification:**
- Build passes (backend + frontend, zero errors).
- Widget renders correctly on a live marketplace order (`order_01KXCTHQC9XM5ME7BQNEJNGEEN`) at `/app/orders/{id}`.
- **Non-marketplace guard (`if (!order.metadata?.marketplace) return null`) is logically sound but behaviorally unverified** — all 20 orders in the dev DB are marketplace orders, so no live negative test case existed. Logged as a known gap (Engram obs #67), not silently marked as verified.

**Status: closed, with one flagged gap** (the unverified guard, low risk but explicitly noted rather than assumed). Logged to Engram as obs #69, linked to obs #68.

### 2.7 New bug found during widget verification — `captured_by` / `marketplace_transaction_id` not persisting

While verifying the widget's transaction-ID display, found that the API returns `captured_by: None` despite `create-or-get-order.ts:186` explicitly setting `captured_by: input.marketplace_order_id`. Two distinct issues:
1. `marketplace_transaction_id` — a separate webhook input field — is accepted by the step's input type (Zod-validated) but **never consumed** in the function body. Dead parameter.
2. Even the `marketplace_order_id` value passed as `captured_by` doesn't survive to the API response — something in the payment-capture path is not persisting it, or it's being overwritten downstream.

**Not yet root-caused.** Needs its own investigation-mode task into Medusa's payment capture extension points — likely a timing issue (capture happening in a step later than where `captured_by` is set) or a field being clobbered by a subsequent workflow step. Logged as Engram obs #68.

**Status: open, filed separately, not folded into the widget task's scope.**

### 2.8 Debug learnings (undocumented Medusa behavior worth flagging for future upgrades)
- `query.graph()` does **not** return `quantity` or `raw_quantity` on order line items (both come back `undefined`) — quantities for reservation must be sourced from the original workflow input payload, not re-queried.
- The Sales Channel ↔ Stock Location link resolves correctly via `query.graph()` in the forward direction, but the reverse traversal (variant → location_levels → stock_locations → sales_channels) does not work reliably.
- `query.graph()` returns `required_quantity` as a plain JS number, not a BigNumber object — inconsistent with other quantity fields. A `asNumber()` helper handles both cases safely.
- **New this session:** Medusa's workflow engine can throw **plain objects**, not `Error` instances, at least on the `formatException`-wrapped HTTP-layer path. Any future error-handling code that gates on `instanceof Error` should assume this is unsafe — check for error-shaped properties (`code`, `type`, `message`) directly instead.

---

## 3. Tooling setup (this project)

### 3.1 Graphify
- Current graph (this session): **5,711 nodes, 20,676 edges, 299 communities.** Both new files from this session (`lib/client.ts`, `marketplace-order-metadata.tsx`) confirmed indexed (community 287 and 239 respectively).
- Known quirk: Graphify runs are sometimes blocked by the safety classifier when invoked via Claude Code agent — run manually when this happens:
  ```bash
  cd /Users/josh/work/high6-medusa-omnichannel-template
  graphify .
  ```

### 3.2 Engram
- Now in active use for this project. Recent observations: obs #66 (idempotency fix), #67 (unverified widget guard), #68 (captured_by bug), #69 (widget final disposition, links #67 + #68).
- Working pattern: log a final disposition observation at task close, explicitly separating verified vs. unverified vs. deferred sub-items rather than marking a task uniformly "done."

### 3.3 Additional plugins installed (v3, unchanged)
- `context7`, `frontend-design`, `medusa-dev` / MedusaDocs, `superpowers` (all `claude-plugins-official` / `medusa`).
- `frontend-design` used for the first time this session (Section 2.6) — no setup quirks encountered.

---

## 4. Carried forward — still open

### 4.1 Shopee & Lazada API wiring — **benched per team lead direction (this session)**
Deprioritized, not abandoned — will be requested later. Scope unchanged from v3:
- Webhook payload parsers (Shopee shape, Lazada shape → the normalized `MarketplaceOrderInput` shape already built).
- Webhook signature verification (currently a stubbed TODO in `webhooks/marketplace/orders/middlewares.ts`).
- Marketplace API client code: OAuth/auth, rate limiting, per-client credential storage/rotation.
- Which platform to prototype first — still undecided.
- Outbound sync (pushing stock levels/catalog *to* Shopee/Lazada) — not started.

**Research on record for when this resumes** (from this session's inquiry, not yet acted on):
- Selling as a registered Shopee seller requires DTI/SEC registration, BIR Certificate of Registration, and local business permits.
- Shopee Open Platform API access (Third-party Partner Platform) requires a registered business with valid documents for **production/go-live** credentials — but **sandbox testing does not**. A developer can register on Open Platform, create an app, and get test Partner ID/Key to build against the sandbox host independently of the client's business registration status. This means API wiring work, when resumed, isn't fully blocked on the client's paperwork — only production go-live is.
- Practical next step when resumed: get org access to the Shopee Open Platform developer console directly, since sandbox endpoint URLs found via search were inconsistent across sources and the console itself is the authoritative source.

### 4.2 New — `captured_by` / `marketplace_transaction_id` persistence bug (Section 2.7)
Not yet investigated at the source level. Needs its own investigation-mode task.

### 4.3 Marketplace order module — remaining deferred follow-ups
- Shipping mapping config (`shipping-mappings.ts`) is currently empty — needs real courier → `shipping_option_id` entries once real Shopee/Lazada payload samples are available. Blocked on 4.1 (now doubly blocked by the bench decision). The DB-backed-mapping infrastructure (vs. the current static config map) could still be scaffolded now, ahead of real data, if desired.
- ~~Admin UI for viewing marketplace order metadata~~ — **done this session (2.6).**
- ~~Unique DB constraint for idempotency~~ — **done this session (2.5).**

### 4.4 Also still open (carried from v1–v3, unchanged)
- **Role-based access** — still needs investigation into whether stock Medusa Admin permissions suffice, and a real conversation with Sir JM/Sir Jeff/client stakeholders on what roles a client team needs. Good candidate to start now — stakeholder scheduling takes calendar time regardless of dev bandwidth. **Next up — Section 4.5 (Cosmos Bazar) is queued to start after this.**
- Per-client instance provisioning/deployment approach.
- Client access-model question (dedicated site vs. admin access) in the omnichannel architecture's context.

### 4.5 New client project (scoped, not started) — Cosmos Bazar: pen/pencil shop with custom engraving

**Priority: queued after Role-Based Access (4.4).**

**Client context:** Cosmos Bazar, Inc. — a real, existing business (est. 1926, Binondo, Manila) and the exclusive distributor of Pilot writing instruments and Nichiban adhesive tapes in the Philippines, also carrying other Japanese brands (Bigen, Kokuryu, Tancho). Current live site: `https://shop.cosmos-bazar.com`. This project is a **remake of an actual existing client site**, not a hypothetical — described as "kind of separate, but coming from the omnichannel template."

**Relationship to the omnichannel template:** treat this as a new per-client instance provisioned from `high6-medusa-omnichannel-template`, reusing the already-settled architecture from Section 1 (Sales Channels, shared Stock Location pool, Pricing Module rule engine) rather than a from-scratch build. The per-client provisioning approach itself is still an open decision (Section 4.4) — worth resolving that first since it directly determines how Cosmos Bazar gets stood up.

**Core feature: engraving on pens — quantity-threshold-based free/paid pricing**

Business rule: pens are sold plain by default. A customer can choose an "Engraved" variant of a pen. Engraving carries an additional fee **unless** the customer orders enough units of that variant in one go, at which point engraving becomes free.

Feasibility confirmed this session against Medusa v2's native capabilities (source-cited, not assumed) — no custom pricing engine required:

| Requirement | Medusa mechanism |
|---|---|
| Customer picks "Engraved" at add-to-cart | Product Option (e.g. "Engraving: Plain / Engraved") generating a separate Variant. Product Options can be **global** — defined once at the store level and reused across every pen/pencil product, rather than rebuilt per product. |
| Fee applies below a quantity threshold, free at/above it | Native **tiered pricing** on the price set via `min_quantity`/`max_quantity` on each price — e.g. tier 1: `min_quantity: 1, max_quantity: 49` at the higher (engraved) price; tier 2: `min_quantity: 50` at the same price as the Plain variant. Threshold evaluates per line item/variant automatically — no custom workflow step needed for the pricing logic itself. |
| Threshold and fee amount editable without code | Price list tiers are editable directly in the Medusa Admin dashboard (click-to-edit per variant/currency), not API-only. |
| Custom engraving text (personalization) | The Cart/Order `LineItem.metadata` field natively supports arbitrary custom data — Medusa has a documented "Personalized Products" pattern for exactly this (custom text passed in `metadata` on add-to-cart, carried through automatically to the resulting Order line item). Requires: a storefront text input, and an Admin-side widget (same `order.details.after` pattern already used for marketplace metadata, Section 2.6) so fulfillment staff can see what to actually engrave. |

**Business rule clarified with Sir JM (resolved this session):**
- Engraving text does **not** need to be identical across different orders/customers — no platform restriction there.
- **Within a single order, one engraving text applies per variant, regardless of quantity** — e.g. 50 units of "Engraved Blue Pen" in one order share a single engraving text, not 50 individually unique texts. This is a deliberate business-rule restriction, not a Medusa limitation, and it simplifies the build significantly: one text = one line item = one quantity field, so the tiered-pricing threshold logic above applies directly without needing to sum quantities across multiple split line items (which would've been required if per-unit-unique text were allowed, since line items with differing metadata are treated as distinct items in Medusa).
- **Open follow-up, not yet asked:** whether this one-text-per-variant restriction is permanent or a starting point — worth confirming before the storefront UI is finalized, since supporting per-unit-unique text later would require a larger rebuild (multiple line items + quantity-summing threshold logic instead of a single line item's native tier pricing).

**Not yet decided / needs scoping before implementation:**
- Actual threshold quantity and engraving fee amount (business decision, not yet provided).
- Whether the threshold is uniform across all pen/pencil products or varies per product/SKU.
- Storefront UI/UX for the engraving text input and character limits/validation (free-text going onto a physical product).
- Per-client instance provisioning approach (shared open item, Section 4.4) — needs resolving as a prerequisite.

---

## 5. Standard structure — writing Claude Code prompts for this project

*(Unchanged from v3 — reproduced here for continuity.)*

```
## Task: [one-line description]

**Skills to invoke:** [Graphify / Engram / frontend-design — pick what applies]

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
- **Investigation before implementation:** for anything with an unverified assumption, always investigate first, report findings, and get direction before touching files.
- **Real evidence, not "should work":** claims about behavior (not just code) must be verified by actually running the thing. This session reinforced this twice: the idempotency error-shape assumption (`instanceof Error`) was wrong and only caught by the live concurrency test, and the widget's non-marketplace guard was left explicitly flagged as unverified rather than assumed correct from reading the code.
- **Inline brief pasting preferred** over referencing external files the Agent would need to locate itself.

---

## 6. Standard structure — responding to the Agent's plan or findings

*(Unchanged from v3.)*

1. **Acknowledge what's confirmed vs. still uncertain.** Flag assumptions in the Agent's report explicitly before approving.
2. **Ask for direct verification when the report's conclusion depends on behavior, not just code.**
3. **Approve scope explicitly and narrowly.**
4. **If the Agent's fix works, close the loop with a verification step** before considering the task done.
5. **Capture the outcome in the handoff doc** before moving to the next task.

---

## References

- `medusa-omnichannel-handoff-v3.md` — Sales Channel/pricing architecture, marketplace order module v1, three-gap fix
- `medusa-omnichannel-handoff-v2.md` — project bootstrap, environment fixes, prior open items
- `medusa-omnichannel-handoff-v1.md` — architecture pivot decision, Shopee/Lazada feasibility research
- `medusa-cms-handoff-v15.md` — final state of the benched multi-tenant project, reusable patterns
- `docs/marketplace-order-idempotency-investigation.md` — full source-level investigation for Section 2.5
- `INVENTORY-RESERVATION-INVESTIGATION.md` — full source-level investigation of the reservation gap (Section 2.4)
- Shopee Open Platform: https://open.shopee.com/
- Lazada Open Platform: https://open.lazada.com/
- Medusa `create-medusa-app` docs: https://docs.medusajs.com/learn/installation
- Cosmos Bazar (Section 4.5 client, current live site to be remade): https://shop.cosmos-bazar.com/about-us/
- Medusa "Personalized Products" recipe (engraving text pattern): https://docs.medusajs.com/resources/recipes/personalized-products
- Medusa Pricing Module — Price Tiers and Rules (quantity-threshold pricing): https://docs.medusajs.com/resources/commerce-modules/pricing/price-rules