import './linkHitTarget.css'

export interface LinkHitTargetOptions {
  href: string
  label: string
  secondary: boolean
  offscreen: boolean
  rect: { left: number; top: number; width: number; height: number }
  onFocus: () => void
}

/** A native control for a foreign-renderer surface; it owns no virtual DOM anchors. */
export function createLinkHitTarget(parent: HTMLElement) {
  // The surface may be in a different Obsidian window; use its own element factory.
  const element = parent.createEl('button')
  element.type = 'button'
  element.className = 'abele-link-hit-target'
  element.setAttribute('role', 'link')
  // A hit surface must never inherit native button paint or animate away from its source.
  Object.assign(element.style, {
    background: 'transparent',
    boxShadow: 'none',
    transition: 'none',
    animation: 'none',
  })
  let focus = () => {}
  const onFocus = () => focus()
  element.addEventListener('focus', onFocus)
  return {
    element,
    update(options: LinkHitTargetOptions) {
      const attr = (name: string, value: string) => {
        if (element.getAttribute(name) !== value) element.setAttribute(name, value)
      }
      attr('data-abele-href', options.href)
      attr('aria-label', options.label)
      attr('tabindex', options.secondary ? '-1' : '0')
      if (options.secondary) attr('aria-hidden', 'true')
      else if (element.hasAttribute('aria-hidden')) element.removeAttribute('aria-hidden')
      if (element.classList.contains('is-offscreen') !== options.offscreen)
        element.classList.toggle('is-offscreen', options.offscreen)
      const { left, top, width, height } = options.rect
      const styles = {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }
      for (const [name, value] of Object.entries(styles)) {
        if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
      }
      focus = options.onFocus
    },
    destroy() {
      element.removeEventListener('focus', onFocus)
      element.remove()
    },
  }
}
