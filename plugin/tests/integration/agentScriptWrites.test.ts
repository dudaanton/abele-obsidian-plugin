import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { setScriptConnection } from '../helpers/scriptConnection'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { ToolContext } from '@/ai/toolContext'
import { createCreateFileTool } from '@/ai/tools/CreateFileTool'
import { createCreateScriptTool } from '@/ai/tools/CreateScriptTool'
import { createWriteFileTool } from '@/ai/tools/WriteFileTool'
import { createEditFileTool } from '@/ai/tools/EditFileTool'
import { createReplaceTool } from '@/ai/tools/ReplaceTool'
import { createCopyFileTool } from '@/ai/tools/CopyFileTool'
import { createMoveFileTool } from '@/ai/tools/MoveFileTool'
import { createScriptTools } from '@/ai/tools/ScriptTool'
import { createDownloadFileTool } from '@/ai/tools/DownloadImageTool'
import * as http from '@/helpers/http'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptTrust, noteLocalScriptWrite } from '@/scripting/ScriptTrust'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { runStartupScripts } from '@/scripting/startupRunner'
import { scriptForExecution, assertScriptContext } from '@/scripting/trust/scriptExecutionGate'
import { AGENT_SCRIPT_WRITES_KEY } from '@/scripting/trust/agentScriptWrites'
import {
  preserveLocalScriptVersions,
  localScriptVersions,
} from '@/scripting/trust/localScriptUpgrade'
import { activateScriptProvenance } from '@/scripting/trust/scriptTrustStorage'

const path = 'Scripts/sample.js'
const source = '// @name Sample\nreturn "sample result"\n'
let app: App
let service: ScriptService

beforeEach(async () => {
  app = useVault([{ path: 'Notes/sample.md', content: 'Sample note' }]) as unknown as App
  ScriptService.destroy()
  ScriptTrust.reset()
  ScriptRuns.destroy()
  const config = AbeleConfig.getInstance()
  config.ai = { ...DEFAULT_AI_SETTINGS, scriptsEnabled: true, scriptsFolder: 'Scripts' }
  ;(config as unknown as { plugin: unknown }).plugin = {
    addCommand: vi.fn(),
    removeCommand: vi.fn(),
    addStatusBarItem: () => createDiv(),
  }
  ScopeResolver.getInstance().setFullVaultAccess(true)
  service = ScriptService.getInstance()
  await service.discover()
})

afterEach(() => {
  ScriptService.destroy()
  ScriptRuns.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function create() {
  await createCreateFileTool().execute('create', { path, content: source })
  await service.discover()
}

async function held() {
  for (const origin of ['automation', 'startup', 'agent', 'script', 'view'] as const)
    await expect(service.execute(path, {}, { source: origin })).rejects.toThrow(/confirm|approval/)
  await expect(scriptForExecution(app, path)).rejects.toThrow(/approval/)
}

describe('agent file writes do not grant code execution', () => {
  it.each([false, true])('holds a new script with foreign checking=%s', async (checking) => {
    service.setConfirmForeign(checking)
    await create()
    await held()
    expect(await app.vault.read(app.vault.getFileByPath(path)!)).toBe(source)
    expect(ScriptRuns.getInstance().running()).toHaveLength(0)
  })

  it('survives discovery, plugin restart and switching foreign checking off and on', async () => {
    await create()
    service.setConfirmForeign(true)
    service.setConfirmForeign(false)
    ScriptService.destroy()
    ScriptTrust.reset()
    service = ScriptService.getInstance()
    await service.discover()
    await held()
  })

  it('skips an agent-authored startup script', async () => {
    await create()
    const result = await runStartupScripts({
      queue: [service.get(path)!],
      paused: false,
      execute: (path, params, options) => service.execute(path, params, options),
      storage: { load: () => null, save: () => {} },
      notify: vi.fn(),
    })
    expect(result).toEqual([{ name: 'Sample', outcome: 'skipped' }])
  })

  it('does not execute newer bytes behind an approved discovery snapshot', async () => {
    await noteLocalScriptWrite(path, source)
    await app.vault.create(path, source)
    await service.discover()
    await createWriteFileTool().execute('write', { path, content: source + '// agent edit\n' })
    // Deliberately do not rediscover: only the byte-level execution gate sees this edit.
    await expect(service.execute(path, {}, { source: 'automation' })).rejects.toThrow(/approval/)
  })

  it('rechecks a snapshot synchronously before compiling it', async () => {
    await app.vault.create(path, source)
    const snapshot = await scriptForExecution(app, path)
    await createWriteFileTool().execute('write', { path, content: source })
    expect(() => assertScriptContext(app, snapshot)).toThrow(/approval/)
  })

  it.each(['write', 'edit', 'replace'] as const)(
    'holds an agent %s of an owner script',
    async (kind) => {
      await app.vault.create(path, source)
      await service.discover()
      if (kind === 'write')
        await createWriteFileTool().execute(kind, { path, content: source + '// agent edit\n' })
      else if (kind === 'edit')
        await createEditFileTool().execute(kind, {
          path,
          old_string: 'sample result',
          new_string: 'changed result',
        })
      else
        await createReplaceTool().execute(kind, {
          path,
          actions: [
            { type: 'replace-in-content', old_value: 'sample result', value: 'changed result' },
          ],
        })
      await service.discover()
      await held()
    }
  )

  it('holds create_script even when creation itself was approved', async () => {
    await createCreateScriptTool().execute(
      'create-script',
      { name: 'sample', content: source },
      undefined,
      { scope: ScopeResolver.getInstance(), interactive: true, approved: true }
    )
    await service.discover()
    await held()
  })

  it.each(['cp', 'mv'] as const)(
    'holds text renamed to executable code through %s',
    async (kind) => {
      await createCreateFileTool().execute('stage', { path: 'Notes/staged.txt', content: source })
      const tool = kind === 'cp' ? createCopyFileTool() : createMoveFileTool()
      await tool.execute(kind, { from: 'Notes/staged.txt', to: path })
      await service.discover()
      await held()
    }
  )

  it('keeps a pending hash held after a native rename', async () => {
    await create()
    const next = 'Scripts/renamed.js'
    await app.fileManager.renameFile(app.vault.getFileByPath(path)!, next)
    await expect(scriptForExecution(app, next)).rejects.toThrow(/approval/)
  })

  it.each(['cp', 'mv'] as const)(
    'preserves already executable owner code through %s',
    async (kind) => {
      await app.vault.create(path, source)
      await service.discover()
      const to = 'Scripts/owner-copy.js'
      const tool = kind === 'cp' ? createCopyFileTool() : createMoveFileTool()
      await tool.execute(kind, { from: path, to })
      await expect(scriptForExecution(app, to)).resolves.toMatchObject({ path: to })
      if (kind === 'cp')
        expect(await service.execute(path, {}, { source: 'automation' })).toBe('sample result')
    }
  )

  it('holds JavaScript downloaded by the agent without contacting a real service', async () => {
    vi.spyOn(http, 'request').mockResolvedValue({
      status: 200,
      headers: {},
      text: source,
      json: null,
      arrayBuffer: new TextEncoder().encode(source).buffer,
    })
    await createDownloadFileTool().execute('download', {
      url: 'https://files.example/sample',
      filename: 'sample',
      extension: 'js',
    })
    await expect(scriptForExecution(app, 'Attachments/sample.js')).rejects.toThrow(/approval/)
  })

  it('allows only the exact owner-approved version', async () => {
    await create()
    const confirm = vi.fn(async (_request: { source: string }) => true)
    await expect(scriptForExecution(app, path, confirm)).resolves.toMatchObject({ path })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toMatchObject({ source })
    expect(await service.execute(path, {}, { source: 'automation' })).toBe('sample result')
    await createEditFileTool().execute('edit', {
      path,
      old_string: 'sample result',
      new_string: 'changed result',
    })
    await service.discover()
    await held()
  })

  it('does not approve replacement bytes while the owner reviews another version', async () => {
    await create()
    await expect(
      scriptForExecution(app, path, async () => {
        await createWriteFileTool().execute('write', { path, content: source + '// replacement\n' })
        return true
      })
    ).rejects.toThrow(/changed/)
    await expect(scriptForExecution(app, path)).rejects.toThrow(/approval/)
  })

  it('keeps owner-authored scripts working and allows the owner to edit a held script', async () => {
    await app.vault.create(path, source)
    await service.discover()
    expect(await service.execute(path, {}, { source: 'automation' })).toBe('sample result')
    await createWriteFileTool().execute('write', { path, content: source + '// agent edit\n' })
    const authored = source + '// owner edit\n'
    await noteLocalScriptWrite(path, authored)
    await app.vault.modify(app.vault.getFileByPath(path)!, authored)
    await service.discover()
    expect(await service.execute(path, {}, { source: 'automation' })).toBe('sample result')
  })

  it.each(['ask', 'auto', 'approved'] as const)(
    'requires a separate script execution right: %s',
    async (mode) => {
      await create()
      const tool = createScriptTools().find((tool) => tool.name === 'script_sample')!
      expect(tool).toBeDefined()
      const ctx = {
        scope: ScopeResolver.getInstance(),
        interactive: true,
        approved: mode === 'approved',
        session: { getToolMode: () => (mode === 'auto' ? 'auto' : 'ask') },
      } as unknown as ToolContext
      if (mode === 'ask') {
        await expect(tool.execute('run', {}, undefined, ctx)).rejects.toThrow(/approval/)
        await held()
      } else {
        await expect(tool.execute('run', {}, undefined, ctx)).resolves.toMatchObject({
          content: [{ text: 'sample result' }],
        })
        expect(await service.execute(path, {}, { source: 'automation' })).toBe('sample result')
      }
    }
  )

  it('does not write a file if the mandatory hold cannot be persisted', async () => {
    vi.spyOn(app, 'saveLocalStorage').mockImplementation(() => {})
    await expect(
      createCreateFileTool().execute('create', { path, content: source })
    ).rejects.toThrow(/persisted/)
    expect(app.vault.getFileByPath(path)).toBeNull()
  })

  it('does not inherit execution approval from personal sync or its upgrade snapshot', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    await create()
    await preserveLocalScriptVersions(app)
    expect(localScriptVersions(app)).toEqual([])
    const binding = {
      endpoint: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-device',
      facet: 'personal' as const,
      grantId: null,
    }
    setScriptConnection(app, binding)
    const trust = await activateScriptProvenance(app, binding, indexedDB)
    await trust.provenance.record(path, 'sample-file')
    trust.store.close()
    await held()
  })

  it('fails closed if the device-local approval record is damaged', async () => {
    await create()
    app.saveLocalStorage(AGENT_SCRIPT_WRITES_KEY, { paths: 'damaged' })
    await expect(scriptForExecution(app, path)).rejects.toThrow(/unreadable/)
  })
})
