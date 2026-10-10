import type { MarkdownPostProcessorContext } from 'obsidian'
import { columnWeights, parseColumnsHeader } from './core'
import { initializeAsides } from './aside'

/** Style the native callouts in place: their embeds and task source bindings stay native. */
export function columnsPostProcessor(el: HTMLElement, ctx?: MarkdownPostProcessorContext): void {
  const selector = '.callout[data-callout="abele-columns"]'
  const parents = [
    ...(el.matches(selector) ? [el] : []),
    ...Array.from(el.querySelectorAll<HTMLElement>(selector)),
  ]
  for (const parent of parents) {
    if (parent.classList.contains('is-collapsible')) continue
    const metadata = parent.getAttribute('data-callout-metadata')
    const options = parseColumnsHeader(`[!abele-columns${metadata ? `|${metadata}` : ''}]`)
    if (!options) continue
    const content = Array.from(parent.children).find((e) => e.classList.contains('callout-content'))
    if (!content) continue
    const children = Array.from(content.children) as HTMLElement[]
    if (
      children.some(
        (e) =>
          !e.matches('.callout[data-callout="abele-column"]') ||
          e.classList.contains('is-collapsible')
      ) ||
      Array.from(content.childNodes).some((n) => n.nodeType === 3 && !!n.textContent?.trim())
    )
      continue
    const weights = columnWeights(options.ratio, children.length)
    if (!weights) continue
    parent.classList.add('abele-columns')
    parent.dataset.abeleColumnsMobile = options.mobile
    children.forEach((child, index) => {
      child.classList.add('abele-column')
      // Native empty callouts omit this node; give folding the same structure as filled ones.
      if (
        !Array.from(child.children).some((element) => element.classList.contains('callout-content'))
      )
        child.createDiv({ cls: 'callout-content' })
      const roles = (child.dataset.calloutMetadata ?? '')
        .split(/\s+/)
        .filter((token) => token.startsWith('role='))
      child.dataset.abeleColumnRole =
        roles.length === 1 && roles[0] === 'role=aside' ? 'aside' : 'main'
      child.style.setProperty('--abele-column-weight', String(weights[index]))
      for (const table of Array.from(child.querySelectorAll('table'))) {
        if (table.closest('.abele-column-table')) continue
        const scroller = table.ownerDocument.win.createDiv({ cls: 'abele-column-table' })
        table.before(scroller)
        scroller.append(table)
      }
    })
    initializeAsides(parent, children, options.mobile, ctx)
  }
}
