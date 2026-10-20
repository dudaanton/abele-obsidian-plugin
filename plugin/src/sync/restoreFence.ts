import { GENERATION_KEY, EXTERNAL_STATE_KEY, EngineError, type StateStore } from '@abele/sync-sdk/core'

export const RESTORE_HEADER = 'abele-restore-generation'
const HOST_KEYS = ['token-asset-outbox', 'token-asset-identities'] as const

/** Retire host authority before core retires its ledger. Never discard retained content. */
export async function fenceHostGeneration(
  state: StateStore,
  generation: string | null,
  archiveWrites?: (archive: (value: unknown) => Promise<void>) => Promise<void>,
  archiveReviews?: (archive: (value: unknown) => Promise<void>) => Promise<void>
): Promise<boolean> {
  if (!generation) return false
  const previous = await state.getMeta(GENERATION_KEY)
  if (previous === generation) return false
  const external = await state.getMeta(EXTERNAL_STATE_KEY)
  const metadata = Object.fromEntries(
    await Promise.all(HOST_KEYS.map(async (name) => [name, await state.getMeta(name)]))
  )
  let recovering =
    previous !== null ||
    external !== null ||
    Object.values(metadata).some((value) => value !== null) ||
    (await state.getCursor()) !== 0 ||
    (await state.getJournal()) !== null
  if (!recovering)
    for await (const _ of state.all()) {
      recovering = true
      break
    }
  if (!recovering) return false
  const key = 'retired-host-generation:' + (previous ?? 'legacy')
  await state.transaction(async () => {
    if (!(await state.getMeta(key))) {
      await state.setMeta(key, JSON.stringify({ generation, metadata }))
    }
    for (const name of HOST_KEYS) await state.setMeta(name, null)
  })
  await archiveWrites?.(async (value) => {
    const writesKey = key + ':writes'
    if (!(await state.getMeta(writesKey))) await state.setMeta(writesKey, JSON.stringify(value))
  })
  await archiveReviews?.(async (value) => {
    const reviewsKey = key + ':reviews'
    if (!(await state.getMeta(reviewsKey))) await state.setMeta(reviewsKey, JSON.stringify(value))
  })
  // External records retain remote identities and filesystem intents independently of core.
  // Preserve their complete document and stop rather than interpreting old IDs on a new server.
  if (external) {
    await state.setMeta(key + ':external', external)
    throw new EngineError(
      'io',
      'Sync recovery required: external files belong to a retired server generation'
    )
  }
  return true
}

/** Run before host response decoding, placement, review or publication acknowledgement. */
export function assertResponseGeneration(response: Response, generation: string | null): void {
  const observed = response.headers.get(RESTORE_HEADER)
  if (generation && observed && observed !== generation)
    throw new EngineError(
      'conflict',
      'Server restore generation changed; checking files on the next sync'
    )
}
