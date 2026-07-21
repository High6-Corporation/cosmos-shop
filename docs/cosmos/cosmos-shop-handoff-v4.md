# Cosmos Shop — Handoff v4

**Session date:** 2026-07-20
**Repo:** `High6-Corporation/cosmos-shop`
**Carried forward from:** `cosmos-shop-handoff-v3.md` (2026-07-20 — storefront engraving toggle built,
blocking cart bug found)

---

## 1. Session Summary (Sessions 4–8, this handoff period)

This handoff period covered five sessions, in order: (4) root-caused and fixed the engraving
pricing/cart-line-item pipeline, attempted a React 19 SSR fix, (5) found and fixed the *real*
cart 500 (a region/currency misconfiguration, distinct from Session 4's fix), scoped and built
the engraving text-input feature, (6) product-page/cart UI polish (stock label, inventory count,
variant images, price breakdown clarity) plus a type-safety fix, (7) further breakdown-copy
refinement plus a full state survey that surfaced two still-unresolved pre-existing issues,
(8) diagnosed and fixed the Engram write failure (see §4), backfilled findings, and refreshed
Graphify.

**Status at end of this handoff period:**

- ✅ Engraving fee pricing pipeline fixed — validate hook (eligibility only) + new
  `cart.updated` subscriber (price correction via `cartModule.updateLineItems()`) — verified
  against real cart API responses across engravable/non-engravable, under/at-threshold cases
- ✅ **Real root cause of the original v3 §3 cart bug found and fixed**: storefront middleware
  defaulted to region `dk` (Denmark, EUR) while all variant prices are PHP-only — line-item add
  failed inside the pricing module for any EUR cart. Fixed via `middleware.ts` default region →
  `ph`, and the Europe region was deleted from the store entirely (Philippines is now the only
  region). **Important:** Session 4's "unable to reproduce" conclusion on this bug was wrong —
  it was tested via direct API calls against the PH region, which bypassed the actual bug path
  the storefront UI was hitting. Worth remembering for future sessions: API-only verification
  is not sufficient for anything storefront/UI-facing.
- ✅ Currency now displays ₱ (PHP) throughout, confirmed in browser — same root cause/fix as above
- ✅ Engraving text input built (Option B: cart page, per line item), decided after presenting
  a 3-option tradeoff analysis (product page / cart / checkout step) — see §2 below for full
  rationale and what's stored where
- ✅ Admin-side visibility for engraving text added — widget at `order.details.after` shows each
  engraved line item's text in a monospace box for fulfillment staff
- ✅ Product page: "Out of stock" no longer shows before a variant is selected — shows a neutral
  "select variant" state instead; inventory count now displayed once a variant is selected
- ✅ Cart page: variant-specific images now shown (`item.variant.images` with fallback) — this
  closes out a real gap, though the underlying platform capability was already correctly
  confirmed as supported back in v3 §5
- ✅ Engraved item price breakdown rewritten to be explicit (base + fee = unit price, unit price
  × qty = total) instead of the ambiguous "includes ₱X engraving" phrasing that prompted this —
  verified against Aqua and Cherry test-batch variants, under- and at-threshold, screenshot-
  confirmed in browser (see screenshot from this session — cart now reads clearly:
  `₱213.00 + ₱25.00 engraving = ₱238.00/unit`, `₱238.00 × 3 = ₱714.00`)
- ✅ `engraving-bulk.tsx:132` type error properly fixed — was patched with an `as any` cast in
  Session 6 (flagged at the time as needing a real fix, not a cast); now correctly typed as
  `useQuery<{ product: AdminProduct }>`, matching the pattern used elsewhere in the codebase
- ✅ **Engram write failure diagnosed and fixed (Session 8)** — the project was never missing;
  it's registered under `project: "work"`, not `"cosmos-shop"`. All Sessions 5–7 write attempts
  used the wrong project name and silently failed. Findings from this whole handoff period have
  now been backfilled (entries #111–#115) — see §4 below. Graphify was also re-indexed.
- 🔴 **NEW blocker, found this session, not yet investigated:** checkout flow stuck at the
  Delivery step — "Continue to payment" button is present but appears disabled/greyed out, with
  no shipping method selectable ("How would you like your order delivered" shows no options).
  Cart contents and pricing are correct at this point (₱714.00 total, correct line item) — the
  blocker is specifically in shipping-method selection. **User has already configured Locations,
  a Shipping Profile, and Shipping Options in the admin** — next session should start by
  verifying that configuration against what the storefront is actually querying, not by
  re-creating it from scratch.
- 🟡 Two pre-existing issues surfaced by this session's full-state survey remain unresolved,
  carried forward from Session 4 (where they were flagged, attempted, and NOT actually fixed —
  correcting an earlier session's premature "resolved" claim):
  - `next build` fails prerendering `/404` — React error #31 ("Objects are not valid as a React
    child"). Root cause: `apps/storefront` needs React 19, but `@medusajs/medusa` at the repo
    root pins `react-dom@^18.3.1` as a peer dependency, and npm hoists that to root
    `node_modules`. Next.js resolves `react-dom/server` from the hoisted root copy during
    prerendering, hitting the wrong major version. A manual symlink fix from Session 4 papered
    over this temporarily but was silently reverted when `@headlessui/react` was upgraded in
    Session 6 (a routine `npm install` re-broke the symlink, exactly the fragility flagged when
    the symlink approach was first proposed). **This needs the structural fix, not another
    symlink**: either exclude `apps/storefront` from the root npm workspace so it gets an
    independent `node_modules`, or migrate to pnpm workspaces (no default hoisting). Symlinking
    is confirmed non-durable across normal dependency-management actions and should not be
    re-attempted as the fix.
  - `mobile-actions.tsx` — 4× TS2322 IDE errors: `@headlessui/react`'s `Transition` component
    `as` prop is typed against the root's `@types/react@18.3.31`, incompatible with the
    storefront's own `@types/react@19.0.5`. Same root cause as the SSR issue above — two
    different `@types/react` majors in the resolution path. Build currently passes
    (`skipLibCheck` + `ignoreBuildErrors` mask it), IDE-only for now, but same underlying fix
    (workspace isolation) should resolve both simultaneously.

---

## 2. Engraving Text Input — Decision Record

No existing decision was found in `docs/cosmos/misc/engraving-pricing-design.md` (§2/§3 cover
merchant flag + Yes/No toggle + pricing only — no mention of text capture). Three placement
options were analyzed (product page inline / cart page per-line / checkout step) and presented
with a tradeoff table before any code was written, per this project's decision-before-build
convention.

**Decision: Option B — cart page, per line item.**

Rationale: cart is the natural editing surface for line-item metadata, handles multi-item carts
correctly (each engraved line gets its own field), text persists with the cart across refresh/
navigation, and matches e-commerce precedent (Amazon "Gift options", Etsy "Personalization" both
live in cart, not product page).

**Implementation:**

| File | Change |
|---|---|
| `apps/storefront/src/modules/cart/components/item/index.tsx` | Text input appears when `item.metadata.engraved === true`; saves to `metadata.engraved_text` via `updateLineItem()` |
| `apps/storefront/src/modules/cart/templates/summary.tsx` | Checkout button disabled + red error state if any engraved item has empty `engraved_text` — **required by default**, decided rather than left optional |
| `apps/backend/src/admin/widgets/order-engraved-text.tsx` | New widget at `order.details.after` — shows each engraved item's text so fulfillment staff don't have to dig through raw metadata |
| `apps/storefront/src/lib/data/cart.ts` | `updateLineItem()` now accepts an optional `metadata` param |

**Storage:** `line_item.metadata.engraved_text: string`, following the existing
`metadata.engraved` boolean precedent.

**Explicitly out of scope (not decided, not built):** character limits, font selection, preview
rendering of the engraved text — flagged as future merchant-facing decisions, not technical
blockers.

---

## 3. 🔴 Current Blocker: Checkout Stuck at Delivery / Shipping Method

**This is the top priority for next session — nothing past this point in the order flow can be
tested until it's resolved.**

- Cart → Shipping Address step completes successfully (address entry, contact, billing = shipping
  all confirmed working — see screenshot, shipping address for "Tester Account" saved correctly).
- **Delivery step blocks**: "Shipping method" section shows only the placeholder text "How would
  you like your order delivered" with no selectable options rendered. "Continue to payment" button
  is present but inert/disabled.
- Cart summary at this point is correct (₱714.00 total, correct line item, engraving fee already
  reflected) — confirms the blocker is isolated to shipping-method resolution, not a cart/pricing
  regression.
- **User has already set up, in admin**: a Location, a Shipping Profile, and Shipping Options.
  This was done outside of an agent session — **next session must verify this configuration
  directly (check it actually links to the "Own Storefront" sales channel / Philippines region /
  the products in the test cart) rather than assuming it's wired correctly or re-creating it.**

**Next session starting point:**
1. Check `GET /store/shipping-options?cart_id=...` response directly (this endpoint already
   appears in the storefront's own request log, returning 200 — so confirm whether it's actually
   returning an empty array vs. a real list that the UI is failing to render).
2. If the API returns options but the UI doesn't show them — storefront rendering bug.
3. If the API returns an empty array — check whether the configured Shipping Profile/Options are
   correctly scoped to the Philippines region, the Own Storefront sales channel, and the specific
   Fulfillment Set/Service Zone the test address (Ormoc, PH) falls into. Medusa v2 shipping
   options are commonly under-scoped this way (e.g. attached to a Fulfillment Set that doesn't
   cover the address's country/zone).

---

## 4. Engram / Graphify — Working State (Session 8)

**Engram project name: `work`, not `cosmos-shop`.** This is the single most important tooling
fact for next session — get it wrong and writes silently fail again. All entries #97–#110 were
already correctly logged under `project: "work"`; the failures in Sessions 5–7 happened because
those calls explicitly passed `project: "cosmos-shop"`, which doesn't exist. Calls with no
explicit project also fail (`mem_current_project` returns "ambiguous" — there are multiple git
repos under `/Users/josh/work`). **Always pass `project: "work"` explicitly for any Engram
read/write related to this codebase.**

**Entries backfilled this session:**

| # | Type | Summary |
|---|---|---|
| #111 | discovery | Engram Write Diagnosis — project is actually "work" |
| #112 | bugfix | Cart 500 Real Root Cause — EUR region default, PHP-only prices |
| #113 | decision | Engraving Text Input — Cart Page, Required, Admin-Visible |
| #114 | discovery | React 18/19 SSR Conflict — Root Cause + Non-Durable Symlink Fix |
| #115 | feedback | API-Only Verification Not Sufficient for Storefront Work |

All queryable under `project: "work"`; no conflicts on write.

**Graphify re-indexed:**

| Metric | Before (Session 3) | After (Session 8) |
|---|---|---|
| Nodes | 1,858 | 1,273 |
| Edges | 2,783 | 2,049 |
| Communities | 134 | 135 |

Node/edge decrease reflects deleted template pages and re-scoped extraction, not data loss —
expected given the storefront cleanup done across Sessions 6–7. **Caveat:** 1/3 of semantic
chunks failed during this re-index due to a Gemini free-tier rate limit; AST-level extraction
completed fully, so structural/call-graph queries should be reliable, but semantic-search-style
Graphify queries may be working off incomplete coverage until a clean re-index is run without
hitting the rate limit.

---

## 5. Environment Reference (Changed This Handoff Period)

| Item | Value |
|---|---|
| Default region | `middleware.ts` `DEFAULT_REGION` changed from `"dk"` to `"ph"`. Hardcoded for now — flagged as fine short-term, but should move to the already-supported `NEXT_PUBLIC_DEFAULT_REGION` env var if the store ever expands beyond one country. |
| Regions | Only "Philippines" (`currency_code: php`) remains — Europe region was deleted via admin API |
| `@headlessui/react` | Upgraded to `2.2.10` in Session 6 — **this upgrade is what silently reverted the Session 4 React-symlink SSR workaround**; worth remembering as a general pattern (routine dependency bumps can re-break manual node_modules patches) |
| Engram | Set up and working — see §4. Always pass `project: "work"` explicitly. |

---

## 6. Next Session Priorities

**Priority 1 (blocking everything else): resolve the shipping-method/Delivery step blocker**
per §3 above. Nothing in the order-confirmation flow can be tested until this works.

**Priority 2: fix the React 18/19 workspace split properly**, not with another symlink —
either exclude `apps/storefront` from root npm hoisting or move to pnpm workspaces. This closes
both the `/404` prerendering failure and the `mobile-actions.tsx` TS2322 errors at once, since
both share the same root cause.

**Priority 3: re-run a clean Graphify semantic re-index** once outside the Gemini free-tier rate
limit window, since 1/3 of semantic chunks failed in the Session 8 refresh (see §4) — structural/
AST queries are reliable now, but semantic-search coverage isn't complete yet.

**Once checkout is unblocked, resume the original order-flow scope** (product page → cart →
checkout → order confirmation, engraved and non-engraved) and complete a full click-through
verification in the browser, including placing an actual test order and confirming the admin
order view shows the correct engraved text (per the widget built in §2) and correct final price.

**Explicitly still out of scope:** product listing/category pages, search, account/auth pages,
full visual redesign — unchanged from v3 §8, still not started, still not needed yet.

---

## 7. Working Discipline Notes Carried Forward

- **API-only verification is not sufficient for storefront/UI work.** The Session 4 "unable to
  reproduce" conclusion on the cart bug was wrong specifically because it was checked via direct
  API calls against the correct region, not through the actual storefront flow a customer uses.
  This cost a full extra session to catch. Insist on browser click-through verification for
  anything UI-facing going forward.
- **Don't patch type errors with `as any`.** Session 6's `engraving-bulk.tsx` fix used a cast as
  a shortcut; it was correctly flagged and redone properly in a later pass. Check for an existing
  typed pattern elsewhere in the codebase (via Graphify) before reaching for a cast.
- **Manual node_modules workarounds (symlinks, manual patches) don't survive normal dependency
  operations.** The Session 4 SSR symlink fix was silently undone by an unrelated `npm install`
  in Session 6. Prefer structural fixes (workspace config) over manual filesystem patches for
  anything expected to persist across sessions.
- **Verify existing admin configuration before assuming it's wired correctly or re-building it**
  — applies directly to the Locations/Shipping Profile/Options the user configured before this
  handoff; next session should audit that config's actual scoping, not treat it as already
  correct or start over.