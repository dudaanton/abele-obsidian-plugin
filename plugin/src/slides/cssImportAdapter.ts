import { TFile, type App } from 'obsidian'
import { request } from '@/helpers/http'
import type { CssImportLoader, CssSource } from './core/model'

const unwrapped = (reference: string) => {
  const ref = reference.trim()
  return ref.startsWith('[[') && ref.endsWith(']]') ? ref.slice(2, -2).split('|')[0] : ref
}

/** CSS URL paths are relative to the importing sheet, not the presentation's renderer window. */
function relativePath(reference: string, base: string): string {
  const path = reference.startsWith('/')
    ? reference.slice(1)
    : base.slice(0, base.lastIndexOf('/') + 1) + reference
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

export function noteCssImporter(app: App, notePath: () => string): CssImportLoader {
  const fileOf = (reference: string, base: string): TFile | null => {
    const direct = app.vault.getAbstractFileByPath(relativePath(reference, base))
    const file =
      direct instanceof TFile ? direct : app.metadataCache.getFirstLinkpathDest(reference, base)
    return file instanceof TFile ? file : null
  }
  return async (reference, relativeTo = ''): Promise<CssSource> => {
    const ref = unwrapped(reference),
      base = relativeTo || notePath()
    if (/^data:text\/css[;,]/i.test(ref)) {
      const comma = ref.indexOf(',')
      const data = ref.slice(comma + 1)
      const css = /;base64$/i.test(ref.slice(0, comma))
        ? new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
        : decodeURIComponent(data)
      return { id: ref, css }
    }
    if (/^https?:\/\//i.test(ref) || /^https?:\/\//i.test(base)) {
      const url = new URL(ref, /^https?:\/\//i.test(base) ? base : undefined)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported stylesheet URL')
      const response = await request({ url: url.href })
      return {
        css: response.text,
        id: url.href,
        assetUrl: (asset) => (asset.startsWith('#') ? asset : new URL(asset, url).href),
      }
    }
    const file = fileOf(ref, base)
    if (!file || file.extension !== 'css') throw new Error('Stylesheet file could not be found')
    return {
      css: await app.vault.read(file),
      id: file.path,
      assetUrl: (asset) => {
        if (asset.startsWith('#') || /^[a-z][\w+.-]*:/i.test(asset)) return asset
        const target = fileOf(asset, file.path)
        return target ? app.vault.getResourcePath(target) : asset
      },
    }
  }
}
