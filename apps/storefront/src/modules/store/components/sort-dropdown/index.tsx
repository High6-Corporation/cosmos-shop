"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

export type SortOptions = "price_asc" | "price_desc" | "created_at"

type SortDropdownProps = {
  sortBy: SortOptions
}

const sortOptions: { value: SortOptions; label: string }[] = [
  { value: "created_at", label: "Latest" },
  { value: "price_asc", label: "Price: Low → High" },
  { value: "price_desc", label: "Price: High → Low" },
]

const SortDropdown = ({ sortBy }: SortDropdownProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("sortBy", e.target.value)
      params.delete("page")
      router.push(`${pathname}?${params.toString()}`)
    },
    [pathname, router, searchParams],
  )

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="sort-select"
        className="text-sm text-cosmos-graphite flex-shrink-0"
      >
        Sort
      </label>
      <select
        id="sort-select"
        value={sortBy}
        onChange={handleChange}
        className="appearance-none bg-cosmos-paper border border-cosmos-hairline rounded-lg px-3 py-2 pr-8 text-sm font-medium text-cosmos-charcoal focus:outline-none focus:ring-2 focus:ring-cosmos-ink focus:border-transparent cursor-pointer bg-[right_0.5rem_center] bg-[length:1rem] bg-no-repeat"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23706860' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
        }}
      >
        {sortOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export default SortDropdown
