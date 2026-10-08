/** Plain identity data; the adapter supplies storage and file existence, never sessions. */
export interface DiscussionIdentityData {
  kind?: string
  anchor?: unknown
  commentId?: string
  commentLocation?: string
}
export interface DiscussionIdentityHost {
  exists(path: string): boolean
  markerPath(id: string): string
  freshId(): string
  read(): unknown
  write(locations: Record<string, string>): void
}
const basename = (path: string) =>
  path
    .split('/')
    .pop()!
    .replace(/\.abchat$/, '')
const isDiscussion = (data: DiscussionIdentityData) =>
  data.kind === 'comment' || !!data.anchor || !!data.commentId

/** An ID owns its recorded path; aliases never shadow a directly owned ID. */
export class DiscussionIdentityResolver {
  private readonly locations = new Map<string, string>()
  private readonly paths = new Map<string, string>()
  constructor(private readonly host: DiscussionIdentityHost) {
    const saved = host.read()
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [id, path] of Object.entries(saved))
        if (typeof path === 'string') {
          this.locations.set(id, path)
          this.paths.set(path, id)
        }
    }
  }
  canonicalId(name: string): string {
    if (this.locations.has(name)) return name
    const owners = [...this.locations].filter(([, path]) => basename(path) === name)
    return owners.length === 1 ? owners[0][0] : name
  }
  pathForId(name: string): string {
    return this.locations.get(this.canonicalId(name)) ?? this.host.markerPath(name)
  }
  idForPath(path: string): string | undefined {
    return this.paths.get(path)
  }
  private bind(id: string, path: string): void {
    if (this.locations.get(id) === path && this.paths.get(path) === id) return
    const oldPath = this.locations.get(id)
    if (oldPath && this.paths.get(oldPath) === id) this.paths.delete(oldPath)
    this.locations.set(id, path)
    this.paths.set(path, id)
    this.host.write(Object.fromEntries(this.locations))
  }
  /** Run before load/restore can save a migration, and on discovery before publishing it. */
  resolve(path: string, data: DiscussionIdentityData): string | undefined {
    if (!isDiscussion(data)) return undefined
    const assigned = this.paths.get(path)
    if (assigned) return assigned
    const requested = data.commentId ?? basename(path)
    let ownerPath = this.locations.get(requested)
    if (!ownerPath || !this.host.exists(ownerPath)) {
      const declared = data.commentLocation
      const marker = this.host.markerPath(requested)
      ownerPath =
        declared && this.host.exists(declared) ? declared : this.host.exists(marker) ? marker : path
      this.bind(requested, ownerPath)
    }
    if (ownerPath === path) return requested
    let id = this.host.freshId()
    while (this.locations.has(id)) id = this.host.freshId()
    this.bind(id, path)
    return id
  }
  rename(oldPath: string, path: string, data: DiscussionIdentityData): string | undefined {
    if (!isDiscussion(data)) return undefined
    const id = this.paths.get(oldPath) ?? data.commentId ?? basename(oldPath)
    const ownerPath = this.locations.get(id)
    // An unrelated copied identity is resolved at its own path, never by its basename.
    if (ownerPath && ownerPath !== oldPath && ownerPath !== path && this.host.exists(ownerPath))
      return this.resolve(path, data)
    this.paths.delete(oldPath)
    this.bind(id, path)
    return id
  }
  remove(path: string): string[] {
    const ids = [...this.locations].filter(([, location]) => location === path).map(([id]) => id)
    this.paths.delete(path)
    for (const id of ids) this.locations.delete(id)
    if (ids.length) this.host.write(Object.fromEntries(this.locations))
    return ids
  }
}
