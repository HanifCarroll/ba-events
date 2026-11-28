export type PageCopy = {
  title: string
  description: string
  heading: string
  updated: string
}

export type AgendaCopy = PageCopy & {
  intro: string
  empty?: string
  emptyLater?: string
  laterHeading?: string
  faq: { question: string; answer: string }[]
}

export type CopyValues = Record<string, string | undefined>

const placeholder = /\{\{([a-z_]+)\}\}/g

/** Missing optional text omits the sentence that needs it, not just the placeholder. */
export function fillCopy(template: string, values: CopyValues) {
  const text = template.replace(/\{\{(frase_gratis|n_gratis_hoy|frase_hoy|free_sentence|today_sentence)\}\} ?/g,
    (_, key: string) => values[key] ? `${values[key]} ` : '')
  return text.split(/(?<=[.!?]) (?=[A-ZÁÉÍÓÚ¿¡])/u)
    .filter(sentence => Array.from(sentence.matchAll(placeholder)).every(match => values[match[1]] !== undefined))
    .map(sentence => sentence.replace(placeholder, (_, key: string) => values[key] ?? ''))
    .join(' ').trim()
}

export function pageCopy(copy: PageCopy, values: CopyValues) {
  return {
    title: fillCopy(copy.title, values),
    description: fillCopy(copy.description, values),
    heading: fillCopy(copy.heading, values),
    updated: fillCopy(copy.updated, values),
  }
}
