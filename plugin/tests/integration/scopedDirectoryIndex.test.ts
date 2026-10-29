// @vitest-environment node
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { desktopFsPort } from '../helpers/desktopRequire'
import { countedDisk, nativeVault } from '../helpers/nativeRestartVault'

it('inventories a settled scoped folder index without walking 33000 file paths on disk', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-scoped-index-')))
  const paths = Array.from(
    { length: 33000 },
    (_, i) => `Sample/Section ${i % 200}/sample-${i}.md`
  )
  let fileProbes = 0
  const counted = countedDisk(undefined, undefined, (method, path) => {
    if (method === 'lstat' && path.endsWith('.md')) fileProbes++
  })
  desktopFsPort(counted.port)
  try {
    for (let i = 0; i < 200; i++)
      await disk.mkdir(join(root, `Sample/Section ${i}`), { recursive: true })
    const app = nativeVault(root, counted.port, paths)
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
    const open = () => new ObsidianFileSystem(app as never, {
      fileScope: 'Sample',
      prepareStartupInventory: async () => {},
    })
    await Array.fromAsync(open().listDirectories())
    counted.calls.clear()
    fileProbes = 0
    const folders = await Array.fromAsync(open().listDirectories())
    console.log('scoped indexed directory calls', Object.fromEntries(counted.calls))
    expect(folders).toHaveLength(201)
    expect(counted.calls.get('readdir') ?? 0).toBe(0)
    expect(fileProbes).toBe(0)
  } finally {
    await disk.rm(root, { recursive: true, force: true })
  }
}, 240000)
