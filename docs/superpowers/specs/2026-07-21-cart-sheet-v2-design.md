# Cart Sheet v2 — Side Panel + Quick-Add + Engraving Toggle

**Date:** 2026-07-21
**Session:** PDP/cart overhaul follow-up
**Status:** Approved, pending implementation

---

## 1. Overview

Three improvements to the cart sheet built in the PDP/cart overhaul:

- **Side panel layout** — "You Might Also Like" moves out of the cart scroll area into a dedicated panel. On desktop: sits to the left of the cart sheet (cart hugs the far-right edge of the viewport). On mobile: bottom section that peeks up into the cart sheet with a visible drag handle.
- **Quick-add from recommended** — each recommended product card gets an `[+ Add]` button. Single-variant products add directly. Multi-variant products open a compact variant-selection modal.
- **Engraving toggle in cart** — per-item Yes/No pill toggle below the quantity stepper. Reveals a text field when "Yes" is active. Fee caption from the existing `EngravingFieldCaption` component. Replaces the bare text field that only appeared when `isEngraved` was pre-set.

Design system: **Ink & Paper** tokens. Existing components reused: `CartSheet`, `CartSheetItem`, `CartSheetRecommended`, `VariantSwatchCard`, `QuantityStepper`, `EngravingFieldCaption`.

---

## 2. Side Panel Layout

### 2.1 Desktop (≥1024px)

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   ┌───────────────────────────┐  ┌──────────────────┐   │
│   │                           │  │                  │   │
│   │  YOU MIGHT ALSO LIKE      │  │   CART SHEET     │   │
│   │  (280px, z-40)            │  │   (400px, z-50)  │   │
│   │                           │  │                  │   │
│   │  ┌─────────┐ ┌─────────┐ │  │  Line items      │   │
│   │  │ [img]   │ │ [img]   │ │  │  Qty steppers    │   │
│   │  │ [+ Add] │ │ [+ Add] │ │  │  Engraving       │   │
│   │  └─────────┘ └─────────┘ │  │  Subtotal        │   │
│   │  ┌─────────┐ ┌─────────┐ │  │  T&C [Checkout]  │   │
│   │  │ [img]   │ │ [img]   │ │  │                  │   │
│   │  │ [+ Add] │ │ [+ Add] │ │  └──────────────────┘   │
│   │  └─────────┘ └─────────┘ │                           │
│   └───────────────────────────┘                           │
│                                                          │
│   ░░░░░░░░░░ backdrop (dismisses both) ░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────┘
```

- **Cart sheet**: `fixed right-0 top-0 h-full w-full max-w-md`, `z-50`. Unchanged from current.
- **Recommended panel**: `fixed` to the left of the cart, same height. Width ~280px. `z-40` so it sits behind the cart visually but is still a visible column. Animates in/out with the same Headless UI Transition pattern.
- **Backdrop**: shared — clicking backdrop closes both panels.
- **Scroll**: each panel scrolls independently (`overflow-y-auto`).
- **Close**: closing the cart also closes the recommended panel. Closing the panel alone does not close the cart (but this interaction is rare since the backdrop dismisses both).

### 2.2 Mobile (<1024px)

```
┌──────────────────────┐
│                      │
│   CART SHEET         │
│   (full width)       │
│                      │
│   Line items         │
│   ...                │
│   ...                │
│                      │
│   ═══ drag handle ═══│  ← always visible
│   YOU MIGHT ALSO     │
│   LIKE ▲             │
│                      │
│   ┌─────────┐ ┌────┐ │
│   │ [img]   │ │[img]│ │
│   │ [+ Add] │ │[+  ]│ │
│   └─────────┘ └────┘ │
└──────────────────────┘
```

- Recommended section is part of the cart sheet scroll body — positioned after line items
- A sticky header with "YOU MIGHT ALSO LIKE" and a drag handle remains visible even when scrolled past line items
- Section is always rendered; no lazy loading or conditional visibility
- Height of the recommended grid is naturally limited (2 rows × 2 columns max)

### 2.3 Animation

- Desktop: recommended panel slides in from the right (same direction as cart), offset ~24px behind the cart. Uses Headless UI `Transition` with `translate-x` transform.
- Mobile: the section is always present in the scroll flow. No separate animation needed — it's part of the sheet body.
- Timing: 300ms ease-out (matching existing `CartSheet` transitions).

---

## 3. Quick-Add from Recommended Panel

### 3.1 Single-variant products

```
┌─────────┐
│ [img]   │
│ Name     │
│ ₱XXX    │
│ [+ Add] │  ← button
└─────────┘
```

- Clicking `[+ Add]` calls `addToCart({ variantId, quantity: 1, countryCode })` directly
- Button shows a spinner during the async call, then a brief checkmark (✓ Added) for 1.5s before reverting to `[+ Add]`
- No modal, no variant selection — single click to cart

### 3.2 Multi-variant products

- Clicking `[+ Add]` opens a compact variant-selection modal
- The button text always shows `[+ Add]` — the modal makes variant selection obvious enough, no need for different button text

### 3.3 Variant selection modal

```
┌──────────────────────────────┐
│  Select Variant        [✕]   │  ← header
├──────────────────────────────┤
│                              │
│  Custom Color                │
│  ┌──────────┐ ┌──────────┐  │
│  │ [image]  │ │ [image]  │  │  ← VariantSwatchCard (single-select mode)
│  │ Silky    │ │ White    │  │
│  │ Green    │ │          │  │
│  │          │ │ ✓selected│  │
│  └──────────┘ └──────────┘  │
│                              │
│  Qty: − 1 +                 │  ← compact QuantityStepper
│                              │
│  ┌──────────────────────────┐│
│  │ Add to cart — ₱213.00    ││  ← vermilion CTA
│  └──────────────────────────┘│
└──────────────────────────────┘
```

**Component:** Headless UI `Dialog`, centered, ~360px wide on desktop, full-width bottom sheet on mobile.

**Reuses:**

- `VariantSwatchCard` in single-select mode (no multi-select props passed — falls back to click-to-select behavior)
- `QuantityStepper` in compact mode — default qty: 1, min: 1

**Behavior:**

- Selecting a variant updates the modal's `selectedVariant` and enables the Add button
- Clicking "Add to cart" calls `addToCart({ variantId, quantity, countryCode })`, closes the modal, and opens the cart sheet (if not already open)
- Modal dismiss on backdrop click or ✕ button
- State resets on close (selected variant cleared, qty back to 1)

**Edge case — out of stock variant:** the VariantSwatchCard shows the dimmed "Out of stock" badge. The Add button is disabled and shows "Out of stock."

---

## 4. Engraving Toggle in Cart Line Items

### 4.1 Per-item toggle (replaces bare text field)

```
┌────────────────────────────────────────┐
│ [img]  Silky Lavender           ₱213  │
│        Variant: Silky Lavender         │
│        Qty: − 2 +                     │
│        ┌──────────────────────────┐   │
│        │ ✎ Add Engraving?  [Yes]/ No│ │  ← pill toggle
│        │ ┌────────────────────────┐ │ │
│        │ │ "Sarah"                │ │ │  ← text field (when Yes)
│        │ └────────────────────────┘ │ │
│        │ ₱25/unit — free at 10+     │ │  ← EngravingFieldCaption
│        └──────────────────────────┘   │
│                            [remove]   │
└────────────────────────────────────────┘
```

### 4.2 Behavior

| Action                                | Effect                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click "Yes"                           | Text field slides in. Toggles `engraved: true` on the line item.                                                                                           |
| Click "No"                            | Text field slides out. Calls `updateLineItem({ metadata: { engraved: false, engraved_text: "" } })` to clear.                                              |
| Type text                             | Debounced update: calls `updateLineItem({ metadata: { engraved: true, engraved_text: text } })` on each keystroke (existing pattern from `CartSheetItem`). |
| Toggle No→Yes→No                      | Text value is preserved — re-selecting "Yes" restores the previously typed text.                                                                           |
| Item added from PDP with engraving    | Toggle defaults to "Yes" with text pre-filled from `metadata.engraved_text`.                                                                               |
| Item added from PDP without engraving | Toggle defaults to "No", text field is empty.                                                                                                              |
| Ineligible variant                    | Toggle does not render at all — no engraving section visible.                                                                                              |

### 4.3 Component structure

```
CartSheetItem
├── Thumbnail + product link
├── Variant label
├── Unit price
├── QuantityStepper (compact)
├── EngravingToggle (NEW — pill Yes/No + conditional text field)
│   ├── Yes/No pill buttons (Button variant="primary"/"secondary", size="small")
│   └── (when Yes) Text input + EngravingFieldCaption
└── Line total + Remove button
```

### 4.4 Fee caption

Reuses `EngravingFieldCaption` — the same component rendered below PDP engraving fields. Shows:

- Fee + threshold: "₱25.00/unit — free at 10+ units"
- Fee only: "₱25.00/unit engraving fee applies"
- Free: "Free engraving included"

### 4.5 State model

```tsx
// Inside CartSheetItem:
const [isEngraved, setIsEngraved] = useState(
  item.metadata?.engraved === true || item.metadata?.engraved === "true",
);
const [engravedText, setEngravedText] = useState(
  (item.metadata?.engraved_text as string) ?? "",
);
// Text is preserved across toggle on/off — only cleared on explicit "No" + save
```

### 4.6 Data flow

- **Toggle on**: `updateLineItem({ lineId, quantity, metadata: { engraved: true, engraved_text: engravedText } })`
- **Toggle off**: `updateLineItem({ lineId, quantity, metadata: { engraved: false, engraved_text: "" } })`
- **Text change**: debounced `updateLineItem` with current metadata
- **Server action triggers** router-refresh → `CartSheetProvider` syncs from new `initialCart`

---

## 5. Component Changes

| Component                                                        | Action        | Details                                                                   |
| ---------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| `CartSheet` (`cart-sheet/index.tsx`)                             | **Modify**    | Add recommended panel alongside cart on desktop; bottom section on mobile |
| `CartSheetItem` (`cart-sheet/cart-sheet-item.tsx`)               | **Modify**    | Add engraving toggle (Yes/No pills + conditional text field)              |
| `CartSheetRecommended` (`cart-sheet/cart-sheet-recommended.tsx`) | **Modify**    | Add `[+ Add]` button per product card; pass `openVariantModal` callback   |
| New: `QuickAddModal` (`cart-sheet/quick-add-modal.tsx`)          | **Create**    | Compact variant-selection modal for multi-variant products                |
| `CartSheetProvider`                                              | **Unchanged** | Existing context already handles cart state, open/close, partial-failure  |

---

## 6. Edge Cases & Constraints

- **Desktop recommended panel empty**: if no recommended products match (empty category/brand + empty fallback), the panel still renders the "YOU MIGHT ALSO LIKE" header but shows "Check back soon" placeholder text. Don't collapse the panel entirely — it leaves an awkward gap.
- **Quick-add while offline**: button shows error state ("Couldn't add") reverting after 2s. No modal opens.
- **Variant modal + cart sheet both open**: the modal stacks above the cart (z-60). Closing the modal returns focus to the recommended panel. Closing the cart closes the modal too.
- **Already-in-cart products in recommended**: excluded by `cartVariantIds` filter (existing logic). If the user adds a recommended product, it disappears from the panel on re-render.
- **Mobile recommended section with no products**: hides entirely — no empty state on mobile.
- **Screen width 1024px–1080px**: the combined panel+cart width (280+400=680px) approaches the viewport edge. At this breakpoint, hide the recommended panel entirely (only the cart sheet is shown). The panel reappears at ≥1080px. Use a CSS media query or Tailwind `lg:block` pattern.
