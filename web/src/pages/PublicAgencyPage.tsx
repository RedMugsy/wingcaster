import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Building2, MapPin, Phone, Mail, Globe, Star, Loader2, ArrowLeft, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PropertyCard } from '@/components/PropertyCard'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { api } from '@/api/client'

export function PublicAgencyPage() {
  const { id } = useParams<{ id: string }>()
  const { addToast } = useToast()
  const [agency, setAgency] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  usePageTitle(agency?.name || 'Agency')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api.getPublicAgency(id)
      .then(data => { setAgency(data); setLoading(false) })
      .catch((err: any) => {
      addToast({ title: 'Failed to load agency', description: err.message || 'Could not load agency', variant: 'error' })
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

  if (!agency) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Agency not found</h2>
          <Link to="/agents"><Button className="mt-4">Browse Agents</Button></Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Agency Header */}
      <div className="bg-white border-b">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-primary">
            <ArrowLeft className="h-4 w-4" />Back to Agents
          </Link>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="rounded-xl bg-primary/10 p-6">
              <Building2 className="h-16 w-16 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold">{agency.name}</h1>
              <p className="mt-2 text-muted-foreground max-w-2xl">{agency.description}</p>
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                {agency.license_number && <span className="flex items-center gap-1"><Badge variant="outline">License {agency.license_number}</Badge></span>}
                {agency.phone && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="h-4 w-4" />{agency.phone}</span>}
                {agency.email && <span className="flex items-center gap-1 text-muted-foreground"><Mail className="h-4 w-4" />{agency.email}</span>}
                {agency.address && <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-4 w-4" />{agency.address}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Team */}
        <div className="mb-10">
          <h2 className="text-xl font-bold mb-4">Our Team ({agency.members?.length || 0})</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {agency.members?.map((member: any) => (
              <Link key={member.id} to={`/agent/${member.user_id}`}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={member.user?.photo} />
                      <AvatarFallback>{member.user?.name?.split(' ').map((n: string) => n[0]).join('')}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{member.user?.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
                      {member.user?.rating && (
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          <span className="text-xs">{member.user.rating}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Listings */}
        <div>
          <h2 className="text-xl font-bold mb-4">Listings ({agency.listings?.length || 0})</h2>
          {agency.listings?.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {agency.listings.map((prop: any) => (
                <PropertyCard key={prop.id} property={prop} />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No active listings from this agency.</p>
          )}
        </div>
      </div>
    </div>
  )
}
