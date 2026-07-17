# Medusa Commerce Integration (Omnichannel, Per-Client) — Handoff Document

> **Status:** Sales Channel / inventory / pricing architecture settled and implemented. Marketplace order-ingestion module implemented and verified end-to-end (including fulfillment). Graphify tooling and supporting plugins set up for this project. Shopee/Lazada API wiring (parsers, auth, webhook signature verification) still not started.
> **Date:** July 10, 2026
> **Version:** v3 (supersedes v2)
> **Summary:** Session 3 covered: (1) Sales Channel / shared-inventory / pricing architecture decisions, (2) Graphify skill setup for this project plus several supporting Claude Code plugins, (3) investigation and implementation of native marketplace Order creation via `createOrderWorkflow`, including discovery and fixing of three behavioral gaps in that workflow's direct-payload path, verified end-to-end through fulfillment.

---

## 1. Architecture decisions (settled this session)

### 1.1 Sales Channels = "Site Commerce Frontend"
Each Sales Channel (Own Storefront, Shopee, Lazada) is gated by its own Publishable API Key, which scopes what products/data a given channel can see. A product can belong to multiple channels or be exclusive to one.

### 1.2 Shared inventory pool (not per-channel)
One Stock Location is linked to all three Sales Channels. This is Medusa's native pattern, not a workaround — Stock Location (where inventory lives) and Sales Channel (where it's sold) are separate concepts, and reservations happen against the shared pool regardless of which channel placed the order. Orders are tagged with `sales_channel_id` for accurate per-channel reporting; the stock pool itself is not split.

The real complexity is at the marketplace boundary, not inside Medusa: Shopee/Lazada hold their own inventory counts on their platform, so stock levels must be pushed out, and there's an inherent race window before sync catches up. Not solved yet — still open (see Section 4).

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
| Payment | Order created already paid, via Medusa's manual payment provider (`pp_system_default`), captured immediately at creation. Marketplace transaction ID stored as metadata on the payment for audit trail. No real payment capture attempted — payment already happened on the marketplace platform. |
| Tax | Pass through marketplace-computed tax as-is. No Medusa tax recalculation. |
| Pricing | Marketplace price preserved as-is (`is_custom_price: true`). No Medusa Price List recalculation. |
| Webhook route | Dedicated path `src/api/webhooks/marketplace/orders/route.ts` — not under `/store` or `/admin`, since webhook traffic is a distinct trust model (server-to-server from the marketplace, not a storefront client or an admin session). Signature verification stubbed as TODO (exact scheme is marketplace-specific — deferred until Shopee/Lazada parsers are built) rather than a static shared secret, per standard webhook security practice (Stripe/Shopify/GitHub pattern). |
| Shipping mapping | Simple TypeScript config map (courier name → `shipping_option_id`) for now, with fallback to a custom shipping method (name + amount, no linked option) when no mapping exists. Documented trigger to move to a DB-backed mapping: if/when per-client instances (`medusa-{client-slug}`) need different courier mappings, since a static config map won't scale across multiple provisioned clients. |
| Idempotency | Dedupe key is `metadata.marketplace` + `metadata.marketplace_order_id` on the Order, checked via the Order module's own filter before calling `createOrderWorkflow`. Known race-condition window between check and create — mitigation (DB unique constraint via migration) deferred as a follow-up, not yet implemented. |

### 2.3 Project structure
```
apps/backend/src/
├── workflows/marketplace/
│   ├── create-marketplace-order.ts       # Workflow composition
│   ├── shipping-mappings.ts              # Courier → shipping option config map
│   └── steps/
│       ├── check-idempotency.ts          # Dedupe check
│       ├── normalize-order-input.ts      # MarketplaceOrderInput → createOrderWorkflow shape
│       ├── create-or-get-order.ts        # Create + payment capture, or return existing
│       └── reserve-order-inventory.ts    # Inventory reservation (added — see 2.4, gap #3)
│
└── api/
    ├── middlewares.ts                    # Central middleware registration
    └── webhooks/marketplace/orders/
        ├── route.ts                      # POST /webhooks/marketplace/orders
        └── middlewares.ts                # Zod validation + signature TODO stub
```

### 2.4 Three gaps found in `createOrderWorkflow`'s direct-payload path — all fixed & verified

`createOrderWorkflow` (called with a direct payload, no Cart) behaves as a lower-level building block — it does **not** automatically handle several things that Medusa's own cart-completion flow (`completeCartWorkflow`) orchestrates explicitly around it. Each gap below was confirmed at the source-code level, not assumed:

| # | Gap | Root cause (confirmed via source) | Fix |
|---|---|---|---|
| 1 | Payment collection not auto-created | `createOrderWorkflow` doesn't create a `PaymentCollection` on the direct-payload path | Explicitly create + link one in `create-or-get-order.ts` |
| 2 | Order totals stale after tax lines | Workflow returns the pre-tax-refresh order (`total: 0`) | Re-fetch the fresh order from DB after workflow completion, in `create-or-get-order.ts` |
| 3 | **Inventory never reserved** | `createOrderWorkflow` calls `confirmVariantInventoryWorkflow` → `inventoryService.confirmInventory()`, which is a **read-only availability check** (`MathBN.gte`, returns boolean, no DB write). It never calls `reserveInventoryStep` — unlike `completeCartWorkflow` and `convertDraftOrderWorkflow`, which both call `reserveInventoryStep` and create real `reservation_item` rows. Confirmed via direct source inspection of `@medusajs/core-flows` and `@medusajs/inventory`. | New step `reserve-order-inventory.ts` (190 lines), added to `create-marketplace-order.ts` (+12 lines), using `prepareConfirmInventoryInput` — the same utility Medusa's own cart/draft-order paths use |

**Why gap #3 mattered more than a data-accuracy issue:** without it, any marketplace order containing a `manage_inventory: true` item would fail outright at fulfillment — `createOrderFulfillmentWorkflow` reads and requires an existing reservation, and throws `"No stock reservation found"` if none exists (it never creates one). This wasn't just a shared-stock-pool accuracy gap; it was a hard fulfillment blocker.

**Verification (real evidence, not "should work"):**
- Before fix: `reserved_quantity: 0`, zero reservation items.
- After fix (order `order_01KX5SPXR5WA5C1Z0J4DK6Y5TR`): reservation created matching order quantity (qty=3); fulfillment run end-to-end returned `200 OK`, `fulfilled_quantity: 3`, no errors.
- Idempotency verified separately: 3 identical webhook calls with the same `marketplace_order_id` (`SHOPEE-250710-JKL012`) all returned the same Order ID; only one Order exists in the DB.
- Pricing/tax verified on the created order: `is_custom_price: true`, `unit_price: 25.50` (exact input match), `tax_lines: [{code: "VAT-12", rate: 0.12}]` passed through unmodified.
- Payment collection verified: `status: "completed"`, `captured_amount` matches order total, `captured_by` set to the marketplace order ID.

### 2.5 Debug learnings (undocumented Medusa behavior worth flagging for future upgrades)
- `query.graph()` does **not** return `quantity` or `raw_quantity` on order line items (both come back `undefined`) — quantities for reservation must be sourced from the original workflow input payload, not re-queried.
- The Sales Channel ↔ Stock Location link resolves correctly via `query.graph()` in the forward direction (sales channel → stock locations), but the reverse traversal (variant → location_levels → stock_locations → sales_channels) does not work reliably.
- `query.graph()` returns `required_quantity` as a plain JS number, not a BigNumber object — inconsistent with other quantity fields elsewhere in the module. A `asNumber()` helper was used to handle both cases safely.

---

## 3. Graphify setup (this project)

- Skill installed at `.claude/skills/graphify/` (all 8 `references/*.md` files present, verbatim match to the standard skill definition).
- `graphifyy` v0.8.35 installed via `uv tool install`.
- `GEMINI_API_KEY` initially placed in `~/.zshrc` — **did not work**, because Claude Code's bash tool appears to spawn non-interactive shells, which don't source `.zshrc`. Fixed by moving the export to `~/.zshenv`, which is sourced by every zsh invocation (interactive or not). Confirmed working (53-char key visible via `echo $GEMINI_API_KEY` from a fresh Claude Code shell).
- **Known limitation:** Claude Code's auto-mode safety classifier blocks agent-initiated calls to `extract_corpus_parallel(backend='gemini')` and `graphify . --update` from within an agent session — it can't evaluate the safety of the outbound LLM API call and rejects it preemptively. Workaround: run `graphify . --update` directly in your own terminal (not via the agent) to get Gemini-backed extraction. Running it from Claude Code falls back to Claude subagents instead, which still works but doesn't benefit from the Gemini key.
- Initial full graph build (this session, fresh — previous graph from July 7 was stale): **1,180 nodes, 2,107 edges, 64 communities**. Output at `graphify-out/graph.html`.
- Used during the Order-creation investigation (Section 2.1) to navigate the codebase rather than manual file search.

### 3.1 Additional plugins installed this session
- `context7` (`claude-plugins-official`)
- `engram` (`engram`)
- `frontend-design` (`claude-plugins-official`)
- `medusa-dev` / **MedusaDocs** (`medusa`)
- `superpowers` (`claude-plugins-official`)

No usage/configuration notes captured yet for these beyond installation — first real usage and any setup quirks (similar to the Graphify `.zshenv` issue) should be logged here as they come up.

---

## 4. Carried forward — still open

### 4.1 Shopee & Lazada API wiring (not started)
- Webhook payload parsers (Shopee shape, Lazada shape → the normalized `MarketplaceOrderInput` shape already built).
- Webhook signature verification (currently a stubbed TODO in `webhooks/marketplace/orders/middlewares.ts`) — exact scheme depends on each marketplace's docs, not yet researched.
- Marketplace API client code: OAuth/auth, rate limiting, per-client credential storage/rotation across N provisioned instances.
- Which platform to prototype first — still undecided.
- Outbound sync (pushing stock levels / catalog *to* Shopee/Lazada) — direction is understood conceptually (per Section 1.2) but no implementation started. This is the piece that actually protects the shared-stock pool from marketplace-side overselling; it doesn't exist yet.

### 4.2 Marketplace order module — deferred follow-ups
- Unique DB constraint on `(metadata.marketplace, metadata.marketplace_order_id)` to close the idempotency check's race-condition window (currently only a soft check-then-create, not atomic).
- Shipping mapping config (`shipping-mappings.ts`) is currently empty — needs real courier → `shipping_option_id` entries once real Shopee/Lazada payload samples are available.
- Admin UI for viewing marketplace order metadata (transaction ID, marketplace order ID, etc.) — not built, currently only visible via raw metadata inspection.

### 4.3 Also still open (carried from v1/v2, unchanged)
- Role-based access — still needs investigation into whether stock Medusa Admin permissions suffice, and a real conversation with Sir JM/Sir Jeff/client stakeholders on what roles a client team needs.
- Per-client instance provisioning/deployment approach.
- Client access-model question (dedicated site vs. admin access) in the omnichannel architecture's context.

---

## 5. Standard structure — writing Claude Code prompts for this project

*(Unchanged from v2 — reproduced here for continuity.)*

```
## Task: [one-line description]

**Skills to invoke:** [Graphify / Engram / UI-UX Pro Max — pick what applies]

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
- **Real evidence, not "should work":** claims about behavior (not just code) must be verified by actually running the thing — this session's inventory-reservation gap is a direct example of why: the first explanation offered ("reserves only at fulfillment") was plausible-sounding and wrong.
- **Inline brief pasting preferred** over referencing external files the Agent would need to locate itself.

---

## 6. Standard structure — responding to the Agent's plan or findings

*(Unchanged from v2.)*

1. **Acknowledge what's confirmed vs. still uncertain.** Flag assumptions in the Agent's report explicitly before approving.
2. **Ask for direct verification when the report's conclusion depends on behavior, not just code.**
3. **Approve scope explicitly and narrowly.**
4. **If the Agent's fix works, close the loop with a verification step** before considering the task done.
5. **Capture the outcome in the handoff doc** before moving to the next task.

---

## References

- `medusa-omnichannel-handoff-v2.md` — project bootstrap, environment fixes, prior open items
- `medusa-omnichannel-handoff-v1.md` — architecture pivot decision, Shopee/Lazada feasibility research
- `medusa-cms-handoff-v15.md` — final state of the benched multi-tenant project, reusable patterns
- `INVENTORY-RESERVATION-INVESTIGATION.md` — full source-level investigation of the reservation gap (Section 2.4)
- Shopee Open Platform: https://open.shopee.com/
- Lazada Open Platform: https://open.lazada.com/
- Medusa `create-medusa-app` docs: https://docs.medusajs.com/learn/installation