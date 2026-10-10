import { expect, it, vi } from 'vitest'
import { fetchViaCapacitorHttp, nativeSyncTransportSnapshot } from '@/sync/mobileTransport'
import { ExternalFileHost, externalFileSnapshot } from '@/sync/external/ObsidianExternalFileHost'
import { buildFakeVault } from '../helpers/fakeVault'

it('retains native request timing independent of a removed connection and hides identities', async () => {
  vi.useFakeTimers()
  try {
    const abort = new AbortController()
    const pending = fetchViaCapacitorHttp({ request: () => new Promise<never>(() => {}) })(
      'https://private.example/v2/files/private-file/content?version_id=private-version',
      { signal: abort.signal, headers: { Range: 'bytes=0-1048575' } }
    ).catch((error) => error)
    await vi.advanceTimersByTimeAsync(1000)
    const snapshot = nativeSyncTransportSnapshot()
    expect(snapshot.active).toContainEqual(
      expect.objectContaining({
        operation: 'GET /v2/files/:id/content bytes=0-1048575',
        elapsedMs: 1000,
      })
    )
    expect(JSON.stringify(snapshot)).not.toContain('private')
    abort.abort()
    await pending
    expect(nativeSyncTransportSnapshot().active).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
it('shows a hung local read separately from native network requests', async () => {
  const app = buildFakeVault([])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  let release!: (bytes: ArrayBuffer) => void
  vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const host = new ExternalFileHost(app as never, { platform: 'mobile', assertOwned: () => {} })
  try {
    const read = host.read('private/path.bin')
    expect(externalFileSnapshot().active).toContainEqual(
      expect.objectContaining({ operation: 'readBinary' })
    )
    expect(JSON.stringify(externalFileSnapshot())).not.toContain('private')
    release(new ArrayBuffer(0))
    await read
    expect(externalFileSnapshot().active).toEqual([])
    expect(externalFileSnapshot().requests.at(-1)).toMatchObject({
      operation: 'readBinary',
      outcome: 'complete',
    })
  } finally {
    host.close()
  }
})
