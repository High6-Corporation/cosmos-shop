"use client"

import { convertToLocale } from "@lib/util/money"
import { Button, Text, clx } from "@modules/common/components/ui"

type EngravingToggleProps = {
  /** Whether this variant is eligible for engraving (variant.metadata.is_engravable) */
  isEngravable: boolean
  /** Per-unit engraving fee from variant.metadata.engraving_fee */
  fee: number
  /** Free-engraving threshold from variant.metadata.engraving_threshold */
  threshold: number
  /** Currency code for fee display */
  currencyCode: string
  /** Current toggle state */
  engraved: boolean
  /** Called when the customer toggles engraving on/off */
  onToggle: (engraved: boolean) => void
  disabled?: boolean
}

/**
 * Storefront engraving toggle — renders an "Add Engraving?" Yes/No control
 * with quantity-tiered fee messaging.
 *
 * Only shown when variant.metadata.is_engravable is true (gated by parent).
 *
 * Design: §3.4 of docs/cosmos/engraving-pricing-design.md
 */
export default function EngravingToggle({
  isEngravable,
  fee,
  threshold,
  currencyCode,
  engraved,
  onToggle,
  disabled = false,
}: EngravingToggleProps) {
  if (!isEngravable) return null

  const hasFee = fee > 0
  const hasThreshold = threshold > 1
  const formattedFee = hasFee
    ? convertToLocale({ amount: fee, currency_code: currencyCode })
    : null

  return (
    <div className="flex flex-col gap-y-3 py-3">
      <div className="flex items-center gap-x-3">
        <Text as="span" className="text-sm font-medium text-cosmos-charcoal">
          Add Engraving?
        </Text>
        <div className="flex gap-x-1">
          <Button
            size="small"
            variant={engraved ? "primary" : "secondary"}
            onClick={() => onToggle(true)}
            disabled={disabled}
            data-testid="engraving-yes-button"
          >
            Yes
          </Button>
          <Button
            size="small"
            variant={!engraved ? "primary" : "secondary"}
            onClick={() => onToggle(false)}
            disabled={disabled}
            data-testid="engraving-no-button"
          >
            No
          </Button>
        </div>
      </div>

      {/* Fee messaging — only shown when "Yes" is selected */}
      {engraved && (
        <div
          className={clx(
            "text-xs px-3 py-2 rounded-md font-medium",
            hasFee && hasThreshold
              ? "bg-cosmos-vermilion/10 text-cosmos-vermilion-text"
              : "bg-cosmos-forest/10 text-cosmos-forest",
          )}
          data-testid="engraving-fee-message"
        >
          {hasFee && hasThreshold ? (
            <p>
              <span className="font-semibold">{formattedFee}/unit</span>{" "}
              engraving fee —{" "}
              <span className="font-semibold">free at {threshold}+ units</span>
            </p>
          ) : hasFee && !hasThreshold ? (
            <p>
              <span className="font-semibold">{formattedFee}/unit</span>{" "}
              engraving fee applies
            </p>
          ) : (
            <p>
              <span className="font-semibold">Free engraving</span> included
            </p>
          )}
        </div>
      )}
    </div>
  )
}
