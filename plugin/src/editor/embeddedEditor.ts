/**
 * Obsidian's own note editor, standing in a field of one of our forms.
 *
 * The editor a note is written in — live preview, the `[[` suggester, link highlighting, the
 * formatting commands, undo, and on a phone the toolbar above the keyboard — is not offered to
 * plugins. It is reached the way the Kanban plugin and many others have reached it for years:
 * ask Obsidian for the embed it makes for `![[note]]`, let that embed build its editor, and
 * take the class of that editor. From there the class is ours to construct anywhere.
 *
 * All of it is Obsidian's insides, undocumented and free to change with any update. So every
 * step is guarded and the answer is `null` when anything is not where it was: the field that
 * gets `null` is a plain text box instead. The e2e tier asks for the class on every run
 * (`noteField.e2e.test.ts`), so a change on their side shows up as a red test here rather than
 * as a field that quietly lost its editor on the owner's phone.
 *
 * What stands in the field has no file. That is on purpose: our own editor extensions — the
 * task header, galleries, footnotes, comment markers — each look the file up and do nothing
 * without one, so none of them draws inside a form.
 */
import { Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import type { App } from 'obsidian'

/** What the borrowed editor looks like from here: only the parts this module touches. */
interface BorrowedEditor {
  app: App
  owner: EditorOwner
  editor: { cm: EditorView; focus(): void; getValue(): string }
  editorEl: HTMLElement
  containerEl?: HTMLElement
  scope?: unknown
  set(value: string, clear?: boolean): void
  get(): string
  load?(): void
  unload?(): void
  destroy?(): void
  onUpdate(update: unknown, changed: boolean): void
  buildLocalExtensions(): Extension[]
}

interface EditorOwner {
  app: App
  onMarkdownScroll(): void
  getMode(): string
  editMode?: unknown
  editor?: unknown
}

type EditorClass = new (app: App, container: HTMLElement, owner: EditorOwner) => BorrowedEditor

interface EmbedRegistry {
  embedByExtension?: Record<
    string,
    (
      context: { app: App; containerEl: HTMLElement; state: Record<string, unknown> },
      file: unknown,
      subpath: string
    ) => { editable: boolean; showEditor(): void; editMode?: object; unload?(): void }
  >
}

interface Workspace {
  activeEditor: unknown
  on(name: 'active-leaf-change', callback: () => void): unknown
  offref(ref: unknown): void
}

interface KeymapWithScopes {
  pushScope(scope: unknown): void
  popScope(scope: unknown): void
}

let cached: EditorClass | null | undefined

/**
 * The CodeMirror view standing in each host, for the e2e tier: a window behind others cannot
 * be typed into, so the tests write through the view.
 */
export const embeddedViews = new WeakMap<HTMLElement, EditorView>()

/** Forgets the class found, for a test that swaps the app underneath. */
export function resetEmbeddedEditorCache(): void {
  cached = undefined
}

/**
 * The class Obsidian writes notes with, or `null` when it cannot be found. Looked up once: the
 * embed it is taken from is built and thrown away, which is not free.
 */
export function getMarkdownEditorClass(app: App): EditorClass | null {
  if (cached !== undefined) return cached
  cached = null
  try {
    const registry = (app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry
    const makeEmbed = registry?.embedByExtension?.md
    if (typeof makeEmbed !== 'function') return null
    const embed = makeEmbed({ app, containerEl: activeWindow.createDiv(), state: {} }, null, '')
    embed.editable = true
    embed.showEditor()
    const editMode = embed.editMode
    const proto = editMode ? Object.getPrototypeOf(Object.getPrototypeOf(editMode)) : null
    embed.unload?.()
    const ctor = proto?.constructor as EditorClass | undefined
    // The two things everything below relies on; a class without them is not the editor.
    if (typeof ctor !== 'function') return null
    if (typeof proto.buildLocalExtensions !== 'function' || typeof proto.set !== 'function') {
      return null
    }
    cached = ctor
  } catch (error) {
    console.debug('[Abele] Note editor not available for forms:', error)
    cached = null
  }
  return cached
}

export function isEmbeddedEditorAvailable(app: App): boolean {
  return getMarkdownEditorClass(app) !== null
}

export interface EmbeddedEditorOptions {
  value: string
  onChange?: (value: string) => void
  /** Mod+Enter: what a form does with it is save. */
  onSubmit?: () => void
  /** Focus left the field — where a text box would say `change`. */
  onBlur?: () => void
  placeholder?: string
}

export interface EmbeddedEditor {
  get(): string
  set(value: string): void
  focus(): void
  /** Focus with the cursor after the last character. */
  focusEnd(): void
  /** The editor's own content element — what the keyboard comes up for. */
  readonly contentEl: HTMLElement
  destroy(): void
}

/** Link text in the editor, rendered or raw. A tap on it would open the note behind the dialog. */
const LINK = '.cm-hmd-internal-link, .cm-link, .cm-url, a.internal-link, a.external-link'

/**
 * Builds the note editor in `host`, or returns `null` when Obsidian's editor cannot be
 * borrowed. Destroy it with the dialog: it holds a keymap scope and, while focused, the
 * workspace's idea of which editor is active.
 */
export function createEmbeddedEditor(
  app: App,
  host: HTMLElement,
  options: EmbeddedEditorOptions
): EmbeddedEditor | null {
  const Base = getMarkdownEditorClass(app)
  if (!Base) return null

  const workspace = (app as unknown as { workspace: Workspace }).workspace
  const keys = (app as unknown as { keymap: KeymapWithScopes }).keymap
  let previousActive: unknown = undefined
  let scopePushed = false

  class FormEditor extends Base {
    /** No file: every extension of ours that needs one stays silent in a form. */
    get file(): null {
      return null
    }

    // The note editor pads its bottom so the last line can scroll to the middle of a pane.
    // In a field that is only empty space under the text.
    updateBottomPadding(): void {}

    onUpdate(update: unknown, changed: boolean): void {
      super.onUpdate(update, changed)
      if (changed) options.onChange?.(this.get())
    }

    buildLocalExtensions(): Extension[] {
      const extensions = super.buildLocalExtensions()
      if (options.placeholder) extensions.push(placeholderExt(options.placeholder))
      extensions.push(
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                options.onSubmit?.()
                return !!options.onSubmit
              },
            },
          ])
        )
      )
      extensions.push(
        Prec.highest(
          EditorView.domEventHandlers({
            focus: () => {
              activate()
              return false
            },
            blur: () => {
              deactivate()
              options.onBlur?.()
              return false
            },
          })
        )
      )
      return extensions
    }
  }

  let controller: BorrowedEditor
  try {
    controller = new FormEditor(app, host, {
      app,
      onMarkdownScroll: () => {},
      getMode: () => 'source',
    })
    // What the editor commands and the suggester look for on whatever is active.
    controller.owner.editMode = controller
    controller.owner.editor = controller.editor
    controller.load?.()
    controller.set(options.value ?? '', true)
  } catch (error) {
    console.debug('[Abele] Note editor could not be built in a form:', error)
    return null
  }

  const toolbar = () =>
    (app as unknown as { mobileToolbar?: { update(): void } | null }).mobileToolbar ?? null

  /**
   * Makes this field the editor Obsidian's phone toolbar works on. The toolbar shows while
   * `workspace.activeEditor.editor.hasFocus()` — nothing more — and its buttons run the
   * editor commands against that same `activeEditor`. The borrowed editor's own focus handler
   * already sets it; this says it again whenever something may have taken it away while the
   * field kept its focus: a leaf becoming active clears it, and the keyboard coming up is when
   * the toolbar is placed.
   */
  function claimToolbar(): void {
    if (!controller.editor.cm.hasFocus) return
    if (workspace.activeEditor !== controller.owner) {
      previousActive = workspace.activeEditor
      workspace.activeEditor = controller.owner
    }
    toolbar()?.update()
  }

  const KEYBOARD_EVENTS = ['keyboardWillShow', 'keyboardDidShow'] as const
  let leafRef: unknown = null
  let listenWin: Window | null = null

  function activate(): void {
    if (workspace.activeEditor !== controller.owner) {
      previousActive = workspace.activeEditor
      workspace.activeEditor = controller.owner
    }
    if (!scopePushed && controller.scope) {
      keys.pushScope(controller.scope)
      scopePushed = true
    }
    if (!leafRef) {
      leafRef = workspace.on('active-leaf-change', () => claimToolbar())
      listenWin = host.ownerDocument.defaultView
      for (const name of KEYBOARD_EVENTS) listenWin?.addEventListener(name, claimToolbar)
    }
    toolbar()?.update()
  }

  function deactivate(): void {
    if (scopePushed) {
      keys.popScope(controller.scope)
      scopePushed = false
    }
    if (leafRef) {
      workspace.offref(leafRef)
      leafRef = null
      for (const name of KEYBOARD_EVENTS) listenWin?.removeEventListener(name, claimToolbar)
      listenWin = null
    }
  }

  // A link in the text is there to be written, not followed: following it would open the note
  // behind the dialog. The tap puts the cursor where it landed instead.
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest(LINK)) return
    event.preventDefault()
    event.stopPropagation()
    const cm = controller.editor.cm
    const pos = cm.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos != null) cm.dispatch({ selection: { anchor: pos } })
    cm.focus()
  }
  host.addEventListener('click', onClick, true)
  embeddedViews.set(host, controller.editor.cm)

  return {
    get: () => controller.get(),
    set: (value: string) => controller.set(value, false),
    focus: () => controller.editor.focus(),
    focusEnd: () => {
      const cm = controller.editor.cm
      cm.dispatch({ selection: { anchor: cm.state.doc.length } })
      cm.focus()
    },
    get contentEl() {
      return controller.editor.cm.contentDOM
    },
    destroy: () => {
      host.removeEventListener('click', onClick, true)
      deactivate()
      if (workspace.activeEditor === controller.owner) {
        workspace.activeEditor = previousActive ?? null
      }
      try {
        controller.unload?.()
        controller.destroy?.()
      } catch (error) {
        console.debug('[Abele] Note editor teardown:', error)
      }
      host.empty()
    },
  }
}
