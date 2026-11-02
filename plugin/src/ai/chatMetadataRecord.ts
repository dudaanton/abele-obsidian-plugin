import type { ChatMetadata } from './types'

/** A bounded, per-read cache, never a cache of transcripts or historical snapshots. */
export class MetadataRecordReader {
  private fields = new Map<string, { raw: string; value: unknown }>()
  private attention = new Map<string, { raw: string; value: unknown }>()

  read(line: string): Record<string, unknown> {
    try {
      return this.object(line, this.fields)
    } catch {
      // Preserve the original JSON parser's validation and damaged-line semantics.
      // Failed lines cannot seed the next line's cache.
      this.fields.clear()
      this.attention.clear()
      return JSON.parse(line) as Record<string, unknown>
    }
  }

  private object(
    raw: string,
    cache: Map<string, { raw: string; value: unknown }>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null)
    let at = 0
    const whitespace = () => {
      while (at < raw.length && /[\x20\t\r\n]/.test(raw[at])) at++
    }
    // Retain at most one object's fields, including when unknown keys rotate over time.
    const finish = () => {
      for (const key of cache.keys()) if (!Object.hasOwn(result, key)) cache.delete(key)
      return result
    }
    whitespace()
    if (raw[at++] !== '{') throw new Error('Invalid metadata object')
    whitespace()
    if (raw[at] === '}') {
      at++
      whitespace()
      if (at !== raw.length) throw new Error('Trailing metadata')
      return finish()
    }
    while (at < raw.length) {
      const startKey = at
      if (raw[at++] !== '"') throw new Error('Invalid metadata key')
      while (at < raw.length) {
        if (raw[at] === '\\') at += 2
        else if (raw[at++] === '"') break
      }
      const key = JSON.parse(raw.slice(startKey, at)) as string
      whitespace()
      if (raw[at++] !== ':') throw new Error('Invalid metadata separator')
      whitespace()
      const start = at
      let depth = 0,
        string = false
      for (; at < raw.length; at++) {
        const char = raw[at]
        if (string) {
          if (char === '\\') at++
          else if (char === '"') string = false
          continue
        }
        if (char === '"') string = true
        else if (char === '{' || char === '[') depth++
        else if (char === '}' || char === ']') {
          if (depth === 0) break
          depth--
        } else if (char === ',' && depth === 0) break
      }
      const valueRaw = raw.slice(start, at).replace(/[\x20\t\r\n]+$/, '')
      const previous = cache.get(key)
      let value: unknown
      if (previous?.raw === valueRaw) value = previous.value
      else if (key === 'attention' && valueRaw.startsWith('{'))
        value = this.object(valueRaw, this.attention)
      else if (
        key === 'resolved' &&
        previous &&
        Array.isArray(previous.value) &&
        previous.raw.endsWith(']') &&
        valueRaw.startsWith(previous.raw.slice(0, -1)) &&
        valueRaw[previous.raw.length - 1] === ','
      ) {
        // Old writers repeat the growing terminal ledger on every checkpoint. Parse only
        // the added suffix; the complete old prefix was already validated by JSON.parse.
        const added = JSON.parse('[' + valueRaw.slice(previous.raw.length)) as unknown[]
        value = [...previous.value, ...added]
      } else value = JSON.parse(valueRaw)
      cache.set(key, { raw: valueRaw, value })
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      })
      whitespace()
      if (raw[at] === '}') {
        at++
        whitespace()
        if (at !== raw.length) throw new Error('Trailing metadata')
        return finish()
      }
      if (raw[at++] !== ',') throw new Error('Invalid metadata delimiter')
      whitespace()
    }
    throw new Error('Unterminated metadata')
  }
}

/** Delta records use the existing meta envelope, with an explicit operation discriminator.
 * Full snapshots remain the recovery/compaction format. null is an ordinary value; removals
 * are explicit so optional fields can be cleared without losing older attention evidence. */
export function metadataDelta(current: ChatMetadata, previous: ChatMetadata): string {
  const set: Record<string, unknown> = Object.create(null)
  const remove: string[] = []
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    const a = previous[key as keyof ChatMetadata]
    const b = current[key as keyof ChatMetadata]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    if (b === undefined) remove.push(key)
    else if (key === 'attention' && b && typeof b === 'object') {
      const before = previous.attention ?? {}
      const after = current.attention!
      const fields: Record<string, unknown> = Object.create(null)
      const removed: string[] = []
      for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const oldValue = before[name as keyof typeof before]
        const newValue = after[name as keyof typeof after]
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue
        if (newValue === undefined) removed.push(name)
        else if (name === 'resolved') {
          const known = new Set(before.resolved ?? [])
          fields.resolved = (after.resolved ?? []).filter((id) => !known.has(id))
        } else fields[name] = newValue
      }
      set.attention = { set: fields, remove: removed }
    } else set[key] = b
  }
  return JSON.stringify({ v: 2, k: 'meta-delta', delta: { set, remove } }) + '\n'
}

function validatedChange(value: unknown): { set: Record<string, unknown>; remove: string[] } {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v)
  if (
    !object(value) ||
    !object(value.set) ||
    !Array.isArray(value.remove) ||
    !value.remove.every((key) => typeof key === 'string')
  )
    throw new Error('Invalid metadata delta')
  return { set: value.set, remove: value.remove as string[] }
}

export function applyMetadataRecord(
  record: Record<string, unknown>,
  previous: ChatMetadata | null
): ChatMetadata {
  if (record.k !== 'meta-delta' && !Object.hasOwn(record, 'delta')) {
    const { k, v, ...metadata } = record
    void k
    void v
    return metadata as unknown as ChatMetadata
  }
  if (!previous) throw new Error('Metadata delta requires a snapshot')
  const delta = validatedChange(record.delta)
  if (delta.set.attention !== undefined) {
    const attention = validatedChange(delta.set.attention)
    if (
      attention.set.resolved !== undefined &&
      (!Array.isArray(attention.set.resolved) ||
        !attention.set.resolved.every((id) => typeof id === 'string'))
    )
      throw new Error('Invalid resolved metadata')
  }
  const next = { ...previous, ...delta.set } as unknown as Record<string, unknown>
  for (const key of delta.remove) delete next[key]
  if (delta.set.attention) {
    const change = delta.set.attention as { set: Record<string, unknown>; remove: string[] }
    const attention = { ...previous?.attention, ...change.set } as Record<string, unknown>
    for (const key of change.remove) delete attention[key]
    if (change.set.resolved)
      attention.resolved = [
        ...new Set([
          ...(previous?.attention?.resolved ?? []),
          ...(change.set.resolved as string[]),
        ]),
      ]
    next.attention = attention
  }
  return next as unknown as ChatMetadata
}
