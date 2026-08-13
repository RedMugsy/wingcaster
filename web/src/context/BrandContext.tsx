import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_BRAND, type BrandConfig } from '@/config/brand'

interface BrandContextValue {
  brand: BrandConfig
  setBrand: (next: Partial<BrandConfig>) => void
  loading: boolean
}

const BrandContext = createContext<BrandContextValue>({
  brand: DEFAULT_BRAND,
  setBrand: () => {},
  loading: false,
})

const STORAGE_KEY = 'companion.brand'

function loadCached(): BrandConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_BRAND
    return { ...DEFAULT_BRAND, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_BRAND
  }
}

function syncDocument(brand: BrandConfig) {
  if (typeof document === 'undefined') return
  document.title = brand.name
  const link = document.getElementById('brand-favicon') as HTMLLinkElement | null
  if (link && brand.iconUrl) link.href = brand.iconUrl
  const themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
  if (themeMeta && brand.primaryColor) themeMeta.content = brand.primaryColor
  const root = document.documentElement
  if (brand.primaryColor) root.style.setProperty('--brand-primary', brand.primaryColor)
  if (brand.accentColor) root.style.setProperty('--brand-accent', brand.accentColor)
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<BrandConfig>(() => loadCached())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchBrand() {
      try {
        const res = await fetch('/api/brand', { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const next = { ...DEFAULT_BRAND, ...data }
        setBrandState(next)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* offline / not yet available — keep cached or defaults */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchBrand()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    syncDocument(brand)
  }, [brand])

  const setBrand = (next: Partial<BrandConfig>) => {
    setBrandState((prev) => {
      const merged = { ...prev, ...next }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      return merged
    })
  }

  const value = useMemo(() => ({ brand, setBrand, loading }), [brand, loading])

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export function useBrand() {
  return useContext(BrandContext)
}
