import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { MapPin, Bed, Bath, Maximize, Share2, Phone, Mail, Calendar, Check, Info, School, Footprints, Bus, Thermometer, Eye, BarChart3, Loader2, MessageCircle, Building2, User, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { api } from '@/api/client'
import { MarketContextCard } from '@/components/market-pricing/MarketContextCard'
import { ComparableListModal } from '@/components/market-pricing/ComparableListModal'
import { TrendMiniChart } from '@/components/market-pricing/TrendMiniChart'
import type { PricingAnalysis, PricingTrendSnapshot } from '@/types/marketPricing'

export function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [activeImage, setActiveImage] = useState(0)
  const [property, setProperty] = useState<any>(null)
  const [agent, setAgent] = useState<any>(null)
  const [stats, setStats] = useState<any>(null)
  const [pricingAnalysis, setPricingAnalysis] = useState<PricingAnalysis | null>(null)
  const [pricingComparables, setPricingComparables] = useState<any[]>([])
  const [pricingTrends, setPricingTrends] = useState<PricingTrendSnapshot[]>([])
  const [showComparablesModal, setShowComparablesModal] = useState(false)
  const [comps, setComps] = useState<any[]>([])
  const [priceHistory, setPriceHistory] = useState<any[]>([])
  const [reviews, setReviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [mortgagePrice, setMortgagePrice] = useState(0)
  const [downPayment, setDownPayment] = useState(20)
  const [loanYears, setLoanYears] = useState(20)
  const [interestRate, setInterestRate] = useState(6.5)
  const [showInquiry, setShowInquiry] = useState(false)
  const [inquiryForm, setInquiryForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [inquirySending, setInquirySending] = useState(false)
  const [inquiryMsg, setInquiryMsg] = useState('')
  const [shareMsg, setShareMsg] = useState('')
  const [ctaConfig, setCtaConfig] = useState<any>(null)
  const [ctaLoading, setCtaLoading] = useState(true)
  const [activeCta, setActiveCta] = useState<'contact' | 'schedule_call' | 'book_viewing' | null>(null)
  const [contactMode, setContactMode] = useState<'email' | 'whatsapp' | null>(null)
  const [scheduleForm, setScheduleForm] = useState({ name: '', email: '', phone: '', date: '', notes: '' })
  const [bookingForm, setBookingForm] = useState({ name: '', email: '', phone: '', date: '', mode: 'in_person', notes: '' })
  const [ctaSubmitting, setCtaSubmitting] = useState(false)
  usePageTitle(property?.title || 'Property Details')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      api.getProperty(id),
      api.getPricingAnalysis(id).catch((err: any) => {
        addToast({ title: 'Failed to load market analysis', description: err.message || 'Could not load pricing analysis', variant: 'error' })
        return null
      }),
      api.getPricingComparables(id).catch((err: any) => {
        addToast({ title: 'Failed to load comparables', description: err.message || 'Could not load comparable properties', variant: 'error' })
        return []
      }),
      api.getPriceHistory(id).catch((err: any) => {
        addToast({ title: 'Failed to load price history', description: err.message || 'Could not load price history', variant: 'error' })
        return []
      }),
    ]).then(([prop, analysis, compList, history]) => {
      setProperty(prop)
      setMortgagePrice(prop.price)
      setPricingAnalysis(analysis)
      setPricingComparables(compList)
      setComps(compList)
      setPriceHistory(history)
      const areaId = prop.area_id || prop.area_profile_id
      if (areaId && prop.property_type) {
        api.getPricingTrends(String(areaId), String(prop.property_type))
          .then(setPricingTrends)
          .catch(() => setPricingTrends([]))
      } else {
        setPricingTrends([])
      }
      setInquiryForm((f) => ({
        ...f,
        message: `Hi, I'm interested in "${prop.title}" (${prop.reference || prop.id}). Please contact me.`,
      }))
      if (prop.agent_id) {
        api.getAgent(prop.agent_id).then(setAgent).catch((err: any) => {
          addToast({ title: 'Failed to load agent details', description: err.message || 'Could not load agent', variant: 'error' })
        })
        api.getAgentReviews(prop.agent_id).then(setReviews).catch((err: any) => {
          addToast({ title: 'Failed to load reviews', description: err.message || 'Could not load reviews', variant: 'error' })
        })
      }
      if (prop.neighborhood) {
        api.getNeighborhoodStats(prop.neighborhood).then(setStats).catch((err: any) => {
          addToast({ title: 'Failed to load neighborhood stats', description: err.message || 'Could not load neighborhood stats', variant: 'error' })
        })
      }
      api.getPropertyCtaConfig(id).then(setCtaConfig).catch((err: any) => {
        addToast({ title: 'Failed to load CTA config', description: err.message || 'Could not load contact options', variant: 'error' })
      }).finally(() => setCtaLoading(false))
      setLoading(false)
    }).catch((err: any) => {
      addToast({ title: 'Failed to load property', description: err.message || 'Could not load property details', variant: 'error' })
      setLoading(false)
    })
  }, [id, addToast])

  const handleShare = async () => {
    try {
      const payload = await api.getSharePayload(property.id)
      const shareData = { title: payload.title, text: payload.description, url: window.location.href }
      if (navigator.share) {
        await navigator.share(shareData)
      } else {
        await navigator.clipboard.writeText(window.location.href)
        setShareMsg('Link copied')
        setTimeout(() => setShareMsg(''), 2000)
      }
    } catch {
      try {
        await navigator.clipboard.writeText(window.location.href)
        setShareMsg('Link copied')
        setTimeout(() => setShareMsg(''), 2000)
      } catch {
        setShareMsg('Unable to share')
      }
    }
  }

  const handleInquiry = async (e: React.FormEvent) => {
    e.preventDefault()
    setInquirySending(true)
    setInquiryMsg('')
    try {
      await api.createInquiry({
        property_id: property.id,
        property_title: property.title,
        name: inquiryForm.name,
        email: inquiryForm.email,
        phone: inquiryForm.phone,
        message: inquiryForm.message,
        source: 'marketplace',
        channel: 'web',
      })
      setInquiryMsg('Message sent. The agent will contact you soon.')
      setShowInquiry(false)
      setInquiryForm((f) => ({ ...f, name: '', email: '', phone: '' }))
    } catch (err: any) {
      setInquiryMsg(err.message || 'Failed to send inquiry')
    } finally {
      setInquirySending(false)
    }
  }

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setCtaSubmitting(true)
    try {
      const mode = ctaConfig?.cta_config?.contact?.mode || 'direct'
      const channel = contactMode || 'email'
      await api.createInquiry({
        property_id: property.id,
        property_title: property.title,
        name: inquiryForm.name,
        email: inquiryForm.email,
        phone: inquiryForm.phone,
        message: inquiryForm.message,
        source: 'marketplace',
        channel: channel === 'whatsapp' ? 'whatsapp' : 'web',
        contact_mode: mode,
      })
      setInquiryMsg(mode === 'platform_routed' ? 'Thank you. We have received your request and will forward it to the agent.' : 'Message sent. The agent will contact you soon.')
      setActiveCta(null)
      setInquiryForm({ name: '', email: '', phone: '', message: '' })
    } catch (err: any) {
      setInquiryMsg(err.message || 'Failed to send message')
    } finally {
      setCtaSubmitting(false)
    }
  }

  const handleScheduleCall = async (e: React.FormEvent) => {
    e.preventDefault()
    setCtaSubmitting(true)
    try {
      const inquiry = await api.createInquiry({
        property_id: property.id,
        property_title: property.title,
        name: scheduleForm.name,
        email: scheduleForm.email,
        phone: scheduleForm.phone,
        message: `Request to schedule a call. Notes: ${scheduleForm.notes}`,
        source: 'marketplace',
        channel: 'web',
      })
      if (agent?.id) {
        await api.scheduleCall({
          contact_id: inquiry?.contact_id || null,
          inquiry_id: inquiry?.id || null,
          assigned_to: agent.id,
          type: 'call',
          title: `Call request for ${property.title}`,
          notes: scheduleForm.notes,
          due_at: new Date(scheduleForm.date).toISOString(),
          priority: 'normal',
        }).catch(() => {})
      }
      setInquiryMsg('Call request sent. The agent will contact you to confirm.')
      setActiveCta(null)
      setScheduleForm({ name: '', email: '', phone: '', date: '', notes: '' })
    } catch (err: any) {
      setInquiryMsg(err.message || 'Failed to schedule call')
    } finally {
      setCtaSubmitting(false)
    }
  }

  const handleBookViewing = async (e: React.FormEvent) => {
    e.preventDefault()
    setCtaSubmitting(true)
    try {
      const inquiry = await api.createInquiry({
        property_id: property.id,
        property_title: property.title,
        name: bookingForm.name,
        email: bookingForm.email,
        phone: bookingForm.phone,
        message: `Request to book a viewing. Preferred time: ${bookingForm.date}. Mode: ${bookingForm.mode}. Notes: ${bookingForm.notes}`,
        source: 'marketplace',
        channel: 'web',
      })
      if (inquiry?.id) {
        await api.bookViewing({
          inquiry_id: inquiry.id,
          property_id: property.id,
          scheduled_at: new Date(bookingForm.date).toISOString(),
          mode: bookingForm.mode,
          location: 'To be confirmed',
          notes: bookingForm.notes,
        }).catch(() => {})
      }
      setInquiryMsg('Viewing request sent. The agent will confirm the appointment.')
      setActiveCta(null)
      setBookingForm({ name: '', email: '', phone: '', date: '', mode: 'in_person', notes: '' })
    } catch (err: any) {
      setInquiryMsg(err.message || 'Failed to book viewing')
    } finally {
      setCtaSubmitting(false)
    }
  }

  const startWhatsApp = () => {
    const phone = agent?.phone || ''
    if (!phone) return
    const text = encodeURIComponent(`Hi, I'm interested in ${property.title}`)
    window.open(`https://wa.me/${String(phone).replace(/\D/g, '')}?text=${text}`, '_blank')
  }

  const startEmail = () => {
    const email = agent?.email || ''
    if (!email) return
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Inquiry about ${property.title}`)}&body=${encodeURIComponent(`Hi, I'm interested in ${property.title}`)}`
  }
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    )
  }

  if (!property) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Property Not Found</h2>
          <Button className="mt-4" onClick={() => navigate('/search')}>Back to Search</Button>
        </div>
      </div>
    )
  }

  const formatPrice = (price: number | null | undefined) => {
    if (price == null || !Number.isFinite(Number(price))) return 'N/A'
    price = Number(price)
    if (price >= 1000000) return `$${(price / 1000000).toFixed(2)}M`
    return `$${(price / 1000).toFixed(0)}K`
  }

  const monthlyPayment = () => {
    const principal = mortgagePrice * (1 - downPayment / 100)
    const monthlyRate = interestRate / 100 / 12
    const numPayments = loanYears * 12
    if (monthlyRate === 0) return principal / numPayments
    return (principal * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1)
  }

  const avgPriceInArea = stats?.avg_price || property.price
  const priceDiff = ((property.price - avgPriceInArea) / avgPriceInArea * 100)

  const marketTempColor = (temp: string) => {
    if (temp === 'Very Hot') return 'text-red-600 bg-red-50'
    if (temp === 'Hot') return 'text-orange-600 bg-orange-50'
    if (temp === 'Warm') return 'text-yellow-600 bg-yellow-50'
    return 'text-blue-600 bg-blue-50'
  }

  const scoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Image Gallery */}
      <div className="relative bg-black">
        <div className="mx-auto max-w-7xl">
          <div className="relative aspect-[16/9] md:aspect-[21/9]">
            <img src={property.photos[activeImage]} alt={property.title} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute left-4 top-4 flex gap-2">
              <Badge variant={property.type === 'sale' ? 'default' : 'secondary'} className="text-sm">
                {property.type === 'sale' ? 'For Sale' : 'For Rent'}
              </Badge>
              {property.featured ? <Badge variant="destructive">Featured</Badge> : null}
            </div>
            <div className="absolute right-4 top-4 flex gap-2">
              <button type="button" onClick={handleShare} className="rounded-full bg-white/90 p-2.5 shadow-sm hover:bg-white">
                <Share2 className="h-5 w-5" />
              </button>
            </div>
            {shareMsg && <div className="absolute right-4 top-16 rounded bg-black/70 px-3 py-1 text-xs text-white">{shareMsg}</div>}
          </div>
          {property.photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto bg-black p-3">
              {property.photos.map((photo: string, i: number) => {
                const mediaMeta = (property as any).media?.[i]
                return (
                <button type="button" aria-label={`View image ${i + 1}`} key={i} onClick={() => setActiveImage(i)}
                  className={`relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-md border-2 ${i === activeImage ? 'border-primary' : 'border-transparent'}`}>
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                  {mediaMeta?.classification && (
                    <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-[9px] text-white truncate">
                      {mediaMeta.classification}
                    </span>
                  )}
                </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">{property.title}</h1>
              <p className="mt-2 flex items-center gap-1 text-muted-foreground"><MapPin className="h-4 w-4" />{property.address}</p>
            </div>

            {/* Price + Zestimate Bar */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2">
                <span className="text-2xl font-bold text-primary">{formatPrice(property.price)}</span>
                {property.type === 'rent' && property.price_unit ? <span className="text-sm text-muted-foreground">/{property.price_unit}</span> : null}
              </div>
              {pricingAnalysis && pricingAnalysis.comparable_count > 0 && (
                <div className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  <div>
                    <span className="text-sm text-muted-foreground">REB Price Index</span>
                    <span className="ml-2 font-bold">
                      {formatPrice(pricingAnalysis.lowest_price)} – {formatPrice(pricingAnalysis.highest_price)}
                    </span>
                    <span className={`ml-1 text-xs ${(pricingAnalysis.target_vs_median_percent || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {(pricingAnalysis.target_vs_median_percent || 0) > 0 ? '+' : ''}{Math.abs(pricingAnalysis.target_vs_median_percent || 0).toFixed(0)}% median
                    </span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-6 text-sm">
                {property.bedrooms > 0 && <span className="flex items-center gap-1.5"><Bed className="h-5 w-5 text-muted-foreground" /><span className="font-medium">{property.bedrooms}</span> Beds</span>}
                <span className="flex items-center gap-1.5"><Bath className="h-5 w-5 text-muted-foreground" /><span className="font-medium">{property.bathrooms}</span> Baths</span>
                <span className="flex items-center gap-1.5"><Maximize className="h-5 w-5 text-muted-foreground" /><span className="font-medium">{property.area}</span> {property.area_unit}</span>
              </div>
            </div>

            {Array.isArray(property.offers) && property.offers.length > 0 && (
              <div className="rounded-xl border bg-white p-4">
                <h2 className="font-semibold mb-3">Also offered by</h2>
                <div className="space-y-3">
                  {property.offers.map((offer: any) => (
                    <Link key={offer.id} to={`/listings/${offer.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40">
                      <div>
                        <p className="font-medium text-sm">{offer.agent_name || 'Agent'}</p>
                        <p className="text-xs text-muted-foreground">{offer.agency_name || offer.listing_owner_type || 'Independent'}</p>
                      </div>
                      <p className="font-semibold text-primary">${Number(offer.price || 0).toLocaleString()}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Neighborhood Scores */}
            {stats && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border bg-white p-3 text-center">
                  <Footprints className="mx-auto mb-1 h-5 w-5 text-primary" />
                  <div className={`text-lg font-bold ${scoreColor(stats.walk_score)}`}>{stats.walk_score}</div>
                  <div className="text-xs text-muted-foreground">Walk Score</div>
                </div>
                <div className="rounded-lg border bg-white p-3 text-center">
                  <School className="mx-auto mb-1 h-5 w-5 text-primary" />
                  <div className="text-lg font-bold">{stats.school_rating}</div>
                  <div className="text-xs text-muted-foreground">School Rating</div>
                </div>
                <div className="rounded-lg border bg-white p-3 text-center">
                  <Bus className="mx-auto mb-1 h-5 w-5 text-primary" />
                  <div className={`text-lg font-bold ${scoreColor(stats.transit_score)}`}>{stats.transit_score}</div>
                  <div className="text-xs text-muted-foreground">Transit Score</div>
                </div>
                <div className="rounded-lg border bg-white p-3 text-center">
                  <Thermometer className="mx-auto mb-1 h-5 w-5 text-primary" />
                  <Badge className={marketTempColor(stats.market_temp)}>{stats.market_temp}</Badge>
                  <div className="text-xs text-muted-foreground">Market Temp</div>
                </div>
              </div>
            )}

            <Tabs defaultValue="details">
              <TabsList className="w-full justify-start flex-wrap">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="amenities">Amenities</TabsTrigger>
                <TabsTrigger value="price-index">REB Price Index</TabsTrigger>
                <TabsTrigger value="comps">Comparables</TabsTrigger>
                <TabsTrigger value="mortgage">Mortgage</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="mt-4 space-y-4">
                <div className="rounded-xl border bg-white p-6">
                  <h3 className="mb-3 text-lg font-semibold">Description</h3>
                  <p className="leading-relaxed text-muted-foreground">{property.description}</p>
                </div>
                <div className="rounded-xl border bg-white p-6">
                  <h3 className="mb-3 text-lg font-semibold">Property Information</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[
                      { label: 'Reference', value: property.reference },
                      { label: 'Property Type', value: property.property_type?.charAt(0).toUpperCase() + property.property_type?.slice(1) },
                      { label: 'Furnished', value: property.furnished ? 'Yes' : 'No' },
                      { label: 'Listed Date', value: property.listed_date },
                      { label: 'Permit Number', value: property.permit_number },
                      { label: 'Views', value: property.views?.toLocaleString() },
                      { label: 'Developed By', value: (property as any).developed_by || '—' },
                      { label: 'Interior Design by', value: (property as any).interior_design_by || '—' },
                      {
                        label: 'Geo-location',
                        value: property.latitude != null && property.longitude != null
                          ? `${property.latitude}, ${property.longitude}`
                          : '—',
                      },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between border-b pb-2 gap-3">
                        <span className="text-sm text-muted-foreground shrink-0">{item.label}</span>
                        <span className="text-sm font-medium text-right">{item.value}</span>
                      </div>
                    ))}
                  </div>
                  {property.latitude != null && property.longitude != null && (
                    <a
                      className="mt-4 inline-flex text-sm text-primary underline"
                      href={`https://www.google.com/maps?q=${property.latitude},${property.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Google Maps
                    </a>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="amenities" className="mt-4">
                <div className="rounded-xl border bg-white p-6">
                  <h3 className="mb-4 text-lg font-semibold">Amenities & Features</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {property.amenities?.map((amenity: string) => (
                      <div key={amenity} className="flex items-center gap-2"><Check className="h-4 w-4 text-green-500" /><span className="text-sm">{amenity}</span></div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="price-index" className="mt-4">
                <div className="rounded-xl border bg-white p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-primary" />
                      REB Price Index
                    </h3>
                    {pricingAnalysis?.calculated_at && (
                      <span className="text-xs text-muted-foreground">
                        Updated {pricingAnalysis.calculated_at.split('T')[0]}
                      </span>
                    )}
                  </div>

                  {pricingAnalysis ? (
                    <div className="space-y-6">
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="rounded-lg bg-green-50 p-4 text-center border border-green-200">
                          <p className="text-sm text-muted-foreground">Comparable Range</p>
                          <p className="text-xl font-bold text-green-700">{formatPrice(pricingAnalysis.lowest_price)} – {formatPrice(pricingAnalysis.highest_price)}</p>
                        </div>
                        <div className="rounded-lg bg-primary/5 p-4 text-center border">
                          <p className="text-sm text-muted-foreground">Market Median</p>
                          <p className="text-2xl font-bold text-primary">{formatPrice(pricingAnalysis.median_price)}</p>
                        </div>
                        <div className="rounded-lg bg-muted/50 p-4 text-center border">
                          <p className="text-sm text-muted-foreground">List Price</p>
                          <p className="text-xl font-bold">{formatPrice(property.price)}</p>
                          <p className={`text-xs ${(pricingAnalysis.target_vs_median_percent || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {(pricingAnalysis.target_vs_median_percent || 0) > 0 ? '+' : ''}{(pricingAnalysis.target_vs_median_percent || 0).toFixed(0)}% vs median
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-lg border p-4">
                          <p className="text-sm font-medium mb-2">Analysis Details</p>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Confidence</span><span className="font-medium capitalize">{pricingAnalysis.confidence}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Comparables Used</span><span className="font-medium">{pricingAnalysis.comparable_count}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Mean Price</span><span className="font-medium">{formatPrice(pricingAnalysis.mean_price)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Price / sqm (median)</span><span className="font-medium">{pricingAnalysis.median_price && property.area ? `$${Math.round(pricingAnalysis.median_price / property.area).toLocaleString()}` : 'N/A'}</span></div>
                          </div>
                        </div>
                        <div className="rounded-lg border p-4">
                          <p className="text-sm font-medium mb-2">Percentiles</p>
                          <div className="space-y-3">
                            {[
                              { label: '25th percentile', value: pricingAnalysis.percentile_25 },
                              { label: '50th percentile (median)', value: pricingAnalysis.median_price },
                              { label: '75th percentile', value: pricingAnalysis.percentile_75 },
                            ].map((item) => (
                              <div key={item.label} className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">{item.label}</span>
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-primary"
                                      style={{ width: `${pricingAnalysis.highest_price && item.value ? Math.min((item.value / pricingAnalysis.highest_price) * 100, 100) : 0}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-medium">{formatPrice(item.value)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border p-4">
                        <p className="text-sm font-medium mb-2">Market Context</p>
                        <p className="text-sm text-muted-foreground">{pricingAnalysis.market_context_sentence || 'No market context available.'}</p>
                      </div>

                      <div className="rounded-lg border p-4">
                        <p className="mb-2 text-sm font-medium">Area trend</p>
                        <TrendMiniChart snapshots={pricingTrends} />
                      </div>

                      {priceHistory.length > 0 && (
                        <div className="rounded-lg border p-4">
                          <p className="mb-2 text-sm font-medium">Listing price history</p>
                          <div className="space-y-2 text-sm">
                            {priceHistory.slice(0, 8).map((entry: any, index: number) => (
                              <div key={entry.id || index} className="flex justify-between gap-3">
                                <span className="text-muted-foreground">{entry.date ? new Date(entry.date).toLocaleDateString() : 'Date unavailable'}</span>
                                <span className="font-medium">{formatPrice(entry.price)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border p-4 text-sm">
                        <p className="font-medium">Method and rate provenance</p>
                        <p className="mt-1 text-muted-foreground">
                          Weighted robust estimator using similarity and recency-weighted comparable evidence. Effective sample confidence: {pricingAnalysis.confidence}.
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <p><span className="text-muted-foreground">Normalized currency:</span> {pricingAnalysis.currency_normalized || 'N/A'}</p>
                          <p><span className="text-muted-foreground">Rate source:</span> {pricingAnalysis.rate_source || 'Not required / unavailable'}</p>
                          <p><span className="text-muted-foreground">Rate effective:</span> {pricingAnalysis.rate_effective_at ? new Date(pricingAnalysis.rate_effective_at).toLocaleString() : 'N/A'}</p>
                          <p><span className="text-muted-foreground">Rate status:</span> {pricingAnalysis.rate_is_stale ? 'Stale — use caution' : 'Fresh or not required'}</p>
                        </div>
                      </div>

                      <div className="rounded-lg border p-4">
                        <p className="text-sm text-muted-foreground">
                          <Info className="inline h-4 w-4 mr-1" />
                          The REB Price Index is a comparable-market analysis, not an appraisal or guarantee. Asking prices may differ from completed transactions. Currency rates are accepted for up to seven days only and are visibly flagged after 24 hours.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">REB Price Index data is not available for this property yet.</div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="comps" className="mt-4">
                <div className="rounded-xl border bg-white p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Comparable Properties</h3>
                    {pricingComparables.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setShowComparablesModal(true)}>
                        View all {pricingComparables.length}
                      </Button>
                    )}
                  </div>
                  {pricingComparables.length > 0 ? (
                    <div className="space-y-3">
                      {pricingComparables.slice(0, 5).map((comp: any) => (
                        <div key={comp.id} className="flex items-center gap-4 rounded-lg border p-3 hover:bg-muted/30 transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{comp.title || comp.location_text || 'Comparable'}</p>
                            <p className="text-xs text-muted-foreground">
                              {comp.city || comp.location_text || ''} • {comp.bedrooms ?? '-'} Beds • {comp.area ?? comp.area_sqm ?? '-'} {property.area_unit}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold">{formatPrice(comp.normalized_price ?? comp.price)}</p>
                            <p className="text-xs text-muted-foreground">score {Number(comp.weight ?? comp.similarity_score ?? 0).toFixed(3)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">No comparable properties found.</div>
                  )}
                </div>
              </TabsContent>

              {showComparablesModal && (
                <ComparableListModal
                  property={property}
                  comparables={pricingComparables}
                  onClose={() => setShowComparablesModal(false)}
                />
              )}

              <TabsContent value="mortgage" className="mt-4">
                <div className="rounded-xl border bg-white p-6">
                  <h3 className="mb-4 text-lg font-semibold">Mortgage Calculator</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">Purchase Price ($)</label>
                      <Input type="number" value={mortgagePrice || property.price} onChange={(e) => setMortgagePrice(Number(e.target.value))} className="h-10" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div><label className="mb-1.5 block text-sm font-medium">Down Payment (%)</label><Input type="number" value={downPayment} onChange={(e) => setDownPayment(Number(e.target.value))} className="h-10" /></div>
                      <div><label className="mb-1.5 block text-sm font-medium">Loan Term (Years)</label><Input type="number" value={loanYears} onChange={(e) => setLoanYears(Number(e.target.value))} className="h-10" /></div>
                      <div><label className="mb-1.5 block text-sm font-medium">Interest Rate (%)</label><Input type="number" step="0.1" value={interestRate} onChange={(e) => setInterestRate(Number(e.target.value))} className="h-10" /></div>
                    </div>
                    <div className="rounded-lg bg-primary/5 p-6 text-center">
                      <p className="text-sm text-muted-foreground">Estimated Monthly Payment</p>
                      <p className="text-3xl font-bold text-primary">${monthlyPayment().toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">with interest rate of {interestRate}%</p>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <MarketContextCard
              analysis={pricingAnalysis}
              onViewComparables={() => setShowComparablesModal(true)}
            />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Contact Agent</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {agent && (
                  <div className="flex items-center gap-3">
                    <Avatar className="h-14 w-14"><AvatarImage src={agent.photo} alt={agent.name} /><AvatarFallback>{agent.name?.split(' ').map((n: string) => n[0]).join('')}</AvatarFallback></Avatar>
                    <div><p className="font-semibold">{agent.name}</p><p className="text-sm text-muted-foreground">{ctaConfig?.agency_name || agent.agency_name}</p></div>
                  </div>
                )}
                {ctaLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : ctaConfig?.cta_config ? (
                  <div className="space-y-2">
                    {ctaConfig.cta_config.contact?.enabled && (
                      <Button className="w-full gap-2" onClick={() => { setActiveCta('contact'); setContactMode(null); setInquiryForm({ name: '', email: '', phone: '', message: '' }) }}>
                        <MessageCircle className="h-4 w-4" /> Contact
                      </Button>
                    )}
                    {ctaConfig.cta_config.schedule_call?.enabled && (
                      <Button variant="outline" className="w-full gap-2" onClick={() => { setActiveCta('schedule_call'); setScheduleForm({ name: '', email: '', phone: '', date: '', notes: '' }) }}>
                        <Phone className="h-4 w-4" /> Schedule a Call
                      </Button>
                    )}
                    {ctaConfig.cta_config.book_viewing?.enabled && (
                      <Button variant="outline" className="w-full gap-2" onClick={() => { setActiveCta('book_viewing'); setBookingForm({ name: '', email: '', phone: '', date: '', mode: 'in_person', notes: '' }) }}>
                        <Calendar className="h-4 w-4" /> Book a Viewing
                      </Button>
                    )}
                    {ctaConfig.cta_config.more_from_agent?.enabled && agent?.id && (
                      <Button variant="ghost" className="w-full gap-2 justify-start" onClick={() => navigate(`/agent/${agent.id}`)}>
                        <User className="h-4 w-4" /> {ctaConfig.cta_config.more_from_agent?.label || 'More from this agent'} <ArrowRight className="ml-auto h-4 w-4" />
                      </Button>
                    )}
                    {ctaConfig.cta_config.more_from_agency?.enabled && ctaConfig?.agency_id && (
                      <Button variant="ghost" className="w-full gap-2 justify-start" onClick={() => navigate(`/agency/${ctaConfig.agency_id}`)}>
                        <Building2 className="h-4 w-4" /> {ctaConfig.cta_config.more_from_agency?.label || 'More from this agency'} <ArrowRight className="ml-auto h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Contact options unavailable.</div>
                )}
                {inquiryMsg && <p className="text-sm text-green-700">{inquiryMsg}</p>}

                {/* Contact modal */}
                {activeCta === 'contact' && (
                  <div className="rounded-lg border p-3 space-y-3">
                    <p className="text-sm font-medium">How would you like to contact the agent?</p>
                    {!contactMode ? (
                      <div className="grid grid-cols-2 gap-2">
                        {ctaConfig.cta_config.contact?.channels?.includes('email') && (
                          <Button variant="outline" className="gap-2" onClick={() => { setContactMode('email'); setInquiryForm({ name: '', email: '', phone: '', message: '' }) }}>
                            <Mail className="h-4 w-4" /> Email
                          </Button>
                        )}
                        {ctaConfig.cta_config.contact?.channels?.includes('whatsapp') && agent?.phone && (
                          <Button variant="outline" className="gap-2" onClick={startWhatsApp}>
                            <MessageCircle className="h-4 w-4" /> WhatsApp
                          </Button>
                        )}
                      </div>
                    ) : (
                      <form onSubmit={handleContactSubmit} className="space-y-3">
                        <p className="text-xs text-muted-foreground">{ctaConfig.cta_config.contact?.mode === 'platform_routed' ? 'Your message will be routed through the platform.' : 'Your message will be sent directly to the agent.'}</p>
                        <div><Label className="text-xs">Name</Label><Input required value={inquiryForm.name} onChange={(e) => setInquiryForm((f) => ({ ...f, name: e.target.value }))} /></div>
                        <div><Label className="text-xs">Email</Label><Input required type="email" value={inquiryForm.email} onChange={(e) => setInquiryForm((f) => ({ ...f, email: e.target.value }))} /></div>
                        <div><Label className="text-xs">Phone</Label><Input value={inquiryForm.phone} onChange={(e) => setInquiryForm((f) => ({ ...f, phone: e.target.value }))} /></div>
                        <div><Label className="text-xs">Message</Label><textarea required rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={inquiryForm.message} onChange={(e) => setInquiryForm((f) => ({ ...f, message: e.target.value }))} /></div>
                        <div className="flex gap-2">
                          <Button type="submit" className="flex-1" disabled={ctaSubmitting}>{ctaSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}</Button>
                          <Button type="button" variant="ghost" onClick={() => setActiveCta(null)}>Cancel</Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* Schedule call modal */}
                {activeCta === 'schedule_call' && (
                  <form onSubmit={handleScheduleCall} className="rounded-lg border p-3 space-y-3">
                    <p className="text-sm font-medium">Request a call back</p>
                    <div><Label className="text-xs">Name</Label><Input required value={scheduleForm.name} onChange={(e) => setScheduleForm((f) => ({ ...f, name: e.target.value }))} /></div>
                    <div><Label className="text-xs">Email</Label><Input required type="email" value={scheduleForm.email} onChange={(e) => setScheduleForm((f) => ({ ...f, email: e.target.value }))} /></div>
                    <div><Label className="text-xs">Phone</Label><Input required value={scheduleForm.phone} onChange={(e) => setScheduleForm((f) => ({ ...f, phone: e.target.value }))} /></div>
                    <div><Label className="text-xs">Preferred date/time</Label><Input required type="datetime-local" value={scheduleForm.date} onChange={(e) => setScheduleForm((f) => ({ ...f, date: e.target.value }))} /></div>
                    <div><Label className="text-xs">Notes</Label><textarea rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={scheduleForm.notes} onChange={(e) => setScheduleForm((f) => ({ ...f, notes: e.target.value }))} /></div>
                    <div className="flex gap-2">
                      <Button type="submit" className="flex-1" disabled={ctaSubmitting}>{ctaSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Request Call'}</Button>
                      <Button type="button" variant="ghost" onClick={() => setActiveCta(null)}>Cancel</Button>
                    </div>
                  </form>
                )}

                {/* Book viewing modal */}
                {activeCta === 'book_viewing' && (
                  <form onSubmit={handleBookViewing} className="rounded-lg border p-3 space-y-3">
                    <p className="text-sm font-medium">Book a viewing</p>
                    <div><Label className="text-xs">Name</Label><Input required value={bookingForm.name} onChange={(e) => setBookingForm((f) => ({ ...f, name: e.target.value }))} /></div>
                    <div><Label className="text-xs">Email</Label><Input required type="email" value={bookingForm.email} onChange={(e) => setBookingForm((f) => ({ ...f, email: e.target.value }))} /></div>
                    <div><Label className="text-xs">Phone</Label><Input value={bookingForm.phone} onChange={(e) => setBookingForm((f) => ({ ...f, phone: e.target.value }))} /></div>
                    <div><Label className="text-xs">Preferred date/time</Label><Input required type="datetime-local" value={bookingForm.date} onChange={(e) => setBookingForm((f) => ({ ...f, date: e.target.value }))} /></div>
                    <div><Label className="text-xs">Mode</Label>
                      <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={bookingForm.mode} onChange={(e) => setBookingForm((f) => ({ ...f, mode: e.target.value }))}>
                        <option value="in_person">In person</option>
                        <option value="virtual">Virtual</option>
                      </select>
                    </div>
                    <div><Label className="text-xs">Notes</Label><textarea rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={bookingForm.notes} onChange={(e) => setBookingForm((f) => ({ ...f, notes: e.target.value }))} /></div>
                    <div className="flex gap-2">
                      <Button type="submit" className="flex-1" disabled={ctaSubmitting}>{ctaSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Book Viewing'}</Button>
                      <Button type="button" variant="ghost" onClick={() => setActiveCta(null)}>Cancel</Button>
                    </div>
                  </form>
                )}

                {agent?.id && (
                  <Button variant="ghost" className="w-full" onClick={() => navigate(`/agent/${agent.id}`)}>View Agent Profile</Button>
                )}
              </CardContent>
            </Card>

            <div className="rounded-xl border bg-white p-6">
              <h3 className="mb-3 text-sm font-semibold">Regulatory Information</h3>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>Reference: {property.reference}</p>
                <p>Broker License: {property.agent_license}</p>
                <p>Agency: {property.agency_name}</p>
                <p>Permit: {property.permit_number}</p>
              </div>
            </div>

            {/* View Stats */}
            <div className="rounded-xl border bg-white p-6">
              <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Eye className="h-4 w-4" /> Listing Activity</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total Views</span><span className="font-medium">{property.views?.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Listed</span><span className="font-medium">{property.listed_date}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
