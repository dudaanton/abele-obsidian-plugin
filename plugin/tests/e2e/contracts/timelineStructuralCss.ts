/** Keep the current scroller/chrome shell while comparing only frozen date-block styling. */
export function timelineStructuralCss(
  rules: Iterable<{ selectorText?: string; cssRules?: Iterable<any>; cssText: string }>
): string {
  const kept: string[] = []
  for (const rule of rules) {
    if (rule.selectorText) {
      if (
        rule.selectorText.includes('.abele-sidebar-panel') ||
        rule.selectorText === '.abele-timeline__history'
      )
        kept.push(rule.cssText)
    } else if (rule.cssRules) {
      const nested = timelineStructuralCss(rule.cssRules)
      if (nested) kept.push(rule.cssText.slice(0, rule.cssText.indexOf('{')) + '{' + nested + '}')
    }
  }
  return kept.join('\n')
}
