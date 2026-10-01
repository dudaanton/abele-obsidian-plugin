import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { useVault } from '../helpers/testEnv'
import { activateScriptProvenance, scriptTrustFor } from '@/scripting/trust/scriptTrustStorage'
import { scriptForExecution, assertScriptContext } from '@/scripting/trust/scriptExecutionGate'
import { CONNECTION_KEY } from '@/sync/connection'

const path = 'Scripts/sample.js'
const bytes = '// @name Sample\nreturn "approved"'
let app: ReturnType<typeof useVault>
let factory: IDBFactory
beforeEach(() => {
  app = useVault([{ path, content: bytes }])
  factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
})
afterEach(() => vi.unstubAllGlobals())
async function managed(facet: 'personal' | 'scoped' = 'personal', principal = 'sample-device') {
  app.saveLocalStorage(CONNECTION_KEY, {
    serverUrl: 'https://sync.example',
    enrolledUrl: 'https://sync.example',
    vaultId: 'sample-vault',
    deviceId: principal,
    facet,
    grantId: facet === 'scoped' ? 'sample-grant' : null,
  })
  const context = await activateScriptProvenance(
    app as unknown as App,
    {
      endpoint: 'https://sync.example',
      vaultId: 'sample-vault',
      principal,
      facet,
      grantId: facet === 'scoped' ? 'sample-grant' : null,
    },
    factory
  )
  await context.provenance.record(path, 'sample-file')
  context.store.close()
}

describe('exact-byte local script approval', () => {
  it('approves the shown version only on this device and runs its actual bytes', async () => {
    await managed()
    const confirm = vi.fn(async () => true)
    const script = await scriptForExecution(app as unknown as App, path, confirm)
    expect(script.code).toContain('return "approved"')
    expect(confirm).toHaveBeenCalledOnce()
    await scriptForExecution(app as unknown as App, path, confirm)
    expect(confirm).toHaveBeenCalledOnce()
  })
  it('does not approve or run changed bytes while the dialog is open', async () => {
    await managed()
    await expect(
      scriptForExecution(app as unknown as App, path, async () => {
        await app.vault.modify(
          app.vault.getAbstractFileByPath(path) as never,
          bytes + '\n// changed'
        )
        return true
      })
    ).rejects.toThrow(/changed/)
    const context = await scriptTrustFor(app as unknown as App, factory)
    expect(
      await context!.provenance.approved(
        (await context!.provenance.lookup(path))!,
        await sha256(new TextEncoder().encode(bytes))
      )
    ).toBe(false)
    context!.store.close()
  })
  it('invalidates an approval when the identity changes despite identical bytes', async () => {
    await managed()
    await expect(
      scriptForExecution(app as unknown as App, path, async () => {
        const context = await scriptTrustFor(app as unknown as App, factory)
        await context!.provenance.record(path, 'replacement-file')
        context!.store.close()
        return true
      })
    ).rejects.toThrow(/changed/)
  })
  it('does not reuse an approval after changing principal', async () => {
    await managed()
    await scriptForExecution(app as unknown as App, path, async () => true)
    await managed('personal', 'other-device')
    await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/approval/)
  })
  it('does not approve a second local vault or installation with the same remote identity', async () => {
    await managed()
    await scriptForExecution(app as unknown as App, path, async () => true)
    const other = useVault([{ path, content: bytes }])
    other.saveLocalStorage(CONNECTION_KEY, app.loadLocalStorage(CONNECTION_KEY))
    const context = await activateScriptProvenance(
      other as unknown as App,
      {
        endpoint: 'https://sync.example',
        vaultId: 'sample-vault',
        principal: 'sample-device',
        facet: 'personal',
        grantId: null,
      },
      factory
    )
    await context.provenance.record(path, 'sample-file')
    context.store.close()
    await expect(scriptForExecution(other as unknown as App, path)).rejects.toThrow(/approval/)
  })

  it('refuses scoped scripts even when a caller supplies a confirmation handler', async () => {
    await managed('scoped')
    const confirm = vi.fn(async () => true)
    await expect(scriptForExecution(app as unknown as App, path, confirm)).rejects.toThrow(/refuse/)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('detects a facet switch during the final native read, not only before it', async () => {
    await managed()
    await scriptForExecution(app as unknown as App, path, async () => true)
    const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
    let count = 0
    vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (target) => {
      const result = await read(target)
      if (++count === 2) {
        const descriptor = app.loadLocalStorage('abele-script-provenance') as any
        app.saveLocalStorage('abele-script-provenance', {
          ...descriptor,
          binding: { ...descriptor.binding, facet: 'scoped', grantId: 'changed-grant' },
        })
      }
      return result
    })
    await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/changed/)
  })

  it('detects identity replacement during the final native read even with identical bytes', async () => {
    await managed()
    await scriptForExecution(app as unknown as App, path, async () => true)
    const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
    let count = 0
    vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (target) => {
      const result = await read(target)
      if (++count === 2) {
        const context = await scriptTrustFor(app as unknown as App, factory)
        await context!.provenance.record(path, 'final-replacement')
        context!.store.close()
      }
      return result
    })
    await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/changed/)
  })

  it('invalidates an open decision when the actual connection changes before a joined engine exists', async () => {
    await managed()
    await expect(
      scriptForExecution(app as unknown as App, path, async () => {
        app.saveLocalStorage(CONNECTION_KEY, {
          serverUrl: 'https://other.example',
          enrolledUrl: 'https://other.example',
          vaultId: 'other-vault',
          deviceId: 'other-device',
          join: { vaultId: 'other-vault', ask: true, prefer: null },
        })
        return true
      })
    ).rejects.toThrow(/changed/)
  })
  it('does not reuse old approval while the actual new connection waits for a join answer', async () => {
    await managed()
    const checked = await scriptForExecution(app as unknown as App, path, async () => true)
    app.saveLocalStorage(CONNECTION_KEY, {
      serverUrl: 'https://sync.example',
      enrolledUrl: 'https://sync.example',
      vaultId: 'other-vault',
      deviceId: 'other-device',
      join: { vaultId: 'other-vault', ask: true, prefer: null },
    })
    expect(() => assertScriptContext(app as unknown as App, checked)).toThrow(/changed/)
    await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/changed/)
  })

  it('does not keep an unconnected local snapshot executable after a managed join begins', async () => {
    const checked = await scriptForExecution(app as unknown as App, path)
    app.saveLocalStorage(CONNECTION_KEY, {
      serverUrl: 'https://sync.example',
      enrolledUrl: 'https://sync.example',
      vaultId: 'sample-vault',
      deviceId: 'sample-device',
      join: { vaultId: 'sample-vault', ask: true, prefer: null },
    })
    expect(() => assertScriptContext(app as unknown as App, checked)).toThrow(/changed/)
  })

  it('does not store permission on decline', async () => {
    await managed()
    await expect(
      scriptForExecution(app as unknown as App, path, async () => false)
    ).rejects.toThrow(/approval/)
    await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/approval/)
  })
})
