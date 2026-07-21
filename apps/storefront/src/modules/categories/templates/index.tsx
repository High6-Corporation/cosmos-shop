import { Suspense } from "react"

import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import SortDropdown from "@modules/store/components/sort-dropdown"
import FilterPillBar from "@modules/store/components/filter-pill-bar"
import PaginatedProducts from "@modules/store/templates/paginated-products"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { HttpTypes } from "@medusajs/types"
import { OptionValueIds } from "@lib/util/product-option-filters"

type Pill = { key: string; label: string }

const PLACEHOLDER = new Set([
  "pants",
  "merch",
  "refill",
  "shirts",
  "sweatshirts",
])

const CategoryTemplate = ({
  category,
  sortBy,
  page,
  countryCode,
  optionValueIds,
  allCategories,
  collections,
}: {
  category: HttpTypes.StoreProductCategory
  sortBy?: SortOptions
  page?: string
  countryCode: string
  optionValueIds?: OptionValueIds
  allCategories: Pill[]
  collections: Pill[]
}) => {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  if (!category || !countryCode) {
    return (
      <div className="content-container py-16 text-center">
        <p className="text-cosmos-graphite">Category not found.</p>
      </div>
    )
  }

  return (
    <div className="content-container py-8" data-testid="category-container">
      {/* Back button */}
      <LocalizedClientLink
        href="/store"
        className="inline-flex items-center gap-1.5 text-sm text-cosmos-graphite hover:text-cosmos-charcoal transition-colors mb-4"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        All Products
      </LocalizedClientLink>

      {/* Heading row: breadcrumb + title + sort */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          {category.parent_category && (
            <span className="text-cosmos-graphite text-sm">
              <LocalizedClientLink
                href={`/categories/${category.parent_category.handle}`}
                className="hover:text-cosmos-charcoal transition-colors"
              >
                {category.parent_category.name}
              </LocalizedClientLink>
              <span className="mx-1">/</span>
            </span>
          )}
          <h1
            className="font-display text-3xl font-semibold tracking-tight text-cosmos-ink"
            data-testid="category-page-title"
          >
            {category.name}
          </h1>
        </div>
        <SortDropdown sortBy={sort} />
      </div>

      {category.description && (
        <p className="text-sm text-cosmos-graphite mb-4">
          {category.description}
        </p>
      )}

      {/* Pill bar with active category highlighted */}
      <FilterPillBar
        categories={allCategories}
        collections={collections}
        activeCategory={category.handle}
      />

      {/* Sub-categories (if any) */}
      {category.category_children && category.category_children.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {category.category_children
            .filter((c) => c.handle && !PLACEHOLDER.has(c.handle.toLowerCase()))
            .map((child) => (
              <LocalizedClientLink
                key={child.id}
                href={`/categories/${child.handle}`}
                className="px-3 py-1.5 rounded-full text-xs font-medium border border-cosmos-hairline text-cosmos-graphite hover:border-cosmos-ink hover:text-cosmos-charcoal transition-colors"
              >
                {child.name}
              </LocalizedClientLink>
            ))}
        </div>
      )}

      {/* Product grid */}
      <Suspense
        fallback={
          <SkeletonProductGrid
            numberOfProducts={category.products?.length ?? 8}
          />
        }
      >
        <PaginatedProducts
          sortBy={sort}
          page={pageNumber}
          categoryId={category.id}
          countryCode={countryCode}
          optionValueIds={optionValueIds}
        />
      </Suspense>
    </div>
  )
}

export default CategoryTemplate
