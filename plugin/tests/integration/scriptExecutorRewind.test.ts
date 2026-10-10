import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { TFile, type App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { createScriptTools } from '@/ai/tools/ScriptTool'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { memoryStore } from '@/ai/rewind/RewindStore'

afterEach(async () => {
  ScriptRuns.getInstance().stopAll()
  await flushPromises()
  ScriptService.destroy()
  ScriptRuns.destroy()
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})

it('retains the invoking journal through service delegation, compiled execution and a suspended form', async () => {
  ScriptService.destroy()
  const app = useVault([
    { path: 'sample.md', content: 'original' },
    {
      path: 'Scripts/sample.js',
      content: `// @name Sample pause
const input = await form([{ name: 'text', label: 'Text' }])
if (input) await write('sample.md', input.text)
return 'done'
`,
    },
  ]) as unknown as App
  const config = AbeleConfig.getInstance()
  config.ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts', scriptsEnabled: true }
  Object.assign(config, {
    plugin: {
      addCommand: vi.fn(),
      removeCommand: vi.fn(),
      addStatusBarItem: () => document.createElement('div'),
    },
  })
  const service = ScriptService.getInstance()
  await service.discover()
  ChangeTracker.install(app)
  const store = memoryStore()
  let key = 'chat-a'
  const log = new ChatRewind(app, { key: () => key, turn: () => 'turn-a' }, store)
  const recording = log.track('script_sample', 'run-a')
  const scope = new ScopeResolver()
  scope.fullVaultAccess.value = true
  const tool = createScriptTools()[0]
  expect(tool.label).toBe('Sample pause')
  const asked = await tool.execute('call-a', {}, undefined, {
    app: recording.app,
    scope,
    interactive: true,
  })
  const output = asked.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
  const runId = /run_id "([^"]+)"/.exec(output)?.[1]
  expect(runId).toBeTruthy()
  await recording.close()
  key = 'chat-b'
  expect(await service.answerForm(runId!, { text: 'owned edit' })).toEqual({
    kind: 'done',
    output: 'done',
  })
  await log.flush()
  const saved = await store.readLog('chat-a')
  expect(saved?.entries).toMatchObject([
    { chat: 'chat-a', run: 'run-a', turn: 'turn-a', changes: [{ path: 'sample.md' }] },
  ])
  expect(await store.readLog('chat-b')).toBeNull()
  expect(log.entries.value).toEqual([])
  const reopened = new ChatRewind(app, { key: () => 'chat-a', turn: () => null }, store)
  expect((await reopened.apply(await reopened.planSince(0))).restored).toEqual(['sample.md'])
  expect(await app.vault.read(app.vault.getAbstractFileByPath('sample.md') as TFile)).toBe(
    'original'
  )
})
