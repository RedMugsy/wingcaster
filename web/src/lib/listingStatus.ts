export type ListingStatus = 'draft' | 'published' | 'unpublished' | 'archived'

export const LISTING_STATUSES: ListingStatus[] = ['draft', 'published', 'unpublished', 'archived']

export interface ListingStatusMeta {
  label: string
  description: string
  badgeClass: string
  dotClass: string
}

export const LISTING_STATUS_META: Record<ListingStatus, ListingStatusMeta> = {
  draft: {
    label: 'Draft',
    description: 'Work in progress. Not visible anywhere.',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    dotClass: 'bg-slate-400',
  },
  published: {
    label: 'Published',
    description: 'Live on connected portals and social channels.',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  unpublished: {
    label: 'Unpublished',
    description: 'Taken down from portals and channels. Kept in your workspace.',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  archived: {
    label: 'Archived',
    description: 'Retired from active management. Hidden from default views.',
    badgeClass: 'bg-zinc-100 text-zinc-600 border-zinc-200',
    dotClass: 'bg-zinc-400',
  },
}

export function normalizeStatus(raw: string | undefined | null): ListingStatus {
  const value = (raw || '').toLowerCase().trim()
  if ((LISTING_STATUSES as string[]).includes(value)) return value as ListingStatus
  // Legacy Bazaar values map to sensible defaults.
  if (value === 'active' || value === 'live') return 'published'
  if (value === 'sold' || value === 'rented' || value === 'closed') return 'archived'
  if (value === 'pending' || value === 'review') return 'draft'
  return 'draft'
}
