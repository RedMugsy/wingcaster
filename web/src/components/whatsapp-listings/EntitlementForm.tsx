import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface EntitlementFormProps {
  initial?: {
    scope?: string
    scope_id?: string
    enabled?: boolean
    max_drafts_per_month?: number
    ai_providers_allowed?: string[]
    thumbnail_variants?: string[]
    auto_publish_social?: boolean
  }
  onSubmit: (data: Record<string, unknown>) => void
  onCancel?: () => void
}

export function EntitlementForm({ initial, onSubmit, onCancel }: EntitlementFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entitlement</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            onSubmit({
              scope: fd.get('scope') || initial?.scope,
              scope_id: fd.get('scope_id') || initial?.scope_id,
              enabled: fd.get('enabled') === 'on',
              config: {
                max_drafts_per_month: Number(fd.get('max_drafts_per_month') || 50),
                ai_providers_allowed: String(fd.get('ai_providers_allowed') || 'gemini,openai')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                thumbnail_variants: String(fd.get('thumbnail_variants') || 'luxe,modern,urgent')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                auto_publish_social: fd.get('auto_publish_social') === 'on',
              },
            })
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="scope">Scope</Label>
            <Input name="scope" defaultValue={initial?.scope || 'agent'} />
          </div>
          <div>
            <Label htmlFor="scope_id">Scope ID</Label>
            <Input name="scope_id" defaultValue={initial?.scope_id || ''} />
          </div>
          <div className="flex items-center gap-2">
            <input name="enabled" type="checkbox" defaultChecked={initial?.enabled !== false} id="enabled" />
            <Label htmlFor="enabled">Enabled</Label>
          </div>
          <div>
            <Label htmlFor="max_drafts_per_month">Max drafts / month</Label>
            <Input name="max_drafts_per_month" type="number" defaultValue={initial?.max_drafts_per_month || 50} />
          </div>
          <div>
            <Label htmlFor="ai_providers_allowed">AI providers allowed (comma-separated)</Label>
            <Input name="ai_providers_allowed" defaultValue={(initial?.ai_providers_allowed || ['gemini', 'openai']).join(',')} />
          </div>
          <div>
            <Label htmlFor="thumbnail_variants">Template variants (comma-separated)</Label>
            <Input name="thumbnail_variants" defaultValue={(initial?.thumbnail_variants || ['luxe', 'modern', 'urgent']).join(',')} />
          </div>
          <div className="flex items-center gap-2">
            <input name="auto_publish_social" type="checkbox" defaultChecked={initial?.auto_publish_social || false} id="auto_publish_social" />
            <Label htmlFor="auto_publish_social">Auto-publish to social</Label>
          </div>
          <div className="flex gap-2">
            <Button type="submit">Save</Button>
            {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
