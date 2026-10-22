import { expect, it } from 'vitest'
import { ConditionalFiles, type ConditionalFileHost } from '@/sync/conditionalFiles'

async function fixture() {
  const files = new Map<string, { bytes: Uint8Array }>()
  const folders = new Set<string>()
  const reserved = new Set<string>()
  let failFlush = true
  const host: ConditionalFileHost = {
    root: '.private',
    active: new Set(),
    check() {},
    validate(path) {
      if (reserved.has(path)) throw new Error('busy')
    },
    stat: async (path) =>
      files.has(path)
        ? { type: 'file', size: files.get(path)!.bytes.length, mtime: 0 }
        : folders.has(path)
          ? { type: 'folder', size: 0, mtime: 0 }
          : null,
    fingerprint: async () => {
      throw new Error('unused')
    },
    create: async (path, bytes) => {
      files.set(path, { bytes })
    },
    read: async (path) => files.get(path)!.bytes,
    mkdir: async (path) => {
      folders.add(path)
    },
    list: async (path) => ({
      files: [...files.keys()].filter(
        (key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')
      ),
      folders: [],
    }),
    capture: async (from, to) => {
      files.set(to, files.get(from)!)
      files.delete(from)
    },
    install: async (from, to) => {
      if (files.has(to)) throw new Error('occupied')
      files.set(to, files.get(from)!)
    },
    flush: async (path) => {
      if (failFlush && path.endsWith('.md')) {
        failFlush = false
        throw new Error('flush failed')
      }
    },
    sameObject: async (a, b) => files.has(a) && files.get(a) === files.get(b),
    stage: async () => {
      throw new Error('unused')
    },
    changed() {},
  }
  await host.mkdir('.private/active')
  await host.create('.private/active/sample.json', new Uint8Array(), 0)
  await host.create(
    '.private/objects/sample/intent.json',
    new TextEncoder().encode(JSON.stringify({ path: 'folder/sample.md', kind: 'remove' })),
    0
  )
  await host.create('.private/objects/sample/victim', new TextEncoder().encode('retained bytes'), 0)
  await host.create('folder/sample.md', new TextEncoder().encode('occupant'), 0)
  const visibleAliases = () =>
    [...files]
      .filter(
        ([path, value]) =>
          !path.startsWith('.') && value === files.get('.private/objects/sample/victim')
      )
      .map(([path]) => path)
  return { host, files, reserved, visibleAliases, recovery: new ConditionalFiles(host) }
}

it('keeps a published plan pending when its destination becomes reserved before retry', async () => {
  const { recovery, reserved, visibleAliases, files } = await fixture()
  await expect(recovery.recover()).rejects.toThrow()
  const [destination] = visibleAliases()
  reserved.add(destination)
  await expect(recovery.recover()).rejects.toThrow()
  expect(visibleAliases()).toEqual([destination])
  expect(files.has('.private/active/sample.json')).toBe(true)
  reserved.clear()
  await recovery.recover()
  expect(visibleAliases()).toEqual([destination])
})

it('rechecks recorded publications immediately before installing another name', async () => {
  const { host, recovery, files, visibleAliases } = await fixture()
  await expect(recovery.recover()).rejects.toThrow()
  const [published] = visibleAliases()
  // Simulate an initial stale inspection; the final publication check must see it.
  const sameObject = host.sameObject!
  let checks = 0
  host.sameObject = async (a, b) => (b === published && ++checks <= 2 ? false : sameObject(a, b))
  await recovery.recover()
  expect(visibleAliases()).toEqual([published])
  expect(files.has('.private/active/sample.json')).toBe(false)
})
