// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'
import { decodeAccessToken } from '@abele/sync-protocol'
import { AccessClient } from '@abele/sync-core'
import { spawnSyncServer, fixtureFetch } from '../e2e/helpers/syncServer'
it('the live helper provisions isolated root tokens and issues folder access with the pinned CLI', async () => {
  const scratch = resolve('../.scratch')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'live-server-contract-'))
  const servers = [] as Awaited<ReturnType<typeof spawnSyncServer>>[]
  try {
    for (let i = 0; i < 2; i++) {
      const dir = join(root, 'server-' + i)
      mkdirSync(dir)
      servers.push(await spawnSyncServer(dir))
    }
    const [first, second] = servers,
      token = decodeAccessToken(first.rootToken)
    expect(token.address).toBe(first.url)
    expect(token.scope.kind).toBe('folder')
    expect(token.scope.path).toBe('/')
    expect(second.url).not.toBe(first.url)
    const issued = await first.issue({ kind: 'folder', id: token.scope.id })
    expect(decodeAccessToken(issued).scope).toEqual(token.scope)
    const authority = await AccessClient.fromToken(issued, { fetch: fixtureFetch }).connection()
    expect(authority.status).toBe('active')
    expect(authority.token_id).not.toBe(
      (await AccessClient.fromToken(first.rootToken, { fetch: fixtureFetch }).connection()).token_id
    )
  } finally {
    for (const server of servers) await server.kill()
    rmSync(root, { recursive: true, force: true })
  }
}, 60000)
