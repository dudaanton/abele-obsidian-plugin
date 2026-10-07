import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import { isReactive, ref } from 'vue'
import { createCanvasTools } from '@/ai/tools/CanvasTools'
import { createAgentTools, getToolRegistry } from '@/ai/tools'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { canvasAssets, canvasRegionAssets } from '@/canvas/pictureAdapter'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { subAgentRefusal } from '@/ai/SubAgentRunner'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createAgent } from '@/ai/agents/types'
import { migrateAgents } from '@/ai/agents/migration'
import { CANVAS_TOOL_MODES, DEFAULT_AI_SETTINGS } from '@/ai/types'
import { buildFakeVault } from '../helpers/fakeVault'
import type { App } from 'obsidian'
import type { ToolContext } from '@/ai/toolContext'

let app: ReturnType<typeof buildFakeVault>, ctx: ToolContext
const tool = (name: string) => createCanvasTools().find((t) => t.name === name)!
const call = async (name: string, params: Record<string, unknown>) => {
  if (['canvas_edit', 'canvas_layout'].includes(name) && !params.revision) {
    const read = await tool('canvas_read').execute(
      'sample-read',
      { path: params.path },
      undefined,
      ctx
    )
    params = { ...params, revision: JSON.parse(read.content[0].text).revision }
  }
  return tool(name).execute('sample-call', params, undefined, ctx)
}
const graph = {
  nodes: [
    { id: 'alpha', kind: 'shape', label: 'Alpha', shape: 'diamond' },
    { id: 'beta', kind: 'note', file: 'sample-note.md' },
  ],
  edges: [{ id: 'flow', fromNode: 'alpha', toNode: 'beta', label: 'next' }],
}
beforeEach(() => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  app = buildFakeVault([{ path: 'sample-note.md', content: '## Sample\nBody' }])
  ;(GlobalStore.getInstance() as unknown as { _app: App })._app = app as unknown as App
  const scope = new ScopeResolver()
  scope.setFullVaultAccess(true)
  ctx = { scope, interactive: true }
})

describe('agent canvas tools and permissions', () => {
  // BUG: the stage-one fixed count is obsolete once the independent walkthrough tool is added.
  it.fails('retains the obsolete count of five independent canvas modes', () => {
    expect(Object.keys(CANVAS_TOOL_MODES)).toHaveLength(5)
  })
  it('registers all independent canvas modes and preserves explicit choices on migration', () => {
    expect(
      createAgentTools()
        .filter((t) => t.name.startsWith('canvas_') || t.name === 'look_at_canvas')
        .map((t) => t.name)
        .sort()
    ).toEqual(Object.keys(CANVAS_TOOL_MODES).sort())
    const agent = createAgent({ toolModes: { canvas_edit: 'off', look_at_canvas: 'ask' } })
    const ai = JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS))
    ai.agents = [agent]
    migrateAgents(ai)
    expect(ai.agents[0].toolModes).toMatchObject({
      canvas_edit: 'off',
      look_at_canvas: 'ask',
      canvas_create: 'ask',
      canvas_layout: 'ask',
      canvas_read: 'auto',
    })
    expect(getToolRegistry().find((t) => t.name === 'canvas_layout')?.category).toBe('Canvas')
  })
  it('does not bypass per-tool Off or Ask with allow-all file permissions', () => {
    const agent = createAgent({
      permissionMode: 'allow-all',
      toolModes: { canvas_edit: 'off', canvas_layout: 'ask', canvas_read: 'auto' },
    })
    expect(subAgentRefusal('canvas_edit', { path: 'sample.canvas' }, agent, ctx.scope)).toMatch(
      /not enabled/
    )
    expect(subAgentRefusal('canvas_layout', { path: 'sample.canvas' }, agent, ctx.scope)).toMatch(
      /approval/
    )
    expect(subAgentRefusal('canvas_read', { path: 'sample.canvas' }, agent, ctx.scope)).toBeNull()
  })
  it('redacts out-of-scope note bodies before the picture adapter can read them', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const data = await new ObsidianCanvasStore(app as unknown as App).read('sample.canvas')
    app.resetStats()
    const assets = await canvasAssets(
      app as unknown as App,
      data,
      'sample.canvas',
      (path) => path === 'sample.canvas',
      document
    )
    expect(assets.contents.get('beta')).toMatch(/outside scope/)
    expect(app.stats.read).toBe(0)
    expect(assets.images.size).toBe(0)
  })
  it('resolves exact note block ids without matching prefixes or painting CRLF frontmatter', async () => {
    const file = app.vault.getAbstractFileByPath('sample-note.md') as TFile
    await app.vault.modify(
      file,
      '---\r\ntopic: sample-metadata\r\n---\r\nFirst paragraph ^sample-long\r\n\r\nTarget paragraph ^sample\r\n'
    )
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const data = await new ObsidianCanvasStore(app as unknown as App).read('sample.canvas')
    data.nodes.find((n) => n.id === 'beta')!.subpath = '#^sample'
    const part = await canvasAssets(
      app as unknown as App,
      data,
      'sample.canvas',
      () => true,
      document
    )
    expect(part.contents.get('beta')).toContain('Target paragraph')
    expect(part.contents.get('beta')).not.toContain('First paragraph')
    expect(part.contents.get('beta')).not.toContain('^sample')
    delete data.nodes.find((n) => n.id === 'beta')!.subpath
    const whole = await canvasAssets(
      app as unknown as App,
      data,
      'sample.canvas',
      () => true,
      document
    )
    expect(whole.contents.get('beta')).not.toContain('sample-metadata')
  })
  it('reports a missing image with malformed percent encoding instead of failing the picture', async () => {
    const file = app.vault.getAbstractFileByPath('sample-note.md') as TFile
    await app.vault.modify(file, '![Sample](sample-%broken.png)')
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const data = await new ObsidianCanvasStore(app as unknown as App).read('sample.canvas')
    const assets = await canvasAssets(
      app as unknown as App,
      data,
      'sample.canvas',
      () => true,
      document
    )
    expect(assets.warnings.map((w) => w.code)).toContain('unavailable-image')
  })
  it('does not load unrelated note bodies or images when inspecting a crop', async () => {
    await app.vault.create('sample-outside.md', 'Outside sample body')
    const data = {
      nodes: [
        {
          id: 'inside',
          type: 'file' as const,
          file: 'sample-note.md',
          x: 0,
          y: 0,
          width: 260,
          height: 160,
        },
        {
          id: 'outside',
          type: 'file' as const,
          file: 'sample-outside.md',
          x: 2000,
          y: 0,
          width: 260,
          height: 160,
        },
      ],
      edges: [],
    }
    app.resetStats()
    const assets = await canvasRegionAssets(
      app as unknown as App,
      data,
      'sample.canvas',
      () => true,
      document,
      { x: -10, y: -10, width: 300, height: 200 }
    )
    expect([...assets.contents.keys()]).toEqual(['inside'])
    expect(app.stats.read).toBe(1)
  })
  it('creates, reads by id, edits atomically, lays out and preserves extensions', async () => {
    await call('canvas_create', { path: 'sample.canvas', title: 'Sample diagram', from: { graph } })
    let read = await call('canvas_read', { path: 'sample.canvas', detail: 'full' })
    let data = JSON.parse(read.content[0].text)
    expect(data.nodes.map((n: { id: string }) => n.id)).toEqual(['alpha', 'beta'])
    await call('canvas_edit', {
      path: 'sample.canvas',
      ops: [
        { op: 'update', id: 'alpha', patch: { abele: { sample: true } } },
        { op: 'style', id: 'alpha', styleAttributes: { border: 'dashed' } },
      ],
    })
    await call('canvas_layout', { path: 'sample.canvas', algorithm: 'tree', direction: 'TB' })
    read = await call('canvas_read', { path: 'sample.canvas', detail: 'full' })
    data = JSON.parse(read.content[0].text)
    expect(data.nodes[0].data.abele.sample).toBe(true)
    expect(data.nodes[0].data.styleAttributes).toMatchObject({ shape: 'diamond', border: 'dashed' })
    const file = app.vault.getAbstractFileByPath('sample.canvas') as TFile
    const before = await app.vault.read(file)
    await expect(
      call('canvas_edit', {
        path: 'sample.canvas',
        ops: [
          { op: 'remove', id: 'alpha' },
          { op: 'update', id: 'missing', patch: { text: 'Changed' } },
        ],
      })
    ).rejects.toThrow(/op 1/)
    expect(await app.vault.read(file)).toBe(before)
    await expect(call('canvas_create', { path: 'sample.canvas', from: { graph } })).rejects.toThrow(
      /exists/i
    )
  })
  it('authors and reads free primitives through the existing edit schema, atomically and within scope', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const line = {
      version: 1,
      id: 'free-arrow',
      from: { x: -300, y: -100 },
      to: { x: 0, y: 0 },
      toEnd: 'arrow',
    }
    await call('canvas_edit', { path: 'sample.canvas', ops: [{ op: 'add_line', line }] })
    let data = JSON.parse((await call('canvas_read', { path: 'sample.canvas' })).content[0].text)
    expect(data.lines).toEqual([line])
    const revision = data.revision
    await call('canvas_edit', {
      path: 'sample.canvas',
      ops: [
        { op: 'move', ids: ['free-arrow'], dx: 20, dy: 30 },
        { op: 'update', id: 'free-arrow', patch: { label: 'Caption', fromEnd: 'arrow' } },
      ],
    })
    data = JSON.parse(
      (await call('canvas_read', { path: 'sample.canvas', detail: 'full' })).content[0].text
    )
    expect(data.lines[0]).toMatchObject({
      from: { x: -280, y: -70 },
      label: 'Caption',
      fromEnd: 'arrow',
    })
    await expect(
      call('canvas_edit', {
        path: 'sample.canvas',
        revision,
        ops: [{ op: 'remove', id: 'free-arrow' }],
      })
    ).rejects.toThrow(/changed|stale|revision/i)
    const file = app.vault.getAbstractFileByPath('sample.canvas') as TFile,
      before = await app.vault.read(file)
    await expect(
      call('canvas_edit', {
        path: 'sample.canvas',
        ops: [
          { op: 'remove', id: 'free-arrow' },
          { op: 'add_line', line: { ...line, from: { x: NaN, y: 0 } } },
        ],
      })
    ).rejects.toThrow(/op 1/)
    expect(await app.vault.read(file)).toBe(before)
    const restricted = new ScopeResolver()
    restricted.setFullVaultAccess(false)
    ctx = { scope: restricted, interactive: true }
    await expect(
      call('canvas_edit', { path: 'sample.canvas', ops: [{ op: 'remove', id: 'free-arrow' }] })
    ).rejects.toThrow(/scope/i)
  })
  it('reads free and attached ink by id with local samples, style, frame and world geometry', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const stroke = {
      version: 1,
      id: 'annotation',
      tool: 'pen',
      color: '',
      size: 2.4,
      points: [10, 20, 0.5, 80, 40, 0.8],
      frame: { width: 260, height: 160 },
    }
    await call('canvas_edit', {
      path: 'sample.canvas',
      ops: [
        { op: 'add_ink', node: 'alpha', stroke },
        {
          op: 'add_ink',
          stroke: { ...stroke, id: 'free', frame: undefined, points: [-600, 0, 0.5] },
        },
        { op: 'update', id: 'alpha', patch: { x: 100, y: 200, width: 520, height: 80 } },
      ],
    })
    const data = JSON.parse((await call('canvas_read', { path: 'sample.canvas' })).content[0].text)
    expect(data.ink.map((s: { id: string }) => s.id)).toEqual(['annotation', 'free'])
    expect(data.ink[0]).toMatchObject({
      ...stroke,
      node: 'alpha',
      world: { x: 100, y: 200, sx: 2, sy: 0.5 },
    })
    expect(data.ink[1]).toMatchObject({ node: null, world: { x: 0, y: 0, sx: 1, sy: 1 } })
    const crop = JSON.parse(
      (
        await call('canvas_read', {
          path: 'sample.canvas',
          region: { x: -620, y: -20, width: 40, height: 40 },
        })
      ).content[0].text
    )
    expect(crop.ink.map((s: { id: string }) => s.id)).toEqual(['free'])
  })
  it('uses theme colour and the human medium widths for omitted ink styles', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    await call('canvas_edit', {
      path: 'sample.canvas',
      ops: [
        {
          op: 'add_ink',
          stroke: { version: 1, id: 'pen', tool: 'pen', points: [-400, 0, 0.5, -300, 20, 0.5] },
        },
        {
          op: 'add_ink',
          stroke: {
            version: 1,
            id: 'marker',
            tool: 'marker',
            points: [-400, 60, 0.5, -300, 80, 0.5],
          },
        },
      ],
    })
    const data = await new ObsidianCanvasStore(app as unknown as App).read('sample.canvas')
    expect(data.abele?.ink).toMatchObject([
      { color: '', size: 2.4 },
      { color: '', size: 14 },
    ])
  })
  it('edits mixed ink batches through shared operations and refuses malformed, duplicate and stale writes atomically', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const stroke = {
      version: 1,
      id: 'ink',
      tool: 'pen',
      color: '1',
      size: 2,
      points: [0, 0, 0.5, 100, 20, 0.5],
    }
    await call('canvas_edit', { path: 'sample.canvas', ops: [{ op: 'add_ink', stroke }] })
    const stale = JSON.parse(
      (await call('canvas_read', { path: 'sample.canvas' })).content[0].text
    ).revision
    await call('canvas_edit', {
      path: 'sample.canvas',
      ops: [
        { op: 'move', ids: ['ink'], dx: 20, dy: 30 },
        { op: 'scale', ids: ['ink'], x: 0, y: 0, factor: 2 },
        {
          op: 'update_ink',
          id: 'ink',
          patch: { color: '4', size: 3, points: [0, 0, 0.5, 90, 10, 0.8] },
        },
        { op: 'attach_ink', id: 'ink', node: 'alpha' },
        { op: 'attach_ink', id: 'ink' },
      ],
    })
    const data = await new ObsidianCanvasStore(app as unknown as App).read('sample.canvas')
    expect(data.abele?.ink).toMatchObject([
      { id: 'ink', color: '4', size: 3, transform: { x: 40, y: 60, sx: 2, sy: 2 } },
    ])
    const file = app.vault.getAbstractFileByPath('sample.canvas') as TFile,
      before = await app.vault.read(file)
    for (const bad of [
      { op: 'add_ink', stroke },
      { op: 'add_ink', stroke: { ...stroke, id: 'alpha' } },
      { op: 'add_ink', stroke: { ...stroke, id: 'bad', points: [0, 0, 2] } },
      {
        op: 'add_ink',
        stroke: { ...stroke, id: 'bad', node: undefined, frame: { width: 100, height: 100 } },
      },
      { op: 'update_ink', id: 'ink', patch: { color: 'invalid' } },
      { op: 'update_ink', id: 'ink', patch: { frame: { width: 0, height: 100 } } },
      { op: 'attach_ink', id: 'ink', node: 'missing' },
    ]) {
      await expect(
        call('canvas_edit', {
          path: 'sample.canvas',
          ops: [{ op: 'move', ids: ['ink'], dx: 5, dy: 6 }, bad],
        })
      ).rejects.toThrow(/op 1/)
      expect(await app.vault.read(file)).toBe(before)
    }
    await expect(
      call('canvas_edit', {
        path: 'sample.canvas',
        revision: stale,
        ops: [{ op: 'remove', id: 'ink' }],
      })
    ).rejects.toThrow(/changed|stale|revision/)
    expect(await app.vault.read(file)).toBe(before)
    await call('canvas_edit', { path: 'sample.canvas', ops: [{ op: 'remove', id: 'ink' }] })
    expect(
      (await new ObsidianCanvasStore(app as unknown as App).read('sample.canvas')).abele?.ink
    ).toEqual([])
  })
  it('applies an approved edit with nested patches from a deep reactive tool-call queue', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const read = await call('canvas_read', { path: 'sample.canvas' })
    const pendingToolCalls = ref([
      {
        name: 'canvas_edit',
        args: {
          path: 'sample.canvas',
          revision: JSON.parse(read.content[0].text).revision,
          ops: [{ op: 'update', id: 'alpha', patch: { styleAttributes: { shape: 'ellipse' } } }],
        },
      },
    ])
    const approved = pendingToolCalls.value[0]
    expect(isReactive(approved.args.ops[0].patch.styleAttributes)).toBe(true)
    await call(approved.name, approved.args)
    const data = await new ObsidianCanvasStore(app as unknown as App).read('sample.canvas')
    expect(data.nodes.find((node) => node.id === 'alpha')?.styleAttributes?.shape).toBe('ellipse')
  })
  it('reads and paints only scope-authorized note assets; refuses out-of-scope diagram changes', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const scope = new ScopeResolver()
    scope.entries.value = [{ type: 'file', path: 'sample-note.md' }]
    scope.setFullVaultAccess(false)
    ctx = { scope, interactive: true }
    await expect(call('canvas_read', { path: 'sample.canvas' })).rejects.toThrow(/scope/i)
    await expect(call('canvas_layout', { path: 'sample.canvas' })).rejects.toThrow(/scope/i)
    await expect(
      call('canvas_edit', { path: 'sample.canvas', ops: [{ op: 'remove', id: 'alpha' }] })
    ).rejects.toThrow(/scope/i)
    await expect(call('look_at_canvas', { path: 'sample.canvas' })).rejects.toThrow(/scope/i)
  })
  it('reports the failed op index for schema errors as well as semantic errors', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const file = app.vault.getAbstractFileByPath('sample.canvas') as TFile
    const before = await app.vault.read(file)
    await expect(
      call('canvas_edit', {
        path: 'sample.canvas',
        ops: [
          { op: 'remove', id: 'alpha' },
          { op: 'add_node', node: { id: 'sample-new', kind: 'shape', shape: 'unsupported' } },
        ],
      })
    ).rejects.toThrow(/op 1/i)
    expect(await app.vault.read(file)).toBe(before)
  })
  it('does not flush or reserialize an open native view for an invalid semantic batch', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const file = app.vault.getAbstractFileByPath('sample.canvas') as TFile
    const current = JSON.parse(await app.vault.read(file))
    const save = vi.fn(async () => {})
    const view = {
      file,
      save,
      canvas: {
        getData: () => current,
        history: { data: [current], current: 0 },
        requestPushHistory: { cancel: vi.fn() },
        pushHistory: vi.fn(),
        requestSave: vi.fn(),
      },
    }
    Object.assign(app, { workspace: { getLeavesOfType: () => [{ view }] } })
    await expect(
      call('canvas_edit', { path: 'sample.canvas', ops: [{ op: 'remove', id: 'missing' }] })
    ).rejects.toThrow(/missing/)
    expect(save).not.toHaveBeenCalled()
    expect(view.canvas.requestSave).not.toHaveBeenCalled()
  })
  // BUG: this older guarantee assumes both concurrently stale writes may succeed. Optimistic writes must refuse one.
  it.fails('serializes concurrent id edits through the final storage boundary', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    await Promise.all([
      call('canvas_edit', {
        path: 'sample.canvas',
        ops: [{ op: 'update', id: 'alpha', patch: { text: 'Updated' } }],
      }),
      call('canvas_edit', {
        path: 'sample.canvas',
        ops: [{ op: 'style', id: 'alpha', styleAttributes: { border: 'dotted' } }],
      }),
    ])
    const data = JSON.parse(
      await app.vault.read(app.vault.getAbstractFileByPath('sample.canvas') as TFile)
    )
    expect(data.nodes.find((n: { id: string }) => n.id === 'alpha')).toMatchObject({
      text: 'Updated',
      styleAttributes: { border: 'dotted' },
    })
  })
  it('uses vault.process rather than stale read-modify-write; cancels before writing', async () => {
    await call('canvas_create', { path: 'sample.canvas', from: { graph } })
    const process = vi.spyOn(app.vault, 'process')
    const abort = new AbortController()
    abort.abort()
    await expect(
      tool('canvas_edit').execute(
        'sample',
        { path: 'sample.canvas', ops: [{ op: 'remove', id: 'alpha' }] },
        abort.signal,
        ctx
      )
    ).rejects.toThrow()
    expect(process).not.toHaveBeenCalled()
    await call('canvas_edit', { path: 'sample.canvas', ops: [{ op: 'remove', id: 'alpha' }] })
    expect(process).toHaveBeenCalledOnce()
  })
  it.each(['../sample.canvas', '/sample.canvas', 'sample.abchat', '.obsidian/sample.canvas'])(
    'rejects unsafe diagram destinations %s',
    async (path) => {
      await expect(call('canvas_create', { path, from: { graph } })).rejects.toThrow()
    }
  )
})
