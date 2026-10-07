/** Pending settings edits are field patches, not another whole copy of the settings file. */
interface Edit {
  path: string[]
  value: unknown
}

export const settingsSnapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export class SettingsEdits {
  private edits = new Map<string, Edit>()
  private readers = 0
  private acknowledged = new Map<string, Edit>()

  /** A read already in flight may return an older copy than a save finishing meanwhile. */
  beginRead(): () => void {
    this.readers++
    let active = true
    return () => {
      if (!active) return
      active = false
      this.readers--
      this.clearAcknowledged()
    }
  }

  private clearAcknowledged(): void {
    if (this.readers) return
    for (const [key, edit] of this.acknowledged) {
      if (this.edits.get(key) === edit) this.edits.delete(key)
    }
    this.acknowledged.clear()
  }

  record(before: unknown, after: unknown, path: string[] = []): void {
    if (object(before) && object(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        this.record(before[key], after[key], [...path, key])
      }
      return
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return
    this.recordPatch(path, after)
  }

  /** A known field change captured from a direct save request, including deletion. */
  recordPatch(path: string[], value: unknown): void {
    const key = JSON.stringify(path)
    // A changed parent replaces any earlier patches below it.
    for (const [id, edit] of this.edits) {
      if (path.every((part, index) => edit.path[index] === part)) this.edits.delete(id)
    }
    this.edits.set(key, {
      path: [...path],
      value: value === undefined ? undefined : settingsSnapshot(value),
    })
  }

  /** A save completed while a native settings read could still return its older snapshot. */
  hasAcknowledged(): boolean {
    return this.acknowledged.size > 0
  }

  /** The screen still owes its debounced save for this field. */
  pending(path: string[]): boolean {
    return [...this.edits.values()].some((edit) => edit.path.every((part, at) => path[at] === part))
  }

  apply<T>(settings: T): T {
    const merged = settingsSnapshot(settings)
    for (const { path, value } of this.edits.values()) {
      let target = merged as Record<string, unknown>
      for (const part of path.slice(0, -1)) {
        if (!object(target[part])) target[part] = {}
        target = target[part] as Record<string, unknown>
      }
      const key = path[path.length - 1]
      if (value === undefined) delete target[key]
      else target[key] = settingsSnapshot(value)
    }
    return merged
  }

  /** Clear only edits carried by this write; newer edits may have arrived while it awaited IO. */
  written(): () => void {
    const written = new Map(this.edits)
    return () => {
      for (const [key, edit] of written) this.acknowledged.set(key, edit)
      // Keep successful writes protected until all older reads have merged their patches.
      this.clearAcknowledged()
    }
  }
}
