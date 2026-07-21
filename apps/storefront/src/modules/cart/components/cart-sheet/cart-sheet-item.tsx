"use client"

import { deleteLineItem, updateLineItem } from "@lib/data/cart"
import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import QuantityStepper from "@modules/products/components/product-actions/quantity-stepper"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useState } from "react"

type CartSheetItemProps = {
  item: HttpTypes.StoreCartLineItem
  currencyCode: string
}

export default function CartSheetItem({
  item,
  currencyCode,
}: CartSheetItemProps) {
  const [updating, setUpdating] = useState(false)
  const [engravingText, setEngravingText] = useState(
    (item.metadata?.engraved_text as string) ?? "",
  )
  const isEngraved =
    item.metadata?.engraved === true || item.metadata?.engraved === "true"

  const handleQuantityChange = async (quantity: number) => {
    setUpdating(true)
    try {
      await updateLineItem({ lineId: item.id, quantity })
    } finally {
      setUpdating(false)
    }
  }

  const handleEngravingChange = async (text: string) => {
    setEngravingText(text)
    await updateLineItem({
      lineId: item.id,
      quantity: item.quantity,
      metadata: { ...item.metadata, engraved_text: text },
    })
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
  )
}
