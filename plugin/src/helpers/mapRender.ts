import 'maplibre-gl/dist/maplibre-gl.css'
import { AbeleConfig } from '@/services/AbeleConfig'
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
    attributionControl: { compact: true },
  })

  const colour = accent(el)

  for (const point of config.points) {
    const marker = new maplibre.Marker({ element: markerElement(el, point.color || colour) })
      .setLngLat([point.lon, point.lat])
      .addTo(map)

    if (point.label) {
      marker.setPopup(new maplibre.Popup({ offset: 12 }).setText(point.label))
    }
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
      map.remove()
    },
  }
}
