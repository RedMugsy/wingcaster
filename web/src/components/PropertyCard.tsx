import { Link } from 'react-router-dom'
import { MapPin, Bed, Bath, Maximize, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatPrice } from '@/lib/format'
import type { Property } from '@/types'

interface PropertyCardProps {
  property: Property
  /** Override default listing profile link */
  to?: string
}

export function PropertyCard({ property, to }: PropertyCardProps) {
  const photos = Array.isArray(property.photos) ? property.photos : []
  const featured = property.featured === 1 || property.featured === true

  return (
    <Link to={to || `/listings/${property.id}`} className="group block">
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-md">
        <div className="relative aspect-[4/3] overflow-hidden">
          <img
            src={photos[0] || '/placeholder-property.svg'}
            alt={property.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute left-3 top-3 flex gap-2">
            <Badge variant={property.type === 'sale' ? 'default' : 'secondary'}>
              {property.type === 'sale' ? 'For Sale' : 'For Rent'}
            </Badge>
            {featured && <Badge variant="destructive">Featured</Badge>}
          </div>
          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
            <Eye className="h-3 w-3" />
            {(property.views || 0).toLocaleString()}
          </div>
        </div>

        <div className="p-4">
          <h3 className="mb-2 line-clamp-1 text-base font-semibold text-foreground">
            {property.title}
          </h3>

          <p className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {property.location}
          </p>

          <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
            {property.bedrooms > 0 && (
              <span className="flex items-center gap-1">
                <Bed className="h-4 w-4" />
                {property.bedrooms}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Bath className="h-4 w-4" />
              {property.bathrooms}
            </span>
            <span className="flex items-center gap-1">
              <Maximize className="h-4 w-4" />
              {property.area} {property.area_unit}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-primary">
              {formatPrice(property.price, property.type, property.price_unit)}
            </span>
            <div className="flex items-center gap-2">
              {property.agent_photo && (
                <img
                  src={property.agent_photo}
                  alt={property.agent_name}
                  className="h-7 w-7 rounded-full object-cover"
                />
              )}
              <span className="text-xs text-muted-foreground">{property.agent_name}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
