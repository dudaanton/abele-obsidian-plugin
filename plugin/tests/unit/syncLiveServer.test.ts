// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { resolve, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { networkInterfaces } from 'node:os'
import { execFileSync } from 'node:child_process'
import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import {
  AccessClient,
  V2EngineClient,
  SyncEngine,
  MemoryFileSystem,
  MemoryStateStore,
  sha256,
} from '@abele/sync-sdk/core'
import { spawnSyncServer, fixtureFetch, syncFixtureNetwork } from '../e2e/helpers/syncServer'
import { defaultSelective } from '@/sync/connection'

it.each([
  '127.0.0.1',
  'localhost',
  '0.0.0.0',
  '[::1]',
  'https://sample.example',
  'sample.example:123',
  'sample example',
])('refuses an unusable advertised phone host: %s', (host) => {
  expect(() =>
    syncFixtureNetwork(12345, { E2E_TARGET: 'phone', ABELE_SYNC_PHONE_HOST: host })
  ).toThrow('ABELE_SYNC_PHONE_HOST')
})
it('defaults phone tokens to loopback for the reverse tunnel', () => {
  expect(syncFixtureNetwork(12345, { E2E_TARGET: 'phone' })).toEqual({
    url: 'http://127.0.0.1:12345',
  })
})

it('keeps a LAN hostname in the TLS endpoint and leaves desktop loopback unchanged', () => {
  expect(
    syncFixtureNetwork(12345, { E2E_TARGET: 'phone', ABELE_SYNC_PHONE_HOST: 'sync.example' })
  ).toEqual({ phoneHost: 'sync.example', url: 'https://sync.example:12345' })
  expect(syncFixtureNetwork(12345, { E2E_TARGET: 'desktop' })).toEqual({
    url: 'http://127.0.0.1:12345',
  })
})

it('phone fixtures listen on the LAN and root and shared tokens advertise that address', async () => {
  const host = Object.values(networkInterfaces())
    .flat()
    .find((one) => one && !one.internal && one.family === 'IPv4')?.address
  if (!host) throw new Error('This fixture network check requires a LAN IPv4 interface')
  const root = mkdtempSync(join(resolve('../.scratch'), 'phone-network-'))
  const cert = join(root, 'certificate.pem'),
    key = join(root, 'key.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=Fixture',
      '-addext',
      `subjectAltName=IP:${host}`,
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' }
  )
  vi.stubEnv('E2E_TARGET', 'phone')
  vi.stubEnv('ABELE_SYNC_PHONE_HOST', host)
  vi.stubEnv('ABELE_SYNC_PHONE_TLS_CERT', cert)
  vi.stubEnv('ABELE_SYNC_PHONE_TLS_KEY', key)
  vi.stubEnv('ABELE_SYNC_PHONE_TLS_CA', cert)
  let server: Awaited<ReturnType<typeof spawnSyncServer>> | undefined
  let socket: WebSocket | undefined
  try {
    server = await spawnSyncServer(root)
    const token = decodeAccessToken(server.rootToken),
      expected = `https://${host}:${new URL(server.url).port}`
    expect(token.address).toBe(expected)
    expect((await fixtureFetch(expected + '/healthz')).ok).toBe(true)
    const shared = await server.issue({ kind: 'folder', id: token.scope.id })
    expect(decodeAccessToken(shared).address).toBe(expected)
    expect(
      (await AccessClient.fromToken(shared, { fetch: fixtureFetch }).connection()).status
    ).toBe('active')
    socket = new WebSocket(expected.replace('https:', 'wss:') + '/v2/events', {
      ca: readFileSync(cert),
    })
    const changed = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('TLS fixture notification did not arrive')),
        3000
      )
      socket!.on('open', () => socket!.send(JSON.stringify({ token: token.key })))
      socket!.on('message', (data) => {
        const event = JSON.parse(String(data))
        if (event.type === 'changes' && event.cursor > 0) {
          clearTimeout(timeout)
          resolve(event.cursor)
        }
      })
      socket!.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
    const remote = new V2EngineClient(shared, { fetch: fixtureFetch }),
      bytes = new TextEncoder().encode('TLS content'),
      sha = await sha256(bytes)
    await remote.putBlob(sha, bytes)
    await remote.commitRaw(
      [{ op: 'create', path: 'sample.md', sha, size: bytes.length, mtime: 1000 }],
      crypto.randomUUID()
    )
    expect(await changed).toBeGreaterThan(0)
    const item = (await remote.manifest()).items.find((one) => one.path === 'sample.md')!
    expect(new TextDecoder().decode(await remote.versionBytes(item.file_id, item.version_id))).toBe(
      'TLS content'
    )
  } finally {
    socket?.terminate()
    await server?.kill()
    rmSync(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  }
}, 15000)
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
