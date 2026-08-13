import { Mail, MapPin } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { useBrand } from '@/context/BrandContext'

export function Footer() {
  const { brand } = useBrand()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t bg-[#F7F6F4]">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div className="space-y-4 md:col-span-2">
            <div className="flex items-center gap-2.5">
              <img src={brand.logoUrl} alt={brand.name} className="h-8 w-auto" />
              <span className="font-display text-lg tracking-tight">{brand.name.toUpperCase()}</span>
            </div>
            <p className="text-sm text-muted-foreground">{brand.tagline}</p>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold">For Agents</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="/dashboard" className="hover:text-foreground">Dashboard</a></li>
              <li><a href="/listings" className="hover:text-foreground">Listings</a></li>
              <li><a href="/contacts" className="hover:text-foreground">Contacts</a></li>
              <li><a href="/register" className="hover:text-foreground">Register as Agent</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold">Contact</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Lebanon
              </li>
              {brand.contactEmail && (
                <li className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {brand.contactEmail}
                </li>
              )}
            </ul>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <p>© {year} {brand.name}. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-foreground">Privacy Policy</a>
            <a href="/terms" className="hover:text-foreground">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
