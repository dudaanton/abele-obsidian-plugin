import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { pruneNodeDatabases } from '@/node/pruneNodeDatabases'

it('removes unowned registration caches only within this installation and rechecks current owners', async () => {
  const factory = new IDBFactory()
  const names = [
    'abele-node-sample-old',
    'abele-node-sample-current',
    'abele-node-foreign-old',
    'abele-node-paired-sample',
    'other-data',
  ]
  for (const name of names)
    await new Promise<void>((resolve) => {
      const request = factory.open(name)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })
  await pruneNodeDatabases(factory, 'sample', () => new Set(['abele-node-sample-current']))
  expect((await factory.databases()).map((db) => db.name).sort()).toEqual(
    names.filter((name) => name !== 'abele-node-sample-old').sort()
  )
})
