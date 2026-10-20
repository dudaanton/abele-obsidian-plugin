import { expect, it, vi } from 'vitest'
import { TokenUi, connectionError, connectionStatusText, scopeName } from '@/sync/tokenUi'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'
import { encodeAccessToken } from '@/sync/v2/contract'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { deferred } from '../helpers/deferred'
import { LocalPlacementError } from '@/sync/localFolderPlacement'

it('does not resurrect departed activity when an older review refresh fails', async () => {
  const { ui, registry } = setup()
  await ui.connect(token)
  const id = registry.records()[0].id
  const pending = deferred<void>()
  vi.spyOn(ui, 'refreshReviews')
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(undefined)
  ui.publish(id, { pending: 2 })
  await ui.disconnect(id)
  pending.reject(new Error('old refresh failed'))
  await Promise.resolve()
  expect(ui.activity.value).toEqual({})
})

it('uses the connection status line for restored server and local files', () => {
  const row = { status: 'syncing', paused: false }
  expect(
    connectionStatusText(row, {
      reconciliation: { phase: 'requested', reason: 'server generation changed' },
    })
  ).toBe('The server was restored from a backup — checking files')
  expect(
    connectionStatusText(row, {
      reconciliation: { phase: 'review', reason: 'explicit reconciliation' },
    })
  ).toBe('Checking restored files')
  expect(
    connectionStatusText(row, {
      reconciliation: { phase: 'complete', reason: 'explicit reconciliation' },
    })
  ).toBe('Syncing')
  expect(connectionError({ code: 'scope_deleted' })).toBe(
    'Deleted on the server. Every file stays on this device.'
  )
})

it('names a granted folder or group the server no longer shows to its issuer', () => {
  expect(scopeName({ kind: 'folder', id: 'moved', path: '(unavailable)' })).toBe(
    'Folder outside this connection'
  )
  expect(scopeName({ kind: 'group', id: 'moved', path: '(unavailable)' })).toBe(
    'Group outside this connection'
  )
  expect(scopeName({ kind: 'folder', id: 'kept', path: 'Shared' })).toBe('Folder: Shared')
})

it('shows the reason a local placement was refused', () => {
  const reason = 'The folder overlaps another connection; sync remains stopped'
  expect(connectionError(new LocalPlacementError(reason))).toBe(reason)
})

it('retains the failed connect stage cause when no connection could be added', async () => {
  const { ui, registry } = setup()
  ui.connectionChangeGuard = async () => {
    throw new Error('Native inventory read failed')
  }
  await expect(ui.connect(token)).rejects.toThrow('Checking the vault')
  expect(registry.records()).toEqual([])
  expect(ui.connectFailure).toMatchObject({ reason: 'Native inventory read failed' })
})

it('reconciles host sessions after disconnect removes a placed connection', async () => {
  const { ui, registry } = setup()
  await ui.connect(token)
  const id = registry.records()[0].id
  registry.setScopePath(id, 'Shared')
  registry.setLocalRoot(id, 'Moved')
  registry.setRootIssue(id, { kind: 'moved', path: 'Moved' })
  const drained = vi.fn(async () => {})
  ui.runtimes.set(id, { disconnect: drained } as never)
  ui.connectionChangeGuard = async () => {}
  const changed = vi.fn(async () => {
    expect(drained).toHaveBeenCalledOnce()
    expect(registry.records()).toEqual([])
  })
  ui.connectionForgotten = changed
  await ui.disconnect(id)
  expect(changed).toHaveBeenCalledOnce()
})

it('shows review and question paths at the local placement while keeping their source binding canonical', async () => {
  const { ui } = setup()
  const candidate = {
    id: 'review',
    path: 'Shared/code.js',
    previousPath: 'Shared/old.js',
    source: { id: 'connection', scope: { path: 'Shared' } },
  }
  const question = {
    id: 'question',
    path: 'Shared/image.png',
    source: { id: 'connection', scope: { path: 'Shared' } },
  }
  Object.assign(ui, {
    reviews: {
      executables: { state: async () => [], pending: async () => [candidate] },
      attachments: { pending: async () => [question] },
    },
  })
  ui.runtimes.set('connection', {
    localPath: (path: string) => path.replace(/^Shared(?=\/|$)/, 'Moved'),
  } as never)
  await ui.refreshReviews()
  expect(ui.candidates.value[0]).toMatchObject({
    path: 'Moved/code.js',
    previousPath: 'Moved/old.js',
    source: { scope: { path: 'Shared' } },
  })
  expect(ui.questions.value[0]).toMatchObject({
    path: 'Moved/image.png',
    source: { scope: { path: 'Shared' } },
  })
  expect(candidate.path).toBe('Shared/code.js')
  expect(question.path).toBe('Shared/image.png')
})

it('distinguishes a cut-off response body from an unreachable server', () => {
  expect(
    connectionError(
      Object.assign(new Error('GET /v2/connection was cut off before its body arrived'), {
        code: 'offline',
      })
    )
  ).toBe('The server response was cut off before it finished. Try syncing again.')
})

function setup() {
  const data = new Map<string, unknown>(),
    keys = new Map<string, string>()
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => structuredClone(data.get(key) ?? null),
    saveLocalStorage: (key, value) => {
      data.set(key, structuredClone(value))
    },
  })
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope: { kind: 'folder', id: 'root', path: '/' },
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      )
  )
  const ui = new TokenUi(
    registry,
    {
      get: (id) => keys.get(id) ?? null,
      set: (id, value) => {
        keys.set(id, value)
      },
      remove: (id) => {
        keys.delete(id)
      },
    },
    transport
  )
  return { ui, registry, keys, transport, data }
}
const token = encodeAccessToken({
  v: 1,
  address: 'https://sync.example',
  key: 'a'.repeat(43),
  scope: { kind: 'folder', id: 'root', path: '/' },
})
const secondToken = encodeAccessToken({
  v: 1,
  address: 'https://second.example',
  key: 'b'.repeat(43),
  scope: { kind: 'folder', id: 'root', path: '/' },
})
it('Sync now waits for startup and completes an exchange instead of returning at activation', async () => {
  const { ui, registry } = setup()
  await ui.connect(token)
  const id = registry.records()[0].id
  const sync = vi.fn(async () => {})
  ui.retryConnection = async () => {
    ui.runtimes.set(id, { sync } as never)
  }
  await ui.sync(id)
  expect(sync).toHaveBeenCalledOnce()
})
it('materializes before departure despite concurrent exchange status updates', async () => {
  const { ui, registry } = setup()
  await ui.connect(token)
  const id = registry.records()[0].id
  ui.connectionChangeGuard = async () => {
    registry.setStatus(id, 'syncing')
  }
  await ui.disconnect(id)
  expect(registry.records()).toEqual([])
})
it('still refuses departure when the connection policy changes during materialization', async () => {
  const { ui, registry } = setup()
  await ui.connect(token)
  const id = registry.records()[0].id
  ui.connectionChangeGuard = async () => {
    registry.setPaused(id, true)
  }
  await expect(ui.disconnect(id)).rejects.toThrow('Connection changed')
  expect(registry.records()).toHaveLength(1)
})
it('exposes safe synchronous startup timings and status for the test hook', async () => {
  const { ui } = setup()
  await ui.connect(token)
  const id = ui.rows.value[0].id
  ui.startupStage(id, 'Checking the vault')
  ui.inspectionProgress(id, 12, 12023)
  expect(ui.startupSnapshot()[0].statusText).toBe('Checking the vault… 12/12023')
  ui.finishStartup(id, 'failed')
  expect(ui.startupSnapshot()[0].startupTimings).toEqual([
    expect.objectContaining({ stage: 'Checking the vault', outcome: 'failed' }),
  ])
  expect(JSON.stringify(ui.startupSnapshot())).not.toContain('a'.repeat(43))
})
for (const stage of ['first guard', 'second guard', 'server']) {
  it(`bounds a hung ${stage} without late enrollment`, async () => {
    vi.useFakeTimers()
    try {
      const { ui, registry, keys, transport } = setup()
      let release!: () => void
      const hung = new Promise<void>((resolve) => {
        release = resolve
      })
      let calls = 0
      ui.connectionChangeGuard = async () => {
        calls++
        if (stage === 'first guard' || (stage === 'second guard' && calls === 2)) await hung
      }
      if (stage === 'server')
        transport.mockImplementationOnce(async () => {
          await hung
          return new Response('{}')
        })
      const result = ui.connect(token).catch((error) => error)
      await vi.advanceTimersByTimeAsync(10001)
      expect(connectionError(await result)).toContain(stage === 'server' ? 'reachable' : 'vault')
      release()
      await vi.advanceTimersByTimeAsync(1)
      expect(registry.records()).toEqual([])
      expect(keys.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
}
it('saves without waiting for startup and reports a hung engine', async () => {
  vi.useFakeTimers()
  try {
    const { ui, registry } = setup()
    ui.connectionsChanged = () => new Promise(() => {})
    let finished = false
    void ui.connect(token).then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(finished).toBe(true)
    expect(registry.records()[0].status).toBe('joining')
    await vi.advanceTimersByTimeAsync(10001)
    expect(registry.records()[0].status).toBe('error')
    expect(ui.activity.value[registry.records()[0].id].error).toContain('starting sync')
  } finally {
    vi.useRealTimers()
  }
})
it('reuses an already connected token and its existing ledger when pasted again', async () => {
  const { ui, registry, keys } = setup()
  await ui.connect(token)
  const before = registry.records()[0]
  await ui.connect(token)
  expect(registry.records()).toEqual([before])
  expect(keys.size).toBe(1)
})

it('connects by token, persists the connection and does not retain pasted text in UI state', async () => {
  const { ui, registry, keys } = setup()
  await ui.connect(token)
  expect(ui.rows.value).toHaveLength(1)
  expect(registry.records()[0].scope?.path).toBe('/')
  expect(keys.size).toBe(1)
  expect(JSON.stringify(ui.rows.value)).not.toContain('a'.repeat(43))
})
it('rejects a bad token without disturbing existing connections or creating an empty row', async () => {
  const { ui, registry } = setup()
  await ui.connect(token)
  const before = registry.records()
  await expect(ui.connect('broken')).rejects.toThrow()
  expect(registry.records()).toEqual(before)
})

it('rejects changed selector hints before adding a connection row', async () => {
  const { ui, registry, transport } = setup()
  await ui.connect(token)
  const before = registry.records()
  transport.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope: { kind: 'folder', id: 'different-root', path: '/' },
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      )
  )
  await expect(ui.connect(token)).rejects.toThrow()
  expect(registry.records()).toEqual(before)
})
it('pauses independently and disconnects only the selected connection and its key', async () => {
  const { ui, registry, keys } = setup()
  await ui.connect(secondToken)
  await ui.connect(token)
  const [first, second] = registry.records()
  await ui.pause(first.id, true)
  expect(registry.records()[1].paused).toBe(false)
  await ui.disconnect(first.id)
  expect(registry.records()).toEqual([second])
  expect(keys.size).toBe(1)
})
it('uses plain reasons for connection errors', () => {
  expect(connectionError({ code: 'bad-token' })).toContain('incomplete')
  expect(connectionError({ code: 'unreachable' })).toContain('reachable')
  expect(connectionError({ code: 'revoked' })).toContain('closed')
  expect(connectionError({ code: 'too_large' })).toContain('too large')
  expect(connectionError({ code: 'quota_waiting' })).toContain('full')
})

it('resumes credential cleanup after disconnect is interrupted, without touching another connection', async () => {
  const { ui, registry, keys, transport } = setup()
  await ui.connect(secondToken)
  await ui.connect(token)
  const [first, second] = registry.records()
  ui.bind(first.id, {
    disconnect: async () => {
      throw new Error('interrupted')
    },
  } as never)
  await expect(ui.disconnect(first.id)).rejects.toThrow('interrupted')
  expect(registry.records()).toEqual([second])
  expect(keys.size).toBe(2)
  new TokenUi(
    registry,
    {
      get: (id) => keys.get(id) ?? null,
      set: (id, value) => {
        keys.set(id, value)
      },
      remove: (id) => {
        keys.delete(id)
      },
    },
    transport
  )
  expect(keys.size).toBe(1)
  expect(keys.get(second.secretReference)).toBeTruthy()
})

it('resumes the same interrupted connection when the token is pasted again', async () => {
  const { registry, transport, keys } = setup()
  let fail = true
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, value: string) => {
      if (fail) throw new Error('keychain unavailable')
      keys.set(id, value)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const ui = new TokenUi(registry, secrets, transport)
  await expect(ui.connect(token)).rejects.toThrow('keychain unavailable')
  const before = registry.records()[0]
  fail = false
  await ui.connect(token)
  expect(registry.records()).toHaveLength(1)
  expect(registry.records()[0]).toMatchObject({
    id: before.id,
    ledgerId: before.ledgerId,
    status: 'idle',
  })
})

it('keeps last successful sync time when the screen and plugin reopen', async () => {
  const { ui, registry, transport, keys } = setup()
  await ui.connect(token)
  const id = ui.rows.value[0].id
  ui.publish(id, { lastSync: 1000 })
  ui.publish(id, { completed: 1, total: 10 })
  expect(ui.activity.value[id].lastSync).toBe(1000)
  const reopened = new TokenUi(
    registry,
    { get: (id) => keys.get(id) ?? null, set: () => {}, remove: () => {} },
    transport
  )
  expect(reopened.activity.value[id].lastSync).toBe(1000)
})

it('keeps root revocation available for tokens issued by another participant', async () => {
  const { ui, transport } = setup()
  await ui.connect(token)
  transport.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'other-issued',
              label: 'Sample shared access',
              scope: { kind: 'folder', id: 'shared', path: 'Shared' },
              issued_by_token_id: 'another-participant',
              created_at: '2025-01-01T00:00:00Z',
              revoked_at: null,
            },
          ],
        })
      )
  )
  expect((await ui.issued(ui.rows.value[0].id))[0].id).toBe('other-issued')
})

it('asks only through the note-open port and persists denial for exactly that file and connection', async () => {
  const fixture = tokenUiFixture(),
    state = new MemoryStateStore()
  const reviews = {
    executables: new ExecutableReview(state),
    attachments: new AttachmentConsent(state),
    close: () => {},
  }
  const ui = new TokenUi(
    fixture.registry,
    { get: () => 'a'.repeat(43), set: () => {}, remove: () => {} },
    async () => {
      throw new Error('No request expected')
    },
    reviews
  )
  const source = fixture.questions.value[0].source,
    target = { id: 'stable-local-image', path: 'Private/sample.png', kind: 'attachment' as const }
  const runtime = {
    sync: async () => {},
    pause: async () => {},
    disconnect: async () => {},
    apply: async () => {},
    resolve: async () => target,
    opened: async (path: string) =>
      path === 'Groups/sample.md' ? [{ source, noteId: 'stable-local-note' }] : [],
  }
  ui.bind(source.id, runtime)
  await reviews.attachments.observeNote(source, 'stable-local-note', [target.id])
  await ui.refreshReviews() // Receipt/background indexing has no question or permission.
  expect(ui.questions.value).toEqual([])
  expect(await reviews.attachments.mayUpload(source, target)).toBe(false)
  await ui.opened('Groups/sample.md')
  expect(ui.questions.value).toHaveLength(1)
  await ui.decide(ui.questions.value[0], false)
  await ui.opened('Groups/sample.md')
  expect(ui.questions.value).toEqual([])
  expect(await reviews.attachments.mayUpload(source, target)).toBe(false)
  expect(await new AttachmentConsent(state).mayUpload(source, target)).toBe(false)
  const other = { ...source, id: 'other-connection', address: 'https://other.example' }
  await reviews.attachments.observeNote(other, 'stable-local-note', [target.id])
  expect(await reviews.attachments.noteOpened(other, 'stable-local-note', runtime)).toHaveLength(1)
})

it('disconnects when an exchange persists progress while materialization is pending', async () => {
  const { ui, registry } = setup()
  await ui.connect(token)
  const id = registry.records()[0].id
  let entered!: () => void, release!: () => void
  const waiting = new Promise<void>((resolve) => {
    entered = resolve
  })
  const materialized = new Promise<void>((resolve) => {
    release = resolve
  })
  ui.connectionChangeGuard = async () => {
    entered()
    await materialized
  }
  const departure = ui.disconnect(id)
  await waiting
  ui.publish(id, { lastSync: 123456 })
  registry.storage(id).saveLocalStorage('abele-sync-token-state:cursor', 'sample-next-cursor')
  registry.setStatus(id, 'syncing')
  release()
  await expect(departure).resolves.toBeUndefined()
  expect(registry.records()).toEqual([])
})

it.each([
  'server',
  'space',
  'token',
  'scope kind',
  'scope id',
  'scope path',
  'ledger',
  'credential reference',
  'credential',
  'selective policy',
  'pending binding',
  'removed connection',
])('refuses departure when %s changes during materialization', async (change) => {
  const { ui, registry, data, keys } = setup()
  await ui.connect(token)
  const id = registry.records()[0].id
  ui.connectionChangeGuard = async () => {
    const document = structuredClone(data.get(TOKEN_REGISTRY_KEY)) as {
      records: ReturnType<typeof registry.records>
      selectedId: string
    }
    const record = document.records[0]
    switch (change) {
      case 'server':
        record.address = 'https://changed.example'
        break
      case 'space':
        record.spaceId = 'sample-changed-space'
        break
      case 'token':
        record.tokenId = 'sample-changed-token'
        break
      case 'scope kind':
        record.scope!.kind = 'group'
        break
      case 'scope id':
        record.scope!.id = 'sample-changed-scope'
        break
      case 'scope path':
        record.scope!.path = 'sample-folder'
        break
      case 'ledger':
        record.ledgerId = 'sample-changed-ledger'
        break
      case 'credential reference':
        record.secretReference += '-changed'
        break
      case 'credential':
        keys.set(record.secretReference, 'b'.repeat(43))
        break
      case 'selective policy':
        record.selective!.images = false
        break
      case 'pending binding':
        record.pending = {
          address: record.address,
          spaceId: record.spaceId,
          tokenId: record.tokenId,
          scope: record.scope!,
          secretReference: record.secretReference,
          ledgerId: record.ledgerId,
        }
        break
      case 'removed connection':
        document.records = []
        document.selectedId = ''
        break
    }
    data.set(TOKEN_REGISTRY_KEY, document)
  }
  await expect(ui.disconnect(id)).rejects.toThrow('Connection changed while disconnecting')
  if (change !== 'removed connection') expect(registry.records()).toHaveLength(1)
})

it.each([false, true])(
  'retires disconnected executable candidates without touching another connection (legacy=%s)',
  async (legacy) => {
    const { registry, keys, transport } = setup()
    const metadata = new MemoryStateStore()
    const reviews = {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    }
    const ui = new TokenUi(
      registry,
      {
        get: (id) => keys.get(id) ?? null,
        set: (id, value) => {
          keys.set(id, value)
        },
        remove: (id) => {
          keys.delete(id)
        },
      },
      transport,
      reviews
    )
    await ui.connect(token)
    await ui.connect(secondToken)
    const [first, other] = registry.records()
    const bytes = new TextEncoder().encode('// pending code'),
      sha = await sha256(bytes)
    for (const record of [first, other])
      await reviews.executables.stage({
        source: {
          id: record.id,
          address: record.address,
          spaceId: record.spaceId,
          tokenId: record.tokenId,
          scope: record.scope!,
        },
        fileId: 'sample-code',
        versionId: 'sample-version',
        path: 'Assets/sample.js',
        previousPath: null,
        operation: 'create',
        directory: false,
        receivedAt: 1000,
        mtime: 1000,
        kind: 'attachment',
        bytes,
        sha,
      })
    await ui.refreshReviews()
    expect(ui.candidates.value).toHaveLength(2)
    if (legacy) {
      registry.forget(first.id)
      await ui.refreshReviews()
    } else await ui.disconnect(first.id)
    expect((await reviews.executables.pending()).map((one) => one.source.id)).toEqual([other.id])
    expect(ui.candidates.value.map((one) => one.source.id)).toEqual([other.id])
  }
)
