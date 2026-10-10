/**
 * Turning a stretch of a chat's log into what a restore does, and doing it.
 *
 * Every path the chosen entries touched is taken back to the state it had before the first of
 * them — not undone step by step, which would pass through every state in between and trip on
 * a file the agent wrote twice. What it holds now is compared with what the last of them left:
 * a difference means somebody else changed it since, and that file is left untouched.
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
  const byPath = new Map<
    string,
    { target: Before; expected: After; refs: string[]; interrupted: boolean }
  >()
  for (const entry of ordered) {
    entry.changes.forEach((change, index) => {
      const ref = `${entry.id}:${index}`
      const known = byPath.get(change.path)
      if (known) {
        known.interrupted ||= known.expected !== beforeAfter(change.before) || !!change.uncertain
        known.expected = change.after
        known.refs.push(ref)
      } else {
        byPath.set(change.path, {
          target: change.before,
          expected: change.after,
          refs: [ref],
          interrupted: !!change.uncertain,
        })
      }
    })
  }

  // Preserve every rename edge, not only the first before-state retained for a path.
  const groups: Set<string>[] = []
  for (const path of byPath.keys()) groups.push(new Set([path]))
  for (const entry of ordered)
    for (const change of entry.changes) {
      const to = change.before.t !== 'missing' ? change.before.movedTo : undefined
      if (!to) continue
      const connected = groups.filter((group) => group.has(change.path) || group.has(to))
      const joined = new Set([change.path, to, ...connected.flatMap((group) => [...group])])
      for (const group of connected) groups.splice(groups.indexOf(group), 1)
      groups.push(joined)
    }

  const currents = new Map<string, Current>()
  for (const path of byPath.keys()) currents.set(path, await fs.current(path))

  const items: RestoreItem[] = []
  const settled: string[] = []
  /** Paths a move back empties, so they are not also sent to the trash. */
  const movedAway = new Set<string>()

  for (const [path, { target, expected, refs, interrupted }] of byPath) {
    const current = currents.get(path) as Current
    // Already as it was: nothing to do, and nothing to show — but it leaves the log all the same.
    if (!interrupted && currentAfter(current) === beforeAfter(target)) {
      settled.push(...refs)
      continue
    }
    const conflict = interrupted || currentAfter(current) !== expected
    const base = { path, conflict, target, refs, expected }
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
      // Legacy folder snapshots do not identify their descendants. Moving a whole folder
      // could take along another writer's additions, so leave it for manual recovery.
      if (target.t === 'folder') {
        items.push({ ...base, conflict: true, action: 'recreate-folder' })
        continue
      }
      const destination = byPath.get(movedTo)
      const safeDestination =
        !destination?.interrupted && (!destination || currentAfter(there) === destination.expected)
      if (
        !safeDestination ||
        (there.t !== 'missing' && currentAfter(there) !== target.hash && !destination)
      ) {
        items.push({ ...base, conflict: true, action: 'recreate' })
        continue
      }
      const same = currentAfter(there) === target.hash
      if (same) {
        movedAway.add(movedTo)
        items.push({
          ...base,
          action: 'move-back',
          from: movedTo,
          sourceExpected: currentAfter(there),
        })
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

  const units = groups.map((paths) => {
    const members = shown.filter((item) => paths.has(item.path))
    if (
      members.some((item) => item.conflict || item.action === 'unrestorable') ||
      [...paths].some((path) => !byPath.has(path))
    ) {
      for (const item of members) item.conflict = true
    }
    return {
      paths: [...paths],
      expected: Object.fromEntries(
        [...paths]
          .filter((path) => byPath.has(path))
          .map((path) => {
            const state = byPath.get(path)!
            const current = currentAfter(currents.get(path)!)
            return [
              path,
              !state.interrupted && current === beforeAfter(state.target)
                ? current
                : state.expected,
            ]
          })
      ),
      refs: [...paths].flatMap((path) => byPath.get(path)?.refs ?? []),
    }
  })

  return {
    units,
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
    refs: [],
  }
  const units = (
    plan.units ??
    plan.items.map((item) => ({
      paths: [item.path, ...(item.from ? [item.from] : [])],
      expected: {
        [item.path]: item.expected ?? null,
        ...(item.from ? { [item.from]: item.sourceExpected ?? null } : {}),
      },
      refs: item.refs,
    }))
  ).map((unit) => ({ ...unit, expected: new Map(Object.entries(unit.expected)), failed: false }))
  const unitOf = (item: RestoreItem) => units.find((unit) => unit.paths.includes(item.path))!
  for (const item of plan.items) {
    if (item.action === 'unrestorable' || item.conflict || choices[item.path] === 'skip')
      unitOf(item).failed = true
  }
  const chosen = plan.items.filter((item) => {
    // Retain the choices argument for older callers, but never permit destructive overwrite.
    if (unitOf(item).failed) {
      result.skipped.push(item.path)
      return false
    }
    return true
  })

  const run = async (item: RestoreItem, step: (safe: VaultFs) => Promise<void>) => {
    const unit = unitOf(item)
    if (unit.failed) {
      result.skipped.push(item.path)
      return
    }
    try {
      for (const [path, expected] of unit.expected) {
        if (currentAfter(await fs.current(path)) !== expected)
          throw new Error(`Changed since the undo snapshot at ${path}: rename unit left untouched`)
      }
      await step(
        fs.checked(
          new Map(unit.expected),
          new Set(item.action === 'remove-folder' ? [item.path] : [])
        )
      )
      unit.expected.set(item.path, beforeAfter(item.target))
      if (item.from) unit.expected.set(item.from, null)
      result.restored.push(item.path)
    } catch (err) {
      unit.failed = true
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
    await run(item, (safe) => safe.ensureFolder(item.path))
  }
  for (const item of of('rewrite', 'recreate')) {
    await run(item, async (safe) => {
      const target = item.target
      const data = target.t === 'binary' && target.blob ? await blob(target.blob) : undefined
      if (target.t === 'binary' && !data) throw new Error('The kept copy is gone')
      if (currentAfter(await fs.current(item.path)) !== item.expected)
        throw new Error('Changed since the undo snapshot: left untouched')
      await safe.put(item.path, target, data ?? undefined, item.expected)
    })
  }
  for (const item of of('remove')) await run(item, (safe) => safe.remove(item.path))
  // Files before folders, and deepest first, so a folder moved back takes nothing stale along.
  const moves = of('move-back').sort(
    (a, b) =>
      Number(a.target.t === 'folder') - Number(b.target.t === 'folder') ||
      depth(b.path) - depth(a.path)
  )
  for (const item of moves) await run(item, (safe) => safe.move(item.from as string, item.path))
  for (const item of of('remove-folder').sort((a, b) => depth(b.path) - depth(a.path))) {
    await run(item, async (safe) => {
      if (!(await safe.removeIfEmpty(item.path))) throw new Error('Not empty: kept')
    })
  }
  for (const unit of units) if (!unit.failed) result.refs.push(...unit.refs)
  if (!plan.units) result.refs.push(...plan.settled)
  return result
}
