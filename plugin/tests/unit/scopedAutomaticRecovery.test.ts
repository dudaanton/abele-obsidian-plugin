import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'

it('arms automatic triggers before the first offline run and re-arms after recovery', async () => {
  const app = buildFakeVault([]),
    state = new MemoryStateStore(),
    meta = new MemoryStateStore()
  const scope = { kind: 'group' as const, id: 'sample-group', path: 'Groups/sample.md' }
  let offline = true
  const failed = vi.fn()
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (offline) throw Error('sample offline connection')
    const path = new URL(String(input)).pathname
    if (path === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope,
        status: 'scope_updating',
        limits: { max_file_bytes: 1000000, quota_bytes: null },
      })
    throw Error('Unexpected file exchange while preparing')
  })
  const make = () =>
    new TokenEngineRuntime({
      id: 'sample-connection',
      encoded: encodeAccessToken({
        v: 1,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        scope,
      }),
      state,
      fs: new ObsidianFileSystem(app as unknown as App),
      fetch: fetcher,
      fallbackMs: 60000,
      reviews: {
        executables: new ExecutableReview(meta),
        attachments: new AttachmentConsent(meta),
        close: () => {},
      },
      covers: async () => false,
      changed: () => {},
      failed,
    })
  const watch = vi.spyOn(ObsidianFileSystem.prototype, 'watch')
  let runtime = make()
  try {
    await runtime.start()
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    expect(watch).toHaveBeenCalledOnce()
    offline = false
    await expect(runtime.sync()).rejects.toMatchObject({ code: 'scope_updating' })
    expect(watch).toHaveBeenCalledOnce()
    await runtime.close()
    runtime = make()
    await runtime.start()
    await vi.waitFor(() => expect(watch).toHaveBeenCalledTimes(2))
  } finally {
    await runtime.close()
    vi.restoreAllMocks()
  }
})
