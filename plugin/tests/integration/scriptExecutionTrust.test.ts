import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@abele/sync-core'
import type { App } from 'obsidian'
import { ScriptService } from '@/scripting/ScriptService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { activateScriptProvenance } from '@/scripting/trust/scriptTrustStorage'
import { useVault } from '../helpers/testEnv'

let app: ReturnType<typeof useVault>
let service: ScriptService
beforeEach(async () => {
  app = useVault([
    { path: 'Scripts/sample.js', content: '// @name Sample\nreturn "cached"' },
    { path: 'Scripts/parent.js', content: '// @name Parent\nreturn await runScript("Sample")' },
  ])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
  ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = {
    addCommand: vi.fn(),
    removeCommand: vi.fn(),
    addStatusBarItem: () => document.createElement('div'),
  }
  ScriptService.destroy()
  service = ScriptService.getInstance()
  await service.discover()
})
afterEach(() => {
  ScriptService.destroy()
  vi.unstubAllGlobals()
})

describe('common exact-byte script execution gate', () => {
  it('runs current full bytes, not discovery-cached code', async () => {
    await app.vault.modify(
      app.vault.getAbstractFileByPath('Scripts/sample.js') as never,
      '// @name Sample\nreturn "fresh"'
    )
    await expect(service.execute('Scripts/sample.js', {}, { source: 'command' })).resolves.toBe(
      'fresh'
    )
  })
  it('does not execute cached bytes after the file disappears', async () => {
    await app.vault.delete(app.vault.getAbstractFileByPath('Scripts/sample.js') as never)
    await expect(service.execute('Scripts/sample.js', {})).rejects.toThrow()
  })
  it.each(['command', 'note', 'link', 'agent', 'script', 'view', 'automation'] as const)(
    'blocks managed bytes from %s until exact-byte approval exists',
    async (source) => {
      const factory = new IDBFactory()
      vi.stubGlobal('indexedDB', factory)
      const trust = await activateScriptProvenance(
        app as unknown as App,
        {
          endpoint: 'https://sync.example',
          vaultId: 'sample-vault',
          principal: 'sample-device',
          facet: 'personal',
          grantId: null,
        },
        factory
      )
      await trust.provenance.record('Scripts/sample.js', 'sample-file')
      trust.store.close()
      await expect(service.execute('Scripts/sample.js', {}, { source })).rejects.toThrow(/approval/)
    }
  )
  it('blocks a nested child whose managed provenance is unknown', async () => {
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    const trust = await activateScriptProvenance(
      app as unknown as App,
      {
        endpoint: 'https://sync.example',
        vaultId: 'sample-vault',
        principal: 'sample-device',
        facet: 'personal',
        grantId: null,
      },
      factory
    )
    await trust.provenance.record('Scripts/parent.js', 'sample-parent')
    const source = await trust.provenance.lookup('Scripts/parent.js')
    const sha = await sha256(
      new Uint8Array(await app.vault.adapter.readBinary('Scripts/parent.js'))
    )
    await trust.store.setMeta(
      `script-approval:${JSON.stringify([source!.binding, source!.fileId, sha])}`,
      'approved'
    )
    trust.store.close()
    await expect(service.execute('Scripts/parent.js', {})).rejects.toThrow(/provenance/)
  })
})
