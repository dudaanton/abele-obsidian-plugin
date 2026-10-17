type Bounds = { left: number; right: number; top: number; bottom: number }

export function checkNodeChatGeometry(
  toolbar: Bounds,
  navbar: Bounds | null,
  viewport: { width: number; height: number },
  navbarAt: (x: number, y: number) => boolean
): void {
  if (
    toolbar.right <= toolbar.left ||
    toolbar.bottom <= toolbar.top ||
    toolbar.left < 0 ||
    toolbar.right > viewport.width + 1 ||
    toolbar.top < 0 ||
    toolbar.bottom > viewport.height + 1
  )
    throw new Error('Node composer actions leave the viewport: ' + JSON.stringify(toolbar))
  if (!navbar) return
  // The note's navbar can remain laid out beside or behind an open chat drawer.
  // Only its painted foreground can cover the composer, not its vertical coordinate alone.
  const left = Math.max(0, toolbar.left, navbar.left)
  const right = Math.min(viewport.width, toolbar.right, navbar.right)
  const top = Math.max(0, toolbar.top, navbar.top)
  const bottom = Math.min(viewport.height, toolbar.bottom, navbar.bottom)
  if (right <= left || bottom <= top) return
  for (const x of [left + 0.5, (left + right) / 2, right - 0.5])
    for (const y of [top + 0.5, (top + bottom) / 2, bottom - 0.5])
      if (navbarAt(x, y))
        throw new Error(
          'Node composer actions are covered by the native mobile navbar: ' +
            JSON.stringify({ toolbar, navbar })
        )
}
