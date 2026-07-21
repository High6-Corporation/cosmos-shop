"use client"

import { useCartSheet } from "@modules/cart/components/cart-sheet-provider"

export default function CartButton() {
  const { cart, openSheet } = useCartSheet()
  const itemCount = cart?.items?.length ?? 0

  return (
    <button
      onClick={openSheet}
      className="relative p-2 text-cosmos-charcoal hover:text-cosmos-ink transition-colors"
      aria-label={`Cart (${itemCount} items)`}
      data-testid="nav-cart-button"
    >
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
        />
      </svg>
      {itemCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 w-5 h-5 flex items-center justify-center bg-cosmos-vermilion text-white text-[11px] font-bold rounded-full"
          data-testid="cart-item-count"
        >
          {itemCount}
        </span>
      )}
    </button>
  )
}
