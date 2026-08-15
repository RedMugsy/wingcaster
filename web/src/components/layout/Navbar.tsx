import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import {
  Menu, X, LogIn, UserPlus, LayoutDashboard, LogOut, User, Inbox,
  ListTodo, Users as UsersIcon, Building2, Megaphone, Calendar, Radar,
  Coins,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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

  const adminNav = isAdmin
    ? [{ path: '/admin/commercial-pricing/territories', label: 'Commercial Pricing', icon: Coins }]
    : []

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
            {[...agentNav, ...adminNav].map((item) => {
              const Icon = item.icon
              const active = location.pathname === item.path || location.pathname.startsWith(`${item.path.split('/').slice(0, 3).join('/')}/`)
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
              [...agentNav, ...adminNav].map((item) => {
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
