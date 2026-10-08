import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@abele/sync-core'
import { useVault } from '../helpers/testEnv'
import { setScriptConnection } from '../helpers/scriptConnection'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { TRUST_KEY, noteLocalScriptWrite } from '@/scripting/ScriptTrust'
import {
  preserveLocalScriptVersions,
  LOCAL_SCRIPT_UPGRADE_KEY,
} from '@/scripting/trust/localScriptUpgrade'
import { noteManagedLocalScriptWrite } from '@/scripting/trust/localScriptWrite'
import {
  activateScriptProvenance,
  SCRIPT_TRUST_KEY,
  scriptTrustFor,
} from '@/scripting/trust/scriptTrustStorage'
import { scriptForExecution, assertScriptContext } from '@/scripting/trust/scriptExecutionGate'
import { CONNECTION_KEY, emptyConnection } from '@/sync/connection'
import { SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'
import { SCRIPT_CONTEXT_HOLD_FILE } from '@/scripting/trust/scriptContextHold'

const path = 'Scripts/local.js'
const source = '// @name Local sample\nreturn "local result"'
const binding = {
  endpoint: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal' as const,
  grantId: null,
}
let app: App
let factory: IDBFactory
beforeEach(() => {
  app = useVault([{ path, content: source }]) as unknown as App
  factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function connect(principal = binding.principal) {
  const next = { ...binding, principal }
  setScriptConnection(app, next)
  const trust = await activateScriptProvenance(app, next, factory)
  await trust.provenance.record(path, 'sample-file')
  trust.store.close()
}

describe('device-local script upgrade continuity', () => {
  it.each([false, true])(
    'keeps pre-sync local versions with 1.x checking armed=%s',
    async (armed) => {
      const hash = await sha256(new TextEncoder().encode(source))
      app.saveLocalStorage(TRUST_KEY, {
        armed,
        declined: false,
        scripts: { [path]: { hash, text: source } },
        refused: [],
      })
      await preserveLocalScriptVersions(app)
      await expect(scriptForExecution(app, path)).resolves.toMatchObject({ path })
      await connect()
      await expect(scriptForExecution(app, path)).resolves.toMatchObject({ path })
      app.saveLocalStorage(CONNECTION_KEY, emptyConnection())
      await expect(scriptForExecution(app, path)).resolves.toMatchObject({ path })
      await connect('sample-reconnected-device')
      await expect(scriptForExecution(app, path)).resolves.toMatchObject({ path })
    }
  )
  it('keeps a pre-sync script executable before its first ledger receipt', async () => {
    await preserveLocalScriptVersions(app)
    setScriptConnection(app, binding)
    const trust = await activateScriptProvenance(app, binding, factory)
    trust.store.close()
    await expect(scriptForExecution(app, path)).resolves.toMatchObject({ path })
  })
  it('does not grandfather unapproved or newly received bytes', async () => {
    app.saveLocalStorage(TRUST_KEY, { armed: true, scripts: {}, refused: [] })
    await preserveLocalScriptVersions(app)
    await connect()
    await expect(scriptForExecution(app, path)).rejects.toThrow(/approval/)
  })
  it('does not snapshot again on a downgrade/re-upgrade or trust new synced bytes', async () => {
    await preserveLocalScriptVersions(app)
    await connect()
    await app.vault.adapter.write(path, source + '\n// remote change')
    await preserveLocalScriptVersions(app)
    await expect(scriptForExecution(app, path)).rejects.toThrow(/approval/)
    await expect(scriptForExecution(app, path, async () => true)).resolves.toMatchObject({ path })
  })
  it.each(['create', 'edit'] as const)(
    'keeps an explicit local %s made before first connect in the same session',
    async (operation) => {
      await preserveLocalScriptVersions(app)
      const target = operation === 'create' ? 'Scripts/new-before-connect.js' : path
      const authored = '// @name Authored sample\nreturn "authored locally"'
      await noteLocalScriptWrite(target, authored)
      if (operation === 'create') await app.vault.create(target, authored)
      else await app.vault.adapter.write(target, authored)
      // No plugin restart or second whole-folder snapshot before connecting.
      await connect()
      const trust = await scriptTrustFor(app, factory)
      await trust!.provenance.record(target, 'sample-authored-file')
      trust!.store.close()
      const confirm = vi.fn(async () => true)
      await expect(scriptForExecution(app, target, confirm)).resolves.toMatchObject({
        path: target,
      })
      expect(confirm).not.toHaveBeenCalled()
    }
  )
  it('does not treat native incoming bytes before first connect as explicit authoring', async () => {
    await preserveLocalScriptVersions(app)
    await app.vault.adapter.write(path, source + '\n// incoming edit')
    const incoming = 'Scripts/incoming-before-connect.js'
    await app.vault.create(incoming, '// @name Incoming sample\nreturn "received"')
    await connect()
    const trust = await scriptTrustFor(app, factory)
    await trust!.provenance.record(incoming, 'sample-incoming-file')
    trust!.store.close()
    await expect(scriptForExecution(app, path)).rejects.toThrow(/approval/)
    await expect(scriptForExecution(app, incoming)).rejects.toThrow(/approval/)
  })
  it('does not save an authoring approval from an unconnected scoped context', async () => {
    app.saveLocalStorage(SCOPED_CONNECTION_KEY, { grantId: 'sample-grant' })
    await expect(noteManagedLocalScriptWrite(app, path, source)).rejects.toThrow(/Scoped/)
    expect(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)).toBeNull()
  })
  it('does not save a local authoring decision if a scoped context enters during the check', async () => {
    const exists = app.vault.adapter.exists.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'exists').mockImplementation(async (target) => {
      const present = await exists(target)
      if (target === SCRIPT_CONTEXT_HOLD_FILE)
        app.saveLocalStorage(SCOPED_CONNECTION_KEY, { grantId: 'sample-grant' })
      return present
    })
    await expect(noteManagedLocalScriptWrite(app, path, source)).rejects.toThrow(/Scoped/)
    expect(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)).toBeNull()
  })
  it('records genuinely local new scripts before their sync receipt, not native arrival events', async () => {
    await preserveLocalScriptVersions(app)
    await connect()
    const freshPath = 'Scripts/new-local.js'
    const freshSource = '// @name New local sample\nreturn "new local"'
    await noteLocalScriptWrite(freshPath, freshSource)
    await app.vault.create(freshPath, freshSource)
    await expect(scriptForExecution(app, freshPath)).resolves.toMatchObject({ path: freshPath })
    const incomingPath = 'Scripts/incoming.js'
    await app.vault.create(incomingPath, '// @name Incoming sample\nreturn "incoming"')
    await expect(scriptForExecution(app, incomingPath)).rejects.toThrow(/unknown/)
  })
  it('never grants scoped/shared execution from a local upgrade approval', async () => {
    await preserveLocalScriptVersions(app)
    await connect()
    app.saveLocalStorage(SCOPED_CONNECTION_KEY, { grantId: 'sample-grant' })
    const confirm = vi.fn(async () => true)
    await expect(scriptForExecution(app, path, confirm)).rejects.toThrow(/Scoped/)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('keeps disconnects from accepting an in-flight execution check', async () => {
    await connect()
    await scriptForExecution(app, path, async () => true)
    const checked = await scriptForExecution(app, path)
    app.saveLocalStorage(CONNECTION_KEY, emptyConnection())
    expect(() => assertScriptContext(app, checked)).toThrow(/changed/)
  })
  it('recovers a missing local database only after explicit review while disconnected', async () => {
    await connect()
    app.saveLocalStorage(CONNECTION_KEY, emptyConnection())
    vi.stubGlobal('indexedDB', new IDBFactory())
    const previous = app.loadLocalStorage(SCRIPT_TRUST_KEY)
    await expect(scriptForExecution(app, path)).rejects.toThrow(/Settings.*Scripts.*Library/)
    await expect(scriptForExecution(app, path, async () => false)).rejects.toThrow(/declined/)
    expect(app.loadLocalStorage(SCRIPT_TRUST_KEY)).toEqual(previous)
    const review = vi.fn(async () => true)
    await expect(scriptForExecution(app, path, review)).resolves.toMatchObject({ path })
    expect(review).toHaveBeenCalledOnce()
    const other = 'Scripts/other.js'
    await app.vault.create(other, '// @name Other sample\nreturn "other"')
    await expect(scriptForExecution(app, other)).rejects.toThrow(/unknown/)
  })
  it.each(['source', 'connection', 'scope'] as const)(
    'does not recover if %s changes during review',
    async (change) => {
      await connect()
      app.saveLocalStorage(CONNECTION_KEY, emptyConnection())
      vi.stubGlobal('indexedDB', new IDBFactory())
      const previous = app.loadLocalStorage(SCRIPT_TRUST_KEY)
      await expect(
        scriptForExecution(app, path, async () => {
          if (change === 'source') await app.vault.adapter.write(path, source + '\n// changed')
          else if (change === 'connection') setScriptConnection(app, binding)
          else app.saveLocalStorage(SCOPED_CONNECTION_KEY, { grantId: 'sample-grant' })
          return true
        })
      ).rejects.toThrow(/changed|Scoped/)
      expect(app.loadLocalStorage(SCRIPT_TRUST_KEY)).toEqual(previous)
    }
  )
  it('does not let manual recovery silently replace a connected engine context', async () => {
    await connect()
    vi.stubGlobal('indexedDB', new IDBFactory())
    const confirm = vi.fn(async () => true)
    await expect(scriptForExecution(app, path, confirm)).rejects.toThrow(/Disconnect sync/)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('does not replace a pending remote hold through manual review', async () => {
    await connect()
    const trust = await scriptTrustFor(app, factory)
    await trust!.provenance.pending(path)
    trust!.store.close()
    const confirm = vi.fn(async () => true)
    await expect(scriptForExecution(app, path, confirm)).rejects.toThrow(/unknown/)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('lets a manual review repair a stale binding after a downgrade without running code', async () => {
    await connect()
    app.saveLocalStorage(CONNECTION_KEY, emptyConnection())
    const raw = app.loadLocalStorage(SCRIPT_TRUST_KEY) as any
    app.saveLocalStorage(SCRIPT_TRUST_KEY, {
      ...raw,
      binding: { ...raw.binding, principal: 'old-device' },
    })
    // An offline former personal binding stays fenced to exact reviewed bytes.
    const confirm = vi.fn(async () => true)
    await expect(scriptForExecution(app, path, confirm)).resolves.toMatchObject({ path })
    expect(confirm).toHaveBeenCalledOnce()
    const reopened = await scriptTrustFor(app, factory)
    reopened?.store.close()
  })
})
