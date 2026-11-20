import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ClientRecords } from '@/node/clientRecords'
import type { NodeClientState } from '@/node/NodeClientStore'
import type { DelegationStorage } from '@/node/delegation'

it('recreates tool payloads deleted by another handle before committing a new reference', async () => {
  const factory = new IDBFactory()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open('sample-tool-handles', 3)
    open.onupgradeneeded = () => open.result.createObjectStore('client')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const task: DelegationStorage['tasks'][string] = {
    parentId: 'sample-parent',
    input: { task_key: 'sample-key', provider: 'pi', title: 'Sample', text: 'Sample work' },
    request: {
      provider: 'pi',
      title: 'Sample',
      text: 'Sample work',
      delegation_key: 'sample-key',
      obsidian_tools: {
        vault_id: 'sample-vault',
        agent_id: 'sample-agent',
        revision: 'sample-revision',
        tools: [],
      },
    },
  }
  const create = () => new ClientRecords(() => {})
  const update = async (records: ClientRecords, mutate: (state: NodeClientState) => void) => {
    const tx = db.transaction('client', 'readwrite')
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
    const state: NodeClientState = { cursors: {}, events: {}, outbox: [], results: {} }
    const loaded = await records.load(tx, state)
    mutate(state)
    await loaded.save()
    await done
    loaded.committed()
  }
  const raw = (key: string) =>
    new Promise<any>((resolve, reject) => {
      const request = db.transaction('client').objectStore('client').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  try {
    const a = create()
    const b = create()
    await update(a, (s) => {
      s.delegation!.tasks.first = task
    })
    const reference = (await raw('record:delegationTasks:first')).toolsRef as string
    expect(await raw(reference)).toEqual(task.request.obsidian_tools)
    await update(b, (s) => {
      delete s.delegation!.tasks.first
    })
    expect(await raw(reference)).toBeUndefined()
    // A imports B's deletion and creates the identical snapshot in the same transaction.
    await update(a, (s) => {
      expect(s.delegation!.tasks.first).toBeUndefined()
      s.delegation!.tasks.second = task
    })
    expect(await raw(reference)).toEqual(task.request.obsidian_tools)
    await update(create(), (s) => {
      expect(s.delegation!.tasks.first).toBeUndefined()
      expect(s.delegation!.tasks.second.request).toEqual(task.request)
    })
  } finally {
    db.close()
  }
})
