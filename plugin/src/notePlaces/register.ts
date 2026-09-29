/**
 * Notes come back where they were left: the scroll and the cursor of each, kept on this device.
 *
 * The same behaviour as the "Remember cursor position" plugin by Dmitry Savosh
 * (https://github.com/dy-sh/obsidian-remember-cursor-position, MIT), written anew for one
 * reason: that plugin tells a jump to a place from a plain opening by looking, a moment after
 * the note opens, for text Obsidian is flashing — which only its own heading and block links do.
 * Any other jump, the reader's to a highlight among them, was overridden by the saved place.
 * Here the place asked for is read where Obsidian carries it, the ephemeral state a leaf is
 * opened with, and anything that scrolls a note to a place of its own — the plugin's line jumps
 * — says so through `holdNotePlace`. Differences besides: the places live in this device's
 * local storage rather than a file in the vault, the view that loaded the note is restored
 * whether or not it is the active one, and a note never moved from its top leaves no entry.
 *
 * How it hooks in, none of it published API:
 * - `WorkspaceLeaf.setViewState(viewState, eState)` — every opening ends there: `openFile`, a
 *   link, the back button, a tab loading after the app started. Its `eState` says whether a
 *   place was asked for.
 * - `MarkdownView.setEphemeralState` — a place asked for after the note has opened.
 * - `MarkdownView.onUnloadFile` and `WorkspaceLeaf.detach` — the moments before a view lets its
 *   note go, to save its place.
 */
import { MarkdownView, Notice, WorkspaceLeaf, type Plugin, type TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { NotePlaceKeeper, type PlaceIo, type ViewPlace } from './keeper'
import type { NotePlace } from './store'
import { isExplicitTarget } from './target'
import { importRememberCursorPlaces, OTHER_PLUGIN_ID } from './otherPlugin'
import { currentPlaceKeeper, setPlaceKeeper } from './hold'
import { alignAnchor, anchorAt, holdAnchor } from './anchor'
import { forgetFooterView } from '@/composables/useFooterView'
import { forgetFooterFolds } from '@/composables/useFooterFold'

/** Where the places are kept, by `App.saveLocalStorage` — per vault, on this device. */
export const PLACES_KEY = 'abele-note-places'
/** Set once the notice about the other plugin has been shown on this device. */
const NOTICE_KEY = 'abele-note-places-notice'
/** Set once the other plugin's places have been brought over on this device. */
const IMPORTED_KEY = 'abele-note-places-imported'
/** How often the views on screen have their place saved while they are read. */
const SAMPLE_MS = 1000

interface LocalStore {
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, value: unknown): void
}

/** Reading view's renderer. `applyScroll` answers false, doing nothing, while it is not measured. */
interface PreviewRenderer {
  applyScroll?: (line: number) => boolean | void
}

const round = (n: number) => Math.round(n * 10000) / 10000

const io: PlaceIo<MarkdownView> = {
  path: (view) => view.file?.path ?? null,
  place(view): ViewPlace | null {
    // Closed, or a tab behind another: its scroller reads 0 and is no place to save.
    const el = view.containerEl
    if (!el.isConnected || el.getClientRects().length === 0) return null
    const scroll = view.currentMode?.getScroll?.()
    if (typeof scroll !== 'number' || !Number.isFinite(scroll)) return null
    const place: ViewPlace = { scroll: round(scroll) }
    // Scrolled into the list under the note: the row at the top, which the line cannot name.
    const scroller = view.getMode() === 'preview' ? null : scrollerOf(view)
    const anchor = scroller ? anchorAt(view.containerEl, scroller) : null
    if (anchor) place.anchor = anchor
    const editor = view.editor
    if (editor) {
      const from = editor.getCursor('anchor')
      const to = editor.getCursor('head')
      if (from && to)
        place.cursor = { from: { line: from.line, ch: from.ch }, to: { line: to.line, ch: to.ch } }
    }
    return place
  },
  apply(view, place: NotePlace, first) {
    const editor = view.editor
    if (first && place.cursor && editor) {
      const last = editor.lastLine()
      const clamp = (p: { line: number; ch: number }) => {
        const line = Math.min(Math.max(0, p.line), last)
        return { line, ch: Math.min(Math.max(0, p.ch), editor.getLine(line).length) }
      }
      editor.setSelection(clamp(place.cursor.from), clamp(place.cursor.to))
    }
    if (view.getMode() === 'preview') {
      const renderer = (view.previewMode as unknown as { renderer?: PreviewRenderer }).renderer
      if (typeof renderer?.applyScroll === 'function') renderer.applyScroll(place.scroll)
      else view.previewMode.applyScroll(place.scroll)
    } else view.setEphemeralState({ scroll: place.scroll })
  },
  atEnd(view) {
    const el = scrollerOf(view)
    return !!el && el.scrollHeight > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2
  },
  alignAnchor(view, anchor) {
    const scroller = view.getMode() === 'preview' ? null : scrollerOf(view)
    return !!scroller && alignAnchor(view.containerEl, scroller, anchor)
  },
  holdAnchor: (view, anchor) =>
    holdAnchor(
      view.containerEl,
      () => (view.getMode() === 'preview' ? null : scrollerOf(view)),
      anchor
    ),
  watchInput(view, onInput) {
    const el = view.containerEl
    const opts = { capture: true, passive: true }
    for (const type of INPUT_EVENTS) el.addEventListener(type, onInput, opts)
    return () => {
      for (const type of INPUT_EVENTS) el.removeEventListener(type, onInput, opts)
    }
  },
}

/**
 * What the person does to scroll or move in a note themselves: a restore gives way to any. A
 * finger already on the glass as the note opens — the swipe that follows a tap — is caught by
 * its moves.
 */
const INPUT_EVENTS = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const

/** The element that scrolls in the mode the note is showing. */
function scrollerOf(view: MarkdownView): HTMLElement | null {
  if (view.getMode() === 'preview')
    return view.containerEl.querySelector<HTMLElement>(
      '.markdown-reading-view > .markdown-preview-view'
    )
  const cm = (view.editor as unknown as { cm?: { scrollDOM?: HTMLElement } }).cm
  return cm?.scrollDOM ?? view.containerEl.querySelector<HTMLElement>('.cm-scroller')
}

type SetViewState = (this: WorkspaceLeaf, viewState: unknown, eState?: unknown) => Promise<void>
type Detach = (this: WorkspaceLeaf) => void
type SetEphemeralState = (this: MarkdownView, state: unknown) => void
type OnUnloadFile = (this: MarkdownView, file: TFile) => Promise<void>

/**
 * Wraps the hooks. Returns the undo; once undone the wrappers pass straight through, so
 * something that wrapped them on top keeps working.
 */
export function hookViews(
  k: NotePlaceKeeper<MarkdownView>,
  leafProto: { setViewState: SetViewState; detach: Detach } = WorkspaceLeaf.prototype,
  viewProto: {
    setEphemeralState: SetEphemeralState
    onUnloadFile: OnUnloadFile
  } = MarkdownView.prototype
): () => void {
  let live = true
  const setViewState = leafProto.setViewState
  const setEphemeralState = viewProto.setEphemeralState
  const onUnloadFile = viewProto.onUnloadFile
  const detach = leafProto.detach

  const wrappedSetViewState: SetViewState = async function (viewState, eState) {
    if (!live) return setViewState.call(this, viewState, eState)
    const before = this.view
    const beforePath = before instanceof MarkdownView ? before.file?.path : undefined
    await setViewState.call(this, viewState, eState)
    const view = this.view
    if (!live || !(view instanceof MarkdownView) || !view.file) return
    if (view === before && view.file.path === beforePath) {
      // The same note in the same view — a mode switch, a link to itself: only a place counts.
      if (isExplicitTarget(eState)) k.claim(view)
      return
    }
    k.opened(view, view.file.path, isExplicitTarget(eState))
  }
  const wrappedSetEphemeralState: SetEphemeralState = function (state) {
    if (live && isExplicitTarget(state)) k.claim(this)
    return setEphemeralState.call(this, state)
  }
  const wrappedOnUnloadFile: OnUnloadFile = function (file) {
    if (live) k.sample(this)
    return onUnloadFile.call(this, file)
  }

  // A tab closing: its place is read while it still shows, before the view is taken down.
  const wrappedDetach: Detach = function () {
    if (live && this.view instanceof MarkdownView) k.sample(this.view)
    return detach.call(this)
  }

  const undo = [
    swap(leafProto, 'detach', wrappedDetach),
    swap(leafProto, 'setViewState', wrappedSetViewState),
    swap(viewProto, 'setEphemeralState', wrappedSetEphemeralState),
    swap(viewProto, 'onUnloadFile', wrappedOnUnloadFile),
  ]
  return () => {
    live = false
    for (const u of undo) u()
  }
}

/**
 * Puts `fn` in place of `target[key]`; the result undoes it. A method the prototype only
 * inherited is removed again rather than left behind as its own; one wrapped again by something
 * else meanwhile is left in place, the wrapper passing everything through.
 */
function swap<T extends object, K extends keyof T>(target: T, key: K, fn: T[K]): () => void {
  const own = Object.prototype.hasOwnProperty.call(target, key)
  const original = target[key]
  target[key] = fn
  return () => {
    if (target[key] !== fn) return
    if (own) target[key] = original
    else delete target[key]
  }
}

export function registerNotePlaces(plugin: Plugin): void {
  const { app } = plugin
  const store = app as unknown as LocalStore
  const k = new NotePlaceKeeper<MarkdownView>(io, {
    enabled: () => AbeleConfig.getInstance().rememberNotePlaces,
    now: () => Date.now(),
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => window.clearTimeout(handle as number),
    load: () => store.loadLocalStorage(PLACES_KEY),
    save: (value) => store.saveLocalStorage(PLACES_KEY, value),
  })
  setPlaceKeeper(k)
  const unhook = hookViews(k)

  const sampleAll = () => {
    app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) k.sample(leaf.view)
    })
  }
  const saveNow = () => {
    sampleAll()
    k.flush()
  }

  plugin.registerInterval(window.setInterval(sampleAll, SAMPLE_MS))
  plugin.registerEvent(app.vault.on('rename', (file, oldPath) => k.renamed(oldPath, file.path)))
  plugin.registerEvent(
    app.vault.on('delete', (file) => {
      k.deleted(file.path)
      // How its lists were left goes too, or a note made later under its name inherits it.
      forgetFooterView(file.path)
      forgetFooterFolds(file.path)
    })
  )
  plugin.registerEvent(app.workspace.on('quit', saveNow))
  // A phone app sent to the background may never come back to say it quit.
  plugin.registerDomEvent(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow()
  })
  plugin.register(() => {
    saveNow()
    k.stop()
    unhook()
    if (currentPlaceKeeper() === k) setPlaceKeeper(null)
  })

  app.workspace.onLayoutReady(() => {
    // The vault is listed by now: a place for a note that is gone is dropped.
    k.prune((path) => !!app.vault.getFileByPath(path))
    void adoptAndWarn(plugin, k, store)
  })
}

/** Every plugin enabled in the vault, by id. Not in the published API. */
function otherPluginEnabled(plugin: Plugin): boolean {
  const plugins = (plugin.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins
  return !!plugins?.enabledPlugins?.has(OTHER_PLUGIN_ID)
}

/**
 * With the other plugin on in this vault: its places brought over once, and the person told,
 * once, that the two will both scroll the note and one should go.
 */
async function adoptAndWarn(
  plugin: Plugin,
  k: NotePlaceKeeper<MarkdownView>,
  store: LocalStore
): Promise<void> {
  if (!AbeleConfig.getInstance().rememberNotePlaces) return
  try {
    if (!store.loadLocalStorage(IMPORTED_KEY)) {
      const places = await importRememberCursorPlaces(plugin.app)
      if (places) {
        k.adopt(places)
        k.flush()
        store.saveLocalStorage(IMPORTED_KEY, true)
      }
    }
  } catch (e) {
    console.warn('[Abele] could not bring over the places saved by Remember cursor position', e)
  }
  if (!otherPluginEnabled(plugin) || store.loadLocalStorage(NOTICE_KEY)) return
  store.saveLocalStorage(NOTICE_KEY, true)
  new Notice(
    'Abele now remembers where each note was left, and so does the "Remember cursor position" ' +
      'plugin. The two will both scroll notes as they open: turn that plugin off, or turn off ' +
      '"Remember where notes were left" in Abele\'s settings. Abele\'s keeps a jump to a ' +
      'heading, a search result or a book highlight where it lands.',
    0
  )
}
