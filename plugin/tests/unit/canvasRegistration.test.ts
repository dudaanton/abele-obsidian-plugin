import { afterEach, expect, it, vi } from 'vitest'
import { TFile, type Plugin } from 'obsidian'
import { registerCanvas } from '@/canvas/register'
import { adoptCanvasLeaves } from '@/canvas/opening'
import { canvasDocuments } from '@/canvas/documentRegistry'
import { emptyCanvas } from '@/canvas/core/model'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'

vi.mock('@/canvas/opening', () => ({
  CANVAS_VIEW_TYPE: 'abele-canvas',
  adoptCanvasLeaves: vi.fn(async () => {}),
  openCanvas: vi.fn(),
}))
vi.mock('@/canvas/CanvasView', () => ({ CanvasView: class {} }))
vi.mock('@/canvas/embed', () => ({
  canvasEmbedProcessor: vi.fn(),
  canvasEmbedsInEditor: vi.fn(),
}))
vi.mock('@/services/AbeleConfig', () => ({
  AbeleConfig: { getInstance: () => ({ canvasViewer: true }) },
}))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
it.each(['clean', 'dirty', 'opening'])(
  'removes every registry handler on plugin unload with a %s document',
  async (state) => {
    const app = buildFakeVault([{ path: 'sample.canvas', raw: '{"nodes":[],"edges":[]}' }])
    const workspace = {
      onLayoutReady: vi.fn(),
      getLeavesOfType: () => [],
      on: vi.fn((event: string) => ({ event, identity: {} })),
      offref: vi.fn(),
    }
    Object.assign(app, { workspace })
    const vaultOn = vi.spyOn(app.vault, 'on')
    const vaultOff = vi.spyOn(app.vault, 'offref')
    const cleanups: (() => void)[] = []
    const plugin = {
      app,
      registerView: vi.fn(),
      registerEvent: (ref: unknown) =>
        cleanups.push(() => {
          app.vault.offref(ref as never)
          workspace.offref(ref)
        }),
      register: (cleanup: () => void) => cleanups.push(cleanup),
      registerMarkdownPostProcessor: vi.fn(),
      registerEditorExtension: vi.fn(),
      addCommand: vi.fn(),
    } as unknown as Plugin
    registerCanvas(plugin)
    const vaultStart = vaultOn.mock.results.length,
      workspaceStart = workspace.on.mock.results.length
    const registry = canvasDocuments(plugin.app)
    const file = app.vault.getAbstractFileByPath('sample.canvas') as TFile
    const snapshot = { graph: emptyCanvas(), revision: 'sample-revision' }
    const loading = deferred<typeof snapshot>()
    const opening = registry.open(file, {}, () =>
      state === 'opening' ? loading.promise : Promise.resolve(snapshot)
    )
    const lease = state === 'opening' ? null : await opening
    if (state === 'dirty') lease!.document.beginDraft()
    const vaultRefs = vaultOn.mock.results.slice(vaultStart).map((result) => result.value)
    const workspaceRefs = workspace.on.mock.results
      .slice(workspaceStart)
      .map((result) => result.value)
    expect(vaultRefs).toHaveLength(3)
    expect(workspaceRefs).toHaveLength(1)
    expect(() => cleanups.forEach((cleanup) => cleanup())).not.toThrow()
    for (const ref of vaultRefs) expect(vaultOff).toHaveBeenCalledWith(ref)
    for (const ref of workspaceRefs) expect(workspace.offref).toHaveBeenCalledWith(ref)
    if (state === 'opening') {
      loading.resolve(snapshot)
      await opening
    }
    const registrations = vaultOn.mock.calls.length + workspace.on.mock.calls.length
    await registry.open(file, {}, async () => snapshot)
    expect(vaultOn.mock.calls.length + workspace.on.mock.calls.length).toBe(registrations)
    expect(app.stats.modify).toBe(0)
  }
)

it('retries adoption after a delayed native initial save without depending on another layout event', async () => {
  vi.useFakeTimers()
  const callbacks = new Map<string, (file: TFile) => void>()
  const cleanups: (() => void)[] = []
  const plugin = {
    app: {
      workspace: { onLayoutReady: vi.fn(), on: vi.fn() },
      vault: {
        on: (event: string, callback: (file: TFile) => void) => callbacks.set(event, callback),
      },
    },
    registerView: vi.fn(),
    registerEvent: vi.fn(),
    register: (cleanup: () => void) => cleanups.push(cleanup),
    registerMarkdownPostProcessor: vi.fn(),
    registerEditorExtension: vi.fn(),
    addCommand: vi.fn(),
  }
  registerCanvas(plugin as unknown as Plugin)
  const file = new TFile()
  file.extension = 'canvas'
  expect(callbacks.has('modify')).toBe(true)
  callbacks.get('modify')!(file)
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledOnce()
  file.extension = 'md'
  callbacks.get('modify')!(file)
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledOnce()
  const canvas = Object.assign(new TFile(), { extension: 'canvas' })
  let finishRead!: () => void
  vi.mocked(adoptCanvasLeaves).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRead = resolve
      })
  )
  callbacks.get('modify')!(canvas)
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledTimes(2)
  callbacks.get('modify')!(canvas) // A save arrives while an adoption read is still pending.
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledTimes(2)
  finishRead()
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledTimes(3)
  callbacks.get('modify')!(canvas)
  cleanups.forEach((cleanup) => cleanup())
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledTimes(3)
})
