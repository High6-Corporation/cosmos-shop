"use client"

import { convertToLocale } from "@lib/util/money"
import { clx } from "@modules/common/components/ui"

type EngravingFieldCaptionProps = {
  fee: number
  threshold: number
  currencyCode: string
}

export default function EngravingFieldCaption({
  fee,
  threshold,
  currencyCode,
}: EngravingFieldCaptionProps) {
  const hasFee = fee > 0
  const hasThreshold = threshold > 1
  const formattedFee = hasFee
    ? convertToLocale({ amount: fee, currency_code: currencyCode })
    : null

  if (!hasFee && !hasThreshold) return null

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
  )
}
