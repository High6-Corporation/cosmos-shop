"use client"

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react"
import { addToCart } from "@lib/data/cart"
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import VariantSwatchCard from "@modules/products/components/product-actions/variant-swatch-card"
import QuantityStepper from "@modules/products/components/product-actions/quantity-stepper"
import { useEffect, useMemo, useState } from "react"
import { isEqual } from "lodash"

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"],
) => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt) => {
    if (varopt.option_id) acc[varopt.option_id] = varopt.value
    return acc
  }, {})
}

type QuickAddModalProps = {
  product: HttpTypes.StoreProduct
  countryCode: string
  open: boolean
  onClose: () => void
}

export default function QuickAddModal({
  product,
  countryCode,
  open,
  onClose,
}: QuickAddModalProps) {
  const { openSheet, refreshCart } = useCartSheet()
  const [options, setOptions] = useState<Record<string, string | undefined>>({})
  const [quantity, setQuantity] = useState(1)
  const [isAdding, setIsAdding] = useState(false)

  const hasOptions = (product.options?.length ?? 0) > 0

  const selectedVariant = useMemo(() => {
    if (!hasOptions) return product.variants?.[0] ?? undefined
    return (product.variants ?? []).find((v) => {
      return isEqual(optionsAsKeymap(v.options), options)
    })
  }, [product.variants, options, hasOptions])

  const allOptionsSelected = useMemo(() => {
    if (!hasOptions) return true
    return (product.options ?? []).every(
      (o) => options[o.id] !== undefined && options[o.id] !== "",
    )
  }, [product.options, options, hasOptions])

  useEffect(() => {
    setQuantity(1)
  }, [selectedVariant?.id])

  // Auto-select when every option has exactly one value (e.g. "Default" only).
  // The user shouldn't need to click a single-option variant to enable "Add to cart".
  useEffect(() => {
    if (!hasOptions) return
    const allSingleValue = (product.options ?? []).every(
      (o) => (o.values?.length ?? 0) === 1,
    )
    if (!allSingleValue) return
    const autoSelected: Record<string, string> = {}
    for (const opt of product.options ?? []) {
      const firstVal = opt.values?.[0]
      if (firstVal) autoSelected[opt.id] = firstVal.value
    }
    setOptions(autoSelected)
  }, [product.options, hasOptions])

  const maxQty = useMemo(() => {
    if (!selectedVariant) return null
    if (!selectedVariant.manage_inventory || selectedVariant.allow_backorder)
      return null
    return selectedVariant.inventory_quantity ?? 0
  }, [selectedVariant])

  const inStock = useMemo(() => {
    if (!selectedVariant) return null
    if (!selectedVariant.manage_inventory) return true
    if (selectedVariant.allow_backorder) return true
    return (selectedVariant.inventory_quantity || 0) > 0
  }, [selectedVariant])

  const price = selectedVariant?.calculated_price?.calculated_amount ?? null
  const formattedPrice =
    price != null
      ? new Intl.NumberFormat("en-PH", {
          style: "currency",
          currency: selectedVariant?.calculated_price?.currency_code ?? "PHP",
        }).format(price)
      : null

  const canAdd = hasOptions
    ? !!selectedVariant && inStock !== false && allOptionsSelected
    : !!selectedVariant && inStock !== false

  const handleAdd = async () => {
    if (!selectedVariant?.id) return
    setIsAdding(true)
    try {
      await addToCart({
        variantId: selectedVariant.id,
        quantity,
        countryCode,
      })
      handleClose()
      await refreshCart()
      openSheet()
    } finally {
      setIsAdding(false)
    }
  }

  const handleClose = () => {
    setOptions({})
    setQuantity(1)
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-cosmos-ink/40 transition duration-200 ease-out data-[closed]:opacity-0 data-[leave]:duration-150 data-[leave]:ease-in"
      />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          transition
          className="w-full max-w-sm bg-cosmos-paper rounded-lg shadow-xl max-h-[90vh] overflow-y-auto transition duration-200 ease-out data-[closed]:opacity-0 data-[closed]:scale-95 data-[leave]:duration-150 data-[leave]:ease-in"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-cosmos-hairline">
            <DialogTitle className="text-base font-semibold text-cosmos-charcoal font-fraunces">
              {hasOptions ? "Select Variant" : product.title}
            </DialogTitle>
            <button
              onClick={handleClose}
              className="p-1 rounded-md text-cosmos-graphite hover:text-cosmos-charcoal hover:bg-cosmos-washi"
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

          <div className="px-4 py-4 flex flex-col gap-y-4">
            {hasOptions && !allOptionsSelected && (
              <p className="text-xs text-cosmos-graphite text-center bg-cosmos-washi py-1.5 px-3 rounded-md">
                Select a variation below to add to cart
              </p>
            )}
            {hasOptions ? (
              (product.options ?? []).map((option) => (
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
              ))
            ) : (
              <p className="text-sm text-cosmos-charcoal text-center">
                {product.title}
              </p>
            )}

            <div className="flex items-center gap-x-3">
              <span className="text-sm font-medium text-cosmos-charcoal">
                Qty:
              </span>
              <QuantityStepper
                quantity={quantity}
                onChange={setQuantity}
                max={maxQty}
                disabled={!canAdd || isAdding}
                compact
              />
            </div>

            {formattedPrice && (
              <p className="text-sm text-cosmos-graphite text-right">
                {formattedPrice} each
              </p>
            )}
          </div>

          <div className="px-4 py-3 border-t border-cosmos-hairline">
            <Button
              onClick={handleAdd}
              disabled={!canAdd || isAdding}
              variant="primary"
              className="w-full h-10 bg-cosmos-ink hover:bg-cosmos-charcoal text-white"
              isLoading={isAdding}
            >
              {hasOptions && !allOptionsSelected
                ? "Select options"
                : inStock === false
                  ? "Out of stock"
                  : `Add to cart${formattedPrice ? ` -- ${formattedPrice}` : ""}`}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
