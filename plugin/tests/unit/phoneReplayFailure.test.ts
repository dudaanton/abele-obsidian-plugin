// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
const fake = vi.hoisted(() => ({
  connection: { value: { paused: false } },
  status: { value: { state: 'idle', pending: 0 } },
  log: { value: [] as string[] },
  client: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}))
vi.mock('@/sync/SyncService', () => ({ SyncService: { getInstance: () => fake } }))
import {
  startPhoneReplay,
  verifyPhoneReplay,
  clearPhoneReplayEvidence,
} from '@/testing/phoneReplay'
import type { App } from 'obsidian'
beforeEach(() => {
  vi.stubGlobal('window', globalThis)
  fake.connection.value.paused = false
  fake.status.value = { state: 'idle', pending: 0 }
  fake.pause.mockImplementation(() => {
    fake.connection.value.paused = true
  })
  fake.resume.mockReset()
  fake.log.value = []
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function fixture() {
  const local = new Map<string, unknown>([['task14-isolated-fixture', { root: 'SampleReplay' }]])
  let path = ''
  const create = vi.fn(async (p: string) => {
    path = p
  })
  const app = {
    loadLocalStorage: (k: string) => local.get(k) ?? null,
    saveLocalStorage: (k: string, v: unknown) => local.set(k, v),
    vault: { create, adapter: { read: async () => 'Native phone replay exact bytes' } },
  } as unknown as App
  return { app, local, create, path: () => path }
}
describe('phone replay failure cleanup and strict confirmation', () => {
  it('restores the original method and paused state when local create rejects', async () => {
    const { app, create } = fixture()
    create.mockRejectedValue(new Error('create failed'))
    const original = vi.fn(),
      client = { commitRaw: original, versions: vi.fn() }
    fake.client.mockReturnValue(client)
    fake.resume.mockImplementation(() => {
      fake.connection.value.paused = false
    })
    await expect(startPhoneReplay(app)).rejects.toThrow(/create failed/)
    expect(client.commitRaw).toBe(original)
    expect(fake.connection.value.paused).toBe(false)
  })
  it('cancels a timed-out interceptor and a late response cannot recreate cleared evidence', async () => {
    vi.useFakeTimers()
    const { app, local, path } = fixture()
    let reply!: (v: any) => void
    const original = vi.fn(
        () =>
          new Promise((r) => {
            reply = r
          })
      ),
      client = {
        commitRaw: original,
        versions: vi.fn(async () => [{ version_id: 'sample-version' }]),
      }
    fake.client.mockReturnValue(client)
    let intercepted!: Promise<any>
    fake.resume.mockImplementation(() => {
      fake.connection.value.paused = false
      intercepted = client.commitRaw([], 'sample-key')
      void intercepted.catch(() => {})
    })
    const work = startPhoneReplay(app),
      failure = expect(work).rejects.toThrow(/not observed/)
    await vi.advanceTimersByTimeAsync(30000)
    await failure
    clearPhoneReplayEvidence(app)
    expect(client.commitRaw).toBe(original)
    reply({
      body: {
        results: [
          { status: 'applied', path: path(), file_id: 'sample-file', version_id: 'sample-version' },
        ],
      },
      replayed: false,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(local.get('task14-phone-replay-evidence')).toBeNull()
    await expect(intercepted).resolves.toMatchObject({ replayed: false })
  })
  it('refuses generic unrelated replay logs even when original history/version/bytes all match', async () => {
    const { app, local } = fixture()
    local.set('task14-phone-replay-evidence', {
      path: 'SampleReplay/sample.md',
      content: 'Native phone replay exact bytes',
      fileId: 'sample-file',
      versionId: 'sample-version',
      beforeCount: 1,
      key: 'wanted-key',
    })
    fake.client.mockReturnValue({ versions: vi.fn(async () => [{ version_id: 'sample-version' }]) })
    fake.log.value = ['push: replaying 1 ops under unrelated-key']
    await expect(verifyPhoneReplay(app)).rejects.toThrow(/evidence failed/)
    expect(local.get('task14-phone-replay-evidence')).not.toBeNull()
  })
})
