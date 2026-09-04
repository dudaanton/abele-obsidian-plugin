/**
 * A script's tab, from `open()` to the workspace and back after a restart.
 *
 * The workspace is faked at the four calls the service makes: a leaf for each placement,
 * reveal, the active-leaf event, and saving the layout. What is asserted is the binding —
 * which leaf a view lands in, what the leaf will save, and what a restored leaf does when the
 * script is gone, throws, or forgets to open anything.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkspaceLeaf } from 'obsidian'
import { ScriptViewService } from '@/scripting/view/ScriptViewService'
import { ScriptView, type SavedViewState } from '@/views/ScriptView'
import { View } from '@/scripting/view/View'
import { ScriptService } from '@/scripting/ScriptService'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const { findScriptByName } = vi.hoisted(() => ({ findScriptByName: vi.fn() }))
vi.mock('@/scripting/runScript', () => ({ findScriptByName }))

let leaves: Record<string, WorkspaceLeaf>
let revealed: WorkspaceLeaf[]
let saveRequested: number

function fakeWorkspace() {
  leaves = {
    tab: new WorkspaceLeaf(),
    split: new WorkspaceLeaf(),
    window: new WorkspaceLeaf(),
    right: new WorkspaceLeaf(),
  }
  revealed = []
  saveRequested = 0
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {}
  return {
    getLeaf: (kind: string) => leaves[kind] ?? leaves.tab,
    getRightLeaf: () => leaves.right,
    revealLeaf: async (leaf: WorkspaceLeaf) => {
      revealed.push(leaf)
    },
    requestSaveLayout: () => {
      saveRequested++
    },
    on: (name: string, fn: (...a: unknown[]) => void) => {
      ;(listeners[name] ??= []).push(fn)
      return { id: name }
    },
    offref: () => {},
    trigger: (name: string, ...a: unknown[]) => listeners[name]?.forEach((fn) => fn(...a)),
  }
}

/** Obsidian makes the ItemView when `setViewState` lands; the fake leaf does it here. */
function attachView(leaf: WorkspaceLeaf): ScriptView {
  const lv = new ScriptView(leaf)
  leaf.view = lv
  void lv.onOpen()
  return lv
}

let service: ScriptViewService
let app: ReturnType<typeof useVault> & { workspace: ReturnType<typeof fakeWorkspace> }

beforeEach(() => {
  app = useVault([]) as typeof app
  app.workspace = fakeWorkspace()
  ScriptViewService.destroy()
  service = ScriptViewService.getInstance()
  findScriptByName.mockReset()
})

const origin = { script: 'Demo', params: { a: 1 } }

describe('opening', () => {
  it('asks the workspace for the placement and binds the view to that leaf', async () => {
    const v = new View({ title: 'T', icon: 'layers' }, service, origin)
    const opening = v.open({ where: 'split' })
    await Promise.resolve()
    const lv = attachView(leaves.split)
    await opening
    expect(v.leafId).toBe(lv.id)
    expect(lv.model.view === v).toBe(true)
    expect(lv.model.status).toEqual({ kind: 'live' })
    expect(lv.getDisplayText()).toBe('T')
    expect(lv.getIcon()).toBe('layers')
    expect(revealed).toEqual([leaves.split])
    expect(leaves.split.state).toMatchObject({ type: 'abele-script-view', active: true })
  })

  it('sidebar means the right leaf', async () => {
    const v = new View({ title: 'T' }, service, origin)
    const opening = v.open({ where: 'sidebar' })
    await Promise.resolve()
    attachView(leaves.right)
    await opening
    expect(v.leafId).toBe((leaves.right.view as ScriptView).id)
  })

  it('saves script, params and state for the layout', async () => {
    const v = new View({ title: 'T' }, service, origin)
    const opening = v.open()
    await Promise.resolve()
    const lv = attachView(leaves.tab)
    await opening
    v.state.index = 4
    expect(lv.getState()).toEqual({ script: 'Demo', params: { a: 1 }, state: { index: 4 } })
  })

  it('closing the leaf disposes the view; closing the view detaches the leaf', async () => {
    const v = new View({ title: 'T' }, service, origin)
    const closed = vi.fn()
    v.on('close', closed)
    const opening = v.open()
    await Promise.resolve()
    const lv = attachView(leaves.tab)
    await opening
    v.close()
    expect(leaves.tab.detached).toBe(true)
    await lv.onClose()
    expect(closed).toHaveBeenCalledTimes(1)
    expect(service.viewFor(lv.id)).toBeUndefined()
    expect(GlobalStore.getInstance().scriptViews.value.find((m) => m.id === lv.id)).toBeUndefined()
  })
})

describe('restoring', () => {
  const saved: SavedViewState = { script: 'Demo', params: { a: 1 }, state: { index: 2 } }

  it('re-runs the script with the saved values and binds its view to the waiting leaf', async () => {
    findScriptByName.mockReturnValue({ path: 'Scripts/Demo.js', meta: { name: 'Demo' } })
    const execute = vi
      .spyOn(ScriptService.getInstance(), 'execute')
      .mockImplementation(async (_p, _params, options) => {
        const opts = options as { restore: { leafId: string; state: Record<string, unknown> } }
        const v = new View({ title: 'Back' }, service, origin, opts.restore)
        await v.open()
        return ''
      })
    const lv = attachView(leaves.tab)
    await lv.setState(saved, { history: false })
    expect(lv.model.status.kind).toBe('starting')
    await vi.waitFor(() => expect(lv.model.status).toEqual({ kind: 'live' }))
    expect(execute).toHaveBeenCalledWith(
      'Scripts/Demo.js',
      { a: 1 },
      expect.objectContaining({ source: 'view', restore: { leafId: lv.id, state: { index: 2 } } })
    )
    expect(lv.model.view?.state).toEqual({ index: 2 })
    expect(leaves.tab.state).toBeNull()
    execute.mockRestore()
  })

  it('reports a missing script, a throw, and a script that opened nothing', async () => {
    const lv = attachView(leaves.tab)
    findScriptByName.mockReturnValue(undefined)
    await lv.setState(saved, { history: false })
    await vi.waitFor(() =>
      expect(lv.model.status).toEqual({
        kind: 'failed',
        script: 'Demo',
        message: 'Script "Demo" not found',
      })
    )

    findScriptByName.mockReturnValue({ path: 'Scripts/Demo.js', meta: { name: 'Demo' } })
    const execute = vi.spyOn(ScriptService.getInstance(), 'execute')
    execute.mockRejectedValueOnce(new Error('boom'))
    lv.model.runAgain()
    await vi.waitFor(() =>
      expect(lv.model.status).toMatchObject({ kind: 'failed', message: 'boom' })
    )

    execute.mockResolvedValueOnce('')
    lv.model.runAgain()
    await vi.waitFor(() =>
      expect(lv.model.status).toMatchObject({
        kind: 'failed',
        message: 'The script finished without opening a view',
      })
    )
    execute.mockRestore()
  })
})

describe('hooks', () => {
  it('relays vault events, active-leaf changes and asks to save the layout on state change', async () => {
    const v = new View({ title: 'T' }, service, origin)
    const vault = vi.fn()
    const focus = vi.fn()
    const blur = vi.fn()
    v.on('vault', vault).on('focus', focus).on('blur', blur)
    const opening = v.open()
    await Promise.resolve()
    const lv = attachView(leaves.tab)
    await opening

    // The fake vault fires its registered listeners through `emit`, so that is what a change
    // looks like from here.
    app.emit('vault', 'modify', { path: 'a.md' })
    await vi.waitFor(() =>
      expect(vault).toHaveBeenCalledWith(expect.objectContaining({ type: 'modify', path: 'a.md' }))
    )

    app.workspace.trigger('active-leaf-change', leaves.tab)
    app.workspace.trigger('active-leaf-change', leaves.split)
    await vi.waitFor(() => expect(blur).toHaveBeenCalledTimes(1))
    expect(focus).toHaveBeenCalledTimes(1)

    v.state.n = 1
    await vi.waitFor(() => expect(saveRequested).toBeGreaterThan(0))
    void lv
  })
})
