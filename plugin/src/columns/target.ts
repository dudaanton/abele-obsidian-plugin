import { quoteSourceRange, taskMarkerPositions, type QuoteSourceRange } from './source'
import { resolveColumnTarget } from './operations'

export const COLUMN_INTERACTIVE =
  'a,input,button,select,textarea,pre,table,img,svg,.math,.footnote-ref,.internal-embed,[role="button"]'

export function columnMenuTarget(target: Element): HTMLElement | null {
  if (target.closest(COLUMN_INTERACTIVE)) return null
  const parent = target.closest<HTMLElement>('.abele-columns')
  return parent && !parent.closest('.internal-embed') ? parent : null
}

/** Find the outer native widget. The descriptive DOM path is not a source identity. */
export function columnPath(element: HTMLElement): { root: HTMLElement; path: number[] } {
  let root = element
  const path: number[] = []
  for (
    let parent = root.parentElement?.closest<HTMLElement>('.abele-columns');
    parent;
    parent = root.parentElement?.closest<HTMLElement>('.abele-columns')
  ) {
    const children = Array.from(parent.querySelectorAll<HTMLElement>('.abele-columns')).filter(
      (child) => child.parentElement?.closest('.abele-columns') === parent
    )
    path.unshift(children.indexOf(root))
    root = parent
  }
  return { root, path }
}
const QUOTE_ELEMENT = '.callout,blockquote,.abele-columns,.abele-column'
const sourceRanges = new WeakMap<HTMLElement, { text: string; from: number; to: number }>()

/** Bind native quote nodes to the Markdown quote tree's original line ranges, not admitted frames. */
function matchRanges(
  text: string,
  rootFrom: number,
  root: HTMLElement,
  establish: boolean
): boolean {
  const source = quoteSourceRange(text, rootFrom)
  if (!source) return false
  const previous = sourceRanges.get(root)
  if (previous && (previous.text !== text || previous.from !== rootFrom)) return false
  const pending: Array<{ element: HTMLElement; range: QuoteSourceRange }> = []
  const bind = (element: HTMLElement, range: QuoteSourceRange): boolean => {
    const established = sourceRanges.get(element)
    if (!establish && !established) return false
    if (
      established &&
      (established.text !== text ||
        established.from !== range.from ||
        established.to !== range.to ||
        element.dataset.abeleFrameFrom !== String(established.from) ||
        element.dataset.abeleFrameTo !== String(established.to))
    )
      return false
    const type =
      element.dataset.callout ??
      (element.classList.contains('abele-columns')
        ? 'abele-columns'
        : element.classList.contains('abele-column')
          ? 'abele-column'
          : null)
    if (
      type !== range.callout ||
      (element.hasAttribute('data-callout-metadata') &&
        element.dataset.calloutMetadata !== range.metadata)
    )
      return false
    const children = Array.from(element.querySelectorAll<HTMLElement>(QUOTE_ELEMENT)).filter(
      (child) =>
        !child.closest('.internal-embed') && child.parentElement?.closest(QUOTE_ELEMENT) === element
    )
    if (
      children.length !== range.children.length ||
      children.some((child, index) => !bind(child, range.children[index]))
    )
      return false
    pending.push({ element, range })
    return true
  }
  if (!bind(root, source)) return false
  if (!establish) return true
  for (const { element, range } of pending) {
    if (sourceRanges.has(element)) continue
    sourceRanges.set(element, { text, from: range.from, to: range.to })
    element.dataset.abeleFrameFrom = String(range.from)
    element.dataset.abeleFrameTo = String(range.to)
  }
  const tasks = Array.from(
    root.querySelectorAll<HTMLInputElement>('li[data-task] > input.task-list-item-checkbox')
  ).filter((input) => !input.closest('.internal-embed'))
  const markers = taskMarkerPositions(text, source.from, source.to)
  if (tasks.length === markers.length)
    tasks.forEach((input, index) => {
      input.dataset.abeleTaskAt = String(markers[index])
    })
  return true
}

/** Called only by the early post-processor with render-time source provenance. */
export function bindColumnRender(text: string, rootFrom: number, root: HTMLElement): boolean {
  return matchRanges(text, rootFrom, root, true)
}
function validateRanges(text: string, rootFrom: number, root: HTMLElement): boolean {
  return matchRanges(text, rootFrom, root, false)
}

export function renderedColumns(text: string, rootFrom: number, element: HTMLElement) {
  const root = columnPath(element).root
  if (!sourceRanges.has(element) || !sourceRanges.has(root)) return null
  if (!validateRanges(text, rootFrom, root)) return null
  const range = sourceRanges.get(element)
  if (!range || range.text !== text) return null
  // The same gate handles the cursor path: both ends must match and rejection never falls outward.
  return resolveColumnTarget(text, range.from, range)
}
