import { descendantColumns } from './operations'

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
