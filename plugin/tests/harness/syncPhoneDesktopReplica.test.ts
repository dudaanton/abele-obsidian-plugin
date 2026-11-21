// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { open } from '@abele/sync-sdk'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { assertDesktopReplicaReady } from '../e2e/helpers/syncPhoneDesktop'

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  uptime: () => 3600,
}))

it('reports a missing desktop ledger binding before phone work starts', () => {
  expect(() =>
    assertDesktopReplicaReady(() => {
      throw new Error('Could not locate the bindings file')
    })
  ).toThrow(/better-sqlite3 native binding/)
})

it('opens a separate desktop SDK replica using the phone gate connection shape', async () => {
  assertDesktopReplicaReady()
  mkdirSync('../.scratch', { recursive: true })
  const root = mkdtempSync('../.scratch/desktop-replica-')
  const files = join(root, 'files')
  mkdirSync(files)
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const key = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope,
  })
  const routes: string[] = []
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname
    routes.push(path)
    if (path === '/capabilities') return Response.json({ protocol: 2 })
    if (path === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 104857600, quota_bytes: null },
      })
    throw new Error(`Unexpected fixture route: ${path}`)
  }
  let client: Awaited<ReturnType<typeof open>> | undefined
  try {
    client = await open({
      key,
      dir: files,
      stateDir: join(root, 'state'),
      transport: { fetch: fetcher },
    })
    expect(routes).toEqual(['/capabilities', '/v2/connection', '/v2/connection'])
    expect(existsSync(join(root, 'state', 'state.db'))).toBe(true)
  } finally {
    await client?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
