/**
 * BA Tourism Client-Side Scraper
 *
 * This scraper must run in a browser context because the BA Tourism website
 * loads event content dynamically via JavaScript.
 *
 * Use this with browser automation tools (like Puppeteer, Playwright, or Chrome MCP).
 */

import type { BATourismEvent, Coordinates, WeekContext } from './types'
import { parseWeekContext } from './date-parser'

/**
 * Extract coordinates from Google Maps URL
 */
function extractCoordinates(url: string | undefined): Coordinates | null {
  if (!url) return null

  const match = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (match) {
    return {
      lat: parseFloat(match[1]),
      lng: parseFloat(match[2]),
    }
  }

  return null
}

/**
 * Parse category and price from heading like "[  Evento   | - ]"
 */
function parseCategoryHeading(text: string): { category: string; isFree: boolean } {
  // Remove brackets and normalize whitespace
  const cleaned = text.replace(/\[/g, '').replace(/\]/g, '').trim()
  const parts = cleaned.split('|').map((p) => p.trim())

  const category = parts[0] || 'Evento'
  const priceIndicator = parts[1] || '-'
  const isFree = priceIndicator.toLowerCase() === 'gratis'

  return { category, isFree }
}

/**
 * Extract venue name and neighborhood from venue text
 */
function parseVenueText(text: string): { venueName: string; neighborhood: string } {
  const lastCommaIdx = text.lastIndexOf(',')

  if (lastCommaIdx > 0) {
    const neighborhood = text.slice(lastCommaIdx + 1).trim()
    const beforeNeighborhood = text.slice(0, lastCommaIdx).trim()

    const doubleSpaceIdx = beforeNeighborhood.indexOf('  ')
    if (doubleSpaceIdx > 0) {
      return {
        venueName: beforeNeighborhood.slice(0, doubleSpaceIdx).trim(),
        neighborhood,
      }
    }

    return {
      venueName: beforeNeighborhood,
      neighborhood,
    }
  }

  return {
    venueName: text.trim(),
    neighborhood: 'CABA',
  }
}

/**
 * Extract week context from page header (runs in browser)
 */
export function extractWeekContextFromDOM(): WeekContext {
  const paragraphs = document.querySelectorAll('.field-name-body p, article p')
  let headerText = ''

  for (const p of paragraphs) {
    const text = p.textContent?.trim() || ''
    if (text.toLowerCase().includes('desde el lunes') && text.toLowerCase().includes('al domingo')) {
      headerText = text
      break
    }
  }

  return parseWeekContext(headerText)
}

/**
 * Extract all events from the rendered DOM (runs in browser)
 *
 * This function must be executed in a browser context after the page
 * has fully loaded and JavaScript has rendered all event cards.
 */
export function extractEventsFromDOM(): BATourismEvent[] {
  const events: BATourismEvent[] = []
  const cards = document.querySelectorAll('.card-landing')

  const skipNames = [
    'para disfrutar',
    'visitas, paseos',
    'imperdibles',
    'turismo en barrios',
    'destacar en el listado',
  ]

  cards.forEach((card) => {
    // Get event name from h2
    const name = card.querySelector('h2')?.textContent?.trim() || ''
    if (!name) return

    // Skip non-event sections
    if (skipNames.some((skip) => name.toLowerCase().includes(skip))) {
      return
    }

    // Get category from .media-heading (h4)
    const categoryText = card.querySelector('.media-heading')?.textContent?.trim() || ''
    const { category, isFree } = parseCategoryHeading(categoryText)

    // Find ¿Cuándo? and ¿Dónde? sections
    let whenText = ''
    let dondeText = ''

    const paragraphs = card.querySelectorAll('p')
    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i].textContent?.trim() || ''
      if (text === '¿Cuándo?' && paragraphs[i + 1]) {
        whenText = paragraphs[i + 1].textContent?.trim() || ''
      }
      if (text === '¿Dónde?' && paragraphs[i + 1]) {
        dondeText = paragraphs[i + 1].textContent?.trim() || ''
      }
    }

    // Parse venue info
    const { venueName, neighborhood } = parseVenueText(dondeText)

    // Get Google Maps link
    const mapsLink = card.querySelector('a[href*="google.com/maps"]') as HTMLAnchorElement | null
    const address = mapsLink?.textContent?.trim() || null
    const mapsHref = mapsLink?.getAttribute('href') || ''
    const coordinates = extractCoordinates(mapsHref)

    // Get "Más información" link
    let moreInfoUrl = ''
    const links = card.querySelectorAll('a')
    for (const link of links) {
      if (link.textContent?.toLowerCase().includes('más información')) {
        moreInfoUrl = (link as HTMLAnchorElement).href || ''
        break
      }
    }

    // Get description
    let description = ''
    let foundDonde = false
    for (const p of paragraphs) {
      const text = p.textContent?.trim() || ''

      if (text === '¿Dónde?') {
        foundDonde = true
        continue
      }

      if (
        foundDonde &&
        text.length > 50 &&
        !text.toLowerCase().includes('más información') &&
        text !== dondeText &&
        !description
      ) {
        description = text
      }
    }

    // Only add if we have essential data
    if (name && whenText) {
      events.push({
        name,
        category,
        isFree,
        whenText,
        venueName: venueName || 'Ubicación no especificada',
        neighborhood: neighborhood || 'CABA',
        address,
        coordinates,
        description,
        moreInfoUrl,
      })
    }
  })

  return events
}

/**
 * Serializable extraction function that can be passed to browser.evaluate()
 *
 * Returns JavaScript code as a string that extracts all events when evaluated in browser.
 * The returned data is a plain object: { events: BATourismEvent[], weekContextText: string }
 */
export function getExtractEventsScript(): string {
  return `
    (function() {
      const events = [];
      const cards = document.querySelectorAll('.card-landing');

      const skipNames = [
        'para disfrutar',
        'visitas, paseos',
        'imperdibles',
        'turismo en barrios',
        'destacar en el listado',
      ];

      const parseCategoryHeading = (text) => {
        const cleaned = text.replace(/\\[/g, '').replace(/\\]/g, '').trim();
        const parts = cleaned.split('|').map(p => p.trim());
        return {
          category: parts[0] || 'Evento',
          isFree: (parts[1] || '-').toLowerCase() === 'gratis'
        };
      };

      const parseVenueText = (text) => {
        const lastCommaIdx = text.lastIndexOf(',');
        if (lastCommaIdx > 0) {
          const neighborhood = text.slice(lastCommaIdx + 1).trim();
          const beforeNeighborhood = text.slice(0, lastCommaIdx).trim();
          const doubleSpaceIdx = beforeNeighborhood.indexOf('  ');
          if (doubleSpaceIdx > 0) {
            return {
              venueName: beforeNeighborhood.slice(0, doubleSpaceIdx).trim(),
              neighborhood
            };
          }
          return { venueName: beforeNeighborhood, neighborhood };
        }
        return { venueName: text.trim(), neighborhood: 'CABA' };
      };

      const extractCoordinates = (url) => {
        if (!url) return null;
        const match = url.match(/[?&]q=(-?\\d+\\.?\\d*),(-?\\d+\\.?\\d*)/);
        if (match) {
          return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
        }
        return null;
      };

      cards.forEach(card => {
        const name = card.querySelector('h2')?.textContent?.trim() || '';
        if (!name) return;
        if (skipNames.some(skip => name.toLowerCase().includes(skip))) return;

        const categoryText = card.querySelector('.media-heading')?.textContent?.trim() || '';
        const { category, isFree } = parseCategoryHeading(categoryText);

        let whenText = '', dondeText = '';
        const paragraphs = card.querySelectorAll('p');
        for (let i = 0; i < paragraphs.length; i++) {
          const text = paragraphs[i].textContent?.trim() || '';
          if (text === '¿Cuándo?' && paragraphs[i + 1]) {
            whenText = paragraphs[i + 1].textContent?.trim() || '';
          }
          if (text === '¿Dónde?' && paragraphs[i + 1]) {
            dondeText = paragraphs[i + 1].textContent?.trim() || '';
          }
        }

        const { venueName, neighborhood } = parseVenueText(dondeText);

        const mapsLink = card.querySelector('a[href*="google.com/maps"]');
        const address = mapsLink?.textContent?.trim() || null;
        const mapsHref = mapsLink?.getAttribute('href') || '';
        const coordinates = extractCoordinates(mapsHref);

        let moreInfoUrl = '';
        const links = card.querySelectorAll('a');
        for (const link of links) {
          if (link.textContent?.toLowerCase().includes('más información')) {
            moreInfoUrl = link.href || '';
            break;
          }
        }

        let description = '', foundDonde = false;
        for (const p of paragraphs) {
          const text = p.textContent?.trim() || '';
          if (text === '¿Dónde?') { foundDonde = true; continue; }
          if (foundDonde && text.length > 50 && !text.toLowerCase().includes('más información') && text !== dondeText && !description) {
            description = text;
          }
        }

        if (name && whenText) {
          events.push({
            name, category, isFree, whenText,
            venueName: venueName || 'Ubicación no especificada',
            neighborhood: neighborhood || 'CABA',
            address, coordinates, description, moreInfoUrl
          });
        }
      });

      // Get week context
      let weekContextText = '';
      const allP = document.querySelectorAll('.field-name-body p, article p');
      for (const p of allP) {
        const text = p.textContent?.trim() || '';
        if (text.toLowerCase().includes('desde el lunes') && text.toLowerCase().includes('al domingo')) {
          weekContextText = text;
          break;
        }
      }

      return { events, weekContextText };
    })()
  `
}
