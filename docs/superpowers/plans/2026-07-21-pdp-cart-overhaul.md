# PDP Multi-Select + Cart Sheet Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-select PDP flow with multi-select variant + inline steppers, relocate engraving text inputs from cart to PDP, and build a cart slide-over sheet with T&C gate + recommended products.

**Architecture:** A `CartSheetProvider` React Context at the layout level shares cart state between Nav (CartButton) and PDP (ProductActions). ProductActions is rewritten for multi-variant state with per-variant steppers and engraving fields. A new Headless UI Dialog-based `CartSheet` slide-over replaces the old `CartDropdown`. Server-action router-refresh keeps cart state fresh without added dependencies.

**Tech Stack:** Next.js 15 App Router, Medusa 2.x SDK, Headless UI (Dialog/Transition), Tailwind CSS, Ink & Paper design tokens

## Global Constraints

- Design system: Ink & Paper tokens (Ink #1a2332, Vermilion #cc2936, Paper #fcfcf9, Washi #f2ede6, Fraunces display, Inter body) — already applied storefront-wide
- All visual/UX claims require a Playwright screenshot or explicit DOM/testid check — "compiles" is never sufficient evidence
- /cart page must remain fully functional
- No persistence of PDP selections across navigation/reload
- Engraving eligibility, fee, and threshold logic must be reused unchanged from existing `ProductActions.engravingMeta`
- `addToCart`, `updateLineItem`, `deleteLineItem` are server actions — must work within existing patterns
- Testids: `product-options`, `product-quantity-stepper`, `add-product-button`, `inventory-count`, `variant-swatch`, `quantity-decrement`, `quantity-increment`, `quantity-display`, `engraving-yes-button`, `engraving-no-button`, `engraving-fee-message`, `engraved-text-input`, `engraved-price-breakdown`, `cart-container`

---

## File Structure

| File                                                                                      | Action      | Responsibility                                                        |
| ----------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `apps/storefront/src/modules/cart/components/cart-sheet-provider/index.tsx`               | **Create**  | React Context provider: cart state, openSheet/closeSheet              |
| `apps/storefront/src/modules/cart/components/cart-sheet/index.tsx`                        | **Create**  | Headless UI Dialog slide-over shell                                   |
| `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-item.tsx`              | **Create**  | Single line-item row: image, title, stepper, engraving, remove        |
| `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-recommended.tsx`       | **Create**  | Recommended products section (category-based)                         |
| `apps/storefront/src/modules/products/components/engraving-field-caption/index.tsx`       | **Create**  | Fee/threshold messaging extracted from EngravingToggle                |
| `apps/storefront/src/app/[countryCode]/(main)/layout.tsx`                                 | **Modify**  | Wrap children in CartSheetProvider                                    |
| `apps/storefront/src/modules/layout/components/cart-button/index.tsx`                     | **Rewrite** | Use useCartSheet().openSheet() instead of CartDropdown                |
| `apps/storefront/src/modules/products/components/product-actions/variant-swatch-card.tsx` | **Modify**  | Add optional stepper + engraving field props                          |
| `apps/storefront/src/modules/products/components/product-actions/quantity-stepper.tsx`    | **Modify**  | Add `compact` boolean prop                                            |
| `apps/storefront/src/modules/products/components/product-actions/index.tsx`               | **Rewrite** | Multi-variant state, per-variant steppers/engraving, bulk add-to-cart |
| `apps/storefront/src/modules/cart/templates/summary.tsx`                                  | **Modify**  | Update engraving-text validation (text now on PDP, may be empty)      |
| `apps/storefront/src/modules/layout/components/cart-dropdown/index.tsx`                   | **Delete**  | Replaced by CartSheet                                                 |
| `apps/storefront/src/modules/products/components/engraving-toggle/index.tsx`              | **Delete**  | Absorbed into per-variant text inputs + EngravingFieldCaption         |

---

### Task 1: Verification Gate — Confirm Revalidation Chain

**Files:**

- No code changes — verification only

**Rationale:** Before building any sheet UI, confirm that `addToCart` → `revalidateTag` → router-refresh → `PageLayout` re-render → fresh `retrieveCart()` actually delivers updated cart data. If this chain is broken, the sheet will silently show stale data after add-to-cart.

- [ ] **Step 1: Add a temporary console.log to PageLayout**

In `apps/storefront/src/app/[countryCode]/(main)/layout.tsx`, add after the `retrieveCart()` call:

```tsx
const cart = await retrieveCart();
console.log(
  "[PageLayout] cart items:",
  cart?.items?.length ?? 0,
  "timestamp:",
  Date.now(),
);
```

- [ ] **Step 2: Start the dev server and open the storefront**

```bash
npm run storefront:dev
```

Navigate to a PDP and add an item to cart. Check the terminal for the log line — it should fire on the initial render AND again after the add completes (router-refresh). The second log should show the incremented item count.

- [ ] **Step 3: Add a temporary log to addToCart to confirm tag revalidation**

In `apps/storefront/src/lib/data/cart.ts`, inside `addToCart`, after `revalidateTag(cartCacheTag)`:

```ts
console.log("[addToCart] revalidated tag:", cartCacheTag);
```

- [ ] **Step 4: Verify the sequence in terminal output**

Expected order after clicking "Add to Cart":

1. `[addToCart] revalidated tag: carts-<id>`
2. `[PageLayout] cart items: N timestamp: <ts>` (router-refresh)

If step 2 happens but cart items didn't increase, the `force-cache` + `revalidateTag` interaction is broken — note this and plan to use the `refreshCart()` fallback in Task 2.

- [ ] **Step 5: Remove temporary logs**

Remove both `console.log` statements added in steps 1 and 3.

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: verify revalidation chain for cart sheet (verification gate)"
```

---

### Task 2: CartSheetProvider + useCartSheet Hook

**Files:**

- Create: `apps/storefront/src/modules/cart/components/cart-sheet-provider/index.tsx`

**Interfaces:**

- Produces: `CartSheetProvider({ children, initialCart }: { children: React.ReactNode; initialCart: HttpTypes.StoreCart | null })` — wraps layout children with context
- Produces: `useCartSheet(): { cart: StoreCart | null; isSheetOpen: boolean; openSheet: () => void; closeSheet: () => void; refreshCart: () => Promise<void> }` — consumed by CartButton, ProductActions, CartSheet

- [ ] **Step 1: Create CartSheetProvider component**

```tsx
"use client";

import { retrieveCart } from "@lib/data/cart";
import { HttpTypes } from "@medusajs/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type CartSheetContextValue = {
  cart: HttpTypes.StoreCart | null;
  isSheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  refreshCart: () => Promise<void>;
  partialFailureMessage: string | null;
  setPartialFailureMessage: (msg: string | null) => void;
};

const CartSheetContext = createContext<CartSheetContextValue | null>(null);

export function useCartSheet() {
  const ctx = useContext(CartSheetContext);
  if (!ctx)
    throw new Error("useCartSheet must be used within CartSheetProvider");
  return ctx;
}

export default function CartSheetProvider({
  children,
  initialCart,
}: {
  children: React.ReactNode;
  initialCart: HttpTypes.StoreCart | null;
}) {
  const [cart, setCart] = useState<HttpTypes.StoreCart | null>(initialCart);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [partialFailureMessage, setPartialFailureMessage] = useState<
    string | null
  >(null);

  // Sync when server re-renders with fresh data (router-refresh after server actions)
  useEffect(() => {
    setCart(initialCart);
  }, [initialCart]);

  const openSheet = useCallback(() => setIsSheetOpen(true), []);
  const closeSheet = useCallback(() => {
    setIsSheetOpen(false);
    setPartialFailureMessage(null); // clear on close
  }, []);

  const refreshCart = useCallback(async () => {
    try {
      const fresh = await retrieveCart();
      setCart(fresh);
    } catch {
      // cart fetch failed — keep current state
    }
  }, []);

  return (
    <CartSheetContext.Provider
      value={{
        cart,
        isSheetOpen,
        openSheet,
        closeSheet,
        refreshCart,
        partialFailureMessage,
        setPartialFailureMessage,
      }}
    >
      {children}
    </CartSheetContext.Provider>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep -i "cart-sheet-provider" || echo "No errors in CartSheetProvider"
```

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/src/modules/cart/components/cart-sheet-provider/index.tsx
git commit -m "feat: add CartSheetProvider context for shared cart-sheet state"
```

---

### Task 3: QuantityStepper Compact Mode

**Files:**

- Modify: `apps/storefront/src/modules/products/components/product-actions/quantity-stepper.tsx`

**Interfaces:**

- Consumes: existing `QuantityStepperProps`
- Produces: adds optional `compact?: boolean` — when true, buttons are `w-8 h-8` instead of `w-10 h-10`

- [ ] **Step 1: Add compact prop and conditional sizing**

Read the current file. Add `compact?: boolean` to the props type. Then change the button classes:

```tsx
type QuantityStepperProps = {
  quantity: number;
  onChange: (qty: number) => void;
  max: number | null;
  disabled: boolean;
  compact?: boolean;
  "data-testid"?: string;
};
```

The decrement button currently has `"flex items-center justify-center w-10 h-10 rounded-l-md ..."`. Change `w-10 h-10` to `{compact ? "w-8 h-8" : "w-10 h-10"}`. Same for the increment button's `w-10 h-10` → conditional. The display span's `w-12 h-10` → `{compact ? "w-10 h-8" : "w-12 h-10"}`.

- [ ] **Step 2: Verify default (non-compact) renders unchanged**

```bash
npm run storefront:dev
```

Navigate to a PDP and visually confirm the standalone QuantityStepper looks identical to before (it doesn't receive the `compact` prop from the current ProductActions, so it defaults to non-compact).

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/src/modules/products/components/product-actions/quantity-stepper.tsx
git commit -m "feat: add compact mode to QuantityStepper for inline variant cards"
```

---

### Task 4: VariantSwatchCard — Per-Variant Stepper + Engraving (Maps API)

**Files:**

- Modify: `apps/storefront/src/modules/products/components/product-actions/variant-swatch-card.tsx`

**Interfaces:**

- Consumes: existing `VariantSwatchCardProps` (option, variants, productImages, current, updateOption, title, disabled, data-testid)
- Produces: new optional multi-select props — `variantQuantities`, `onVariantQuantityChange`, `variantEngravingTexts`, `onVariantEngravingTextChange`, `variantMeta`
- Key design point: VariantSwatchCard renders a grid of option-value buttons internally (one per `option.values`). Each value maps to a variant via the existing `valueToVariant` map. For multi-select mode, the card receives variant-ID-keyed maps and looks up the variant for each value to find its quantity + engraving data. The stepper and engraving field render inside each option-value button.

- [ ] **Step 1: Add type and extend props**

Add `VariantMeta` type and extend `VariantSwatchCardProps`:

```tsx
type VariantMeta = {
  isEngravable: boolean;
  fee: number;
  threshold: number;
  inStock: boolean | null;
  maxQty: number | null;
};

type VariantSwatchCardProps = {
  option: HttpTypes.StoreProductOption;
  variants: HttpTypes.StoreProductVariant[];
  productImages: HttpTypes.StoreProductImage[] | null;
  current: string | undefined;
  updateOption: (optionId: string, value: string) => void;
  title: string;
  disabled: boolean;
  "data-testid"?: string;
  // Multi-select mode (all optional — when absent, card behaves as single-select):
  variantQuantities?: Record<string, number>; // variant_id → qty
  onVariantQuantityChange?: (variantId: string, qty: number) => void;
  variantEngravingTexts?: Record<string, string>; // variant_id → engraving text
  onVariantEngravingTextChange?: (variantId: string, text: string) => void;
  variantMeta?: Record<string, VariantMeta>; // variant_id → metadata
};
```

- [ ] **Step 2: Add inline stepper inside each option-value button**

After the label `<span>` (line ~137 in the current file, showing the option value name), add inside each value's button:

```tsx
{
  /* Inline stepper — rendered when multi-select props are provided */
}
{
  onVariantQuantityChange &&
    (() => {
      const variant = valueToVariant[value];
      const variantId = variant?.id;
      if (!variantId) return null;
      const qty = variantQuantities?.[variantId] ?? 0;
      const meta = variantMeta?.[variantId];
      return (
        <div className="w-full mt-1.5" onClick={(e) => e.stopPropagation()}>
          <QuantityStepper
            quantity={qty}
            onChange={(newQty) => onVariantQuantityChange(variantId, newQty)}
            max={meta?.maxQty ?? null}
            disabled={disabled || meta?.inStock === false}
            compact
            data-testid={`variant-stepper-${variantId}`}
          />
        </div>
      );
    })();
}
```

- [ ] **Step 3: Add conditional engraving field (qty > 0 AND engravable)**

After the stepper block, add:

```tsx
{
  /* Engraving field — shown when qty > 0 AND variant is engravable */
}
{
  onVariantEngravingTextChange &&
    (() => {
      const variant = valueToVariant[value];
      const variantId = variant?.id;
      if (!variantId) return null;
      const qty = variantQuantities?.[variantId] ?? 0;
      const meta = variantMeta?.[variantId];
      const isEngravable = meta?.isEngravable ?? false;
      if (qty === 0 || !isEngravable) return null;
      const text = variantEngravingTexts?.[variantId] ?? "";
      return (
        <div className="w-full mt-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={text}
            onChange={(e) =>
              onVariantEngravingTextChange(variantId, e.target.value)
            }
            placeholder="Engraving text..."
            className="w-full text-[11px] px-2 py-1 rounded border border-cosmos-hairline bg-cosmos-paper text-cosmos-charcoal placeholder:text-cosmos-graphite focus:outline-none focus:ring-1 focus:ring-cosmos-ink"
            data-testid={`engraving-input-${variantId}`}
          />
          {meta?.fee !== undefined && meta.fee > 0 && (
            <p className="text-[10px] text-cosmos-graphite mt-0.5">
              {new Intl.NumberFormat("en-PH", {
                style: "currency",
                currency: "PHP",
              }).format(meta.fee)}
              /unit
              {meta.threshold > 1 && <> — free at {meta.threshold}+ units</>}
            </p>
          )}
        </div>
      );
    })();
}
```

- [ ] **Step 4: Update selection logic**

Change `const selected = value === current` to conditionally check multi-select mode:

```tsx
const selected = onVariantQuantityChange
  ? (variantQuantities?.[valueToVariant[value]?.id ?? ""] ?? 0) > 0
  : value === current;
```

- [ ] **Step 5: Verify compilation**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep -i "variant-swatch-card" || echo "No errors"
```

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/modules/products/components/product-actions/variant-swatch-card.tsx
git commit -m "feat: add per-variant stepper and engraving to VariantSwatchCard via maps API"
```

---

### Task 5: EngravingFieldCaption Component

**Files:**

- Create: `apps/storefront/src/modules/products/components/engraving-field-caption/index.tsx`

**Interfaces:**

- Produces: `EngravingFieldCaption({ fee, threshold, currencyCode }: { fee: number; threshold: number; currencyCode: string })` — renders fee-messaging caption extracted from EngravingToggle

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { convertToLocale } from "@lib/util/money";
import { clx } from "@modules/common/components/ui";

type EngravingFieldCaptionProps = {
  fee: number;
  threshold: number;
  currencyCode: string;
};

export default function EngravingFieldCaption({
  fee,
  threshold,
  currencyCode,
}: EngravingFieldCaptionProps) {
  const hasFee = fee > 0;
  const hasThreshold = threshold > 1;
  const formattedFee = hasFee
    ? convertToLocale({ amount: fee, currency_code: currencyCode })
    : null;

  if (!hasFee && !hasThreshold) return null;

  return (
    <p
      className={clx(
        "text-xs px-2 py-1 rounded-md font-medium mt-1",
        hasFee && hasThreshold
          ? "bg-cosmos-vermilion/10 text-cosmos-vermilion-text"
          : "bg-cosmos-forest/10 text-cosmos-forest",
      )}
      data-testid="engraving-fee-message"
    >
      {hasFee && hasThreshold ? (
        <>
          <span className="font-semibold">{formattedFee}/unit</span> engraving
          fee —{" "}
          <span className="font-semibold">free at {threshold}+ units</span>
        </>
      ) : hasFee && !hasThreshold ? (
        <>
          <span className="font-semibold">{formattedFee}/unit</span> engraving
          fee applies
        </>
      ) : (
        <>
          <span className="font-semibold">Free engraving</span> included
        </>
      )}
    </p>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep -i "engraving-field-caption" || echo "No errors"
```

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/src/modules/products/components/engraving-field-caption/index.tsx
git commit -m "feat: extract EngravingFieldCaption from EngravingToggle for PDP engraving fields"
```

---

### Task 6: ProductActions Rewrite — Multi-Select + Per-Variant Engraving

**Files:**

- Rewrite: `apps/storefront/src/modules/products/components/product-actions/index.tsx`

**Interfaces:**

- Consumes: `useCartSheet().openSheet()`, `addToCart()`, `VariantSwatchCard` (extended with maps props from Task 4), `EngravingFieldCaption`
- Produces: same component signature — `ProductActions({ product, region, disabled })`
- State model: `quantities: Record<string, number>` (variant_id → qty), `engravingTexts: Record<string, string>` (variant_id → text), `useSameText: boolean`, `sharedEngravingText: string`

**Design:** ProductActions still renders option groups via `VariantSwatchCard` — the swatch card grid layout is preserved. But instead of single-select via `updateOption` + `selectedVariant`, it passes variant-ID-keyed quantity/engraving/metadata maps. Each VariantSwatchCard internally resolves option values → variant IDs and renders steppers/engraving fields per card. The "Add to Cart" button collects all qty>0 variants and fires `Promise.allSettled`.

- [ ] **Step 1: Read the current file**

Read `apps/storefront/src/modules/products/components/product-actions/index.tsx` fully to understand the current structure.

- [ ] **Step 2: Build variantMeta map (replaces scattered useMemo blocks)**

```tsx
const variantMeta = useMemo(() => {
  const map: Record<
    string,
    {
      isEngravable: boolean;
      fee: number;
      threshold: number;
      inStock: boolean | null;
      maxQty: number | null;
      price: number | null;
    }
  > = {};
  for (const v of product.variants ?? []) {
    if (!v.id) continue;
    const isEngravable =
      v.metadata?.is_engravable === true ||
      v.metadata?.is_engravable === "true";
    const fee = Number(v.metadata?.engraving_fee) || 0;
    const threshold = Number(v.metadata?.engraving_threshold) || 0;

    let inStock: boolean | null = null;
    let maxQty: number | null = null;
    if (!v.manage_inventory) {
      inStock = true;
      maxQty = null;
    } else if (v.allow_backorder) {
      inStock = true;
      maxQty = null;
    } else if ((v.inventory_quantity || 0) > 0) {
      inStock = true;
      maxQty = v.inventory_quantity ?? 0;
    } else {
      inStock = false;
      maxQty = 0;
    }

    map[v.id] = {
      isEngravable,
      fee,
      threshold,
      inStock,
      maxQty,
      price: v.calculated_price?.calculated_amount ?? null,
    };
  }
  return map;
}, [product.variants]);
```

- [ ] **Step 3: Add multi-variant state**

Replace the existing `options`, `quantity`, `isEngraved` state:

```tsx
const [quantities, setQuantities] = useState<Record<string, number>>({});
const [engravingTexts, setEngravingTexts] = useState<Record<string, string>>(
  {},
);
const [useSameText, setUseSameText] = useState(false);
const [sharedEngravingText, setSharedEngravingText] = useState("");
const [isAdding, setIsAdding] = useState(false);
```

- [ ] **Step 4: Add derived values**

```tsx
const selectedVariants = useMemo(() => {
  return (product.variants ?? []).filter((v) => (quantities[v.id!] ?? 0) > 0);
}, [product.variants, quantities]);

const engravableVariants = useMemo(() => {
  return selectedVariants.filter((v) => variantMeta[v.id!]?.isEngravable);
}, [selectedVariants, variantMeta]);

const showSharedToggle = engravableVariants.length >= 2;

const handleUseSameTextToggle = (checked: boolean) => {
  if (checked) {
    const firstNonEmpty = engravableVariants.find(
      (v) => (engravingTexts[v.id!] ?? "").trim() !== "",
    )?.id;
    setSharedEngravingText(
      firstNonEmpty ? (engravingTexts[firstNonEmpty] ?? "") : "",
    );
  }
  setUseSameText(checked);
};

// Button total with engraving threshold zeroing
const { totalItems, totalPrice } = useMemo(() => {
  let items = 0,
    price = 0;
  for (const v of selectedVariants) {
    const qty = quantities[v.id!] ?? 0;
    const meta = variantMeta[v.id!];
    if (!meta) continue;
    items += qty;
    const unitPrice = meta.price ?? 0;
    const text = useSameText
      ? sharedEngravingText
      : (engravingTexts[v.id!] ?? "");
    const hasText = text.trim().length > 0;
    // Fee is waived only when a real threshold is set AND met (threshold=0 means no free tier)
    const feeWaived =
      meta.isEngravable && meta.threshold > 0 && qty >= meta.threshold;
    const engravingFee =
      hasText && meta.isEngravable && !feeWaived ? meta.fee : 0;
    price += (unitPrice + engravingFee) * qty;
  }
  return { totalItems: items, totalPrice: price };
}, [
  selectedVariants,
  quantities,
  variantMeta,
  useSameText,
  sharedEngravingText,
  engravingTexts,
]);

const anyOutOfStock = selectedVariants.some(
  (v) => variantMeta[v.id!]?.inStock === false,
);
```

- [ ] **Step 5: Rewrite handleAddToCart with Promise.allSettled**

```tsx
const handleAddToCart = async () => {
  if (totalItems === 0) return;
  setIsAdding(true);

  const items = selectedVariants.map((v) => {
    const qty = quantities[v.id!] ?? 0;
    const text = useSameText
      ? sharedEngravingText
      : (engravingTexts[v.id!] ?? "");
    const hasText = text.trim().length > 0;
    const meta = variantMeta[v.id!];
    return {
      variantId: v.id!,
      quantity: qty,
      metadata:
        hasText && meta?.isEngravable
          ? { engraved: true, engraved_text: text }
          : undefined,
    };
  });

  const results = await Promise.allSettled(
    items.map((item) => addToCart({ ...item, countryCode })),
  );

  const succeeded: string[] = [],
    failed: string[] = [];
  results.forEach((r, i) => {
    const label =
      selectedVariants[i]?.title ?? selectedVariants[i]?.id ?? "item";
    if (r.status === "fulfilled") succeeded.push(label);
    else failed.push(label);
  });

  setIsAdding(false);
  openSheet();

  if (failed.length > 0 && succeeded.length > 0) {
    setPartialFailureMessage(
      `${succeeded.map((s) => s + " added").join(", ")}. ${failed.map((f) => f + " couldn't be added").join(", ")}.`,
    );
  }

  // Reset
  setQuantities({});
  setEngravingTexts({});
  setUseSameText(false);
  setSharedEngravingText("");
};
```

- [ ] **Step 6: Rewrite the JSX — pass maps to VariantSwatchCard, remove single-select logic**

Remove: `options` state, `setOptionValue`, `isValidVariant`, `selectedVariant`, the URL-search-params effect, the standalone `QuantityStepper`, `EngravingToggle`, and the per-variant-row rendering that was in the earlier (now-corrected) plan.

The option groups still render through VariantSwatchCard:

```tsx
{
  (product.options || []).map((option) => (
    <div key={option.id}>
      <VariantSwatchCard
        option={option}
        variants={product.variants ?? []}
        productImages={product.images ?? null}
        current={undefined} // selection is now stepper-driven, not click-driven
        updateOption={() => {}} // no-op in multi-select mode
        title={option.title ?? ""}
        data-testid="product-options"
        disabled={!!disabled || isAdding}
        // Multi-select props:
        variantQuantities={quantities}
        onVariantQuantityChange={(variantId, qty) =>
          setQuantities((prev) => ({ ...prev, [variantId]: qty }))
        }
        variantEngravingTexts={
          useSameText
            ? Object.fromEntries(
                engravableVariants.map((v) => [v.id!, sharedEngravingText]),
              )
            : engravingTexts
        }
        onVariantEngravingTextChange={(variantId, text) => {
          if (useSameText) {
            setSharedEngravingText(text);
            setEngravingTexts((prev) => {
              const next = { ...prev };
              for (const ev of engravableVariants) next[ev.id!] = text;
              return next;
            });
          } else {
            setEngravingTexts((prev) => ({ ...prev, [variantId]: text }));
          }
        }}
        variantMeta={variantMeta}
      />
    </div>
  ));
}
```

Below the option groups, add the shared-text toggle (conditional) and the button:

```tsx
{showSharedToggle && (
  <label className="flex items-center gap-x-2 cursor-pointer mt-2">
    <input
      type="checkbox"
      checked={useSameText}
      onChange={(e) => handleUseSameTextToggle(e.target.checked)}
      className="w-4 h-4 rounded border-cosmos-hairline text-cosmos-vermilion focus:ring-cosmos-ink"
      data-testid="use-same-text-checkbox"
    />
    <span className="text-sm text-cosmos-charcoal">
      Use the same text for all variants
    </span>
  </label>
)}

<ProductPrice product={product} variant={undefined} />

<Button
  onClick={handleAddToCart}
  disabled={totalItems === 0 || anyOutOfStock || !!disabled || isAdding}
  variant="primary"
  className="w-full h-10 bg-cosmos-ink hover:bg-cosmos-charcoal text-white"
  isLoading={isAdding}
  data-testid="add-product-button"
>
  {totalItems === 0
    ? anyOutOfStock ? "Out of stock" : "Select variants"
    : `Add ${totalItems} item${totalItems > 1 ? "s" : ""} to cart — ${formattedTotal}`}
</Button>
```

- [ ] **Step 7: Remove unused imports**

Remove imports that are no longer needed: `EngravingToggle`, the standalone `QuantityStepper` import (it's now only used inside VariantSwatchCard), `isEqual` from lodash, `useSearchParams`, `usePathname`, `useRouter` (if only used for URL search params).

Add new imports: `useCartSheet` from `@modules/cart/components/cart-sheet-provider`.

- [ ] **Step 8: Verify TypeScript compilation**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | head -30
```

Fix any type errors before proceeding.

- [ ] **Step 9: Visual verification with Playwright**

Start the dev server. Navigate to a PDP with multiple variants. Screenshot showing per-variant steppers inside the swatch card grid (not as separate rows) and the "Add N items" button.

- [ ] **Step 10: Commit**

```bash
git add apps/storefront/src/modules/products/components/product-actions/index.tsx
git commit -m "feat: rewrite ProductActions for multi-variant selection via VariantSwatchCard steppers"
```

---

### Task 7: CartSheet Slide-Over Component

**Files:**

- Create: `apps/storefront/src/modules/cart/components/cart-sheet/index.tsx`
- Create: `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-item.tsx`
- Create: `apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-recommended.tsx`

**Interfaces:**

- Consumes: `useCartSheet()` for `cart`, `isSheetOpen`, `closeSheet`
- Produces: `CartSheet()` — full slide-over component, self-contained

- [ ] **Step 1: Create CartSheetItem sub-component**

`apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-item.tsx`:

```tsx
"use client";

import { deleteLineItem, updateLineItem } from "@lib/data/cart";
import { convertToLocale } from "@lib/util/money";
import { HttpTypes } from "@medusajs/types";
import QuantityStepper from "@modules/products/components/product-actions/quantity-stepper";
import LocalizedClientLink from "@modules/common/components/localized-client-link";
import { useState } from "react";

type CartSheetItemProps = {
  item: HttpTypes.StoreCartLineItem;
  currencyCode: string;
};

export default function CartSheetItem({
  item,
  currencyCode,
}: CartSheetItemProps) {
  const [updating, setUpdating] = useState(false);
  const [engravingText, setEngravingText] = useState(
    (item.metadata?.engraved_text as string) ?? "",
  );
  const isEngraved =
    item.metadata?.engraved === true || item.metadata?.engraved === "true";

  const handleQuantityChange = async (quantity: number) => {
    setUpdating(true);
    try {
      await updateLineItem({ lineId: item.id, quantity });
    } finally {
      setUpdating(false);
    }
  };

  const handleEngravingChange = async (text: string) => {
    setEngravingText(text);
    await updateLineItem({
      lineId: item.id,
      quantity: item.quantity,
      metadata: { ...item.metadata, engraved_text: text },
    });
  };

  const handleRemove = async () => {
    setUpdating(true);
    try {
      await deleteLineItem(item.id);
    } finally {
      setUpdating(false);
    }
  };

  const maxQty =
    item.variant?.manage_inventory && !item.variant?.allow_backorder
      ? (item.variant?.inventory_quantity ?? 0) + item.quantity
      : null;

  const title = item.product_title ?? item.title ?? "Item";
  const variantLabel = item.variant?.title ?? "";
  const thumbnail = item.thumbnail ?? item.variant?.images?.[0]?.url;

  return (
    <div
      className="flex gap-x-3 py-3 border-b border-cosmos-hairline"
      data-testid="cart-sheet-item"
    >
      {/* Thumbnail */}
      <div className="w-16 h-16 flex-shrink-0 rounded-md overflow-hidden bg-cosmos-washi">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-cosmos-graphite text-xs">
            No image
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <LocalizedClientLink
          href={`/products/${item.product_handle}`}
          className="text-sm font-medium text-cosmos-charcoal hover:text-cosmos-ink truncate block"
        >
          {title}
        </LocalizedClientLink>
        {variantLabel && variantLabel !== title && (
          <p className="text-xs text-cosmos-graphite truncate">
            {variantLabel}
          </p>
        )}

        {/* Unit price */}
        {item.unit_price && (
          <p className="text-xs text-cosmos-graphite mt-0.5">
            {convertToLocale({
              amount: item.unit_price,
              currency_code: currencyCode,
            })}{" "}
            each
          </p>
        )}

        {/* Quantity stepper */}
        <div className="mt-2">
          <QuantityStepper
            quantity={item.quantity}
            onChange={handleQuantityChange}
            max={maxQty}
            disabled={updating}
            compact
            data-testid={`cart-sheet-stepper-${item.id}`}
          />
        </div>

        {/* Engraving text (editable if engraved) */}
        {isEngraved && (
          <div className="mt-2">
            <input
              type="text"
              value={engravingText}
              onChange={(e) => handleEngravingChange(e.target.value)}
              placeholder="Engraving text..."
              className="w-full text-xs px-2 py-1 rounded border border-cosmos-hairline bg-cosmos-paper text-cosmos-charcoal focus:outline-none focus:ring-1 focus:ring-cosmos-ink"
              data-testid={`cart-sheet-engraving-${item.id}`}
            />
          </div>
        )}
      </div>

      {/* Line total + remove */}
      <div className="flex flex-col items-end justify-between flex-shrink-0">
        <p className="text-sm font-semibold text-cosmos-charcoal tabular-nums">
          {item.total
            ? convertToLocale({
                amount: item.total,
                currency_code: currencyCode,
              })
            : ""}
        </p>
        <button
          onClick={handleRemove}
          disabled={updating}
          className="text-xs text-cosmos-graphite hover:text-cosmos-vermilion transition-colors disabled:opacity-50"
          data-testid={`cart-sheet-remove-${item.id}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CartSheetRecommended sub-component**

`apps/storefront/src/modules/cart/components/cart-sheet/cart-sheet-recommended.tsx`:

```tsx
"use client";

import { listProducts } from "@lib/data/products";
import { HttpTypes } from "@medusajs/types";
import LocalizedClientLink from "@modules/common/components/localized-client-link";
import { useEffect, useState } from "react";

type CartSheetRecommendedProps = {
  cart: HttpTypes.StoreCart | null;
  countryCode: string;
};

export default function CartSheetRecommended({
  cart,
  countryCode,
}: CartSheetRecommendedProps) {
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>([]);

  useEffect(() => {
    if (!cart?.items?.length) {
      setProducts([]);
      return;
    }

    const fetchRecommended = async () => {
      try {
        // Extract unique category IDs from cart items
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

        if (categoryIds.length === 0) {
          setProducts([]);
          return;
        }

        // Server-side filter by category
        let { response } = await listProducts({
          countryCode,
          queryParams: {
            category_id: categoryIds,
            limit: 20,
            fields: "*variants,*images",
          },
        });

        // Client-side: exclude items already in cart, cap at 4
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

  if (products.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-cosmos-hairline">
      <p className="text-xs font-semibold text-cosmos-graphite uppercase tracking-wide mb-3">
        You might also like
      </p>
      <div className="grid grid-cols-2 gap-3">
        {products.map((product) => (
          <LocalizedClientLink
            key={product.id}
            href={`/products/${product.handle}`}
            className="group"
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
                    product.variants[0].calculated_price.currency_code ?? "PHP",
                }).format(
                  product.variants[0].calculated_price.calculated_amount,
                )}
              </p>
            )}
          </LocalizedClientLink>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the CartSheet shell**

`apps/storefront/src/modules/cart/components/cart-sheet/index.tsx`:

```tsx
"use client";

import { Dialog, Transition } from "@headlessui/react";
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider";
import { convertToLocale } from "@lib/util/money";
import LocalizedClientLink from "@modules/common/components/localized-client-link";
import { useParams } from "next/navigation";
import { Fragment, useState } from "react";
import CartSheetItem from "./cart-sheet-item";
import CartSheetRecommended from "./cart-sheet-recommended";

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

  // Reset T&C on every close
  const handleClose = () => {
    setTermsChecked(false);
    closeSheet();
  };

  const currencyCode = cart?.region?.currency_code?.toUpperCase() ?? "PHP";
  const itemCount = cart?.items?.length ?? 0;
  const subtotal = cart?.subtotal ?? 0;

  return (
    <Transition show={isSheetOpen} as={Fragment}>
      <Dialog onClose={handleClose} className="relative z-50">
        {/* Backdrop */}
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

        {/* Panel */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="translate-x-full"
          enterTo="translate-x-0"
          leave="ease-in duration-200"
          leaveFrom="translate-x-0"
          leaveTo="translate-x-full"
        >
          <Dialog.Panel className="fixed right-0 top-0 h-full w-full max-w-md bg-cosmos-paper shadow-xl flex flex-col">
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

                  {/* Recommended products */}
                  <CartSheetRecommended cart={cart} countryCode={countryCode} />
                </>
              )}
            </div>

            {/* Footer — sticky */}
            {cart && itemCount > 0 && (
              <div className="border-t border-cosmos-hairline px-4 py-4 bg-cosmos-paper">
                {/* Subtotal */}
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-cosmos-graphite">Subtotal</span>
                  <span className="text-sm font-semibold text-cosmos-charcoal tabular-nums">
                    {convertToLocale({
                      amount: subtotal,
                      currency_code: currencyCode,
                    })}
                  </span>
                </div>

                {/* T&C checkbox */}
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

                {/* Checkout button */}
                <LocalizedClientLink
                  href={`/${countryCode}/checkout?step=delivery`}
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

                {/* View full cart link */}
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

- [ ] **Step 4: Verify TypeScript compilation**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep -E "cart-sheet|cache|error TS" | head -30
```

Fix any type errors. Common issues: `listProducts` signature, `HttpTypes.StoreProduct.categories` typing, `product_handle` type.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/modules/cart/components/cart-sheet/
git commit -m "feat: add CartSheet slide-over with line items, T&C gate, and recommended products"
```

---

### Task 8: Wire CartSheetProvider into Layout + CartButton

**Files:**

- Modify: `apps/storefront/src/app/[countryCode]/(main)/layout.tsx`
- Rewrite: `apps/storefront/src/modules/layout/components/cart-button/index.tsx`

**Interfaces:**

- Consumes: `CartSheetProvider`, `useCartSheet`
- Produces: Layout wraps children in provider; CartButton opens sheet

- [ ] **Step 1: Wrap PageLayout children in CartSheetProvider**

In `apps/storefront/src/app/[countryCode]/(main)/layout.tsx`:

Add import:

```tsx
import CartSheetProvider from "@modules/cart/components/cart-sheet-provider";
import CartSheet from "@modules/cart/components/cart-sheet";
```

Wrap the return value:

```tsx
return (
  <CartSheetProvider initialCart={cart}>
    <div className="bg-cosmos-paper min-h-screen">
      <Nav />
      {customer && cart && (
        <CartMismatchBanner customer={customer} cart={cart} />
      )}
      {cart && (
        <FreeShippingPriceNudge
          variant="popup"
          cart={cart}
          shippingOptions={shippingOptions}
        />
      )}
      {props.children}
      <Footer />
    </div>
    <CartSheet />
  </CartSheetProvider>
);
```

- [ ] **Step 2: Rewrite CartButton**

Rewrite `apps/storefront/src/modules/layout/components/cart-button/index.tsx`:

```tsx
"use client";

import { useCartSheet } from "@modules/cart/components/cart-sheet-provider";

export default function CartButton() {
  const { cart, openSheet } = useCartSheet();
  const itemCount = cart?.items?.length ?? 0;

  return (
    <button
      onClick={openSheet}
      className="relative p-2 text-cosmos-charcoal hover:text-cosmos-ink transition-colors"
      aria-label={`Cart (${itemCount} items)`}
      data-testid="nav-cart-button"
    >
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
        />
      </svg>
      {itemCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 w-5 h-5 flex items-center justify-center bg-cosmos-vermilion text-white text-[11px] font-bold rounded-full"
          data-testid="cart-item-count"
        >
          {itemCount}
        </span>
      )}
    </button>
  );
}
```

Note: CartButton becomes a `"use client"` component. It no longer imports `retrieveCart` or `CartDropdown`.

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 4: Playwright screenshot — nav cart icon and empty sheet**

Start the dev server, open Playwright, navigate to the storefront. Click the nav cart icon — the empty cart sheet should open. Screenshot it.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/app/[countryCode]/(main)/layout.tsx apps/storefront/src/modules/layout/components/cart-button/index.tsx
git commit -m "feat: wire CartSheetProvider into layout, rewrite CartButton to open sheet"
```

---

### Task 9: Update Cart Summary — Engraving Validation

**Files:**

- Modify: `apps/storefront/src/modules/cart/templates/summary.tsx`

**Rationale:** The cart summary currently checks for engraved items missing text (`metadata.engraved === true && !metadata.engraved_text`). Since text is now entered on the PDP before add-to-cart, this check should still work as-is — items added from the PDP will have `engraved_text` populated. But the user could also add engraving in the sheet by editing the text field, which calls `updateLineItem` with the new text. The validation logic is still correct, but verify it and add a note.

- [ ] **Step 1: Read the current summary.tsx engraving validation**

Read lines 25–50 of `apps/storefront/src/modules/cart/templates/summary.tsx` to understand the current validation logic.

- [ ] **Step 2: Confirm the validation still works or update it**

The current logic:

```tsx
const hasEngravingWithoutText = cart.items?.some(
  (item) =>
    (item.metadata?.engraved === true || item.metadata?.engraved === "true") &&
    !(item.metadata?.engraved_text as string)?.trim(),
);
```

This should continue working — items with `engraved: true` but no `engraved_text` are blocked from checkout. No code change needed, but verify during end-to-end testing (Task 11).

- [ ] **Step 3: Commit (or skip if no changes needed)**

```bash
# If no code changes:
echo "Cart summary engraving validation confirmed — no changes needed"
```

---

### Task 10: Delete CartDropdown and EngravingToggle

**Files:**

- Delete: `apps/storefront/src/modules/layout/components/cart-dropdown/index.tsx`
- Delete: `apps/storefront/src/modules/products/components/engraving-toggle/index.tsx`

**Verification:** Grep for remaining imports before deleting.

- [ ] **Step 1: Confirm no remaining imports of CartDropdown**

```bash
grep -r "CartDropdown\|cart-dropdown" apps/storefront/src --include="*.tsx" --include="*.ts" | grep -v "cart-dropdown/index.tsx"
```

Expected: zero results (only the file itself matches).

- [ ] **Step 2: Confirm no remaining imports of EngravingToggle**

```bash
grep -r "EngravingToggle\|engraving-toggle" apps/storefront/src --include="*.tsx" --include="*.ts" | grep -v "engraving-toggle/index.tsx"
```

Expected: zero results.

- [ ] **Step 3: Delete the files**

```bash
rm apps/storefront/src/modules/layout/components/cart-dropdown/index.tsx
rm apps/storefront/src/modules/products/components/engraving-toggle/index.tsx
# Remove empty directories if they contain no other files
rmdir apps/storefront/src/modules/layout/components/cart-dropdown 2>/dev/null
rmdir apps/storefront/src/modules/products/components/engraving-toggle 2>/dev/null
```

- [ ] **Step 4: Verify build still passes**

```bash
cd apps/storefront && npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -10
```

- [ ] **Step 5: Commit**

```bash
git add -A apps/storefront/src/modules/layout/components/cart-dropdown/ apps/storefront/src/modules/products/components/engraving-toggle/
git commit -m "chore: delete CartDropdown and EngravingToggle (replaced by CartSheet and per-variant engraving fields)"
```

---

### Task 11: End-to-End Verification — Playwright Screenshots

**Files:**

- No code changes — visual verification only

**Acceptance criteria from handoff §9:**

- [ ] **Step 1: Multi-variant add-to-cart**

Navigate to a PDP with multiple variants (e.g., the stationery product). Set qty=2 on Silky Lavender, qty=3 on White. Click "Add 5 items to cart." Open the sheet. Screenshot the sheet showing both line items.

Expected: Two separate cart line items, one click.

- [ ] **Step 2: Engraving text survives into cart**

Navigate to a PDP with an engravable variant. Set qty=1, type engraving text in the field, add to cart. In the cart sheet, verify the engraving text is displayed on the line item. Screenshot it.

Expected: Engraving text entered on PDP appears in cart line item.

- [ ] **Step 3: Ineligible variants show no engraving field**

Navigate to a PDP with both engravable and non-engravable variants. Set qty=1 on each. Verify only the engravable variant shows a text input. Screenshot.

Expected: Non-engravable variant has no engraving field.

- [ ] **Step 4: Cart sheet auto-opens on add-to-cart**

Add any item to cart. Verify the cart sheet automatically opens. Screenshot.

- [ ] **Step 5: Cart sheet opens from nav icon**

Close the sheet. Click the cart icon in the nav. Verify the sheet opens. Screenshot.

- [ ] **Step 6: /cart page still works independently**

Navigate to /cart. Verify the dedicated cart page loads with the same items. Screenshot.

- [ ] **Step 7: Checkout button disabled until T&C checked**

Open the cart sheet with items. Verify the "Proceed to Checkout" button is disabled until the T&C checkbox is checked. Screenshot both states.

- [ ] **Step 8: Recommended products in sheet**

Add items that share a category with other products. Open the sheet. Verify recommended products appear (≤4, excluding cart items). Screenshot.

- [ ] **Step 9: "Use same text for all" behavior**

PDP with 2+ engravable variants. Set qty>0 on both. Type individual text in each field. Check "Use same text for all." Verify individual fields collapse to one shared field. Type in shared field. Uncheck. Verify individual fields revert to their original text. Screenshot key states.

- [ ] **Step 10: Partial failure messaging**

Simulate a failure (or verify the happy path produces no false errors). Note behavior in report.

- [ ] **Step 11: Submit report**

Write a report section including:

- All screenshots from steps 1–9
- Any bugs found and fixed during verification
- Updated Graphify stats (re-run `graphify update .`)
- Agent-memory entry filename/summary

````

- [ ] **Step 12: Final commit**

```bash
git add -A
git commit -m "docs: add end-to-end verification report with Playwright screenshots"
````

---

## Verification Summary Checklist

| Acceptance Criterion                                     | Verification Step | Method                                                        |
| -------------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| 2× Silky Lavender + 3× White = two line items, one click | Step 1            | Screenshot                                                    |
| Engraving text from PDP survives into cart line item     | Step 2            | Screenshot + DOM check `data-testid="cart-sheet-engraving-*"` |
| Ineligible variants show no engraving field              | Step 3            | Screenshot                                                    |
| Cart sheet auto-opens on add-to-cart                     | Step 4            | Screenshot                                                    |
| Cart sheet opens from nav icon                           | Step 5            | Screenshot                                                    |
| /cart page still works independently                     | Step 6            | Screenshot                                                    |
| Checkout button disabled until T&C checked               | Step 7            | Screenshot (both states)                                      |
| Recommended products ≤4, exclude cart items              | Step 8            | Screenshot                                                    |
| "Use same text for all" toggle behavior                  | Step 9            | Screenshot                                                    |
| Partial failure messaging                                | Step 10           | Report note                                                   |
