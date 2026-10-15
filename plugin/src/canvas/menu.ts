import { Menu } from 'obsidian'

/**
 * A menu that closes on a press anywhere outside it. The canvas keeps its own presses from
 * reaching the page, so a menu listening there would stay open over it.
 */
export function canvasMenu(): Menu {
  const menu = new Menu(),
    doc = activeDocument
  const outside = (e: PointerEvent): void => {
    if ((e.target as Element | null)?.closest?.('.menu')) return
    doc.removeEventListener('pointerdown', outside, true)
    menu.hide()
  }
  // After the press that opens it, so that one does not close it again.
  window.setTimeout(() => doc.addEventListener('pointerdown', outside, true), 0)
  menu.onHide(() => doc.removeEventListener('pointerdown', outside, true))
  return menu
}
