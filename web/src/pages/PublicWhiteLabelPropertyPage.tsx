import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Bath, Bed, Loader2, Mail, MapPin, Maximize, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'

export function PublicWhiteLabelPropertyPage() {
  const { subdomain, propertyId } = useParams<{ subdomain: string; propertyId: string }>()
  const { addToast } = useToast()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')

  usePageTitle(data?.property?.title || 'Property')

  useEffect(() => {
    if (!subdomain || !propertyId) return
    setLoading(true)
    api.getPublicSiteProperty(subdomain, propertyId)
      .then((payload) => {
        setData(payload)
        api.trackPublicSiteEvent(subdomain, { page: `property:${propertyId}`, device: 'web' }).catch((err: any) => {
          addToast({ title: 'Analytics event failed', description: err.message || 'Could not track property view', variant: 'error' })
        })
      })
      .catch((err: any) => {
        addToast({ title: 'Failed to load property', description: err.message || 'Could not load listing', variant: 'error' })
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [subdomain, propertyId, addToast])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Listing not found</h2>
          <Link to={`/site/${subdomain}`}><Button className="mt-4">Back to site</Button></Link>
        </div>
      </div>
    )
  }

  const brand = data.site?.brand_config || {}
  const primary = brand.primary_color || data.agency?.primary_color || '#0f172a'
  const property = data.property
  const photos = Array.isArray(property.photos) ? property.photos : []
  const agent = data.agent

  const sendInquiry = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setMsg('')
    try {
      await api.createInquiry({
        property_id: property.id,
        name: form.name,
        email: form.email,
        phone: form.phone,
        message: form.message || `Interested in ${property.title}`,
        property_title: property.title,
        agency_id: data.agency.id,
        site_id: data.site.id,
        landing_page: `/site/${subdomain}/property/${property.id}`,
        source: 'agency_website',
        channel: 'web',
        agent_id: agent?.id || '',
      })
      setMsg('Inquiry sent. An agent will contact you soon.')
      setForm({ name: '', email: '', phone: '', message: '' })
    } catch (err: any) {
      setMsg(err.message || 'Failed to send inquiry')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to={`/site/${subdomain}`} className="flex items-center gap-2 text-sm font-medium" style={{ color: primary }}>
            <ArrowLeft className="h-4 w-4" />
            {data.agency.name}
          </Link>
          {data.agency.phone && (
            <a href={`tel:${data.agency.phone}`} className="flex items-center gap-1 text-sm text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />{data.agency.phone}
            </a>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[1.4fr_0.8fr] sm:px-6">
        <div>
          <div className="overflow-hidden rounded-xl bg-muted">
            <img
              src={photos[0] || '/placeholder-property.svg'}
              alt={property.title}
              className="aspect-[16/10] w-full object-cover"
            />
          </div>
          {photos.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {photos.slice(1, 5).map((src: string) => (
                <img key={src} src={src} alt="" className="aspect-video rounded-lg object-cover" />
              ))}
            </div>
          )}

          <div className="mt-6">
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge>{property.type === 'sale' ? 'For Sale' : 'For Rent'}</Badge>
              <Badge variant="secondary">{property.property_type}</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{property.title}</h1>
            <p className="mt-2 flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-4 w-4" />{property.location}
            </p>
            <p className="mt-4 text-2xl font-bold" style={{ color: primary }}>
              ${Number(property.price || 0).toLocaleString()}
              {property.type === 'rent' ? `/${property.price_unit || 'mo'}` : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
              {property.bedrooms > 0 && <span className="flex items-center gap-1"><Bed className="h-4 w-4" />{property.bedrooms} beds</span>}
              <span className="flex items-center gap-1"><Bath className="h-4 w-4" />{property.bathrooms} baths</span>
              <span className="flex items-center gap-1"><Maximize className="h-4 w-4" />{property.area} {property.area_unit || 'sqm'}</span>
            </div>
            <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {property.description || 'No description provided.'}
            </p>
          </div>
        </div>

        <aside className="space-y-4">
          {agent && (
            <div className="rounded-xl border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Listed by</p>
              <p className="mt-1 font-semibold">{agent.name}</p>
              <p className="text-sm text-muted-foreground">{agent.specialization}</p>
              {agent.phone && <p className="mt-2 flex items-center gap-1 text-sm"><Phone className="h-3.5 w-3.5" />{agent.phone}</p>}
              {agent.email && <p className="flex items-center gap-1 text-sm"><Mail className="h-3.5 w-3.5" />{agent.email}</p>}
            </div>
          )}

          <form onSubmit={sendInquiry} className="rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold">Inquire about this property</h2>
            <div>
              <Label>Name</Label>
              <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Email</Label>
              <Input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>Message</Label>
              <textarea
                required
                rows={4}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              />
            </div>
            {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
            <Button type="submit" disabled={sending} className="w-full" style={{ background: primary }}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send inquiry'}
            </Button>
          </form>
        </aside>
      </div>
    </div>
  )
}
