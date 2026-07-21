# PDP Multi-Select + Cart Sheet Overhaul — Design Spec

**Date:** 2026-07-21
**Session:** cosmos-shop-handoff-v6 §8 (post-Sir-Jeff demo scope)
**Status:** Approved, pending implementation

---

## 1. Overview

Replaces the current single-select PDP flow and cart-dropdown with:

- **PDP multi-select variants** — each `VariantSwatchCard` gets an inline `QuantityStepper`; incrementing above 0 _is_ the selection. Single "Add to Cart" adds all qty>0 variants as separate line items.
- **Engraving relocation** — text inputs move from cart to PDP, one field per selected engravable variant by default, with a "Use same text for all" convenience toggle.
- **Cart sheet (slide-over)** — right-edge drawer auto-opens on add-to-cart, also manually openable via nav cart icon. Line items with inline qty steppers + editable engraving, T&C checkbox gate, and recommended products section.
- **`/cart` page preserved** — the sheet is an additional surface, not a replacement.

Design system: **Ink & Paper** tokens (already applied storefront-wide). Existing components leveraged: `VariantSwatchCard`, `QuantityStepper`, `ProductSlideshow`, `FilterSlideOver` (Headless UI Dialog pattern), `FilterPillBar`, `SortDropdown`.

---

## 2. PDP — Multi-Select Variant with Inline Quantity

### 2.1 Layout (top to bottom on PDP)

```
ProductSlideshow (existing, no change)
Product Info — title, price, description (existing, no change)
Option groups — each rendered as before via VariantSwatchCard
  └── Per-card: image + label + inline QuantityStepper
      └── Per-card (conditional): engraving text input if variant is engravable and qty > 0
"Use same text for all variants" checkbox (conditional, see §3.3)
"Add N items to cart — ₱X.XX" button (single click adds all qty>0 variants)
```

### 2.2 VariantSwatchCard changes

- New optional props: `showStepper?: boolean`, `quantity?: number`, `onQuantityChange?: (qty: number) => void`, `maxQuantity?: number | null`, `engravingText?: string`, `onEngravingTextChange?: (text: string) => void`, `showEngravingField?: boolean`, `engravingFee?: number`, `engravingThreshold?: number`.
- When `showStepper` is true, a compact `QuantityStepper` renders below the label (buttons `w-8 h-8` vs the standalone `w-10 h-10`).
- Selection state is driven by `quantity > 0` rather than a separate click — the vermilion border + checkmark appear when quantity ≥ 1. Multiple cards can be selected simultaneously.
- Out-of-stock variants: stepper + disabled, "Out of stock" badge unchanged.

### 2.3 ProductActions rewrite

Current flow: `optionsAsKeymap` → single `selectedVariant` → one `QuantityStepper` → one `handleAddToCart`.

New flow:

```
State:
  quantities: Record<string, number>        // variant_id → qty
  engravingTexts: Record<string, string>    // variant_id → engraving text
  useSameText: boolean                       // "use same text for all" toggle
  sharedEngravingText: string                // value when useSameText is true

Derived:
  selectedVariants: variant[] — all variants where quantities[id] > 0
  engravableVariants: variant[] — subset where metadata.is_engravable is true AND quantities[id] > 0

On "Add to Cart":
  1. Build items: { variantId, quantity, metadata: { engraved_text } }[]
  2. Promise.allSettled over addToCart() per item
  3. On any rejection: toast with per-item results ("X added, Y failed — reason")
  4. On success: open cart sheet via CartSheetContext

Button state:
  - Disabled when no variant has qty > 0
  - Text: "Add N items to cart — ₱total"
  - Per-variant line total: (calculated_price + engraving_fee_effective) × quantity
  - engraving_fee_effective = engraving_fee when (engraved_text present AND quantity < threshold), otherwise 0
  - total = sum of per-variant line totals
  - Same fee-zeroing logic applies everywhere: button total, line-item price in sheet, cart subtotal
```

### 2.4 Partial-failure behavior

- Uses `Promise.allSettled`, not `Promise.all`.
- Successful items land in the cart normally.
- Failed items produce a toast: _"Silky Lavender (2) added. White (3) couldn't be added — network error. Please try again."_
- The cart sheet auto-opens regardless, showing whatever was successfully added.
- **Rationale for partial success over atomic rollback:** Atomic rollback requires calling `deleteLineItem` on the succeeded items — if those deletion calls also fail (network drop, race condition), the user ends up with items in their cart they didn't knowingly add. Partial success with clear messaging is the standard e-commerce pattern (Amazon, Shopify).

---

## 3. Engraving — Relocated from Cart to PDP

### 3.1 Current state

`EngravingToggle` renders a Yes/No toggle on the PDP. Checking "Yes" passes `{ metadata: { engraved: true } }` to `addToCart`. No actual engraving text is captured anywhere — the engraving text field exists only in the cart (v5 §4). This change moves text capture to the PDP and removes the Yes/No toggle entirely (presence of text = opt-in).

### 3.2 Eligibility logic (reused, not changed)

From `ProductActions.engravingMeta` (existing, unchanged):

```
isEngravable = variant.metadata.is_engravable === true || variant.metadata.is_engravable === "true"
fee = Number(variant.metadata.engraving_fee) || 0
threshold = Number(variant.metadata.engraving_threshold) || 0
```

### 3.3 Per-variant text fields (default mode)

| Condition                             | Behavior                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Variant qty = 0                       | No engraving field shown                                                                               |
| Variant qty > 0, isEngravable = true  | Text input renders inline below stepper                                                                |
| Variant qty > 0, isEngravable = false | No engraving field — explicitly confirmed, never shown                                                 |
| Fee > 0                               | Small caption below field: "₱{fee}/unit engraving fee" (reuses existing EngravingToggle fee messaging) |
| Threshold > 1                         | Caption adds: "free at {threshold}+ units"                                                             |

### 3.4 "Use same text for all variants" toggle

- **Visibility:** Only rendered when 2+ engravable variants have qty > 0.
- **Checked state:** All individual text inputs are hidden (but their values preserved in state). One shared text input appears. Typing in it sets every `engravingTexts[id]` to the same value.
- **Unchecking:** Individual fields reappear with their **original values from before the checkbox was checked**, not the shared field's value. The checkbox is a view toggle, not a data mutation. If a field was empty before checking, it's empty after unchecking.
- **State model:**
  ```
  engravingTexts: { [variantId]: string }     // preserved at all times
  sharedEngravingText: string                  // only used when useSameText is true
  useSameText: boolean
  ```
  When `useSameText` transitions false→true: `sharedEngravingText` is initialized from the first non-empty `engravingTexts[id]` (if any).
  When `useSameText` transitions true→false: `sharedEngravingText` is discarded; individual fields revert to `engravingTexts[id]`.

### 3.5 EngravingToggle removal

The `EngravingToggle` Yes/No component is removed. Its fee messaging (formatted fee, threshold caption, free-engraving indicator) is absorbed into a small `EngravingFieldCaption` sub-component rendered below each per-variant text input.

---

## 4. Cart Sheet — Slide-Over

### 4.1 Architecture: CartSheetProvider (React Context)

A new client component `CartSheetProvider` wraps both `<Nav />` and `{children}` in `PageLayout` (`apps/storefront/src/app/[countryCode]/(main)/layout.tsx`).

```tsx
// layout.tsx (server component — unchanged pattern)
export default async function PageLayout(props: { children: React.ReactNode }) {
  const customer = await retrieveCustomer()
  const cart = await retrieveCart()
  // ...
  return (
    <CartSheetProvider initialCart={cart}>
      <Nav />
      {customer && cart && <CartMismatchBanner ... />}
      {cart && <FreeShippingPriceNudge ... />}
      {props.children}
      <Footer />
    </CartSheetProvider>
  )
}
```

`CartSheetProvider` provides via React Context:

- `cart: StoreCart | null` — shared cart state
- `refreshCart(): Promise<void>` — re-fetches from server
- `openSheet(): void` — opens the cart sheet
- `closeSheet(): void` — closes the cart sheet
- `isSheetOpen: boolean`

Consumers:

- `ProductActions` (PDP) → calls `openSheet()` on successful add-to-cart
- `CartButton` (Nav) → calls `openSheet()` on click (replaces old dropdown behavior)
- `CartSheet` (the slide-over itself) → reads `isSheetOpen`, `cart`, calls `closeSheet()`

### 4.2 Sheet content (top to bottom)

```
┌──────────────────────────────────────────┐
│  ← YOUR CART (3)            [✕ close]   │  ← Header with item count badge
├──────────────────────────────────────────┤
│  Line items                             │
│  ┌──────────────────────────────────────┐│
│  │ [img] Product Name            ₱XXX  ││  ← thumbnail, title, unit price
│  │ Variant: Color / Size               ││  ← variant option summary
│  │ Qty: − N +                          ││  ← inline QuantityStepper (compact)
│  │ ✎ "engraving text"                  ││  ← editable if engraving present
│  │                            [remove] ││
│  └──────────────────────────────────────┘│
│  ...more items...                       │
│  ─────────────────────────────────────── │
│  Subtotal                        ₱XXXX  │
│  ─────────────────────────────────────── │
│  ☐ I agree to the Terms & Conditions   │  ← gates checkout button
│  [Proceed to Checkout →]  (disabled)    │
│  ── You might also like ──              │
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ [img]  │ │ [img]  │ │ [img]  │       │  ← Recommended products (max 4)
│  │ Name   │ │ Name   │ │ Name   │       │
│  │ ₱XXX   │ │ ₱XXX   │ │ ₱XXX   │       │
│  └────────┘ └────────┘ └────────┘       │
│  [View full cart →]                      │  ← Link to /cart page
└──────────────────────────────────────────┘
```

### 4.3 Sheet technical details

- **Component:** Headless UI `Dialog` + `Transition`, right-edge slide-over (same pattern as `FilterSlideOver`).
- **Width:** ~400px on desktop, full-width on mobile.
- **Backdrop:** semi-transparent ink overlay, click-to-close.
- **Scroll:** `overflow-y-auto` on the sheet body; header and checkout bar are sticky.
- **Quantity changes in sheet:** calls `updateLineItem({ lineId, quantity })` directly (existing server action).
- **Engraving edits in sheet:** calls `updateLineItem({ lineId, metadata: { engraved_text: newText } })`.
- **Remove item:** calls `deleteLineItem(lineId)` (existing server action).
- **After any mutation:** calls `refreshCart()` to keep the shared state in sync.

### 4.4 T&C checkbox

- Unchecked by default.
- Resets to unchecked on every sheet close — **not persisted across close/reopen**.
- Rationale: The checkbox is a legal gate, not a user preference. Requiring explicit re-check on each open is the standard pattern (airline check-in flows, payment modals). Cart contents may have changed between opens, so a stale "already agreed" state is misleading.
- "Proceed to Checkout" button is `disabled` until checked.
- Checkout link: `/{countryCode}/checkout?step=delivery` (existing checkout path, unchanged).

### 4.5 Recommended products

**Category-based, server-side filtered, client-side exclusion:**

1. Extract unique `category_id`s from the current cart items' products.
2. Call `listProducts({ category_id: [...], limit: 20 })` — server-side filtering.
3. Client-side: `.filter(p => !cartItemVariantIds.has(p.variants[0]?.id))` — exclude items already in cart.
4. `.slice(0, 4)` — cap at 4 results.

This pattern survives the ~1,067-product bulk import without refactoring — the heavy filtering happens server-side.

**Note on "brand":** The product data model has no "brand" field — no collection, metadata key, or product type that maps to brand. The handoff §9.4 mentions "category or brand" but "brand" doesn't exist at the data layer yet. Category-only for this pass. Add brand-matching as a follow-up once the field is defined in the catalog (likely during or after the bulk-import stream).

### 4.6 useCart() shared hook

- `CartSheetProvider` receives `initialCart` from the server-side `PageLayout` (which calls `retrieveCart()`).
- Internal state via `useState(initialCart)`, synced via `useEffect` when `initialCart` prop changes.
- Next.js App Router **automatically refreshes server components** after server actions complete (`addToCart`, `updateLineItem`, `deleteLineItem` are all server actions). This triggers `PageLayout` to re-fetch `retrieveCart()`, which flows down as a new `initialCart` prop.
- No React Query needed — the existing server-action → router-refresh → server-render loop handles cache invalidation.
- The `/cart` page fetches independently via its own server-component `retrieveCart()` call. Both hit the same Medusa API — no drift because server actions revalidate tags and both re-fetch on navigation/mutation.
- Note: `addToCart` calls `getOrSetCart()` per invocation. With `Promise.allSettled` over N variants, this means N redundant cart retrievals. Redundant but harmless — the cart ID is cached in a cookie after the first call; subsequent calls are near-instant lookups.
- **⚠️ Verification gate (first implementation step):** Confirm end-to-end that the revalidation chain actually delivers fresh cart data to the sheet. The chain is: `addToCart` → `revalidateTag("carts-{id}")` → server-action router-refresh → `PageLayout` re-renders → `retrieveCart()` misses cache (tag invalidated, `force-cache` + `next.tags`) → new `initialCart` prop → `CartSheetProvider` syncs via `useEffect`. There is a known timing edge case: the sheet opens via `openSheet()` immediately after `Promise.allSettled` resolves, but the router-refresh may not have completed yet — the sheet shows the previous cart state for one render frame until the new `initialCart` arrives. If this proves more than a single-frame flicker (e.g., the refresh doesn't propagate because the server action's `revalidateTag` and the layout's `retrieveCart` use different cache-tag derivations), the fallback is to call `refreshCart()` imperatively after add-to-cart completes, bypassing the prop-sync path entirely. Test this before building any sheet UI.

---

## 5. Component Lifecycle

| Component                                                           | Action                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CartDropdown` (`modules/layout/components/cart-dropdown/`)         | **Deleted** — only consumer was `CartButton`, now repurposed                                        |
| `CartButton` (`modules/layout/components/cart-button/`)             | **Rewritten** — calls `useCartSheet().openSheet()` instead of rendering `CartDropdown`              |
| `EngravingToggle` (`modules/products/components/engraving-toggle/`) | **Deleted** — absorbed into per-variant text inputs + `EngravingFieldCaption`                       |
| `VariantSwatchCard`                                                 | **Extended** — new optional props for inline stepper + engraving field                              |
| `QuantityStepper`                                                   | **Unchanged** — reused as-is, just rendered in compact mode via a `compact` prop or wrapper classes |
| `ProductActions`                                                    | **Rewritten** — multi-variant state, inline steppers, per-variant engraving, bulk add-to-cart       |
| `PageLayout` (`(main)/layout.tsx`)                                  | **Wrapped** — children wrapped in `CartSheetProvider`                                               |
| `CartTemplate` + sub-templates                                      | **Unchanged** — `/cart` page preserved as-is                                                        |
| New: `CartSheetProvider`                                            | Client context provider at layout level                                                             |
| New: `CartSheet`                                                    | Slide-over component (Headless UI Dialog)                                                           |
| New: `CartSheetItem`                                                | Single line-item row within the sheet                                                               |
| New: `CartSheetRecommended`                                         | Recommended products section                                                                        |
| New: `EngravingFieldCaption`                                        | Fee/threshold messaging extracted from `EngravingToggle`                                            |

---

## 6. Data Flow

```
                    ┌─────────────────────────────┐
                    │     PageLayout (server)      │
                    │   retrieveCart() → cart      │
                    └──────────┬──────────────────┘
                               │ initialCart prop
                    ┌──────────▼──────────────────┐
                    │   CartSheetProvider (client) │
                    │   ┌───────────────────────┐  │
                    │   │  useState(initialCart) │  │
                    │   │  Context: isOpen,      │  │
                    │   │  openSheet, closeSheet │  │
                    │   │  useEffect syncs on    │  │
                    │   │  initialCart change    │  │
                    │   └───────────────────────┘  │
                    └──┬──────────────────┬───────┘
                       │                  │
              ┌────────▼─────┐   ┌───────▼──────────┐
              │  Nav          │   │  PDP / Cart page  │
              │  CartButton   │   │  ProductActions   │
              │  → openSheet()│   │  → openSheet()    │
              └───────────────┘   └───┬───────────────┘
                                      │
                         addToCart()   │  Promise.allSettled
                         (server       │  over variants
                         action)       │
                                      │
                         ┌────────────▼───────────┐
                         │  Server action completes │
                         │  → revalidateTag("carts")│
                         │  → router.refresh()      │
                         │  → PageLayout re-renders │
                         │  → new initialCart prop  │
                         │  → CartSheetProvider     │
                         │    syncs its state       │
                         └──────────────────────────┘
```

---

## 7. Open Decisions Made

| Decision                         | Choice                                                                                                                                           | Rationale                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| T&C checkbox persistence         | Reset on each sheet close                                                                                                                        | Legal gate, not a preference; stale "agreed" state is misleading when cart contents change between opens |
| Sheet + /cart page state sharing | `CartSheetProvider` receives `initialCart` from server layout; syncs via `useEffect` on prop change; server-action router-refresh keeps it fresh | Single source of truth (Medusa API), no client-side cache drift, no added dependencies                   |
| Partial add-to-cart failure      | Partial success + toast (Promise.allSettled)                                                                                                     | Rollback via deleteLineItem is fragile; clear per-item messaging is standard e-commerce pattern          |
| "Use same text" uncheck behavior | Revert to individual field values (preserved under checkbox)                                                                                     | Checkbox is a view toggle, not a commit; user unchecking wants to go back to individual editing          |
| Recommended products filtering   | Server-side category filter, client-side cart exclusion only; brand deferred (field doesn't exist in data model yet)                             | Survives 1,067-product bulk import without refactor; brand-matching is follow-up once field is defined   |
| Sheet auto-open mechanism        | `CartSheetProvider` React Context at layout level                                                                                                | Single provider consumed by both Nav (CartButton) and PDP (ProductActions); no prop drilling             |
| CartDropdown fate                | Deleted                                                                                                                                          | Only consumer was CartButton, now repurposed                                                             |

---

## 8. Edge Cases & Constraints

- **No persistence across navigation/reload** — PDP selections reset on leave. Standard PDP behavior, no special state management needed.
- **Variant with 0 inventory and no backorder** — stepper is disabled at 0 (both buttons disabled), "Out of stock" badge shown.
- **All variants out of stock** — "Add to Cart" button shows "Out of stock", disabled.
- **Engraving text with special characters** — passed as `metadata.engraved_text` string; no sanitization needed at this layer (Medusa handles JSON encoding).
- **Empty engraving text** — treated as "no engraving requested"; fee is not added.
- **Rapid add-to-cart clicks** — button disables during `isAdding` state (existing pattern, preserved).
- **Cart sheet on mobile** — full-width slide-over (not 400px fixed); bottom-sheet pattern on small viewports if the right-edge slide-over feels awkward (design judgment call at implementation).
- **`/cart` page still fully functional** — all existing cart functionality (quantity changes, item removal, checkout flow) remains unchanged on the dedicated page.
