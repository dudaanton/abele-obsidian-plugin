import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyFiles } from '@/transfer/files'
import type { TransferEntry } from '@/transfer/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ScriptTrust, sha256 } from '@/scripting/ScriptTrust'
import { localScriptVersions } from '@/scripting/trust/localScriptUpgrade'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const source = '// @name Sample import\nreturn "explicit import"'
const target = 'Automation/sample-import.js'
const entry: TransferEntry = {
  section: 'script-files',
  id: 'Scripts/sample-import.js',
  label: 'Sample import',
  data: { path: 'sample-import.js', content: source, base: 'Scripts' },
}
let app: ReturnType<typeof useVault>
beforeEach(() => {
  app = useVault([])
  ScriptTrust.reset()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    scriptsFolder: 'Automation',
    confirmForeignScripts: true,
  }
  ScriptTrust.getInstance().arm([])
})
afterEach(() => {
  vi.restoreAllMocks()
  ScriptTrust.reset()
})

describe('explicitly selected script file transfers', () => {
  it.each([false, true])(
    'persists the selected file before native approval hashing with older checking armed=%s',
    async (armed) => {
      if (!armed) ScriptTrust.getInstance().disarm()
      const hash = await sha256(source)
      const entered = deferred()
      const release = deferred()
      const digest = crypto.subtle.digest.bind(crypto.subtle)
      vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, bytes) => {
        entered.resolve()
        await release.promise
        return digest(algorithm, bytes)
      })
      const applying = applyFiles(app as never, [entry], 'Automation')
      try {
        await entered.promise
        const file = app.vault.getFileByPath(target)
        expect(file).toBeTruthy()
        expect(await app.vault.read(file!)).toBe(source)
        expect(app.vault.getFileByPath('Scripts/sample-import.js')).toBeNull()
        // Arrival alone has not bypassed the existing confirmation policy.
        if (armed) expect(ScriptTrust.getInstance().verdict(target, hash)).toBe('waiting')
        expect(localScriptVersions(app as never)).toEqual([])
      } finally {
        release.resolve()
        await applying
      }
      expect(await applying).toEqual({ written: 1, failed: [] })
      expect(ScriptTrust.getInstance().verdict(target, hash)).toBe('confirmed')
      expect(localScriptVersions(app as never)).toContainEqual({ path: target, sha: hash })
      const other = '// @name Other import\nreturn "unapproved"'
      const otherHash = await sha256(other)
      if (armed) expect(ScriptTrust.getInstance().verdict(target, otherHash)).toBe('waiting')
      expect(localScriptVersions(app as never)).not.toContainEqual({ path: target, sha: otherHash })
    }
  )
  it('does not approve an unselected script or an ordinary arrival', async () => {
    expect(await applyFiles(app as never, [], 'Automation')).toEqual({ written: 0, failed: [] })
    await app.vault.createFolder('Automation')
    await app.vault.create(target, source)
    expect(ScriptTrust.getInstance().verdict(target, await sha256(source))).toBe('waiting')
    expect(localScriptVersions(app as never)).toEqual([])
  })
})
