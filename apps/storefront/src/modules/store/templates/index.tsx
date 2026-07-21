import { Suspense } from "react"

import { OptionValueIds } from "@lib/util/product-option-filters"
import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import FilterPillBar from "@modules/store/components/filter-pill-bar"
import SortDropdown from "@modules/store/components/sort-dropdown"

import PaginatedProducts from "./paginated-products"

type Pill = {
  key: string
  label: string
}

const StoreTemplate = ({
  sortBy,
  page,
  countryCode,
  optionValueIds,
  categories,
  collections,
}: {
  sortBy?: SortOptions
  page?: string
  countryCode: string
  optionValueIds?: OptionValueIds
  categories: Pill[]
  collections: Pill[]
}) => {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  return (
    <div className="content-container py-8" data-testid="category-container">
      {/* Heading row: title + sort dropdown */}
      <div className="flex items-center justify-between mb-4">
        <h1
          className="font-display text-3xl font-semibold tracking-tight text-cosmos-ink"
          data-testid="store-page-title"
        >
          All products
        </h1>
        <SortDropdown sortBy={sort} />
      </div>

      {/* Horizontal filter pill bar */}
      <FilterPillBar categories={categories} collections={collections} />

      {/* Product grid: 3 columns at desktop, 2 at mobile */}
      <Suspense fallback={<SkeletonProductGrid />}>
        <PaginatedProducts
          sortBy={sort}
          page={pageNumber}
          countryCode={countryCode}
          optionValueIds={optionValueIds}
        />
      </Suspense>
    </div>
  )
}

export default StoreTemplate
