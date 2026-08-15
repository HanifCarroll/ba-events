#!/usr/bin/env bun
/**
 * Expired golden labels from 2026-08-08. Kept for history only.
 * Live runner imports `./golden.ts`.
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
    relevant: ['a5fa63f9-09fc-4b9b-8558-504e14a061b5', '7ea97ad4-9ede-48d4-8863-a2c6956f1978'],
  },
  {
    query: 'argentine alfajor sweets celebration',
    relevant: ['3bb5c70d-52f2-40ea-b1ca-d7a22fee41c5', '08784b70-d1cc-4356-9817-7960f6241769'],
  },
  {
    query: 'tango dancing class',
    relevant: ['9a0f3383-b859-43db-a764-c0d79e372b10', '2a60d877-8a0d-4ac2-9a68-5b70ae91a740'],
  },
  {
    query: 'practice english language exchange',
    relevant: [
      '0e188ed2-d662-49df-98ea-93c73a9e9615',
      '33a31869-ec0f-46da-9136-b8a560750b92',
      'a24063e0-4042-4247-97a6-a4c77703f1e7',
      'b2bd49af-f5db-469b-a612-17577d993b1b',
      'd0dee98f-3502-425f-b1ec-e97aafc91a85',
      'fa6345a9-68fa-427f-a237-7d153b9bf98a',
      'e5d5a8c1-0866-4091-b994-177fe47187eb',
      'c7625df8-5fff-4862-9f2c-8c4c3e3c698c',
    ],
  },
  {
    query: 'meet new people make friends social',
    relevant: [
      'c6cbafa2-f190-46ad-9c53-c860d56a6f22',
      '06dc5301-15ef-4727-8fbd-b071d1548d38',
      'd0dee98f-3502-425f-b1ec-e97aafc91a85',
    ],
  },
  {
    query: 'elegant classical music evening with wine',
    relevant: [
      '5076d830-344d-4ca9-a137-e864a53725ca',
      '1070ee85-464b-4d32-9cc7-9595883d8291',
      '3c752f97-65cd-487f-9f58-3bab2248af0e',
    ],
  },
  {
    query: 'family theater show for kids',
    relevant: ['12a30899-25f6-4fc8-8aba-3b65b0e95e63', 'a341b0d7-061c-4a04-b3c1-2febf25de225'],
  },
  {
    query: 'boat tour on the river',
    relevant: ['314ae9d9-e91c-4223-881e-3b5a01d00974', 'eac6f420-eb4d-4d7f-ad4b-d349318c6f2a'],
  },
  {
    query: 'tourist sightseeing iconic landmarks',
    relevant: [
      '1f26283f-75aa-4188-9844-8fe5540a2dbf',
      'ab379ceb-1612-47c6-b358-52a5833a3051',
      '314ae9d9-e91c-4223-881e-3b5a01d00974',
    ],
  },
  {
    query: 'bar crawl nightlife party',
    relevant: [
      'aba2fe76-236c-4a0f-aff5-b24204d926d9',
      '34948a68-4ee8-49f3-aafb-6389f04d5744',
      'c9913cd2-c23d-4151-90ce-ef3a04aecb29',
      '48b4f854-c7f4-43d4-ac5d-5b354edd50ff',
    ],
  },
  {
    query: 'trivia quiz night with games',
    relevant: [
      '499064c6-8568-4ec2-8853-7142d9488ff9',
      '70ecd710-c091-448a-b837-9dec168176d1',
      '3e2c85ff-b014-4559-bc2d-2894664ee027',
      '0dbb3dc0-7a35-446c-966e-cf8dd8c22231',
    ],
  },
  {
    query: 'k-pop festival',
    relevant: ['c43a8fa8-a52d-4b24-bcab-d029dcb42cf6'],
  },
  {
    query: 'independent books literature fair',
    relevant: ['e372472e-4dea-4b99-99c0-30f6c1570ac3'],
  },
  {
    query: 'interactive murder mystery comedy',
    relevant: ['29b9cd6e-17ee-406d-a32e-9eb5be144a2d'],
  },
  {
    query: 'argentine rock tribute charly garcia',
    relevant: ['5c4bf123-e2a5-4243-ae98-f6b62516d99e', 'fd9c8616-788b-46d6-abad-c43af9e14299'],
  },
  {
    query: 'wine tasting afternoon drinks',
    relevant: [
      '463c30eb-3627-4f46-982a-da9c2296fb2e',
      '5076d830-344d-4ca9-a137-e864a53725ca',
      '4dd1ca75-bf4a-49cf-bf38-4c5936958d4f',
      '2322ae00-3811-4288-a890-ace309f445a2',
    ],
  },
  {
    query: 'spiritual wellness meditation movement',
    relevant: [
      '38ef587d-6cd6-4903-975f-3568d53610e7',
      '80e40fa7-86a4-435c-b958-0225ad514bec',
      'f460022b-b590-41e5-8ed2-a22b5472d67e',
      '92897937-7651-4451-8df8-f2991743fe31',
      '49b45d5c-ee35-4490-8a0b-fcb3c9ba54ed',
      '6103fe25-9948-4a40-98d1-b99870a47c34',
      'd3100db2-0ccc-4e2a-a815-92ebd70886bc',
    ],
  },
  {
    query: 'big live music concert in an arena',
    relevant: ['96a874e9-4a13-44c7-b555-57a48878f39e'],
  },
  {
    query: 'casual coffee meetup conversation',
    relevant: [
      '8c77545e-a0d5-4930-8eb4-a913ea97bc77',
      'c6cbafa2-f190-46ad-9c53-c860d56a6f22',
      '06dc5301-15ef-4727-8fbd-b071d1548d38',
    ],
  },
  {
    query: 'tech talks engineering networking',
    relevant: ['d86fffa5-fbae-440b-99eb-4f6086ccacda', 'c1e04ab3-522f-4575-9939-f2c9357dfa2a'],
  },
  {
    query: 'museum cultural art experience',
    relevant: [
      '29b9cd6e-17ee-406d-a32e-9eb5be144a2d',
      '72bacff2-802b-4e9c-85fe-e217a570bd94',
      '59091cc3-6ea4-4e86-ae96-b9885dab274d',
    ],
  },
  {
    query: 'creative writing group',
    relevant: ['f7132a32-c67a-45e1-aa9c-ce82d169b9e1'],
  },
  {
    query: 'relaxed board games afternoon',
    relevant: [
      'bf7f726e-a41c-4cbd-9cef-de34c42661b4',
      '78a53762-d3ac-42bd-85fb-28f38abb12d5',
      '21740c83-72bc-449d-8cda-4e8e2b636bd7',
      'ccec7b1e-d664-483e-8ada-f961ac6b6ef8',
      'cbc66003-cf8c-4b93-ba28-39692a5cea53',
    ],
  },
  {
    query: 'outdoor food festival',
    relevant: [
      'a5fa63f9-09fc-4b9b-8558-504e14a061b5',
      '7ea97ad4-9ede-48d4-8863-a2c6956f1978',
      '08784b70-d1cc-4356-9817-7960f6241769',
      '3bb5c70d-52f2-40ea-b1ca-d7a22fee41c5',
    ],
  },
]
