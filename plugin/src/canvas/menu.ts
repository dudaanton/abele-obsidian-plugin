import { Menu } from 'obsidian'

const openMenus = new WeakMap<Document, Menu>()

/**
 * A menu that closes on a press anywhere outside it. The canvas keeps its own presses from
 * reaching the page, so a menu listening there would stay open over it.
 * Pass closing work here: Menu.onHide replaces its previous callback, including our cleanup.
 */
export function canvasMenu(onHide?: () => void): Menu {
  const menu = new Menu(),
    doc = activeDocument
  openMenus.get(doc)?.hide()
  openMenus.set(doc, menu)
  const outside = (e: PointerEvent): void => {
    if ((e.target as Element | null)?.closest?.('.menu')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    menu.hide()
  }
  const wheel = (e: WheelEvent): void => {
    if (!(e.target as Element | null)?.closest?.('.menu')) menu.hide()
  }
  const key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    menu.hide()
  }
  // After the press that opens it, so that one does not close it again.
  const timer = window.setTimeout(() => {
    doc.addEventListener('pointerdown', outside, true)
    doc.addEventListener('wheel', wheel, true)
    doc.addEventListener('keydown', key, true)
  }, 0)
  menu.onHide(() => {
    window.clearTimeout(timer)
    doc.removeEventListener('pointerdown', outside, true)
    doc.removeEventListener('wheel', wheel, true)
    doc.removeEventListener('keydown', key, true)
    if (openMenus.get(doc) === menu) openMenus.delete(doc)
    onHide?.()
  })
  return menu
}
