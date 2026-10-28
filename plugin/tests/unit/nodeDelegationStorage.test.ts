import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
import type { DelegationStorage } from '@/node/delegation'

it('moves legacy delegation tasks out of metadata and shares their exact tool snapshot', async () => {
  const factory = new IDBFactory()
  const tools = {
    vault_id: 'sample-vault',
    agent_id: 'sample-agent',
    revision: 'sample-revision',
    tools: Array.from({ length: 4 }, (_, i) => ({
      name: 'sample_read_' + i,
      description: 'Sample tool',
      inputSchema: {
        type: 'object',
        properties: { sample: { type: 'string', description: 'Sample schema '.repeat(3000) } },
      },
      mode: 'ask' as const,
    })),
  }
  const task = {
    parentId: 'sample-parent',
    input: { task_key: 'sample', provider: 'pi' as const, title: 'Sample', text: 'Sample task' },
    request: {
      provider: 'pi' as const,
      title: 'Sample',
      text: 'Sample task',
      delegation_key: 'sample-key',
      obsidian_tools: tools,
    },
  }
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('abele-node-sample-task-migration', 3)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('client').put(
        {
          cursors: {},
          events: {},
          outbox: [],
          results: {},
          delegation: { tasks: { one: task, two: task } },
        },
        'state'
      )
      open.result.createObjectStore('journal')
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      open.result.close()
      resolve()
    }
  })
  const store = new NodeClientStore('sample-task-migration', factory)
  try {
    await expect(
      store.transaction(() => {
        throw new Error('sample rollback')
      })
    ).rejects.toThrow('sample rollback')
    await store.transaction(() => {})
    const db = await (store as unknown as { open(): Promise<IDBDatabase> }).open()
    const read = (key: string) =>
      new Promise<any>((resolve) => {
        const req = db.transaction('client').objectStore('client').get(key)
        req.onsuccess = () => resolve(req.result)
      })
    expect(await read('state')).not.toHaveProperty('delegation')
    const stored = await read('record:delegationTasks:one')
    expect(stored.request).not.toHaveProperty('obsidian_tools')
    expect(stored.toolsRef).toBeTruthy()
    expect((await read('record:delegationTasks:two')).toolsRef).toBe(stored.toolsRef)
    const second = new NodeClientStore('sample-task-migration', factory)
    try {
      expect(await second.read((s) => s.delegation!.tasks.one.request.obsidian_tools)).toEqual(
        tools
      )
      expect(await second.read((s) => s.delegation!.tasks.one.request)).toEqual(task.request)
      expect(
        await second.read(
          (s) =>
            s.delegation!.tasks.one.request.obsidian_tools ===
            s.delegation!.tasks.two.request.obsidian_tools
        )
      ).toBe(true)
    } finally {
      second.close()
    }
  } finally {
    store.close()
  }
})

it('bounds delivered terminal tasks and retains uncertain work and owner stop fences', async () => {
  const store = new NodeClientStore('sample-task-retention', new IDBFactory())
  const task: DelegationStorage['tasks'][string] = {
    parentId: 'sample-parent',
    input: {
      task_key: 'sample-key',
      provider: 'pi',
      title: 'Sample',
      text: 'Sample task',
      base_ref: 'HEAD',
    },
    request: { provider: 'pi', title: 'Sample', text: 'Sample task', delegation_key: 'sample-key' },
    awaitingResult: false,
    status: {
      node_id: 'sample-node',
      session_id: 'sample-session',
      delegation_id: 'sample-delegation',
      delegation_key: 'sample-key',
      grant_id: 'sample-grant',
      parent_id: 'sample-parent',
      mailbox_stream_id: 'sample-mailbox',
      workspace_id: null,
      job_id: null,
      state: 'completed',
      created_at: '2026-01-01T00:00:00.000Z',
      session_head_seq: 1,
      mailbox_head_seq: 1,
      pending_human_prompts: 0,
    },
  }
  try {
    await store.transaction((s) => {
      s.delegation = {
        tasks: Object.fromEntries(
          Array.from({ length: 205 }, (_, i) => ['sample-' + i, structuredClone(task)])
        ),
      }
      s.delegation.tasks.uncertain = {
        ...structuredClone(task),
        status: { ...task.status!, state: 'unknown' },
      }
      s.delegation.tasks.fenced = { ...structuredClone(task), ownerStopped: true }
    })
    expect(await store.read((s) => Object.keys(s.delegation!.tasks).length)).toBe(202)
    expect(await store.read((s) => s.delegation!.tasks.uncertain.status!.state)).toBe('unknown')
    expect(await store.read((s) => s.delegation!.tasks.fenced.ownerStopped)).toBe(true)
  } finally {
    store.close()
  }
})
