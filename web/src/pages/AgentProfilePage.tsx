import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Star, Phone, Mail, MapPin, Calendar, Award, Building2, Loader2, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { PropertyCard } from '@/components/PropertyCard'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'

export function AgentProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [agent, setAgent] = useState<any>(null)
  const [listings, setListings] = useState<any[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [reviews, setReviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [following, setFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)

  usePageTitle(agent?.name ? `${agent.name} | Agent Profile` : 'Agent Profile')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      api.getAgent(id),
      api.getAgentTransactions(id),
      api.getAgentReviews(id),
    ]).then(([agentData, txData, reviewData]) => {
      setAgent(agentData)
      setTransactions(txData)
      setReviews(reviewData)
      setListings(agentData.listings || [])
      setLoading(false)
      api.getFollowingAgent(agentData.id).then((r) => setFollowing(!!r.following)).catch((err: any) => {
        addToast({ title: 'Could not check follow status', description: err.message, variant: 'error' })
      })
    }).catch((err: any) => {
      setLoading(false)
      addToast({ title: 'Failed to load agent profile', description: err.message || 'Could not load profile', variant: 'error' })
    })
  }, [id, addToast])

  const toggleFollow = async () => {
    if (!agent) return
    setFollowBusy(true)
    try {
      if (following) {
        await api.unfollowAgent(agent.id)
        setFollowing(false)
        addToast({ title: 'Unfollowed', variant: 'success' })
      } else {
        await api.followAgent(agent.id)
        setFollowing(true)
        addToast({ title: 'Following', variant: 'success' })
      }
    } catch (e: any) {
      addToast({ title: 'Follow action failed', description: e.message || 'Sign in as another agent to follow', variant: 'error' })
    } finally {
      setFollowBusy(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>
  }

  if (!agent) {
    return <div className="flex min-h-screen items-center justify-center"><div className="text-center"><h2 className="text-2xl font-bold">Agent Not Found</h2><Button className="mt-4" onClick={() => navigate('/agents')}>Back to Agents</Button></div></div>
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-12 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
            <Avatar className="h-24 w-24 border-4 border-white shadow-xl">
              <AvatarImage src={agent.photo} alt={agent.name} />
              <AvatarFallback className="text-2xl">{agent.name?.split(' ').map((n: string) => n[0]).join('')}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <h1 className="text-3xl font-bold">{agent.name}</h1>
                {agent.verified ? <Badge className="bg-green-500 text-white border-0"><Award className="mr-1 h-3 w-3" />Verified</Badge> : null}
              </div>
              <p className="mt-1 text-lg text-slate-300">{agent.specialization}</p>
              <p className="text-slate-400">{agent.agency_name} • License {agent.license_number}</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm sm:justify-start">
                <span className="flex items-center gap-1"><Star className="h-4 w-4 fill-yellow-400 text-yellow-400" /><strong>{agent.rating}</strong> ({agent.review_count} reviews)</span>
                <span className="flex items-center gap-1 text-slate-400"><Calendar className="h-4 w-4" />Since {agent.experience_since}</span>
                <span className="flex items-center gap-1 text-slate-400"><MapPin className="h-4 w-4" />{agent.languages}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button className="gap-2 bg-white text-slate-900 hover:bg-slate-100"><Phone className="h-4 w-4" />{agent.phone}</Button>
              <Button variant="outline" className="gap-2 border-white text-white hover:bg-white/10" onClick={toggleFollow} disabled={followBusy}>
                {following ? 'Following' : 'Follow'}
              </Button>
              {agent.engagement && (
                <p className="text-xs text-slate-300 text-center sm:text-left">
                  {agent.engagement.followers_total || 0} followers · {agent.engagement.views_total || 0} views
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border bg-white p-6">
              <h3 className="mb-3 text-lg font-semibold">About {agent.name}</h3>
              <p className="leading-relaxed text-muted-foreground">{agent.bio}</p>
            </div>

            {transactions.length > 0 && (
              <div className="rounded-xl border bg-white p-6">
                <h3 className="mb-4 text-lg font-semibold">Recent Transactions</h3>
                <div className="space-y-3">
                  {transactions.map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div><p className="font-medium">{t.location}</p><p className="text-xs text-muted-foreground">{t.property_type} • {t.bedrooms} • {t.date}</p></div>
                      <div className="text-right">
                        <Badge variant={t.deal_type === 'sale' ? 'default' : 'secondary'} className="mb-1">{t.deal_type === 'sale' ? 'Sold' : 'Rented'}</Badge>
                        <p className="font-semibold">${t.price.toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {reviews.length > 0 && (
              <div className="rounded-xl border bg-white p-6">
                <h3 className="mb-4 text-lg font-semibold">Reviews ({reviews.length})</h3>
                <div className="space-y-4">
                  {reviews.map((r: any) => (
                    <div key={r.id} className="border-b pb-4 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.reviewer_name}</span>
                          {r.verified_transaction ? <Badge variant="outline" className="text-xs gap-1"><CheckCircle className="h-3 w-3" />Verified</Badge> : null}
                        </div>
                        <div className="flex items-center gap-1"><Star className="h-4 w-4 fill-yellow-400 text-yellow-400" /><span className="font-medium">{r.rating}</span></div>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">"{r.comment}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {listings.length > 0 && (
              <div>
                <h3 className="mb-4 text-lg font-semibold">Active Listings ({listings.length})</h3>
                <div className="grid gap-6 sm:grid-cols-2">
                  {listings.map((p: any) => <PropertyCard key={p.id} property={p} />)}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border bg-white p-6">
              <h3 className="mb-4 text-lg font-semibold">Agent Stats</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Active Listings</span><span className="font-semibold">{listings.length}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Total Views</span><span className="font-semibold">{listings.reduce((acc: number, p: any) => acc + (p.views || 0), 0).toLocaleString()}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Rating</span><span className="flex items-center gap-1 font-semibold"><Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />{agent.rating}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Reviews</span><span className="font-semibold">{agent.review_count}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Experience</span><span className="font-semibold">{new Date().getFullYear() - agent.experience_since} years</span></div>
              </div>
            </div>

            <div className="rounded-xl border bg-white p-6">
              <h3 className="mb-4 text-lg font-semibold">Contact Information</h3>
              <div className="space-y-3 text-sm">
                <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{agent.phone}</p>
                <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" />{agent.email}</p>
                <p className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{agent.agency_name}</p>
              </div>
              <Separator className="my-4" />
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>Broker License: {agent.license_number}</p>
                <p>Agency License: {agent.agency_license}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
