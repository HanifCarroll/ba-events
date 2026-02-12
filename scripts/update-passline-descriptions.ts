import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync } from 'fs'

config({ path: '.env' })

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

interface EnrichedEvent {
  id: string
  description_es: string
}

async function main() {
  const inputFile = process.argv[2]
  if (!inputFile) {
    console.log('Usage: bun scripts/update-passline-descriptions.ts <json-file>')
    process.exit(1)
  }

  const events: EnrichedEvent[] = JSON.parse(readFileSync(inputFile, 'utf-8'))
  console.log(`Updating ${events.length} events with descriptions...`)

  let updated = 0
  let failed = 0

  for (const event of events) {
    const { error } = await supabase
      .from('events')
      .update({
        description_es: event.description_es,
        description_unavailable: false
      })
      .eq('id', event.id)

    if (error) {
      console.log(`Failed ${event.id}: ${error.message}`)
      failed++
    } else {
      updated++
    }
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed`)
}

main()
