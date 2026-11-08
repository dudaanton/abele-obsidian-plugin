import { parse, list } from 'postcss'

/** Keep current chrome while replacing only the frozen date-block rules.
 * Work from source text: CSSOM serialization loses a var()-based shorthand when a
 * later longhand overrides it (for example sidebar padding plus padding-top).
 */
export function timelineStructuralCss(css: string, appearance = false): string {
  const root = parse(css)
  const shells = new WeakSet<object>()
  root.walkRules((rule) => {
    if (shells.has(rule)) return
    const placement = list
      .comma(rule.selector)
      .filter((selector) => /\.abele-timeline__date-block$/.test(selector))
    if (placement.length) {
      const positions = rule.nodes.filter(
        (node) => node.type === 'decl' && node.prop === 'position'
      )
      if (!appearance && positions.length) {
        // The separator introduced a containing block. Keep that paint coordinate
        // system in both captures; changing it also changes fractional label-dot AA.
        const shell = rule.clone({ selector: placement.join(', ') })
        shell.removeAll()
        for (const position of positions) shell.append(position.clone())
        shells.add(shell)
        rule.before(shell)
      } else if (appearance && placement.length === list.comma(rule.selector).length) {
        for (const position of positions) position.remove()
      }
    }
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
