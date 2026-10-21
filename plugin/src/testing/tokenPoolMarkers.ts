import { z } from 'zod'
import { LOCAL_ONLY_COPIES } from '../sync/localOnlyCopies'
import { EXTERNAL_ACTIVATION_KEY } from '../sync/external/recovery'
import { EXTERNAL_RETIRED_KEY } from '../sync/external/connectionSwitch'
import type { LocalStorage } from '../sync/ledgerId'
const envelope = z
  .object({
    schema: z.literal(1),
    ledgers: z.array(
      z
        .object({
          ledgerId: z.string(),
          databaseName: z.string(),
          binding: z.object({ mode: z.string() }).loose(),
        })
        .loose()
    ),
  })
  .loose()

/** Only proofs of token databases in the guarded reset's ownership journal are removed. */
export function tokenPoolMarkers(storage: LocalStorage, owned: readonly string[]): () => void {
  const plans: { key: string; before: unknown; after: unknown }[] = [
    EXTERNAL_ACTIVATION_KEY,
    EXTERNAL_RETIRED_KEY,
  ].map((key) => {
    const before = storage.loadLocalStorage(key) ?? null
    if (before === null) return { key, before, after: null }
    const groups =
      key === EXTERNAL_ACTIVATION_KEY ? [envelope.parse(before)] : z.array(envelope).parse(before)
    const remaining = groups
      .map((group) => ({
        ...group,
        ledgers: group.ledgers.filter(
          (one) =>
            !(
              one.binding.mode === 'token' &&
              one.ledgerId === one.databaseName &&
              owned.includes(one.databaseName)
            )
        ),
      }))
      .filter((group) => group.ledgers.length)
    return {
      key,
      before,
      after: remaining.length ? (key === EXTERNAL_ACTIVATION_KEY ? remaining[0] : remaining) : null,
    }
  })
  const copiesBefore = storage.loadLocalStorage(LOCAL_ONLY_COPIES) ?? null
  const copies =
    copiesBefore === null
      ? []
      : z
          .array(z.object({ id: z.string(), path: z.string(), ledgerId: z.string() }).loose())
          .parse(copiesBefore)
  const remaining = copies.filter((one) => !owned.includes(one.ledgerId))
  plans.push({
    key: LOCAL_ONLY_COPIES,
    before: copiesBefore,
    after: remaining.length ? remaining : null,
  })
  return () => {
    for (const { key, before } of plans)
      if (JSON.stringify(storage.loadLocalStorage(key) ?? null) !== JSON.stringify(before))
        throw new Error('Pool activation ownership changed during reset')
    for (const { key, after } of plans) {
      storage.saveLocalStorage(key, after)
      if (JSON.stringify(storage.loadLocalStorage(key) ?? null) !== JSON.stringify(after))
        throw new Error('Pool activation cleanup was not stored')
    }
  }
}
