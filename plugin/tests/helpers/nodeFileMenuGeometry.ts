type Bounds = { left: number; right: number; top: number; bottom: number }

export function checkNodeFileMenuGeometry(
  menu: Bounds,
  viewport: { width: number; height: number },
  anchor: number,
  phone: boolean
): void {
  if (
    menu.left < 0 ||
    menu.right > viewport.width + 1 ||
    menu.top < 0 ||
    menu.bottom > viewport.height + 1
  )
    throw new Error('File menu escapes the viewport: ' + JSON.stringify({ menu, viewport }))
  // Obsidian deliberately uses a bottom sheet on phones, ignoring pointer coordinates.
  if (phone) {
    if (Math.abs(menu.bottom - viewport.height) > 1)
      throw new Error('File menu is detached from the viewport bottom')
  } else if (Math.min(Math.abs(menu.top - anchor), Math.abs(menu.bottom - anchor)) > 16)
    throw new Error('File menu is detached from the clicked line')
}
