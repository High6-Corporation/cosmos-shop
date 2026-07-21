"use client"

import { Dialog, Transition } from "@headlessui/react"
import { sdk } from "@lib/config"
import { clx } from "@modules/common/components/ui"
import { HttpTypes } from "@medusajs/types"
import { usePathname, useRouter } from "next/navigation"
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"

type OptionValue = {
  id: string
  label: string
}

type FilterSlideOverProps = {
  open: boolean
  onClose: () => void
  currentSearchParams: string
}

const FilterSlideOver = ({
  open,
  onClose,
  currentSearchParams,
}: FilterSlideOverProps) => {
  const router = useRouter()
  const pathname = usePathname()

  // Fetch real product option values from API (same source as old OptionsPicker)
  const [options, setOptions] = useState<HttpTypes.StoreProductOption[]>([])

  useEffect(() => {
    if (!open) return
    const fetchOptions = async () => {
      try {
        const response = await sdk.client.fetch<{
          product_options?: HttpTypes.StoreProductOption[]
        }>("/store/product-options", {
          method: "GET",
          query: { is_exclusive: false, fields: "*values" },
        })
        if (response?.product_options) {
          setOptions(response.product_options)
        }
      } catch (error) {
        console.error("Failed to fetch product options", error)
      }
    }
    fetchOptions()
  }, [open])

  // Parse existing selections from current URL params
  const initialSelections = useMemo(() => {
    const params = new URLSearchParams(currentSearchParams)
    return params.getAll("optionValueIds").filter(Boolean)
  }, [currentSearchParams])

  // Local selection state — toggled independently, only applied on "Show results"
  const [selections, setSelections] = useState<string[]>(initialSelections)

  // Sync local state when panel opens or URL changes
  useEffect(() => {
    if (open) setSelections(initialSelections)
  }, [open, initialSelections])

  const toggleSelection = useCallback((id: string) => {
    setSelections((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
    )
  }, [])

  const clearAll = useCallback(() => setSelections([]), [])

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams(currentSearchParams)
    params.delete("optionValueIds")
    params.delete("page")
    selections.forEach((id) => params.append("optionValueIds", id))
    router.push(`${pathname}?${params.toString()}`)
    onClose()
  }, [currentSearchParams, selections, pathname, router, onClose])

  // Build filter groups from fetched product options
  const filterGroups = useMemo(() => {
    return options
      .map((option) => {
        const values: OptionValue[] =
          option.values
            ?.filter((v) => v.id && v.value)
            .map((v) => ({ id: v.id!, label: v.value! })) ?? []

        return values.length > 0
          ? { title: option.title ?? "Option", values }
          : null
      })
      .filter(Boolean) as { title: string; values: OptionValue[] }[]
  }, [options])

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[60]" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-cosmos-ink/30 backdrop-blur-sm" />
        </Transition.Child>

        {/* Slide-over panel */}
        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-200"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-sm">
                  <div className="flex h-full flex-col bg-cosmos-paper shadow-xl">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-cosmos-hairline">
                      <Dialog.Title className="font-display text-lg font-semibold text-cosmos-ink">
                        Filters
                      </Dialog.Title>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={clearAll}
                          className="text-sm text-cosmos-graphite hover:text-cosmos-charcoal transition-colors"
                        >
                          Clear all
                        </button>
                        <button
                          onClick={onClose}
                          className="text-cosmos-graphite hover:text-cosmos-charcoal transition-colors"
                          aria-label="Close filters"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Filter groups */}
                    <div className="flex-1 overflow-y-auto px-6 py-6">
                      {filterGroups.length === 0 ? (
                        <p className="text-sm text-cosmos-graphite text-center py-12">
                          No filters available for current products.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-y-8">
                          {filterGroups.map((group) => (
                            <div key={group.title}>
                              <h3 className="text-sm font-semibold text-cosmos-charcoal mb-3">
                                {group.title}
                              </h3>
                              <div className="flex flex-wrap gap-2">
                                {group.values.map((value) => {
                                  const isSelected = selections.includes(
                                    value.id,
                                  )
                                  return (
                                    <button
                                      key={value.id}
                                      onClick={() => toggleSelection(value.id)}
                                      className={clx(
                                        "px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
                                        isSelected
                                          ? "bg-cosmos-ink text-white"
                                          : "bg-cosmos-washi text-cosmos-graphite hover:bg-cosmos-hairline/50",
                                      )}
                                      aria-pressed={isSelected}
                                    >
                                      {value.label}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Footer with apply button */}
                    <div className="border-t border-cosmos-hairline px-6 py-4">
                      <button
                        onClick={applyFilters}
                        className="w-full py-3 rounded-lg bg-cosmos-ink text-white font-medium text-sm hover:bg-cosmos-charcoal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2"
                      >
                        Show{" "}
                        {selections.length > 0
                          ? `${selections.length} filter${selections.length > 1 ? "s" : ""}`
                          : "all"}{" "}
                        results
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

export default FilterSlideOver
