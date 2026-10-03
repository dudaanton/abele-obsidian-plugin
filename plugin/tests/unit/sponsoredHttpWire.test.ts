import { describe, it, expect, vi } from 'vitest'
import { SponsoredAssetsHttpPort } from '@/sync/sharing/sponsoredHttp'
const view = {
  grantId: 'sample-grant',
  revision: 1,
  withdrawalGeneration: 0,
  active: true,
  role: 'editor',
  entries: [],
}
describe('concrete sponsored HTTP wire binding', () => {
  it('uses only personal-device owner asset paths and exact delta bodies, without account fallback', async () => {
    const transport = vi.fn(
        async () =>
          new Response(JSON.stringify(view), { headers: { 'content-type': 'application/json' } })
      ),
      port = new SponsoredAssetsHttpPort({
        baseUrl: 'https://sync.example',
        fetch: transport as any,
        enabled: () => true,
        context: {
          facet: 'personal',
          vaultId: 'sample-vault',
          principalId: 'sample-owner',
          token: () => 'absd_' + 'a'.repeat(43),
        },
      })
    expect(await port.read('sample-grant')).toEqual(view)
    await port.mutate(
      'sample-grant',
      { kind: 'withdraw', fileId: 'sample-target', expectedGeneration: 0 },
      1,
      'sample-intent'
    )
    expect(transport.mock.calls[1][0]).toBe(
      'https://sync.example/v1/vaults/sample-vault/grants/sample-grant/assets/mutate'
    )
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({
      expectedRevision: 1,
      intentId: 'sample-intent',
      delta: { kind: 'withdraw', fileId: 'sample-target', expectedGeneration: 0 },
    })
  })
  it('keeps native creation/proof scoped, with no personal token fallback', async () => {
    const transport = vi.fn(),
      port = new SponsoredAssetsHttpPort({
        baseUrl: 'https://sync.example',
        fetch: transport,
        enabled: () => true,
        context: {
          facet: 'scoped',
          vaultId: 'sample-vault',
          principalId: 'sample-install',
          token: () => 'absd_' + 'a'.repeat(43),
        },
      })
    await expect(port.read('sample-grant')).rejects.toThrow(/facet|credential/)
    expect(transport).not.toHaveBeenCalled()
  })
})
