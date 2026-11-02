// @vitest-environment node
import { expect, it } from 'vitest'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { nativeVault } from '../helpers/nativeRestartVault'
import { desktopFsPort } from '../helpers/desktopRequire'

it('reuses native capabilities and mutation wrappers instead of allocating them per file', async () => {
  const root = await disk.mkdtemp(join(tmpdir(), 'sample-port-budget-'))
  desktopFsPort(disk)
  try {
    const files = new ObsidianFileSystem(nativeVault(root, disk) as unknown as App)
    const ports = new Set<unknown>(),
      methods = new Set<unknown>()
    for (let i = 0; i < 2048; i++) {
      const port = Reflect.get(files, 'native')
      ports.add(port)
      methods.add(port.installExclusive)
    }
    // A port owns immutable capabilities; all live effect checks still run on invocation.
    expect(ports.size).toBe(1)
    expect(methods.size).toBe(1)
    await disk.writeFile(join(root, 'sample.md'), 'sample')
    const port = Reflect.get(files, 'native')
    expect(await port.fileIdentity('sample.md')).not.toBeNull()
    await disk.rename(root, root + '-moved')
    await expect(port.fileIdentity('sample.md')).rejects.toMatchObject({
      code: 'vault-root-changed',
    })
  } finally {
    await disk.rm(root, { recursive: true, force: true })
    await disk.rm(root + '-moved', { recursive: true, force: true })
  }
})

it('bounds cloned diagnostic-owner bytes per ledger write', async () => {
  const factory = new IDBFactory()
  const state = await IndexedDbStateStore.open(factory, 'sample-owner-budget')
  const db = Reflect.get(Reflect.get(state, 'connection'), 'db') as IDBDatabase
  const transaction = db.transaction.bind(db)
  let bytes = 0,
    owners = 0
  const wrapped = new WeakSet<IDBObjectStore>()
  db.transaction = ((...args: Parameters<typeof db.transaction>) => {
    const tx = transaction(...args)
    const objectStore = tx.objectStore.bind(tx)
    tx.objectStore = (name: string) => {
      const store = objectStore(name)
      if (wrapped.has(store)) return store
      wrapped.add(store)
      const put = store.put.bind(store)
      store.put = (value, key) => {
        if (value?.key === 'revision' && typeof value.owner === 'string') {
          bytes += new TextEncoder().encode(value.owner).length
          owners++
        }
        return put(value, key)
      }
      return store
    }
    return tx
  }) as typeof db.transaction
  try {
    for (let i = 0; i < 256; i++) await state.setMeta('sample', String(i))
    expect(owners).toBe(256)
    // Logical operation and writer identity fit in 128 bytes; no eager stack strings.
    expect(bytes).toBeLessThanOrEqual(owners * 128)
  } finally {
    state.close()
  }
})

it('bounds outstanding crash-recovery acknowledgement requests within one snapshot', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-recovery-budget')
  for (const i of [0, 127, 32999])
    await state.put({
      path: `Notes/${i}.md`,
      wirePath: `Notes/${i}.md`,
      fileId: `sample-${i}`,
      versionId: 'sample-version',
      sha: 'e'.repeat(64),
      size: 1,
      mtime: 1,
    })
  const db = Reflect.get(Reflect.get(state, 'connection'), 'db') as IDBDatabase
  const transaction = db.transaction.bind(db)
  let pending = 0,
    peak = 0,
    reads = 0
  db.transaction = ((...args: Parameters<typeof db.transaction>) => {
    const tx = transaction(...args)
    const objectStore = tx.objectStore.bind(tx)
    tx.objectStore = (name: string) => {
      const store = objectStore(name),
        get = store.get.bind(store)
      store.get = (key) => {
        const request = get(key)
        if (name === 'entries') {
          reads++
          pending++
          peak = Math.max(peak, pending)
          request.addEventListener('success', () => {
            pending--
          })
        }
        return request
      }
      return store
    }
    return tx
  }) as typeof db.transaction
  try {
    expect(
      (
        await state.readCommittedEntries(Array.from({ length: 33000 }, (_, i) => `Notes/${i}.md`))
      ).map((row) => row.path)
    ).toEqual(['Notes/0.md', 'Notes/127.md', 'Notes/32999.md'])
    expect(reads).toBe(33000)
    expect(peak).toBeLessThanOrEqual(128)
  } finally {
    state.close()
  }
})
