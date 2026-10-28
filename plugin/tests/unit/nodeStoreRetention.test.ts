import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'

it('retains an editor pending receipt and request across pruning and reopening', async () => {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-editor-recovery-retention', factory)
  const request = {
    method: 'workspace.write',
    params: {
      workspace_id: 'sample-workspace',
      path: 'sample.txt',
      expected_content_id: 'a'.repeat(64),
      text: 'new text',
    },
  }
  try {
    await store.transaction((s) => {
      s.results['sample-editor-write'] = { result: 'saved', request }
      s.operationRequests = { 'sample-editor-write': request }
      s.fileDrafts = {
        sample: {
          revision: crypto.randomUUID(),
          baseContentId: 'a'.repeat(64),
          baseText: 'old text',
          text: 'new text',
          status: 'outcome_unknown',
          pending: { operationId: 'sample-editor-write', params: request.params },
        },
      }
      for (let i = 0; i < 1100; i++) s.results['sample-' + i] = { result: 'settled' }
    })
    const reopened = new NodeClientStore('sample-editor-recovery-retention', factory)
    try {
      expect(await reopened.read((s) => s.results['sample-editor-write'])).toEqual({
        result: 'saved',
        request,
      })
      expect(await reopened.read((s) => s.operationRequests?.['sample-editor-write'])).toEqual(
        request
      )
    } finally {
      reopened.close()
    }
  } finally {
    store.close()
  }
})

it('bounds legacy successful cancellations which have no delivery wake', async () => {
  const store = new NodeClientStore('sample-cancel-retention', new IDBFactory())
  try {
    await store.transaction((s) => {
      s.managerOperations = {}
      for (let i = 0; i < 250; i++) {
        const run = {
          run_id: 'sample-run-' + i,
          prompt_id: 'sample-prompt',
          session_id: 'sample-session',
          method: 'command.v1.run' as const,
          state: 'cancelled' as const,
          stdout: '',
          stderr: '',
          stdout_truncated: false,
          stderr_truncated: false,
        }
        s.managerOperations['sample-' + i] = {
          parent: 'sample-parent',
          method: 'command.v1.cancel',
          params: {},
          run,
        }
        s.results['sample-' + i] = { result: run }
      }
    })
    expect(await store.read((s) => Object.keys(s.managerOperations!).length)).toBe(200)
  } finally {
    store.close()
  }
})

it('migrates version-2 receipts atomically and refuses older clients after the layout changes', async () => {
  const factory = new IDBFactory()
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('abele-node-sample-receipt-migration', 2)
    open.onupgradeneeded = () => {
      open.result
        .createObjectStore('client')
        .put(
          { cursors: {}, events: {}, outbox: [], results: { sample: { result: 'retained' } } },
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
  const store = new NodeClientStore('sample-receipt-migration', factory)
  await expect(
    store.transaction((s) => {
      expect(s.results.sample.result).toBe('retained')
      s.results.sample.result = 'damaged'
      throw new Error('sample migration abort')
    })
  ).rejects.toThrow('sample migration abort')
  await store.transaction(() => {})
  store.close()
  const reopened = new NodeClientStore('sample-receipt-migration', factory)
  expect(await reopened.read((s) => s.results.sample.result)).toBe('retained')
  reopened.close()
  await expect(
    new Promise((resolve, reject) => {
      const open = factory.open('abele-node-sample-receipt-migration', 2)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        open.result.close()
        resolve(undefined)
      }
    })
  ).rejects.toMatchObject({ name: 'VersionError' })
})

it('retains undelivered and uncertain manager runs while bounding delivered terminal history', async () => {
  const store = new NodeClientStore('sample-manager-retention', new IDBFactory())
  const run = {
    run_id: 'sample-run',
    prompt_id: 'sample-prompt',
    session_id: 'sample-session',
    method: 'command.v1.run' as const,
    state: 'exited' as const,
    stdout: '',
    stderr: '',
    stdout_truncated: false,
    stderr_truncated: false,
  }
  try {
    await store.transaction((s) => {
      s.managerOperations = {}
      for (let i = 0; i < 250; i++) {
        const id = 'sample-' + i
        s.managerOperations[id] = {
          parent: 'sample-parent',
          method: run.method,
          params: {},
          notified: true,
          run,
        }
        s.results[id] = { result: run }
        if (i % 2) {
          delete s.managerOperations[id].run
          s.results[id] = { error: 'resource_busy' }
        }
      }
      s.managerOperations.unknown = {
        parent: 'sample-parent',
        method: run.method,
        params: {},
        notified: true,
        run: { ...run, state: 'outcome_unknown' },
      }
      s.managerOperations.undelivered = {
        parent: 'sample-parent',
        method: run.method,
        params: {},
        run,
      }
      s.results.unknown = { result: { ...run, state: 'outcome_unknown' } }
    })
    expect(await store.read((s) => Object.keys(s.managerOperations!).length)).toBe(202)
    expect(await store.read((s) => s.managerOperations!.unknown.run!.state)).toBe('outcome_unknown')
    expect(await store.read((s) => s.managerOperations!.undelivered)).toBeDefined()
  } finally {
    store.close()
  }
})

it('isolates receipt caches across handles, failed transactions and readonly mutations', async () => {
  const factory = new IDBFactory()
  const first = new NodeClientStore('sample-receipt-isolation', factory)
  const second = new NodeClientStore('sample-receipt-isolation', factory)
  try {
    await first.transaction((s) => {
      s.results.sample = { result: { text: 'original' } }
    })
    expect(await second.read((s) => s.results.sample.result)).toEqual({ text: 'original' })
    await expect(
      first.transaction((s) => {
        s.results.sample.result = 'damaged'
        throw new Error('sample rollback')
      })
    ).rejects.toThrow('sample rollback')
    await expect(
      first.read((s) => {
        s.results.sample.result = 'readonly mutation'
      })
    ).rejects.toThrow(TypeError)
    expect(await first.read((s) => s.results.sample.result)).toEqual({ text: 'original' })
    await second.transaction((s) => {
      s.results.sample.result = { text: 'changed' }
    })
    expect(await first.read((s) => s.results.sample.result)).toEqual({ text: 'changed' })
    await second.transaction((s) => {
      delete s.results.sample
    })
    expect(await first.read((s) => s.results.sample)).toBeUndefined()
  } finally {
    first.close()
    second.close()
  }
})

it('bounds unreferenced settled results while retaining recovery evidence', async () => {
  const store = new NodeClientStore('sample-retention', new IDBFactory())
  try {
    await store.transaction((s) => {
      for (let i = 0; i < 1500; i++) s.results['sample-' + i] = { result: 'x'.repeat(2000) }
      s.results.recovery = {
        error: 'sample refusal',
        input: { sessionId: 'sample', text: 'recover me' },
      }
      s.operationRequests = {
        pending: { method: 'session.stop', params: { session_id: 'sample' } },
      }
      s.outbox.push({
        operation_id: 'pending',
        method: 'session.stop',
        params: { session_id: 'sample' },
      })
    })
    expect(await store.read((s) => Object.keys(s.results).length)).toBeLessThanOrEqual(1001)
    expect(await store.read((s) => s.results.recovery.input?.text)).toBe('recover me')
    expect(await store.read((s) => s.outbox[0].operation_id)).toBe('pending')
  } finally {
    store.close()
  }
})

it('writes only the changed receipt and does no writes on idle reads or transactions', async () => {
  const store = new NodeClientStore('sample-incremental', new IDBFactory())
  try {
    await store.transaction((s) => {
      for (let i = 0; i < 500; i++) s.results['sample-' + i] = { result: 'x'.repeat(5000) }
    })
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    try {
      await store.transaction((s) => {
        s.results['sample-0'] = { result: 'changed' }
      })
      expect(put.mock.calls.every(([value]) => !JSON.stringify(value).includes('xxxxx'))).toBe(true)
      put.mockClear()
      await store.transaction(() => {})
      await store.read((s) => Object.keys(s.results).length)
      expect(put).not.toHaveBeenCalled()
    } finally {
      put.mockRestore()
    }
  } finally {
    store.close()
  }
})
