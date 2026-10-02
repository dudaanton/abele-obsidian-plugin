import { describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { JOURNAL_KEY, RECOVERED_WRITES_KEY } from '@/sync/vaultWrites'
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
  it('has a durable preservation flag before exclusive installation and respects it on restart', async () => {
    const app = buildFakeVault([{ path: 'sample.md', content: 'before' }])
    withDesktopFs(app, { fenced: false })
    const raw = app.vault.adapter as unknown as {
      fsPromises: { link(from: string, to: string): Promise<void> }
    }
    const link = raw.fsPromises.link.bind(raw.fsPromises)
    let snapshot: any[] = [],
      once = true
    raw.fsPromises.link = async (from, to) => {
      if (!once) return link(from, to)
      once = false
      snapshot = JSON.parse(JSON.stringify(app.loadLocalStorage(JOURNAL_KEY)))
      const entry = snapshot[0]
      await app.vault.adapter.writeBinary(
        entry.backup,
        text('late local writer bytes').buffer as ArrayBuffer
      )
      await link(from, to)
      throw new Error('Crash during awaited reconciliation')
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.writeAtomic('sample.md', text('remote replacement'), 9).catch(() => {})
    // Reconstruct the exact crash boundary, before any later catch/finally work ran.
    app.saveLocalStorage(JOURNAL_KEY, snapshot)
    app.saveLocalStorage(RECOVERED_WRITES_KEY, null)
    await listed(new ObsidianFileSystem(app as unknown as App))
    expect(read(await app.vault.adapter.readBinary('sample.md'))).toBe('remote replacement')
    expect(read(await app.vault.adapter.readBinary(snapshot[0].backup))).toBe(
      'late local writer bytes'
    )
    expect(snapshot[0].preserveBackup).toBe(true)
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
