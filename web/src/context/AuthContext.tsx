import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { api, clearAuthToken, clearElevatedToken, setAuthToken } from '@/api/client'
import type { LoginOutcome } from '@/types/twoFactor'

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
  /**
   * Resolves to `{ status: '2fa_required', … }` when the password was correct
   * but the account has a second factor — no session is established in that
   * case. Callers must handle both outcomes.
   */
  login: (email: string, password: string) => Promise<LoginOutcome>
  /** Redeems a sign-in challenge and establishes the session. */
  completeTwoFactor: (challengeId: string, code: string) => Promise<void>
  register: (data: Record<string, unknown>) => Promise<void>
  logout: () => void
  refreshAgent: () => Promise<void>
  updateProfile: (data: Record<string, unknown>) => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  agent: null,
  loading: true,
  isAdmin: false,
  login: async () => ({ status: 'signed_in' }),
  completeTwoFactor: async () => {},
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

  /** Adopt a session payload from either /auth/login or /auth/2fa/challenge. */
  const adoptSession = async (res: { token?: string; agent?: Agent }) => {
    if (!res?.token) throw new Error('Sign-in succeeded but no token was returned')
    setAuthToken(res.token)
    // A fresh session starts unelevated — never carry a previous account's
    // step-up across a sign-in.
    clearElevatedToken()
    // Prefer fresh /me payload so role/affiliation match server state
    try {
      const me = await api.me()
      setAgent(me)
    } catch {
      setAgent(res.agent ?? null)
    }
  }

  const login = async (email: string, password: string): Promise<LoginOutcome> => {
    const res = await api.login(email, password)
    // Password accepted, but the account has a second factor. Deliberately not
    // an error: the caller shows a code prompt rather than a failure message.
    if (res?.status === '2fa_required') {
      return { status: '2fa_required', challenge_id: res.challenge_id, method: res.method }
    }
    await adoptSession(res)
    return { status: 'signed_in' }
  }

  const completeTwoFactor = async (challengeId: string, code: string) => {
    const res = await api.twoFactorChallenge(challengeId, code)
    await adoptSession(res)
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
    clearElevatedToken()
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
    <AuthContext.Provider
      value={{ agent, loading, isAdmin, login, completeTwoFactor, register, logout, refreshAgent, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
