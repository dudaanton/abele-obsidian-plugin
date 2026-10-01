import { describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { JOURNAL_KEY } from '@/sync/vaultWrites'
import { buildFakeVault } from '../helpers/fakeVault'

const ARCHIVE = 'abele-sync-recovered-writes'
const target = 'Notes/sample.md',
  backup = 'Notes/.abele-sync-abcd1234.old',
  temp = 'Notes/.abele-sync-efgh5678.tmp'
const bytes = (text: string) => new TextEncoder().encode(text)
const read = (data: ArrayBuffer) => new TextDecoder().decode(data)
async function list(fs: ObsidianFileSystem) {
  const paths = []
  for await (const file of fs.list()) paths.push(file.path)
  return paths
}
async function sample(installed: boolean) {
  const app = buildFakeVault([
    { path: target, content: 'Local edit after interruption' },
    { path: backup, content: 'Original backup bytes' },
    { path: temp, content: 'Remote replacement' },
  ])
  app.saveLocalStorage(JOURNAL_KEY, [
    { target, backup, temp, installed, replacementSha: await sha256(bytes('Remote replacement')) },
  ])
  return app
}

describe('interrupted mobile swap with independently edited target', () => {
  it.each([false, true])(
    'preserves both copies and resumes scans even when installed=%s',
    async (installed) => {
      const app = await sample(installed)
      const fs = new ObsidianFileSystem(app as unknown as App)
      expect(await list(fs)).toEqual([target])
      expect(read(await app.vault.adapter.readBinary(target))).toBe('Local edit after interruption')
      expect(read(await app.vault.adapter.readBinary(backup))).toBe('Original backup bytes')
      expect(await app.vault.adapter.exists(temp)).toBe(false)
      expect(app.loadLocalStorage(JOURNAL_KEY)).toBeNull()
      expect(app.loadLocalStorage(ARCHIVE)).toEqual([
        { target, backup, replacementSha: await sha256(bytes('Remote replacement')) },
      ])
      expect(await list(new ObsidianFileSystem(app as unknown as App))).toEqual([target])
      expect(await app.vault.adapter.exists(backup)).toBe(true)
    }
  )
  it('keeps the preserved backup after crashing between archive persistence and journal completion', async () => {
    const app = await sample(false)
    const save = app.saveLocalStorage.bind(app)
    let crash = true
    app.saveLocalStorage = (key, value) => {
      if (key === JOURNAL_KEY && value === null && crash) {
        crash = false
        throw new Error('Interrupted completion')
      }
      save(key, value)
    }
    await expect(list(new ObsidianFileSystem(app as unknown as App))).rejects.toThrow()
    expect(app.loadLocalStorage(ARCHIVE)).not.toBeNull()
    // A later reversion to the intended bytes does not revoke a prior preservation decision.
    await app.vault.adapter.writeBinary(target, bytes('Remote replacement').buffer as ArrayBuffer)
    expect(await list(new ObsidianFileSystem(app as unknown as App))).toEqual([target])
    expect(read(await app.vault.adapter.readBinary(backup))).toBe('Original backup bytes')
  })
  it('touches neither copy if its preservation decision cannot be persisted', async () => {
    const app = await sample(false)
    const save = app.saveLocalStorage.bind(app)
    app.saveLocalStorage = (key, value) => {
      if (key === ARCHIVE) throw new Error('Storage full')
      save(key, value)
    }
    await expect(list(new ObsidianFileSystem(app as unknown as App))).rejects.toThrow()
    expect(read(await app.vault.adapter.readBinary(target))).toBe('Local edit after interruption')
    expect(read(await app.vault.adapter.readBinary(backup))).toBe('Original backup bytes')
    expect(app.loadLocalStorage(JOURNAL_KEY)).not.toBeNull()
  })
})
