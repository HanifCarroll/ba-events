import { describe, expect, it } from 'vitest'
import {
  getExternalActionKind,
  getExternalEventUrl,
  getExternalLinkType,
  getSourceLabel,
} from './source-presentation.ts'

describe('getExternalActionKind', () => {
  it('classifies ticketed sources as tickets', () => {
    expect(getExternalActionKind('passline')).toBe('tickets')
    expect(getExternalActionKind('eventbrite')).toBe('tickets')
    expect(getExternalActionKind('venti')).toBe('tickets')
  })

  it('classifies meetup as rsvp', () => {
    expect(getExternalActionKind('meetup')).toBe('rsvp')
  })

  it('classifies luma as register', () => {
    expect(getExternalActionKind('luma')).toBe('register')
  })

  it('classifies ba-tourism as a plain source view', () => {
    expect(getExternalActionKind('ba-tourism')).toBe('source')
  })

  it('falls back to a plain source view for unknown or missing sources', () => {
    expect(getExternalActionKind('some-future-source')).toBe('source')
    expect(getExternalActionKind(null)).toBe('source')
    expect(getExternalActionKind(undefined)).toBe('source')
  })
})

describe('getExternalLinkType', () => {
  it('keeps the legacy singular ticket value', () => {
    expect(getExternalLinkType('tickets')).toBe('ticket')
  })

  it('uses the action kind name for other kinds', () => {
    expect(getExternalLinkType('rsvp')).toBe('rsvp')
    expect(getExternalLinkType('register')).toBe('register')
    expect(getExternalLinkType('source')).toBe('source')
  })
})

describe('getExternalEventUrl', () => {
  it('prefers ticket_url over link', () => {
    expect(
      getExternalEventUrl({ ticket_url: 'https://example.com/tickets', link: 'https://example.com' })
    ).toBe('https://example.com/tickets')
  })

  it('falls back to link when ticket_url is missing', () => {
    expect(getExternalEventUrl({ ticket_url: null, link: 'https://example.com' })).toBe(
      'https://example.com'
    )
  })

  it('returns null when neither URL exists', () => {
    expect(getExternalEventUrl({ ticket_url: null, link: null })).toBeNull()
  })
})

describe('getSourceLabel', () => {
  it('maps known sources to display names', () => {
    expect(getSourceLabel('passline')).toBe('Passline')
    expect(getSourceLabel('ba-tourism')).toBe('BA Tourism')
    expect(getSourceLabel('meetup')).toBe('Meetup')
  })

  it('returns null for unknown or missing sources', () => {
    expect(getSourceLabel('unknown-source')).toBeNull()
    expect(getSourceLabel(null)).toBeNull()
  })
})
