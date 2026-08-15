#!/usr/bin/env bun
/**
 * Golden set for semantic search eval.
 *
 * Labeled against scheduled events in the dev DB on 2026-08-14 (see
 * inspect-events.ts to dump current data). Events expire, so this set goes
 * stale — refresh labels when the suite starts failing for data reasons
 * rather than retrieval reasons.
 *
 * Keep labels tight (1–3 IDs): recall@5 is found/labeled, so listing every
 * recurring date of the same series makes a correct top-5 look like a miss.
 * Prefer the soonest distinct matches, not every later copy.
 *
 * Previous labels (2026-08-08, mostly past): golden-2026-08-08.ts
 */
export interface GoldenQuery {
  query: string
  /** event IDs considered relevant for this query */
  relevant: string[]
  note?: string
}

export const GOLDEN_QUERIES: GoldenQuery[] = [
  {
    query: 'bbq smoked meats festival',
    relevant: [
      '03dfc9b0-e284-4e8e-9faf-588901710772', // Smoked, Festival de Ahumados
      '5d2a620c-2f9c-440d-b96b-ca78e8c2e763', // Carne! Festival de Parrillas
    ],
  },
  {
    query: 'argentine alfajor sweets celebration',
    relevant: ['e5c000c5-28f4-4730-84c9-b93af5ceebdf'], // Campenato Argentino del Alfajor
  },
  {
    query: 'tango dancing class',
    relevant: [
      '6186ade4-3281-4598-942b-713ba80f7f49', // TANGO desde cero y AMIGOS
      '25422ab4-a181-4e40-8ea1-3d50bfcddcac', // Learn Tango
    ],
  },
  {
    query: 'practice english language exchange',
    relevant: [
      'c7625df8-5fff-4862-9f2c-8c4c3e3c698c', // Language Exchange Café
      '2d2f9265-31ee-4e76-af85-d44ee2feb4ef', // Language Exchange Party
      '9b542a00-2316-408d-82d1-e22a6725db7f', // Spanglish Thursday
    ],
  },
  {
    query: 'meet new people make friends social',
    relevant: [
      '06dc5301-15ef-4727-8fbd-b071d1548d38', // Make Friends: Deep talks & Coffee
      'f3bcb0c1-145a-4db7-bbc7-ecfefc7d18ee', // Social Meet - International Friends
    ],
  },
  {
    query: 'elegant classical music evening with wine',
    relevant: [
      'e49e9331-5e37-4488-8b80-8436b8cfbefc', // Coldplay. Piano, Violín y vino
      'c1c87611-9f28-4a80-bdb6-5046fc0efca8', // Cata y Lírica Palacio Paz
    ],
  },
  {
    query: 'family theater show for kids',
    relevant: ['6e66cb18-af7d-422f-bba5-aced7a62df1a'], // Annie
  },
  {
    query: 'boat tour on the river',
    relevant: [
      '68cb980f-4406-494e-a607-fe7c701438ad', // Navegación por el Riachuelo
      'ba144010-5b45-4971-819c-d99c48056a5c',
    ],
  },
  {
    query: 'tourist sightseeing iconic landmarks',
    relevant: [
      '3a266e15-53ce-45f7-8ac2-3d82137e159b', // Bus Turístico
      'c10d1c02-09fe-4d9d-9bc8-2b1bb207a091', // Mirador Obelisco
    ],
  },
  {
    query: 'bar crawl nightlife party',
    relevant: [
      'e57b7b50-5e2f-463b-b6c8-3081e14ec343', // NightCrawl BA - Bar Tour
      '48b4f854-c7f4-43d4-ac5d-5b354edd50ff', // Speakeasy Hidden Bar Tour
    ],
  },
  {
    query: 'trivia quiz night with games',
    relevant: [
      '9be96614-ce8c-42c9-af98-60585bbb8b9e', // Noche de Trivia Shamrock
      '686fe228-5753-4751-9b94-4ec2b3c96ce5', // Trivia Night
      '64d2185f-1b5f-4683-b689-98ebed30222b', // BA Trivia Pub Quiz
    ],
  },
  {
    query: 'k-pop festival',
    relevant: ['bfdaeaf5-fa3e-4d08-a515-963fbbca8f08'], // EXPERIENCIA KPOP
  },
  {
    query: 'independent books literature fair',
    relevant: [
      '9f5c3a5d-517d-4a0e-8bee-6e010d20ea1e', // Feria de Editores 2026
      '4c17a7f3-e22a-415d-aa4b-34c646b548de', // Feria del Libro Raro y Curioso
    ],
  },
  {
    query: 'interactive murder mystery comedy',
    relevant: [
      'edf5b371-200d-4013-90dc-469896b5047d', // Mafia Game Night
      '23f7d601-4f8e-4d3f-a816-0192fd58a6f3', // El Cuadro Maldito
    ],
  },
  {
    query: 'argentine rock tribute charly garcia',
    relevant: [
      '7a3858f8-acc2-42ed-9f8d-79d59b40555e', // Íconos del Rock Nacional
      '9d47e23c-ff08-429a-8d2e-d9bf9a504659', // Charly García Hello! MTV Unplugged
    ],
  },
  {
    query: 'wine tasting afternoon drinks',
    relevant: [
      '8cf4728c-1652-47fc-a552-91e92b38c498', // Cata con maridaje Bodega Benegas
      '4dd1ca75-bf4a-49cf-bf38-4c5936958d4f', // Degustación de 12 Pinot Noir
      '2b4768da-a94c-4629-ba8b-d00d9fc8a17b', // WINE ARGENTINA Palacio San Miguel
    ],
  },
  {
    query: 'spiritual wellness meditation movement',
    relevant: [
      'd3100db2-0ccc-4e2a-a815-92ebd70886bc', // Experiencia Wellness
      'c03a9098-5693-4233-8dfd-f0c2d733cd03', // Meditación presencial San Telmo
      '6103fe25-9948-4a40-98d1-b99870a47c34', // Biodanza
      '9089d173-0ef3-40a5-9419-e12381470bbd', // Ecstatic Dance
    ],
  },
  {
    query: 'big live music concert in an arena',
    relevant: [
      '35a3b49b-847b-41cf-8539-9ca602c68a08', // Soda Stereo Ecos — Movistar Arena
      '58205866-2251-4aee-9509-90367d25081b', // Serú Girán — Movistar Arena
    ],
  },
  {
    query: 'casual coffee meetup conversation',
    relevant: [
      '06dc5301-15ef-4727-8fbd-b071d1548d38', // Make Friends: Deep talks & Coffee
      '981174e8-d77a-4eb8-9d5a-db1a5ab1b395', // Coffee meeting
    ],
  },
  {
    query: 'tech talks engineering networking',
    relevant: [
      '4e3d7563-7c13-4354-81ad-420913959009', // Hackware hardware hackathon
      'c62659df-d767-4dfb-8d3e-180de8009a62', // Networking en Palermo
      'cb26fb08-d75f-4959-b24b-55f2d5a0ffc2', // Tecnologías para la Transición Climática
    ],
  },
  {
    query: 'museum cultural art experience',
    relevant: [
      '97ac54c8-0b12-40ec-b281-eb4c95cb04b0', // Museo del Mate
      'fe340bbf-7161-48e4-be1a-c204dcfc8b20', // Casa Nacional / Museo del Grabado
    ],
  },
  {
    query: 'creative writing group',
    relevant: ['7b9fd51a-a936-4349-86f8-b46e895ddf05'], // Write Club
  },
  {
    query: 'relaxed board games afternoon',
    relevant: ['21740c83-72bc-449d-8cda-4e8e2b636bd7'], // Board Game Night
  },
  {
    query: 'outdoor food festival',
    relevant: [
      '03dfc9b0-e284-4e8e-9faf-588901710772', // Smoked, Festival de Ahumados
      '5d2a620c-2f9c-440d-b96b-ca78e8c2e763', // Carne! Festival de Parrillas
      'e5c000c5-28f4-4730-84c9-b93af5ceebdf', // Campenato Argentino del Alfajor
    ],
  },
]
