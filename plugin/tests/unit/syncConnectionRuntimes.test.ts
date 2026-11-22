import { expect, it } from 'vitest'
import { connectionRuntimes } from '../e2e/helpers/syncConnectionRuntimes'

it('waits for all active members even when the parent has no runtime', () => {
  const first = { engine: { status: { state: 'idle', lastSyncAt: 1 } } }
  const host = {
    live: new Map([['folder', first]]),
    ui: {
      itemSets: {
        store: {
          get: () => ({
            items: [
              { recordId: 'folder', paused: false },
              { recordId: 'group', paused: false },
              { recordId: 'file', paused: true },
              { recordId: 'detached', paused: false, detached: true },
            ],
          }),
        },
      },
    },
  }
  expect(connectionRuntimes(host, 'parent')).toEqual([first, undefined])
  host.live.set('group', first)
  expect(connectionRuntimes(host, 'parent')).toEqual([first, first])
})

it('uses the parent for an ordinary connection and never treats absent runtimes as ready', () => {
  const host = {
    live: new Map([['root', 'runtime']]),
    ui: { itemSets: { store: { get: () => null } } },
  }
  expect(connectionRuntimes(host, 'root')).toEqual(['runtime'])
  expect(connectionRuntimes(host, 'missing')).toEqual([undefined])
})
