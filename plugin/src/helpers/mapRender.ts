import 'maplibre-gl/dist/maplibre-gl.css'
import { AbeleConfig } from '@/services/AbeleConfig'
import { formatLatLon, reverseGeocode } from '@/services/GeoService'
import { mapBounds, type MapConfig, type MapPoint } from './mapConfig'

/**
 * The map itself: MapLibre, on tiles that cost the person nothing.
 *
 * OpenFreeMap serves the vector tiles with no key, no account and no stated limit, and asks
 * only for the attribution MapLibre draws by itself — which is why a map works on a fresh
 * install with nothing configured. A style URL in the settings replaces it for anyone who
 * would rather pay their own provider.
 *
 * Everything here loads on demand. MapLibre is the largest thing in the bundle by a distance,
 * and a vault with no maps in it should never pay for parsing it.
 */

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/bright'
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'

export interface MapHandle {
  destroy(): void
}

interface MapFeature {
  sourceLayer?: string
  properties?: Record<string, unknown> | null
}

export interface MapFeatureInfo {
  title: string
  details: string[]
}

const textProperty = (properties: Record<string, unknown>, ...names: string[]): string => {
  for (const name of names) {
    const value = properties[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

/** The useful part of an OpenMapTiles feature, without exposing its tile metadata to a person. */
export function mapFeatureInfo(feature: MapFeature): MapFeatureInfo | null {
  const properties = feature.properties || {}
  const name = textProperty(properties, 'name', 'name_en', 'name:latin', 'name:nonlatin')
  const street = textProperty(properties, 'addr:street', 'street')
  const number = textProperty(properties, 'addr:housenumber', 'housenumber', 'house_number')
  const address =
    textProperty(properties, 'address', 'addr:full') || [street, number].filter(Boolean).join(' ')
  const kind = textProperty(properties, 'subclass', 'class', 'type')
  const title = name || address
  if (!title) return null

  const details = [address && address !== title ? address : '', kind]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
  return { title, details }
}

function featurePriority(feature: MapFeature): number {
  return (
    {
      poi: 50,
      housenumber: 40,
      building: 30,
      place: 20,
      aerodrome_label: 20,
      transportation_name: 10,
    }[feature.sourceLayer || ''] || 0
  )
}

function popupContent(
  el: HTMLElement,
  title: string,
  details: string[],
  coordinates: string
): HTMLElement {
  const doc = el.ownerDocument || document
  const content = doc.win.createDiv({ cls: 'abele-map__place' })
  content.appendChild(doc.win.createEl('strong', { text: title }))
  for (const detail of details) {
    content.appendChild(doc.win.createDiv({ text: detail }))
  }
  content.appendChild(doc.win.createDiv({ cls: 'abele-map__coordinates', text: coordinates }))
  return content
}

function isDark(el: HTMLElement): boolean {
  const doc = el.ownerDocument || document
  return doc.body.classList.contains('theme-dark')
}

function styleFor(config: MapConfig, el: HTMLElement): string {
  if (config.style) return config.style

  const configured = AbeleConfig.getInstance().mapStyleUrl
  if (configured) return configured

  return isDark(el) ? DARK_STYLE : LIGHT_STYLE
}

function accent(el: HTMLElement): string {
  const doc = el.ownerDocument || document
  const colour = doc.defaultView
    ?.getComputedStyle(doc.body)
    .getPropertyValue('--color-accent')
    .trim()
  return colour || '#e5484d'
}

/** A pin, in the shape the rest of the plugin's UI would draw it. */
function markerElement(el: HTMLElement, colour: string): HTMLElement {
  const doc = el.ownerDocument || document
  const pin = doc.win.createDiv()
  pin.className = 'abele-map__pin'
  pin.style.backgroundColor = colour
  return pin
}

/**
 * Draws the map and hands back the way to take it down again.
 *
 * Asynchronous because of the dynamic imports; callers that are torn down before it resolves
 * get a handle that has already disposed of everything.
 */
export async function renderMap(el: HTMLElement, config: MapConfig): Promise<MapHandle> {
  const [maplibre, worker] = await Promise.all([
    import('maplibre-gl'),
    import('virtual:maplibre-worker'),
  ])

  // MapLibre fetches its worker as a file next to itself, which a plugin bundled into one
  // `main.js` does not have. The worker is bundled at build time and handed over as a blob
  // instead — without this the map comes up blank and the console says the worker URL is "".
  if (!maplibre.getWorkerUrl()) {
    const blob = new Blob([worker.default], { type: 'text/javascript' })
    maplibre.setWorkerUrl(URL.createObjectURL(blob))
  }

  let disposed = false
  const map = new maplibre.Map({
    container: el,
    style: styleFor(config, el),
    center: config.center ? [config.center.lon, config.center.lat] : [0, 0],
    zoom: config.zoom ?? 12,
    interactive: config.interactive,
    // A map inside a scrolling chat or note should not trap a one-finger phone gesture.
    cooperativeGestures: config.interactive,
    attributionControl: { compact: true },
  })

  const colour = accent(el)

  if (config.interactive) {
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibre.FullscreenControl({ container: el }), 'top-right')
    map.addControl(new maplibre.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  }

  for (const point of config.points) {
    const pin = markerElement(el, point.color || colour)
    // A pin has its own popup. Do not also treat the same press as a request for the base map.
    pin.addEventListener('click', (event) => event.stopPropagation())
    const marker = new maplibre.Marker({ element: pin })
      .setLngLat([point.lon, point.lat])
      .addTo(map)

    if (point.label) {
      marker.setPopup(new maplibre.Popup({ offset: 12 }).setText(point.label))
    }
  }

  let lookup = 0
  let placePopup: InstanceType<typeof maplibre.Popup> | null = null

  if (config.interactive) {
    map.on('click', (event) => {
      void (async () => {
        const mine = ++lookup
        const coordinates = formatLatLon(event.lngLat.lat, event.lngLat.lng)
        const features = map
          .queryRenderedFeatures(event.point)
          .filter((feature) => !String(feature.layer?.id || '').startsWith('abele-line-'))
          .sort((a, b) => featurePriority(b) - featurePriority(a))

        const first = features[0]
        const fromTile = features.map(mapFeatureInfo).find((info) => info !== null) ?? null
        // POIs carry their names in the vector tile. Bare building polygons generally do not;
        // reverse lookup turns the clicked shape into the house address a person expected.
        const needsLookup =
          !fromTile || ['building', 'housenumber'].includes(first?.sourceLayer || '')

        placePopup?.remove()
        placePopup = new maplibre.Popup({ closeButton: true, offset: 8 })
          .setLngLat(event.lngLat)
          .setDOMContent(
            popupContent(
              el,
              needsLookup ? 'Looking up this place…' : fromTile.title,
              needsLookup ? [] : fromTile.details,
              coordinates
            )
          )
          .addTo(map)

        if (!needsLookup) return

        try {
          const place = await reverseGeocode({ lat: event.lngLat.lat, lon: event.lngLat.lng })
          if (disposed || mine !== lookup || !placePopup) return
          const details = [place?.address || '', place?.kind || ''].filter(Boolean)
          placePopup.setDOMContent(
            popupContent(el, place?.name || 'Selected place', details, coordinates)
          )
        } catch {
          if (disposed || mine !== lookup || !placePopup) return
          placePopup.setDOMContent(popupContent(el, 'Place details unavailable', [], coordinates))
        }
      })()
    })

    map.on('mousemove', (event) => {
      const feature = map
        .queryRenderedFeatures(event.point)
        .find((candidate) => featurePriority(candidate) > 0)
      map.getCanvas().style.cursor = feature ? 'pointer' : ''
    })
  }

  map.on('load', () => {
    if (disposed) return

    config.lines.forEach((line, index) => {
      const id = `abele-line-${index}`
      map.addSource(id, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: line.points.map((p: MapPoint) => [p.lon, p.lat]),
          },
        },
      })
      map.addLayer({
        id,
        type: 'line',
        source: id,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': line.color || colour,
          'line-width': 4,
          'line-opacity': 0.85,
        },
      })
    })
  })

  // Fit to what there is, unless the block said where to look. A route drawn at the default
  // zoom would otherwise show a street in the middle of it and nothing else.
  const bounds = mapBounds(config)
  if (bounds && !config.center) {
    if (bounds.min.lat === bounds.max.lat && bounds.min.lon === bounds.max.lon) {
      map.setCenter([bounds.min.lon, bounds.min.lat])
      map.setZoom(config.zoom ?? 15)
    } else {
      map.fitBounds(
        [
          [bounds.min.lon, bounds.min.lat],
          [bounds.max.lon, bounds.max.lat],
        ],
        { padding: 40, animate: false, maxZoom: config.zoom ?? 16 }
      )
    }
  }

  return {
    destroy() {
      disposed = true
      lookup++
      placePopup?.remove()
      map.remove()
    },
  }
}
