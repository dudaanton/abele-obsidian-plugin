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
 *
 * Under the index there is a disk, reached through `vault.adapter`: `list`, `stat`,
 * `readBinary`, `writeBinary`, `rename`, `remove`, `mkdir` and `exists`. It holds the hidden
 * files the index never shows — a spec whose path has a dot-segment, `.obsidian/app.json`
 * among them — and it answers a name that is spelled differently in the same letters, which
 * is what makes it a stand-in for macOS rather than for ext4. `vault.on`, `workspace.on` and
 * `emit` together let a test fire the events a watcher listens for, and `offref` really does
 * unregister.
 */
import { TFile, TFolder, TAbstractFile } from 'obsidian'
import { dump as dumpYaml, load as loadYaml } from 'js-yaml'
import { OperationDelays } from './deferred'

export interface FakeLinkCache {
  link: string
}

export interface FakeFileSpec {
  path: string
  /** Parsed frontmatter for this note, as Obsidian's metadata cache would expose it. */
  frontmatter?: Record<string, unknown>
  /** Note body, without frontmatter. Wikilinks in it become the file's outgoing links. */
  content?: string
  /**
   * The file exactly as it is on disk, for a vault loaded from one. `read` returns this rather
   * than frontmatter re-serialised from `frontmatter`, which would not match byte for byte.
   */
  raw?: string
  /** What `TFile.stat.mtime` and the adapter report for this file; 0 when unsaid. */
  mtime?: number
  /** What `TFile.stat.ctime` and the adapter report for this file; 0 when unsaid. */
  ctime?: number
}

/**
 * A file as the *adapter* sees it, which is not the same set as the file index: a spec whose
 * path has a dot-segment (`.obsidian/app.json`) exists on this disk and nowhere in
 * `getFiles()`, exactly as Obsidian hides its own configuration from the vault.
 */
export interface FakeDiskEntry {
  bytes: Uint8Array
  ctime: number
  mtime: number
}

export interface FakeVaultStats {
  getFiles: number
  getMarkdownFiles: number
  getFileCache: number
  getFirstLinkpathDest: number
  getAbstractFileByPath: number
  read: number
  /** Files created, whole-file rewrites, and appends — what a save costs the disk. */
  create: number
  modify: number
  append: number
  /** Bytes handed to the vault, which is what makes a rewrite visibly worse than an append. */
  written: number
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

/** The slice of Obsidian's `DataAdapter` the fake models — the raw disk under the index. */
export interface FakeAdapter {
  exists(path: string, sensitive?: boolean): Promise<boolean>
  stat(
    path: string
  ): Promise<{ type: 'file' | 'folder'; ctime: number; mtime: number; size: number } | null>
  list(path: string): Promise<{ files: string[]; folders: string[] }>
  readBinary(path: string): Promise<ArrayBuffer>
  writeBinary(
    path: string,
    data: ArrayBuffer,
    options?: { mtime?: number; ctime?: number }
  ): Promise<void>
  rename(path: string, newPath: string): Promise<void>
  remove(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  /**
   * Obsidian desktop's `rmdir`: `fs.rm(path, { recursive })`, which without `recursive` refuses
   * every folder, empty ones included (EISDIR) — and with it removes whatever the folder holds.
   */
  rmdir(path: string, recursive: boolean): Promise<void>
}

export interface FakeApp {
  delays: OperationDelays<'frontmatter' | 'metadata'>
  fileManager: {
    processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>
  }
  vault: {
    getResourcePath(file: TFile): string
    /** Obsidian's configuration folder, hidden from the file index and open to the adapter. */
    configDir: string
    adapter: FakeAdapter
    getFiles(): TFile[]
    getMarkdownFiles(): TFile[]
    getAbstractFileByPath(path: string): TAbstractFile | null
    getFileByPath(path: string): TFile | null
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
  /**
   * Obsidian's vault-scoped key/value store, where the chat tab layout lives. Backed by a map
   * rather than `window.localStorage`, which is shared by every test in a file.
   */
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, value: unknown): void
  /**
   * Gives a file the metadata Obsidian would have parsed for it — what a note written after
   * the vault was built needs before anything reading the cache can see it.
   */
  setFrontmatter(path: string, frontmatter: Record<string, unknown>): void
  /** Obsidian's workspace, for the events that live there — `css-change` among them. */
  workspace: {
    on(name: string, callback: (...args: unknown[]) => void): { id: string }
    offref(ref: { id: string }): void
  }
  /** Invokes the handlers registered for an event, so tests can drive incremental updates. */
  emit(scope: 'vault' | 'metadataCache' | 'workspace', name: string, ...args: unknown[]): void
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
  const delays = new OperationDelays<'frontmatter' | 'metadata'>()
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

  /**
   * The raw disk, as `vault.adapter` sees it.
   *
   * It holds two kinds of file. A hidden one — any path with a dot-segment, which is where
   * Obsidian keeps its configuration — lives *only* here, invisible to `getFiles()` exactly
   * as it is in a real vault. A visible one lives in the file index too, and its bytes are
   * kept here as well so that a binary write survives being read back byte for byte; a text
   * write through `vault.modify` drops the copy, which hands authority back to `rawByPath`.
   */
  const disk = new Map<string, FakeDiskEntry>()
  const diskFolders = new Set<string>([''])
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  /** A clock for writes that name no mtime, so two of them are never the same instant. */
  let diskClock = 1_700_000_000_000

  /** Obsidian hides every dot-segment from the file index; the adapter still sees it. */
  const isHidden = (path: string): boolean =>
    path.split('/').some((segment) => segment.startsWith('.'))

  /** The folder and every folder above it, on the disk. */
  const ensureDiskFolder = (path: string): void => {
    let folder = ''
    for (const segment of path.split('/')) {
      if (segment === '') continue
      folder = folder === '' ? segment : `${folder}/${segment}`
      diskFolders.add(folder)
    }
  }

  /** The folders a file at this path sits in. */
  const ensureDiskFolders = (path: string): void => {
    const cut = path.lastIndexOf('/')
    if (cut !== -1) ensureDiskFolder(path.slice(0, cut))
  }

  /**
   * How this disk compares two names when it has no exact match: case-insensitively and
   * whichever way they are composed. That is macOS and Windows, not ext4 — and it is what
   * stops code that means to tell a case-only rename from a collision leaning on a lookup,
   * and what lets a decomposed name on disk answer to the composed one Obsidian lists.
   */
  const fold = (path: string): string => path.normalize('NFC').toLowerCase()

  /** The spelling this disk actually holds for a name, or null when it holds none. */
  const actualPath = (path: string): string | null => {
    if (disk.has(path) || byPath.has(path)) return path
    const key = fold(path)
    for (const held of disk.keys()) if (fold(held) === key) return held
    for (const held of byPath.keys()) if (fold(held) === key) return held
    return null
  }

  const actualFolder = (path: string): string | null => {
    const folder = path === '/' ? '' : path
    if (diskFolders.has(folder) || folders.has(folder)) return folder
    const key = fold(folder)
    for (const held of diskFolders) if (fold(held) === key) return held
    for (const held of folders.keys()) if (fold(held) === key) return held
    return null
  }

  /** The bytes at a path: the disk's own copy, or the text store rendered as UTF-8. */
  const entryAt = (path: string): FakeDiskEntry | null => {
    const own = disk.get(path)
    if (own) return own
    const file = byPath.get(path)
    if (!file) return null
    return {
      bytes: encoder.encode(rawByPath.get(path) ?? ''),
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
    }
  }

  /** Puts bytes at a path, in the index too when the path is one the index would show. */
  const placeFile = (path: string, entry: FakeDiskEntry): void => {
    ensureDiskFolders(path)
    disk.set(path, entry)
    if (isHidden(path)) return
    const file = addFile(path)
    file.stat = { ctime: entry.ctime, mtime: entry.mtime, size: entry.bytes.byteLength }
    rawByPath.set(path, decoder.decode(entry.bytes))
  }

  for (const spec of specs) {
    // A hidden spec is a file on the disk and nothing in the index, so no `TFile` is built
    // for it and no folder of the index's is created above it.
    if (isHidden(spec.path)) {
      specByPath.set(spec.path, spec)
      continue
    }
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
    create: 0,
    modify: 0,
    append: 0,
    written: 0,
    resolvedLinks: 0,
  }

  const addFile = (path: string): TFile => {
    const existing = byPath.get(path)
    if (existing) return existing

    const file = new TFile()
    file.path = path
    file.name = path.split('/').pop() ?? path
    const dot = file.name.lastIndexOf('.')
    file.basename = dot > 0 ? file.name.slice(0, dot) : file.name
    file.extension = dot > 0 ? file.name.slice(dot + 1) : ''

    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const parent = ensureFolder(parentPath)
    parent.children.push(file)
    file.parent = parent

    files.push(file)
    byPath.set(path, file)
    return file
  }

  const removeFile = (path: string): void => {
    disk.delete(path)
    const folder = folders.get(path)
    if (folder && path !== '') {
      for (const child of [...folder.children]) removeFile(child.path)
      folders.delete(path)
      if (folder.parent) {
        const idx = folder.parent.children.indexOf(folder)
        if (idx !== -1) folder.parent.children.splice(idx, 1)
      }
      return
    }
    const file = byPath.get(path)
    if (!file) return
    byPath.delete(path)
    rawByPath.delete(path)
    binByPath.delete(path)
    const at = files.indexOf(file)
    if (at !== -1) files.splice(at, 1)
    if (file.parent) {
      const idx = file.parent.children.indexOf(file)
      if (idx !== -1) file.parent.children.splice(idx, 1)
    }
  }

  const resolveLink = (linkpath: string, sourcePath = ''): TFile | null => {
    // A bare name with several notes of that name: Obsidian takes the one beside the note the
    // link is written in, even over one at the vault root.
    if (sourcePath && !linkpath.includes('/')) {
      const name = linkpath.endsWith('.md') ? linkpath.slice(0, -3) : linkpath
      const same = byBasename.get(name) ?? []
      if (same.length > 1) {
        const folder = sourcePath.includes('/')
          ? sourcePath.slice(0, sourcePath.lastIndexOf('/'))
          : ''
        const near = same.filter((f) => f.path === (folder ? `${folder}/${f.name}` : f.name))
        if (near.length === 1) return near[0]
      }
    }
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
    // `![[poster.jpg]]` names an attachment by its file name, extension and all, and
    // Obsidian finds it in whichever folder it sits in. Same shortest-path rule as above.
    const named = files.filter((f) => f.name === linkpath || f.path.endsWith('/' + linkpath))
    if (named.length === 1) return named[0]

    return null
  }

  // Caches derived once, mirroring Obsidian's own precomputed metadata.
  const cacheByPath = new Map<string, FakeFileCache>()
  const rawByPath = new Map<string, string>()
  /** Bytes of files written as binaries, for the tests that read them back. */
  const binByPath = new Map<string, ArrayBuffer>()
  /** Files written through the adapter alone, which the vault index never lists. */
  const hidden = new Map<string, string>()
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
    const raw = spec.raw ?? `${yaml}${spec.content ?? ''}`
    const entry = {
      bytes: encoder.encode(raw),
      ctime: spec.ctime ?? 0,
      mtime: spec.mtime ?? 0,
    }
    ensureDiskFolders(spec.path)
    if (isHidden(spec.path)) {
      disk.set(spec.path, entry)
    } else {
      // A visible file keeps its bytes in the text store alone, so a `vault.modify` in a test
      // is seen by the adapter too; `entryAt` renders them when the adapter asks.
      rawByPath.set(spec.path, raw)
      const file = byPath.get(spec.path)
      if (file) file.stat = { ctime: entry.ctime, mtime: entry.mtime, size: entry.bytes.byteLength }
    }

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
  const byRef = new Map<string, { key: string; callback: (...args: unknown[]) => void }>()
  let handlerId = 0

  const register =
    (scope: string) =>
    (name: string, callback: (...args: unknown[]) => void): { id: string } => {
      const key = `${scope}:${name}`
      const bucket = handlers.get(key)
      if (bucket) bucket.push(callback)
      else handlers.set(key, [callback])
      const id = `${key}#${handlerId++}`
      byRef.set(id, { key, callback })
      return { id }
    }

  /**
   * Unregistering for real. Most tests build a fresh app per case and never need it, but code
   * that stops watching — the sync filesystem adapter does — is only honest about having
   * stopped if the handler is actually gone.
   */
  const offref = (ref: { id: string }): void => {
    const held = byRef.get(ref?.id)
    if (!held) return
    byRef.delete(ref.id)
    const bucket = handlers.get(held.key)
    if (!bucket) return
    const at = bucket.indexOf(held.callback)
    if (at !== -1) bucket.splice(at, 1)
  }

  const localStore = new Map<string, unknown>()

  /**
   * Moves a file or folder in place, the way Obsidian does: the same `TFile` keeps working at
   * its new path, and its metadata and links move with it.
   */
  const moveEntry = (entry: TAbstractFile, to: string): void => {
    const from = entry.path
    if (entry instanceof TFolder) {
      const children = [...entry.children]
      folders.delete(from)
      if (entry.parent) {
        const idx = entry.parent.children.indexOf(entry)
        if (idx !== -1) entry.parent.children.splice(idx, 1)
      }
      entry.path = to
      entry.name = to.split('/').pop() ?? to
      const parent = ensureFolder(to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '')
      parent.children.push(entry)
      entry.parent = parent
      folders.set(to, entry)
      entry.children = []
      for (const child of children) {
        const childTo = `${to}/${child.name}`
        child.parent = entry
        entry.children.push(child)
        if (child instanceof TFolder) {
          entry.children.pop()
          moveEntry(child, childTo)
        } else {
          entry.children.pop()
          moveEntry(child, childTo)
        }
      }
      return
    }
    const file = entry as TFile
    const body = rawByPath.get(from)
    const bytes = binByPath.get(from)
    byPath.delete(from)
    rawByPath.delete(from)
    binByPath.delete(from)
    if (file.parent) {
      const idx = file.parent.children.indexOf(file)
      if (idx !== -1) file.parent.children.splice(idx, 1)
    }

    file.path = to
    file.name = to.split('/').pop() ?? to
    const dot = file.name.lastIndexOf('.')
    file.basename = dot > 0 ? file.name.slice(0, dot) : file.name
    file.extension = dot > 0 ? file.name.slice(dot + 1) : ''

    const parent = ensureFolder(to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '')
    parent.children.push(file)
    file.parent = parent

    byPath.set(to, file)
    if (body !== undefined) rawByPath.set(to, body)
    if (bytes !== undefined) binByPath.set(to, bytes)

    // Obsidian carries the file's metadata and its place in the link index along with it,
    // so a question asked right after the rename is answered for the new path.
    const cached = cacheByPath.get(from)
    cacheByPath.delete(from)
    if (cached) cacheByPath.set(to, cached)
    if (resolvedLinks[from]) {
      resolvedLinks[to] = resolvedLinks[from]
      delete resolvedLinks[from]
    }
    for (const targets of Object.values(resolvedLinks)) {
      if (targets[from] === undefined) continue
      targets[to] = targets[from]
      delete targets[from]
    }
  }

  const bytesOf = (path: string): ArrayBuffer =>
    binByPath.get(path) ??
    new TextEncoder().encode(rawByPath.get(path) ?? hidden.get(path) ?? '').buffer

  const self = {
    loadLocalStorage(key: string) {
      return localStore.has(key) ? localStore.get(key) : null
    },
    saveLocalStorage(key: string, value: unknown) {
      localStore.set(key, value)
    },
    setFrontmatter(path: string, frontmatter: Record<string, unknown>) {
      const cached = cacheByPath.get(path)
      if (cached) cached.frontmatter = frontmatter
      else cacheByPath.set(path, { frontmatter, links: [], frontmatterLinks: [] })
    },
    emit(scope: 'vault' | 'metadataCache' | 'workspace', name: string, ...args: unknown[]) {
      for (const callback of [...(handlers.get(`${scope}:${name}`) ?? [])]) callback(...args)
    },
    vault: {
      on: register('vault'),
      offref,
      getResourcePath(file: TFile) { return `app://sample/${file.path}` },
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
      // Narrower than the above: a folder at this path is not a file, so it reads as absent.
      getFileByPath(path: string) {
        stats.getAbstractFileByPath++
        return byPath.get(path) ?? null
      },
      async read(file: TFile) {
        stats.read++
        return rawByPath.get(file.path) ?? ''
      },
      async cachedRead(file: TFile) {
        stats.read++
        return rawByPath.get(file.path) ?? ''
      },

      // ── Writing ──
      //
      // Enough to let code that persists into the vault run for real. Content is kept in the
      // same map `read` serves, so a test can save something and read it back.

      async create(path: string, content: string) {
        stats.create++
        stats.written += content.length
        const file = addFile(path)
        ensureDiskFolders(path)
        disk.delete(path)
        rawByPath.set(path, content)
        return file
      },
      /** A picture written whole: only that it exists and where matters to a test. */
      async createBinary(path: string, data: ArrayBuffer) {
        stats.create++
        stats.written += data.byteLength
        const file = addFile(path)
        rawByPath.set(path, new TextDecoder().decode(data))
        binByPath.set(path, data.slice(0))
        return file
      },
      async readBinary(file: TFile) {
        return bytesOf(file.path)
      },
      async modifyBinary(file: TFile, data: ArrayBuffer) {
        stats.modify++
        binByPath.set(file.path, data.slice(0))
      },
      async rename(file: TAbstractFile, to: string) {
        moveEntry(file, to)
      },
      async modify(file: TFile, content: string) {
        stats.modify++
        stats.written += content.length
        disk.delete(file.path)
        rawByPath.set(file.path, content)
      },
      /**
       * Obsidian's read-modify-write under one lock. Modelled because the tools that edit a
       * note someone may be typing into use it rather than read-then-modify.
       */
      async process(file: TFile, fn: (data: string) => string) {
        stats.modify++
        const next = fn(rawByPath.get(file.path) ?? '')
        stats.written += next.length
        disk.delete(file.path)
        rawByPath.set(file.path, next)
        return next
      },
      async append(file: TFile, data: string) {
        stats.append++
        stats.written += data.length
        const held =
          rawByPath.get(file.path) ?? decoder.decode(disk.get(file.path)?.bytes ?? new Uint8Array())
        disk.delete(file.path)
        rawByPath.set(file.path, held + data)
      },
      async createFolder(path: string) {
        ensureDiskFolder(path)
        return ensureFolder(path)
      },

      configDir: '.obsidian',

      /**
       * Obsidian's raw filesystem view: the whole disk, hidden folders included, and the only
       * way to reach a file the index does not show. Lookups fall back to a case-insensitive
       * match, the way a macOS or Windows volume does.
       */
      adapter: {
        async exists(path: string, sensitive = false) {
          if (sensitive)
            return disk.has(path) || byPath.has(path) || diskFolders.has(path) || folders.has(path)
          return actualPath(path) !== null || actualFolder(path) !== null
        },

        async stat(path: string) {
          const file = actualPath(path)
          if (file !== null) {
            const entry = entryAt(file)
            if (entry) {
              return {
                type: 'file' as const,
                ctime: entry.ctime,
                mtime: entry.mtime,
                size: entry.bytes.byteLength,
              }
            }
          }
          if (actualFolder(path) === null) return null
          return { type: 'folder' as const, ctime: 0, mtime: 0, size: 0 }
        },

        async list(path: string) {
          const folder = actualFolder(path)
          if (folder === null) throw new Error(`ENOENT: no such folder: ${path}`)
          const prefix = folder === '' ? '' : `${folder}/`
          const listedFiles = new Set<string>()
          const listedFolders = new Set<string>()
          const consider = (held: string, isFolder: boolean): void => {
            if (held === folder || !held.startsWith(prefix)) return
            const rest = held.slice(prefix.length)
            const cut = rest.indexOf('/')
            if (cut === -1) (isFolder ? listedFolders : listedFiles).add(held)
            else listedFolders.add(prefix + rest.slice(0, cut))
          }
          for (const held of disk.keys()) consider(held, false)
          for (const held of byPath.keys()) consider(held, false)
          for (const held of diskFolders) consider(held, true)
          for (const held of folders.keys()) consider(held, true)
          // Obsidian composes every name it lists, whatever the volume keeps underneath, so
          // a decomposed name on disk is listed composed and found again by `stat`.
          const composed = (held: string): string => held.normalize('NFC')
          return {
            files: [...listedFiles].map(composed),
            folders: [...listedFolders].map(composed),
          }
        },

        async readBinary(path: string) {
          const file = actualPath(path)
          const entry = file === null ? null : entryAt(file)
          if (!entry) throw new Error(`ENOENT: no such file: ${path}`)
          // A copy, so no caller can reach into the store through the array it was handed.
          const out = new ArrayBuffer(entry.bytes.byteLength)
          new Uint8Array(out).set(entry.bytes)
          return out
        },

        async writeBinary(
          path: string,
          data: ArrayBuffer,
          options?: { mtime?: number; ctime?: number }
        ) {
          if (actualFolder(path) !== null) throw new Error(`EISDIR: a folder is at ${path}`)
          const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
          if (actualFolder(parent) === null) throw new Error(`ENOENT: no such folder: ${parent}`)
          const standing = actualPath(path)
          const before = standing === null ? null : entryAt(standing)
          const stamp = diskClock++
          placeFile(standing ?? path, {
            bytes: new Uint8Array(data.slice(0)),
            ctime: options?.ctime ?? before?.ctime ?? stamp,
            mtime: options?.mtime ?? stamp,
          })
        },

        async rename(path: string, newPath: string) {
          const from = actualPath(path)
          if (from === null) throw new Error(`ENOENT: no such file: ${path}`)
          const entry = entryAt(from)
          if (!entry) throw new Error(`ENOENT: no such file: ${path}`)
          const parent = newPath.includes('/') ? newPath.slice(0, newPath.lastIndexOf('/')) : ''
          if (actualFolder(parent) === null) throw new Error(`ENOENT: no such folder: ${parent}`)
          // A rename onto another spelling of the same file takes the new spelling, which is
          // what APFS and NTFS do and what a case-only rename depends on.
          const onto = actualPath(newPath)
          if (onto !== null && onto !== from) throw new Error(`EEXIST: ${newPath} is taken`)
          removeFile(from)
          placeFile(newPath, entry)
        },

        async remove(path: string) {
          const file = actualPath(path)
          if (file === null) throw new Error(`ENOENT: no such file: ${path}`)
          removeFile(file)
        },

        async mkdir(path: string) {
          if (actualPath(path) !== null) throw new Error(`EEXIST: a file is at ${path}`)
          ensureDiskFolder(path)
          // A folder the index would show gets a `TFolder` too, the way Obsidian notices one.
          if (!isHidden(path)) ensureFolder(path)
        },

        async rmdir(path: string, recursive: boolean) {
          const folder = actualFolder(path)
          if (folder === null || folder === '') throw new Error(`ENOENT: no such folder: ${path}`)
          const prefix = `${folder}/`
          const inside = (held: string): boolean => held.startsWith(prefix)
          if (!recursive) throw new Error(`EISDIR: Path is a directory: rm returned EISDIR (${path})`)
          for (const file of [...disk.keys(), ...byPath.keys()].filter(inside)) removeFile(file)
          for (const gone of [folder, ...[...diskFolders].filter(inside)]) diskFolders.delete(gone)
          for (const gone of [folder, ...[...folders.keys()].filter(inside)]) {
            const node = folders.get(gone)
            folders.delete(gone)
            const siblings = node?.parent?.children
            const at = siblings?.indexOf(node as TFolder) ?? -1
            if (siblings && at !== -1) siblings.splice(at, 1)
          }
        },
      },
      async delete(file: TAbstractFile) {
        removeFile(file.path)
      },
      async trash(file: TAbstractFile) {
        removeFile(file.path)
      },
    },
    workspace: {
      on: register('workspace'),
      offref,
    },
    metadataCache: {
      on: register('metadataCache'),
      offref,
      getFileCache(file: TFile) {
        stats.getFileCache++
        return cacheByPath.get(file.path) ?? null
      },
      getFirstLinkpathDest(linkpath: string, sourcePath = '') {
        stats.getFirstLinkpathDest++
        return resolveLink(linkpath, sourcePath)
      },
      trigger() {
        // Obsidian fires metadata events here; nothing in these tests observes them.
      },
      get resolvedLinks() {
        stats.resolvedLinks++
        return resolvedLinks
      },
    },
    // Deletion goes through the file manager so it honours the user's "Deleted files"
    // preference. The fake has no preference to honour, so it just drops the file.
    fileManager: {
      async trashFile(file: TFile) {
        await self.vault.trash(file)
      },
      /**
       * Obsidian's frontmatter editor: the properties parsed, handed to `fn` to change in place,
       * and written back above the untouched body. Tests can hold persistence and cache
       * delivery separately; without a gate both retain their immediate default.
       */
      async processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void) {
        const writing = delays.take('frontmatter')
        if (writing) await writing
        stats.modify++
        const raw = rawByPath.get(file.path) ?? ''
        const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw)
        const frontmatter = ((match ? loadYaml(match[1]) : null) ?? {}) as Record<string, unknown>
        fn(frontmatter)
        const body = match ? raw.slice(match[0].length) : raw
        const head = Object.keys(frontmatter).length ? `---\n${dumpYaml(frontmatter)}---\n` : ''
        rawByPath.set(file.path, head + body)
        const publish = () => {
          const cached = cacheByPath.get(file.path)
          if (cached) cached.frontmatter = { ...frontmatter }
          else
            cacheByPath.set(file.path, {
              frontmatter: { ...frontmatter },
              links: [],
              frontmatterLinks: [],
            })
        }
        const metadata = delays.take('metadata')
        if (metadata) void metadata.then(publish)
        else publish()
      },
      /**
       * The real one also rewrites every link pointing at the file; nothing here needs that
       * yet. What it does need is the part that catches people out: Obsidian moves the file
       * *in place*, so everything already holding that `TFile` keeps working. A fake that
       * made a new one instead would leave every existing reference pointing at a ghost.
       */
      async renameFile(file: TFile, to: string) {
        // Through the vault, as Obsidian's own does — which is also what a wrapper around the
        // vault sees of it.
        await self.vault.rename(file, to)
      },
    },
    secretStorage: (() => {
      const secrets = new Map<string, string>()
      return {
        getSecret: (id: string) => secrets.get(id) ?? '',
        // Obsidian's own rule, which it enforces by throwing: an id is lowercase letters,
        // digits and dashes. A fake that took anything hid a calendar link that never saved.
        setSecret: (id: string, value: string) => {
          if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid secret ID: ${id}`)
          secrets.set(id, value)
        },
      }
    })(),
    delays,
    stats,
    resetStats() {
      stats.getFiles = 0
      stats.getMarkdownFiles = 0
      stats.create = 0
      stats.modify = 0
      stats.append = 0
      stats.written = 0
      stats.getFileCache = 0
      stats.getFirstLinkpathDest = 0
      stats.getAbstractFileByPath = 0
      stats.read = 0
      stats.resolvedLinks = 0
    },
  }
  return self
}
