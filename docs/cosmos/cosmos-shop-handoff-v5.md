# Cosmos Shop — Handoff v5

**Session date:** 2026-07-20
**Repo:** `High6-Corporation/cosmos-shop`
**Carried forward from:** `cosmos-shop-handoff-v4.md` (2026-07-20 earlier session — checkout blocker triage, order-confirmation image bugs)

---

## 1. Session Summary

This session closed out the two carried-forward blockers from v4 (order-confirmation variant
images, React 18/19 type conflict) and completed a full end-to-end verification of the core
purchase flow with engraving. Backend architecture work from earlier sessions (v2/v3) is now
fully validated by a real, successful test order rather than just component-level testing.

**Status at end of session:**

- ✅ Order-confirmation and order-detail pages now show correct variant images (data gap +
  rendering gap fix, both `retrieveOrder()` and `listOrders()` call sites covered)
- ✅ Checkout shipping-method blocker resolved — root cause was a stale `force-cache` on
  shipping options with no admin-triggered invalidation path
- ✅ React 18/19 type conflict resolved structurally — `apps/storefront` excluded from root npm
  workspaces, isolated into its own dependency tree; confirmed durable through a fresh install
  (unlike the earlier symlink workaround, which silently broke under routine `npm install`)
- ✅ **Full core purchase flow verified end-to-end via real browser click-through, twice:**
  browse products → select product → add to cart → opt into engraving on a specific variant →
  checkout → payment → order confirmation. Two real test orders placed successfully (order #1,
  order #2), confirmed correct pricing, shipping, and variant images throughout
- ✅ Confirmed fulfillment-side visibility: engraved text is visible on the admin order view
- 🟡 Two known sibling-bug classes flagged but not fixed this session (see §5)
- ⛔ Storefront visual identity still generic Medusa default — Cosmos Bazaar branding/design
  pass not yet started (**next session**)
- ⛔ Bulk product import (beyond the 5-product/16-variant test batch from v2) not yet started
  (**next session**)

---

## 2. Environment Reference (Changed This Session)

| Item | Value |
|---|---|
| `apps/storefront` workspace status | **Excluded** from root `package.json` `workspaces` array (previously `["apps/**", "!apps/backend/.medusa/**"]`, now `["apps/backend", "!apps/backend/.medusa/**"]`). Has its own independent `node_modules` and `package-lock.json` (537 packages) |
| Storefront dev/build invocation | No longer via turbo — `npm run storefront:dev` / `storefront:build` from root now do `cd apps/storefront && npm run dev`/`build` directly |
| `apps/storefront/next.config.js` | `ignoreBuildErrors: true` and the webpack `resolve.alias` React-version band-aid both removed — no longer needed |
| Test orders placed | Order #1 (Pilot BAC-50MF Acro 500, Silky Lavender, 3× ₱238.00, ₱729.00 total incl. ₱15 shipping) and Order #2 (same product, ₱228.00) — both real, successful, browser-verified |
| Admin credentials | **Still unknown/unconfirmed.** Default Medusa credentials (`admin@medusa-test.com`, `admin@cosmos-shop.com`) both failed. Blocks any future admin-config verification or cache-invalidation regression testing that requires logging into `/app` |

---

## 3. Bugs Fixed This Session

### 3.1 Order confirmation / order detail — missing variant images
Two-part bug, both parts required to cause the symptom:
- **Data gap:** `retrieveOrder()` in `orders.ts` requested `*items.variant` but not
  `*items.variant.images` — in Medusa v2, `images` is a relation not expanded by a bare wildcard.
- **Rendering gap:** `order/components/item/index.tsx` passed only `thumbnail` to `<Thumbnail>`
  with no `images` fallback (order line items have `thumbnail: null`, unlike cart line items).

Fixed in `orders.ts` (added `*items.variant.images` to the fields query) and
`order/components/item/index.tsx` (added `images` prop, mirroring the cart's existing
`item.variant?.images ?? item.variant?.product?.images` fallback pattern).

**Follow-up caught same session:** `listOrders()` had the identical fields gap, and
`account/components/order-card/index.tsx` had a hardcoded `images={[]}` (worse than missing —
actively empty). Both fixed using the same pattern. All three surfaces (confirmation, order
detail, account order list) now consistently show correct variant images.

### 3.2 Checkout — shipping method blocker
`listCartShippingMethods()` in `apps/storefront/src/lib/data/fulfillment.ts` used
`cache: "force-cache"`, permanently caching an empty shipping-options response if checkout was
first hit before shipping options existed in admin config. No admin action triggers
`revalidateTag("fulfillment")` — only cart mutations do. Only a server restart cleared it, which
is why the bug was intermittent and hard to reproduce reliably.

Fixed by replacing `cache: "force-cache"` with `next: { revalidate: 60 }`. Admin-side shipping
config (Location, Shipping Profile, Shipping Options, Fulfillment Set/Service Zone for PH) was
audited and confirmed already correctly wired — no admin changes were needed.

### 3.3 React 18/19 type conflict (structural)
Root cause: `apps/backend` (via `@medusajs/medusa`) pins React 18 as a peer dependency; npm
hoists this to root `node_modules`, while `apps/storefront` needs React 19 locally. This produced
two co-existing `@types/react` majors in TypeScript's resolution path, surfacing as `TS2786`
("cannot be used as a JSX component") on `Button`, `OptionSelect`, `MobileActions`, and others,
plus a `/404` prerender failure at build time.

Two alternatives were investigated and ruled out first:
- `npm overrides` — controls *version*, not *hoisting location*; can't fix a spatial conflict.
- `tsconfig` `paths` redirect — would work for storefront's own source files, but transitive
  peer deps (e.g. `@radix-ui/*`) still resolve `@types/react` to the hoisted v18 copy, so the
  conflict wasn't actually eliminated, just hidden behind `skipLibCheck`.

**Fix:** excluded `apps/storefront` from the root npm `workspaces` array entirely, giving it a
fully isolated dependency tree where only React 19 (and its correctly-resolved `@types/react`)
exists anywhere in its filesystem scope. Confirmed via official npm/Turborepo documentation that
`turbo.json` has no `workspaces` field — Turborepo reads workspace membership solely from the
package manager's config, so once excluded, storefront is invoked directly rather than via
turbo.

**Regression test:** `rm -rf apps/storefront/node_modules apps/storefront/package-lock.json &&
npm install && npm run build` — passes clean, 22/22 pages, zero type errors, confirming the fix
survives a fresh install (the prior symlink-based workaround did not survive this same test and
had silently reverted).

**Deferred, not fixed this session:** `skipLibCheck: true` remains in all 3 tsconfigs (removing
it may surface unrelated third-party `.d.ts` issues, particularly in `apps/backend/src/admin/`);
`ignoreDuringBuilds: true` (ESLint) also remains — separate concern, not type-checking related.

Engram entry: `obs-2d3c72f89d3353c1`.

---

## 4. Feature Recap — Engraving (Full State as of This Session)

Originally designed and implemented in v2 as product-level (see v2 §5), reworked since to
**variant-level**, consistent with how variant-specific images were also added:

- Eligibility flag, per-unit fee, and free-engraving threshold are all merchant-editable and set
  **per variant**, not per product and not hardcoded — different variants of the same product
  (e.g. a limited-edition color) can have different engraving settings or none at all.
- Because Medusa's default product-creation tabs are rigid and not designed to be extended,
  both engraving settings and variant-specific images live on the **individual variant's detail
  page**, editable per variant after the product/variant already exists, rather than during
  initial product creation.
- Customer-facing flow (opt in per line item, enter custom text) confirmed working end-to-end via
  real test orders this session; merchant-facing eligibility/fee/threshold widget confirmed
  working in admin.
- Admin order view confirmed to surface the engraved text for fulfillment staff.

---

## 5. Known Issues Flagged, Not Yet Fixed

- **Sibling `force-cache` bugs:** 17 total usages of `cache: "force-cache"` across
  `apps/storefront/src/lib/data/`; 11 are the same bug class as §3.2 (admin-mutable data with no
  admin-triggered invalidation). Most notable: `payment.ts:24` on payment providers — same
  failure mode would hit the Payment step once admin adds a new payment provider. Not fixed this
  session, scoped out to stay focused on the shipping blocker specifically.
- **Admin-triggered cache-invalidation regression test not performed** for the shipping fix
  (§3.2) — needs admin credentials to log into `/app` and toggle a live shipping option to
  confirm the `revalidate: 60` window actually picks up the change. Blocked on unknown admin
  credentials (see §2).
- **`skipLibCheck` and `ignoreDuringBuilds`** — both intentionally deferred, see §3.3.

---

## 6. Next Session Starting Point

**Primary focus: frontend/storefront design pass.** Core purchase flow (browse → cart → engrave
→ checkout → confirmation) is fully functional and verified — next session shifts from
functional correctness to visual identity and scale:

1. **Cosmos Bazaar storefront branding/UX pass** — move the storefront off the generic default
   Medusa look toward an actual Cosmos Bazaar identity (design tokens, layout, product
   presentation). This was deliberately sequenced after backend/core-flow completion, and that
   condition is now met.
2. **Bulk product import** — move beyond the 5-product/16-variant test batch (v2 §3) toward
   accommodating the full ~1,067-row WooCommerce dataset. Revisit the still-open items from the
   v2 compatibility report: category hierarchy (36 flat categories, nesting unclear),
   `PPOM Fields` decoding (may hold per-product engraving eligibility from the WooCommerce side),
   the soft-delete SKU/handle collision issue blocking re-import, and the 1 `variation, virtual`
   outlier product.

**Deferred, pick up if time allows:**
- Sibling `force-cache` audit/fix pass (§5), especially `payment.ts`.
- Admin-credential recovery, to unblock the cache-invalidation regression test.
- Variant-level image support for bulk-imported products — WooCommerce's
  `Woo Variation Gallery Images` column was flagged but unhandled in the original compatibility
  report; now that variant-level images exist as a feature, this should be revisited alongside
  the bulk import work.

---

## 7. EOD Reports Sent This Session

Reports sent to Sir JM (technical, Taglish) and Sir Jeff (business-level, English) covering:
backend architecture work made compatible with Cosmos Shop's real dataset as the required
foundation, the minimal storefront built on top of it for the core order-with-engraving
operation, and the two package/environment issues resolved (stale-cache checkout blocker, React
18/19 dependency conflict). Both confirmed the demo is expected once the branding pass and bulk
import are done next session.

---

## 8. Engram Entries This Session

| # / ID | Type | Summary |
|---|---|---|
| #116 | bugfix | Checkout shipping-method blocker — stale `force-cache` on shipping options |
| #117 | bugfix | Order confirmation/detail/account-list missing variant images — data gap + rendering gap, 3 call sites |
| `obs-2d3c72f89d3353c1` | bugfix | React 18/19 type conflict — resolved via npm workspace exclusion, confirmed durable through fresh install |