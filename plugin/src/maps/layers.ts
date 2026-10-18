import { getIcon } from 'obsidian'
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl'
import type { MapPlace } from '@/maps/core/records'

const SOURCE = 'abele-places'
export const PLACE_LAYER = 'abele-place-symbols'
export const CLUSTER_LAYER = 'abele-place-clusters'
/** One source and two symbol layers, regardless of the number of notes. */
export class PlaceLayers {
  private disposed = false
  private generation = 0
  private images = new Map<string, Promise<ImageData>>()
  constructor(
    private map: LibreMap,
    private doc: Document
  ) {
    map.setMissingStyleImageResolver((id) => this.clusterImage({ id }))
  }

  private clusterImage = (event: { id: string }): void => {
    const prefix = 'abele-cluster-'
    if (!event.id.startsWith(prefix) || this.disposed || this.map.hasImage(event.id)) return
    const count = event.id.slice(prefix.length)
    if (!/^\d+$/.test(count)) return
    const style = this.doc.defaultView.getComputedStyle(this.map.getContainer())
    const canvas = this.doc.win.createEl('canvas')
    canvas.width = canvas.height = 96
    const context = canvas.getContext('2d')
    context.fillStyle = style.getPropertyValue('--text-normal').trim() || '#222'
    context.beginPath()
    context.arc(48, 48, 40, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = style.getPropertyValue('--background-primary').trim() || '#fff'
    context.font = `26px ${style.getPropertyValue('--font-interface').trim() || 'sans-serif'}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(count, 48, 48, 76)
    this.map.addImage(event.id, context.getImageData(0, 0, 96, 96), { pixelRatio: 2 })
  }

  async update(places: MapPlace[], cluster: boolean): Promise<void> {
    const generation = ++this.generation
    if (this.disposed || !this.map.isStyleLoaded()) return
    const accent =
      this.doc.defaultView
        .getComputedStyle(this.map.getContainer())
        .getPropertyValue('--interactive-accent')
        .trim() || '#888'
    const foreground =
      this.doc.defaultView
        .getComputedStyle(this.map.getContainer())
        .getPropertyValue('--text-on-accent')
        .trim() || '#fff'
    const colors = new Map<string, string>()
    const icons = new Map<string, SVGSVGElement | null>()
    const features = await Promise.all(
      places.map(async (place) => {
        const rawColor = place.color || ''
        if (!colors.has(rawColor)) {
          const probe = this.doc.win.createSpan()
          probe.setCssProps({ color: 'var(--interactive-accent)' })
          if (place.color) probe.style.color = place.color
          this.map.getContainer().appendChild(probe)
          colors.set(rawColor, this.doc.defaultView.getComputedStyle(probe).color || accent)
          probe.remove()
        }
        const color = colors.get(rawColor)
        const name = place.icon || ''
        if (!icons.has(name)) icons.set(name, name ? getIcon(name) : null)
        const icon = icons.get(name)
        const key = `${icon ? place.icon : 'dot'}:${color}:${foreground}`
        if (!this.images.has(key)) {
          this.images.set(
            key,
            (async () => {
              const canvas = this.doc.win.createEl('canvas')
              canvas.width = canvas.height = 64
              const ctx = canvas.getContext('2d')
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(32, 32, icon ? 27 : 12, 0, Math.PI * 2)
              ctx.fill()
              if (icon) {
                const svg = icon.cloneNode(true) as SVGElement
                svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
                svg.setAttribute('stroke', foreground)
                svg.setAttribute('width', '32')
                svg.setAttribute('height', '32')
                const img = new Image()
                img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
                try {
                  await img.decode()
                  ctx.drawImage(img, 16, 16, 32, 32)
                } catch {
                  /* The coloured disc remains usable. */
                }
              }
              return ctx.getImageData(0, 0, 64, 64)
            })()
          )
        }
        await this.images.get(key)
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [place.lon, place.lat] },
          properties: { id: place.id, image: key },
        }
      })
    )
    if (this.disposed || generation !== this.generation || !this.map.isStyleLoaded()) return
    const used = new Set(features.map((f) => f.properties.image))
    const stale: string[] = []
    for (const [key, data] of this.images) {
      if (!used.has(key)) {
        this.images.delete(key)
        stale.push(key)
        continue
      }
      if (!this.map.hasImage(key)) this.map.addImage(key, await data, { pixelRatio: 2 })
    }
    const data = { type: 'FeatureCollection' as const, features }
    const prune = () => {
      if (this.disposed || generation !== this.generation) return
      for (const key of stale) if (this.map.hasImage(key)) this.map.removeImage(key)
    }
    const source = this.map.getSource<GeoJSONSource>(SOURCE)
    if (source && this.cluster === cluster) {
      await source.setData(data)
      prune()
      return
    }
    for (const id of [PLACE_LAYER, CLUSTER_LAYER])
      if (this.map.getLayer(id)) this.map.removeLayer(id)
    if (source) this.map.removeSource(SOURCE)
    this.cluster = cluster
    this.map.addSource(SOURCE, {
      type: 'geojson',
      data,
      cluster,
      maxzoom: 24,
      clusterRadius: 44,
      clusterMaxZoom: 24,
    })
    this.map.addLayer({
      id: PLACE_LAYER,
      type: 'symbol',
      source: SOURCE,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['get', 'image'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
    this.map.addLayer({
      id: CLUSTER_LAYER,
      type: 'symbol',
      source: SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': ['concat', 'abele-cluster-', ['to-string', ['get', 'point_count']]],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
    prune()
  }
  private cluster = true
  source(): GeoJSONSource {
    return this.map.getSource<GeoJSONSource>(SOURCE)
  }
  dispose(): void {
    this.disposed = true
    this.map.setMissingStyleImageResolver(null)
    this.generation++
    this.images.clear()
  }
}
