import type { NodeClientState } from './NodeClientStore'
import { promptAnswerStates } from './promptAnswers'
import { snapshotOf } from './storeDraft'
import { tableOf } from './recordTable'

type Receipt = NodeClientState['results'][string]
interface ReceiptIndex {
  sessions: Map<string, Set<string>>
  inputs: Map<string, Set<string>>
  order: Map<string, number>
  next: number
}
const receiptIndexes = new WeakMap<object, ReceiptIndex>()

function add(index: Map<string, Set<string>>, key: string | undefined, id: string): void {
  if (!key) return
  let ids = index.get(key)
  if (!ids) index.set(key, (ids = new Set()))
  ids.add(id)
}

function membership(
  index: ReceiptIndex,
  id: string,
  receipt: Receipt | undefined,
  addRow: boolean
) {
  if (!receipt) return
  const result = receipt.result as { session_id?: string; input_id?: string } | undefined
  const update = (map: Map<string, Set<string>>, key: string | undefined) => {
    if (!key) return
    const ids = new Set(map.get(key))
    if (addRow) ids.add(id)
    else ids.delete(id)
    if (ids.size) map.set(key, ids)
    else map.delete(key)
  }
  update(index.sessions, receipt.input?.sessionId)
  update(index.sessions, receipt.answer?.sessionId)
  update(index.sessions, result?.session_id)
  update(index.inputs, result?.input_id)
}

function receiptOf(value: unknown): Receipt | undefined {
  return value && typeof value === 'object' ? (value as Receipt) : undefined
}

function receiptIndex(results: NodeClientState['results']): ReceiptIndex {
  const source = snapshotOf(results)
  const cached = receiptIndexes.get(source)
  if (cached) return cached
  const table = tableOf(source)
  if (table) {
    let ancestor = table.previous?.deref()
    const changed = new Set(table.changedKeys)
    while (ancestor && !receiptIndexes.has(ancestor.view)) {
      for (const key of ancestor.changedKeys) changed.add(key)
      ancestor = ancestor.previous?.deref()
    }
    const base = ancestor && receiptIndexes.get(ancestor.view)
    if (base && ancestor) {
      const index: ReceiptIndex = {
        sessions: new Map(base.sessions),
        inputs: new Map(base.inputs),
        order: new Map(base.order),
        next: base.next,
      }
      for (const id of changed) {
        membership(index, id, receiptOf(ancestor.get(id)), false)
        const current = receiptOf(table.get(id))
        if (current && !index.order.has(id)) index.order.set(id, index.next++)
        if (!current) index.order.delete(id)
        membership(index, id, current, true)
      }
      receiptIndexes.set(source, index)
      return index
    }
  }
  const index: ReceiptIndex = { sessions: new Map(), inputs: new Map(), order: new Map(), next: 0 }
  for (const [id, receipt] of Object.entries(source)) {
    index.order.set(id, index.next++)
    const result = receipt.result as { session_id?: string; input_id?: string } | undefined
    add(index.sessions, receipt.input?.sessionId, id)
    add(index.sessions, receipt.answer?.sessionId, id)
    add(index.sessions, result?.session_id, id)
    add(index.inputs, result?.input_id, id)
  }
  if (table || Object.isFrozen(source)) receiptIndexes.set(source, index)
  return index
}

/** A presentation owns only its session's plain data, never store accessors or their closure. */
export function presenterSnapshot(
  state: NodeClientState,
  session: string,
  older: NodeClientState['events'][string] = []
) {
  const history = [...older, ...(state.events[session] ?? [])]
  const inputIds = new Set(
    history.map((event) => (event.data as { input_id?: string })?.input_id).filter(Boolean)
  )
  const letters = Object.fromEntries(
    Object.entries(state.nodeLetters ?? {})
      .filter(([, letter]) => letter.sessionId === session)
      .map(([id, letter]) => [id, { ...letter }])
  )
  const receipts: NodeClientState['results'] = {}
  const results = snapshotOf(state.results)
  const index = receiptIndex(results)
  const ids = new Set(index.sessions.get(session))
  for (const inputId of inputIds) for (const id of index.inputs.get(inputId) ?? []) ids.add(id)
  for (const id of Object.keys(letters)) if (id in results) ids.add(id)
  for (const id of [...ids].sort((a, b) => (index.order.get(a) ?? 0) - (index.order.get(b) ?? 0))) {
    const receipt: Receipt = results[id]
    if (!receipt) continue
    const result = receipt.result as
      | { session_id?: string; input_id?: string; accepted_seq?: number }
      | undefined
    if (
      receipt.input?.sessionId === session ||
      receipt.answer?.sessionId === session ||
      result?.session_id === session ||
      (result?.input_id && inputIds.has(result.input_id)) ||
      id in letters
    ) {
      receipts[id] = {
        ...(receipt.error ? { error: receipt.error } : {}),
        ...(receipt.input ? { input: { ...receipt.input } } : {}),
        ...(receipt.answer ? { answer: { ...receipt.answer } } : {}),
        ...(result
          ? {
              result:
                result.session_id === session
                  ? { ...result }
                  : { input_id: result.input_id, accepted_seq: result.accepted_seq },
            }
          : {}),
      }
    }
  }
  const artifactData: NonNullable<NodeClientState['artifactData']> = {}
  for (const event of history) {
    const id = (event.data as { artifact_id?: string })?.artifact_id
    if (id && state.artifactData?.[id]) artifactData[id] = { ...state.artifactData[id] }
  }
  return {
    history,
    letters,
    receipts,
    artifactData,
    answers: promptAnswerStates({ results: state.results, outbox: state.outbox ?? [] }, session),
  }
}
