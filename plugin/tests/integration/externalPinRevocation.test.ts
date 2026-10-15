import { expect, it, vi } from 'vitest'
import { externalFileFixture as fixture } from './externalFileFollowupFixture'
import { deferred } from '../helpers/deferred'
it.each(['verification', 'removal preservation'])(
  'a device pin persisted during %s revokes removal',
  async (pauseAt) => {
    const entered = deferred<void>(),
      release = deferred<void>()
    let captures = 0
    const pause = async () => {
      entered.resolve()
      await release.promise
    }
    const s = await fixture(
      'Media/sample.png',
      async () => {
        if (pauseAt === 'verification') await pause()
      },
      async () => {
        if (++captures === 2 && pauseAt === 'removal preservation') await pause()
      },
      async () => {
        throw new Error('offline')
      }
    )
    const remove = vi.spyOn(s.app.vault.adapter, 'remove')
    try {
      const eviction = s.port.evict(s.path)
      const settled = Promise.allSettled([eviction])
      await entered.promise
      s.app.saveLocalStorage('abele-external-pins-v1', [s.path])
      const queuedPin = s.port.setPinned(s.path, true)
      const pinSettled = Promise.allSettled([queuedPin])
      release.resolve()
      expect(await settled).toMatchObject([
        { status: 'fulfilled', value: { status: 'pinned', reclaimedBytes: 0 } },
      ])
      await pinSettled
      expect(remove.mock.calls.filter(([path]) => path === s.path)).toEqual([])
      expect(await s.app.vault.adapter.exists(s.path)).toBe(true)
      expect(await s.app.vault.adapter.read(s.path)).toBe('sample original bytes')
    } finally {
      release.resolve()
      s.close()
    }
  }
)
