import { EditorView } from '@codemirror/view'
import { GlobalStore } from '@/stores/GlobalStore'
import { MarkdownView } from 'obsidian'

const FLASH_CLASS = 'abele-footnote-flash'
const MAX_RETRIES = 12
const RETRY_DELAY = 80

export function reliableScrollTo(offset: number, flash = true) {
  const cmView = getCmView()
  if (!cmView) {
    const mdView = GlobalStore.getInstance().app.workspace.getActiveViewOfType(MarkdownView)
    if (!mdView) return
    const editor = mdView.editor
    const pos = editor.offsetToPos(offset)
    editor.setCursor(pos)
    editor.scrollIntoView({ from: pos, to: pos }, true)
    return
  }

  let attempt = 0

  const tryScroll = () => {
    // Rough scroll via height estimate
    const block = cmView.lineBlockAt(offset)
    const scrollerHeight = cmView.scrollDOM.clientHeight
    cmView.scrollDOM.scrollTop = Math.max(0, block.top - scrollerHeight / 2)

    attempt++

    if (attempt >= MAX_RETRIES) {
      centerAndFinish()
      return
    }

    window.setTimeout(() => {
      // If target is rendered, use native scrollIntoView for precise centering
      if (tryNativeCenter()) {
        window.setTimeout(() => finish(), RETRY_DELAY)
        return
      }
      tryScroll()
    }, RETRY_DELAY)
  }

  const tryNativeCenter = (): boolean => {
    try {
      const domPos = cmView.domAtPos(offset)
      const lineEl =
        domPos.node instanceof HTMLElement
          ? domPos.node.closest('.cm-line')
          : (domPos.node.parentElement?.closest('.cm-line') ?? null)
      if (lineEl) {
        lineEl.scrollIntoView({ block: 'center', behavior: 'instant' })
        return true
      }
    } catch {
      // not rendered
    }
    return false
  }

  const centerAndFinish = () => {
    tryNativeCenter()
    window.setTimeout(() => finish(), RETRY_DELAY)
  }

  const finish = () => {
    cmView.dispatch({ selection: { anchor: offset } })
    cmView.focus()
    if (flash) window.setTimeout(() => tryFlash(offset), 50)
  }

  tryScroll()
}

function tryFlash(offset: number) {
  const cmView = getCmView()
  if (!cmView) return

  try {
    const domPos = cmView.domAtPos(offset)
    const lineEl =
      domPos.node instanceof HTMLElement
        ? domPos.node.closest('.cm-line')
        : (domPos.node.parentElement?.closest('.cm-line') ?? null)
    if (lineEl) {
      lineEl.classList.remove(FLASH_CLASS)
      void (lineEl as HTMLElement).offsetWidth
      lineEl.classList.add(FLASH_CLASS)
      window.setTimeout(() => lineEl.classList.remove(FLASH_CLASS), 2500)
    }
  } catch {
    // pos outside viewport
  }
}

function getCmView(): EditorView | undefined {
  const mdView = GlobalStore.getInstance().app.workspace.getActiveViewOfType(MarkdownView)
  if (!mdView) return undefined
  return (mdView as any).editor?.cm as EditorView | undefined
}
