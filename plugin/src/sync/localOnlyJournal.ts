import type { StateStore, Journal } from '@abele/sync-sdk/core'

async function touches(
  state: StateStore,
  journal: Journal,
  held: (path: string) => boolean
): Promise<boolean> {
  for (const op of journal.ops) {
    if ('path' in op && held(op.path)) return true
    if ('to_path' in op && held(op.to_path)) return true
    if ('file_id' in op) {
      const entry = await state.byFileId(op.file_id)
      if (entry && (held(entry.path) || held(entry.wirePath))) return true
    }
  }
  return false
}
async function retain(state: StateStore, journal: Journal): Promise<void> {
  if (!state.setMeta || !state.getMeta)
    throw new Error('Kept-copy publication recovery needs durable storage')
  const key = 'local-only-publication-journal:' + journal.idempotencyKey
  const value = JSON.stringify(journal)
  const old = await state.getMeta(key)
  if (old !== null && old !== value) throw new Error('Kept-copy publication evidence changed')
  await state.setMeta(key, value)
  if ((await state.getMeta(key)) !== value)
    throw new Error('Could not retain kept-copy publication evidence')
}
/** A receipt key covers the entire batch: retain it intact, never split or rewrite its ops. */
export async function quarantineLocalOnlyJournal(
  state: StateStore,
  held: (path: string) => boolean
): Promise<void> {
  const journal = await state.getJournal()
  if (!journal || !(await touches(state, journal, held))) return
  await state.transaction(async () => {
    await retain(state, journal)
    await state.setJournal(null)
  })
  console.debug('[Abele Sync] Kept-copy publication journal quarantined', journal.idempotencyKey)
}
/** Guard both bootstrap recovery and core resumeJournal, which precedes filtered scanning. */
export function localOnlyJournalState(
  state: StateStore,
  held: (path: string) => boolean
): StateStore {
  return new Proxy(state, {
    get(target, key) {
      if (key === 'getJournal')
        return async () => {
          await quarantineLocalOnlyJournal(target, held)
          return target.getJournal()
        }
      if (key === 'setJournal')
        return async (journal: Journal | null) => {
          if (journal && (await touches(target, journal, held))) {
            await target.transaction(() => retain(target, journal))
            throw new Error('A kept local copy cannot be published')
          }
          await target.setJournal(journal)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
