# Cart Sheet v2 — Side Panel + Quick-Add + Engraving Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add engraving Yes/No toggle to cart line items, quick-add buttons to recommended products (with variant-selection modal for multi-variant products), and reposition recommended products into a side panel alongside the cart sheet on desktop (≥1080px).

**Architecture:** Four focused component changes. `CartSheetItem` gains a pill-toggle engraving control that preserves text across toggles. `CartSheetRecommended` gains per-product `[+ Add]` buttons; single-variant products add directly, multi-variant products open a new `QuickAddModal`. `CartSheet` gains a side-panel layout: separate fixed panel to the left of the cart on desktop, bottom section inside the sheet on mobile. Shared backdrop dismisses both panels. No provider changes needed — `partialFailureMessage` already exists.

**Tech Stack:** Next.js 15 App Router, Medusa 2.x SDK, Headless UI (Dialog/Transition), Tailwind CSS, Ink & Paper design tokens

## Global Constraints

- Design system: Ink & Paper tokens (Ink #1a2332, Vermilion #cc2936, Paper #fcfcf9, Washi #f2ede6, Fraunces display, Inter body) — already applied storefront-wide
- Desktop side-panel breakpoint: ≥1080px (Tailwind `xl:`). Mobile: <1080px.
- Engraving fee authority: `metadata.engraved === true` (boolean), NOT text presence. A line item with `engraved: false` + non-empty `engraved_text` is NOT charged the fee.
- Engraving text MUST survive "No" toggle and sheet close/reopen — do NOT clear `engraved_text` server-side on toggle-off.
- Fee threshold logic: `feeWaived = threshold > 0 && qty >= threshold`. Fee charges when `hasText && isEngravable && !feeWaived`. Do NOT use `|| 1` fallback.
- Stepper max: three-state inventory (tracked+capped, backorder+uncapped, oos+disabled).
- QuickAddModal: for multi-option products, render one VariantSwatchCard per option group; button enables only when ALL groups have selections.
- All visual/UX claims require a Playwright screenshot or explicit DOM/testid check — "compiles" is never sufficient evidence.
- `partialFailureMessage`/`setPartialFailureMessage` already exist in CartSheetProvider — use them, don't console.warn.

---

## File Structure

| File                                                                                | Action        | Responsibility                                                       |
| ----------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------- |
| `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-item.tsx`        | **Modify**    | Add engraving Yes/No toggle + conditional text field + fee caption   |
| `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-recommended.tsx` | **Modify**    | Add `[+ Add]` button per product; accept `onQuickAdd` callback       |
| `apps/storefront/src/modules/cart/components/cart-sheet/quick-add-modal.tsx`        | **Create**    | Variant-selection modal for multi-variant products                   |
| `apps/storefront/src/modules/cart/components/cart-sheet/index.tsx`                  | **Modify**    | Side-panel layout: desktop panel left of cart, mobile bottom section |
| `apps/storefront/src/modules/cart/components/cart-sheet-provider/index.tsx`         | **No change** | Already has partialFailureMessage (predates this plan)               |

---

### Task 1: Engraving Yes/No Toggle in CartSheetItem

**Files:**

- Modify: `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-item.tsx`

**Interfaces:**

- Consumes: existing `CartSheetItemProps` (item, currencyCode)
- Produces: same component — adds engraving toggle UI, modifies `handleEngravingChange` to respect debounce and NOT clear `engraved_text` on "No"

**Changes from current:** The current code (lines 20-24) reads `isEngraved` from metadata and conditionally shows a bare text field. The rewrite adds a Yes/No pill toggle that reveals the text field only when "Yes" is active. Toggling "No" sets `engraved: false` without clearing `engraved_text`. The text field uses 400ms debounce. `EngravingFieldCaption` renders below the text field when "Yes" is active and a fee exists.

- [ ] **Step 1: Read the current file to confirm starting state**

The file at `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-item.tsx` — lines 17-42 contain the current engraving logic. Read these lines before editing.

- [ ] **Step 2: Add imports and replace state logic**

Add imports for `EngravingFieldCaption` and the `Button` component. Replace the existing `isEngraved` derived value and `handleEngravingChange` with the new toggle logic:

```tsx
"use client"

import { deleteLineItem, updateLineItem } from "@lib/data/cart"
import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import QuantityStepper from "@modules/products/components/product-actions/quantity-stepper"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import EngravingFieldCaption from "@modules/products/components/engraving-field-caption"
import { Button } from "@modules/common/components/ui"
import { useRef, useState, useCallback, useEffect } from "react"

// ... (props type unchanged)

export default function CartSheetItem({
  item,
  currencyCode,
}: CartSheetItemProps) {
  const [updating, setUpdating] = useState(false)

  // Engraving state — text persists locally even when toggled off
  const [isEngraved, setIsEngraved] = useState(
    item.metadata?.engraved === true || item.metadata?.engraved === "true"
  )
  const [engravedText, setEngravedText] = useState(
    (item.metadata?.engraved_text as string) ?? ""
  )

  // Sync from server when item metadata changes (e.g. after router-refresh)
  useEffect(() => {
    const serverEngraved =
      item.metadata?.engraved === true || item.metadata?.engraved === "true"
    setIsEngraved(serverEngraved)
    setEngravedText((item.metadata?.engraved_text as string) ?? "")
  }, [item.metadata?.engraved, item.metadata?.engraved_text])

  // Debounce ref for engraving text updates
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedUpdateEngraving = useCallback(
    (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        updateLineItem({
          lineId: item.id,
          quantity: item.quantity,
          metadata: { engraved: true, engraved_text: text },
        })
      }, 400)
    },
    [item.id, item.quantity]
  )

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleEngravingToggle = async (on: boolean) => {
    setIsEngraved(on)
    if (on) {
      // Restore preserved text (from local state; server still has it since we never clear)
      await updateLineItem({
        lineId: item.id,
        quantity: item.quantity,
        metadata: { engraved: true, engraved_text: engravedText },
      })
    } else {
      // Toggle off — do NOT clear engraved_text so it survives close/reopen
      await updateLineItem({
        lineId: item.id,
        quantity: item.quantity,
        metadata: { engraved: false },
      })
    }
  }

  const handleEngravingTextChange = (text: string) => {
    setEngravedText(text)
    debouncedUpdateEngraving(text)
  }

  // ... (handleQuantityChange, handleRemove, maxQty unchanged)

  // Engraving eligibility from variant metadata
  const isEngravable =
    item.variant?.metadata?.is_engravable === true ||
    item.variant?.metadata?.is_engravable === "true"
  const engravingFee = Number(item.variant?.metadata?.engraving_fee) || 0
  const engravingThreshold =
    Number(item.variant?.metadata?.engraving_threshold) || 0

  // ... (title, variantLabel, thumbnail — unchanged)
```

- [ ] **Step 3: Replace the engraving section in the JSX**

Replace lines 119-131 (the `{isEngraved && (<input>)}` block) with the new toggle UI:

```tsx
{
  /* Engraving toggle — only shown for engravable variants */
}
{
  isEngravable && (
    <div className="mt-2">
      <div className="flex items-center gap-x-2">
        <span className="text-xs text-cosmos-graphite">✎ Add Engraving?</span>
        <Button
          size="small"
          variant={isEngraved ? "primary" : "secondary"}
          onClick={() => handleEngravingToggle(true)}
          disabled={updating}
          data-testid={`engraving-yes-${item.id}`}
        >
          Yes
        </Button>
        <Button
          size="small"
          variant={!isEngraved ? "primary" : "secondary"}
          onClick={() => handleEngravingToggle(false)}
          disabled={updating}
          data-testid={`engraving-no-${item.id}`}
        >
          No
        </Button>
      </div>

      {/* Text field + fee caption — shown when Yes is active */}
      {isEngraved && (
        <div className="mt-2">
          <input
            type="text"
            value={engravedText}
            onChange={(e) => handleEngravingTextChange(e.target.value)}
            placeholder="Enter text to engrave..."
            className="w-full text-xs px-2 py-1 rounded border border-cosmos-hairline bg-cosmos-paper text-cosmos-charcoal placeholder:text-cosmos-graphite focus:outline-none focus:ring-1 focus:ring-cosmos-ink"
            data-testid={`cart-sheet-engraving-${item.id}`}
          />
          <EngravingFieldCaption
            fee={engravingFee}
            threshold={engravingThreshold}
            currencyCode={currencyCode}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compilation**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -10 || echo "No TS errors"
```

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-item.tsx
git commit -m "feat: add engraving Yes/No toggle to cart sheet line items

- Yes/No pill buttons replace bare text field
- Text persists across toggle off (engraved_text NOT cleared server-side)
- 400ms debounced text updates
- Fee caption via EngravingFieldCaption (reused from PDP)
- Ineligible variants show no toggle at all

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Quick-Add Buttons on Recommended Products + QuickAddModal

**Files:**

- Modify: `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-recommended.tsx`
- Create: `apps/storefront/src/modules/cart/components/cart-sheet/quick-add-modal.tsx`

**Interfaces:**

- Consumes: `addToCart()`, `useParams().countryCode`, `VariantSwatchCard` (single-select mode), `QuantityStepper`
- Produces: `QuickAddModal({ product, countryCode, open, onClose }: { product: HttpTypes.StoreProduct; countryCode: string; open: boolean; onClose: () => void })` — compact variant-selection modal
- CartSheetRecommended gains `[+ Add]` buttons; opens QuickAddModal for multi-variant products

**QuickAddModal design:**

- Headless UI Dialog, centered, max-w-sm (360px) on desktop, full-width bottom sheet on mobile
- Renders one `VariantSwatchCard` per option group (single-select mode: no multi-select props)
- Single `QuantityStepper` (compact, default qty:1)
- Stock-aware max: three-state inventory logic from PDP
- Add button enabled only when all option groups have selections (valid variant exists)
- On add: calls `addToCart`, closes modal, opens cart sheet via `useCartSheet().openSheet()`

- [ ] **Step 1: Create QuickAddModal component**

Create `apps/storefront/src/modules/cart/components/cart-sheet/quick-add-modal.tsx`:

```tsx
"use client";

import { Dialog, Transition } from "@headlessui/react";
import { addToCart } from "@lib/data/cart";
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider";
import { HttpTypes } from "@medusajs/types";
import { Button } from "@modules/common/components/ui";
import VariantSwatchCard from "@modules/products/components/product-actions/variant-swatch-card";
import QuantityStepper from "@modules/products/components/product-actions/quantity-stepper";
import { Fragment, useMemo, useState } from "react";
import { isEqual } from "lodash";

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"],
) => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt) => {
    if (varopt.option_id) acc[varopt.option_id] = varopt.value;
    return acc;
  }, {});
};

type QuickAddModalProps = {
  product: HttpTypes.StoreProduct;
  countryCode: string;
  open: boolean;
  onClose: () => void;
};

export default function QuickAddModal({
  product,
  countryCode,
  open,
  onClose,
}: QuickAddModalProps) {
  const { openSheet } = useCartSheet();
  const [options, setOptions] = useState<Record<string, string | undefined>>(
    {},
  );
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);

  // Find selected variant from options
  const selectedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return undefined;
    return product.variants.find((v) => {
      const variantOptions = optionsAsKeymap(v.options);
      return isEqual(variantOptions, options);
    });
  }, [product.variants, options]);

  // Check if all option groups have a selection
  const allOptionsSelected = useMemo(() => {
    return (product.options || []).every(
      (opt) => options[opt.id] !== undefined,
    );
  }, [product.options, options]);

  // Stock-aware max — three-state inventory from PDP logic
  const maxQty = useMemo(() => {
    if (!selectedVariant) return null;
    if (!selectedVariant.manage_inventory || selectedVariant.allow_backorder) {
      return null; // uncapped
    }
    return selectedVariant.inventory_quantity ?? 0; // capped
  }, [selectedVariant]);

  const inStock = useMemo(() => {
    if (!selectedVariant) return null;
    if (!selectedVariant.manage_inventory) return true;
    if (selectedVariant.allow_backorder) return true;
    return (selectedVariant.inventory_quantity || 0) > 0;
  }, [selectedVariant]);

  const price = selectedVariant?.calculated_price?.calculated_amount ?? null;
  const formattedPrice =
    price != null
      ? new Intl.NumberFormat("en-PH", {
          style: "currency",
          currency: selectedVariant?.calculated_price?.currency_code ?? "PHP",
        }).format(price)
      : null;

  const handleAdd = async () => {
    if (!selectedVariant?.id) return;
    setIsAdding(true);
    try {
      await addToCart({
        variantId: selectedVariant.id,
        quantity,
        countryCode,
      });
      handleClose();
      openSheet();
    } catch {
      // addToCart is a server action that handles errors internally
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    setOptions({});
    setQuantity(1);
    onClose();
  };

  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={handleClose} className="relative z-[60]">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-cosmos-ink/40" aria-hidden="true" />
        </Transition.Child>

        {/* Panel */}
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-sm bg-cosmos-paper rounded-lg shadow-xl max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-cosmos-hairline">
                <Dialog.Title className="text-base font-semibold text-cosmos-charcoal font-fraunces">
                  Select Variant
                </Dialog.Title>
                <button
                  onClick={handleClose}
                  className="p-1 rounded-md text-cosmos-graphite hover:text-cosmos-charcoal hover:bg-cosmos-washi transition-colors"
                  aria-label="Close"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="px-4 py-4 flex flex-col gap-y-5">
                {/* One VariantSwatchCard per option group */}
                {(product.options || []).map((option) => (
                  <div key={option.id}>
                    <VariantSwatchCard
                      option={option}
                      variants={product.variants ?? []}
                      productImages={product.images ?? null}
                      current={options[option.id]}
                      updateOption={(optionId, value) =>
                        setOptions((prev) => ({ ...prev, [optionId]: value }))
                      }
                      title={option.title ?? ""}
                      disabled={isAdding}
                    />
                  </div>
                ))}

                {/* Quantity stepper */}
                <div className="flex items-center gap-x-3">
                  <span className="text-sm font-medium text-cosmos-charcoal">
                    Qty:
                  </span>
                  <QuantityStepper
                    quantity={quantity}
                    onChange={setQuantity}
                    max={maxQty}
                    disabled={!selectedVariant || inStock === false || isAdding}
                    compact
                    data-testid="quick-add-modal-stepper"
                  />
                </div>

                {/* Price */}
                {formattedPrice && (
                  <p className="text-sm text-cosmos-graphite text-right">
                    {formattedPrice} each
                  </p>
                )}
              </div>

              {/* Footer — Add button */}
              <div className="px-4 py-3 border-t border-cosmos-hairline">
                <Button
                  onClick={handleAdd}
                  disabled={!selectedVariant || inStock === false || isAdding}
                  variant="primary"
                  className="w-full h-10 bg-cosmos-ink hover:bg-cosmos-charcoal text-white"
                  isLoading={isAdding}
                  data-testid="quick-add-modal-button"
                >
                  {!allOptionsSelected
                    ? "Select options"
                    : inStock === false
                      ? "Out of stock"
                      : `Add to cart${formattedPrice ? ` — ${formattedPrice}` : ""}`}
                </Button>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
```

- [ ] **Step 2: Modify CartSheetRecommended — add [+ Add] buttons and modal state**

Rewrite `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-recommended.tsx`. The key changes from current:

- Import and use `addToCart`, `Button`, `QuickAddModal`, `useCartSheet`
- Add `[+ Add]` button per product card
- Track which product opens the modal (`modalProduct` state)
- Track add state per product (`adding` map) for spinner/checkmark feedback
- Integrate `openSheet()` after successful single-variant add

```tsx
"use client";

import { addToCart } from "@lib/data/cart";
import { listProducts } from "@lib/data/products";
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider";
import { HttpTypes } from "@medusajs/types";
import { Button } from "@modules/common/components/ui";
import LocalizedClientLink from "@modules/common/components/localized-client-link";
import { useEffect, useState } from "react";
import QuickAddModal from "./quick-add-modal";

type CartSheetRecommendedProps = {
  cart: HttpTypes.StoreCart | null;
  countryCode: string;
};

export default function CartSheetRecommended({
  cart,
  countryCode,
}: CartSheetRecommendedProps) {
  const { openSheet } = useCartSheet();
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>([]);
  const [modalProduct, setModalProduct] =
    useState<HttpTypes.StoreProduct | null>(null);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!cart?.items?.length) {
      setProducts([]);
      return;
    }

    const fetchRecommended = async () => {
      try {
        const cartVariantIds = new Set(
          cart.items?.map((item) => item.variant_id).filter(Boolean) ?? [],
        );

        const categoryIds = [
          ...new Set(
            (cart.items ?? [])
              .flatMap(
                (item) =>
                  (item.product as HttpTypes.StoreProduct)?.categories?.map(
                    (c: { id: string }) => c.id,
                  ) ?? [],
              )
              .filter(Boolean),
          ),
        ];

        const { response } = await listProducts({
          countryCode,
          queryParams: {
            ...(categoryIds.length > 0 ? { category_id: categoryIds[0] } : {}),
            limit: categoryIds.length > 0 ? 20 : 4,
            fields:
              "*variants.calculated_price,*thumbnail,*images,*variants.inventory_quantity,*variants.manage_inventory,*variants.allow_backorder,*options,*options.values",
          },
        });

        const recommended = (response.products ?? [])
          .filter((p) => !p.variants?.some((v) => cartVariantIds.has(v.id)))
          .slice(0, 4);

        setProducts(recommended);
      } catch {
        setProducts([]);
      }
    };

    fetchRecommended();
  }, [cart, countryCode]);

  const isMultiVariant = (product: HttpTypes.StoreProduct) =>
    (product.variants?.length ?? 0) > 1;

  const handleQuickAdd = async (product: HttpTypes.StoreProduct) => {
    const variant = product.variants?.[0];
    if (!variant?.id) return;

    if (isMultiVariant(product)) {
      setModalProduct(product);
      return;
    }

    // Single-variant: direct add
    const productId = product.id!;
    setAdding((prev) => ({ ...prev, [productId]: true }));
    try {
      await addToCart({
        variantId: variant.id,
        quantity: 1,
        countryCode,
      });
      setAdded((prev) => ({ ...prev, [productId]: true }));
      openSheet();
      setTimeout(() => {
        setAdded((prev) => ({ ...prev, [productId]: false }));
      }, 1500);
    } catch {
      // Server action handles errors internally
    } finally {
      setAdding((prev) => ({ ...prev, [productId]: false }));
    }
  };

  if (products.length === 0) return null;

  return (
    <>
      <div className="mt-4 pt-4 border-t border-cosmos-hairline">
        <p className="text-xs font-semibold text-cosmos-graphite uppercase tracking-wide mb-3">
          You might also like
        </p>
        <div className="grid grid-cols-2 gap-3">
          {products.map((product) => {
            const productId = product.id!;
            const isAdding = adding[productId];
            const isAdded = added[productId];

            return (
              <div key={product.id} className="group">
                <LocalizedClientLink
                  href={`/products/${product.handle}`}
                  className="block"
                >
                  <div className="aspect-square rounded-md overflow-hidden bg-cosmos-washi mb-1.5">
                    {product.thumbnail ? (
                      <img
                        src={product.thumbnail}
                        alt={product.title ?? ""}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-cosmos-graphite text-xs">
                        No image
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-medium text-cosmos-charcoal truncate group-hover:text-cosmos-ink transition-colors">
                    {product.title}
                  </p>
                  {product.variants?.[0]?.calculated_price?.calculated_amount !=
                    null && (
                    <p className="text-xs text-cosmos-graphite">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency:
                          product.variants[0].calculated_price.currency_code ??
                          "PHP",
                      }).format(
                        product.variants[0].calculated_price.calculated_amount,
                      )}
                    </p>
                  )}
                </LocalizedClientLink>
                <Button
                  onClick={() => handleQuickAdd(product)}
                  size="small"
                  variant="secondary"
                  disabled={isAdding}
                  isLoading={isAdding}
                  className="w-full mt-1 text-xs h-7"
                  data-testid={`quick-add-${product.id}`}
                >
                  {isAdded ? "✓ Added" : "+ Add"}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Variant selection modal for multi-variant products */}
      {modalProduct && (
        <QuickAddModal
          product={modalProduct}
          countryCode={countryCode}
          open={!!modalProduct}
          onClose={() => setModalProduct(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2a: Note — the `<div>` wrapping each product replaces the outer `<LocalizedClientLink>`**

The product name + image link is now inside a wrapper `<div>` so the [+ Add] button can sit below it without being inside the link. The `LocalizedClientLink` wraps just the image + name + price, not the whole card.

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -15 || echo "No TS errors"
```

Fix any type errors. Potential issues:

- `product.options` typing — may need `as HttpTypes.StoreProductOption[]`
- `listProducts` response type — `response.products` may need explicit typing
- `Button` `isLoading` prop — confirm it exists in the Button component

- [ ] **Step 4: Commit**

```bash
git add apps/storefront/src/modules/cart/components/cart-sheet/quick-add-modal.tsx apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-recommended.tsx
git commit -m "feat: add quick-add buttons to recommended products + QuickAddModal

- [+ Add] button per recommended product card
- Single-variant: direct add to cart with spinner → '✓ Added' feedback
- Multi-variant: opens QuickAddModal with VariantSwatchCard per option group
- QuickAddModal: stock-aware stepper max (three-state inventory), single-select
- Modal opens cart sheet on successful add

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Side Panel Layout in CartSheet

**Files:**

- Modify: `apps/storefront/src/modules/cart/components/cart-sheet/index.tsx`

**Interfaces:**

- Consumes: `useCartSheet()` context, `CartSheetItem`, `CartSheetRecommended` (updated from Task 2)
- Produces: `CartSheet()` — gains side-panel layout on desktop (≥1080px)

**Design:**

- Desktop (≥1080px): cart sheet (`fixed right-0`, `z-50`) + recommended panel (`fixed` to its left, `z-40`, width 280px). Both slide in from right simultaneously. Shared backdrop dismisses both.
- Mobile (<1080px): recommended section inside the cart scroll body (current behavior, no layout change needed — Task 2's CartSheetRecommended already renders there).
- The recommended panel on desktop is a distinct `Dialog.Panel` sibling inside the same `Transition` so both panels animate together.

- [ ] **Step 1: Read the current CartSheet to understand the structure**

The current `CartSheet` returns a single `Dialog.Panel` at `fixed right-0`. The `<CartSheetRecommended>` component renders inside the scrollable body. For desktop, we need to extract recommended products into a separate fixed panel alongside the cart.

- [ ] **Step 2: Rewrite CartSheet with dual-panel desktop layout**

Replace the entire return block of `apps/storefront/src/modules/cart/components/cart-sheet/index.tsx`. The key structural change: the cart items and footer stay in the existing `Dialog.Panel`. A second fixed panel for recommended products appears on desktop at `right-[calc(28rem+24px)]` (to the left of the 448px cart). On mobile, recommended products render inside the cart body as before.

```tsx
// ... imports unchanged from current

export default function CartSheet() {
  const {
    cart,
    isSheetOpen,
    closeSheet,
    partialFailureMessage,
    setPartialFailureMessage,
  } = useCartSheet();
  const countryCode = useParams().countryCode as string;
  const [termsChecked, setTermsChecked] = useState(false);

  const handleClose = () => {
    setTermsChecked(false);
    closeSheet();
  };

  const currencyCode = cart?.region?.currency_code?.toUpperCase() ?? "PHP";
  const itemCount = cart?.items?.length ?? 0;
  const subtotal = cart?.subtotal ?? 0;
  const hasItems = !!(cart && itemCount > 0);

  return (
    <Transition show={isSheetOpen} as={Fragment}>
      <Dialog onClose={handleClose} className="relative z-50">
        {/* Backdrop — shared */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-cosmos-ink/30" aria-hidden="true" />
        </Transition.Child>

        {/* Desktop: Recommended products panel — sits to the left of the cart */}
        {hasItems && (
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="ease-in duration-200"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <div className="hidden xl:block fixed right-[28rem] top-0 h-full w-72 bg-cosmos-paper/95 backdrop-blur-sm border-r border-cosmos-hairline shadow-lg z-40 overflow-y-auto">
              <div className="px-4 pt-16 pb-4">
                <p className="text-xs font-semibold text-cosmos-graphite uppercase tracking-wide mb-3">
                  You might also like
                </p>
                <CartSheetRecommended cart={cart} countryCode={countryCode} />
              </div>
            </div>
          </Transition.Child>
        )}

        {/* Cart sheet panel */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="translate-x-full"
          enterTo="translate-x-0"
          leave="ease-in duration-200"
          leaveFrom="translate-x-0"
          leaveTo="translate-x-full"
        >
          <Dialog.Panel className="fixed right-0 top-0 h-full w-full max-w-md bg-cosmos-paper shadow-xl flex flex-col z-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-cosmos-hairline">
              <Dialog.Title className="text-lg font-semibold text-cosmos-charcoal font-fraunces">
                Your Cart{itemCount > 0 ? ` (${itemCount})` : ""}
              </Dialog.Title>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-md text-cosmos-graphite hover:text-cosmos-charcoal hover:bg-cosmos-washi transition-colors"
                aria-label="Close cart"
                data-testid="cart-sheet-close"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Partial-failure banner */}
            {partialFailureMessage && (
              <div
                className="mx-4 mt-3 px-3 py-2 bg-cosmos-vermilion/10 border border-cosmos-vermilion/20 rounded-md flex items-start gap-x-2"
                data-testid="cart-sheet-failure-banner"
              >
                <p className="text-sm text-cosmos-vermilion-text flex-1">
                  {partialFailureMessage}
                </p>
                <button
                  onClick={() => setPartialFailureMessage(null)}
                  className="text-cosmos-vermilion-text hover:text-cosmos-charcoal transition-colors flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            )}

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto px-4">
              {!cart || itemCount === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-y-3 text-center py-12">
                  <p className="text-cosmos-graphite text-sm">
                    Your cart is empty.
                  </p>
                  <button
                    onClick={handleClose}
                    className="text-sm font-medium text-cosmos-ink hover:text-cosmos-charcoal transition-colors"
                  >
                    Continue shopping
                  </button>
                </div>
              ) : (
                <>
                  {/* Line items */}
                  <div className="divide-y divide-cosmos-hairline">
                    {cart.items!.map((item) => (
                      <CartSheetItem
                        key={item.id}
                        item={item}
                        currencyCode={currencyCode}
                      />
                    ))}
                  </div>

                  {/* Mobile: Recommended products inside scroll body */}
                  <div className="xl:hidden">
                    <CartSheetRecommended
                      cart={cart}
                      countryCode={countryCode}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Footer — sticky */}
            {cart && itemCount > 0 && (
              <div className="border-t border-cosmos-hairline px-4 py-4 bg-cosmos-paper">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-cosmos-graphite">Subtotal</span>
                  <span className="text-sm font-semibold text-cosmos-charcoal tabular-nums">
                    {convertToLocale({
                      amount: subtotal,
                      currency_code: currencyCode,
                    })}
                  </span>
                </div>

                <label className="flex items-start gap-x-2 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={termsChecked}
                    onChange={(e) => setTermsChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-cosmos-hairline text-cosmos-vermilion focus:ring-cosmos-ink"
                    data-testid="cart-sheet-terms-checkbox"
                  />
                  <span className="text-xs text-cosmos-graphite leading-relaxed">
                    I agree to the{" "}
                    <LocalizedClientLink
                      href="/terms"
                      className="text-cosmos-ink underline hover:text-cosmos-charcoal"
                    >
                      Terms &amp; Conditions
                    </LocalizedClientLink>
                  </span>
                </label>

                <LocalizedClientLink
                  href="/checkout?step=delivery"
                  className={`block w-full text-center py-2.5 rounded-md text-sm font-semibold transition-colors ${
                    termsChecked
                      ? "bg-cosmos-ink text-white hover:bg-cosmos-charcoal"
                      : "bg-cosmos-hairline text-cosmos-graphite cursor-not-allowed pointer-events-none"
                  }`}
                  data-testid="cart-sheet-checkout-button"
                  aria-disabled={!termsChecked}
                  tabIndex={termsChecked ? 0 : -1}
                  onClick={(e) => {
                    if (!termsChecked) e.preventDefault();
                    else handleClose();
                  }}
                >
                  Proceed to Checkout
                </LocalizedClientLink>

                <LocalizedClientLink
                  href="/cart"
                  className="block text-center text-xs text-cosmos-graphite hover:text-cosmos-charcoal mt-2 transition-colors"
                  onClick={handleClose}
                >
                  View full cart
                </LocalizedClientLink>
              </div>
            )}
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition>
  );
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -15 || echo "No TS errors"
```

- [ ] **Step 4: Playwright verification — desktop layout**

Start dev server. Navigate to a PDP, add item to cart. Verify:

- Cart sheet opens at the right edge
- Recommended panel appears to the left of the cart (when browser width ≥1080px)
- Both panels dismiss when clicking backdrop
- Screenshot both panels visible simultaneously

```bash
npm run storefront:dev
# Use Playwright to navigate, add to cart, take screenshot
```

- [ ] **Step 5: Playwright verification — mobile layout**

Resize browser to <1080px. Verify:

- Cart sheet opens full-width
- Recommended section appears below line items in the scroll body (not as a separate panel)
- "You might also like" header is visible

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/modules/cart/components/cart-sheet/index.tsx
git commit -m "feat: add side-panel layout to cart sheet (desktop recommended panel)

- Desktop (≥1080px): recommended panel to left of cart sheet, shared backdrop
- Mobile (<1080px): recommended section inside cart scroll body
- Both panels animate together via shared Transition
- Cart sheet at z-50, recommended panel at z-40

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: End-to-End Verification

**Files:**

- No code changes — visual verification only

- [ ] **Step 1: Engraving toggle**

Navigate to PDP, add an engravable variant (no engraving text). Open cart. Verify:

- Yes/No toggle visible on the line item
- Click "Yes" — text field appears with EngravingFieldCaption
- Type text, close sheet, reopen — text is preserved
- Toggle "No" — text field hides
- Toggle "Yes" again — text is restored (from server metadata, since engraved_text was never cleared)
- Screenshot all states

- [ ] **Step 2: Quick-add single-variant**

Open cart sheet with items. In recommended section:

- Click [+ Add] on a single-variant product
- Verify spinner appears on button, then "✓ Added"
- Cart item count increases
- Screenshot

- [ ] **Step 3: Quick-add multi-variant**

Click [+ Add] on a multi-variant product. Verify:

- QuickAddModal opens centered
- Option groups render as VariantSwatchCard grid
- Add button disabled until all groups selected
- Select variants, increase qty, click Add
- Modal closes, cart sheet opens with new item
- Screenshot modal open

- [ ] **Step 4: Desktop side panel**

Resize browser to ≥1080px. Open cart sheet with items. Verify:

- Recommended panel visible to the left of the cart
- Both panels have independent scroll
- Backdrop dismisses both
- Screenshot

- [ ] **Step 5: Mobile layout**

Resize browser to <1080px. Open cart sheet. Verify:

- Single full-width panel
- Recommended products inside scroll body below line items
- Screenshot

- [ ] **Step 6: Update graphify and commit report**

```bash
graphify update .
git add -A
git commit -m "docs: add end-to-end verification report for Cart Sheet v2"
```

---

## Verification Checklist

| Acceptance Criterion                          | Step | Method                                                 |
| --------------------------------------------- | ---- | ------------------------------------------------------ |
| Engraving Yes/No toggle on engravable items   | 1    | Screenshot + DOM: `[data-testid="engraving-yes-{id}"]` |
| Text survives toggle off + sheet close/reopen | 1    | Screenshot + verify engraved_text NOT cleared          |
| Ineligible variant shows no toggle            | 1    | DOM: engraving section absent                          |
| Quick-add single-variant: direct add          | 2    | Screenshot + cart count increment                      |
| Quick-add multi-variant: modal opens          | 3    | Screenshot `QuickAddModal`                             |
| Modal: multi-option renders all groups        | 3    | DOM: VariantSwatchCard per option group                |
| Modal: Add disabled until all groups selected | 3    | Screenshot disabled state                              |
| Modal: stock-aware max                        | 3    | Verify stepper max matches inventory                   |
| Desktop: side panel alongside cart            | 4    | Screenshot at ≥1080px                                  |
| Mobile: recommended in scroll body            | 5    | Screenshot at <1080px                                  |
| Backdrop dismisses both panels                | 4    | Click backdrop, verify both hidden                     |
