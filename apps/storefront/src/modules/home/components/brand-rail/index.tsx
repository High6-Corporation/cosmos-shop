import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

type BrandRailProps = {
  collections: HttpTypes.StoreCollection[]
}

/**
 * BrandRail — horizontally scrollable shop-by-brand rail.
 * Each collection with a handle acts as a brand card.
 * Empty state: renders nothing (no brands = no rail).
 */
export default function BrandRail({ collections }: BrandRailProps) {
  const visible = collections.filter((c) => c.handle && c.title)

  if (!visible.length) return null

  return (
    <section className="content-container py-16">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-display text-2xl small:text-3xl font-semibold tracking-tight text-cosmos-ink">
          Shop by Brand
        </h2>
        <LocalizedClientLink
          href="/collections"
          className="text-sm font-medium text-cosmos-graphite hover:text-cosmos-charcoal transition-colors"
        >
          View all →
        </LocalizedClientLink>
      </div>

      <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
        {visible.map((collection) => (
          <LocalizedClientLink
            key={collection.id}
            href={`/collections/${collection.handle}`}
            className="flex-shrink-0 w-[180px] small:w-[200px] group"
          >
            <div className="aspect-square rounded-lg bg-cosmos-washi border border-cosmos-hairline overflow-hidden mb-3 transition-shadow group-hover:shadow-md">
              <div className="w-full h-full flex items-center justify-center p-6">
                <span className="font-display text-xl small:text-2xl font-semibold text-cosmos-ink text-center leading-tight group-hover:text-cosmos-vermilion transition-colors">
                  {collection.title}
                </span>
              </div>
            </div>
            <p className="text-sm font-medium text-cosmos-charcoal text-center group-hover:text-cosmos-ink transition-colors">
              {collection.title}
            </p>
          </LocalizedClientLink>
        ))}
      </div>
    </section>
  )
}
