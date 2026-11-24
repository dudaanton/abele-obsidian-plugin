import { z } from 'zod'
import type { LocalStorage } from '../ledgerId'

const openingHistorySchema = z.record(z.string(), z.number())

/** Missing history is empty; malformed history must not authorize an offload decision. */
export function readOpeningHistory(storage: Pick<LocalStorage, 'loadLocalStorage'>) {
  return openingHistorySchema.parse(storage.loadLocalStorage('abele-external-last-opened-v1') ?? {})
}
