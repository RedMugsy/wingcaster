import { AlertTriangle, CheckCircle2, HelpCircle, MinusCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { computeVariableDiagnostics } from './helpers'

interface Props {
  template: {
    subject?: string | null
    html_body?: string | null
    text_body?: string | null
    required_variables?: string[]
    optional_variables?: string[]
  }
}

/**
 * Diagnostic panel that shows the admin exactly which variables their
 * template references, which are declared, and which are missing.
 *
 * Rendered in the Variables tab of the edit page. Four categorised
 * sections rather than a single wall of names, because each category
 * carries a different action:
 *
 *   * Required, present    — nothing to do. Green.
 *   * Required, missing    — BLOCKS save. Red. Names the exact strings
 *                            the template body must include.
 *   * Optional, referenced — informational. The variable is documented
 *                            and used. Muted green.
 *   * Optional, unreferenced — informational. The variable is
 *                            documented but the current copy does not
 *                            use it. Muted grey — usually fine.
 *   * Referenced but unknown — WARNING. The variable appears in the
 *                            body but is not in required/optional.
 *                            Renders as blank at send time. Amber.
 *
 * A summary chip at the top gives a status glance without needing to
 * scan the list — matches the ProductStatusBadge pattern used elsewhere
 * in the admin console.
 */
export function VariableDiagnosticsPanel({ template }: Props) {
  const diag = computeVariableDiagnostics(template)
  const hasBlockers = diag.required_missing.length > 0
  const hasWarnings = diag.unknown_referenced.length > 0

  const summaryTone: 'ok' | 'warn' | 'blocked' = hasBlockers ? 'blocked' : hasWarnings ? 'warn' : 'ok'
  const summaryText =
    summaryTone === 'blocked'
      ? `Cannot save — ${diag.required_missing.length} required variable${diag.required_missing.length === 1 ? '' : 's'} missing from the body.`
      : summaryTone === 'warn'
        ? `${diag.unknown_referenced.length} unknown variable${diag.unknown_referenced.length === 1 ? '' : 's'} will render blank at send time.`
        : 'All required variables are referenced. Template is publishable.'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Variables</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <StatusSummary tone={summaryTone} text={summaryText} />

        <Section
          title="Required — present"
          hint="Referenced in the body. Substituted at send time."
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden />}
          items={diag.required_present}
          variant="green"
          emptyText="No required variables referenced yet."
        />

        <Section
          title="Required — missing"
          hint="Declared as required but not referenced anywhere in the subject, HTML body, or text body. Add them or remove them from the required list."
          icon={<AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />}
          items={diag.required_missing}
          variant="red"
          emptyText="None missing — every required variable is used."
        />

        <Section
          title="Referenced — not declared"
          hint="Appears in the body but not in required or optional. Will render as an empty string at send time. Add it to optional variables, or remove it from the body."
          icon={<HelpCircle className="h-4 w-4 text-amber-600" aria-hidden />}
          items={diag.unknown_referenced}
          variant="amber"
          emptyText="Every referenced variable is declared."
        />

        <Section
          title="Optional — present"
          hint="Documented and used. Callers may or may not provide a value; missing values render as blank."
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden />}
          items={diag.optional_referenced}
          variant="green-muted"
          emptyText="No optional variables referenced."
        />

        <Section
          title="Optional — not used"
          hint="Declared as optional but not currently referenced. Harmless — informational only."
          icon={<MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden />}
          items={diag.optional_unreferenced}
          variant="muted"
          emptyText="No unused optional variables."
        />
      </CardContent>
    </Card>
  )
}

type Tone = 'ok' | 'warn' | 'blocked'

function StatusSummary({ tone, text }: { tone: Tone; text: string }) {
  const styles: Record<Tone, string> = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    blocked: 'border-red-200 bg-red-50 text-red-900',
  }
  const Icon = tone === 'blocked' ? AlertTriangle : tone === 'warn' ? HelpCircle : CheckCircle2
  return (
    <div
      role={tone === 'blocked' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-md border p-3 text-sm ${styles[tone]}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <span>{text}</span>
    </div>
  )
}

type SectionVariant = 'green' | 'red' | 'amber' | 'green-muted' | 'muted'

function Section({
  title,
  hint,
  icon,
  items,
  variant,
  emptyText,
}: {
  title: string
  hint: string
  icon: React.ReactNode
  items: string[]
  variant: SectionVariant
  emptyText: string
}) {
  const badgeClass: Record<SectionVariant, string> = {
    green: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    red: 'border-red-300 bg-red-50 text-red-800',
    amber: 'border-amber-300 bg-amber-50 text-amber-800',
    'green-muted': 'border-emerald-200 bg-emerald-50/60 text-emerald-800',
    muted: 'border-border bg-muted/60 text-muted-foreground',
  }
  return (
    <section className="space-y-2" aria-labelledby={`vars-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <header className="flex items-center gap-2">
        {icon}
        <h4 id={`vars-${title.replace(/\s+/g, '-').toLowerCase()}`} className="text-sm font-semibold">
          {title}
        </h4>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </header>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((name) => (
            <li key={name}>
              <Badge variant="outline" className={`font-mono text-xs ${badgeClass[variant]}`}>
                {`{{${name}}}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
