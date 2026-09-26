/**
 * A page written inline, as the test's own document: happy-dom's ranges work only there, not in a
 * document of their own. The markup is parsed apart and its nodes brought in.
 */
export function pageOf(body: string, head = ''): Document {
  const parsed = new DOMParser().parseFromString(
    `<html><head>${head}</head><body>${body}</body></html>`,
    'text/html'
  )
  const bring = (from: Node) => Array.from(from.childNodes).map((n) => document.importNode(n, true))
  document.head.replaceChildren(...bring(parsed.head))
  document.body.replaceChildren(...bring(parsed.body))
  return document
}
