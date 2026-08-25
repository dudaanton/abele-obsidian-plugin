import { ref, computed } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile, TFolder } from 'obsidian'
import { isWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'

export interface ScopeEntry {
  type: 'file' | 'folder' | 'pattern' | 'group'
  path: string
}

/**
 * Manages the virtual filesystem scope for the AI agent.
 * All file operations are restricted to resolved scope paths.
 */
export class ScopeResolver {
  private static instance: ScopeResolver | null = null
  private static activeOverride: ScopeResolver | null = null

  public readonly entries = ref<ScopeEntry[]>([])
  public readonly fullVaultAccess = ref(false)

  /** Cached resolved paths — invalidated on scope change */
  private _cache: Set<string> | null = null

  /**
   * Set the active session's scope resolver so that tools calling
   * ScopeResolver.getInstance() resolve to the correct session's scope.
   */
  static setActiveInstance(resolver: ScopeResolver | null): void {
    ScopeResolver.activeOverride = resolver
  }

  static getInstance(): ScopeResolver {
    if (ScopeResolver.activeOverride) return ScopeResolver.activeOverride
    if (!ScopeResolver.instance) {
      ScopeResolver.instance = new ScopeResolver()
    }
    return ScopeResolver.instance
  }

  /** Summary for display: "2 files, 1 folder" */
  public readonly summary = computed(() => {
    if (this.fullVaultAccess.value) return 'Full vault'
    const e = this.entries.value
    if (e.length === 0) return 'No files'
    const files = e.filter((x) => x.type === 'file').length
    const folders = e.filter((x) => x.type === 'folder').length
    const patterns = e.filter((x) => x.type === 'pattern').length
    const groups = e.filter((x) => x.type === 'group').length
    const parts: string[] = []
    if (files) parts.push(`${files} file${files > 1 ? 's' : ''}`)
    if (folders) parts.push(`${folders} folder${folders > 1 ? 's' : ''}`)
    if (patterns) parts.push(`${patterns} pattern${patterns > 1 ? 's' : ''}`)
    if (groups) parts.push(`${groups} group${groups > 1 ? 's' : ''}`)
    return parts.join(', ')
  })

  /** Short preview: first 2 names */
  public readonly preview = computed(() => {
    if (this.fullVaultAccess.value) return 'Full vault access'
    const e = this.entries.value
    if (e.length === 0) return ''
    const names = e.slice(0, 2).map((x) => x.path.split('/').pop() || x.path)
    const rest = e.length - 2
    return rest > 0 ? `${names.join(', ')} +${rest}` : names.join(', ')
  })

  // ── Mutations ──

  addFile(path: string): void {
    if (!this.entries.value.some((e) => e.type === 'file' && e.path === path)) {
      this.entries.value = [...this.entries.value, { type: 'file', path }]
      this._cache = null
    }
  }

  addFolder(path: string): void {
    const normalized = path.replace(/\/+$/, '')
    if (!this.entries.value.some((e) => e.type === 'folder' && e.path === normalized)) {
      this.entries.value = [...this.entries.value, { type: 'folder', path: normalized }]
      this._cache = null
    }
  }

  addPattern(pattern: string): void {
    if (!this.entries.value.some((e) => e.type === 'pattern' && e.path === pattern)) {
      this.entries.value = [...this.entries.value, { type: 'pattern', path: pattern }]
      this._cache = null
    }
  }

  addGroup(path: string): void {
    if (!this.entries.value.some((e) => e.type === 'group' && e.path === path)) {
      this.entries.value = [...this.entries.value, { type: 'group', path }]
      this._cache = null
    }
  }

  remove(entry: ScopeEntry): void {
    this.entries.value = this.entries.value.filter(
      (e) => !(e.type === entry.type && e.path === entry.path)
    )
    this._cache = null
  }

  clear(): void {
    this.entries.value = []
    this.fullVaultAccess.value = false
    this._cache = null
  }

  setFullVaultAccess(value: boolean): void {
    this.fullVaultAccess.value = value
    this._cache = null
  }

  // ── Resolution ──

  /** Resolve all scope entries to a set of file paths */
  resolve(): Set<string> {
    if (this._cache) return this._cache

    const { app } = GlobalStore.getInstance()
    const result = new Set<string>()

    if (this.fullVaultAccess.value) {
      for (const file of app.vault.getFiles()) {
        result.add(file.path)
      }
      this._cache = result
      return result
    }

    // Built at most once per resolve() and shared by every group entry — see buildGroupIndex.
    let groupIndex: Map<string, string[]> | null = null

    for (const entry of this.entries.value) {
      switch (entry.type) {
        case 'file': {
          result.add(entry.path)
          break
        }
        case 'folder': {
          this.resolveFolder(entry.path, result)
          break
        }
        case 'pattern': {
          const regex = this.patternToRegex(entry.path)
          for (const file of app.vault.getFiles()) {
            if (regex.test(file.path)) result.add(file.path)
          }
          break
        }
        case 'group': {
          groupIndex ??= this.buildGroupIndex()
          this.resolveGroup(entry.path, result, groupIndex)
          break
        }
      }
    }

    this._cache = result
    return result
  }

  /** Check if a file path is within scope */
  isInScope(path: string): boolean {
    if (this.fullVaultAccess.value) return true
    return this.resolve().has(path)
  }

  /** Check if a folder is within scope (any file inside it is in scope) */
  isFolderInScope(folderPath: string): boolean {
    if (this.fullVaultAccess.value) return true
    const normalized = folderPath.replace(/\/+$/, '')
    // Direct folder entry
    if (this.entries.value.some((e) => e.type === 'folder' && e.path === normalized)) return true
    // Parent folder entry
    if (this.entries.value.some((e) => e.type === 'folder' && normalized.startsWith(e.path + '/')))
      return true
    // Any resolved file under this folder
    for (const p of this.resolve()) {
      if (p.startsWith(normalized + '/')) return true
    }
    return false
  }

  /** Get all accessible file paths as array (for agent's list_workspace tool) */
  getAccessiblePaths(): string[] {
    return [...this.resolve()].sort()
  }

  /** Filter paths to only those in scope */
  filterInScope(paths: string[]): string[] {
    if (this.fullVaultAccess.value) return paths
    const resolved = this.resolve()
    return paths.filter((p) => resolved.has(p))
  }

  /** Invalidate cache (call after vault changes) */
  invalidate(): void {
    this._cache = null
  }

  // ── Internals ──

  private resolveFolder(folderPath: string, result: Set<string>): void {
    const { app } = GlobalStore.getInstance()
    const folder = app.vault.getAbstractFileByPath(folderPath)
    if (!(folder instanceof TFolder)) return

    for (const child of folder.children) {
      if (child instanceof TFile) {
        result.add(child.path)
      } else if (child instanceof TFolder) {
        this.resolveFolder(child.path, result)
      }
    }
  }

  /**
   * Builds a reverse index of group membership: group note path -> paths of the notes that
   * name it in their `groups` frontmatter.
   *
   * One pass over the vault answers the membership question for every group at once, which
   * is what keeps group resolution linear in vault size. Walking the vault per group node
   * instead — as this used to — costs (nodes in the group tree) x (notes with a `groups`
   * property); on a 37k-file vault that was around 22 million link resolutions and blocked
   * the main thread for well over a minute.
   *
   * Obsidian's `resolvedLinks` is deliberately not used as the source here: it records that
   * one note links to another, not which property produced the link, so a note merely
   * mentioning a group note in its body would be indexed as a member of it.
   */
  private buildGroupIndex(): Map<string, string[]> {
    const { app } = GlobalStore.getInstance()
    const index = new Map<string, string[]>()

    for (const file of app.vault.getFiles()) {
      const groups = app.metadataCache.getFileCache(file)?.frontmatter?.groups
      if (!Array.isArray(groups)) continue

      for (const group of groups) {
        if (!isWikilink(group)) continue

        const linkpath = wikilinkToPath(group)
        if (!linkpath) continue

        const dest = app.metadataCache.getFirstLinkpathDest(linkpath, file.path)
        if (!dest) continue

        const members = index.get(dest.path)
        if (members) members.push(file.path)
        else index.set(dest.path, [file.path])
      }
    }

    return index
  }

  /**
   * Resolve all notes belonging to a group (notes that reference the group note
   * via `groups` property, recursively down the tree).
   */
  private resolveGroup(groupPath: string, result: Set<string>, index: Map<string, string[]>): void {
    const { app } = GlobalStore.getInstance()
    const visited = new Set<string>()
    const pending = [groupPath]

    // Iterative rather than recursive: a group tree can be thousands of nodes deep-ish and
    // wide, and this runs synchronously on the agent's tool-call path.
    while (pending.length > 0) {
      const current = pending.pop()
      if (visited.has(current)) continue
      visited.add(current)

      const file = app.vault.getAbstractFileByPath(current)
      if (file instanceof TFile) {
        result.add(file.path)
      }

      // Every member is itself a potential group for further notes.
      for (const member of index.get(current) ?? []) {
        if (!visited.has(member)) pending.push(member)
      }
    }
  }

  /** Resolve a group entry and return just its paths (for preview) */
  resolveGroupPaths(groupPath: string): string[] {
    const result = new Set<string>()
    this.resolveGroup(groupPath, result, this.buildGroupIndex())
    return [...result].sort()
  }

  destroy(): void {
    this.clear()
    ScopeResolver.instance = null
  }

  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*')
      .replace(/\\\?/g, '[^/]')
    return new RegExp(`^${escaped}$`, 'i')
  }
}
