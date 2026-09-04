import { ItemView, WorkspaceLeaf, type ViewStateResult } from 'obsidian'
import { nanoid } from 'nanoid'
import { shallowReactive, watch, type WatchStopHandle } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import type { View } from '@/scripting/view/View'
import { ScriptViewService } from '@/scripting/view/ScriptViewService'

export const SCRIPT_VIEW_TYPE = 'abele-script-view'
export const SCRIPT_VIEW_ID_ATTR = 'abele-script-view-id'

/** What the workspace layout keeps for this tab: enough to run the script again. */
export interface SavedViewState {
  script: string
  params: Record<string, unknown>
  state: Record<string, unknown>
}

export type ViewStatus =
  | { kind: 'starting'; script: string }
  | { kind: 'failed'; script: string; message: string }
  | { kind: 'live' }

/** What the Vue side renders from. One per leaf, reactive, handed over through the store. */
export interface ScriptViewModel {
  id: string
  view: View | null
  status: ViewStatus
  saved: SavedViewState | null
  runAgain(): void
}

/**
 * The pane a script's view lives in.
 *
 * Obsidian makes one of these for a leaf and calls `setState` with whatever the layout kept.
 * A state naming a script and no view bound yet means the tab is being rebuilt after a
 * restart, and the service is asked to run the script again. A fresh open passes no state:
 * the service binds the view straight after `setViewState` returns.
 */
export class ScriptView extends ItemView {
  readonly id = nanoid()
  readonly model: ScriptViewModel
  private stopWatching: WatchStopHandle | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.model = shallowReactive({
      id: this.id,
      view: null,
      status: { kind: 'starting', script: '' },
      saved: null,
      // Only a tab that failed has anything to run again: a live one already has its view,
      // and a starting one is being run now.
      runAgain: () => {
        const { saved, status } = this.model
        if (saved && status.kind === 'failed')
          void ScriptViewService.getInstance().restore(this, saved)
      },
    })
  }

  getViewType() {
    return SCRIPT_VIEW_TYPE
  }

  getDisplayText() {
    return this.model.view?.title ?? this.model.saved?.script ?? 'Script view'
  }

  getIcon() {
    return this.model.view?.icon ?? 'scroll-text'
  }

  getState(): Record<string, unknown> {
    const { view, saved } = this.model
    if (view) {
      return {
        script: view.origin.script,
        params: view.origin.params,
        state: JSON.parse(JSON.stringify(view.state)) as Record<string, unknown>,
      }
    }
    return saved ? { ...saved } : {}
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved = state as Partial<SavedViewState> | null
    if (saved?.script && !this.model.view) {
      const full: SavedViewState = {
        script: saved.script,
        params: saved.params ?? {},
        state: saved.state ?? {},
      }
      this.model.saved = full
      void ScriptViewService.getInstance().restore(this, full)
    }
    await super.setState(state, result)
  }

  async onOpen() {
    const container = this.containerEl.children[1]
    container.appendChild(createDiv({ attr: { [SCRIPT_VIEW_ID_ATTR]: this.id } }))
    const open = GlobalStore.getInstance().scriptViews
    open.value = [...open.value, this.model]
    ScriptViewService.getInstance().attach(this)
  }

  async onClose() {
    const open = GlobalStore.getInstance().scriptViews
    open.value = open.value.filter((m) => m.id !== this.id)
    this.stopWatching?.()
    this.stopWatching = null
    ScriptViewService.getInstance().detach(this.id)
  }

  starting(script: string) {
    this.model.status = { kind: 'starting', script }
  }

  /**
   * Redraws the two places the title shows. `leaf.updateHeader()` redoes the tab; the title
   * bar above the content is written once by `ItemView.load()` and never again by Obsidian,
   * so a view that renames itself writes it too. Neither is in the typings.
   */
  private refreshHeader() {
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
    ;(this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText())
  }

  fail(message: string) {
    this.model.status = { kind: 'failed', script: this.model.saved?.script ?? '', message }
  }

  bind(view: View) {
    this.model.view = view
    this.model.saved = { script: view.origin.script, params: view.origin.params, state: view.state }
    this.model.status = { kind: 'live' }
    // The headers read title and icon when the leaf opened, which on a fresh open was before
    // any view existed — they still say "Script view" with the generic icon. Tell them now,
    // tell them again when the script changes them, and ask for the layout to be written
    // when the state does, so a crash loses nothing.
    const { app } = GlobalStore.getInstance()
    this.refreshHeader()
    // `number`, not `ReturnType<typeof setTimeout>`: with @types/node in scope that alias is
    // Node's `Timeout`, while the DOM call this makes returns a plain handle.
    let timer: number | null = null
    const stop = watch(
      () => [view.title, view.icon, JSON.stringify(view.state)],
      ([, , state], [, , before]) => {
        this.refreshHeader()
        if (state !== before) {
          if (timer !== null) window.clearTimeout(timer)
          timer = window.setTimeout(() => app.workspace.requestSaveLayout(), 500)
        }
      }
    )
    // A save still pending when the tab closes would write a layout without it; drop it.
    this.stopWatching = () => {
      stop()
      if (timer !== null) window.clearTimeout(timer)
      timer = null
    }
  }
}
