import { Menu } from 'obsidian'
import { t } from '@/i18n'
import { isIdentifier } from '@/github/search/definitions'
import type { LspPosition } from './NodeLspDocument'

interface SymbolPosition {
  name: string
  position: LspPosition
}

/** Only current after-side bytes have meaningful positions in the live language-server buffer. */
export function diffReferenceSymbol(
  root: HTMLElement,
  event: MouseEvent,
  source: string,
  caret?: Range
): SymbolPosition | null {
  const target = event.target as Element | null
  const text = target?.closest<HTMLElement>('.abele-diff__text')
  const row = text?.closest<HTMLElement>('.abele-diff__line')
  if (
    !text ||
    !row ||
    !root.contains(text) ||
    row.matches('.abele-diff__line_removed, .abele-diff__line_left')
  )
    return null
  const line = Number(row.dataset.lineB) - 1
  if (line < 0 || !Number.isInteger(line) || source.split('\n')[line] !== text.textContent)
    return null
  const doc = root.ownerDocument
  const range = caret ?? doc.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (!range || !text.contains(range.startContainer)) return null
  const prefix = doc.createRange()
  prefix.selectNodeContents(text)
  prefix.setEnd(range.startContainer, range.startOffset)
  const raw = text.textContent ?? ''
  let from = prefix.toString().length
  let to = from
  while (from > 0 && /[\w$]/.test(raw[from - 1])) --from
  while (to < raw.length && /[\w$]/.test(raw[to])) ++to
  const name = raw.slice(from, to)
  return isIdentifier(name) ? { name, position: { line, character: from } } : null
}

/** A separate menu adapter: definition execution stays in the view's existing navigation callback. */
export function installDiffReferences(
  root: HTMLElement,
  source: () => string,
  run: (kind: 'definition' | 'references', symbol: SymbolPosition) => void
) {
  const win = root.ownerDocument.defaultView ?? window
  let timer: number | undefined
  let lastPress = 0
  let menu: Menu | undefined
  const show = (event: MouseEvent) => {
    const symbol = diffReferenceSymbol(root, event, source())
    if (!symbol) return false
    menu?.hide()
    menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.goToDefinitionOf.14ff5d', { v0: symbol.name }))
        .setIcon('locate')
        .onClick(() => run('definition', symbol))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('node.lsp.references', { name: symbol.name }))
        .setIcon('search')
        .onClick(() => run('references', symbol))
    )
    menu.showAtMouseEvent(event)
    return true
  }
  const contextmenu = (event: MouseEvent) => {
    if (Date.now() - lastPress < 1000 || show(event)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  const cancel = () => {
    win.clearTimeout(timer)
    timer = undefined
  }
  const touchstart = (event: TouchEvent) => {
    cancel()
    const touch = event.touches[0]
    if (event.touches.length !== 1 || !touch) return
    const point = new MouseEvent('contextmenu', { clientX: touch.clientX, clientY: touch.clientY })
    Object.defineProperty(point, 'target', { value: event.target })
    timer = win.setTimeout(() => {
      if (show(point)) {
        lastPress = Date.now()
        root.ownerDocument.getSelection()?.removeAllRanges()
      }
    }, 500)
  }
  root.addEventListener('contextmenu', contextmenu, true)
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'F12' || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)
      return
    const selection = root.ownerDocument.getSelection()
    if (!selection?.rangeCount) return
    const target = selection.anchorNode?.parentElement
    if (!target || !root.contains(target)) return
    const point = new MouseEvent('contextmenu')
    Object.defineProperty(point, 'target', { value: target })
    const symbol = diffReferenceSymbol(root, point, source(), selection.getRangeAt(0))
    if (!symbol) return
    event.preventDefault()
    event.stopPropagation()
    run('references', symbol)
  }
  root.ownerDocument.addEventListener('keydown', keydown)
  root.addEventListener('touchstart', touchstart)
  for (const event of ['touchmove', 'touchend', 'touchcancel']) root.addEventListener(event, cancel)
  return () => {
    cancel()
    menu?.hide()
    root.removeEventListener('contextmenu', contextmenu, true)
    root.ownerDocument.removeEventListener('keydown', keydown)
    root.removeEventListener('touchstart', touchstart)
    for (const event of ['touchmove', 'touchend', 'touchcancel'])
      root.removeEventListener(event, cancel)
  }
}
