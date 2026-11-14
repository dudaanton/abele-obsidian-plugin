import { MarkdownRenderChild, setIcon, type MarkdownPostProcessorContext } from 'obsidian'
import type { ColumnsMobile } from './core'

const mounted = new WeakSet<HTMLElement>()

/** Aside folding is view state, never Markdown state or a native collapsible frame. */
export function initializeAsides(
  parent: HTMLElement,
  columns: HTMLElement[],
  mobile: ColumnsMobile,
  ctx?: MarkdownPostProcessorContext
): void {
  const asides = columns.filter((column) => column.dataset.abeleColumnRole === 'aside')
  for (const aside of asides) {
    const label = aside.querySelector<HTMLElement>(':scope > .callout-title > .callout-title-inner')
    if (label?.textContent && /^abele[ -]column$/i.test(label.textContent)) label.setText('Aside')
  }
  if (mobile !== 'aside-collapse' || !asides.length || !ctx || mounted.has(parent)) return
  mounted.add(parent)
  const states = asides.flatMap((aside) => {
    const title = aside.querySelector<HTMLElement>(':scope > .callout-title')
    if (!title) return []
    const fold = title.ownerDocument.win.createDiv({
      cls: 'callout-fold abele-column-aside-fold',
      parent: title,
    })
    return [{ aside, title, fold, collapsed: true, applied: '' }]
  })
  let gone = false
  let lastNarrow: boolean | undefined
  const update = (narrow = parent.clientWidth <= 500) => {
    if (gone) return
    lastNarrow = narrow
    for (const state of states) {
      const presentation = narrow ? (state.collapsed ? 'collapsed' : 'expanded') : 'wide'
      // Height-only deliveries must not replace icons or write attributes again: those
      // mutations can make the host measure the widget and deliver another resize.
      if (state.applied === presentation) continue
      state.applied = presentation
      state.aside.dataset.abeleAsideCollapsed = String(narrow && state.collapsed)
      state.fold.hidden = !narrow
      if (narrow) {
        state.title.setAttribute('role', 'button')
        state.title.tabIndex = 0
        state.title.setAttribute('aria-expanded', String(!state.collapsed))
        setIcon(state.fold, state.collapsed ? 'chevron-right' : 'chevron-down')
      } else {
        state.title.removeAttribute('role')
        state.title.removeAttribute('tabindex')
        state.title.removeAttribute('aria-expanded')
      }
    }
  }
  const handlers = states.map((state) => {
    const toggle = (event: Event) => {
      if (gone || parent.clientWidth > 500 || (event.target as Element).closest('a,input,button'))
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      state.collapsed = !state.collapsed
      update()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') toggle(event)
    }
    // Keep both native CodeMirror entry and the column menu away from the fold gesture.
    const press = (event: Event) => {
      if (parent.clientWidth <= 500) event.stopPropagation()
    }
    state.title.addEventListener('click', toggle, true)
    state.title.addEventListener('keydown', key)
    state.title.addEventListener('pointerdown', press)
    state.title.addEventListener('mousedown', press)
    return () => {
      state.title.removeEventListener('click', toggle, true)
      state.title.removeEventListener('keydown', key)
      state.title.removeEventListener('pointerdown', press)
      state.title.removeEventListener('mousedown', press)
    }
  })
  const Observer =
    (parent.ownerDocument.win as Window & { ResizeObserver?: typeof ResizeObserver })
      .ResizeObserver ?? ResizeObserver
  let stopped = false
  let transitions = 0
  let lastResize = 0
  const resize = new Observer(() => {
    if (gone || stopped) return
    const narrow = parent.clientWidth <= 500
    if (narrow === lastNarrow) return
    const now = Date.now()
    if (now - lastResize > 1000) transitions = 0
    lastResize = now
    // Bound alternating layouts as well as same-width feedback. Do not automatically
    // rearm a runaway observer; a fresh render gets a fresh budget. Clicks still work.
    if (++transitions > 16) {
      stopped = true
      resize.disconnect()
      console.warn('Abele: stopped repeated column aside layout changes')
      return
    }
    update(narrow)
  })
  update()
  resize.observe(parent)
  class AsideRenderChild extends MarkdownRenderChild {
    onunload(): void {
      gone = true
      resize.disconnect()
      handlers.forEach((remove) => remove())
    }
  }
  ctx.addChild(new AsideRenderChild(parent))
}
