import { descendantColumns } from './operations'

export const COLUMN_INTERACTIVE =
  'a,input,button,select,textarea,pre,table,img,svg,.math,.footnote-ref,.internal-embed,[role="button"]'

export function columnMenuTarget(target: Element): HTMLElement | null {
  if (target.closest(COLUMN_INTERACTIVE)) return null
  const parent = target.closest<HTMLElement>('.abele-columns')
  return parent && !parent.closest('.internal-embed') ? parent : null
}

/** Native widget positions identify the outer quote; the DOM nesting path identifies its child. */
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
export function renderedColumns(text: string, rootFrom: number, element: HTMLElement) {
  return descendantColumns(text, rootFrom, columnPath(element).path)
}
