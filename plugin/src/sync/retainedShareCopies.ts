import { z } from 'zod'
import type { StateEntry, StateStore } from '@abele/sync-sdk/core'
import { PathSchema } from '@abele/sync-sdk/protocol'

export const RETAINED_SHARE_COPIES = 'plugin:retained-share-copies-v1'
const path = z.string().refine((value) => PathSchema.safeParse(value.normalize('NFC')).success)
const entry = z
  .object({
    path,
    wirePath: path,
    fileId: z.string().min(1),
    versionId: z.string().min(1),
    sha: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
    mtime: z.number().nonnegative(),
  })
  .strict()

/** Baselines kept after core drops a departed file's active ledger entry. */
export class RetainedShareCopies {
  private readonly meta
  constructor(state: StateStore) {
    if (!state.getMeta || !state.setMeta || !state.metadataKeys)
      throw new Error('Retained copies need durable metadata')
    this.meta = {
      read: state.getMeta.bind(state),
      write: state.setMeta.bind(state),
      keys: state.metadataKeys.bind(state),
    }
  }
  async read(): Promise<StateEntry[]> {
    try {
      const entries: StateEntry[] = []
      for (const key of await this.meta.keys(RETAINED_SHARE_COPIES + ':')) {
        const value = await this.meta.read(key)
        if (value !== null) entries.push(entry.parse(JSON.parse(value)))
      }
      return entries
    } catch {
      throw new Error('Retained shared copies require recovery')
    }
  }
  async remember(value: StateEntry): Promise<void> {
    await this.meta.write(
      RETAINED_SHARE_COPIES + ':' + encodeURIComponent(value.fileId),
      JSON.stringify(entry.parse(value))
    )
  }
  async forget(fileId: string): Promise<void> {
    await this.meta.write(RETAINED_SHARE_COPIES + ':' + encodeURIComponent(fileId), null)
  }
}
