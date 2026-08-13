import { useEffect } from 'react'

export function usePageTitle(title: string, suffix = 'Real Estate Bazaar') {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} | ${suffix}` : suffix
    return () => {
      document.title = previous
    }
  }, [title, suffix])
}
