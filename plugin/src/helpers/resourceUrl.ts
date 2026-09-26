/**
 * From what a script or a note calls a picture to what the renderer can load.
 *
 * A vault path is not a URL; `getResourcePath` makes one. And what a note calls a picture is
 * usually not a path at all — `![[poster.jpg]]` names the file, and Obsidian finds it wherever
 * it lives. A script that copied that name out of a note deserves the same lookup, so a bare
 * name is resolved the way a link is when no file sits at the path as written.
 */
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { vaultUrl } from './vaultUrl'

/** Anything with a scheme, a leading slash or a data URL is already a URL: left alone. */
export function isExternalSource(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')
}

/**
 * What a `cover` property names, as a path, a link name or a URL — or null.
 *
 * Written by hand it is `[[poster.jpg]]`, `![[poster.jpg|300]]`, `Media/poster.jpg` or a web
 * address; a list is read by its first entry. The brackets and the display text go, because
 * the renderer resolves the name, not the link.
 */
export function coverLink(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first !== 'string' || !first.trim()) return null
  return (
    first
      .trim()
      .replace(/^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/, '$1')
      .trim() || null
  )
}

/** The file a path or a link name points at, resolved from `from` the way a link is. */
export function resolveVaultFile(src: string, from = ''): TFile | null {
  if (!src || isExternalSource(src)) return null
  const { app } = GlobalStore.getInstance()
  const exact = app.vault.getAbstractFileByPath(src)
  if (exact instanceof TFile) return exact
  const linked = app.metadataCache.getFirstLinkpathDest(src, from)
  return linked instanceof TFile ? linked : null
}

/** A URL the renderer can load, or `undefined` when nothing in the vault answers to `src`. */
export function resourceUrl(src: string, from = ''): string | undefined {
  if (isExternalSource(src)) return src
  const file = resolveVaultFile(src, from)
  return file ? vaultUrl(GlobalStore.getInstance().app, file) : undefined
}

/**
 * Turns the vault paths in a fragment of markup into URLs, in place.
 *
 * Markup a script wrote says `<img src="Attachments/a.jpg">` because that is what the file
 * is called; the browser would ask the page's own origin for it and draw nothing. Every
 * media element whose `src` names a vault file gets the loadable URL instead. A URL that
 * resolves to nothing is left as written.
 */
export function resolveMediaSources(root: ParentNode, from = ''): void {
  for (const el of Array.from(
    root.querySelectorAll('img[src], video[src], audio[src], source[src]')
  )) {
    const src = el.getAttribute('src') ?? ''
    if (!src || isExternalSource(src)) continue
    const url = resourceUrl(src, from)
    if (url) el.setAttribute('src', url)
  }
}
