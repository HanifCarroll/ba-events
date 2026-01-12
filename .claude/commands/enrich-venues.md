---
description: Look up missing venue addresses and neighborhoods using Google Maps via Playwriter
allowed-tools: Bash, Read, Grep, mcp__playwriter__*, TodoWrite
argument-hint: [limit] (optional, default 10)
---

# Venue Address & Neighborhood Enrichment

Look up missing venue addresses and neighborhoods using Google Maps via Playwriter browser automation.

## Prerequisites

- Chrome browser must be open with the Playwriter extension active
- User should click the Playwriter extension icon on any tab to activate MCP connection

## Valid Neighborhoods

Buenos Aires (CABA) has 48 official neighborhoods. When matching, use exact names from this list:

Agronomia, Almagro, Balvanera, Barracas, Belgrano, Boedo, Caballito, Chacarita, Coghlan, Colegiales, Constitucion, Flores, Floresta, La Boca, La Paternal, Liniers, Mataderos, Monte Castro, Monserrat, Nueva Pompeya, Nunez, Palermo, Parque Avellaneda, Parque Chacabuco, Parque Chas, Parque Patricios, Puerto Madero, Recoleta, Retiro, Saavedra, San Cristobal, San Nicolas, San Telmo, Velez Sarsfield, Versalles, Villa Crespo, Villa del Parque, Villa Devoto, Villa General Mitre, Villa Lugano, Villa Luro, Villa Ortuzar, Villa Pueyrredon, Villa Real, Villa Riachuelo, Villa Santa Rita, Villa Soldati, Villa Urquiza

## Process

### 1. Find Venues Needing Enrichment

Query the database for venues missing addresses or neighborhoods:

```bash
bun scripts/find-venues-missing-info.ts $ARGUMENTS
```

Create this script if it doesn't exist:

```typescript
// scripts/find-venues-missing-info.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const limit = parseInt(process.argv[2] || '10')

  const { data, error } = await supabase
    .from('venues')
    .select('id, name, address, neighborhood')
    .or('address.is.null,neighborhood.is.null')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  console.log(`Found ${data.length} venues needing enrichment:\n`)
  data.forEach((v, i) => {
    console.log(`${i + 1}. ${v.name}`)
    console.log(`   Address: ${v.address || 'MISSING'}`)
    console.log(`   Neighborhood: ${v.neighborhood || 'MISSING'}`)
  })
  console.log('\n---JSON---')
  console.log(JSON.stringify(data))
}

main().catch(console.error)
```

### 2. Search Google Maps with Playwriter

For each venue, search Google Maps and extract the address:

```javascript
// Store venues in state
state.venues = [ /* array of {id, name, address, neighborhood} from DB query */ ];
state.results = [];

// Navigate to Google Maps
await page.goto('https://www.google.com/maps');
await page.waitForLoadState('networkidle');

// Process each venue
for (let i = 0; i < state.venues.length; i++) {
  const v = state.venues[i];
  console.log(`\n[${i+1}/${state.venues.length}] Searching for: ${v.name}`);

  // Search for venue in Buenos Aires
  const searchBox = page.locator('input#searchboxinput');
  await searchBox.fill(`${v.name} Buenos Aires Argentina`);
  await searchBox.press('Enter');
  await page.waitForTimeout(3000);

  // Try to extract address from the result
  const snapshot = await accessibilitySnapshot({ page, search: /address|direccion|calle/i });
  console.log('Snapshot:', snapshot);

  // Store result for manual review
  state.results.push({
    id: v.id,
    name: v.name,
    currentAddress: v.address,
    currentNeighborhood: v.neighborhood,
    // Fill in manually after reviewing the map
    newAddress: null,
    newNeighborhood: null,
  });
}
```

### 3. Manual Address Extraction

For each venue result, you should:

1. Look at the Google Maps result
2. Extract the street address (e.g., "Av. Corrientes 1234")
3. Identify the neighborhood from the address or map location
4. Match the neighborhood to one of the 48 valid CABA neighborhoods

Common neighborhood indicators:
- "Palermo" -> Palermo
- "San Telmo" -> San Telmo
- "Recoleta" -> Recoleta
- "Villa Crespo" -> Villa Crespo
- "La Boca" -> La Boca
- "Centro" -> Usually San Nicolas or Monserrat (check cross streets)

### 4. Update Database

After gathering addresses and neighborhoods, update the database:

```bash
bun scripts/update-venue-info.ts
```

Create this script with the extracted data:

```typescript
// scripts/update-venue-info.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const updates = [
  // Fill in with extracted data
  { id: 'uuid-here', address: 'Av. Corrientes 1234', neighborhood: 'San Nicolas' },
  // ... more venues
]

async function main() {
  console.log(`Updating ${updates.length} venues...`)

  let success = 0, failed = 0
  for (const venue of updates) {
    const updateData: Record<string, string> = {}
    if (venue.address) updateData.address = venue.address
    if (venue.neighborhood) updateData.neighborhood = venue.neighborhood

    const { error } = await supabase
      .from('venues')
      .update(updateData)
      .eq('id', venue.id)

    if (error) {
      console.log(`X ${venue.id}: ${error.message}`)
      failed++
    } else {
      console.log(`OK Updated venue ${venue.id}`)
      success++
    }
  }

  console.log(`\nDone: ${success} updated, ${failed} failed`)
}

main().catch(console.error)
```

### 5. Handle Non-CABA Venues

If a venue is found to be outside CABA (e.g., in Provincia de Buenos Aires, Avellaneda, etc.):

1. Note that it's outside CABA
2. Consider adding to the blocklist:
   ```bash
   bun -e "
   const { createClient } = require('@supabase/supabase-js');
   const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
   supabase.from('import_blocklist').insert({
     pattern: 'Venue Name Here',
     target_field: 'venue_name',
     source: 'all',
     reason: 'Outside CABA - located in Avellaneda'
   }).then(({error}) => error ? console.error(error) : console.log('Added to blocklist'));
   "
   ```
3. Delete the venue and associated events if they exist

### 6. Report Results

After completion, report:
- Number of venues successfully enriched (address found, neighborhood assigned)
- Venues that couldn't be found on Google Maps
- Venues found to be outside CABA (with recommended action)
- Remaining venues still missing address/neighborhood

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No browser tabs connected" | User needs to click Playwriter extension icon on a tab |
| Google Maps CAPTCHA | Wait for user to solve it manually, then continue |
| Venue not found | Try alternative search terms (e.g., just address, or venue type + street) |
| Multiple results | Review the map to pick the correct one |
| Connection lost | Call `mcp__playwriter__reset` to reconnect |
| Invalid neighborhood | Check the 48 valid CABA neighborhoods list above |

## Example Workflow

```
User: /enrich-venues 5

Claude:
1. Queries DB -> finds 5 venues missing addresses/neighborhoods
2. Opens Google Maps in Playwriter
3. Searches for each venue, extracts address info
4. Creates update script with found addresses + neighborhoods
5. Runs script to update DB
6. Reports: "Updated 4 venues. 1 not found on maps. 23 remaining."
```

## Tips

- Search with "Buenos Aires Argentina" suffix for better results
- For bars/restaurants, the name alone often works
- For generic venue names, try including the known address or cross streets
- If unsure about neighborhood, check the map zoom level to see barrio boundaries
- Use WebSearch as fallback if Google Maps doesn't find the venue
