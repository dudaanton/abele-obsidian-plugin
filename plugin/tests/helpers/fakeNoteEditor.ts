/**
 * A stand-in for Obsidian's note editor, for component tests of the fields built on it.
 *
 * The real one is borrowed out of Obsidian's insides (`src/editor/embeddedEditor.ts`) and only
 * exists in the running app, where the e2e tier drives it. This one reports text, blur and
 * Mod+Enter the way the real one does, through the same options. Use it as the module:
 *
 *   vi.mock('@/editor/embeddedEditor', () => import('../helpers/fakeNoteEditor'))
 */
import type { App } from 'obsidian'
import type { EmbeddedEditor, EmbeddedEditorOptions } from '@/editor/embeddedEditor'

export interface FakeNoteEditor {
  host: HTMLElement
  value: string
  placeholder?: string
  /** What typing does: the text changes and the field hears of it. */
  type(value: string): void
  blur(): void
  /** Mod+Enter. */
  submit(): void
  destroyed: boolean
}

/** Every editor built since the last `resetFakeNoteEditors`, in order. */
export const fakeNoteEditors: FakeNoteEditor[] = []

export function resetFakeNoteEditors(): void {
  fakeNoteEditors.splice(0)
}

export const embeddedViews = new WeakMap<HTMLElement, unknown>()

export function isEmbeddedEditorAvailable(_app: App): boolean {
  return true
}

export function createEmbeddedEditor(
  _app: App,
  host: HTMLElement,
  options: EmbeddedEditorOptions
): EmbeddedEditor | null {
  const content = host.ownerDocument.createElement('div')
  content.className = 'fake-note-editor'
  content.contentEditable = 'true'
  host.appendChild(content)
  const fake: FakeNoteEditor = {
    host,
    value: options.value ?? '',
    placeholder: options.placeholder,
    type(value) {
      fake.value = value
      options.onChange?.(value)
    },
    blur: () => options.onBlur?.(),
    submit: () => options.onSubmit?.(),
    destroyed: false,
  }
  fakeNoteEditors.push(fake)
  return {
    get: () => fake.value,
    set: (value: string) => void (fake.value = value),
    focus: () => content.focus(),
    focusEnd: () => content.focus(),
    contentEl: content,
    destroy: () => {
      fake.destroyed = true
      content.remove()
    },
  }
}
