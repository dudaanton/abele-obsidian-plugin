/**
 * Turning a stretch of a chat's log into what a restore does, and doing it.
 *
 * Every path the chosen entries touched is taken back to the state it had before the first of
 * them — not undone step by step, which would pass through every state in between and trip on
 * a file the agent wrote twice. What it holds now is compared with what the last of them left:
 * a difference means somebody else changed it since, and that file is the person's to decide.
 */
import type { VaultFs } from './vaultFs'
import type {
  After,
  Before,
  ConflictChoice,
  Current,
  RestoreItem,
  RestorePlan,
  RestoreResult,
  RewindEntry,
} from './types'

const currentAfter = (current: Current): After =>
  current.t === 'missing' ? null : current.t === 'folder' ? 'folder' : current.hash

const beforeAfter = (before: Before): After =>
  before.t === 'missing' ? null : before.t === 'folder' ? 'folder' : before.hash

const depth = (path: string) => path.split('/').length

export async function planRestore(entries: RewindEntry[], fs: VaultFs): Promise<RestorePlan> {
  const ordered = [...entries].sort((a, b) => a.at - b.at)
  const byPath = new Map<string, { target: Before; expected: After; refs: string[] }>()
  for (const entry of ordered) {
    entry.changes.forEach((change, index) => {
      const ref = `${entry.id}:${index}`
      const known = byPath.get(change.path)
      if (known) {
        known.expected = change.after
        known.refs.push(ref)
      } else {
        byPath.set(change.path, { target: change.before, expected: change.after, refs: [ref] })
      }
    })
  }

  const currents = new Map<string, Current>()
  for (const path of byPath.keys()) currents.set(path, await fs.current(path))

  const items: RestoreItem[] = []
  const settled: string[] = []
  /** Paths a move back empties, so they are not also sent to the trash. */
  const movedAway = new Set<string>()

  for (const [path, { target, expected, refs }] of byPath) {
    const current = currents.get(path) as Current
    // Already as it was: nothing to do, and nothing to show — but it leaves the log all the same.
    if (currentAfter(current) === beforeAfter(target)) {
      settled.push(...refs)
      continue
    }
    const conflict = currentAfter(current) !== expected
    const base = { path, conflict, target, refs }
    const oldText = current.t === 'text' ? current.text : ''

    if (target.t === 'missing') {
      items.push({
        ...base,
        action: current.t === 'folder' ? 'remove-folder' : 'remove',
        diff: current.t === 'text' ? { old: oldText, new: '' } : undefined,
      })
      continue
    }

    // Moved away: back by the same road while what it left is still there as it was left.
    const movedTo = target.movedTo
    if (movedTo && current.t === 'missing') {
      const there = currents.get(movedTo) ?? (await fs.current(movedTo))
      const same =
        target.t === 'folder' ? there.t === 'folder' : currentAfter(there) === target.hash
      if (same) {
        movedAway.add(movedTo)
        items.push({ ...base, action: 'move-back', from: movedTo })
        continue
      }
    }

    if (target.t === 'folder') {
      items.push({ ...base, action: 'recreate-folder' })
      continue
    }
    if (target.t === 'binary' && !target.blob) {
      items.push({ ...base, action: 'unrestorable' })
      continue
    }
    items.push({
      ...base,
      action: current.t === 'missing' ? 'recreate' : 'rewrite',
      diff: target.t === 'text' ? { old: oldText, new: target.text } : undefined,
    })
  }

  // The place a file is moved back from is emptied by the move itself; listed once, as the move.
  const shown: RestoreItem[] = []
  for (const item of items) {
    const byMove =
      movedAway.has(item.path) && (item.action === 'remove' || item.action === 'remove-folder')
    const move = byMove ? items.find((i) => i.action === 'move-back' && i.from === item.path) : null
    if (move) move.refs.push(...item.refs)
    else shown.push(item)
  }

  return {
    items: shown.sort((a, b) => a.path.localeCompare(b.path)),
    entryIds: ordered.map((e) => e.id),
    settled,
  }
}

export async function applyRestore(
  plan: RestorePlan,
  choices: Record<string, ConflictChoice>,
  fs: VaultFs,
  blob: (name: string) => Promise<ArrayBuffer | null>
): Promise<RestoreResult & { refs: string[] }> {
  const result: RestoreResult & { refs: string[] } = {
    restored: [],
    skipped: [],
    failed: [],
    refs: [...plan.settled],
  }
  const chosen = plan.items.filter((item) => {
    if (item.action === 'unrestorable' || (item.conflict && choices[item.path] !== 'overwrite')) {
      result.skipped.push(item.path)
      return false
    }
    return true
  })

  const run = async (item: RestoreItem, step: () => Promise<void>) => {
    try {
      await step()
      result.restored.push(item.path)
      result.refs.push(...item.refs)
    } catch (err) {
      result.failed.push({
        path: item.path,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const of = (...actions: RestoreItem['action'][]) =>
    chosen.filter((item) => actions.includes(item.action))

  // Folders first, shallowest first, so content has somewhere to go.
  for (const item of of('recreate-folder').sort((a, b) => depth(a.path) - depth(b.path))) {
    await run(item, () => fs.ensureFolder(item.path))
  }
  for (const item of of('rewrite', 'recreate')) {
    await run(item, async () => {
      const target = item.target
      const data = target.t === 'binary' && target.blob ? await blob(target.blob) : undefined
      if (target.t === 'binary' && !data) throw new Error('The kept copy is gone')
      await fs.put(item.path, target, data ?? undefined)
    })
  }
  for (const item of of('remove')) await run(item, () => fs.remove(item.path))
  // Files before folders, and deepest first, so a folder moved back takes nothing stale along.
  const moves = of('move-back').sort(
    (a, b) =>
      Number(a.target.t === 'folder') - Number(b.target.t === 'folder') ||
      depth(b.path) - depth(a.path)
  )
  for (const item of moves) await run(item, () => fs.move(item.from as string, item.path))
  for (const item of of('remove-folder').sort((a, b) => depth(b.path) - depth(a.path))) {
    await run(item, async () => {
      if (!(await fs.removeIfEmpty(item.path))) throw new Error('Not empty: kept')
    })
  }
  return result
}
