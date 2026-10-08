import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@abele/sync-core'
import { useVault } from '../helpers/testEnv'
import { setScriptConnection } from '../helpers/scriptConnection'
import { activateScriptProvenance, scriptTrustFor } from '@/scripting/trust/scriptTrustStorage'
import { scriptForExecution, assertScriptContext } from '@/scripting/trust/scriptExecutionGate'
import {
  preserveLocalScriptVersions,
  LOCAL_SCRIPT_UPGRADE_KEY,
} from '@/scripting/trust/localScriptUpgrade'
import { TRUST_KEY } from '@/scripting/ScriptTrust'
import { CONNECTION_KEY, emptyConnection } from '@/sync/connection'
import { SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

const path = 'Scripts/local-sample.js'
const source = '// @name Local sample\nreturn "local"'
const binding = {
  endpoint: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal' as const,
  grantId: null,
}
let app: App
let factory: IDBFactory
beforeEach(async () => {
  app = useVault([{ path, content: source }]) as unknown as App
  factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
  // An older managed release already created its healthy personal store. Disconnect and
  // the older local runtime retain it, but have no newer pre-sync migration snapshot.
  setScriptConnection(app, binding)
  const trust = await activateScriptProvenance(app, binding, factory)
  trust.store.close()
  app.saveLocalStorage(CONNECTION_KEY, emptyConnection())
  app.saveLocalStorage(TRUST_KEY, { armed: false, declined: true, scripts: {}, refused: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('returning from a managed release to a disconnected local runtime', () => {
  it('runs a local untracked script under the retained older checking-off policy, without a review dialog', async () => {
    await preserveLocalScriptVersions(app)
    expect(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)).toBeNull()
    const confirm = vi.fn(async () => true)
    await expect(scriptForExecution(app, path, confirm)).resolves.toMatchObject({ path })
    expect(confirm).not.toHaveBeenCalled()
    const trust = await scriptTrustFor(app, factory)
    expect(await trust!.provenance.hasSourceEvidence(path)).toBe(false)
    trust!.store.close()
    // The exact version that already ran locally keeps that decision on a later reconnect.
    setScriptConnection(app, { ...binding, principal: 'sample-reconnected-device' })
    const next = await activateScriptProvenance(
      app,
      { ...binding, principal: 'sample-reconnected-device' },
      factory
    )
    await next.provenance.record(path, 'sample-new-file')
    next.store.close()
    await expect(scriptForExecution(app, path)).resolves.toMatchObject({ path })
  })
  it('honors an exact older approval when checking is on', async () => {
    const hash = await sha256(new TextEncoder().encode(source))
    app.saveLocalStorage(TRUST_KEY, {
      armed: true,
      declined: false,
      scripts: { [path]: { hash, text: source } },
      refused: [],
    })
    await expect(scriptForExecution(app, path)).resolves.toMatchObject({ path })
    await app.vault.adapter.write(path, source + '\n// changed elsewhere')
    await expect(scriptForExecution(app, path)).rejects.toThrow(/approval|confirmed/)
  })
  it('carries a previously explicit local approval into an existing personal receipt without review', async () => {
    const hash = await sha256(new TextEncoder().encode(source))
    app.saveLocalStorage(TRUST_KEY, {
      armed: true,
      declined: false,
      scripts: { [path]: { hash, text: source } },
      refused: [],
    })
    const trust = await scriptTrustFor(app, factory)
    await trust!.provenance.record(path, 'sample-personal-file')
    trust!.store.close()
    await expect(scriptForExecution(app, path)).resolves.toMatchObject({ path })
  })
  it('does not reinterpret a managed remote receipt or pending hold as an untracked local script', async () => {
    for (const pending of [false, true]) {
      const trust = await scriptTrustFor(app, factory)
      if (pending) await trust!.provenance.pending(path)
      else await trust!.provenance.record(path, 'sample-remote-file')
      trust!.store.close()
      await expect(scriptForExecution(app, path)).rejects.toThrow(/approval|unknown/)
    }
  })
  it.each(['personal', 'scoped'] as const)(
    'does not let another %s binding hide a managed receipt behind an unknown lookup',
    async (facet) => {
      const trust = await scriptTrustFor(app, factory)
      await trust!.store.setMeta(
        'script-source:scripts/local-sample.js',
        JSON.stringify({
          binding: {
            ...trust!.provenance.binding,
            principal: 'previous-device',
            facet,
            grantId: facet === 'scoped' ? 'sample-grant' : null,
          },
          path,
          fileId: 'sample-remote-file',
        })
      )
      trust!.store.close()
      await expect(scriptForExecution(app, path)).rejects.toThrow(/unknown/)
    }
  )
  it('invalidates the offline snapshot when a new connection starts', async () => {
    const checked = await scriptForExecution(app, path)
    setScriptConnection(app, binding)
    expect(() => assertScriptContext(app, checked)).toThrow(/changed/)
    await expect(scriptForExecution(app, path)).rejects.toThrow(/unknown|approval/)
  })
  it('rejects a late managed hold during the offline native reread', async () => {
    const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
    let reads = 0
    vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (target) => {
      const bytes = await read(target)
      if (++reads === 2) {
        const writer = await scriptTrustFor(app, factory)
        await writer!.provenance.pending(path)
        writer!.store.close()
      }
      return bytes
    })
    await expect(scriptForExecution(app, path)).rejects.toThrow(/changed/)
  })
  it('rejects an older local approval-policy change at the compilation boundary', async () => {
    const checked = await scriptForExecution(app, path)
    app.saveLocalStorage(TRUST_KEY, { armed: true, scripts: {}, refused: [] })
    expect(() => assertScriptContext(app, checked)).toThrow(/approval.*changed/i)
  })
  it('keeps scoped/shared contexts blocked even with checking off', async () => {
    app.saveLocalStorage(SCOPED_CONNECTION_KEY, { grantId: 'sample-grant' })
    await expect(scriptForExecution(app, path)).rejects.toThrow(/Scoped/)
  })
})
