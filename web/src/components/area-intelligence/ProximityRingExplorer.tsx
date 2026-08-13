import { useMemo, useState } from 'react'

interface Place {
  name?: string
  vicinity?: string
  rating?: number
  user_ratings_total?: number
  price_level?: number
  opening_hours?: { open_now?: boolean }
  geometry?: { location?: { lat: number; lng: number } }
}

interface CategoryResult {
  category: string
  radius: number
  count: number
  results?: Place[]
}

interface CachedScore {
  query_category?: string
  query_radius_meters?: number
  results_json?: CategoryResult[] | unknown
}

interface ProximityRingExplorerProps {
  googleScores: CachedScore[]
  center?: { lat: number; lng: number } | null
}

const RINGS = [
  { key: 'local', label: 'Local', min: 0, max: 3000, color: '#3B82F6' },
  { key: 'secondary', label: 'Secondary', min: 3001, max: 5000, color: '#60A5FA' },
  { key: 'macro', label: 'Macro', min: 5001, max: 10000, color: '#93C5FD' },
]

const CATEGORY_PILLS = ['Medical', 'F&B', 'Fitness', 'Education', 'Grocery', 'All']

function normalizeCategory(raw: string): string {
  const lower = String(raw).toLowerCase()
  if (lower.includes('hospital') || lower.includes('doctor') || lower.includes('pharmacy') || lower.includes('medical')) return 'Medical'
  if (lower.includes('restaurant') || lower.includes('cafe') || lower.includes('bar') || lower.includes('bakery')) return 'F&B'
  if (lower.includes('gym') || lower.includes('sports') || lower.includes('swimming') || lower.includes('park')) return 'Fitness'
  if (lower.includes('school') || lower.includes('university') || lower.includes('preschool')) return 'Education'
  if (lower.includes('grocery') || lower.includes('supermarket')) return 'Grocery'
  return 'Other'
}

function parseResults(json: unknown): CategoryResult[] {
  if (Array.isArray(json)) return json as CategoryResult[]
  return []
}

export function ProximityRingExplorer({ googleScores, center }: ProximityRingExplorerProps) {
  const [activeRing, setActiveRing] = useState('local')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['All'])

  const ring = RINGS.find((r) => r.key === activeRing) || RINGS[0]

  const items = useMemo(() => {
    const list: Array<Place & { category: string; distance: number }> = []
    for (const score of googleScores || []) {
      const results = parseResults(score.results_json)
      for (const group of results) {
        const distance = Number(group.radius)
        if (distance < ring.min || distance > ring.max) continue
        for (const place of group.results || []) {
          list.push({ ...place, category: normalizeCategory(group.category), distance })
        }
      }
    }
    return list
  }, [googleScores, ring])

  const countsByCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const item of items) {
      map[item.category] = (map[item.category] || 0) + 1
    }
    return map
  }, [items])

  const filtered = useMemo(() => {
    if (selectedCategories.includes('All')) return items
    return items.filter((i) => selectedCategories.includes(i.category))
  }, [items, selectedCategories])

  function toggleCategory(cat: string) {
    if (cat === 'All') {
      setSelectedCategories(['All'])
      return
    }
    setSelectedCategories((prev) => {
      const next = prev.filter((c) => c !== 'All')
      if (next.includes(cat)) return next.filter((c) => c !== cat)
      return [...next, cat]
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-4">
        {RINGS.map((r) => (
          <button
            key={r.key}
            onClick={() => setActiveRing(r.key)}
            className={`flex flex-col items-center rounded-full border px-4 py-2 transition ${
              activeRing === r.key ? 'border-transparent text-white' : 'border-gray-200 bg-white'
            }`}
            style={activeRing === r.key ? { backgroundColor: r.color } : undefined}
          >
            <span className="text-sm font-semibold">{r.label}</span>
            <span className="text-xs opacity-90">{r.min}-{r.max}m</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {CATEGORY_PILLS.map((cat) => {
          const disabled = cat !== 'All' && (countsByCategory[cat] || 0) === 0
          const active = selectedCategories.includes(cat)
          return (
            <button
              key={cat}
              disabled={disabled}
              onClick={() => toggleCategory(cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                disabled
                  ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                  : active
                  ? 'bg-gray-900 text-white'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {cat} {cat !== 'All' ? `(${countsByCategory[cat] || 0})` : ''}
            </button>
          )
        })}
      </div>

      <div className="max-h-80 overflow-auto rounded-lg border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No places found for this ring and category.
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((place, idx) => (
              <li key={idx} className="flex items-start justify-between p-3">
                <div>
                  <div className="font-medium">{place.name || 'Unnamed place'}</div>
                  <div className="text-xs text-muted-foreground">{place.vicinity}</div>
                  <div className="mt-1 flex gap-2 text-xs">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">{place.category}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">{place.distance}m</span>
                    {typeof place.price_level === 'number' && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5">{'$'.repeat(place.price_level)}</span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs">
                  {typeof place.rating === 'number' && (
                    <div className="font-semibold text-amber-500">★ {place.rating.toFixed(1)}</div>
                  )}
                  {place.opening_hours && (
                    <div className={place.opening_hours.open_now ? 'text-green-600' : 'text-red-500'}>
                      {place.opening_hours.open_now ? 'Open now' : 'Closed'}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
