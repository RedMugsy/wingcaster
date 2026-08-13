import { useState, useEffect, useRef } from 'react'
import { Loader2, X, Link2, Upload, MapPin, Trash2, Image as ImageIcon, Video, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api } from '@/api/client'
import type { Property } from '@/types'
import {
  AMENITY_CATEGORIES,
  MEDIA_CLASSIFICATIONS,
  MAX_LISTING_MEDIA,
  type ListingMediaItem,
} from '@/lib/listingAmenities'

const PROPERTY_TYPES = ['apartment', 'villa', 'townhouse', 'studio', 'penthouse', 'office', 'shop']

export type ListingFormValues = {
  title: string
  description: string
  type: 'sale' | 'rent'
  property_type: string
  price: string
  price_unit: string
  bedrooms: string
  bathrooms: string
  area: string
  area_unit: string
  location: string
  city: string
  neighborhood: string
  address: string
  latitude: string
  longitude: string
  media: ListingMediaItem[]
  amenities: string[]
  furnished: boolean
  featured: boolean
  permit_number: string
  reference: string
  agency_tied: boolean
  marketplace_syndicated: boolean
  ungroup_override: boolean
  classification: string
  permissible_buildup_area: string
  developed_by: string
  interior_design_by: string
}

function newMediaId() {
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function mediaFromProperty(p: Property): ListingMediaItem[] {
  const existing = (p as any).media
  if (Array.isArray(existing) && existing.length) {
    return existing.slice(0, MAX_LISTING_MEDIA).map((m: any, i: number) => ({
      id: m.id || `media-${i}`,
      url: m.url || '',
      media_type: m.media_type === 'video' ? 'video' : 'image',
      classification: m.classification || 'Other',
      source: m.source === 'upload' ? 'upload' : 'link',
    }))
  }
  return (p.photos || []).slice(0, MAX_LISTING_MEDIA).map((url, i) => ({
    id: `legacy-${i}`,
    url,
    media_type: /\.(mp4|webm|mov)(\?|$)/i.test(url) || /youtube|vimeo/i.test(url) ? 'video' as const : 'image' as const,
    classification: 'Other',
    source: 'link' as const,
  }))
}

const emptyForm = (): ListingFormValues => ({
  title: '',
  description: '',
  type: 'sale',
  property_type: 'apartment',
  price: '',
  price_unit: 'month',
  bedrooms: '1',
  bathrooms: '1',
  area: '',
  area_unit: 'sqm',
  location: '',
  city: 'Beirut',
  neighborhood: '',
  address: '',
  latitude: '',
  longitude: '',
  media: [],
  amenities: [],
  furnished: false,
  featured: false,
  permit_number: '',
  reference: '',
  agency_tied: true,
  marketplace_syndicated: true,
  ungroup_override: false,
  classification: 'apartment',
  permissible_buildup_area: '',
  developed_by: '',
  interior_design_by: '',
})

function fromProperty(p: Property): ListingFormValues {
  return {
    title: p.title || '',
    description: p.description || '',
    type: p.type || 'sale',
    property_type: p.property_type || 'apartment',
    price: String(p.price ?? ''),
    price_unit: p.price_unit || 'month',
    bedrooms: String(p.bedrooms ?? 0),
    bathrooms: String(p.bathrooms ?? 1),
    area: String(p.area ?? ''),
    area_unit: p.area_unit || 'sqm',
    location: p.location || '',
    city: p.city || 'Beirut',
    neighborhood: p.neighborhood || '',
    address: p.address || '',
    latitude: p.latitude != null ? String(p.latitude) : '',
    longitude: p.longitude != null ? String(p.longitude) : '',
    media: mediaFromProperty(p),
    amenities: p.amenities || [],
    furnished: p.furnished === 1 || p.furnished === true,
    featured: p.featured === 1 || p.featured === true,
    permit_number: p.permit_number || '',
    reference: p.reference || '',
    agency_tied: p.agency_tied !== false && p.agency_tied !== 0,
    marketplace_syndicated: p.marketplace_syndicated !== false && p.marketplace_syndicated !== 0,
    ungroup_override: p.ungroup_override === true || p.ungroup_override === 1,
    classification: (p as any).classification || p.property_type || '',
    permissible_buildup_area: String((p as any).permissible_buildup_area ?? p.area ?? ''),
    developed_by: (p as any).developed_by || '',
    interior_design_by: (p as any).interior_design_by || '',
  }
}

interface ListingFormModalProps {
  open: boolean
  property?: Property | null
  onClose: () => void
  onSaved: (property: Property) => void
}

export function ListingFormModal({ open, property, onClose, onSaved }: ListingFormModalProps) {
  const [form, setForm] = useState<ListingFormValues>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [linkDraft, setLinkDraft] = useState('')
  const [linkType, setLinkType] = useState<'image' | 'video'>('image')
  const [linkClass, setLinkClass] = useState<string>(MEDIA_CLASSIFICATIONS[0])
  const [uploadClass, setUploadClass] = useState<string>(MEDIA_CLASSIFICATIONS[0])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [amenityQuery, setAmenityQuery] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMessage, setAiMessage] = useState('')

  async function handleAiDraft() {
    if (aiBusy) return
    const photoUrls = form.media
      .filter((m) => (m.media_type || 'image') === 'image' && !!m.url?.trim())
      .map((m) => m.url.trim())
    if (photoUrls.length === 0) {
      setAiMessage('Add at least one photo before running AI describe.')
      return
    }
    setAiBusy(true)
    setAiMessage('')
    try {
      const r = await api.describeListingFromPhotos({
        photo_urls: photoUrls,
        hints: {
          city: form.city || undefined,
          neighborhood: form.neighborhood || undefined,
          type: form.type,
          property_type: form.property_type || undefined,
          price: form.price ? Number(form.price) : undefined,
          currency: form.price_unit || undefined,
        },
        intent: 'create',
      })
      const p = r.property
      setForm((prev) => ({
        ...prev,
        // Prefer AI value only when the field is empty — never overwrite user edits.
        title: prev.title || p.title || '',
        description: prev.description || p.description || '',
        property_type: prev.property_type || p.property_type || '',
        bedrooms: prev.bedrooms || (p.bedrooms != null ? String(p.bedrooms) : ''),
        bathrooms: prev.bathrooms || (p.bathrooms != null ? String(p.bathrooms) : ''),
        area: prev.area || (p.area != null ? String(p.area) : ''),
        area_unit: prev.area_unit || p.area_unit || '',
        city: prev.city || p.city || '',
        neighborhood: prev.neighborhood || p.neighborhood || '',
        location: prev.location || p.location || '',
        address: prev.address || p.address || '',
        amenities:
          Array.isArray(prev.amenities) && prev.amenities.length > 0
            ? prev.amenities
            : (p.amenities || []),
      }))
      setAiMessage(`Drafted via ${r.provider} (confidence ${Math.round((p.confidence || 0) * 100)}%). Review and edit as needed.`)
    } catch (err: any) {
      setAiMessage(err?.message || 'AI draft failed.')
    } finally {
      setAiBusy(false)
    }
  }
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setError('')
    setLinkDraft('')
    setAmenityQuery('')
    setForm(property ? fromProperty(property) : emptyForm())
  }, [open, property])

  if (!open) return null

  const set = (key: keyof ListingFormValues, value: string | boolean | string[] | ListingMediaItem[]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const toggleAmenity = (a: string) => {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(a)
        ? prev.amenities.filter((x) => x !== a)
        : [...prev.amenities, a],
    }))
  }

  const addMediaItem = (item: Omit<ListingMediaItem, 'id'>) => {
    setForm((prev) => {
      if (prev.media.length >= MAX_LISTING_MEDIA) return prev
      return { ...prev, media: [...prev.media, { ...item, id: newMediaId() }] }
    })
  }

  const updateMedia = (id: string, patch: Partial<ListingMediaItem>) => {
    setForm((prev) => ({
      ...prev,
      media: prev.media.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }))
  }

  const removeMedia = (id: string) => {
    setForm((prev) => ({ ...prev, media: prev.media.filter((m) => m.id !== id) }))
  }

  const addFromLink = () => {
    const url = linkDraft.trim()
    if (!url) return
    if (form.media.length >= MAX_LISTING_MEDIA) {
      setError(`Maximum ${MAX_LISTING_MEDIA} media items.`)
      return
    }
    addMediaItem({
      url,
      media_type: linkType,
      classification: linkClass,
      source: 'link',
    })
    setLinkDraft('')
    setError('')
  }

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || (files as FileList).length === 0) return
    const remaining = MAX_LISTING_MEDIA - form.media.length
    if (remaining <= 0) {
      setError(`Maximum ${MAX_LISTING_MEDIA} media items.`)
      return
    }
    const list = Array.from(files as FileList | File[])
      .filter((f) => /^(image|video)\//.test(f.type))
      .slice(0, remaining)
    if (!list.length) {
      setError('Please choose image or video files.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const { items } = await api.uploadMedia(list)
      setForm((prev) => {
        const next = [...prev.media]
        for (const item of items) {
          if (next.length >= MAX_LISTING_MEDIA) break
          next.push({
            id: newMediaId(),
            url: item.url,
            media_type: item.media_type === 'video' ? 'video' : 'image',
            classification: item.media_type === 'video' ? 'Video Tour' : uploadClass,
            source: 'upload',
          })
        }
        return { ...prev, media: next }
      })
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.')
      return
    }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((prev) => ({
          ...prev,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }))
        setGeoBusy(false)
      },
      () => {
        setError('Could not get your location. Enter coordinates manually.')
        setGeoBusy(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim() || !form.price || !form.area || !form.location.trim()) {
      setError('Title, price, area, and location are required.')
      return
    }
    if (form.media.length > MAX_LISTING_MEDIA) {
      setError(`Maximum ${MAX_LISTING_MEDIA} media items.`)
      return
    }
    const media = form.media.filter((m) => m.url.trim())
    const photoList = media.map((m) => m.url)

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      type: form.type,
      property_type: form.property_type,
      price: Number(form.price),
      price_unit: form.type === 'rent' ? form.price_unit : undefined,
      bedrooms: Number(form.bedrooms) || 0,
      bathrooms: Number(form.bathrooms) || 1,
      area: Number(form.area),
      area_unit: form.area_unit,
      location: form.location.trim(),
      city: form.city.trim(),
      neighborhood: form.neighborhood.trim() || form.location.trim(),
      address: form.address.trim() || form.location.trim(),
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      media,
      photos: photoList.length
        ? photoList
        : ['/placeholder-property.svg'],
      amenities: form.amenities,
      furnished: form.furnished ? 1 : 0,
      featured: form.featured ? 1 : 0,
      permit_number: form.permit_number.trim() || `LP-${Date.now().toString().slice(-8)}`,
      reference: form.reference.trim() || `REB-${form.city.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-5)}`,
      status: 'active',
      agency_tied: form.agency_tied,
      marketplace_syndicated: form.marketplace_syndicated,
      ungroup_override: form.ungroup_override,
      classification: form.classification.trim() || form.property_type,
      permissible_buildup_area: Number(form.permissible_buildup_area || form.area) || Number(form.area),
      territory_id: 'territory-lb',
      developed_by: form.developed_by.trim(),
      interior_design_by: form.interior_design_by.trim(),
    }

    setSaving(true)
    try {
      const saved = property
        ? await api.updateProperty(property.id, payload)
        : await api.createProperty(payload)
      onSaved(saved)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to save listing')
    } finally {
      setSaving(false)
    }
  }

  const q = amenityQuery.trim().toLowerCase()
  const categories = AMENITY_CATEGORIES.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) => !q || item.toLowerCase().includes(q)),
  })).filter((cat) => cat.items.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{property ? 'Edit Listing' : 'Add Listing'}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-start justify-between gap-3 rounded-lg border border-dashed bg-amber-50/50 p-3">
            <div className="flex-1 text-xs text-slate-700">
              <div className="flex items-center gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                Draft with AI
              </div>
              <p className="mt-0.5 text-muted-foreground">
                Upload photos below, then hit Draft — AI fills the title, description, and as many
                fields as it can infer. It never overwrites anything you've already typed.
              </p>
              {aiMessage && (
                <p className="mt-1.5 text-slate-800">{aiMessage}</p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={aiBusy || form.media.length === 0}
              onClick={handleAiDraft}
              title={form.media.length === 0 ? 'Add photos first' : 'Draft listing from uploaded photos'}
            >
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {aiBusy ? 'Drafting…' : 'Draft with AI'}
            </Button>
          </div>

          <div>
            <Label>Title *</Label>
            <Input className="mt-1" value={form.title} onChange={(e) => set('title', e.target.value)} required />
          </div>
          <div>
            <Label>Description</Label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Listing Type</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.type}
                onChange={(e) => set('type', e.target.value)}
              >
                <option value="sale">For Sale</option>
                <option value="rent">For Rent</option>
              </select>
            </div>
            <div>
              <Label>Property Type</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.property_type}
                onChange={(e) => set('property_type', e.target.value)}
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Price (USD) *</Label>
              <Input className="mt-1" type="number" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} required />
            </div>
          </div>

          {form.type === 'rent' && (
            <div>
              <Label>Rent Period</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.price_unit}
                onChange={(e) => set('price_unit', e.target.value)}
              >
                <option value="month">Per Month</option>
                <option value="year">Per Year</option>
              </select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label>Bedrooms</Label>
              <Input className="mt-1" type="number" min="0" value={form.bedrooms} onChange={(e) => set('bedrooms', e.target.value)} />
            </div>
            <div>
              <Label>Bathrooms</Label>
              <Input className="mt-1" type="number" min="0" value={form.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} />
            </div>
            <div>
              <Label>Area *</Label>
              <Input className="mt-1" type="number" min="1" value={form.area} onChange={(e) => set('area', e.target.value)} required />
            </div>
            <div>
              <Label>Unit</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.area_unit}
                onChange={(e) => set('area_unit', e.target.value)}
              >
                <option value="sqm">sqm</option>
                <option value="sqft">sqft</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Location *</Label>
              <Input className="mt-1" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Achrafieh, Beirut" required />
            </div>
            <div>
              <Label>City</Label>
              <Input className="mt-1" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <Label>Neighborhood</Label>
              <Input className="mt-1" value={form.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />
            </div>
            <div>
              <Label>Address</Label>
              <Input className="mt-1" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
          </div>

          {/* Geo-location */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold flex items-center gap-2"><MapPin className="h-4 w-4" /> Geo-location</p>
                <p className="text-xs text-muted-foreground">Pin the property on the map with latitude & longitude</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={detectLocation} disabled={geoBusy} className="gap-1">
                {geoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                Use my location
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Latitude</Label>
                <Input className="mt-1" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} placeholder="33.8938" />
              </div>
              <div>
                <Label>Longitude</Label>
                <Input className="mt-1" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} placeholder="35.5018" />
              </div>
            </div>
            {form.latitude && form.longitude && (
              <a
                className="text-xs text-primary underline"
                href={`https://www.google.com/maps?q=${form.latitude},${form.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                Preview on Google Maps
              </a>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Developed By</Label>
              <Input className="mt-1" value={form.developed_by} onChange={(e) => set('developed_by', e.target.value)} placeholder="Developer / company name" />
            </div>
            <div>
              <Label>Interior Design by</Label>
              <Input className="mt-1" value={form.interior_design_by} onChange={(e) => set('interior_design_by', e.target.value)} placeholder="Designer / studio name" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Classification (LB disclosure) *</Label>
              <Input className="mt-1" value={form.classification} onChange={(e) => set('classification', e.target.value)} required />
            </div>
            <div>
              <Label>Permissible Buildup Area (sqm) *</Label>
              <Input className="mt-1" type="number" min="1" value={form.permissible_buildup_area} onChange={(e) => set('permissible_buildup_area', e.target.value)} required />
            </div>
            <div>
              <Label>Permit Number</Label>
              <Input className="mt-1" value={form.permit_number} onChange={(e) => set('permit_number', e.target.value)} />
            </div>
            <div>
              <Label>Reference</Label>
              <Input className="mt-1" value={form.reference} onChange={(e) => set('reference', e.target.value)} />
            </div>
          </div>

          {/* Media */}
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Pictures & videos</p>
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_LISTING_MEDIA} items. Use direct upload from your device, or paste a URL link. Classify each item.
                </p>
              </div>
              <Badge variant="outline">{form.media.length} / {MAX_LISTING_MEDIA}</Badge>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {/* Direct upload */}
              <div
                className={`rounded-lg border border-dashed p-4 transition-colors ${
                  dragOver ? 'border-[#0F0F0F] bg-muted/50' : 'bg-muted/20'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  void handleFiles(e.dataTransfer.files)
                }}
              >
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Upload className="h-4 w-4" /> Direct upload
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Drag & drop photos/videos here, or choose files from your computer (max 12MB each).
                </p>
                <div className="mt-3">
                  <Label className="text-xs">Default classification for uploads</Label>
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={uploadClass}
                    onChange={(e) => setUploadClass(e.target.value)}
                  >
                    {MEDIA_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  className="mt-3 w-full gap-2 bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
                  disabled={uploading || form.media.length >= MAX_LISTING_MEDIA}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? 'Uploading…' : 'Choose files to upload'}
                </Button>
              </div>

              {/* URL link */}
              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> URL link
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Paste an image or video URL (CDN, Google Drive public link, YouTube, Vimeo, etc.).
                </p>
                <div className="mt-3 space-y-2">
                  <Input
                    placeholder="https://…"
                    value={linkDraft}
                    onChange={(e) => setLinkDraft(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={linkType}
                      onChange={(e) => setLinkType(e.target.value as 'image' | 'video')}
                    >
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                    </select>
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={linkClass}
                      onChange={(e) => setLinkClass(e.target.value)}
                    >
                      {MEDIA_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    onClick={addFromLink}
                    disabled={!linkDraft.trim() || form.media.length >= MAX_LISTING_MEDIA}
                  >
                    <Link2 className="h-4 w-4" /> Add from URL
                  </Button>
                </div>
              </div>
            </div>

            {form.media.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No media yet — upload files or add a URL.</p>
            ) : (
              <div className="space-y-3">
                {form.media.map((m, idx) => (
                  <div key={m.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
                    <div className="h-16 w-24 shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center">
                      {m.media_type === 'video' ? (
                        <Video className="h-6 w-6 text-muted-foreground" />
                      ) : m.url ? (
                        <img src={m.url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        #{idx + 1} · {m.source === 'upload' ? 'Direct upload' : 'URL link'}
                      </p>
                      <Input
                        value={m.url}
                        onChange={(e) => updateMedia(m.id, { url: e.target.value, source: 'link' })}
                        placeholder="https://… or /uploads/…"
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={m.media_type}
                          onChange={(e) => updateMedia(m.id, { media_type: e.target.value as 'image' | 'video' })}
                        >
                          <option value="image">Image</option>
                          <option value="video">Video</option>
                        </select>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={m.classification}
                          onChange={(e) => updateMedia(m.id, { classification: e.target.value })}
                        >
                          {MEDIA_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="text-destructive shrink-0" onClick={() => removeMedia(m.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Amenities */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Amenities</p>
                <p className="text-xs text-muted-foreground">
                  {form.type === 'rent'
                    ? 'Rent listings: outdoor, A/C, maid/guard rooms, storage, and services are highlighted.'
                    : 'Select all that apply. Search to filter the full catalog.'}
                </p>
              </div>
              <Badge variant="secondary">{form.amenities.length} selected</Badge>
            </div>
            <Input
              placeholder="Search amenities (e.g. pool, maid, storage…)"
              value={amenityQuery}
              onChange={(e) => setAmenityQuery(e.target.value)}
            />
            <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
              {categories.map((cat) => (
                <div key={cat.id}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    {cat.label}
                    {form.type === 'rent' && cat.rentFocus && (
                      <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium normal-case text-orange-700">Key for rent</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {cat.items.map((a) => {
                      const on = form.amenities.includes(a)
                      return (
                        <button
                          key={a}
                          type="button"
                          onClick={() => toggleAmenity(a)}
                          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                            on
                              ? 'border-[#0F0F0F] bg-[#0F0F0F] text-white'
                              : 'hover:bg-muted'
                          }`}
                        >
                          {on ? '✓ ' : ''}{a}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            {form.amenities.length > 0 && (
              <div className="flex flex-wrap gap-1 border-t pt-3">
                {form.amenities.map((a) => (
                  <Badge key={a} variant="outline" className="cursor-pointer" onClick={() => toggleAmenity(a)}>
                    {a} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-sm font-medium">Publishing controls</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.agency_tied} onChange={(e) => set('agency_tied', e.target.checked)} />
              Tie to my current agency affiliation
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.marketplace_syndicated} onChange={(e) => set('marketplace_syndicated', e.target.checked)} />
              Syndicate to REB marketplace
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.ungroup_override} onChange={(e) => set('ungroup_override', e.target.checked)} />
              Display as standalone (ungroup from multi-agency offers)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.furnished} onChange={(e) => set('furnished', e.target.checked)} />
              Furnished
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} />
              Featured listing
            </label>
          </div>

          {error && <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving} className="gap-2 bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {property ? 'Save Changes' : 'Create Listing'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
