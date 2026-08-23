/**
 * Builds an in-memory stand-in for the slice of Obsidian's `app` that the plugin's group,
 * log and relation logic touches: `vault.getFiles`, `vault.getMarkdownFiles`, `vault.read`,
 * `vault.getAbstractFileByPath`, `metadataCache.getFileCache`,
 * `metadataCache.getFirstLinkpathDest`, `metadataCache.trigger` and
 * `metadataCache.resolvedLinks`.
 *
 * It is a real implementation rather than a stub — link resolution follows Obsidian's
 * documented precedence (exact path, then path + `.md`, then unique basename) so that
 * tests exercise the same resolution semantics production code depends on. Body and
 * frontmatter links are derived from the fixture exactly as Obsidian would derive them,
 * which is what lets code paths like `getOutgoingLinksByPath` run unmodified.
 *
 * Every lookup increments a counter in `stats`, which lets a test assert on the *amount*
 * of work an algorithm does rather than on wall-clock time. That distinction matters for
 * the group-resolution performance tests: operation counts are identical across machines
 * and CI runners, whereas milliseconds are not.
 */
import { TFile, TFolder, TAbstractFile } from 'obsidian'

export interface FakeLinkCache {
  link: string
}

export interface FakeFileSpec {
  path: string
  /** Parsed frontmatter for this note, as Obsidian's metadata cache would expose it. */
  frontmatter?: Record<string, unknown>
  /** Note body, without frontmatter. Wikilinks in it become the file's outgoing links. */
  content?: string
}

export interface FakeVaultStats {
  getFiles: number
  getMarkdownFiles: number
  getFileCache: number
  getFirstLinkpathDest: number
  getAbstractFileByPath: number
  read: number
  /**
   * Reads of the whole `resolvedLinks` map. Backlink lookups walk it end to end, so one read
   * per lookup means the cost scales with how many paths are asked about; one read per burst
   * means it scales with the vault alone.
   */
  resolvedLinks: number
}

export interface FakeFileCache {
  frontmatter?: Record<string, unknown>
  links: FakeLinkCache[]
  frontmatterLinks: FakeLinkCache[]
}

export interface FakeApp {
  vault: {
    getFiles(): TFile[]
    getMarkdownFiles(): TFile[]
    getAbstractFileByPath(path: string): TAbstractFile | null
    read(file: TFile): Promise<string>
    cachedRead(file: TFile): Promise<string>
    on(name: string, callback: (...args: unknown[]) => void): { id: string }
    offref(ref: { id: string }): void
  }
  metadataCache: {
    getFileCache(file: TFile): FakeFileCache | null
    getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null
    trigger(...args: unknown[]): void
    on(name: string, callback: (...args: unknown[]) => void): { id: string }
    offref(ref: { id: string }): void
    resolvedLinks: Record<string, Record<string, number>>
  }
  /** Obsidian's keychain. Tests seed it directly; production reads provider keys through it. */
  secretStorage: {
    getSecret(id: string): string
    setSecret(id: string, value: string): void
  }
  /** Invokes the handlers registered for an event, so tests can drive incremental updates. */
  emit(scope: 'vault' | 'metadataCache', name: string, ...args: unknown[]): void
  stats: FakeVaultStats
  resetStats(): void
}

const WIKILINK = /\[\[([^\]]+)\]\]/
const WIKILINK_GLOBAL = /\[\[([^\]]+)\]\]/g

/** Strips `[[ ]]`, a `|alias` suffix and a `#heading` fragment down to the bare link target. */
function linkTarget(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const match = WIKILINK.exec(raw)
  const inner = match ? match[1] : raw
  const trimmed = inner.split('|')[0].split('#')[0].trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Every wikilink target appearing in a block of text, in order. */
function bodyLinkTargets(body: string): string[] {
  const targets: string[] = []
  for (const match of body.matchAll(WIKILINK_GLOBAL)) {
    const target = match[1].split('|')[0].split('#')[0].trim()
    if (target) targets.push(target)
  }
  return targets
}

/**
 * Serialises frontmatter back to YAML for `vault.read`.
 *
 * Wikilinks are quoted, matching how every writer in the plugin emits them. An unquoted
 * `- [[X]]` parses as a nested array rather than a string, which readers silently skip —
 * so emitting them correctly here keeps fixtures faithful to real notes.
 */
function toYaml(frontmatter: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${quote(item)}`)
    } else {
      lines.push(`${key}: ${quote(value)}`)
    }
  }
  return lines.join('\n')
}

function quote(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const str = String(value)
  return /[[\]:#'"]/.test(str) || str === '' ? `'${str.replace(/'/g, "''")}'` : str
}

export function buildFakeVault(specs: FakeFileSpec[]): FakeApp {
  const files: TFile[] = []
  const byPath = new Map<string, TFile>()
  const folders = new Map<string, TFolder>()
  const specByPath = new Map<string, FakeFileSpec>()

  const ensureFolder = (path: string): TFolder => {
    const existing = folders.get(path)
    if (existing) return existing

    const folder = new TFolder()
    folder.path = path
    folder.name = path.split('/').pop() ?? path
    folder.children = []
    folders.set(path, folder)

    if (path !== '' && path !== '/') {
      const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const parent = ensureFolder(parentPath)
      parent.children.push(folder)
      folder.parent = parent
    }

    return folder
  }

  ensureFolder('')

  for (const spec of specs) {
    const file = new TFile()
    file.path = spec.path
    file.name = spec.path.split('/').pop() ?? spec.path
    const dot = file.name.lastIndexOf('.')
    file.basename = dot > 0 ? file.name.slice(0, dot) : file.name
    file.extension = dot > 0 ? file.name.slice(dot + 1) : ''

    const parentPath = spec.path.includes('/') ? spec.path.slice(0, spec.path.lastIndexOf('/')) : ''
    const parent = ensureFolder(parentPath)
    parent.children.push(file)
    file.parent = parent

    files.push(file)
    byPath.set(spec.path, file)
    specByPath.set(spec.path, spec)
  }

  // Basename index for link resolution. Obsidian only falls back to a basename match when it
  // is unambiguous, so ambiguous basenames are recorded and then excluded.
  const byBasename = new Map<string, TFile[]>()
  for (const file of files) {
    const bucket = byBasename.get(file.basename)
    if (bucket) bucket.push(file)
    else byBasename.set(file.basename, [file])
  }

  const stats: FakeVaultStats = {
    getFiles: 0,
    getMarkdownFiles: 0,
    getFileCache: 0,
    getFirstLinkpathDest: 0,
    getAbstractFileByPath: 0,
    read: 0,
    resolvedLinks: 0,
  }

  const resolveLink = (linkpath: string): TFile | null => {
    const exact = byPath.get(linkpath)
    if (exact) return exact

    const withExtension = byPath.get(`${linkpath}.md`)
    if (withExtension) return withExtension

    // Callers reach this via wikilinkToPath(), which unconditionally appends `.md`, so a
    // link written as `[[Movies]]` arrives here as `Movies.md`. Obsidian resolves that to
    // a note named `Movies` in any folder; the bare-name fallback reproduces that.
    const bare = linkpath.endsWith('.md') ? linkpath.slice(0, -3) : linkpath
    const candidates = byBasename.get(bare)
    if (candidates && candidates.length === 1) return candidates[0]

    return null
  }

  // Caches derived once, mirroring Obsidian's own precomputed metadata.
  const cacheByPath = new Map<string, FakeFileCache>()
  const rawByPath = new Map<string, string>()
  const resolvedLinks: Record<string, Record<string, number>> = {}

  for (const spec of specs) {
    const frontmatterLinks: FakeLinkCache[] = []
    for (const value of Object.values(spec.frontmatter ?? {})) {
      const values = Array.isArray(value) ? value : [value]
      for (const entry of values) {
        if (typeof entry !== 'string' || !WIKILINK.test(entry)) continue
        const target = linkTarget(entry)
        if (target) frontmatterLinks.push({ link: target })
      }
    }

    const links: FakeLinkCache[] = bodyLinkTargets(spec.content ?? '').map((link) => ({ link }))

    cacheByPath.set(spec.path, {
      frontmatter: spec.frontmatter,
      links,
      frontmatterLinks,
    })

    const yaml = spec.frontmatter ? `---\n${toYaml(spec.frontmatter)}\n---\n` : ''
    rawByPath.set(spec.path, `${yaml}${spec.content ?? ''}`)

    const targets: Record<string, number> = {}
    for (const { link } of [...links, ...frontmatterLinks]) {
      const dest = resolveLink(link)
      if (dest) targets[dest.path] = (targets[dest.path] ?? 0) + 1
    }
    resolvedLinks[spec.path] = targets
  }

  // Event registry. Entities register vault/metadata listeners in their constructors, and
  // some behaviour is only reachable by firing those events, so handlers are kept and can
  // be invoked from a test through `emit`.
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  let handlerId = 0

  const register =
    (scope: string) =>
    (name: string, callback: (...args: unknown[]) => void): { id: string } => {
      const key = `${scope}:${name}`
      const bucket = handlers.get(key)
      if (bucket) bucket.push(callback)
      else handlers.set(key, [callback])
      return { id: `${key}#${handlerId++}` }
    }

  const noopOffref = (): void => {
    // Tests build a fresh app per case, so unregistering is unnecessary.
  }

  return {
    emit(scope: 'vault' | 'metadataCache', name: string, ...args: unknown[]) {
      for (const callback of handlers.get(`${scope}:${name}`) ?? []) callback(...args)
    },
    vault: {
      on: register('vault'),
      offref: noopOffref,
      getFiles() {
        stats.getFiles++
        // Obsidian allocates a fresh array per call; mirroring that keeps callers honest
        // about treating this as an expensive operation.
        return files.slice()
      },
      getMarkdownFiles() {
        stats.getMarkdownFiles++
        return files.filter((file) => file.extension === 'md')
      },
      getAbstractFileByPath(path: string) {
        stats.getAbstractFileByPath++
        return byPath.get(path) ?? folders.get(path) ?? null
      },
      async read(file: TFile) {
        stats.read++
        return rawByPath.get(file.path) ?? ''
      },
      async cachedRead(file: TFile) {
        stats.read++
        return rawByPath.get(file.path) ?? ''
      },
    },
    metadataCache: {
      on: register('metadataCache'),
      offref: noopOffref,
      getFileCache(file: TFile) {
        stats.getFileCache++
        return cacheByPath.get(file.path) ?? null
      },
      getFirstLinkpathDest(linkpath: string) {
        stats.getFirstLinkpathDest++
        return resolveLink(linkpath)
      },
      trigger() {
        // Obsidian fires metadata events here; nothing in these tests observes them.
      },
      get resolvedLinks() {
        stats.resolvedLinks++
        return resolvedLinks
      },
    },
    secretStorage: (() => {
      const secrets = new Map<string, string>()
      return {
        getSecret: (id: string) => secrets.get(id) ?? '',
        setSecret: (id: string, value: string) => void secrets.set(id, value),
      }
    })(),
    stats,
    resetStats() {
      stats.getFiles = 0
      stats.getMarkdownFiles = 0
      stats.getFileCache = 0
      stats.getFirstLinkpathDest = 0
      stats.getAbstractFileByPath = 0
      stats.read = 0
      stats.resolvedLinks = 0
    },
  }
}
