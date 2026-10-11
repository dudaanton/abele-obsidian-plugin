import { parse, list } from 'postcss'

/** Keep current chrome while replacing only the frozen date-block rules.
 * Work from source text: CSSOM serialization loses a var()-based shorthand when a
 * later longhand overrides it (for example sidebar padding plus padding-top).
 */
export function timelineStructuralCss(css: string, appearance = false): string {
  const root = parse(css)
  root.walkRules((rule) => {
    const selectors = list.comma(rule.selector).filter((selector) => {
      const dateBlock =
        /\.(?:timeline__date\b|abele-timeline__(?:date-|block-content\b|tasks\b|no-tasks\b|completed-toggle\b))/.test(
          selector
        )
      return dateBlock === appearance
    })
    if (!selectors.length) rule.remove()
    else if (selectors.length !== list.comma(rule.selector).length)
      rule.selector = selectors.join(', ')
  })
  root.walkAtRules((rule) => {
    if (rule.nodes?.length === 0) rule.remove()
  })
  return root.toString()
}
