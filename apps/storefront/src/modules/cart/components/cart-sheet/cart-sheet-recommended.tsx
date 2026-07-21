"use client"

import { addToCart } from "@lib/data/cart"
import { sdk } from "@lib/config"
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useCallback, useEffect, useState } from "react"
import QuickAddModal from "./quick-add-modal"

type CartSheetRecommendedProps = {
  cart: HttpTypes.StoreCart | null
  countryCode: string
  showEmptyState?: boolean
}

export default function CartSheetRecommended({
  cart,
  countryCode,
  showEmptyState,
}: CartSheetRecommendedProps) {
  const { openSheet, refreshCart, setPartialFailureMessage } = useCartSheet()
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>([])
  const [modalProduct, setModalProduct] =
    useState<HttpTypes.StoreProduct | null>(null)
  const [adding, setAdding] = useState<Record<string, boolean>>({})
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const [fetching, setFetching] = useState(false)

  const fetchRecommended = useCallback(async () => {
    if (!cart?.items?.length) return
    setFetching(true)
    try {
      const cartVariantIds = new Set(
        cart.items?.map((item) => item.variant_id).filter(Boolean) ?? [],
      )

      // Direct SDK fetch — NOT a server action (avoids router.refresh closing the sheet).
      // Fetch all products (catalog is small — ~11 items).
      const region = cart.region_id
        ? await sdk.store.region.retrieve(cart.region_id)
        : null
      const regionId = region?.region?.id ?? cart.region_id

      const data = await sdk.client.fetch<{
        products: HttpTypes.StoreProduct[]
        count: number
      }>("/store/products", {
        method: "GET",
        query: {
          limit: 50,
          region_id: regionId,
          fields:
            "*variants,*variants.calculated_price,*thumbnail,*images,*variants.inventory_quantity,*variants.manage_inventory,*variants.allow_backorder,*options,*options.values",
        },
      })

      const recommended = (data.products ?? [])
        .filter((p) => !p.variants?.some((v) => cartVariantIds.has(v.id)))
        .slice(0, 4)

      setProducts(recommended)
    } catch {
      // keep current products on fetch failure
    } finally {
      setFetching(false)
    }
  }, [cart, countryCode])

  // Fetch on mount and when cart item count changes
  const itemCount = cart?.items?.length ?? 0
  useEffect(() => {
    fetchRecommended()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemCount, countryCode])

  const handleQuickAdd = async (product: HttpTypes.StoreProduct) => {
    const variant = product.variants?.[0]
    if (!variant?.id) return

    if ((product.variants?.length ?? 0) > 1) {
      setModalProduct(product)
      return
    }

    const productId = product.id!
    setAdding((prev) => ({ ...prev, [productId]: true }))
    try {
      await addToCart({
        variantId: variant.id,
        quantity: 1,
        countryCode,
      })
      setAdded((prev) => ({ ...prev, [productId]: true }))
      setProducts((prev) => prev.filter((p) => p.id !== product.id))
      await refreshCart()
      openSheet()
    } catch {
      setPartialFailureMessage(
        `Couldn't add ${product.title ?? "item"}. Please try again.`,
      )
    } finally {
      setAdding((prev) => ({ ...prev, [productId]: false }))
      setTimeout(() => {
        setAdded((prev) => ({ ...prev, [productId]: false }))
      }, 1500)
    }
  }

  if (products.length === 0) {
    if (showEmptyState) {
      return (
        <div className="mt-4 pt-4 border-t border-cosmos-hairline">
          <p className="text-xs font-semibold text-cosmos-graphite uppercase tracking-wide mb-3">
            You might also like
          </p>
          <p className="text-xs text-cosmos-graphite italic">
            Check back soon
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <>
      <div className="mt-4 pt-4 border-t border-cosmos-hairline">
        <p className="text-xs font-semibold text-cosmos-graphite uppercase tracking-wide mb-3">
          You might also like
        </p>
        <div className="max-h-[400px] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            {products.map((product) => {
              const productId = product.id!
              return (
                <div key={product.id} className="group">
                  <LocalizedClientLink
                    href={`/products/${product.handle}`}
                    className="block"
                  >
                    <div className="aspect-square rounded-md overflow-hidden bg-cosmos-washi mb-1.5">
                      {product.thumbnail ? (
                        <img
                          src={product.thumbnail}
                          alt={product.title ?? ""}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-cosmos-graphite text-xs">
                          No image
                        </div>
                      )}
                    </div>
                    <p className="text-xs font-medium text-cosmos-charcoal truncate group-hover:text-cosmos-ink transition-colors">
                      {product.title}
                    </p>
                    {product.variants?.[0]?.calculated_price
                      ?.calculated_amount != null && (
                      <p className="text-xs text-cosmos-graphite">
                        {new Intl.NumberFormat("en-PH", {
                          style: "currency",
                          currency:
                            product.variants[0].calculated_price
                              .currency_code ?? "PHP",
                        }).format(
                          product.variants[0].calculated_price
                            .calculated_amount,
                        )}
                      </p>
                    )}
                  </LocalizedClientLink>
                  <Button
                    onClick={() => handleQuickAdd(product)}
                    size="small"
                    variant="secondary"
                    disabled={adding[productId]}
                    isLoading={adding[productId]}
                    className="w-full mt-1 text-xs h-7"
                    data-testid={`quick-add-${product.id}`}
                  >
                    {added[productId] ? "✓ Added" : "+ Add"}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
        <button
          onClick={() => fetchRecommended()}
          disabled={fetching}
          className="block w-full text-center text-xs text-cosmos-graphite hover:text-cosmos-charcoal mt-3 transition-colors disabled:opacity-50"
        >
          {fetching ? "Loading…" : "See more →"}
        </button>
      </div>

      {modalProduct && (
        <QuickAddModal
          product={modalProduct}
          countryCode={countryCode}
          open={!!modalProduct}
          onClose={() => setModalProduct(null)}
        />
      )}
    </>
  )
}
