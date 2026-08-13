import { Link } from 'react-router-dom'
import { Star, Phone, Mail, Award, MapPin, Calendar, Building2, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { Agent } from '@/types'

interface AgentCardProps {
  agent: Agent
}

export function AgentCard({ agent }: AgentCardProps) {
  const languages = Array.isArray(agent.languages)
    ? agent.languages
    : String(agent.languages || '').split(',').map((s) => s.trim()).filter(Boolean)
  const dealCount = agent.transactions?.length ?? 0
  const verified = agent.verified === 1 || agent.verified === true

  return (
    <Link to={`/agent/${(agent as any).slug || agent.id}`} className="group block">
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-md">
        <div className="flex flex-col sm:flex-row">
          <div className="flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5 p-6 sm:w-40">
            <Avatar className="h-20 w-20 border-4 border-white shadow-lg">
              <AvatarImage src={agent.photo} alt={agent.name} />
              <AvatarFallback>{agent.name.split(' ').map((n) => n[0]).join('')}</AvatarFallback>
            </Avatar>
          </div>

          <div className="flex-1 p-4">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">{agent.name}</h3>
                <p className="text-sm text-muted-foreground">{agent.specialization}</p>
              </div>
              {verified && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Award className="h-3 w-3 text-primary" />
                  Verified
                </Badge>
              )}
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {agent.agency_name}
              </span>
              {languages.length > 0 && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {languages.slice(0, 2).join(', ')}
                </span>
              )}
              {agent.experience_since && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Since {agent.experience_since}
                </span>
              )}
            </div>

            <div className="mb-3 flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                <span className="text-sm font-medium">{agent.rating || '—'}</span>
                <span className="text-xs text-muted-foreground">({agent.review_count || 0})</span>
              </div>
              {dealCount > 0 && (
                <div className="flex items-center gap-1 text-xs text-green-600">
                  <TrendingUp className="h-3 w-3" />
                  {dealCount} recent deals
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={(e) => {
                  e.preventDefault()
                  if (agent.phone) window.location.href = `tel:${agent.phone.replace(/\s/g, '')}`
                }}
              >
                <Phone className="h-3.5 w-3.5" />
                Call
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={(e) => {
                  e.preventDefault()
                  if (agent.email) window.location.href = `mailto:${agent.email}`
                }}
              >
                <Mail className="h-3.5 w-3.5" />
                Email
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
