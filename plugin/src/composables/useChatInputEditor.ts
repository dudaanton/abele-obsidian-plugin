import { ref, nextTick, onMounted, onUnmounted, type Ref } from 'vue'
import { TFile, type Scope } from 'obsidian'
import type { Extension } from '@codemirror/state'
import { insertLine } from '@/ai/replyLinks'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  createEmbeddedEditor,
  isEmbeddedEditorAvailable,
  type EmbeddedEditor,
} from '@/editor/embeddedEditor'

interface InputEditorOptions {
  props: { textOnly?: boolean; canNote?: boolean }
  text: Ref<string>
  expanded: Ref<boolean>
  send: () => void
  keepNote: () => void
  emitFocus: (focused: boolean) => void
  /** More of the note editor's drawing: the reply chips. */
  extensions?: Extension[]
  /** The keys of the chat pane around the field, heard while it has the focus. */
  parentScope?: Scope
}

/** The borrowed note editor and the plain-text fallback share the same composer actions. */
export function useChatInputEditor(options: InputEditorOptions) {
  const { props, text, expanded, send, keepNote, emitFocus } = options
  const inputEl = ref<HTMLTextAreaElement | null>(null)
  const editorHost = ref<HTMLElement | null>(null)
  /**
   * The note editor cannot be borrowed — an Obsidian that moved its insides, or a test with no
   * Obsidian at all — and the field is the plain text box it used to be.
   */
  const fallback = ref(props.textOnly || !isEmbeddedEditorAvailable(GlobalStore.getInstance().app))
  let editor: EmbeddedEditor | null = null
  /** What the editor itself last reported, so writing it back does not move the cursor. */
  let echoed = ''

  /**
   * Puts text in the field from outside — a draft coming back, a quote, a dictation, a send
   * emptying it. Straight into the editor as well, not through a watcher: typed and cleared in
   * one tick, the value a watcher sees has not changed, and the sent words stayed in the field.
   */
  const write = (value: string) => {
    text.value = value
    if (editor && value !== echoed) {
      echoed = value
      editor.set(value)
    }
  }

  const autoResize = () => {
    const el = inputEl.value
    // A hidden field — the chat's drawer on a phone, shut while text is put in — measures
    // nothing; it is sized when it is drawn (`watchDrawn`).
    if (!el || !el.getClientRects().length) return
    // Opened out, the stylesheet gives it the chat's height, and it scrolls within that.
    if (expanded.value) {
      el.style.removeProperty('height')
      el.style.removeProperty('overflow-y')
      return
    }
    // One line at least and eight at most (Obsidian's line height): the stylesheet holds both
    // limits, so the field is let down to its least and grown to what the text needs.
    el.style.removeProperty('height')
    const most = parseFloat(getComputedStyle(el).maxHeight) || Infinity
    el.style.height = `${Math.min(el.scrollHeight, most)}px`
    el.style.overflowY = el.scrollHeight > most ? 'auto' : 'hidden'
  }

  const onInput = (e: Event) => {
    text.value = (e.target as HTMLTextAreaElement).value
    nextTick(autoResize)
  }

  const syncText = (value: string) => {
    if (editor && value !== echoed) {
      echoed = value
      editor.set(value)
    }
    nextTick(autoResize)
  }

  /** `atEnd` puts the cursor after what is already typed — text somebody else put there. */
  function focus(options: { atEnd?: boolean } = {}) {
    if (editor) {
      if (options.atEnd) editor.focusEnd()
      else editor.focus()
      return
    }
    const el = inputEl.value
    if (!el) return
    el.focus()
    if (options.atEnd) el.setSelectionRange(el.value.length, el.value.length)
  }

  /**
   * A line of its own where the cursor is — a place replied to — and the cursor on the line after
   * it, for the words about it.
   */
  function placeLine(line: string) {
    const el = inputEl.value
    const at = editor ? editor.cursor() : (el?.selectionStart ?? text.value.length)
    const placed = insertLine(text.value, at, line)
    write(placed.text)
    if (editor) return editor.focusAt(placed.cursor)
    void nextTick(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(placed.cursor, placed.cursor)
      autoResize()
    })
  }

  /** Whether the field has the cursor — a focus given to one not on screen yet is dropped. */
  function hasFocus(): boolean {
    const el = editor ? editor.contentEl : inputEl.value
    const active = el?.ownerDocument.activeElement
    return !!el && !!active && el.contains(active)
  }

  /** Some of the field's text is selected — what Ctrl+C copies. */
  function hasSelection(): boolean {
    if (editor) return editor.hasSelection()
    const el = inputEl.value
    return !!el && el.selectionStart !== el.selectionEnd
  }

  const onKeydown = (e: KeyboardEvent) => {
    // Alt+Enter is Enter without the model, and only where there is a note to keep.
    if (e.key === 'Enter' && e.altKey && props.canNote) {
      e.preventDefault()
      keepNote()
      return
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Cmd/Ctrl+Enter is send in either field. The borrowed editor's scope first
  // shields it from Obsidian's earlier window-capture follow-link hotkey.
  const onCaptureKeydown = (e: KeyboardEvent) => {
    // A borrowed editor submits through its scope before this listener is reached.
    if (editor && e.defaultPrevented) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && hasFocus()) {
      e.preventDefault()
      e.stopImmediatePropagation()
      send()
    }
  }

  /**
   * The keys the note editor is given before its own and Obsidian's: the same as the text box
   * had. Enter is a new line, as in a note; Shift+Enter sends; Alt+Enter keeps a note, and only
   * where there is one to keep — anywhere else Obsidian may have it.
   */
  const EDITOR_KEYS = [
    {
      key: 'Shift-Enter',
      run: () => {
        send()
        return true
      },
    },
    {
      key: 'Alt-Enter',
      run: () => {
        if (!props.canNote) return false
        keepNote()
        return true
      },
    },
  ]

  const mountEditor = () => {
    const host = editorHost.value
    if (!host) return
    echoed = text.value
    editor = createEmbeddedEditor(GlobalStore.getInstance().app, host, {
      value: text.value,
      placeholder: 'Message...',
      onChange: (value) => {
        echoed = value
        text.value = value
      },
      onSubmit: send,
      onFocus: () => emitFocus(true),
      onBlur: () => emitFocus(false),
      keys: EDITOR_KEYS,
      extensions: options.extensions,
      parentScope: options.parentScope,
    })
    if (!editor) fallback.value = true
  }

  /** A press on the field below the last line puts the cursor at the end, as in a note. */
  const onEmptyPress = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (!editor || target.closest('.cm-content')) return
    event.preventDefault()
    editor.focusEnd()
  }

  /**
   * A file dropped on the note editor is an attachment, as it was on the text box — not a link
   * written into the message, which is what the editor would make of it. Only the default is
   * taken from the editor (it stands down for an event already handled); the drop goes on to the
   * handlers above, which read what was dropped. Text dragged in is left to the editor.
   */
  const onEditorDrop = (e: DragEvent) => {
    const dt = e.dataTransfer
    if (!dt) return
    const plain = dt.getData('text/plain')?.trim() ?? ''
    if (dt.files?.length || plain.startsWith('obsidian://') || isVaultPath(plain)) {
      e.preventDefault()
    }
  }

  const isVaultPath = (value: string): boolean => {
    if (!value || value.includes('\n')) return false
    const { app } = GlobalStore.getInstance()
    return app.vault.getAbstractFileByPath(value.replace(/^\[\[|\]\]$/g, '')) instanceof TFile
  }

  /**
   * Sizes the field again whenever its width changes — above all from none to some, when a chat
   * that was filled while hidden is shown: its text arrived when there was nothing to measure.
   */
  let drawn: ResizeObserver | null = null
  let lastWidth = -1
  const watchDrawn = () => {
    const el = inputEl.value
    const View = el?.ownerDocument.defaultView?.ResizeObserver ?? window.ResizeObserver
    if (!el || !View) return
    drawn = new View((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0
      if (width === lastWidth) return
      lastWidth = width
      if (width > 0) autoResize()
    })
    drawn.observe(el)
  }

  onMounted(() => {
    window.addEventListener('keydown', onCaptureKeydown, true)
    if (fallback.value) {
      watchDrawn()
      return
    }
    mountEditor()
    // Built and refused after all: the text box is drawn on the next tick, and sized from then.
    if (fallback.value) void nextTick(watchDrawn)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onCaptureKeydown, true)
    drawn?.disconnect()
    editor?.destroy()
    editor = null
  })

  return {
    inputEl,
    editorHost,
    fallback,
    write,
    autoResize,
    onInput,
    syncText,
    focus,
    placeLine,
    hasFocus,
    hasSelection,
    onKeydown,
    onEmptyPress,
    onEditorDrop,
  }
}
