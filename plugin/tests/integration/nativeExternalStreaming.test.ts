// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-sdk/core'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { SerialQueue } from '@/sync/queue'
import { buildFakeVault } from '../helpers/fakeVault'

// A fixed 1 MiB + 7 byte file bounds native staging, installation, byte comparison and cleanup.
it('stages and installs a streamed external file using real native handles and paths', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-external-'))
  const app = buildFakeVault([])
  const bytes = new Uint8Array(1024 * 1024 + 7).fill(31)
  const target = 'notes/sample.bin'
  Object.assign(app.vault.adapter, {
    getFullPath: (path: string) => join(root, path),
    fsPromises: fs,
    mkdir: async (path: string) => {
      await fs.mkdir(join(root, path), { recursive: true })
    },
    exists: async (path: string) =>
      fs.access(join(root, path)).then(
        () => true,
        () => false
      ),
    stat: async (path: string) => {
      try {
        const stat = await fs.stat(join(root, path))
        return {
          type: stat.isFile() ? 'file' : 'folder',
          size: stat.size,
          mtime: stat.mtimeMs,
          ctime: stat.ctimeMs,
        }
      } catch (error) {
        if ((error as { code: string }).code === 'ENOENT') return null
        throw error
      }
    },
    readBinary: async () => {
      throw new Error('whole-file read')
    },
  })
  app.workspace.iterateAllLeaves = () => {}
  const host = new ExternalFileHost(app as unknown as App, {
    platform: 'desktop',
    assertOwned: () => {},
  })
  const close = vi.fn(async () => {})
  const staging = host.artifactPath('.abele-external-sample.incoming')
  try {
    await fs.mkdir(join(root, 'notes'))
    const artifact = {
      operationId: 'sample',
      path: staging,
      role: 'incoming' as const,
      sha: await sha256(bytes),
      size: bytes.length,
    }
    await host.run(
      new SerialQueue(),
      {
        operationId: 'sample',
        fileId: 'sample-file',
        paths: [staging, target],
        assertIntent: () => {},
      },
      async (effects) => {
        expect(
          await effects.stageSource(artifact, {
            size: bytes.length,
            read: async (offset, length) => bytes.slice(offset, offset + length),
            assertUnchanged: async () => {},
            close,
          })
        ).toEqual({ status: 'staged' })
        expect(await fs.readdir(join(root, 'notes'))).toEqual([])
        expect(await effects.install(artifact, target)).toEqual({
          status: 'installed',
          method: 'native-link',
          sourceRetained: true,
        })
      }
    )
    expect(await fs.readFile(join(root, target))).toEqual(Buffer.from(bytes))
    expect(await fs.readdir(join(root, 'notes'))).toEqual(['sample.bin'])
    expect(close).toHaveBeenCalledOnce()
  } finally {
    host.close()
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)
