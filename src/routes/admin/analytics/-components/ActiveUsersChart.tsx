import { useId } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import type { ActiveUserDataPoint } from '@/features/analytics/types'

interface ActiveUsersChartProps {
  data: ActiveUserDataPoint[]
  loading: boolean
  title: string
  color: string // oklch color string
  yAxisLabel: string
}

// Skeleton loader that mimics chart shape
function ChartSkeleton() {
  return (
    <div className="h-[250px] relative">
      {/* Y-axis skeleton */}
      <div className="absolute left-0 top-0 bottom-8 w-12 flex flex-col justify-between py-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-3 w-8 bg-muted/40 rounded animate-pulse" />
        ))}
      </div>

      {/* Chart area skeleton */}
      <div className="ml-14 mr-4 h-[calc(100%-32px)] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-muted/30 to-transparent rounded-lg animate-pulse" />
        {/* Fake line path */}
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
          <path
            d="M0,80 Q50,60 100,70 T200,50 T300,65 T400,45 T500,55"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="2"
            className="animate-pulse"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      {/* X-axis skeleton */}
      <div className="ml-14 mr-4 flex justify-between mt-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-3 w-10 bg-muted/40 rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}

// Custom tooltip component
function CustomTooltip({
  active,
  payload,
  label,
  title,
}: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string; color: string }>
  label?: string
  title: string
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
      <p className="text-sm font-medium text-muted-foreground mb-2">{label}</p>
      <div className="flex items-center gap-2">
        <div
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: payload[0].color }}
        />
        <span className="text-sm text-muted-foreground">{title}:</span>
        <span className="text-sm font-semibold text-foreground">
          {payload[0].value.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

export function ActiveUsersChart({ data, loading, title, color, yAxisLabel }: ActiveUsersChartProps) {
  const gradientId = useId()

  if (loading) {
    return <ChartSkeleton />
  }

  if (data.length === 0) {
    return (
      <div className="h-[250px] flex flex-col items-center justify-center text-center">
        <div className="p-4 rounded-full bg-muted/30 mb-4">
          <svg
            className="h-8 w-8 text-muted-foreground/50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
            />
          </svg>
        </div>
        <p className="text-muted-foreground font-medium">No data available</p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Data will appear as users visit the site
        </p>
      </div>
    )
  }

  // Format date for display
  const formattedData = data.map((point) => ({
    ...point,
    displayDate: new Date(point.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
  }))

  return (
    <div className="h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={formattedData}
          margin={{ top: 25, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={`gradient-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            strokeOpacity={0.3}
            vertical={false}
          />

          <XAxis
            dataKey="displayDate"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickCount={5}
            label={{
              value: 'Date',
              position: 'insideBottom',
              offset: -5,
              style: { fill: 'rgba(255, 255, 255, 0.7)', fontSize: 12, fontWeight: 500 },
            }}
          />

          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => value.toLocaleString()}
            width={50}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'rgba(255, 255, 255, 0.7)', fontSize: 12, fontWeight: 500, textAnchor: 'middle' },
            }}
          />

          <Tooltip content={<CustomTooltip title={title} />} />

          <Area
            type="monotone"
            dataKey="activeUsers"
            name={title}
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${gradientId})`}
            fillOpacity={1}
          >
            <LabelList
              dataKey="activeUsers"
              position="top"
              offset={8}
              style={{ fill: 'rgba(255, 255, 255, 0.85)', fontSize: 11, fontWeight: 500 }}
            />
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
