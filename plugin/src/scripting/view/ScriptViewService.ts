/**
 * Where views meet leaves.
 *
 * The script side knows a `View`; Obsidian knows a `WorkspaceLeaf` with a `ScriptView` in it.
 * This is the one place that knows both: it opens a leaf for a view, binds a rebuilt view to
 * the leaf that was waiting for it, and turns the workspace's events into the view's hooks.
 */
import type { EventRef, TAbstractFile, WorkspaceLeaf } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { findScriptByName } from '@/scripting/runScript'
import type { View, ViewHost, Placement, VaultChange } from './View'
import { setDefaultViewHost } from './host'
import { SCRIPT_VIEW_TYPE, type SavedViewState, type ScriptView } from '@/views/ScriptView'

interface Bound {
  view: View
  leafView: ScriptView
  unsubscribe: () => void
}

interface Opening {
  view: View
  resolve: (leafView: ScriptView) => void
}

export class ScriptViewService implements ViewHost {
  private static instance: ScriptViewService | null = null

  private bound = new Map<string, Bound>()
  /** Leaves that exist and have no view yet, by id: a fresh open or a restore in progress. */
  private waiting = new Map<string, ScriptView>()
  /** Leaves whose script is being run again right now, so a second ask does not start another. */
  private restoring = new Set<string>()
  /** Views whose `open()` is waiting for a leaf to appear, oldest first. */
  private opening: Opening[] = []

  private constructor() {
    setDefaultViewHost(this)
  }

  static getInstance(): ScriptViewService {
    if (!this.instance) this.instance = new ScriptViewService()
    return this.instance
  }

  static destroy() {
    if (!this.instance) return
    for (const id of [...this.instance.bound.keys()]) this.instance.detach(id)
    this.instance.waiting.clear()
    this.instance.restoring.clear()
    this.instance.opening = []
    setDefaultViewHost(null)
    this.instance = null
  }

  viewFor(leafId: string): View | undefined {
    return this.bound.get(leafId)?.view
  }

  leaves(): ScriptView[] {
    return [...this.bound.values()].map((b) => b.leafView)
  }

  // ── ViewHost ──

  async open(view: View, opts: { where: Placement; active: boolean }): Promise<void> {
    if (view.restore) {
      const restoring = this.waiting.get(view.restore.leafId)
      if (restoring) {
        this.bind(view, restoring)
        return
      }
      // The tab this view was rebuilding was closed while its script ran. Opening a new one
      // would put a tab on screen nobody asked for; the view ends here instead.
      await view.dispose()
      return
    }
    const { workspace } = GlobalStore.getInstance().app
    const leaf: WorkspaceLeaf =
      opts.where === 'sidebar' ? workspace.getRightLeaf(false) : workspace.getLeaf(opts.where)

    // Obsidian builds the ItemView inside setViewState and calls onOpen, which is where the
    // leaf reports itself through `attach`. No state is passed: a state naming a script would
    // read as a restore.
    let resolveArrival: Opening['resolve'] = () => {}
    const arrived = new Promise<ScriptView>((resolve) => {
      resolveArrival = resolve
    })
    const entry: Opening = { view, resolve: resolveArrival }
    this.opening.push(entry)
    try {
      await leaf.setViewState({ type: SCRIPT_VIEW_TYPE, active: opts.active })
    } catch (err) {
      // No leaf is coming. Left in the queue, the next leaf to open would be handed to this
      // view instead of the one that asked for it.
      this.opening = this.opening.filter((o) => o !== entry)
      throw err
    }
    const leafView = await arrived
    this.bind(view, leafView)
    await workspace.revealLeaf(leaf)
  }

  close(view: View): void {
    if (!view.leafId) return
    this.bound.get(view.leafId)?.leafView.leaf.detach()
  }

  // ── Leaves ──

  /** A leaf has opened. Either a view is waiting for one, or a restore will name it. */
  attach(leafView: ScriptView): void {
    const next = this.opening.shift()
    if (next) {
      next.resolve(leafView)
      return
    }
    this.waiting.set(leafView.id, leafView)
  }

  detach(leafId: string): void {
    this.waiting.delete(leafId)
    const b = this.bound.get(leafId)
    if (!b) return
    this.bound.delete(leafId)
    b.unsubscribe()
    void b.view.dispose()
  }

  /**
   * Runs the script a saved tab names, so the view it makes lands in that tab.
   *
   * A leaf that already has its view, or whose script is running now, is left alone: binding
   * twice would subscribe twice and lose the first view without disposing it.
   */
  async restore(leafView: ScriptView, saved: SavedViewState): Promise<void> {
    if (this.bound.has(leafView.id) || this.restoring.has(leafView.id)) return
    this.restoring.add(leafView.id)
    this.waiting.set(leafView.id, leafView)
    leafView.starting(saved.script)
    try {
      // The layout is rebuilt before the plugin has looked at the scripts folder: wait for
      // the workspace, then for the index, before asking it for anything.
      const { app } = GlobalStore.getInstance()
      await new Promise<void>((resolve) => app.workspace.onLayoutReady(resolve))
      // The view type is registered whether or not scripts are on, so a layout saved with
      // script tabs still rebuilds them when the feature is off. Nothing will fill the index
      // then, and a tab waiting on it would wait forever; say why, and let the tab be run
      // again once scripts are turned on.
      const { ai } = AbeleConfig.getInstance()
      if (!ai.enabled || !ai.scriptsEnabled || !ai.scriptsFolder) {
        leafView.fail('Scripts are turned off in the settings')
        return
      }
      await ScriptService.getInstance().ready
      const script = findScriptByName(saved.script)
      if (!script) {
        leafView.fail(`Script "${saved.script}" not found`)
        return
      }
      await ScriptService.getInstance().execute(script.path, saved.params, {
        source: 'view',
        restore: { leafId: leafView.id, state: saved.state },
      })
      if (!this.bound.has(leafView.id)) leafView.fail('The script finished without opening a view')
    } catch (err) {
      leafView.fail(err instanceof Error ? err.message : String(err))
    } finally {
      this.restoring.delete(leafView.id)
    }
  }

  // ── Binding ──

  private bind(view: View, leafView: ScriptView): void {
    this.waiting.delete(leafView.id)
    view.leafId = leafView.id
    leafView.bind(view)
    this.bound.set(leafView.id, { view, leafView, unsubscribe: this.subscribe(view, leafView) })
  }

  /** Turns workspace, vault, keyboard and size events into the view's hooks. */
  private subscribe(view: View, leafView: ScriptView): () => void {
    const { app } = GlobalStore.getInstance()
    const vaultRefs: EventRef[] = []
    const workspaceRefs: EventRef[] = []
    const change =
      (type: VaultChange['type']) =>
      (file: TAbstractFile, oldPath?: string): void => {
        void view.emit('vault', { type, path: file.path, oldPath })
      }
    vaultRefs.push(app.vault.on('create', change('create')))
    vaultRefs.push(app.vault.on('modify', change('modify')))
    vaultRefs.push(app.vault.on('delete', change('delete')))
    vaultRefs.push(app.vault.on('rename', change('rename')))

    // A leaf opened with `active: true` is already the active one, and the change event for
    // that has been and gone. `activeLeaf` is not in the public typings, hence the cast.
    const workspace = app.workspace as unknown as { activeLeaf?: WorkspaceLeaf | null }
    let active = workspace.activeLeaf === leafView.leaf
    if (active) void view.emit('focus')
    workspaceRefs.push(
      app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        const now = leaf === leafView.leaf
        if (now && !active) void view.emit('focus')
        if (!now && active) void view.emit('blur')
        active = now
      })
    )

    // Keys go to the script only while its tab is the active one, and never those typed into
    // a field. The listener is on the document because focus is rarely inside the pane: a
    // key pressed with nothing focused lands on the body, which the pane would never see.
    const el = leafView.containerEl
    const doc = el.ownerDocument
    const onKey = (e: KeyboardEvent) => {
      if (!active) return
      const t = e.target as Element | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      void view.emit('key', e)
    }
    doc.addEventListener('keydown', onKey)

    // The leaf may live in a popout, so the observer comes from its own window.
    const win = doc.defaultView
    const observer =
      win && 'ResizeObserver' in win
        ? new win.ResizeObserver((entries) => {
            const r = entries[0]?.contentRect
            if (r) void view.emit('resize', { width: r.width, height: r.height })
          })
        : null
    observer?.observe(el)

    return () => {
      for (const ref of vaultRefs) app.vault.offref(ref)
      for (const ref of workspaceRefs) app.workspace.offref(ref)
      doc.removeEventListener('keydown', onKey)
      observer?.disconnect()
    }
  }
}
