"use client"

import { deleteLineItem, updateLineItem } from "@lib/data/cart"
import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import QuantityStepper from "@modules/products/components/product-actions/quantity-stepper"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import EngravingFieldCaption from "@modules/products/components/engraving-field-caption"
import { Button } from "@modules/common/components/ui"
import { useRef, useState, useCallback, useEffect } from "react"

type CartSheetItemProps = {
  item: HttpTypes.StoreCartLineItem
  currencyCode: string
}

export default function CartSheetItem({
  item,
  currencyCode,
}: CartSheetItemProps) {
  const [updating, setUpdating] = useState(false)

  // Engraving state — text persists locally even when toggled off
  const [isEngraved, setIsEngraved] = useState(
    item.metadata?.engraved === true || item.metadata?.engraved === "true",
  )
  const [engravedText, setEngravedText] = useState(
    (item.metadata?.engraved_text as string) ?? "",
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
          metadata: {
            ...item.metadata,
            engraved: true,
            engraved_text: text,
          },
        })
      }, 400)
    },
    [item.id, item.quantity],
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
      // Show text field immediately (local state), but defer engraved: true
      // to the first typed text. This prevents charging the fee on a blank
      // field — per §4.7, engraved (boolean) is the fee authority.
      // The debounced text update will set engraved: true when the user types.
      // For now, only make a server call if there's already saved text.
      if (engravedText.trim().length > 0) {
        await updateLineItem({
          lineId: item.id,
          quantity: item.quantity,
          metadata: {
            ...item.metadata,
            engraved: true,
            engraved_text: engravedText,
          },
        })
      }
      // If no text yet, no server call — wait for the user to type
    } else {
      // Toggle off — do NOT clear engraved_text so it survives close/reopen
      await updateLineItem({
        lineId: item.id,
        quantity: item.quantity,
        metadata: { ...item.metadata, engraved: false },
      })
    }
  }

  const handleEngravingTextChange = (text: string) => {
    setEngravedText(text)
    debouncedUpdateEngraving(text)
  }

  const handleQuantityChange = async (quantity: number) => {
    setUpdating(true)
    try {
      await updateLineItem({ lineId: item.id, quantity })
    } finally {
      setUpdating(false)
    }
  }

  const handleRemove = async () => {
    setUpdating(true)
    try {
      await deleteLineItem(item.id)
    } finally {
      setUpdating(false)
    }
  }

  const maxQty =
    item.variant?.manage_inventory && !item.variant?.allow_backorder
      ? (item.variant?.inventory_quantity ?? 0) + item.quantity
      : null

  const title = item.product_title ?? item.title ?? "Item"
  const variantLabel = item.variant?.title ?? ""
  const thumbnail = item.thumbnail ?? item.variant?.images?.[0]?.url

  // Engraving eligibility from variant metadata
  const isEngravable =
    item.variant?.metadata?.is_engravable === true ||
    item.variant?.metadata?.is_engravable === "true"
  const engravingFee = Number(item.variant?.metadata?.engraving_fee) || 0
  const engravingThreshold =
    Number(item.variant?.metadata?.engraving_threshold) || 0

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

        {/* Engraving toggle — only shown for engravable variants */}
        {isEngravable && (
          <div className="mt-2">
            <div className="flex items-center gap-x-2">
              <span className="text-xs text-cosmos-graphite">
                ✎ Add Engraving?
              </span>
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
  )
}
