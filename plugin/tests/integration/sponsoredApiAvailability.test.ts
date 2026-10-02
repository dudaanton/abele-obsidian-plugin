// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { SponsoredAssetsHttpPort } from '@/sync/sharing/sponsoredHttp'
let server: Awaited<ReturnType<typeof scopedApiServer>> | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})
describe('reviewed server sponsored surface availability', () => {
  it('does not invent an extras API behind the existing owner-management fence', async () => {
    server = await scopedApiServer()
    const { accountToken } = await server.account('sample-availability@example.com'),
      { vaultId } = await server.vault(accountToken, 'Sample availability')
    const port = new SponsoredAssetsHttpPort({
      baseUrl: 'http://127.0.0.1',
      fetch: server.fetch,
      enabled: () => true,
    })
    await expect(port.read('sample-grant')).rejects.toMatchObject({
      code: 'sponsored_api_unavailable',
    })
    await expect(
      port.mutate(
        'sample-grant',
        { kind: 'withdraw', fileId: 'sample-file', expectedGeneration: 0 },
        0,
        'sample-intent'
      )
    ).rejects.toMatchObject({ code: 'sponsored_api_unavailable' })
    const path = '/v1/vaults/' + vaultId + '/grants/sample-grant/extras'
    const fenced = await server.closedFetch('http://127.0.0.1' + path, {
      headers: { authorization: 'Bearer ' + accountToken },
    })
    expect(fenced.status).toBe(503)
    const withoutEarlyFence = await server.fetch('http://127.0.0.1' + path, {
      headers: { authorization: 'Bearer ' + accountToken },
    })
    expect(withoutEarlyFence.status).toBe(404)
    const root = process.env.ABELE_SCOPED_API_FIXTURE!
    const files = readdirSync(join(root, 'packages/server/src/api/routes'))
    expect(files.some((f) => /sponsor|extra|publication/i.test(f))).toBe(false)
    const schema = readFileSync(join(root, 'packages/protocol/src/scopedCommits.ts'), 'utf8')
    expect(schema).not.toContain('native_asset')
    expect(schema).not.toContain('sponsors')
  })
})
