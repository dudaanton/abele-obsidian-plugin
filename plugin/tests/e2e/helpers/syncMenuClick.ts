/** Serialized into the owning document, so the menu receives a pointer position. */
export function clickSyncMenu(row: HTMLElement): void {
  const button = row
    .querySelector<HTMLElement>('svg.lucide-more-horizontal')
    ?.closest<HTMLElement>('.abele-obsidian-icon')
  if (!button) throw new Error('Connection menu button unavailable')
  const box = button.getBoundingClientRect(),
    view = button.ownerDocument.defaultView
  if (!view || box.width <= 0 || box.height <= 0)
    throw new Error('Connection menu button is not visible')
  button.dispatchEvent(
    new view.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    })
  )
}
