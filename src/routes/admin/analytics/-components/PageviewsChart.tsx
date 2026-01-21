import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { PageviewDataPoint } from '@/features/analytics/types'

interface PageviewsChartProps {
  data: PageviewDataPoint[]
  loading: boolean
}

export function PageviewsChart({ data, loading }: PageviewsChartProps) {
  if (loading) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
        No pageview data available
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
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={formattedData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis
            dataKey="displayDate"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => value.toLocaleString()}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))' }}
            itemStyle={{ color: 'hsl(var(--foreground))' }}
          />
          <Legend
            wrapperStyle={{ paddingTop: '20px' }}
          />
          <Line
            type="monotone"
            dataKey="pageviews"
            name="Pageviews"
            stroke="oklch(0.78 0.14 75)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6, fill: 'oklch(0.78 0.14 75)' }}
          />
          <Line
            type="monotone"
            dataKey="uniqueUsers"
            name="Unique Users"
            stroke="oklch(0.7 0.15 200)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6, fill: 'oklch(0.7 0.15 200)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
