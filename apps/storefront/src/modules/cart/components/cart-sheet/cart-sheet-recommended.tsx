"use client"

import { sdk } from "@lib/config"
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useCallback, useEffect, useState } from "react"

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
  const { openQuickAdd } = useCartSheet()
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>([])
  const [fetching, setFetching] = useState(false)

  const fetchRecommended = useCallback(async () => {
    if (!cart?.items?.length) return
    setFetching(true)
    try {
      const cartVariantIds = new Set(
        cart.items?.map((item) => item.variant_id).filter(Boolean) ?? [],
      )

      // Direct SDK fetch -- NOT a server action (avoids router.refresh closing the sheet).
      const data = await sdk.client.fetch<{
        products: HttpTypes.StoreProduct[]
        count: number
      }>("/store/products", {
        method: "GET",
        query: {
          limit: 50,
          region_id: cart.region_id,
          fields:
            "*variants,*variants.calculated_price,*thumbnail,*images,*variants.inventory_quantity,*variants.manage_inventory,*variants.allow_backorder,*options,*options.values",
        },
      })

      const recommended = (data.products ?? [])
        .filter((p, i, arr) => {
          // Deduplicate by title -- the API may return the same product under
          // different ids and handles (e.g. "pilot-bls-g2-10-black" and
          // "pilot-bls-g2-10-black-tb" share the same display title).
          return arr.findIndex((x) => x.title === p.title) === i
        })
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

  if (products.length === 0) {
    if (showEmptyState) {
      return (
        <div className="mt-4 pt-4 border-t border-cosmos-hairline">
          <p className="text-xs font-semibold text-cosmos-graphite uppercase tracking-wide mb-3">
            You might also like
          </p>
          <p className="text-xs text-cosmos-graphite italic">Check back soon</p>
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
            {products.map((product) => (
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
                  {product.variants?.[0]?.calculated_price?.calculated_amount !=
                    null && (
                    <p className="text-xs text-cosmos-graphite">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency:
                          product.variants[0].calculated_price.currency_code ??
                          "PHP",
                      }).format(
                        product.variants[0].calculated_price.calculated_amount,
                      )}
                    </p>
                  )}
                </LocalizedClientLink>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openQuickAdd(product)
                  }}
                  className="w-full mt-1 text-xs h-7 px-2 py-1 rounded-md border border-cosmos-hairline bg-cosmos-paper text-cosmos-charcoal hover:bg-cosmos-washi transition-colors cursor-pointer"
                  data-testid={`quick-add-${product.id}`}
                >
                  + Add
                </button>
              </div>
            ))}
          </div>
        </div>
        <LocalizedClientLink
          href="/store"
          className="block text-center text-xs text-cosmos-graphite hover:text-cosmos-ink mt-3 transition-colors"
        >
          See more
        </LocalizedClientLink>
      </div>
    </>
  )
}
