"use client"

import { addToCart } from "@lib/data/cart"
import { listProducts } from "@lib/data/products"
import { useCartSheet } from "@modules/cart/components/cart-sheet-provider"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useEffect, useState } from "react"
import QuickAddModal from "./quick-add-modal"

type CartSheetRecommendedProps = {
  cart: HttpTypes.StoreCart | null
  countryCode: string
  showEmptyState?: boolean // when true, renders "Check back soon" instead of null
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

  useEffect(() => {
    if (!cart?.items?.length) {
      setProducts([])
      return
    }

    const fetchRecommended = async () => {
      try {
        const cartVariantIds = new Set(
          cart.items?.map((item) => item.variant_id).filter(Boolean) ?? [],
        )

        const categoryIds = [
          ...new Set(
            (cart.items ?? [])
              .flatMap(
                (item) =>
                  (item.product as HttpTypes.StoreProduct)?.categories?.map(
                    (c: { id: string }) => c.id,
                  ) ?? [],
              )
              .filter(Boolean),
          ),
        ]

        const { response } = await listProducts({
          countryCode,
          queryParams: {
            ...(categoryIds.length > 0
              ? { category_id: categoryIds as any }
              : {}),
            limit: categoryIds.length > 0 ? 20 : 4,
            fields:
              "*variants.calculated_price,*thumbnail,*images,*variants.inventory_quantity,*variants.manage_inventory,*variants.allow_backorder,*options,*options.values",
          },
        })

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

  const isMultiVariant = (product: HttpTypes.StoreProduct) =>
    (product.variants?.length ?? 0) > 1

  const handleQuickAdd = async (product: HttpTypes.StoreProduct) => {
    const variant = product.variants?.[0]
    if (!variant?.id) return

    if (isMultiVariant(product)) {
      setModalProduct(product)
      return
    }

    // Single-variant: direct add
    const productId = product.id!
    setAdding((prev) => ({ ...prev, [productId]: true }))
    try {
      await addToCart({
        variantId: variant.id,
        quantity: 1,
        countryCode,
      })
      setAdded((prev) => ({ ...prev, [productId]: true }))
      // Force immediate cart refresh before opening sheet (router-refresh is async)
      await refreshCart()
      openSheet()
      setTimeout(() => {
        setAdded((prev) => ({ ...prev, [productId]: false }))
      }, 1500)
    } catch {
      setPartialFailureMessage(
        `Couldn't add ${product.title ?? "item"}. Please try again.`,
      )
    } finally {
      setAdding((prev) => ({ ...prev, [productId]: false }))
    }
  }

  if (products.length === 0) {
    // Desktop panel shows placeholder; mobile hides entirely
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
        <div className="grid grid-cols-2 gap-3">
          {products.map((product) => {
            const productId = product.id!
            const isAdding = adding[productId]
            const isAdded = added[productId]

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
                <Button
                  onClick={() => handleQuickAdd(product)}
                  size="small"
                  variant="secondary"
                  disabled={isAdding}
                  isLoading={isAdding}
                  className="w-full mt-1 text-xs h-7"
                  data-testid={`quick-add-${product.id}`}
                >
                  {isAdded ? "✓ Added" : "+ Add"}
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Variant selection modal for multi-variant products */}
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
