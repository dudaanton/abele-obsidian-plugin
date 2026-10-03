import type { CommitOp } from '@abele/sync-protocol'
import type { PushUnit } from './publicationIntents'
export interface StoredOwnerUnit {
  r: string
  o: CommitOp[] | [number, unknown[]][]
  c: Record<number, string>
  /** Ordered key dictionaries preserve the original JSON operation field order. */
  k?: string[][]
  /** Fixed-size selection bitmap reserved at preparation, not another operation copy. */
  m: string
  b: boolean
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
export function ownerSubsetIndices(prepared: PushUnit, actual: PushUnit): number[] {
  if (prepared.requestId !== actual.requestId || !actual.ops.length)
    throw new Error('Invalid submitted publication unit')
  let next = 0
  const selected: number[] = []
  for (const [index, op] of actual.ops.entries()) {
    const found = prepared.ops.findIndex(
      (candidate, at) =>
        at >= next &&
        JSON.stringify(candidate) === JSON.stringify(op) &&
        (op.op !== 'create' || prepared.createHandles[at] === actual.createHandles[index])
    )
    if (found < 0)
      throw new Error('Submitted publication operation or handle differs from prepared evidence')
    selected.push(found)
    next = found + 1
  }
  for (const [key, handle] of Object.entries(actual.createHandles)) {
    const index = Number(key)
    if (
      !Number.isSafeInteger(index) ||
      String(index) !== key ||
      actual.ops[index]?.op !== 'create' ||
      typeof handle !== 'string' ||
      !handle ||
      handle.length > 4096
    )
      throw new Error('Invalid submitted publication handle map')
  }
  return selected
}
function maskOf(count: number, selected: number[]): string {
  const bytes = new Uint8Array(Math.ceil(count / 8))
  for (const index of selected) bytes[index >> 3] |= 1 << index % 8
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
export function storeOwnerUnit(
  prepared: PushUnit,
  actual: PushUnit = prepared,
  bound = false
): StoredOwnerUnit {
  const original = copy(prepared),
    keys: string[][] = [],
    lookup = new Map<string, number>()
  const packed: [number, unknown[]][] = original.ops.map((op) => {
    const shape = Object.keys(op),
      key = JSON.stringify(shape)
    let at = lookup.get(key)
    if (at === undefined) {
      at = keys.length
      keys.push(shape)
      lookup.set(key, at)
    }
    return [at, shape.map((k) => (op as unknown as Record<string, unknown>)[k])]
  })
  const compress =
    JSON.stringify({ o: packed, k: keys }).length < JSON.stringify({ o: original.ops }).length
  return {
    r: original.requestId,
    o: compress ? packed : original.ops,
    c: original.createHandles,
    ...(compress ? { k: keys } : {}),
    m: maskOf(original.ops.length, ownerSubsetIndices(original, actual)),
    b: bound,
  }
}
export function loadOwnerUnit(stored: StoredOwnerUnit): {
  prepared: PushUnit
  actual: PushUnit
  bound: boolean
} {
  if (
    !stored ||
    typeof stored.r !== 'string' ||
    !Array.isArray(stored.o) ||
    stored.o.length < 1 ||
    stored.o.length > 1000 ||
    !stored.c ||
    typeof stored.c !== 'object' ||
    typeof stored.b !== 'boolean'
  )
    throw new Error('Invalid stored owner unit')
  let ops: CommitOp[]
  if (stored.k) {
    if (
      !Array.isArray(stored.k) ||
      stored.k.length > 1000 ||
      stored.k.some(
        (keys) =>
          !Array.isArray(keys) ||
          keys.some((k) => typeof k !== 'string') ||
          new Set(keys).size !== keys.length
      )
    )
      throw new Error('Invalid stored operation dictionary')
    ops = (stored.o as [number, unknown[]][]).map((row) => {
      if (
        !Array.isArray(row) ||
        row.length !== 2 ||
        !Number.isSafeInteger(row[0]) ||
        !Array.isArray(row[1])
      )
        throw new Error('Invalid stored owner operation')
      const keys = stored.k[row[0]]
      if (!keys || keys.length !== row[1].length)
        throw new Error('Invalid stored owner operation shape')
      return Object.fromEntries(keys.map((key, index) => [key, row[1][index]])) as CommitOp
    })
  } else ops = copy(stored.o as CommitOp[])
  if (
    typeof stored.m !== 'string' ||
    stored.m.length !== 2 * Math.ceil(ops.length / 8) ||
    !/^[a-f0-9]+$/.test(stored.m)
  )
    throw new Error('Invalid owner selection bitmap')
  const bytes = new Uint8Array(stored.m.match(/../g).map((v) => parseInt(v, 16))),
    selected: number[] = []
  for (let i = 0; i < bytes.length * 8; i++)
    if (bytes[i >> 3] & (1 << i % 8)) {
      if (i >= ops.length) throw new Error('Out-of-range owner selection')
      selected.push(i)
    }
  const prepared = { requestId: stored.r, ops, createHandles: copy(stored.c) },
    actual = {
      requestId: stored.r,
      ops: selected.map((i) => copy(ops[i])),
      createHandles: Object.fromEntries(
        selected.flatMap((old, index) => (ops[old].op === 'create' ? [[index, stored.c[old]]] : []))
      ),
    }
  if (!stored.b && selected.length !== ops.length)
    throw new Error('Prepared owner selection changed')
  ownerSubsetIndices(prepared, actual)
  return { prepared, actual, bound: stored.b }
}
