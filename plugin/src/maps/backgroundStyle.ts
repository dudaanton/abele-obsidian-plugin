import { requestUrl } from 'obsidian'
import type { StyleSpecification } from 'maplibre-gl'

export type BackgroundSource = 'base' | 'settings' | 'default'

type Request = (url: string) => Promise<{ status: number; json: unknown }>
const hostRequest: Request = (url) => requestUrl({ url, throw: false })

/** Only explicitly configured named backgrounds may use host transport. All other URLs stay with MapLibre. */
export async function loadBackgroundStyle(
  style: string | object,
  source: BackgroundSource = 'base',
  request: Request = hostRequest
): Promise<string | StyleSpecification> {
  if (typeof style !== 'string') return style as StyleSpecification
  if (source !== 'settings') return style
  try {
    const response = await request(style)
    if (response.status < 200 || response.status >= 300) return style
    const data = response.json as StyleSpecification
    if (data?.version !== 8 || !data.sources || !Array.isArray(data.layers)) return style
    const copy = structuredClone(data)
    const token = new URL(style).searchParams.get('access_token')
    const url = (value: string, source = false) => {
      if (value.startsWith('mapbox://') && token) {
        const parsed = new URL(value)
        const endpoint = new URL('https://api.mapbox.com')
        if (parsed.hostname === 'sprites')
          endpoint.pathname = `/styles/v1/${parsed.pathname.split('/').filter(Boolean).slice(0, 2).join('/')}/sprite`
        else if (parsed.hostname === 'fonts') endpoint.pathname = `/fonts/v1${parsed.pathname}`
        else if (parsed.hostname === 'styles') endpoint.pathname = `/styles/v1${parsed.pathname}`
        else if (source) {
          endpoint.pathname = `/v4/${parsed.hostname}.json`
          endpoint.searchParams.set('secure', '')
        } else return value
        for (const [key, entry] of parsed.searchParams) endpoint.searchParams.set(key, entry)
        endpoint.searchParams.set('access_token', token)
        return endpoint.href.replaceAll('%7B', '{').replaceAll('%7D', '}')
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value
      return new URL(value, style).href.replaceAll('%7B', '{').replaceAll('%7D', '}')
    }
    if (typeof copy.sprite === 'string') copy.sprite = url(copy.sprite)
    else if (Array.isArray(copy.sprite))
      copy.sprite = copy.sprite.map((sprite) => ({ ...sprite, url: url(sprite.url) }))
    if (copy.glyphs) copy.glyphs = url(copy.glyphs)
    for (const source of Object.values(copy.sources)) {
      if ('url' in source && typeof source.url === 'string') source.url = url(source.url, true)
      if ('tiles' in source && Array.isArray(source.tiles))
        source.tiles = source.tiles.map((tile) => url(tile))
    }
    if (copy.projection && 'name' in copy.projection) {
      delete (copy.projection as { name?: unknown }).name
      if (!('type' in copy.projection)) delete copy.projection
    }
    return copy
  } catch {
    console.debug('[maps] Host style request failed; trying the renderer transport')
    return style
  }
}
