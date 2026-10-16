import { reactive } from 'vue'
import type { IControl, Map } from 'maplibre-gl'
import MapControls from '@/components/map/MapControls.vue'
import type { MapControlsState } from '@/components/map/mapControlsState'
import { renderKit, unrenderKit } from '@/components/obsidian/mount'
import type { MapLocationControl } from './mapLocationControl'

/**
 * The map's column of glyphs as a MapLibre control: zoom, north once turned, the device's place
 * and the whole screen, drawn by the plugin instead of MapLibre's own buttons. Where the system
 * has no full screen for an element (a phone's browser engine), the map fills the window instead.
 */
export class AbeleMapControls implements IControl {
  private host: HTMLElement | null = null
  private map: Map | null = null
  private state = reactive<MapControlsState>({
    turned: false,
    bearing: 0,
    locating: false,
    full: false,
  })

  constructor(
    private el: HTMLElement,
    private location: MapLocationControl
  ) {}

  onAdd(map: Map): HTMLElement {
    this.map = map
    const doc = this.el.ownerDocument
    const host = doc.win.createDiv({ cls: 'maplibregl-ctrl abele-map-controls-host' })
    this.host = host
    map.on('rotate', this.turn)
    map.on('pitch', this.turn)
    doc.addEventListener('fullscreenchange', this.fullChanged)
    this.location.onBusy = (busy) => (this.state.locating = busy)
    renderKit(host, MapControls, {
      state: this.state,
      onZoom: (step: 1 | -1) => (step > 0 ? map.zoomIn() : map.zoomOut()),
      onNorth: () => map.resetNorthPitch(),
      onLocate: () => this.location.locate(),
      onFull: () => this.toggleFull(),
    })
    return host
  }

  onRemove(): void {
    const doc = this.el.ownerDocument
    this.map?.off('rotate', this.turn)
    this.map?.off('pitch', this.turn)
    doc.removeEventListener('fullscreenchange', this.fullChanged)
    this.location.onBusy = null
    if (this.host) unrenderKit(this.host)
    this.host?.remove()
    this.host = this.map = null
  }

  private turn = () => {
    if (!this.map) return
    this.state.bearing = this.map.getBearing()
    this.state.turned = Math.abs(this.state.bearing) > 0.5 || this.map.getPitch() > 0.5
  }

  private fullChanged = () => {
    this.state.full = this.el.ownerDocument.fullscreenElement === this.el
    this.map?.resize()
  }

  private toggleFull(): void {
    const doc = this.el.ownerDocument
    if (typeof this.el.requestFullscreen === 'function' && doc.fullscreenEnabled !== false) {
      if (doc.fullscreenElement === this.el) void doc.exitFullscreen()
      else void this.el.requestFullscreen()
      return
    }
    this.state.full = !this.state.full
    this.el.toggleClass('abele-map_full', this.state.full)
    this.map?.resize()
  }
}
