/**
 * Update events with scraped descriptions
 * Pass JSON results via stdin or as argument
 */

import { createClient } from '@supabase/supabase-js'

// Use service role key to bypass RLS
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface Result {
  id: string
  name?: string
  description: string | null
}

async function main() {
  // Read results from file path argument
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Usage: bun run scripts/update-descriptions.ts /path/to/results.json')
    process.exit(1)
  }

  const fs = await import('fs')
  const resultsJson = fs.readFileSync(filePath, 'utf-8')
  const results: Result[] = JSON.parse(resultsJson)
  console.log(`Processing ${results.length} results...`)

  let updated = 0
  let markedUnavailable = 0

  for (const result of results) {
    if (result.description) {
      // Update with description
      const { error } = await supabase
        .from('events')
        .update({
          description_es: result.description,
          enrichment_status: 'completed',
        })
        .eq('id', result.id)

      if (error) {
        console.error(`Error updating ${result.id}:`, error.message)
      } else {
        updated++
        console.log(`✓ Updated: ${result.name || result.id}`)
      }
    } else {
      // Mark as description unavailable
      const { error } = await supabase
        .from('events')
        .update({
          description_unavailable: true,
          enrichment_status: 'completed',
        })
        .eq('id', result.id)

      if (error) {
        console.error(`Error marking ${result.id}:`, error.message)
      } else {
        markedUnavailable++
        console.log(`⚠ Marked unavailable: ${result.name || result.id}`)
      }
    }
  }

  console.log(`\nDone! Updated: ${updated}, Marked unavailable: ${markedUnavailable}`)
}

main()
