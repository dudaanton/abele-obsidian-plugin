/**
 * A script's tab, from `open()` to the workspace and back after a restart.
 *
 * The workspace is faked at the calls the service makes: a leaf for each placement, reveal,
 * the active leaf and its change event, layout-ready, and saving the layout. What is asserted
 * is the binding — which leaf a view lands in, what the leaf will save, and what a restored
 * leaf does when the script is gone, throws, or forgets to open anything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
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
    activeLeaf: null as WorkspaceLeaf | null,
    getLeaf: (kind: string) => leaves[kind] ?? leaves.tab,
    getRightLeaf: () => leaves.right,
    revealLeaf: async (leaf: WorkspaceLeaf) => {
      revealed.push(leaf)
    },
    requestSaveLayout: () => {
      saveRequested++
    },
    onLayoutReady: (cb: () => void) => cb(),
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

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let service: ScriptViewService
let app: ReturnType<typeof useVault> & { workspace: ReturnType<typeof fakeWorkspace> }

beforeEach(() => {
  app = useVault([]) as typeof app
  app.workspace = fakeWorkspace()
  ScriptViewService.destroy()
  service = ScriptViewService.getInstance()
  findScriptByName.mockReset()
  // The index is ready unless a test says otherwise: `init()` is what would settle this, and
  // nothing here runs it.
  ScriptService.getInstance().ready = Promise.resolve()
})

afterEach(() => {
  vi.useRealTimers()
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

  it('forgets a view whose leaf never came, so the next leaf goes to whoever asked for it', async () => {
    leaves.split.setViewState = () => Promise.reject(new Error('no room'))
    const v = new View({ title: 'T' }, service, origin)
    await expect(v.open({ where: 'split' })).rejects.toThrow('no room')
    expect(v.leafId).toBeNull()

    // A leaf that opens now is nobody's: it waits for a restore rather than going to `v`.
    const lv = attachView(leaves.tab)
    expect(service.viewFor(lv.id)).toBeUndefined()
    const back = new View({ title: 'Back' }, service, origin, { leafId: lv.id, state: {} })
    await back.open()
    expect(lv.model.view === back).toBe(true)
    expect(v.leafId).toBeNull()
  })
})

describe('restoring', () => {
  const saved: SavedViewState = { script: 'Demo', params: { a: 1 }, state: { index: 2 } }
  const demo = { path: 'Scripts/Demo.js', meta: { name: 'Demo' } }

  /** An `execute` that opens a view for the leaf it was given, once `gate` lets it. */
  function executeOpeningView(gate: Promise<void> = Promise.resolve()) {
    return vi
      .spyOn(ScriptService.getInstance(), 'execute')
      .mockImplementation(async (_p, _params, options) => {
        await gate
        const opts = options as { restore: { leafId: string; state: Record<string, unknown> } }
        const v = new View({ title: 'Back' }, service, origin, opts.restore)
        await v.open()
        return ''
      })
  }

  it('re-runs the script with the saved values and binds its view to the waiting leaf', async () => {
    findScriptByName.mockReturnValue(demo)
    const gate = deferred()
    const execute = executeOpeningView(gate.promise)
    const lv = attachView(leaves.tab)
    await lv.setState(saved, { history: false })
    await vi.waitFor(() => expect(execute).toHaveBeenCalled())
    expect(lv.model.status).toEqual({ kind: 'starting', script: 'Demo' })
    gate.resolve()
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

  it('waits for the script index before deciding the script is missing', async () => {
    const index = deferred()
    let indexed = false
    ScriptService.getInstance().ready = index.promise
    findScriptByName.mockImplementation(() => (indexed ? demo : undefined))
    const execute = executeOpeningView()
    const lv = attachView(leaves.tab)
    await lv.setState(saved, { history: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(lv.model.status).toEqual({ kind: 'starting', script: 'Demo' })
    expect(findScriptByName).not.toHaveBeenCalled()

    indexed = true
    index.resolve()
    await vi.waitFor(() => expect(lv.model.status).toEqual({ kind: 'live' }))
    expect(execute).toHaveBeenCalledTimes(1)
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

    findScriptByName.mockReturnValue(demo)
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

  it('runs nothing again for a tab that is live or already starting', async () => {
    findScriptByName.mockReturnValue(demo)
    const gate = deferred()
    const execute = executeOpeningView(gate.promise)
    const lv = attachView(leaves.tab)
    await lv.setState(saved, { history: false })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))

    // Still starting: a second ask, from the button or the service, starts no second run.
    lv.model.runAgain()
    await service.restore(lv, saved)
    expect(execute).toHaveBeenCalledTimes(1)

    gate.resolve()
    await vi.waitFor(() => expect(lv.model.status).toEqual({ kind: 'live' }))
    const first = lv.model.view
    lv.model.runAgain()
    await service.restore(lv, saved)
    await new Promise((r) => setTimeout(r, 20))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(lv.model.view === first).toBe(true)
    execute.mockRestore()
  })

  it('ends a view whose tab was closed while its script was still running', async () => {
    findScriptByName.mockReturnValue(demo)
    const gate = deferred()
    const execute = executeOpeningView(gate.promise)
    const lv = attachView(leaves.tab)
    await lv.setState(saved, { history: false })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await lv.onClose()

    gate.resolve()
    await vi.waitFor(() => expect(execute.mock.results[0]?.value).resolves.toBe(''))
    // No leaf was asked for, and nothing is bound: the view went away with its tab.
    for (const leaf of Object.values(leaves)) expect(leaf.state).toBeNull()
    expect(service.leaves()).toEqual([])
    execute.mockRestore()
  })
})

describe('hooks', () => {
  it('relays vault events and active-leaf changes', async () => {
    const v = new View({ title: 'T' }, service, origin)
    const vault = vi.fn()
    const focus = vi.fn()
    const blur = vi.fn()
    v.on('vault', vault).on('focus', focus).on('blur', blur)
    const opening = v.open()
    await Promise.resolve()
    attachView(leaves.tab)
    await opening

    // The fake vault fires its registered listeners through `emit`, so that is what a change
    // looks like from here.
    app.emit('vault', 'modify', { path: 'a.md' })
    await vi.waitFor(() =>
      expect(vault).toHaveBeenCalledWith(expect.objectContaining({ type: 'modify', path: 'a.md' }))
    )

    // Opened while another leaf was active: the first focus is the change to this one.
    expect(focus).not.toHaveBeenCalled()
    app.workspace.trigger('active-leaf-change', leaves.tab)
    app.workspace.trigger('active-leaf-change', leaves.split)
    await vi.waitFor(() => expect(blur).toHaveBeenCalledTimes(1))
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('knows a tab that opened active is focused, so the first change away is a blur', async () => {
    const v = new View({ title: 'T' }, service, origin)
    const focus = vi.fn()
    const blur = vi.fn()
    v.on('focus', focus).on('blur', blur)
    app.workspace.activeLeaf = leaves.tab
    const opening = v.open()
    await Promise.resolve()
    attachView(leaves.tab)
    await opening
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(1))

    app.workspace.trigger('active-leaf-change', leaves.split)
    await vi.waitFor(() => expect(blur).toHaveBeenCalledTimes(1))
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('hands keys to the active tab only, and never those typed into a field', async () => {
    const v = new View({ title: 'T' }, service, origin)
    const key = vi.fn()
    v.on('key', key)
    app.workspace.activeLeaf = leaves.tab
    const opening = v.open()
    await Promise.resolve()
    const lv = attachView(leaves.tab)
    await opening
    document.body.appendChild(lv.containerEl)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
      await vi.waitFor(() => expect(key).toHaveBeenCalledTimes(1))

      const input = document.createElement('input')
      lv.containerEl.appendChild(input)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
      await new Promise((r) => setTimeout(r, 10))
      expect(key).toHaveBeenCalledTimes(1)

      app.workspace.trigger('active-leaf-change', leaves.split)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
      await new Promise((r) => setTimeout(r, 10))
      expect(key).toHaveBeenCalledTimes(1)

      // Closed: the document listener goes with the leaf. A disposed view is deaf anyway, so
      // the hook cannot show the difference; the removal itself is what is checked.
      const removed = vi.spyOn(document, 'removeEventListener')
      await lv.onClose()
      expect(removed).toHaveBeenCalledWith('keydown', expect.any(Function))
      removed.mockRestore()
    } finally {
      lv.containerEl.remove()
    }
  })

  it('asks to save the layout half a second after the state last changed', async () => {
    const v = new View({ title: 'T' }, service, origin)
    const opening = v.open()
    await Promise.resolve()
    attachView(leaves.tab)
    await opening

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    v.state.n = 1
    await nextTick()
    v.state.n = 2
    await nextTick()
    vi.advanceTimersByTime(499)
    expect(saveRequested).toBe(0)
    vi.advanceTimersByTime(1)
    expect(saveRequested).toBe(1)
  })
})
