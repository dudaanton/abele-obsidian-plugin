/** Only the state menu owns a hold; a tap and a scroll keep their native behaviour. */
export function bindCheckboxMenu(
  doc: Document,
  open: (input: HTMLInputElement, point: { x: number; y: number }) => boolean
): () => void {
  const win = doc.defaultView ?? window
  let timer: number | undefined
  let press: { input: HTMLInputElement; x: number; y: number; id: number } | undefined
  let held: HTMLInputElement | undefined
  let heldUntil = 0
  let selectionRoot: Element | null = null
  const inputAt = (event: Event) =>
    (event.target as Element | null)?.closest?.<HTMLInputElement>(
      'input.task-list-item-checkbox[data-task], li[data-task] > input.task-list-item-checkbox'
    )
  const cancel = () => {
    win.clearTimeout(timer)
    press = undefined
    selectionRoot?.classList.remove('abele-checkbox-press')
    selectionRoot = null
  }
  const up = () => {
    if (held) heldUntil = Date.now() + 1200
    cancel()
  }
  const selecting = (event: Event) => {
    if (selectionRoot) event.preventDefault()
  }
  const down = (event: PointerEvent) => {
    cancel()
    held = undefined
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    const input = inputAt(event)
    if (!input) return
    // WebKit otherwise selects nearby prose and puts its Copy toolbar over the state menu.
    // Only while this finger is on a checkbox; a swipe or release restores text selection.
    selectionRoot = input.closest('.markdown-preview-view, .markdown-embed-content')
    selectionRoot?.classList.add('abele-checkbox-press')
    press = { input, x: event.clientX, y: event.clientY, id: event.pointerId }
    timer = win.setTimeout(() => {
      if (press && input.isConnected && open(input, press)) {
        held = input
        heldUntil = Date.now() + 1200
      }
      press = undefined
    }, 550)
  }
  const move = (event: PointerEvent) => {
    if (
      press &&
      (press.id !== event.pointerId ||
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8)
    )
      cancel()
  }
  const context = (event: MouseEvent) => {
    win.clearTimeout(timer)
    press = undefined
    const input = inputAt(event)
    if (!input) return
    if (
      (held === input && Date.now() < heldUntil) ||
      open(input, { x: event.clientX, y: event.clientY })
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  const click = (event: MouseEvent) => {
    if (held && inputAt(event) === held && Date.now() < heldUntil) {
      event.preventDefault()
      event.stopImmediatePropagation()
      held = undefined
    }
  }
  doc.addEventListener('pointerdown', down, true)
  doc.addEventListener('pointermove', move, true)
  doc.addEventListener('pointerup', up, true)
  doc.addEventListener('selectstart', selecting, true)
  doc.addEventListener('pointercancel', cancel, true)
  doc.addEventListener('contextmenu', context, true)
  doc.addEventListener('click', click, true)
  return () => {
    cancel()
    doc.removeEventListener('pointerdown', down, true)
    doc.removeEventListener('pointermove', move, true)
    doc.removeEventListener('pointerup', up, true)
    doc.removeEventListener('selectstart', selecting, true)
    doc.removeEventListener('pointercancel', cancel, true)
    doc.removeEventListener('contextmenu', context, true)
    doc.removeEventListener('click', click, true)
  }
}
