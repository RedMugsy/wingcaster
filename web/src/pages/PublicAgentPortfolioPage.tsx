import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Phone, Mail, Star, Loader2, ArrowLeft, MapPin, Calendar, Building2, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PropertyCard } from '@/components/PropertyCard'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { api } from '@/api/client'

export function PublicAgentPortfolioPage() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [portfolio, setPortfolio] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [inquiryOpen, setInquiryOpen] = useState(false)
  const [inquiryForm, setInquiryForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [inquiryMsg, setInquiryMsg] = useState('')

  usePageTitle(portfolio?.agent?.name || 'Agent Portfolio')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api.getPublicAgentPortfolio(id)
      .then((data) => {
        setPortfolio(data)
        setLoading(false)
      })
      .catch((err: any) => {
      addToast({ title: 'Failed to load portfolio', description: err.message || 'Could not load agent portfolio', variant: 'error' })
      setLoading(false)
    })
  }, [id, addToast])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!portfolio) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Agent not found</h2>
          <Link to="/agents"><Button className="mt-4">Browse Agents</Button></Link>
        </div>
      </div>
    )
  }

  const agent = portfolio.agent || portfolio
  const listings = portfolio.listings || agent.listings || []
  const reviews = portfolio.reviews || agent.reviews || []
  const transactions = portfolio.transactions || portfolio.sold_portfolio || agent.transactions || []
  const agency = portfolio.agency
  const languages = Array.isArray(agent.languages) ? agent.languages.join(', ') : agent.languages
  const totalVolume = transactions.reduce((s: number, t: any) => s + (t.price || 0), 0)

  const sendInquiry = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.createInquiry({
        agent_id: agent.id,
        name: inquiryForm.name,
        email: inquiryForm.email,
        phone: inquiryForm.phone,
        message: inquiryForm.message || `Inquiry for agent ${agent.name}`,
        property_title: `Agent contact: ${agent.name}`,
        source: 'agent_portfolio',
        channel: 'web',
      })
      setInquiryMsg('Message sent.')
      setInquiryOpen(false)
    } catch (err: any) {
      setInquiryMsg(err.message || 'Failed to send')
    }
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="bg-white border-b">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-primary">
            <ArrowLeft className="h-4 w-4" />Back to Agents
          </Link>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <Avatar className="h-24 w-24 border-4 border-primary/10">
              <AvatarImage src={agent.photo} />
              <AvatarFallback>{agent.name?.split(' ').map((n: string) => n[0]).join('')}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold">{agent.name}</h1>
                {(agent.verified === 1 || agent.verified === true) && <Badge>Verified</Badge>}
              </div>
              <p className="mt-1 text-muted-foreground">
                {agent.specialization}
                {agency ? <> &bull; <Link className="text-primary hover:underline" to={`/public/agency/${agency.id}`}>{agency.name}</Link></> : <> &bull; {agent.agency_name}</>}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1">
                  <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                  <span className="font-bold">{agent.rating}</span>
                  <span className="text-sm text-muted-foreground">({agent.review_count} reviews)</span>
                </div>
                {agent.experience_since && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />Since {agent.experience_since}
                  </span>
                )}
                {languages && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />{languages}
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {agent.phone && (
                  <Button className="gap-2" asChild>
                    <a href={`tel:${String(agent.phone).replace(/\s/g, '')}`}><Phone className="h-4 w-4" />{agent.phone}</a>
                  </Button>
                )}
                <Button variant="outline" className="gap-2" onClick={() => setInquiryOpen(true)}>
                  <Mail className="h-4 w-4" />Email Agent
                </Button>
              </div>
              {inquiryMsg && <p className="mt-2 text-sm text-green-700">{inquiryMsg}</p>}
              {inquiryOpen && (
                <form onSubmit={sendInquiry} className="mt-4 max-w-md space-y-2 rounded-lg border p-4">
                  <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Your name" required value={inquiryForm.name} onChange={(e) => setInquiryForm((f) => ({ ...f, name: e.target.value }))} />
                  <input className="w-full rounded-md border px-3 py-2 text-sm" type="email" placeholder="Email" required value={inquiryForm.email} onChange={(e) => setInquiryForm((f) => ({ ...f, email: e.target.value }))} />
                  <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Phone" value={inquiryForm.phone} onChange={(e) => setInquiryForm((f) => ({ ...f, phone: e.target.value }))} />
                  <textarea className="w-full rounded-md border px-3 py-2 text-sm" rows={3} placeholder="Message" required value={inquiryForm.message} onChange={(e) => setInquiryForm((f) => ({ ...f, message: e.target.value }))} />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">Send</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setInquiryOpen(false)}>Cancel</Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Active Listings', value: listings.length, icon: Building2 },
            { label: 'Closed Deals', value: transactions.length, icon: TrendingUp },
            { label: 'Total Volume', value: '$' + (totalVolume / 1000000).toFixed(1) + 'M', icon: TrendingUp },
            { label: 'Reviews', value: agent.review_count || reviews.length || 0, icon: Star },
          ].map((stat) => {
            const Icon = stat.icon
            return (
              <Card key={stat.label}>
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="rounded-lg bg-muted p-3"><Icon className="h-6 w-6 text-primary" /></div>
                  <div><p className="text-2xl font-bold">{stat.value}</p><p className="text-sm text-muted-foreground">{stat.label}</p></div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {agent.bio && (
          <Card className="mb-8">
            <CardHeader><CardTitle>About</CardTitle></CardHeader>
            <CardContent><p className="text-muted-foreground">{agent.bio}</p></CardContent>
          </Card>
        )}

        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4">Current Listings ({listings.length})</h2>
          {listings.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((prop: any) => (
                <PropertyCard key={prop.id} property={prop} />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No active listings.</p>
          )}
        </div>

        {reviews.length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Client Reviews</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {reviews.map((review: any) => (
                <Card key={review.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-4 w-4 ${i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted'}`} />
                        ))}
                      </div>
                      {review.verified_transaction ? <Badge variant="secondary" className="text-xs">Verified</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">&ldquo;{review.comment}&rdquo;</p>
                    <p className="mt-2 text-xs font-medium">— {review.reviewer_name}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
