interface SemiCircleRadarProps {
  scores: {
    inner?: number | null
    middle?: number | null
    outer?: number | null
  }
  size?: number
}

export function SemiCircleRadar({ scores, size = 280 }: SemiCircleRadarProps) {
  const bands = [
    { key: 'inner', radius: size * 0.45, color: '#3B82F6', stroke: 12, label: 'Local 0–3km', score: scores.inner },
    { key: 'middle', radius: size * 0.32, color: '#60A5FA', stroke: 10, label: 'Secondary 3–5km', score: scores.middle },
    { key: 'outer', radius: size * 0.19, color: '#93C5FD', stroke: 8, label: 'Macro 5–10km', score: scores.outer },
  ]

  const cx = size / 2
  const cy = size - 20

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 20}>
        {bands.map((band) => {
          const value = band.score == null || !Number.isFinite(band.score) ? 0 : Math.min(10, Math.max(0, band.score))
          const circumference = Math.PI * band.radius
          const fill = (value / 10) * circumference
          return (
            <g key={band.key}>
              <circle
                cx={cx}
                cy={cy}
                r={band.radius}
                fill="none"
                stroke={band.color}
                strokeWidth={band.stroke}
                strokeDasharray={`${fill} ${circumference}`}
                strokeLinecap="round"
                transform={`rotate(180 ${cx} ${cy})`}
              />
              <text
                x={cx}
                y={cy - band.radius}
                textAnchor="middle"
                className="fill-foreground text-xs font-semibold"
                dy={-6}
              >
                {band.score == null ? '—' : value.toFixed(1)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        {bands.map((band) => (
          <div key={band.key} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: band.color }} />
            <span>{band.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
