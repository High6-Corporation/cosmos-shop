"use client"

import { clx } from "@modules/common/components/ui"
import React from "react"

type QuantityStepperProps = {
  quantity: number
  onChange: (qty: number) => void
  max: number | null // null = no limit (no inventory tracking or backorder allowed)
  disabled: boolean
  "data-testid"?: string
}

/**
 * QuantityStepper — explicit − / quantity / + control replacing the
 * implicit qty=1 default in the Medusa product actions.
 *
 * Boundary behavior:
 *   - Min 1, − disabled at 1
 *   - + disabled at max (inventory_quantity) when inventory is tracked
 *   - Both buttons disabled when disabled prop is true (0 stock, no backorder)
 */
const QuantityStepper: React.FC<QuantityStepperProps> = ({
  quantity,
  onChange,
  max,
  disabled,
  "data-testid": dataTestId,
}) => {
  const atMin = quantity <= 1
  const atMax = max !== null && quantity >= max

  const decrement = () => {
    if (!atMin && !disabled) {
      onChange(quantity - 1)
    }
  }

  const increment = () => {
    if (!atMax && !disabled) {
      onChange(quantity + 1)
    }
  }

  return (
    <div className="flex flex-col gap-y-2" data-testid={dataTestId}>
      <span className="text-sm font-medium text-cosmos-charcoal">Quantity</span>
      <div className="flex items-center gap-x-0">
        <button
          onClick={decrement}
          disabled={atMin || disabled}
          className={clx(
            "flex items-center justify-center w-10 h-10 rounded-l-md border border-cosmos-hairline bg-cosmos-paper text-lg font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
            atMin || disabled
              ? "text-cosmos-hairline cursor-not-allowed"
              : "text-cosmos-charcoal hover:bg-cosmos-washi",
          )}
          aria-label="Decrease quantity"
          data-testid="quantity-decrement"
        >
          −
        </button>
        <span
          className={clx(
            "flex items-center justify-center w-12 h-10 border-y border-cosmos-hairline bg-cosmos-paper text-sm font-semibold text-cosmos-charcoal tabular-nums",
            disabled && "text-cosmos-graphite",
          )}
          data-testid="quantity-display"
        >
          {quantity}
        </span>
        <button
          onClick={increment}
          disabled={atMax || disabled}
          className={clx(
            "flex items-center justify-center w-10 h-10 rounded-r-md border border-cosmos-hairline bg-cosmos-paper text-lg font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
            atMax || disabled
              ? "text-cosmos-hairline cursor-not-allowed"
              : "text-cosmos-charcoal hover:bg-cosmos-washi",
          )}
          aria-label="Increase quantity"
          data-testid="quantity-increment"
        >
          +
        </button>
      </div>
      {max !== null && max > 0 && !disabled && (
        <p className="text-xs text-cosmos-graphite">{max} in stock</p>
      )}
    </div>
  )
}

export default QuantityStepper
