import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { api, clearAuthToken, setAuthToken } from '@/api/client'

interface Agent {
  id: string
  name: string
  email: string
  phone: string
  photo?: string
  agency_name: string
  license_number: string
  verified: number
  specialization?: string
  languages?: string | string[]
  rating?: number
  review_count?: number
  bio?: string
  role?: string
  platform_role?: 'platform_admin' | null
  [key: string]: unknown
}

interface AuthContextType {
  agent: Agent | null
  loading: boolean
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: Record<string, unknown>) => Promise<void>
  logout: () => void
  refreshAgent: () => Promise<void>
  updateProfile: (data: Record<string, unknown>) => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  agent: null,
  loading: true,
  isAdmin: false,
  login: async () => {},
  register: async () => {},
  logout: () => {},
  refreshAgent: async () => {},
  updateProfile: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const legacy = localStorage.getItem('sa_token')
    if (legacy && !localStorage.getItem('fi_token')) {
      setAuthToken(legacy)
    }
    const token = localStorage.getItem('fi_token') || localStorage.getItem('sa_token')
    if (!token) {
      setLoading(false)
      return
    }
    api.me()
      .then((data: Agent) => setAgent(data))
      .catch(() => clearAuthToken())
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password)
    if (!res?.token) throw new Error('Login succeeded but no token was returned')
    setAuthToken(res.token)
    // Prefer fresh /me payload so role/affiliation match server state
    try {
      const me = await api.me()
      setAgent(me)
    } catch {
      setAgent(res.agent)
    }
  }

  const register = async (data: Record<string, unknown>) => {
    const res = await api.register(data)
    if (!res?.token) throw new Error('Registration succeeded but no token was returned')
    setAuthToken(res.token)
    try {
      const me = await api.me()
      setAgent(me)
    } catch {
      setAgent(res.agent)
    }
  }

  const logout = () => {
    clearAuthToken()
    setAgent(null)
    window.location.href = '/'
  }

  const refreshAgent = async () => {
    const data = await api.me()
    setAgent(data)
  }

  const updateProfile = async (data: Record<string, unknown>) => {
    const updated = await api.updateProfile(data)
    setAgent(updated)
  }

  const isAdmin = !!agent && agent.platform_role === 'platform_admin'

  return (
    <AuthContext.Provider value={{ agent, loading, isAdmin, login, register, logout, refreshAgent, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
