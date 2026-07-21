"use client"

import { retrieveCart } from "@lib/data/cart"
import { HttpTypes } from "@medusajs/types"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"

type CartSheetContextValue = {
  cart: HttpTypes.StoreCart | null
  isSheetOpen: boolean
  openSheet: () => void
  closeSheet: () => void
  refreshCart: () => Promise<void>
  partialFailureMessage: string | null
  setPartialFailureMessage: (msg: string | null) => void
}

const CartSheetContext = createContext<CartSheetContextValue | null>(null)

export function useCartSheet() {
  const ctx = useContext(CartSheetContext)
  if (!ctx) throw new Error("useCartSheet must be used within CartSheetProvider")
  return ctx
}

export default function CartSheetProvider({
  children,
  initialCart,
}: {
  children: React.ReactNode
  initialCart: HttpTypes.StoreCart | null
}) {
  const [cart, setCart] = useState<HttpTypes.StoreCart | null>(initialCart)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [partialFailureMessage, setPartialFailureMessage] = useState<
    string | null
  >(null)

  // Sync when server re-renders with fresh data (router-refresh after server actions)
  useEffect(() => {
    setCart(initialCart)
  }, [initialCart])

  const openSheet = useCallback(() => setIsSheetOpen(true), [])
  const closeSheet = useCallback(() => {
    setIsSheetOpen(false)
    setPartialFailureMessage(null) // clear on close
  }, [])

  const refreshCart = useCallback(async () => {
    try {
      const fresh = await retrieveCart()
      setCart(fresh)
    } catch {
      // cart fetch failed — keep current state
    }
  }, [])

  return (
    <CartSheetContext.Provider
      value={{
        cart,
        isSheetOpen,
        openSheet,
        closeSheet,
        refreshCart,
        partialFailureMessage,
        setPartialFailureMessage,
      }}
    >
      {children}
    </CartSheetContext.Provider>
  )
}
