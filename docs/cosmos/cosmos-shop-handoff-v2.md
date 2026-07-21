# Cosmos Shop — Handoff v2

**Session date:** 2026-07-19
**Repo:** `High6-Corporation/cosmos-shop`
**Carried forward from:** `cosmos-shop-handoff-v1.md` (2026-07-17 — fork, local infra, RBAC bootstrap, admin rebrand)

---

## 1. Session Summary

First session doing real commerce work on Cosmos Shop, following up on v1's pure-infrastructure
session. Covered, in order: a WooCommerce→Medusa v2 compatibility assessment of the client's real
product data, a small test-batch product import to validate the model end-to-end, inventory
reconciliation, and a full design + implementation pass on the engraving feature (Cosmos Shop's
core differentiator, flagged since v1).

**Status at end of session:**

- ✅ WooCommerce CSV (1,067 rows) assessed for Medusa v2 compatibility — full column mapping,
  gaps identified, brand/attribute/inventory/currency strategy decided
- ✅ 5 test-batch products imported (3 simple, 2 variable with 13 variations, 16 variants total)
  via custom script against Admin API workflows
- ✅ PHP region set up (provisional, pending client currency confirmation)
- ✅ Manual admin config: default currency changed to PHP, Sales Channel "Own Storefront"
  created, Stock Location "Default Stock Location (Test)" created and linked
- ✅ Inventory reconciled — all 16 test variants consolidated at one Stock Location,
  `manage_inventory: true`, real stocked quantities set
- ✅ Variant rendering verified directly in admin UI (not just via API counts) — no bugs found
- ✅ Engraving feature designed, reviewed, and implemented: merchant-facing eligibility +
  fee/threshold widget, customer-facing cart-hook pricing logic
- ✅ Graphify scope incident (accidentally indexed the whole `/Users/josh/work` root instead of
  `cosmos-shop/`) caught, root-caused, and fixed; guard added to `CLAUDE.md`
- 🟡 **Known architecture gap, not yet fixed:** engraving eligibility/fee/threshold is currently
  implemented at the **product** level, but needs to be at the **variant** level (see §6, next
  session item #3) — this is a rework of what was just built, not new scope
- ⛔ Storefront-side engraving UI (gate + line-item toggle) not built — blocked on storefront
  running + publishable API key (inherited blocker from v1 §7.3)

---

## 2. Environment Reference (New/Changed This Session)

| Item | Value |
|---|---|
| Store | `store_01KXX36V9QY6KFXHJ6Q14X32D2` (seed default, since manually reconfigured — see below) |
| Default currency | **PHP** (manually changed this session; was seed-default EUR) |
| PHP Region | `reg_01KXX38ETTWD318SFD8D98C0DZ` — "Philippines (Provisional)" — **not client-confirmed, flagged for swap/removal once currency is confirmed** |
| Sales Channel | "Own Storefront" (manually created this session; all test products assigned) |
| Stock Location | "Default Stock Location (Test)" (manually created this session, linked to "Own Storefront"; test variants' inventory consolidated here — old seed "European Warehouse" location now has zero items for these SKUs) |
| Admin URL | `http://localhost:9000/app` (unchanged from v1) |
| Test admin login | `superadmin@cosmosshop.dev` / `TestPass123!` (from v1, unchanged) |

**Resolves an open question from earlier in this session:** `initial-data-seed.ts` execution
status was previously unconfirmed. It's now confirmed indirectly — the seed-default Store exists
(it's the object that got manually reconfigured to PHP), so the seed did run at some point before
or during this session.

---

## 3. Test-Batch Products

| Product | Type | SKUs | Price (PHP) |
|---|---|---|---|
| Pilot BL-G2-10 Black G-2 Ball Pen | Simple | `P-BL-G2-10-B-TB` | 69.00 |
| Pilot BLS-G2-10 Black Ball Pen G-2 1.0 Refill | Simple | `P-BLS-G2-10-B-TB` | 46.50 |
| Pilot BPS-30SK Ball Pen | Simple | `P-BPS-30SK-TB` | 174.00 |
| Nichiban TN-TEI Ichioshi Tape Glue | Variable (6 COLOR) | `N-TN-TEI-TB-A` through `F` | 136.00 each |
| Panfix PCT Cellulose Tape | Variable (7 SIZE) | `N-PCT-TB*` | 35.75–70.00 |

All 16 variants: `manage_inventory: true`, 50 qty each, consolidated at "Default Stock Location
(Test)". Variant option values (COLOR, SIZE) verified correct directly in admin UI.

**⚠️ Known issue, not yet fixed:** re-running the import script will fail on these SKUs/handles —
Medusa soft-deletes reserve them permanently. A full-catalog import needs either fresh
handles/SKUs or a permanent-delete strategy. `cleanup-test-batch.ts` exists but wasn't run this
session (test data intentionally left in place for continued testing).

---

## 4. WooCommerce → Medusa v2 Compatibility Assessment

Full report: `docs/cosmos/wc-product-compatibility-report.md` (source: `wc-product-export-15-7-2026-1784079190575.csv`, 1,067 rows — 160 variable, 821 variation, 85 simple, 1 `variation, virtual` outlier).

**Key decisions made:**

| Area | Decision |
|---|---|
| Attribute names (35 distinct, many typo/case duplicates) | Import as-is, no normalization — cleanup deferred to admin post-import |
| Brand | Two disagreeing sources found in the CSV: `Brands` column (190 rows, Pilot/Kum only) vs. attribute-slot `Brand` (240 rows, Pilot/Cretacolor/Kum/Panfix — more complete). **Attribute-slot source is authoritative.** Maps to Medusa `ProductType` (`type_id`) — native, queryable, no custom module needed for 4 low-cardinality values |
| Inventory | Two-tier: 15 SKUs with real tracked quantities map directly; ~917 "in stock, no quantity" SKUs get `manage_inventory: false`; ~135 "out of stock" SKUs get `manage_inventory: true, stocked_quantity: 0` |
| Currency | **Unconfirmed with client.** Provisional PHP assumption applied to unblock test-batch work (see §2) — must be confirmed before any full-catalog import |
| Images | 1,064 of 1,067 rows have images (1,756 total URLs), all hosted on live `shop.cosmos-bazar.com`. Fine for dev; needs re-hosting (CDN or Medusa File Module) before production due to link-rot risk |

**Still-open items from the compatibility report**, not addressed this session: category
hierarchy (36 flat categories — unclear if any should nest), `PPOM Fields` data decoding (may
hold per-product engraving eligibility from the WooCommerce side), the 1 `variation, virtual`
outlier product's handling.

---

## 5. Engraving Feature — Design & Implementation

Design doc: `docs/cosmos/engraving-pricing-design.md`

**Business rule (confirmed with Yanyan):** engraving fee and free-engraving threshold are **merchant-editable fields**, not fixed global values — set per product/variant by whoever manages the store, not hardcoded or gated on a client decision. Formula:

```
if engraved:
  if quantity < threshold → fee_total = fee_per_unit × quantity
  else → fee_total = 0 (free)
else:
  no price change
```

**Two-mechanism design:** a merchant-facing eligibility flag (admin, gates whether the storefront
offers engraving at all) is separate from the customer-facing per-line choice (storefront,
captures the actual order-time decision). These can't share one field — see design doc §4 for the
full reasoning.

**Implemented this session (4 files):**

| File | Purpose |
|---|---|
| `api/admin/products/[id]/engravable/route.ts` | POST endpoint toggling eligibility + fee/threshold. Zod-validated: if eligible=ON, both fee and threshold are required and must be `> 0` — no silent free/broken engraving allowed |
| `admin/widgets/engravable-toggle.tsx` | Widget at `product.details.after` — Switch + fee/threshold inputs (shown when ON), following the confirmed `tenant-filter.tsx` pattern from `high6-medusa-commerce` |
| `utils/engraving-pricing.ts` | Pure functions: `calculateEngravingPricing`, `validateEngravingEligibility` |
| `workflows/register-engraving-pricing.ts` | Cart hooks on `addToCartWorkflow` / `createCartWorkflow` — validates eligibility, applies fee when `engraved && qty < threshold` |

Build verified: backend and frontend both compile clean. Graphify re-indexed to 1,787 nodes
(correctly scoped to `cosmos-shop/` — see §7).

**🔴 Known gap — priority item for next session:** eligibility/fee/threshold are currently stored
at the **product** level (`product.metadata`), but engraving eligibility actually varies by
**variant** — e.g. a pen's Blue color might be engravable while a limited-edition color isn't, or
different variants might warrant different fees. This needs to move from product-level metadata
to variant-level metadata, with the widget and cart hook logic updated to match. This is a rework
of what was just built, not new scope — see §6 item #3.

---

## 6. Next Session Starting Point

1. **Variant-level images in product creation.** Medusa's default image model is product-level
   only (`product.images[]`), not per-variant. Needs investigation into whether this is a hard
   platform limitation or workaroundable (e.g. tagging images by variant in metadata, or a custom
   field) — relevant both for real product data (some WooCommerce rows have
   `Woo Variation Gallery Images`, flagged but unhandled in the compatibility report) and for
   general usability.
2. **Flexible option-value creation in the Variants UI.** Currently, creating/editing variants in
   admin only lets you pick from option values that already exist — it should let the merchant
   add new option values on the fly instead of being limited to whatever was set up beforehand.
   Needs investigation into Medusa's default admin flow here before deciding whether this needs a
   custom widget/route or if it's a configuration gap.
3. **Move engraving from product-level to variant-level** (see §5 above) — rework
   `engravable-toggle.tsx`, the admin API route, and `register-engraving-pricing.ts` so
   eligibility/fee/threshold are set per-variant, not per-product.
4. **Storefront UI/UX** — deliberately sequenced after the admin dashboard setup is finalized
   (items 1–3 above), not before. Includes the still-pending engraving storefront gate + line-item
   toggle from §5, plus general storefront work blocked since v1 on the publishable API key.

---

## 7. Notable Findings / Incidents This Session

- **Graphify scope incident:** an in-session `graphify update .` was run from `/Users/josh/work`
  instead of `cosmos-shop/`, which merged Cosmos Shop's graph into a shared 176,540-node
  multi-project index. Root cause: the re-index command omitted the `cd` into `cosmos-shop/` that
  query commands were using. Fixed by restoring the work-root graph from its July 17 backup
  (verified node-for-node identical post-restore) and confirming `cosmos-shop/graphify-out/`
  itself was never touched (1,750 → 1,787 nodes, consistent growth from this session's actual
  file changes). **Guard added to `cosmos-shop/CLAUDE.md`** warning that `graphify update` must
  be run from inside the project root.
- **Report-accuracy pattern worth carrying forward:** several agent-reported figures needed
  correction this session before being trusted (an image-count error, an unsupported
  currency/country speculation, an incomplete brand-data claim, and a GitHub issue citation that
  didn't actually support the claim it was attached to). All were caught by independently
  re-deriving the underlying numbers/sources rather than accepting summary claims at face value.
  Worth keeping that verification habit for future sessions, especially on any claim citing an
  external source (docs, GitHub issues) as justification for a design decision.

---

## 8. Engram Entries (to confirm/log)

| # | Type | Summary |
|---|---|---|
| TBD | feature | Test-batch product import + inventory reconciliation complete for Cosmos Shop |
| TBD | discovery | WooCommerce CSV brand data has two disagreeing sources (Brands column vs attribute-slot Brand); attribute-slot is authoritative |
| TBD | feature | Engraving eligibility + fee/threshold implemented (product-level) — merchant-editable fields, not global constants |
| TBD | discovery | Engraving needs to be variant-level, not product-level — flagged for next session rework |
| TBD | incident | Graphify work-root contamination from mis-scoped `update` command — root-caused, restored, guarded in CLAUDE.md |

*(Exact Engram entry numbers to be confirmed by whoever's session actually persisted them.)*