import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { clearElevatedToken } from '@/api/client'
import { StepUpModal } from '@/components/auth/StepUpModal'
import { STEP_UP_REQUIRED } from '@/types/twoFactor'

interface StepUpContextType {
  /**
   * Prompt for re-authentication. Resolves true once elevation is obtained,
   * false if the user cancels.
   */
  requireElevation: (actionLabel?: string) => Promise<boolean>
  /**
   * Run a request, and if the server rejects it with `step_up_required`,
   * prompt for elevation and run it again. Returns null if the user cancels.
   *
   * This is the seam Phase 7f/3 uses: gated call sites wrap their request and
   * gain the whole prompt-and-retry flow without knowing anything about it.
   */
  runElevated: <T>(action: () => Promise<T>, actionLabel?: string) => Promise<T | null>
}

const StepUpContext = createContext<StepUpContextType>({
  requireElevation: async () => false,
  runElevated: async (action) => action(),
})

interface PendingPrompt {
  actionLabel?: string
  resolve: (elevated: boolean) => void
}

/** A 401 carrying the backend's step-up code, in any of its shapes. */
function isStepUpRequired(err: unknown): boolean {
  const e = err as { code?: string; status?: number } | null
  return Boolean(e && e.code === STEP_UP_REQUIRED)
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null)

  const requireElevation = useCallback(
    (actionLabel?: string) =>
      new Promise<boolean>((resolve) => {
        setPending({ actionLabel, resolve })
      }),
    [],
  )

  const runElevated = useCallback(
    async <T,>(action: () => Promise<T>, actionLabel?: string): Promise<T | null> => {
      try {
        return await action()
      } catch (err) {
        if (!isStepUpRequired(err)) throw err
        // Whatever we were holding is stale or absent — drop it so the retry
        // cannot re-send a token the server has already refused.
        clearElevatedToken()
        const elevated = await requireElevation(actionLabel)
        if (!elevated) return null
        return await action()
      }
    },
    [requireElevation],
  )

  const settle = (elevated: boolean) => {
    pending?.resolve(elevated)
    setPending(null)
  }

  return (
    <StepUpContext.Provider value={{ requireElevation, runElevated }}>
      {children}
      <StepUpModal
        open={pending !== null}
        actionLabel={pending?.actionLabel}
        onCancel={() => settle(false)}
        onElevated={() => settle(true)}
      />
    </StepUpContext.Provider>
  )
}

export function useStepUp() {
  return useContext(StepUpContext)
}
