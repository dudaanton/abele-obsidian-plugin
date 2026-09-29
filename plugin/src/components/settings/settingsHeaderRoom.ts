/**
 * Obsidian's phone settings header floats over the native scrolling pane. Move this plugin's
 * pane below its measured edge so text cannot show through the header as the page scrolls.
 * The header belongs to Obsidian: its size, safe-area spacing and buttons remain theirs.
 */
export function settingsHeaderRoom(pane: HTMLElement, header: HTMLElement): () => void {
  const view = pane.ownerDocument.defaultView
  if (view === null) return () => undefined
  const before = pane.style.getPropertyValue('--abele-settings-header-room')
  const update = (): void => {
    const top = pane.parentElement?.getBoundingClientRect().top ?? 0
    const controls = [
      header,
      ...Array.from(header.querySelectorAll<HTMLElement>('*')),
      ...Array.from(
        pane.closest('.modal')?.querySelectorAll<HTMLElement>('.modal-close-button') ?? []
      ),
    ]
    const bottom = Math.max(...controls.map((el) => el.getBoundingClientRect().bottom))
    const room = Math.max(0, bottom - top)
    pane.style.setProperty('--abele-settings-header-room', `${room}px`)
  }
  pane.classList.add('abele-settings-pane_phone')
  update()
  const observer =
    typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(update) : null
  observer?.observe(header)
  view.addEventListener('resize', update)
  return () => {
    observer?.disconnect()
    view.removeEventListener('resize', update)
    pane.classList.remove('abele-settings-pane_phone')
    if (before) pane.style.setProperty('--abele-settings-header-room', before)
    else pane.style.removeProperty('--abele-settings-header-room')
  }
}
