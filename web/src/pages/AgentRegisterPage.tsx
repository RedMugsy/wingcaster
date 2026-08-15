import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2, CheckCircle, Loader2, ArrowRight, ArrowLeft, MessageCircle,
  Mail, MapPin, Phone, Globe, User, Lock, FileText,
  Languages, Target, Home, Search, ChevronDown, Check, X, Briefcase,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/ui/toast'
import { usePageTitle } from '@/lib/usePageTitle'
import { api } from '@/api/client'

/* ───────────────────────── TYPES ───────────────────────── */
type ContactChannel = 'whatsapp' | 'email' | 'gmail' | 'facebook'

interface AgencyOption {
  id: string
  name: string
  license_number?: string
  email?: string
  phone?: string
  address?: string
  website?: string
  logo?: string
  city?: string
}

interface FormState {
  first_name: string
  last_name: string
  email: string
  phone: string
  country_code: string
  license_number: string
  password: string
  password_confirm: string
  office_address: string
  bio: string
  languages: string
  specialization: string
  territories: string[]
  property_types: string[]
  agency_mode: 'existing' | 'new' | 'none'
  agency_id: string
  agency_name: string
  agency_license: string
  agency_address: string
  agency_website: string
  agency_email: string
  agency_phone: string
  primary_contact_first: string
  primary_contact_last: string
  primary_contact_title: string
  primary_contact_email: string
  primary_contact_phone: string
  terms_accepted: boolean
}

/* ───────────────────────── CONSTANTS ───────────────────────── */
const STEPS = [
  { id: 0, title: 'Verify Contact', blurb: 'Secure your account' },
  { id: 1, title: 'Enter OTP', blurb: 'Confirm your identity' },
  { id: 2, title: 'Your Profile', blurb: 'Complete your registration' },
]

const CHANNELS: { id: ContactChannel; label: string; icon: typeof MessageCircle; placeholder: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, placeholder: '+961 3 123 456' },
  { id: 'email', label: 'Email', icon: Mail, placeholder: 'you@agency.com' },
  { id: 'gmail', label: 'Gmail', icon: Mail, placeholder: 'you@gmail.com' },
  { id: 'facebook', label: 'Facebook', icon: Globe, placeholder: 'your.facebook.id' },
]

const COUNTRY_CODES = [
  { code: '+961', flag: '🇱🇧', label: 'Lebanon (+961)' },
  { code: '+971', flag: '🇦🇪', label: 'UAE (+971)' },
  { code: '+966', flag: '🇸🇦', label: 'Saudi Arabia (+966)' },
  { code: '+965', flag: '🇰🇼', label: 'Kuwait (+965)' },
  { code: '+974', flag: '🇶🇦', label: 'Qatar (+974)' },
  { code: '+973', flag: '🇧🇭', label: 'Bahrain (+973)' },
  { code: '+968', flag: '🇴🇲', label: 'Oman (+968)' },
  { code: '+962', flag: '🇯🇴', label: 'Jordan (+962)' },
  { code: '+20', flag: '🇪🇬', label: 'Egypt (+20)' },
  { code: '+90', flag: '🇹🇷', label: 'Turkey (+90)' },
  { code: '+1', flag: '🇺🇸', label: 'USA (+1)' },
  { code: '+44', flag: '🇬🇧', label: 'UK (+44)' },
]

const PROPERTY_TYPES = [
  'Apartment', 'Villa', 'Townhouse', 'Penthouse', 'Studio',
  'Office', 'Shop / Retail', 'Warehouse', 'Land', 'Building',
]

const TERRITORIES = [
  'Beirut', 'Achrafieh', 'Downtown Beirut', 'Hamra', 'Gemayzeh',
  'Mar Mikhael', 'Saifi Village', 'Zaitunay Bay', 'Ashrafieh',
  'Jounieh', 'Kaslik', 'Dbayeh', 'Zouk Mosbeh',
  'Baabda', 'Aley', 'Bhamdoun', 'Broumana',
  'Tripoli', 'Batroun', 'Byblos / Jbeil',
  'Sidon', 'Tyre',
  'Zahle', 'Chtaura',
  'Dubai', 'Abu Dhabi', 'Sharjah',
  'Riyadh', 'Jeddah', 'Dammam',
]

const AGENCY_TYPES = [
  'Sole Proprietorship', 'Limited Liability Company (LLC)',
  'Partnership', 'Joint Stock Company', 'Free Zone Company', 'Other',
]

const emptyForm: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  country_code: '+961',
  license_number: '',
  password: '',
  password_confirm: '',
  office_address: '',
  bio: '',
  languages: 'English, Arabic',
  specialization: '',
  territories: [],
  property_types: [],
  agency_mode: 'none',
  agency_id: '',
  agency_name: '',
  agency_license: '',
  agency_address: '',
  agency_website: '',
  agency_email: '',
  agency_phone: '',
  primary_contact_first: '',
  primary_contact_last: '',
  primary_contact_title: '',
  primary_contact_email: '',
  primary_contact_phone: '',
  terms_accepted: false,
}

/* ───────────────────────── COMPONENT ───────────────────────── */
export function AgentRegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const { addToast } = useToast()
  usePageTitle('Register as Agent')

  /* step & ui state */
  const [step, setStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  /* contact verify state */
  const [channel, setChannel] = useState<ContactChannel>('whatsapp')
  const [contactValue, setContactValue] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [verifiedContact, setVerifiedContact] = useState('')

  /* otp state */
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  const [otpVerified, setOtpVerified] = useState(false)
  const [resendTimer, setResendTimer] = useState(60)

  /* registration form */
  const [form, setForm] = useState<FormState>({ ...emptyForm })

  /* agency search */
  const [agencyQuery, setAgencyQuery] = useState('')
  const [agencyResults, setAgencyResults] = useState<AgencyOption[]>([])
  const [agencySearchOpen, setAgencySearchOpen] = useState(false)
  const [selectedAgency, setSelectedAgency] = useState<AgencyOption | null>(null)
  const agencySearchRef = useRef<HTMLDivElement>(null)

  /* ─── helpers ─── */
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const toggleArray = (key: 'territories' | 'property_types', value: string) => {
    setForm((prev) => {
      const arr = prev[key]
      const exists = arr.includes(value)
      return { ...prev, [key]: exists ? arr.filter((v) => v !== value) : [...arr, value] }
    })
  }

  /* ─── resend timer ─── */
  useEffect(() => {
    if (resendTimer <= 0 || !otpSent) return
    const t = setTimeout(() => setResendTimer((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendTimer, otpSent])

  /* ─── agency search debounce ─── */
  useEffect(() => {
    if (agencyQuery.length < 2) {
      setAgencyResults([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchAgencies(agencyQuery)
        setAgencyResults(res)
      } catch (err: any) {
        addToast({ title: 'Agency search failed', description: err.message || 'Could not search agencies', variant: 'error' })
        setAgencyResults([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [agencyQuery, addToast])

  /* ─── click outside agency dropdown ─── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (agencySearchRef.current && !agencySearchRef.current.contains(e.target as Node)) {
        setAgencySearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /* ─── Step 1: send OTP ─── */
  const handleSendOtp = async () => {
    setError('')
    if (!contactValue.trim()) {
      setError(`Please enter your ${CHANNELS.find((c) => c.id === channel)?.label}`)
      return
    }
    setLoading(true)
    try {
      await api.sendOtp(channel, contactValue.trim())
      setOtpSent(true)
      setResendTimer(60)
      setStep(1)
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  /* ─── Step 2: verify OTP ─── */
  const handleVerifyOtp = async () => {
    const code = otpDigits.join('')
    if (code.length !== 6) {
      setError('Please enter the 6-digit code')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await api.verifyOtp(contactValue.trim(), code)
      if (res.verified) {
        setOtpVerified(true)
        setVerifiedContact(contactValue.trim())
        /* pre-fill contact into form */
        if (channel === 'whatsapp' || channel === 'email' || channel === 'gmail') {
          setForm((prev) => ({
            ...prev,
            phone: channel === 'whatsapp' ? contactValue.trim() : prev.phone,
            email: channel !== 'whatsapp' ? contactValue.trim() : prev.email,
          }))
        }
        setStep(2)
      }
    } catch (err: any) {
      setError(err.message || 'Invalid OTP')
    } finally {
      setLoading(false)
    }
  }

  const handleOtpChange = (idx: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1)
    setOtpDigits((prev) => {
      const next = [...prev]
      next[idx] = digit
      return next
    })
    if (digit && idx < 5) {
      otpRefs.current[idx + 1]?.focus()
    }
  }

  const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus()
    }
  }

  const handlePasteOtp = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    const next = text.split('').concat(Array(6).fill('')).slice(0, 6)
    setOtpDigits(next)
    if (text.length === 6) {
      otpRefs.current[5]?.focus()
    } else {
      otpRefs.current[text.length]?.focus()
    }
  }

  const handleResend = async () => {
    setResendTimer(60)
    try {
      await api.sendOtp(channel, contactValue.trim())
    } catch (err: any) {
      setError(err.message || 'Failed to resend')
    }
  }

  /* ─── Step 3: validate & submit ─── */
  const validateFinal = (): string | null => {
    if (!form.first_name.trim()) return 'First name is required'
    if (!form.last_name.trim()) return 'Last name is required'
    if (!form.email.trim() || !form.email.includes('@')) return 'A valid email is required'
    if (!form.phone.trim()) return 'Phone number is required'
    if (form.password.length < 6) return 'Password must be at least 6 characters'
    if (form.password !== form.password_confirm) return 'Passwords do not match'
    if (!form.office_address.trim()) return 'Office address is required'
    if (form.territories.length === 0) return 'Select at least one territory'
    if (form.property_types.length === 0) return 'Select at least one property type'
    if (form.agency_mode === 'existing' && !form.agency_id) {
      return 'Please select an agency or choose to register a new one'
    }
    if (form.agency_mode === 'new') {
      if (!form.agency_name.trim()) return 'Agency name is required'
      if (!form.agency_license.trim()) return 'Agency commercial license is required'
      if (!form.agency_address.trim()) return 'Agency address is required'
      if (!form.agency_email.trim() || !form.agency_email.includes('@')) return 'Valid agency email is required'
      if (!form.agency_phone.trim()) return 'Agency phone is required'
      if (!form.primary_contact_first.trim()) return 'Primary contact first name is required'
      if (!form.primary_contact_last.trim()) return 'Primary contact last name is required'
      if (!form.primary_contact_email.trim() || !form.primary_contact_email.includes('@'))
        return 'Valid primary contact email is required'
    }
    if (!form.terms_accepted) return 'You must accept the Terms of Use'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateFinal()
    if (err) {
      setError(err)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setError('')
    setLoading(true)

    try {
      /* 1. register the agent */
      const fullName = `${form.first_name.trim()} ${form.last_name.trim()}`
      await register({
        name: fullName,
        email: form.email.trim(),
        phone: `${form.country_code} ${form.phone.trim()}`,
        password: form.password,
        license_number: form.license_number.trim(),
        agency_name: form.agency_mode === 'new' ? form.agency_name.trim() : selectedAgency?.name || '',
        agency_license: form.agency_mode === 'new' ? form.agency_license.trim() : '',
        specialization: form.specialization.trim(),
        languages: form.languages.trim(),
        bio: form.bio.trim(),
        office_address: form.office_address.trim(),
        agency_mode: form.agency_mode,
        territories: form.territories,
        property_types: form.property_types,
        otp_verified: otpVerified,
        terms_accepted: form.terms_accepted,
      })

      /* 2. if existing agency selected → send application */
      if (form.agency_mode === 'existing' && selectedAgency) {
        try {
          await api.applyToAgency(selectedAgency.id, {
            agent_email: form.email.trim(),
            agent_name: fullName,
            agent_phone: `${form.country_code} ${form.phone.trim()}`,
            message: `Agent ${fullName} would like to join ${selectedAgency.name}.`,
          })
        } catch (err: any) {
          addToast({ title: 'Agency application failed', description: err.message || 'Could not apply to agency', variant: 'error' })
        }
      }

      /* 3. if new agency → create it */
      if (form.agency_mode === 'new') {
        try {
          await api.createAgency({
            name: form.agency_name.trim(),
            license_number: form.agency_license.trim(),
            description: `${form.agency_name} — ${form.specialization || 'Real Estate Agency'}`,
            phone: form.agency_phone.trim(),
            email: form.agency_email.trim(),
            address: form.agency_address.trim(),
            website: form.agency_website.trim(),
            site_hosting_type: 'none',
          })
        } catch (err: any) {
          addToast({ title: 'Agency creation failed', description: err.message || 'Agent account created, but agency setup failed', variant: 'error' })
        }
      }

      setSubmitted(true)
      setTimeout(() => navigate('/dashboard'), 1500)
    } catch (err: any) {
      setError(err.message || 'Registration failed')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setLoading(false)
    }
  }

  /* ─── RENDER ─── */

  if (submitted) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4">
        <div className="text-center">
          <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-600" />
          <h2 className="text-2xl font-bold font-display">Registration successful</h2>
          <p className="mt-2 text-muted-foreground">Taking you to your workspace…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-muted/20 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-foreground" />
          <h1 className="text-3xl font-bold tracking-tight font-display">Create your agent account</h1>
          <p className="mt-2 text-muted-foreground">
            Join Real Estate Bazaar and start listing properties today.
          </p>
        </div>

        {/* Stepper */}
        <div className="mb-6 flex gap-2">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={s.id > step}
              className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                step === s.id
                  ? 'border-foreground bg-white shadow-sm'
                  : s.id < step
                    ? 'border-green-300 bg-green-50 text-green-700'
                    : 'bg-muted/40 text-muted-foreground'
              }`}
            >
              <span className="block font-semibold">
                {s.id < step ? <Check className="mr-1 inline h-3.5 w-3.5" /> : null}
                {s.id + 1}. {s.title}
              </span>
              <span className="block text-xs">{s.blurb}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ─── STEP 0: CONTACT VERIFICATION ─── */}
        {step === 0 && (
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle className="font-display">Verify your contact</CardTitle>
              <CardDescription>
                We'll send a one-time code to confirm it's you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Main channel input */}
              <div className="space-y-2">
                <Label>
                  {channel === 'whatsapp' ? 'WhatsApp Number' : channel === 'email' ? 'Email Address' : channel === 'gmail' ? 'Gmail Address' : 'Facebook ID'}
                </Label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {channel === 'whatsapp' ? <Phone className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                  </div>
                  <Input
                    className="pl-10"
                    type={channel === 'whatsapp' ? 'tel' : 'text'}
                    placeholder={CHANNELS.find((c) => c.id === channel)?.placeholder}
                    value={contactValue}
                    onChange={(e) => setContactValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                  />
                </div>
              </div>

              {/* Alternative channels */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Or verify using</Label>
                <div className="flex gap-3">
                  {CHANNELS.filter((c) => c.id !== channel).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setChannel(c.id)
                        setContactValue('')
                        setError('')
                      }}
                      className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-medium transition hover:bg-muted/50 hover:border-foreground"
                    >
                      <c.icon className="h-4 w-4" />
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Terms teaser + submit */}
              <div className="space-y-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  By continuing, you agree to our{' '}
                  <Link to="/terms" className="underline underline-offset-2 text-foreground">Terms of Use</Link>{' '}
                  and{' '}
                  <Link to="/privacy" className="underline underline-offset-2 text-foreground">Privacy Policy</Link>.
                </p>
                <Button
                  onClick={handleSendOtp}
                  disabled={loading}
                  className="h-11 w-full gap-2 bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Send verification code
                </Button>
              </div>

              <div className="text-center text-sm text-muted-foreground">
                Already registered?{' '}
                <Link to="/login" className="underline underline-offset-4 text-foreground">Sign in</Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── STEP 1: OTP ─── */}
        {step === 1 && (
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle className="font-display">Enter verification code</CardTitle>
              <CardDescription>
                Enter the 6-digit code sent to{' '}
                <span className="font-medium text-foreground">{contactValue}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* OTP inputs */}
              <div className="flex justify-center gap-2" onPaste={handlePasteOtp}>
                {otpDigits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="h-14 w-12 rounded-lg border border-input bg-white text-center text-2xl font-semibold tracking-widest shadow-sm transition focus:border-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                ))}
              </div>

              <div className="text-center text-sm text-muted-foreground">
                {resendTimer > 0 ? (
                  <span>Resend code in {resendTimer}s</span>
                ) : (
                  <button type="button" onClick={handleResend} className="underline underline-offset-4 text-foreground">
                    Resend code
                  </button>
                )}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-between">
                <Button type="button" variant="outline" onClick={() => setStep(0)} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={handleVerifyOtp}
                  disabled={loading}
                  className="h-11 gap-2 bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Verify & continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── STEP 2: FULL REGISTRATION ─── */}
        {step === 2 && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Personal Details */}
            <Card className="border shadow-sm">
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <User className="h-5 w-5" /> Personal Details
                </CardTitle>
                <CardDescription>Tell us who you are</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First Name *</Label>
                    <Input id="first_name" value={form.first_name} onChange={(e) => setField('first_name', e.target.value)} placeholder="Karim" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name *</Label>
                    <Input id="last_name" value={form.last_name} onChange={(e) => setField('last_name', e.target.value)} placeholder="Haddad" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input id="email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="you@agency.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone *</Label>
                    <div className="flex gap-2">
                      <select
                        className="w-28 rounded-md border border-input bg-white px-2 py-2 text-sm"
                        value={form.country_code}
                        onChange={(e) => setField('country_code', e.target.value)}
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                        ))}
                      </select>
                      <Input
                        id="phone"
                        type="tel"
                        className="flex-1"
                        value={form.phone}
                        onChange={(e) => setField('phone', e.target.value)}
                        placeholder="3 123 456"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="license_number">
                    <FileText className="mr-1 inline h-3.5 w-3.5" />
                    Real Estate License Number <span className="text-muted-foreground font-normal">(if available)</span>
                  </Label>
                  <Input id="license_number" value={form.license_number} onChange={(e) => setField('license_number', e.target.value)} placeholder="RL-28471" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="password">Password *</Label>
                    <Input id="password" type="password" value={form.password} onChange={(e) => setField('password', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password_confirm">Confirm Password *</Label>
                    <Input id="password_confirm" type="password" value={form.password_confirm} onChange={(e) => setField('password_confirm', e.target.value)} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Profile */}
            <Card className="border shadow-sm">
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <Briefcase className="h-5 w-5" /> Professional Profile
                </CardTitle>
                <CardDescription>How clients see you</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="office_address">
                    <MapPin className="mr-1 inline h-3.5 w-3.5" />
                    Office Address *
                  </Label>
                  <Input id="office_address" value={form.office_address} onChange={(e) => setField('office_address', e.target.value)} placeholder="Sassine Street, Achrafieh, Beirut" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bio">
                    <FileText className="mr-1 inline h-3.5 w-3.5" />
                    About Me
                  </Label>
                  <textarea
                    id="bio"
                    rows={4}
                    className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:border-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    value={form.bio}
                    onChange={(e) => setField('bio', e.target.value)}
                    placeholder="Tell buyers and sellers about your experience, achievements, and what makes you different…"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="languages">
                    <Languages className="mr-1 inline h-3.5 w-3.5" />
                    Spoken Languages
                  </Label>
                  <Input id="languages" value={form.languages} onChange={(e) => setField('languages', e.target.value)} placeholder="English, Arabic, French" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialization">Specialization</Label>
                  <Input id="specialization" value={form.specialization} onChange={(e) => setField('specialization', e.target.value)} placeholder="Luxury Residential, Commercial, New Developments…" />
                </div>
              </CardContent>
            </Card>

            {/* Market Specialization */}
            <Card className="border shadow-sm">
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <Target className="h-5 w-5" /> Market Specialization
                </CardTitle>
                <CardDescription>Select the property types and territories you cover</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Property Types * <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
                  <div className="flex flex-wrap gap-2">
                    {PROPERTY_TYPES.map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => toggleArray('property_types', pt)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          form.property_types.includes(pt)
                            ? 'border-foreground bg-foreground text-white'
                            : 'border-input bg-white text-foreground hover:bg-muted/50'
                        }`}
                      >
                        {form.property_types.includes(pt) && <Check className="mr-1 inline h-3 w-3" />}
                        {pt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Territories / Cities * <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border rounded-lg p-3 bg-white">
                    {TERRITORIES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleArray('territories', t)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          form.territories.includes(t)
                            ? 'border-foreground bg-foreground text-white'
                            : 'border-input bg-white text-foreground hover:bg-muted/50'
                        }`}
                      >
                        {form.territories.includes(t) && <Check className="mr-1 inline h-3 w-3" />}
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Agency Affiliation */}
            <Card className="border shadow-sm">
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <Home className="h-5 w-5" /> Agency Affiliation
                </CardTitle>
                <CardDescription>Are you part of an agency?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  {[
                    { id: 'none', label: 'Independent Agent' },
                    { id: 'existing', label: 'Join Existing Agency' },
                    { id: 'new', label: 'Register New Agency' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setField('agency_mode', opt.id as any)
                        setField('agency_id', '')
                        setSelectedAgency(null)
                      }}
                      className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                        form.agency_mode === opt.id
                          ? 'border-foreground bg-foreground text-white'
                          : 'border-input bg-white text-foreground hover:bg-muted/50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Existing agency search */}
                {form.agency_mode === 'existing' && (
                  <div className="space-y-2" ref={agencySearchRef}>
                    <Label>Search for your agency</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-10"
                        placeholder="Type agency name, license, or city…"
                        value={agencyQuery}
                        onChange={(e) => {
                          setAgencyQuery(e.target.value)
                          setAgencySearchOpen(true)
                        }}
                        onFocus={() => setAgencySearchOpen(true)}
                      />
                      {agencySearchOpen && agencyResults.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-lg border bg-white shadow-lg">
                          {agencyResults.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition"
                              onClick={() => {
                                setSelectedAgency(a)
                                setField('agency_id', a.id)
                                setAgencyQuery(a.name)
                                setAgencySearchOpen(false)
                              }}
                            >
                              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded bg-muted text-xs font-bold">
                                {a.name[0]}
                              </div>
                              <div className="flex-1">
                                <div className="font-medium">{a.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {a.license_number && `License: ${a.license_number}`}
                                  {a.city && ` · ${a.city}`}
                                </div>
                              </div>
                              {selectedAgency?.id === a.id && <Check className="h-4 w-4 text-green-600" />}
                            </button>
                          ))}
                        </div>
                      )}
                      {agencySearchOpen && agencyQuery.length >= 2 && agencyResults.length === 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-lg border bg-white p-3 text-sm text-muted-foreground shadow-lg">
                          No agencies found. Try a different search or{' '}
                          <button type="button" className="underline text-foreground" onClick={() => setField('agency_mode', 'new')}>
                            register a new agency
                          </button>.
                        </div>
                      )}
                    </div>
                    {selectedAgency && (
                      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                        <div className="flex items-center gap-2 text-green-800 font-medium">
                          <Check className="h-4 w-4" /> Selected: {selectedAgency.name}
                        </div>
                        <p className="mt-1 text-green-700 text-xs">
                          An invitation email will be sent to this agency to confirm your affiliation.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* New agency registration */}
                {form.agency_mode === 'new' && (
                  <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                    <h4 className="text-sm font-semibold">Register New Agency</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Agency Name *</Label>
                        <Input value={form.agency_name} onChange={(e) => setField('agency_name', e.target.value)} placeholder="Haddad Premium Properties" />
                      </div>
                      <div className="space-y-2">
                        <Label>Commercial License Number *</Label>
                        <Input value={form.agency_license} onChange={(e) => setField('agency_license', e.target.value)} placeholder="AL-8892" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Agency Address *</Label>
                      <Input value={form.agency_address} onChange={(e) => setField('agency_address', e.target.value)} placeholder="Sassine Street, Achrafieh, Beirut" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Company Website</Label>
                        <Input value={form.agency_website} onChange={(e) => setField('agency_website', e.target.value)} placeholder="https://agency.com" />
                      </div>
                      <div className="space-y-2">
                        <Label>Company Email *</Label>
                        <Input type="email" value={form.agency_email} onChange={(e) => setField('agency_email', e.target.value)} placeholder="info@agency.com" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Company Phone *</Label>
                      <Input value={form.agency_phone} onChange={(e) => setField('agency_phone', e.target.value)} placeholder="+961 1 000 000" />
                    </div>
                    <div className="border-t pt-3">
                      <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Primary Contact Details</h5>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>First Name *</Label>
                          <Input value={form.primary_contact_first} onChange={(e) => setField('primary_contact_first', e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Last Name *</Label>
                          <Input value={form.primary_contact_last} onChange={(e) => setField('primary_contact_last', e.target.value)} />
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 mt-3">
                        <div className="space-y-2">
                          <Label>Job Title</Label>
                          <Input value={form.primary_contact_title} onChange={(e) => setField('primary_contact_title', e.target.value)} placeholder="Managing Director" />
                        </div>
                        <div className="space-y-2">
                          <Label>Email *</Label>
                          <Input type="email" value={form.primary_contact_email} onChange={(e) => setField('primary_contact_email', e.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-2 mt-3">
                        <Label>Phone</Label>
                        <Input value={form.primary_contact_phone} onChange={(e) => setField('primary_contact_phone', e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Terms & reCAPTCHA */}
            <Card className="border shadow-sm">
              <CardContent className="space-y-4 pt-6">
                <div id="recaptcha-root" />

                {/* Terms checkbox */}
                <label className="flex items-start gap-3 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300"
                    checked={form.terms_accepted}
                    onChange={(e) => setField('terms_accepted', e.target.checked)}
                  />
                  <span>
                    I accept the{' '}
                    <Link to="/terms" className="underline underline-offset-2 text-foreground">Terms of Use</Link>{' '}
                    and{' '}
                    <Link to="/privacy" className="underline underline-offset-2 text-foreground">Privacy Policy</Link>{' '}
                    in the creation of my Real Estate Bazaar account. I confirm that all information provided is accurate and that I hold a valid real estate license where applicable.
                  </span>
                </label>

                {/* Submit */}
                <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-between">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="gap-2">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="h-11 gap-2 bg-[#0F0F0F] text-white hover:bg-[#2F2F2F]"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Create Account
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        )}
      </div>
    </div>
  )
}
