/**
 * Links and images in a markdown file from GitHub, pointed where GitHub points them.
 *
 * Obsidian renders the file as if it were a note in the vault: `[guide](docs/guide.md)` would
 * become a link to a note, `![](logo.png)` an embed of a vault file. Here they are the
 * repository's: a relative link opens that file in a GitHub tab, at the same ref; a relative
 * image loads from the repository's raw files. A link to a heading scrolls the preview. Anything
 * but a web or mail address — `javascript:`, `obsidian:`, `file:` — is left as text: a README is
 * written by someone else, and a link in it must not be able to act inside the app.
 */
import { repoWeb, webOrigin } from './origin'
import type { GithubClient } from './client'

/** The file a preview shows: its repository, the ref it was read at, and its path. */
export interface RepoFile {
  host: string
  owner: string
  repo: string
  ref: string
  path: string
}

export type HrefAction =
  | { kind: 'anchor'; slug: string }
  | { kind: 'repo'; url: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked' }

const SCHEME = /^([a-z][a-z0-9+.-]*):/i
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

const encodePath = (segments: string[]) => segments.map(encodeURIComponent).join('/')
const repoBase = (f: RepoFile) => repoWeb(f)

/**
 * A path written in the file, resolved in the repository: against the file's folder, or against
 * the repository's root when it starts with `/`. `..` never climbs out of the repository.
 */
export function resolveRepoPath(from: string, written: string): string[] {
  let decoded = written
  try {
    decoded = decodeURI(written)
  } catch {
    // Not valid percent-encoding: taken as written.
  }
  const base = decoded.startsWith('/') ? [] : from.split('/').slice(0, -1)
  const out = [...base]
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out
}

/** Split `path?query#hash`. */
function parts(href: string): { path: string; query: string; hash: string } {
  const hashAt = href.indexOf('#')
  const hash = hashAt >= 0 ? href.slice(hashAt) : ''
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href
  const queryAt = beforeHash.indexOf('?')
  return {
    path: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash,
    query: queryAt >= 0 ? beforeHash.slice(queryAt) : '',
    hash,
  }
}

/** The slug a `#…` link names, as the heading blocks carry it. */
export function anchorSlug(hash: string): string {
  let slug = hash.replace(/^#/, '')
  try {
    slug = decodeURIComponent(slug)
  } catch {
    // Kept as written.
  }
  // A space is how an Obsidian-style `[[#Some heading]]` writes what GitHub makes a dash.
  return slug
    .replace(/^user-content-/, '')
    .toLowerCase()
    .replace(/ /g, '-')
}

/** What a link in the rendered file does. */
export function hrefAction(href: string, file: RepoFile): HrefAction {
  const h = href.trim()
  if (!h) return { kind: 'blocked' }
  if (h.startsWith('#')) return { kind: 'anchor', slug: anchorSlug(h) }
  if (h.startsWith('//')) return { kind: 'external', url: `https:${h}` }
  const scheme = SCHEME.exec(h)
  if (scheme) {
    return SAFE_SCHEMES.has(scheme[1].toLowerCase())
      ? { kind: 'external', url: h }
      : { kind: 'blocked' }
  }
  const { path, query, hash } = parts(h)
  // `?plain=1` alone, or `#…` after a query: this same file.
  const segments = path ? resolveRepoPath(file.path, path) : file.path.split('/')
  const ref = encodePath(file.ref.split('/'))
  if (segments.length === 0 || path.endsWith('/')) {
    // A folder: its listing, which opens in the tab like a file does.
    const folder = segments.length ? `/${encodePath(segments)}` : ''
    return { kind: 'repo', url: `${repoBase(file)}/tree/${ref}${folder}` }
  }
  return {
    kind: 'repo',
    url: `${repoBase(file)}/blob/${ref}/${encodePath(segments)}${query}${hash}`,
  }
}

/** Where a file's bytes are served from without the API: github.com's raw host, or the server's. */
export function rawUrl(file: RepoFile, segments: string[]): string {
  const ref = encodePath(file.ref.split('/'))
  if (file.host === 'github.com') {
    return `https://raw.githubusercontent.com/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}/${ref}/${encodePath(segments)}`
  }
  return `${repoBase(file)}/raw/${ref}/${encodePath(segments)}`
}

export interface ImageSource {
  src: string
  /** The repository path it was read from, for loading it through the API when that fails. */
  repoPath?: string
}

/** Where an image in the file loads from; null for one that must not load at all. */
export function imageSource(src: string, file: RepoFile): ImageSource | null {
  const s = src.trim()
  if (!s) return null
  if (/^data:image\//i.test(s)) return { src: s }
  if (s.startsWith('//')) return { src: `https:${s}` }
  const scheme = SCHEME.exec(s)
  if (scheme) {
    const name = scheme[1].toLowerCase()
    if (name !== 'http' && name !== 'https') return null
    // A link to an image's page in this repository means its bytes, as GitHub reads it.
    const page = new RegExp(
      `^https?://${file.host.replace(/\./g, '\\.')}(?::\\d+)?/([^/]+)/([^/]+)/blob/(.+)$`,
      'i'
    ).exec(s)
    if (page) return { src: `${webOrigin(file.host)}/${page[1]}/${page[2]}/raw/${page[3]}` }
    return { src: s }
  }
  const segments = resolveRepoPath(file.path, parts(s).path)
  if (segments.length === 0) return null
  return { src: rawUrl(file, segments), repoPath: segments.join('/') }
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

/**
 * Points every link and image in a rendered block where GitHub would, and marks what the click
 * handler needs to know: `data-abele-anchor` for a heading in this file, `data-abele-repo` for a
 * file in the repository. Called on each block as it renders.
 */
export function rewriteRendered(root: HTMLElement, file: RepoFile): void {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    if (a.classList.contains('footnote-link') || a.classList.contains('footnote-backref')) continue
    const written = a.getAttribute('data-href') ?? a.getAttribute('href')
    if (written === null) continue
    const action = hrefAction(written, file)
    a.removeAttribute('data-href')
    a.classList.remove('internal-link', 'is-unresolved')
    switch (action.kind) {
      case 'anchor':
        a.setAttribute('href', `#${action.slug}`)
        a.dataset.abeleAnchor = action.slug
        break
      case 'repo':
        a.setAttribute('href', action.url)
        a.dataset.abeleRepo = ''
        a.classList.add('external-link')
        break
      case 'external':
        a.setAttribute('href', action.url)
        break
      case 'blocked':
        a.removeAttribute('href')
        a.removeAttribute('target')
        a.dataset.abeleBlocked = ''
        a.classList.remove('external-link')
        break
    }
  }

  // `![](logo.png)` arrives as an embed of a vault file; an image it is.
  for (const embed of Array.from(root.querySelectorAll('.internal-embed'))) {
    const src = embed.getAttribute('src') ?? ''
    if (!IMAGE_EXTENSIONS.test(parts(src).path) && !SCHEME.test(src)) {
      // A note of the vault named from a README is not the README's to show.
      embed.replaceWith(root.ownerDocument.createTextNode(embed.getAttribute('alt') || src))
      continue
    }
    const img = createEl('img')
    img.setAttribute('src', src)
    const alt = embed.getAttribute('alt')
    if (alt && alt !== src) img.setAttribute('alt', alt)
    for (const size of ['width', 'height'])
      if (embed.getAttribute(size)) img.setAttribute(size, embed.getAttribute(size) ?? '')
    embed.replaceWith(img)
  }

  for (const img of Array.from(root.querySelectorAll('img'))) {
    const source = imageSource(img.getAttribute('src') ?? '', file)
    if (!source) {
      img.removeAttribute('src')
      continue
    }
    img.setAttribute('src', source.src)
    if (source.repoPath) img.dataset.abeleRepoPath = source.repoPath
  }

  // `<picture>` with a dark and a light logo, as READMEs do it.
  for (const el of Array.from(root.querySelectorAll('source[srcset]'))) {
    const set = (el.getAttribute('srcset') ?? '')
      .split(',')
      .map((entry) => {
        const [url, ...size] = entry.trim().split(/\s+/)
        const source = imageSource(url ?? '', file)
        return source ? [source.src, ...size].join(' ') : ''
      })
      .filter(Boolean)
    el.setAttribute('srcset', set.join(', '))
  }
}

/**
 * Loads an image of the repository through the API, with the token, for when its raw address
 * refused it — a private repository, or an Enterprise server that wants a session. The bytes come
 * back as an object URL the caller revokes.
 */
export async function repoImageUrl(
  client: GithubClient,
  file: RepoFile,
  repoPath: string
): Promise<string> {
  const { bytes, type } = await client.fileBytes(file, repoPath, file.ref, 'the image')
  // An SVG without its type is not drawn at all.
  const mime = /\.svg$/i.test(repoPath) ? 'image/svg+xml' : type
  return URL.createObjectURL(new Blob([bytes], mime ? { type: mime } : {}))
}
