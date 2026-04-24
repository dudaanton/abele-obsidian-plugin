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

  public readonly entries = ref<ScopeEntry[]>([])
  public readonly fullVaultAccess = ref(false)

  /** Cached resolved paths — invalidated on scope change */
  private _cache: Set<string> | null = null

  static getInstance(): ScopeResolver {
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
          this.resolveGroup(entry.path, result)
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
   * Resolve all notes belonging to a group (notes that reference the group note
   * via `groups` property, recursively down the tree).
   */
  private resolveGroup(groupPath: string, result: Set<string>, visited = new Set<string>()): void {
    if (visited.has(groupPath)) return
    visited.add(groupPath)

    const { app } = GlobalStore.getInstance()
    const groupFile = app.vault.getAbstractFileByPath(groupPath)
    if (groupFile instanceof TFile) {
      result.add(groupFile.path)
    }

    // Find all notes that have this group in their `groups` frontmatter
    for (const file of app.vault.getFiles()) {
      if (visited.has(file.path)) continue
      const cache = app.metadataCache.getFileCache(file)
      const groups = cache?.frontmatter?.groups
      if (!Array.isArray(groups)) continue

      for (const group of groups) {
        const linkPath = isWikilink(group)
          ? app.metadataCache.getFirstLinkpathDest(wikilinkToPath(group), file.path)?.path
          : null
        if (linkPath && linkPath === groupPath) {
          result.add(file.path)
          // Recurse: this note might also be a group for other notes
          this.resolveGroup(file.path, result, visited)
          break
        }
      }
    }
  }

  /** Resolve a group entry and return just its paths (for preview) */
  resolveGroupPaths(groupPath: string): string[] {
    const result = new Set<string>()
    this.resolveGroup(groupPath, result)
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
