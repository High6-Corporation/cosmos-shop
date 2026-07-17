# Medusa Commerce Integration (Omnichannel, Per-Client) — Handoff Document

> **Status:** New project, session 1. Architecture direction confirmed in team meeting this session — supersedes the multi-tenant approach (see `medusa-cms-handoff-v15.md`, now benched). No implementation yet. This session covered: direction confirmation, initial rationale capture, and early research into Shopee/Lazada API feasibility for the omnichannel model.
> **Date:** July 9, 2026
> **Version:** v1 (old document)
> **Summary:** Team decision this session: instead of one shared Medusa instance serving multiple tenants (the now-benched approach), each client gets their own dedicated Medusa instance, following Medusa's native architecture rather than working against it. Each client's instance is then omnichannel — one Medusa, multiple sales channels (own storefront, Shopee, Lazada, etc.), which is what Sales Channels are actually designed for in stock Medusa. This removes the entire class of tenant-isolation problems the prior project spent several sessions solving (cross-tenant leaks, write-time alignment guards, cascade validation) because there's only ever one tenant per instance. Initial research this session confirmed both Shopee and Lazada publish official partner APIs suitable for this model.

---

## 1. Architecture — why the pivot, and what changes

### 1.1 The problem with the prior approach
The multi-tenant model (one Medusa instance, N tenants, isolation enforced via custom guards on every write path) worked — all guard work reached a fully closed, live-verified state — but required building and maintaining a parallel isolation layer on top of Medusa that doesn't exist in stock Medusa. Every new entity relationship (Sales Channel, Stock Location, Inventory Level, Reservation, Draft Order) needed its own bespoke tenant-alignment guard, discovered one leak at a time.

### 1.2 The new model
**One Medusa instance per client.** Each instance is fully isolated at the infrastructure level (separate database, separate deployment) rather than isolated at the application level via custom guards. Within a single client's instance, Medusa's own Sales Channel concept is used for its intended purpose: one store, multiple channels (own storefront + Shopee + Lazada + others), not as a tenant-isolation mechanism.

**What this removes:**
- No `Product↔Tenant`, no `Sales Channel↔Tenant`, no `Stock Location↔Tenant` link tables
- No `validateTenantAlignment`-style write guards
- No tenant-scoped admin filters
- No cross-tenant leak class of bug at all — there's nothing to leak across, since there's only one tenant per instance

**What this adds:**
- Per-client instance provisioning/deployment overhead (new territory — not yet scoped)
- Role-based access **within** a single client's instance (see Section 2) — a different problem than tenant isolation, but may reuse some of the same guard-writing discipline
- External marketplace channel wiring (Shopee, Lazada) — see Section 3

---

## 2. Role-based access — design context (not yet implemented)

With tenant isolation removed, the access-control question shifts shape: instead of "which tenant can see/write this," it becomes "which role, within one client's team, can see/write this." This is a materially different problem — closer to standard Medusa Admin user roles/permissions than the custom tenant-registry pattern used previously.

**Not yet scoped this session.** Flagging the shape of the problem for next session:
- Does stock Medusa's built-in Admin user/permission system cover this out of the box, or does it need the same kind of custom layer the tenant work needed? (Needs investigation — don't assume either way.)
- What roles actually exist for a client team? (e.g. store owner/full access, catalog manager, order fulfillment staff, read-only/reporting) — needs a real conversation with Sir JM/Sir Jeff/client stakeholders, not an assumed list.
- Does this connect to the still-unresolved `User↔Tenant` question carried over from the benched project, or is that now moot since "tenant" isn't a first-class concept anymore in this model?

---

## 3. External marketplace integration — Shopee & Lazada (research started this session)

### 3.1 Feasibility — confirmed
Both platforms publish official partner/open APIs suitable for this integration:

**Shopee (Open Platform, v2 API)**
- Coverage: shop, products, orders, logistics, returns, payments, vouchers, bundle/add-on deals, account health
- Real-time push webhooks (order, return, logistics, payment, item events) via HMAC-SHA256-signed delivery to a partner endpoint — supports event-driven sync, not just polling
- Auth: partner_id/shop_id + HMAC-SHA256 request signing (not a simple API key — needs its own signing implementation)
- **Known constraint:** strict per-shop-per-minute rate limits — bulk operations (e.g. initial catalog sync for a new client) need request queuing and backoff, not a naive loop

**Lazada (Open Platform)**
- Coverage: products, orders, logistics, inventory, seller data
- Auth: OAuth-style access_token + refresh_token per seller account, scoped per seller/country
- Old Seller Center API is fully decommissioned — Open Platform is the only current path in, no legacy fork to account for

### 3.2 Open scoping questions (not yet answered)
- Which platform to prototype first — no decision made yet
- Sync direction and source of truth: does Medusa push to Shopee/Lazada (Medusa owns catalog/inventory), or do orders flow the other way into Medusa (marketplace owns the order, Medusa needs to ingest it)? Likely both directions for different data types (products out, orders in) but not confirmed
- Whether Shopee/Lazada map cleanly onto Medusa's existing Sales Channel concept (one channel per marketplace) or need a separate integration layer sitting beside Medusa
- Per-client credential management — each client's Shopee/Lazada seller accounts need their own OAuth tokens; how this is stored/rotated across N per-client Medusa instances is unscoped
- Rate-limit-safe sync architecture (queue-based, not live pass-through) — direction is clear, implementation isn't started

### 3.3 Explicitly not started
No code, no prototype, no architecture diagram yet. This section reflects research only.

---

## 4. Carried-forward reusable patterns from the benched project

See `medusa-cms-handoff-v15.md` Section 4 for full detail. Summary of what's worth reapplying here even though tenant isolation itself doesn't apply:
- Investigation-before-implementation discipline (Step 0 pattern) — especially relevant for the role-based access question and the Shopee/Lazada sync direction question, both of which have unverified assumptions baked in right now
- Middleware-over-hooks default assumption for native Medusa workflow customization
- Fail-closed-by-default stance as a starting point for any new guard/permission work

---

## 5. Immediate next actions

1. Decide role-based access scope — needs a real conversation on what roles exist per client team, and whether stock Medusa Admin permissions cover it before building anything custom.
2. Decide which marketplace (Shopee or Lazada) to prototype first.
3. Scope sync direction and source-of-truth per data type (catalog, inventory, orders) before writing any integration code.
4. Scope per-client instance provisioning/deployment approach — new territory, not addressed yet.
5. Re-raise the still-unanswered questions from the benched project that may or may not still be relevant: client access-model question (dedicated site vs. admin access) may need to be re-asked in this new architecture's context, since the answer space has changed.

---

## References

- `medusa-cms-handoff-v15.md` — final state of the benched multi-tenant project, reusable patterns
- Shopee Open Platform: https://open.shopee.com/
- Lazada Open Platform: https://open.lazada.com/
