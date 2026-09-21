import { requestUrl } from 'obsidian'

/**
 * Maps, addresses and routes, from services that cost nothing and ask for nothing.
 *
 * The choice of hosts is the feature. Photon (komoot) and the FOSSGIS routing servers need no
 * account and no API key, so the map tools work for a person who installed the plugin and did
 * nothing else — which is why they can be on by default. The public Nominatim and the OSM tile
 * servers are deliberately not here: their policy counts traffic per application summed over
 * all its users, and a plugin installed everywhere is exactly what they ask not to point at
 * them.
 *
 * What the free hosts do ask for is restraint, so every call goes through one queue that holds
 * them roughly a second apart, and answers are cached for the session. Both are the difference
 * between a good guest and an IP that stops being served.
 */

const PHOTON = 'https://photon.komoot.io'
const VALHALLA = 'https://valhalla1.openstreetmap.de'
const OVERPASS = 'https://overpass-api.de/api/interpreter'

/**
 * Who is calling. Not a courtesy: Overpass answers `406 Not Acceptable` to a request whose
 * user agent it does not like, which is what a plugin's default looks like.
 */
const USER_AGENT = 'Abele-Obsidian-Plugin (+https://github.com/dudaanton/abele-obsidian-plugin)'
const OSRM = 'https://routing.openstreetmap.de'

export interface GeoPoint {
  lat: number
  lon: number
}

export interface GeoPlace extends GeoPoint {
  name: string
  address: string
  /** `amenity:cafe`, `tourism:museum` — what OSM calls it. */
  kind: string
  /** Distance from the point a search was centred on, when there was one. */
  distanceKm?: number
}

export interface RouteStep {
  text: string
  distanceKm: number
}

/** One stretch between two of the points asked for — the whole route when there are only two. */
export interface RouteLeg {
  steps: RouteStep[]
  distanceKm: number
  durationMin: number
  /** Where this stretch ends. */
  to: GeoPlace
}

export interface GeoRoute {
  mode: TravelMode
  provider: 'Valhalla' | 'OSRM'
  distanceKm: number
  durationMin: number
  from: GeoPlace
  to: GeoPlace
  /** Kept apart rather than run together, so a point passed through is not read as arrival. */
  legs: RouteLeg[]
  /** The line itself, encoded, for whatever draws it. */
  shape?: string
  /** Precision of `shape`: Valhalla encodes at 6 decimals, OSRM at 5. */
  shapePrecision?: number
}

export type TravelMode = 'car' | 'bike' | 'walk'

/**
 * The languages Photon answers in. Anything else is a `400`, so an unsupported one is dropped
 * rather than passed on: with no language it answers in the local one, which for «где это»
 * about a street in Riga is the more useful answer anyway.
 */
const PHOTON_LANGUAGES = new Set(['de', 'en', 'fr', 'it'])

export function photonLanguage(lang?: string): string | undefined {
  const code = (lang || '').trim().toLowerCase().slice(0, 2)
  return PHOTON_LANGUAGES.has(code) ? code : undefined
}

// ── Politeness ───────────────────────────────────────────────

let pacingMs = 1000
let lastCallAt = 0
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, unknown>()
const CACHE_LIMIT = 200

/** Tests drive the pacing to zero; nothing else should touch it. */
export function setGeoPacing(ms: number): void {
  pacingMs = ms
}

export function resetGeoCache(): void {
  cache.clear()
  lastCallAt = 0
  queue = Promise.resolve()
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

/**
 * One request at a time, a pace apart, each answer remembered.
 *
 * The queue is shared across the three services rather than kept per host: an agent asking
 * "café near the museum, and how do I walk there" fires all of them within a second, and the
 * hosts are run by the same handful of volunteers either way.
 */
async function ask<T>(url: string, label: string): Promise<T> {
  const cached = cache.get(url)
  if (cached !== undefined) return cached as T

  const task: Promise<T> = queue.then(async (): Promise<T> => {
    let last = ''

    // Twice, because these hosts are busy rather than broken: Overpass hands out a 504 under
    // load and answers the same query a moment later.
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = pacingMs - (Date.now() - lastCallAt)
      if (wait > 0) await sleep(wait)

      try {
        // No `Accept-Encoding` of our own — see WebSearchTool: a header set by hand left
        // Android handing the body over still gzipped.
        const response = await requestUrl({
          url,
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
          throw: false,
        })
        if (response.status < 400) return response.json as T

        last = `${label} answered ${response.status}`
        if (response.status < 500) break
      } catch (error) {
        last = `${label} did not answer: ${(error as Error).message}`
      } finally {
        lastCallAt = Date.now()
      }
    }

    throw new Error(last)
  })

  queue = task.catch((): undefined => undefined)
  const value = await task

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(url, value)
  return value
}

// ── Coordinates ──────────────────────────────────────────────

/** `56.9496, 24.1052` and the other separators a person types, or nothing if it is a name. */
export function parseLatLon(input: string): GeoPoint | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input || '')
  if (!match) return null

  const lat = Number(match[1])
  const lon = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null

  return { lat, lon }
}

/**
 * The form a note stores a position in — the same `lat, lon` string Obsidian's own map layout
 * and Map View read, so a note the agent fills in shows up on a map without being touched again.
 */
export function formatLatLon(lat: number, lon: number): string {
  const round = (n: number) => Number(n.toFixed(5))
  return `${round(lat)}, ${round(lon)}`
}

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ── Categories ───────────────────────────────────────────────

/**
 * The words people ask in, mapped to the OSM tag that actually selects them.
 *
 * Photon matches names, so a free-text "pharmacy" finds places called Pharmacy and misses the
 * one called Apotheke. The tag is what makes "what is near me" work in a country whose
 * language the person does not speak.
 */
const CATEGORIES: Record<string, string> = {
  cafe: 'amenity:cafe',
  coffee: 'amenity:cafe',
  restaurant: 'amenity:restaurant',
  bar: 'amenity:bar',
  pub: 'amenity:pub',
  'fast food': 'amenity:fast_food',
  bakery: 'shop:bakery',
  supermarket: 'shop:supermarket',
  grocery: 'shop:supermarket',
  pharmacy: 'amenity:pharmacy',
  hospital: 'amenity:hospital',
  doctor: 'amenity:doctors',
  dentist: 'amenity:dentist',
  veterinary: 'amenity:veterinary',
  atm: 'amenity:atm',
  bank: 'amenity:bank',
  fuel: 'amenity:fuel',
  'gas station': 'amenity:fuel',
  'petrol station': 'amenity:fuel',
  'charging station': 'amenity:charging_station',
  parking: 'amenity:parking',
  hotel: 'tourism:hotel',
  hostel: 'tourism:hostel',
  museum: 'tourism:museum',
  gallery: 'tourism:gallery',
  attraction: 'tourism:attraction',
  viewpoint: 'tourism:viewpoint',
  park: 'leisure:park',
  playground: 'leisure:playground',
  beach: 'natural:beach',
  gym: 'leisure:fitness_centre',
  fitness: 'leisure:fitness_centre',
  swimming: 'leisure:swimming_pool',
  cinema: 'amenity:cinema',
  theatre: 'amenity:theatre',
  library: 'amenity:library',
  school: 'amenity:school',
  kindergarten: 'amenity:kindergarten',
  university: 'amenity:university',
  'post office': 'amenity:post_office',
  police: 'amenity:police',
  toilets: 'amenity:toilets',
  'bus stop': 'highway:bus_stop',
  'train station': 'railway:station',
  airport: 'aeroway:aerodrome',
  church: 'amenity:place_of_worship',
  hairdresser: 'shop:hairdresser',
  laundry: 'shop:laundry',
  bicycle: 'shop:bicycle',
  'car rental': 'amenity:car_rental',
}

export interface CategoryMatch {
  /** The OSM tag to ask the map for. */
  tag: string
  /** What was left of the query — «Italian» out of «Italian restaurant». */
  rest: string
}

/**
 * The category hiding in what was asked, and the words left over.
 *
 * «Italian restaurant» is a restaurant question, not a name question: searching names for it
 * finds the places actually called Italian Restaurant, three countries away. So the category
 * word is pulled out and the rest is kept to rank what comes back.
 */
export function categoryTag(query: string): CategoryMatch | null {
  const needle = (query || '').trim().toLowerCase()
  if (!needle) return null
  if (/^[a-z_]+:[a-z_]+$/.test(needle)) return { tag: needle, rest: '' }

  const whole = CATEGORIES[needle] ?? CATEGORIES[needle.replace(/s$/, '')]
  if (whole) return { tag: whole, rest: '' }

  // Longest phrase first, so «gas station» is not read as «station».
  const words = needle.split(/\s+/)
  for (let size = Math.min(2, words.length); size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const phrase = words.slice(start, start + size).join(' ')
      const tag = CATEGORIES[phrase] ?? CATEGORIES[phrase.replace(/s$/, '')]
      if (!tag) continue

      const rest = [...words.slice(0, start), ...words.slice(start + size)].join(' ')
      return { tag, rest }
    }
  }

  return null
}

// ── Photon ───────────────────────────────────────────────────

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: Record<string, string>
}

function toPlace(feature: PhotonFeature): GeoPlace | null {
  const coords = feature.geometry?.coordinates
  if (!coords || coords.length < 2) return null

  const p = feature.properties || {}
  const street = [p.street, p.housenumber].filter(Boolean).join(' ')
  const address = [street, p.district, p.city || p.county, p.postcode, p.country]
    .filter(Boolean)
    .join(', ')

  return {
    lat: coords[1],
    lon: coords[0],
    name: p.name || street || p.city || p.country || 'Unnamed place',
    address,
    kind: [p.osm_key, p.osm_value].filter(Boolean).join(':'),
  }
}

interface OverpassElement {
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function toOverpassPlace(element: OverpassElement, tag: string): GeoPlace | null {
  const lat = element.lat ?? element.center?.lat
  const lon = element.lon ?? element.center?.lon
  if (lat === undefined || lon === undefined) return null

  const tags = element.tags || {}
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ')
  const address = [street, tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ')

  return {
    lat,
    lon,
    // An unnamed place is still an answer — a pharmacy nobody named is a pharmacy — so it is
    // labelled by what it is rather than dropped.
    name: tags.name || tags['name:en'] || tag.split(':')[1].replace(/_/g, ' '),
    address,
    kind: tag,
  }
}

export interface SearchOptions {
  query: string
  /** Bias results towards here, and measure the distance from it. */
  near?: GeoPoint
  /** Ask Photon for the OSM tag rather than hoping the name matches. */
  tag?: string | null
  limit?: number
  lang?: string
}

export async function searchPlaces(options: SearchOptions): Promise<GeoPlace[]> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 25)
  const params = new URLSearchParams({ q: options.query, limit: String(limit) })

  if (options.near) {
    params.set('lat', String(options.near.lat))
    params.set('lon', String(options.near.lon))
  }
  if (options.tag) params.set('osm_tag', options.tag)
  const lang = photonLanguage(options.lang)
  if (lang) params.set('lang', lang)

  const answer = await ask<{ features?: PhotonFeature[] }>(
    `${PHOTON}/api?${params.toString()}`,
    'Photon'
  )

  const places = (answer.features || []).map(toPlace).filter((p): p is GeoPlace => p !== null)
  if (!options.near) return places

  const near = options.near
  return places
    .map((place) => ({ ...place, distanceKm: distanceKm(near, place) }))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
}

/**
 * What is actually standing around a point, from Overpass.
 *
 * Photon is a geocoder: it matches names, so "cafe" finds the places called Cafe Something and
 * misses the one called Kuza. Overpass queries the map itself, which is the only way "what is
 * near me" answers with what is near you.
 *
 * Kept deliberately small — one bounded radius, a capped result count, cached and paced — since
 * the public instance asks applications not to treat it as a backend.
 */
export async function placesAround(
  near: GeoPoint,
  tag: string,
  radiusKm: number,
  limit: number,
  /** Words to rank by, when the question had more in it than the category. */
  match = ''
): Promise<GeoPlace[]> {
  const [key, value] = tag.split(':')
  const radius = Math.round(Math.min(Math.max(radiusKm, 0.1), 50) * 1000)
  const query =
    `[out:json][timeout:25];nwr(around:${radius},${near.lat},${near.lon})["${key}"="${value}"];` +
    `out center ${Math.min(limit * 5, 100)};`

  const answer = await ask<{ elements?: OverpassElement[] }>(
    `${OVERPASS}?data=${encodeURIComponent(query)}`,
    'Overpass'
  )

  const words = match
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2)

  const found = (answer.elements || [])
    .map((element) => ({ element, place: toOverpassPlace(element, tag) }))
    .filter((row): row is { element: OverpassElement; place: GeoPlace } => row.place !== null)
    .map((row) => {
      const tags = row.element.tags || {}
      const haystack = `${row.place.name} ${tags.cuisine || ''} ${tags.brand || ''}`.toLowerCase()
      return {
        place: { ...row.place, distanceKm: distanceKm(near, row.place) },
        // Ranked, not filtered: «Italian» matching nothing nearby should still answer with
        // the restaurants rather than with silence.
        matched: words.length > 0 && words.some((word) => haystack.includes(word)),
      }
    })
    .sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1
      return (a.place.distanceKm ?? 0) - (b.place.distanceKm ?? 0)
    })

  return found.map((row) => row.place)
}

export async function reverseGeocode(point: GeoPoint, lang?: string): Promise<GeoPlace | null> {
  const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lon) })
  const code = photonLanguage(lang)
  if (code) params.set('lang', code)

  const answer = await ask<{ features?: PhotonFeature[] }>(
    `${PHOTON}/reverse?${params.toString()}`,
    'Photon'
  )

  const first = (answer.features || [])[0]
  return first ? toPlace(first) : null
}

/**
 * What the person wrote, turned into a point on the map.
 *
 * Coordinates are taken as they are — no request, no rate limit, and no chance of a search
 * moving a position the person already knew.
 */
export async function resolvePoint(input: string, lang?: string): Promise<GeoPlace> {
  const text = (input || '').trim()
  if (!text) throw new Error('Missing a place: give an address, a place name or "lat, lon"')

  const point = parseLatLon(text)
  if (point) {
    return { ...point, name: formatLatLon(point.lat, point.lon), address: '', kind: '' }
  }

  const found = await searchPlaces({ query: text, limit: 1, lang })
  if (!found.length) throw new Error(`Nothing found for "${text}"`)
  return found[0]
}

// ── Routing ──────────────────────────────────────────────────

const VALHALLA_COSTING: Record<TravelMode, string> = {
  car: 'auto',
  bike: 'bicycle',
  walk: 'pedestrian',
}

const OSRM_PROFILE: Record<TravelMode, string> = {
  car: 'routed-car',
  bike: 'routed-bike',
  walk: 'routed-foot',
}

interface ValhallaAnswer {
  trip?: {
    summary?: { length?: number; time?: number }
    legs?: Array<{
      shape?: string
      summary?: { length?: number; time?: number }
      maneuvers?: Array<{ instruction?: string; length?: number; time?: number }>
    }>
  }
}

interface OsrmAnswer {
  code?: string
  routes?: Array<{
    distance?: number
    duration?: number
    geometry?: string
    legs?: Array<{
      distance?: number
      duration?: number
      steps?: Array<{
        name?: string
        distance?: number
        maneuver?: { type?: string; modifier?: string }
      }>
    }>
  }>
}

async function valhallaRoute(points: GeoPlace[], mode: TravelMode): Promise<GeoRoute> {
  const body = {
    locations: points.map((p) => ({ lat: p.lat, lon: p.lon })),
    costing: VALHALLA_COSTING[mode],
    directions_options: { units: 'kilometers' },
  }
  const answer = await ask<ValhallaAnswer>(
    `${VALHALLA}/route?json=${encodeURIComponent(JSON.stringify(body))}`,
    'Valhalla'
  )

  const trip = answer.trip
  if (!trip?.legs?.length) throw new Error('Valhalla returned no route')

  const legs: RouteLeg[] = trip.legs.map((leg, index) => ({
    steps: (leg.maneuvers || [])
      .filter((maneuver) => maneuver.instruction)
      .map((maneuver) => ({
        text: maneuver.instruction,
        distanceKm: maneuver.length || 0,
      })),
    distanceKm: leg.summary?.length || 0,
    durationMin: Math.round((leg.summary?.time || 0) / 60),
    to: points[index + 1] ?? points[points.length - 1],
  }))

  return {
    mode,
    provider: 'Valhalla',
    distanceKm: trip.summary?.length || 0,
    durationMin: Math.round((trip.summary?.time || 0) / 60),
    from: points[0],
    to: points[points.length - 1],
    legs,
    // Every leg's shape, one string. `;` is below the range polyline encoding uses, so it
    // cannot appear inside a leg — and unlike a NUL it survives being written into YAML.
    shape: trip.legs.map((leg) => leg.shape || '').join(';'),
    shapePrecision: 6,
  }
}

/** OSRM has no sentences, only the pieces of one, so the instruction is assembled here. */
function osrmInstruction(step: {
  name?: string
  maneuver?: { type?: string; modifier?: string }
}): string {
  const type = step.maneuver?.type || 'continue'
  const modifier = step.maneuver?.modifier
  const road = step.name ? ` onto ${step.name}` : ''

  if (type === 'depart') return `Start${step.name ? ` on ${step.name}` : ''}`
  if (type === 'arrive') return 'Arrive at the destination'
  if (type === 'roundabout' || type === 'rotary') return `Take the roundabout${road}`
  if (modifier && modifier !== 'straight') return `Turn ${modifier}${road}`
  return `Continue${road}`
}

async function osrmRoute(points: GeoPlace[], mode: TravelMode): Promise<GeoRoute> {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';')
  const answer = await ask<OsrmAnswer>(
    `${OSRM}/${OSRM_PROFILE[mode]}/route/v1/driving/${coords}?overview=full&steps=true`,
    'OSRM'
  )

  const route = answer.routes?.[0]
  if (!route) throw new Error('OSRM returned no route')

  const legs: RouteLeg[] = (route.legs || []).map((leg, index) => ({
    steps: (leg.steps || []).map((step) => ({
      text: osrmInstruction(step),
      distanceKm: (step.distance || 0) / 1000,
    })),
    distanceKm: (leg.distance || 0) / 1000,
    durationMin: Math.round((leg.duration || 0) / 60),
    to: points[index + 1] ?? points[points.length - 1],
  }))

  return {
    mode,
    provider: 'OSRM',
    distanceKm: (route.distance || 0) / 1000,
    durationMin: Math.round((route.duration || 0) / 60),
    from: points[0],
    to: points[points.length - 1],
    legs,
    shape: route.geometry,
    shapePrecision: 5,
  }
}

/**
 * Valhalla first, OSRM behind it.
 *
 * Both are volunteer-run and both go down; between them a route comes back on almost any day,
 * and neither costs the person anything. Valhalla leads because it writes instructions in
 * sentences and knows all three ways of travelling.
 */
export async function findRoute(points: GeoPlace[], mode: TravelMode): Promise<GeoRoute> {
  if (points.length < 2) throw new Error('A route needs a start and a destination')

  try {
    return await valhallaRoute(points, mode)
  } catch (valhallaError) {
    try {
      return await osrmRoute(points, mode)
    } catch (osrmError) {
      throw new Error(
        `Could not build a route. Valhalla: ${(valhallaError as Error).message}. ` +
          `OSRM: ${(osrmError as Error).message}`
      )
    }
  }
}
