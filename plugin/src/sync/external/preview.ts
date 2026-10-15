import type { App } from 'obsidian'
import { sha256 } from './hash'
import { projectionMime } from './projection'

const KEY = 'abele-external-previews-v1'
const MAX_DATA = 56 * 1024
type Preview = { data: string; saved: number }
function previews(app: App): Record<string, Preview> {
  const value: unknown = app.loadLocalStorage(KEY)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) =>
        /^[a-f0-9]{64}$/.test(key) &&
        entry &&
        typeof entry === 'object' &&
        typeof entry.data === 'string' &&
        entry.data.length <= MAX_DATA &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(entry.data) &&
        Number.isFinite(entry.saved)
    )
  )
}
export function externalPreview(app: App, key: string): string | undefined {
  return previews(app)[key]?.data
}

/** Only local app storage: a preview is neither a vault attachment nor sync input. */
export async function saveExternalPreview(
  app: App,
  path: string,
  sha: string,
  render = renderPreview
): Promise<string | undefined> {
  if (!/^image\/(png|jpeg|gif|webp|avif|bmp|heic|heif)$/.test(projectionMime(path))) return
  try {
    const stat = await app.vault.adapter.stat(path)
    // Mobile adapters expose whole reads; never allocate an unbounded original for a thumbnail.
    if (!stat || stat.size > 50 * 1024 * 1024) return
    const bytes = new Uint8Array(await app.vault.adapter.readBinary(path))
    if ((await sha256(bytes)) !== sha) return
    if (externalPreview(app, sha)) return sha
    const data = await render(new Blob([bytes], { type: projectionMime(path) }))
    if (!data || data.length > MAX_DATA || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data))
      return
    const cache = previews(app)
    cache[sha] = { data, saved: Date.now() }
    const entries = Object.entries(cache)
      .sort(([, a], [, b]) => b.saved - a.saved)
      .slice(0, 128)
    app.saveLocalStorage(KEY, Object.fromEntries(entries))
    return externalPreview(app, sha) === data ? sha : undefined
  } catch (error) {
    console.debug('[abele-sync] optional image preview unavailable', error)
    return undefined
  }
}

async function renderPreview(blob: Blob): Promise<string | undefined> {
  const image = new Image()
  if (typeof image.decode !== 'function') return
  const url = URL.createObjectURL(blob)
  let timer: number | undefined
  try {
    image.src = url
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Preview decode timed out')), 5000)
      }),
    ])
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = createEl('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.7, 0.5, 0.3]) {
      const data = canvas.toDataURL('image/jpeg', quality)
      if (data.length <= MAX_DATA) return data
    }
    return undefined
  } finally {
    window.clearTimeout(timer)
    URL.revokeObjectURL(url)
    image.src = ''
  }
}
