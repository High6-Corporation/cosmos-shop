"use client"

import { clx } from "@modules/common/components/ui"
import { useSearchParams } from "next/navigation"
import { useState } from "react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import FilterSlideOver from "../filter-slide-over"

type Pill = {
  key: string // category handle or collection handle
  label: string
}

type FilterPillBarProps = {
  categories: Pill[]
  collections: Pill[]
  /** Current active category handle from the URL, if on a category page */
  activeCategory?: string
}

const FilterPillBar = ({
  categories,
  collections,
  activeCategory,
}: FilterPillBarProps) => {
  const searchParams = useSearchParams()
  const [slideOverOpen, setSlideOverOpen] = useState(false)

  return (
    <>
      {/* Horizontal scrollable pill row */}
      <div className="flex items-center gap-3 pb-6 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 flex-nowrap">
          {/* "All" pill — always goes to /store */}
          <LocalizedClientLink
            href="/store"
            className={clx(
              "flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
              !activeCategory
                ? "bg-cosmos-ink text-white"
                : "border border-cosmos-hairline text-cosmos-graphite hover:border-cosmos-ink hover:text-cosmos-charcoal",
            )}
          >
            All
          </LocalizedClientLink>

          {/* Category pills — navigate to category pages */}
          {categories.map((pill) => {
            const isActive = activeCategory === pill.key
            return (
              <LocalizedClientLink
                key={`cat-${pill.key}`}
                href={`/categories/${pill.key}`}
                className={clx(
                  "flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
                  isActive
                    ? "bg-cosmos-ink text-white"
                    : "border border-cosmos-hairline text-cosmos-graphite hover:border-cosmos-ink hover:text-cosmos-charcoal",
                )}
              >
                {pill.label}
              </LocalizedClientLink>
            )
          })}

          {/* Collection/brand pills — navigate to collection pages */}
          {collections.map((pill) => (
            <LocalizedClientLink
              key={`col-${pill.key}`}
              href={`/collections/${pill.key}`}
              className={clx(
                "flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                "border border-cosmos-hairline text-cosmos-graphite hover:border-cosmos-ink hover:text-cosmos-charcoal",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
              )}
            >
              {pill.label}
            </LocalizedClientLink>
          ))}
        </div>

        {/* Filters trigger pill — opens slide-over on current page */}
        <button
          onClick={() => setSlideOverOpen(true)}
          className={clx(
            "flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
            "border border-cosmos-hairline text-cosmos-graphite hover:border-cosmos-ink hover:text-cosmos-charcoal",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
          )}
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
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
          Filters
        </button>
      </div>

      {/* Slide-over panel — filters on the current page via option_value_id */}
      <FilterSlideOver
        open={slideOverOpen}
        onClose={() => setSlideOverOpen(false)}
        currentSearchParams={searchParams.toString()}
      />
    </>
  )
}

export default FilterPillBar
