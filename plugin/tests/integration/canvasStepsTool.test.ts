import { beforeEach, expect, it } from 'vitest'
import { TFile, type App } from 'obsidian'
import { createCanvasTools } from '@/ai/tools/CanvasTools'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, CANVAS_TOOL_MODES, TOUCHING_TOOLS } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { migrateAgents } from '@/ai/agents/migration'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { subAgentRefusal } from '@/ai/SubAgentRunner'
import { buildFakeVault } from '../helpers/fakeVault'

let app: ReturnType<typeof buildFakeVault>, scope: ScopeResolver
const call = (name: string, params: unknown) =>
  createCanvasTools()
    .find((t) => t.name === name)!
    .execute('sample', params, undefined, { scope, interactive: true })
const read = async () =>
  JSON.parse((await call('canvas_read', { path: 'sample.canvas' })).content[0].text)
beforeEach(() => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  app = buildFakeVault([
    {
      path: 'sample.canvas',
      content: JSON.stringify({
        nodes: [
          { id: 'alpha', type: 'text', text: 'Alpha', x: 0, y: 0, width: 200, height: 100 },
          { id: 'beta', type: 'text', text: 'Beta', x: 400, y: 0, width: 200, height: 100 },
        ],
        edges: [],
        abele: { sample: true },
      }),
    },
  ])
  ;(GlobalStore.getInstance() as unknown as { _app: App })._app = app as unknown as App
  scope = new ScopeResolver()
  scope.setFullVaultAccess(true)
})
it('adds a sixth independent Ask mode, migrates without overriding Off and records touched files', () => {
  expect(
    createCanvasTools()
      .map((t) => t.name)
      .sort()
  ).toEqual(Object.keys(CANVAS_TOOL_MODES).sort())
  expect(CANVAS_TOOL_MODES.canvas_steps).toBe('ask')
  expect(TOUCHING_TOOLS).toContain('canvas_steps')
  const ai = JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS))
  ai.agents = [createAgent({ toolModes: { canvas_steps: 'off' } }), createAgent({ toolModes: {} })]
  const ids = new Set(ai.agents.map((a: { id: string }) => a.id))
  migrateAgents(ai)
  expect(
    ai.agents
      .filter((a: { id: string }) => ids.has(a.id))
      .map((a: { toolModes: Record<string, string> }) => a.toolModes.canvas_steps)
  ).toEqual(['off', 'ask'])
  expect(
    subAgentRefusal(
      'canvas_steps',
      { path: 'sample.canvas' },
      createAgent({ permissionMode: 'allow-all', toolModes: { canvas_steps: 'ask' } }),
      scope
    )
  ).toMatch(/approval/)
})
it('writes atomically with a read revision, reads a step, refuses stale writes and keeps extensions', async () => {
  const snapshot = await read()
  const ops = [
    {
      op: 'replace',
      steps: [
        { id: 'start', reveal: ['alpha'], say: 'The input.', focus: 'alpha' },
        { id: 'next', reveal: ['beta'], highlight: ['beta'], say: 'The result.' },
      ],
    },
  ]
  const result = await call('canvas_steps', {
    path: 'sample.canvas',
    revision: snapshot.revision,
    ops,
  })
  expect(result.details?.diff).toBeDefined()
  const data = JSON.parse(
    (await call('canvas_read', { path: 'sample.canvas', step: 1 })).content[0].text
  )
  expect(data.nodes.map((n: { id: string }) => n.id)).toEqual(['alpha'])
  expect(data.playback.say).toBe('The input.')
  const file = app.vault.getAbstractFileByPath('sample.canvas') as TFile
  const bytes = await app.vault.read(file)
  expect(JSON.parse(bytes).abele.sample).toBe(true)
  await expect(
    call('canvas_steps', { path: 'sample.canvas', revision: snapshot.revision, ops })
  ).rejects.toThrow(/changed since/)
  await expect(
    call('canvas_steps', {
      path: 'sample.canvas',
      revision: data.revision,
      ops: [
        { op: 'remove', id: 'start' },
        { op: 'upsert', step: { id: 'bad', reveal: ['missing'], say: '' } },
      ],
    })
  ).rejects.toThrow(/op 1/)
  expect(await app.vault.read(file)).toBe(bytes)
})
it('refuses step writes outside scope and unsafe paths', async () => {
  const revision = (await read()).revision
  scope.setFullVaultAccess(false)
  await expect(
    call('canvas_steps', { path: 'sample.canvas', revision, ops: [{ op: 'replace', steps: [] }] })
  ).rejects.toThrow(/scope/)
  await expect(
    call('canvas_steps', {
      path: '../sample.canvas',
      revision,
      ops: [{ op: 'replace', steps: [] }],
    })
  ).rejects.toThrow(/safe/)
})
