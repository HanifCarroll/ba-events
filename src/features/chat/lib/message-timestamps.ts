interface TimestampedMessage {
  id: string
  metadata?: {
    createdAt?: string
  }
}

export function resolveMessageTimestamp(
  message: TimestampedMessage,
  timestampsById: Map<string, Date>,
  now: () => Date = () => new Date()
): Date {
  const persistedTimestamp = message.metadata?.createdAt

  if (persistedTimestamp) {
    const parsedTimestamp = new Date(persistedTimestamp)
    if (!Number.isNaN(parsedTimestamp.getTime())) {
      timestampsById.set(message.id, parsedTimestamp)
      return parsedTimestamp
    }
  }

  const existingTimestamp = timestampsById.get(message.id)
  if (existingTimestamp) return existingTimestamp

  const createdTimestamp = now()
  timestampsById.set(message.id, createdTimestamp)
  return createdTimestamp
}
