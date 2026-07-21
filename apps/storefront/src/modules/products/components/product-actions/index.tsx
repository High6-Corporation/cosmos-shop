"use client"

import { addToCart } from "@lib/data/cart"
import { useIntersection } from "@lib/hooks/use-in-view"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import Divider from "@modules/common/components/divider"
import VariantSwatchCard from "@modules/products/components/product-actions/variant-swatch-card"
import QuantityStepper from "@modules/products/components/product-actions/quantity-stepper"
import { isEqual } from "lodash"
import { useParams, usePathname, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import ProductPrice from "../product-price"
import MobileActions from "./mobile-actions"
import { useRouter } from "next/navigation"
import EngravingToggle from "../engraving-toggle"

type ProductActionsProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
}

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"],
) => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt) => {
    if (varopt.option_id) acc[varopt.option_id] = varopt.value
    return acc
  }, {})
}

export default function ProductActions({
  product,
  region,
  disabled,
}: ProductActionsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [options, setOptions] = useState<Record<string, string | undefined>>({})
  const [isAdding, setIsAdding] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const countryCode = useParams().countryCode as string

  // If there is only 1 variant, preselect the options
  useEffect(() => {
    if (product.variants?.length === 1) {
      const variantOptions = optionsAsKeymap(product.variants[0].options)
      setOptions(variantOptions ?? {})
    }
  }, [product.variants])

  const selectedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) {
      return
    }

    return product.variants.find((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  // update the options when a variant is selected
  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => ({
      ...prev,
      [optionId]: value,
    }))
  }

  //check if the selected options produce a valid variant
  const isValidVariant = useMemo(() => {
    return product.variants?.some((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const value = isValidVariant ? selectedVariant?.id : null

    if (params.get("v_id") === value) {
      return
    }

    if (value) {
      params.set("v_id", value)
    } else {
      params.delete("v_id")
    }

    router.replace(pathname + "?" + params.toString())
  }, [selectedVariant, isValidVariant])

  // check if the selected variant is in stock
  const inStock = useMemo(() => {
    // No variant selected yet — neutral
    if (!selectedVariant) {
      return null
    }

    // If we don't manage inventory, we can always add to cart
    if (!selectedVariant.manage_inventory) {
      return true
    }

    // If we allow back orders on the variant, we can add to cart
    if (selectedVariant.allow_backorder) {
      return true
    }

    // If there is inventory available, we can add to cart
    if (
      selectedVariant.manage_inventory &&
      (selectedVariant.inventory_quantity || 0) > 0
    ) {
      return true
    }

    // Otherwise, we can't add to cart
    return false
  }, [selectedVariant])

  // Compute the max quantity for the stepper
  const maxQuantity = useMemo(() => {
    if (!selectedVariant) return null
    if (!selectedVariant.manage_inventory || selectedVariant.allow_backorder) {
      return null // unlimited
    }
    return selectedVariant.inventory_quantity ?? 0
  }, [selectedVariant])

  // Reset quantity to 1 when variant changes
  useEffect(() => {
    setQuantity(1)
  }, [selectedVariant?.id])

  // Engraving: read variant-level eligibility + pricing from metadata
  const [isEngraved, setIsEngraved] = useState(false)

  const engravingMeta = useMemo(() => {
    const meta = selectedVariant?.metadata ?? {}
    const isEngravable =
      meta?.is_engravable === true || meta?.is_engravable === "true"
    const fee = Number(meta?.engraving_fee) || 0
    const threshold = Number(meta?.engraving_threshold) || 0
    return { isEngravable, fee, threshold }
  }, [selectedVariant])

  // Reset engraving toggle when variant changes
  useEffect(() => {
    setIsEngraved(false)
  }, [selectedVariant?.id])

  const actionsRef = useRef<HTMLDivElement>(null)

  const inView = useIntersection(actionsRef, "0px")

  // add the selected variant to the cart
  const handleAddToCart = async () => {
    if (!selectedVariant?.id) return null

    setIsAdding(true)

    await addToCart({
      variantId: selectedVariant.id,
      quantity,
      countryCode,
      ...(engravingMeta.isEngravable && isEngraved
        ? { metadata: { engraved: true } }
        : {}),
    })

    setIsAdding(false)
  }

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
                      current={options[option.id]}
                      updateOption={setOptionValue}
                      title={option.title ?? ""}
                      data-testid="product-options"
                      disabled={!!disabled || isAdding}
                    />
                  </div>
                )
              })}
              <Divider />
            </div>
          )}
        </div>

        <ProductPrice product={product} variant={selectedVariant} />

        <QuantityStepper
          quantity={quantity}
          onChange={setQuantity}
          max={maxQuantity}
          disabled={(!selectedVariant || inStock === false) ?? false}
          data-testid="product-quantity-stepper"
        />

        {isEngraved &&
          engravingMeta.fee > 0 &&
          selectedVariant?.calculated_price?.calculated_amount != null && (
            <p
              className="text-sm text-cosmos-graphite"
              data-testid="engraved-price-breakdown"
            >
              {new Intl.NumberFormat("en-PH", {
                style: "currency",
                currency: region?.currency_code ?? "PHP",
              }).format(
                selectedVariant.calculated_price.calculated_amount,
              )}{" "}
              +{" "}
              {new Intl.NumberFormat("en-PH", {
                style: "currency",
                currency: region?.currency_code ?? "PHP",
              }).format(engravingMeta.fee)}{" "}
              engraving ={" "}
              {new Intl.NumberFormat("en-PH", {
                style: "currency",
                currency: region?.currency_code ?? "PHP",
              }).format(
                selectedVariant.calculated_price.calculated_amount +
                  engravingMeta.fee,
              )}{" "}
              per unit
            </p>
          )}

        <EngravingToggle
          isEngravable={engravingMeta.isEngravable}
          fee={engravingMeta.fee}
          threshold={engravingMeta.threshold}
          currencyCode={region?.currency_code ?? "USD"}
          engraved={isEngraved}
          onToggle={setIsEngraved}
          disabled={!!disabled || isAdding}
        />

        <Button
          onClick={handleAddToCart}
          disabled={
            !selectedVariant ||
            inStock === false ||
            !!disabled ||
            isAdding ||
            !isValidVariant
          }
          variant="primary"
          className="w-full h-10 bg-cosmos-ink hover:bg-cosmos-charcoal text-white"
          isLoading={isAdding}
          data-testid="add-product-button"
        >
          {!selectedVariant
            ? "Select variant"
            : !isValidVariant
              ? "Select variant"
              : inStock === false
                ? "Out of stock"
                : `Add to cart — ${quantity}`}
        </Button>

        {selectedVariant?.manage_inventory &&
          selectedVariant.inventory_quantity != null && (
            <p
              className="text-sm text-cosmos-graphite text-center"
              data-testid="inventory-count"
            >
              {inStock === false
                ? "Out of stock"
                : `${selectedVariant.inventory_quantity} in stock`}
            </p>
          )}

        <MobileActions
          product={product}
          variant={selectedVariant}
          options={options}
          updateOptions={setOptionValue}
          inStock={inStock}
          handleAddToCart={handleAddToCart}
          isAdding={isAdding}
          show={!inView}
          optionsDisabled={!!disabled || isAdding}
        />
      </div>
    </>
  )
}
