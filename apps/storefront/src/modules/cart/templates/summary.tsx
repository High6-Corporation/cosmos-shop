"use client"

import { Button, Heading } from "@modules/common/components/ui"

import CartTotals from "@modules/common/components/cart-totals"
import Divider from "@modules/common/components/divider"
import DiscountCode from "@modules/checkout/components/discount-code"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { HttpTypes } from "@medusajs/types"

type SummaryProps = {
  cart: HttpTypes.StoreCart
}

function getCheckoutStep(cart: HttpTypes.StoreCart) {
  if (!cart?.shipping_address?.address_1 || !cart.email) {
    return "address"
  } else if (cart?.shipping_methods?.length === 0) {
    return "delivery"
  } else {
    return "payment"
  }
}

const Summary = ({ cart }: SummaryProps) => {
  const step = getCheckoutStep(cart)

  // Check for engraved items missing text
  const missingEngravedText = (cart.items ?? []).some(
    (item) =>
      (item.metadata?.engraved === true ||
        item.metadata?.engraved === "true") &&
      !(item.metadata?.engraved_text as string)?.trim(),
  )

  return (
    <div className="flex flex-col gap-y-4">
      <Heading level="h2" className="text-[2rem] leading-[2.75rem] font-display tracking-tight">
        Summary
      </Heading>
      <DiscountCode cart={cart} />
      <Divider />
      <CartTotals totals={cart} />
      {missingEngravedText && (
        <p
          className="text-sm text-red-500"
          data-testid="engraved-text-validation-error"
        >
          Please enter engraving text for all engraved items before checking
          out.
        </p>
      )}
      <LocalizedClientLink
        href={missingEngravedText ? "#" : "/checkout?step=" + step}
        data-testid="checkout-button"
        className={missingEngravedText ? "pointer-events-none opacity-50" : ""}
        aria-disabled={missingEngravedText}
        tabIndex={missingEngravedText ? -1 : undefined}
      >
        <Button className="w-full h-10">Go to checkout</Button>
      </LocalizedClientLink>
    </div>
  )
}

export default Summary
