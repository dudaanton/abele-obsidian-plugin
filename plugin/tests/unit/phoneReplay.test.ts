// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
const fake = vi.hoisted(() => ({
  svc: {
    status: { value: { state: 'idle', pending: 0 } },
    log: { value: [] as string[] },
    client: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  },
}))
vi.mock('@/sync/SyncService', () => ({ SyncService: { getInstance: () => fake.svc } }))
import { startPhoneReplay, verifyPhoneReplay } from '@/testing/phoneReplay'
import type { App } from 'obsidian'
beforeEach(() => vi.stubGlobal('window', globalThis))
afterEach(() => vi.unstubAllGlobals())
describe('phone replay evidence at the actual response boundary', () => {
  it('reads body.results and persists the actual pre-reload history, not just the replay key', async () => {
    const local = new Map<string, unknown>([['task14-isolated-fixture', { root: 'SampleReplay' }]]),
      files = new Map<string, string>()
    let path = ''
    const app = {
      loadLocalStorage: (k: string) => local.get(k) ?? null,
      saveLocalStorage: (k: string, v: unknown) => local.set(k, v),
      vault: {
        create: async (p: string, body: string) => {
          path = p
          files.set(p, body)
        },
        adapter: { read: async (p: string) => files.get(p) },
      },
    } as unknown as App
    const client = {
      commitRaw: vi.fn(async () => ({
        body: {
          results: [
            { status: 'applied', path, file_id: 'sample-file', version_id: 'sample-version' },
          ],
        },
        replayed: false,
      })),
      versions: vi.fn(async () => [{ version_id: 'sample-version' }]),
    }
    fake.svc.client.mockReturnValue(client)
    fake.svc.resume.mockImplementation(() => {
      void client.commitRaw([], 'sample-key').catch(() => {})
    })
    expect(await startPhoneReplay(app)).toEqual({ beforeCount: 1, captured: true })
    fake.svc.log.value = ['push: replaying 1 ops']
    expect(await verifyPhoneReplay(app)).toEqual({
      beforeCount: 1,
      afterCount: 1,
      versionUnchanged: true,
      localExact: true,
      replayed: true,
    })
    expect(local.get('task14-phone-replay-evidence')).toBeNull()
  })
})
