import { expect, it, vi } from 'vitest'
import { ExternalFileEffects, type ExternalFilesystemPort } from '@/sync/external/filesystem'
import {
  gateMobileSource,
  mobileLargeFileGate,
  MOBILE_LARGE_SOURCE,
} from '@/sync/mobileLargeFileGate'

it('preserves lazy gate ownership through staging and finishes consecutive concurrent large hydrations', async () => {
  const size = 200 * 1024 * 1024
  const close = vi.fn(async () => {})
  const port = {
    exists: async () => false,
    makeParents: async () => {},
    matches: async () => true,
    writeStagingSource: async (_path, source) => {
      // The mobile writer must delegate acquisition to this source, never acquire twice.
      expect(Reflect.get(source, MOBILE_LARGE_SOURCE)).toBe(true)
      await source.read(0, 1)
      await source.assertUnchanged()
    },
  } as ExternalFilesystemPort
  const effects = () =>
    new ExternalFileEffects(
      port,
      { assertPaths: () => {}, request: { operationId: 'sample-operation' } } as never,
      {
        assertOwned: () => {},
        assertUnused: () => {},
        assertIntent: () => {},
      }
    )
  const hydrate = (name: string) =>
    effects().stageSource(
      {
        operationId: 'sample-operation',
        role: 'incoming',
        path: `Media/.abele-external-${name}`,
        size,
        sha: 'a'.repeat(64),
      },
      gateMobileSource({
        size,
        read: async () => new Uint8Array(1),
        assertUnchanged: async () => {},
        close,
      })
    )
  expect(await Promise.all([hydrate('first'), hydrate('second')])).toEqual([
    { status: 'staged' },
    { status: 'staged' },
  ])
  expect(close).toHaveBeenCalledTimes(2)
  const release = await mobileLargeFileGate.acquire()
  release()
})
