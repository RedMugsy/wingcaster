import { useEffect, useRef } from 'react'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

interface GoogleMapProps {
  apiKey?: string
  center: { lat: number; lng: number }
  zoom?: number
}

export function GoogleMap({ apiKey, center, zoom = 13 }: GoogleMapProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !apiKey) return

    setOptions({ key: apiKey, v: 'weekly' })
    let cancelled = false

    importLibrary('maps').then((maps) => {
      if (cancelled || !ref.current) return
      new maps.Map(ref.current, {
        center,
        zoom,
        mapTypeControl: false,
        streetViewControl: false,
      })
    })

    return () => {
      cancelled = true
    }
  }, [apiKey, center, zoom])

  if (!apiKey) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-gray-50 text-sm text-muted-foreground">
        Map preview unavailable (Google Maps API key not configured)
      </div>
    )
  }

  return <div ref={ref} className="h-64 w-full rounded-lg border" />
}
