import { Metadata } from "next"

import { parseOptionValueIds } from "@lib/util/product-option-filters"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import StoreTemplate from "@modules/store/templates"
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "All Products | Cosmos Bazaar",
  description:
    "Explore our full range of stationery, writing instruments, and art supplies.",
}

type StorePageSearchParams = Record<string, string | string[] | undefined> & {
  sortBy?: SortOptions
  page?: string
  optionValueIds?: string | string[]
}

type Params = {
  searchParams: Promise<StorePageSearchParams>
  params: Promise<{
    countryCode: string
  }>
}

// Known placeholder categories from the Medusa template — filter out
const PLACEHOLDER = new Set([
  "pants",
  "merch",
  "refill",
  "shirts",
  "sweatshirts",
])

export default async function StorePage(props: Params) {
  const params = await props.params
  const searchParams = await props.searchParams
  const { sortBy, page } = searchParams
  const optionValueIds = parseOptionValueIds(searchParams)

  // Fetch categories and collections for the filter pill bar
  const [productCategories, { collections }] = await Promise.all([
    listCategories(),
    listCollections({ fields: "id, handle, title" }),
  ])

  const categoryPills = (productCategories || [])
    .filter(
      (c) =>
        c.handle &&
        !PLACEHOLDER.has(c.handle.toLowerCase()) &&
        !c.parent_category,
    )
    .slice(0, 8)
    .map((c) => ({ key: c.handle!, label: c.name }))

  const collectionPills = (collections || [])
    .filter((c) => c.handle && c.title)
    .slice(0, 6)
    .map((c) => ({ key: c.handle!, label: c.title }))

  return (
    <StoreTemplate
      sortBy={sortBy}
      page={page}
      countryCode={params.countryCode}
      optionValueIds={optionValueIds}
      categories={categoryPills}
      collections={collectionPills}
    />
  )
}
