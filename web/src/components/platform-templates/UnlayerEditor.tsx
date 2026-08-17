import { Component, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Code2, LayoutTemplate, Loader2, RefreshCcw } from 'lucide-react'
import EmailEditor, { type EditorRef } from 'react-email-editor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { PlatformTemplateEditorMode } from '@/types/platformTemplates'

interface Props {
  /**
   * Current editor mode. 'unlayer' shows the drag-drop builder; 'raw'
   * shows a plain HTML textarea escape hatch. 'mjml' is stored in the
   * database (commit 2) but not wired to a UI yet — falls through to
   * the raw editor with a note.
   */
  mode: PlatformTemplateEditorMode
  onModeChange: (next: PlatformTemplateEditorMode) => void

  /**
   * HTML body of the template. In Unlayer mode this is the COMPILED
   * html; the source of truth is design_json (below). In raw mode this
   * is the source of truth.
   */
  html: string
  /**
   * Unlayer's serialised builder state. Used to seed the builder on
   * mount and after external changes (e.g. a version revert). Kept
   * separate from html because the builder's saveDesign() format is not
   * the same as the compiled output.
   */
  designJson: unknown | null
  /**
   * Text-only body. Not touched by the visual builder — surfaced as a
   * secondary textarea so admins can hand-author the plain-text
   * variant of an email.
   */
  text: string

  /**
   * Emitted whenever the current html/design/text changes. The parent
   * (TemplateEditPage in 5b/6) owns dirty tracking, so this fires on
   * every keystroke in raw mode and on every design:updated event in
   * Unlayer mode.
   *
   * The three fields are passed together so a parent doesn't have to
   * juggle three change handlers with subtle ordering.
   */
  onChange: (patch: { html?: string; design_json?: unknown; text?: string }) => void

  /**
   * Height for the Unlayer iframe. Defaults to 600px — enough to work
   * with without dominating the page on smaller displays.
   */
  minHeight?: number

  /**
   * Optional project id + user config passthrough. Unlayer's cloud
   * gallery / template marketplace require a Project ID; without one
   * the builder still works with its free block library.
   *
   * Read from env in the parent so different environments (dev / stage
   * / prod) can point at different projects.
   */
  projectId?: number
}

/**
 * UnlayerEditor — visual drag-drop email builder with an HTML source
 * escape hatch and an error boundary.
 *
 * The builder lives inside its own iframe (Unlayer's own containment),
 * which is helpful — a JS error in one of the block libraries cannot
 * take down the admin console. Still, the LOADER can throw if the
 * script fails to fetch, so a React ErrorBoundary wraps the whole thing.
 *
 * Two design constraints from the plan:
 *   1. Unlayer output must be usable as HTML in the shipping template.
 *      We call exportHtml() on every design:updated event and emit
 *      BOTH the design_json (source of truth for round-tripping) AND
 *      the compiled html (source of truth for the send).
 *   2. The admin must always have a raw-HTML fallback. The mode toggle
 *      switches to a plain textarea; whatever the admin types there
 *      becomes the html_body. Switching back to Unlayer loads the
 *      design_json — if there isn't one, Unlayer starts with a blank
 *      canvas rather than trying to reverse-engineer arbitrary HTML.
 */
export function UnlayerEditor(props: Props) {
  return (
    <UnlayerErrorBoundary>
      <UnlayerEditorInner {...props} />
    </UnlayerErrorBoundary>
  )
}

function UnlayerEditorInner({
  mode,
  onModeChange,
  html,
  designJson,
  text,
  onChange,
  minHeight = 600,
  projectId,
}: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutTemplate className="h-4 w-4" aria-hidden />
          Design
        </CardTitle>
        <ModeSwitch mode={mode} onModeChange={onModeChange} />
      </CardHeader>
      <CardContent>
        <Tabs value={mode === 'unlayer' ? 'visual' : 'raw'} className="w-full">
          <TabsList className="mb-3">
            <TabsTrigger value="visual" onClick={() => onModeChange('unlayer')}>
              <LayoutTemplate className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Visual builder
            </TabsTrigger>
            <TabsTrigger value="raw" onClick={() => onModeChange('raw')}>
              <Code2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              HTML source
            </TabsTrigger>
          </TabsList>

          <TabsContent value="visual" className="mt-0">
            {mode === 'unlayer' ? (
              <UnlayerCanvas
                html={html}
                designJson={designJson}
                onChange={onChange}
                minHeight={minHeight}
                projectId={projectId}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Switch to the Visual builder tab to see the drag-drop editor.</p>
            )}
          </TabsContent>

          <TabsContent value="raw" className="mt-0 space-y-4">
            <RawHtmlEditor
              html={html}
              text={text}
              onChange={onChange}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function ModeSwitch({ mode, onModeChange }: { mode: PlatformTemplateEditorMode; onModeChange: (next: PlatformTemplateEditorMode) => void }) {
  return (
    <div className="text-xs text-muted-foreground">
      {mode === 'mjml' ? (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900"
          title="MJML editor is planned but not built yet. HTML source is used as a fallback."
          role="status"
        >
          MJML source (compile step not wired)
        </span>
      ) : (
        <>Mode: <b className="text-foreground">{mode === 'unlayer' ? 'Visual builder' : 'HTML source'}</b></>
      )}
      {mode === 'mjml' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-2"
          onClick={() => onModeChange('raw')}
        >
          Switch to HTML source
        </Button>
      )}
    </div>
  )
}

function UnlayerCanvas({
  html,
  designJson,
  onChange,
  minHeight,
  projectId,
}: {
  html: string
  designJson: unknown | null
  onChange: (patch: { html?: string; design_json?: unknown }) => void
  minHeight: number
  projectId?: number
}) {
  const editorRef = useRef<EditorRef>(null)
  const [ready, setReady] = useState(false)
  // Track the last design we LOADED so parent-driven changes (e.g. a
  // version revert re-seeding designJson) reload the canvas without
  // an infinite export/change/reload loop.
  const loadedRef = useRef<unknown | null>(null)

  const emitFromEditor = useCallback(() => {
    const unlayer = editorRef.current?.editor
    if (!unlayer) return
    unlayer.saveDesign((design) => {
      unlayer.exportHtml((data) => {
        onChange({ html: data.html, design_json: design })
      })
    })
  }, [onChange])

  const onReady = useCallback(() => {
    setReady(true)
    const unlayer = editorRef.current?.editor
    if (!unlayer) return
    if (designJson) {
      unlayer.loadDesign(designJson as never)
      loadedRef.current = designJson
    }
    // Subscribe once the editor is ready. The library forwards design
    // updates through onDesignUpdated on the props, but we set up the
    // handler here so we can debounce inside the export pipeline.
    unlayer.addEventListener('design:updated', () => emitFromEditor())
  }, [designJson, emitFromEditor])

  // Reload the canvas when the parent's designJson changes and it's not
  // one we produced ourselves. Compare by reference — if the parent
  // reset the state (e.g. a revert), it hands us a new object.
  useEffect(() => {
    if (!ready) return
    const unlayer = editorRef.current?.editor
    if (!unlayer) return
    if (designJson && designJson !== loadedRef.current) {
      unlayer.loadDesign(designJson as never)
      loadedRef.current = designJson
    }
  }, [ready, designJson])

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white">
      {!ready && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Loading visual builder…</span>
        </div>
      )}
      <EmailEditor
        ref={editorRef}
        minHeight={minHeight}
        onReady={onReady}
        options={{
          projectId,
          displayMode: 'email',
          // No mergeTags here — the resolver on the backend substitutes
          // {{name}} at render time, so declaring them at the editor
          // level would just create duplicate tag lists.
        }}
      />
      {html && (
        <p className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Last export: {html.length.toLocaleString()} characters of HTML — saved with the template on next Save.
        </p>
      )}
    </div>
  )
}

function RawHtmlEditor({
  html,
  text,
  onChange,
}: {
  html: string
  text: string
  onChange: (patch: { html?: string; text?: string }) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="raw-html" className="mb-1.5 flex items-center justify-between text-sm">
          <span className="font-medium">HTML body</span>
          <span className="text-xs text-muted-foreground">
            {html.length.toLocaleString()} characters
          </span>
        </label>
        <textarea
          id="raw-html"
          value={html}
          onChange={(e) => onChange({ html: e.target.value })}
          rows={16}
          spellCheck={false}
          className="w-full rounded-md border border-input bg-white p-3 font-mono text-sm shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="<p>Hello {{name}}, your code is {{code}}.</p>"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Substituted variable values are HTML-escaped at render time — an admin's <code>{'Hi {{name}}'}</code>
          cannot become an XSS vector by a malicious <code>name</code>.
        </p>
      </div>
      <div>
        <label htmlFor="raw-text" className="mb-1.5 flex items-center justify-between text-sm">
          <span className="font-medium">Plain-text body</span>
          <span className="text-xs text-muted-foreground">
            {text.length.toLocaleString()} characters
          </span>
        </label>
        <textarea
          id="raw-text"
          value={text}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={8}
          spellCheck={false}
          className="w-full rounded-md border border-input bg-white p-3 font-mono text-sm shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder={'Hello {{name}}, your code is {{code}}.'}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Included as the text/plain part of the email; some clients render it (spam filters use
          it too). Variables are substituted verbatim — no escaping.
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Error boundary — catches Unlayer script-load / render failures     */
/* ------------------------------------------------------------------ */

interface BoundaryState {
  hasError: boolean
  error: Error | null
  attempt: number
}

class UnlayerErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false, error: null, attempt: 0 }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log but do not throw further — the fallback UI takes over. In
    // real production this would ship to whatever error tracker the app
    // has wired; for now, console is enough to be visible to an admin
    // hitting devtools when something breaks.
    // eslint-disable-next-line no-console
    console.error('[UnlayerEditor] boundary caught error', { error, info })
  }

  retry = () => {
    this.setState((prev) => ({ hasError: false, error: null, attempt: prev.attempt + 1 }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Visual builder failed to load
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">The Unlayer editor crashed.</p>
              <p className="mt-1">
                Most often this is a script-load failure (blocked by an ad-blocker, offline network,
                or CSP misconfiguration). The admin console itself is unaffected — you can retry the
                editor, or switch this template to HTML-source mode from the Settings tab and edit
                it that way.
              </p>
              {this.state.error && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium">Error details</summary>
                  <pre className="mt-2 overflow-auto text-xs">{this.state.error.message}</pre>
                </details>
              )}
            </div>
            <Button type="button" variant="outline" onClick={this.retry}>
              <RefreshCcw className="mr-2 h-4 w-4" aria-hidden />
              Retry
            </Button>
          </CardContent>
        </Card>
      )
    }
    // The `key` bumps every retry so React fully remounts the child
    // subtree — without this, a corrupted Unlayer iframe would persist
    // through the retry.
    return <div key={this.state.attempt}>{this.props.children}</div>
  }
}
