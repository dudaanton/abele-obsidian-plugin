import { expect, it, vi } from 'vitest'
import { TokenUi, connectionError } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { encodeAccessToken } from '@/sync/v2/contract'
import { MemoryStateStore } from '@abele/sync-core'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { tokenUiFixture } from '@/testing/tokenUiFixture'

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
  await ui.connect(token)
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
  await ui.connect(token)
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
