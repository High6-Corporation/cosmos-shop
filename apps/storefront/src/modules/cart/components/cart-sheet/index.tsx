"use client"

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react"
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider"
import { convertToLocale } from "@lib/util/money"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useParams } from "next/navigation"
import { useMemo, useState } from "react"
import CartSheetItem from "./cart-sheet-item"
import CartSheetRecommended from "./cart-sheet-recommended"
import QuickAddModal from "./quick-add-modal"

export default function CartSheet() {
  const {
    cart,
    isSheetOpen,
    closeSheet,
    partialFailureMessage,
    setPartialFailureMessage,
    quickAddProduct,
    closeQuickAdd,
    quickAddIntentRef,
  } = useCartSheet()
  const countryCode = useParams().countryCode as string
  const [termsChecked, setTermsChecked] = useState(false)
  const [groupEngraved, setGroupEngraved] = useState(true)

  // Group items by engraved_text when the toggle is on
  const groupedItems = useMemo(() => {
    if (!cart?.items?.length) return null
    if (!groupEngraved) return null

    const groups: Record<
      string,
      { items: typeof cart.items; totalQty: number; text: string }
    > = {}
    const ungrouped: typeof cart.items = []

    for (const item of cart.items) {
      const text = (item.metadata?.engraved_text as string) ?? ""
      if (text.trim()) {
        if (!groups[text]) {
          groups[text] = { items: [], totalQty: 0, text }
        }
        groups[text].items.push(item)
        groups[text].totalQty += item.quantity
      } else {
        ungrouped.push(item)
      }
    }

    return { groups: Object.values(groups), ungrouped }
  }, [cart?.items, groupEngraved])

  // Guarded close -- used by Dialog's onClose (fires on mousedown outside panel).
  // Headless UI v2's useOutsideClick fires onClose for any mousedown, even inside
  // DialogPanel. The panel-level onMouseDownCapture sets the ref, and this guard
  // prevents the close when the mousedown was inside the panel.
  const handleDialogClose = () => {
    if (quickAddIntentRef.current) {
      quickAddIntentRef.current = false
      return
    }
    if (quickAddProduct) return
    setTermsChecked(false)
    closeSheet()
  }

  // Unguarded close -- used by explicit close actions (X button, links).
  // These are intentional user actions, not accidental outside-click detections.
  const handleClose = () => {
    setTermsChecked(false)
    closeSheet()
  }

  const currencyCode = cart?.region?.currency_code?.toUpperCase() ?? "PHP"
  const itemCount = cart?.items?.length ?? 0
  const subtotal = cart?.subtotal ?? 0
  const hasItems = !!(cart && itemCount > 0)

  return (
    <>
      {quickAddProduct && (
        <QuickAddModal
          product={quickAddProduct}
          countryCode={countryCode}
          open={!!quickAddProduct}
          onClose={closeQuickAdd}
        />
      )}
      <Dialog
        open={isSheetOpen}
        onClose={handleDialogClose}
        className="relative z-50"
      >
        {/* Backdrop */}
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-cosmos-ink/30 transition duration-300 ease-out data-[closed]:opacity-0 data-[leave]:duration-200 data-[leave]:ease-in"
        />

        {/* Desktop: Recommended products panel -- sits to the left of the cart */}
        {hasItems && (
          <DialogPanel
            transition
            onMouseDownCapture={() => {
              quickAddIntentRef.current = true
            }}
            className="hidden min-[1080px]:block fixed right-[28rem] top-0 h-full w-72 bg-cosmos-paper/95 backdrop-blur-sm border-r border-cosmos-hairline shadow-lg z-40 overflow-y-auto transition duration-300 ease-out data-[closed]:translate-x-full data-[leave]:duration-200 data-[leave]:ease-in"
          >
            <div className="px-4 pt-16 pb-4">
              <CartSheetRecommended
                cart={cart}
                countryCode={countryCode}
                showEmptyState={true}
              />
            </div>
          </DialogPanel>
        )}

        {/* Cart sheet panel */}
        <DialogPanel
          transition
          onMouseDownCapture={() => {
            quickAddIntentRef.current = true
          }}
          className="fixed right-0 top-0 h-full w-full max-w-md bg-cosmos-paper shadow-xl flex flex-col z-50 transition duration-300 ease-out data-[closed]:translate-x-full data-[leave]:duration-200 data-[leave]:ease-in"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-cosmos-hairline">
            <DialogTitle className="text-lg font-semibold text-cosmos-charcoal font-fraunces">
              Your Cart{itemCount > 0 ? ` (${itemCount})` : ""}
            </DialogTitle>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-md text-cosmos-graphite hover:text-cosmos-charcoal hover:bg-cosmos-washi transition-colors"
              aria-label="Close cart"
              data-testid="cart-sheet-close"
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

          {/* Partial-failure banner */}
          {partialFailureMessage && (
            <div
              className="mx-4 mt-3 px-3 py-2 bg-cosmos-vermilion/10 border border-cosmos-vermilion/20 rounded-md flex items-start gap-x-2"
              data-testid="cart-sheet-failure-banner"
            >
              <p className="text-sm text-cosmos-vermilion-text flex-1">
                {partialFailureMessage}
              </p>
              <button
                onClick={() => setPartialFailureMessage(null)}
                className="text-cosmos-vermilion-text hover:text-cosmos-charcoal transition-colors flex-shrink-0"
                aria-label="Dismiss"
              >
                <svg
                  className="w-4 h-4"
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
          )}

          {/* Body -- scrollable */}
          <div className="flex-1 overflow-y-auto px-4">
            {!cart || itemCount === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-y-3 text-center py-12">
                <p className="text-cosmos-graphite text-sm">
                  Your cart is empty.
                </p>
                <button
                  onClick={handleClose}
                  className="text-sm font-medium text-cosmos-ink hover:text-cosmos-charcoal transition-colors"
                >
                  Continue shopping
                </button>
              </div>
            ) : (
              <>
                {/* Line items */}
                <div className="divide-y divide-cosmos-hairline">
                  {groupedItems ? (
                    <>
                      {/* Grouped items -- same engraving text collapsed into one */}
                      {groupedItems.groups.map((group) => (
                        <CartSheetItem
                          key={group.text}
                          item={group.items[0]}
                          currencyCode={currencyCode}
                          groupQuantity={group.totalQty}
                          groupItems={group.items}
                        />
                      ))}
                      {/* Ungrouped items -- no engraving text or different texts */}
                      {groupedItems.ungrouped.map((item) => (
                        <CartSheetItem
                          key={item.id}
                          item={item}
                          currencyCode={currencyCode}
                        />
                      ))}
                    </>
                  ) : (
                    cart.items!.map((item) => (
                      <CartSheetItem
                        key={item.id}
                        item={item}
                        currencyCode={currencyCode}
                      />
                    ))
                  )}
                </div>

                {/* Mobile: Recommended products inside scroll body */}
                <div className="block min-[1080px]:hidden">
                  <CartSheetRecommended cart={cart} countryCode={countryCode} />
                </div>
              </>
            )}
          </div>

          {/* Footer -- sticky */}
          {cart && itemCount > 0 && (
            <div className="border-t border-cosmos-hairline px-4 py-4 bg-cosmos-paper">
              {/* Subtotal */}
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-cosmos-graphite">Subtotal</span>
                <span className="text-sm font-semibold text-cosmos-charcoal tabular-nums">
                  {convertToLocale({
                    amount: subtotal,
                    currency_code: currencyCode,
                  })}
                </span>
              </div>

              {/* Group engraved toggle -- shown when engraved items exist */}
              {cart.items?.some((i) =>
                (i.metadata?.engraved_text as string)?.trim(),
              ) && (
                <label className="flex items-center gap-x-2 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={groupEngraved}
                    onChange={(e) => setGroupEngraved(e.target.checked)}
                    className="w-4 h-4 rounded border-cosmos-hairline text-cosmos-ink focus:ring-cosmos-ink"
                    data-testid="group-engraved-toggle"
                  />
                  <span className="text-xs text-cosmos-graphite">
                    Group same engraving text
                  </span>
                </label>
              )}

              {/* T&C checkbox */}
              <label className="flex items-start gap-x-2 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsChecked}
                  onChange={(e) => setTermsChecked(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-cosmos-hairline text-cosmos-vermilion focus:ring-cosmos-ink"
                  data-testid="cart-sheet-terms-checkbox"
                />
                <span className="text-xs text-cosmos-graphite leading-relaxed">
                  I agree to the{" "}
                  <LocalizedClientLink
                    href="/terms"
                    className="text-cosmos-ink underline hover:text-cosmos-charcoal"
                  >
                    Terms &amp; Conditions
                  </LocalizedClientLink>
                </span>
              </label>

              {/* Checkout button */}
              <LocalizedClientLink
                href="/checkout?step=delivery"
                className={`block w-full text-center py-2.5 rounded-md text-sm font-semibold transition-colors ${
                  termsChecked
                    ? "bg-cosmos-ink text-white hover:bg-cosmos-charcoal"
                    : "bg-cosmos-hairline text-cosmos-graphite cursor-not-allowed pointer-events-none"
                }`}
                data-testid="cart-sheet-checkout-button"
                aria-disabled={!termsChecked}
                tabIndex={termsChecked ? 0 : -1}
                onClick={() => {
                  if (!termsChecked) return
                  handleClose()
                }}
              >
                Proceed to Checkout
              </LocalizedClientLink>

              {/* View full cart link */}
              <LocalizedClientLink
                href="/cart"
                className="block text-center text-xs text-cosmos-graphite hover:text-cosmos-charcoal mt-2 transition-colors"
                onClick={handleClose}
              >
                View full cart
              </LocalizedClientLink>
            </div>
          )}
        </DialogPanel>
      </Dialog>
    </>
  )
}
