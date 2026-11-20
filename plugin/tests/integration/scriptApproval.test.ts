import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-sdk/core'
import { useVault, configureAbele } from '../helpers/testEnv'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptTrust, TRUST_KEY, noteLocalScriptWrite } from '@/scripting/ScriptTrust'
import * as reviewDialogs from '@/scripting/reviewScript'
import { noteAgentScriptWrite } from '@/scripting/trust/agentScriptWrites'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { activateScriptProvenance, scriptTrustFor } from '@/scripting/trust/scriptTrustStorage'
import { scriptForExecution, assertScriptContext } from '@/scripting/trust/scriptExecutionGate'
import { CONNECTION_KEY } from '@/sync/connection'
import { ScriptProvenance } from '@/scripting/trust/ScriptProvenance'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ScriptExecutor } from '@/scripting/ScriptExecutor'
import { scriptApprovalDialog, cancelScriptApprovals } from '@/scripting/trust/scriptApprovalPrompt'

const path = 'Scripts/sample.js'
const bytes = '// @name Sample\nreturn "approved"'
let app: ReturnType<typeof useVault>
let factory: IDBFactory
beforeEach(() => {
  app = useVault([{ path, content: bytes }])
  factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
})
afterEach(() => {
  cancelScriptApprovals()
  ScriptService.destroy()
  ScriptTrust.reset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
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
  it.each(['review', 'author'] as const)(
    'preserves an explicit %s receipt across restart and optional toggles',
    async (origin) => {
      const config = configureAbele()
      const previousAi = config.ai
      try {
        config.ai = {
          ...DEFAULT_AI_SETTINGS,
          scriptsFolder: 'Scripts',
          confirmForeignScripts: false,
        }
        const hash = await sha256(new TextEncoder().encode(bytes))
        if (origin === 'review') ScriptTrust.getInstance().confirm({ path, hash, text: bytes })
        else await noteLocalScriptWrite(path, bytes)
        ScriptTrust.getInstance().disarm()
        ScriptTrust.getInstance().allowArming()
        ScriptTrust.reset()
        await managed()
        const confirm = vi.fn(async () => true)
        await expect(
          scriptForExecution(app as unknown as App, path, confirm)
        ).resolves.toMatchObject({ path })
        expect(confirm).not.toHaveBeenCalled()
        await app.vault.adapter.write(path, bytes + '\n// unreviewed replacement')
        await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/approval/)
      } finally {
        config.ai = previousAi
      }
    }
  )

  it('keeps existing managed approval when legacy records have no explicit marker', async () => {
    await managed()
    await scriptForExecution(app as unknown as App, path, async () => true)
    const hash = await sha256(new TextEncoder().encode(bytes))
    app.saveLocalStorage(TRUST_KEY, {
      armed: true,
      scripts: { [path]: { hash, text: bytes } },
      refused: [],
    })
    ScriptTrust.reset()
    const confirm = vi.fn(async () => true)
    await expect(scriptForExecution(app as unknown as App, path, confirm)).resolves.toMatchObject({
      path,
    })
    expect(confirm).not.toHaveBeenCalled()
  })

  it.each(['run', 'shield'] as const)(
    'does not promote a synced automatic baseline after restart through %s',
    async (entry) => {
      const config = configureAbele()
      const previousAi = config.ai
      const pluginConfig = config as unknown as { plugin: unknown }
      const previousPlugin = pluginConfig.plugin
      try {
        // The script and this enabled setting arrived together on a new device.
        config.ai = {
          ...DEFAULT_AI_SETTINGS,
          scriptsFolder: 'Scripts',
          confirmForeignScripts: true,
        }
        pluginConfig.plugin = { addCommand: vi.fn(), removeCommand: vi.fn() }
        expect(app.loadLocalStorage(TRUST_KEY)).toBeNull()
        await managed()
        const service = ScriptService.getInstance()
        await service.discover()
        const snapshot = service.get(path)!
        expect(service.verdict(snapshot)).toBe('confirmed')
        expect(ScriptTrust.getInstance().lastConfirmed(path)).toBeUndefined()
        // Recreate the runtime against the persisted device-local state and IndexedDB.
        ScriptService.destroy()
        ScriptTrust.reset()
        const restarted = ScriptService.getInstance()
        if (entry === 'run') {
          await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/approval/)
          const confirm = vi.fn(async (request) => {
            expect(request.source).toBe(bytes)
            expect(request.sha).toBe(snapshot.hash)
            return true
          })
          await scriptForExecution(app as unknown as App, path, confirm)
          expect(confirm).toHaveBeenCalledOnce()
        } else {
          let settled = false
          const reviewing = restarted.review(snapshot).finally(() => {
            settled = true
          })
          await vi.waitFor(() => expect(settled || !!scriptApprovalDialog.value).toBe(true))
          const shown = scriptApprovalDialog.value
          shown?.answer(true)
          await reviewing
          expect(shown).not.toBeNull()
          expect(shown!.source).toBe(bytes)
          expect(shown!.sha).toBe(snapshot.hash)
          expect(shown!.previousSource).toBeUndefined()
        }
        ScriptService.destroy()
        ScriptTrust.reset()
        const again = vi.fn(async () => true)
        await expect(scriptForExecution(app as unknown as App, path, again)).resolves.toMatchObject(
          { path }
        )
        expect(again).not.toHaveBeenCalled()
      } finally {
        ScriptService.destroy()
        config.ai = previousAi
        pluginConfig.plugin = previousPlugin
      }
    }
  )

  it.each([false, true])(
    'requires displayed managed consent when optional checking is off (accept=%s)',
    async (accept) => {
      const config = configureAbele()
      const previousAi = config.ai
      try {
        config.ai = { ...DEFAULT_AI_SETTINGS, confirmForeignScripts: false }
        ScriptTrust.reset()
        await managed()
        const service = ScriptService.getInstance()
        const snapshot = {
          path,
          hash: await sha256(new TextEncoder().encode(bytes)),
          source: bytes,
          code: 'return "approved"',
          commandId: '',
          meta: { name: 'Sample', description: '', params: [] },
        }
        const optionalReview = vi.spyOn(reviewDialogs, 'reviewScript')
        expect(service.verdict(snapshot)).toBe('confirmed')
        await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/approval/)
        let settled = false
        const reviewing = service.review(snapshot).then(
          () => {
            settled = true
            return true
          },
          () => {
            settled = true
            return false
          }
        )
        await vi.waitFor(() => expect(settled || !!scriptApprovalDialog.value).toBe(true))
        const shown = scriptApprovalDialog.value
        // Settle even the broken implementation, so failure cannot leave a pending dialog.
        shown?.answer(accept)
        const result = await reviewing
        expect(optionalReview).not.toHaveBeenCalled()
        expect(shown).not.toBeNull()
        expect(shown!.source).toBe(bytes)
        expect(shown!.sha).toBe(snapshot.hash)
        expect(result).toBe(accept)
        if (accept) {
          await expect(scriptForExecution(app as unknown as App, path)).resolves.toMatchObject({
            code: snapshot.code,
          })
          await expect(service.review(snapshot)).resolves.toBe(true)
          expect(scriptApprovalDialog.value).toBeNull()
        } else {
          await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/approval/)
        }
      } finally {
        config.ai = previousAi
      }
    }
  )

  it('reviews managed agent bytes once and keeps a diff baseline with foreign checking off', async () => {
    const config = configureAbele()
    const previousAi = config.ai
    try {
      config.ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts', confirmForeignScripts: false }
      ScriptTrust.reset()
      ScriptService.destroy()
      await noteAgentScriptWrite(app as unknown as App, path, bytes, 'sample-chat')
      await managed()
      const service = ScriptService.getInstance()
      vi.spyOn(reviewDialogs, 'reviewScript').mockResolvedValue(true)
      let settled = false
      const reviewing = service
        .review({
          path,
          hash: await sha256(new TextEncoder().encode(bytes)),
          source: bytes,
          code: 'return "approved"',
          commandId: '',
          meta: { name: 'Sample', description: '', params: [] },
        })
        .then(
          () => (settled = true),
          () => (settled = true)
        )
      await vi.waitFor(() => expect(settled || !!scriptApprovalDialog.value).toBe(true))
      const extraReview = !!scriptApprovalDialog.value
      scriptApprovalDialog.value?.answer(false)
      await reviewing
      expect(extraReview).toBe(false)
      ScriptTrust.reset()
      expect(ScriptTrust.getInstance().lastConfirmed(path)).toBe(bytes)
      await expect(scriptForExecution(app as unknown as App, path)).resolves.toMatchObject({
        code: 'return "approved"',
      })
      const changed = bytes + '\n// later edit'
      await noteAgentScriptWrite(app as unknown as App, path, changed, 'sample-chat')
      await app.vault.adapter.write(path, changed)
      await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/approval/)
    } finally {
      config.ai = previousAi
    }
  })

  it('stops the owning execution before settling its approval and never starts its script', async () => {
    await managed()
    let signal: AbortSignal | undefined
    const executor = new ScriptExecutor({
      admit: vi.fn(async (_path, _source, admittedSignal) => {
        signal = admittedSignal
        return {} as never
      }),
      execute: vi.fn(),
      showParamForm: vi.fn(),
    })
    const run = vi.spyOn(executor as unknown as { run: () => Promise<never> }, 'run')
    const result = executor
      .execute(path, {}, { source: 'command', allowApprovalPrompt: true })
      .then(
        () => 'executed',
        (error: Error) => error.message
      )
    await vi.waitFor(() => expect(scriptApprovalDialog.value).not.toBeNull())
    scriptApprovalDialog.value!.stop()
    expect(signal!.aborted).toBe(true)
    expect(await result).toContain('approval')
    expect(run).not.toHaveBeenCalled()
    expect(scriptApprovalDialog.value).toBeNull()
  })
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

  it.each(['pending', 'replacement'])(
    'rejects %s written while the final approved read is awaited',
    async (mutation) => {
      await managed()
      await scriptForExecution(app as unknown as App, path, async () => true)
      const approved = ScriptProvenance.prototype.approved
      let calls = 0
      vi.spyOn(ScriptProvenance.prototype, 'approved').mockImplementation(
        async function (record, sha) {
          const result = await approved.call(this, record, sha)
          if (++calls === 2) {
            const writer = await scriptTrustFor(app as unknown as App, factory)
            if (mutation === 'pending') await writer!.provenance.pending(path)
            else await writer!.provenance.record(path, 'new-identity')
            writer!.store.close()
          }
          return result
        }
      )
      await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/changed/)
    }
  )
  it('rechecks provenance synchronously at the compilation boundary', async () => {
    await managed()
    const checked = await scriptForExecution(app as unknown as App, path, async () => true)
    const writer = await scriptTrustFor(app as unknown as App, factory)
    await writer!.provenance.pending(path)
    writer!.store.close()
    expect(() => assertScriptContext(app as unknown as App, checked)).toThrow(/changed/)
  })

  it('does not grant the moved identity to a same-byte recreation at its old path', async () => {
    await managed()
    await scriptForExecution(app as unknown as App, path, async () => true)
    const moved = 'Scripts/moved.js'
    await app.vault.adapter.rename(path, moved)
    const writer = await scriptTrustFor(app as unknown as App, factory)
    await writer!.provenance.rename(path, moved)
    writer!.store.close()
    await app.vault.create(path, bytes)
    await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/unknown/)
    expect((await scriptForExecution(app as unknown as App, moved)).code).toContain(
      'return "approved"'
    )
  })

  it('keeps the initial generation when a complete same-identity mutation finishes during final IDB open', async () => {
    await managed()
    await scriptForExecution(app as unknown as App, path, async () => true)
    const writer = await scriptTrustFor(app as unknown as App, factory)
    const open = IndexedDbStateStore.open
    let calls = 0
    vi.spyOn(IndexedDbStateStore, 'open').mockImplementation(async (...args) => {
      const result = await open(...args)
      if (++calls === 2) {
        await writer!.provenance.pending(path)
        await app.vault.adapter.writeBinary(
          path,
          new TextEncoder().encode(bytes + '\n// new content').buffer as ArrayBuffer
        )
        await writer!.provenance.record(path, 'sample-file')
      }
      return result
    })
    try {
      await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/changed/)
    } finally {
      writer!.store.close()
    }
  })

  it('also refuses stale bytes if mutation completes during the initial store open', async () => {
    await managed()
    await scriptForExecution(app as unknown as App, path, async () => true)
    const writer = await scriptTrustFor(app as unknown as App, factory)
    const open = IndexedDbStateStore.open
    let first = true
    vi.spyOn(IndexedDbStateStore, 'open').mockImplementation(async (...args) => {
      const result = await open(...args)
      if (first) {
        first = false
        await writer!.provenance.pending(path)
        await app.vault.adapter.writeBinary(
          path,
          new TextEncoder().encode(bytes + '\n// advanced during initial open')
            .buffer as ArrayBuffer
        )
        await writer!.provenance.record(path, 'sample-file')
      }
      return result
    })
    try {
      await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/changed/)
    } finally {
      writer!.store.close()
    }
  })

  it('does not store permission on decline', async () => {
    await managed()
    await expect(
      scriptForExecution(app as unknown as App, path, async () => false)
    ).rejects.toThrow(/approval/)
    await expect(scriptForExecution(app as unknown as App, path)).rejects.toThrow(/approval/)
  })
})
