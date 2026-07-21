"use client"

import { listProducts } from "@lib/data/products"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useEffect, useState } from "react"

type CartSheetRecommendedProps = {
  cart: HttpTypes.StoreCart | null
  countryCode: string
}

export default function CartSheetRecommended({
  cart,
  countryCode,
}: CartSheetRecommendedProps) {
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>([])

  useEffect(() => {
    if (!cart?.items?.length) {
      setProducts([])
      return
    }

    const fetchRecommended = async () => {
      try {
        // Collect variant IDs already in cart for exclusion
        const cartVariantIds = new Set(
          cart.items
            ?.map((item) => item.variant_id)
            .filter(Boolean) ?? [],
        )

        // Extract unique category IDs from cart items' products
        const categoryIds = [
          ...new Set(
            (cart.items ?? [])
              .flatMap(
                (item) =>
                  (
                    item.product as HttpTypes.StoreProduct
                  )?.categories?.map((c: { id: string }) => c.id) ?? [],
              )
              .filter(Boolean),
          ),
        ]

        if (categoryIds.length === 0) {
          setProducts([])
          return
        }

        // Server-side filter by category
        const { response } = await listProducts({
          countryCode,
          queryParams: {
            category_id: categoryIds,
            limit: 20,
            fields: "*variants,*images",
          },
        })

        // Client-side: exclude items already in cart, cap at 4
        const recommended = (response.products ?? [])
          .filter((p) => !p.variants?.some((v) => cartVariantIds.has(v.id)))
          .slice(0, 4)

        setProducts(recommended)
      } catch {
        setProducts([])
      }
    }

    fetchRecommended()
  }, [cart, countryCode])

  if (products.length === 0) return null

  return (
    <div className="mt-4 pt-4 border-t border-cosmos-hairline">
      <p className="text-xs font-semibold text-cosmos-graphite uppercase tracking-wide mb-3">
        You might also like
      </p>
      <div className="grid grid-cols-2 gap-3">
        {products.map((product) => (
          <LocalizedClientLink
            key={product.id}
            href={`/products/${product.handle}`}
            className="group"
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
        ))}
      </div>
    </div>
  )
}
