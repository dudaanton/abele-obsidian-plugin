import { describe, expect, it, vi } from 'vitest'
import { acquireVaultRelationBatches } from '@/entities/vaultRelationBatches'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

// Count queue-history work only during the folder notification, not elapsed time or
// entity cleanup. This uses the real adapter with an already-resolved subscription.
describe('folder-only deletion identity lookup complexity', () => {
  it.each([32, 64])('does linear queue-history work for %s watched descendants', async (count) => {
    const paths = Array.from({ length: count }, (_, i) => `Samples/entry-${i}.md`)
    const app = useVault(paths.map((path) => ({ path })))
    const lease = acquireVaultRelationBatches(GlobalStore.getInstance().app)
    const batches: { kind: string; path: string }[][] = []
    const subscription = lease.router.subscribe((changes) => batches.push(changes))
    subscription.update('Outside/root.md', null, paths)
    app.emit('metadataCache', 'resolved')
    batches.length = 0
    const folder = app.vault.getAbstractFileByPath('Samples')!
    await app.vault.delete(folder)
    let examined = 0,
      reversed = 0,
      lookups = 0
    const originalGet = Map.prototype.get
    const get = vi.spyOn(Map.prototype, 'get').mockImplementation(function (key) {
      lookups++
      return originalGet.call(this, key)
    })
    const originalFind = Array.prototype.find
    const find = vi
      .spyOn(Array.prototype, 'find')
      .mockImplementation(function (predicate, thisArg) {
        return originalFind.call(this, (value, index, array) => {
          examined++
          return predicate.call(thisArg, value, index, array)
        })
      })
    const originalReverse = Array.prototype.reverse
    const reverse = vi.spyOn(Array.prototype, 'reverse').mockImplementation(function () {
      reversed += this.length
      return originalReverse.call(this)
    })
    try {
      app.emit('vault', 'delete', folder)
    } finally {
      find.mockRestore()
      reverse.mockRestore()
      get.mockRestore()
    }
    try {
      console.info(JSON.stringify({ count, examined, reversed, lookups }))
      app.emit('metadataCache', 'resolved')
      expect(batches).toHaveLength(1)
      expect(batches[0].map((change) => change.path)).toEqual(paths)
      expect(batches[0].every((change) => change.kind === 'delete')).toBe(true)
      expect(examined + reversed + lookups).toBeLessThanOrEqual(count * 8)
    } finally {
      subscription.stop()
      lease.release()
    }
  })
})
