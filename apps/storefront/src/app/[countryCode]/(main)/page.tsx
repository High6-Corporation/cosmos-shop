import { Metadata } from "next"

import FeaturedProducts from "@modules/home/components/featured-products"
import Hero from "@modules/home/components/hero"
import BrandRail from "@modules/home/components/brand-rail"
import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import ProductPreview from "@modules/products/components/product-preview"
import { HttpTypes } from "@medusajs/types"

export const metadata: Metadata = {
  title: "Cosmos Bazaar — Quality Stationery & Art Supplies",
  description:
    "Pens, art supplies, adhesives, and writing instruments from Pilot, Panfix, KUM, Cretacolor, and more. Delivered across the Philippines.",
}

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const params = await props.params

  const { countryCode } = params

  const region = await getRegion(countryCode)

  const { collections } = await listCollections({
    fields: "id, handle, title",
  })

  // Fetch featured products directly (not collection-filtered)
  // since products may not be assigned to collections in test data
  const {
    response: { products: featuredProducts },
  } = await listProducts({
    countryCode,
    queryParams: { limit: 8 },
  })

  if (!collections || !region) {
    return null
  }

  return (
    <>
      <Hero />
      <BrandRail collections={collections} />
      <div className="content-container py-16">
        <div className="mb-8">
          <h2 className="font-display text-2xl small:text-3xl font-semibold tracking-tight text-cosmos-ink">
            Featured Products
          </h2>
        </div>
        {featuredProducts && featuredProducts.length > 0 ? (
          <ul className="grid grid-cols-2 small:grid-cols-4 gap-x-4 gap-y-8">
            {featuredProducts.map((product: HttpTypes.StoreProduct) => (
              <li key={product.id}>
                <ProductPreview product={product} region={region} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-16 text-center">
            <p className="text-cosmos-graphite text-sm">
              Products coming soon — check back shortly.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
