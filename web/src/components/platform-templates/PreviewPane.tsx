import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/api/client'
import type { PlatformMessageTemplate, PlatformTemplatePreview } from '@/types/platformTemplates'
import { defaultPreviewVariables, extractAllVariables } from './helpers'

interface Props {
  template: PlatformMessageTemplate
  /**
   * Latest unsaved edits to render — the edit page passes its dirty state
   * here so the admin can preview edits before saving. Falls back to the
   * template's persisted content when the field is omitted.
   */
  draft?: Partial<Pick<PlatformMessageTemplate, 'subject' | 'html_body' | 'text_body' | 'required_variables' | 'optional_variables'>>
  /**
   * When true, uses the backend preview endpoint (server-side render,
   * closer to what the recipient will actually see). When false, renders
   * client-side using the helpers. Server-side is authoritative but
   * costs a round-trip per debounce tick.
   */
  useServer?: boolean
}

const DEBOUNCE_MS = 250

/**
 * Live preview pane for the template edit page.
 *
 * Two rendering modes:
 *   * server (default) — POST /admin/message-templates/:id/preview so the
 *     admin sees exactly what the backend renderer produces, including
 *     HTML-escaping semantics the client can't perfectly mirror. Debounced.
 *   * client — instant, no network. Useful when the admin is scrubbing
 *     through variable values and the network jitter would be
 *     distracting.
 *
 * The HTML preview renders inside an iframe with sandbox="" — no scripts,
 * no plugins, no external form submission. That is deliberate: the
 * admin's HTML could contain anything (they own the template), but a
 * bug that let a script run would compromise every OTHER page in the
 * admin console. The sandbox is the containment boundary.
 */
export function PreviewPane({ template, draft, useServer = true }: Props) {
  // Merge the persisted template with any unsaved draft so the preview
  // reflects what the admin is currently typing, not last-saved content.
  const merged = useMemo(() => ({
    subject: draft?.subject ?? template.subject,
    html_body: draft?.html_body ?? template.html_body,
    text_body: draft?.text_body ?? template.text_body,
    required_variables: draft?.required_variables ?? template.required_variables,
    optional_variables: draft?.optional_variables ?? template.optional_variables,
  }), [template, draft])

  // Variables the admin can play with in the form. Seed with either the
  // template's known variables (with sample values) or whatever the body
  // references — whichever is broader.
  const [variables, setVariables] = useState<Record<string, string>>(() =>
    hydrateVariables(defaultPreviewVariables(merged), extractAllVariables(merged)),
  )
  useEffect(() => {
    // If the template gains/loses variables while the pane is open, add
    // fresh sample values for the newcomers without wiping user-typed
    // overrides for existing keys.
    setVariables((prev) => {
      const desired = new Set(extractAllVariables(merged))
      const withSamples = { ...defaultPreviewVariables(merged), ...prev }
      const trimmed: Record<string, string> = {}
      for (const key of desired) trimmed[key] = withSamples[key] ?? ''
      return trimmed
    })
  }, [merged])

  const [rendered, setRendered] = useState<PlatformTemplatePreview['rendered'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Debounced render trigger.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const handle = setTimeout(async () => {
      try {
        if (useServer) {
          const result = await api.previewPlatformTemplate(template.id, variables)
          if (!cancelled) setRendered(result.rendered)
        } else {
          // Client-side render — shape-compatible with the server response.
          const local = renderClientSide(merged, variables)
          if (!cancelled) setRendered(local)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = (err as { message?: string })?.message || 'Preview render failed'
          setError(msg)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [template.id, merged, variables, useServer])

  // Push the rendered HTML into the iframe. Using srcDoc means the
  // sandbox attribute governs execution — a `document.write` from an
  // inline handler cannot escape.
  useEffect(() => {
    if (!iframeRef.current) return
    iframeRef.current.srcdoc = wrapHtmlDocument(rendered?.html_body || '')
  }, [rendered?.html_body])

  const varNames = Object.keys(variables).sort()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Preview</CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              <span>Rendering…</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              <span>{useServer ? 'Server render' : 'Local render'}</span>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </div>
        )}

        {varNames.length > 0 && (
          <section aria-labelledby="preview-vars-heading" className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <h4 id="preview-vars-heading" className="text-sm font-semibold">
              Sample variables
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {varNames.map((name) => (
                <div key={name} className="space-y-1">
                  <Label htmlFor={`preview-var-${name}`} className="font-mono text-xs">
                    {`{{${name}}}`}
                  </Label>
                  <Input
                    id={`preview-var-${name}`}
                    value={variables[name] ?? ''}
                    onChange={(e) => setVariables((prev) => ({ ...prev, [name]: e.target.value }))}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Values here are only used for this preview. They are not saved with the template.
            </p>
          </section>
        )}

        <Tabs defaultValue="html" className="w-full">
          <TabsList>
            <TabsTrigger value="html">HTML preview</TabsTrigger>
            <TabsTrigger value="text">Plain text</TabsTrigger>
            <TabsTrigger value="subject">Subject</TabsTrigger>
          </TabsList>

          <TabsContent value="html" className="mt-3">
            <div className="rounded-md border border-border bg-white">
              <iframe
                ref={iframeRef}
                // sandbox="" is the strongest possible sandbox: no scripts,
                // no forms, no same-origin. Admin templates render safely.
                sandbox=""
                title="Rendered HTML preview"
                className="h-[520px] w-full rounded-md"
                aria-label="Rendered HTML preview"
              />
            </div>
          </TabsContent>

          <TabsContent value="text" className="mt-3">
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-white p-4 text-sm text-foreground">
              {rendered?.text_body ?? ''}
            </pre>
          </TabsContent>

          <TabsContent value="subject" className="mt-3">
            <div className="rounded-md border border-border bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Subject</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{rendered?.subject ?? ''}</div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

/** Seed values for variables the body references but the template doesn't declare. */
function hydrateVariables(base: Record<string, string>, extraNames: string[]): Record<string, string> {
  const out: Record<string, string> = { ...base }
  for (const name of extraNames) {
    if (out[name] === undefined) out[name] = `<${name}>`
  }
  return out
}

/**
 * Client-side render — mirrors the backend's semantics closely enough for
 * a preview but is NOT the source of truth. Values are HTML-escaped in
 * html_body, left raw in subject and text_body.
 */
function renderClientSide(
  template: { subject?: string | null; html_body?: string | null; text_body?: string | null },
  variables: Record<string, string>,
): PlatformTemplatePreview['rendered'] {
  const substitute = (source: string | null | undefined, escape: boolean) => {
    if (!source) return ''
    return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => {
      const value = variables[name]
      if (value == null) return ''
      return escape ? escapeHtml(value) : value
    })
  }
  return {
    subject: substitute(template.subject, false),
    html_body: substitute(template.html_body, true),
    text_body: substitute(template.text_body, false),
  }
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPE[c])
}

/**
 * Wrap the rendered HTML body in a minimal document with viewport +
 * neutral styling so the preview looks like an actual email client's
 * default rather than raw fragment against the admin console's own CSS.
 */
function wrapHtmlDocument(bodyHtml: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; padding: 24px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5; }
    a { color: #C8963C; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`
}
