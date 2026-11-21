// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AccessClient, V2EngineClient } from '@abele/sync-sdk/core'
import { fixtureFetch, spawnSyncServer } from '../e2e/helpers/syncServer'
import { syncDesktopGateReplica } from '../e2e/helpers/syncPhoneDesktop'

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  uptime: () => 3600,
}))

it('pulls files uploaded by another replica into a fresh desktop disk replica', async () => {
  mkdirSync('../.scratch', { recursive: true })
  const root = mkdtempSync('../.scratch/phone-desktop-pull-')
  const server = await spawnSyncServer(root)
  try {
    const count = 100
    const bytes = new TextEncoder().encode('sample bytes')
    const sha = createHash('sha256').update(bytes).digest('hex')
    const owner = new V2EngineClient(server.rootToken, { fetch: fixtureFetch })
    const folder = await owner.commitRaw([{ op: 'mkdir', path: 'Sample' }], randomUUID())
    const folderId = folder.body.results[0]?.file_id
    if (!folderId) throw new Error('Sample folder missing')
    await owner.putBlob(sha, bytes)
    for (let batch = 0; batch < count / 100; batch++) {
      const result = await owner.commitRaw(
        Array.from({ length: 100 }, (_, i) => ({
          op: 'create' as const,
          path: `Sample/sample-${batch * 100 + i}.md`,
          sha,
          size: bytes.length,
          mtime: 1000,
        })),
        randomUUID()
      )
      expect(result.body.results.every((row) => row.status !== 'rejected')).toBe(true)
    }
    const dir = join(root, 'desktop')
    mkdirSync(dir)
    const scoped = await AccessClient.fromToken(server.rootToken, { fetch: fixtureFetch }).issue({
      scope: { kind: 'folder', id: folderId },
      label: 'Sample desktop',
    })
    await syncDesktopGateReplica({
      key: scoped.token,
      dir,
      stateDir: join(root, 'desktop-state'),
      fetch: fixtureFetch,
    })
    for (let i = 0; i < count; i++)
      expect(readFileSync(join(dir, `Sample/sample-${i}.md`))).toEqual(Buffer.from(bytes))
  } finally {
    await server.kill()
    rmSync(root, { recursive: true, force: true })
  }
}, 60_000)
