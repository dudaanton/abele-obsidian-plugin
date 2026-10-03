/** Storage-independent index of exact note types and effective journal days. */
export interface IndexedNote {
  path: string
  type: unknown
  day: string | null
}
export class NoteTypeIndex {
  readonly notes = new Map<string, IndexedNote>()
  private readonly types = new Map<string, Set<string>>()
  private readonly days = new Map<string, Set<string>>()
  private put(map: Map<string, Set<string>>, key: string, path: string) {
    let paths = map.get(key)
    if (!paths) map.set(key, (paths = new Set()))
    paths.add(path)
  }
  remove(path: string): IndexedNote | undefined {
    const before = this.notes.get(path)
    if (!before) return
    if (typeof before.type === 'string') {
      const paths = this.types.get(before.type)
      paths?.delete(path)
      if (!paths?.size) this.types.delete(before.type)
    }
    if (before.day) {
      const paths = this.days.get(before.day)
      paths?.delete(path)
      if (!paths?.size) this.days.delete(before.day)
    }
    this.notes.delete(path)
    return before
  }
  upsert(note: IndexedNote): IndexedNote | undefined {
    const before = this.remove(note.path)
    this.notes.set(note.path, note)
    if (typeof note.type === 'string') this.put(this.types, note.type, note.path)
    if (note.day) this.put(this.days, note.day, note.path)
    return before
  }
  pathsOfType(type: string): ReadonlySet<string> {
    return this.types.get(type) ?? new Set()
  }
  pathsOnDay(day: string): ReadonlySet<string> {
    return this.days.get(day) ?? new Set()
  }
}
