import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Users, Plus, Settings, Mail, Shield, UserMinus, Loader2, Check, X, Crown, UserCog, User, Eye, DollarSign, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/api/client'
import { usePageTitle } from '@/lib/usePageTitle'

const ROLE_META: Record<string, { label: string; icon: any; color: string; description: string }> = {
  owner: { label: 'Owner', icon: Crown, color: 'bg-amber-100 text-amber-700 border-amber-200', description: 'Full control over agency' },
  admin: { label: 'Admin', icon: Shield, color: 'bg-red-100 text-red-700 border-red-200', description: 'Manage members and settings' },
  manager: { label: 'Manager', icon: UserCog, color: 'bg-blue-100 text-blue-700 border-blue-200', description: 'Manage listings and team' },
  agent: { label: 'Agent', icon: User, color: 'bg-green-100 text-green-700 border-green-200', description: 'List properties and manage leads' },
  marketer: { label: 'Marketer', icon: Eye, color: 'bg-purple-100 text-purple-700 border-purple-200', description: 'Manage content and campaigns' },
  finance: { label: 'Finance', icon: DollarSign, color: 'bg-emerald-100 text-emerald-700 border-emerald-200', description: 'View reports and invoices' },
  readonly: { label: 'Read-Only', icon: Eye, color: 'bg-gray-100 text-gray-700 border-gray-200', description: 'View-only access' },
}

export function AgencyManagementPage() {
  const { agent, loading: authLoading } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Agency Management')
  const [loading, setLoading] = useState(true)
  const [agency, setAgency] = useState<any>(null)
  const [activeTab, setActiveTab] = useState('overview')

  // Create agency form
  const [createMode, setCreateMode] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', license_number: '', description: '', phone: '', email: '', address: '', site_hosting_type: 'none' })
  const [creating, setCreating] = useState(false)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('agent')
  const [inviting, setInviting] = useState(false)
  const [departure, setDeparture] = useState<null | {
    memberId: string
    userId: string
    name: string
    listings: Array<{ id: string; title: string }>
    assignments: Record<string, string>
    saving: boolean
    error: string
  }>(null)

  const loadAgency = useCallback(() => {
    setLoading(true)
    api.getMyAgency()
      .then(data => {
        setAgency(data)
        setLoading(false)
      })
      .catch((err: any) => {
        setLoading(false)
        addToast({ title: 'Failed to load agency', description: err.message || 'Could not load agency data', variant: 'error' })
      })
  }, [addToast])

  useEffect(() => {
    if (!agent) return
    loadAgency()
  }, [agent, loadAgency])

  const handleCreate = async () => {
    if (!createForm.name.trim()) return
    setCreating(true)
    try {
      const data = await api.createAgency(createForm)
      setAgency(data)
      setCreateMode(false)
      addToast({ title: 'Agency created', description: `${data.name} is ready.`, variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to create agency', description: e.message || 'Could not create agency', variant: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !agency) return
    setInviting(true)
    try {
      await api.inviteMember(agency.id, { email: inviteEmail, role: inviteRole })
      setInviteEmail('')
      loadAgency()
      addToast({ title: 'Invitation sent', description: `Invite sent to ${inviteEmail}.`, variant: 'success' })
    } catch (e: any) {
      addToast({ title: 'Failed to invite', description: e.message || 'Could not send invitation', variant: 'error' })
    } finally {
      setInviting(false)
    }
  }

  const openDeparture = async (memberId: string, memberUserId?: string, memberName?: string) => {
    if (!memberUserId || !agency) return
    try {
      const data = await api.getTiedListings(agency.id, memberId)
      const listings = data.listings || []
      const assignments: Record<string, string> = {}
      listings.forEach((l: any) => { assignments[l.id] = '' })
      setDeparture({
        memberId,
        userId: memberUserId,
        name: memberName || 'Agent',
        listings,
        assignments,
        saving: false,
        error: '',
      })
    } catch (e: any) {
      addToast({ title: 'Failed to load tied listings', description: e.message || 'Could not load listings', variant: 'error' })
    }
  }

  const completeDeparture = async () => {
    if (!agency || !departure) return
    if (departure.listings.length > 0) {
      const missing = departure.listings.filter((l) => !departure.assignments[l.id])
      if (missing.length) {
        setDeparture((d) => d ? { ...d, error: 'Assign every agency-tied listing to another agent first.' } : d)
        return
      }
    }
    setDeparture((d) => d ? { ...d, saving: true, error: '' } : d)
    try {
      for (const listing of departure.listings) {
        await api.reassignAgencyListing(agency.id, listing.id, {
          from_agent_id: departure.userId,
          to_agent_id: departure.assignments[listing.id],
        })
      }
      await api.endAgencyMembership(agency.id, departure.memberId, { reason: 'departure' })
      setDeparture(null)
      loadAgency()
    } catch (e: any) {
      setDeparture((d) => d ? { ...d, saving: false, error: e.message || 'Failed' } : d)
    }
  }

  const handleUpdateRole = async (memberId: string, newRole: string) => {
    await api.updateMember(agency.id, memberId, { role: newRole })
    loadAgency()
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Please sign in</h2>
          <p className="text-muted-foreground">You need to be logged in to manage your agency</p>
          <Link to="/login"><Button className="mt-4">Sign In</Button></Link>
        </div>
      </div>
    )
  }

  // Not in an agency yet
  if (!loading && !agency && !createMode) {
    return (
      <div className="min-h-screen bg-muted/20 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Building2 className="mx-auto h-16 w-16 text-primary/60" />
          <h1 className="mt-6 text-3xl font-bold">Create Your Agency</h1>
          <p className="mt-2 text-muted-foreground">Set up your agency on REB to unlock white-label websites, team management, and multi-channel distribution.</p>
          <Button className="mt-6 gap-2" onClick={() => setCreateMode(true)}><Plus className="h-4 w-4" />Create Agency</Button>
        </div>
      </div>
    )
  }

  if (createMode) {
    return (
      <div className="min-h-screen bg-muted/20 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle>Create Agency</CardTitle>
              <CardDescription>Register your real estate agency on REB</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Agency Name *</Label><Input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g., Haddad Premium Properties" /></div>
              <div><Label>License Number</Label><Input value={createForm.license_number} onChange={e => setCreateForm({ ...createForm, license_number: e.target.value })} placeholder="e.g., AL-8892" /></div>
              <div><Label>Description</Label><textarea value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Describe your agency..." /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Phone</Label><Input value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Input value={createForm.address} onChange={e => setCreateForm({ ...createForm, address: e.target.value })} placeholder="Office address" /></div>
              <div>
                <Label>Site hosting (Decision 4)</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-10"
                  value={(createForm as any).site_hosting_type || 'none'}
                  onChange={e => setCreateForm({ ...createForm, site_hosting_type: e.target.value } as any)}
                >
                  <option value="none">Marketplace-only (no public agency site)</option>
                  <option value="external">External website + selective marketplace syndication</option>
                  <option value="whitelabel">Platform white-label site (custom domain eligible)</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setCreateMode(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating || !createForm.name.trim()} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Create Agency
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const myRole = agency?.myRole || 'agent'
  const canManageMembers = ['owner', 'admin'].includes(myRole)
  const canManageSettings = ['owner', 'admin'].includes(myRole)

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Header */}
      <div className="border-b bg-white px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-primary/10 p-3">
                <Building2 className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{agency.name}</h1>
                <p className="text-sm text-muted-foreground">License {agency.license_number} &bull; {agency.members?.length || 1} member{(agency.members?.length || 1) > 1 ? 's' : ''}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link to="/agency/pricing"><Button variant="outline" className="gap-2"><DollarSign className="h-4 w-4" />Price Health</Button></Link>
              <Link to="/white-label"><Button variant="outline" className="gap-2"><Settings className="h-4 w-4" />White-Label Sites</Button></Link>
              <Link to="/integrations"><Button variant="outline" className="gap-2"><Settings className="h-4 w-4" />Integrations</Button></Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            {canManageSettings && <TabsTrigger value="settings">Settings</TabsTrigger>}
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview">
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Agency Details</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><Label className="text-sm text-muted-foreground">Name</Label><p className="font-medium">{agency.name}</p></div>
                    <div><Label className="text-sm text-muted-foreground">License</Label><p className="font-medium">{agency.license_number || '—'}</p></div>
                    <div><Label className="text-sm text-muted-foreground">Phone</Label><p className="font-medium">{agency.phone || '—'}</p></div>
                    <div><Label className="text-sm text-muted-foreground">Email</Label><p className="font-medium">{agency.email || '—'}</p></div>
                  </div>
                  <div><Label className="text-sm text-muted-foreground">Address</Label><p className="font-medium">{agency.address || '—'}</p></div>
                  <div><Label className="text-sm text-muted-foreground">Description</Label><p className="text-sm text-muted-foreground">{agency.description || 'No description'}</p></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Quick Stats</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-primary" />
                    <div><p className="font-bold">{agency.members?.length || 1}</p><p className="text-xs text-muted-foreground">Team Members</p></div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-primary" />
                    <div><p className="font-bold">{agency.listings?.length || 0}</p><p className="text-xs text-muted-foreground">Listings</p></div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* MEMBERS */}
          <TabsContent value="members">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Team Members</CardTitle>
                <CardDescription>Manage roles and permissions for your team</CardDescription>
              </CardHeader>
              <CardContent>
                {canManageMembers && (
                  <div className="mb-6 flex flex-col gap-3 sm:flex-row">
                    <Input placeholder="Enter email to invite" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} className="sm:w-72" />
                    <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-sm h-10">
                      {Object.entries(ROLE_META).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.label}</option>
                      ))}
                    </select>
                    <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} className="gap-2">
                      {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Invite
                    </Button>
                  </div>
                )}

                <div className="space-y-3">
                  {agency.members?.map((member: any) => {
                    const meta = ROLE_META[member.role] || ROLE_META.readonly
                    const Icon = meta.icon
                    const isMe = member.user_id === agent.id
                    return (
                      <div key={member.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={member.user?.photo} />
                          <AvatarFallback>{member.user?.name?.split(' ').map((n: string) => n[0]).join('')}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{member.user?.name || 'Unknown'}</p>
                            {isMe && <Badge variant="outline" className="text-xs">You</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{member.user?.email}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {canManageMembers && !isMe ? (
                            <select
                              value={member.role}
                              onChange={e => handleUpdateRole(member.id, e.target.value)}
                              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                            >
                              {Object.entries(ROLE_META).map(([key, meta]) => (
                                <option key={key} value={key}>{meta.label}</option>
                              ))}
                            </select>
                          ) : (
                            <Badge className={meta.color}>{meta.label}</Badge>
                          )}
                          {canManageMembers && !isMe && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => openDeparture(member.id, member.user_id || member.user?.id, member.user?.name)}
                            >
                              <UserMinus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-6 rounded-lg bg-muted/50 p-4">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Shield className="h-4 w-4" />Role Permissions</h4>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(ROLE_META).map(([key, meta]) => (
                      <div key={key} className="flex items-start gap-2 text-sm">
                        <Badge className={`${meta.color} text-xs shrink-0 mt-0.5`}>{meta.label}</Badge>
                        <span className="text-muted-foreground">{meta.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SETTINGS */}
          {canManageSettings && (
            <TabsContent value="settings">
              <Card>
                <CardHeader><CardTitle>Agency Settings</CardTitle><CardDescription>Update your agency profile</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><Label>Name</Label><Input defaultValue={agency.name} /></div>
                    <div><Label>License Number</Label><Input defaultValue={agency.license_number || ''} /></div>
                    <div><Label>Phone</Label><Input defaultValue={agency.phone || ''} /></div>
                    <div><Label>Email</Label><Input defaultValue={agency.email || ''} /></div>
                  </div>
                  <div><Label>Address</Label><Input defaultValue={agency.address || ''} /></div>
                  <div><Label>Description</Label><textarea defaultValue={agency.description || ''} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
                  <div className="flex gap-2">
                    <Button onClick={() => api.updateAgency(agency.id, agency).then(() => loadAgency())}>Save Changes</Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {departure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold">End affiliation — {departure.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Agency-tied listings must be reassigned to another active member before departure.
            </p>
            {departure.listings.length === 0 ? (
              <p className="mt-4 text-sm">No agency-tied listings. You can end affiliation now.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {departure.listings.map((listing) => (
                  <div key={listing.id} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">{listing.title}</p>
                    <Label className="mt-2 text-xs">Reassign to</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-10"
                      value={departure.assignments[listing.id] || ''}
                      onChange={(e) =>
                        setDeparture((d) =>
                          d
                            ? {
                                ...d,
                                assignments: { ...d.assignments, [listing.id]: e.target.value },
                              }
                            : d,
                        )
                      }
                    >
                      <option value="">Select agent</option>
                      {(agency.members || [])
                        .filter((m: any) => m.status !== 'ended' && (m.user_id || m.user?.id) !== departure.userId)
                        .map((m: any) => (
                          <option key={m.id} value={m.user_id || m.user?.id}>
                            {m.user?.name || m.user_id}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {departure.error && <p className="mt-3 text-sm text-destructive">{departure.error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeparture(null)} disabled={departure.saving}>Cancel</Button>
              <Button onClick={completeDeparture} disabled={departure.saving} className="gap-2">
                {departure.saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Reassign & end affiliation
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
