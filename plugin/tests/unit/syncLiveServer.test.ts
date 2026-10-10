// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'
import { decodeAccessToken } from '@abele/sync-protocol'
import {
  AccessClient,
  V2EngineClient,
  SyncEngine,
  MemoryFileSystem,
  MemoryStateStore,
  sha256,
} from '@abele/sync-core'
import { spawnSyncServer, fixtureFetch } from '../e2e/helpers/syncServer'
import { defaultSelective } from '@/sync/connection'
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

it('a fresh CLI user issues a group token and its core engine becomes ready without a separate graph worker', async () => {
  const scratch = resolve('../.scratch')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'group-readiness-'))
  const server = await spawnSyncServer(root)
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  let engine: SyncEngine | undefined
  try {
    const owner = new V2EngineClient(server.rootToken, { fetch: fixtureFetch })
    for (const [path, text] of [
      ['SampleGroup.md', 'group'],
      ['member.md', '---\ngroups: ["[[SampleGroup]]"]\n---\nmember'],
    ]) {
      const bytes = new TextEncoder().encode(text),
        sha = await sha256(bytes)
      await owner.putBlob(sha, bytes)
      await owner.commitRaw(
        [{ op: 'create', path, sha, size: bytes.length, mtime: 1000 }],
        crypto.randomUUID()
      )
    }
    const group = (await owner.manifest()).items.find((one) => one.path === 'SampleGroup.md')!
    const token = await server.issue({ kind: 'group', id: group.file_id })
    const client = new V2EngineClient(token, { fetch: fixtureFetch })
    expect((await client.connection()).status).toBe('active')
    engine = new SyncEngine({ client, fs, state, selective: defaultSelective() })
    await engine.sync()
    expect(engine.status.state).toBe('idle')
    expect(new TextDecoder().decode(await fs.read('member.md'))).toContain('member')
  } finally {
    await engine?.stop()
    await server.kill()
    rmSync(root, { recursive: true, force: true })
  }
}, 15000)
