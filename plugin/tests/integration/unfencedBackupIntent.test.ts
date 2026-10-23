import { describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { JOURNAL_KEY } from '@/sync/vaultWrites'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

const text = (value: string) => new TextEncoder().encode(value)
const read = (value: ArrayBuffer) => new TextDecoder().decode(value)
async function listed(fs: ObsidianFileSystem) {
  const result = []
  for await (const info of fs.list()) result.push(info.path)
  return result
}

describe('unfenced backup crash intent', () => {
  it('has durable capture ownership before exclusive installation and respects it on restart', async () => {
    const app = buildFakeVault([{ path: 'sample.md', content: 'before' }])
    withDesktopFs(app, { fenced: false })
    const raw = app.vault.adapter as unknown as {
      fsPromises: {
        link(from: string, to: string): Promise<void>
        stat(path: string): Promise<{ dev: number; ino: number }>
      }
    }
    const link = raw.fsPromises.link.bind(raw.fsPromises)
    const independentWrite = app.vault.adapter.writeBinary.bind(app.vault.adapter)
    let intent: { path: string; expected: { sha: string }; data: string } | undefined
    let captured = ''
    raw.fsPromises.link = async (from, to) => {
      console.debug('[conditional crash fixture] exclusive link', from, to)
      if (to !== '/vault/sample.md' || intent) return link(from, to)
      const folder = from.slice('/vault/'.length, from.lastIndexOf('/'))
      intent = JSON.parse(await app.vault.adapter.read(folder + '/intent.json'))
      expect(intent?.path).toBe('sample.md')
      expect(intent?.expected.sha).toHaveLength(64)
      const id = folder.split('/').at(-1)
      expect(
        await app.vault.adapter.exists(
          '.obsidian/plugins/abele/sync-conditional/active/' + id + '.json'
        )
      ).toBe(true)
      captured = folder + '/victim'
      await independentWrite(captured, text('late local writer bytes').buffer as ArrayBuffer)
      await link(from, to)
      throw new Error('Crash during awaited reconciliation')
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.writeAtomic('sample.md', text('remote replacement'), 9).catch(() => {})
    expect(intent).toBeDefined()
    await listed(new ObsidianFileSystem(app as unknown as App))
    expect(read(await app.vault.adapter.readBinary('sample.md'))).toBe('remote replacement')
    const recovered = (await app.vault.adapter.list('')).files.filter(
      (path) => path !== 'sample.md'
    )
    expect(recovered).toHaveLength(1)
    expect(read(await app.vault.adapter.readBinary(recovered[0]))).toBe('late local writer bytes')
    const privateAlias = await raw.fsPromises.stat('/vault/' + captured)
    const publicCopy = await raw.fsPromises.stat('/vault/' + recovered[0])
    expect(privateAlias.dev).toBe(publicCopy.dev)
    expect(privateAlias.ino).toBe(publicCopy.ino)
  })
  it('still restores a flagged backup if installation never created a target', async () => {
    const app = buildFakeVault([{ path: '.abele-sync-abcd1234.old', content: 'only local bytes' }])
    app.saveLocalStorage(JOURNAL_KEY, [
      {
        target: 'sample.md',
        backup: '.abele-sync-abcd1234.old',
        preserveBackup: true,
        replacementSha: 'a'.repeat(64),
      },
    ])
    expect(await listed(new ObsidianFileSystem(app as unknown as App))).toEqual(['sample.md'])
    expect(read(await app.vault.adapter.readBinary('sample.md'))).toBe('only local bytes')
  })
})
