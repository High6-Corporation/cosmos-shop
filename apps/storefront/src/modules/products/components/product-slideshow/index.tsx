"use client"

import { HttpTypes } from "@medusajs/types"
import { clx } from "@modules/common/components/ui"
import PlaceholderImage from "@modules/common/icons/placeholder-image"
import Image from "next/image"
import React, { useCallback, useEffect, useRef, useState } from "react"

type ProductSlideshowProps = {
  images: HttpTypes.StoreProductImage[]
  productTitle?: string
}

/**
 * ProductSlideshow — swipeable/clickable image carousel replacing the
 * Medusa default static vertical ImageGallery.
 *
 * Features:
 *   - Swipe gestures (touch + mouse drag)
 *   - Keyboard navigation (arrow keys)
 *   - Clickable thumbnail strip with active-state indicator
 *   - Empty state: centered placeholder when no images exist
 */
const ProductSlideshow: React.FC<ProductSlideshowProps> = ({
  images,
  productTitle = "Product",
}) => {
  const [activeIndex, setActiveIndex] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)

  // Drag/swipe state
  const dragStart = useRef<{ x: number; scrollLeft: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Reset index when images change (variant switch)
  useEffect(() => {
    setActiveIndex(0)
  }, [images])

  // Clamp activeIndex if images shrink
  const safeIndex = Math.min(activeIndex, Math.max(0, images.length - 1))

  const goTo = useCallback(
    (index: number) => {
      setActiveIndex(Math.max(0, Math.min(index, images.length - 1)))
    },
    [images.length],
  )

  const goNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % Math.max(1, images.length))
  }, [images.length])

  const goPrev = useCallback(() => {
    setActiveIndex(
      (prev) => (prev - 1 + images.length) % Math.max(1, images.length),
    )
  }, [images.length])

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev()
      if (e.key === "ArrowRight") goNext()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [goPrev, goNext])

  // --- Drag / swipe handling ---
  const onPointerDown = (e: React.PointerEvent) => {
    // Don't start drag when clicking interactive elements (buttons, thumbnails)
    const target = e.target as HTMLElement
    if (target.closest("button")) return
    dragStart.current = { x: e.clientX, scrollLeft: 0 }
    setIsDragging(true)
    if (trackRef.current) trackRef.current.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStart.current) return
    const dx = e.clientX - dragStart.current.x
    // Threshold: 40px drag to trigger slide change
    if (Math.abs(dx) > 40) {
      if (dx > 0) goPrev()
      else goNext()
      dragStart.current = null
      setIsDragging(false)
    }
  }

  const onPointerUp = () => {
    dragStart.current = null
    setIsDragging(false)
  }

  // Empty state
  if (!images.length) {
    return (
      <div className="flex items-center justify-center w-full aspect-[4/5] bg-cosmos-washi rounded-lg">
        <div className="flex flex-col items-center gap-3 text-cosmos-graphite">
          <PlaceholderImage size={48} />
          <span className="text-sm">No images available</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-4 group">
      {/* Main image area */}
      <div
        ref={trackRef}
        className={clx(
          "relative w-full aspect-[4/5] overflow-hidden rounded-lg bg-cosmos-washi",
          "touch-pan-y",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Slide images — only mount the active one for performance */}
        {images.map((image, index) => (
          <div
            key={image.id || index}
            className={clx(
              "absolute inset-0 transition-opacity duration-300",
              index === safeIndex ? "opacity-100 z-10" : "opacity-0 z-0",
            )}
          >
            {image.url && (
              <Image
                src={image.url}
                priority={index <= 1}
                className="object-cover object-center"
                alt={`${productTitle} — image ${index + 1}`}
                fill
                sizes="(max-width: 576px) 100vw, (max-width: 1024px) 50vw, 600px"
                quality={85}
              />
            )}
          </div>
        ))}

        {/* Arrow buttons — hidden on touch devices, visible on hover */}
        {images.length > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                goPrev()
              }}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/80 backdrop-blur-sm shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-white"
              aria-label="Previous image"
              data-testid="slideshow-prev"
            >
              <svg
                className="w-5 h-5 text-cosmos-ink"
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
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                goNext()
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/80 backdrop-blur-sm shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-white"
              aria-label="Next image"
              data-testid="slideshow-next"
            >
              <svg
                className="w-5 h-5 text-cosmos-ink"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </>
        )}

        {/* Counter badge */}
        {images.length > 1 && (
          <div className="absolute bottom-3 right-3 z-20 px-2 py-0.5 rounded-full bg-white/70 backdrop-blur-sm text-xs font-medium text-cosmos-graphite">
            {safeIndex + 1} / {images.length}
          </div>
        )}
      </div>

      {/* Thumbnail strip — clickable, with active-state indicator */}
      {images.length > 1 && (
        <div
          className="flex gap-2 overflow-x-auto no-scrollbar px-1"
          role="tablist"
          aria-label="Product image thumbnails"
        >
          {images.map((image, index) => (
            <button
              key={image.id || index}
              role="tab"
              aria-selected={index === safeIndex}
              onClick={() => goTo(index)}
              className={clx(
                "relative flex-shrink-0 w-16 h-16 rounded-md overflow-hidden transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmos-ink focus-visible:ring-offset-2",
                index === safeIndex
                  ? "ring-2 ring-cosmos-vermilion ring-offset-2"
                  : "opacity-60 hover:opacity-100 ring-1 ring-cosmos-hairline",
              )}
              data-testid="slideshow-thumbnail"
            >
              {image.url ? (
                <Image
                  src={image.url}
                  alt={`${productTitle} — thumbnail ${index + 1}`}
                  className="object-cover object-center"
                  fill
                  sizes="64px"
                  quality={30}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-cosmos-washi">
                  <PlaceholderImage size={12} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProductSlideshow
