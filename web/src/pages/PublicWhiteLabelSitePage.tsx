import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Building2, Loader2, Mail, MapPin, Phone, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PropertyCard } from '@/components/PropertyCard'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { api } from '@/api/client'

export function PublicWhiteLabelSitePage() {
  const { subdomain } = useParams<{ subdomain: string }>()
  const { addToast } = useToast()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | 'sale' | 'rent'>('all')
  const [contact, setContact] = useState({ name: '', email: '', phone: '', message: '' })
  const [contactMsg, setContactMsg] = useState('')
  const [sending, setSending] = useState(false)

  usePageTitle(data?.site?.name || data?.agency?.name || 'Agency Site')

  useEffect(() => {
    if (!subdomain) return
    setLoading(true)
    api.getPublicSiteBySubdomain(subdomain)
      .then((payload) => {
        setData(payload)
        api.trackPublicSiteEvent(subdomain, { page: 'home', device: 'web' }).catch((err: any) => {
          addToast({ title: 'Analytics event failed', description: err.message || 'Could not track site visit', variant: 'error' })
        })
      })
      .catch((err: any) => {
        addToast({ title: 'Failed to load agency site', description: err.message || 'Could not load site', variant: 'error' })
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [subdomain, addToast])

  const brand = data?.site?.brand_config || {}
  const primary = brand.primary_color || data?.agency?.primary_color || '#0f172a'

  const listings = useMemo(() => {
    let rows = data?.listings || []
    if (type !== 'all') rows = rows.filter((p: any) => p.type === type)
    if (query.trim()) {
      const q = query.toLowerCase()
      rows = rows.filter((p: any) =>
        [p.title, p.location, p.city, p.neighborhood].some((v) => String(v || '').toLowerCase().includes(q)),
      )
    }
    return rows
  }, [data, query, type])

  const sendContact = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!data) return
    setSending(true)
    setContactMsg('')
    try {
      await api.createInquiry({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        message: contact.message,
        agency_id: data.agency.id,
        site_id: data.site.id,
        landing_page: `/site/${subdomain}`,
        property_title: `Agency contact: ${data.agency.name}`,
        source: 'agency_website',
        channel: 'web',
      })
      setContactMsg('Message sent.')
      setContact({ name: '', email: '', phone: '', message: '' })
    } catch (err: any) {
      setContactMsg(err.message || 'Failed to send')
    } finally {
      setSending(false)
    }
  }

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
          <h2 className="text-2xl font-bold">Agency site not found</h2>
          <Link to="/"><Button className="mt-4">Back to REB</Button></Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ ['--wl-primary' as any]: primary }}>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            {brand.logo_url ? (
              <img src={brand.logo_url} alt={data.agency.name} className="h-10 w-auto" />
            ) : (
              <Building2 className="h-8 w-8" style={{ color: primary }} />
            )}
            <div>
              <h1 className="text-xl font-bold" style={{ color: primary }}>{data.agency.name}</h1>
              <p className="text-xs text-muted-foreground">{data.template?.name || 'Agency'} website</p>
            </div>
          </div>
          <div className="hidden text-sm text-muted-foreground sm:flex sm:items-center sm:gap-4">
            {data.agency.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{data.agency.phone}</span>}
            {data.agency.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{data.agency.email}</span>}
          </div>
        </div>
      </header>

      <section className="border-b px-4 py-12 sm:px-6 lg:px-8" style={{ background: `linear-gradient(135deg, ${primary}12, transparent)` }}>
        <div className="mx-auto max-w-7xl">
          <h2 className="text-3xl font-bold tracking-tight" style={{ color: primary }}>{data.site.name || data.agency.name}</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">{data.agency.description || 'Browse our exclusive property inventory.'}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search location..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Button variant={type === 'all' ? 'default' : 'outline'} onClick={() => setType('all')}>All</Button>
            <Button variant={type === 'sale' ? 'default' : 'outline'} onClick={() => setType('sale')}>Buy</Button>
            <Button variant={type === 'rent' ? 'default' : 'outline'} onClick={() => setType('rent')}>Rent</Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <h3 className="mb-4 text-lg font-semibold">{listings.length} properties</h3>
        {listings.length === 0 ? (
          <p className="text-muted-foreground">No listings match your filters.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((p: any) => (
              <PropertyCard key={p.id} property={p} to={`/site/${subdomain}/property/${p.id}`} />
            ))}
          </div>
        )}
      </section>

      <section className="border-t bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h3 className="mb-4 text-lg font-semibold">Our agents</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(data.agents || []).map((agent: any) => (
              <Link key={agent.id} to={`/public/agent/${agent.id}`} className="rounded-xl border p-4 hover:bg-muted/30">
                <p className="font-medium">{agent.name}</p>
                <p className="text-sm text-muted-foreground">{agent.specialization}</p>
              </Link>
            ))}
          </div>
          {data.agency.address && (
            <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />{data.agency.address}
            </p>
          )}
        </div>
      </section>

      <section className="border-t px-4 py-10 sm:px-6 lg:px-8" style={{ background: `${primary}08` }}>
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2">
          <div>
            <h3 className="text-lg font-semibold">Contact {data.agency.name}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Leads from this site are routed into the agency dashboard with source attribution.
            </p>
          </div>
          <form onSubmit={sendContact} className="space-y-3 rounded-xl border bg-white p-4">
            <div>
              <Label>Name</Label>
              <Input required value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} />
            </div>
            <div>
              <Label>Email</Label>
              <Input required type="email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} />
            </div>
            <div>
              <Label>Message</Label>
              <textarea
                required
                rows={3}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={contact.message}
                onChange={(e) => setContact((c) => ({ ...c, message: e.target.value }))}
              />
            </div>
            {contactMsg && <p className="text-sm text-muted-foreground">{contactMsg}</p>}
            <Button type="submit" disabled={sending} style={{ background: primary }}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send message'}
            </Button>
          </form>
        </div>
      </section>
    </div>
  )
}
