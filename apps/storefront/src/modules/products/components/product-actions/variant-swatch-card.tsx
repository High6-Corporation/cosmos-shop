"use client"

import { HttpTypes } from "@medusajs/types"
import { clx } from "@modules/common/components/ui"
import Image from "next/image"
import React from "react"
import QuantityStepper from "./quantity-stepper"

type VariantMeta = {
  isEngravable: boolean
  fee: number
  threshold: number
  inStock: boolean | null
  maxQty: number | null
}

type VariantSwatchCardProps = {
  option: HttpTypes.StoreProductOption
  variants: HttpTypes.StoreProductVariant[]
  productImages: HttpTypes.StoreProductImage[] | null
  current: string | undefined
  updateOption: (optionId: string, value: string) => void
  title: string
  disabled: boolean
  "data-testid"?: string
  // Multi-select mode (all optional — when absent, card behaves as single-select):
  variantQuantities?: Record<string, number> // variant_id → qty
  onVariantQuantityChange?: (variantId: string, qty: number) => void
  variantEngravingTexts?: Record<string, string> // variant_id → engraving text
  onVariantEngravingTextChange?: (variantId: string, text: string) => void
  variantMeta?: Record<string, VariantMeta> // variant_id → metadata
}

/**
 * VariantSwatchCard — image-backed variant selector replacing the plain
 * text-button OptionSelect from the Medusa default.
 *
 * Fallback tiers for each option value:
 *   1. First matching variant's first image (variant.images[0])
 *   2. First product image (product.images[0])
 *   3. Styled text label showing the option value name
 *
 * Out-of-stock variants show dimmed with an "Out of stock" badge.
 */
const VariantSwatchCard: React.FC<VariantSwatchCardProps> = ({
  option,
  variants,
  productImages,
  current,
  updateOption,
  title,
  "data-testid": dataTestId,
  disabled,
  variantQuantities,
  onVariantQuantityChange,
  variantEngravingTexts,
  onVariantEngravingTextChange,
  variantMeta,
}) => {
  // Build a map: option_value → first matching variant
  const valueToVariant = React.useMemo(() => {
    const map: Record<string, HttpTypes.StoreProductVariant | undefined> = {}
    for (const v of variants) {
      const opt = v.options?.find((o) => o.option_id === option.id)
      if (opt?.value && !(opt.value in map)) {
        map[opt.value] = v
      }
    }
    return map
  }, [variants, option.id])

  /**
   * Resolve the best image for a given option value:
   *   1. Matching variant's first image
   *   2. First product image
   *   3. null → renders text-only fallback card
   */
  const resolveImage = (value: string): string | null => {
    const variant = valueToVariant[value]
    if (variant?.images?.length) {
      return variant.images[0].url ?? null
    }
    if (productImages?.length) {
      return productImages[0].url ?? null
    }
    return null
  }

  /**
   * Determine if a variant for this option value is in stock.
   * If no matching variant is found, assume in stock (degenerate case).
   */
  const isInStock = (value: string): boolean => {
    const variant = valueToVariant[value]
    if (!variant) return true
    if (!variant.manage_inventory) return true
    if (variant.allow_backorder) return true
    return (variant.inventory_quantity ?? 0) > 0
  }

  const filteredOptions = (option.values ?? []).map((v) => v.value)

  return (
    <div className="flex flex-col gap-y-3">
      <span className="text-sm font-medium text-cosmos-charcoal">{title}</span>
      <div
        className="grid grid-cols-2 small:grid-cols-3 gap-3"
        data-testid={dataTestId}
      >
        {filteredOptions.map((value) => {
          const imageUrl = resolveImage(value)
          const inStock = isInStock(value)
          // Selection: in multi-select mode, qty > 0. In single-select, current match.
          const selected = onVariantQuantityChange
            ? (variantQuantities?.[valueToVariant[value]?.id ?? ""] ?? 0) > 0
            : value === current

          const isMultiSelect = !!onVariantQuantityChange

          const cardContent = (
            <>
              {/* Image area */}
              <div className="relative w-full aspect-square overflow-hidden rounded-md bg-cosmos-washi">
                {imageUrl ? (
                  <Image
                    src={imageUrl}
                    alt={`${title}: ${value}`}
                    className="object-cover object-center"
                    fill
                    sizes="(max-width: 512px) 40vw, (max-width: 1024px) 25vw, 120px"
                    quality={60}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-2">
                    <span className="text-xs text-center text-cosmos-graphite font-medium leading-tight">
                      {value}
                    </span>
                  </div>
                )}
              </div>

              {/* Label */}
              <span
                className={clx(
                  "text-xs font-medium text-center leading-tight",
                  selected ? "text-cosmos-charcoal" : "text-cosmos-graphite",
                )}
              >
                {value}
              </span>

              {/* Inline stepper — rendered when multi-select props are provided */}
              {onVariantQuantityChange &&
                (() => {
                  const variant = valueToVariant[value]
                  const variantId = variant?.id
                  if (!variantId) return null
                  const qty = variantQuantities?.[variantId] ?? 0
                  const meta = variantMeta?.[variantId]
                  return (
                    <div
                      className="w-full mt-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <QuantityStepper
                        quantity={qty}
                        onChange={(newQty) =>
                          onVariantQuantityChange(variantId, newQty)
                        }
                        max={meta?.maxQty ?? null}
                        disabled={disabled || meta?.inStock === false}
                        compact
                        data-testid={`variant-stepper-${variantId}`}
                      />
                    </div>
                  )
                })()}

              {/* Engraving field — shown when qty > 0 AND variant is engravable */}
              {onVariantEngravingTextChange &&
                (() => {
                  const variant = valueToVariant[value]
                  const variantId = variant?.id
                  if (!variantId) return null
                  const qty = variantQuantities?.[variantId] ?? 0
                  const meta = variantMeta?.[variantId]
                  const isEngravable = meta?.isEngravable ?? false
                  if (qty === 0 || !isEngravable) return null
                  const text = variantEngravingTexts?.[variantId] ?? ""
                  return (
                    <div
                      className="w-full mt-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={text}
                        onChange={(e) =>
                          onVariantEngravingTextChange(
                            variantId,
                            e.target.value,
                          )
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
                          {meta.threshold > 1 && (
                            <> — free at {meta.threshold}+ units</>
                          )}
                        </p>
                      )}
                    </div>
                  )
                })()}

              {/* Out-of-stock badge */}
              {!inStock && (
                <span className="absolute top-1 right-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-cosmos-charcoal text-white">
                  Out of stock
                </span>
              )}

              {/* Selected indicator */}
              {selected && (
                <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-cosmos-vermilion flex items-center justify-center">
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </span>
              )}
            </>
          )

          return isMultiSelect ? (
            <div
              key={value}
              className={clx(
                "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all duration-200",
                selected
                  ? "border-cosmos-vermilion bg-cosmos-paper shadow-md"
                  : "border-cosmos-hairline bg-cosmos-paper hover:border-cosmos-graphite hover:shadow-sm",
                !inStock && "opacity-50",
                disabled && "cursor-not-allowed",
              )}
              data-testid="variant-swatch"
            >
              {cardContent}
            </div>
          ) : (
            <button
              onClick={() => updateOption(option.id, value)}
              key={value}
              disabled={disabled}
              className={clx(
                "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
                selected
                  ? "border-cosmos-vermilion bg-cosmos-paper shadow-md"
                  : "border-cosmos-hairline bg-cosmos-paper hover:border-cosmos-graphite hover:shadow-sm",
                !inStock && "opacity-50",
                disabled && "cursor-not-allowed",
              )}
              data-testid="variant-swatch"
            >
              {cardContent}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default VariantSwatchCard
