import LocalizedClientLink from "@modules/common/components/localized-client-link"

const Hero = () => {
  return (
    <div className="relative w-full bg-cosmos-ink overflow-hidden">
      <div className="content-container relative z-10 flex flex-col items-center text-center py-24 small:py-36 gap-y-6">
        <h1 className="font-display text-4xl small:text-5xl font-bold tracking-tight text-white leading-tight max-w-2xl">
          Quality stationery for writing, drawing, and creating
        </h1>
        <p className="text-base small:text-lg text-white/70 max-w-lg">
          Pens, art supplies, adhesives, and writing instruments from Pilot,
          Panfix, KUM, Cretacolor, and more — delivered across the Philippines.
        </p>
        <div className="flex gap-x-4 pt-4">
          <LocalizedClientLink
            href="/store"
            className="inline-flex items-center justify-center h-12 px-8 rounded-md font-medium bg-cosmos-vermilion text-white hover:bg-cosmos-vermilion-text transition-colors"
          >
            Shop All Products
          </LocalizedClientLink>
          <LocalizedClientLink
            href="/collections"
            className="inline-flex items-center justify-center h-12 px-8 rounded-md font-medium border border-white/30 text-white hover:bg-white/10 transition-colors"
          >
            Browse Collections
          </LocalizedClientLink>
        </div>
      </div>
      {/* Subtle texture overlay */}
      <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle_at_50%_50%,_#ffffff,_transparent_70%)]" />
    </div>
  )
}

export default Hero
