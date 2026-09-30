import { Notice, setIcon } from 'obsidian'
import type { IControl, Map, Marker } from 'maplibre-gl'
import { getDeviceLocation, type DeviceLocation } from '@/services/DeviceLocation'

type LocationMapLibrary = Pick<
  typeof import('maplibre-gl'),
  'Marker' | 'LngLat' | 'LngLatBounds' | 'MercatorCoordinate'
>

/**
 * A one-shot control in MapLibre's own control/marker style. Unlike its GeolocateControl,
 * this remains clickable when permission is denied or the API is missing, so the person
 * gets an actionable Notice. Acquisition shares the tool's wall-clock timeout and errors.
 */
export class MapLocationControl implements IControl {
  private map: Map | null = null
  private container: HTMLElement | null = null
  private button: HTMLButtonElement | null = null
  private request: AbortController | null = null
  private dot: Marker | null = null
  private circle: Marker | null = null
  private circleElement: HTMLElement | null = null
  private position: DeviceLocation | null = null

  constructor(
    private el: HTMLElement,
    private library: LocationMapLibrary
  ) {}

  onAdd(map: Map): HTMLElement {
    this.map = map
    const doc = this.el.ownerDocument
    const container = doc.win.createDiv()
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const button = doc.win.createEl('button')
    button.type = 'button'
    button.title = 'Show my location'
    button.setAttribute('aria-label', 'Show my location')
    setIcon(button, 'locate-fixed')
    button.addEventListener('click', this.locate)
    container.appendChild(button)
    this.container = container
    this.button = button
    map.on('zoom', this.resizeCircle)
    return container
  }

  onRemove(): void {
    this.request?.abort()
    this.request = null
    this.map?.off('zoom', this.resizeCircle)
    this.map = null
    this.dot?.remove()
    this.circle?.remove()
    this.dot = this.circle = null
    this.position = null
    this.circleElement = null
    this.button?.removeEventListener('click', this.locate)
    this.container?.remove()
    this.container = this.button = null
  }

  private resizeCircle = () => {
    if (!this.position || !this.map || !this.circleElement) return
    const { latitude, longitude, accuracy } = this.position
    const units = this.library.MercatorCoordinate.fromLngLat([
      longitude,
      latitude,
    ]).meterInMercatorCoordinateUnits()
    // MapLibre's Mercator world is 512 px at zoom 0; accuracy is a radius, not a diameter.
    const diameter = 2 * accuracy * units * 512 * 2 ** this.map.getZoom()
    this.circleElement.style.width = `${diameter}px`
    this.circleElement.style.height = `${diameter}px`
  }

  private locate = () => {
    if (this.request || !this.map || !this.button) return
    const request = new AbortController()
    this.request = request
    this.button.disabled = true
    this.button.setAttribute('aria-busy', 'true')
    void this.showPosition(request)
  }

  private async showPosition(request: AbortController): Promise<void> {
    try {
      const position = await getDeviceLocation(
        request.signal,
        this.el.ownerDocument.defaultView?.navigator
      )
      if (request.signal.aborted || !this.map) return
      this.dot?.remove()
      this.circle?.remove()
      this.position = position
      const { latitude, longitude, accuracy } = position
      const doc = this.el.ownerDocument
      this.circleElement = doc.win.createDiv()
      this.circleElement.className = 'maplibregl-user-location-accuracy-circle'
      this.circleElement.setAttribute('aria-hidden', 'true')
      // Like note pins, the local position overlays must not trigger the base map's
      // third-party reverse lookup when pressed.
      this.circleElement.addEventListener('click', (event) => event.stopPropagation())
      const dot = doc.win.createDiv()
      dot.className = 'maplibregl-user-location-dot'
      dot.title = `Current location (accuracy ${Math.round(accuracy)} m)`
      dot.addEventListener('click', (event) => event.stopPropagation())
      this.circle = new this.library.Marker({ element: this.circleElement, pitchAlignment: 'map' })
        .setLngLat([longitude, latitude])
        .addTo(this.map)
      this.dot = new this.library.Marker({ element: dot })
        .setLngLat([longitude, latitude])
        .addTo(this.map)
      this.resizeCircle()
      this.map.fitBounds(
        this.library.LngLatBounds.fromLngLat(
          new this.library.LngLat(longitude, latitude),
          Math.max(accuracy * 2, 40)
        ),
        // Bounds choose the zoom; the acquired position, not the bounds' approximate centre,
        // chooses the camera centre (especially important on a narrow map).
        { maxZoom: 15, center: [longitude, latitude] }
      )
    } catch (error) {
      if (!request.signal.aborted && this.map) {
        new Notice(
          error instanceof Error
            ? error.message
            : 'Location is unavailable on this device. Check Location Services and Obsidian permissions, then try again.'
        )
      }
    } finally {
      if (this.request === request) {
        this.request = null
        if (this.button) {
          this.button.disabled = false
          this.button.removeAttribute('aria-busy')
        }
      }
    }
  }
}
