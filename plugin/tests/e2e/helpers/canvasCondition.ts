import { WAIT_PRELUDE } from './wait'

/** Poll in the page: a readiness retry must not launch another native driver process. */
export const canvasCondition = (body: string, timeoutMs = 10_000): string => `
  ${WAIT_PRELUDE}
  const ready = await until(async () => { ${body} }, ${timeoutMs}, 50)
  if (!ready) throw new Error('Canvas condition did not become ready')
  return ready
`

/** Read selection only once the focused field and its native keyboard are ready. */
export const canvasTypingState = (text: string): string =>
  canvasCondition(`
  const field = document.activeElement
  if (!field?.matches('input,textarea') || !(
    parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height')) > 1 ||
    innerHeight - (window.visualViewport?.height ?? innerHeight) > 1)) return null
  return {expected: field.value.slice(0,field.selectionStart) + ${JSON.stringify(text)} + field.value.slice(field.selectionEnd)}
`)

/** A conservative fuzzy match: only the intended full path may contain the query in order.
 * Self-contained because the fixture evaluates it in the page against the current file index. */
export function shortCanvasQuery(target: string, paths: string[]): string {
  const name = target.slice(target.lastIndexOf('/') + 1).toLowerCase()
  const matches = (path: string, query: string) => {
    let at = 0
    for (const char of path.toLowerCase()) if (char === query[at]) at++
    return at === query.length
  }
  for (let length = 1; length <= name.length; length++) {
    for (let start = 0; start + length <= name.length; start++) {
      const query = name.slice(start, start + length)
      if (!/^[a-z0-9._-]+$/.test(query)) continue
      if (paths.filter((path) => matches(path, query)).every((path) => path === target))
        return query
    }
  }
  return target
}
