import type { ImportSource } from '@/hooks/useImportWizard'

export type DataStatus = 'included' | 'requires_enrichment' | 'not_available'

export interface SourceMetadata {
  name: string
  color: string
  icon: 'zap' | 'ticket' | 'landmark' | 'users' | 'file-text'
  dataGaps: {
    description: DataStatus
    venue: DataStatus
    price: DataStatus
    categories: DataStatus
  }
  note: string
  autoEnrichDefault: boolean
}

export const SOURCE_METADATA: Record<ImportSource, SourceMetadata> = {
  passline: {
    name: 'Passline',
    color: 'primary',
    icon: 'zap',
    dataGaps: {
      description: 'requires_enrichment',
      venue: 'included',
      price: 'included',
      categories: 'requires_enrichment',
    },
    note: 'Descriptions and categories need enrichment after import.',
    autoEnrichDefault: true,
  },
  eventbrite: {
    name: 'Eventbrite',
    color: 'orange',
    icon: 'ticket',
    dataGaps: {
      description: 'included',
      venue: 'included',
      price: 'requires_enrichment',
      categories: 'requires_enrichment',
    },
    note: 'Prices and categories can be enriched after import.',
    autoEnrichDefault: false,
  },
  'ba-tourism': {
    name: 'BA Tourism',
    color: 'sky',
    icon: 'landmark',
    dataGaps: {
      description: 'included',
      venue: 'included',
      price: 'included',
      categories: 'included',
    },
    note: 'Most data is included. Some venues may need matching.',
    autoEnrichDefault: false,
  },
  meetup: {
    name: 'Meetup',
    color: 'red',
    icon: 'users',
    dataGaps: {
      description: 'included',
      venue: 'requires_enrichment',
      price: 'included',
      categories: 'requires_enrichment',
    },
    note: 'Venue details often need enrichment from event pages.',
    autoEnrichDefault: true,
  },
  csv: {
    name: 'CSV Import',
    color: 'gray',
    icon: 'file-text',
    dataGaps: {
      description: 'included',
      venue: 'included',
      price: 'included',
      categories: 'included',
    },
    note: 'Data quality depends on your CSV file.',
    autoEnrichDefault: false,
  },
}

export function getSourceMetadata(source: ImportSource): SourceMetadata {
  return SOURCE_METADATA[source]
}
