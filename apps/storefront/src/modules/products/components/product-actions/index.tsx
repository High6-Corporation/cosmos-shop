"use client"

import { addToCart } from "@lib/data/cart"
import { useIntersection } from "@lib/hooks/use-in-view"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import Divider from "@modules/common/components/divider"
import VariantSwatchCard from "@modules/products/components/product-actions/variant-swatch-card"
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider"
import { useParams } from "next/navigation"
import { useMemo, useRef, useState } from "react"
import ProductPrice from "../product-price"
import MobileActions from "./mobile-actions"

type ProductActionsProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
}

export default function ProductActions({
  product,
  region,
  disabled,
}: ProductActionsProps) {
  const { openSheet, setPartialFailureMessage } = useCartSheet()
  const countryCode = useParams().countryCode as string

  // Multi-variant state
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [engravingTexts, setEngravingTexts] = useState<Record<string, string>>(
    {},
  )
  const [useSameText, setUseSameText] = useState(false)
  const [sharedEngravingText, setSharedEngravingText] = useState("")
  const [isAdding, setIsAdding] = useState(false)

  // Per-variant metadata lookup — centralizes inventory + engraving logic
  const variantMeta = useMemo(() => {
    const map: Record<
      string,
      {
        isEngravable: boolean
        fee: number
        threshold: number
        inStock: boolean | null
        maxQty: number | null
        price: number | null
      }
    > = {}
    for (const v of product.variants ?? []) {
      if (!v.id) continue
      const isEngravable =
        v.metadata?.is_engravable === true ||
        v.metadata?.is_engravable === "true"
      const fee = Number(v.metadata?.engraving_fee) || 0
      const threshold = Number(v.metadata?.engraving_threshold) || 0

      let inStock: boolean | null = null
      let maxQty: number | null = null
      if (!v.manage_inventory) {
        inStock = true
        maxQty = null
      } else if (v.allow_backorder) {
        inStock = true
        maxQty = null
      } else if ((v.inventory_quantity || 0) > 0) {
        inStock = true
        maxQty = v.inventory_quantity ?? 0
      } else {
        inStock = false
        maxQty = 0
      }

      map[v.id] = {
        isEngravable,
        fee,
        threshold,
        inStock,
        maxQty,
        price: v.calculated_price?.calculated_amount ?? null,
      }
    }
    return map
  }, [product.variants])

  // Selected (qty > 0) variants
  const selectedVariants = useMemo(() => {
    return (product.variants ?? []).filter(
      (v) => (quantities[v.id!] ?? 0) > 0,
    )
  }, [product.variants, quantities])

  // Engravable selected variants
  const engravableVariants = useMemo(() => {
    return selectedVariants.filter((v) => variantMeta[v.id!]?.isEngravable)
  }, [selectedVariants, variantMeta])

  const showSharedToggle = engravableVariants.length >= 2

  // Handle "use same text" toggle
  const handleUseSameTextToggle = (checked: boolean) => {
    if (checked) {
      // Initialize shared from first non-empty individual text
      const firstNonEmpty = engravableVariants.find(
        (v) => (engravingTexts[v.id!] ?? "").trim() !== "",
      )?.id
      setSharedEngravingText(
        firstNonEmpty ? (engravingTexts[firstNonEmpty] ?? "") : "",
      )
    }
    setUseSameText(checked)
  }

  // Button total with engraving threshold zeroing
  const { totalItems, totalPrice } = useMemo(() => {
    let items = 0
    let price = 0
    for (const v of selectedVariants) {
      const qty = quantities[v.id!] ?? 0
      const meta = variantMeta[v.id!]
      if (!meta) continue
      items += qty
      const unitPrice = meta.price ?? 0
      const text = useSameText
        ? sharedEngravingText
        : (engravingTexts[v.id!] ?? "")
      const hasText = text.trim().length > 0
      // Fee is waived only when a real threshold is set AND met (threshold=0 means no free tier)
      const feeWaived =
        meta.isEngravable && meta.threshold > 0 && qty >= meta.threshold
      const engravingFee =
        hasText && meta.isEngravable && !feeWaived ? meta.fee : 0
      price += (unitPrice + engravingFee) * qty
    }
    return { totalItems: items, totalPrice: price }
  }, [
    selectedVariants,
    quantities,
    variantMeta,
    useSameText,
    sharedEngravingText,
    engravingTexts,
  ])

  const currencyCode = region?.currency_code ?? "PHP"
  const formattedTotal = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: currencyCode,
  }).format(totalPrice)

  const anyOutOfStock = selectedVariants.some(
    (v) => variantMeta[v.id!]?.inStock === false,
  )

  const handleAddToCart = async () => {
    if (totalItems === 0) return
    setIsAdding(true)

    const items = selectedVariants.map((v) => {
      const qty = quantities[v.id!] ?? 0
      const text = useSameText
        ? sharedEngravingText
        : (engravingTexts[v.id!] ?? "")
      const hasText = text.trim().length > 0
      const meta = variantMeta[v.id!]
      return {
        variantId: v.id!,
        quantity: qty,
        metadata:
          hasText && meta?.isEngravable
            ? { engraved: true, engraved_text: text }
            : undefined,
      }
    })

    const results = await Promise.allSettled(
      items.map((item) => addToCart({ ...item, countryCode })),
    )

    const succeeded: string[] = []
    const failed: string[] = []
    results.forEach((r, i) => {
      const label =
        selectedVariants[i]?.title ?? selectedVariants[i]?.id ?? "item"
      if (r.status === "fulfilled") succeeded.push(label)
      else failed.push(label)
    })

    setIsAdding(false)
    openSheet()

    if (failed.length > 0 && succeeded.length > 0) {
      setPartialFailureMessage(
        `${succeeded.map((s) => s + " added").join(", ")}. ${failed.map((f) => f + " couldn't be added").join(", ")}.`,
      )
    } else if (failed.length > 0 && succeeded.length === 0) {
      setPartialFailureMessage(
        `Couldn't add items: ${failed.join(", ")}. Please try again.`,
      )
    }

    // Reset state after add
    setQuantities({})
    setEngravingTexts({})
    setUseSameText(false)
    setSharedEngravingText("")
  }

  const actionsRef = useRef<HTMLDivElement>(null)
  const inView = useIntersection(actionsRef, "0px")

  return (
    <>
      <div className="flex flex-col gap-y-4" ref={actionsRef}>
        <div>
          {(product.variants?.length ?? 0) > 1 && (
            <div className="flex flex-col gap-y-5">
              {(product.options || []).map((option) => {
                return (
                  <div key={option.id}>
                    <VariantSwatchCard
                      option={option}
                      variants={product.variants ?? []}
                      productImages={product.images ?? null}
                      current={undefined}
                      updateOption={() => {}} // no-op in multi-select mode
                      title={option.title ?? ""}
                      data-testid="product-options"
                      disabled={!!disabled || isAdding}
                      // Multi-select props:
                      variantQuantities={quantities}
                      onVariantQuantityChange={(variantId, qty) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [variantId]: qty,
                        }))
                      }
                      variantEngravingTexts={
                        useSameText
                          ? Object.fromEntries(
                              engravableVariants.map((v) => [
                                v.id!,
                                sharedEngravingText,
                              ]),
                            )
                          : engravingTexts
                      }
                      onVariantEngravingTextChange={(variantId, text) => {
                        if (useSameText) {
                          setSharedEngravingText(text)
                          setEngravingTexts((prev) => {
                            const next = { ...prev }
                            for (const ev of engravableVariants)
                              next[ev.id!] = text
                            return next
                          })
                        } else {
                          setEngravingTexts((prev) => ({
                            ...prev,
                            [variantId]: text,
                          }))
                        }
                      }}
                      variantMeta={variantMeta}
                    />
                  </div>
                )
              })}
              <Divider />
            </div>
          )}
        </div>

        {/* "Use same text for all" toggle */}
        {showSharedToggle && (
          <label className="flex items-center gap-x-2 cursor-pointer">
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
          disabled={
            totalItems === 0 || anyOutOfStock || !!disabled || isAdding
          }
          variant="primary"
          className="w-full h-10 bg-cosmos-ink hover:bg-cosmos-charcoal text-white"
          isLoading={isAdding}
          data-testid="add-product-button"
        >
          {totalItems === 0
            ? anyOutOfStock
              ? "Out of stock"
              : "Select variants"
            : `Add ${totalItems} item${totalItems > 1 ? "s" : ""} to cart — ${formattedTotal}`}
        </Button>

        <MobileActions
          product={product}
          variant={selectedVariants[0] ?? null}
          options={{}}
          updateOptions={() => {}}
          inStock={!anyOutOfStock}
          handleAddToCart={handleAddToCart}
          isAdding={isAdding}
          show={!inView}
          optionsDisabled={!!disabled || isAdding}
        />
      </div>
    </>
  )
}
