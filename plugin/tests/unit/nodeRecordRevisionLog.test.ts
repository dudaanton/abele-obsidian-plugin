import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
import { RECORD_LOG_WINDOW } from '@/node/clientRecords'

it('keeps legacy manifest rows and tool payloads readable for rollback without reviving retired rows', async () => {
  const factory = new IDBFactory()
  const namespace = 'sample-legacy-retirement'
  const receipt = 'record:results:sample-old-receipt'
  const task = 'record:delegationTasks:sample-old-task'
  const toolsRef = 'delegation-tools:sample-old-tools'
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('abele-node-' + namespace, 3)
    open.onupgradeneeded = () => {
      const client = open.result.createObjectStore('client')
      open.result.createObjectStore('journal')
      client.put(
        { cursors: {}, events: {}, outbox: [], results: {}, delegation: { tasks: {} } },
        'state'
      )
      client.put({ result: 'Sample settled result' }, receipt)
      client.put(
        {
          parentId: 'sample-parent',
          input: {
            task_key: 'sample-task',
            provider: 'pi',
            title: 'Sample task',
            text: 'Sample work',
            base_ref: 'HEAD',
          },
          request: {
            provider: 'pi',
            title: 'Sample task',
            text: 'Sample work',
            delegation_key: 'sample-delegation',
          },
          toolsRef,
        },
        task
      )
      client.put(
        {
          vault_id: 'sample-vault',
          agent_id: 'sample-agent',
          revision: 'sample-revision',
          tools: [],
        },
        toolsRef
      )
      client.put({ [receipt]: 'sample-revision' }, 'record-revisions')
      client.put({ [task]: 'sample-revision' }, 'delegation-revisions')
    }
    open.onsuccess = () => {
      open.result.close()
      resolve()
    }
    open.onerror = () => reject(open.error)
  })
  const writer = new NodeClientStore(namespace, factory)
  try {
    await writer.transaction((s) => {
      delete s.results['sample-old-receipt']
    })
    const db = await (writer as unknown as { open(): Promise<IDBDatabase> }).open()
    const raw = (key: string) =>
      new Promise<unknown>((resolve) => {
        const request = db.transaction('client').objectStore('client').get(key)
        request.onsuccess = () => resolve(request.result)
      })
    expect(await raw(receipt)).toEqual({ result: 'Sample settled result' })
    expect(await raw(task)).toHaveProperty('toolsRef', toolsRef)
    expect(await raw(toolsRef)).toBeDefined()
    const reopened = new NodeClientStore(namespace, factory)
    try {
      expect(await reopened.read((s) => s.results['sample-old-receipt'])).toBeUndefined()
      expect(await reopened.read((s) => s.delegation?.tasks['sample-old-task'])).toBeUndefined()
    } finally {
      reopened.close()
    }
  } finally {
    writer.close()
  }
})

it('bounds revision history and preserves deletions and rollback after a reader misses the window', async () => {
  const factory = new IDBFactory()
  const writer = new NodeClientStore('sample-revision-window', factory)
  const reader = new NodeClientStore('sample-revision-window', factory)
  try {
    await writer.transaction((s) => {
      s.results['sample-removed'] = { error: 'outcome_unknown' }
      s.results['sample-retained'] = { error: 'outcome_unknown' }
    })
    const before = await reader.read((s) => s.results)
    await writer.transaction((s) => {
      delete s.results['sample-removed']
      s.results['sample-retained'].error = 'connection_lost'
    })
    for (let i = 0; i <= RECORD_LOG_WINDOW; ++i)
      await writer.transaction((s) => {
        s.chatDrafts!['sample-session'] = { text: 'Sample draft ' + i, notice: '' }
      })
    expect(await reader.read((s) => s.results['sample-removed'])).toBeUndefined()
    expect(await reader.read((s) => s.results['sample-retained'].error)).toBe('connection_lost')
    expect(before['sample-removed'].error).toBe('outcome_unknown')
    const db = await (writer as unknown as { open(): Promise<IDBDatabase> }).open()
    const keys = () =>
      new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db.transaction('client').objectStore('client').getAllKeys()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const persisted = await keys()
    expect(persisted.filter((key) => Array.isArray(key) && key[0] === 'record-log')).toHaveLength(
      RECORD_LOG_WINDOW
    )
    expect(
      persisted.some(
        (key) =>
          typeof key === 'string' &&
          key.startsWith('record-order:') &&
          key.endsWith(':record:results:sample-removed')
      )
    ).toBe(false)
    const put = IDBObjectStore.prototype.put
    const abort = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (value, key) {
        const request = put.call(this, value, key)
        if (key === 'records-stamp') this.transaction.abort()
        return request
      })
    try {
      await expect(
        writer.transaction((s) => {
          s.chatDrafts!['sample-session'].text = 'Sample aborted draft'
        })
      ).rejects.toThrow()
    } finally {
      abort.mockRestore()
    }
    expect(await keys()).toEqual(persisted)
    expect(await reader.read((s) => s.chatDrafts!['sample-session'].text)).toBe(
      'Sample draft ' + RECORD_LOG_WINDOW
    )
  } finally {
    writer.close()
    reader.close()
  }
}, 30000)
