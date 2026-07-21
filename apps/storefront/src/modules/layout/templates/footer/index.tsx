import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import { Text, clx } from "@modules/common/components/ui"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import MedusaCTA from "@modules/layout/components/medusa-cta"

export default async function Footer() {
  const { collections } = await listCollections({
    fields: "*products",
  })
  const productCategories = await listCategories()

  // Filter out known placeholder/template categories
  const PLACEHOLDER_CATEGORIES = new Set(["pants", "merch", "refill", "shirts", "sweatshirts"])
  const realCategories = (productCategories || []).filter(
    (c) => c.handle && !PLACEHOLDER_CATEGORIES.has(c.handle.toLowerCase())
  )

  return (
    <footer className="border-t border-cosmos-hairline bg-cosmos-washi w-full">
      <div className="content-container flex flex-col w-full py-16">
        <div className="flex flex-col gap-y-8 small:flex-row small:items-start small:justify-between">
          <div className="small:max-w-[200px]">
            <LocalizedClientLink
              href="/"
              className="font-display text-xl font-semibold tracking-tight text-cosmos-ink hover:text-cosmos-charcoal transition-colors"
            >
              Cosmos Bazaar
            </LocalizedClientLink>
            <p className="text-sm text-cosmos-graphite mt-3 leading-relaxed">
              Quality stationery, writing instruments, and art supplies from
              Pilot, Panfix, KUM, and Cretacolor.
            </p>
          </div>
          <div className="text-small-regular gap-10 md:gap-x-16 grid grid-cols-2 sm:grid-cols-3">
            <div className="flex flex-col gap-y-2">
              <span className="txt-small-plus text-cosmos-charcoal font-medium">
                Shop
              </span>
              <ul className="grid grid-cols-1 gap-2 text-cosmos-graphite txt-small">
                {realCategories.length > 0 ? (
                  realCategories.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      <LocalizedClientLink
                        className="hover:text-cosmos-charcoal transition-colors"
                        href={`/categories/${c.handle}`}
                      >
                        {c.name}
                      </LocalizedClientLink>
                    </li>
                  ))
                ) : (
                  <>
                    <li>
                      <LocalizedClientLink
                        href="/store"
                        className="hover:text-cosmos-charcoal transition-colors"
                      >
                        All Products
                      </LocalizedClientLink>
                    </li>
                  </>
                )}
                {collections?.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <LocalizedClientLink
                      className="hover:text-cosmos-charcoal transition-colors"
                      href={`/collections/${c.handle}`}
                    >
                      {c.title}
                    </LocalizedClientLink>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-y-2">
              <span className="txt-small-plus text-cosmos-charcoal font-medium">
                Account
              </span>
              <ul className="grid grid-cols-1 gap-y-2 text-cosmos-graphite txt-small">
                <li>
                  <LocalizedClientLink
                    href="/account"
                    className="hover:text-cosmos-charcoal transition-colors"
                  >
                    My Account
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink
                    href="/account/orders"
                    className="hover:text-cosmos-charcoal transition-colors"
                  >
                    Orders
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink
                    href="/cart"
                    className="hover:text-cosmos-charcoal transition-colors"
                  >
                    Cart
                  </LocalizedClientLink>
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-y-2">
              <span className="txt-small-plus text-cosmos-charcoal font-medium">
                Company
              </span>
              <ul className="grid grid-cols-1 gap-y-2 text-cosmos-graphite txt-small">
                <li>
                  <LocalizedClientLink
                    href="/store"
                    className="hover:text-cosmos-charcoal transition-colors"
                  >
                    All Products
                  </LocalizedClientLink>
                </li>
                <li>
                  <span className="text-cosmos-graphite cursor-default">
                    Manila, Philippines
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="flex w-full mt-16 pt-8 border-t border-cosmos-hairline justify-between text-cosmos-graphite">
          <Text className="txt-compact-small">
            © {new Date().getFullYear()} Cosmos Bazaar. All rights reserved.
          </Text>
          <MedusaCTA />
        </div>
      </div>
    </footer>
  )
}
