export interface CanvasLinkPorts {
  open(link: HTMLAnchorElement, event: MouseEvent): void
  hover(link: HTMLAnchorElement, event: MouseEvent): void
}

/** Let native mouse/touch clicks reach links without starting a canvas gesture. */
export function bindCanvasLinks(body: HTMLElement, ports: CanvasLinkPorts): () => void {
  const off: (() => void)[] = []
  let pen = false
  const listen = (type: string, handler: EventListener) => {
    body.addEventListener(type, handler)
    off.push(() => body.removeEventListener(type, handler))
  }
  const linkAt = (event: Event) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>(
      'a.internal-link, a.external-link, a[href]'
    )
    return link && body.contains(link) ? link : null
  }
  listen('pointerdown', (event) => {
    pen = (event as PointerEvent).pointerType === 'pen'
    if (!pen && linkAt(event)) event.stopPropagation()
  })
  for (const type of ['pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup'])
    listen(type, (event) => {
      if (!pen && linkAt(event)) event.stopPropagation()
    })
  for (const type of ['click', 'auxclick'])
    listen(type, (event) => {
      const link = linkAt(event),
        mouse = event as MouseEvent
      if (!link || (mouse.button !== 0 && mouse.button !== 1)) return
      event.preventDefault()
      event.stopPropagation()
      if (!pen) ports.open(link, mouse)
    })
  listen('mouseover', (event) => {
    const link = linkAt(event)
    if (link) ports.hover(link, event as MouseEvent)
  })
  return () => off.forEach((remove) => remove())
}
