import { App, Editor, SuggestModal } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
  getHighlightAtCursor,
} from '@/editor/HighlightPlugin'

class ColorPickerModal extends SuggestModal<HighlightColor> {
  private resolve: (color: HighlightColor | null) => void = () => {}
  private picked = false

  getSuggestions(query: string): HighlightColor[] {
    const q = query.toLowerCase()
    return HIGHLIGHT_COLORS.filter((c) => c.includes(q))
  }

  renderSuggestion(color: HighlightColor, el: HTMLElement): void {
    const container = el.createDiv({ cls: 'abele-color-picker-item' })
    const swatch = container.createSpan({ cls: 'abele-color-picker-swatch' })
    swatch.style.backgroundColor = `var(--abele-highlight-${color})`
    container.createSpan({ text: color })
  }

  onChooseSuggestion(color: HighlightColor): void {
    this.picked = true
    this.resolve(color)
  }

  onClose(): void {
    setTimeout(() => {
      if (!this.picked) this.resolve(null)
    }, 0)
  }

  pick(): Promise<HighlightColor | null> {
    return new Promise((resolve) => {
      this.resolve = resolve
      this.open()
    })
  }
}

function pickColor(app: App): Promise<HighlightColor | null> {
  return new ColorPickerModal(app).pick()
}

export function removeHighlight(editor: Editor) {
  const existing = getHighlightAtCursor(editor as any)
  if (!existing) return

  const content = editor.getValue()
  const innerText = content.slice(existing.openTo, existing.closeFrom)
  const cursor = editor.getCursor()
  const cursorOffset = editor.posToOffset(cursor)

  const updated = content.slice(0, existing.from) + innerText + content.slice(existing.to)
  editor.setValue(updated)

  // Adjust cursor: shift by the removed opening syntax length
  const openLen = existing.openTo - existing.from
  const newOffset = Math.max(0, cursorOffset - openLen)
  editor.setCursor(editor.offsetToPos(Math.min(newOffset, updated.length)))
}

export async function insertHighlight(editor: Editor) {
  const app = GlobalStore.getInstance().app

  // Check if cursor is inside an existing highlight
  const existing = getHighlightAtCursor(editor as any)

  const color = await pickColor(app)
  if (!color) return

  if (existing) {
    // Change color of existing highlight
    const content = editor.getValue()
    const oldOpen = content.slice(existing.from, existing.openTo)
    const newOpen = `=={${color}} `
    const updated = content.slice(0, existing.from) + newOpen + content.slice(existing.openTo)
    editor.setValue(updated)

    // Restore cursor inside the highlight
    const offset = newOpen.length - oldOpen.length
    const cursorOffset = editor.posToOffset(editor.getCursor()) + offset
    const newPos = editor.offsetToPos(Math.max(0, cursorOffset))
    editor.setCursor(newPos)
    return
  }

  const selection = editor.getSelection()

  if (selection) {
    // Check if selection is an existing highlight
    const highlightRe = /^==\{(\w+)\}\s([\s\S]*)==$/
    const match = highlightRe.exec(selection)
    if (match) {
      // Selection is a full highlight — change its color
      editor.replaceSelection(`=={${color}} ${match[2]}==`)
    } else {
      // Wrap selection
      editor.replaceSelection(`=={${color}} ${selection}==`)
    }
  } else {
    // No selection — insert empty highlight and place cursor inside
    const cursor = editor.getCursor()
    const insert = `=={${color}} ==`
    editor.replaceRange(insert, cursor)
    // Place cursor between the markers (before closing ==)
    editor.setCursor({ line: cursor.line, ch: cursor.ch + insert.length - 2 })
  }
}
