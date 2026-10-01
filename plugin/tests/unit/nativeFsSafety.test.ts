// @vitest-environment node
import { promises as fsp } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { nativeOf } from '@/sync/nativeVaultFs'

/** Real link(2), not only a fake adapter's exists check. */
describe('native exclusive installation capability', () => {
  it('never overwrites a recreated target and leaves source bytes recoverable', async () => {
    const scratch = fileURLToPath(new URL('../../../.scratch/batch4/fs-13/', import.meta.url))
    await mkdir(scratch, { recursive: true })
    const dir = await mkdtemp(join(scratch, 'sample-'))
    try {
      const native = nativeOf({
        fsPromises: fsp,
        getFullPath: (path: string) => join(dir, path),
      } as unknown as DataAdapter)!
      await fsp.writeFile(join(dir, 'incoming.tmp'), 'incoming bytes')
      await fsp.writeFile(join(dir, 'sample.md'), 'local recreation')
      await expect(native.installExclusive!('incoming.tmp', 'sample.md')).rejects.toThrow(/EEXIST/)
      expect(await fsp.readFile(join(dir, 'sample.md'), 'utf8')).toBe('local recreation')
      expect(await fsp.readFile(join(dir, 'incoming.tmp'), 'utf8')).toBe('incoming bytes')
      await fsp.unlink(join(dir, 'sample.md'))
      await native.installExclusive!('incoming.tmp', 'sample.md')
      expect(await fsp.readFile(join(dir, 'sample.md'), 'utf8')).toBe('incoming bytes')
      expect(await fsp.readFile(join(dir, 'incoming.tmp'), 'utf8')).toBe('incoming bytes')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
