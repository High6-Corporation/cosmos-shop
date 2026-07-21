# Cosmos Shop — Handoff v3

**Session date:** 2026-07-20
**Repo:** `High6-Corporation/cosmos-shop`
**Carried forward from:** `cosmos-shop-handoff-v2.md` (2026-07-19 — WooCommerce compatibility assessment, test-batch import, engraving feature product→variant rework)

---

## 1. Session Summary

This session covered four threads, in order: (1) investigation into variant-level images
(closed — built-in Medusa feature, no work needed), (2) bulk-edit UX design and implementation
for engraving settings across multiple variants at once, (3) a `patch-package` fix enabling
inline option-value creation in the product creation wizard, and (4) the first storefront-side
work — a flag gate + per-line engraving toggle, which surfaced a **blocking backend bug**
unrelated to engraving.

**Status at end of session:**

- ✅ Variant-level images investigated and closed — fully supported since Medusa v2.11.2, no
  implementation needed (built-in Media → "Edit images" UI on variant detail page)
- ✅ WooCommerce `Woo Variation Gallery Images` column confirmed empty (0/1,067 rows) — no
  migration work, compatibility report flag closed
- ✅ Bulk-edit UX for engraving designed and implemented — widget at `product.details.after`
  with DataTable + row selection + CommandBar + Drawer, applies fee/threshold/eligibility to
  multiple selected variants at once. Verified working.
- ✅ `patch-package` fix applied to `@medusajs/dashboard@2.17.2` — uncommented a disabled
  `onCreateOption` handler so merchants can type new option **values** inline (not just new
  option titles) during product creation, without leaving the form
- ✅ Product Options confirmed to be global by data model (no `product_id` on `ProductOption`) —
  decision made to normalize the WooCommerce CSV's 35 raw attribute names to ~8 canonical names
  during the full-catalog import, rather than pre-populating raw names (would create duplicate
  clutter)
- ✅ Publishable API key generated and Sales Channel linked — **unblocks storefront work**
  (was blocked since v1 §7.3)
- ✅ Storefront engraving flag gate + per-line Yes/No toggle built (4 files) — code verified
  correct, but **cannot be end-to-end tested** due to a pre-existing backend bug (see §3)
- 🔴 **New blocking bug found, not caused by this session's work:** `addToCartWorkflow` fails
  with `unknown_error` for every product/variant, with or without engraving metadata. Confirmed
  across 10+ products, with backend freshly restarted. This blocks all cart/checkout work,
  not just engraving — see §3 for details. **Top priority for next session.**
- 🟡 Two more pre-existing, non-blocking issues discovered in the storefront template: Next.js
  production build fails on `/404` prerendering (React error #31), and ~100 TypeScript `TS2786`
  errors from a React 19 FC-type incompatibility across the template. Neither blocks dev-mode
  work; noted for later cleanup.

---

## 2. Environment Reference (New/Changed This Session)

| Item | Value |
|---|---|
| Publishable API key | `pk_9700557e66ae075cce2f3c4f00d2829ae6466dbf39ce7ea94650beba18941d42` — linked to "Own Storefront" sales channel. **Stored in storefront `.env` as `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`** — confirm this matches the storefront's actual SDK client init (`src/lib/config.ts` or equivalent) before assuming; do not hardcode the key anywhere in source. |
| Sales Channel | "Own Storefront" (created v2, unchanged) — now has a publishable key attached |
| `patches/@medusajs+dashboard+2.17.2.patch` | New — uncomments `onCreateOption` on the variant-value Combobox (product creation wizard), adds two hint strings. Applied via existing `postinstall` patch-package setup. Reason for the original comment-out: commit `6eff867` ("feat: global product options (#13817)") — refactor oversight, not an intentional disable. **Caution:** `medusa develop` serves from a Vite cache at `apps/backend/node_modules/.vite/` — must `rm -rf` that directory after any patch change before restarting, or the patch won't take visible effect. |
| `admin.maxUploadFileSize` | Increased 1MB → 5MB in `medusa-config.ts` |
| Admin URL / test login | Unchanged from v1/v2 (`http://localhost:9000/app`, `superadmin@cosmosshop.dev` / `TestPass123!`) |

---

## 3. 🔴 Blocking Bug: Cart Line-Item Add Fails for All Products

**This is unrelated to engraving and blocks all storefront cart/checkout work — fix first, next session.**

- `POST /store/carts` succeeds (200) — cart creation is fine.
- `POST /store/carts/:id/line-items` fails with a generic `unknown_error` for **every** product
  tested (10+, across multiple categories), **with or without** engraving metadata on the
  request.
- Ruled out as an engraving-toggle side effect: reproduced with no `metadata` field on the
  request at all, and with non-engravable variants.
- Ruled out as stale state: backend was restarted fresh, bug persists.
- `register-engraving-pricing.ts` (the cart hook) is structurally correct — reads
  `item.metadata.engraved`, validates eligibility, applies `calculateEngravingPricing()` — but
  something in `addToCartWorkflow` fails before or during hook execution. The generic error
  message doesn't localize where.

**Next session starting point:** add logging/tracing inside `addToCartWorkflow` (or bisect by
temporarily removing the engraving hook registration to confirm whether the hook itself is the
failure point, vs. something else in the workflow). Do not assume the engraving hook is the
cause just because it's the newest addition to that workflow — verify directly, since the bug
reproduces with plain non-engravable products too.

---

## 4. Storefront Engraving — What's Built, What's Unverified

Implements §3.4 of `docs/cosmos/engraving-pricing-design.md` (Approach B: line-item metadata +
cart hook, not a variant fork).

| File | Change |
|---|---|
| `apps/storefront/src/modules/products/components/engraving-toggle/index.tsx` (new, 83 lines) | Yes/No toggle with contextual fee messaging (e.g. "₹25/unit — free at 10+ units"), reads fee/threshold from variant metadata |
| `apps/storefront/src/modules/products/components/product-actions/index.tsx` | Reads `variant.metadata.is_engravable`, renders toggle conditionally, passes `metadata: { engraved: true }` to `addToCart()` |
| `apps/storefront/src/lib/data/cart.ts` | `addToCart()` now accepts an optional `metadata` param, passed through to the SDK's `createLineItem` |
| `apps/storefront/src/lib/data/products.ts` | Added `*variants.metadata` to the product fields query so `is_engravable`/fee/threshold are available client-side |

**Verified:** non-engravable variants render no engraving UI; engravable variants render the
toggle with correct fee messaging; frontend build compiles clean (dev server starts in 1.2s; the
TS2786 errors are pre-existing and unrelated).

**Not verified (blocked by §3):** whether choosing "Yes" and adding to cart actually results in
`engraved: true` landing on the line item, and whether the cart total then reflects the fee
correctly under/at threshold. The code path looks correct by inspection but cannot be confirmed
until the cart bug is fixed. **Do not assume this works — re-test explicitly once §3 is
resolved**, using an engravable test-batch variant (Nichiban Aqua fee=25/threshold=10, or Cherry
fee=30/threshold=5) at both under- and at-threshold quantities.

---

## 5. Variant-Level Images — Closed, No Work Needed

Investigated and confirmed **fully supported** since Medusa v2.11.2 — this was a documentation
blind spot, not a platform gap.

| Layer | Status |
|---|---|
| Data model | `ProductVariant.images` ↔ `ProductImage.variants` many-to-many (pivot: `ProductVariantProductImage`) |
| Admin API | `POST /admin/products/:id/variants/:variant_id/images/batch`, `sdk.admin.product.batchVariantImages()` |
| Admin UI | Built-in — variant detail page → Media section → "Edit images" drawer; also "Manage associated variants" from the image side |
| Store API | `StoreProductVariant.images` returns `BaseProductImage[]` |

WooCommerce `Woo Variation Gallery Images` column confirmed empty (0/1,067 rows) — the earlier
compatibility-report flag on this is closed, no migration work required.

Design doc: `docs/cosmos/variant-images-design.md` §1.

---

## 6. Bulk-Edit UX for Engraving — Implemented

Design doc: `docs/cosmos/variant-images-design.md` §2. Solves the tedium of clicking into each
variant individually to set engraving (flagged as a carry-forward item since the original
engraving rework).

**Investigation findings:**
- No injection zone exists on the built-in variants table on the product detail page (same class
  of limitation as the product-creation wizard, but a distinct surface — verified separately).
- Medusa UI (`@medusajs/ui` v4.1.19) has a full bulk-action framework available:
  `DataTable` + `createDataTableColumnHelper` + `createDataTableCommandHelper` + `CommandBar`.
- Scope decision: bulk-apply **full settings** (fee + threshold + eligibility together), not
  toggle-only — matches how a merchant actually thinks ("all these colors engrave at $25/unit,
  free over 10"). Drawer pre-fills only when all selected variants already share the same value;
  otherwise fields are left blank to avoid silently overwriting intentional per-variant
  differences.

**Files built:**

| File | Lines | Purpose |
|---|---|---|
| `admin/widgets/engraving-bulk.tsx` | 480 | Widget at `product.details.after` — DataTable with checkbox selection, CommandBar, Drawer for bulk fee/threshold/eligibility entry |
| `api/admin/products/[id]/engravable/bulk/route.ts` | 97 | POST — validates `variant_ids[]` + settings, loops `updateProductVariants()` (no native bulk-metadata endpoint exists; documented ceiling of ~50 variants/product, acceptable at current scale) |

Reuses `validateEngravingEligibility` from `utils/engraving-pricing.ts` — no duplicated
validation logic. Does not touch the existing single-variant widget/route, cart hooks, or the
patch-package fix. Verified working via manual test (multi-variant product, subset selection,
confirmed only selected variants updated).

---

## 7. Product Options — Global by Design, Decision Made

Investigated whether options could be scoped per-product to avoid a growing pile of near-duplicate
global options (e.g. multiple "Color" options with slightly different names/casing).

**Finding:** `ProductOption` has **no `product_id` field** — options are always global,
linked to products via a many-to-many join. Verified via direct API inspection (creating an
inline option makes it appear immediately in the global `GET /admin/product-options` list;
reusing a title creates a new option ID rather than deduplicating). Medusa's "product-specific"
language in its own docs refers to a *usage convention* (created inline during product creation,
not yet reused elsewhere), not a data-model guarantee.

**Decision:** don't pre-populate the CSV's 35 raw attribute names as global options (would create
duplicate-name clutter and picker confusion — worse than the problem it solves). Instead,
normalize 35 raw names → ~8 canonical names (Ink Color, Barrel Color, Barrel Design, Tip Size,
Nib Type, Lead Color, Lead Grade, Grip Color) **during the full-catalog import script** — not
done yet, scoped for whenever that import is built.

The `patch-package` fix (§2) separately solves the *discoverability* problem for merchants
creating products manually before that import runs — they can now type a genuinely new value
inline with a visible "Create" affordance, without needing to pre-guess whether it already exists
under a different name.

Design doc: `docs/cosmos/engraving-pricing-design.md` §9.

---

## 8. Next Session: Storefront Rebuild — Order Flow Focus

**Goal:** rebuild the storefront, taking inspiration from `https://shop.cosmos-bazar.com/`
(the client's live WooCommerce site) but more modern — **starting with, and limited to for now,
the add-to-cart → ordering flow with engraved variants.** Not a full storefront rebuild yet;
browsing/discovery/account pages etc. are out of scope until this core flow works end-to-end.

**Must happen first, before any new storefront UI work:** resolve the §3 blocking bug. There is
no point building more cart-dependent UI on top of a cart API that fails for every product.

**Once unblocked, the order-flow scope is:**
- Product page → add to cart (with engraving toggle where applicable, built in §4 — needs
  re-verification once §3 is fixed, not just visual confirmation)
- Cart page — line items, quantities, engraving fee reflected correctly per §1 formula
  (fee if `engraved && qty < threshold`, free at/above threshold)
- Checkout flow through to order confirmation

**Explicitly out of scope for next session** (don't drift into these without a separate
decision): product listing/category pages, search, account/auth pages, full visual redesign
beyond what's needed for the order flow itself. Reference `shop.cosmos-bazar.com` for tone/layout
inspiration on the pages actually in scope, not as a mandate to rebuild everything at once.

**Also in scope for next session: storefront cleanup.** The current storefront is the stock
Medusa Next.js starter template, largely untouched apart from this session's 4 engraving files.
Before or alongside the rebuild:
- Strip out template pages/components/routes not needed for the order-flow scope above (product
  listing/category, search, account/auth, and any other starter-template pages not on the
  add-to-cart → cart → checkout → order-confirmation path). Don't delete blind — confirm each
  removal doesn't break a route the order flow actually depends on (e.g. don't remove shared
  layout components just because a page using them is being cut).
- **Primary goal: get the storefront running clean, with the known errors actually resolved**,
  not just newly-added code compiling clean. This includes the two pre-existing issues already
  found (§1 of this session): the Next.js production build failure on `/404` prerendering (React
  error #31), and the ~100 TypeScript `TS2786` React-19-FC-incompatibility errors across the
  template. Both were noted as "pre-existing, non-blocking for dev mode" last session — that
  framing no longer applies once the goal is a clean, running storefront; fix them, don't just
  re-confirm they're still there.
- Sequence relative to §3 (the cart bug): fix §3 first, since it's a backend issue that no amount
  of storefront cleanup will touch. Cleanup and the TS2786/build-error fixes can reasonably happen
  in parallel with or after that, since they're storefront-only — but don't let cleanup work
  become a distraction from getting the cart bug root-caused if time is limited.

---

## 9. Engram Entries (This Session)

| # | Type | Summary |
|---|---|---|
| #106 | discovery | Variant Images: Fully Supported in Medusa v2.11.2+, Not a Gap |
| #107 | decision | Bulk-Edit UX: Product Detail Widget for Engraving Settings |
| #108 | discovery | WooCommerce Variation Gallery Images: Empty Column, No Migration Needed |
| #109 | feature | Bulk Engraving Feature Implemented |
| #110 | feature | Storefront Engraving Toggle — Flag Gate + Per-Line Choice |

*(#104, from the previous session, covers the patch-package fix and is referenced but not
re-logged here.)*

**Not yet logged — do next session once resolved:** the §3 cart bug root cause, once found,
should be logged as its own `discovery` or `incident` entry so future sessions don't re-diagnose
it from scratch if it resurfaces.

---

## 10. Notable Findings / Incidents This Session

- **Backend cart bug (§3)** is the standout finding — a platform-breaking issue discovered
  as a side effect of storefront testing, not caused by the storefront changes themselves. Caught
  early, before more UI was built on top of it, by testing broadly (10+ products, with/without
  metadata) rather than assuming the newest code was at fault.
- **Graphify:** re-indexed twice this session (once after the images/bulk-edit investigation,
  once after the storefront engraving work). Final state: 1,858 nodes / 2,783 edges / 134
  communities, scoped correctly to `cosmos-shop/`. Deltas both times were driven by legitimate
  full AST re-extractions (uncached files) plus new design-doc/component nodes — no scope
  contamination.
- **Verification discipline carried forward:** the images investigation reversed an assumption
  ("Medusa's image model is product-level only") that had been stated as fact in the original
  engraving design doc's next-session list — caught by checking the actual data model/API/UI
  rather than trusting the earlier framing. Worth remembering that even this handoff document's
  own prior statements aren't guaranteed correct until re-verified.