import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Trash2 } from 'lucide-react'

interface QuotasEditorProps {
  value: Record<string, number>
  onChange: (next: Record<string, number>) => void
  disabled?: boolean
}

interface Row {
  key: string
  value: string
}

function fromMap(map: Record<string, number>): Row[] {
  return Object.entries(map).map(([key, val]) => ({ key, value: String(val) }))
}

function toMap(rows: Row[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const k = row.key.trim()
    if (!k) continue
    const n = Number(row.value)
    if (!Number.isFinite(n) || n < 0) continue
    out[k] = Math.round(n)
  }
  return out
}

export function QuotasEditor({ value, onChange, disabled }: QuotasEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => fromMap(value))

  useEffect(() => {
    setRows(fromMap(value))
  }, [value])

  function updateRow(idx: number, patch: Partial<Row>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    setRows(next)
    onChange(toMap(next))
  }

  function removeRow(idx: number) {
    const next = rows.filter((_, i) => i !== idx)
    setRows(next)
    onChange(toMap(next))
  }

  function addRow() {
    const next = [...rows, { key: '', value: '0' }]
    setRows(next)
    onChange(toMap(next))
  }

  return (
    <div className="space-y-2">
      <Label>Quotas granted per period</Label>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No quotas set. This tier will grant no unit-based allowances.</p>
      ) : null}
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            placeholder="quota_key (e.g. outbound_whatsapp)"
            value={row.key}
            disabled={disabled}
            onChange={(e) => updateRow(idx, { key: e.target.value })}
            className="flex-1 font-mono text-xs"
          />
          <Input
            type="number"
            min={0}
            value={row.value}
            disabled={disabled}
            onChange={(e) => updateRow(idx, { value: e.target.value })}
            className="w-32 text-right"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => removeRow(idx)}
            disabled={disabled}
            aria-label="Remove quota"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={addRow} disabled={disabled}>
        + Add quota
      </Button>
    </div>
  )
}
