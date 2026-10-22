/** Record deltas are computed against this host's view, never against another host's rows. */
export interface HostRecord {
  namespace: string
  key: string
  id: string
  value: unknown
  order: number
}
export interface HostChange {
  key: string
  id: string
  before: unknown
  after: unknown
}
const HEADER = '!header'
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function splitHostValue(key: string, value: unknown): Map<string, unknown> {
  const rows = new Map<string, unknown>()
  if (
    Array.isArray(value) &&
    (key === 'abele-sync-writes' || key === 'abele-sync-recovered-writes')
  ) {
    for (const entry of value) {
      if (!object(entry)) throw new Error('Invalid host journal entry')
      const id =
        'entry:' + JSON.stringify([entry.owner ?? null, entry.temp ?? entry.backup ?? entry.target])
      if (rows.has(id)) throw new Error('Duplicate host journal identity')
      rows.set(id, entry)
    }
    rows.set(HEADER, { kind: 'array' })
  } else if (object(value)) {
    const header = { ...value }
    for (const field of ['records', 'cleanup', 'connections']) {
      if (!Array.isArray(value[field])) continue
      for (const entry of value[field]) {
        if (!object(entry) || typeof entry.id !== 'string')
          throw new Error('Invalid host record identity')
        const id = field + ':' + entry.id
        if (rows.has(id)) throw new Error('Duplicate host record identity')
        rows.set(id, entry)
      }
      header[field] = []
    }
    rows.set(HEADER, { kind: 'document', value: header })
  } else rows.set(HEADER, { kind: 'value', value })
  return rows
}

export function joinHostValue(rows: readonly HostRecord[]): unknown {
  const header = rows.find((row) => row.id === HEADER)?.value
  if (!object(header)) throw new Error('Sync host record header is missing')
  const entries = rows.filter((row) => row.id !== HEADER).sort((a, b) => a.order - b.order)
  if (header.kind === 'array' || entries.some((row) => row.id.startsWith('entry:')))
    return entries.map((row) => row.value)
  if (header.kind === 'document' && object(header.value)) {
    const value = { ...header.value }
    for (const field of ['records', 'cleanup', 'connections']) {
      const items = entries.filter((row) => row.id.startsWith(field + ':')).map((row) => row.value)
      if (items.length || Array.isArray(value[field])) value[field] = items
    }
    return value
  }
  return header.value
}

/** Derive container metadata from the records that actually survived this transaction. */
export function normalizeHostHeader(
  key: string,
  rows: Map<string, HostRecord>
): HostRecord | undefined {
  const header = rows.get(HEADER)
  if (!header || !object(header.value)) return
  if (key === 'abele-sync-writes' || key === 'abele-sync-recovered-writes') {
    if (
      header.value.kind !== 'array' &&
      [...rows.values()].some((row) => row.id.startsWith('entry:'))
    )
      return { ...header, value: { kind: 'array' } }
    return
  }
  if (key !== 'abele-sync-connections-v2' && key !== 'abele-sync-item-connections-v1') return
  if (header.value.kind !== 'document' || !object(header.value.value)) return
  const records = [...rows.values()]
    .filter((row) => row.id.startsWith('records:'))
    .sort((a, b) => a.order - b.order)
  const selected = header.value.value.selectedId
  if (records.some((row) => object(row.value) && row.value.id === selected)) return
  const first = records[0]?.value
  return {
    ...header,
    value: {
      ...header.value,
      value: { ...header.value.value, selectedId: object(first) ? first.id : '' },
    },
  }
}

export function hostChanges(key: string, before: unknown, after: unknown): HostChange[] {
  const prior = splitHostValue(key, before),
    next = splitHostValue(key, after)
  return [...new Set([...prior.keys(), ...next.keys()])]
    .filter((id) => !equal(prior.get(id), next.get(id)))
    .map((id) => ({ key, id, before: prior.get(id), after: next.get(id) }))
}

export function mergeHostChange(change: HostChange, current: unknown): unknown {
  // Independent first item enrollments do not need to fight over the initial selection.
  if (
    change.key === 'abele-sync-item-selection-v1' &&
    object(change.before) &&
    object(current) &&
    change.before.value == null &&
    current.value != null
  )
    return current
  return mergeHostValue(change.before, change.after, current)
}

/** Three-way field merge: a stale host cannot recreate a deleted record or erase a new one. */
export function mergeHostValue(before: unknown, after: unknown, current: unknown): unknown {
  if (equal(before, after)) return current
  if (equal(current, after) || equal(current, before)) return after
  if (
    object(before) &&
    object(after) &&
    object(current) &&
    before.kind === 'value' &&
    before.value == null &&
    after.kind === 'document' &&
    current.kind === 'document'
  )
    before = { kind: 'document', value: {} }
  if (object(before) && object(after) && object(current)) {
    const result = { ...current }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      // Concurrent first enrollments may each select themselves; keep the established selection.
      if (key === 'selectedId' && !before[key] && current[key]) continue
      const value = mergeHostValue(before[key], after[key], current[key])
      if (value === undefined) delete result[key]
      else result[key] = value
    }
    return result
  }
  throw new Error('Concurrent sync host record changed; retry from committed state')
}
