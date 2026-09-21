import type { AgentTool } from '../client'
import {
  categoryTag,
  findRoute,
  placesAround,
  formatLatLon,
  resolvePoint,
  reverseGeocode,
  searchPlaces,
  type GeoPlace,
  type GeoRoute,
  type TravelMode,
} from '@/services/GeoService'

/**
 * Addresses, places and routes for an agent.
 *
 * Every one of these runs on a keyless public service (`GeoService`), so they work the moment
 * the plugin is installed — no account, no key, no settings screen. Coordinates come back in
 * the `lat, lon` form a note stores them in, so an answer can be written straight into
 * frontmatter and land on a map afterwards.
 */

/** What "near here" means when nobody said. A walk, not a drive. */
const DEFAULT_RADIUS_KM = 2

/** And what it means where the first circle came back empty. */
const WIDER_RADIUS_KM = 15

const LOCATION_HINT =
  'Store a place in a note as `location: "56.9496, 24.1052"` — that is the form Obsidian map views read.'

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min`
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

function formatPlace(place: GeoPlace, index: number): string {
  const parts = [`${index}. **${place.name}**`]
  if (place.address) parts.push(` — ${place.address}`)

  const tail = [`\`${formatLatLon(place.lat, place.lon)}\``]
  if (place.kind) tail.push(place.kind)
  if (place.distanceKm !== undefined) tail.push(formatDistance(place.distanceKm))

  return `${parts.join('')}\n   ${tail.join(' · ')}`
}

function formatPlaces(places: GeoPlace[]): string {
  return places.map((place, i) => formatPlace(place, i + 1)).join('\n')
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] }
}

export function createGeocodeTool(): AgentTool {
  return {
    name: 'geocode',
    label: 'Geocode',
    description:
      'Find the coordinates of an address or place name, or the address of a pair of coordinates. ' +
      'Free, no API key, OpenStreetMap data. Pass `query` to search, or `lat` and `lon` to go the ' +
      'other way. Coordinates come back as "lat, lon", ready to store in a note property.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Address or place name to look up' },
        lat: { type: 'number', description: 'Latitude, for a reverse lookup' },
        lon: { type: 'number', description: 'Longitude, for a reverse lookup' },
        near: {
          type: 'string',
          description:
            'Bias the search towards this place — an address, a city, or "lat, lon". Use it when the name is ambiguous.',
        },
        limit: { type: 'number', description: 'How many results (default 5, max 25)' },
        lang: { type: 'string', description: 'Language of the answer, e.g. en, de, fr' },
      },
    },
    execute: async (_id, params) => {
      const query = (params.query as string)?.trim()
      const lat = params.lat as number | undefined
      const lon = params.lon as number | undefined
      const lang = params.lang as string | undefined

      if (!query) {
        if (lat === undefined || lon === undefined) {
          throw new Error('Give either `query`, or `lat` and `lon` for a reverse lookup')
        }

        const place = await reverseGeocode({ lat, lon }, lang)
        if (!place) return text(`Nothing found at ${formatLatLon(lat, lon)}.`)
        return text(`${formatPlace(place, 1)}\n\n${LOCATION_HINT}`)
      }

      const near = params.near ? await resolvePoint(params.near as string, lang) : undefined
      const places = await searchPlaces({
        query,
        near: near ? { lat: near.lat, lon: near.lon } : undefined,
        limit: (params.limit as number) ?? 5,
        lang,
      })

      if (!places.length) return text(`Nothing found for "${query}".`)
      return text(`${formatPlaces(places)}\n\n${LOCATION_HINT}`)
    },
  }
}

export function createPlacesTool(): AgentTool {
  return {
    name: 'places',
    label: 'Find places',
    description:
      'Find places around a point: cafés, pharmacies, museums, shops, stations. Free, no API key, ' +
      'OpenStreetMap data. `near` takes an address, a place name or "lat, lon"; `query` takes a ' +
      'category ("cafe", "pharmacy", "museum") or free text ("Italian restaurant"). Results are ' +
      'sorted by distance from `near`.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look for — a category like "cafe", or free text',
        },
        near: {
          type: 'string',
          description: 'Where to look — an address, a place name, or "lat, lon"',
        },
        radius_km: {
          type: 'number',
          description: 'How far around `near` to look, in kilometres (default 2)',
        },
        limit: { type: 'number', description: 'How many results (default 8, max 25)' },
        lang: { type: 'string', description: 'Language of the answer, e.g. en, de, fr' },
      },
      required: ['query', 'near'],
    },
    execute: async (_id, params) => {
      const query = (params.query as string)?.trim()
      const near = (params.near as string)?.trim()
      if (!query) throw new Error('Missing required parameter: query')
      if (!near) throw new Error('Missing required parameter: near')

      const lang = params.lang as string | undefined
      const limit = Math.min(Math.max((params.limit as number) ?? 8, 1), 25)
      const centre = await resolvePoint(near, lang)
      const category = categoryTag(query)
      const asked = params.radius_km as number | undefined

      let found: GeoPlace[] = []
      if (category) {
        // A category is a question about the map, not about names, so it goes to Overpass —
        // and when Overpass is having one of its afternoons, the name search below is still
        // an answer, which beats handing the person an error.
        try {
          found = await placesAround(
            centre,
            category.tag,
            asked ?? DEFAULT_RADIUS_KM,
            limit,
            category.rest
          )
          // Out of town a 2 km circle is empty and the person meant "the nearest one", so
          // widen once — but never past a radius they asked for themselves.
          if (!found.length && asked === undefined) {
            found = await placesAround(centre, category.tag, WIDER_RADIUS_KM, limit, category.rest)
          }
        } catch (error) {
          console.debug('[Abele] places: the map query failed, searching names instead', error)
        }
      }

      if (!found.length) {
        // Free text, or a category the map had nothing for: fall back to searching names.
        const byName = await searchPlaces({
          query,
          near: { lat: centre.lat, lon: centre.lon },
          limit: Math.min(limit * 3, 25),
          lang,
        })
        // A name search is global, and a restaurant in Tehran is not an answer to what is
        // near a square in Riga. Anything outside the circle asked about is dropped.
        const reach = asked ?? WIDER_RADIUS_KM
        found = byName.filter((place) => (place.distanceKm ?? 0) <= reach)
      }

      const places = found.slice(0, limit)
      if (!places.length) {
        const where = centre.name || formatLatLon(centre.lat, centre.lon)
        return text(`Nothing found for "${query}" near ${where}.`)
      }

      const where = centre.address || centre.name
      return text(
        `Near ${where} (${formatLatLon(centre.lat, centre.lon)}):\n\n${formatPlaces(places)}`
      )
    },
  }
}

function formatRoute(route: GeoRoute, withSteps: boolean): string {
  const label = { car: 'Drive', bike: 'Cycle', walk: 'Walk' }[route.mode]
  const head = `**${label}** — ${route.distanceKm.toFixed(1)} km, ${formatDuration(route.durationMin)}`

  const endpoint = (place: GeoPlace) => {
    const coords = formatLatLon(place.lat, place.lon)
    // A point given as coordinates has the coordinates for a name, and printing them twice
    // reads like two different places.
    if (place.name === coords && !place.address) return coords

    const label =
      place.address && !place.address.startsWith(place.name)
        ? `${place.name}, ${place.address}`
        : place.address || place.name
    return `${label} (${coords})`
  }

  const lines = [head, '', `From: ${endpoint(route.from)}`, `To: ${endpoint(route.to)}`]

  if (withSteps && route.steps.length) {
    // A long route can run to a hundred maneuvers, and a hundred maneuvers is a page of
    // context spent on the middle of a motorway.
    const shown = route.steps.slice(0, 30)
    lines.push('')
    lines.push(
      ...shown.map((step, i) => `${i + 1}. ${step.text} (${formatDistance(step.distanceKm)})`)
    )
    if (route.steps.length > shown.length) {
      lines.push(`… and ${route.steps.length - shown.length} more steps`)
    }
  }

  return lines.join('\n')
}

export function createRouteTool(): AgentTool {
  return {
    name: 'route',
    label: 'Build route',
    description:
      'Build a route between two places and report the distance, the travel time and the ' +
      'turn-by-turn directions. Free, no API key, OpenStreetMap data. `from`, `to` and every ' +
      '`via` point take an address, a place name or "lat, lon".',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start — address, place name or "lat, lon"' },
        to: { type: 'string', description: 'Destination — address, place name or "lat, lon"' },
        via: {
          type: 'array',
          items: { type: 'string' },
          description: 'Points to pass through, in order',
        },
        mode: {
          type: 'string',
          enum: ['car', 'bike', 'walk'],
          description: 'How the journey is made (default car)',
        },
        steps: {
          type: 'boolean',
          description: 'Include turn-by-turn directions (default true)',
        },
        lang: { type: 'string', description: 'Language for geocoding the endpoints' },
      },
      required: ['from', 'to'],
    },
    execute: async (_id, params) => {
      const from = (params.from as string)?.trim()
      const to = (params.to as string)?.trim()
      if (!from || !to) throw new Error('Both `from` and `to` are required')

      const lang = params.lang as string | undefined
      const mode = ((params.mode as string) || 'car') as TravelMode
      if (!['car', 'bike', 'walk'].includes(mode)) {
        throw new Error(`Unknown mode "${mode}": use car, bike or walk`)
      }

      const via = Array.isArray(params.via) ? (params.via as string[]) : []
      const points: GeoPlace[] = []
      for (const input of [from, ...via, to]) {
        points.push(await resolvePoint(input, lang))
      }

      const route = await findRoute(points, mode)
      return text(formatRoute(route, params.steps !== false))
    },
  }
}
