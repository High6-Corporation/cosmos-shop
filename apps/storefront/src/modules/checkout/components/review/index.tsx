"use client"

import { Heading, Text, clx } from "@modules/common/components/ui"

import PaymentButton from "../payment-button"
import { useSearchParams } from "next/navigation"
import { HttpTypes } from "@medusajs/types"

const Review = ({ cart }: { cart: HttpTypes.StoreCart }) => {
  const searchParams = useSearchParams()

  const isOpen = searchParams.get("step") === "review"

  const paidByGiftcard = !!(
    (cart as unknown as Record<string, unknown>)?.gift_cards &&
    ((cart as unknown as Record<string, unknown>)?.gift_cards as unknown[])
      ?.length > 0 &&
    cart?.total === 0
  )

  const hasShippingAddress = !!cart.shipping_address
  const hasShippingMethod = (cart.shipping_methods?.length ?? 0) > 0
  const hasPayment = !!(cart.payment_collection || paidByGiftcard)

  const previousStepsCompleted =
    hasShippingAddress && hasShippingMethod && hasPayment

  // Build a list of what's still missing so the user knows exactly what to fix
  const missingSteps: string[] = []
  if (!hasShippingAddress) missingSteps.push("Shipping Address")
  if (!hasShippingMethod) missingSteps.push("Shipping Method")
  if (!hasPayment) missingSteps.push("Payment")

  return (
    <div className="bg-cosmos-paper">
      <div className="flex flex-row items-center justify-between mb-6">
        <Heading
          level="h2"
          className={clx(
            "flex flex-row text-3xl-regular gap-x-2 items-baseline font-display tracking-tight",
            {
              "opacity-50 pointer-events-none select-none": !isOpen,
            },
          )}
        >
          Review
        </Heading>
      </div>
      {isOpen && previousStepsCompleted && (
        <>
          <div className="flex items-start gap-x-1 w-full mb-6">
            <div className="w-full">
              <Text className="txt-medium-plus text-cosmos-charcoal mb-1">
                By clicking the Place Order button, you confirm that you have
                read, understand and accept our Terms of Use, Terms of Sale and
                Returns Policy and acknowledge that you have read Medusa
                Store&apos;s Privacy Policy.
              </Text>
            </div>
          </div>
          <PaymentButton cart={cart} data-testid="submit-order-button" />
        </>
      )}
      {isOpen && !previousStepsCompleted && (
        <div className="rounded-lg border-2 border-cosmos-vermilion/30 bg-cosmos-vermilion/5 p-4">
          <p className="text-sm font-semibold text-cosmos-vermilion-text mb-2">
            Complete the following to place your order:
          </p>
          <ul className="list-disc list-inside space-y-1">
            {missingSteps.map((step) => (
              <li key={step} className="text-sm text-cosmos-charcoal">
                {step}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default Review
