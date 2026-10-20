import { KEYBOARD_EVENTS, fullHeight, keyboardVar } from '@/modal/keyboard'

/** Keep Obsidian's native popup in the same keyboard room as the sheet's field. */
export function fitSuggestionAboveKeyboard(input: HTMLInputElement, popup: HTMLElement): void {
  const doc = input.ownerDocument
  const win = doc.defaultView
  if (!win || doc.activeElement !== input) return
  const viewport = win.visualViewport
  const keyboard = keyboardVar(doc)
  const visualBottom = viewport ? viewport.offsetTop + viewport.height : win.innerHeight
  const bottom = Math.min(fullHeight(win) - keyboard, visualBottom)
  if (bottom >= win.innerHeight) return
  const rect = popup.getBoundingClientRect()
  if (rect.bottom <= bottom && rect.top >= (viewport?.offsetTop ?? 0)) return
  const field = input.getBoundingClientRect()
  const top = (viewport?.offsetTop ?? 0) + 5
  const above = Math.max(0, field.top - top - 5)
  const below = Math.max(0, bottom - field.bottom - 5)
  const room = Math.max(above, below)
  const height = Math.min(rect.height, room)
  const target = above > below ? field.top - 5 - height : field.bottom + 5
  const parent = popup.offsetParent as HTMLElement | null
  popup.style.setProperty(
    'top',
    `${target - (parent?.getBoundingClientRect().top ?? 0) + (parent?.scrollTop ?? 0)}px`
  )
  popup.style.removeProperty('bottom')
  popup.style.setProperty('max-height', `${room}px`)
}

/** Follow native keyboard notifications, viewport changes and the shell's layout changes. */
export function watchSuggestionKeyboard(input: HTMLInputElement, popup: HTMLElement): () => void {
  const win = input.ownerDocument.defaultView
  if (!win) return () => {}
  let frame = 0
  const schedule = () => {
    win.cancelAnimationFrame(frame)
    frame = win.requestAnimationFrame(() => fitSuggestionAboveKeyboard(input, popup))
  }
  for (const event of KEYBOARD_EVENTS) win.addEventListener(event, schedule)
  win.addEventListener('resize', schedule)
  win.visualViewport?.addEventListener('resize', schedule)
  win.visualViewport?.addEventListener('scroll', schedule)
  input.ownerDocument.addEventListener('scroll', schedule, true)
  input.addEventListener('input', schedule)
  const observer = new MutationObserver(schedule)
  for (const el of [input.ownerDocument.documentElement, input.ownerDocument.body])
    observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] })
  const resize = new ResizeObserver(schedule)
  resize.observe(popup)
  const sheet = input.closest('.modal')
  if (sheet) resize.observe(sheet)
  schedule()
  return () => {
    win.cancelAnimationFrame(frame)
    observer.disconnect()
    resize.disconnect()
    for (const event of KEYBOARD_EVENTS) win.removeEventListener(event, schedule)
    win.removeEventListener('resize', schedule)
    win.visualViewport?.removeEventListener('resize', schedule)
    win.visualViewport?.removeEventListener('scroll', schedule)
    input.ownerDocument.removeEventListener('scroll', schedule, true)
    input.removeEventListener('input', schedule)
  }
}
