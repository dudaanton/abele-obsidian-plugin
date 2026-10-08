import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptTrust } from '@/scripting/ScriptTrust'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { activateScriptProvenance } from '@/scripting/trust/scriptTrustStorage'
import { scriptForExecution } from '@/scripting/trust/scriptExecutionGate'
import { SCRIPT_FIXTURE } from '../e2e/helpers/scriptFixture'
import { useVault } from '../helpers/testEnv'

const PATH = 'Sample scripts/fixture.js'
const SOURCE = '// @name Sample fixture\nreturn "approved fixture"'
let app: ReturnType<typeof useVault>
let config: AbeleConfig
const run = (body: string) =>
  new Function('app', `return (async () => { ${SCRIPT_FIXTURE}\n${body} })()`)(app)

beforeEach(async () => {
  app = useVault([
    { path: PATH, content: SOURCE },
    { path: 'Sample scripts/other.js', content: '// @name Other\nreturn "other"' },
  ])
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  config = AbeleConfig.getInstance()
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: false,
    scriptsEnabled: false,
    scriptsFolder: 'Original scripts',
  }
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  ;(app.vault as any).getConfig = () => ['editor:toggle-bold']
  ;(app.vault as any).setConfig = vi.fn()
  ;(app.vault as any).saveConfig = vi.fn(async () => {})
  ;(config as any).plugin = {
    addCommand: vi.fn(),
    removeCommand: vi.fn(),
    addStatusBarItem: () => document.createElement('div'),
  }
  ScriptService.destroy()
  ScriptTrust.reset()
  ;(window as any).__abeleTest = {
    AbeleConfig,
    ScriptService,
    ScriptTrust,
    scriptTrust: { load: scriptForExecution },
  }
  const context = await activateScriptProvenance(
    app as unknown as App,
    {
      endpoint: 'local:',
      vaultId: 'local',
      principal: 'local',
      facet: 'personal',
      grantId: null,
    },
    factory
  )
  await context.store.setMeta('unrelated-evidence', 'keep this')
  context.store.close()
})
afterEach(() => {
  ScriptService.destroy()
  ScriptTrust.reset()
  delete (window as any).__abeleTest
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('script fixture prerequisites and ownership', () => {
  it('approves only exact fixture bytes through the execution gate and restores durable state', async () => {
    await expect(scriptForExecution(app as unknown as App, PATH)).rejects.toThrow(/provenance/)
    const before = await run('return await saveScriptFixture()')
    const result = await run(`
      const saved = await saveScriptFixture()
      try {
        await enableScriptFixture('Sample scripts')
        await approveScriptFixture(${JSON.stringify(PATH)}, ${JSON.stringify(SOURCE)})
        const result = await window.__abeleTest.ScriptService.getInstance().execute(${JSON.stringify(PATH)}, {}, { source: 'automation' })
        let other = ''
        try { await window.__abeleTest.scriptTrust.load(app, 'Sample scripts/other.js') } catch (e) { other = e.message }
        return { result, other, enabled: window.__abeleTest.AbeleConfig.getInstance().ai.scriptsEnabled }
      } finally { await restoreScriptFixture(saved) }
    `)
    expect(result).toEqual({
      result: 'approved fixture',
      other: expect.stringContaining('provenance'),
      enabled: true,
    })
    expect(await run('return await saveScriptFixture()')).toEqual(before)
    await expect(scriptForExecution(app as unknown as App, PATH)).rejects.toThrow(/provenance/)
  })

  it('restores after setup fails and refuses an unexpected source', async () => {
    const before = await run('return await saveScriptFixture()')
    await expect(
      run(`
      const saved = await saveScriptFixture()
      try {
        await enableScriptFixture('Sample scripts')
        await approveScriptFixture(${JSON.stringify(PATH)}, 'different bytes')
      } finally { await restoreScriptFixture(saved) }
    `)
    ).rejects.toThrow('Fixture source was not discovered')
    expect(await run('return await saveScriptFixture()')).toEqual(before)
  })
})
