"use client"

import { Dialog, Transition } from "@headlessui/react"
import { addToCart } from "@lib/data/cart"
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import VariantSwatchCard from "@modules/products/components/product-actions/variant-swatch-card"
import QuantityStepper from "@modules/products/components/product-actions/quantity-stepper"
import { Fragment, useEffect, useMemo, useState } from "react"
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
  const { openSheet } = useCartSheet()
  const [options, setOptions] = useState<Record<string, string | undefined>>({})
  const [quantity, setQuantity] = useState(1)
  const [isAdding, setIsAdding] = useState(false)

  // Find selected variant from options
  const selectedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return undefined
    return product.variants.find((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  // Check if all option groups have a selection
  const allOptionsSelected = useMemo(() => {
    return (product.options || []).every(
      (opt) => options[opt.id] !== undefined,
    )
  }, [product.options, options])

  // Reset quantity to 1 when selected variant changes (prevents stale qty > new max)
  useEffect(() => {
    setQuantity(1)
  }, [selectedVariant?.id])

  // Stock-aware max — three-state inventory from PDP logic
  const maxQty = useMemo(() => {
    if (!selectedVariant) return null
    if (!selectedVariant.manage_inventory || selectedVariant.allow_backorder) {
      return null // uncapped
    }
    return selectedVariant.inventory_quantity ?? 0 // capped
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
      openSheet()
    } catch {
      // addToCart is a server action that handles errors internally
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
                    disabled={
                      !selectedVariant || inStock === false || isAdding
                    }
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
                  disabled={
                    !selectedVariant || inStock === false || isAdding
                  }
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
  )
}
