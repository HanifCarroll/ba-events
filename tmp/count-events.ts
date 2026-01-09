import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function countEvents() {
  // Total count
  const { count: total } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })

  console.log(`\n📊 Total Events: ${total}\n`)

  // By source
  const { data: bySource } = await supabase
    .rpc('count_events_by_source')
    .select()

  // If RPC doesn't exist, do it manually
  if (!bySource) {
    const sources = ['passline', 'eventbrite', 'ba-tourism', 'meetup', 'luma', 'manual']
    console.log('Events by Source:')
    for (const source of sources) {
      const { count } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('source', source)
      if (count && count > 0) {
        console.log(`  ${source}: ${count}`)
      }
    }
  }

  // By status - check what statuses actually exist
  const { data: statuses } = await supabase
    .from('events')
    .select('status')
    .limit(1000)

  const statusCounts: Record<string, number> = {}
  statuses?.forEach(e => {
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1
  })

  console.log('\nEvents by Status:')
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`)
  })

  // Recent imports (today)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { count: todayCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())

  console.log(`\n📅 Imported Today: ${todayCount}`)

  // Venues count
  const { count: venueCount } = await supabase
    .from('venues')
    .select('*', { count: 'exact', head: true })

  console.log(`🏢 Total Venues: ${venueCount}`)
}

countEvents().catch(console.error)
