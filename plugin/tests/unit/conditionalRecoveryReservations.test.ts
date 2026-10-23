import { expect, it } from 'vitest'
import { ConditionalFiles, type ConditionalFileHost } from '@/sync/conditionalFiles'
import { EngineError } from '@abele/sync-sdk/core'
import { deferred } from '../helpers/deferred'

it('restores a late captured save even when its content cannot be fingerprinted', async () => {
  const { host, files } = await fixture()
  files.clear()
  const text = (value: string) => new TextEncoder().encode(value)
  files.set('sample.md', { bytes: text('before') })
  host.sameObject = undefined
  host.flush = async () => {}
  host.remove = async (path) => {
    files.delete(path)
  }
  const entered = deferred(),
    resume = deferred(),
    revoked = deferred<never>()
  void revoked.promise.catch(() => {})
  const expired = Object.assign(new EngineError('conflict', 'lease expired'), {
    leaseExpired: true,
  })
  let expiredNow = false
  const lease = Object.assign(() => {}, {
    check: () => {
      if (expiredNow) throw expired
    },
    wait: <T>(work: Promise<T>) => Promise.race([work, revoked.promise]),
  })
  host.checked = {
    maxBytes: 1024,
    wait: async () => {},
    acquire: async () => lease,
    publicationCheck: () => () => true,
  }
  const capture = host.capture
  host.capture = async (from, to) => {
    if (from === 'sample.md') {
      entered.resolve()
      await resume.promise
    }
    await capture(from, to)
  }
  const recovery = new ConditionalFiles(host)
  const operation = recovery.retainUncertain('sample.md', '.private/backup')
  await entered.promise
  expiredNow = true
  revoked.reject(expired)
  expect(await operation).toBe(false)
  files.set('sample.md', { bytes: text('new save') })
  const repairs = [...Reflect.get(recovery, 'lateRepairs')] as Promise<void>[]
  resume.resolve()
  await Promise.all(repairs)
  expect(files.get('sample.md')?.bytes).toEqual(text('new save'))
  expect([...files.keys()].filter((path) => path.endsWith('/late-effect.json'))).toHaveLength(1)
  await recovery.recover()
  expect(files.get('sample.md')?.bytes).toEqual(text('new save'))
})

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
