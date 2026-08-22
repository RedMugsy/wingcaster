import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import {
  Menu, X, LogIn, UserPlus, LayoutDashboard, LogOut, User, Inbox,
  ListTodo, Users as UsersIcon, Building2, Megaphone, Calendar, Radar,
  Coins, ChevronDown, CreditCard, Shield, MessageSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/context/AuthContext'
import { useBrand } from '@/context/BrandContext'

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { agent, isAdmin, logout, loading: authLoading } = useAuth()
  const { brand } = useBrand()

  const agentNav = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/command-center', label: 'Command', icon: Radar },
    { path: '/listings', label: 'Listings', icon: Building2 },
    { path: '/dashboard/inbox', label: 'Inbox', icon: Inbox },
    { path: '/contacts', label: 'Contacts', icon: UsersIcon },
    { path: '/calendar', label: 'Calendar', icon: Calendar },
    { path: '/campaigns', label: 'Campaigns', icon: Megaphone },
    { path: '/tasks', label: 'Tasks', icon: ListTodo },
  ]

  const commercialPricingSubItems = [
    { path: '/admin/commercial-pricing/territories', label: 'Territories' },
    { path: '/admin/commercial-pricing/rate-cards', label: 'Rate cards' },
    { path: '/admin/commercial-pricing/products', label: 'Products' },
    { path: '/admin/commercial-pricing/subscriptions', label: 'Subscriptions' },
    { path: '/admin/commercial-pricing/credit-notes', label: 'Credit notes' },
    { path: '/admin/commercial-pricing/reports', label: 'Reports' },
    { path: '/admin/commercial-pricing/reconciliation', label: 'Reconciliation' },
  ]
  const commercialPricingActive = location.pathname.startsWith('/admin/commercial-pricing')

  // Platform-admin surfaces that aren't part of commercial pricing.
  // Kept as a separate dropdown so the Commercial menu stays scoped.
  const platformAdminSubItems = [
    { path: '/admin/message-templates', label: 'Message templates', icon: MessageSquare },
  ]
  const platformAdminActive = platformAdminSubItems.some((it) =>
    location.pathname === it.path || location.pathname.startsWith(`${it.path}/`),
  )
  const finOpsSubItems = [
    { path: '/admin/fin/overview', label: 'Overview' },
    { path: '/admin/fin/tenants', label: 'Tenants' },
    { path: '/admin/fin/usage', label: 'Usage' },
    { path: '/admin/fin/credits', label: 'Credits' },
    { path: '/admin/fin/holds', label: 'Holds' },
    { path: '/admin/fin/facilities', label: 'Facilities' },
    { path: '/admin/fin/contracts', label: 'Contracts' },
    { path: '/admin/fin/pricing', label: 'Pricing' },
    { path: '/admin/fin/invoices', label: 'Invoices' },
    { path: '/admin/fin/vendor-costs', label: 'Vendor costs' },
    { path: '/admin/fin/reconciliation', label: 'Reconciliation' },
    { path: '/admin/fin/parity', label: 'Parity' },
    { path: '/admin/fin/exceptions', label: 'Exceptions' },
    { path: '/admin/fin/approvals', label: 'Approvals' },
    { path: '/admin/fin/audit', label: 'Audit' },
    { path: '/admin/fin/configuration', label: 'Configuration' },
  ]
  const finOpsActive = location.pathname.startsWith('/admin/fin')

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to={agent ? '/dashboard' : '/login'} className="flex items-center gap-2.5">
          <img src={brand.logoUrl} alt={brand.name} className="h-9 w-auto" />
          <span
            className="font-display text-xl tracking-tight"
            style={{ color: brand.primaryColor }}
          >
            {brand.name.toUpperCase()}
          </span>
        </Link>

        {agent && (
          <div className="hidden items-center gap-1 lg:flex">
            {agentNav.map((item) => {
              const Icon = item.icon
              const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'text-white'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                  style={active ? { backgroundColor: brand.primaryColor } : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      commercialPricingActive
                        ? 'text-white'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    style={commercialPricingActive ? { backgroundColor: brand.primaryColor } : undefined}
                  >
                    <Coins className="h-4 w-4" />
                    Commercial
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Commercial Pricing</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {commercialPricingSubItems.map((sub) => (
                    <DropdownMenuItem key={sub.path} asChild>
                      <Link to={sub.path}>{sub.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      platformAdminActive
                        ? 'text-white'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    style={platformAdminActive ? { backgroundColor: brand.primaryColor } : undefined}
                    aria-label="Platform admin menu"
                  >
                    <Shield className="h-4 w-4" />
                    Platform
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Platform admin</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {platformAdminSubItems.map((sub) => {
                    const Icon = sub.icon
                    return (
                      <DropdownMenuItem key={sub.path} asChild>
                        <Link to={sub.path} className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {sub.label}
                        </Link>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      finOpsActive
                        ? 'text-white'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    style={finOpsActive ? { backgroundColor: brand.primaryColor } : undefined}
                    aria-label="Fin ops menu"
                  >
                    <CreditCard className="h-4 w-4" />
                    Fin ops
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Fin operations</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {finOpsSubItems.map((sub) => (
                    <DropdownMenuItem key={sub.path} asChild>
                      <Link to={sub.path}>{sub.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        )}

        <div className="hidden items-center gap-2 md:flex">
          {authLoading ? (
            <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
          ) : agent ? (
            <>
              <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{agent.name}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1 rounded-md p-1.5 text-sm text-muted-foreground hover:bg-accent">
                    <CreditCard className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Billing</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/pricing">Plans</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/subscription">My subscription</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/credit-notes">My credit notes</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/notifications">Notification preferences</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={logout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Link to="/login">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <LogIn className="h-4 w-4" />
                  Sign In
                </Button>
              </Link>
              <Link to="/register">
                <Button
                  size="sm"
                  className="gap-1.5 text-white"
                  style={{ backgroundColor: brand.primaryColor }}
                >
                  <UserPlus className="h-4 w-4" />
                  Register
                </Button>
              </Link>
            </>
          )}
        </div>

        <button type="button" className="lg:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t bg-white px-4 py-3 lg:hidden">
          <div className="flex flex-col gap-1">
            {agent &&
              agentNav.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )
              })}
            {isAdmin ? (
              <div className="mt-2 border-t pt-3">
                <div className="mb-1 flex items-center gap-2 px-3 text-xs font-semibold uppercase text-muted-foreground">
                  <Coins className="h-3.5 w-3.5" />
                  Commercial
                </div>
                {commercialPricingSubItems.map((sub) => (
                  <Link
                    key={sub.path}
                    to={sub.path}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-md px-6 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
                  >
                    {sub.label}
                  </Link>
                ))}
              </div>
            ) : null}
            {isAdmin ? (
              <div className="mt-2 border-t pt-3">
                <div className="mb-1 flex items-center gap-2 px-3 text-xs font-semibold uppercase text-muted-foreground">
                  <Shield className="h-3.5 w-3.5" />
                  Platform
                </div>
                {platformAdminSubItems.map((sub) => {
                  const Icon = sub.icon
                  return (
                    <Link
                      key={sub.path}
                      to={sub.path}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-2 rounded-md px-6 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
                    >
                      <Icon className="h-4 w-4" />
                      {sub.label}
                    </Link>
                  )
                })}
              </div>
            ) : null}
            {isAdmin ? (
              <div className="mt-2 border-t pt-3">
                <div className="mb-1 flex items-center gap-2 px-3 text-xs font-semibold uppercase text-muted-foreground">
                  <CreditCard className="h-3.5 w-3.5" />
                  Fin ops
                </div>
                {finOpsSubItems.map((sub) => (
                  <Link
                    key={sub.path}
                    to={sub.path}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-md px-6 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
                  >
                    {sub.label}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="mt-2 flex flex-col gap-2 border-t pt-3">
              {authLoading ? (
                <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
              ) : agent ? (
                <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => { logout(); setMobileOpen(false) }}>
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </Button>
              ) : (
                <>
                  <Link to="/login" onClick={() => setMobileOpen(false)}>
                    <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                      <LogIn className="h-4 w-4" />
                      Sign In
                    </Button>
                  </Link>
                  <Link to="/register" onClick={() => setMobileOpen(false)}>
                    <Button
                      size="sm"
                      className="w-full justify-start gap-2 text-white"
                      style={{ backgroundColor: brand.primaryColor }}
                    >
                      <UserPlus className="h-4 w-4" />
                      Register
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
