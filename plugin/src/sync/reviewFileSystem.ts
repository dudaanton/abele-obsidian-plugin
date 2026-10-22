import type { AtomicStage, FileSystem } from '@abele/sync-sdk/core'
import { PLACEMENT } from './pathCoordinator'

/** An approval can be revoked while core waits on reads, placement, or stage verification. */
export function reviewFileSystem<T extends FileSystem>(fs: T, assertAllowed: () => void): T {
  const stage = (pending: AtomicStage): AtomicStage =>
    new Proxy(pending, {
      get(target, key) {
        if (key === 'commit')
          return async (...args: Parameters<AtomicStage['commit']>) => {
            assertAllowed()
            return target.commit(...args)
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  return new Proxy(fs, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      if (key === PLACEMENT)
        return (paths: string[], work: () => Promise<unknown>) =>
          value.call(target, paths, async () => {
            assertAllowed()
            return work()
          })
      if (key === 'beginAtomicWrite' || key === 'reopenStage')
        return async (...args: unknown[]) => {
          assertAllowed()
          return stage(await value.apply(target, args))
        }
      if (
        [
          'writeAtomic',
          'move',
          'remove',
          'mkdir',
          'moveDirectory',
          'removeDirectory',
          'conditionalFile',
          'recoverConditionalFiles',
        ].includes(String(key))
      )
        return async (...args: unknown[]) => {
          assertAllowed()
          return value.apply(target, args)
        }
      return value.bind(target)
    },
  })
}
