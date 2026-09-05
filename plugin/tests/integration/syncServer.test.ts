// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { syncServer, type SyncServer } from '../helpers/syncServer'

/**
 * The harness itself, proved once. Everything downstream — the service, the settings screens —
 * builds on it, so if the cross-repo wiring breaks (an alias, a moved helper, a sibling that
 * was not installed) this is the test that says so rather than twenty confusing ones.
 *
 * Node, not happy-dom: the server is Fastify on better-sqlite3.
 */
describe('syncServer', () => {
  let server: SyncServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('runs a real server a device can ask for the state of its vault', async () => {
    server = await syncServer()
    const { accountToken } = await server.account()
    const { vaultId } = await server.vault(accountToken)
    const { deviceToken } = await server.device(accountToken, vaultId)

    const client = server.clientFor(deviceToken, vaultId)
    const state = await client.state()

    expect(state.head_seq).toBe(0)
    expect(server.BASE_URL).toMatch(/^https?:\/\//)
    expect(server.TEST_PASSWORD).toBeTruthy()
  })
})
