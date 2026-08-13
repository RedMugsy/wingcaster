interface ScoreGaugeProps {
  score: number | null
  label: string
  color?: string
  size?: number
}

export function ScoreGauge({ score, label, color = '#3B82F6', size = 120 }: ScoreGaugeProps) {
  const value = score == null || !Number.isFinite(score) ? 0 : Math.min(10, Math.max(0, score))
  const percentage = value * 10
  const radius = size / 2 - 10
  const circumference = 2 * Math.PI * radius
  const dashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E5E7EB"
            strokeWidth={8}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">{score == null ? '—' : value.toFixed(1)}</span>
          <span className="text-xs text-muted-foreground">/ 10</span>
        </div>
      </div>
      <span className="mt-2 text-center text-sm font-medium">{label}</span>
    </div>
  )
}
